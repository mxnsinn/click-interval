package com.servermanager.teleport.core;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Versioned saved-place persistence. A complete replacement is forced to a sibling temporary file
 * and then atomically renamed, so a failed write never truncates the last good file.
 */
public final class PlaceFile {
    private static final String FORMAT_VERSION_KEY = "format-version";
    private static final String FORMAT_VERSION = "1";
    private static final long MAX_FILE_BYTES = 16L * 1024L * 1024L;
    private static final int MAX_WARNINGS = 32;
    private static final Pattern PROPERTY_KEY = Pattern.compile(
            "places\\.([0-9a-fA-F-]{36})\\.([A-Za-z0-9_-]{1,24})\\."
                    + "(world-uuid|world-name|x|y|z|yaw|pitch)"
    );
    private static final List<String> REQUIRED_FIELDS = List.of(
            "world-uuid", "world-name", "x", "y", "z", "yaw", "pitch"
    );

    private final Path file;

    public PlaceFile(Path file) {
        if (file == null) throw new IllegalArgumentException("file is required");
        this.file = file.toAbsolutePath().normalize();
    }

    public Path path() {
        return file;
    }

    public LoadResult load() throws IOException {
        if (!Files.exists(file)) return new LoadResult(new PlaceBook(), List.of());
        if (!Files.isRegularFile(file) || Files.size(file) > MAX_FILE_BYTES) {
            throw new IOException("saved-place file is not a regular file or exceeds 16 MiB");
        }

        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            properties.load(reader);
        } catch (IllegalArgumentException malformed) {
            throw new IOException("saved-place file contains malformed escapes", malformed);
        }
        if (!FORMAT_VERSION.equals(properties.getProperty(FORMAT_VERSION_KEY))) {
            throw new IOException("saved-place file has a missing or unsupported format version");
        }

        Comparator<EntryKey> order = Comparator
                .comparing((EntryKey key) -> key.playerId().toString())
                .thenComparing(EntryKey::name);
        Map<EntryKey, Map<String, String>> grouped = new TreeMap<>(order);
        int ignoredKeys = 0;
        for (String key : properties.stringPropertyNames()) {
            if (FORMAT_VERSION_KEY.equals(key)) continue;
            Matcher matcher = PROPERTY_KEY.matcher(key);
            if (!matcher.matches() || !PlaceNames.isValid(matcher.group(2))) {
                ignoredKeys++;
                continue;
            }
            UUID playerId;
            try {
                playerId = UUID.fromString(matcher.group(1));
            } catch (IllegalArgumentException invalidUuid) {
                ignoredKeys++;
                continue;
            }
            EntryKey entry = new EntryKey(playerId, PlaceNames.normalize(matcher.group(2)));
            grouped.computeIfAbsent(entry, ignored -> new LinkedHashMap<>())
                    .put(matcher.group(3), properties.getProperty(key));
        }

        PlaceBook result = new PlaceBook();
        List<String> warnings = new ArrayList<>();
        if (ignoredKeys > 0) addWarning(warnings, "Ignored " + ignoredKeys + " unrecognized properties.");
        for (Map.Entry<EntryKey, Map<String, String>> entry : grouped.entrySet()) {
            EntryKey key = entry.getKey();
            Map<String, String> fields = entry.getValue();
            if (!fields.keySet().containsAll(REQUIRED_FIELDS)) {
                addWarning(warnings, "Skipped incomplete place " + key.name() + " for " + key.playerId() + ".");
                continue;
            }
            try {
                SavedPlace place = new SavedPlace(
                        UUID.fromString(fields.get("world-uuid")),
                        fields.get("world-name"),
                        Double.parseDouble(fields.get("x")),
                        Double.parseDouble(fields.get("y")),
                        Double.parseDouble(fields.get("z")),
                        Float.parseFloat(fields.get("yaw")),
                        Float.parseFloat(fields.get("pitch"))
                );
                if (result.put(key.playerId(), key.name(), place) == PlaceBook.PutResult.LIMIT_REACHED) {
                    addWarning(warnings, "Skipped place " + key.name() + " because the player limit is 16.");
                }
            } catch (IllegalArgumentException invalidPlace) {
                addWarning(warnings, "Skipped invalid place " + key.name() + " for " + key.playerId() + ".");
            }
        }
        return new LoadResult(result, List.copyOf(warnings));
    }

    public void save(Map<UUID, Map<String, SavedPlace>> snapshot) throws IOException {
        if (snapshot == null) throw new IllegalArgumentException("snapshot is required");
        Properties properties = new Properties();
        properties.setProperty(FORMAT_VERSION_KEY, FORMAT_VERSION);
        snapshot.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.comparing(UUID::toString)))
                .forEach(playerEntry -> addPlayer(properties, playerEntry.getKey(), playerEntry.getValue()));

        Path parent = file.getParent();
        if (parent == null) throw new IOException("saved-place file has no parent directory");
        Files.createDirectories(parent);
        Path temporary = Files.createTempFile(parent, file.getFileName() + ".", ".tmp");
        boolean moved = false;
        try {
            try (FileChannel channel = FileChannel.open(
                    temporary,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.TRUNCATE_EXISTING
            )) {
                Writer writer = Channels.newWriter(channel, StandardCharsets.UTF_8);
                properties.store(writer, "ServerTeleport saved places - edit only while the server is stopped");
                writer.flush();
                channel.force(true);
            }
            Files.move(
                    temporary,
                    file,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
            );
            moved = true;
        } finally {
            if (!moved) Files.deleteIfExists(temporary);
        }
    }

    private static void addPlayer(
            Properties properties,
            UUID playerId,
            Map<String, SavedPlace> playerPlaces
    ) {
        if (playerId == null || playerPlaces == null) {
            throw new IllegalArgumentException("snapshot contains a null player entry");
        }
        if (playerPlaces.size() > PlaceBook.MAX_PLACES_PER_PLAYER) {
            throw new IllegalArgumentException("snapshot exceeds the per-player place limit");
        }
        playerPlaces.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(String.CASE_INSENSITIVE_ORDER))
                .forEach(placeEntry -> {
                    String normalized = PlaceNames.normalize(placeEntry.getKey());
                    if (!normalized.equals(placeEntry.getKey())) {
                        throw new IllegalArgumentException("snapshot place names must be canonical");
                    }
                    SavedPlace place = placeEntry.getValue();
                    if (place == null) throw new IllegalArgumentException("snapshot contains a null place");
                    String prefix = "places." + playerId + "." + normalized + ".";
                    properties.setProperty(prefix + "world-uuid", place.worldId().toString());
                    properties.setProperty(prefix + "world-name", place.worldName());
                    properties.setProperty(prefix + "x", Double.toString(place.x()));
                    properties.setProperty(prefix + "y", Double.toString(place.y()));
                    properties.setProperty(prefix + "z", Double.toString(place.z()));
                    properties.setProperty(prefix + "yaw", Float.toString(place.yaw()));
                    properties.setProperty(prefix + "pitch", Float.toString(place.pitch()));
                });
    }

    private static void addWarning(List<String> warnings, String warning) {
        if (warnings.size() < MAX_WARNINGS) warnings.add(warning);
    }

    private record EntryKey(UUID playerId, String name) {
    }

    public record LoadResult(PlaceBook places, List<String> warnings) {
        public LoadResult {
            if (places == null) throw new IllegalArgumentException("places are required");
            warnings = warnings == null ? List.of() : List.copyOf(warnings);
        }
    }
}
