package dev.proximityvoice.core;

import java.util.Objects;
import java.util.function.LongSupplier;

public final class TokenBucket {
    private final double capacity;
    private final double refillPerNanosecond;
    private final LongSupplier nanoClock;
    private double tokens;
    private long lastRefill;

    public TokenBucket(double capacity, double refillPerSecond) {
        this(capacity, refillPerSecond, System::nanoTime);
    }

    public TokenBucket(double capacity, double refillPerSecond, LongSupplier nanoClock) {
        if (!Double.isFinite(capacity) || capacity <= 0.0) {
            throw new IllegalArgumentException("Token capacity must be positive.");
        }
        if (!Double.isFinite(refillPerSecond) || refillPerSecond <= 0.0) {
            throw new IllegalArgumentException("Token refill rate must be positive.");
        }
        this.capacity = capacity;
        this.refillPerNanosecond = refillPerSecond / 1_000_000_000.0;
        this.nanoClock = Objects.requireNonNull(nanoClock, "nanoClock");
        this.tokens = capacity;
        this.lastRefill = nanoClock.getAsLong();
    }

    public synchronized boolean tryConsume(double amount) {
        if (!Double.isFinite(amount) || amount <= 0.0 || amount > capacity) return false;
        refill();
        if (tokens + 1.0e-9 < amount) return false;
        tokens -= amount;
        return true;
    }

    public synchronized double available() {
        refill();
        return tokens;
    }

    private void refill() {
        long now = nanoClock.getAsLong();
        long elapsed = now - lastRefill;
        if (elapsed > 0L) {
            tokens = Math.min(capacity, tokens + elapsed * refillPerNanosecond);
            lastRefill = now;
        } else if (elapsed < 0L) {
            lastRefill = now;
        }
    }
}
