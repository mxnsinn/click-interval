package com.clickinterval.map.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

@Timeout(10)
class CoalescingSnapshotWriterTest {
    @Test
    void slowDiskKeepsOnlyLatestPendingSnapshotAndOneWorker() throws Exception {
        var executor = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        List<String> written = new CopyOnWriteArrayList<>();
        List<Exception> failures = new CopyOnWriteArrayList<>();
        var writer = new CoalescingSnapshotWriter(executor, snapshot -> {
            if (snapshot.equals("first")) {
                entered.countDown();
                await(release);
            }
            written.add(snapshot);
        }, failures::add);
        try {
            assertTrue(writer.submit("first"));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            for (int i = 0; i < 50_000; i++) assertTrue(writer.submit("pending-" + i));
            assertEquals(1, executor.getTaskCount(), "Producer updates must not enqueue runnable tasks");
            assertEquals(0, executor.getQueue().size());
            // Zero timeout seals the final payload while the first I/O is deliberately blocked.
            assertFalse(writer.closeAndFlush("final", 0, TimeUnit.MILLISECONDS));
            assertFalse(writer.submit("stale-after-close"));
            release.countDown();
            assertTrue(writer.closeAndFlush("must-not-replace-final", 2, TimeUnit.SECONDS));
            assertEquals(List.of("first", "final"), written);
            assertTrue(failures.isEmpty());
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void freshSnapshotsContinueAfterACompletedDrain() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        List<String> written = new CopyOnWriteArrayList<>();
        CountDownLatch firstDone = new CountDownLatch(1);
        CountDownLatch secondDone = new CountDownLatch(1);
        var writer = new CoalescingSnapshotWriter(executor, snapshot -> {
            written.add(snapshot);
            if (snapshot.equals("first")) firstDone.countDown();
            if (snapshot.equals("second")) secondDone.countDown();
        }, failure -> fail(failure));
        try {
            writer.submit("first");
            assertTrue(firstDone.await(2, TimeUnit.SECONDS));
            // A barrier behind the drain confirms the first worker has fully returned.
            executor.submit(() -> {}).get(2, TimeUnit.SECONDS);
            writer.submit("second");
            assertTrue(secondDone.await(2, TimeUnit.SECONDS));
            assertTrue(writer.closeAndFlush("final", 2, TimeUnit.SECONDS));
            assertEquals(List.of("first", "second", "final"), written);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void failedDiskWriteDoesNotWedgeFutureStatus() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        AtomicInteger attempts = new AtomicInteger();
        List<Exception> failures = new CopyOnWriteArrayList<>();
        List<String> written = new CopyOnWriteArrayList<>();
        CountDownLatch failed = new CountDownLatch(1);
        var writer = new CoalescingSnapshotWriter(executor, snapshot -> {
            if (attempts.getAndIncrement() == 0) throw new IOException("Simulated sharing violation");
            written.add(snapshot);
        }, failure -> { failures.add(failure); failed.countDown(); });
        try {
            writer.submit("unwritable");
            assertTrue(failed.await(2, TimeUnit.SECONDS));
            assertTrue(writer.closeAndFlush("recovered", 2, TimeUnit.SECONDS));
            assertEquals(List.of("recovered"), written);
            assertEquals(1, failures.size());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void closeBeforeFirstTickStillPublishesFinalSnapshot(@TempDir Path directory) throws Exception {
        List<Exception> failures = new CopyOnWriteArrayList<>();
        var writer = new CoalescingSnapshotWriter(directory.resolve("new-directory"), failures::add);
        String expected = "{\"players\":[],\"generatedAt\":1234}";
        assertTrue(writer.closeAndFlush(expected, 2, TimeUnit.SECONDS));
        assertEquals(expected, Files.readString(directory.resolve("new-directory/snapshot.json")));
        assertFalse(Files.exists(directory.resolve("new-directory/snapshot.json.tmp")));
        assertFalse(writer.submit("late"));
        assertTrue(failures.isEmpty());
    }

    @Test
    void finalSnapshotReplacesExistingFileAtomically(@TempDir Path directory) throws Exception {
        Files.writeString(directory.resolve("snapshot.json"), "old");
        List<Exception> failures = new CopyOnWriteArrayList<>();
        var writer = new CoalescingSnapshotWriter(directory, failures::add);
        assertTrue(writer.closeAndFlush("new", 2, TimeUnit.SECONDS));
        assertEquals("new", Files.readString(directory.resolve("snapshot.json")));
        assertFalse(Files.exists(directory.resolve("snapshot.json.tmp")));
        assertTrue(failures.isEmpty());
    }

    @Test
    void concurrentProducersCannotWriteAfterFinalSnapshot() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        var producers = Executors.newFixedThreadPool(4);
        List<String> written = new CopyOnWriteArrayList<>();
        var writer = new CoalescingSnapshotWriter(executor, written::add, failure -> fail(failure));
        try {
            for (int producer = 0; producer < 4; producer++) producers.submit(() -> {
                for (int index = 0; index < 1_000; index++) writer.submit("update-" + index);
            });
            producers.shutdown();
            assertTrue(producers.awaitTermination(2, TimeUnit.SECONDS));
            assertTrue(writer.closeAndFlush("final", 2, TimeUnit.SECONDS));
            assertEquals("final", written.getLast());
            assertFalse(writer.submit("late"));
        } finally {
            producers.shutdownNow();
            executor.shutdownNow();
        }
    }

    private static void await(CountDownLatch latch) throws IOException {
        try {
            if (!latch.await(3, TimeUnit.SECONDS)) throw new IOException("Test gate timed out");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException(interrupted);
        }
    }
}
