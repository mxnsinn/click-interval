package dev.servertradeassistant.fabric.core;

/** Pure price math shared by runtime code and tests. */
public final class TradePricing {
    public static final int MAX_DISCOUNT_PERCENT = 55;

    private TradePricing() { }

    public static int clampDiscountPercent(int percent) {
        return Math.max(0, Math.min(MAX_DISCOUNT_PERCENT, percent));
    }

    public static int discountedCost(int currentCost, int percent) {
        int cost = Math.max(1, currentCost);
        int discount = clampDiscountPercent(percent);
        return Math.max(1, (int) Math.floor(cost * (100.0D - discount) / 100.0D));
    }

    /** Value to add to MerchantOffer.specialPriceDiff. Always zero or negative. */
    public static int discountDelta(int currentCost, int percent) {
        int cost = Math.max(1, currentCost);
        return discountedCost(cost, percent) - cost;
    }
}
