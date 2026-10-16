package com.clickinterval.anticheat.core;

/**
 * Bounded, allocation-free evidence gates for behaviour which is visible to the server but is too
 * ambiguous to act on from one sample. Platform adapters supply authoritative collision/liquid
 * state and reset the analyzer during lag, teleports, vehicles and other grace conditions.
 */
public final class BehaviorPatternAnalyzer {
    public static final int GROUND_SPOOF = 1;
    public static final int WATER_WALK = 1 << 1;
    public static final int STEP = 1 << 2;
    public static final int NO_SLOW = 1 << 3;
    public static final int TIMER = 1 << 4;
    public static final int CRITICALS = 1 << 5;
    public static final int SCAFFOLD = 1 << 6;
    public static final int MULTI_BREAK = 1 << 7;

    private static final int BREAK_RING_SIZE = 12;
    private final long[] breakAt = new long[BREAK_RING_SIZE];
    private final double[] breakX = new double[BREAK_RING_SIZE];
    private final double[] breakY = new double[BREAK_RING_SIZE];
    private final double[] breakZ = new double[BREAK_RING_SIZE];

    private int groundSpoofEvidence;
    private int waterWalkEvidence;
    private int stepEvidence;
    private long stepEvidenceAt;
    private int noSlowEvidence;
    private boolean previousSupported;
    private boolean movementInitialized;

    private long packetWindowAt;
    private int packetCount;
    private int highPacketWindows;

    private long criticalWindowAt;
    private int criticalEvidence;
    private long scaffoldWindowAt;
    private int scaffoldEvidence;
    private int breakCursor;
    private int breakCount;

    public int observeMovement(
            long now,
            double vertical,
            double horizontal,
            boolean clientGround,
            boolean serverSupported,
            boolean liquidSurface,
            boolean insideLiquid,
            boolean usingItem,
            boolean exempt,
            double allowedStep,
            double maxUseItemSpeed,
            int requiredGroundSpoof,
            int requiredWaterWalk,
            int requiredStep,
            int requiredNoSlow
    ) {
        if (exempt || !Double.isFinite(vertical) || !Double.isFinite(horizontal)) {
            resetMovement();
            previousSupported = serverSupported;
            movementInitialized = true;
            return 0;
        }

        int flags = 0;
        boolean groundSpoof = clientGround && !serverSupported && !insideLiquid && !liquidSurface;
        groundSpoofEvidence = evidence(groundSpoof, groundSpoofEvidence);
        if (groundSpoofEvidence >= boundedSamples(requiredGroundSpoof)) {
            flags |= GROUND_SPOOF;
            groundSpoofEvidence = 0;
        }

        boolean waterWalk = liquidSurface && !insideLiquid && !serverSupported
                && horizontal >= 0.035 && Math.abs(vertical) <= 0.035;
        waterWalkEvidence = evidence(waterWalk, waterWalkEvidence);
        if (waterWalkEvidence >= boundedSamples(requiredWaterWalk)) {
            flags |= WATER_WALK;
            waterWalkEvidence = 0;
        }

        double safeStep = Math.max(0.5, Math.min(2.0, allowedStep));
        boolean step = movementInitialized && previousSupported && serverSupported
                && horizontal >= 0.035 && vertical > safeStep + 0.08 && vertical <= 1.60;
        if (step) {
            if (!withinWindow(now, stepEvidenceAt, 3_000L)) stepEvidence = 0;
            stepEvidenceAt = now;
            stepEvidence = Math.min(100_000, stepEvidence + 1);
        } else if (!withinWindow(now, stepEvidenceAt, 3_000L)) {
            stepEvidence = 0;
        }
        if (stepEvidence >= boundedSamples(requiredStep)) {
            flags |= STEP;
            stepEvidence = 0;
        }

        boolean noSlow = usingItem && serverSupported && horizontal > Math.max(0.08, maxUseItemSpeed);
        noSlowEvidence = evidence(noSlow, noSlowEvidence);
        if (noSlowEvidence >= boundedSamples(requiredNoSlow)) {
            flags |= NO_SLOW;
            noSlowEvidence = 0;
        }

        previousSupported = serverSupported;
        movementInitialized = true;
        return flags;
    }

