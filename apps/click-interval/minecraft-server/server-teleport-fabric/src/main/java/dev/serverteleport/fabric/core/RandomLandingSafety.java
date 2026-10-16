package dev.serverteleport.fabric.core;

import java.util.Set;

/** Random travel must not deliberately choose damaging, trapping, fluid, or unsupported terrain. */
public final class RandomLandingSafety {
    private static final Set<String> HAZARDS = Set.of(
            "minecraft:lava", "minecraft:water", "minecraft:fire", "minecraft:soul_fire",
            "minecraft:magma_block", "minecraft:cactus", "minecraft:sweet_berry_bush",
            "minecraft:powder_snow", "minecraft:campfire", "minecraft:soul_campfire",
            "minecraft:wither_rose", "minecraft:pointed_dripstone", "minecraft:cobweb",
            "minecraft:nether_portal", "minecraft:end_portal", "minecraft:end_gateway");

    private RandomLandingSafety() { }

    public static boolean hazardous(String blockId) {
        return HAZARDS.contains(blockId);
    }

}
