package com.clickinterval.anticheat.core;

/**
 * Pure reach geometry and evidence handling. Bukkit objects deliberately stay out of this class so
 * the edge cases can be tested without starting a server.
 */
public final class ReachCheckMath {
    private ReachCheckMath() {
    }

    public static Assessment assess(
            Point eye,
            Box target,
            Point targetVelocityPerTick,
            double configuredReach,
            double serverInteractionRange,
            int pingMillis,
            double tps,
            Parameters parameters
    ) {
        if (parameters == null) throw new IllegalArgumentException("Reach parameters are required");
        int boundedPing = Math.max(0, pingMillis);
        double boundedTps = Math.max(0.0, Math.min(20.0, finiteOr(tps, 20.0)));
        double baseReach = Math.max(
                Math.max(0.0, finiteOr(configuredReach, 0.0)),
                Math.max(0.0, finiteOr(serverInteractionRange, 0.0)));

        // A client sees a moving target slightly behind its current server position. Compare the
        // current hitbox and one tightly bounded rewind rather than granting blanket extra reach.
        double rewindTicks = Math.min(
                parameters.maxRewindTicks(),
                parameters.baseRewindTicks() + boundedPing * parameters.pingRewindTicksPerMs());
        Point rewind = targetVelocityPerTick.scale(-rewindTicks)
                .limitLength(parameters.maxTargetRewind());
        Box rewoundTarget = target.shift(rewind);
        double observed = Math.min(distanceToBox(eye, target), distanceToBox(eye, rewoundTarget));

        double pingAllowance = Math.min(
                parameters.maxPingAllowance(),
                boundedPing * parameters.pingAllowancePerMs());
        double tickAllowance = Math.min(
                parameters.maxTickAllowance(),
                Math.max(0.0, 20.0 - boundedTps) * parameters.tickAllowancePerMissingTps());
        double allowed = baseReach + parameters.geometryAllowance() + pingAllowance + tickAllowance;
        return new Assessment(observed, allowed, Math.max(0.0, observed - allowed));
    }

    public static double distanceToBox(Point point, Box box) {
        double dx = axisDistance(point.x(), box.minX(), box.maxX());
        double dy = axisDistance(point.y(), box.minY(), box.maxY());
        double dz = axisDistance(point.z(), box.minZ(), box.maxZ());
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static double axisDistance(double value, double minimum, double maximum) {
        if (value < minimum) return minimum - value;
        if (value > maximum) return value - maximum;
        return 0.0;
    }

    private static double finiteOr(double value, double fallback) {
        return Double.isFinite(value) ? value : fallback;
    }

    public record Assessment(double observed, double allowed, double excess) {
        public boolean suspicious() {
            return excess > 0.0;
        }
    }

    /** Runtime-tunable reconciliation parameters with conservative safety bounds. */
    public record Parameters(
            double geometryAllowance,
            double maxPingAllowance,
            double pingAllowancePerMs,
            double maxTickAllowance,
            double tickAllowancePerMissingTps,
            double maxTargetRewind,
            double baseRewindTicks,
            double pingRewindTicksPerMs,
            double maxRewindTicks,
            double immediateExcess,
            int consecutiveSamples,
            long evidenceWindowMillis
    ) {
        public Parameters {
            geometryAllowance = clampFinite(geometryAllowance, 0.025, 0.25, 0.05);
            maxPingAllowance = clampFinite(maxPingAllowance, 0.15, 0.50, 0.25);
            pingAllowancePerMs = clampFinite(pingAllowancePerMs, 0.0005, 0.002, 0.0008);
            maxTickAllowance = clampFinite(maxTickAllowance, 0.05, 0.25, 0.10);
            tickAllowancePerMissingTps = clampFinite(
                    tickAllowancePerMissingTps, 0.025, 0.10, 0.05);
            maxTargetRewind = clampFinite(maxTargetRewind, 0.25, 0.75, 0.45);
            baseRewindTicks = clampFinite(baseRewindTicks, 0.25, 1.50, 0.50);
            pingRewindTicksPerMs = clampFinite(pingRewindTicksPerMs, 0.005, 0.020, 0.010);
            maxRewindTicks = clampFinite(maxRewindTicks, 1.50, 5.00, 3.00);
            immediateExcess = clampFinite(immediateExcess, 0.50, 2.00, 0.75);
            consecutiveSamples = Math.max(2, Math.min(6, consecutiveSamples));
            evidenceWindowMillis = Math.max(750L, Math.min(5_000L, evidenceWindowMillis));
        }

        public static Parameters balancedDefaults() {
            return new Parameters(
                    0.05,
                    0.25,
                    0.0008,
                    0.10,
                    0.05,
                    0.45,
                    0.50,
                    0.010,
                    3.00,
                    0.75,
                    2,
                    1_250L
            );
        }

        private static double clampFinite(double value, double minimum, double maximum, double fallback) {
            if (!Double.isFinite(value)) return fallback;
            return Math.max(minimum, Math.min(maximum, value));
        }
    }

    public record Point(double x, double y, double z) {
        public Point {
            if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
                throw new IllegalArgumentException("Point coordinates must be finite");
            }
        }

        public Point scale(double multiplier) {
            return new Point(x * multiplier, y * multiplier, z * multiplier);
        }

        public Point limitLength(double maximum) {
            double lengthSquared = x * x + y * y + z * z;
            double maximumSquared = maximum * maximum;
            if (lengthSquared <= maximumSquared || lengthSquared == 0.0) return this;
            return scale(maximum / Math.sqrt(lengthSquared));
        }
    }

    public record Box(double minX, double minY, double minZ, double maxX, double maxY, double maxZ) {
        public Box {
            if (!Double.isFinite(minX) || !Double.isFinite(minY) || !Double.isFinite(minZ)
                    || !Double.isFinite(maxX) || !Double.isFinite(maxY) || !Double.isFinite(maxZ)) {
                throw new IllegalArgumentException("Box coordinates must be finite");
            }
            if (minX > maxX || minY > maxY || minZ > maxZ) {
                throw new IllegalArgumentException("Box minimums cannot exceed maximums");
            }
        }

        public Box shift(Point shift) {
            return new Box(
                    minX + shift.x(), minY + shift.y(), minZ + shift.z(),
                    maxX + shift.x(), maxY + shift.y(), maxZ + shift.z());
        }
    }

    /**
     * Prevents a single borderline sample from becoming a warning. Clearly impossible reach is
     * still reported immediately; smaller excesses require two consecutive hits.
     */
    public static final class EvidenceGate {
        private int consecutive;
        private long lastSuspiciousAt = Long.MIN_VALUE;

        public synchronized boolean observe(Assessment assessment, Parameters parameters, long nowMillis) {
            if (parameters == null) throw new IllegalArgumentException("Reach parameters are required");
            if (!assessment.suspicious()) {
                reset();
                return false;
            }
            if (assessment.excess() >= parameters.immediateExcess()) {
                reset();
                return true;
            }
            if (lastSuspiciousAt == Long.MIN_VALUE || nowMillis < lastSuspiciousAt
                    || nowMillis - lastSuspiciousAt > parameters.evidenceWindowMillis()) {
                consecutive = 1;
            } else {
                consecutive++;
            }
            lastSuspiciousAt = nowMillis;
            if (consecutive < parameters.consecutiveSamples()) return false;
            reset();
            return true;
        }

        public synchronized void reset() {
            consecutive = 0;
            lastSuspiciousAt = Long.MIN_VALUE;
        }
    }
}
