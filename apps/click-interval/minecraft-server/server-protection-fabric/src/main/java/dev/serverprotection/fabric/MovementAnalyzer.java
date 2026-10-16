package dev.serverprotection.fabric;

/** Allocation-free per-player movement evidence. Minecraft-specific exemptions are supplied by the adapter. */
public final class MovementAnalyzer {
    public static final int INVALID_POSITION = 1;
    public static final int HORIZONTAL_SPEED = 1 << 1;
    public static final int VERTICAL_FLIGHT = 1 << 2;
    public static final int PHASE = 1 << 3;

    private static final double ASCENT_MINIMUM_PER_TICK = 0.22;
    private static final double DESCENT_MAXIMUM_PER_TICK = -0.045;
    private static final double CONTROLLED_DESCENT_MINIMUM_PER_TICK = -2.0;
    private static final double MINIMUM_NATURAL_GRAVITY_CHANGE = 0.02;
    private static final int SUSTAINED_DIRECTIONAL_SAMPLES = 8;

    private boolean initialized;
    private double x;
    private double y;
    private double z;
    private int airTicks;
    private int ascentSamples;
    private int descentSamples;
    private int phaseSamples;
    private int speedSamples;
    private double lastVerticalDelta;
    private boolean verticalDeltaInitialized;

    public Result evaluate(Sample sample, ProtectionConfig config) {
        if (!finite(sample.x()) || !finite(sample.y()) || !finite(sample.z())) {
            reset();
            return new Result(INVALID_POSITION, 0.0, 0.0, 0.0, 0, 0);
        }
        if (!initialized || sample.exempt() || sample.grace()) {
            accept(sample);
            return Result.NONE;
        }

        double dx = sample.x() - x;
        double dy = sample.y() - y;
        double dz = sample.z() - z;
        double distanceSquared = dx * dx + dy * dy + dz * dz;
        acceptPosition(sample);

        // A large discontinuity is a teleport/correction, not speed evidence. Smaller same-world
        // teleports are absorbed by the consecutive-sample gate below.
        if (!finite(distanceSquared) || distanceSquared > 256.0) {
            resetEvidence();
            return Result.NONE;
        }
        if (sample.tps() + 1.0e-6 < config.minimumTps()) {
            resetEvidence();
            return Result.NONE;
        }

        int flags = 0;
        double horizontal = Math.sqrt(dx * dx + dz * dz) / Math.max(1, sample.elapsedTicks());
        double attributeScale = Math.max(1.0, Math.min(8.0, sample.movementAttributeScale()));
        double allowed = (sample.groundSupported()
                ? config.movement().maxGroundBlocksPerTick()
                : config.movement().maxAirBlocksPerTick()) * attributeScale;
        // Fluids and vanilla movement surfaces can add server-authored momentum that is not
        // represented by the movement-speed attribute. Keep the check active there, but require
        // stronger, sustained evidence and a small bounded margin. Confirmed knockback/velocity
        // is different: it is authoritative forced movement, so it clears horizontal evidence.
        int requiredSpeedSamples = sample.environmentalMovement() ? 4 : 2;
        if (sample.environmentalMovement()) allowed *= 1.35;
        if (sample.forcedMovement()) {
            speedSamples = 0;
        } else if (horizontal > allowed) {
            speedSamples = Math.min(100, speedSamples + 1);
            if (config.checks().speed() && speedSamples >= requiredSpeedSamples) flags |= HORIZONTAL_SPEED;
        } else {
            speedSamples = 0;
        }

        if (sample.groundSupported() || sample.flightExempt()) {
            resetVerticalEvidence();
        } else if (dy > ASCENT_MINIMUM_PER_TICK) {
            airTicks = 0;
            descentSamples = 0;
            ascentSamples = continuesWithoutNaturalGravity(dy, ASCENT_MINIMUM_PER_TICK)
                    ? Math.min(100_000, ascentSamples + Math.max(1, sample.elapsedTicks()))
                    : Math.max(1, sample.elapsedTicks());
            rememberVerticalDelta(dy);
        } else if (dy < DESCENT_MAXIMUM_PER_TICK) {
            airTicks = 0;
            ascentSamples = 0;
            boolean controlledDescent = dy >= CONTROLLED_DESCENT_MINIMUM_PER_TICK
                    && continuesWithoutNaturalGravity(dy, DESCENT_MAXIMUM_PER_TICK);
            descentSamples = controlledDescent
                    ? Math.min(100_000, descentSamples + Math.max(1, sample.elapsedTicks()))
                    : Math.max(1, sample.elapsedTicks());
            rememberVerticalDelta(dy);
        } else {
            ascentSamples = 0;
            descentSamples = 0;
            airTicks = Math.min(100_000, airTicks + Math.max(1, sample.elapsedTicks()));
            rememberVerticalDelta(dy);
        }
        int verticalEvidence = Math.max(airTicks, Math.max(ascentSamples, descentSamples));
        if (config.checks().flight()
                && (airTicks > config.movement().maxAirTicks()
                || ascentSamples >= SUSTAINED_DIRECTIONAL_SAMPLES
                || descentSamples >= SUSTAINED_DIRECTIONAL_SAMPLES)) {
            flags |= VERTICAL_FLIGHT;
        }

        if (config.checks().phase() && !sample.phaseExempt() && !sample.forcedMovement()
                && !sample.environmentalMovement()
                && !sample.collisionFree() && horizontal > 0.06) {
            phaseSamples = Math.min(100, phaseSamples + 1);
            if (phaseSamples >= config.movement().phaseSamples()) flags |= PHASE;
        } else {
            phaseSamples = 0;
        }
        return new Result(flags, horizontal, dy / Math.max(1, sample.elapsedTicks()), allowed,
                verticalEvidence, phaseSamples);
    }

