package dev.serverteleport.fabric.core;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * World-scoped, bounded storage for player-owned named destinations.
 *
 * <p>Every mutation is written to a same-directory temporary file, flushed, and atomically
 * renamed before the in-memory snapshot is changed. A failed write therefore leaves both the
 * previous file and the active snapshot intact.</p>
 */
public final class SavedLocationStore {
    public static final int MAX_LOCATIONS_PER_PLAYER = 30;
    public static final int MAX_NAME_LENGTH = 24;
    public static final long MAX_FILE_BYTES = 8L * 1024L * 1024L;

    private static final String HEADER = "server-teleport-locations-v1";
    private static final Pattern NAME = Pattern.compile("[a-z0-9_ -]{1,24}");
    private static final Set<String> RESERVED_NAMES = Set.of(
            "accept", "decline", "set", "list", "delete");

    private final Path file;
    private Map<UUID, Map<String, SavedLocation>> locations;

    private SavedLocationStore(Path file, Map<UUID, Map<String, SavedLocation>> locations) {
        this.file = file;
        this.locations = immutableSnapshot(locations);
    }

    public static SavedLocationStore open(Path file) throws IOException {
        if (file == null) throw new IOException("location storage path is required");
        Path normalized = file.toAbsolutePath().normalize();
        if (Files.notExists(normalized, LinkOption.NOFOLLOW_LINKS)) {
            return new SavedLocationStore(normalized, Map.of());
        }
        if (!Files.isRegularFile(normalized, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("location storage path is not a regular file");
        }
        long size = Files.size(normalized);
        if (size > MAX_FILE_BYTES) throw new IOException("location storage exceeds 8 MiB");

        byte[] bytes;
        try (var input = Files.newInputStream(normalized, StandardOpenOption.READ)) {
            bytes = input.readNBytes((int) MAX_FILE_BYTES + 1);
        }
        if (bytes.length > MAX_FILE_BYTES) throw new IOException("location storage exceeds 8 MiB");
        return new SavedLocationStore(normalized, parse(new String(bytes, StandardCharsets.UTF_8)));
    }

    public static String normalizeName(String input) {
        if (input == null) return "";
        // Tabs and line breaks delimit the durable TSV format and must never be normalized into a
        // seemingly valid name. Ordinary ASCII spaces are safe and collapse into one stable key.
        if (input.indexOf('\t') >= 0 || input.indexOf('\r') >= 0 || input.indexOf('\n') >= 0) {
            return "";
        }
        String normalized = input.strip().toLowerCase(Locale.ROOT).replaceAll(" +", " ");
        return NAME.matcher(normalized).matches() && !RESERVED_NAMES.contains(normalized)
                ? normalized
                : "";
    }

    public static boolean isValidName(String input) {
        return !normalizeName(input).isEmpty();
    }

    public synchronized Optional<SavedLocation> find(UUID playerId, String name) {
        if (playerId == null) return Optional.empty();
        String normalized = normalizeName(name);
        if (normalized.isEmpty()) return Optional.empty();
        return Optional.ofNullable(locations.getOrDefault(playerId, Map.of()).get(normalized));
    }

    public synchronized List<String> names(UUID playerId) {
        if (playerId == null) return List.of();
        return locations.getOrDefault(playerId, Map.of()).keySet().stream()
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .toList();
    }

    public synchronized PutResult put(UUID playerId, String name, SavedLocation location) throws IOException {
        Objects.requireNonNull(playerId, "playerId");
        Objects.requireNonNull(location, "location");
        String normalized = normalizeName(name);
        if (normalized.isEmpty()) throw new IllegalArgumentException("invalid location name");

        Map<String, SavedLocation> current = locations.getOrDefault(playerId, Map.of());
        boolean replacing = current.containsKey(normalized);
        if (!replacing && current.size() >= MAX_LOCATIONS_PER_PLAYER) return PutResult.LIMIT_REACHED;

        LinkedHashMap<UUID, Map<String, SavedLocation>> candidate = mutableSnapshot(locations);
        LinkedHashMap<String, SavedLocation> playerLocations =
                new LinkedHashMap<>(candidate.getOrDefault(playerId, Map.of()));
        playerLocations.put(normalized, location);
        candidate.put(playerId, playerLocations);
        persist(candidate);
        locations = immutableSnapshot(candidate);
        return replacing ? PutResult.UPDATED : PutResult.ADDED;
    }

    public synchronized boolean delete(UUID playerId, String name) throws IOException {
        if (playerId == null) return false;
        String normalized = normalizeName(name);
        if (normalized.isEmpty()) return false;
        Map<String, SavedLocation> current = locations.get(playerId);
        if (current == null || !current.containsKey(normalized)) return false;

        LinkedHashMap<UUID, Map<String, SavedLocation>> candidate = mutableSnapshot(locations);
        LinkedHashMap<String, SavedLocation> playerLocations = new LinkedHashMap<>(candidate.get(playerId));
        playerLocations.remove(normalized);
        if (playerLocations.isEmpty()) candidate.remove(playerId);
        else candidate.put(playerId, playerLocations);
        persist(candidate);
        locations = immutableSnapshot(candidate);
        return true;
    }

    public Path file() {
        return file;
    }

    private void persist(Map<UUID, Map<String, SavedLocation>> candidate) throws IOException {
        byte[] data = serialize(candidate).getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_FILE_BYTES) throw new IOException("location storage exceeds 8 MiB");

        Path parent = file.getParent();
        if (parent == null) throw new IOException("location storage directory is unavailable");
        Files.createDirectories(parent);
        if (!Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("location storage directory is not a directory");
        }

        Path temporary = Files.createTempFile(parent, file.getFileName() + ".", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary,
                    StandardOpenOption.WRITE,
                    StandardOpenOption.TRUNCATE_EXISTING)) {
                ByteBuffer buffer = ByteBuffer.wrap(data);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            try {
                Files.move(temporary, file,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                throw new IOException("location storage does not support atomic replacement", unsupported);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static String serialize(Map<UUID, Map<String, SavedLocation>> values) {
        StringBuilder output = new StringBuilder(HEADER).append('\n');
        values.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.comparing(UUID::toString)))
                .forEach(player -> player.getValue().entrySet().stream()
                        .sorted(Map.Entry.comparingByKey())
                        .forEach(entry -> {
                            SavedLocation location = entry.getValue();
                            output.append(player.getKey()).append('\t')
                                    .append(entry.getKey()).append('\t')
                                    .append(location.dimension()).append('\t')
                                    .append(Double.toString(location.x())).append('\t')
                                    .append(Double.toString(location.y())).append('\t')
                                    .append(Double.toString(location.z())).append('\t')
                                    .append(Float.toString(location.yaw())).append('\t')
                                    .append(Float.toString(location.pitch())).append('\n');
                        }));
        return output.toString();
    }

    private static Map<UUID, Map<String, SavedLocation>> parse(String serialized) throws IOException {
        String normalized = serialized == null ? "" : serialized.replace("\r\n", "\n");
        String[] lines = normalized.split("\n", -1);
        if (lines.length == 0 || !HEADER.equals(lines[0])) {
            throw new IOException("unsupported or corrupt location storage header");
        }

        LinkedHashMap<UUID, Map<String, SavedLocation>> parsed = new LinkedHashMap<>();
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index];
            if (line.isEmpty() && index == lines.length - 1) continue;
            if (line.isBlank()) throw malformed(index + 1, null);
            String[] fields = line.split("\t", -1);
            if (fields.length != 8) throw malformed(index + 1, null);
            try {
                UUID playerId = UUID.fromString(fields[0]);
                String name = normalizeName(fields[1]);
                if (name.isEmpty() || !name.equals(fields[1])) throw new IllegalArgumentException();
                SavedLocation location = new SavedLocation(
                        fields[2],
                        Double.parseDouble(fields[3]),
                        Double.parseDouble(fields[4]),
                        Double.parseDouble(fields[5]),
                        Float.parseFloat(fields[6]),
                        Float.parseFloat(fields[7]));

                LinkedHashMap<String, SavedLocation> playerLocations =
                        new LinkedHashMap<>(parsed.getOrDefault(playerId, Map.of()));
                if (playerLocations.putIfAbsent(name, location) != null) throw new IllegalArgumentException();
                if (playerLocations.size() > MAX_LOCATIONS_PER_PLAYER) {
                    throw new IllegalArgumentException();
                }
                parsed.put(playerId, playerLocations);
            } catch (IllegalArgumentException error) {
                throw malformed(index + 1, error);
            }
        }
        return parsed;
    }

    private static IOException malformed(int line, Throwable cause) {
        return new IOException("invalid location storage record on line " + line, cause);
    }

    private static LinkedHashMap<UUID, Map<String, SavedLocation>> mutableSnapshot(
            Map<UUID, Map<String, SavedLocation>> source) {
        LinkedHashMap<UUID, Map<String, SavedLocation>> copy = new LinkedHashMap<>();
        source.forEach((playerId, values) -> copy.put(playerId, new LinkedHashMap<>(values)));
        return copy;
    }

    private static Map<UUID, Map<String, SavedLocation>> immutableSnapshot(
            Map<UUID, Map<String, SavedLocation>> source) {
        LinkedHashMap<UUID, Map<String, SavedLocation>> copy = new LinkedHashMap<>();
        source.forEach((playerId, values) -> copy.put(playerId, Map.copyOf(values)));
        return Map.copyOf(copy);
    }

    public enum PutResult {
        ADDED,
        UPDATED,
        LIMIT_REACHED
    }
}
