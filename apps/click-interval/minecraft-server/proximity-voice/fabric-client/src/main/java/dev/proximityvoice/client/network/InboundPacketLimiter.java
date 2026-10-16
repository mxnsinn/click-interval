package dev.proximityvoice.client.network;

import dev.proximityvoice.client.protocol.Protocol;

import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * Fixed-memory aggregate admission control for packets received from the voice
 * relay. A connected UDP socket authenticates the sender address, but a broken
 * or hostile relay must still be unable to make the client decrypt and allocate
 * without a bound.
 */
final class InboundPacketLimiter {
    private final double packetCapacity;
    private final double packetsPerNanosecond;
    private final double byteCapacity;
    private final double bytesPerNanosecond;
    private final LongSupplier nanoClock;
    private double packetTokens;
    private double byteTokens;
    private long lastRefill;

    InboundPacketLimiter(
            double packetCapacity,
            double packetsPerSecond,
            double byteCapacity,
            double bytesPerSecond,
            LongSupplier nanoClock
    ) {
        if (!finitePositive(packetCapacity) || !finitePositive(packetsPerSecond)
                || !finitePositive(byteCapacity) || !finitePositive(bytesPerSecond)) {
            throw new IllegalArgumentException("Inbound packet limits must be positive and finite");
        }
        this.packetCapacity = packetCapacity;
        this.packetsPerNanosecond = packetsPerSecond / 1_000_000_000.0;
        this.byteCapacity = byteCapacity;
        this.bytesPerNanosecond = bytesPerSecond / 1_000_000_000.0;
        this.nanoClock = Objects.requireNonNull(nanoClock, "nanoClock");
        packetTokens = packetCapacity;
        byteTokens = byteCapacity;
        lastRefill = nanoClock.getAsLong();
    }

    boolean allow(int bytes) {
        if (bytes <= 0 || bytes > Protocol.MAX_DATAGRAM_BYTES) return false;
        refill();
        if (packetTokens + 1.0e-9 < 1.0 || byteTokens + 1.0e-9 < bytes) return false;
        packetTokens -= 1.0;
        byteTokens -= bytes;
        return true;
    }

    private void refill() {
        long now = nanoClock.getAsLong();
        long elapsed = now - lastRefill;
        if (elapsed > 0L) {
            packetTokens = Math.min(packetCapacity, packetTokens + elapsed * packetsPerNanosecond);
            byteTokens = Math.min(byteCapacity, byteTokens + elapsed * bytesPerNanosecond);
            lastRefill = now;
        } else if (elapsed < 0L) {
            lastRefill = now;
        }
    }

    private static boolean finitePositive(double value) {
        return Double.isFinite(value) && value > 0.0;
    }
}
