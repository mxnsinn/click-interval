'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { test } = require('node:test');
const setup = require('./minecraft-server/seamless-restart-setup');
const { normalizeSeamlessRestartConfig } = require('./minecraft-server/seamless-restart');
const main = fss.readFileSync(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');
const originalSecret = 'verified-existing-credential-'.repeat(3);
const rotatedSecret = 'mistakenly-rotated-credential-'.repeat(3);

function block(start, end) {
  const from = main.indexOf(start), to = main.indexOf(end, from + start.length);
  assert(from >= 0 && to > from);
  return main.slice(from, to);
}
const setupSource = block('async function getSeamlessRestartSetupForwardingSecret', 'async function disableSeamlessRestart');
const recoverySource = block('async function recoverInterruptedSeamlessRestartTransaction', 'function renderSeamlessRestartCoordinatorConfig');
const disableSource = block('async function disableSeamlessRestart', 'async function readWorldSavedVersion');
const installedSource = block('function isInstalledSeamlessRestartMetadata', 'async function assertOriginalSeamlessRestartBackups');
const safeSource = block('async function assertSeamlessRestartMutationStillSafe', 'async function getSeamlessRestartSetupForwardingSecret');
const mapSource = block('function seamlessRestartSetupFileMap', 'async function ');

async function fixture(t, { installed = false, running = false } = {}) {
  const work = path.resolve(__dirname, 'work');
  await fs.mkdir(work, { recursive: true });
  const root = await fs.mkdtemp(path.join(work, 'seamless-persistence-'));
  t.after(async () => {
    assert.equal(path.dirname(root), work);
    assert(path.basename(root).startsWith('seamless-persistence-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const seamlessRoot = path.join(root, '.click-interval-seamless-restart');
  const paths = { root, seamlessRestartRoot: seamlessRoot };
  const names = {
    VelocityConfig: 'velocity/velocity.toml', VelocitySecret: 'velocity/forwarding.secret',
    VelocityJar: 'velocity/velocity.jar', LimboJar: 'limbo/NanoLimbo.jar',
    LimboConfig: 'limbo/settings.yml', LimboSecret: 'limbo/forwarding.secret',
    CoordinatorJar: 'velocity/plugins/ClickIntervalRestartProxy.jar',
    CoordinatorConfig: 'velocity/plugins/clickinterval-restart-proxy/config.properties',
    Metadata: 'metadata.json', Notices: 'THIRD-PARTY-NOTICES.txt'
  };
  for (const [key, relative] of Object.entries(names)) paths[`seamlessRestart${key}`] = path.join(seamlessRoot, relative);
  paths.seamlessRestartFabricProxyConfig = path.join(root, 'config/FabricProxy-Lite.toml');
  paths.seamlessRestartFabricProxyJar = path.join(root, 'mods/FabricProxy-Lite.jar');
  const holdingConfig = path.join(seamlessRoot, 'holding-fabric/config/FabricProxy-Lite.toml');
  const profileId = path.basename(root);
  const state = {
    config: { seamlessRestart: normalizeSeamlessRestartConfig({ enabled: installed }),
      serverType: 'fabric', serverVersion: '26.2', onlineMode: true, port: 25565,
      voiceUdpPort: 24454, maxPlayers: 20, motd: 'Original' },
    metadata: installed ? { schemaVersion: 1, feature: 'seamless-restart', state: 'installed',
      commitMarker: 'complete', profileId } : { feature: 'seamless-restart', state: 'disabled', commitMarker: 'complete', profileId },
    inspectReady: true, holdingValid: true, holdingEnabled: true,
    writes: [], downloads: [], restores: 0, logs: [], inspections: []
  };
  const write = async (file, content) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };
  await write(holdingConfig, setup.renderFabricProxyLiteConfig({ forwardingSecret: originalSecret }));
  await write(paths.seamlessRestartVelocitySecret, `${rotatedSecret}\n`);
  await write(paths.seamlessRestartMetadata, JSON.stringify(state.metadata));
  const context = vm.createContext({
    path, fs, crypto, Buffer, Date, AggregateError,
    seamlessSetupPromise: null, serverProcess: running ? {} : null,
    pendingServerStart: null, serverStopPromise: null, serverState: running ? 'running' : 'stopped',
    seamlessVelocityProcess: running ? {} : null, seamlessLimboProcess: running ? {} : null,
    serverToolMutationCoordinator: { run: (_key, callback) => Promise.resolve().then(callback) },
    getActiveProfile: async () => ({ id: profileId }), getPathsForProfile: () => paths,
    readConfig: async () => structuredClone(state.config), readJson: async () => structuredClone(state.metadata),
    getSeamlessRestartConfig: config => normalizeSeamlessRestartConfig(config.seamlessRestart),
    normalizeServerConfig: config => ({ ...config, seamlessRestart: normalizeSeamlessRestartConfig(config.seamlessRestart) }),
    getServerPlatformStatus: async () => ({ type: 'fabric', minecraftVersion: '26.2' }),
    resolveJava: async () => ({ available: true, major: 25 }), MIN_JAVA_MAJOR: 25,
    normalizeServerType: value => value, normalizeSeamlessRestartConfig,
    SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION: '26.2', LOCAL_ONLY_BIND_IP: '127.0.0.1',
    SEAMLESS_RESTART_COORDINATOR_SOURCE: path.join(root, 'bundled.jar'),
    SEAMLESS_RESTART_PINNED_ARTIFACTS: setup.PINNED_ARTIFACTS,
    readConfiguredRconPort: async () => 0, assertTcpEndpointAvailable: async () => {},
    readSmallTextFile: file => fs.readFile(file, 'utf8'),
    parseFabricProxyLiteSecret: text => setup.parseFabricProxyLiteConfig(text).secret,
    inspectHoldingLobby: async options => {
      state.inspections.push(options);
      return { enabled: state.holdingEnabled,
        ready: !state.holdingEnabled || (state.holdingValid && options.forwardingSecret === originalSecret),
        error: 'Holding lobby preflight failed: verification failed.' };
    },
    getSeamlessRestartInspection: async (config, _paths, platform, java, options = {}) => {
      assert.equal(platform.type, 'fabric'); assert.equal(java.major, 25);
      if (options.metadataOverride) {
        const proxy = (await fs.readFile(paths.seamlessRestartVelocitySecret, 'utf8')).trim();
        const backend = setup.parseFabricProxyLiteConfig(await fs.readFile(paths.seamlessRestartFabricProxyConfig, 'utf8')).secret;
        assert.equal(proxy, originalSecret); assert.equal(backend, originalSecret);
        assert.equal(setup.parseFabricProxyLiteConfig(await fs.readFile(holdingConfig, 'utf8')).secret, originalSecret);
      }
      return { status: { setupReady: state.inspectReady, reasons: [] }, artifactReport: { ready: state.inspectReady } };
    },
    isRegularFile: async () => true,
    ensurePinnedSeamlessRestartArtifact: async (id, file) => { state.downloads.push(id); await write(file, id); },
    assertNoConflictingFabricProxyLiteMods: async () => {},
    backupOriginalSeamlessRestartBackendFiles: async () => ({ jarExisted: false, configExisted: false, jarBackupSha256: '', configBackupSha256: '' }),
    restoreOriginalSeamlessRestartBackendFiles: async () => { state.restores++; },
    assertOriginalSeamlessRestartBackups: async () => {}, hashMatches: async () => true,
    inspectFabricProxyLiteConfigSemantics: async () => ({ ready: true }),
    createSeamlessRestartSetup: setup.createSeamlessRestartSetup,
    renderSeamlessRestartCoordinatorConfig: () => 'main-server=main\n',
    seamlessRestartSourceSettings: config => ({ motd: config.motd, maxPlayers: config.maxPlayers }),
    writeJsonAtomically: async (file, data) => {
      state.writes.push(file); state.metadata = structuredClone(data); await write(file, JSON.stringify(data));
    },
    writeTextAtomically: async (file, data) => { state.writes.push(file); await write(file, data); },
    copyFileAtomically: async (_from, file) => { state.writes.push(file); await write(file, 'artifact'); },
    calculateFileHash: async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),
    writeConfig: async (config, _paths, options) => {
      assert.equal(options.allowSeamlessRestartMutation, true);
      state.writes.push('config'); state.config = structuredClone(config); return config;
    },
    appendServerLog: text => state.logs.push(text), invalidateStatusCache: () => {}
  });
  vm.runInContext(`${installedSource}\n${recoverySource}\n${safeSource}\n${mapSource}\n${setupSource}\n${disableSource}`, context);
  return { state, context, paths, holdingConfig, profileId,
    setup: () => context.setupSeamlessRestart(),
    recover: () => context.recoverInterruptedSeamlessRestartTransaction(paths, state.config, profileId) };
}

test('disabled setup repairs a rotated proxy credential while preserving the protected lobby', async t => {
  const f = await fixture(t);
  const holdingBefore = await fs.readFile(f.holdingConfig);
  const result = await f.setup();
  assert.equal(result.enabled, true);
  assert.equal(f.state.metadata.state, 'installed');
  assert.equal(f.state.metadata.commitMarker, 'complete');
  assert.deepEqual(await fs.readFile(f.holdingConfig), holdingBefore);
  assert.equal(f.state.restores, 0);
  assert.equal(f.state.inspections[0].forwardingSecret, rotatedSecret);
  assert.equal(f.state.inspections[1].forwardingSecret, originalSecret);
  const writes = f.state.writes.length, downloads = f.state.downloads.length;
  // An ordinary restart discards all runtime handles; provisioning still exists.
  f.context.serverProcess = null; f.context.seamlessVelocityProcess = null; f.context.seamlessLimboProcess = null;
  f.state.config.motd = 'Changed'; f.state.config.maxPlayers = 50;
  assert.equal((await f.setup()).unchanged, true);
  f.context.serverProcess = {}; f.context.seamlessVelocityProcess = {}; f.context.seamlessLimboProcess = {};
  f.context.serverState = 'running';
  assert.equal((await f.setup()).unchanged, true);
  assert.equal(f.state.writes.length, writes); assert.equal(f.state.downloads.length, downloads);
  assert.deepEqual(await fs.readFile(f.holdingConfig), holdingBefore);
});

test('a verified installed setup is idempotent while the server is running', async t => {
  const f = await fixture(t, { installed: true, running: true });
  const before = JSON.stringify(f.state.metadata);
  assert.equal((await f.setup()).unchanged, true);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.downloads.length, 0);
  assert.equal(JSON.stringify(f.state.metadata), before); assert.equal(f.state.restores, 0);
});

test('invalid installed setup stays installed without overwriting or uninstalling files', async t => {
  const f = await fixture(t, { installed: true });
  f.state.inspectReady = false;
  await assert.rejects(f.setup(), /saved seamless-restart setup was retained/);
  assert.equal(f.state.metadata.state, 'installed'); assert.equal(f.state.config.seamlessRestart.enabled, true);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.restores, 0);
});

test('an unverified protected lobby fails before any setup download or mutation', async t => {
  const f = await fixture(t); f.state.holdingValid = false;
  await assert.rejects(f.setup(), /Holding lobby preflight failed/);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.downloads.length, 0);
  assert.equal(f.state.restores, 0); assert.equal(f.state.metadata.state, 'disabled');
});

