package com.clickinterval.solotest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class LobbyCandidateProtocolTest {
    @TempDir Path temporary;
    final Instant now=Instant.parse("2026-10-09T12:00:00Z");
    final String ticket="02928f23-e3ed-42ea-81e2-61088c6a010e";
    String request(String name) { return "{\"world\":\""+name+"\",\"ticket\":\""+ticket+"\",\"expiresAt\":\"2026-10-09T12:10:00Z\"}"; }
    byte[] bytes(String text) { return text.getBytes(StandardCharsets.UTF_8); }
    RequestProtocol fixture(String name,boolean marker) throws Exception {
        Path game=temporary.resolve("game"); Files.createDirectories(game.resolve("saves").resolve(name));
        Files.createDirectories(game.resolve("config")); Files.write(game.resolve("saves").resolve(name).resolve("level.dat"),new byte[]{1});
        if(marker) Files.writeString(game.resolve("saves").resolve(name).resolve(RequestProtocol.CANDIDATE_MARKER),RequestProtocol.candidateMarker(name));
        return new RequestProtocol(game,game);
    }
    @Test void onlyThreeExactCandidateNamesAreAccepted() throws Exception {
        for(String name:RequestProtocol.CANDIDATES) {
            var parsed=RequestProtocol.parse(bytes(request(name)),now); assertEquals(name,parsed.world()); assertFalse(parsed.screenshot());
        }
        for(String name:new String[]{"LobbyCandidate-00","LobbyCandidate-04","LobbyCandidate-1","LobbyCandidate-SMP","lobbycandidate-01","../LobbyCandidate-01","LobbyCandidate-01/../SMP","SMP","LobbyCandidate-01.","C:/LobbyCandidate-01"})
            assertThrows(IOException.class,()->RequestProtocol.parse(bytes(request(name)),now),name);
    }
    @Test void screenshotRequiresBooleanAndCandidateAndRejectsDuplicate() throws Exception {
        String base=request("LobbyCandidate-01");
        assertTrue(RequestProtocol.parse(bytes(base.replace("}",",\"screenshot\":true}")),now).screenshot());
        assertFalse(RequestProtocol.parse(bytes(base.replace("}",",\"screenshot\":false}")),now).screenshot());
        for(String invalid:new String[]{base.replace("}",",\"screenshot\":\"true\"}"),base.replace("}",",\"screenshot\":null}"),
                base.replace("}",",\"screenshot\":true,\"screenshot\":false}"),request("TreeChopTest").replace("}",",\"screenshot\":true}")})
            assertThrows(IOException.class,()->RequestProtocol.parse(bytes(invalid),now));
    }
    @Test void candidateConsumesAndReportsActualWorldWithoutTreeChopTestExisting() throws Exception {
        var protocol=fixture("LobbyCandidate-02",true); Files.writeString(protocol.requestPath(),request("LobbyCandidate-02"));
        var consumed=protocol.consume(temporary.resolve("game/saves"),now);
        assertEquals("LobbyCandidate-02",consumed.world());
        assertEquals(temporary.resolve("game/saves/LobbyCandidate-02"),protocol.expectedWorld(consumed.world()));
        String report=Files.readString(protocol.reportRoot().resolve("status/"+ticket+"-consumed.json"));
        assertTrue(report.contains("\"world\":\"LobbyCandidate-02\""));
        assertFalse(Files.exists(temporary.resolve("game/saves/TreeChopTest")));
    }
    @Test void missingWrongAndOversizedMarkersRetainRequest() throws Exception {
        var protocol=fixture("LobbyCandidate-01",false); Files.writeString(protocol.requestPath(),request("LobbyCandidate-01"));
        Path marker=temporary.resolve("game/saves/LobbyCandidate-01").resolve(RequestProtocol.CANDIDATE_MARKER);
        assertThrows(IOException.class,()->protocol.consume(temporary.resolve("game/saves"),now));
        for(String text:new String[]{RequestProtocol.candidateMarker("LobbyCandidate-02"),RequestProtocol.candidateMarker("LobbyCandidate-01").strip(),"x".repeat(257),"\ufeff"+RequestProtocol.candidateMarker("LobbyCandidate-01")}) {
            Files.writeString(marker,text); assertThrows(IOException.class,()->protocol.consume(temporary.resolve("game/saves"),now));
            assertTrue(Files.isRegularFile(protocol.requestPath()));
        }
        assertFalse(Files.exists(protocol.reportRoot()));
    }
    @Test void anotherSaveRootAndMissingLevelAreRejected() throws Exception {
        var protocol=fixture("LobbyCandidate-03",true); Files.writeString(protocol.requestPath(),request("LobbyCandidate-03"));
        Path other=Files.createDirectory(temporary.resolve("other"));
        assertThrows(IOException.class,()->protocol.consume(other,now));
        Files.delete(temporary.resolve("game/saves/LobbyCandidate-03/level.dat"));
        assertThrows(IOException.class,()->protocol.consume(temporary.resolve("game/saves"),now));
        assertTrue(Files.exists(protocol.requestPath()));
    }
    @Test void markerIsRevalidatedAfterConsumption() throws Exception {
        var protocol=fixture("LobbyCandidate-01",true); Files.writeString(protocol.requestPath(),request("LobbyCandidate-01"));
        var consumed=protocol.consume(temporary.resolve("game/saves"),now);
        Files.writeString(temporary.resolve("game/saves/LobbyCandidate-01").resolve(RequestProtocol.CANDIDATE_MARKER),"changed");
        assertThrows(IOException.class,()->protocol.validateWorld(temporary.resolve("game/saves"),consumed.world()));
    }
    @Test void linkedMarkerRejected() throws Exception {
        var protocol=fixture("LobbyCandidate-01",false); Files.writeString(protocol.requestPath(),request("LobbyCandidate-01"));
        Path target=temporary.resolve("marker-source"); Files.writeString(target,RequestProtocol.candidateMarker("LobbyCandidate-01"));
        try { Files.createSymbolicLink(temporary.resolve("game/saves/LobbyCandidate-01").resolve(RequestProtocol.CANDIDATE_MARKER),target); }
        catch(IOException|UnsupportedOperationException denied) { assumeTrue(false,"Symlink creation unavailable"); }
        assertThrows(IOException.class,()->protocol.consume(temporary.resolve("game/saves"),now));
        assertTrue(Files.exists(protocol.requestPath()));
    }
    @Test void existingTestHubDelegatesToNarrowMarkedWorldGateNotLobbyAllowlist() throws Exception {
        String code=new String(getClass().getResourceAsStream("/com/clickinterval/solotest/TestHub.class").readAllBytes(),StandardCharsets.ISO_8859_1);
        assertTrue(code.contains("validateTestHubWorld")); assertFalse(code.contains("CANDIDATES")); assertFalse(code.contains("allowedWorld"));
        for(String candidate:RequestProtocol.CANDIDATES) assertFalse(RequestProtocol.testHubWorld(candidate));
    }
}
