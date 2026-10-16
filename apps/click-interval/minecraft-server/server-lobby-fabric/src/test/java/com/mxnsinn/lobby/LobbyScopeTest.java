package com.mxnsinn.lobby;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class LobbyScopeTest {
    @TempDir Path root;
    @Test void unrelatedWorldIsNeverEnabled() { assertFalse(LobbyScope.marked(root)); }
    @Test void displayNameAloneIsInsufficient() throws Exception {
        Path world = Files.createDirectory(root.resolve("MXNSINN Lobby Preview"));
        assertFalse(LobbyScope.marked(world));
    }
    @Test void onlyExactMarkerEnables() throws Exception {
        Path marker = root.resolve(LobbyScope.MARKER);
        Files.writeString(marker, "other world"); assertFalse(LobbyScope.marked(root));
        Files.writeString(marker, LobbyScope.CONTENTS + "\r\n"); assertTrue(LobbyScope.marked(root));
    }
    @Test void oversizedAndDirectoryMarkersAreIgnored() throws Exception {
        Path marker = root.resolve(LobbyScope.MARKER);
        Files.createDirectory(marker); assertFalse(LobbyScope.marked(root));
        Files.delete(marker);
        Files.writeString(marker, "x".repeat(129)); assertFalse(LobbyScope.marked(root));
    }
}
