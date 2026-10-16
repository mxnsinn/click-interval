package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SavedLocationStoreTest {
    private static final SavedLocation HOME = new SavedLocation(
            "minecraft:overworld", 12.25, 64.0, -91.75, 179.5F, -12.25F);

    @Test
    void normalizesSafeNamesAndReservesCommandWords() {
        assertEquals("my_farm-2", SavedLocationStore.normalizeName("My_Farm-2"));
        assertEquals("end portal", SavedLocationStore.normalizeName("  End   Portal  "));
        assertEquals("_", SavedLocationStore.normalizeName("_"));
        assertEquals("", SavedLocationStore.normalizeName("accept"));
        assertEquals("", SavedLocationStore.normalizeName("DECLINE"));
        assertEquals("", SavedLocationStore.normalizeName("set"));
        assertEquals("", SavedLocationStore.normalizeName("LIST"));
        assertEquals("", SavedLocationStore.normalizeName("delete"));
        assertEquals("back", SavedLocationStore.normalizeName("back"));
        assertEquals("go", SavedLocationStore.normalizeName("go"));
        assertEquals("two words", SavedLocationStore.normalizeName("two words"));
        assertEquals("", SavedLocationStore.normalizeName("two\twords"));
        assertEquals("", SavedLocationStore.normalizeName("two\nwords"));
        assertEquals("", SavedLocationStore.normalizeName("two\rwords"));
        assertEquals("", SavedLocationStore.normalizeName("has.dot"));
        assertEquals("", SavedLocationStore.normalizeName("a".repeat(25)));
    }

    @Test
    void roundTripsEveryLocationFieldAndPlayerOwnership(@TempDir Path directory) throws IOException {
        Path file = directory.resolve("world").resolve("server-teleport").resolve("locations.tsv");
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        SavedLocationStore store = SavedLocationStore.open(file);

        assertEquals(SavedLocationStore.PutResult.ADDED, store.put(first, "Home", HOME));
        assertEquals(SavedLocationStore.PutResult.ADDED, store.put(first, " End   Portal ", HOME));
        SavedLocation netherFarm = new SavedLocation(
                "minecraft:the_nether", -2.125, 118.75, 9.5, -370.25F, 89.0F);
        assertEquals(SavedLocationStore.PutResult.ADDED, store.put(second, "farm", netherFarm));

        SavedLocationStore restored = SavedLocationStore.open(file);
        assertEquals(HOME, restored.find(first, "HOME").orElseThrow());
        assertEquals(HOME, restored.find(first, "end portal").orElseThrow());
        assertEquals(netherFarm, restored.find(second, "Farm").orElseThrow());
        assertTrue(restored.find(first, "farm").isEmpty());
        assertEquals(java.util.List.of("end portal", "home"), restored.names(first));
        assertTrue(Files.readString(file).startsWith("server-teleport-locations-v1\n"));
    }

    @Test
    void capsEachPlayerAtThirtyWithoutChangingTheDurableSnapshot(@TempDir Path directory)
            throws IOException {
        Path file = directory.resolve("locations.tsv");
        UUID player = UUID.randomUUID();
        SavedLocationStore store = SavedLocationStore.open(file);
        for (int index = 0; index < SavedLocationStore.MAX_LOCATIONS_PER_PLAYER; index++) {
            assertEquals(SavedLocationStore.PutResult.ADDED,
                    store.put(player, "place_" + index, HOME));
        }
        byte[] before = Files.readAllBytes(file);

        assertEquals(SavedLocationStore.PutResult.LIMIT_REACHED,
                store.put(player, "one_too_many", HOME));
        assertEquals(30, SavedLocationStore.MAX_LOCATIONS_PER_PLAYER);
        assertEquals(java.util.stream.IntStream.range(0, 30).mapToObj(index -> "place_" + index).sorted().toList(), store.names(player));
        assertTrue(java.util.Arrays.equals(before, Files.readAllBytes(file)));

        SavedLocation changed = new SavedLocation(
                "minecraft:overworld", 1.0, 2.0, 3.0, 4.0F, 5.0F);
        assertEquals(SavedLocationStore.PutResult.UPDATED, store.put(player, "PLACE_0", changed));
        assertEquals(changed, SavedLocationStore.open(file).find(player, "place_0").orElseThrow());
    }

    @Test
    void legacySixteenPlaceFileReopensUnchangedAndCanGrowToThirty(@TempDir Path directory) throws IOException {
        Path file = directory.resolve("locations.tsv");
        UUID player = UUID.randomUUID();
        SavedLocationStore oldData = SavedLocationStore.open(file);
        for (int index = 0; index < 16; index++) oldData.put(player, "legacy_" + index, HOME);
        byte[] before = Files.readAllBytes(file);
        SavedLocationStore upgraded = SavedLocationStore.open(file);
        assertTrue(java.util.Arrays.equals(before, Files.readAllBytes(file)));
        for (int index = 16; index < 30; index++) upgraded.put(player, "extra_" + index, HOME);
        SavedLocationStore reloaded = SavedLocationStore.open(file);
        assertEquals(30, reloaded.names(player).size());
        for (int index = 0; index < 16; index++) assertEquals(HOME, reloaded.find(player, "legacy_" + index).orElseThrow());
    }

    @Test
    void deletionIsDurableAndLeavesNoTemporaryFiles(@TempDir Path directory) throws IOException {
        Path file = directory.resolve("locations.tsv");
        UUID player = UUID.randomUUID();
        SavedLocationStore store = SavedLocationStore.open(file);
        store.put(player, "home", HOME);

        assertTrue(store.delete(player, "HOME"));
        assertFalse(store.delete(player, "home"));
        assertTrue(SavedLocationStore.open(file).names(player).isEmpty());
        try (var files = Files.list(directory)) {
            assertEquals(0L, files.filter(path -> path.getFileName().toString().endsWith(".tmp")).count());
        }
    }

    @Test
    void rejectsCorruptionOversizeAndTooManyLocations(@TempDir Path directory) throws IOException {
        Path malformed = directory.resolve("malformed.tsv");
        Files.writeString(malformed, "wrong-header\n");
        assertThrows(IOException.class, () -> SavedLocationStore.open(malformed));

        Path tooMany = directory.resolve("too-many.tsv");
        UUID player = UUID.randomUUID();
        StringBuilder data = new StringBuilder("server-teleport-locations-v1\n");
        for (int index = 0; index <= SavedLocationStore.MAX_LOCATIONS_PER_PLAYER; index++) {
            data.append(player).append('\t').append("place_").append(index)
                    .append("\tminecraft:overworld\t0.0\t64.0\t0.0\t0.0\t0.0\n");
        }
        Files.writeString(tooMany, data);
        assertThrows(IOException.class, () -> SavedLocationStore.open(tooMany));

        Path oversized = directory.resolve("oversized.tsv");
        Files.write(oversized, new byte[(int) SavedLocationStore.MAX_FILE_BYTES + 1]);
        assertThrows(IOException.class, () -> SavedLocationStore.open(oversized));
    }

    @Test
    void rejectsInvalidStoredCoordinatesAndDimensions() {
        assertThrows(IllegalArgumentException.class, () -> new SavedLocation(
                "Not A Dimension", 0, 64, 0, 0, 0));
        assertThrows(IllegalArgumentException.class, () -> new SavedLocation(
                "minecraft:overworld", Double.NaN, 64, 0, 0, 0));
        assertThrows(IllegalArgumentException.class, () -> new SavedLocation(
                "minecraft:overworld", 30_000_001, 64, 0, 0, 0));
        assertThrows(IllegalArgumentException.class, () -> new SavedLocation(
                "minecraft:overworld", 0, 64, 0, Float.POSITIVE_INFINITY, 0));
    }
}
