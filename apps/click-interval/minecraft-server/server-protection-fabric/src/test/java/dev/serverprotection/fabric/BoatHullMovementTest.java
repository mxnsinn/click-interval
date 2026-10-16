package dev.serverprotection.fabric;

import net.minecraft.world.phys.AABB;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class BoatHullMovementTest {
    private static final AABB HULL = new AABB(-0.6875, 63.4375, -0.6875, 0.6875, 64, 0.6875);
    private static AABB player(double x, double y, double z) {
        return new AABB(x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3);
    }
    @Test void permitsShortWalkingAndBothDirectionsOfShallowHullBobbing() {
        assertTrue(BoatHullMovement.eligibleGeometry(player(0, 64.02, 0), player(.25, 63.935, 0), HULL));
        assertTrue(BoatHullMovement.eligibleGeometry(player(.25, 63.935, 0), player(0, 64.02, 0), HULL));
        assertTrue(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(.3, 64, 0), HULL));
    }
    @Test void rejectsNearbySideUnderAndUnsupportedEndpoints() {
        assertFalse(BoatHullMovement.eligibleGeometry(player(1.2, 64, 0), player(.9, 64, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(.9, 64, 0), player(1.2, 64, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 63.7, 0), player(.1, 63.7, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64.5, 0), player(.1, 64.5, 0), HULL));
    }
    @Test void rejectsExcessSpeedJumpHeightAndSizeChanges() {
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(.41, 64, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(.3, 64, .3), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 63.9, 0), player(0, 64.1, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(0, 64, 0).inflate(.1), HULL));
    }
    @Test void rejectsNonfiniteCoordinates() {
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(Double.NaN, 64, 0), HULL));
        assertFalse(BoatHullMovement.eligibleGeometry(player(0, 64, 0), player(0, Double.POSITIVE_INFINITY, 0), HULL));
    }
}
