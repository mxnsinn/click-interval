'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  FABRIC_CHECKS,
  getProtectionCapabilities
} = require('./minecraft-server/protection-capabilities');

const root = __dirname;
const adapterRoot = path.join(root, 'minecraft-server', 'server-protection-fabric');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

function inspectZip(file) {
  const archive = fs.readFileSync(file);
  const minimumOffset = Math.max(0, archive.length - 65_557);
  let end = -1;
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  assert.notEqual(end, -1, `${file} should contain a ZIP end-of-central-directory record`);
  const entryCount = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  let cursor = archive.readUInt32LE(end + 16);
  assert.notEqual(entryCount, 0xffff, `${file} should not require ZIP64 inspection`);
  assert.ok(cursor + directorySize <= end, `${file} central directory should be bounded by the archive`);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50,
      `${file} central-directory entry ${index} should have a valid signature`);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    assert.ok(next <= end, `${file} central-directory entry ${index} should stay in bounds`);
    entries.push({
      name: archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      compression: archive.readUInt16LE(cursor + 10),
      compressedSize: archive.readUInt32LE(cursor + 20),
      size: archive.readUInt32LE(cursor + 24),
      localOffset: archive.readUInt32LE(cursor + 42)
    });
    cursor = next;
  }
  return { archive, entries };
}

function zipEntryNames(file) {
  return inspectZip(file).entries.map(entry => entry.name);
}

function readZipEntry(file, name) {
  const { archive, entries } = inspectZip(file);
  const entry = entries.find(candidate => candidate.name === name);
  assert.ok(entry, `${file} should contain ${name}`);
  assert.equal(archive.readUInt32LE(entry.localOffset), 0x04034b50,
    `${file} ${name} should have a valid local header`);
  const nameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  assert.ok(dataEnd <= archive.length, `${file} ${name} data should stay in bounds`);
  const compressed = archive.subarray(dataStart, dataEnd);
  const content = entry.compression === 0
    ? compressed
    : entry.compression === 8
      ? zlib.inflateRawSync(compressed)
      : null;
  assert.ok(content, `${file} ${name} should use a supported ZIP compression method`);
  assert.equal(content.length, entry.size, `${file} ${name} should match its declared size`);
  return content;
}

function readZipTextEntry(file, name) {
  return readZipEntry(file, name).toString('utf8');
}

const expected = [
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation',
  'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak',
  'chatSpam', 'commandSpam', 'inventorySpam'
];

assert.deepEqual(FABRIC_CHECKS, expected);
for (const version of ['26.2', '26.3']) {
  const capabilities = getProtectionCapabilities('fabric', version);
  assert.deepEqual(capabilities.supportedChecks, expected,
    `Fabric ${version} must advertise only the checks its shared adapter implements`);
  assert.equal(capabilities.nativeAntiXraySupported, false);
  assert.equal(capabilities.antiXrayDetectionSupported, true,
    `Fabric ${version} should retain concealed-ore detection as a secondary signal`);
  assert.equal(capabilities.antiXrayObfuscationSupported, true,
    `Fabric ${version} should advertise its bundled packet obfuscator`);
  assert.equal(capabilities.antiXrayMode, 'obfuscation');
}
const unsupportedFabric = getProtectionCapabilities('fabric', '26.4');
assert.equal(unsupportedFabric.antiXrayDetectionSupported, false);
assert.equal(unsupportedFabric.antiXrayObfuscationSupported, false);
assert.equal(unsupportedFabric.antiXrayMode, '');
const paperCapabilities = getProtectionCapabilities('paper', '26.3');
assert.equal(paperCapabilities.nativeAntiXraySupported, true);
assert.equal(paperCapabilities.antiXrayObfuscationSupported, false,
  'Paper native obfuscation must not be mislabeled as the bundled Fabric provider');
assert.equal(paperCapabilities.antiXrayMode, 'obfuscation');

