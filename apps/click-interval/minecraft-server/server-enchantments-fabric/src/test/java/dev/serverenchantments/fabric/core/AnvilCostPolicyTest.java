package dev.serverenchantments.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class AnvilCostPolicyTest {
    @Test void expensiveSingleItemWorkCapsAt39IncludingExactly40AndOverflowSafeNativeMaximum() {
        for (int price : new int[]{40, 41, 127, 255, 1024, Integer.MAX_VALUE})
            assertEquals(39, AnvilCostPolicy.cappedCost(price, false, 1));
    }
    @Test void EveryLowerPriceAndInvalidZeroRemainUnchanged() {
        for (int price = -1; price <= 39; price++) assertEquals(price, AnvilCostPolicy.cappedCost(price, false, 1));
    }
    @Test void creativeUsesItsNativeCostsAndBehavior() {
        for (int price : new int[]{0, 1, 39, 40, 127, Integer.MAX_VALUE})
            assertEquals(price, AnvilCostPolicy.cappedCost(price, true, 1));
    }
    @Test void stackedInputRejectionSentinelNeverTurnsIntoBulkEnchantment() {
        for (int count : new int[]{0, 2, 64}) assertEquals(40, AnvilCostPolicy.cappedCost(40, false, count));
    }
}
