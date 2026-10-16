package dev.serverteleport.fabric.core;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Successful PvP escapes only; bounded atomic world-local storage, never a ban. */
public final class ReturnLockStore {
    public static final long DURATION_MILLIS = 300_000L;
    public static final double RADIUS = 160.0;
    private static final String HEADER = "server-teleport-return-locks-v1";
    private static final int MAX_RECORDS = 4_096;
    private static final int MAX_BYTES = 1024 * 1024;
    private final Path file;
    private List<Lock> locks;

    private ReturnLockStore(Path file, List<Lock> locks) { this.file = file; this.locks = List.copyOf(locks); }

    public static ReturnLockStore open(Path file) throws IOException {
        Path normalized = file.toAbsolutePath().normalize();
        if (Files.notExists(normalized, LinkOption.NOFOLLOW_LINKS)) return new ReturnLockStore(normalized, List.of());
        if (!Files.isRegularFile(normalized, LinkOption.NOFOLLOW_LINKS) || Files.size(normalized) > MAX_BYTES) {
            throw new IOException("return-lock storage is not a bounded regular file");
        }
        byte[] bytes;
        try (var input = Files.newInputStream(normalized)) { bytes = input.readNBytes(MAX_BYTES + 1); }
        if (bytes.length > MAX_BYTES) throw new IOException("return-lock storage too large");
        String[] lines = new String(bytes, StandardCharsets.UTF_8).replace("\r\n", "\n").split("\n");
        if (lines.length == 0 || !HEADER.equals(lines[0])) throw new IOException("invalid return-lock header");
        List<Lock> locks = new ArrayList<>();
        try {
            for (int i = 1; i < lines.length; i++) {
                String[] fields = lines[i].split("\t", -1);
                if (fields.length != 6 || locks.size() >= MAX_RECORDS) throw new IllegalArgumentException();
                locks.add(new Lock(UUID.fromString(fields[0]), fields[1], Double.parseDouble(fields[2]),
                        Double.parseDouble(fields[3]), Long.parseLong(fields[4]), Long.parseLong(fields[5])));
            }
        } catch (IllegalArgumentException error) { throw new IOException("invalid return-lock record", error); }
        return new ReturnLockStore(normalized, locks);
    }

    public long remainingMillis(UUID player, String dimension, double x, double z, long now) {
        return locks.stream().filter(lock -> lock.player().equals(player) && lock.dimension().equals(dimension)
                        && lock.until() > now && Math.hypot(x - lock.x(), z - lock.z()) <= RADIUS)
                .mapToLong(lock -> lock.until() - now).max().orElse(0);
    }

    public static boolean isEscape(boolean activePvp, SavedLocation origin, SavedLocation arrival) {
        return activePvp && (!origin.dimension().equals(arrival.dimension())
                || Double.compare(origin.x(), arrival.x()) != 0
                || Double.compare(origin.y(), arrival.y()) != 0
                || Double.compare(origin.z(), arrival.z()) != 0);
    }

    /** Only after every member transferred; a failed write leaves the prior snapshot intact. */
    public void arm(UUID player, SavedLocation origin, long now) throws IOException {
        List<Lock> candidate = new ArrayList<>(locks.stream().filter(lock -> lock.until() > now).toList());
        if (candidate.size() >= MAX_RECORDS) throw new IOException("return-lock storage is full");
        candidate.add(new Lock(player, origin.dimension(), origin.x(), origin.z(), now, Math.addExact(now, DURATION_MILLIS)));
        persist(candidate);
    }

    public void clearAfterDeath(UUID player) throws IOException {
        List<Lock> candidate = locks.stream().filter(lock -> !lock.player().equals(player)).toList();
        if (candidate.size() == locks.size()) return;
        persist(candidate);
    }

    private void persist(List<Lock> candidate) throws IOException {
        StringBuilder data = new StringBuilder(HEADER).append('\n');
        for (Lock lock : candidate) data.append(lock.player()).append('\t').append(lock.dimension()).append('\t')
                .append(lock.x()).append('\t').append(lock.z()).append('\t').append(lock.started()).append('\t')
                .append(lock.until()).append('\n');
        byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("return-lock storage too large");
        Files.createDirectories(file.getParent());
        Path temporary = Files.createTempFile(file.getParent(), "return-locks-", ".tmp");
        try {
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            locks = List.copyOf(candidate);
        } finally { Files.deleteIfExists(temporary); }
    }

    private record Lock(UUID player, String dimension, double x, double z, long started, long until) {
        private Lock {
            if (player == null || dimension == null || !dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")
                    || !Double.isFinite(x) || !Double.isFinite(z) || Math.abs(x) > 30_000_000
                    || Math.abs(z) > 30_000_000 || started < 0 || until <= started
                    || until - started != DURATION_MILLIS) throw new IllegalArgumentException("invalid return lock");
        }
    }
}
