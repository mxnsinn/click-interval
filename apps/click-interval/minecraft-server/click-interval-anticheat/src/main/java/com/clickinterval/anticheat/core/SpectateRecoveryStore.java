package com.clickinterval.anticheat.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Small crash-recovery journal for server-side player camera sessions. */
public final class SpectateRecoveryStore {
    public static final int MAX_RECORDS = 64;
    public static final long MAX_BYTES = 128L * 1024L;
    private static final String HEADER = "server-player-view-recovery-v1";
    private static final Pattern PLAYER_NAME = Pattern.compile("[A-Za-z0-9_]{1,16}");
    private static final Pattern WORLD_ID = Pattern.compile("[A-Za-z0-9_.:/-]{1,192}");
    private static final Set<String> GAME_MODES = Set.of("survival", "creative", "adventure", "spectator");

    private final Path file;

    public SpectateRecoveryStore(Path file) {
        if (file == null) throw new IllegalArgumentException("Recovery file is required.");
        this.file = file;
    }

    public synchronized Map<UUID, Origin> load() throws IOException {
        if (!Files.exists(file)) return Map.of();
        if (!Files.isRegularFile(file) || Files.size(file) > MAX_BYTES) {
            throw new IOException("Player-view recovery file is not a bounded regular file.");
        }
        return parse(Files.readString(file, StandardCharsets.UTF_8));
    }

    public synchronized void save(Collection<Origin> values) throws IOException {
        List<Origin> records = normalize(values);
        if (records.isEmpty()) {
            Files.deleteIfExists(file);
            return;
        }
        String serialized = serialize(records);
        if (serialized.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IOException("Player-view recovery state exceeds its storage limit.");
        }
        Path parent = file.toAbsolutePath().getParent();
        if (parent == null) throw new IOException("Player-view recovery path has no parent directory.");
        Files.createDirectories(parent);
        Path temporary = parent.resolve(file.getFileName() + ".tmp");
        Files.writeString(temporary, serialized, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    static Map<UUID, Origin> parse(String source) throws IOException {
        byte[] bytes = String.valueOf(source == null ? "" : source).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("Player-view recovery state is too large.");
        String[] lines = new String(bytes, StandardCharsets.UTF_8).split("\\R", -1);
        if (lines.length == 0 || !HEADER.equals(lines[0])) {
            throw new IOException("Player-view recovery state has an unsupported format.");
        }
        LinkedHashMap<UUID, Origin> result = new LinkedHashMap<>();
        for (int index = 1; index < lines.length; index++) {
            String line = lines[index];
            if (line.isBlank()) continue;
            if (result.size() >= MAX_RECORDS) throw new IOException("Player-view recovery state has too many records.");
            if (line.length() > 2_048) throw new IOException("Player-view recovery state contains an oversized record.");
            String[] fields = line.split("\\t", -1);
            if (fields.length != 11) throw new IOException("Player-view recovery state contains a malformed record.");
            try {
                UUID viewerId = UUID.fromString(fields[0]);
                Origin origin = new Origin(
                        viewerId,
                        decode(fields[1]),
                        UUID.fromString(fields[2]),
                        decode(fields[3]),
                        decode(fields[4]),
                        Double.parseDouble(fields[5]),
                        Double.parseDouble(fields[6]),
                        Double.parseDouble(fields[7]),
                        Float.parseFloat(fields[8]),
                        Float.parseFloat(fields[9]),
                        decode(fields[10]));
                if (result.putIfAbsent(viewerId, origin) != null) {
                    throw new IOException("Player-view recovery state contains a duplicate viewer.");
                }
            } catch (IllegalArgumentException invalid) {
                if (invalid instanceof IOExceptionCarrier carrier) throw carrier.io;
                throw new IOException("Player-view recovery state contains an invalid record.", invalid);
            }
        }
        return Map.copyOf(result);
    }

    static String serialize(Collection<Origin> values) throws IOException {
        List<Origin> records = normalize(values);
        StringBuilder output = new StringBuilder(HEADER).append('\n');
        for (Origin value : records) {
            output.append(value.viewerId()).append('\t')
                    .append(encode(value.viewerName())).append('\t')
                    .append(value.targetId()).append('\t')
                    .append(encode(value.targetName())).append('\t')
                    .append(encode(value.worldId())).append('\t')
                    .append(Double.toString(value.x())).append('\t')
                    .append(Double.toString(value.y())).append('\t')
                    .append(Double.toString(value.z())).append('\t')
                    .append(Float.toString(value.yaw())).append('\t')
                    .append(Float.toString(value.pitch())).append('\t')
                    .append(encode(value.gameMode())).append('\n');
        }
        return output.toString();
    }

    private static List<Origin> normalize(Collection<Origin> values) throws IOException {
        ArrayList<Origin> records = new ArrayList<>();
        LinkedHashMap<UUID, Boolean> seen = new LinkedHashMap<>();
        for (Origin value : values == null ? List.<Origin>of() : values) {
            if (value == null) continue;
            if (seen.putIfAbsent(value.viewerId(), Boolean.TRUE) != null) {
                throw new IOException("Player-view recovery state contains a duplicate viewer.");
            }
            records.add(value);
            if (records.size() > MAX_RECORDS) throw new IOException("Player-view recovery state has too many records.");
        }
        records.sort(Comparator.comparing(value -> value.viewerId().toString()));
        return records;
    }

    private static String encode(String value) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String value) {
        try {
            return new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException invalid) {
            throw new IOExceptionCarrier(new IOException("Player-view recovery state contains invalid text encoding."));
        }
    }

    public record Origin(UUID viewerId, String viewerName, UUID targetId, String targetName,
                         String worldId, double x, double y, double z, float yaw, float pitch,
                         String gameMode) {
        public Origin {
            if (viewerId == null || targetId == null) throw new IllegalArgumentException("Player IDs are required.");
            viewerName = cleanPlayerName(viewerName);
            targetName = cleanPlayerName(targetName);
            worldId = String.valueOf(worldId == null ? "" : worldId).trim();
            if (!WORLD_ID.matcher(worldId).matches()) throw new IllegalArgumentException("Invalid world ID.");
            if (!finiteCoordinate(x) || !finiteCoordinate(y) || !finiteCoordinate(z)) {
                throw new IllegalArgumentException("Invalid player coordinates.");
            }
            if (!Float.isFinite(yaw) || !Float.isFinite(pitch) || pitch < -90.01f || pitch > 90.01f) {
                throw new IllegalArgumentException("Invalid player rotation.");
            }
            gameMode = String.valueOf(gameMode == null ? "" : gameMode).trim().toLowerCase(Locale.ROOT);
            if (!GAME_MODES.contains(gameMode)) throw new IllegalArgumentException("Invalid game mode.");
        }

        public Origin withTarget(UUID updatedTargetId, String updatedTargetName) {
            return new Origin(viewerId, viewerName, updatedTargetId, updatedTargetName,
                    worldId, x, y, z, yaw, pitch, gameMode);
        }

        private static String cleanPlayerName(String value) {
            String clean = String.valueOf(value == null ? "" : value).trim();
            if (!PLAYER_NAME.matcher(clean).matches()) throw new IllegalArgumentException("Invalid player name.");
            return clean;
        }

        private static boolean finiteCoordinate(double value) {
            return Double.isFinite(value) && Math.abs(value) <= 1_000_000_000.0;
        }
    }

    private static final class IOExceptionCarrier extends IllegalArgumentException {
        private final IOException io;

        private IOExceptionCarrier(IOException io) {
            super(io);
            this.io = io;
        }
    }
}