test('first-time setup remains stopped-only', async t => {
  const f = await fixture(t, { running: true });
  await assert.rejects(f.setup(), /fully stopped/);
  assert.equal(f.state.writes.length, 0); assert.equal(f.state.inspections.length, 0);
});

test('startup restores stale enablement from verified installed provenance without deleting setup', async t => {
  const f = await fixture(t, { installed: true });
  f.state.config.seamlessRestart = { ...f.state.config.seamlessRestart, enabled: false };
  assert.equal((await f.recover()).recovered, true);
  assert.equal(f.state.config.seamlessRestart.enabled, true);
  assert.equal(f.state.metadata.state, 'installed'); assert.equal(f.state.restores, 0);
  assert.deepEqual(f.state.writes, ['config']);
  assert.equal((await f.recover()).recovered, false);
});

test('invalid or other-profile saved provenance cannot be enabled or deleted by recovery', async t => {
  for (const bad of ['integrity', 'profile', 'commit']) {
    const f = await fixture(t, { installed: true });
    f.state.config.seamlessRestart = { ...f.state.config.seamlessRestart, enabled: false };
    if (bad === 'integrity') f.state.inspectReady = false;
    if (bad === 'profile') f.state.metadata.profileId = 'another';
    if (bad === 'commit') f.state.metadata.commitMarker = 'transaction';
    await assert.rejects(f.recover(), /retained/);
    assert.equal(f.state.writes.length, 0); assert.equal(f.state.restores, 0);
    assert.equal(f.state.metadata.state, 'installed');
  }
});

