'use strict';

const BALANCED_TUNING = Object.freeze({
  minimumTps: 18,
  grace: Object.freeze({ joinSeconds: 4, teleportSeconds: 3, velocitySeconds: 2 }),
  response: Object.freeze({ alertVl: 8, kickVl: 16, actionCooldownSeconds: 8, violationDecay: 0.12 }),
  reach: Object.freeze({
    geometryAllowance: 0.05,
    maxPingAllowance: 0.25,
    pingAllowancePerMs: 0.0008,
    maxTickAllowance: 0.10,
    tickAllowancePerMissingTps: 0.05,
    maxTargetRewind: 0.45,
    baseRewindTicks: 0.5,
    pingRewindTicksPerMs: 0.01,
    maxRewindTicks: 3,
    immediateExcess: 0.75,
    consecutiveSamples: 2,
    evidenceWindowMillis: 1250
  }),
  limits: Object.freeze({
    maxGroundBlocksPerTick: 0.78,
    maxAirBlocksPerTick: 0.92,
    maxAirTicks: 80,
    phaseSamples: 3,
    groundSpoofSamples: 5,
    waterWalkSamples: 7,
    stepSamples: 2,
    maxUseItemBlocksPerTick: 0.20,
    noSlowSamples: 7,
    maxPacketsPerSecond: 28,
    timerEvidenceWindows: 3,
    maxReach: 3.45,
    maxCps: 20,
    wallHitSamples: 6,
    multiTargetCount: 4,
    multiTargetWindowMillis: 650,
    maxAimDeviationDegrees: 55,
    aimEvidenceSamples: 4,
    aimEvidenceWindowMillis: 1500,
    rapidSwitchMillis: 90,
    rapidSwitchAngleDegrees: 110,
    rapidSwitchSamples: 3,
    rapidSwitchEvidenceWindowMillis: 1200,
    clickPatternSamples: 16,
    clickPatternMaxDeviationMillis: 1.5,
    criticalSamples: 3,
    criticalWindowMillis: 2500,
    blockReachAllowance: 0.75,
    maxBreaksPerSecond: 18,
    maxPlacesPerSecond: 16,
    scaffoldAimDegrees: 80,
    scaffoldSamples: 4,
    scaffoldWindowMillis: 2000,
    multiBreakSamples: 6,
    multiBreakWindowMillis: 300,
    multiBreakMinSpan: 3.5,
    maxChatPerFiveSeconds: 6,
    maxCommandsPerFiveSeconds: 10,
    maxInventoryClicksPerSecond: 35,
    inventoryEvidenceSamples: 3,
    inventorySampleIntervalMillis: 250,
    inventoryEvidenceWindowMillis: 1500,
    maxInventoryBurstPacketsPerSecond: 120,
    inventoryViolationCooldownMillis: 3000
  })
});

