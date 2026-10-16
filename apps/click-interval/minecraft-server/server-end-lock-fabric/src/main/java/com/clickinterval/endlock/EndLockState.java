package com.clickinterval.endlock;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;
import java.util.function.LongSupplier;

/** World-local state: a successful durable write always precedes an unlock in memory. */
public final class EndLockState {
    public enum Domain { END, NETHER }

    private record Lock(boolean locked, long unlockAtMillis, long startOnLaunchMillis, long openingDurationMillis) {
        private Lock(boolean locked, long unlockAtMillis) { this(locked, unlockAtMillis, 0, 0); }
        private boolean expired(long now) { return locked && unlockAtMillis > 0 && now >= unlockAtMillis; }
    }

    private record Snapshot(Lock end, Lock nether, boolean eyeCraftingBlocked, boolean frameInsertionBlocked) {
        private Lock lock(Domain domain) { return domain == Domain.END ? end : nether; }
        private Snapshot withLock(Domain domain, Lock lock) {
            return new Snapshot(domain == Domain.END ? lock : end, domain == Domain.NETHER ? lock : nether,
                    eyeCraftingBlocked, frameInsertionBlocked);
        }
        private Snapshot failClosed(boolean preserveTimers) {
            return new Snapshot(closed(end, preserveTimers), closed(nether, preserveTimers), true, true);
        }
        private static Lock closed(Lock old, boolean preserve) {
            return preserve ? new Lock(true, old.unlockAtMillis, old.startOnLaunchMillis, old.openingDurationMillis) : new Lock(true, 0);
        }
    }

    private final Path file;
    private final LongSupplier clock;
    private Snapshot value = new Snapshot(new Lock(true, 0), new Lock(false, 0), true, true);
    private String error = "";

    public EndLockState(Path file) { this(file, System::currentTimeMillis); }

    /** The clock is injectable so startup expiry and convenience methods can be tested deterministically. */
    public EndLockState(Path file, LongSupplier clock) {
        this.file = Objects.requireNonNull(file, "file").toAbsolutePath().normalize();
        this.clock = Objects.requireNonNull(clock, "clock");
        try {
            rejectLinks(this.file);
            if (!Files.exists(this.file, LinkOption.NOFOLLOW_LINKS)) {
                write(value);
            } else {
                if (!Files.isRegularFile(this.file, LinkOption.NOFOLLOW_LINKS) || Files.size(this.file) > 512) {
                    throw new IOException("Invalid dimension lock state file");
                }
                value = parse(Files.readString(this.file, StandardCharsets.UTF_8).replace("\r\n", "\n"));
                refresh(clock.getAsLong());
            }
        } catch (IOException | RuntimeException failure) {
            failClosed(failure, false);
        }
    }

    /** Legacy End-only API. Reads never write or publish an unpersisted timer expiry. */
    public synchronized boolean locked() { return value.end.locked; }
    public synchronized String error() { return error; }
    public synchronized boolean locked(Domain domain, long now) {
        return value.lock(Objects.requireNonNull(domain, "domain")).locked;
    }
    public synchronized boolean locked(Domain domain) { return locked(domain, clock.getAsLong()); }
    public synchronized long unlockAtMillis(Domain domain) {
        return value.lock(Objects.requireNonNull(domain, "domain")).unlockAtMillis;
    }
    public synchronized long startOnLaunchMillis(Domain domain) { return value.lock(domain).startOnLaunchMillis; }
    public synchronized long openingDurationMillis(Domain domain) { return value.lock(domain).openingDurationMillis; }

    /** Offline deployment arms both locks. Merely reading state never starts this clock. */
    public synchronized void armForNextLaunch(long netherMillis, long endMillis) throws IOException {
        DurationSpec.validateMillis(netherMillis);
        DurationSpec.validateMillis(endMillis);
        persist(new Snapshot(new Lock(true, 0, endMillis, endMillis),
                new Lock(true, 0, netherMillis, netherMillis), value.eyeCraftingBlocked, value.frameInsertionBlocked));
    }

    /** Called once when the server is ready. Both deadlines are durably committed in one atomic write. */
    public synchronized boolean startPendingTimers(long now) {
        if (now < 0) throw new IllegalArgumentException("Current epoch time must not be negative");
        Snapshot desired = value;
        try {
            for (Domain domain : Domain.values()) {
                Lock old = desired.lock(domain);
                if (old.startOnLaunchMillis > 0) desired = desired.withLock(domain,
                        new Lock(true, Math.addExact(now, old.startOnLaunchMillis), 0, old.openingDurationMillis));
            }
            if (desired.equals(value)) return false;
            write(desired);
            value = desired;
            error = "";
            return true;
        } catch (IOException | RuntimeException failure) {
            failClosed(failure, true);
            return false;
        }
    }
    public synchronized boolean eyeCraftingBlocked() { return value.eyeCraftingBlocked; }
    public synchronized boolean frameInsertionBlocked() { return value.frameInsertionBlocked; }

