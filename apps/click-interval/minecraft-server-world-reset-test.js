'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reset = require('./minecraft-server/world-reset');

const work = path.resolve(__dirname, 'work');
let testRoot;
const handlers = new Map();
const mainPath = path.join(__dirname, 'minecraft-server/main.js');

async function write(root, name, data = name) {
  const file = reset.contained(root, path.join(root, name));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}
async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function loadBackend(userData) {
  const source = fss.readFileSync(mainPath, 'utf8') + `\nmodule.exports.__resetTest = {
    wipeServerData, DEFAULT_CONFIG, readConfig, getPlayerHistory, getBannedPlayers, queuePlayerHistoryEvent, serverToolMutationCoordinator, serverStartCoordinator,
    setProfile(id) { profilesState = { activeProfileId: id, profiles: [{ id, name: id }] }; },
    setState(state, child = null) { serverState = state; serverProcess = child; },
    setPending(value) { pendingServerRestart = value; },
    setReadSnapshot(value) { worldResetReadSnapshot = value; },
    banTimer(name) { return tempBanTimers.get(name.toLowerCase()); },
    failNextSettingsWrite() {
      const original = writeServerProperties;
      writeServerProperties = async () => { writeServerProperties = original; throw new Error('simulated Settings write failure'); };
    },
    isResetting() { return Boolean(worldResetReadSnapshot); },
    delayProtectionIngress(incident, gate) {
      const original = queueProtectionIncidents;
      queueProtectionIncidents = async rows => { queueProtectionIncidents = original; await gate; return original(rows); };
      pendingProtectionIncidents.push(incident);
      return scheduleProtectionIncidentIngress();
    },
    noLifecycleCalls() { stopServer = () => { throw new Error('reset must never stop'); }; startServer = () => { throw new Error('reset must never start'); }; }
  };`;
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, __dirname: path.dirname(mainPath), __filename: mainPath,
    Buffer, URL, URLSearchParams, process, console, setTimeout, clearTimeout, setInterval, clearInterval,
    setImmediate, require(id) {
      if (id === 'electron') return {
        app: { getPath: () => userData, on() {} }, BrowserWindow: { fromWebContents: () => null },
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, dialog: {}, shell: {}, Menu: {}, clipboard: {},
        safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }
      };
      if (id === './vendor/node_modules/nat-api') return class {};
      return id.startsWith('./') ? require(path.join(path.dirname(mainPath), id)) : require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: mainPath });
  return module.exports.__resetTest;
}

