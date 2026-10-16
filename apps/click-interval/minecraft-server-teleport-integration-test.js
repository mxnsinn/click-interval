'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const source = `${mainText}\nmodule.exports.__teleportTest = {\n` +
  '  parsePluginCommandNames, normalizeServerToolsMetadata, classifyBundledTeleportInstall,\n' +
  '  getBundledTeleportAdapter, getBundledTeleportAdapterById, inspectionMatchesBundledTeleportAdapter,\n' +
  '  isBundledTeleportAddonFile,\n' +
  '  isBundledTeleportRuntimeCompatible, inspectAntiCheatJar, findBundledTeleportArtifact,\n' +
  '  findBundledTeleportDependencyArtifact, getBundledTeleportFabricDependencyState,\n' +
  '  findBundledTeleportCommandConflicts\n' +
  '};';

const ipcHandlers = new Map();
const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'teleport-integration-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
const sandbox = {
  module: moduleMock,
  exports: moduleMock.exports,
  __dirname: path.dirname(mainPath),
  __filename: mainPath,
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
    if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: mainPath });
const test = moduleMock.exports.__teleportTest;

assert.ok(test, 'Teleport integration test hooks failed to load.');
for (const channel of ['tools:getTeleportStatus', 'tools:installTeleport', 'tools:removeTeleport']) {
  assert.ok(ipcHandlers.has(channel), `Missing narrow teleport IPC handler: ${channel}`);
}

assert.deepEqual(
  JSON.parse(JSON.stringify(test.parsePluginCommandNames(`name: Example\ncommands:\n  tpa:\n    usage: /tpa <player>\n  'tpaccept':\n  unrelated:\npermissions:\n  tpa.use:\n`))),
  ['tpa', 'tpaccept', 'unrelated'],
  'plugin command parsing should only return top-level command declarations'
);
assert.deepEqual(JSON.parse(JSON.stringify(test.parsePluginCommandNames('name: NoCommands\npermissions:\n  tpa:\n'))), []);

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const identity = sha256 => ({
  kind: 'plugins', pluginName: 'ServerTeleport', bundledTeleportIdentity: true, sha256
});
assert.equal(test.classifyBundledTeleportInstall({ artifact: { sha256: hashA }, installed: identity(hashA) }).managed, true);
const recordedUpdate = test.classifyBundledTeleportInstall({
  artifact: { sha256: hashB },
  installed: identity(hashA),
  record: { file: 'ServerTeleport.jar', sha256: hashA, size: 100, installedAt: '2026-10-02T00:00:00.000Z' }
});
assert.equal(recordedUpdate.managed, true);
assert.equal(recordedUpdate.updateAvailable, true);
assert.equal(test.classifyBundledTeleportInstall({ artifact: { sha256: hashA }, installed: identity(hashB) }).conflict, true);
assert.equal(test.classifyBundledTeleportInstall({ artifact: { sha256: hashA }, installed: {
  kind: 'plugins', pluginName: 'ServerTeleport', bundledTeleportIdentity: false, sha256: hashA
} }).conflict, true, 'a matching name and hash must not replace a JAR without the bundled class identity');

