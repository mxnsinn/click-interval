package dev.serverenchantments.fabric.core;

/** Caps the price, not the transaction validity or the player's permissions. */
public final class AnvilCostPolicy {
    public static final int MAX_SURVIVAL_LEVEL_COST = 39;
    private AnvilCostPolicy() { }

    public static int cappedCost(int nativeCost, boolean infiniteMaterials, int inputCount) {
        // Vanilla deliberately assigns 40 to illegal stacked enchantment inputs.
        // Never turn that rejection sentinel into an allowed bulk-enchant output.
        if (infiniteMaterials || inputCount != 1 || nativeCost <= MAX_SURVIVAL_LEVEL_COST) return nativeCost;
        return MAX_SURVIVAL_LEVEL_COST;
    }
}