async function main() {
  await fs.mkdir(work, { recursive: true });
  testRoot = await fs.mkdtemp(path.join(work, 'world-reset-test-'));
  const backend = loadBackend(testRoot);
  backend.noLifecycleCalls();
  const fixture = async (id, overrides = {}) => {
    const root = path.join(testRoot, 'minecraft-servers', id);
    await fs.mkdir(root, { recursive: true });
    const config = { ...backend.DEFAULT_CONFIG, levelName: 'My SMP', seed: '1234',
      serverType: 'fabric', serverVersion: '26.2', jarPath: path.join(root, 'minecraft-server.jar'),
      memoryMb: 4096, port: 25570, pvp: false, acceptEula: true, motd: 'Keep me',
      requestedServerType: 'fabric', requestedServerVersion: '26.2', simulationDistance: 18,
      publicAddress: '198.51.100.25:25570', customHostname: 'play.example.test',
      directHostingEnabled: true, securityPreset: 'strict', customFeature: { retained: true }, ...overrides };
    await write(root, 'assembly-config.json', `${JSON.stringify(config, null, 4)}\r\n`);
    await write(root, 'server.properties', '# custom formatting\r\nlevel-name=My SMP\r\npvp=false\r\ncustom-unknown=leave-me\r\nenforce-secure-profile=true\r\n');
    await write(root, 'eula.txt', '# accepted\r\neula=true\r\n');
    for (const name of ['My SMP/region/r.0.0.mca', 'My SMP/DIM-1/region/a.mca', 'My SMP/DIM1/region/a.mca',
      'My SMP/dimensions/custom/moon/region/a.mca', 'My SMP/playerdata/player.dat', 'My SMP/stats/player.json',
      'My SMP/advancements/player.json', 'My SMP/server-market/ledger.json', 'My SMP/server-market/ledger.prepared.json',
      'My SMP/data/serverteams/teams.json', 'My SMP/server-bounties/ledger.json', 'My SMP/server-teleport/locations.tsv',
      'My SMP_nether/region/a.mca', 'My SMP_the_end/region/a.mca', 'click-interval-map/terrain.tsv',
      'squaremap/web/tiles/map.png', 'config/servertradeassistant/map-snapshot.json',
      'player-view-recovery.json', 'plugins/ServerTeleport/places.properties']) await write(root, name);
    for (const name of ['My SMP/paper-world.yml', 'My SMP/datapacks/custom/pack.mcmeta',
      'My SMP/server-advancement-silence.json', 'My SMP/server-enchantments/player-toggles.user.properties',
      'My SMP/server-end-lock/state.properties', 'mods/custom.jar', 'plugins/custom.jar',
      'config/server-protection/config.yml', 'config/server-protection/access.yml', 'click-interval-access.json',
      'ops.json', 'whitelist.json', 'server-icon.png', 'icon.png', 'My SMP/icon.png',
      'squaremap/config.yml', 'config/servertradeassistant/control-token.txt', 'logs/latest.log',
      'config/server-death-loot/config.properties', 'assembly-platform.json', '.click-interval-seamless-restart/metadata.json',
      'world/region/unrelated.mca']) await write(root, name);
    await write(root, 'My SMP/server-end-lock/state.properties',
      'version=2\nend.locked=true\nend.unlockAtMillis=0\nnether.locked=true\nnether.unlockAtMillis=0\neyeCraftingBlocked=false\nframeInsertionBlocked=true\n');
    await write(root, 'assembly-player-history.json', JSON.stringify({ alice: { name: 'Alice', lastActive: '2026-01-01T00:00:00Z', events: [] } }));
    await write(root, 'usercache.json', JSON.stringify([{ name: 'Alice', uuid: '00000000-0000-0000-0000-000000000001' }]));
    await write(root, 'assembly-bans.json', JSON.stringify({ alice: { name: 'Alice', managed: true, endAt: 0, createdAt: Date.now() } }));
    await write(root, 'banned-players.json', JSON.stringify([{ name: 'Alice', uuid: '00000000-0000-0000-0000-000000000001', expires: 'forever' }]));
    await write(root, 'banned-ips.json', JSON.stringify([{ ip: '192.0.2.1', expires: 'forever' }]));
    await write(root, 'config/server-protection/offenses.properties', 'Alice.temporaryBanUntil=9999999999999');
    await write(root, 'logs/latest.log', '[12:00:00] [Server thread/INFO]: Alice joined the game\n');
    backend.setProfile(id);
    backend.setState('stopped');
    backend.setPending(null);
    return { root, config };
  };

  const initial = await fixture('preserve');
  const preservedNames = ['assembly-config.json', 'server.properties', 'eula.txt', 'mods/custom.jar',
    'plugins/custom.jar', 'config/server-protection/config.yml', 'config/server-protection/access.yml',
    'click-interval-access.json', 'ops.json', 'whitelist.json',
    'server-icon.png', 'icon.png', 'My SMP/icon.png', 'squaremap/config.yml', 'config/servertradeassistant/control-token.txt',
    'config/server-death-loot/config.properties', 'world/region/unrelated.mca',
    'My SMP/paper-world.yml', 'My SMP/datapacks/custom/pack.mcmeta', 'My SMP/server-advancement-silence.json',
    'My SMP/server-enchantments/player-toggles.user.properties', 'My SMP/server-end-lock/state.properties'];
  const originals = new Map(await Promise.all(preservedNames.map(async name => [name, await fs.readFile(path.join(initial.root, name))])));
  const sibling = path.join(testRoot, 'minecraft-servers', 'other-profile');
  await write(sibling, 'world/region/keep.mca', 'another profile');
  assert.equal((await backend.getPlayerHistory()).length, 1);
  assert.equal((await backend.getBannedPlayers()).length, 1);
  const result = await handlers.get('files:wipeData')({}, { profileId: 'preserve', resetSettings: false });
  assert.equal(result.reset, true);
  assert.equal(result.resetSettings, false);
  for (const [name, contents] of originals) assert.deepEqual(await fs.readFile(path.join(initial.root, name)), contents, `keep ${name}`);
  for (const name of ['My SMP/region', 'My SMP/DIM-1', 'My SMP/DIM1', 'My SMP/dimensions', 'My SMP/playerdata',
    'My SMP/stats', 'My SMP/advancements', 'My SMP/server-market', 'My SMP/server-teleport',
    'My SMP/data/serverteams', 'My SMP/server-bounties',
    'My SMP_nether', 'My SMP_the_end', 'click-interval-map', 'squaremap/web/tiles',
    'config/servertradeassistant/map-snapshot.json', 'player-view-recovery.json', 'plugins/ServerTeleport/places.properties',
    'assembly-player-history.json', 'usercache.json', 'assembly-bans.json', 'banned-players.json', 'banned-ips.json',
    'config/server-protection/offenses.properties', 'logs']) {
    assert.equal(await exists(path.join(initial.root, name)), false, `reset ${name}`);
    assert.equal(await exists(path.join(result.backupPath, 'data', name)), true, `back up ${name}`);
  }
  assert.equal(await fs.readFile(path.join(sibling, 'world/region/keep.mca'), 'utf8'), 'another profile');
  assert.equal((await backend.getPlayerHistory()).length, 0, 'old joins cannot return through log history import');
  assert.equal((await backend.getBannedPlayers()).length, 0, 'managed/native ban caches are cleared');
  assert.equal(await exists(path.join(initial.root, reset.JOURNAL)), false);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backupPath, 'manifest.json'))).phase, 'complete');

  // The broad checkbox cannot opt the user into resetting individual identity,
  // connection, distance or software fields. It also preserves every icon source.
  const ordinary = await fixture('ordinary-settings');
  const ordinaryIconNames = ['server-icon.png', 'icon.png', 'My SMP/icon.png'];
  const ordinaryIcons = new Map(await Promise.all(ordinaryIconNames.map(async name => [name, await fs.readFile(path.join(ordinary.root, name))])));
  const ordinaryResult = await backend.wipeServerData({ profileId: 'ordinary-settings', resetSettings: true });
  const ordinarySaved = JSON.parse(await fs.readFile(path.join(ordinary.root, 'assembly-config.json')));
  for (const key of ['serverType', 'serverVersion', 'requestedServerType', 'requestedServerVersion',
    'levelName', 'motd', 'publicAddress', 'customHostname', 'simulationDistance']) {
    assert.equal(ordinarySaved[key], ordinary.config[key], `ordinary checkbox preserves ${key}`);
  }
  assert.equal(ordinarySaved.pvp, backend.DEFAULT_CONFIG.pvp);
  assert.notEqual(ordinarySaved.seed, ordinary.config.seed);
  for (const [name, bytes] of ordinaryIcons) assert.deepEqual(await fs.readFile(path.join(ordinary.root, name)), bytes, `ordinary checkbox preserves ${name}`);
  assert.equal(await fs.readFile(path.join(ordinary.root, 'world/region/unrelated.mca'), 'utf8'), 'world/region/unrelated.mca');
  assert.equal(await exists(path.join(ordinary.root, 'My SMP/region/r.0.0.mca')), false);
  assert.equal(JSON.stringify(ordinaryResult.resetFields), '[]');
  const ordinaryProperties = await fs.readFile(path.join(ordinary.root, 'server.properties'), 'utf8');
  assert.match(ordinaryProperties, /^level-name=My SMP$/m);
  assert.match(ordinaryProperties, /^motd=Keep me$/m);
  assert.match(ordinaryProperties, /^simulation-distance=18$/m);

  const settings = await fixture('settings');
  // Default world must not cause a reset to overwrite a different saved world.
  await assert.rejects(backend.wipeServerData({ profileId: 'settings', resetSettings: true, resetFields: [...reset.RESET_FIELDS] }), /default world folder world already exists/);
  assert.equal(await exists(path.join(settings.root, 'My SMP/region/r.0.0.mca')), true);
  await fs.rename(path.join(settings.root, 'world'), path.join(settings.root, 'older-unrelated-world'));
  const changed = await backend.wipeServerData({ profileId: 'settings', resetSettings: true, resetFields: [...reset.RESET_FIELDS] });
  const saved = JSON.parse(await fs.readFile(path.join(settings.root, 'assembly-config.json')));
  for (const key of reset.SETTINGS_KEYS.filter(key => !['serverType', 'serverVersion', 'seed'].includes(key))) {
    assert.equal(saved[key], backend.DEFAULT_CONFIG[key], `reset Settings field ${key}`);
  }
  assert.equal(saved.serverType, 'fabric');
  assert.equal(saved.serverVersion, '26.2');
  assert.equal(saved.requestedServerType, 'vanilla');
  assert.equal(saved.requestedServerVersion, 'latest');
  for (const key of ['levelName', 'motd', 'publicAddress', 'customHostname', 'simulationDistance']) {
    assert.equal(saved[key], backend.DEFAULT_CONFIG[key], `explicit checkbox resets ${key}`);
  }
  assert.notEqual(saved.seed, settings.config.seed);
  assert.match(String(saved.seed), /^-?\d+$/);
  assert.equal(saved.jarPath, settings.config.jarPath);
  assert.equal(saved.securityPreset, 'strict');
  assert.equal(saved.directHostingEnabled, true);
  assert.deepEqual(saved.customFeature, { retained: true });
  assert.equal(await exists(path.join(settings.root, 'server-icon.png')), false);
  assert.equal(await fs.readFile(path.join(changed.backupPath, 'data/server-icon.png'), 'utf8'), 'server-icon.png');
  assert.equal(await exists(path.join(settings.root, 'icon.png')), false);
  assert.equal(await exists(path.join(settings.root, 'world/icon.png')), false);
  assert.equal(await fs.readFile(path.join(changed.backupPath, 'data/My SMP/icon.png'), 'utf8'), 'My SMP/icon.png');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(changed.backupPath, 'manifest.json'))).resetFields, [...reset.RESET_FIELDS]);
  assert.equal(await fs.readFile(path.join(settings.root, 'eula.txt'), 'utf8'), 'eula=false\n');
  assert.match(await fs.readFile(path.join(settings.root, 'server.properties'), 'utf8'), /custom-unknown=leave-me/);
  assert.match(await fs.readFile(path.join(settings.root, 'server.properties'), 'utf8'), /^pvp=true$/m);
  assert.equal(await fs.readFile(path.join(settings.root, 'world/paper-world.yml'), 'utf8'), 'My SMP/paper-world.yml');
  const dimensionSettings = await fs.readFile(path.join(settings.root, 'world/server-end-lock/state.properties'), 'utf8');
  assert.match(dimensionSettings, /^end\.locked=false$/m);
  assert.match(dimensionSettings, /^nether\.locked=false$/m);
  assert.match(dimensionSettings, /^eyeCraftingBlocked=false$/m);
  assert.match(dimensionSettings, /^frameInsertionBlocked=true$/m);
  assert.equal(await exists(path.join(settings.root, 'mods/custom.jar')), true);
  assert.equal(await exists(path.join(settings.root, 'click-interval-access.json')), true);
  assert.equal(await fs.readFile(path.join(settings.root, 'assembly-platform.json'), 'utf8'), 'assembly-platform.json');

  // Individual choices work with the general checkbox off, without resetting any
  // other setting or runtime software identity. Icon-only keeps config bytes too.
  const individualCases = [
    ['serverIcon', {}],
    ['serverType', { requestedServerType: backend.DEFAULT_CONFIG.serverType }],
    ['serverVersion', { requestedServerVersion: backend.DEFAULT_CONFIG.serverVersion }],
    ['levelName', { levelName: backend.DEFAULT_CONFIG.levelName }],
    ['motd', { motd: backend.DEFAULT_CONFIG.motd }],
    ['publicAddress', { publicAddress: backend.DEFAULT_CONFIG.publicAddress, customHostname: backend.DEFAULT_CONFIG.customHostname }],
    ['simulationDistance', { simulationDistance: backend.DEFAULT_CONFIG.simulationDistance }]
  ];
  for (const [field, patch] of individualCases) {
    const id = `individual-${field}`;
    const individual = await fixture(id);
    const originalConfig = await fs.readFile(path.join(individual.root, 'assembly-config.json'));
    const untouchedNames = ['eula.txt', 'config/server-death-loot/config.properties'];
    const untouched = new Map(await Promise.all(untouchedNames.map(async name => [name, await fs.readFile(path.join(individual.root, name))])));
    if (field === 'levelName') await fs.rename(path.join(individual.root, 'world'), path.join(individual.root, 'older-unrelated-world'));
    const individualResult = await handlers.get('files:wipeData')({}, { profileId: id, resetSettings: false, resetFields: [field] });
    const configBytes = await fs.readFile(path.join(individual.root, 'assembly-config.json'));
    assert.deepEqual(JSON.parse(configBytes), JSON.parse(JSON.stringify({ ...individual.config, ...patch })), `only selected ${field} resets`);
    assert.equal(JSON.stringify(individualResult.resetFields), JSON.stringify([field]));
    for (const [name, bytes] of untouched) assert.deepEqual(await fs.readFile(path.join(individual.root, name)), bytes, `${field} preserves ${name}`);
    const nextWorld = patch.levelName || individual.config.levelName;
    const lockState = await fs.readFile(path.join(individual.root, nextWorld, 'server-end-lock/state.properties'), 'utf8');
    assert.match(lockState, /^end\.locked=true$/m, `${field} preserves dimension settings`);
    assert.match(lockState, /^nether\.locked=true$/m);
    if (field === 'serverIcon') {
      assert.deepEqual(configBytes, originalConfig);
      for (const name of ['server-icon.png', 'icon.png', 'My SMP/icon.png']) {
        assert.equal(await exists(path.join(individual.root, name)), false, `explicit clear removes ${name}`);
        assert.equal(await fs.readFile(path.join(individualResult.backupPath, 'data', name), 'utf8'), name);
      }
    } else {
      assert.equal(await fs.readFile(path.join(individual.root, 'server-icon.png'), 'utf8'), 'server-icon.png');
      assert.equal(await fs.readFile(path.join(individual.root, nextWorld, 'icon.png'), 'utf8'), 'My SMP/icon.png');
    }
  }

  const guards = await fixture('guards');
  for (const state of ['running', 'starting', 'stopping']) {
    backend.setState(state, state === 'running' ? {} : null);
    await assert.rejects(backend.wipeServerData({ profileId: 'guards', resetSettings: false }), /Stop the Minecraft server/);
  }
  backend.setState('stopped');
  await assert.rejects(backend.wipeServerData({ profileId: 'wrong', resetSettings: false }), /selected server changed/);
  await assert.rejects(backend.wipeServerData({ resetSettings: false }), /Select a server/);
  await assert.rejects(backend.wipeServerData({ profileId: 'guards', resetSettings: 'true' }), /Select a server/);
  for (const resetFields of [null, 'serverIcon', ['server-icon'], ['../server-icon.png'], ['serverIcon', 'serverIcon'], [true]]) {
    await assert.rejects(backend.wipeServerData({ profileId: 'guards', resetSettings: false, resetFields }), /listed Reset Data settings/);
  }
  backend.setPending({});
  await assert.rejects(backend.wipeServerData({ profileId: 'guards', resetSettings: false }), /pending server restart/);
  backend.setPending(null);
  assert.equal(await exists(path.join(guards.root, 'My SMP/region/r.0.0.mca')), true);
  let release;
  const blocked = backend.serverToolMutationCoordinator.run('other-change', () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(backend.wipeServerData({ profileId: 'guards', resetSettings: false }), /Another server profile/);
  release(); await blocked;

  // A polling config read must never recreate the config temporarily in the backup.
  backend.setReadSnapshot({ root: path.resolve(guards.root), config: guards.config });
  await fs.rename(path.join(guards.root, 'assembly-config.json'), path.join(guards.root, 'config-test-hold.json'));
  assert.equal((await backend.readConfig()).seed, guards.config.seed);
  assert.equal(await exists(path.join(guards.root, 'assembly-config.json')), false);
  await fs.rename(path.join(guards.root, 'config-test-hold.json'), path.join(guards.root, 'assembly-config.json'));
  backend.setReadSnapshot(null);

  const timedRollback = await fixture('timed-rollback');
  await fs.rename(path.join(timedRollback.root, 'world'), path.join(timedRollback.root, 'older-world'));
  const rollbackNames = ['assembly-config.json', 'server.properties', 'eula.txt', 'server-icon.png', 'icon.png', 'My SMP/icon.png'];
  const rollbackOriginals = new Map(await Promise.all(rollbackNames.map(async name => [name, await fs.readFile(path.join(timedRollback.root, name))])));
  const endAt = Date.now() + 120_000;
  await write(timedRollback.root, 'assembly-bans.json', JSON.stringify({ alice: { name: 'Alice', managed: true, endAt, createdAt: Date.now() } }));
  await write(timedRollback.root, 'banned-players.json', JSON.stringify([{ name: 'Alice', expires: new Date(endAt).toISOString() }]));
  await backend.getBannedPlayers();
  const previousTimer = backend.banTimer('Alice');
  assert.ok(previousTimer, 'fixture arms temporary ban expiry');
  backend.queuePlayerHistoryEvent('Charlie', 'joined', { reason: 'queued before reset' });
  backend.failNextSettingsWrite();
  await assert.rejects(backend.wipeServerData({ profileId: 'timed-rollback', resetSettings: true, resetFields: [...reset.RESET_FIELDS] }), /Original data was restored/);
  for (const [name, bytes] of rollbackOriginals) assert.deepEqual(await fs.readFile(path.join(timedRollback.root, name)), bytes, `rollback restores ${name}`);
  assert.equal(await exists(path.join(timedRollback.root, 'world')), false, 'failed default-world replacement is archived');
  assert.ok(backend.banTimer('Alice'), 'rolled-back reset resumes temporary ban expiry');
  assert.notEqual(backend.banTimer('Alice'), previousTimer, 'expiry is rearmed after the cancelled timer');
  assert.equal((await backend.getBannedPlayers())[0].endAt, endAt, 'original temporary ban deadline remains');
  assert.equal(await exists(path.join(timedRollback.root, 'My SMP/region/r.0.0.mca')), true);
  assert.equal(await exists(path.join(timedRollback.root, reset.JOURNAL)), false);
  const restoredHistory = await backend.getPlayerHistory();
  const restoredCharlie = restoredHistory.find(entry => entry.name === 'Charlie');
  assert.ok(restoredCharlie, 'queued joined-player history survives failed reset');
  assert.equal(restoredCharlie.events.some(event => event.reason === 'queued before reset'), true);

  const ingress = await fixture('ingress');
  backend.queuePlayerHistoryEvent('Dana', 'joined');
  let releaseIngress;
  const ingressGate = new Promise(resolve => { releaseIngress = resolve; });
  const inFlightIngress = backend.delayProtectionIngress({ id: 'reset-ingress', player: 'Bob',
    timestamp: new Date().toISOString(), action: 'ban', reason: 'Fixture incident', check: 'test',
    durationMs: 0, offenses: 1, violations: 1 }, ingressGate);
  const ingressReset = backend.wipeServerData({ profileId: 'ingress', resetSettings: false });
  for (let attempts = 0; !backend.isResetting() && attempts < 500; attempts += 1) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(backend.isResetting(), true, 'reset waits for pending protection ingress');
  assert.equal(await exists(path.join(ingress.root, 'My SMP/region/r.0.0.mca')), true, 'world stays in place before ingress drains');
  releaseIngress();
  await inFlightIngress;
  const ingressResult = await ingressReset;
  const archivedBans = JSON.parse(await fs.readFile(path.join(ingressResult.backupPath, 'data/assembly-bans.json')));
  assert.equal(archivedBans.bob.name, 'Bob', 'in-flight moderation is captured in the reset backup');
  const archivedHistory = JSON.parse(await fs.readFile(path.join(ingressResult.backupPath, 'data/assembly-player-history.json')));
  assert.equal(archivedHistory.dana.name, 'Dana', 'queued joins are included in the successful reset backup');
  assert.equal((await backend.getBannedPlayers()).length, 0, 'late ingress cannot restore old bans after reset');
  assert.equal((await backend.getPlayerHistory()).length, 0, 'late ingress cannot restore joined-player history');

  const outside = path.join(testRoot, 'outside');
  await write(outside, 'sentinel.txt', 'safe');
  const unsafe = path.join(testRoot, 'unsafe');
  await fs.mkdir(unsafe);
  await fs.symlink(outside, path.join(unsafe, 'world'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(reset.buildPlan(unsafe, { levelName: 'world' }), /link or junction/);
  await assert.rejects(reset.buildPlan(unsafe, { levelName: '../outside' }), /unsafe|outside/);
  await assert.rejects(reset.buildPlan(unsafe, { levelName: 'config' }), /overlaps/);
  await assert.rejects(reset.buildPlan(unsafe, { levelName: 'safe' }, { levelName: '../outside' }), /unsafe|outside/);
  await assert.rejects(reset.buildPlan(unsafe, { levelName: 'safe' }, { levelName: 'config' }), /overlaps/);
  assert.equal(await fs.readFile(path.join(outside, 'sentinel.txt'), 'utf8'), 'safe');
  const nested = path.join(testRoot, 'nested');
  await fs.mkdir(path.join(nested, 'world/datapacks'), { recursive: true });
  await fs.symlink(outside, path.join(nested, 'world/datapacks/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(reset.buildPlan(nested, { levelName: 'world' }), /link or junction/);

  const rollback = path.join(testRoot, 'rollback');
  await write(rollback, 'world/region/a.mca', 'terrain');
  await write(rollback, 'world/paper-world.yml', 'settings');
  await write(rollback, 'click-interval-map/terrain.tsv', 'map');
  const rollbackPlan = await reset.buildPlan(rollback, { levelName: 'world' });
  let renameCount = 0;
  const failingIo = new Proxy(fs, { get(target, key) {
    if (key === 'rename') return async (...args) => {
      if (++renameCount === 2) throw new Error('simulated disk error');
      return target.rename(...args);
    };
    return target[key];
  } });
  await assert.rejects(reset.resetWorldTransaction({ root: rollback, profileId: 'rollback', plan: rollbackPlan,
    resetSettings: false, revalidate: async () => {}, io: failingIo }), /Original data was restored/);
  assert.equal(await fs.readFile(path.join(rollback, 'world/region/a.mca'), 'utf8'), 'terrain');
  assert.equal(await fs.readFile(path.join(rollback, 'click-interval-map/terrain.tsv'), 'utf8'), 'map');
  assert.equal(await exists(path.join(rollback, reset.JOURNAL)), false);
  await assert.rejects(reset.resetWorldTransaction({ root: rollback, profileId: 'rollback', plan: rollbackPlan,
    resetSettings: true, revalidate: async () => {}, applySettings: async () => { throw new Error('settings write failed'); } }), /Original data was restored/);
  assert.equal(await fs.readFile(path.join(rollback, 'world/region/a.mca'), 'utf8'), 'terrain');
  assert.equal(await fs.readFile(path.join(rollback, 'world/paper-world.yml'), 'utf8'), 'settings');
  await write(rollback, reset.JOURNAL, '{}');
  await assert.rejects(reset.assertNoPendingReset(rollback), /needs recovery/);
  await assert.rejects(reset.resetWorldTransaction({ root: rollback, profileId: 'rollback', plan: rollbackPlan,
    resetSettings: false, revalidate: async () => {} }), /needs recovery/);

  const local = reset.settingsConfig({ ...settings.config, localOnly: true, bindIp: '127.0.0.1' }, backend.DEFAULT_CONFIG, () => '55');
  assert.equal(local.localOnly, true); assert.equal(local.bindIp, '127.0.0.1');
  assert.throws(() => reset.settingsConfig({ ...settings.config, seamlessRestart: { enabled: true } }, backend.DEFAULT_CONFIG, () => '55'), /Disable seamless restart/);
  console.log('World reset: protected server identity/software/address/distance and icons, individual opt-ins, byte-preserved Settings, complete world/backup scope, player-history clear, unban everyone, lifecycle/profile locks, junction safety, full rollback and crash guard passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (testRoot) {
    const safe = reset.contained(work, testRoot);
    if (path.basename(safe).startsWith('world-reset-test-')) await fs.rm(safe, { recursive: true, force: true });
  }
});
