package com.clickinterval.map.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

final class TerrainColorPaletteTest {
    @Test
    void grassAndFoliageStayGreenInsteadOfFallingBackToDirt() {
        String grass = TerrainColorPalette.colorFor("minecraft:grass_block", "minecraft:plains");
        String dirt = TerrainColorPalette.colorFor("minecraft:dirt", "minecraft:plains");
        String jungleLeaves = TerrainColorPalette.colorFor("minecraft:jungle_leaves", "minecraft:jungle");

        assertEquals("#63a54d", grass);
        assertEquals("#795238", dirt);
        assertNotEquals(grass, dirt);
        assertNotEquals(grass, jungleLeaves);
    }

    @Test
    void biomeAndMaterialVariantsRemainVisuallyDistinct() {
        assertNotEquals(
                TerrainColorPalette.colorFor("minecraft:water", "minecraft:warm_ocean"),
                TerrainColorPalette.colorFor("minecraft:water", "minecraft:frozen_ocean"));
        assertNotEquals(
                TerrainColorPalette.colorFor("minecraft:crimson_nylium", "minecraft:crimson_forest"),
                TerrainColorPalette.colorFor("minecraft:warped_nylium", "minecraft:warped_forest"));
        assertEquals("#669dd8",
                TerrainColorPalette.colorFor("minecraft:light_blue_concrete", "minecraft:plains"));
    }

    @Test
    void liveMinecraftMapColorWinsForOrdinaryBlocks() {
        assertEquals("#123456",
                TerrainColorPalette.colorFor("minecraft:custom_decorative_block", "minecraft:plains", 0x123456));
    }
}
