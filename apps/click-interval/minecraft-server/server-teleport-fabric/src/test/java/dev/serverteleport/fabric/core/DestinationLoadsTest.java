package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;

final class DestinationLoadsTest {
    @Test
    void incompleteTerrainRemainsPendingWithoutWaitingOrReadingAResult() {
        FakeLoader loader = new FakeLoader();
        DestinationLoads<String> loads = new DestinationLoads<>(4, loader);
        var lease = loads.acquire("nether-base");
        assertEquals(DestinationLoads.Status.WAITING, loads.poll(lease));
        assertEquals(0, loader.readinessChecks);
        loader.futures.get("nether-base").complete(null);
        assertEquals(DestinationLoads.Status.WAITING, loads.poll(lease));
        loader.ready.add("nether-base");
        assertEquals(DestinationLoads.Status.READY, loads.poll(lease));
    }

    @Test
    void activeDestinationsAreBoundedAndSharedUntilTheLastTravelerReleases() {
        FakeLoader loader = new FakeLoader();
        DestinationLoads<String> loads = new DestinationLoads<>(2, loader);
        var first = loads.acquire("home");
        var second = loads.acquire("end");
        assertNull(loads.acquire("new-area"));
        var companion = loads.acquire("home");
        assertSame(first, companion);
        assertEquals(2, loader.starts);
        loads.release(first);
        assertFalse(loader.released.contains("home"));
        assertNull(loads.acquire("new-area"));
        loads.release(companion);
        assertTrue(loader.released.contains("home"));
        assertNotNull(loads.acquire("new-area"));
        loads.release(second);
        assertFalse(loader.futures.get("end").isCancelled(), "Minecraft owns the loading future");
    }

    @Test
    void FailedAndCancelledLoadsCannotBeUsedForArrival() {
        FakeLoader loader = new FakeLoader();
        DestinationLoads<String> loads = new DestinationLoads<>(2, loader);
        var failed = loads.acquire("failed");
        loader.futures.get("failed").completeExceptionally(new IllegalStateException("read failure"));
        loader.ready.add("failed");
        assertEquals(DestinationLoads.Status.FAILED, loads.poll(failed));
        var cancelled = loads.acquire("cancelled");
        loader.futures.get("cancelled").cancel(false);
        assertEquals(DestinationLoads.Status.FAILED, loads.poll(cancelled));
        loads.clear();
        assertEquals(Set.of("failed", "cancelled"), loader.released);
        assertEquals(DestinationLoads.Status.FAILED, loads.poll(failed));
    }

    @Test
    void startingFailureReleasesTicketAndDoesNotOccupyCapacity() {
        FakeLoader loader = new FakeLoader();
        loader.throwFor = "bad";
        DestinationLoads<String> loads = new DestinationLoads<>(1, loader);
        assertThrows(IllegalStateException.class, () -> loads.acquire("bad"));
        assertTrue(loader.released.contains("bad"));
        assertNotNull(loads.acquire("good"));
    }

    @Test
    void terrainCompletionAfterDeathCannotReactivateTheReleasedLifeOrCompleteItsReplacement() {
        FakeLoader loader = new FakeLoader();
        DestinationLoads<String> loads = new DestinationLoads<>(1, loader);
        var deadLife = loads.acquire("home");
        var oldFuture = loader.futures.get("home");
        loads.release(deadLife);
        var newLife = loads.acquire("home");
        oldFuture.complete(null);
        loader.ready.add("home");
        assertEquals(DestinationLoads.Status.FAILED, loads.poll(deadLife));
        assertEquals(DestinationLoads.Status.WAITING, loads.poll(newLife));
        loader.futures.get("home").complete(null);
        assertEquals(DestinationLoads.Status.READY, loads.poll(newLife));
    }

    @Test
    void CompletedCombatCountdownStillRejectsPushesDuringTerrainPreparation() {
        TeleportWarmupState warmup = new TeleportWarmupState(0L, "nether", 8, 70, 8);
        assertEquals(TeleportWarmupState.Status.COMPLETE,
                warmup.update(10_000L, "nether", 8, 70, 8, true).status());
        assertEquals(TeleportWarmupState.Status.MOVED,
                warmup.update(12_000L, "nether", 8.0001, 70, 8, true).status());
    }

    private static final class FakeLoader implements DestinationLoads.Loader<String> {
        private final Map<String, CompletableFuture<Void>> futures = new HashMap<>();
        private final Set<String> ready = new HashSet<>();
        private final Set<String> released = new HashSet<>();
        private String throwFor;
        private int starts;
        private int readinessChecks;

        @Override
        public CompletableFuture<?> start(String key) {
            starts++;
            if (key.equals(throwFor)) throw new IllegalStateException("could not request load");
            CompletableFuture<Void> future = new CompletableFuture<>() {
                @Override
                public Void join() { throw new AssertionError("must not block the server thread"); }
            };
            futures.put(key, future);
            return future;
        }

        @Override
        public boolean ready(String key) { readinessChecks++; return ready.contains(key); }
        @Override
        public void keepAlive(String key) { }
        @Override
        public void release(String key) { released.add(key); }
    }
}