    /** Milliseconds remaining, zero if unlocked/expired, or -1 for a permanent lock. */
    public synchronized long remaining(Domain domain, long now) {
        Lock lock = value.lock(Objects.requireNonNull(domain, "domain"));
        if (!lock.locked) return 0;
        if (lock.unlockAtMillis == 0) return -1;
        if (now >= lock.unlockAtMillis) return 0;
        // A backward clock jump can extend a deadline, but must never overflow into an early unlock.
        try { return Math.subtractExact(lock.unlockAtMillis, now); }
        catch (ArithmeticException overflow) { return Long.MAX_VALUE; }
    }
    public synchronized long remaining(Domain domain) { return remaining(domain, clock.getAsLong()); }

    public synchronized void setLocked(boolean desired) throws IOException { setLocked(Domain.END, desired); }

    /** An explicit lock/unlock cancels that domain's timer, without changing the other domain. */
    public synchronized void setLocked(Domain domain, boolean desired) throws IOException {
        persist(value.withLock(Objects.requireNonNull(domain, "domain"), new Lock(desired, 0)));
    }

    public synchronized void lockFor(Domain domain, long durationMillis, long now) throws IOException {
        Objects.requireNonNull(domain, "domain");
        DurationSpec.validateMillis(durationMillis);
        if (now < 0) throw new IllegalArgumentException("Current epoch time must not be negative");
        final long deadline;
        try { deadline = Math.addExact(now, durationMillis); }
        catch (ArithmeticException overflow) { throw new IllegalArgumentException("Unlock deadline overflows epoch time", overflow); }
        persist(value.withLock(domain, new Lock(true, deadline)));
    }

    public synchronized void lockFor(Domain domain, long durationMillis) throws IOException {
        lockFor(domain, durationMillis, clock.getAsLong());
    }

    public synchronized void setEyeCraftingBlocked(boolean blocked) throws IOException {
        persist(new Snapshot(value.end, value.nether, blocked, value.frameInsertionBlocked));
    }

    public synchronized void setFrameInsertionBlocked(boolean blocked) throws IOException {
        persist(new Snapshot(value.end, value.nether, value.eyeCraftingBlocked, blocked));
    }

    /**
     * Persist due expiries together before opening either domain. Call from a bounded server tick
     * (for example once per second), not from hot-path access checks. A failed expiry retains its
     * deadline for the next bounded retry, records an error, and closes both domains in memory.
     */
    public synchronized boolean refresh(long now) {
        Snapshot desired = value;
        for (Domain domain : Domain.values()) {
            if (desired.lock(domain).expired(now)) desired = desired.withLock(domain, new Lock(false, 0));
        }
        if (desired.equals(value)) return false;
        try {
            write(desired);
            value = desired;
            error = "";
            return true;
        } catch (IOException | RuntimeException failure) {
            failClosed(failure, true);
            return false;
        }
    }
    public synchronized boolean refresh() { return refresh(clock.getAsLong()); }

    private void persist(Snapshot desired) throws IOException {
        try {
            write(desired);
            value = desired;
            error = "";
        } catch (IOException failure) {
            failClosed(failure, false);
            throw failure;
        } catch (RuntimeException failure) {
            failClosed(failure, false);
            throw new IOException("Cannot persist dimension lock state", failure);
        }
    }

    private void failClosed(Exception failure, boolean preserveTimers) {
        value = value.failClosed(preserveTimers);
        error = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
    }

    private static Snapshot parse(String text) throws IOException {
        // Existing v1 files are accepted byte-for-byte (including normalized Windows newlines).
        // Do not migrate on read: corrupt/legacy evidence stays untouched until an explicit save.
        if (text.equals("version=1\nlocked=true\n") || text.equals("version=1\nlocked=false\n")) {
            return new Snapshot(new Lock(text.contains("locked=true"), 0), new Lock(false, 0), true, true);
        }
        String[] lines = text.split("\n", -1);
        boolean v3 = lines.length == 12 && lines[0].equals("version=3") && lines[11].isEmpty();
        if (!v3 && (lines.length != 8 || !lines[0].equals("version=2") || !lines[7].isEmpty())) {
            throw new IOException("Invalid dimension lock state contents");
        }
        Lock end = parseLock(lines[1], "end.locked=", lines[2], "end.unlockAtMillis=");
        Lock nether = parseLock(lines[3], "nether.locked=", lines[4], "nether.unlockAtMillis=");
        if (v3) {
            end = parseLaunch(end, lines[7], "end.startOnLaunchMillis=", lines[8], "end.openingDurationMillis=");
            nether = parseLaunch(nether, lines[9], "nether.startOnLaunchMillis=", lines[10], "nether.openingDurationMillis=");
        }
        return new Snapshot(end, nether, parseBoolean(lines[5], "eyeCraftingBlocked="),
                parseBoolean(lines[6], "frameInsertionBlocked="));
    }

