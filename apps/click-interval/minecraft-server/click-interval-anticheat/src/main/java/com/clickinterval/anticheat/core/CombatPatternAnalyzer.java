package com.clickinterval.anticheat.core;

import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;

/**
 * Fixed-capacity, allocation-free combat sequence analysis shared by the Bukkit and Fabric
 * adapters. The analyzer deliberately needs repeated evidence: one delayed rotation packet or one
 * quick target change must never be enough to accuse a player.
 */
public final class CombatPatternAnalyzer {
    public static final int AIM_DIRECTION = 1;
    public static final int RAPID_SWITCH = 1 << 1;
    public static final int CLICK_PATTERN = 1 << 2;
    private static final int MAX_INTERVALS = 24;

    private final long[] intervals = new long[MAX_INTERVALS];
    private int intervalCount;
    private int nextInterval;
    private long lastAttackAt = Long.MIN_VALUE;
    private UUID previousTarget;
    private double previousTargetDirectionX;
    private double previousTargetDirectionY;
    private double previousTargetDirectionZ;
    private boolean previousTargetDirectionInitialized;
    private long previousTargetAt = Long.MIN_VALUE;
    private int aimSamples;
    private long firstAimSampleAt = Long.MIN_VALUE;
    private int switchSamples;
    private long firstSwitchSampleAt = Long.MIN_VALUE;

    public Result observe(Observation observation, Settings settings) {
        Objects.requireNonNull(observation, "observation");
        return observe(observation.targetId(), observation.nowMillis(),
                observation.eye().x(), observation.eye().y(), observation.eye().z(),
                observation.viewDirection().x(), observation.viewDirection().y(), observation.viewDirection().z(),
                observation.targetBox().minX(), observation.targetBox().minY(), observation.targetBox().minZ(),
                observation.targetBox().maxX(), observation.targetBox().maxY(), observation.targetBox().maxZ(),
                settings);
    }

