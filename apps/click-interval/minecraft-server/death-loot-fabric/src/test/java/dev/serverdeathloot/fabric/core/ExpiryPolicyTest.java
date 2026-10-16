package dev.serverdeathloot.fabric.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExpiryPolicyTest {
    @Test
    void zeroLifetimeNeverExpires() {
        assertEquals(0L, ExpiryPolicy.deadlineMillis(500L, 0));
        assertFalse(ExpiryPolicy.isExpired(0L, Long.MAX_VALUE));
    }

    @Test
    void deadlineUsesWallClockSeconds() {
        assertEquals(31_000L, ExpiryPolicy.deadlineMillis(1_000L, 30));
    }

    @Test
    void exactDeadlineIsExpired() {
        assertFalse(ExpiryPolicy.isExpired(10_000L, 9_999L));
        assertTrue(ExpiryPolicy.isExpired(10_000L, 10_000L));
        assertTrue(ExpiryPolicy.isExpired(10_000L, 10_001L));
    }

    @Test
    void overflowingDeadlineSaturates() {
        assertEquals(Long.MAX_VALUE, ExpiryPolicy.deadlineMillis(Long.MAX_VALUE - 500L, 1));
    }

    @Test
    void negativeLifetimeIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> ExpiryPolicy.deadlineMillis(0L, -1));
    }
}
