package com.clickinterval.map.fabric;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class SurfaceTileReducerTest {
    @Test
    void keepsFourBoundedQuadrantsInsteadOfFlatteningAChunkToOneColor() {
        List<SurfaceTileReducer.Sample> samples = new ArrayList<>();
        int[] offsets = {0, 4, 8, 12};
        for (int z : offsets) {
            for (int x : offsets) {
                boolean east = x >= 8;
                boolean south = z >= 8;
                String block = east ? (south ? "minecraft:sand" : "minecraft:water")
                        : (south ? "minecraft:oak_leaves" : "minecraft:grass_block");
                String color = TerrainColorPalette.colorFor(block, "minecraft:plains");
                samples.add(new SurfaceTileReducer.Sample(x, z, 64 + x + z, color, block));
            }
        }

        SurfaceTileReducer.Result result = SurfaceTileReducer.reduce(samples, 8);

        assertNotNull(result);
        assertEquals(16, result.coarse().size());
        assertEquals(4, result.details().size());
        assertEquals(List.of("minecraft:grass_block", "minecraft:water", "minecraft:oak_leaves", "minecraft:sand"),
                result.details().stream().map(SurfaceTileReducer.Cell::block).toList());
        assertEquals(List.of(0, 8, 0, 8),
                result.details().stream().map(SurfaceTileReducer.Cell::localX).toList());
        assertEquals(List.of(0, 0, 8, 8),
                result.details().stream().map(SurfaceTileReducer.Cell::localZ).toList());
    }

    @Test
    void tiesPreferTheHigherVisibleSurfaceDeterministically() {
        var result = SurfaceTileReducer.reduce(List.of(
                new SurfaceTileReducer.Sample(0, 0, 64, "#795238", "minecraft:dirt"),
                new SurfaceTileReducer.Sample(4, 0, 72, "#4d8a43", "minecraft:oak_leaves")
        ), 8);

        assertNotNull(result);
        assertEquals("minecraft:oak_leaves", result.details().getFirst().block());
        assertEquals(72, result.details().getFirst().y());
    }

    @Test
    void rejectsInvalidDetailSizes() {
        var sample = new SurfaceTileReducer.Sample(0, 0, 64, "#63a54d", "minecraft:grass_block");
        assertThrows(IllegalArgumentException.class,
                () -> SurfaceTileReducer.reduce(List.of(sample), 6));
    }
}
