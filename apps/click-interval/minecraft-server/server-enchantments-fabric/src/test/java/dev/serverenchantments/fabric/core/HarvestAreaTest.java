package dev.serverenchantments.fabric.core;

import org.junit.jupiter.api.Test;
import java.util.HashSet;
import static org.junit.jupiter.api.Assertions.*;

class HarvestAreaTest {
    private static final TreeScan.Point CENTER = new TreeScan.Point(-14, 70, 5);

    @Test void firstTierIsOnlyHorizontalRowPerpendicularToFacing() {
        var acrossX = HarvestArea.extras(CENTER, true, 1);
        assertEquals(2, acrossX.size());
        assertTrue(acrossX.contains(new TreeScan.Point(-15, 70, 5)));
        assertTrue(acrossX.contains(new TreeScan.Point(-13, 70, 5)));
        var acrossZ = HarvestArea.extras(CENTER, false, 1);
        assertTrue(acrossZ.contains(new TreeScan.Point(-14, 70, 4)));
        assertTrue(acrossZ.contains(new TreeScan.Point(-14, 70, 6)));
    }

    @Test void higherTiersAreExactHorizontalSquaresWithoutCenterOrDuplicates() {
        for (int level : new int[]{2, 3}) {
            int radius = level - 1;
            var positions = HarvestArea.extras(CENTER, true, level);
            assertEquals(level == 2 ? 8 : 24, positions.size());
            assertEquals(positions.size(), new HashSet<>(positions).size());
            assertFalse(positions.contains(CENTER));
            assertEquals(positions, HarvestArea.extras(CENTER, false, level));
            for (var p : positions) {
                assertEquals(CENTER.y(), p.y());
                assertTrue(Math.abs(p.x() - CENTER.x()) <= radius);
                assertTrue(Math.abs(p.z() - CENTER.z()) <= radius);
            }
        }
    }

    @Test void malformedLevelsCannotExpandWorkPastTwentyFiveCells() {
        assertTrue(HarvestArea.extras(CENTER, true, 0).isEmpty());
        assertTrue(HarvestArea.extras(CENTER, true, -1).isEmpty());
        assertEquals(HarvestArea.extras(CENTER, false, 3), HarvestArea.extras(CENTER, false, Integer.MAX_VALUE));
    }
}
