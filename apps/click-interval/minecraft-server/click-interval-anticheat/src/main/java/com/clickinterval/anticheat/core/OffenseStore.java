package com.clickinterval.anticheat.core;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Properties;
import java.util.UUID;

/** Durable, atomic, bounded offense state. JSONL event history is handled by EventLogger. */
public final class OffenseStore {
    public static final int DEFAULT_MAX_RECORDS = 16_384;
    public static final long DEFAULT_MAX_FILE_BYTES = 16L * 1024L * 1024L;
    public static final long DEFAULT_RETENTION_MILLIS = 180L * 24L * 60L * 60L * 1000L;

    private static final int MAX_EVICTION_SCAN = 64;

    private final Path file;
    private final Clock clock;
    private final int maxRecords;
    private final long maxFileBytes;
    private final Map<UUID, OffenseRecord> records = new LinkedHashMap<>(256, 0.75f, true);
    private final Object writeLock = new Object();
    private boolean dirty;
    private long changeVersion;

    public OffenseStore(Path file, Clock clock) {
        this(file, clock, DEFAULT_MAX_RECORDS, DEFAULT_MAX_FILE_BYTES);
    }

    OffenseStore(Path file, Clock clock, int maxRecords, long maxFileBytes) {
        this.file = file;
        this.clock = clock;
        this.maxRecords = Math.max(16, Math.min(100_000, maxRecords));
        this.maxFileBytes = Math.max(64L * 1024L, maxFileBytes);
    }

