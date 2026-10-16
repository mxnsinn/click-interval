package dev.proximityvoice.core;

import java.net.SocketAddress;
import java.util.Objects;
import java.util.function.LongSupplier;

/**
 * Fixed-memory admission control for work performed before packet authentication.
 *
 * <p>The endpoint budget intentionally uses a fixed array of hashed stripes instead
 * of a map. An unauthenticated sender can therefore never grow relay memory by
 * rotating spoofed source addresses. The global budget limits aggregate work if an
 * attacker spreads traffic across every stripe.</p>
 */
final class PreAuthRateLimiter {
    private static final int DEFAULT_ENDPOINT_STRIPES = 2_048;
    private static final double GLOBAL_PACKET_BURST = 4_096.0;
    private static final double GLOBAL_PACKETS_PER_SECOND = 2_048.0;
    private static final double GLOBAL_BYTE_BURST = 4.0 * 1024.0 * 1024.0;
    private static final double GLOBAL_BYTES_PER_SECOND = 2.0 * 1024.0 * 1024.0;
    private static final double ENDPOINT_PACKET_BURST = 256.0;
    private static final double ENDPOINT_PACKETS_PER_SECOND = 128.0;
    private static final double ENDPOINT_BYTE_BURST = 256.0 * 1024.0;
    private static final double ENDPOINT_BYTES_PER_SECOND = 128.0 * 1024.0;

    private final TokenBucket globalPackets;
    private final TokenBucket globalBytes;
    private final TokenBucket[] endpointPackets;
    private final TokenBucket[] endpointBytes;

    PreAuthRateLimiter() {
        this(DEFAULT_ENDPOINT_STRIPES,
                GLOBAL_PACKET_BURST, GLOBAL_PACKETS_PER_SECOND,
                GLOBAL_BYTE_BURST, GLOBAL_BYTES_PER_SECOND,
                ENDPOINT_PACKET_BURST, ENDPOINT_PACKETS_PER_SECOND,
                ENDPOINT_BYTE_BURST, ENDPOINT_BYTES_PER_SECOND,
                System::nanoTime);
    }

    PreAuthRateLimiter(
            int endpointStripes,
            double globalPacketBurst,
            double globalPacketsPerSecond,
            double globalByteBurst,
            double globalBytesPerSecond,
            double endpointPacketBurst,
            double endpointPacketsPerSecond,
            double endpointByteBurst,
            double endpointBytesPerSecond,
            LongSupplier nanoClock
    ) {
        if (endpointStripes <= 0 || (endpointStripes & (endpointStripes - 1)) != 0) {
            throw new IllegalArgumentException("Endpoint stripe count must be a positive power of two.");
        }
        Objects.requireNonNull(nanoClock, "nanoClock");
        globalPackets = new TokenBucket(globalPacketBurst, globalPacketsPerSecond, nanoClock);
        globalBytes = new TokenBucket(globalByteBurst, globalBytesPerSecond, nanoClock);
        endpointPackets = new TokenBucket[endpointStripes];
        endpointBytes = new TokenBucket[endpointStripes];
        for (int index = 0; index < endpointStripes; index++) {
            endpointPackets[index] = new TokenBucket(
                    endpointPacketBurst, endpointPacketsPerSecond, nanoClock);
            endpointBytes[index] = new TokenBucket(
                    endpointByteBurst, endpointBytesPerSecond, nanoClock);
        }
    }

    synchronized boolean allow(SocketAddress remote, int bytes) {
        if (remote == null || bytes <= 0 || bytes > Protocol.MAX_DATAGRAM_BYTES) return false;
        int stripe = endpointStripeIndex(remote);

        // Preflight all four private buckets while holding this limiter's lock.
        // In particular, an exhausted endpoint stripe returns before spending the
        // shared budget, so one noisy endpoint cannot starve unrelated clients.
        if (!has(endpointPackets[stripe], 1.0) || !has(endpointBytes[stripe], bytes)) return false;
        if (!has(globalPackets, 1.0) || !has(globalBytes, bytes)) return false;

        // The buckets are private and every admission is serialized by this method;
        // after the preflight these operations cannot fail or partially admit.
        return endpointPackets[stripe].tryConsume(1.0)
                && endpointBytes[stripe].tryConsume(bytes)
                && globalPackets.tryConsume(1.0)
                && globalBytes.tryConsume(bytes);
    }

    int endpointStripeCount() {
        return endpointPackets.length;
    }

    int endpointStripeIndex(SocketAddress remote) {
        return smear(Objects.requireNonNull(remote, "remote").hashCode())
                & (endpointPackets.length - 1);
    }

    private static boolean has(TokenBucket bucket, double amount) {
        return bucket.available() + 1.0e-9 >= amount;
    }

    private static int smear(int hash) {
        hash ^= hash >>> 16;
        hash *= 0x7feb352d;
        hash ^= hash >>> 15;
        hash *= 0x846ca68b;
        return hash ^ hash >>> 16;
    }
}
