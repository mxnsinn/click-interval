package dev.serverenchantments.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class SmeltAmountsTest {
    @Test void preservesFortuneAndRecipeCounts() {
        assertEquals(17, SmeltAmounts.total(17, 1, 64, 256));
        assertEquals(51, SmeltAmounts.total(17, 3, 64, 256));
        assertEquals(130, SmeltAmounts.total(65, 2, 64, 3));
    }
    @Test void respectsExactOutputSlotAndPerInputBounds() {
        assertEquals(128, SmeltAmounts.total(128, 1, 64, 2));
        assertEquals(0, SmeltAmounts.total(129, 1, 64, 2));
        assertEquals(4096, SmeltAmounts.total(4096, 1, 64, 256));
        assertEquals(0, SmeltAmounts.total(4097, 1, 64, 256));
        assertEquals(64, SmeltAmounts.total(64, 1, 1, 256));
        assertEquals(0, SmeltAmounts.total(65, 1, 1, 256));
    }
    @Test void malformedOrOverflowingCountsFailBackToNativeLoot() {
        assertEquals(0, SmeltAmounts.total(Integer.MAX_VALUE, Integer.MAX_VALUE, 64, 256));
        assertEquals(0, SmeltAmounts.total(1, 0, 64, 256));
        assertEquals(0, SmeltAmounts.total(-1, 1, 64, 256));
        assertEquals(0, SmeltAmounts.total(1, 1, 0, 256));
        assertEquals(0, SmeltAmounts.total(1, 1, 64, 0));
    }
}