    public void reset() {
        initialized = false;
        resetVerticalEvidence();
        phaseSamples = 0;
        speedSamples = 0;
    }

    private void accept(Sample sample) {
        initialized = true;
        acceptPosition(sample);
        resetEvidence();
    }

    private void acceptPosition(Sample sample) {
        x = sample.x();
        y = sample.y();
        z = sample.z();
    }

    private void resetEvidence() {
        phaseSamples = 0;
        speedSamples = 0;
        resetVerticalEvidence();
    }

    private boolean continuesWithoutNaturalGravity(double dy, double requiredPreviousDirection) {
        return verticalDeltaInitialized
                && (requiredPreviousDirection > 0.0
                ? lastVerticalDelta > requiredPreviousDirection
                : lastVerticalDelta < requiredPreviousDirection
                        && lastVerticalDelta >= CONTROLLED_DESCENT_MINIMUM_PER_TICK)
                && dy - lastVerticalDelta >= -MINIMUM_NATURAL_GRAVITY_CHANGE;
    }

    private void rememberVerticalDelta(double dy) {
        lastVerticalDelta = dy;
        verticalDeltaInitialized = true;
    }

    private void resetVerticalEvidence() {
        airTicks = 0;
        ascentSamples = 0;
        descentSamples = 0;
        lastVerticalDelta = 0.0;
        verticalDeltaInitialized = false;
    }

    private static boolean finite(double value) {
        return Double.isFinite(value) && Math.abs(value) <= 30_000_100.0;
    }

    public record Sample(double x, double y, double z, boolean groundSupported, boolean exempt,
                          boolean flightExempt, boolean forcedMovement, boolean environmentalMovement,
                          boolean grace, boolean collisionFree, boolean phaseExempt, double movementAttributeScale,
                          double tps, int elapsedTicks) { }

    public record Result(int flags, double horizontalPerTick, double verticalPerTick, double allowedHorizontal,
                         int airTicks, int phaseSamples) {
        static final Result NONE = new Result(0, 0.0, 0.0, 0.0, 0, 0);
        public boolean has(int flag) { return (flags & flag) != 0; }
    }
}
