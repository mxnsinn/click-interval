package com.clickinterval.map.fabric;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** Source contracts for the Minecraft-thread adapter; the asynchronous pipeline is tested separately. */
class MapTickIoRegressionTest {
    private String source() throws Exception {
        return Files.readString(Path.of("src/main/java/com/clickinterval/map/fabric/ClickIntervalMapFabric.java"));
    }

    @Test
    void historicalQueueUsesJdkAtomicCountForAllMutationPaths() throws Exception {
        String source = source();
        assertTrue(source.contains("LinkedBlockingQueue<HistoricalChunk> historicalChunks = new LinkedBlockingQueue<>()"));
        assertFalse(source.contains("ConcurrentLinkedQueue" + "<HistoricalChunk>"));
        assertTrue(source.contains("historicalChunks.addAll(discovered)"));
        assertTrue(source.contains("historicalChunks.add(target.retry())"));
        assertTrue(source.contains("historicalChunks.poll()"));
        assertTrue(source.contains("historicalChunks.clear()"));
        assertTrue(source.contains("historicalChunks.size() + historicalReadsInFlight.get()"));
        assertFalse(source.contains("historicalChunks.stream()"));
    }

    @Test
    void statusTickCapturesImmutableTextWithoutFileIo() throws Exception {
        String source = source();
        int start = source.indexOf("private void writeStatusSnapshot(");
        int end = source.indexOf("private void scheduleTerrainWrite(", start);
        String tickAdapter = source.substring(start, end);
        assertTrue(tickAdapter.contains("writer.submit(statusJson(server))"));
        assertFalse(tickAdapter.contains("Files."));
        assertFalse(tickAdapter.contains("writeAtomically("));
        assertFalse(tickAdapter.contains("await"));
        assertTrue(source.contains("writer.closeAndFlush(statusJson(server), 5, TimeUnit.SECONDS)"));
    }

    @Test
    void backfillPacingPreservesConcurrencyTickGateAndCoverage() throws Exception {
        String source = source();
        assertTrue(source.contains("MAX_HISTORICAL_STARTS_PER_TICK = 1;"));
        assertTrue(source.contains("MAX_HISTORICAL_READS = 6;"));
        assertTrue(source.contains("TERRAIN_IO_THREADS = 3;"));
        assertTrue(source.contains("HISTORICAL_PAUSE_TICK_MS = 30.0D;"));
        assertTrue(source.contains("MAX_COARSE_CHUNKS = 500_000;"));
        assertTrue(source.contains("SAMPLE_STEP = 4;"));
        assertTrue(source.contains("task -> MapBackgroundThreads.create(task, \"click-interval-map-io\")"));
        String writer = Files.readString(Path.of("src/main/java/com/clickinterval/map/fabric/CoalescingSnapshotWriter.java"));
        assertTrue(writer.contains("task -> MapBackgroundThreads.create(task, \"click-interval-map-status-io\")"));
    }
}
