package dev.serverteleport.fabric.core;

import java.util.Objects;

/** Pure, bounded state for a private combat-teleport countdown. */
public final class TeleportWarmupState {
    public static final long DURATION_MILLIS = 10_000L;

    public enum Status {
        WAITING,
        COUNTDOWN,
        COMPLETE,
        MOVED,
        UNSAFE
    }

    public record Update(Status status, int secondsRemaining) {
        public Update {
            Objects.requireNonNull(status, "status");
            if (secondsRemaining < 0 || secondsRemaining > 10) {
                throw new IllegalArgumentException("seconds remaining must be between 0 and 10");
            }
        }
    }

    private final String dimension;
    private final double startX;
    private final double startY;
    private final double startZ;
    private final long deadlineMillis;
    private int lastAnnouncedSecond = 10;

    public TeleportWarmupState(long startedAtMillis, String dimension, double x, double y, double z) {
        if (startedAtMillis < 0L) throw new IllegalArgumentException("start time must not be negative");
        this.dimension = Objects.requireNonNull(dimension, "dimension");
        if (dimension.isBlank()) throw new IllegalArgumentException("dimension must not be blank");
        if (!finite(x, y, z)) throw new IllegalArgumentException("start position must be finite");
        startX = x;
        startY = y;
        startZ = z;
        deadlineMillis = safeAdd(startedAtMillis, DURATION_MILLIS);
    }

    public Update update(
            long nowMillis,
            String currentDimension,
            double x,
            double y,
            double z,
            boolean safe) {
        if (!safe || !dimension.equals(currentDimension) || !finite(x, y, z)) {
            return new Update(Status.UNSAFE, secondsRemaining(nowMillis));
        }
        // Compare only the server-authoritative position. Rotation, inventory actions, and hotbar
        // selection never reach this state, while walking, jumping, falling, vehicle motion,
        // knockback, pistons, and other pushes all change at least one coordinate. Deliberately do
        // not allow a distance tolerance: combat teleporting requires the player to remain fully
        // still, and a tolerance lets slow movement evade the warmup.
        if (Double.compare(startX, x) != 0
                || Double.compare(startY, y) != 0
                || Double.compare(startZ, z) != 0) {
            return new Update(Status.MOVED, secondsRemaining(nowMillis));
        }
        long remaining = deadlineMillis - nowMillis;
        if (remaining <= 0L) return new Update(Status.COMPLETE, 0);
        int seconds = (int) Math.min(10L, (remaining + 999L) / 1_000L);
        if (seconds < lastAnnouncedSecond) {
            lastAnnouncedSecond = seconds;
            return new Update(Status.COUNTDOWN, seconds);
        }
        return new Update(Status.WAITING, seconds);
    }

    private int secondsRemaining(long nowMillis) {
        long remaining = Math.max(0L, deadlineMillis - nowMillis);
        return (int) Math.min(10L, (remaining + 999L) / 1_000L);
    }

    private static boolean finite(double x, double y, double z) {
        return Double.isFinite(x) && Double.isFinite(y) && Double.isFinite(z);
    }

    private static long safeAdd(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException overflow) {
            return Long.MAX_VALUE;
        }
    }
}
