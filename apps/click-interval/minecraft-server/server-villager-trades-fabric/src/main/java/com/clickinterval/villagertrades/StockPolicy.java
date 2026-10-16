package com.clickinterval.villagertrades;

public final class StockPolicy {
    private StockPolicy() { }

    /** Preserve one day's normal demand range even after arbitrarily many paid transactions. */
    public static int nextUses(int uses, int originalMaxUses) {
        long ceiling = Math.max(1, originalMaxUses);
        return (int) Math.min(ceiling, Math.max(0L, uses) + 1L);
    }

    /** Vanilla clients need a positive available stock value even when the saved offer is exhausted. */
    public static int clientUses(int uses) {
        return Math.min(Integer.MAX_VALUE - 1, Math.max(0, uses));
    }
}