const implementation = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'ServerProtectionFabric.java');
for (const id of [
  'movement.invalidRotation', 'movement.groundSpoof', 'movement.waterWalk', 'movement.step', 'movement.timer', 'movement.noSlow',
  'combat.aimDirection', 'combat.killAura', 'combat.clickPattern', 'combat.criticals',
  'world.fastBreak', 'world.fastPlace', 'world.breakReach', 'world.placeReach', 'world.scaffold', 'world.multiBreak',
  'abuse.chatSpam', 'abuse.commandSpam', 'abuse.inventorySpam'
]) {
  assert.match(implementation, new RegExp(id.replace('.', '\\.')),
    `missing incident/enforcement check ${id}`);
}
for (const toggle of ['invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak', 'chatSpam', 'commandSpam', 'inventorySpam']) {
  assert.match(implementation, new RegExp(`checks\\(\\)\\.${toggle}\\(\\)`),
    `runtime callback is not gated by ${toggle}`);
}
const combatAnalyzer = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'CombatAnalyzer.java');
for (const toggle of ['aimDirection', 'killAura', 'clickPattern']) {
  assert.match(combatAnalyzer, new RegExp(`checks\\(\\)\\.${toggle}\\(\\)`),
    `combat analyzer is not gated by ${toggle}`);
}
assert.match(implementation, /boolean groundSupported = hasGroundSupport\(player, supportingBoat\)/,
  'movement checks must derive support from server collision state instead of the client on-ground bit');
assert.match(implementation, /player\.verticalCollisionBelow/,
  'server collision evidence must participate in ground support');
assert.match(implementation, /player\.level\(\)\.noCollision\(player, support\)/,
  'slabs and ledges need a bounded support-box collision probe');
assert.match(implementation, /FabricLoader\.getInstance\(\)\.isModLoaded\("meowantixray"\)/,
  'the Fabric adapter should verify that its nested packet provider actually loaded');
assert.match(implementation, /ServerLifecycleEvents\.SERVER_STARTED\.register\(this::onServerStarted\)/,
  'packet-provider health must be checked after the provider has activated, not merely during server starting');
assert.match(implementation, /MeowAntiXrayMod\.fakeOre\(\)\.isEnabled\(\)/,
  'the runtime handshake must verify effective packet obfuscation instead of only checking the mod list');
assert.match(implementation, /reloadConfigWithSummary\(\)[\s\S]*antiXrayReload\.applied\(\)/,
  'live protection reload must require the packet provider to accept its configuration');
assert.match(implementation,
  /Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal\./,
  'the adapter and manager handshake need one exact packet-provider success marker');
assert.match(implementation,
  /Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated\./,
  'enabled ore protection needs an exact degraded-runtime marker when the provider is absent');

const packetMixin = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'mixin', 'ServerGamePacketListenerMixin.java');
assert.match(packetMixin, /method = "performUnsignedChatCommand"/,
  'ordinary unsigned commands need a true pre-execution rate hook');
assert.match(packetMixin, /@Redirect\(method = "performSignedChatCommand"[\s\S]*Commands;performCommand/,
  'commands with signed arguments need a policy hook after vanilla consumes their signatures');
assert.match(packetMixin,
  /@Redirect\(method = "performSignedChatCommand"[\s\S]*ServerGamePacketListenerImpl;parseCommand/,
  'managed roles must be applied before Brigadier discovers signed command arguments');
assert.doesNotMatch(packetMixin,
  /@Inject\(method = "performSignedChatCommand", at = @At\("HEAD"\), cancellable = true\)/,
  'a HEAD cancellation skips signed-argument decoding and breaks /msg, /tell, and /w chat chains');
assert.match(packetMixin, /method = "handleContainerClick"/,
  'inventory spam needs a packet-level hook');
assert.match(packetMixin, /method = "handleContainerButtonClick"/,
  'container button spam needs the same packet-level hook');
assert.match(packetMixin, /method = "handleSetCreativeModeSlot"/,
  'creative inventory spam needs the same packet-level hook');
assert.match(packetMixin, /method = "handleMovePlayer"/,
  'timer evidence needs a raw movement-packet cadence hook');
assert.match(packetMixin, /method = "handleAttack"/,
  'rejected attack attempts need a pre-vanilla combat hook');
assert.match(packetMixin, /method = "handlePlayerAction"/,
  'rejected out-of-range break attempts need a pre-vanilla block hook');

const mixins = JSON.parse(read(adapterRoot, 'src', 'main', 'resources',
  'serverprotection.fabric.mixins.json'));
assert.ok(mixins.mixins.includes('BlockItemMixin'));
assert.ok(mixins.mixins.includes('CommandsMixin'),
  'managed roles must control the command tree sent to each client');
assert.ok(mixins.mixins.includes('ServerGamePacketListenerMixin'));
for (const selectiveMixin of [
  'CreeperExplosionMixin',
  'EnderMan26_2BlockGriefingMixin',
  'Enderman26_3BlockGriefingMixin'
]) {
  assert.ok(mixins.mixins.includes(selectiveMixin),
    `${selectiveMixin} must ship for selective mob-griefing enforcement`);
}
const selectiveMobGriefing = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'SelectiveMobGriefing.java');
assert.match(implementation, /GameRules\.MOB_GRIEFING/,
  'the adapter must keep the global mob-griefing rule enabled for Villager and Piglin interactions');
assert.match(selectiveMobGriefing, /Level\.ExplosionInteraction\.NONE/,
  'Creeper explosions must retain entity effects while preserving blocks');
const breakRatePolicy = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'BreakRatePolicy.java');
assert.match(breakRatePolicy, /minecraft:sugar_cane/,
  'sugar cane must use the bounded sweep-harvest rate window');
