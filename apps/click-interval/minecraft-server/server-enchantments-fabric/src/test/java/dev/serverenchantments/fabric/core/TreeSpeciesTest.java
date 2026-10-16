package dev.serverenchantments.fabric.core;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
final class TreeSpeciesTest {
    @Test void otherSpeciesPlacedLeavesStrippedLogsAndFullBarkBuildBlocksAreRejected() {
        assertTrue(TreeSpecies.naturalLog("minecraft","cherry_log"));
        assertTrue(TreeSpecies.matchingNaturalLeaves("cherry_log","minecraft","cherry_leaves",false));
        assertFalse(TreeSpecies.matchingNaturalLeaves("cherry_log","minecraft","oak_leaves",false));
        assertFalse(TreeSpecies.matchingNaturalLeaves("oak_log","minecraft","oak_leaves",true));
        assertFalse(TreeSpecies.naturalLog("minecraft","stripped_oak_log"));
        assertFalse(TreeSpecies.naturalLog("minecraft","oak_wood"));
        assertFalse(TreeSpecies.naturalLog("minecraft","crimson_stem"));
        assertFalse(TreeSpecies.naturalLog("other","oak_log"));
    }
}