const metadata = test.normalizeServerToolsMetadata({
  teleport: { file: 'ServerTeleport.jar', sha256: hashA, size: 48221, installedAt: '2026-10-02T00:00:00.000Z' }
});
assert.equal(metadata.teleport.sha256, hashA);
assert.equal(test.normalizeServerToolsMetadata({
  teleport: { file: '../ServerTeleport.jar', sha256: hashA, size: 1 }
}).teleport, null, 'unsafe metadata must not establish ownership');
assert.equal(test.normalizeServerToolsMetadata({
  teleport: { file: 'ServerTeleport.jar', sha256: 'bad', size: 1 }
}).teleport, null, 'invalid hashes must not establish ownership');
const fabricMetadata = test.normalizeServerToolsMetadata({
  teleport: {
    adapterId: 'fabric-26.2', kind: 'mods', file: 'ServerTeleport-Fabric.jar',
    sha256: hashA, size: 49951, minecraftVersion: '26.2',
    dependencyFile: 'fabric-api-0.161.0+26.2.jar', dependencyProvisioned: true
  }
});
assert.equal(fabricMetadata.teleport.adapterId, 'fabric-26.2');
assert.equal(fabricMetadata.teleport.kind, 'mods');
assert.equal(fabricMetadata.teleport.dependencyProvisioned, true);
assert.equal(test.normalizeServerToolsMetadata({
  teleport: { adapterId: 'fabric-26.2', kind: 'plugins', file: 'ServerTeleport-Fabric.jar', sha256: hashA, size: 1 }
}).teleport, null, 'metadata must not move the managed Fabric mod into the plugins folder');
assert.equal(test.isBundledTeleportAddonFile('plugins', 'ServerTeleport.jar'), true);
assert.equal(test.isBundledTeleportAddonFile('mods', 'ServerTeleport-Fabric.jar'), true);
assert.equal(test.isBundledTeleportAddonFile('mods', 'ServerTeleport.jar'), false,
  'the Bukkit provider name must not be treated as managed inside the mods directory');
assert.equal(test.isBundledTeleportAddonFile('plugins', 'ServerTeleport-Fabric.jar'), false,
  'the Fabric provider name must not be treated as managed inside the plugins directory');

const compatiblePlatform = { jarExists: true, compatible: true, supportsPlugins: true };
for (const type of ['paper', 'purpur', 'spigot']) {
  assert.equal(test.isBundledTeleportRuntimeCompatible(type, compatiblePlatform), true, `${type} should be supported`);
}
for (const type of ['vanilla', 'fabric', 'forge', 'neoforge']) {
  assert.equal(test.isBundledTeleportRuntimeCompatible(type, compatiblePlatform), false, `${type} without an exact adapter must be rejected`);
}
assert.equal(test.isBundledTeleportRuntimeCompatible('paper', { ...compatiblePlatform, compatible: false }), false);
assert.equal(test.isBundledTeleportRuntimeCompatible('paper', { ...compatiblePlatform, jarExists: false }), false);
const fabricAdapter = test.getBundledTeleportAdapter('fabric', '26.2');
assert.equal(fabricAdapter.id, 'fabric-26.2');
assert.equal(fabricAdapter.kind, 'mods');
assert.equal(test.getBundledTeleportAdapter('fabric', '26.3'), null, 'Fabric compatibility must be exact');
assert.equal(test.isBundledTeleportRuntimeCompatible('fabric', {
  jarExists: true, compatible: true, supportsMods: true, minecraftVersion: '26.2'
}, fabricAdapter), true);
assert.equal(test.isBundledTeleportRuntimeCompatible('fabric', {
  jarExists: true, compatible: true, supportsMods: true, minecraftVersion: '26.3'
}, fabricAdapter), false);

