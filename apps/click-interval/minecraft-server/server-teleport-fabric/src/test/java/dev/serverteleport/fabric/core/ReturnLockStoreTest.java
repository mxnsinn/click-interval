package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

final class ReturnLockStoreTest {
    @TempDir Path directory;
    private final UUID player = UUID.randomUUID();
    private SavedLocation origin(String dimension, double x, double y, double z) {
        return new SavedLocation(dimension, x, y, z, 0, 0);
    }

    @Test void successLockIsHorizontalInclusiveDimensionScopedAndExactlyFiveMinutes() throws Exception {
        var store = ReturnLockStore.open(directory.resolve("locks.tsv"));
        assertEquals(0, store.remainingMillis(player, "minecraft:overworld", 0, 0, 1_000));
        store.arm(player, origin("minecraft:overworld", 0, 70, 0), 1_000);
        assertEquals(300_000, store.remainingMillis(player, "minecraft:overworld", 160, 0, 1_000));
        assertEquals(0, store.remainingMillis(player, "minecraft:overworld", 160.001, 0, 1_000));
        assertEquals(0, store.remainingMillis(player, "minecraft:the_nether", 0, 0, 1_000));
        assertEquals(0, store.remainingMillis(UUID.randomUUID(), "minecraft:overworld", 0, 0, 1_000));
        assertEquals(1, store.remainingMillis(player, "minecraft:overworld", 0, 0, 300_999));
        assertEquals(0, store.remainingMillis(player, "minecraft:overworld", 0, 0, 301_000));
    }

    @Test void onlyRealDisplacementInAnActiveFightQualifiesNotANoopOrAnExpiredFight() {
        SavedLocation start = origin("minecraft:overworld", 0, 70, 0);
        SavedLocation away = origin("minecraft:overworld", 300, 70, 0);
        assertFalse(ReturnLockStore.isEscape(false, start, away));
        assertFalse(ReturnLockStore.isEscape(true, start, start));
        assertFalse(ReturnLockStore.isEscape(true, start, new SavedLocation("minecraft:overworld", 0, 70, 0, 90, 30)));
        assertTrue(ReturnLockStore.isEscape(true, start, away));
        assertTrue(ReturnLockStore.isEscape(true, start, origin("minecraft:overworld", 0, 200, 0)));
    }

    @Test void reconnectReloadPreservesLockButDeathClearsDurablyWithoutTouchingOtherPlayers() throws Exception {
        Path file = directory.resolve("locks.tsv");
        var store = ReturnLockStore.open(file);
        UUID other = UUID.randomUUID();
        store.arm(player, origin("minecraft:overworld", -200, -40, 99), 1_000);
        store.arm(other, origin("minecraft:overworld", -200, 250, 99), 1_000);
        var reconnected = ReturnLockStore.open(file);
        assertEquals(299_000, reconnected.remainingMillis(player, "minecraft:overworld", -200, 99, 2_000));
        reconnected.clearAfterDeath(player);
        var respawned = ReturnLockStore.open(file);
        assertEquals(0, respawned.remainingMillis(player, "minecraft:overworld", -200, 99, 2_000));
        assertEquals(299_000, respawned.remainingMillis(other, "minecraft:overworld", -200, 99, 2_000));
    }

    @Test void anotherEscapeCannotEraseAnEarlierActiveFightAreaAndWorldsStaySeparate() throws Exception {
        var firstWorld = ReturnLockStore.open(directory.resolve("first/locks.tsv"));
        var otherWorld = ReturnLockStore.open(directory.resolve("second/locks.tsv"));
        firstWorld.arm(player, origin("minecraft:overworld", 0, 70, 0), 1_000);
        firstWorld.arm(player, origin("minecraft:overworld", 1_000, 70, 0), 2_000);
        assertTrue(firstWorld.remainingMillis(player, "minecraft:overworld", 0, 0, 3_000) > 0);
        assertTrue(firstWorld.remainingMillis(player, "minecraft:overworld", 1_000, 0, 3_000) > 0);
        assertEquals(0, otherWorld.remainingMillis(player, "minecraft:overworld", 0, 0, 3_000));
    }

    @Test void readOrWriteFailureDoesNotInventAnOffenseOrRewriteCorruptData() throws Exception {
        Path bad = directory.resolve("bad.tsv");
        Files.writeString(bad, "corrupt-existing-data");
        assertThrows(IOException.class, () -> ReturnLockStore.open(bad));
        assertEquals("corrupt-existing-data", Files.readString(bad));
        Path parentFile = directory.resolve("not-a-directory");
        Files.writeString(parentFile, "keep");
        var store = ReturnLockStore.open(parentFile.resolve("locks.tsv"));
        assertThrows(IOException.class, () -> store.arm(player, origin("minecraft:overworld", 0, 70, 0), 1_000));
        assertEquals(0, store.remainingMillis(player, "minecraft:overworld", 0, 0, 1_000));
    }
}
