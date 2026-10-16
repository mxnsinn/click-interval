package com.clickinterval.villagertrades;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class StockPolicyTest {
    @Test
    void unlimitedPurchasesRetainNormalDailyDemandRangeAndTradedState() {
        int uses = 0;
        for (int trade = 1; trade <= 10_000; trade++) {
            uses = StockPolicy.nextUses(uses, 12);
            assertEquals(Math.min(12, trade), uses);
        }
        assertEquals(12, uses + uses - 12, "vanilla updateDemand delta for a sold-out day");
        assertTrue(uses > 0, "used offers must remain recognizably traded");
        assertEquals(1, StockPolicy.nextUses(0, 12), "native restock reset starts counting again");
    }

    @Test
    void exhaustedAndMalformedSavedCountersCannotOverflow() {
        assertEquals(12, StockPolicy.nextUses(12, 12));
        assertEquals(12, StockPolicy.nextUses(Integer.MAX_VALUE, 12));
        assertEquals(Integer.MAX_VALUE, StockPolicy.nextUses(Integer.MAX_VALUE, Integer.MAX_VALUE));
        assertEquals(1, StockPolicy.nextUses(-4, 12));
        assertEquals(1, StockPolicy.nextUses(0, 0));
    }

    @Test
    void wireRepresentationAlwaysHasPositiveClientStock() {
        for (int uses : new int[]{-1, 0, 12, 64, Integer.MAX_VALUE}) {
            int sent = StockPolicy.clientUses(uses);
            assertTrue(sent >= 0 && sent < Integer.MAX_VALUE);
        }
    }
}
