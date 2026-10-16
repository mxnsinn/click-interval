package com.clickinterval.endlock;

import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

final class NetherOriginStoreTest {
    @TempDir Path root;
    private static final UUID FIRST = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID OTHER = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static NetherOriginStore.Origin origin() { return new NetherOriginStore.Origin("minecraft:overworld", 12.5, 64, -27.5, 90, 0); }

    @Test void originsPersistIndependentlyAndUnknownPlayersHaveNoInventedLocation() throws Exception {
        NetherOriginStore store = new NetherOriginStore(root);
        assertTrue(store.read(FIRST).isEmpty());
        store.write(FIRST, origin());
        assertEquals(origin(), new NetherOriginStore(root).read(FIRST).orElseThrow());
        assertTrue(store.read(OTHER).isEmpty());
        assertTrue(new NetherOriginStore(root.resolve("other-world")).read(FIRST).isEmpty());
    }

    @Test void rejectsNetherUnsafeNumbersAndMalformedDimensionKeys() {
        for (String dimension : new String[]{"minecraft:the_nether", "../overworld", "", "X:y"}) {
            assertThrows(IllegalArgumentException.class, () -> new NetherOriginStore.Origin(dimension, 0, 64, 0, 0, 0));
        }
        for (double bad : new double[]{Double.NaN, Double.POSITIVE_INFINITY, 30_000_001}) {
            assertThrows(IllegalArgumentException.class, () -> new NetherOriginStore.Origin("minecraft:overworld", bad, 64, 0, 0, 0));
        }
        assertThrows(IllegalArgumentException.class, () -> new NetherOriginStore.Origin("minecraft:overworld", 0, -4096, 0, 0, 0));
    }

    @Test void malformedAndOversizedRecordsNeverBecomeOriginsOrOverwriteEvidence() throws Exception {
        Path file = root.resolve(FIRST + ".txt");
        NetherOriginStore store = new NetherOriginStore(root);
        for (String content : new String[]{"", "version=1\nminecraft:overworld\nNaN\n64\n0\n0\n0\nend\n", "x".repeat(513),
                "version=1\nminecraft:overworld\n0\n64\n0\n0\n0\nwrong\n"}) {
            Files.writeString(file, content);
            assertThrows(IOException.class, () -> store.read(FIRST));
            assertEquals(content, Files.readString(file));
        }
    }

    @Test void failedPersistenceDoesNotPublishAFalseSuccessfulOrigin() throws Exception {
        Path blocker = root.resolve("blocker");
        Files.writeString(blocker, "fixture");
        NetherOriginStore store = new NetherOriginStore(blocker);
        assertThrows(IOException.class, () -> store.write(FIRST, origin()));
        assertEquals("fixture", Files.readString(blocker));
    }

    @Test void invalidatedPreviousTripCannotReappearAfterRestart() throws Exception {
        NetherOriginStore store = new NetherOriginStore(root);
        store.write(FIRST, origin());
        store.invalidate(FIRST);
        assertTrue(new NetherOriginStore(root).read(FIRST).isEmpty());
        store.write(FIRST, origin());
        assertEquals(origin(), store.read(FIRST).orElseThrow());
    }
}
