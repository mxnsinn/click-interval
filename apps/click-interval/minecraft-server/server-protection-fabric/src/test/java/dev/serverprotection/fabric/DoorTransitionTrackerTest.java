package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.properties.DoubleBlockHalf;
import net.minecraft.world.phys.AABB;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class DoorTransitionTrackerTest {
    @Test
    void coversOnlyAnActualRecentTransitionAtTheSameDoor() {
        DoorTransitionTracker tracker = new DoorTransitionTracker();
        Object level = new Object();
        tracker.observe(1_000L, level, 12, 64, -7, false);

        assertTrue(tracker.coversChangedDoor(1_001L, level, 12, 64, -7, true));
        assertFalse(tracker.coversChangedDoor(1_100L, level, 12, 65, -7, true));
        assertFalse(tracker.coversChangedDoor(1_100L, level, 12, 64, -7, false));
        assertFalse(tracker.coversChangedDoor(1_100L, level, 13, 64, -7, true));
        assertFalse(tracker.coversChangedDoor(1_100L, new Object(), 12, 64, -7, true));
    }

    @Test
    void upperAndLowerHalvesCanonicalizeWithoutAliasingAStackedDoor() {
        assertEquals(64, ServerProtectionFabric.canonicalDoorLowerY(DoubleBlockHalf.LOWER, 64));
        assertEquals(64, ServerProtectionFabric.canonicalDoorLowerY(DoubleBlockHalf.UPPER, 65));
        assertEquals(66, ServerProtectionFabric.canonicalDoorLowerY(DoubleBlockHalf.LOWER, 66));

        DoorTransitionTracker tracker = new DoorTransitionTracker();
        Object level = new Object();
        tracker.observe(2_000L, level, 3, 64, 9, false);
        assertTrue(tracker.coversChangedDoor(2_010L, level, 3,
                ServerProtectionFabric.canonicalDoorLowerY(DoubleBlockHalf.UPPER, 65), 9, true));
        assertFalse(tracker.coversChangedDoor(2_010L, level, 3,
                ServerProtectionFabric.canonicalDoorLowerY(DoubleBlockHalf.LOWER, 66), 9, true));
    }

    @Test
    void collisionScanIncludesOneNeighborLayerButRemainsBounded() {
        AABB probe = new AABB(10.2, 64.04, -4.8, 10.8, 65.76, -4.2);
        Set<BlockPos> positions = new HashSet<>();
        for (BlockPos position : ServerProtectionFabric.expandedDoorCollisionPositions(probe)) {
            positions.add(position.immutable());
        }

        assertTrue(positions.contains(new BlockPos(9, 63, -6)));
        assertTrue(positions.contains(new BlockPos(11, 66, -4)));
        assertFalse(positions.contains(new BlockPos(8, 64, -5)));
        assertFalse(positions.contains(new BlockPos(12, 64, -5)));
    }

    @Test
    void expiresAndRejectsClockRollback() {
        DoorTransitionTracker tracker = new DoorTransitionTracker();
        Object level = new Object();
        tracker.observe(5_000L, level, 0, 80, 0, true);

        assertTrue(tracker.coversChangedDoor(5_000L + DoorTransitionTracker.TRANSITION_MILLIS,
                level, 0, 80, 0, false));
        assertFalse(tracker.coversChangedDoor(5_001L + DoorTransitionTracker.TRANSITION_MILLIS,
                level, 0, 80, 0, false));
        assertFalse(tracker.coversChangedDoor(4_999L, level, 0, 80, 0, false));
        tracker.reset();
        assertFalse(tracker.coversChangedDoor(5_010L, level, 0, 80, 0, false));
    }
}
