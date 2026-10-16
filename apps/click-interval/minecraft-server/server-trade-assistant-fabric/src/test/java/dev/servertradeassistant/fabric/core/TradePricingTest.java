package dev.servertradeassistant.fabric.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class TradePricingTest {
    @Test
    void clampsDiscountAndNeverMakesAFreeTrade() {
        assertEquals(0, TradePricing.clampDiscountPercent(-4));
        assertEquals(55, TradePricing.clampDiscountPercent(90));
        assertEquals(1, TradePricing.discountedCost(1, 55));
        assertEquals(20, TradePricing.discountedCost(45, 55));
        assertEquals(-25, TradePricing.discountDelta(45, 55));
    }

    @Test
    void zeroDiscountLeavesPriceAlone() {
        assertEquals(32, TradePricing.discountedCost(32, 0));
        assertEquals(0, TradePricing.discountDelta(32, 0));
    }
}