    private static Lock parseLaunch(Lock old, String pendingLine, String pendingKey, String durationLine, String durationKey) throws IOException {
        long pending = parseMillis(pendingLine, pendingKey), duration = parseMillis(durationLine, durationKey);
        if (pending > 0 && (!old.locked || old.unlockAtMillis != 0 || pending != duration)) throw new IOException("Invalid pending launch lock");
        if (!old.locked && duration != 0) throw new IOException("Unlocked dimension cannot have an opening duration");
        return new Lock(old.locked, old.unlockAtMillis, pending, duration);
    }

    private static long parseMillis(String line, String key) throws IOException {
        if (!line.startsWith(key) || !line.substring(key.length()).matches("0|[1-9][0-9]*")) throw new IOException("Invalid duration: " + key);
        try {
            long duration = Long.parseLong(line.substring(key.length()));
            if (duration != 0) DurationSpec.validateMillis(duration);
            return duration;
        } catch (IllegalArgumentException invalid) { throw new IOException("Invalid duration: " + key, invalid); }
    }

    private static Lock parseLock(String lockedLine, String lockedKey, String deadlineLine, String deadlineKey) throws IOException {
        boolean locked = parseBoolean(lockedLine, lockedKey);
        if (!deadlineLine.startsWith(deadlineKey)) throw new IOException("Missing lock deadline: " + deadlineKey);
        String number = deadlineLine.substring(deadlineKey.length());
        if (!number.matches("0|[1-9][0-9]*")) throw new IOException("Invalid lock deadline: " + deadlineKey);
        final long deadline;
        try { deadline = Long.parseLong(number); }
        catch (NumberFormatException overflow) { throw new IOException("Invalid lock deadline: " + deadlineKey, overflow); }
        if (!locked && deadline != 0) throw new IOException("Unlocked dimension cannot have an unlock deadline");
        return new Lock(locked, deadline);
    }

    private static boolean parseBoolean(String line, String key) throws IOException {
        if (line.equals(key + "true")) return true;
        if (line.equals(key + "false")) return false;
        throw new IOException("Invalid lock setting: " + key);
    }

    private void write(Snapshot desired) throws IOException {
        rejectLinks(file);
        Files.createDirectories(file.getParent());
        rejectLinks(file);
        if (Files.exists(file, LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Invalid dimension lock state file");
        }
        Path temporary = Files.createTempFile(file.getParent(), ".end-lock-", ".tmp");
        try {
            boolean launchMetadata = desired.end.startOnLaunchMillis > 0 || desired.nether.startOnLaunchMillis > 0
                    || desired.end.openingDurationMillis > 0 || desired.nether.openingDurationMillis > 0;
            byte[] bytes = ("version=" + (launchMetadata ? 3 : 2) + "\nend.locked=" + desired.end.locked
                    + "\nend.unlockAtMillis=" + desired.end.unlockAtMillis
                    + "\nnether.locked=" + desired.nether.locked
                    + "\nnether.unlockAtMillis=" + desired.nether.unlockAtMillis
                    + "\neyeCraftingBlocked=" + desired.eyeCraftingBlocked
                    + "\nframeInsertionBlocked=" + desired.frameInsertionBlocked
                    + (launchMetadata ? "\nend.startOnLaunchMillis=" + desired.end.startOnLaunchMillis
                    + "\nend.openingDurationMillis=" + desired.end.openingDurationMillis
                    + "\nnether.startOnLaunchMillis=" + desired.nether.startOnLaunchMillis
                    + "\nnether.openingDurationMillis=" + desired.nether.openingDurationMillis : "") + "\n").getBytes(StandardCharsets.UTF_8);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)) {
                ByteBuffer content = ByteBuffer.wrap(bytes);
                while (content.hasRemaining()) channel.write(content);
                channel.force(true);
            }
            rejectLinks(file);
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void rejectLinks(Path file) throws IOException {
        for (Path part = file; part != null; part = part.getParent()) {
            if (Files.isSymbolicLink(part)) throw new IOException("Linked dimension lock state path");
        }
    }
}