test('explicit disable remains durable and recovery does not reenable it', async t => {
  const f = await fixture(t);
  assert.equal((await f.recover()).recovered, false);
  assert.equal(f.state.config.seamlessRestart.enabled, false);
  assert.equal(f.state.writes.length, 0);
});

test('explicit removal needs no Java runtime, restores originals once, and stays disabled', async t => {
  const f = await fixture(t, { installed: true });
  f.state.config.seamlessRestart = { ...f.state.config.seamlessRestart, enabled: false };
  f.context.resolveJava = async () => { throw new Error('Java unavailable'); };
  assert.equal((await f.context.disableSeamlessRestart()).enabled, false);
  assert.equal(f.state.restores, 1);
  assert.equal(f.state.metadata.state, 'disabled');
  const writes = f.state.writes.length;
  assert.equal((await f.context.disableSeamlessRestart()).unchanged, true);
  assert.equal((await f.recover()).recovered, false);
  assert.equal(f.state.writes.length, writes); assert.equal(f.state.restores, 1);
});

test('MOTD and max players cannot invalidate durable setup, while topology and integrity still can', () => {
  const source = block('async function getSeamlessRestartInspection', 'function assertOriginalSeamlessRestartBackendFileProvenance');
  const assignment = source.match(/const configReady = ([\s\S]*?);/)[1];
  const check = values => vm.runInNewContext(assignment, {
    metadataReady: true, topologyReady: true, managedFiles: { ready: true }, coordinatorReady: true,
    coordinatorConfigReady: true, fabricProxyLiteConfig: { ready: true }, holding: { ready: true },
    sourceSettingsReady: false, ...values
  });
  assert.equal(check({}), true);
  assert.equal(check({ topologyReady: false }), false);
  assert.equal(check({ fabricProxyLiteConfig: { ready: false } }), false);
  assert.equal(check({ managedFiles: { ready: false } }), false);
});
