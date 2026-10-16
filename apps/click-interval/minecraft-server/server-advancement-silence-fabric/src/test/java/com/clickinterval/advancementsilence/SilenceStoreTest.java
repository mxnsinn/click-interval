package com.clickinterval.advancementsilence;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.io.IOException;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class SilenceStoreTest {
    @TempDir Path directory;
    private Path file() { return directory.resolve("server-advancement-silence.json"); }
    @Test void startsEmptyWithoutCreatingAFile() throws Exception {
        assertEquals(0, new SilenceStore(file()).size()); assertFalse(Files.exists(file()));
    }
    @Test void uuidIsolationAndRestartPersistence() throws Exception {
        UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        SilenceStore first = new SilenceStore(file());
        assertTrue(first.set(a, true)); assertTrue(first.contains(a)); assertFalse(first.contains(b));
        SilenceStore restarted = new SilenceStore(file());
        assertTrue(restarted.contains(a)); assertFalse(restarted.contains(b));
        assertTrue(restarted.set(a, false)); assertFalse(new SilenceStore(file()).contains(a));
    }
    @Test void idempotentRequestsDoNotRewrite() throws Exception {
        UUID a = UUID.randomUUID(); SilenceStore store = new SilenceStore(file());
        store.set(a, true); var time = Files.getLastModifiedTime(file());
        assertFalse(store.set(a, true)); assertEquals(time, Files.getLastModifiedTime(file()));
    }
    @Test void manyPlayersAndRemovalAreIndependent() throws Exception {
        SilenceStore store = new SilenceStore(file()); UUID a = UUID.randomUUID(), b = UUID.randomUUID();
        store.set(a,true); store.set(b,true); store.set(a,false);
        assertFalse(store.contains(a)); assertTrue(store.contains(b));
        assertEquals(1, new SilenceStore(file()).size());
    }
    @Test void rejectsMalformedStateWithoutOverwriting() throws Exception {
        for (String data : new String[]{"broken", "null", "[]", "{}", "{\"version\":2,\"silenced\":[]}",
                "{\"version\":1,\"silenced\":[\"1-1-1-1-1\"]}", "{\"version\":1,\"silenced\":[12]}",
                "{\"version\":1,\"silenced\":[],\"extra\":true}"}) {
            Files.writeString(file(),data);
            assertThrows(IOException.class, () -> new SilenceStore(file()));
            assertEquals(data, Files.readString(file()));
        }
    }
    @Test void duplicateUUIDRejected() throws Exception {
        String a=UUID.randomUUID().toString(); Files.writeString(file(),"{\"version\":1,\"silenced\":[\""+a+"\",\""+a+"\"]}");
        assertThrows(IOException.class, () -> new SilenceStore(file()));
    }
    @Test void failedAtomicReplacementDoesNotChangeMemoryOrLeaveTempFiles() throws Exception {
        SilenceStore store = new SilenceStore(file()); UUID a = UUID.randomUUID();
        Files.createDirectory(file()); Files.writeString(file().resolve("keep"),"preserve");
        assertThrows(IOException.class, () -> store.set(a,true)); assertFalse(store.contains(a));
        assertEquals("preserve",Files.readString(file().resolve("keep")));
        try(var files=Files.list(directory)) { assertEquals(1,files.count()); }
    }
    @Test void separateWorldsDoNotShareState() throws Exception {
        UUID a=UUID.randomUUID(); new SilenceStore(file()).set(a,true);
        assertFalse(new SilenceStore(directory.resolve("second-world/state.json")).contains(a));
    }
}
