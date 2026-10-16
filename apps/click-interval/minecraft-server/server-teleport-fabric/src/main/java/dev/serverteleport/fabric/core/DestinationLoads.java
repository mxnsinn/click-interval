package dev.serverteleport.fabric.core;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;

/** Server-thread-only, bounded shared destination loads. Polling never waits on a future. */
public final class DestinationLoads<K> {
    public enum Status { WAITING, READY, FAILED }

    public interface Loader<K> {
        CompletableFuture<?> start(K destination);
        boolean ready(K destination);
        void keepAlive(K destination);
        void release(K destination);
    }

    private final int capacity;
    private final Loader<K> loader;
    private final Map<K, Lease<K>> loads = new LinkedHashMap<>();

    public DestinationLoads(int capacity, Loader<K> loader) {
        if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
        this.capacity = capacity;
        this.loader = Objects.requireNonNull(loader, "loader");
    }

    /** Null means the bounded loader is busy. Existing loads can always be shared. */
    public Lease<K> acquire(K key) {
        Objects.requireNonNull(key, "key");
        Lease<K> existing = loads.get(key);
        if (existing != null) {
            existing.references++;
            return existing;
        }
        if (loads.size() >= capacity) return null;
        CompletableFuture<?> future;
        try {
            future = Objects.requireNonNull(loader.start(key), "load future");
        } catch (RuntimeException error) {
            loader.release(key);
            throw error;
        }
        Lease<K> lease = new Lease<>(key, future);
        loads.put(key, lease);
        return lease;
    }

    public Status poll(Lease<K> lease) {
        if (lease == null || loads.get(lease.key) != lease) return Status.FAILED;
        loader.keepAlive(lease.key);
        if (lease.future.isCompletedExceptionally() || lease.future.isCancelled()) return Status.FAILED;
        return lease.future.isDone() && loader.ready(lease.key) ? Status.READY : Status.WAITING;
    }

    public void release(Lease<K> lease) {
        if (lease == null || loads.get(lease.key) != lease) return;
        if (--lease.references > 0) return;
        loads.remove(lease.key);
        loader.release(lease.key);
        // Minecraft owns the future; cancelling it could affect another chunk consumer.
    }

    public void clear() {
        for (K key : loads.keySet()) loader.release(key);
        loads.clear();
    }

    public static final class Lease<K> {
        private final K key;
        private final CompletableFuture<?> future;
        private int references = 1;

        private Lease(K key, CompletableFuture<?> future) {
            this.key = key;
            this.future = future;
        }

        public K key() { return key; }
    }
}
