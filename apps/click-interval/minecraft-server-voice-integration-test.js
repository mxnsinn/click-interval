'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const exportRoot = path.join(root, 'work', 'voice-client-export-test');
const exportDestination = path.join(exportRoot, 'ProximityVoice-Fabric-Client-1.0.0.jar');
fs.rmSync(exportRoot, { recursive: true, force: true });
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const source = `${mainText}\nmodule.exports.__voiceTest = {\n` +
  '  normalizeServerToolsMetadata, classifyBundledVoiceInstall,\n' +
  '  getBundledVoiceAdapter, getBundledVoiceAdapterById, inspectionMatchesBundledVoiceAdapter,\n' +
  '  isBundledVoiceRuntimeCompatible, inspectAntiCheatJar, describeBundledVoiceNetwork,\n' +
  '  prepareBundledVoiceNetworkForStartup\n' +
  '};';

const ipcHandlers = new Map();
const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'voice-integration-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: exportDestination })
  }, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
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
const test = moduleMock.exports.__voiceTest;

assert.ok(test, 'Proximity Voice integration test hooks failed to load.');
for (const channel of ['tools:getVoiceStatus', 'tools:installVoice', 'tools:removeVoice', 'tools:exportVoiceClient']) {
  assert.ok(ipcHandlers.has(channel), `Missing narrow voice IPC handler: ${channel}`);
}

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const identity = sha256 => ({
  kind: 'plugins', pluginName: 'ProximityVoice', bundledVoiceIdentity: true, sha256
});
assert.equal(test.classifyBundledVoiceInstall({ artifact: { sha256: hashA }, installed: identity(hashA) }).managed, true);
const recordedUpdate = test.classifyBundledVoiceInstall({
  artifact: { sha256: hashB },
  installed: identity(hashA),
  record: { file: 'ProximityVoice-Server.jar', sha256: hashA, size: 100, installedAt: '2026-10-02T00:00:00.000Z' }
});
assert.equal(recordedUpdate.managed, true);
assert.equal(recordedUpdate.updateAvailable, true);
assert.equal(test.classifyBundledVoiceInstall({ artifact: { sha256: hashA }, installed: {
  kind: 'plugins', pluginName: 'ProximityVoice', bundledVoiceIdentity: false, sha256: hashA
} }).conflict, true, 'matching name/hash must not establish ownership without the bundled class identity');

const metadata = test.normalizeServerToolsMetadata({
  teleport: { file: 'ServerTeleport.jar', sha256: hashB, size: 28924, installedAt: '2026-10-02T00:00:00.000Z' },
  voice: { file: 'ProximityVoice-Server.jar', sha256: hashA, size: 52086, installedAt: '2026-10-02T00:00:00.000Z' }
});
assert.equal(metadata.teleport.sha256, hashB, 'normalization must preserve the teleport ownership record');
assert.equal(metadata.voice.sha256, hashA, 'normalization must preserve the voice ownership record');
assert.equal(test.normalizeServerToolsMetadata({
  voice: { file: '../ProximityVoice-Server.jar', sha256: hashA, size: 1 }
}).voice, null, 'unsafe voice metadata must not establish ownership');

const compatiblePlatform = { jarExists: true, compatible: true, supportsPlugins: true };
for (const type of ['paper', 'purpur', 'spigot']) {
  assert.equal(test.isBundledVoiceRuntimeCompatible(type, compatiblePlatform), true, `${type} should support the server relay`);
}
for (const type of ['vanilla', 'fabric', 'forge', 'neoforge']) {
  assert.equal(test.isBundledVoiceRuntimeCompatible(type, compatiblePlatform), false, `${type} is not supported by this Paper relay artifact`);
}
const fabricVoiceAdapter = test.getBundledVoiceAdapter('fabric', '26.2');
assert.equal(fabricVoiceAdapter.kind, 'mods');
assert.equal(fabricVoiceAdapter.managedFile, 'ProximityVoice-Fabric-Server.jar');
assert.equal(test.isBundledVoiceRuntimeCompatible('fabric', {
  jarExists: true, compatible: true, supportsMods: true, minecraftVersion: '26.2'
}, fabricVoiceAdapter), true, 'Fabric 26.2 should support the bundled server-side voice mod');
assert.equal(test.getBundledVoiceAdapter('fabric', '26.3'), null,
  'unsupported Fabric versions must not be described as compatible');

