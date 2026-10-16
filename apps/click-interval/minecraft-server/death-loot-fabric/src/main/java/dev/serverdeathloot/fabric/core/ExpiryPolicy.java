package dev.serverdeathloot.fabric.core;

public final class ExpiryPolicy {
    private ExpiryPolicy() {}

    public static long deadlineMillis(long nowMillis, int lifetimeSeconds) {
        if (lifetimeSeconds == 0) return 0L;
        if (lifetimeSeconds < 0) throw new IllegalArgumentException("lifetimeSeconds cannot be negative");
        long durationMillis = Math.multiplyExact((long) lifetimeSeconds, 1_000L);
        try {
            return Math.addExact(nowMillis, durationMillis);
        } catch (ArithmeticException ignored) {
            return Long.MAX_VALUE;
        }
    }

    public static boolean isExpired(long deadlineMillis, long nowMillis) {
        return deadlineMillis > 0L && nowMillis >= deadlineMillis;
    }
}
