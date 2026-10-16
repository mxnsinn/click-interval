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
const testUserData = fs.mkdtempSync(path.join(temporaryBase, 'click-interval-teleport-refresh-'));

function assertSafeTemporaryPath(target) {
  const resolved = path.resolve(target);
  const prefix = `${temporaryBase}${path.sep}`;
  if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('click-interval-teleport-refresh-')) {
    throw new Error(`Refusing to clean an unsafe integration-test path: ${resolved}`);
  }
  return resolved;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function loadBackend() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__teleportRefreshTest = {\n`
    + '  getPaths, readConfig, getServerPlatformStatus, inspectAntiCheatJar,\n'
    + '  assessManagedBundledTeleportRefresh, refreshManagedBundledTeleportBeforeStartUnlocked\n'
    + '};';
  const moduleMock = { exports: {} };
  const electronMock = {
    app: { getPath: () => testUserData, on: () => {} },
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
  return moduleMock.exports.__teleportRefreshTest;
}

async function seedFabricProfile() {
  const profileId = 'Teleport-Refresh-Test';
  const profileRoot = path.join(testUserData, 'minecraft-servers', profileId);
  const serverJar = path.join(profileRoot, 'minecraft-server.jar');
  const serverBytes = Buffer.from('verified-fabric-26.2-teleport-refresh-server');
  await fs.promises.mkdir(path.join(profileRoot, 'mods'), { recursive: true });
  await fs.promises.writeFile(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
    activeProfileId: profileId,
    profiles: [{ id: profileId, name: 'Teleport Refresh Test' }]
  }, null, 2));
  await fs.promises.writeFile(serverJar, serverBytes);
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({
    serverType: 'fabric',
    serverVersion: '26.2',
    jarPath: serverJar,
    levelName: 'world'
  }, null, 2));
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-platform.json'), JSON.stringify({
    type: 'fabric',
    declaredType: 'fabric',
    minecraftVersion: '26.2',
    source: 'fabricmc',
    sha256: sha256(serverBytes),
    size: serverBytes.length,
    verified: true,
    installedAt: new Date().toISOString()
  }, null, 2));
  return { profileId, profileRoot };
}

async function writeManagedOldInstall(profileRoot, oldArtifact, dependencyArtifact) {
  const destination = path.join(profileRoot, 'mods', 'ServerTeleport-Fabric.jar');
  const dependency = path.join(profileRoot, 'mods', 'fabric-api-0.161.0+26.2.jar');
  await fs.promises.copyFile(oldArtifact, destination);
  await fs.promises.copyFile(dependencyArtifact, dependency);
  const bytes = await fs.promises.readFile(oldArtifact);
  const installedAt = '2026-10-04T19:28:07.852Z';
  await fs.promises.writeFile(path.join(profileRoot, 'server-tools.json'), JSON.stringify({
    version: 2,
    teleport: {
      name: 'ServerTeleport',
      adapterId: 'fabric-26.2',
      kind: 'mods',
      minecraftVersion: '26.2',
      file: 'ServerTeleport-Fabric.jar',
      sha256: sha256(bytes),
      size: bytes.length,
      installedAt,
      dependencyFile: 'fabric-api-0.161.0+26.2.jar',
      dependencyProvisioned: false
    },
    voice: null
  }, null, 2));
  return { destination, installedAt, oldHash: sha256(bytes), oldSize: bytes.length };
}

async function run() {
  const { profileId, profileRoot } = await seedFabricProfile();
  const api = loadBackend();
  assert(api, 'Teleport startup refresh hooks failed to load.');

  const oldArtifact = path.join(root, 'minecraft-server', 'server-teleport-fabric', 'dist',
    'ServerTeleport-Fabric-1.6.1+mc26.2.jar');
  const currentArtifact = path.join(root, 'minecraft-server', 'server-teleport-fabric', 'dist',
    'ServerTeleport-Fabric-1.6.6+mc26.2.jar');
  const dependencyArtifact = path.join(root, 'minecraft-server', 'server-teleport-fabric', 'dist',
    'fabric-api-0.161.0+26.2.jar');
  for (const required of [oldArtifact, currentArtifact, dependencyArtifact]) {
    assert(fs.existsSync(required), `Missing refresh fixture: ${required}`);
  }
  const currentBytes = await fs.promises.readFile(currentArtifact);
  const currentHash = sha256(currentBytes);
  const seeded = await writeManagedOldInstall(profileRoot, oldArtifact, dependencyArtifact);
  const paths = await api.getPaths();
  const serverConfig = await api.readConfig(paths);
  const platform = await api.getServerPlatformStatus(serverConfig, paths);
  const profileSnapshot = Object.freeze({ profileId, paths });
  let revalidations = 0;
  const context = {
    profileSnapshot,
    paths,
    serverConfig,
    platform,
    revalidate: async () => { revalidations += 1; return paths; }
  };

  const result = await api.refreshManagedBundledTeleportBeforeStartUnlocked(context);
  assert.equal(result.updated, true);
  assert.equal(result.version, '1.6.6');
  assert(revalidations >= 3, 'startup ownership must be revalidated before atomic publication');
  const installed = await api.inspectAntiCheatJar(seeded.destination);
  assert.equal(installed.sha256, currentHash);
  assert.equal(installed.size, currentBytes.length);
  assert.equal(installed.fabricVersion, '1.6.6');
  const metadata = JSON.parse(await fs.promises.readFile(path.join(profileRoot, 'server-tools.json'), 'utf8'));
  assert.equal(metadata.teleport.sha256, currentHash);
  assert.equal(metadata.teleport.size, currentBytes.length);
  assert.equal(metadata.teleport.installedAt, seeded.installedAt,
    'an update should preserve the original managed-install timestamp');

  // A file that no longer matches its ownership record is never overwritten.
  await fs.promises.copyFile(oldArtifact, seeded.destination);
  const modified = await api.refreshManagedBundledTeleportBeforeStartUnlocked({
    ...context,
    revalidate: async () => paths
  });
  assert.equal(modified.updated, false);
  assert.equal(modified.reason, 'modified');
  assert.equal(sha256(await fs.promises.readFile(seeded.destination)), seeded.oldHash);

  // Recreate a valid old managed record, then mutate after the final pre-publish inspection.
  // The refresh must restore that externally changed file instead of overwriting it.
  await writeManagedOldInstall(profileRoot, oldArtifact, dependencyArtifact);
  let raceChecks = 0;
  const externalBytes = Buffer.from('external-change-during-teleport-refresh');
  await assert.rejects(
    api.refreshManagedBundledTeleportBeforeStartUnlocked({
      ...context,
      revalidate: async () => {
        raceChecks += 1;
        if (raceChecks === 3) await fs.promises.writeFile(seeded.destination, externalBytes);
        return paths;
      }
    }),
    /quarantined managed Teleport Requests JAR failed verification/
  );
  assert.deepEqual(await fs.promises.readFile(seeded.destination), externalBytes,
    'a destination changed during startup preparation must be restored byte-for-byte');

  const mainSource = fs.readFileSync(sourcePath, 'utf8');
  const start = mainSource.indexOf('async function startServerOperationInternal(');
  const refresh = mainSource.indexOf('await refreshManagedBundledTeleportBeforeStartUnlocked({', start);
  const launch = mainSource.indexOf('processRef = await launchPersistentProcess({', start);
  assert(start >= 0 && refresh > start && launch > refresh,
    'managed Teleport must refresh inside the stopped startup window before Java launches');
}

run()
  .then(() => console.log('PASS managed Teleport startup refresh, ownership, and race safety'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(assertSafeTemporaryPath(testUserData), { recursive: true, force: true }));
