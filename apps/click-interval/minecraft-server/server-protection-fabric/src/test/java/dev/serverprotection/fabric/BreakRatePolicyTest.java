package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class BreakRatePolicyTest {
    @Test
    void recognizesOnlyCuratedSweepHarvestBlocks() {
        assertTrue(BreakRatePolicy.isSweepHarvestBlock("minecraft:sugar_cane"));
        assertTrue(BreakRatePolicy.isSweepHarvestBlock("minecraft:bamboo"));
        assertTrue(BreakRatePolicy.isSweepHarvestBlock("minecraft:kelp_plant"));
        assertTrue(BreakRatePolicy.isSweepHarvestBlock("minecraft:wheat"));
        assertTrue(BreakRatePolicy.isSweepHarvestBlock("minecraft:weeping_vines_plant"));

        assertFalse(BreakRatePolicy.isSweepHarvestBlock("minecraft:stone"));
        assertFalse(BreakRatePolicy.isSweepHarvestBlock("minecraft:diamond_ore"));
        assertFalse(BreakRatePolicy.isSweepHarvestBlock("minecraft:tnt"));
        assertFalse(BreakRatePolicy.isSweepHarvestBlock(null));
    }

    @Test
    void raisesOnlyTheSweepHarvestFloor() {
        assertEquals(18, BreakRatePolicy.breaksPerSecondLimit(false, 18));
        assertEquals(40, BreakRatePolicy.breaksPerSecondLimit(true, 18));
        assertEquals(60, BreakRatePolicy.breaksPerSecondLimit(true, 60));
        assertEquals(1, BreakRatePolicy.breaksPerSecondLimit(false, -5));
    }

    @Test
    void vanillaInstantMiningIncludesCorrectToolAndZeroHardnessBlocks() {
        assertTrue(BreakRatePolicy.allowsFastMining(false, 1.0f));
        assertTrue(BreakRatePolicy.allowsFastMining(false, 1.8f));
        assertTrue(BreakRatePolicy.allowsFastMining(false, Float.POSITIVE_INFINITY));
        assertTrue(BreakRatePolicy.allowsFastMining(true, 0.1f));
        assertFalse(BreakRatePolicy.allowsFastMining(false, 0.99f));
        assertFalse(BreakRatePolicy.allowsFastMining(false, 0.0f));
        assertFalse(BreakRatePolicy.allowsFastMining(false, Float.NaN));
    }
}
