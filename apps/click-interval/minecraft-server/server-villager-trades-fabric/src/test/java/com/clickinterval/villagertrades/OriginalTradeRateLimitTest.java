package com.clickinterval.villagertrades;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class OriginalTradeRateLimitTest {
    @Test void permitsFirstClickAndNormalBurstButBoundsSpam() {
        var limit = new OriginalTradeRateLimit();
        for (int i = 0; i < 8; i++) assertTrue(limit.acquire(100));
        for (int i = 0; i < 10000; i++) assertFalse(limit.acquire(100));
        assertFalse(limit.acquire(119));
        assertTrue(limit.acquire(120));
    }
    @Test void independentPlayersAndWorldTickResetDoNotBlockNormalClicks() {
        var first = new OriginalTradeRateLimit();
        var second = new OriginalTradeRateLimit();
        for (int i = 0; i < 8; i++) assertTrue(first.acquire(100));
        assertTrue(second.acquire(100));
        assertTrue(first.acquire(0));
    }
}
