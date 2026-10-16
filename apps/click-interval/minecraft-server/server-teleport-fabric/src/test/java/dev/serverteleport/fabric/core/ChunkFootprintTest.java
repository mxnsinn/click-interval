package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class ChunkFootprintTest {
    @Test void ordinaryArrivalNeedsOneChunkInsteadOfAnUnconditionalNine() {
        assertEquals(new ChunkFootprint(4, 8, 4, 8), ChunkFootprint.ofBounds(65.2, 129.2, 65.8, 129.8));
    }
    @Test void edgeArrivalIncludesEveryCollisionColumnAcrossNegativeCoordinates() {
        assertEquals(new ChunkFootprint(-1, -1, 0, 0), ChunkFootprint.ofBounds(-0.3, -0.3, 0.3, 0.3));
        assertEquals(new ChunkFootprint(-2, -2, -1, -1), ChunkFootprint.ofBounds(-16.3, -16.3, -15.7, -15.7));
    }
    @Test void exclusiveMaximumDoesNotRequireAnUnoccupiedNeighbor() {
        assertEquals(new ChunkFootprint(0, 0, 0, 0), ChunkFootprint.ofBounds(15.4, 15.4, 16, 16));
        assertEquals(new ChunkFootprint(-1, -1, -1, -1), ChunkFootprint.ofBounds(-0.6, -0.6, 0, 0));
    }
    @Test void invalidOrExcessiveFootprintsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> ChunkFootprint.ofBounds(0, 0, Double.NaN, 2));
        assertThrows(IllegalArgumentException.class, () -> ChunkFootprint.ofBounds(0, 0, 200, 200));
    }
}