    /**
     * Allocation-light hot-path overload. Adapters that already own primitive entity geometry can
     * avoid constructing Observation/Point/Box wrappers for every attack.
     */
    public synchronized Result observe(
            UUID targetId,
            long now,
            double eyeX,
            double eyeY,
            double eyeZ,
            double viewX,
            double viewY,
            double viewZ,
            double targetMinX,
            double targetMinY,
            double targetMinZ,
            double targetMaxX,
            double targetMaxY,
            double targetMaxZ,
            Settings settings
    ) {
        Objects.requireNonNull(targetId, "targetId");
        Objects.requireNonNull(settings, "settings");
        int flags = 0;

        double targetDirectionX = (targetMinX + targetMaxX) * 0.5 - eyeX;
        double targetDirectionY = (targetMinY + targetMaxY) * 0.5 - eyeY;
        double targetDirectionZ = (targetMinZ + targetMaxZ) * 0.5 - eyeZ;
        double aimDeviation = aimDeviationDegrees(
                viewX, viewY, viewZ,
                targetMinX, targetMinY, targetMinZ, targetMaxX, targetMaxY, targetMaxZ,
                targetDirectionX, targetDirectionY, targetDirectionZ);
        if (Double.isFinite(aimDeviation) && aimDeviation > settings.maxAimDeviationDegrees()) {
            if (firstAimSampleAt == Long.MIN_VALUE || now < firstAimSampleAt
                    || now - firstAimSampleAt > settings.aimEvidenceWindowMillis()) {
                firstAimSampleAt = now;
                aimSamples = 1;
            } else {
                aimSamples = Math.min(100, aimSamples + 1);
            }
            if (aimSamples >= settings.aimEvidenceSamples()) {
                flags |= AIM_DIRECTION;
                aimSamples = 0;
                firstAimSampleAt = Long.MIN_VALUE;
            }
        } else {
            aimSamples = 0;
            firstAimSampleAt = Long.MIN_VALUE;
        }

        double switchAngle = 0.0;
        if (previousTarget != null && !previousTarget.equals(targetId)
                && previousTargetDirectionInitialized && previousTargetAt != Long.MIN_VALUE
                && now >= previousTargetAt
                && now - previousTargetAt <= settings.rapidSwitchMillis()) {
            switchAngle = angleDegrees(
                    previousTargetDirectionX, previousTargetDirectionY, previousTargetDirectionZ,
                    targetDirectionX, targetDirectionY, targetDirectionZ);
            if (Double.isFinite(switchAngle) && switchAngle >= settings.rapidSwitchAngleDegrees()) {
                if (firstSwitchSampleAt == Long.MIN_VALUE || now < firstSwitchSampleAt
                        || now - firstSwitchSampleAt > settings.rapidSwitchEvidenceWindowMillis()) {
                    firstSwitchSampleAt = now;
                    switchSamples = 1;
                } else {
                    switchSamples = Math.min(100, switchSamples + 1);
                }
                if (switchSamples >= settings.rapidSwitchSamples()) {
                    flags |= RAPID_SWITCH;
                    switchSamples = 0;
                    firstSwitchSampleAt = Long.MIN_VALUE;
                }
            } else {
                switchSamples = Math.max(0, switchSamples - 1);
            }
        }
        previousTarget = targetId;
        previousTargetDirectionX = targetDirectionX;
        previousTargetDirectionY = targetDirectionY;
        previousTargetDirectionZ = targetDirectionZ;
        previousTargetDirectionInitialized = true;
        previousTargetAt = now;

        double intervalDeviation = Double.NaN;
        if (lastAttackAt != Long.MIN_VALUE && now > lastAttackAt) {
            long interval = now - lastAttackAt;
            // Ignore held attacks and long combat pauses; neither describes click automation.
            if (interval >= 35L && interval <= 350L) {
                intervals[nextInterval] = interval;
                nextInterval = (nextInterval + 1) % intervals.length;
                intervalCount = Math.min(intervals.length, intervalCount + 1);
                if (intervalCount >= settings.clickPatternSamples()) {
                    intervalDeviation = standardDeviation(intervalCount);
                    if (intervalDeviation <= settings.clickPatternMaxDeviationMillis()) {
                        flags |= CLICK_PATTERN;
                        clearIntervals();
                    }
                }
            } else {
                clearIntervals();
            }
        } else if (lastAttackAt != Long.MIN_VALUE && now < lastAttackAt) {
            clearIntervals();
        }
        lastAttackAt = now;
        return new Result(flags, aimDeviation, switchAngle, intervalDeviation);
    }

    public synchronized void reset() {
        clearIntervals();
        lastAttackAt = Long.MIN_VALUE;
        previousTarget = null;
        previousTargetDirectionX = 0.0;
        previousTargetDirectionY = 0.0;
        previousTargetDirectionZ = 0.0;
        previousTargetDirectionInitialized = false;
        previousTargetAt = Long.MIN_VALUE;
        aimSamples = 0;
        firstAimSampleAt = Long.MIN_VALUE;
        switchSamples = 0;
        firstSwitchSampleAt = Long.MIN_VALUE;
    }

    private void clearIntervals() {
        Arrays.fill(intervals, 0L);
        intervalCount = 0;
        nextInterval = 0;
    }

    private double standardDeviation(int count) {
        double mean = 0.0;
        for (int index = 0; index < count; index++) mean += intervals[index];
        mean /= count;
        double variance = 0.0;
        for (int index = 0; index < count; index++) {
            double difference = intervals[index] - mean;
            variance += difference * difference;
        }
        return Math.sqrt(variance / count);
    }

    static double aimDeviationDegrees(Point eye, Point viewDirection, Box target) {
        double targetDirectionX = (target.minX() + target.maxX()) * 0.5 - eye.x();
        double targetDirectionY = (target.minY() + target.maxY()) * 0.5 - eye.y();
        double targetDirectionZ = (target.minZ() + target.maxZ()) * 0.5 - eye.z();
        return aimDeviationDegrees(
                viewDirection.x(), viewDirection.y(), viewDirection.z(),
                target.minX(), target.minY(), target.minZ(), target.maxX(), target.maxY(), target.maxZ(),
                targetDirectionX, targetDirectionY, targetDirectionZ);
    }

