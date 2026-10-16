package com.clickinterval.advancementsilence;

import com.google.gson.*;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Loaded once per world; advancement awards only perform an in-memory UUID lookup. */
final class SilenceStore {
    private static final long MAX_BYTES = 4 * 1024 * 1024;
    private final Path file;
    private Set<UUID> silenced;

    SilenceStore(Path file) throws IOException {
        this.file = file;
        silenced = read(file);
    }

    boolean contains(UUID player) { return silenced.contains(player); }
    int size() { return silenced.size(); }

    boolean set(UUID player, boolean value) throws IOException {
        Objects.requireNonNull(player);
        if (silenced.contains(player) == value) return false;
        var next = new HashSet<>(silenced);
        if (value) next.add(player); else next.remove(player);
        JsonObject json = new JsonObject();
        json.addProperty("version", 1);
        JsonArray entries = new JsonArray();
        next.stream().map(UUID::toString).sorted().forEach(entries::add);
        json.add("silenced", entries);
        byte[] bytes = (new GsonBuilder().setPrettyPrinting().create().toJson(json) + "\n").getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("Silence settings exceed the supported size");
        Files.createDirectories(file.toAbsolutePath().getParent());
        Path temporary = Files.createTempFile(file.toAbsolutePath().getParent(), ".advancement-silence-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            // Refuse non-atomic replacement instead of risking truncation on a crash.
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            silenced = Set.copyOf(next);
            return true;
        } finally { Files.deleteIfExists(temporary); }
    }

    private static Set<UUID> read(Path file) throws IOException {
        if (!Files.exists(file)) return Set.of();
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_BYTES)
            throw new IOException("Invalid or oversized advancement silence settings");
        try {
            JsonObject json = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!json.keySet().equals(Set.of("version", "silenced")) || !json.get("version").toString().equals("1"))
                throw new IllegalArgumentException("Unsupported silence settings schema");
            Set<UUID> result = new HashSet<>();
            for (JsonElement entry : json.getAsJsonArray("silenced")) {
                if (!entry.isJsonPrimitive() || !entry.getAsJsonPrimitive().isString())
                    throw new IllegalArgumentException("Expected a UUID string");
                String text = entry.getAsString();
                UUID id = UUID.fromString(text);
                if (!id.toString().equals(text) || !result.add(id))
                    throw new IllegalArgumentException("Invalid or duplicate UUID");
            }
            return Set.copyOf(result);
        } catch (RuntimeException failure) { throw new IOException("Malformed advancement silence settings; existing file was not changed", failure); }
    }
}
