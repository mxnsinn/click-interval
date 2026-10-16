'use strict';

const assert = require('node:assert/strict');
const { defaultProtectionTuning, normalizeProtectionTuning } = require('./protection-tuning');

assert.equal(defaultProtectionTuning('balanced').limits.maxReach, 3.45);
assert.equal(defaultProtectionTuning('strict').limits.maxReach, 3.25);
assert.equal(defaultProtectionTuning('strict').response.alertVl, 5);
assert.equal(defaultProtectionTuning('balanced').reach.evidenceWindowMillis, 1250);
assert.equal(defaultProtectionTuning('balanced').reach.consecutiveSamples, 2);
assert.equal(defaultProtectionTuning('balanced').limits.inventoryEvidenceSamples, 3);
assert.equal(defaultProtectionTuning('balanced').limits.maxInventoryBurstPacketsPerSecond, 120);
assert.equal(defaultProtectionTuning('compatibility').limits.maxReach, 3.65);
assert.equal(defaultProtectionTuning('compatibility').response.alertVl, 12);
assert.equal(defaultProtectionTuning('balanced').limits.aimEvidenceSamples, 4);
assert.equal(defaultProtectionTuning('strict').limits.rapidSwitchSamples, 2);
assert.equal(defaultProtectionTuning('compatibility').limits.clickPatternSamples, 20);
assert.deepEqual([
  defaultProtectionTuning('strict').limits.maxPacketsPerSecond,
  defaultProtectionTuning('balanced').limits.maxPacketsPerSecond,
  defaultProtectionTuning('compatibility').limits.maxPacketsPerSecond
], [25, 28, 34]);
assert.deepEqual([
  defaultProtectionTuning('strict').limits.groundSpoofSamples,
  defaultProtectionTuning('balanced').limits.groundSpoofSamples,
  defaultProtectionTuning('compatibility').limits.groundSpoofSamples
], [4, 5, 7]);
assert.deepEqual([
  defaultProtectionTuning('strict').limits.scaffoldSamples,
  defaultProtectionTuning('balanced').limits.scaffoldSamples,
  defaultProtectionTuning('compatibility').limits.scaffoldSamples
], [3, 4, 6]);

const normalized = normalizeProtectionTuning({
  minimumTps: 200,
  grace: { joinSeconds: -4, teleportSeconds: 2.26, velocitySeconds: 'bad' },
  response: { alertVl: 20, kickVl: 10, actionCooldownSeconds: -1, violationDecay: 20 },
  reach: { geometryAllowance: -1, maxPingAllowance: 9, consecutiveSamples: 99, evidenceWindowMillis: 1 },
  limits: {
    maxReach: 100,
    maxCps: 0,
    maxAirTicks: 25.4,
    groundSpoofSamples: 99,
    maxPacketsPerSecond: 1,
    timerEvidenceWindows: 99,
    scaffoldAimDegrees: 999,
    multiBreakMinSpan: -1,
    maxInventoryClicksPerSecond: 50,
    inventoryEvidenceSamples: 99,
    inventorySampleIntervalMillis: 1,
    inventoryEvidenceWindowMillis: 1,
    maxInventoryBurstPacketsPerSecond: 1,
    inventoryViolationCooldownMillis: 999999
  }
}, 'balanced');
assert.equal(normalized.minimumTps, 20);
assert.equal(normalized.grace.joinSeconds, 2);
assert.equal(normalized.grace.teleportSeconds, 2.3);
assert.equal(normalized.grace.velocitySeconds, 2);
assert.equal(normalized.response.alertVl, 20);
assert.equal(normalized.response.kickVl, 20.1);
assert.equal(normalized.response.actionCooldownSeconds, 1);
assert.equal(normalized.response.violationDecay, 10);
assert.equal(normalized.reach.geometryAllowance, 0.025);
assert.equal(normalized.reach.maxPingAllowance, 0.5);
assert.equal(normalized.reach.consecutiveSamples, 6);
assert.equal(normalized.reach.evidenceWindowMillis, 750);
assert.equal(normalized.limits.maxReach, 8);
assert.equal(normalized.limits.maxCps, 5);
assert.equal(normalized.limits.maxAirTicks, 25);
assert.equal(normalized.limits.groundSpoofSamples, 12);
assert.equal(normalized.limits.maxPacketsPerSecond, 21);
assert.equal(normalized.limits.timerEvidenceWindows, 6);
assert.equal(normalized.limits.scaffoldAimDegrees, 140);
assert.equal(normalized.limits.multiBreakMinSpan, 1.5);
assert.equal(normalized.limits.maxInventoryClicksPerSecond, 50);
assert.equal(normalized.limits.inventoryEvidenceSamples, 8);
assert.equal(normalized.limits.inventorySampleIntervalMillis, 100);
assert.equal(normalized.limits.inventoryEvidenceWindowMillis, 700);
assert.equal(normalized.limits.maxInventoryBurstPacketsPerSecond, 51);
assert.equal(normalized.limits.inventoryViolationCooldownMillis, 30000);

const boundedRuntimeValues = normalizeProtectionTuning({
  reach: {
    pingAllowancePerMs: 10,
    maxTickAllowance: 10,
    tickAllowancePerMissingTps: -10,
    maxTargetRewind: 10,
    baseRewindTicks: -10,
    pingRewindTicksPerMs: 10,
    maxRewindTicks: -10,
    immediateExcess: 10
  },
  limits: { maxCps: 100 }
});
assert.equal(boundedRuntimeValues.reach.pingAllowancePerMs, 0.002);
assert.equal(boundedRuntimeValues.reach.maxTickAllowance, 0.25);
assert.equal(boundedRuntimeValues.reach.tickAllowancePerMissingTps, 0.025);
assert.equal(boundedRuntimeValues.reach.maxTargetRewind, 0.75);
assert.equal(boundedRuntimeValues.reach.baseRewindTicks, 0.25);
assert.equal(boundedRuntimeValues.reach.pingRewindTicksPerMs, 0.02);
assert.equal(boundedRuntimeValues.reach.maxRewindTicks, 1.5);
assert.equal(boundedRuntimeValues.reach.immediateExcess, 2);
assert.equal(boundedRuntimeValues.limits.maxCps, 40);

const fabricSafeFloors = normalizeProtectionTuning({
  minimumTps: 0,
  grace: { joinSeconds: 0, teleportSeconds: 0, velocitySeconds: 0 },
  response: { alertVl: 0, kickVl: 0, actionCooldownSeconds: 0 },
  limits: { maxGroundBlocksPerTick: 0, maxAirBlocksPerTick: 0, maxAirTicks: 0 }
});
assert.equal(fabricSafeFloors.minimumTps, 10);
assert.equal(fabricSafeFloors.grace.joinSeconds, 2);
assert.equal(fabricSafeFloors.grace.teleportSeconds, 2);
assert.equal(fabricSafeFloors.grace.velocitySeconds, 1);
assert.equal(fabricSafeFloors.response.alertVl, 1);
assert.equal(fabricSafeFloors.response.kickVl, 2);
assert.equal(fabricSafeFloors.response.actionCooldownSeconds, 1);
assert.equal(fabricSafeFloors.limits.maxGroundBlocksPerTick, 0.25);
assert.equal(fabricSafeFloors.limits.maxAirBlocksPerTick, 0.25);
assert.equal(fabricSafeFloors.limits.maxAirTicks, 20);

console.log('PASS protection tuning tests');
