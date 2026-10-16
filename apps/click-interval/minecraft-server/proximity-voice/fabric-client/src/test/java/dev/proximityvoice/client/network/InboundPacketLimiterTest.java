package dev.proximityvoice.client.network;

import dev.proximityvoice.client.protocol.Protocol;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InboundPacketLimiterTest {
    @Test
    void appliesPacketAndByteLimitsWithoutPartialSpending() {
        AtomicLong nanos = new AtomicLong(1_000L);
        InboundPacketLimiter limiter = new InboundPacketLimiter(
                2.0, 1.0,
                100.0, 50.0,
                nanos::get);

        assertTrue(limiter.allow(60));
        assertFalse(limiter.allow(50), "byte rejection must happen before either budget is spent");
        assertTrue(limiter.allow(40), "rejected datagram did not spend the last packet token");
        assertFalse(limiter.allow(1), "packet burst is bounded");

        nanos.addAndGet(1_000_000_000L);
        assertTrue(limiter.allow(50), "both budgets refill monotonically");
    }

    @Test
    void rejectsInvalidDatagramSizes() {
        InboundPacketLimiter limiter = new InboundPacketLimiter(
                2.0, 1.0,
                Protocol.MAX_DATAGRAM_BYTES * 2.0,
                Protocol.MAX_DATAGRAM_BYTES,
                System::nanoTime);
        assertFalse(limiter.allow(0));
        assertFalse(limiter.allow(Protocol.MAX_DATAGRAM_BYTES + 1));
    }
}
