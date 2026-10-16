package com.mxnsinn.lobby;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class LobbyHoldingTest {
    @TempDir Path root;
    Path holding() throws Exception {
        Path world = root.resolve("profile/.click-interval-seamless-restart/holding-fabric/HoldingLobby");
        Files.createDirectories(world);
        Files.writeString(world.resolve(LobbyScope.HOLDING_MARKER), "Click Interval holding lobby v1\nworld=HoldingLobby\n");
        Files.writeString(world.resolve(LobbyScope.SETTINGS), LobbyCandidateTest.config("HoldingLobby"));
        return world;
    }
    @Test void explicitHoldingActivatesOnlyDedicatedAndExactPath() throws Exception {
        Path world = holding();
        assertTrue(LobbyScope.holdingPath(world));
        assertTrue(LobbyScope.profile(world, true).orElseThrow().holding());
        assertFalse(LobbyScope.profile(world, false).isPresent());
        assertFalse(LobbyScope.marked(world));
    }
    @Test void wrongPathCannotActivateEvenWithValidMarkers() throws Exception {
        Path world = Files.createDirectories(root.resolve("HoldingLobby"));
        Files.writeString(world.resolve(LobbyScope.HOLDING_MARKER), "Click Interval holding lobby v1\nworld=HoldingLobby\n");
        Files.writeString(world.resolve(LobbyScope.MARKER), LobbyScope.CONTENTS);
        Files.writeString(world.resolve(LobbyScope.SETTINGS), LobbyCandidateTest.config("HoldingLobby"));
        assertFalse(LobbyScope.profile(world, true).isPresent());
    }
    @Test void invalidReservedHoldingScopeThrowsInsteadOfHostingUnprotected() throws Exception {
        Path world = holding();
        Files.delete(world.resolve(LobbyScope.HOLDING_MARKER));
        assertThrows(IllegalStateException.class, () -> LobbyScope.profile(world, true));
        Files.writeString(world.resolve(LobbyScope.HOLDING_MARKER), "Click Interval holding lobby v1\nworld=Other\n");
        assertThrows(IllegalStateException.class, () -> LobbyScope.profile(world, true));
    }
    @Test void malformedOrMismatchedSettingsRefuseHoldingStartup() throws Exception {
        Path world = holding();
        Files.writeString(world.resolve(LobbyScope.SETTINGS), LobbyCandidateTest.config("LobbyCandidate-03"));
        assertThrows(IllegalStateException.class, () -> LobbyScope.profile(world, true));
        Files.writeString(world.resolve(LobbyScope.SETTINGS), "bad json");
        assertThrows(IllegalStateException.class, () -> LobbyScope.profile(world, true));
    }
    @Test void legacyAndCandidateMarkersCannotEnableReservedHoldingAlone() throws Exception {
        Path world = holding();
        Files.delete(world.resolve(LobbyScope.HOLDING_MARKER));
        Files.writeString(world.resolve(LobbyScope.MARKER), LobbyScope.CONTENTS);
        Files.writeString(world.resolve(LobbyScope.CANDIDATE_MARKER), "Click Interval lobby candidate v1\nworld=HoldingLobby\n");
        assertThrows(IllegalStateException.class, () -> LobbyScope.profile(world, true));
    }
    @Test void communicationOnlyCommandPolicyRejectsAliasesWrappersAndEscapes() {
        for (String command : new String[]{"help", "list", "/w Alice hello", "minecraft:msg Alice hi", " me hello", "voicechat test Alice"}) {
            assertTrue(LobbyCommands.allowed(command), command);
        }
        for (String command : new String[]{"tp Alice", "tpa base", "minecraft:tp 1 2 3", "execute as @a run kill", "kill", "gamemode creative",
                "give @s diamond", "serverteleport:tpa base", "function escape", "trigger tpa", "minecraft:minecraft:w Alice hi", "//help", "", "HELP"}) {
            assertFalse(LobbyCommands.allowed(command), command);
        }
        assertFalse(LobbyCommands.allowed(null));
    }
}
