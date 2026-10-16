package com.clickinterval.solotest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class TestWorldProtocolTest {
    @TempDir Path temporary;
    final Instant now=Instant.parse("2026-10-09T12:00:00Z");
    final String ticket="02928f23-e3ed-42ea-81e2-61088c6a010e";
    Path game(){return temporary.resolve("game");}
    Path world(){return game().resolve("saves/TestWorld");}
    Path marker(){return world().resolve(RequestProtocol.TEST_WORLD_MARKER);}
    String request(){return "{\"world\":\"TestWorld\",\"ticket\":\""+ticket+"\",\"expiresAt\":\"2026-10-09T12:10:00Z\"}";}
    byte[] bytes(String text){return text.getBytes(StandardCharsets.UTF_8);}
    RequestProtocol fixture(boolean marked)throws Exception{
        Files.createDirectories(world());Files.createDirectory(game().resolve("config"));Files.write(world().resolve("level.dat"),new byte[]{1});
        if(marked)Files.writeString(marker(),RequestProtocol.TEST_WORLD_MARKER_CONTENT,StandardCharsets.UTF_8);
        return new RequestProtocol(game(),game());
    }
    @Test void markerContractHasExactFolderTextAndFinalLf(){
        assertEquals("TestWorld",RequestProtocol.TEST_WORLD);
        assertEquals(".clickinterval-test-world",RequestProtocol.TEST_WORLD_MARKER);
        assertEquals("Click Interval test world v1\nworld=TestWorld\n",RequestProtocol.TEST_WORLD_MARKER_CONTENT);
    }
    @Test void exactNewWorldParsesButAliasesTraversalAndScreenshotsDoNot()throws Exception{
        assertEquals("TestWorld",RequestProtocol.parse(bytes(request()),now).world());
        for(String wrong:new String[]{"Test World","testworld","TestWorld2","../TestWorld","TestWorld/../SMP","TestWorld.","C:/TestWorld","TreeChopTestCopy"})
            assertThrows(IOException.class,()->RequestProtocol.parse(bytes(request().replace("TestWorld",wrong)),now),wrong);
        assertThrows(IOException.class,()->RequestProtocol.parse(bytes(request().replace("}",",\"screenshot\":true}")),now));
    }
    @Test void consumesOnlyMarkedExistingWorldAndRetainsReplayEvidence()throws Exception{
        RequestProtocol protocol=fixture(true);Files.writeString(protocol.requestPath(),request());
        var consumed=protocol.consume(game().resolve("saves"),now);assertEquals("TestWorld",consumed.world());
        assertEquals(world(),protocol.expectedWorld(consumed.world()));assertFalse(Files.exists(protocol.requestPath()));
        assertEquals(request(),Files.readString(protocol.reportRoot().resolve("requests/"+ticket+".json")));
        assertTrue(Files.readString(protocol.reportRoot().resolve("status/"+ticket+"-consumed.json")).contains("\"world\":\"TestWorld\""));
        assertFalse(Files.exists(game().resolve("saves/TreeChopTest")));
        Files.writeString(protocol.requestPath(),request());assertThrows(IOException.class,()->protocol.consume(game().resolve("saves"),now));assertTrue(Files.exists(protocol.requestPath()));
    }
    @Test void absentChangedForeignAndOversizedMarkersNeverConsume()throws Exception{
        RequestProtocol protocol=fixture(false);Files.writeString(protocol.requestPath(),request());
        assertThrows(IOException.class,()->protocol.consume(game().resolve("saves"),now));
        for(String invalid:new String[]{"",RequestProtocol.candidateMarker("LobbyCandidate-01"),RequestProtocol.TEST_WORLD_MARKER_CONTENT.strip(),"\ufeff"+RequestProtocol.TEST_WORLD_MARKER_CONTENT,RequestProtocol.TEST_WORLD_MARKER_CONTENT.replace("TestWorld","SMP"),RequestProtocol.TEST_WORLD_MARKER_CONTENT.replace("\n","\r\n"),"x".repeat(257)}){
            Files.writeString(marker(),invalid,StandardCharsets.UTF_8);assertThrows(IOException.class,()->protocol.consume(game().resolve("saves"),now));assertTrue(Files.exists(protocol.requestPath()));
        }
        assertFalse(Files.exists(protocol.reportRoot()));
    }
    @Test void markerIsRecheckedForTestToolsAndPostConsumptionValidation()throws Exception{
        RequestProtocol protocol=fixture(true);protocol.validateTestHubWorld(world());Files.writeString(protocol.requestPath(),request());protocol.consume(game().resolve("saves"),now);
        Files.writeString(marker(),"changed");assertThrows(IOException.class,()->protocol.validateTestHubWorld(world()));assertThrows(IOException.class,()->protocol.validateWorld(game().resolve("saves"),"TestWorld"));
    }
    @Test void toolsRejectLobbyCandidatesOtherRootsAndUnmarkedNewWorldButKeepLegacy()throws Exception{
        RequestProtocol protocol=fixture(false);assertThrows(IOException.class,()->protocol.validateTestHubWorld(world()));
        for(String name:RequestProtocol.CANDIDATES){Path candidate=game().resolve("saves").resolve(name);Files.createDirectories(candidate);Files.write(candidate.resolve("level.dat"),new byte[]{1});Files.writeString(candidate.resolve(RequestProtocol.CANDIDATE_MARKER),RequestProtocol.candidateMarker(name));assertThrows(IOException.class,()->protocol.validateTestHubWorld(candidate));}
        Files.writeString(marker(),RequestProtocol.TEST_WORLD_MARKER_CONTENT);Path other=temporary.resolve("other/TestWorld");Files.createDirectories(other);Files.write(other.resolve("level.dat"),new byte[]{1});Files.writeString(other.resolve(RequestProtocol.TEST_WORLD_MARKER),RequestProtocol.TEST_WORLD_MARKER_CONTENT);
        assertThrows(IOException.class,()->protocol.validateTestHubWorld(other));
        Path legacy=game().resolve("saves/TreeChopTest");Files.createDirectory(legacy);Files.write(legacy.resolve("level.dat"),new byte[]{1});protocol.validateTestHubWorld(legacy);
        assertTrue(RequestProtocol.testHubWorld("TreeChopTest"));assertTrue(RequestProtocol.testHubWorld("TestWorld"));assertFalse(RequestProtocol.testHubWorld("SMP"));
    }
    @Test void copiedMarkerCannotAuthorizeArbitraryNameAndMissingLevelFails()throws Exception{
        RequestProtocol protocol=fixture(true);Path other=game().resolve("saves/SMP");Files.createDirectory(other);Files.write(other.resolve("level.dat"),new byte[]{1});Files.writeString(other.resolve(RequestProtocol.TEST_WORLD_MARKER),RequestProtocol.TEST_WORLD_MARKER_CONTENT);
        assertThrows(IOException.class,()->protocol.validateTestHubWorld(other));assertThrows(IOException.class,()->protocol.validateWorld(game().resolve("saves"),"SMP"));
        Files.delete(world().resolve("level.dat"));assertThrows(IOException.class,()->protocol.validateTestHubWorld(world()));
    }
    @Test void linkedMarkerIsRejected()throws Exception{
        RequestProtocol protocol=fixture(false);Path target=temporary.resolve("marker");Files.writeString(target,RequestProtocol.TEST_WORLD_MARKER_CONTENT);
        try{Files.createSymbolicLink(marker(),target);}catch(IOException|UnsupportedOperationException e){assumeTrue(false,"Symlink creation unavailable");}
        assertThrows(IOException.class,()->protocol.validateTestHubWorld(world()));
    }
    @Test void otherGameDirectoryCannotUseMarkedTestWorld()throws Exception{
        fixture(true);Path expected=temporary.resolve("different-game");Files.createDirectories(expected);
        RequestProtocol protocol=new RequestProtocol(game(),expected);assertThrows(IOException.class,()->protocol.validateTestHubWorld(world()));
    }
}
