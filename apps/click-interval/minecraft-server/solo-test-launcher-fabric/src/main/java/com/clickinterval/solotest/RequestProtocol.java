package com.clickinterval.solotest;

import com.google.gson.JsonObject;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.*;
import java.util.*;

/** Bounded, strict one-shot file protocol. No world is ever created here. */
final class RequestProtocol {
    static final String WORLD = "TreeChopTest";
    static final String TEST_WORLD = "TestWorld";
    static final String TEST_WORLD_MARKER = ".clickinterval-test-world";
    static final String TEST_WORLD_MARKER_CONTENT = "Click Interval test world v1\nworld=TestWorld\n";
    static final Set<String> CANDIDATES = Set.of("LobbyCandidate-01", "LobbyCandidate-02", "LobbyCandidate-03");
    static final String CANDIDATE_MARKER = ".clickinterval-lobby-candidate";
    static final String REQUEST_NAME = "clickinterval-solo-test-open.json";
    static final Path EXPECTED_GAME = Path.of("C:/Users/example/AppData/Roaming/.minecraft");
    static final Path EXPECTED_WORLD = EXPECTED_GAME.resolve("saves").resolve(WORLD);
    record Request(String world, UUID ticket, Instant expiresAt, boolean screenshot) {}
    private final Path game, expected;
    RequestProtocol(Path game, Path expected) { this.game=game.toAbsolutePath().normalize(); this.expected=expected.toAbsolutePath().normalize(); }
    Path requestPath() { return game.resolve("config").resolve(REQUEST_NAME); }
    Path reportRoot() { return game.resolve("config/clickinterval-solo-test-launcher"); }

    static Request parse(byte[] bytes, Instant now) throws IOException {
        if(bytes.length==0 || bytes.length>1024) throw new IOException("Request size rejected");
        Map<String,String> fields=new HashMap<>();
        try(JsonReader reader=new JsonReader(new StringReader(new String(bytes,StandardCharsets.UTF_8)))) {
            reader.setStrictness(com.google.gson.Strictness.STRICT);
            reader.beginObject();
            while(reader.hasNext()) {
                String key=reader.nextName();
                if(!Set.of("world","ticket","expiresAt","screenshot").contains(key) || fields.containsKey(key))
                    throw new IOException("Unexpected or duplicate request field");
                if(key.equals("screenshot")) {
                    if(reader.peek()!=JsonToken.BOOLEAN) throw new IOException("Screenshot flag must be boolean");
                    fields.put(key,Boolean.toString(reader.nextBoolean()));
                } else {
                    if(reader.peek()!=JsonToken.STRING) throw new IOException("Non-string request field");
                    fields.put(key,reader.nextString());
                }
            }
            reader.endObject();
            if(reader.peek()!=JsonToken.END_DOCUMENT || !fields.keySet().containsAll(Set.of("world","ticket","expiresAt"))
                    || !allowedWorld(fields.get("world"))) throw new IOException("Invalid request shape or world");
            boolean screenshot=Boolean.parseBoolean(fields.getOrDefault("screenshot","false"));
            if(screenshot && !CANDIDATES.contains(fields.get("world"))) throw new IOException("Screenshots are restricted to marked lobby candidates");
            UUID ticket=UUID.fromString(fields.get("ticket"));
            if(!ticket.toString().equals(fields.get("ticket"))) throw new IOException("Noncanonical ticket");
            Instant expires=Instant.parse(fields.get("expiresAt"));
            if(!expires.isAfter(now) || expires.isAfter(now.plus(Duration.ofMinutes(30)))) throw new IOException("Expired or excessively long-lived request");
            return new Request(fields.get("world"),ticket,expires,screenshot);
        } catch(RuntimeException invalid) { throw new IOException("Malformed request",invalid); }
    }

    static boolean allowedWorld(String world) { return world!=null && (testHubWorld(world) || CANDIDATES.contains(world)); }
    /** This is intentionally narrower than the opener allowlist: lobby previews never gain test tools. */
    static boolean testHubWorld(String world) { return WORLD.equals(world) || TEST_WORLD.equals(world); }
    static String candidateMarker(String world) throws IOException {
        if(!CANDIDATES.contains(world)) throw new IOException("Not an allowlisted lobby candidate");
        return "Click Interval lobby candidate v1\nworld="+world+"\n";
    }
    Path expectedWorld(String world) throws IOException {
        if(!allowedWorld(world)) throw new IOException("World not allowlisted");
        return expected.resolve("saves").resolve(world);
    }