const STRICT_TUNING = Object.freeze({
  minimumTps: 18,
  grace: Object.freeze({ joinSeconds: 3, teleportSeconds: 2, velocitySeconds: 2 }),
  response: Object.freeze({ alertVl: 5, kickVl: 11, actionCooldownSeconds: 6, violationDecay: 0.08 }),
  reach: Object.freeze({
    geometryAllowance: 0.04,
    maxPingAllowance: 0.20,
    pingAllowancePerMs: 0.0007,
    maxTickAllowance: 0.08,
    tickAllowancePerMissingTps: 0.04,
    maxTargetRewind: 0.4,
    baseRewindTicks: 0.5,
    pingRewindTicksPerMs: 0.009,
    maxRewindTicks: 2.5,
    immediateExcess: 0.7,
    consecutiveSamples: 2,
    evidenceWindowMillis: 1100
  }),
  limits: Object.freeze({
    maxGroundBlocksPerTick: 0.7,
    maxAirBlocksPerTick: 0.82,
    maxAirTicks: 65,
    phaseSamples: 3,
    groundSpoofSamples: 4,
    waterWalkSamples: 5,
    stepSamples: 2,
    maxUseItemBlocksPerTick: 0.17,
    noSlowSamples: 5,
    maxPacketsPerSecond: 25,
    timerEvidenceWindows: 2,
    maxReach: 3.25,
    maxCps: 18,
    wallHitSamples: 6,
    multiTargetCount: 4,
    multiTargetWindowMillis: 750,
    maxAimDeviationDegrees: 42,
    aimEvidenceSamples: 3,
    aimEvidenceWindowMillis: 1200,
    rapidSwitchMillis: 130,
    rapidSwitchAngleDegrees: 85,
    rapidSwitchSamples: 2,
    rapidSwitchEvidenceWindowMillis: 1000,
    clickPatternSamples: 12,
    clickPatternMaxDeviationMillis: 3,
    criticalSamples: 2,
    criticalWindowMillis: 2000,
    blockReachAllowance: 0.5,
    maxBreaksPerSecond: 14,
    maxPlacesPerSecond: 13,
    scaffoldAimDegrees: 70,
    scaffoldSamples: 3,
    scaffoldWindowMillis: 1600,
    multiBreakSamples: 5,
    multiBreakWindowMillis: 250,
    multiBreakMinSpan: 3,
    maxChatPerFiveSeconds: 5,
    maxCommandsPerFiveSeconds: 8,
    maxInventoryClicksPerSecond: 28,
    inventoryEvidenceSamples: 3,
    inventorySampleIntervalMillis: 200,
    inventoryEvidenceWindowMillis: 1200,
    maxInventoryBurstPacketsPerSecond: 100,
    inventoryViolationCooldownMillis: 2500
  })
});

const COMPATIBILITY_TUNING = Object.freeze({
  minimumTps: 17,
  grace: Object.freeze({ joinSeconds: 6, teleportSeconds: 5, velocitySeconds: 3 }),
  response: Object.freeze({ alertVl: 12, kickVl: 24, actionCooldownSeconds: 12, violationDecay: 0.18 }),
  reach: Object.freeze({
    geometryAllowance: 0.08,
    maxPingAllowance: 0.35,
    pingAllowancePerMs: 0.001,
    maxTickAllowance: 0.15,
    tickAllowancePerMissingTps: 0.07,
    maxTargetRewind: 0.6,
    baseRewindTicks: 0.75,
    pingRewindTicksPerMs: 0.012,
    maxRewindTicks: 4,
    immediateExcess: 1.1,
    consecutiveSamples: 3,
    evidenceWindowMillis: 1800
  }),
  limits: Object.freeze({
    maxGroundBlocksPerTick: 0.95,
    maxAirBlocksPerTick: 1.1,
    maxAirTicks: 110,
    phaseSamples: 5,
    groundSpoofSamples: 7,
    waterWalkSamples: 10,
    stepSamples: 3,
    maxUseItemBlocksPerTick: 0.26,
    noSlowSamples: 10,
    maxPacketsPerSecond: 34,
    timerEvidenceWindows: 4,
    maxReach: 3.65,
    maxCps: 24,
    wallHitSamples: 8,
    multiTargetCount: 5,
    multiTargetWindowMillis: 550,
    maxAimDeviationDegrees: 70,
    aimEvidenceSamples: 5,
    aimEvidenceWindowMillis: 1800,
    rapidSwitchMillis: 70,
    rapidSwitchAngleDegrees: 130,
    rapidSwitchSamples: 4,
    rapidSwitchEvidenceWindowMillis: 1500,
    clickPatternSamples: 20,
    clickPatternMaxDeviationMillis: 0.75,
    criticalSamples: 5,
    criticalWindowMillis: 4000,
    blockReachAllowance: 1,
    maxBreaksPerSecond: 24,
    maxPlacesPerSecond: 22,
    scaffoldAimDegrees: 100,
    scaffoldSamples: 6,
    scaffoldWindowMillis: 3000,
    multiBreakSamples: 8,
    multiBreakWindowMillis: 450,
    multiBreakMinSpan: 4.5,
    maxChatPerFiveSeconds: 8,
    maxCommandsPerFiveSeconds: 14,
    maxInventoryClicksPerSecond: 45,
    inventoryEvidenceSamples: 4,
    inventorySampleIntervalMillis: 300,
    inventoryEvidenceWindowMillis: 2200,
    maxInventoryBurstPacketsPerSecond: 160,
    inventoryViolationCooldownMillis: 4000
  })
});

