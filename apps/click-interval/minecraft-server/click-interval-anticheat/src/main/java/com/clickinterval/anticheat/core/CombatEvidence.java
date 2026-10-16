package com.clickinterval.anticheat.core;

import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;

/**
 * Fixed-capacity combat evidence used by the Bukkit adapter. Keeping this state independent from
 * Bukkit makes its timing and hysteresis rules testable without starting a server.
 */
public final class CombatEvidence {
    public static final int MAX_TARGET_HISTORY = 8;

    private final UUID[] targets = new UUID[MAX_TARGET_HISTORY];
    private final long[] targetTimes = new long[MAX_TARGET_HISTORY];
    private int nextTarget;
    private UUID wallTarget;
    private long lastWallSampleAt = Long.MIN_VALUE;
    private int wallSamples;

    /** Remembers one direct attack and returns the bounded distinct-target count in the window. */
    public synchronized int rememberTarget(UUID target, long nowMillis, long windowMillis) {
        Objects.requireNonNull(target, "target");
        long safeWindow = Math.max(100L, Math.min(1_000L, windowMillis));
        targets[nextTarget] = target;
        targetTimes[nextTarget] = nowMillis;
        nextTarget = (nextTarget + 1) % targets.length;

        int distinct = 0;
        long cutoff = nowMillis - safeWindow;
        for (int index = 0; index < targets.length; index++) {
            UUID candidate = targets[index];
            if (candidate == null || targetTimes[index] < cutoff || targetTimes[index] > nowMillis) continue;
            boolean counted = false;
            for (int prior = 0; prior < index; prior++) {
                if (targetTimes[prior] >= cutoff && targetTimes[prior] <= nowMillis
                        && candidate.equals(targets[prior])) {
                    counted = true;
                    break;
                }
            }
            if (!counted) distinct++;
        }
        return distinct;
    }

    /**
     * Requires repeated blocked hits against the same target. Legal, near, stale, or target-swapped
     * samples clear the sequence so a block edge cannot accumulate into a report over time.
     */
    public synchronized boolean observeWallHit(
            UUID target,
            boolean hasLineOfSight,
            double observedReach,
            long nowMillis,
            int requiredSamples,
            long evidenceWindowMillis
    ) {
        int safeRequired = Math.max(2, Math.min(8, requiredSamples));
        long safeWindow = Math.max(250L, Math.min(2_000L, evidenceWindowMillis));
        if (target == null || hasLineOfSight || !Double.isFinite(observedReach) || observedReach <= 1.25) {
            clearWallEvidence();
            return false;
        }
        if (!target.equals(wallTarget) || lastWallSampleAt == Long.MIN_VALUE
                || nowMillis < lastWallSampleAt || nowMillis - lastWallSampleAt > safeWindow) {
            wallSamples = 1;
        } else {
            wallSamples = Math.min(100, wallSamples + 1);
        }
        wallTarget = target;
        lastWallSampleAt = nowMillis;
        if (wallSamples < safeRequired) return false;
        clearWallEvidence();
        return true;
    }

    public synchronized void clearTargets() {
        Arrays.fill(targets, null);
        Arrays.fill(targetTimes, 0L);
        nextTarget = 0;
    }

    public synchronized void clearWallEvidence() {
        wallTarget = null;
        lastWallSampleAt = Long.MIN_VALUE;
        wallSamples = 0;
    }

    public synchronized void clear() {
        clearTargets();
        clearWallEvidence();
    }
}
