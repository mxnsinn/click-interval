'use strict';

const assert = require('node:assert/strict');
const {
  SUPPORTED_SERVER_TYPES,
  normalizeProtectionServerType,
  getProtectionCapabilities,
  getProtectionCapabilityState
} = require('./protection-capabilities');

assert.equal(normalizeProtectionServerType(' Paper '), 'paper');
assert.equal(normalizeProtectionServerType('unknown'), 'vanilla');
assert.deepEqual(SUPPORTED_SERVER_TYPES, ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur', 'spigot']);

for (const type of SUPPORTED_SERVER_TYPES) {
  const capability = getProtectionCapabilities(type);
  assert.equal(capability.serverType, type);
  assert.equal(Object.isFrozen(capability), true);
  assert.equal(capability.baselineHardeningSupported, true, `${type} should receive baseline hardening`);
  assert.equal(capability.legacyRecommendedInstallSupported, false, `${type} must not expose the old recommended download`);
}

for (const type of ['paper', 'purpur', 'spigot']) {
  const capability = getProtectionCapabilities(type);
  assert.equal(capability.tier, 'full-bundled');
  assert.equal(capability.bundledAdapterSupported, true);
  assert.equal(capability.bundledAdapterKind, 'plugins');
  assert.equal(capability.eventChecksBundled, true);
  assert.equal(capability.customAdapterKind, 'plugins');
}

for (const type of ['fabric', 'quilt', 'forge', 'neoforge']) {
  const capability = getProtectionCapabilities(type);
  assert.equal(capability.tier, 'baseline-with-custom-adapter');
  assert.equal(capability.bundledAdapterSupported, false, `the Bukkit artifact must not be offered to ${type}`);
  assert.equal(capability.eventChecksBundled, false);
  assert.equal(capability.customAdapterSupported, true);
  assert.equal(capability.customAdapterKind, 'mods');
}

const vanilla = getProtectionCapabilities('vanilla');
assert.equal(vanilla.tier, 'baseline-only');
assert.equal(vanilla.bundledAdapterSupported, false);
assert.equal(vanilla.customAdapterSupported, false);
assert.equal(vanilla.customAdapterKind, '');
assert.equal(vanilla.nativeAntiXraySupported, false);
assert.equal(getProtectionCapabilityState('vanilla', {}).effectiveTier, 'baseline-only');

assert.equal(getProtectionCapabilities('paper').nativeAntiXraySupported, true);
assert.equal(getProtectionCapabilities('purpur').nativeAntiXraySupported, true);
assert.equal(getProtectionCapabilities('spigot').nativeAntiXraySupported, false);
assert.equal(getProtectionCapabilities('fabric', '26.2').antiXrayDetectionSupported, true);
assert.equal(getProtectionCapabilities('fabric', '26.2').antiXrayObfuscationSupported, true);
assert.equal(getProtectionCapabilities('fabric', '26.2').antiXrayMode, 'obfuscation');
assert.equal(getProtectionCapabilities('fabric', '26.3').antiXrayObfuscationSupported, true);
assert.equal(getProtectionCapabilities('fabric', '26.3').antiXrayMode, 'obfuscation');
assert.equal(getProtectionCapabilities('fabric', '1.21.4').antiXrayDetectionSupported, false);
assert.equal(getProtectionCapabilities('fabric', '1.21.4').antiXrayObfuscationSupported, false);

const readyPaper = getProtectionCapabilityState('paper', {
  desiredType: 'paper',
  jarExists: true,
  compatible: true,
  verified: true,
  ready: true
});
assert.equal(readyPaper.bundledAdapterReady, true);
assert.equal(readyPaper.effectiveTier, 'full-bundled');

const unverifiedPaper = getProtectionCapabilityState('paper', {
  desiredType: 'paper',
  jarExists: true,
  compatible: true,
  verified: false,
  ready: false
});
assert.equal(unverifiedPaper.bundledAdapterReady, false);
assert.equal(unverifiedPaper.effectiveTier, 'baseline-awaiting-adapter');

const mismatchedPaper = getProtectionCapabilityState('paper', {
  desiredType: 'fabric',
  jarExists: true,
  compatible: true,
  verified: true,
  ready: true
});
assert.equal(mismatchedPaper.platformMatches, false);
assert.equal(mismatchedPaper.bundledAdapterReady, false);

const readyFabric = getProtectionCapabilityState('fabric', {
  desiredType: 'fabric',
  jarExists: true,
  compatible: true,
  verified: true,
  ready: true
});
assert.equal(readyFabric.runtimeReady, true);
assert.equal(readyFabric.bundledAdapterReady, false, 'a ready Fabric runtime still cannot load the Bukkit artifact');
assert.equal(readyFabric.effectiveTier, 'baseline-awaiting-adapter');

const bundledFabric = getProtectionCapabilities('fabric', '26.3');
assert.equal(bundledFabric.tier, 'full-bundled');
assert.equal(bundledFabric.bundledAdapterSupported, true);
assert.equal(bundledFabric.bundledAdapterId, 'fabric-26.3');
assert.equal(bundledFabric.bundledAdapterKind, 'mods');
assert.equal(bundledFabric.bundledAdapterVersionSupported, true);
assert.deepEqual(bundledFabric.supportedMinecraftVersions, ['26.2', '26.3']);
assert.deepEqual(bundledFabric.supportedChecks, [
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation',
  'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak',
  'chatSpam', 'commandSpam', 'inventorySpam'
]);
assert.equal(bundledFabric.espMitigationSupported, false);
assert.equal(bundledFabric.accessRoleExemptionsSupported, true);
assert.equal(bundledFabric.accessCommandPermissionsSupported, true);

const exactReadyFabric = getProtectionCapabilityState('fabric', {
  desiredType: 'fabric',
  minecraftVersion: '26.3',
  jarExists: true,
  compatible: true,
  verified: true,
  ready: true
});
assert.equal(exactReadyFabric.bundledAdapterReady, true);
assert.equal(exactReadyFabric.effectiveTier, 'full-bundled');
const bundledFabric262 = getProtectionCapabilities('fabric', '26.2');
assert.equal(bundledFabric262.bundledAdapterSupported, true);
assert.equal(bundledFabric262.bundledAdapterId, 'fabric-26.2');
assert.equal(bundledFabric262.espMitigationSupported, false);
assert.deepEqual(bundledFabric262.supportedMinecraftVersions, ['26.2', '26.3']);
const exactReadyFabric262 = getProtectionCapabilityState('fabric', {
  desiredType: 'fabric',
  minecraftVersion: '26.2',
  jarExists: true,
  compatible: true,
  verified: true,
  ready: true
});
assert.equal(exactReadyFabric262.bundledAdapterReady, true);
assert.equal(exactReadyFabric262.effectiveTier, 'full-bundled');
assert.equal(getProtectionCapabilities('fabric', '26.1').bundledAdapterSupported, false);
assert.equal(getProtectionCapabilities('paper', '26.3').espMitigationSupported, false);
assert.equal(getProtectionCapabilities('paper', '26.3').accessRoleExemptionsSupported, true);
assert.equal(getProtectionCapabilities('paper', '26.3').accessCommandPermissionsSupported, true);

console.log('PASS protection capability matrix tests');