function finiteNumber(value, fallback, minimum, maximum, digits = 0) {
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  const clamped = Math.min(maximum, Math.max(minimum, selected));
  if (digits <= 0) return Math.round(clamped);
  const scale = 10 ** digits;
  return Math.round(clamped * scale) / scale;
}

function defaultProtectionTuning(preset = 'balanced') {
  const source = preset === 'strict' ? STRICT_TUNING
    : preset === 'compatibility' ? COMPATIBILITY_TUNING
      : BALANCED_TUNING;
  return {
    minimumTps: source.minimumTps,
    grace: { ...source.grace },
    response: { ...source.response },
    reach: { ...source.reach },
    limits: { ...source.limits }
  };
}

function normalizeProtectionTuning(value = {}, preset = 'balanced') {
  const fallback = defaultProtectionTuning(preset);
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const grace = source.grace && typeof source.grace === 'object' ? source.grace : {};
  const response = source.response && typeof source.response === 'object' ? source.response : {};
  const reach = source.reach && typeof source.reach === 'object' ? source.reach : {};
  const limits = source.limits && typeof source.limits === 'object' ? source.limits : {};
  const alertVl = finiteNumber(response.alertVl, fallback.response.alertVl, 1, 100, 2);
  const kickVl = finiteNumber(response.kickVl, fallback.response.kickVl, Math.max(2, alertVl + 0.1), 200, 2);
  const maxInventoryClicksPerSecond = finiteNumber(
    limits.maxInventoryClicksPerSecond,
    fallback.limits.maxInventoryClicksPerSecond,
    1,
    200
  );
  const inventoryEvidenceSamples = finiteNumber(
    limits.inventoryEvidenceSamples,
    fallback.limits.inventoryEvidenceSamples,
    2,
    8
  );
  const inventorySampleIntervalMillis = finiteNumber(
    limits.inventorySampleIntervalMillis,
    fallback.limits.inventorySampleIntervalMillis,
    100,
    1000
  );
  return {
    minimumTps: finiteNumber(source.minimumTps, fallback.minimumTps, 10, 20, 2),
    grace: {
      joinSeconds: finiteNumber(grace.joinSeconds, fallback.grace.joinSeconds, 2, 30, 1),
      teleportSeconds: finiteNumber(grace.teleportSeconds, fallback.grace.teleportSeconds, 2, 30, 1),
      velocitySeconds: finiteNumber(grace.velocitySeconds, fallback.grace.velocitySeconds, 1, 15, 1)
    },
    response: {
      alertVl,
      kickVl,
      actionCooldownSeconds: finiteNumber(response.actionCooldownSeconds, fallback.response.actionCooldownSeconds, 1, 300, 1),
      violationDecay: finiteNumber(response.violationDecay, fallback.response.violationDecay, 0, 10, 3)
    },
    reach: {
      geometryAllowance: finiteNumber(reach.geometryAllowance, fallback.reach.geometryAllowance, 0.025, 0.25, 4),
      maxPingAllowance: finiteNumber(reach.maxPingAllowance, fallback.reach.maxPingAllowance, 0.15, 0.5, 4),
      pingAllowancePerMs: finiteNumber(reach.pingAllowancePerMs, fallback.reach.pingAllowancePerMs, 0.0005, 0.002, 6),
      maxTickAllowance: finiteNumber(reach.maxTickAllowance, fallback.reach.maxTickAllowance, 0.05, 0.25, 4),
      tickAllowancePerMissingTps: finiteNumber(reach.tickAllowancePerMissingTps, fallback.reach.tickAllowancePerMissingTps, 0.025, 0.1, 4),
      maxTargetRewind: finiteNumber(reach.maxTargetRewind, fallback.reach.maxTargetRewind, 0.25, 0.75, 3),
      baseRewindTicks: finiteNumber(reach.baseRewindTicks, fallback.reach.baseRewindTicks, 0.25, 1.5, 3),
      pingRewindTicksPerMs: finiteNumber(reach.pingRewindTicksPerMs, fallback.reach.pingRewindTicksPerMs, 0.005, 0.02, 5),
      maxRewindTicks: finiteNumber(reach.maxRewindTicks, fallback.reach.maxRewindTicks, 1.5, 5, 2),
      immediateExcess: finiteNumber(reach.immediateExcess, fallback.reach.immediateExcess, 0.5, 2, 3),
      consecutiveSamples: finiteNumber(reach.consecutiveSamples, fallback.reach.consecutiveSamples, 2, 6),
      evidenceWindowMillis: finiteNumber(reach.evidenceWindowMillis, fallback.reach.evidenceWindowMillis, 750, 5000)
    },
    limits: {
      maxGroundBlocksPerTick: finiteNumber(limits.maxGroundBlocksPerTick, fallback.limits.maxGroundBlocksPerTick, 0.25, 5, 3),
      maxAirBlocksPerTick: finiteNumber(limits.maxAirBlocksPerTick, fallback.limits.maxAirBlocksPerTick, 0.25, 5, 3),
      maxAirTicks: finiteNumber(limits.maxAirTicks, fallback.limits.maxAirTicks, 20, 600),
      phaseSamples: finiteNumber(limits.phaseSamples, fallback.limits.phaseSamples, 2, 10),
      groundSpoofSamples: finiteNumber(limits.groundSpoofSamples, fallback.limits.groundSpoofSamples, 3, 12),
      waterWalkSamples: finiteNumber(limits.waterWalkSamples, fallback.limits.waterWalkSamples, 3, 16),
      stepSamples: finiteNumber(limits.stepSamples, fallback.limits.stepSamples, 2, 8),
      maxUseItemBlocksPerTick: finiteNumber(limits.maxUseItemBlocksPerTick, fallback.limits.maxUseItemBlocksPerTick, 0.08, 0.5, 3),
      noSlowSamples: finiteNumber(limits.noSlowSamples, fallback.limits.noSlowSamples, 3, 16),
      maxPacketsPerSecond: finiteNumber(limits.maxPacketsPerSecond, fallback.limits.maxPacketsPerSecond, 21, 100),
      timerEvidenceWindows: finiteNumber(limits.timerEvidenceWindows, fallback.limits.timerEvidenceWindows, 2, 6),
      maxReach: finiteNumber(limits.maxReach, fallback.limits.maxReach, 2.5, 8, 3),
      maxCps: finiteNumber(limits.maxCps, fallback.limits.maxCps, 5, 40),
      wallHitSamples: finiteNumber(limits.wallHitSamples, fallback.limits.wallHitSamples, 6, 12),
      multiTargetCount: finiteNumber(limits.multiTargetCount, fallback.limits.multiTargetCount, 2, 16),
      multiTargetWindowMillis: finiteNumber(limits.multiTargetWindowMillis, fallback.limits.multiTargetWindowMillis, 100, 5000),
      maxAimDeviationDegrees: finiteNumber(limits.maxAimDeviationDegrees, fallback.limits.maxAimDeviationDegrees, 20, 120, 2),
      aimEvidenceSamples: finiteNumber(limits.aimEvidenceSamples, fallback.limits.aimEvidenceSamples, 2, 12),
      aimEvidenceWindowMillis: finiteNumber(limits.aimEvidenceWindowMillis, fallback.limits.aimEvidenceWindowMillis, 500, 5000),
      rapidSwitchMillis: finiteNumber(limits.rapidSwitchMillis, fallback.limits.rapidSwitchMillis, 40, 300),
      rapidSwitchAngleDegrees: finiteNumber(limits.rapidSwitchAngleDegrees, fallback.limits.rapidSwitchAngleDegrees, 45, 170, 2),
      rapidSwitchSamples: finiteNumber(limits.rapidSwitchSamples, fallback.limits.rapidSwitchSamples, 2, 8),
      rapidSwitchEvidenceWindowMillis: finiteNumber(limits.rapidSwitchEvidenceWindowMillis, fallback.limits.rapidSwitchEvidenceWindowMillis, 300, 5000),
      clickPatternSamples: finiteNumber(limits.clickPatternSamples, fallback.limits.clickPatternSamples, 8, 24),
      clickPatternMaxDeviationMillis: finiteNumber(limits.clickPatternMaxDeviationMillis, fallback.limits.clickPatternMaxDeviationMillis, 0, 20, 2),
      criticalSamples: finiteNumber(limits.criticalSamples, fallback.limits.criticalSamples, 2, 8),
      criticalWindowMillis: finiteNumber(limits.criticalWindowMillis, fallback.limits.criticalWindowMillis, 500, 10000),
      blockReachAllowance: finiteNumber(limits.blockReachAllowance, fallback.limits.blockReachAllowance, 0.25, 3, 2),
      maxBreaksPerSecond: finiteNumber(limits.maxBreaksPerSecond, fallback.limits.maxBreaksPerSecond, 1, 100),
      maxPlacesPerSecond: finiteNumber(limits.maxPlacesPerSecond, fallback.limits.maxPlacesPerSecond, 1, 100),
      scaffoldAimDegrees: finiteNumber(limits.scaffoldAimDegrees, fallback.limits.scaffoldAimDegrees, 45, 140, 2),
      scaffoldSamples: finiteNumber(limits.scaffoldSamples, fallback.limits.scaffoldSamples, 2, 10),
      scaffoldWindowMillis: finiteNumber(limits.scaffoldWindowMillis, fallback.limits.scaffoldWindowMillis, 500, 10000),
      multiBreakSamples: finiteNumber(limits.multiBreakSamples, fallback.limits.multiBreakSamples, 3, 12),
      multiBreakWindowMillis: finiteNumber(limits.multiBreakWindowMillis, fallback.limits.multiBreakWindowMillis, 100, 2000),
      multiBreakMinSpan: finiteNumber(limits.multiBreakMinSpan, fallback.limits.multiBreakMinSpan, 1.5, 10, 2),
      maxChatPerFiveSeconds: finiteNumber(limits.maxChatPerFiveSeconds, fallback.limits.maxChatPerFiveSeconds, 1, 100),
      maxCommandsPerFiveSeconds: finiteNumber(limits.maxCommandsPerFiveSeconds, fallback.limits.maxCommandsPerFiveSeconds, 1, 200),
      maxInventoryClicksPerSecond,
      inventoryEvidenceSamples,
      inventorySampleIntervalMillis,
      inventoryEvidenceWindowMillis: finiteNumber(
        limits.inventoryEvidenceWindowMillis,
        fallback.limits.inventoryEvidenceWindowMillis,
        inventorySampleIntervalMillis * (inventoryEvidenceSamples - 1),
        10000
      ),
      maxInventoryBurstPacketsPerSecond: finiteNumber(
        limits.maxInventoryBurstPacketsPerSecond,
        fallback.limits.maxInventoryBurstPacketsPerSecond,
        Math.max(20, maxInventoryClicksPerSecond + 1),
        1000
      ),
      inventoryViolationCooldownMillis: finiteNumber(
        limits.inventoryViolationCooldownMillis,
        fallback.limits.inventoryViolationCooldownMillis,
        500,
        30000
      )
    }
  };
}

module.exports = {
  BALANCED_TUNING,
  STRICT_TUNING,
  COMPATIBILITY_TUNING,
  defaultProtectionTuning,
  normalizeProtectionTuning
};
