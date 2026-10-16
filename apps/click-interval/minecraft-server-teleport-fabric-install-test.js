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
const testUserData = fs.mkdtempSync(path.join(temporaryBase, 'click-interval-teleport-fabric-install-'));
const plain = value => JSON.parse(JSON.stringify(value));

function assertSafeTemporaryPath(target) {
  const resolved = path.resolve(target);
  const prefix = `${temporaryBase}${path.sep}`;
  if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('click-interval-teleport-fabric-install-')) {
    throw new Error(`Refusing to clean an unsafe integration-test path: ${resolved}`);
  }
  return resolved;
}

function loadBackend() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__teleportFabricInstallTest = {\n`
    + '  getBundledTeleportStatus, installBundledTeleport, removeBundledTeleport\n'
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
  return moduleMock.exports.__teleportFabricInstallTest;
}

async function seedFabricProfile() {
  const profileId = 'Teleport-Fabric-Test';
  const profileRoot = path.join(testUserData, 'minecraft-servers', profileId);
  const serverJar = path.join(profileRoot, 'minecraft-server.jar');
  const serverBytes = Buffer.from('verified-fabric-26.2-teleport-test-server');
  const sha256 = crypto.createHash('sha256').update(serverBytes).digest('hex');
  await fs.promises.mkdir(profileRoot, { recursive: true });
  await fs.promises.writeFile(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
    activeProfileId: profileId,
    profiles: [{ id: profileId, name: 'Teleport Fabric Test' }]
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
    sha256,
    size: serverBytes.length,
    verified: true,
    installedAt: new Date().toISOString()
  }, null, 2));
  return profileRoot;
}

async function run() {
  const profileRoot = await seedFabricProfile();
  const api = loadBackend();
  assert(api, 'Fabric teleport lifecycle hooks failed to load.');

  const before = plain(await api.getBundledTeleportStatus());
  assert.equal(before.adapterId, 'fabric-26.2');
  assert.equal(before.kind, 'mods');
  assert.equal(before.runtimeCompatible, true, before.message);
  assert.equal(before.installed, false);
  assert.equal(before.dependencyReady, false);
  assert.equal(before.canInstall, true, before.message);

  const installed = plain(await api.installBundledTeleport());
  assert.equal(installed.installed, true, installed.message);
  assert.equal(installed.managed, true, installed.message);
  assert.equal(installed.integrityVerified, true, installed.message);
  assert.equal(installed.dependencyReady, true, installed.message);
  assert.equal(installed.dependencyManaged, true, installed.message);
  assert.equal(installed.installedKind, 'mods');

  const mod = path.join(profileRoot, 'mods', 'ServerTeleport-Fabric.jar');
  const fabricApi = path.join(profileRoot, 'mods', 'fabric-api-0.161.0+26.2.jar');
  assert.equal((await fs.promises.stat(mod)).size, 130_973);
  assert.equal((await fs.promises.stat(fabricApi)).size, 2_566_123);
  const metadata = JSON.parse(await fs.promises.readFile(path.join(profileRoot, 'server-tools.json'), 'utf8'));
  assert.equal(metadata.teleport.adapterId, 'fabric-26.2');
  assert.equal(metadata.teleport.kind, 'mods');
  assert.equal(metadata.teleport.dependencyProvisioned, true);

  const removed = plain(await api.removeBundledTeleport());
  assert.equal(removed.changed, true);
  assert.equal(removed.dependencyRetained, true);
  assert.equal(fs.existsSync(mod), false, 'managed TPA mod should be removed');
  assert.equal(fs.existsSync(fabricApi), true, 'shared Fabric API must remain for Server Protection');
  const afterMetadata = JSON.parse(await fs.promises.readFile(path.join(profileRoot, 'server-tools.json'), 'utf8'));
  assert.equal(afterMetadata.teleport, null);
}

run()
  .then(() => console.log('PASS Fabric 26.2 Teleport Requests install/remove lifecycle'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fs.promises.rm(assertSafeTemporaryPath(testUserData), { recursive: true, force: true });
  });
