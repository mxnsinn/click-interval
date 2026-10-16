package dev.serverenchantments.fabric.core;

/** Hard allocation bounds for unusual data-pack cooking outputs; fail back to native loot. */
public final class SmeltAmounts {
    public static final int MAX_INPUT_STACKS = 128;
    public static final int MAX_OUTPUT_STACKS = 256;
    public static final int MAX_SPLITS_PER_INPUT = 64;
    private SmeltAmounts() { }

    public static int total(int inputCount, int recipeCount, int maxStackSize, int availableStacks) {
        if (inputCount <= 0 || recipeCount <= 0 || maxStackSize <= 0 || availableStacks <= 0) return 0;
        long amount = (long) inputCount * recipeCount;
        long splits = (amount + maxStackSize - 1L) / maxStackSize;
        return amount <= Integer.MAX_VALUE && splits <= Math.min(MAX_SPLITS_PER_INPUT, availableStacks)
                ? (int) amount : 0;
    }
}
