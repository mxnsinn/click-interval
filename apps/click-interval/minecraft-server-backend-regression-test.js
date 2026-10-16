const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__test = {\n` +
  '  assertSafeHttpsUrl, replacePaperAntiXrayBlock, renderPaperAntiXrayBlock, inspectPaperAntiXrayBlock, migratePaperAntiXrayMaxBlockHeight,\n' +
  '  chooseModrinthFile, chooseCurseForgeFile, getServerTypeAddonSupport,\n' +
  '  isSafeProfileId, isSafeWorldName, validateWorldName, makeSafeWorldName, resolveContainedPath, normalizeProfilesState,\n' +
  '  parseSha256Digest, validatePlayitAssetMetadata, parseAuthenticodeResult, normalizeExpectedHashes,\n' +
  '  isProtectionRuntimeReady, isRecordedLegacyProtectionInstall, inspectRecordedLegacyProtectionInstallation, removeLegacyProtection,\n' +
  '  normalizeProtectionConfig, renderBundledProtectionConfig, renderFabricProtectionConfig, renderFabricPacketAntiXrayConfig, protectionPolicyForUi, normalizeCompatibilityCheck, validateZipEntryName, inspectAntiCheatJar,\n' +
  '  normalizeProtectionIncidentEvent, parseProtectionIncidentLine, consumeProtectionLogChunk, mergeProtectionIncidentHistory,\n' +
  '  getExpectedAntiCheatKind, isAntiCheatDescriptorCompatible, isBundledProtectionRuntimeCompatible, inspectionMatchesBundledProtectionAdapter, getBundledProtectionAdapter, assessManagedBundledProtectionRefresh,\n' +
  '  getBundledProtectionJarPaths, migrateLegacyBundledProtectionData, disableLegacyBundledProtectionJar, assertCurrentBundledProtectionJarIsReplaceable,\n' +
  '  getPardonCommands, normalizeServerConfig, configForLocalOnlyMode, buildPublicJoinAddress, renderBundledVoiceNetworkConfig, renderLocalOnlyBundledVoiceConfig, normalizeManagedAccessTeamIds, escapePropertyValue, getRestartRequiredSettingChanges, getRecordedPlatformIdentity, reconcileConfigWithInstalledPlatform,\n' +
  '  parsePlayerPositionSnbt, parsePlayerScalarSnbt, splitTopLevelSnbtList, splitTopLevelSnbtCompound, playerInventorySection, parsePlayerInventorySnbt, parsePlayerEquipmentSnbt, mergePlayerInspectionItems, normalizePlayerStatistics,\n' +
  '  installedAddonKey, normalizeAddonIconUrl, normalizeInstalledAddonEntry, normalizeInstalledAddonMetadata, describeAddonProviderSelection, installedAddonMatchesProviderSelection,\n' +
  '  createSingleFlightCoordinator, serializeProtectionStateTransaction, publishStagedFileIfAbsent, getPlatformInstallRequestKey, resolvePlatformInstallTarget,\n' +
  '  packetAntiXrayTransitionNeedsFreshChunks, summarizeServerStartupFailure,\n' +
  '  isServerReadyOutput, summarizeServerStartupFailure, waitForChildExit, canMarkServerReady, isServerRuntimeReady, tryWriteServerInput,\n' +
  '  usesRegistryGameRules, getGameRuleCommandCandidates,\n' +
  '  consumePlayerLogChunk, appendPlayerHistoryEvent, flattenPlayerHistoryEvents, parseBanExpiry, buildAssemblyTempBanReason, normalizeTempBanDurationMs, getTempBanTimerDelay,\n' +
  '  getServerPlatformStatus\n' +
  '};';

const ipcHandlers = new Map();
const testUserData = path.join(__dirname, 'work', `backend-test-profile-${process.pid}`);
const electronMock = {
  app: { getPath: () => testUserData, on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
  dialog: {},
  shell: {},
  Menu: {},
  clipboard: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
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
  require: (id) => {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
    if (id === './mod-policy') return require(path.join(path.dirname(sourcePath), 'mod-policy.js'));
    if (id === './access-policy') return require(path.join(path.dirname(sourcePath), 'access-policy.js'));
    if (id === './protection-messages') return require(path.join(path.dirname(sourcePath), 'protection-messages.js'));
    if (id === './protection-tuning') return require(path.join(path.dirname(sourcePath), 'protection-tuning.js'));
    if (id === './player-assets') return require(path.join(path.dirname(sourcePath), 'player-assets.js'));
    if (id === './nat-lease-ownership') return require(path.join(path.dirname(sourcePath), 'nat-lease-ownership.js'));
    if (id === './performance-safety') return require(path.join(path.dirname(sourcePath), 'performance-safety.js'));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: sourcePath });
const test = moduleMock.exports.__test;

assert(test, 'Backend test hooks failed to load.');
const serverConsoleSource = fs.readFileSync(path.join(__dirname, 'server-console.js'), 'utf8');
assert.match(serverConsoleSource, /['"]local-only['"]/,
  'the server console must route local-only commands to the manager instead of Minecraft');
assert.match(source, /assertLocalOnlyExposureStopped\(config\)/,
  'Minecraft startup must refuse a local-only launch while a public tunnel is still running');
assert.match(source, /cleanupOwnedNatMappingsForProfileUnlocked/,
  'local-only mode must reuse ownership-scoped TCP and voice mapping cleanup');
assert.match(source, /await prepareBundledVoiceNetworkForStartup\(\{ paths, config, platform \}\)/,
  'local-only startup must rebind the managed bundled proximity voice relay before Java starts');
assert.match(source, /config\.localOnly && !discovery\.complete/,
  'local-only startup must fail closed when voice-provider discovery is incomplete');
assert.match(source, /'enable-rcon': config\.localOnly \? false/,
  'local-only server.properties must disable RCON');
assert.match(source, /'enable-query': backendBehindProxy \|\| config\.localOnly \? false/,
  'local-only and proxied backends must disable the UDP query listener');
assert.match(source, /'enable-jmx-monitoring': config\.localOnly \? false/,
  'local-only server.properties must disable remote JMX');
const startOperationSource = source.slice(
  source.indexOf('async function startServerOperation'),
  source.indexOf('function stopServer', source.indexOf('async function startServerOperation'))
);
const platformGateIndex = startOperationSource.indexOf('if (!platform.compatible)');
const protectionRefreshIndex = startOperationSource.indexOf('await refreshManagedBundledProtectionBeforeStartUnlocked');
const buildArgsIndex = startOperationSource.indexOf('await buildServerJavaArgs');
const spawnIndex = startOperationSource.indexOf('processRef = await launchPersistentProcess(');
assert(platformGateIndex >= 0 && protectionRefreshIndex > platformGateIndex,
  'Managed Fabric protection refresh must run only after the final platform compatibility check.');
assert(buildArgsIndex > protectionRefreshIndex && spawnIndex > buildArgsIndex,
  'Managed Fabric protection refresh must finish before Java arguments are built or a server process can spawn.');
const packetConfig = test.renderFabricPacketAntiXrayConfig(
  '# keep this\nanti-xray:\n  enabled: "false" # old\n  async-worker-threads: 1\n',
  true
);
assert.match(packetConfig, /^# keep this$/m);
assert.match(packetConfig, /^  enabled: true # old$/m,
  'Fabric packet Anti-Xray rendering should preserve an existing inline comment');
assert.match(packetConfig, /^  async-worker-threads: 3$/m,
  'Fabric packet Anti-Xray should have enough bounded rewrite workers to avoid exposing overflow chunks');
assert.match(packetConfig, /^  async-queue-size: 128$/m,
  'Fabric packet Anti-Xray should absorb normal exploration bursts without unbounded queue growth');
assert.match(packetConfig, /^  engine-mode: 1$/m,
  'Fabric packet Anti-Xray should hide ores without the expensive fake-stone filler pass');
assert.match(packetConfig, /^  mode2-obfuscate-replacement-blocks: false$/m);
assert.match(packetConfig, /^  only-obfuscate-hidden-blocks: false$/m,
  'cave-facing ores should remain obfuscated until a nearby block update legitimately reveals them');
assert.match(packetConfig, /^  guarantee-hide-all-hidden-blocks: true$/m,
  'all configured ore palette entries should be covered by packet obfuscation');
assert.match(packetConfig, /^  max-blocks-per-chunk: 4096$/m);
assert.equal((packetConfig.match(/^  enabled\s*:/gm) || []).length, 1,
  'Fabric packet Anti-Xray rendering must replace, not duplicate, the global enabled key.');
const applyAntiXraySource = source.slice(
  source.indexOf('async function applyAntiXray(options'),
  source.indexOf('async function getSecurityStatus')
);
assert.match(applyAntiXraySource, /restartRequired: Boolean\(protectionConfig\.restartRequired\)/,
  'the UI Anti-Xray action must preserve the fresh-chunk restart requirement from the config transaction');
const packetTransitionAdapter = test.getBundledProtectionAdapter('fabric', '26.2');
const packetDisabled = { enabled: true, layers: { builtIn: true, antiXray: false } };
const packetEnabled = { enabled: true, layers: { builtIn: true, antiXray: true } };
assert.equal(test.packetAntiXrayTransitionNeedsFreshChunks(
  packetTransitionAdapter, packetDisabled, packetEnabled, true
), true, 'enabling packet Anti-Xray on a running server needs fresh client chunks');
assert.equal(test.packetAntiXrayTransitionNeedsFreshChunks(
  packetTransitionAdapter, packetDisabled, packetEnabled, false
), false, 'a stopped server will naturally send protected chunks on its next start');
assert.equal(test.packetAntiXrayTransitionNeedsFreshChunks(
  packetTransitionAdapter, packetEnabled, packetEnabled, true
), false, 'saving an already-enabled packet provider should not manufacture a restart requirement');
assert.match(
  test.summarizeServerStartupFailure(
    'java.lang.OutOfMemoryError: Java heap space at com.meowantixray.antixray.FakeOreService',
    null,
    1,
    null,
    { memoryMb: 2048 }
  ),
  /Anti-Xray exhausted the 2048 MB Java heap/,
  'an Anti-Xray heap crash should tell the owner to increase memory and update protection'
);
assert.match(
  test.summarizeServerStartupFailure('Could not reserve enough space for object heap', null, 1, null, { memoryMb: 8192 }),
  /could not reserve/i,
  'a JVM reservation failure should remain distinct from runtime heap exhaustion'
);

const refreshAdapter = test.getBundledProtectionAdapter('fabric', '26.2');
const oldManagedHash = 'a'.repeat(64);
const newArtifactHash = 'b'.repeat(64);
const oldManagedInspection = {
  kind: 'mods',
  descriptor: 'fabric.mod.json',
  fabricModId: 'serverprotection_fabric',
  fabricEnvironment: 'server',
  fabricMainEntrypoints: ['dev.serverprotection.fabric.ServerProtectionFabric'],
  fabricMinecraftDependency: '=26.2',
  bundledFabricProtectionIdentity: true,
  sha256: oldManagedHash,
  size: 123
};
const oldManagedRecord = {
  adapterId: 'fabric-26.2',
  serverType: 'fabric',
  minecraftVersion: '26.2',
  kind: 'mods',
  file: 'ServerProtection-Fabric.jar',
  sha256: oldManagedHash,
  size: 123
};
assert.deepEqual(
  JSON.parse(JSON.stringify(test.assessManagedBundledProtectionRefresh({
    adapter: refreshAdapter,
    record: oldManagedRecord,
    installed: oldManagedInspection,
    artifact: { sha256: newArtifactHash, size: 456 }
  }))),
  { eligible: true, reason: 'managed-update' }
);
assert.equal(test.assessManagedBundledProtectionRefresh({
  adapter: refreshAdapter,
  record: oldManagedRecord,
  installed: { ...oldManagedInspection, sha256: 'c'.repeat(64) },
  artifact: { sha256: newArtifactHash, size: 456 }
}).reason, 'modified', 'A changed managed JAR must never be auto-replaced.');
assert.equal(test.assessManagedBundledProtectionRefresh({
  adapter: refreshAdapter,
  record: {},
  installed: oldManagedInspection,
  artifact: { sha256: newArtifactHash, size: 456 }
}).reason, 'unmanaged', 'A JAR without matching ownership metadata must never be auto-replaced.');
for (const channel of ['players:getAccess', 'players:setAccess', 'players:removeAccess']) {
  assert(ipcHandlers.has(channel), `Missing player access IPC handler: ${channel}`);
}
assert.throws(() => test.assertSafeHttpsUrl('http://cdn.modrinth.com/file.jar'), /HTTPS/);
assert.throws(() => test.assertSafeHttpsUrl('https://example.com/file.jar', ['modrinth.com']), /unexpected host/);
assert.equal(test.assertSafeHttpsUrl('https://cdn.modrinth.com/file.jar', ['modrinth.com']).hostname, 'cdn.modrinth.com');
assert.equal(test.normalizeAddonIconUrl('http://cdn.modrinth.com/icon.png'), '', 'installed add-on icons must not retain insecure URLs');
assert.match(test.normalizeAddonIconUrl('https://cdn.modrinth.com/data/icon.png'), /^https:\/\/cdn\.modrinth\.com\//);
const addonMetadata = JSON.parse(JSON.stringify(test.normalizeInstalledAddonMetadata({ addons: [
  { kind: 'mods', file: 'Example.jar', source: 'modrinth', projectId: 'project-1', providerVersionId: 'version-1',
    providerFileName: 'Example-1.0.jar', versionName: '1.0', gameVersion: '26.2', serverType: 'fabric',
    expectedHashes: { sha1: 'a'.repeat(40) }, title: 'Example', iconUrl: 'https://cdn.modrinth.com/icon.png' },
  { kind: 'mods', file: 'example.jar', source: 'modrinth', title: 'Duplicate' },
  { kind: 'plugins', file: '../escape.jar', iconUrl: 'https://example.com/icon.png' },
  { kind: 'plugins', file: 'Plugin.jar', source: 'curseforge', title: 'Plugin' }
] })));
assert.equal(addonMetadata.addons.length, 2, 'metadata should reject unsafe paths and de-duplicate add-ons by kind and filename');
assert.equal(addonMetadata.addons[0].iconUrl, 'https://cdn.modrinth.com/icon.png');
assert.equal(addonMetadata.addons[0].providerVersionId, 'version-1');
assert.equal(addonMetadata.addons[0].providerFileName, 'Example-1.0.jar');
assert.equal(addonMetadata.addons[0].expectedHashes.sha1, 'a'.repeat(40));
assert.equal(test.installedAddonKey('mods', 'EXAMPLE.jar'), 'mods:example.jar');
const providerSelection = test.describeAddonProviderSelection('modrinth', {
  version: { id: 'version-2', version_number: '2.0', date_published: '2026-10-03T00:00:00.000Z' },
  file: { filename: 'Example-2.0.jar', size: 42, hashes: { sha1: 'b'.repeat(40) } }
});
assert.equal(providerSelection.providerVersionId, 'version-2');
assert.equal(providerSelection.providerFileName, 'Example-2.0.jar');
assert.equal(test.installedAddonMatchesProviderSelection({ providerVersionId: 'version-1' }, providerSelection), false,
  'a newer provider version should be reported immediately');
assert.equal(test.installedAddonMatchesProviderSelection({ providerVersionId: 'version-2' }, providerSelection), true);
assert.equal(test.installedAddonMatchesProviderSelection({ providerVersionId: 'version-2' }, providerSelection, false), false,
  'a same-version JAR that fails provider integrity must still be repairable through Update');

for (const worldName of ['world', 'My World', '世界']) assert.equal(test.isSafeWorldName(worldName), true);
for (const worldName of ['', '.', '..', '../outside', '..\\outside', '/outside', 'C:\\outside', 'CON', 'con.txt', 'NUL', 'world.', 'world ', 'a/b', 'a\\b', `bad\0name`]) {
  assert.equal(test.isSafeWorldName(worldName), false, `Unsafe world name accepted: ${JSON.stringify(worldName)}`);
  assert.throws(() => test.validateWorldName(worldName), /single safe folder name/);
}
assert.equal(test.isSafeWorldName(test.makeSafeWorldName('../unsafe world')), true);
assert.deepEqual(
  test.normalizeManagedAccessTeamIds(['ci_r_0123456789', 'CI_R_0123456789', '../bad', 'asm_pve']),
  ['ci_r_0123456789'],
  'only bounded deterministic role-team IDs should be persisted for later cleanup'
);

const normalizedServerConfig = test.normalizeServerConfig({
  levelName: 'world', motd: '', memoryMb: 'not-a-number', port: 70000, maxPlayers: 0,
  spawnProtection: 0, playersSleepingPercentage: 2000, spawnRadius: -10,
  randomTickSpeed: 0, viewDistance: 500, simulationDistance: 1,
  functionPermissionLevel: 99, opPermissionLevel: -2
});
assert.equal(normalizedServerConfig.motd, '');
assert.equal(normalizedServerConfig.memoryMb, 2048);
assert.equal(normalizedServerConfig.port, 65535);
assert.equal(normalizedServerConfig.maxPlayers, 1);
assert.equal(normalizedServerConfig.spawnProtection, 0, 'Spawn protection 0 must remain valid.');
assert.equal(normalizedServerConfig.playersSleepingPercentage, 100);
assert.equal(normalizedServerConfig.spawnRadius, 0);
assert.equal(normalizedServerConfig.randomTickSpeed, 0, 'Random tick speed 0 must remain valid.');
assert.equal(normalizedServerConfig.viewDistance, 32);
assert.equal(normalizedServerConfig.simulationDistance, 2);
assert.equal(normalizedServerConfig.functionPermissionLevel, 4);
assert.equal(normalizedServerConfig.opPermissionLevel, 1);

const localOnlyConfig = test.configForLocalOnlyMode({
  bindIp: '192.168.1.20',
  publicAddress: 'example.test:25565',
  directHostingEnabled: true,
  port: 25570
}, true);
assert.equal(localOnlyConfig.localOnly, true);
assert.equal(localOnlyConfig.bindIp, '127.0.0.1', 'local-only mode must bind Minecraft to IPv4 loopback');
assert.equal(localOnlyConfig.localOnlyPreviousBindIp, '192.168.1.20');
assert.equal(localOnlyConfig.publicAddress, '', 'local-only mode must not advertise a stale public endpoint');
assert.equal(localOnlyConfig.directHostingEnabled, false, 'local-only mode must disable automatic router exposure');
assert.equal(test.buildPublicJoinAddress({
  localOnly: true,
  customHostname: 'stale.example.test',
  publicAddress: '203.0.113.4:25565'
}), '', 'local-only mode must suppress every public join/status target');
const publicAgain = test.configForLocalOnlyMode(localOnlyConfig, false);
assert.equal(publicAgain.localOnly, false);
assert.equal(publicAgain.bindIp, '192.168.1.20', 'disabling local-only mode should restore the previous explicit bind');
assert.equal(publicAgain.directHostingEnabled, false, 'leaving local-only mode must not silently re-expose the router');
const alreadyPublic = test.configForLocalOnlyMode({
  bindIp: '192.168.1.44',
  publicAddress: 'example.test:25565',
  directHostingEnabled: true,
  localOnly: false
}, false);
assert.equal(alreadyPublic.bindIp, '192.168.1.44', 'disabling an already-disabled mode must be idempotent');
assert.equal(alreadyPublic.publicAddress, 'example.test:25565');
assert.equal(alreadyPublic.directHostingEnabled, true);

const bukkitLocalVoice = test.renderLocalOnlyBundledVoiceConfig(
  "enabled: false\nbindAddress: ''\npublicHost: 'voice.example.test'\nport: 24500\nvoiceDistance: 32\nsessionTimeoutSeconds: 60\n",
  'yaml'
);
assert.match(bukkitLocalVoice, /^enabled: false$/m);
assert.match(bukkitLocalVoice, /^bindAddress: "127\.0\.0\.1"$/m);
assert.match(bukkitLocalVoice, /^publicHost: ""$/m);
assert.match(bukkitLocalVoice, /^port: 24500$/m);
assert.equal((bukkitLocalVoice.match(/^bindAddress:/gm) || []).length, 1,
  'local-only bundled voice rendering must eliminate duplicate/ambiguous bind keys');
const fabricLocalVoice = test.renderLocalOnlyBundledVoiceConfig(
  'enabled=true\nbindAddress=0.0.0.0\npublicHost=voice.example.test\nport=24501\nvoiceDistance=40\nsessionTimeoutSeconds=75\n',
  'properties'
);
assert.match(fabricLocalVoice, /^bindAddress=127\.0\.0\.1$/m);
assert.match(fabricLocalVoice, /^publicHost=$/m);
assert.match(fabricLocalVoice, /^port=24501$/m);
const restoredBukkitVoice = test.renderBundledVoiceNetworkConfig(
  bukkitLocalVoice,
  'yaml',
  '',
  'voice.example.test'
);
assert.match(restoredBukkitVoice, /^bindAddress: ""$/m);
assert.match(restoredBukkitVoice, /^publicHost: "voice\.example\.test"$/m);

const formattedMotd = test.normalizeServerConfig({ motd: '§cRed\n§kMagic§r' }).motd;
assert.equal(formattedMotd, '§cRed\\n§kMagic§r', 'MOTD line breaks should be stored as Minecraft newline escapes.');
assert.equal(test.escapePropertyValue('§cRed'), '\\u00A7cRed', 'Formatting marks must use Java-properties Unicode escapes.');
assert.equal(
  test.escapePropertyValue(formattedMotd, { preserveNewlineEscape: true }),
  '\\u00A7cRed\\n\\u00A7kMagic\\u00A7r',
  'MOTD formatting and line breaks must survive server.properties serialization.'
);
assert.equal(test.escapePropertyValue('C:\\server'), 'C\\:\\\\server', 'Ordinary backslashes and separators should remain escaped.');
assert.deepEqual(
  JSON.parse(JSON.stringify(test.getRestartRequiredSettingChanges({ motd: 'Old' }, { motd: 'New' }))),
  [{ key: 'motd', label: 'MOTD', value: 'New' }],
  'MOTD changes should clearly require a server restart.'
);

assert.deepEqual(
  JSON.parse(JSON.stringify(test.parsePlayerPositionSnbt('[12.5d, 64.0d, -8.25d]'))),
  { x: 12.5, y: 64, z: -8.25 },
  'player coordinates should parse from Minecraft SNBT'
);
const parsedInventory = JSON.parse(JSON.stringify(test.parsePlayerInventorySnbt('[{Slot: 0b, id: "minecraft:diamond_sword", count: 1}, {Count: 64b, Slot: 12b, id: "minecraft:stone"}, {Slot: -106b, id: "minecraft:shield", count: 1}]')));
assert.deepEqual(parsedInventory, [
  { id: 'minecraft:shield', name: 'Shield', count: 1, slot: -106, section: 'offhand', index: 0 },
  { id: 'minecraft:diamond_sword', name: 'Diamond Sword', count: 1, slot: 0, section: 'hotbar', index: 0 },
  { id: 'minecraft:stone', name: 'Stone', count: 64, slot: 12, section: 'inventory', index: 3 }
], 'player inventory should parse modern and legacy item counts');
const modern262Equipment = JSON.parse(JSON.stringify(test.parsePlayerInventorySnbt('[{Slot: 103b, id: "minecraft:diamond_helmet", count: 1}, {Slot: 102b, id: "minecraft:diamond_chestplate", count: 1, components: {"minecraft:enchantments": {levels: {"minecraft:protection": 4}}}}, {Slot: 101b, id: "minecraft:diamond_leggings", count: 1}, {Slot: 100b, id: "minecraft:diamond_boots", count: 1}, {Slot: -106b, id: "minecraft:shield", count: 1}]')));
assert.deepEqual(modern262Equipment.map(({ id, section, index }) => ({ id, section, index })), [
  { id: 'minecraft:shield', section: 'offhand', index: 0 },
  { id: 'minecraft:diamond_boots', section: 'armor', index: 3 },
  { id: 'minecraft:diamond_leggings', section: 'armor', index: 2 },
  { id: 'minecraft:diamond_chestplate', section: 'armor', index: 1 },
  { id: 'minecraft:diamond_helmet', section: 'armor', index: 0 }
], 'Minecraft 26.2 armor and offhand slots should map to their inventory positions');
const current262Equipment = JSON.parse(JSON.stringify(test.parsePlayerEquipmentSnbt('{feet: {id: "minecraft:diamond_boots", count: 1}, legs: {id: "minecraft:diamond_leggings", count: 1}, chest: {id: "minecraft:diamond_chestplate", count: 1, components: {"minecraft:enchantments": {levels: {"minecraft:protection": 4}}}}, head: {id: "minecraft:diamond_helmet", count: 1}, offhand: {id: "minecraft:shield", count: 1}}')));
assert.deepEqual(current262Equipment.map(({ id, section, index }) => ({ id, section, index })), [
  { id: 'minecraft:shield', section: 'offhand', index: 0 },
  { id: 'minecraft:diamond_boots', section: 'armor', index: 3 },
  { id: 'minecraft:diamond_leggings', section: 'armor', index: 2 },
  { id: 'minecraft:diamond_chestplate', section: 'armor', index: 1 },
  { id: 'minecraft:diamond_helmet', section: 'armor', index: 0 }
], 'Minecraft 26.2 equipment compound should expose armor and offhand items');
const merged262Equipment = JSON.parse(JSON.stringify(test.mergePlayerInspectionItems(
  test.parsePlayerInventorySnbt('[{Slot: 0b, id: minecraft:diamond_sword, count: 1}, {Slot: -106b, id: minecraft:old_shield, count: 1}]'),
  test.parsePlayerEquipmentSnbt('{offhand: {id: minecraft:shield, count: 1}}')
)));
assert.deepEqual(merged262Equipment.map(({ id, section }) => ({ id, section })), [
  { id: 'minecraft:shield', section: 'offhand' },
  { id: 'minecraft:diamond_sword', section: 'hotbar' }
], 'current equipment data should replace stale legacy equipment slots without duplicating them');
for (const [input, expected] of [['20.0f', 20], ['17', 17], ['0.75f', 0.75], ['-2s', -2]]) {
  assert.equal(test.parsePlayerScalarSnbt(input), expected, `player scalar should parse ${input}`);
}
assert.equal(test.parsePlayerScalarSnbt('not-a-number'), null);
const normalizedStats = JSON.parse(JSON.stringify(test.normalizePlayerStatistics({ stats: {
  'minecraft:custom': { 'minecraft:play_time': 72000, 'minecraft:jump': 42, invalid: -1 },
  'minecraft:mined': { 'minecraft:stone': 123 },
  malformed: ['ignored']
} })));
assert.equal(normalizedStats.totalEntries, 3);
assert.deepEqual(normalizedStats.categories.map(category => category.id), ['minecraft:custom', 'minecraft:mined']);
assert.equal(normalizedStats.categories[0].entries[0].id, 'minecraft:play_time');

assert.equal(
  test.getPlatformInstallRequestKey({ type: 'Paper', version: '1.21.11' }),
  test.getPlatformInstallRequestKey({ type: 'paper', version: '1.21.11' })
);
assert.notEqual(
  test.getPlatformInstallRequestKey({ type: 'paper', version: '1.21.11' }),
  test.getPlatformInstallRequestKey({ type: 'fabric', version: '1.21.11' })
);
assert.deepEqual(JSON.parse(JSON.stringify(test.resolvePlatformInstallTarget({}, {
  requestedServerType: 'paper', requestedServerVersion: '1.21.11', serverType: 'vanilla', serverVersion: '1.21.10'
}))), { type: 'paper', version: '1.21.11' });
assert.deepEqual(JSON.parse(JSON.stringify(test.resolvePlatformInstallTarget({ type: 'fabric', version: '1.21.12' }, {
  requestedServerType: 'paper', requestedServerVersion: '1.21.11', serverType: 'vanilla', serverVersion: '1.21.10'
}))), { type: 'fabric', version: '1.21.12' });

assert.equal(test.canMarkServerReady(false, true, true, 'starting', false), true);
assert.equal(test.canMarkServerReady(false, true, true, 'stopping', true), false);
assert.equal(test.canMarkServerReady(false, true, true, 'starting', true), false);
assert.equal(test.canMarkServerReady(true, true, true, 'starting', false), false);
assert.equal(test.isServerRuntimeReady({}, 'running', 4, 4), true);
assert.equal(test.isServerRuntimeReady({}, 'starting', 4, 4), false);
assert.equal(test.isServerRuntimeReady({}, 'running', 3, 4), false);
assert.equal(test.isServerRuntimeReady(null, 'running', 4, 4), false);

const serverInputWrites = [];
assert.equal(test.tryWriteServerInput({ stdin: {
  writable: true,
  destroyed: false,
  writableEnded: false,
  write: (value) => serverInputWrites.push(value)
} }, 'gamerule keepInventory true'), true);
assert.deepEqual(serverInputWrites, ['gamerule keepInventory true\n']);
assert.equal(test.tryWriteServerInput({ stdin: {
  writable: true,
  destroyed: false,
  writableEnded: false,
  write: () => { throw new Error('closed'); }
} }, 'gamerule keepInventory true'), false);
assert.equal(test.tryWriteServerInput({ stdin: { writable: true, destroyed: false, writableEnded: true } }, 'help'), false);

assert.equal(test.isServerReadyOutput('[Server thread/INFO]: Done (38.937s)! For help, type "help"'), true);
assert.equal(test.isServerReadyOutput('[Server thread/INFO]: Starting Minecraft server on *:25565'), false);
assert.match(test.summarizeServerStartupFailure('FAILED TO BIND TO PORT\nPerhaps a server is already running', null, 1, null, { port: 25570 }), /25570.*already in use/);
assert.match(test.summarizeServerStartupFailure('OutOfMemoryError', null, 1, null, {}), /memory/i);

assert.equal(test.usesRegistryGameRules('26.2'), true);
assert.equal(test.usesRegistryGameRules('1.21.11'), true);
assert.equal(test.usesRegistryGameRules('1.21.10'), false);
assert.deepEqual(JSON.parse(JSON.stringify(test.getGameRuleCommandCandidates('doInsomnia', true, '26.2'))), [
  { gamerule: 'spawn_phantoms', value: 'true' },
  { gamerule: 'doInsomnia', value: 'true' }
]);
assert.deepEqual(JSON.parse(JSON.stringify(test.getGameRuleCommandCandidates('announceAdvancements', false, '26.2'))), [
  { gamerule: 'show_advancement_messages', value: 'false' },
  { gamerule: 'announceAdvancements', value: 'false' }
]);
assert.deepEqual(JSON.parse(JSON.stringify(test.getGameRuleCommandCandidates('doFireTick', true, '26.2'))), [
  { gamerule: 'fire_spread_radius_around_player', value: '128' },
  { gamerule: 'doFireTick', value: 'true' }
]);
assert.deepEqual(JSON.parse(JSON.stringify(test.getGameRuleCommandCandidates('spawnRadius', 12, '1.21.10'))), [
  { gamerule: 'spawnRadius', value: '12' },
  { gamerule: 'respawn_radius', value: '12' }
]);

const playerChunkA = test.consumePlayerLogChunk('', '[Server thread/INFO]: Alex joined');
assert.equal(playerChunkA.lines.length, 0);
const playerChunkB = test.consumePlayerLogChunk(playerChunkA.remainder, ' the game\n[Server thread/INFO]: Alex left the game\n');
assert.equal(playerChunkB.remainder, '');
assert.equal(playerChunkB.lines.length, 2);
const timeline = test.appendPlayerHistoryEvent([], { type: 'joined', timestamp: '2026-10-02T10:00:00.000Z' });
assert.equal(timeline.length, 1);
assert.equal(timeline[0].type, 'joined');
assert.deepEqual(JSON.parse(JSON.stringify(test.flattenPlayerHistoryEvents([
  { name: 'Alex', events: [{ type: 'joined', timestamp: '2026-10-02T10:00:00.000Z' }, { type: 'left', timestamp: '2026-10-02T10:05:00.000Z' }] },
  { name: 'Steve', events: [{ type: 'kicked', timestamp: '2026-10-02T10:03:00.000Z', reason: 'Packet rate' }] }
]))), [
  { name: 'Alex', type: 'left', event: 'left', timestamp: '2026-10-02T10:05:00.000Z', reason: '', expiresAt: '' },
  { name: 'Steve', type: 'kicked', event: 'kicked', timestamp: '2026-10-02T10:03:00.000Z', reason: 'Packet rate', expiresAt: '' },
  { name: 'Alex', type: 'joined', event: 'joined', timestamp: '2026-10-02T10:00:00.000Z', reason: '', expiresAt: '' }
]);
assert.equal(test.parseBanExpiry('2026-10-03T10:00:00.000Z', Date.parse('2026-10-02T10:00:00.000Z')).temporary, true);
assert.equal(test.parseBanExpiry('forever').temporary, false);
assert.doesNotMatch(test.buildAssemblyTempBanReason(Date.now() + 60_000, ''), /Assembly/);
assert.equal(test.normalizeTempBanDurationMs(60_000), 60_000);
assert.equal(test.normalizeTempBanDurationMs(90_000), 90_000);
assert.equal(test.normalizeTempBanDurationMs(999_999_999_999), 525_600 * 60_000);
assert.throws(() => test.normalizeTempBanDurationMs(59_999), /at least 1 minute/);
assert.equal(test.getTempBanTimerDelay(1_000_000, 0), 1_000_000);
assert.equal(test.getTempBanTimerDelay(9_999_999_999, 0), 2_147_000_000);

for (const profileId of ['Server-2', 'a_b']) assert.equal(test.isSafeProfileId(profileId), true);
for (const profileId of ['', 'default', '.', '..', '../outside', 'a/b', 'a\\b', 'CON', 'COM1', 'a'.repeat(65)]) {
  assert.equal(test.isSafeProfileId(profileId), false, `Unsafe profile id accepted: ${JSON.stringify(profileId)}`);
}
const normalizedProfiles = test.normalizeProfilesState({
  activeProfileId: '../outside',
  profiles: [
    { id: '../outside', name: 'Bad' },
    { id: 'Server-2', name: '  Main  ' },
    { id: 'Server-2', name: 'Duplicate' },
    { id: 'default', name: 'Legacy' },
    { id: 'a_b', name: '' }
  ]
});
assert.deepEqual(JSON.parse(JSON.stringify(normalizedProfiles)), {
  activeProfileId: 'Server-2',
  profiles: [{ id: 'Server-2', name: 'Main' }, { id: 'a_b', name: 'a_b' }]
});

const containmentRoot = path.join(__dirname, 'work', 'containment-root');
assert.equal(test.resolveContainedPath(containmentRoot, path.join(containmentRoot, 'nested', 'child')), path.resolve(containmentRoot, 'nested', 'child'));
assert.throws(() => test.resolveContainedPath(containmentRoot, containmentRoot), /outside the managed/);
assert.throws(() => test.resolveContainedPath(containmentRoot, path.join(containmentRoot, '..', 'outside')), /outside the managed/);
assert.throws(() => test.resolveContainedPath(containmentRoot, `${containmentRoot}-evil`), /outside the managed/);

const goodSha256 = 'a'.repeat(64);
assert.equal(test.parseSha256Digest(`sha256:${goodSha256}`), goodSha256);
for (const digest of ['', goodSha256, `sha1:${'a'.repeat(40)}`, `sha256:${'g'.repeat(64)}`]) {
  assert.equal(test.parseSha256Digest(digest), '');
}
assert.deepEqual(JSON.parse(JSON.stringify(test.validatePlayitAssetMetadata({
  browser_download_url: 'https://github.com/playit-cloud/playit-agent/releases/download/test/playit.exe',
  digest: `sha256:${goodSha256}`,
  size: 4_000_000
}))), { sha256: goodSha256, size: 4_000_000 });
for (const asset of [
  { browser_download_url: 'https://github.com/file.exe', digest: '', size: 100 },
  { browser_download_url: 'https://github.com/file.exe', digest: `sha256:${goodSha256}`, size: 0 },
  { browser_download_url: 'https://github.com/file.exe', digest: `sha256:${goodSha256}`, size: 65 * 1024 * 1024 }
]) assert.throws(() => test.validatePlayitAssetMetadata(asset), /integrity metadata/);

const validAuthenticode = test.parseAuthenticodeResult({
  Status: 'Valid', StatusMessage: 'Signature verified.', Subject: 'CN=Playit Publisher', Thumbprint: 'A'.repeat(40)
});
assert.equal(validAuthenticode.status, 'Valid');
for (const result of [
  {},
  { Status: 'NotSigned', Subject: 'CN=Playit Publisher', Thumbprint: 'A'.repeat(40) },
  { Status: 'Valid', Subject: '', Thumbprint: 'A'.repeat(40) },
  { Status: 'Valid', Subject: 'CN=Playit Publisher', Thumbprint: 'nope' }
]) assert.throws(() => test.parseAuthenticodeResult(result), /Authenticode verification/);

assert.equal(test.isProtectionRuntimeReady({ jarExists: true, compatible: true, verified: true, ready: true }), true);
assert.equal(test.isProtectionRuntimeReady({ jarExists: true, compatible: true, verified: false, ready: false }), false);
assert.equal(test.isProtectionRuntimeReady({ jarExists: true, compatible: false, verified: true, ready: false }), false);
const normalizedProtection = test.normalizeProtectionConfig({
  preset: 'strict', enabled: true,
  layers: { builtIn: false, antiXray: true, espMitigation: true, grim: true },
  checks: { speed: false, reach: true, madeUpCheck: true },
  escalation: {
    enabled: true, preThresholdAction: 'log', decayHours: 99999,
    steps: [
      { offense: 4, action: 'ban' },
      { offense: 2, action: 'temp-ban', durationMinutes: 60 },
      { offense: 2, action: 'kick' },
      { offense: 3, action: 'not-real' }
    ]
  }
});
assert.equal(normalizedProtection.preset, 'strict');
assert.equal(normalizedProtection.version, 6);
assert.equal(test.normalizeProtectionConfig({}).checks.phase, false);
assert.equal(test.normalizeProtectionConfig({}).checks.groundSpoof, true);
assert.equal(test.normalizeProtectionConfig({}).checks.timer, true);
assert.equal(test.normalizeProtectionConfig({}).checks.criticals, false);
assert.equal(test.normalizeProtectionConfig({}).checks.multiBreak, false);
assert.equal(test.normalizeProtectionConfig({ preset: 'compatibility' }).checks.timer, false);
for (const conservative of ['groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow', 'criticals', 'scaffold', 'multiBreak']) {
  assert.equal(test.normalizeProtectionConfig({ preset: 'compatibility' }).checks[conservative], false,
    `compatibility preset should disable ${conservative}`);
}
assert.equal(test.normalizeProtectionConfig({ preset: 'strict' }).checks.phase, true);
assert.equal(test.normalizeProtectionConfig({ preset: 'strict' }).checks.multiBreak, true);
assert.equal(normalizedProtection.layers.builtIn, false);
assert.equal(Object.hasOwn(normalizedProtection.layers, 'grim'), false);
assert.deepEqual(Object.keys(normalizedProtection.layers).sort(), ['antiXray', 'builtIn', 'espMitigation']);
assert.equal(normalizedProtection.layers.espMitigation, false,
  'managed PvP servers must preserve vanilla player and nametag visibility');
assert.equal(normalizedProtection.checks.speed, false);
assert.equal(Object.hasOwn(normalizedProtection.checks, 'madeUpCheck'), false);
assert.equal(normalizedProtection.escalation.preThresholdAction, 'log');
assert.equal(normalizedProtection.escalation.decayHours, 8760);
assert.deepEqual(JSON.parse(JSON.stringify(normalizedProtection.escalation.steps)), [
  { offense: 2, action: 'kick', durationMinutes: 0 },
  { offense: 3, action: 'temp-ban', durationMinutes: 60 },
  { offense: 4, action: 'ban', durationMinutes: 0 }
]);
const protectionYaml = test.renderBundledProtectionConfig(normalizedProtection);
assert.match(protectionYaml, /preset: strict/);
assert.match(protectionYaml, /enabled: false/);
assert.match(protectionYaml, /speed: false/);
const strictProtectionYaml = test.renderBundledProtectionConfig(test.normalizeProtectionConfig({ preset: 'strict' }));
assert.match(strictProtectionYaml, /groundSpoof: true/);
assert.match(strictProtectionYaml, /criticals: true/);
assert.match(strictProtectionYaml, /multiBreak: true/);
const expectedProtectionChecks = [
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak',
  'chatSpam', 'commandSpam', 'inventorySpam'
];
for (const check of expectedProtectionChecks) {
  assert.match(strictProtectionYaml, new RegExp(`\\s${check}: true(?:\\r?\\n|$)`),
    `Paper YAML should render strict ${check}`);
}
assert.match(protectionYaml, /violation-decay: 0\.08/);
assert.match(protectionYaml, /kickOffenses: 2/);
assert.match(protectionYaml, /offenseDecayHours: 8760/);
assert.match(protectionYaml, /messages:\n  warning:/);
assert.match(protectionYaml, /entityEsp:\n    enabled: false/);
assert.doesNotMatch(protectionYaml, /Click Interval Protection: suspicious activity/);
const exemptionProtection = test.normalizeProtectionConfig({ exemptions: { owners: true, admins: false, players: ['Trusted_Admin', '../bad', 'trusted_admin'] } });
assert.deepEqual(JSON.parse(JSON.stringify(exemptionProtection.exemptions)), { owners: true, admins: false, players: ['trusted_admin'] });
assert.match(test.renderBundledProtectionConfig(exemptionProtection), /exempt-players:\n  - "trusted_admin"/);
const customizedProtection = test.normalizeProtectionConfig({
  messages: {
    warningCooldownSeconds: 27,
    banSource: 'My server',
    checks: { reach: { text: 'Reach warning: {reason}', color: '#123abc' } }
  },
  tuning: {
    minimumTps: 16.5,
    response: { alertVl: 12, kickVl: 20, actionCooldownSeconds: 4, violationDecay: 0.25 },
    reach: { geometryAllowance: 0.08, consecutiveSamples: 3, evidenceWindowMillis: 1750 },
    limits: { maxReach: 3.8, maxCps: 24 },
    grace: { joinSeconds: 6, teleportSeconds: 5, velocitySeconds: 4 }
  }
});
const customizedYaml = test.renderBundledProtectionConfig(customizedProtection);
assert.match(customizedYaml, /warningCooldownSeconds: 27/);
assert.match(customizedYaml, /banSource: "My server"/);
assert.match(customizedYaml, /reach:\n        text: "Reach warning: \{reason\}"\n        color: "#123abc"/);
assert.match(customizedYaml, /alertVl: 12/);
assert.match(customizedYaml, /kickVl: 20/);
assert.match(customizedYaml, /minimum-tps: 16\.5/);
assert.match(customizedYaml, /geometryAllowance: 0\.08/);
assert.match(customizedYaml, /consecutiveSamples: 3/);
assert.match(customizedYaml, /evidenceWindowMillis: 1750/);
assert.match(customizedYaml, /maxReach: 3\.8/);
assert.match(customizedYaml, /maxCps: 24/);
const policyProtection = test.normalizeProtectionConfig({
  compatibility: {
    playerOverrides: {
      Alex: { presets: ['mouse-tweaks'] },
      Sorter: { presets: ['quick-inventory'] },
      Fighter: { exemptChecks: ['combat.autoClicker'] }
    }
  },
  modPolicy: { enabled: true, enforcement: 'kick', allowed: ['mouse-tweaks'], blocked: ['xray'] }
});
const policyYaml = test.renderBundledProtectionConfig(policyProtection);
assert.match(policyYaml, /compatibility:/);
assert.match(policyYaml, /"alex":/);
assert.match(policyYaml, /exemptChecks: \["abuse\.inventorySpam"\]/);
assert.match(policyYaml, /allowed: \["mouse-tweaks"\]/);
assert.match(policyYaml, /blocked: \["xray"\]/);
const fabricPolicyYaml = test.renderFabricProtectionConfig(policyProtection);
const strictFabricYaml = test.renderFabricProtectionConfig(test.normalizeProtectionConfig({ preset: 'strict' }));
for (const check of expectedProtectionChecks) {
  assert.match(strictFabricYaml, new RegExp(`\\s${check}: true(?:\\r?\\n|$)`),
    `Fabric YAML should render strict ${check}`);
}
assert.match(fabricPolicyYaml, /check-exemptions:/);
assert.match(fabricPolicyYaml, /autoClicker: \["fighter"\]/);
assert.match(fabricPolicyYaml, /inventorySpam: \["alex", "sorter"\]/);
assert.doesNotMatch(fabricPolicyYaml, /inventorySpam: \[[^\]]*fighter/);
assert.match(fabricPolicyYaml, /modPolicy:/);
assert.match(fabricPolicyYaml, /  enforcement: kick/);
assert.match(fabricPolicyYaml, /  allowed: \["mouse-tweaks"\]/);
assert.match(fabricPolicyYaml, /  blocked: \["xray"\]/);
assert.match(fabricPolicyYaml, /inventoryEvidenceSamples: 3/);
assert.match(fabricPolicyYaml, /maxInventoryBurstPacketsPerSecond: 120/);
assert.equal(test.normalizeCompatibilityCheck('inventorySpam'), 'abuse.inventorySpam');
assert.equal(test.normalizeCompatibilityCheck('combat.autoClicker'), 'combat.autoClicker');
assert.throws(() => test.normalizeCompatibilityCheck('all'), /Unknown protection check/);
const uiPolicy = test.protectionPolicyForUi(policyProtection);
assert.deepEqual(JSON.parse(JSON.stringify(uiPolicy.allowedMods)), [{ modId: 'mouse-tweaks' }]);
assert.deepEqual(JSON.parse(JSON.stringify(uiPolicy.blockedMods)), [{ modId: 'xray' }]);
assert.equal(uiPolicy.playerExceptions[0].player, 'alex');
assert.equal(test.getExpectedAntiCheatKind('paper'), 'plugins');
assert.equal(test.getExpectedAntiCheatKind('fabric'), 'mods');
assert.equal(test.getExpectedAntiCheatKind('vanilla'), '');
assert.equal(test.isAntiCheatDescriptorCompatible('plugin.yml', 'paper'), true);
assert.equal(test.isAntiCheatDescriptorCompatible('plugin.yml', 'fabric'), false);
assert.equal(test.isAntiCheatDescriptorCompatible('fabric.mod.json', 'fabric'), true);
assert.equal(test.isBundledProtectionRuntimeCompatible('paper', {
  jarExists: true, compatible: true, verified: true, ready: true
}, test.getBundledProtectionAdapter('paper', '26.3')), true);
assert.equal(test.isBundledProtectionRuntimeCompatible('paper', {
  jarExists: true, compatible: true, verified: false, ready: false
}, test.getBundledProtectionAdapter('paper', '26.3')), false);
assert.equal(test.isBundledProtectionRuntimeCompatible('paper', {
  jarExists: false, compatible: true, verified: true, ready: false
}, test.getBundledProtectionAdapter('paper', '26.3')), false);
assert.equal(test.isBundledProtectionRuntimeCompatible('fabric', {
  minecraftVersion: '26.3', jarExists: true, compatible: true, verified: true, ready: true
}, test.getBundledProtectionAdapter('fabric', '26.3')), true);
assert.equal(test.isBundledProtectionRuntimeCompatible('fabric', {
  minecraftVersion: '26.2', jarExists: true, compatible: true, verified: true, ready: true
}, test.getBundledProtectionAdapter('fabric', '26.2')), true);
assert.equal(test.isBundledProtectionRuntimeCompatible('fabric', {
  minecraftVersion: '26.2', jarExists: true, compatible: true, verified: true, ready: true
}, test.getBundledProtectionAdapter('fabric', '26.3')), false);
assert.deepEqual(JSON.parse(JSON.stringify(test.getPardonCommands('Steve_1'))), ['pardon Steve_1', 'serverprotection pardon Steve_1']);
assert.throws(() => test.getPardonCommands('Steve; stop'), /Invalid player name/);
assert.throws(() => test.validateZipEntryName('../evil.class'), /traversal/);
assert.throws(() => test.validateZipEntryName('folder\\evil.class'), /unsafe/);

const protectionEvent = test.parseProtectionIncidentLine(
  '[12:00:00 INFO]: [ServerProtection] EVENT {"player":"Steve","uuid":"123e4567-e89b-12d3-a456-426614174000","check":"movement.speed","category":"movement","action":"temp_ban","reason":"Speed exceeded","violations":12.5,"offenseCount":2,"timestamp":"2026-10-02T10:00:00.000Z","durationSeconds":1800}'
);
assert(protectionEvent);
assert.equal(protectionEvent.player, 'Steve');
assert.equal(protectionEvent.check, 'movement.speed');
assert.equal(protectionEvent.action, 'temp-ban');
assert.equal(protectionEvent.durationMs, 1_800_000);
assert.equal(protectionEvent.offenses, 2);
assert.equal(protectionEvent.source, 'server-protection');
for (const check of [
  'movement.invalidPosition',
  'combat.wallHit',
  'combat.multiTarget',
  'world.hiddenOre',
  'compatibility.modPolicy'
]) {
  assert(test.normalizeProtectionIncidentEvent({ player: 'Steve', check, action: 'detect' }), `${check} event was rejected`);
}
// Existing servers may still emit the old prefix until their next protected restart.
const splitPayload = '[ClickIntervalAC] EVENT {"player":"Alex","check":"combat.reach","action":"kick","violations":9,"offenseCount":1,"timestamp":"2026-10-02T10:01:00.000Z"}';
const firstChunk = test.consumeProtectionLogChunk('', splitPayload.slice(0, 50));
assert.equal(firstChunk.incidents.length, 0);
assert(firstChunk.remainder.length > 0);
const secondChunk = test.consumeProtectionLogChunk(firstChunk.remainder, `${splitPayload.slice(50)}\n`);
assert.equal(secondChunk.remainder, '');
assert.equal(secondChunk.incidents.length, 1);
assert.equal(secondChunk.incidents[0].player, 'Alex');
const mergedIncidents = test.mergeProtectionIncidentHistory([protectionEvent], [protectionEvent, secondChunk.incidents[0], secondChunk.incidents[0]], 10);
assert.equal(mergedIncidents.added.length, 1);
assert.equal(mergedIncidents.incidents.length, 2);
assert.equal(test.parseProtectionIncidentLine('[ServerProtection] EVENT {"player":"../bad"}'), null);
assert.equal(test.normalizeProtectionIncidentEvent({ player: 'Steve', check: 'movement.unknown', action: 'kick' }), null);
assert.equal(test.isRecordedLegacyProtectionInstall({ source: 'modrinth', projectId: 'LJNGWSvH', kind: 'plugins' }), true);
assert.equal(test.isRecordedLegacyProtectionInstall({ source: 'modrinth', projectId: 'LJNGWSvH', kind: 'mods' }), true);
assert.equal(test.isRecordedLegacyProtectionInstall({ source: 'modrinth', projectId: 'other', file: 'legacy.jar', kind: 'plugins' }), false);
assert.equal(test.isRecordedLegacyProtectionInstall({ source: 'imported', projectId: 'LJNGWSvH', kind: 'plugins' }), false);

const yaml = [
  '_version: 31',
  'anticheat:',
  '  obfuscation:',
  '    items: true',
  '  anti-xray:',
  '    enabled: false',
  '    engine-mode: 1',
  'chunks:',
  '  auto-save-interval: default'
].join('\n');
const patched = test.replacePaperAntiXrayBlock(yaml, test.renderPaperAntiXrayBlock(3, false));
assert.match(patched, /_version: 31/);
assert.match(patched, /obfuscation:\n    items: true/);
assert.match(patched, /anti-xray:\n    enabled: true\n    engine-mode: 3/);
assert.match(patched, /^    max-block-height: 320$/m,
  'new managed Paper Anti-Xray blocks should cover the modern Overworld build height');
assert.match(patched, /chunks:\n  auto-save-interval: default/);
assert.equal((patched.match(/anti-xray:/g) || []).length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(test.inspectPaperAntiXrayBlock(patched))), { enabled: true, engineMode: 3 });
const disabledPatch = test.replacePaperAntiXrayBlock(patched, test.renderPaperAntiXrayBlock(3, false, false));
assert.match(disabledPatch, /anti-xray:\n    enabled: false\n    engine-mode: 3/);
assert.match(disabledPatch, /obfuscation:\n    items: true/);
assert.match(disabledPatch, /chunks:\n  auto-save-interval: default/);
assert.equal((disabledPatch.match(/anti-xray:/g) || []).length, 1);
assert.deepEqual(JSON.parse(JSON.stringify(test.inspectPaperAntiXrayBlock(disabledPatch))), { enabled: false, engineMode: 3 });

const legacyPaperYaml = [
  '_version: 31',
  'anticheat: # retain section note',
  '  anti-xray: # retain provider note',
  '    enabled: true # retain enabled note',
  '    engine-mode: 3',
  '    max-block-height: "128" # legacy managed ceiling',
  '    custom-paper-option: preserve-me',
  'chunks:',
  '  max-auto-save-chunks-per-tick: 24',
  'unrelated:',
  '    max-block-height: 64'
].join('\r\n') + '\r\n';
const migratedPaperYaml = test.migratePaperAntiXrayMaxBlockHeight(legacyPaperYaml);
assert.match(migratedPaperYaml, /^    max-block-height: "320" # legacy managed ceiling\r$/m,
  'the legacy managed Paper ceiling should migrate while retaining quoting and its inline comment');
assert.match(migratedPaperYaml, /^    custom-paper-option: preserve-me\r$/m,
  'Paper height migration should preserve unrelated Anti-Xray settings');
assert.match(migratedPaperYaml, /^    max-block-height: 64\r$/m,
  'Paper height migration should not modify similarly named keys outside anticheat.anti-xray');
assert.equal(test.migratePaperAntiXrayMaxBlockHeight(migratedPaperYaml), migratedPaperYaml,
  'Paper height migration should be byte-idempotent after the ceiling is current');
const higherPaperYaml = legacyPaperYaml.replace('"128"', '352');
assert.equal(test.migratePaperAntiXrayMaxBlockHeight(higherPaperYaml), higherPaperYaml,
  'Paper height migration should preserve an explicit ceiling that already covers the managed range');

const wrongModrinth = [{
  id: 'wrong', game_versions: ['1.20.1'], loaders: ['fabric'], environment: 'server_only', version_type: 'release',
  files: [{ filename: 'wrong.jar', primary: true, url: 'https://cdn.modrinth.com/wrong.jar', hashes: {} }]
}];
assert.equal(test.chooseModrinthFile(wrongModrinth, 'mods', '1.21.8', 'fabric'), null);
const rightModrinth = [{
  id: 'right', game_versions: ['1.21.8'], loaders: ['fabric'], environment: 'server_only', version_type: 'release',
  files: [{ filename: 'right.jar', primary: true, url: 'https://cdn.modrinth.com/right.jar', hashes: {} }]
}];
assert.equal(test.chooseModrinthFile(rightModrinth, 'mods', '1.21.8', 'fabric').file.filename, 'right.jar');

const curseFiles = [
  { id: 1, fileName: 'forge.jar', gameVersions: ['1.21.8', 'Forge'], releaseType: 1, isAvailable: true },
  { id: 2, fileName: 'fabric.jar', gameVersions: ['1.21.8', 'Fabric'], releaseType: 1, isAvailable: true }
];
assert.equal(test.chooseCurseForgeFile(curseFiles, 'mods', '1.21.8', 'fabric').id, 2);
assert.equal(test.chooseCurseForgeFile(curseFiles, 'mods', '1.20.1', 'fabric'), null);
assert.deepEqual(JSON.parse(JSON.stringify(test.getServerTypeAddonSupport('paper'))), {
  type: 'paper', mods: [], plugins: ['paper', 'bukkit']
});

for (const channel of [
  'server:installPlatform', 'server:platformStatus', 'addons:getCurseForgeKeyStatus',
  'addons:checkUpdate', 'addons:updateInstalled', 'links:openServerAddons',
  'addons:setCurseForgeApiKey', 'security:getStatus', 'security:applyPreset',
  'security:applyAntiXray', 'security:removeLegacyProtection',
  'server:selectIcon', 'server:removeIcon',
  'protection:getConfig', 'protection:saveConfig', 'protection:getModPolicy', 'protection:addModPolicyRule',
  'protection:removeModPolicyRule', 'protection:addPlayerModException', 'protection:removePlayerModException',
  'protection:getHistory', 'protection:clearHistory',
  'protection:installBundled', 'protection:importCustom', 'protection:listCustom', 'protection:removeCustom'
]) {
  assert(ipcHandlers.has(channel), `Missing IPC handler: ${channel}`);
}
assert.equal(ipcHandlers.has('security:installAntiCheat'), false);
assert.equal(ipcHandlers.has('security:removeAntiCheat'), false);
assert.equal(source.includes("sendServerCommand('ciac reload')"), false);
assert.equal(source.includes("reloadCommand: 'serverprotection reload'"), true);
assert.equal(source.includes('reloadBundledProtectionRuntime(adapter)'), true);
assert.equal(source.includes("sendServerCommand(adapter.reloadCommand || 'serverprotection reload')"), true);
assert.equal(source.includes('observeProtectionRuntimeOutputLine(line, runtimeContext)'), true);

function makeStoredJar(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const [name, rawValue] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const value = Buffer.from(rawValue, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(value.length, 18);
    local.writeUInt32LE(value.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, value);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(value.length, 20);
    central.writeUInt32LE(value.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + value.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

async function runProtectionJarEvidenceTests() {
  const fixtureRoot = path.join(__dirname, 'work', `backend-protection-jar-fixture-${process.pid}`);
  await fs.promises.mkdir(fixtureRoot, { recursive: true });
  try {
    const pluginJar = path.join(fixtureRoot, 'plugin.jar');
    await fs.promises.writeFile(pluginJar, makeStoredJar({ 'plugin.yml': 'name: TestAntiCheat', 'example/Main.class': 'bytes' }));
    const plugin = await test.inspectAntiCheatJar(pluginJar);
    assert.equal(plugin.kind, 'plugins');
    assert.equal(plugin.descriptor, 'plugin.yml');
    assert.equal(plugin.pluginName, 'TestAntiCheat');
    assert.match(plugin.sha256, /^[a-f0-9]{64}$/);

    const fabricJar = path.join(fixtureRoot, 'fabric.jar');
    await fs.promises.writeFile(fabricJar, makeStoredJar({ 'fabric.mod.json': '{"id":"test_ac"}' }));
    const fabric = await test.inspectAntiCheatJar(fabricJar);
    assert.equal(fabric.kind, 'mods');
    assert.equal(fabric.descriptor, 'fabric.mod.json');
    assert.equal(fabric.fabricModId, 'test_ac');

    const quiltJar = path.join(fixtureRoot, 'voicechat-quilt.jar');
    await fs.promises.writeFile(quiltJar, makeStoredJar({
      'quilt.mod.json': JSON.stringify({
        schema_version: 1,
        quilt_loader: { id: 'voicechat', version: '2.6.22+26.2' }
      })
    }));
    const quilt = await test.inspectAntiCheatJar(quiltJar);
    assert.equal(quilt.kind, 'mods');
    assert.equal(quilt.descriptor, 'quilt.mod.json');
    assert.equal(quilt.quiltModId, 'voicechat');
    assert.equal(quilt.quiltVersion, '2.6.22+26.2');
    assert.equal(test.isAntiCheatDescriptorCompatible(quilt.descriptor, 'quilt'), true);
    assert.equal(test.isAntiCheatDescriptorCompatible(quilt.descriptor, 'fabric'), false);

    const currentBundledJar = path.join(__dirname, 'minecraft-server', 'click-interval-anticheat', 'dist', 'ServerProtection.jar');
    const legacyBundledJar = path.join(__dirname, 'minecraft-server', 'click-interval-anticheat', 'dist', 'ClickIntervalAntiCheat.jar');
    const bundledJar = fs.existsSync(currentBundledJar) ? currentBundledJar : legacyBundledJar;
    if (fs.existsSync(bundledJar)) {
      const bundled = await test.inspectAntiCheatJar(bundledJar);
      assert.equal(bundled.kind, 'plugins');
      assert.equal(bundled.descriptor, 'plugin.yml');
      assert.equal(bundled.bundledProtectionIdentity, true);
      if (path.basename(bundledJar) === 'ServerProtection.jar') assert.equal(bundled.pluginName, 'ServerProtection');
      assert(bundled.size > 0);
    }

    const bundledFabricReleases = [
      {
        version: '26.2',
        directory: 'server-protection-fabric-26.2',
        artifact: 'ServerProtection-Fabric-1.3.3+mc26.2.jar'
      },
      {
        version: '26.3',
        directory: 'server-protection-fabric',
        artifact: 'ServerProtection-Fabric-1.3.0+mc26.3.jar'
      }
    ];
    for (const release of bundledFabricReleases) {
      const bundledFabricJar = path.join(
        __dirname, 'minecraft-server', release.directory, 'dist', release.artifact
      );
      if (!fs.existsSync(bundledFabricJar)) continue;
      const bundledFabric = await test.inspectAntiCheatJar(bundledFabricJar);
      const adapter = test.getBundledProtectionAdapter('fabric', release.version);
      assert.equal(bundledFabric.fabricModId, 'serverprotection_fabric');
      assert.equal(bundledFabric.fabricEnvironment, 'server');
      assert.deepEqual([...bundledFabric.fabricMainEntrypoints], ['dev.serverprotection.fabric.ServerProtectionFabric']);
      assert.equal(bundledFabric.fabricMinecraftDependency, `=${release.version}`);
      assert.equal(bundledFabric.bundledFabricProtectionIdentity, true);
      assert.equal(test.inspectionMatchesBundledProtectionAdapter(bundledFabric, adapter), true);
    }

    const missingDescriptor = path.join(fixtureRoot, 'missing.jar');
    await fs.promises.writeFile(missingDescriptor, makeStoredJar({ 'example/Main.class': 'bytes' }));
    await assert.rejects(test.inspectAntiCheatJar(missingDescriptor), /no supported .*descriptor/);

    const traversal = path.join(fixtureRoot, 'traversal.jar');
    await fs.promises.writeFile(traversal, makeStoredJar({ '../plugin.yml': 'name: Bad' }));
    await assert.rejects(test.inspectAntiCheatJar(traversal), /traversal/);
  } finally {
    await fs.promises.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runBundledProtectionMigrationTests() {
  const fixtureRoot = path.join(__dirname, 'work', `backend-protection-migration-${process.pid}`);
  const plugins = path.join(fixtureRoot, 'plugins');
  const paths = { root: fixtureRoot, plugins };
  const jarPaths = test.getBundledProtectionJarPaths(paths);
  const legacyData = path.join(plugins, 'ClickIntervalAntiCheat');
  const currentData = path.join(plugins, 'ServerProtection');
  await fs.promises.mkdir(legacyData, { recursive: true });
  await fs.promises.mkdir(currentData, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(legacyData, 'config.yml'), 'legacy-config\n');
    await fs.promises.writeFile(path.join(legacyData, 'offenses.properties'), 'legacy-offenses\n');
    await fs.promises.writeFile(path.join(currentData, 'config.yml'), 'current-config\n');
    const migration = await test.migrateLegacyBundledProtectionData(paths);
    assert.equal(migration.migrated, true);
    assert.deepEqual([...migration.files], ['offenses.properties']);
    assert.equal(await fs.promises.readFile(path.join(currentData, 'config.yml'), 'utf8'), 'current-config\n');
    assert.equal(await fs.promises.readFile(path.join(currentData, 'offenses.properties'), 'utf8'), 'legacy-offenses\n');
    assert.equal(await fs.promises.readFile(path.join(legacyData, 'offenses.properties'), 'utf8'), 'legacy-offenses\n');
    await fs.promises.writeFile(path.join(legacyData, 'offenses.properties'), 'final-legacy-offenses\n');
    const newer = new Date(Date.now() + 2000);
    await fs.promises.utimes(path.join(legacyData, 'offenses.properties'), newer, newer);
    const refreshed = await test.migrateLegacyBundledProtectionData(paths, { refreshMutable: true });
    assert.deepEqual([...refreshed.files], ['offenses.properties']);
    assert.equal(await fs.promises.readFile(path.join(currentData, 'offenses.properties'), 'utf8'), 'final-legacy-offenses\n');
    assert.equal(await fs.promises.readFile(path.join(currentData, 'config.yml'), 'utf8'), 'current-config\n');

    await fs.promises.writeFile(jarPaths.legacy, makeStoredJar({
      'plugin.yml': 'name: ClickIntervalAntiCheat',
      'com/clickinterval/anticheat/ClickIntervalAntiCheat.class': 'legacy-managed-plugin'
    }));
    const disabled = await test.disableLegacyBundledProtectionJar(paths, {});
    assert.equal(disabled.disabled, true);
    assert.equal(fs.existsSync(jarPaths.legacy), false);
    assert.equal(fs.existsSync(disabled.backup), true);
    assert.doesNotMatch(path.basename(disabled.backup), /\.jar$/i);

    await fs.promises.writeFile(jarPaths.legacy, makeStoredJar({
      'plugin.yml': 'name: UnrelatedPlugin',
      'example/Unrelated.class': 'leave-this-alone'
    }));
    await assert.rejects(test.disableLegacyBundledProtectionJar(paths, {}), /left untouched/);
    assert.equal(fs.existsSync(jarPaths.legacy), true);

    await fs.promises.writeFile(jarPaths.current, makeStoredJar({
      'plugin.yml': 'name: UserProtection',
      'example/UserProtection.class': 'do-not-replace'
    }));
    await assert.rejects(test.assertCurrentBundledProtectionJarIsReplaceable(paths, {}), /left untouched/);
    assert.equal(fs.existsSync(jarPaths.current), true);
  } finally {
    await fs.promises.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runFileEvidenceTests() {
  const fixtureRoot = path.join(__dirname, 'work', `backend-security-fixture-${process.pid}`);
  const plugins = path.join(fixtureRoot, 'plugins');
  const mods = path.join(fixtureRoot, 'mods');
  const legacyFile = path.join(plugins, 'legacy-protection-test.jar');
  const payload = Buffer.from('verified legacy protection fixture');
  const sha256 = require('crypto').createHash('sha256').update(payload).digest('hex');
  await fs.promises.mkdir(plugins, { recursive: true });
  await fs.promises.mkdir(mods, { recursive: true });
  try {
    await fs.promises.writeFile(legacyFile, payload);
    const paths = { root: fixtureRoot, plugins, mods };
    const validMetadata = {
      installedFiles: [{
        source: 'modrinth', projectId: 'LJNGWSvH', file: 'legacy-protection-test.jar', kind: 'plugins',
        gameVersion: '1.21.8', serverType: 'paper', size: payload.length, expectedHashes: { sha256 }
      }]
    };
    const valid = await test.inspectRecordedLegacyProtectionInstallation(paths, validMetadata);
    assert.equal(valid.exists, true);
    assert.equal(valid.integrityVerified, true);

    const wrongHash = await test.inspectRecordedLegacyProtectionInstallation(paths, {
      installedFiles: [{ ...validMetadata.installedFiles[0], expectedHashes: { sha256: '0'.repeat(64) } }]
    });
    assert.equal(wrongHash.exists, true);
    assert.equal(wrongHash.integrityVerified, false);

    const traversal = await test.inspectRecordedLegacyProtectionInstallation(paths, {
      installedFiles: [{ ...validMetadata.installedFiles[0], file: '../../outside.jar' }]
    });
    assert.equal(traversal.exists, false);

    await fs.promises.rm(legacyFile, { force: true });
    const deleted = await test.inspectRecordedLegacyProtectionInstallation(paths, validMetadata);
    assert.equal(deleted.exists, false);
  } finally {
    await fs.promises.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runPlatformEvidenceTests() {
  const profileId = 'Test-Server';
  const profileRoot = path.join(testUserData, 'minecraft-servers', profileId);
  const jarPath = path.join(profileRoot, 'minecraft-server.jar');
  const platformPath = path.join(profileRoot, 'assembly-platform.json');
  const jarPayload = Buffer.from('paper server jar fixture');
  const sha256 = require('crypto').createHash('sha256').update(jarPayload).digest('hex');
  await fs.promises.mkdir(profileRoot, { recursive: true });
  try {
    await fs.promises.writeFile(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
      activeProfileId: profileId,
      profiles: [{ id: profileId, name: 'Test Server' }]
    }));
    await fs.promises.writeFile(jarPath, jarPayload);
    const config = {
      levelName: 'world', serverType: 'paper', serverVersion: '1.21.8', jarPath
    };

    const unknown = await test.getServerPlatformStatus(config);
    assert.equal(unknown.installedType, 'unknown');
    assert.equal(unknown.verified, false);
    assert.equal(unknown.ready, false);

    await fs.promises.writeFile(platformPath, JSON.stringify({
      type: 'paper', minecraftVersion: '1.21.8', source: 'papermc', verified: true,
      sha256, size: jarPayload.length
    }));
    const verified = await test.getServerPlatformStatus(config);
    assert.equal(verified.compatible, true);
    assert.equal(verified.verified, true);
    assert.equal(verified.ready, true);
    const paths = {
      root: profileRoot,
      platform: platformPath,
      vanillaJar: jarPath
    };
    assert.deepEqual(JSON.parse(JSON.stringify(await test.getRecordedPlatformIdentity(paths, config))), {
      type: 'paper', version: '1.21.8', jarPath
    });
    const reconciled = await test.reconcileConfigWithInstalledPlatform({ ...config, serverType: 'fabric' }, paths);
    assert.equal(reconciled.changed, true);
    assert.equal(reconciled.config.serverType, 'paper');
    assert.equal(reconciled.config.requestedServerType, 'fabric');
    assert.equal(reconciled.config.requestedServerVersion, '1.21.8');

    const versionReconciled = await test.reconcileConfigWithInstalledPlatform({ ...config, serverVersion: '1.21.11' }, paths);
    assert.equal(versionReconciled.changed, true);
    assert.equal(versionReconciled.config.serverVersion, '1.21.8');
    assert.equal(versionReconciled.config.requestedServerVersion, '1.21.11');

    await fs.promises.writeFile(jarPath, Buffer.alloc(jarPayload.length, 0x62));
    const future = new Date(Date.now() + 2000);
    await fs.promises.utimes(jarPath, future, future);
    const changed = await test.getServerPlatformStatus(config);
    assert.equal(changed.compatible, true);
    assert.equal(changed.integrityMatches, false);
    assert.equal(changed.verified, false);
    assert.equal(changed.ready, false);
  } finally {
    await fs.promises.rm(testUserData, { recursive: true, force: true });
  }
}

async function runLifecycleHelperTests() {
  const exiting = new EventEmitter();
  exiting.exitCode = null;
  exiting.signalCode = null;
  exiting.removeListener = exiting.removeListener.bind(exiting);
  setTimeout(() => {
    exiting.exitCode = 0;
    exiting.emit('exit', 0, null);
  }, 5);
  assert.equal(await test.waitForChildExit(exiting, 100), true);

  const stuck = new EventEmitter();
  stuck.exitCode = null;
  stuck.signalCode = null;
  stuck.removeListener = stuck.removeListener.bind(stuck);
  const keepAlive = setTimeout(() => {}, 100);
  assert.equal(await test.waitForChildExit(stuck, 10), false);
  clearTimeout(keepAlive);
}

async function runSingleFlightTests() {
  const coordinator = test.createSingleFlightCoordinator('conflicting operation');
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const first = coordinator.run('paper:1.21.11', async () => {
    calls += 1;
    await gate;
    return 'installed';
  });
  const same = coordinator.run('paper:1.21.11', async () => {
    calls += 1;
    return 'duplicate';
  });
  assert.strictEqual(same, first, 'Matching concurrent operations must share one promise.');
  assert.equal(calls, 0, 'The coordinator must claim the operation before async work starts.');
  await Promise.resolve();
  assert.equal(calls, 1);
  await assert.rejects(
    coordinator.run('fabric:1.21.11', async () => {
      calls += 1;
      return 'conflict';
    }),
    /conflicting operation/
  );
  assert.equal(calls, 1, 'A conflicting operation must not start work.');
  releaseFirst();
  assert.equal(await first, 'installed');
  assert.equal(coordinator.getActiveKey(), '');
  assert.equal(await coordinator.run('fabric:1.21.11', async () => {
    calls += 1;
    return 'installed-next';
  }), 'installed-next');
  assert.equal(calls, 2, 'A new operation must be allowed after cleanup.');

  const startCoordinator = test.createSingleFlightCoordinator();
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  let starts = 0;
  const startOne = startCoordinator.run('start', async () => {
    starts += 1;
    await startGate;
    return { state: 'running' };
  });
  const startTwo = startCoordinator.run('start', async () => {
    starts += 1;
    return { state: 'duplicate' };
  });
  assert.strictEqual(startTwo, startOne, 'Concurrent starts must share one operation.');
  await Promise.resolve();
  assert.equal(starts, 1);
  releaseStart();
  assert.deepEqual(JSON.parse(JSON.stringify(await startOne)), { state: 'running' });
}

async function runProtectionStateTransactionTests() {
  const events = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const profileA = path.join(testUserData, 'Profile-A');
  const equivalentProfileA = process.platform === 'win32' ? profileA.toUpperCase() : profileA;
  const profileB = path.join(testUserData, 'Profile-B');
  const first = test.serializeProtectionStateTransaction(profileA, async () => {
    events.push('a1-start');
    await gate;
    events.push('a1-end');
  });
  const second = test.serializeProtectionStateTransaction(equivalentProfileA, async () => {
    events.push('a2-start');
    events.push('a2-end');
  });
  const independent = test.serializeProtectionStateTransaction(profileB, async () => {
    events.push('b-start');
    events.push('b-end');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.includes('a1-start'));
  assert.ok(events.includes('b-start'), 'different profiles should not block one another');
  assert.equal(events.includes('a2-start'), false, 'same-profile mutations must wait for the active transaction');
  releaseFirst();
  await Promise.all([first, second, independent]);
  assert.ok(events.indexOf('a2-start') > events.indexOf('a1-end'));

  const publishRoot = path.join(__dirname, 'work', `protection-publish-test-${process.pid}-${Date.now()}`);
  await fs.promises.mkdir(publishRoot, { recursive: true });
  try {
    const occupied = path.join(publishRoot, 'occupied.jar');
    const rejectedStage = path.join(publishRoot, 'rejected-stage.jar');
    await fs.promises.writeFile(occupied, 'existing-bytes');
    await fs.promises.writeFile(rejectedStage, 'replacement-bytes');
    await assert.rejects(test.publishStagedFileIfAbsent(rejectedStage, occupied), /changed while installation was committing/);
    assert.equal(await fs.promises.readFile(occupied, 'utf8'), 'existing-bytes',
      'exclusive publication must never overwrite a raced-in destination');
    assert.equal(await fs.promises.readFile(rejectedStage, 'utf8'), 'replacement-bytes');

    const staged = path.join(publishRoot, 'stage.jar');
    const published = path.join(publishRoot, 'published.jar');
    const bytes = Buffer.from('verified-protection-artifact');
    await fs.promises.writeFile(staged, bytes);
    await test.publishStagedFileIfAbsent(staged, published);
    assert.deepEqual(await fs.promises.readFile(published), bytes);
    assert.equal(fs.existsSync(staged), false, 'a successful exclusive publication should clean its staged name');
  } finally {
    const resolved = path.resolve(publishRoot);
    assert.ok(resolved.startsWith(path.resolve(__dirname, 'work') + path.sep));
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

Promise.all([
  runFileEvidenceTests(),
  runPlatformEvidenceTests(),
  runProtectionJarEvidenceTests(),
  runBundledProtectionMigrationTests(),
  runLifecycleHelperTests(),
  runSingleFlightTests(),
  runProtectionStateTransactionTests()
])
  .then(() => console.log('Minecraft server backend regression tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