assert.match(breakRatePolicy, /MIN_SWEEP_HARVEST_BREAKS_PER_SECOND = 40/,
  'sweep harvesting must retain a finite packet-flood ceiling');
const movementAnalyzer = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'MovementAnalyzer.java');
assert.match(implementation, /ServerLivingEntityEvents\.AFTER_DAMAGE/,
  'server-observed entity and projectile damage must grant knockback grace');
assert.match(movementAnalyzer, /sample\.forcedMovement\(\)/,
  'horizontal speed evidence must honor authoritative knockback');
assert.match(movementAnalyzer, /sample\.environmentalMovement\(\)/,
  'fluid and special-surface movement must use bounded environmental evidence');
const commandsMixin = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'mixin', 'CommandsMixin.java');
assert.match(commandsMixin, /method = "sendCommands"[\s\S]*buildCommandTree[\s\S]*ClientboundCommandsPacket/,
  'the client command tree must be deep-copied through the manager-owned role filter');
const teleportMixin = read(adapterRoot, 'src', 'main', 'java', 'dev', 'serverprotection', 'fabric',
  'mixin', 'LivingEntityTeleportMixin.java');
assert.equal(
  [...teleportMixin.matchAll(/@Group\(name = "serverProtection\$randomTeleport(?:Head|Return)", min = 1, max = 2\)/g)].length,
  4,
  '26.2 can expose both compatible randomTeleport overloads, so the grouped injections must permit both matches'
);
assert.doesNotMatch(teleportMixin, /serverProtection\$randomTeleport(?:Head|Return)", min = 1, max = 1/,
  'a one-match maximum crashes Minecraft 26.2 when both randomTeleport overloads are present');
for (const retiredVisibilityMixin of ['TrackedEntityMixin', 'TrackedEntityInvoker', 'ChunkMapAccessor']) {
  assert.equal(mixins.mixins.includes(retiredVisibilityMixin), false,
    `${retiredVisibilityMixin} must stay retired so PvP players and nametags remain vanilla-visible`);
}

const defaults = read(adapterRoot, 'src', 'main', 'resources', 'default-config.yml');
for (const field of [
  'invalidRotation:', 'groundSpoof:', 'waterWalk:', 'step:', 'timer:', 'noSlow:',
  'aimDirection:', 'killAura:', 'clickPattern:', 'criticals:',
  'fastBreak:', 'fastPlace:', 'breakReach:', 'placeReach:', 'scaffold:', 'multiBreak:', 'chatSpam:', 'commandSpam:', 'inventorySpam:',
  'maxBreaksPerSecond:', 'maxPlacesPerSecond:', 'maxChatPerFiveSeconds:',
  'maxCommandsPerFiveSeconds:', 'maxInventoryClicksPerSecond:',
  'groundSpoofSamples:', 'waterWalkSamples:', 'maxPacketsPerSecond:', 'maxAimDeviationDegrees:',
  'rapidSwitchMillis:', 'clickPatternSamples:', 'criticalSamples:', 'blockReachAllowance:', 'scaffoldSamples:', 'multiBreakSamples:'
]) {
  assert.match(defaults, new RegExp(field), `default Fabric config is missing ${field}`);
}

const backend = read(root, 'minecraft-server', 'main.js');
for (const field of [
  'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak', 'chatSpam', 'commandSpam', 'inventorySpam',
  'maxBreaksPerSecond', 'maxPlacesPerSecond', 'maxChatPerFiveSeconds',
  'maxCommandsPerFiveSeconds', 'maxInventoryClicksPerSecond',
  'groundSpoofSamples', 'waterWalkSamples', 'maxPacketsPerSecond', 'maxAimDeviationDegrees',
  'rapidSwitchMillis', 'clickPatternSamples', 'criticalSamples', 'blockReachAllowance', 'scaffoldSamples', 'multiBreakSamples'
]) {
  assert.match(backend, new RegExp(field), `manager config rendering is missing ${field}`);
}