const preloadText = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const standalonePreloadText = fs.readFileSync(path.join(root, 'minecraft-server', 'preload.js'), 'utf8');
const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const text of [preloadText, standalonePreloadText]) {
  assert.match(text, /getTeleportStatus:[^\n]+tools:getTeleportStatus/);
  assert.match(text, /installTeleport:[^\n]+tools:installTeleport/);
  assert.match(text, /removeTeleport:[^\n]+tools:removeTeleport/);
}
assert.doesNotMatch(uiText, /api\.(?:get|install|remove)Teleport\(/,
  'Teleport Requests must not remain as a built-in promotional/install control');
assert.match(indexText, /id="msDownloadServerAddons"[^>]*>Download server add-ons/,
  'the manual website-download workflow must remain visible beside JAR import');
const importSource = mainText.slice(mainText.indexOf('async function importJarFiles'), mainText.indexOf('async function deleteManagedJar'));
assert.doesNotMatch(importSource, /declares the managed Teleport Requests identity|Use the built-in Teleport Requests entry/,
  'manually downloaded Teleport Requests JARs must be accepted by normal import');
const deleteSource = mainText.slice(mainText.indexOf('async function deleteManagedJar'), mainText.indexOf('function normalizeAddonKind'));
assert.match(deleteSource, /if \(teleportFile\)[\s\S]*?if \(teleport\.managed\) return removeBundledTeleport\(profileSnapshot\)/,
  'verified legacy managed copies should still use integrity-safe removal');
assert.doesNotMatch(mainText, /Use the built-in Teleport Requests entry to remove this managed plugin safely/);
assert.match(mainText, /fs\.link\(temporary, destination\)/, 'first install should publish atomically without replacement');
assert.match(mainText, /fs\.rename\(destination, quarantine\)/, 'remove should quarantine before deleting');
assert.match(mainText, /captureActiveServerToolProfile\('Teleport Requests'\)/, 'mutations must be stopped-only and profile-bound');
assert.match(mainText, /canInstall: Boolean\([\s\S]*?!commandConflicts\.length[\s\S]*?\)/,
  'a real command collision must block built-in teleport installation');
const teleportInstallSource = mainText.slice(
  mainText.indexOf('function installBundledTeleport()'),
  mainText.indexOf('function removeBundledTeleport()')
);
assert.match(teleportInstallSource, /findBundledTeleportCommandConflicts\(paths, descriptorIndex, adapter\)/,
  'installation must recheck command conflicts at mutation time');
assert.match(teleportInstallSource, /findBundledTeleportDependencyArtifact\(adapter\)/,
  'a TPA-only Fabric install must provision its pinned Fabric API dependency when absent');
assert.match(teleportInstallSource, /fs\.link\(dependencyTemporary, dependencyDestination\)/,
  'the Fabric API dependency must be published without overwriting an existing file');
assert.match(uiText, /api\.deleteJar\(kind, file\.name\)/,
  'installed Teleport Requests files should use the same visible remove action as other JARs');

(async () => {
  const jar = path.join(root, 'minecraft-server', 'server-teleport', 'dist', 'ServerTeleport.jar');
  assert.ok(fs.existsSync(jar), 'Bundled ServerTeleport JAR is missing.');
  const inspection = await test.inspectAntiCheatJar(jar);
  assert.equal(inspection.kind, 'plugins');
  assert.equal(inspection.pluginName, 'ServerTeleport');
  assert.equal(inspection.bundledTeleportIdentity, true);
  assert.deepEqual(
    [...inspection.declaredCommands].sort(),
    ['serverteleport', 'tpa', 'tpaccept', 'tpacancel', 'tpdeny'].sort()
  );
  assert.match(inspection.sha256, /^[a-f0-9]{64}$/);
  assert.match(mainText, new RegExp(`BUNDLED_TELEPORT_SHA256 = '${inspection.sha256}'`), 'the packaged JAR hash should be pinned in the backend');
  assert.match(mainText, /BUNDLED_TELEPORT_SIZE = 49_163/, 'the packaged JAR size should be pinned in the backend');

  const fabricJar = path.join(root, 'minecraft-server', 'server-teleport-fabric', 'dist', 'ServerTeleport-Fabric-1.6.6+mc26.2.jar');
  assert.ok(fs.existsSync(fabricJar), 'Bundled Fabric ServerTeleport JAR is missing.');
  const fabricInspection = await test.inspectAntiCheatJar(fabricJar);
  assert.equal(fabricInspection.kind, 'mods');
  assert.equal(fabricInspection.fabricModId, 'serverteleport_fabric');
  assert.equal(fabricInspection.fabricEnvironment, 'server');
  assert.equal(fabricInspection.fabricMinecraftDependency, '=26.2');
  assert.ok(fabricInspection.fabricMainEntrypoints.includes('dev.serverteleport.fabric.ServerTeleportFabric'));
  assert.equal(fabricInspection.bundledFabricTeleportIdentity, true);
  assert.equal(test.inspectionMatchesBundledTeleportAdapter(fabricInspection, fabricAdapter), true);
  assert.equal(fabricInspection.sha256, '2d58465fb8ec3d04a173761f73226d815d5067b062357006549852894fd58157');
  assert.equal(fabricInspection.size, 130973);

  const dependencyArtifact = await test.findBundledTeleportDependencyArtifact(fabricAdapter);
  assert.ok(dependencyArtifact, 'The exact Fabric API dependency must ship for a TPA-only install.');
  assert.equal(dependencyArtifact.sha256, 'e5b858ceb13290c274e31cb888ff5a1a40cb91067e7ffab0b5b775aec51e216a');
  assert.equal(dependencyArtifact.size, 2566123);

  const fabricOnlyRoot = path.join(root, 'work', 'teleport-fabric-dependency-test');
  const fabricOnlyMods = path.join(fabricOnlyRoot, 'mods');
  fs.rmSync(fabricOnlyRoot, { recursive: true, force: true });
  fs.mkdirSync(fabricOnlyMods, { recursive: true });
  const missingDependency = await test.getBundledTeleportFabricDependencyState({
    root: fabricOnlyRoot, mods: fabricOnlyMods, plugins: path.join(fabricOnlyRoot, 'plugins')
  }, fabricAdapter);
  assert.equal(missingDependency.ready, false, 'an otherwise empty Fabric server must report the dependency as absent');
  assert.equal(missingDependency.conflict, false, 'an absent dependency is provisionable, not a conflict');
  fs.copyFileSync(dependencyArtifact.path, path.join(fabricOnlyMods, 'fabric-api-0.161.0+26.2.jar'));
  const installedDependency = await test.getBundledTeleportFabricDependencyState({
    root: fabricOnlyRoot, mods: fabricOnlyMods, plugins: path.join(fabricOnlyRoot, 'plugins')
  }, fabricAdapter);
  assert.equal(installedDependency.ready, true, 'the freshly provisioned exact dependency must be accepted');
  assert.equal(installedDependency.managed, true, 'the pinned dependency must be integrity-verified');

  const renamedFabricConflict = path.join(fabricOnlyMods, 'AnotherTeleport.jar');
  fs.copyFileSync(fabricJar, renamedFabricConflict);
  const fabricConflicts = await test.findBundledTeleportCommandConflicts({
    root: fabricOnlyRoot, mods: fabricOnlyMods, plugins: path.join(fabricOnlyRoot, 'plugins')
  }, null, fabricAdapter);
  assert.equal(fabricConflicts.length, 1, 'a second live Fabric TPA identity must block install');
  fs.rmSync(renamedFabricConflict, { force: true });
  assert.deepEqual(JSON.parse(JSON.stringify(await test.findBundledTeleportCommandConflicts({
    root: fabricOnlyRoot, mods: fabricOnlyMods, plugins: path.join(fabricOnlyRoot, 'plugins')
  }, null, fabricAdapter))), [], 'removing the conflicting mod must clear the live conflict scan');
  fs.rmSync(fabricOnlyRoot, { recursive: true, force: true });

  const conflictRoot = path.join(root, 'work', 'teleport-conflict-test');
  const plugins = path.join(conflictRoot, 'plugins');
  fs.rmSync(conflictRoot, { recursive: true, force: true });
  fs.mkdirSync(plugins, { recursive: true });
  const copiedConflict = path.join(plugins, 'JustTPA.jar');
  fs.copyFileSync(jar, copiedConflict);
  fs.writeFileSync(path.join(conflictRoot, 'installed-addons.json'), JSON.stringify({
    version: 1,
    addons: [{ kind: 'plugins', file: 'JustTPA.jar', title: 'JustTPA' }]
  }));
  const conflicts = await test.findBundledTeleportCommandConflicts({ plugins });
  assert.equal(conflicts.length, 1, 'an actual installed command-owning JAR must remain a conflict');
  assert.deepEqual([...conflicts[0].commands].sort(), ['tpa', 'tpaccept', 'tpacancel', 'tpdeny'].sort());
  fs.rmSync(copiedConflict, { force: true });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await test.findBundledTeleportCommandConflicts({ plugins }))),
    [],
    'removing the JAR must clear its conflict even when stale add-on metadata remains'
  );
  fs.rmSync(conflictRoot, { recursive: true, force: true });
  console.log('PASS ServerTeleport Electron integration contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
