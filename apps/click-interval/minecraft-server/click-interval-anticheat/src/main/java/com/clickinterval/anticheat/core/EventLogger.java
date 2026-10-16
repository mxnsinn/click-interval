package com.clickinterval.anticheat.core;

import java.io.Closeable;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/** Writes bounded, host-parseable event history without blocking the server thread on file I/O. */
public final class EventLogger implements Closeable {
    public static final String PREFIX = "[ServerProtection] EVENT ";
    public static final int DEFAULT_QUEUE_CAPACITY = 512;
    public static final long DEFAULT_MAX_HISTORY_BYTES = 16L * 1024L * 1024L;
    public static final int DEFAULT_HISTORY_ARCHIVES = 2;
    // Console rendering is synchronous in both Paper and Fabric. Keep raw detection chatter low;
    // enforcement actions still receive the separate priority allowance below.
    public static final int DEFAULT_CONSOLE_EVENTS_PER_SECOND = 30;

    private static final int MAX_BATCH_EVENTS = 64;
    private static final int MAX_DETAILS = 16;
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final Path historyFile;
    private final Consumer<String> console;
    private final ArrayBlockingQueue<String> queue;
    private final long maxHistoryBytes;
    private final int historyArchives;
    private final int consoleEventsPerSecond;
    private final Thread writerThread;
    private final AtomicLong droppedEvents = new AtomicLong();
    private final AtomicLong writeFailures = new AtomicLong();
    private final Object consoleRateLock = new Object();

    private volatile boolean closing;
    private long consoleWindowStartedNanos = System.nanoTime();
    private int consoleEventsInWindow;
    private long suppressedConsoleEvents;

    public EventLogger(Path historyFile, Consumer<String> console) {
        this(historyFile, console, DEFAULT_QUEUE_CAPACITY, DEFAULT_MAX_HISTORY_BYTES,
                DEFAULT_HISTORY_ARCHIVES, DEFAULT_CONSOLE_EVENTS_PER_SECOND);
    }

    EventLogger(
            Path historyFile,
            Consumer<String> console,
            int queueCapacity,
            long maxHistoryBytes,
            int historyArchives,
            int consoleEventsPerSecond
    ) {
        this.historyFile = historyFile;
        this.console = console == null ? ignored -> { } : console;
        this.queue = new ArrayBlockingQueue<>(Math.max(8, Math.min(8192, queueCapacity)));
        this.maxHistoryBytes = Math.max(64L * 1024L, maxHistoryBytes);
        this.historyArchives = Math.max(0, Math.min(8, historyArchives));
        this.consoleEventsPerSecond = Math.max(1, Math.min(10_000, consoleEventsPerSecond));
        writerThread = new Thread(this::writeLoop, "server-protection-history");
        writerThread.setDaemon(true);
        writerThread.start();
    }

    public void event(
            String player,
            UUID uuid,
            String check,
            String category,
            EnforcementAction action,
            String reason,
            double violations,
            int offenseCount,
            int durationSeconds,
            Map<String, ?> details
    ) {
        EnforcementAction safeAction = action == null ? EnforcementAction.NONE : action;
        String json = buildEvent(player, uuid, check, category, safeAction, reason,
                violations, offenseCount, durationSeconds, details);
        emitConsole(PREFIX + json, safeAction != EnforcementAction.NONE);
        enqueue(json, safeAction != EnforcementAction.NONE);
    }

    public long droppedEventCount() {
        return droppedEvents.get();
    }

    public long writeFailureCount() {
        return writeFailures.get();
    }

    int pendingEventCount() {
        return queue.size();
    }