    private static double aimDeviationDegrees(
            double viewX, double viewY, double viewZ,
            double targetMinX, double targetMinY, double targetMinZ,
            double targetMaxX, double targetMaxY, double targetMaxZ,
            double targetDirectionX, double targetDirectionY, double targetDirectionZ
    ) {
        double distance = magnitude(targetDirectionX, targetDirectionY, targetDirectionZ);
        double viewMagnitude = magnitude(viewX, viewY, viewZ);
        if (!Double.isFinite(distance) || !Double.isFinite(viewMagnitude)
                || distance < 1.0e-6 || viewMagnitude < 1.0e-6) return Double.NaN;
        double centerAngle = angleDegrees(
                viewX, viewY, viewZ, targetDirectionX, targetDirectionY, targetDirectionZ);
        double radius = Math.sqrt(
                square((targetMaxX - targetMinX) * 0.5 + 0.15)
                        + square((targetMaxY - targetMinY) * 0.5 + 0.15)
                        + square((targetMaxZ - targetMinZ) * 0.5 + 0.15));
        double angularRadius = Math.toDegrees(Math.asin(Math.min(1.0, radius / distance)));
        return Math.max(0.0, centerAngle - angularRadius);
    }

    private static double angleDegrees(double leftX, double leftY, double leftZ,
                                       double rightX, double rightY, double rightZ) {
        double divisor = magnitude(leftX, leftY, leftZ) * magnitude(rightX, rightY, rightZ);
        if (!Double.isFinite(divisor) || divisor < 1.0e-9) return Double.NaN;
        double dot = leftX * rightX + leftY * rightY + leftZ * rightZ;
        return Math.toDegrees(Math.acos(Math.max(-1.0, Math.min(1.0, dot / divisor))));
    }

    private static double magnitude(double x, double y, double z) {
        return Math.sqrt(square(x) + square(y) + square(z));
    }

    private static double square(double value) {
        return value * value;
    }

    public record Point(double x, double y, double z) { }
    public record Box(double minX, double minY, double minZ,
                      double maxX, double maxY, double maxZ) { }
    public record Observation(UUID targetId, long nowMillis, Point eye,
                              Point viewDirection, Box targetBox) {
        public Observation {
            Objects.requireNonNull(targetId, "targetId");
            Objects.requireNonNull(eye, "eye");
            Objects.requireNonNull(viewDirection, "viewDirection");
            Objects.requireNonNull(targetBox, "targetBox");
        }
    }
    public record Settings(double maxAimDeviationDegrees, int aimEvidenceSamples,
                           long aimEvidenceWindowMillis, long rapidSwitchMillis,
                           double rapidSwitchAngleDegrees, int rapidSwitchSamples,
                           long rapidSwitchEvidenceWindowMillis, int clickPatternSamples,
                           double clickPatternMaxDeviationMillis) {
        public Settings {
            maxAimDeviationDegrees = clamp(maxAimDeviationDegrees, 20.0, 120.0);
            aimEvidenceSamples = (int) clamp(aimEvidenceSamples, 2, 12);
            aimEvidenceWindowMillis = (long) clamp(aimEvidenceWindowMillis, 500, 5_000);
            rapidSwitchMillis = (long) clamp(rapidSwitchMillis, 40, 300);
            rapidSwitchAngleDegrees = clamp(rapidSwitchAngleDegrees, 45.0, 170.0);
            rapidSwitchSamples = (int) clamp(rapidSwitchSamples, 2, 8);
            rapidSwitchEvidenceWindowMillis = (long) clamp(rapidSwitchEvidenceWindowMillis, 300, 5_000);
            clickPatternSamples = (int) clamp(clickPatternSamples, 8, MAX_INTERVALS);
            clickPatternMaxDeviationMillis = clamp(clickPatternMaxDeviationMillis, 0.0, 20.0);
        }

        private static double clamp(double value, double minimum, double maximum) {
            return Double.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
        }
    }
    public record Result(int flags, double aimDeviationDegrees, double switchAngleDegrees,
                         double clickIntervalDeviationMillis) {
        public boolean has(int flag) { return (flags & flag) != 0; }
    }
}
