package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class AntiCheatExemptionStoreTest {
    private static final UUID ALICE = UUID.fromString("12345678-1234-4234-8234-1234567890ab");
    private static final UUID BOB = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    @TempDir
    Path temporary;

    @Test
    void persistsByUuidAndUsesOnlyExactNames() throws Exception {
        Path file = temporary.resolve("server-protection/anticheat-exemptions.tsv");
        AntiCheatExemptionStore store = new AntiCheatExemptionStore(file);

        assertTrue(store.disable(ALICE, "Alice_Name"));
        assertTrue(store.disable(BOB, "Bob"));
        assertFalse(store.disable(ALICE, "Alice_Name"));

        AntiCheatExemptionStore reloaded = new AntiCheatExemptionStore(file);
        reloaded.load();
        assertTrue(reloaded.contains(ALICE));
        assertEquals(ALICE, reloaded.findByExactName("alice_name").playerId());
        assertNull(reloaded.findByExactName("Alice"), "prefixes must never resolve a player");
        assertEquals(2, reloaded.snapshot().size());

        assertTrue(reloaded.enable(ALICE));
        AntiCheatExemptionStore afterEnable = new AntiCheatExemptionStore(file);
        afterEnable.load();
        assertFalse(afterEnable.contains(ALICE));
        assertTrue(afterEnable.contains(BOB));
    }

    @Test
    void acceptsUuidOnlyEntriesWithoutInventingAName() throws Exception {
        Path file = temporary.resolve("anticheat-exemptions.tsv");
        AntiCheatExemptionStore store = new AntiCheatExemptionStore(file);
        store.disable(ALICE, "not a valid player name!");

        AntiCheatExemptionStore reloaded = new AntiCheatExemptionStore(file);
        reloaded.load();
        assertEquals(ALICE.toString(), reloaded.get(ALICE).displayName());
    }

    @Test
    void rejectedReloadDoesNotReplaceLastKnownGoodMemory() throws Exception {
        Path file = temporary.resolve("anticheat-exemptions.tsv");
        AntiCheatExemptionStore store = new AntiCheatExemptionStore(file);
        store.disable(ALICE, "Alice");
        Files.writeString(file, "wrong-header\n");

        assertThrows(IOException.class, store::load);
        assertTrue(store.contains(ALICE));
    }

    @Test
    void rejectsOversizedStateBeforeReadingIt() throws Exception {
        Path file = temporary.resolve("anticheat-exemptions.tsv");
        Files.write(file, new byte[(int) AntiCheatExemptionStore.MAX_FILE_BYTES + 1]);
        AntiCheatExemptionStore store = new AntiCheatExemptionStore(file);

        assertThrows(IOException.class, store::load);
        assertTrue(store.snapshot().isEmpty());
    }
}
