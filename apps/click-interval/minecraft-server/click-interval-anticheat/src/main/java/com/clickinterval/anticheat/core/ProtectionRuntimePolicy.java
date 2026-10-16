package com.clickinterval.anticheat.core;

/** Shared, dependency-free runtime decisions used by the Bukkit event adapter. */
public final class ProtectionRuntimePolicy {
    private ProtectionRuntimePolicy() {
    }

    /** A detected action is blocked only while automatic response is enabled. */
    public static boolean shouldCancelDetectedAction(boolean responseEnabled, boolean detected) {
        return responseEnabled && detected;
    }

    /** Reach and wall-hit use the same response gate. */
    public static boolean shouldCancelSpatialAttack(
            boolean responseEnabled,
            boolean confirmedReach,
            boolean confirmedWallHit
    ) {
        return responseEnabled && (confirmedReach || confirmedWallHit);
    }

    /** Select movement allowance from server-observed collision support, never a client claim. */
    public static double horizontalMovementLimit(
            boolean serverSupported,
            double groundBlocksPerTick,
            double airBlocksPerTick
    ) {
        return serverSupported ? groundBlocksPerTick : airBlocksPerTick;
    }

    /** Convert a bounded decimal-second setting without losing half-second precision. */
    public static long boundedSecondsToMillis(
            double seconds,
            double fallbackSeconds,
            double minimumSeconds,
            double maximumSeconds
    ) {
        double fallback = Double.isFinite(fallbackSeconds) ? fallbackSeconds : minimumSeconds;
        double selected = Double.isFinite(seconds) ? seconds : fallback;
        double minimum = Math.min(minimumSeconds, maximumSeconds);
        double maximum = Math.max(minimumSeconds, maximumSeconds);
        return Math.round(Math.max(minimum, Math.min(maximum, selected)) * 1_000.0);
    }
}
