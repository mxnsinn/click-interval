'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const sourcePath = path.join(root, 'minecraft-server', 'main.js');
const temporaryBase = path.resolve(os.tmpdir());
const testRoot = fs.mkdtempSync(path.join(temporaryBase, 'click-interval-death-loot-'));

function assertSafeTemporaryPath(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(`${temporaryBase}${path.sep}`) ||
      !path.basename(resolved).startsWith('click-interval-death-loot-')) {
    throw new Error(`Refusing to clean an unsafe integration-test path: ${resolved}`);
  }
  return resolved;
}

function loadBackend() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__deathLootIntegrationTest = {\n`
    + '  getPathsForProfile, inspectAntiCheatJar, inspectionMatchesBundledDeathLoot,\n'
    + '  getBundledDeathLootAdapter, findBundledDeathLootArtifact, normalizeDeathLootMetadata,\n'
    + '  refreshManagedDeathLootBeforeStartUnlocked\n'
    + '};';
  const moduleMock = { exports: {} };
  const electronMock = {
    app: { getPath: () => testRoot, on: () => {} },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle: () => {} },
    dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from(value, 'utf8'),
      decryptString: value => value.toString('utf8')
    }
  };
  const sandbox = {
    module: moduleMock,
    exports: moduleMock.exports,
    __dirname: path.dirname(sourcePath),
    __filename: sourcePath,
    Buffer,
    URL,
    URLSearchParams,
    process,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: id => {
      if (id === 'electron') return electronMock;
      if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
      if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
      return require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return moduleMock.exports.__deathLootIntegrationTest;
}

function makeContext(api, id, configOverrides = {}) {
  const profile = { id, name: id };
  const paths = api.getPathsForProfile(profile);
  const serverConfig = {
    serverType: 'fabric',
    serverVersion: '26.2',
    jarPath: paths.vanillaJar,
    levelName: 'world',
    deathLootMode: 'timed',
    deathDropLifetimeSeconds: 77,
    deathChestLifetimeSeconds: 900,
    deathChestTorches: true,
    ...configOverrides
  };
  return {
    profile,
    paths,
    serverConfig,
    startup: {
      profileSnapshot: Object.freeze({ profileId: id, paths }),
      paths,
      serverConfig,
      platform: {
        jarExists: true,
        compatible: true,
        supportsMods: true,
        minecraftVersion: '26.2'
      },
      revalidate: async () => paths
    }
  };
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
}

async function run() {
  const api = loadBackend();
  const adapter = api.getBundledDeathLootAdapter('fabric', '26.2');
  assert(adapter, 'Fabric 26.2 death-loot adapter must exist.');
  const artifact = await api.findBundledDeathLootArtifact(adapter);
  assert(artifact, 'Pinned Server Death Loot artifact must pass integrity inspection.');
  assert.equal(artifact.size, 42_619);
  assert.equal(artifact.sha256, '5d062b2593fe307d8763cdf0e7d78970a24df5888350e9e8f70665e4307fe066');
  assert.equal(api.inspectionMatchesBundledDeathLoot(artifact, adapter), true);

  const clean = makeContext(api, 'Death-Loot-Clean');
  await fs.promises.mkdir(clean.paths.mods, { recursive: true });
  const first = await api.refreshManagedDeathLootBeforeStartUnlocked(clean.startup);
  assert.equal(first.installed, true);
  assert.equal(first.changed, true);
  const managedJar = path.join(clean.paths.mods, 'ServerDeathLoot-Fabric.jar');
  const fabricApi = path.join(clean.paths.mods, 'fabric-api-0.161.0+26.2.jar');
  assert.equal(await sha256(managedJar), artifact.sha256);
  assert.equal((await fs.promises.stat(fabricApi)).size, 2_566_123);
  assert.equal(await fs.promises.readFile(clean.paths.deathLootConfig, 'utf8'), [
    '# Server Death Loot - managed by the server settings page',
    'mode=timed',
    'death-drop-lifetime-seconds=77',
    'death-chest-lifetime-seconds=900',
    'place-torches=true',
    ''
  ].join('\n'));
  const metadata = JSON.parse(await fs.promises.readFile(clean.paths.deathLootMetadata, 'utf8'));
  assert.equal(metadata.file, 'ServerDeathLoot-Fabric.jar');
  assert.equal(metadata.sha256, artifact.sha256);
  assert.equal(metadata.dependencyProvisioned, true);
  const addons = JSON.parse(await fs.promises.readFile(clean.paths.addonMetadata, 'utf8'));
  assert(addons.addons.some(entry => entry.file === 'ServerDeathLoot-Fabric.jar' && entry.title === 'Server Death Loot'));

  clean.startup.serverConfig = {
    ...clean.startup.serverConfig,
    deathLootMode: 'chest',
    deathChestLifetimeSeconds: 0,
    deathChestTorches: false
  };
  const second = await api.refreshManagedDeathLootBeforeStartUnlocked(clean.startup);
  assert.equal(second.changed, false, 'current verified binary must not be recopied');
  const chestConfig = await fs.promises.readFile(clean.paths.deathLootConfig, 'utf8');
  assert.match(chestConfig, /mode=chest/);
  assert.match(chestConfig, /death-chest-lifetime-seconds=0/);
  assert.match(chestConfig, /place-torches=false/);

  clean.startup.serverConfig = { ...clean.startup.serverConfig, deathLootMode: 'vanilla' };
  const disabled = await api.refreshManagedDeathLootBeforeStartUnlocked(clean.startup);
  assert.equal(disabled.removed, true, 'vanilla mode should remove the verified managed mod');
  assert.equal(fs.existsSync(managedJar), false, 'disabled managed death-loot mod must not remain in mods');
  assert.equal(fs.existsSync(fabricApi), true, 'shared Fabric API must remain installed');
  assert.equal(fs.existsSync(clean.paths.deathLootMetadata), false, 'managed record should be removed with its JAR');
  const disabledAddons = JSON.parse(await fs.promises.readFile(clean.paths.addonMetadata, 'utf8'));
  assert.equal(disabledAddons.addons.some(entry => entry.file === 'ServerDeathLoot-Fabric.jar'), false);

  const conflict = makeContext(api, 'Death-Loot-Conflict');
  await fs.promises.mkdir(conflict.paths.mods, { recursive: true });
  const foreign = path.join(root, 'minecraft-server', 'server-teleport-fabric', 'dist', 'ServerTeleport-Fabric-1.6.6+mc26.2.jar');
  await fs.promises.copyFile(foreign, path.join(conflict.paths.mods, 'ServerDeathLoot-Fabric.jar'));
  const beforeHash = await sha256(path.join(conflict.paths.mods, 'ServerDeathLoot-Fabric.jar'));
  await assert.rejects(
    api.refreshManagedDeathLootBeforeStartUnlocked(conflict.startup),
    /not a verified managed copy/
  );
  assert.equal(await sha256(path.join(conflict.paths.mods, 'ServerDeathLoot-Fabric.jar')), beforeHash,
    'an unrelated manually imported JAR must never be overwritten');

  const vanilla = makeContext(api, 'Death-Loot-Vanilla', { deathLootMode: 'vanilla' });
  await fs.promises.mkdir(vanilla.paths.mods, { recursive: true });
  const vanillaResult = await api.refreshManagedDeathLootBeforeStartUnlocked(vanilla.startup);
  assert.equal(vanillaResult.reason, 'not-installed');
  assert.equal(fs.existsSync(path.join(vanilla.paths.mods, 'ServerDeathLoot-Fabric.jar')), false,
    'vanilla mode must not install the optional mod');

  const mainText = fs.readFileSync(sourcePath, 'utf8');
  const hook = mainText.indexOf('await refreshManagedDeathLootBeforeStartUnlocked({');
  const spawn = mainText.indexOf('processRef = await launchPersistentProcess', hook);
  assert(hook > 0 && spawn > hook, 'managed death loot must be prepared and verified before Java starts');
  assert.match(mainText, /ordinary item drops unchanged/i);
}

run()
  .then(() => console.log('PASS managed Fabric death-only loot install and conflict safety'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fs.promises.rm(assertSafeTemporaryPath(testRoot), { recursive: true, force: true });
  });