for (const release of [
  {
    version: '26.2',
    modVersion: '1.4.4',
    directory: path.join(root, 'minecraft-server', 'server-protection-fabric-26.2'),
    providerFile: 'meowantixray-fabric-1.6.3.jar',
    providerVersion: '1.6.3'
  },
  {
    version: '26.3',
    modVersion: '1.3.0', // Legacy archived adapter; this update deploys only 26.2.
    directory: adapterRoot,
    providerFile: 'meowantixray-fabric-1.7.0.jar',
    providerVersion: '1.7.0'
  }
]) {
  const nestedPath = `META-INF/jars/${release.providerFile}`;
  const metadata = JSON.parse(read(release.directory, 'src', 'main', 'resources', 'fabric.mod.json'));
  assert.deepEqual(metadata.jars, [{ file: nestedPath }],
    `Fabric ${release.version} metadata should load exactly one nested packet Anti-Xray provider`);
  assert.equal(metadata.depends?.meowantixray, `=${release.providerVersion}`,
    `Fabric ${release.version} should initialize its exact nested provider before reporting runtime health`);

  const build = read(release.directory, 'build.gradle');
  assert.match(build, new RegExp(`lib/${release.providerFile.replaceAll('.', '\\.')}`),
    `Fabric ${release.version} build should use the pinned provider file`);
  assert.match(build, new RegExp(`compileOnly files\\('${release.providerFile.replaceAll('.', '\\.').replace('meowantixray', 'lib/meowantixray')}'\\)`),
    `Fabric ${release.version} should compile its runtime-health bridge against the exact nested provider`);
  assert.match(build, /tasks\.named\('jar'\)\s*\{[\s\S]*dependsOn tasks\.named\('verifyBundledAntiXray'\)[\s\S]*into 'META-INF\/jars'/,
    `Fabric ${release.version} should verify the provider before nesting it in the release JAR`);
  const expectedSha512 = build.match(/bundledAntiXraySha512\s*=\s*'([a-f0-9]{128})'/)?.[1];
  assert.ok(expectedSha512, `Fabric ${release.version} build should pin the provider SHA-512`);

  const providerPath = path.join(release.directory, 'lib', release.providerFile);
  assert.ok(fs.statSync(providerPath).isFile(), `Fabric ${release.version} provider should be a regular file`);
  const actualSha512 = crypto.createHash('sha512').update(fs.readFileSync(providerPath)).digest('hex');
  assert.equal(actualSha512, expectedSha512,
    `Fabric ${release.version} provider should match the build-time integrity pin`);
  const providerEntries = zipEntryNames(providerPath);
  assert.ok(providerEntries.includes('fabric.mod.json'),
    `Fabric ${release.version} nested provider should identify itself as a Fabric mod`);
  const providerMetadata = JSON.parse(readZipTextEntry(providerPath, 'fabric.mod.json'));
  assert.equal(providerMetadata.id, 'meowantixray',
    `Fabric ${release.version} nested provider should expose the expected mod ID`);
  assert.equal(providerMetadata.version, release.providerVersion,
    `Fabric ${release.version} nested provider version should match its pinned filename`);
  assert.equal(providerMetadata.environment, 'server',
    `Fabric ${release.version} nested provider should be server-side only`);
  assert.deepEqual(providerMetadata.entrypoints?.main, ['com.meowantixray.fabric.MeowAntiXrayFabricMod'],
    `Fabric ${release.version} nested provider should expose its real runtime entrypoint`);
  assert.ok(providerMetadata.mixins?.includes('meowantixray.mixins.json'),
    `Fabric ${release.version} nested provider should register its packet-obfuscation mixins`);
  assert.ok(providerEntries.includes('com/meowantixray/fabric/MeowAntiXrayFabricMod.class'),
    `Fabric ${release.version} nested provider should contain its declared runtime entrypoint`);
  assert.ok(providerEntries.includes('meowantixray.mixins.json'),
    `Fabric ${release.version} nested provider should contain its declared mixin configuration`);
  if (release.version === '26.2') {
    const serviceBytecodeText = readZipEntry(
      providerPath,
      'com/meowantixray/antixray/FakeOreService.class'
    ).toString('latin1');
    assert.match(serviceBytecodeText, /statFailOpenChunkSends/,
      'the 26.2 provider should count bounded fail-open chunk sends');
    assert.match(serviceBytecodeText, /sending original chunk/,
      'async pressure should send the original packet instead of stalling the server thread');
    assert.doesNotMatch(serviceBytecodeText, /fallback to sync chunk/,
      'async failures must never retry the expensive rewrite synchronously');
    assert.match(serviceBytecodeText, /MAX_RETAINED_CHUNKS_PER_PLAYER/,
      'the 26.2 provider should bound retained per-player chunk state');
    assert.match(serviceBytecodeText, /compactSnapshotStorage/,
      'the 26.2 provider should retain packed section snapshots instead of decoded int arrays');
    assert.match(serviceBytecodeText, /retained\{players=/,
      'the 26.2 provider should expose lightweight retained-mask diagnostics');
    assert.ok(providerEntries.includes('com/meowantixray/antixray/FakeOreService$SectionBoundarySnapshot.class'),
      'the 26.2 provider should package face-only neighbor snapshots');
    assert.ok(providerEntries.includes('com/meowantixray/antixray/FakeOreService$SectionMask.class'),
      'the 26.2 provider should package compact persistent section masks');
    const senderMixinText = readZipEntry(
      providerPath,
      'com/meowantixray/mixin/PlayerChunkSenderMixin.class'
    ).toString('latin1');
    assert.match(senderMixinText, /dropChunk/,
      'the 26.2 provider should observe client chunk unloads');
    assert.match(senderMixinText, /onChunkDropped/,
      'the 26.2 provider should evict masks when vanilla drops a chunk');
  }

  const releaseJar = path.join(release.directory, 'dist', `ServerProtection-Fabric-${release.modVersion}+mc${release.version}.jar`);
  const releaseEntries = zipEntryNames(releaseJar);
  assert.equal(releaseEntries.filter(entry => entry === nestedPath).length, 1,
    `Fabric ${release.version} release JAR should contain exactly one verified nested provider`);
  const nestedProvider = readZipEntry(releaseJar, nestedPath);
  assert.equal(crypto.createHash('sha512').update(nestedProvider).digest('hex'), expectedSha512,
    `Fabric ${release.version} release JAR should embed the exact pinned provider bytes`);
  assert.equal(
    crypto.createHash('sha256').update(nestedProvider).digest('hex'),
    crypto.createHash('sha256').update(fs.readFileSync(providerPath)).digest('hex'),
    `Fabric ${release.version} nested provider should be byte-identical to its verified library`
  );
  const embeddedMetadata = JSON.parse(readZipTextEntry(releaseJar, 'fabric.mod.json'));
  assert.equal(embeddedMetadata.id, 'serverprotection_fabric');
  assert.equal(embeddedMetadata.version, release.modVersion);
  assert.equal(embeddedMetadata.environment, 'server');
  assert.deepEqual(embeddedMetadata.entrypoints?.main, ['dev.serverprotection.fabric.ServerProtectionFabric']);
  assert.equal(embeddedMetadata.depends?.minecraft, `=${release.version}`);
  assert.equal(embeddedMetadata.depends?.meowantixray, `=${release.providerVersion}`);
  assert.deepEqual(embeddedMetadata.jars, [{ file: nestedPath }]);
  for (const classFile of [
    'dev/serverprotection/fabric/BreakRatePolicy.class',
    'dev/serverprotection/fabric/SelectiveMobGriefing.class',
    'dev/serverprotection/fabric/mixin/CreeperExplosionMixin.class',
    'dev/serverprotection/fabric/mixin/EnderMan26_2BlockGriefingMixin.class',
    'dev/serverprotection/fabric/mixin/Enderman26_3BlockGriefingMixin.class'
  ]) {
    assert.ok(releaseEntries.includes(classFile),
      `Fabric ${release.version} release JAR should contain ${classFile}`);
  }
  if (release.version === '26.2') {
    assert.equal(releaseEntries.some(entry => entry.startsWith('dev/serverprotection/fabric/typing/')), false,
      'the current 26.2 release must not package the retired typing implementation');
  }
  assert.ok(releaseEntries.includes('META-INF/licenses/ServerProtection/MeowAntiXray-LICENSE.txt'),
    `Fabric ${release.version} release JAR should preserve the nested provider attribution`);
}

console.log('Minecraft Server Fabric protection coverage test passed.');
