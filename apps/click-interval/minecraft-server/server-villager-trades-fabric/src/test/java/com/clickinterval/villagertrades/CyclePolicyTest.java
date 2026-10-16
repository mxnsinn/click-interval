package com.clickinterval.villagertrades;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CyclePolicyTest {
    @Test void cooldownSurvivesRepeatedClicksAndClockRollback() {
        assertTrue(CyclePolicy.cooldownReady(Long.MIN_VALUE, 0));
        assertFalse(CyclePolicy.cooldownReady(100, 100));
        assertFalse(CyclePolicy.cooldownReady(100, 109));
        assertTrue(CyclePolicy.cooldownReady(100, 110));
        assertFalse(CyclePolicy.cooldownReady(100, 99));
    }

    @Test void permanentAndDefensiveTradeLocksAreIndependent() {
        assertTrue(CyclePolicy.untraded(0, 1, false));
        assertFalse(CyclePolicy.untraded(1, 1, false));
        assertFalse(CyclePolicy.untraded(0, 1, true));
        assertFalse(CyclePolicy.untraded(0, 2, false));
        assertFalse(CyclePolicy.untraded(-1, 1, false));
    }
}