    private static String buildEvent(
            String player,
            UUID uuid,
            String check,
            String category,
            EnforcementAction action,
            String reason,
            double violations,
            int offenseCount,
            int durationSeconds,
            Map<String, ?> details
    ) {
        StringBuilder json = new StringBuilder(384);
        json.append('{');
        appendField(json, "player", bounded(player, 64)).append(',');
        appendField(json, "uuid", uuid == null ? "" : uuid.toString()).append(',');
        appendField(json, "check", bounded(check, 96)).append(',');
        appendField(json, "category", bounded(category, 64)).append(',');
        appendField(json, "action", action.wireName()).append(',');
        appendField(json, "reason", bounded(reason, 512)).append(',');
        json.append("\"violations\":").append(finite(violations)).append(',')
                .append("\"offenseCount\":").append(Math.max(0, offenseCount)).append(',');
        appendField(json, "timestamp", Instant.now().toString()).append(',');
        json.append("\"durationSeconds\":").append(Math.max(0, durationSeconds)).append(',')
                .append("\"details\":");
        appendObject(json, details);
        json.append('}');
        return json.toString();
    }

    private void enqueue(String json, boolean priority) {
        if (closing) {
            droppedEvents.incrementAndGet();
            return;
        }
        if (queue.offer(json)) return;
        if (priority) {
            if (queue.poll() != null) droppedEvents.incrementAndGet();
            if (queue.offer(json)) return;
        }
        droppedEvents.incrementAndGet();
    }

    private void emitConsole(String line, boolean priority) {
        String summary = null;
        boolean emit;
        long now = System.nanoTime();
        synchronized (consoleRateLock) {
            if (now - consoleWindowStartedNanos >= TimeUnit.SECONDS.toNanos(1)) {
                if (suppressedConsoleEvents > 0) {
                    summary = "[ServerProtection] Suppressed " + suppressedConsoleEvents
                            + " repetitive detection event(s) from console output.";
                }
                consoleWindowStartedNanos = now;
                consoleEventsInWindow = 0;
                suppressedConsoleEvents = 0;
            }
            int hardLimit = Math.min(20_000, consoleEventsPerSecond * 2);
            emit = priority
                    ? consoleEventsInWindow < hardLimit
                    : consoleEventsInWindow < consoleEventsPerSecond;
            if (emit) consoleEventsInWindow++;
            else suppressedConsoleEvents++;
        }
        if (summary != null) safeConsole(summary);
        if (emit) safeConsole(line);
    }

    private void safeConsole(String line) {
        try {
            console.accept(line);
        } catch (RuntimeException ignored) {
            // Console output must never break an event handler.
        }
    }

    private void writeLoop() {
        List<String> batch = new ArrayList<>(MAX_BATCH_EVENTS);
        while (!closing || !queue.isEmpty()) {
            try {
                String first = queue.poll(250, TimeUnit.MILLISECONDS);
                if (first == null) continue;
                batch.clear();
                batch.add(first);
                queue.drainTo(batch, MAX_BATCH_EVENTS - 1);
                appendBatch(batch);
            } catch (InterruptedException interrupted) {
                if (closing) break;
            } catch (IOException | RuntimeException ignored) {
                writeFailures.incrementAndGet();
                droppedEvents.addAndGet(Math.max(1, batch.size()));
            }
        }
    }

    private void appendBatch(List<String> batch) throws IOException {
        String separator = System.lineSeparator();
        int separatorBytes = utf8Length(separator);
        Path parent = historyFile.getParent();
        if (parent != null) Files.createDirectories(parent);
        long currentSize = Files.isRegularFile(historyFile) ? Files.size(historyFile) : 0L;
        long projectedSize = currentSize;
        StringBuilder payload = new StringBuilder(batch.size() * 384);
        for (String json : batch) {
            int lineBytes = utf8Length(json) + separatorBytes;
            if (projectedSize > 0 && projectedSize + lineBytes > maxHistoryBytes) {
                flushPayload(payload);
                rotateHistory();
                payload.setLength(0);
                projectedSize = 0L;
            }
            payload.append(json).append(separator);
            projectedSize += lineBytes;
        }
        flushPayload(payload);
    }