    /** Records one accepted movement packet/event and reports only after several complete windows. */
    public int observeMovementPacket(long now, int maximumPerSecond, int requiredWindows, boolean exempt) {
        if (exempt || now <= 0L) {
            resetPackets();
            return 0;
        }
        int limit = Math.max(21, Math.min(200, maximumPerSecond));
        int windows = Math.max(2, Math.min(6, requiredWindows));
        if (packetWindowAt == 0L || now < packetWindowAt || now - packetWindowAt > 3_000L) {
            packetWindowAt = now;
            packetCount = 1;
            highPacketWindows = 0;
            return 0;
        }
        long elapsed = now - packetWindowAt;
        if (elapsed < 1_000L) {
            packetCount = Math.min(10_000, packetCount + 1);
            return 0;
        }
        // Delivery windows end when the next packet arrives, not exactly one second later.
        // A delayed/batched window must be judged by its actual elapsed duration; comparing
        // its entire count with a one-second limit turned ordinary catch-up into timer evidence.
        boolean overRate = (long) packetCount * 1_000L > (long) limit * elapsed;
        highPacketWindows = overRate
                ? Math.min(100, highPacketWindows + 1)
                : 0; // Require consecutive abnormal windows, not accumulated intermittent bursts.
        packetWindowAt = now;
        packetCount = 1;
        if (highPacketWindows < windows) return 0;
        highPacketWindows = 0;
        return TIMER;
    }

    public int observeCritical(long now, boolean impossibleCritical, int requiredSamples, long windowMillis) {
        if (!withinWindow(now, criticalWindowAt, windowMillis)) criticalEvidence = 0;
        criticalWindowAt = now;
        criticalEvidence = evidence(impossibleCritical, criticalEvidence);
        if (criticalEvidence < boundedSamples(requiredSamples)) return 0;
        criticalEvidence = 0;
        return CRITICALS;
    }

    public int observeScaffold(long now, boolean implausiblePlacement, int requiredSamples, long windowMillis) {
        if (!withinWindow(now, scaffoldWindowAt, windowMillis)) scaffoldEvidence = 0;
        scaffoldWindowAt = now;
        scaffoldEvidence = evidence(implausiblePlacement, scaffoldEvidence);
        if (scaffoldEvidence < boundedSamples(requiredSamples)) return 0;
        scaffoldEvidence = 0;
        return SCAFFOLD;
    }

    public int observeBreak(long now, double x, double y, double z,
                            int requiredSamples, long windowMillis, double minimumSpan) {
        if (now <= 0L || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) return 0;
        breakAt[breakCursor] = now;
        breakX[breakCursor] = x;
        breakY[breakCursor] = y;
        breakZ[breakCursor] = z;
        breakCursor = (breakCursor + 1) % BREAK_RING_SIZE;
        breakCount = Math.min(BREAK_RING_SIZE, breakCount + 1);

        long window = Math.max(100L, Math.min(2_000L, windowMillis));
        int needed = Math.max(3, Math.min(BREAK_RING_SIZE, requiredSamples));
        double minX = x, maxX = x, minY = y, maxY = y, minZ = z, maxZ = z;
        int samples = 0;
        for (int index = 0; index < breakCount; index++) {
            if (now < breakAt[index] || now - breakAt[index] > window) continue;
            samples++;
            minX = Math.min(minX, breakX[index]); maxX = Math.max(maxX, breakX[index]);
            minY = Math.min(minY, breakY[index]); maxY = Math.max(maxY, breakY[index]);
            minZ = Math.min(minZ, breakZ[index]); maxZ = Math.max(maxZ, breakZ[index]);
        }
        double span = Math.sqrt(square(maxX - minX) + square(maxY - minY) + square(maxZ - minZ));
        if (samples < needed || span < Math.max(1.5, minimumSpan)) return 0;
        resetBreaks();
        return MULTI_BREAK;
    }

    public void reset() {
        resetMovement();
        resetPackets();
        criticalWindowAt = 0L;
        criticalEvidence = 0;
        scaffoldWindowAt = 0L;
        scaffoldEvidence = 0;
        resetBreaks();
    }

    /** Clears only movement-derived evidence while preserving packet, combat, and world evidence. */
    public void resetMovement() {
        groundSpoofEvidence = 0;
        waterWalkEvidence = 0;
        stepEvidence = 0;
        stepEvidenceAt = 0L;
        noSlowEvidence = 0;
        movementInitialized = false;
    }

    private void resetPackets() {
        packetWindowAt = 0L;
        packetCount = 0;
        highPacketWindows = 0;
    }

    public void resetBreakEvidence() {
        resetBreaks();
    }

    private void resetBreaks() {
        breakCursor = 0;
        breakCount = 0;
    }

    private static int evidence(boolean suspicious, int current) {
        return suspicious ? Math.min(100_000, current + 1) : Math.max(0, current - 2);
    }

    private static int boundedSamples(int value) {
        return Math.max(2, Math.min(20, value));
    }

    private static boolean withinWindow(long now, long startedAt, long windowMillis) {
        long window = Math.max(250L, Math.min(10_000L, windowMillis));
        return startedAt > 0L && now >= startedAt && now - startedAt <= window;
    }

    private static double square(double value) {
        return value * value;
    }
}
