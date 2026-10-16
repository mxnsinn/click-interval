package com.mxnsinn.lobby;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class LobbyCandidateTest {
    @TempDir Path root;
    static String config(String world) {
        return """
            {"version":1,"world":"%s","spawn":{"x":103.5,"y":85,"z":-210.5,"yaw":90,"pitch":5},
             "bounds":{"minX":32,"maxX":200,"minY":60,"maxY":150,"minZ":-300,"maxZ":-100}}
            """.formatted(world);
    }
    Path candidate(String name) throws Exception {
        Path world = Files.createDirectory(Files.createTempDirectory(root, "case-").resolve(name));
        Files.writeString(world.resolve(LobbyScope.CANDIDATE_MARKER), "Click Interval lobby candidate v1\nworld=" + name + "\n");
        Files.writeString(world.resolve(LobbyScope.SETTINGS), config(name));
        return world;
    }
    @Test void allThreeExplicitCandidatesHaveTheirOwnCoordinates() throws Exception {
        for (String name : new String[]{"LobbyCandidate-01", "LobbyCandidate-02", "LobbyCandidate-03"}) {
            var settings = LobbyScope.settings(candidate(name)).orElseThrow();
            assertEquals(103.5, settings.x()); assertEquals(85, settings.y()); assertEquals(-210.5, settings.z());
            assertEquals(90, settings.yaw()); assertEquals(5, settings.pitch());
            assertFalse(settings.outside(103.5, 85, -210.5));
            assertTrue(settings.outside(201, 85, -210.5));
            assertTrue(settings.outside(103.5, 59, -210.5));
        }
    }
    @Test void legacyMarkerCannotBypassCandidateValidation() throws Exception {
        Path world = Files.createDirectory(root.resolve("LobbyCandidate-01"));
        Files.writeString(world.resolve(LobbyScope.MARKER), LobbyScope.CONTENTS);
        assertFalse(LobbyScope.marked(world));
    }
    @Test void noOtherNumberOrCaseIsEnabled() throws Exception {
        for (String name : new String[]{"LobbyCandidate-00", "LobbyCandidate-04", "lobbycandidate-01", "Unrelated"}) {
            assertFalse(LobbyScope.marked(candidate(name)));
        }
    }
    @Test void markerMustMatchFolder() throws Exception {
        Path world = candidate("LobbyCandidate-01");
        Files.writeString(world.resolve(LobbyScope.CANDIDATE_MARKER), "Click Interval lobby candidate v1\nworld=LobbyCandidate-02\n");
        assertFalse(LobbyScope.marked(world));
    }
    @Test void configMustMatchFolder() throws Exception {
        Path world = candidate("LobbyCandidate-01");
        Files.writeString(world.resolve(LobbyScope.SETTINGS), config("LobbyCandidate-02"));
        assertFalse(LobbyScope.marked(world));
    }
    @Test void missingOrMalformedConfigIsNeverEnabled() throws Exception {
        Path world = candidate("LobbyCandidate-01"), file = world.resolve(LobbyScope.SETTINGS);
        Files.delete(file); assertFalse(LobbyScope.marked(world));
        Files.writeString(file, "{"); assertFalse(LobbyScope.marked(world));
        Files.writeString(file, "x".repeat(8193)); assertFalse(LobbyScope.marked(world));
    }
    @Test void realSmpAndPriorTestNeverEnableEvenWithBothMarkers() throws Exception {
        for (String name : new String[]{"SMP", "TreeChopTest", "smp", "treechoptest"}) {
            Path world = candidate(name);
            Files.writeString(world.resolve(LobbyScope.MARKER), LobbyScope.CONTENTS);
            assertFalse(LobbyScope.marked(world));
        }
    }
    @Test void crlfMarkerWorksWithoutPermissiveWhitespace() throws Exception {
        Path world = candidate("LobbyCandidate-01"), marker = world.resolve(LobbyScope.CANDIDATE_MARKER);
        Files.writeString(marker, "Click Interval lobby candidate v1\r\nworld=LobbyCandidate-01\r\n");
        assertTrue(LobbyScope.marked(world));
        Files.writeString(marker, " Click Interval lobby candidate v1\nworld=LobbyCandidate-01\n");
        assertFalse(LobbyScope.marked(world));
    }
    @Test void invalidNumericTypesAndUnexpectedKeysAreRejected() {
        String valid = config("LobbyCandidate-01");
        for (String invalid : new String[]{valid.replace("103.5", "\"103.5\""), valid.replace("103.5", "NaN"),
                valid.replace("103.5", "1e999"), valid.replace("\"yaw\":90", "\"yaw\":999"),
                valid.replace("\"pitch\":5", "\"pitch\":100"), valid.replace("\"version\":1", "\"version\":2"),
                valid.replace("\"version\":1", "\"unknown\":true,\"version\":1")}) {
            assertThrows(RuntimeException.class, () -> LobbySettings.parse(invalid, "LobbyCandidate-01"));
        }
    }
    @Test void invalidBoundariesAndOutOfBoundsSpawnsAreRejected() {
        String valid = config("LobbyCandidate-01");
        for (String invalid : new String[]{valid.replace("\"minX\":32", "\"minX\":200"),
                valid.replace("\"maxX\":200", "\"maxX\":9000"), valid.replace("\"minY\":60", "\"minY\":-65"),
                valid.replace("\"maxY\":150", "\"maxY\":321"), valid.replace("103.5", "201"),
                valid.replace("\"y\":85", "\"y\":60"), valid.replace("\"z\":-210.5", "\"z\":0")}) {
            assertThrows(RuntimeException.class, () -> LobbySettings.parse(invalid, "LobbyCandidate-01"));
        }
    }
    @Test void immutableParsedSettingsDoNotFollowLaterFileEdits() throws Exception {
        Path world = candidate("LobbyCandidate-01");
        LobbySettings loaded = LobbyScope.settings(world).orElseThrow();
        Files.writeString(world.resolve(LobbyScope.SETTINGS), "invalid");
        assertEquals(103.5, loaded.x()); assertFalse(LobbyScope.marked(world));
        assertTrue(loaded.outside(Double.NaN, 85, -210));
    }
    @Test void modernNegativeYSpawnIsSupported() {
        LobbySettings settings = LobbySettings.parse(config("LobbyCandidate-02")
                .replace("\"y\":85", "\"y\":-23").replace("\"minY\":60", "\"minY\":-63"), "LobbyCandidate-02");
        assertEquals(-23, settings.y()); assertFalse(settings.outside(103.5, -23, -210.5));
        assertTrue(settings.outside(103.5, -64, -210.5));
    }
}