    private void flushPayload(StringBuilder payload) throws IOException {
        if (payload.isEmpty()) return;
        Files.writeString(historyFile, payload, StandardCharsets.UTF_8,
                StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
    }

    private void rotateHistory() throws IOException {
        if (historyArchives == 0) {
            Files.deleteIfExists(historyFile);
            return;
        }
        for (int index = historyArchives; index >= 2; index--) {
            Path previous = archive(index - 1);
            if (Files.isRegularFile(previous)) {
                Files.move(previous, archive(index), StandardCopyOption.REPLACE_EXISTING);
            }
        }
        if (Files.isRegularFile(historyFile)) {
            Files.move(historyFile, archive(1), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private Path archive(int index) {
        return historyFile.resolveSibling(historyFile.getFileName() + "." + index);
    }

    private static void appendObject(StringBuilder result, Map<String, ?> values) {
        result.append('{');
        if (values == null || values.isEmpty()) {
            result.append('}');
            return;
        }
        boolean first = true;
        int count = 0;
        for (Map.Entry<String, ?> entry : values.entrySet()) {
            if (count++ == MAX_DETAILS) break;
            if (!first) result.append(',');
            first = false;
            appendField(result, bounded(entry.getKey(), 64), bounded(String.valueOf(entry.getValue()), 256));
        }
        result.append('}');
    }

    private static StringBuilder appendField(StringBuilder result, String name, String value) {
        appendQuoted(result, name).append(':');
        return appendQuoted(result, value);
    }

    private static String finite(double value) {
        return Double.isFinite(value) ? Double.toString(value) : "0.0";
    }

    private static String bounded(String value, int maximum) {
        if (value == null) return "";
        if (value.length() <= maximum) return value;
        int end = maximum;
        if (end > 0 && Character.isHighSurrogate(value.charAt(end - 1))) end--;
        return value.substring(0, end);
    }

    private static StringBuilder appendQuoted(StringBuilder result, String value) {
        result.append('"');
        if (value == null || value.isEmpty()) return result.append('"');
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            switch (character) {
                case '\\' -> result.append("\\\\");
                case '"' -> result.append("\\\"");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (character < 0x20) {
                        result.append("\\u")
                                .append(HEX[(character >>> 12) & 0xF])
                                .append(HEX[(character >>> 8) & 0xF])
                                .append(HEX[(character >>> 4) & 0xF])
                                .append(HEX[character & 0xF]);
                    } else {
                        result.append(character);
                    }
                }
            }
        }
        return result.append('"');
    }

    /** Returns the encoded byte count without allocating a temporary byte array per history line. */
    static int utf8Length(CharSequence value) {
        int bytes = 0;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character <= 0x7F) {
                bytes++;
            } else if (character <= 0x7FF) {
                bytes += 2;
            } else if (Character.isHighSurrogate(character)
                    && index + 1 < value.length()
                    && Character.isLowSurrogate(value.charAt(index + 1))) {
                bytes += 4;
                index++;
            } else if (Character.isSurrogate(character)) {
                // The JDK UTF-8 encoder replaces an unpaired surrogate with one ASCII '?'.
                bytes++;
            } else {
                bytes += 3;
            }
        }
        return bytes;
    }

    @Override
    public void close() {
        if (closing) return;
        closing = true;
        try {
            writerThread.join(2_000L);
            if (writerThread.isAlive()) {
                writerThread.interrupt();
                writerThread.join(250L);
            }
        } catch (InterruptedException interrupted) {
            writerThread.interrupt();
            Thread.currentThread().interrupt();
        }
        synchronized (consoleRateLock) {
            if (suppressedConsoleEvents > 0) {
                safeConsole("[ServerProtection] Suppressed " + suppressedConsoleEvents
                        + " repetitive detection event(s) from console output.");
                suppressedConsoleEvents = 0;
            }
        }
    }
}
