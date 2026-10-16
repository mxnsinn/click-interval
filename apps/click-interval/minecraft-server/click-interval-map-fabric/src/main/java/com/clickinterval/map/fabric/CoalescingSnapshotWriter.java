package com.clickinterval.map.fabric;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** One writer plus one replaceable pending snapshot, regardless of disk latency or producer rate. */
final class CoalescingSnapshotWriter {
    @FunctionalInterface
    interface Sink {
        void write(String snapshot) throws IOException;
    }

    private final ExecutorService executor;
    private final Sink sink;
    private final Consumer<Exception> onFailure;
    private String pending;
    private boolean workerScheduled;
    private boolean closed;

    CoalescingSnapshotWriter(Path directory, Consumer<Exception> onFailure) {
        this(Executors.newSingleThreadExecutor(
                task -> MapBackgroundThreads.create(task, "click-interval-map-status-io")),
                snapshot -> writeSnapshot(directory, snapshot), onFailure);
    }

    CoalescingSnapshotWriter(ExecutorService executor, Sink sink, Consumer<Exception> onFailure) {
        this.executor = Objects.requireNonNull(executor);
        this.sink = Objects.requireNonNull(sink);
        this.onFailure = Objects.requireNonNull(onFailure);
    }

    synchronized boolean submit(String snapshot) {
        Objects.requireNonNull(snapshot);
        if (closed) return false;
        pending = snapshot;
        return scheduleWorker();
    }

    /**
     * Stops producers and makes the final snapshot the last write, without a competing synchronous
     * fallback that could be overwritten by an older in-flight write. Only shutdown may wait on I/O.
     * A storage hang is reported by the bounded timeout; the daemon still owns the final pending write.
     */
    boolean closeAndFlush(String finalSnapshot, long timeout, TimeUnit unit) throws InterruptedException {
        synchronized (this) {
            if (!closed) {
                pending = Objects.requireNonNull(finalSnapshot);
                closed = true;
                scheduleWorker();
            }
            executor.shutdown();
        }
        return executor.awaitTermination(timeout, unit);
    }

    private boolean scheduleWorker() {
        if (workerScheduled) return true;
        workerScheduled = true;
        try {
            executor.execute(this::drain);
            return true;
        } catch (RejectedExecutionException rejected) {
            workerScheduled = false;
            onFailure.accept(rejected);
            return false;
        }
    }

    private void drain() {
        while (true) {
            String snapshot;
            synchronized (this) {
                snapshot = pending;
                pending = null;
                if (snapshot == null) {
                    workerScheduled = false;
                    return;
                }
            }
            try {
                sink.write(snapshot);
            } catch (Exception failure) {
                // A transient sharing/disk error must not wedge future status updates.
                onFailure.accept(failure);
            }
        }
    }

    private static void writeSnapshot(Path directory, String snapshot) throws IOException {
        Files.createDirectories(directory);
        Path temporary = directory.resolve("snapshot.json.tmp");
        Path target = directory.resolve("snapshot.json");
        Files.writeString(temporary, snapshot, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
