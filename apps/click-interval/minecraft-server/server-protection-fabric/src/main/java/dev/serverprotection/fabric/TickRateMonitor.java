package dev.serverprotection.fabric;

/** Monotonic, bounded EWMA of server tick rate. */
public final class TickRateMonitor {
    private long lastTickNanos;
    private double tps = 20.0;

    public double tick(long nowNanos) {
        if (lastTickNanos != 0L && nowNanos > lastTickNanos) {
            double elapsedMillis = Math.min(1_000.0, (nowNanos - lastTickNanos) / 1_000_000.0);
            double instantaneous = Math.max(1.0, Math.min(20.0, 1_000.0 / Math.max(50.0, elapsedMillis)));
            tps = tps * 0.90 + instantaneous * 0.10;
        }
        lastTickNanos = nowNanos;
        return tps;
    }

    public double tps() {
        return tps;
    }
}
