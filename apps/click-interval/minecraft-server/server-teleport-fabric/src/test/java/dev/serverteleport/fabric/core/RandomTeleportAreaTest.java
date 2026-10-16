package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import java.util.Random;
import static org.junit.jupiter.api.Assertions.*;

final class RandomTeleportAreaTest {
    @Test void samplesStayInCurrentBorderWithBroadLandingMargin() {
        var area = RandomTeleportArea.withinBorder(-75, 322, -231, 35).orElseThrow();
        var random = new Random(7301);
        for (int i = 0; i < 10_000; i++) {
            var column = area.sample(random).orElseThrow();
            assertTrue(area.contains(column.x(), column.z()));
            assertTrue(column.x() >= -73 && column.x() <= 319);
            assertTrue(column.z() >= -229 && column.z() <= 32);
        }
    }

    @Test void fullBorderSamplesReachFarBeyondOldRadiusAndAllQuadrants() {
        var area = RandomTeleportArea.withinBorder(-3e7, 3e7, -3e7, 3e7).orElseThrow();
        var random = new Random(73);
        boolean[] quadrants = new boolean[4];
        boolean beyondOldRadius = false;
        for (int i = 0; i < 1000; i++) {
            var point = area.sample(random).orElseThrow();
            assertTrue(area.contains(point.x(), point.z()));
            beyondOldRadius |= Math.hypot(point.x() + .5, point.z() + .5) > 100_000;
            quadrants[(point.x() >= 0 ? 1 : 0) + (point.z() >= 0 ? 2 : 0)] = true;
        }
        for (boolean quadrant : quadrants) assertTrue(quadrant);
        assertTrue(beyondOldRadius);
    }

    @Test void tinyInvalidOrNonFiniteBordersFailClosed() {
        assertTrue(RandomTeleportArea.withinBorder(-1, 1, -1, 1).isEmpty());
        assertTrue(RandomTeleportArea.withinBorder(Double.NaN, 100, -100, 100).isEmpty());
        assertTrue(RandomTeleportArea.withinBorder(100, -100, -100, 100).isEmpty());
        assertTrue(RandomTeleportArea.withinBorder(-100, Double.POSITIVE_INFINITY, -100, 100).isEmpty());
    }

    @Test void worldEdgeAndNegativeCoordinatesRemainBounded() {
        var area = RandomTeleportArea.withinBorder(-3e7, 3e7, -3e7, 3e7).orElseThrow();
        var random = new Random(5);
        for (int i = 0; i < 100; i++) {
            var point = area.sample(random).orElseThrow();
            assertTrue(point.x() >= -29_999_983 && point.z() <= 29_999_983);
        }
    }

    @Test void landHazardsAreExplicitWhileOrdinarySupportRemainsAvailable() {
        for (String hazard : new String[]{"lava", "water", "cactus", "magma_block", "powder_snow", "fire",
                "soul_fire", "campfire", "soul_campfire", "sweet_berry_bush", "wither_rose", "pointed_dripstone",
                "cobweb", "nether_portal", "end_portal", "end_gateway"}) {
            assertTrue(RandomLandingSafety.hazardous("minecraft:" + hazard), hazard);
        }
        assertFalse(RandomLandingSafety.hazardous("minecraft:stone"));
        assertFalse(RandomLandingSafety.hazardous("minecraft:grass_block"));
    }
}
