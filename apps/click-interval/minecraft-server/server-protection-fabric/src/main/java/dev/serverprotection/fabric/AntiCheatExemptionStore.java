package dev.serverprotection.fabric;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Bounded, atomic persistence for explicit per-player anti-cheat exemptions.
 *
 * <p>The UUID is authoritative. A last-known name is stored only for readable command output and
 * exact-name lookup when re-enabling an offline exemption.</p>
 */
final class AntiCheatExemptionStore {
    static final int MAX_ENTRIES = 4_096;
    static final long MAX_FILE_BYTES = 512L * 1_024L;
    private static final String HEADER = "server-protection-anticheat-exemptions-v1";
    private static final Pattern PLAYER_NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");

    private final Path file;
    private final LinkedHashMap<UUID, Entry> entries = new LinkedHashMap<>();

    AntiCheatExemptionStore(Path file) {
        this.file = file;
    }

    synchronized void load() throws IOException {
        if (!Files.exists(file)) {
            entries.clear();
            return;
        }
        if (!Files.isRegularFile(file) || Files.size(file) > MAX_FILE_BYTES) {
            throw new IOException("anti-cheat exemption state is missing, invalid, or too large");
        }
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        if (lines.isEmpty() || !HEADER.equals(lines.getFirst())) {
            throw new IOException("anti-cheat exemption state has an unsupported header");
        }
        if (lines.size() > MAX_ENTRIES + 1) {
            throw new IOException("anti-cheat exemption state has too many entries");
        }

        LinkedHashMap<UUID, Entry> loaded = new LinkedHashMap<>();
        for (int index = 1; index < lines.size(); index++) {
            String line = lines.get(index);
            if (line.isBlank()) continue;
            String[] fields = line.split("\\t", -1);
            if (fields.length != 2) {
                throw new IOException("invalid anti-cheat exemption entry at line " + (index + 1));
            }
            UUID playerId;
            String name;
            try {
                playerId = UUID.fromString(fields[0]);
                name = new String(Base64.getUrlDecoder().decode(fields[1]), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException invalid) {
                throw new IOException("invalid anti-cheat exemption entry at line " + (index + 1), invalid);
            }
            if (!name.isEmpty() && !PLAYER_NAME.matcher(name).matches()) {
                throw new IOException("invalid player name at line " + (index + 1));
            }
            if (loaded.putIfAbsent(playerId, new Entry(playerId, name)) != null) {
                throw new IOException("duplicate anti-cheat exemption UUID at line " + (index + 1));
            }
        }
        entries.clear();
        entries.putAll(loaded);
    }

    synchronized boolean contains(UUID playerId) {
        return playerId != null && entries.containsKey(playerId);
    }

    synchronized Entry get(UUID playerId) {
        return playerId == null ? null : entries.get(playerId);
    }

    synchronized Entry findByExactName(String name) {
        if (name == null || !PLAYER_NAME.matcher(name).matches()) return null;
        for (Entry entry : entries.values()) {
            if (entry.name().equalsIgnoreCase(name)) return entry;
        }
        return null;
    }

    synchronized List<Entry> snapshot() {
        return List.copyOf(entries.values());
    }

    synchronized boolean disable(UUID playerId, String lastKnownName) throws IOException {
        if (playerId == null) throw new IllegalArgumentException("playerId");
        String safeName = safeName(lastKnownName);
        Entry previous = entries.get(playerId);
        Entry replacement = new Entry(playerId,
                safeName.isEmpty() && previous != null ? previous.name() : safeName);
        if (replacement.equals(previous)) return false;
        if (previous == null && entries.size() >= MAX_ENTRIES) {
            throw new IOException("anti-cheat exemption limit reached");
        }
        LinkedHashMap<UUID, Entry> updated = new LinkedHashMap<>(entries);
        updated.put(playerId, replacement);
        persist(updated);
        entries.clear();
        entries.putAll(updated);
        return true;
    }

    synchronized boolean enable(UUID playerId) throws IOException {
        if (playerId == null || !entries.containsKey(playerId)) return false;
        LinkedHashMap<UUID, Entry> updated = new LinkedHashMap<>(entries);
        updated.remove(playerId);
        persist(updated);
        entries.clear();
        entries.putAll(updated);
        return true;
    }

    private void persist(Map<UUID, Entry> state) throws IOException {
        StringBuilder output = new StringBuilder(HEADER).append('\n');
        for (Entry entry : state.values()) {
            output.append(entry.playerId()).append('\t')
                    .append(Base64.getUrlEncoder().withoutPadding().encodeToString(
                            entry.name().getBytes(StandardCharsets.UTF_8)))
                    .append('\n');
            if (output.length() > MAX_FILE_BYTES) {
                throw new IOException("anti-cheat exemption state exceeds its size limit");
            }
        }
        Path parent = file.toAbsolutePath().getParent();
        if (parent == null) throw new IOException("anti-cheat exemption path has no parent");
        Files.createDirectories(parent);
        Path temporary = parent.resolve(file.getFileName() + ".tmp");
        try {
            Files.writeString(temporary, output, StandardCharsets.UTF_8);
            try {
                Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static String safeName(String name) {
        if (name == null || name.isBlank()) return "";
        String trimmed = name.trim();
        return PLAYER_NAME.matcher(trimmed).matches() ? trimmed : "";
    }

    record Entry(UUID playerId, String name) {
        Entry {
            if (playerId == null) throw new IllegalArgumentException("playerId");
            name = name == null ? "" : name;
        }

        String displayName() {
            return name.isEmpty() ? playerId.toString().toLowerCase(Locale.ROOT) : name;
        }
    }
}
