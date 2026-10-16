package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

final class EntityVisibilityMitigationTest {
    @Test
    void pvpSafeModeNeverWithholdsPlayersOrNametags() {
        assertTrue(EntityVisibilityMitigation.pvpSafeAllowsTracking(true, true, 33.0 * 33.0));
        assertTrue(EntityVisibilityMitigation.pvpSafeAllowsTracking(true, true, 256.0 * 256.0));
        assertTrue(EntityVisibilityMitigation.pvpSafeAllowsTracking(true, false, Double.POSITIVE_INFINITY));
        assertTrue(EntityVisibilityMitigation.pvpSafeAllowsTracking(false, true, Double.NaN));
    }
}