const preloadText = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const standalonePreloadText = fs.readFileSync(path.join(root, 'minecraft-server', 'preload.js'), 'utf8');
const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const releaseScriptText = fs.readFileSync(path.join(root, 'build-development-update.ps1'), 'utf8');
const voiceClientRoot = path.join(root, 'minecraft-server', 'proximity-voice', 'fabric-client');
const voiceFabricServerSource = fs.readFileSync(path.join(root, 'minecraft-server', 'proximity-voice',
  'fabric-server', 'src', 'main', 'java', 'dev', 'proximityvoice', 'fabric',
  'ProximityVoiceFabricServer.java'), 'utf8');
const avatarMixinText = fs.readFileSync(path.join(voiceClientRoot, 'src', 'main', 'java', 'dev',
  'proximityvoice', 'client', 'mixin', 'AvatarRendererMixin.java'), 'utf8');
const microphoneFont = JSON.parse(fs.readFileSync(path.join(voiceClientRoot, 'src', 'main', 'resources',
  'assets', 'proximityvoice_client', 'font', 'microphone.json'), 'utf8'));
for (const text of [preloadText, standalonePreloadText]) {
  assert.match(text, /getVoiceStatus:[^\n]+tools:getVoiceStatus/);
  assert.match(text, /installVoice:[^\n]+tools:installVoice/);
  assert.match(text, /removeVoice:[^\n]+tools:removeVoice/);
  assert.match(text, /exportVoiceClient:[^\n]+tools:exportVoiceClient/);
}
assert.doesNotMatch(uiText, /api\.(?:get|install|remove|export)Voice\(/,
  'Proximity Voice must not remain as a built-in promotional, install, or client-export control');
assert.match(indexText, /id="msDownloadServerAddons"[^>]*>Download server add-ons/,
  'the website download workflow must replace the built-in voice card');
assert.match(releaseScriptText, /proximity-voice\\fabric-server\\\.gradle/,
  'development releases must remove the Fabric voice server Gradle cache');
assert.match(releaseScriptText, /proximity-voice\\fabric-server\\build/,
  'development releases must remove Fabric voice server build outputs while retaining dist artifacts');
assert.match(voiceFabricServerSource, /SERVER_STARTED\.register\(this::onServerStarted\)/,
  'Fabric voice snapshots must wait for the fully started lifecycle phase');
assert.match(voiceFabricServerSource, /var playerList = server\.getPlayerList\(\);\s+if \(playerList == null\)/,
  'Fabric voice must tolerate PlayerList being absent during early startup');
const voiceStartingMethod = voiceFabricServerSource.slice(
  voiceFabricServerSource.indexOf('private void onServerStarting'),
  voiceFabricServerSource.indexOf('private void onServerStarted')
);
assert.doesNotMatch(voiceStartingMethod, /refreshSnapshots\(\)/,
  'SERVER_STARTING must not enumerate players before Minecraft constructs PlayerList');
const importSource = mainText.slice(mainText.indexOf('async function importJarFiles'), mainText.indexOf('async function deleteManagedJar'));
assert.doesNotMatch(importSource, /declares the managed Proximity Voice identity|Use the built-in Proximity Voice entry/,
  'manually downloaded Proximity Voice JARs must be accepted by normal import');
const deleteSource = mainText.slice(mainText.indexOf('async function deleteManagedJar'), mainText.indexOf('function normalizeAddonKind'));
assert.match(deleteSource, /if \(voiceFile\)[\s\S]*?if \(voice\.managed\) return removeBundledVoice\(profileSnapshot\)/,
  'verified legacy managed voice copies should still use integrity-safe removal');
assert.doesNotMatch(mainText, /Use the built-in Proximity Voice entry to remove this managed plugin safely/);
assert.match(mainText, /protocol: 'UDP'/, 'direct hosting must map a separate UDP port');
assert.match(mainText, /Minecraft\/playit TCP address does not carry voice/);
assert.match(mainText, /serverToolMutationCoordinator/, 'server tool changes must serialize across built-in tools');
assert.doesNotMatch(avatarMixinText, /🎙/, 'name tags must not depend on a glyph absent from Minecraft 26.2');
assert.match(avatarMixinText, /Component\.literal\("  "\)\.append\(/,
  'ordinary spacing must use Minecraft’s default font rather than the private microphone font');
for (const glyph of ['\\uE001', '\\uE002', '\\uE003', '\\uE004']) {
  assert.ok(avatarMixinText.includes(glyph), `missing custom microphone state ${glyph}`);
}
assert.equal(microphoneFont.providers[0].file, 'proximityvoice_client:font/microphone.png');
assert.equal(microphoneFont.providers[0].chars[0], '\uE001\uE002\uE003\uE004');
const teleportInstallSource = mainText.slice(
  mainText.indexOf('function installBundledTeleport()'),
  mainText.indexOf('async function removeBundledTeleport')
);
const voiceInstallSource = mainText.slice(
  mainText.indexOf('function installBundledVoice()'),
  mainText.indexOf('async function removeBundledVoice')
);
assert.doesNotMatch(teleportInstallSource, /mapManagedVoiceUdpForDirectHosting/,
  'installing Teleport Requests must never touch voice/NAT state');
assert.match(voiceInstallSource, /mapManagedVoiceUdpForDirectHosting/,
  'installing Proximity Voice should refresh UDP mapping when direct hosting is enabled');

assert.deepEqual(JSON.parse(JSON.stringify(test.describeBundledVoiceNetwork({
  installed: true,
  directHostingEnabled: false,
  udpPort: 24454
}))), {
  state: 'manual',
  notice: 'Voice uses UDP 24454; remote players need separate UDP forwarding. A Minecraft/playit TCP address does not carry voice.',
  warning: ''
}, 'manual UDP requirements are routine information, not an error');
assert.deepEqual(JSON.parse(JSON.stringify(test.describeBundledVoiceNetwork({
  installed: true,
  directHostingEnabled: true,
  udpMapped: true,
  udpPort: 24454
}))), {
  state: 'upnp-mapped',
  notice: 'UPnP mapped UDP 24454; external reachability is not verified.',
  warning: ''
}, 'an owned UPnP mapping should be reported truthfully without claiming reachability');
const failedMapping = test.describeBundledVoiceNetwork({
  installed: true,
  directHostingEnabled: true,
  udpPort: 24454,
  mappingError: 'router rejected mapping'
});
assert.equal(failedMapping.state, 'upnp-failed');
assert.match(failedMapping.warning, /router rejected mapping/,
  'a real automatic mapping failure should remain an actionable warning');

(async () => {
  const noBundledVoiceRoot = path.join(root, 'work', 'voice-startup-without-managed-record');
  fs.rmSync(noBundledVoiceRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(noBundledVoiceRoot, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(noBundledVoiceRoot, 'plugins'), { recursive: true });
  const noBundledVoicePaths = {
    root: noBundledVoiceRoot,
    mods: path.join(noBundledVoiceRoot, 'mods'),
    plugins: path.join(noBundledVoiceRoot, 'plugins'),
    serverTools: path.join(noBundledVoiceRoot, 'server-tools.json')
  };
  for (const localOnly of [false, true]) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(await test.prepareBundledVoiceNetworkForStartup({
        paths: noBundledVoicePaths,
        config: { serverType: 'fabric', serverVersion: '26.2', localOnly },
        platform: { minecraftVersion: '26.2' }
      }))),
      { active: false },
      `Fabric ${localOnly ? 'local-only' : 'public'} startup with null managed-voice metadata must skip the absent JAR without dereferencing a null adapter`
    );
  }
  fs.rmSync(noBundledVoiceRoot, { recursive: true, force: true });

  const jar = path.join(root, 'minecraft-server', 'proximity-voice', 'dist', 'ProximityVoice-Server.jar');
  assert.ok(fs.existsSync(jar), 'Bundled Proximity Voice server JAR is missing.');
  const inspection = await test.inspectAntiCheatJar(jar);
  assert.equal(inspection.kind, 'plugins');
  assert.equal(inspection.pluginName, 'ProximityVoice');
  assert.equal(inspection.bundledVoiceIdentity, true);
  assert.deepEqual([...inspection.declaredCommands], ['proximityvoice']);
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_SERVER_SHA256 = '${inspection.sha256}'`),
    'the packaged server relay hash should be pinned in the backend');
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_SERVER_SIZE = ${inspection.size.toLocaleString('en-US').replace(/,/g, '_')}`),
    'the packaged server relay size should be pinned in the backend');

  const clientJar = path.join(root, 'minecraft-server', 'proximity-voice', 'fabric-client', 'dist',
    'ProximityVoice-Fabric-Client-1.0.0.jar');
  assert.ok(fs.existsSync(clientJar), 'Bundled Proximity Voice Fabric client JAR is missing.');
  const clientInspection = await test.inspectAntiCheatJar(clientJar);
  assert.equal(clientInspection.kind, 'mods');
  assert.equal(clientInspection.descriptor, 'fabric.mod.json');
  const clientArchiveDirectory = fs.readFileSync(clientJar).toString('latin1');
  assert.match(clientArchiveDirectory, /assets\/proximityvoice_client\/font\/microphone\.json/,
    'the client JAR must contain the custom microphone font definition');
  assert.match(clientArchiveDirectory, /assets\/proximityvoice_client\/textures\/font\/microphone\.png/,
    'the client JAR must contain the generated microphone bitmap atlas');
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_CLIENT_SHA256 = '${clientInspection.sha256}'`),
    'the packaged client mod hash should be pinned in the backend');
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_CLIENT_SIZE = ${clientInspection.size.toLocaleString('en-US').replace(/,/g, '_')}`),
    'the packaged client mod size should be pinned in the backend');

  const fabricServerJar = path.join(root, 'minecraft-server', 'proximity-voice', 'fabric-server', 'dist',
    'ProximityVoice-Fabric-Server-1.0.1+mc26.2.jar');
  assert.ok(fs.existsSync(fabricServerJar), 'Bundled Proximity Voice Fabric server JAR is missing.');
  const fabricServerInspection = await test.inspectAntiCheatJar(fabricServerJar);
  assert.equal(fabricServerInspection.kind, 'mods');
  assert.equal(fabricServerInspection.fabricModId, 'proximityvoice_fabric_server');
  assert.equal(fabricServerInspection.fabricEnvironment, 'server');
  assert.equal(fabricServerInspection.bundledFabricVoiceIdentity, true);
  assert.equal(test.inspectionMatchesBundledVoiceAdapter(fabricServerInspection, fabricVoiceAdapter), true);
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_FABRIC_SERVER_SHA256 = '${fabricServerInspection.sha256}'`),
    'the packaged Fabric server relay hash should be pinned in the backend');
  assert.match(mainText, new RegExp(`BUNDLED_VOICE_FABRIC_SERVER_SIZE = ${fabricServerInspection.size.toLocaleString('en-US').replace(/,/g, '_')}`),
    'the packaged Fabric server relay size should be pinned in the backend');
  const fabricMetadata = test.normalizeServerToolsMetadata({ voice: {
    adapterId: 'fabric-26.2', kind: 'mods', minecraftVersion: '26.2',
    file: 'ProximityVoice-Fabric-Server.jar', sha256: fabricServerInspection.sha256,
    size: fabricServerInspection.size, dependencyFile: 'fabric-api-0.161.0+26.2.jar', dependencyProvisioned: true
  }});
  assert.equal(fabricMetadata.voice.adapterId, 'fabric-26.2');
  assert.equal(fabricMetadata.voice.kind, 'mods');
  assert.equal(fabricMetadata.voice.dependencyProvisioned, true);
  const exportResult = await ipcHandlers.get('tools:exportVoiceClient')({ sender: {} });
  assert.equal(exportResult.cancelled, false);
  assert.equal(exportResult.minecraftVersion, '26.2');
  assert.equal(exportResult.loader, 'Fabric');
  assert.equal(fs.statSync(exportDestination).size, clientInspection.size);
  assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(exportDestination)).digest('hex'),
    clientInspection.sha256, 'exported client mod must match the pinned bundled artifact');
  fs.rmSync(exportRoot, { recursive: true, force: true });
  console.log('PASS Proximity Voice Electron integration contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
