package dev.serverprotection.fabric;

import java.util.Set;

/** Narrow exceptions for blocks players legitimately clear in fast, continuous sweeps. */
final class BreakRatePolicy {
    static final int MIN_SWEEP_HARVEST_BREAKS_PER_SECOND = 40;

    private static final Set<String> SWEEP_HARVEST_BLOCKS = Set.of(
            "minecraft:bamboo",
            "minecraft:bamboo_sapling",
            "minecraft:beetroots",
            "minecraft:cactus",
            "minecraft:carrots",
            "minecraft:cave_vines",
            "minecraft:cave_vines_plant",
            "minecraft:chorus_flower",
            "minecraft:chorus_plant",
            "minecraft:cocoa",
            "minecraft:kelp",
            "minecraft:kelp_plant",
            "minecraft:nether_wart",
            "minecraft:potatoes",
            "minecraft:seagrass",
            "minecraft:sugar_cane",
            "minecraft:sweet_berry_bush",
            "minecraft:tall_seagrass",
            "minecraft:twisting_vines",
            "minecraft:twisting_vines_plant",
            "minecraft:vine",
            "minecraft:weeping_vines",
            "minecraft:weeping_vines_plant",
            "minecraft:wheat");

    private BreakRatePolicy() { }

    static boolean isSweepHarvestBlock(String blockId) {
        return blockId != null && SWEEP_HARVEST_BLOCKS.contains(blockId);
    }

    static boolean allowsFastMining(boolean sweepHarvest, float destroyProgress) {
        // BlockState#getDestroyProgress includes actual tool, enchantments, Haste, water and
        // airborne penalties. A value of one is vanilla's instant-break threshold.
        return sweepHarvest || destroyProgress >= 1.0f;
    }

    static int breaksPerSecondLimit(boolean sweepHarvest, int configuredLimit) {
        int safeConfiguredLimit = Math.max(1, configuredLimit);
        return sweepHarvest
                ? Math.max(safeConfiguredLimit, MIN_SWEEP_HARVEST_BREAKS_PER_SECOND)
                : safeConfiguredLimit;
    }
}