    public synchronized void load() throws IOException {
        records.clear();
        if (!Files.isRegularFile(file)) return;
        long size = Files.size(file);
        if (size > maxFileBytes) {
            throw new IOException("Offense state exceeds the " + maxFileBytes + " byte safety limit");
        }
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(file)) {
            properties.load(input);
        }
        String ids = properties.getProperty("players", "");
        for (String raw : ids.split(",")) {
            if (records.size() >= maxRecords) break;
            if (raw.isBlank()) continue;
            try {
                UUID uuid = UUID.fromString(raw.trim());
                String prefix = uuid + ".";
                OffenseRecord record = new OffenseRecord(uuid, properties.getProperty(prefix + "name", "Unknown"));
                record.restore(
                        integer(properties, prefix + "detections"),
                        integer(properties, prefix + "offenses"),
                        number(properties, prefix + "temporaryBanUntil"),
                        Boolean.parseBoolean(properties.getProperty(prefix + "permanentBan", "false")),
                        number(properties, prefix + "lastSeenAt"),
                        properties.getProperty(prefix + "lastCheck", ""),
                        properties.getProperty(prefix + "lastReason", ""),
                        properties.getProperty(prefix + "lastAction", "detect")
                );
                records.put(uuid, record);
            } catch (IllegalArgumentException ignored) {
                // One malformed entry should not make the whole protection database unusable.
            }
        }
        dirty = false;
        changeVersion = 0L;
    }

    public synchronized OffenseRecord observe(UUID uuid, String name, String check, String reason) {
        OffenseRecord record = records.get(uuid);
        if (record == null) {
            ensureCapacityForNewRecord();
            record = new OffenseRecord(uuid, name);
            records.put(uuid, record);
        }
        record.observe(name, check, reason, clock.nowMillis());
        markDirty();
        return record;
    }

    public synchronized OffenseRecord punish(
            UUID uuid,
            EnforcementAction action,
            int durationSeconds,
            boolean countsAsOffense
    ) {
        OffenseRecord record = records.get(uuid);
        if (record == null) throw new IllegalStateException("observe must be called before punish");
        long until = action == EnforcementAction.TEMP_BAN
                ? clock.nowMillis() + Math.max(1, durationSeconds) * 1000L
                : 0L;
        record.punish(action, until, countsAsOffense);
        markDirty();
        return record;
    }

    public synchronized int priorOffenseCount(UUID uuid, long inactiveMillis) {
        OffenseRecord record = records.get(uuid);
        if (record == null) return 0;
        if (record.decayOffenses(clock.nowMillis(), Math.max(1L, inactiveMillis))) markDirty();
        return record.offenseCount();
    }

    public synchronized OffenseRecord get(UUID uuid) {
        return records.get(uuid);
    }

    public synchronized OffenseRecord findByName(String name) {
        if (name == null || name.isBlank()) return null;
        for (OffenseRecord record : records.values()) {
            if (record.name().equalsIgnoreCase(name)) return record;
        }
        return null;
    }

    public synchronized List<OffenseRecord> recent(int limit) {
        int boundedLimit = Math.max(0, Math.min(maxRecords, limit));
        if (boundedLimit == 0 || records.isEmpty()) return List.of();
        Comparator<OffenseRecord> oldestFirst = Comparator.comparingLong(OffenseRecord::lastSeenAt);
        PriorityQueue<OffenseRecord> newest = new PriorityQueue<>(Math.min(boundedLimit, records.size()), oldestFirst);
        for (OffenseRecord record : records.values()) {
            if (newest.size() < boundedLimit) {
                newest.offer(record);
            } else if (record.lastSeenAt() > newest.element().lastSeenAt()) {
                newest.poll();
                newest.offer(record);
            }
        }
        ArrayList<OffenseRecord> result = new ArrayList<>(newest);
        result.sort(oldestFirst.reversed());
        return Collections.unmodifiableList(result);
    }

    public synchronized boolean pardon(UUID uuid) {
        OffenseRecord record = records.get(uuid);
        if (record == null) return false;
        record.pardon();
        markDirty();
        return true;
    }

    public synchronized int pruneInactive(long retentionMillis) {
        long now = clock.nowMillis();
        long cutoff = now - Math.max(60_000L, retentionMillis);
        int removed = 0;
        Iterator<OffenseRecord> iterator = records.values().iterator();
        while (iterator.hasNext()) {
            OffenseRecord record = iterator.next();
            if (!record.permanentBan() && record.temporaryBanUntil() <= now && record.lastSeenAt() < cutoff) {
                iterator.remove();
                removed++;
            }
        }
        if (removed > 0) markDirty();
        return removed;
    }

    public synchronized int size() {
        return records.size();
    }

    public void saveIfDirty() throws IOException {
        synchronized (writeLock) {
            List<Snapshot> snapshot;
            long snapshotVersion;
            synchronized (this) {
                if (!dirty) return;
                // The live map is already hard-capped. Copy once while synchronized and let the
                // writer perform I/O after releasing the server-thread lock; sorting the entire
                // map here only added O(n log n) work and temporary stream arrays.
                snapshot = new ArrayList<>(records.size());
                for (OffenseRecord record : records.values()) snapshot.add(Snapshot.from(record));
                snapshotVersion = changeVersion;
            }

            writeSnapshot(snapshot);
            synchronized (this) {
                if (changeVersion == snapshotVersion) dirty = false;
            }
        }
    }

    private void writeSnapshot(List<Snapshot> snapshot) throws IOException {
        Path parent = file.getParent();
        if (parent != null) Files.createDirectories(parent);
        Properties properties = new Properties();
        StringBuilder ids = new StringBuilder(snapshot.size() * 37);
        for (Snapshot record : snapshot) {
            String uuid = record.uuid().toString();
            if (!ids.isEmpty()) ids.append(',');
            ids.append(uuid);
            String prefix = uuid + ".";
            properties.setProperty(prefix + "name", record.name());
            properties.setProperty(prefix + "detections", Integer.toString(record.detections()));
            properties.setProperty(prefix + "offenses", Integer.toString(record.offenseCount()));
            properties.setProperty(prefix + "temporaryBanUntil", Long.toString(record.temporaryBanUntil()));
            properties.setProperty(prefix + "permanentBan", Boolean.toString(record.permanentBan()));
            properties.setProperty(prefix + "lastSeenAt", Long.toString(record.lastSeenAt()));
            properties.setProperty(prefix + "lastCheck", record.lastCheck());
            properties.setProperty(prefix + "lastReason", record.lastReason());
            properties.setProperty(prefix + "lastAction", record.lastAction());
        }
        properties.setProperty("players", ids.toString());
        properties.setProperty("savedAt", Instant.ofEpochMilli(clock.nowMillis()).toString());

        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        try (OutputStream output = Files.newOutputStream(temporary)) {
            properties.store(output, "Server Protection offense state");
        }
        if (Files.size(temporary) > maxFileBytes) {
            Files.deleteIfExists(temporary);
            throw new IOException("Serialized offense state exceeds the " + maxFileBytes + " byte safety limit");
        }
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException atomicUnsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void ensureCapacityForNewRecord() {
        if (records.size() < maxRecords) return;
        long now = clock.nowMillis();
        UUID first = null;
        UUID preferred = null;
        int inspected = 0;
        for (Map.Entry<UUID, OffenseRecord> entry : records.entrySet()) {
            if (first == null) first = entry.getKey();
            OffenseRecord record = entry.getValue();
            if (!record.permanentBan() && record.temporaryBanUntil() <= now) {
                preferred = entry.getKey();
                if (record.offenseCount() == 0) break;
            }
            if (++inspected >= MAX_EVICTION_SCAN) break;
        }
        UUID eviction = preferred == null ? first : preferred;
        if (eviction != null) records.remove(eviction);
    }

    private void markDirty() {
        dirty = true;
        changeVersion++;
    }

    private static int integer(Properties properties, String key) {
        try { return Integer.parseInt(properties.getProperty(key, "0")); }
        catch (NumberFormatException ignored) { return 0; }
    }

    private static long number(Properties properties, String key) {
        try { return Long.parseLong(properties.getProperty(key, "0")); }
        catch (NumberFormatException ignored) { return 0L; }
    }

    private record Snapshot(
            UUID uuid,
            String name,
            int detections,
            int offenseCount,
            long temporaryBanUntil,
            boolean permanentBan,
            long lastSeenAt,
            String lastCheck,
            String lastReason,
            String lastAction
    ) {
        private static Snapshot from(OffenseRecord record) {
            return new Snapshot(
                    record.uuid(), record.name(), record.detections(), record.offenseCount(),
                    record.temporaryBanUntil(), record.permanentBan(), record.lastSeenAt(),
                    record.lastCheck(), record.lastReason(), record.lastAction());
        }
    }
}