    static void plain(Path path, boolean directory) throws IOException {
        Path absolute=path.toAbsolutePath().normalize();
        for(Path item=absolute; item!=null; item=item.getParent()) {
            BasicFileAttributes attr=Files.readAttributes(item,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
            if(attr.isSymbolicLink() || attr.isOther() || (item.equals(absolute)?(directory?!attr.isDirectory():!attr.isRegularFile()):!attr.isDirectory()))
                throw new IOException("Linked or nonordinary path refused");
        }
    }
    void validateWorld(Path saveBase) throws IOException {
        validateWorld(saveBase,WORLD);
    }
    void validateWorld(Path saveBase,String worldName) throws IOException {
        plain(game,true); plain(expected,true);
        if(!game.toRealPath().equals(expected.toRealPath())) throw new IOException("Unexpected game directory");
        Path expectedSaves=expected.resolve("saves"), world=expectedWorld(worldName);
        plain(expectedSaves,true); plain(saveBase,true); plain(world,true); plain(world.resolve("level.dat"),false);
        if(!saveBase.toRealPath().equals(expectedSaves.toRealPath()) || !saveBase.resolve(worldName).toRealPath().equals(world.toRealPath()))
            throw new IOException("Unexpected saves directory");
        if(CANDIDATES.contains(worldName)) {
            Path marker=world.resolve(CANDIDATE_MARKER); plain(marker,false);
            if(Files.size(marker)>256 || !Arrays.equals(candidateMarker(worldName).getBytes(StandardCharsets.UTF_8),readBounded(marker)))
                throw new IOException("Candidate marker is missing, changed or belongs to another world");
        }
        if(TEST_WORLD.equals(worldName)) {
            Path marker=world.resolve(TEST_WORLD_MARKER); plain(marker,false);
            if(Files.size(marker)>256 || !Arrays.equals(TEST_WORLD_MARKER_CONTENT.getBytes(StandardCharsets.UTF_8),readBounded(marker)))
                throw new IOException("Test World marker is missing or changed");
        }
    }
    void validateTestHubWorld(Path openedWorld) throws IOException {
        Path world=openedWorld.toAbsolutePath().normalize();
        String name=world.getFileName()==null?"":world.getFileName().toString();
        if(!testHubWorld(name)) throw new IOException("Test tools are not permitted in this world");
        validateWorld(expected.resolve("saves"),name);
        plain(world,true);
        if(!world.toRealPath().equals(expectedWorld(name).toRealPath())) throw new IOException("Test tools require the exact test save");
    }
    Request consume(Path saveBase, Instant now) throws IOException {
        Path source=requestPath(); plain(source,false);
        if(Files.size(source)>1024) throw new IOException("Oversized request");
        byte[] bytes=readBounded(source); Request request=parse(bytes,now);
        validateWorld(saveBase,request.world());
        Path root=reportRoot(); directory(root); directory(root.resolve("requests")); directory(root.resolve("status"));
        Path archive=root.resolve("requests").resolve(request.ticket()+".json");
        if(Files.exists(archive,LinkOption.NOFOLLOW_LINKS)) throw new IOException("Request ticket already consumed");
        if(!Arrays.equals(bytes,readBounded(source))) throw new IOException("Request changed while validating");
        // Never REPLACE_EXISTING: retain both evidence and replay protection.
        Files.move(source,archive);
        plain(archive,false);
        if(!Arrays.equals(bytes,readBounded(archive))) throw new IOException("Consumed request differs");
        report(request,"consumed","Validated existing save; native open pending");
        return request;
    }
    private static byte[] readBounded(Path path) throws IOException {
        try(InputStream stream=Files.newInputStream(path,LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes=stream.readNBytes(1025);
            if(bytes.length>1024) throw new IOException("Oversized request");
            return bytes;
        }
    }
    private static void directory(Path path) throws IOException {
        if(!Files.exists(path,LinkOption.NOFOLLOW_LINKS)) { plain(path.getParent(),true); Files.createDirectory(path); }
        plain(path,true);
    }
    void report(Request request,String phase,String detail) throws IOException {
        if(!Set.of("consumed","opening","opened","cancelled","failed").contains(phase)) throw new IOException("Invalid phase");
        Path directory=reportRoot().resolve("status"); plain(directory,true);
        JsonObject json=new JsonObject(); json.addProperty("ticket",request.ticket().toString()); json.addProperty("world",request.world());
        json.addProperty("phase",phase); json.addProperty("at",Instant.now().toString()); json.addProperty("detail",detail);
        Files.writeString(directory.resolve(request.ticket()+"-"+phase+".json"),json+"\n",StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
    }
}
