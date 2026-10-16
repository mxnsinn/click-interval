package com.clickinterval.endlock;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Optional;
import java.util.UUID;

/** One bounded record per player, captured before travel and committed only after successful Nether arrival. */
public final class NetherOriginStore {
    public record Origin(String dimension, double x, double y, double z, float yaw, float pitch) {
        public Origin {
            if (dimension == null || dimension.length() > 128 || !dimension.matches("[a-z0-9_.-]+:[a-z0-9/._-]+")
                    || dimension.equals("minecraft:the_nether") || !Double.isFinite(x) || !Double.isFinite(y)
                    || !Double.isFinite(z) || !Float.isFinite(yaw) || !Float.isFinite(pitch)
                    || Math.abs(x) > 30_000_000 || Math.abs(z) > 30_000_000 || y < -2048 || y > 2048) {
                throw new IllegalArgumentException("Invalid prior Nether entry location");
            }
        }
    }

    private final Path directory;
    public NetherOriginStore(Path directory) { this.directory = directory.toAbsolutePath().normalize(); }

    public Optional<Origin> read(UUID player) throws IOException {
        Path file = path(player);
        rejectLinks(file);
        if (!Files.exists(file)) return Optional.empty();
        if (!Files.isRegularFile(file) || Files.size(file) > 512) throw new IOException("Invalid Nether origin record");
        String[] parts = Files.readString(file, StandardCharsets.UTF_8).strip().split("\\n", -1);
        if (parts.length != 8 || !parts[0].equals("version=1") || !parts[7].equals("end")) throw new IOException("Invalid Nether origin format");
        try {
            return Optional.of(new Origin(parts[1], Double.parseDouble(parts[2]), Double.parseDouble(parts[3]),
                    Double.parseDouble(parts[4]), Float.parseFloat(parts[5]), Float.parseFloat(parts[6])));
        } catch (RuntimeException invalid) { throw new IOException("Invalid Nether origin value", invalid); }
    }

    public void write(UUID player, Origin origin) throws IOException {
        if (origin == null) throw new IllegalArgumentException("Missing Nether origin");
        Path file = path(player);
        rejectLinks(file);
        Files.createDirectories(directory);
        rejectLinks(file);
        Path temporary = Files.createTempFile(directory, ".origin-", ".tmp");
        try {
            byte[] bytes = ("version=1\n" + origin.dimension + "\n" + origin.x + "\n" + origin.y + "\n" + origin.z
                    + "\n" + origin.yaw + "\n" + origin.pitch + "\nend\n").getBytes(StandardCharsets.UTF_8);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer data = ByteBuffer.wrap(bytes);
                while (data.hasRemaining()) channel.write(data);
                channel.force(true);
            }
            rejectLinks(file);
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }

    /** A failed new write must never leave a previous trip's origin eligible for later evacuation. */
    public void invalidate(UUID player) throws IOException {
        Path file = path(player);
        rejectLinks(file);
        if (Files.exists(file) && !Files.isRegularFile(file)) throw new IOException("Cannot invalidate non-file origin");
        Files.deleteIfExists(file);
    }

    private Path path(UUID player) {
        if (player == null) throw new IllegalArgumentException("Missing player UUID");
        return directory.resolve(player + ".txt");
    }

    private static void rejectLinks(Path file) throws IOException {
        for (Path part = file; part != null; part = part.getParent()) {
            if (Files.isSymbolicLink(part)) throw new IOException("Linked Nether origin path");
        }
    }
}
