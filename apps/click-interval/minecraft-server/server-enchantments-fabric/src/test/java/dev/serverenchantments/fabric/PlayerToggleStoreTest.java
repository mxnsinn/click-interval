package dev.serverenchantments.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static dev.serverenchantments.fabric.PlayerToggleStore.*;

final class PlayerToggleStoreTest {
    @TempDir Path temporary;
    private final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID();
    @Test void missingDefaultsOnWithoutWritingAnything() {
        var store = new PlayerToggleStore(temporary.resolve("world"), message -> fail(message));
        assertEquals(State.DEFAULT, store.get(alice).state());
        assertFalse(Files.exists(temporary.resolve("world")));
    }
    @Test void playerWorldAndFeatureIsolationAndReload() throws Exception {
        Path world = temporary.resolve("first");
        var store = new PlayerToggleStore(world, message -> fail(message));
        long revision = store.get(alice).revision();
        store.set(alice, Feature.MINER, false);
        assertTrue(store.get(alice).revision() > revision);
        assertFalse(store.enabled(alice, Feature.MINER));
        assertTrue(store.enabled(alice, Feature.TREE));
        assertTrue(store.enabled(alice, Feature.HARVESTER));
        assertEquals(State.DEFAULT, store.get(bob).state());
        assertEquals(State.DEFAULT, new PlayerToggleStore(temporary.resolve("second"), message -> fail(message)).get(alice).state());
        var reload = new PlayerToggleStore(world, message -> fail(message));
        assertEquals(store.get(alice).state(), reload.get(alice).state());
        store.forget(alice);
        assertEquals(reload.get(alice).state(), store.get(alice).state());
        try (var files = Files.list(world)) { assertEquals(1, files.count()); }
    }
    @Test void malformedMissingFieldsUnsupportedVersionsAndOversizedFilesFailClosed() throws Exception {
        for (String invalid : List.of("", "version=9\nminer=true\ntree=true\nharvester=true\n",
                "version=1\nminer=true\ntree=true\n", "version=1\nminer=maybe\ntree=true\nharvester=true\n",
                "version=1\nminer=true\ntree=true\nharvester=true\nextra=true\n", "\\uZZZZ", "x".repeat(4097))) {
            Files.writeString(path(temporary, alice), invalid);
            List<String> warnings = new ArrayList<>();
            var store = new PlayerToggleStore(temporary, warnings::add);
            assertEquals(State.SAFE, store.get(alice).state());
            assertEquals(1, warnings.size());
            assertEquals(invalid, Files.readString(path(temporary, alice)), "bad source retained for recovery");
        }
    }
    @Test void failedAtomicReplacementPreservesMemoryAndCleansOnlyItsTemporaryFile() throws Exception {
        var store = new PlayerToggleStore(temporary, message -> fail(message));
        State original = store.get(alice).state();
        Files.createDirectory(path(temporary, alice));
        Files.writeString(path(temporary, alice).resolve("keep"), "existing");
        assertThrows(java.io.IOException.class, () -> store.set(alice, Feature.TREE, false));
        assertEquals(original, store.get(alice).state());
        assertEquals("existing", Files.readString(path(temporary, alice).resolve("keep")));
        try (var files = Files.list(temporary)) { assertEquals(1, files.count()); }
    }
    private static Path path(Path directory, UUID id) { return directory.resolve("player-toggles." + id + ".properties"); }
}
