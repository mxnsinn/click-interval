package com.clickinterval.anticheat.core;

/**
 * Allocation-free vertical movement evidence. The Bukkit adapter supplies a support result
 * derived from server collision shapes; a client ground claim is diagnostic only and can never
 * clear evidence by itself.
 */
public final class FlightEvidence {
    private static final double ASCENT_MINIMUM_PER_TICK = 0.22;
    private static final double DESCENT_MAXIMUM_PER_TICK = -0.045;
    private static final double CONTROLLED_DESCENT_MINIMUM_PER_TICK = -2.0;
    private static final double MINIMUM_NATURAL_GRAVITY_CHANGE = 0.02;
    private static final int SUSTAINED_DIRECTIONAL_TICKS = 8;
    private static final int REPORT_INTERVAL_TICKS = 10;

    private int hoverTicks;
    private int ascentTicks;
    private int descentTicks;
    private double lastVerticalPerTick;
    private boolean verticalInitialized;

    public Assessment observe(Sample sample, int configuredMaxAirTicks) {
        if (sample == null || sample.exempt() || sample.serverSupported()
                || !Double.isFinite(sample.verticalDelta())) {
            reset();
            return Assessment.NONE;
        }

        int elapsedTicks = Math.max(1, Math.min(5, sample.elapsedTicks()));
        int maxAirTicks = Math.max(20, Math.min(2_000, configuredMaxAirTicks));
        double verticalPerTick = sample.verticalDelta() / elapsedTicks;
        Motion motion;
        int evidenceTicks;
        int threshold;

        if (verticalPerTick > ASCENT_MINIMUM_PER_TICK) {
            hoverTicks = 0;
            descentTicks = 0;
            ascentTicks = continuesWithoutNaturalGravity(verticalPerTick, true)
                    ? boundedAdd(ascentTicks, elapsedTicks)
                    : elapsedTicks;
            motion = Motion.ASCENT;
            evidenceTicks = ascentTicks;
            threshold = SUSTAINED_DIRECTIONAL_TICKS;
        } else if (verticalPerTick < DESCENT_MAXIMUM_PER_TICK) {
            hoverTicks = 0;
            ascentTicks = 0;
            boolean controlledDescent = verticalPerTick >= CONTROLLED_DESCENT_MINIMUM_PER_TICK
                    && continuesWithoutNaturalGravity(verticalPerTick, false);
            descentTicks = controlledDescent ? boundedAdd(descentTicks, elapsedTicks) : elapsedTicks;
            motion = Motion.CONTROLLED_DESCENT;
            evidenceTicks = descentTicks;
            threshold = SUSTAINED_DIRECTIONAL_TICKS;
        } else {
            ascentTicks = 0;
            descentTicks = 0;
            hoverTicks = boundedAdd(hoverTicks, elapsedTicks);
            motion = Motion.HOVER;
            evidenceTicks = hoverTicks;
            threshold = maxAirTicks + 1;
        }

        lastVerticalPerTick = verticalPerTick;
        verticalInitialized = true;
        boolean report = shouldReport(evidenceTicks, threshold, elapsedTicks);
        return new Assessment(report, motion, evidenceTicks, verticalPerTick,
                sample.clientOnGround() && !sample.serverSupported());
    }

    public void reset() {
        hoverTicks = 0;
        ascentTicks = 0;
        descentTicks = 0;
        lastVerticalPerTick = 0.0;
        verticalInitialized = false;
    }

    private boolean continuesWithoutNaturalGravity(double verticalPerTick, boolean ascending) {
        if (!verticalInitialized) return false;
        if (ascending && lastVerticalPerTick <= ASCENT_MINIMUM_PER_TICK) return false;
        if (!ascending && (lastVerticalPerTick >= DESCENT_MAXIMUM_PER_TICK
                || lastVerticalPerTick < CONTROLLED_DESCENT_MINIMUM_PER_TICK)) return false;
        // Normal airborne motion loses roughly 0.08 blocks/tick of vertical speed to gravity.
        // Sustained flight instead keeps the same vertical speed or loses almost none.
        return verticalPerTick - lastVerticalPerTick >= -MINIMUM_NATURAL_GRAVITY_CHANGE;
    }

    private static boolean shouldReport(int evidenceTicks, int threshold, int elapsedTicks) {
        if (evidenceTicks < threshold) return false;
        if (evidenceTicks - elapsedTicks < threshold) return true;
        int previousBucket = (evidenceTicks - elapsedTicks - threshold) / REPORT_INTERVAL_TICKS;
        int currentBucket = (evidenceTicks - threshold) / REPORT_INTERVAL_TICKS;
        return currentBucket > previousBucket;
    }

    private static int boundedAdd(int value, int increment) {
        return Math.min(100_000, value + increment);
    }

    public enum Motion {
        NONE,
        HOVER,
        ASCENT,
        CONTROLLED_DESCENT
    }

    public record Sample(double verticalDelta, int elapsedTicks, boolean clientOnGround,
                         boolean serverSupported, boolean exempt) { }

    public record Assessment(boolean report, Motion motion, int evidenceTicks,
                             double verticalPerTick, boolean unsupportedGroundClaim) {
        public static final Assessment NONE = new Assessment(false, Motion.NONE, 0, 0.0, false);
    }
}
