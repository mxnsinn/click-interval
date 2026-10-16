package dev.serverteleport.fabric.core;

import java.util.Objects;

/** Pure state for holding a login position until its destination chunk is actually ready. */
public final class LoginSafetyState {
    public static final long TIMEOUT_MILLIS = 30_000L;
    private static final int REQUIRED_READY_TICKS = 2;

    public enum Status {
        HOLD,
        RELEASE,
        DIMENSION_CHANGED,
        TIMED_OUT
    }

    private final String dimension;
    private final double x;
    private final double y;
    private final double z;
    private final float yaw;
    private final float pitch;
    private final long deadlineMillis;
    private int readyTicks;

    public LoginSafetyState(
            long startedAtMillis,
            String dimension,
            double x,
            double y,
            double z,
            float yaw,
            float pitch) {
        if (startedAtMillis < 0L) throw new IllegalArgumentException("start time must not be negative");
        this.dimension = Objects.requireNonNull(dimension, "dimension");
        if (dimension.isBlank()) throw new IllegalArgumentException("dimension must not be blank");
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || !Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            throw new IllegalArgumentException("login position must be finite");
        }
        this.x = x;
        this.y = y;
        this.z = z;
        this.yaw = yaw;
        this.pitch = pitch;
        deadlineMillis = safeAdd(startedAtMillis, TIMEOUT_MILLIS);
    }

    public Status update(long nowMillis, String currentDimension, boolean chunkReady) {
        if (!dimension.equals(currentDimension)) return Status.DIMENSION_CHANGED;
        if (chunkReady) {
            readyTicks++;
            if (readyTicks >= REQUIRED_READY_TICKS) return Status.RELEASE;
        } else {
            readyTicks = 0;
        }
        return nowMillis >= deadlineMillis ? Status.TIMED_OUT : Status.HOLD;
    }

    public String dimension() {
        return dimension;
    }

    public double x() {
        return x;
    }

    public double y() {
        return y;
    }

    public double z() {
        return z;
    }

    public float yaw() {
        return yaw;
    }

    public float pitch() {
        return pitch;
    }

    private static long safeAdd(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException overflow) {
            return Long.MAX_VALUE;
        }
    }
}
