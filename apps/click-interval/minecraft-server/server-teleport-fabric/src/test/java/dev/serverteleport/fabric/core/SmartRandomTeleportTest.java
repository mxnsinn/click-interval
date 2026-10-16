package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;
import static org.junit.jupiter.api.Assertions.*;

final class SmartRandomTeleportTest {
    @TempDir Path directory;

    @Test void radialCapIncludesLandingScanAndRespectsShiftedSpawn() {
        var area = RandomTeleportArea.withinBorder(-9000, 11000, -12000, 8000).orElseThrow();
        var random = new Random(31891);
        for (int i = 0; i < 10000; i++) {
            var point = area.sampleNearSpawn(random, 1000, -2000, 100000).orElseThrow();
            for (int dx : new int[]{-4, 4}) for (int dz : new int[]{-4, 4})
                assertTrue(Math.hypot(point.x() + dx + .5 - 1000, point.z() + dz + .5 + 2000) <= 10000);
        }
    }

    @Test void impossibleAreaFailsInsteadOfIgnoringCap() {
        var area = new RandomTeleportArea(20000, 21000, 20000, 21000);
        assertTrue(area.sampleNearSpawn(new Random(1), 0, 0, 10000).isEmpty());
    }

    @Test void missingRegionsAreClearAndInspectionDoesNotCreateFiles() throws Exception {
        assertTrue(UnexploredRegionCheck.clear(directory, 0, 0, 8));
        try (var entries = Files.list(directory)) { assertEquals(0, entries.count()); }
    }

    @Test void savedChunkAcrossNegativeRegionBoundaryRejectsArea() throws Exception {
        byte[] region = new byte[8192];
        ByteBuffer.wrap(region).putInt(4 * (31 + 32 * 31), 0x201);
        Path file = directory.resolve("r.-1.-1.mca");
        Files.write(file, region);
        assertFalse(UnexploredRegionCheck.clear(directory, 0, 0, 8));
        assertTrue(UnexploredRegionCheck.clear(directory, 9, 9, 8));
        assertArrayEquals(region, Files.readAllBytes(file));
    }

    @Test void corruptOrUnreadableRegionFailsClosed() throws Exception {
        Files.write(directory.resolve("r.0.0.mca"), new byte[10]);
        assertFalse(UnexploredRegionCheck.clear(directory, 0, 0, 0));
        assertFalse(UnexploredRegionCheck.clear(directory, 0, 0, 9));
    }
}
