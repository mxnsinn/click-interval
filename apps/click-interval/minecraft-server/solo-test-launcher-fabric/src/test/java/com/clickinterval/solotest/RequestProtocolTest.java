package com.clickinterval.solotest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class RequestProtocolTest {
    @TempDir Path temporary;
    final Instant now=Instant.parse("2026-10-09T12:00:00Z");
    final String ticket="02928f23-e3ed-42ea-81e2-61088c6a010e";
    String request() { return "{\"world\":\"TreeChopTest\",\"ticket\":\""+ticket+"\",\"expiresAt\":\"2026-10-09T12:10:00Z\"}"; }
    byte[] bytes(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    RequestProtocol fixture() throws Exception {
        Path game=temporary.resolve("game"); Files.createDirectories(game.resolve("saves/TreeChopTest")); Files.createDirectory(game.resolve("config"));
        Files.write(game.resolve("saves/TreeChopTest/level.dat"),new byte[]{1});
        return new RequestProtocol(game,game);
    }
    @Test void strictValidRequest() throws Exception { assertEquals(UUID.fromString(ticket),RequestProtocol.parse(bytes(request()),now).ticket()); }
    @Test void rejectsWrongWorldDuplicateUnknownAndType() {
        for(String invalid:new String[]{request().replace("TreeChopTest","SMP"),request().replace("\"world\":", "\"world\":\"TreeChopTest\",\"world\":"),request().replace("\"ticket\"","\"other\""),request().replace("\"TreeChopTest\"","3"),request()+"{}"})
            assertThrows(IOException.class,()->RequestProtocol.parse(bytes(invalid),now));
    }
    @Test void rejectsExpiredFarFutureMalformedAndOversized() {
        for(String invalid:new String[]{request().replace("12:10:00","11:59:00"),request().replace("12:10:00","13:00:00"),request().replace(ticket,"1-1-1-1-1"),request().replace("12:10:00","invalid")," ".repeat(1025)})
            assertThrows(IOException.class,()->RequestProtocol.parse(bytes(invalid),now));
    }
    @Test void consumesRecoverablyAndRejectsReplayedTicket() throws Exception {
        RequestProtocol protocol=fixture(); Files.writeString(protocol.requestPath(),request());
        var consumed=protocol.consume(protocol.requestPath().getParent().getParent().resolve("saves"),now);
        assertEquals(ticket,consumed.ticket().toString()); assertFalse(Files.exists(protocol.requestPath()));
        Path archive=protocol.reportRoot().resolve("requests/"+ticket+".json"); assertEquals(request(),Files.readString(archive));
        assertTrue(Files.isRegularFile(protocol.reportRoot().resolve("status/"+ticket+"-consumed.json")));
        Files.writeString(protocol.requestPath(),request());
        assertThrows(IOException.class,()->protocol.consume(protocol.requestPath().getParent().getParent().resolve("saves"),now));
        assertTrue(Files.exists(protocol.requestPath())); assertEquals(request(),Files.readString(archive));
    }
    @Test void mismatchedSaveRootAndMissingWorldNeverConsume() throws Exception {
        RequestProtocol protocol=fixture(); Files.writeString(protocol.requestPath(),request());
        Path unrelated=Files.createDirectory(temporary.resolve("unrelated"));
        assertThrows(IOException.class,()->protocol.consume(unrelated,now)); assertTrue(Files.exists(protocol.requestPath()));
        Path game=protocol.requestPath().getParent().getParent(); Files.delete(game.resolve("saves/TreeChopTest/level.dat"));
        assertThrows(IOException.class,()->protocol.consume(game.resolve("saves"),now)); assertTrue(Files.exists(protocol.requestPath()));
    }
    @Test void differentGameDirectoryRejected() throws Exception {
        RequestProtocol valid=fixture(); Path expected=Files.createDirectory(temporary.resolve("expected"));
        var invalid=new RequestProtocol(valid.requestPath().getParent().getParent(),expected);
        assertThrows(IOException.class,()->invalid.validateWorld(temporary.resolve("game/saves")));
    }
    @Test void reportsCannotOverwriteEvidence() throws Exception {
        RequestProtocol protocol=fixture(); Files.writeString(protocol.requestPath(),request());
        var consumed=protocol.consume(temporary.resolve("game/saves"),now);
        assertThrows(FileAlreadyExistsException.class,()->protocol.report(consumed,"consumed","overwrite"));
        assertThrows(IOException.class,()->protocol.report(consumed,"../escape","bad"));
    }
}
