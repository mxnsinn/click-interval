package dev.servertradeassistant.fabric.core;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;

/** Bounded monotonic cooldown registry; all calls happen on the server thread. */
public final class CooldownGate {
    private static final int MAX_ENTRIES = 4_096;
    private final Map<UUID, Long> nextAllowedNanos = new LinkedHashMap<>(128, 0.75F, true);
    private final LongSupplier nanoClock;

    public CooldownGate() {
        this(System::nanoTime);
    }

    CooldownGate(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    public long remainingMillis(UUID playerId) {
        long remaining = nextAllowedNanos.getOrDefault(playerId, 0L) - nanoClock.getAsLong();
        return remaining <= 0L ? 0L : Math.max(1L, (remaining + 999_999L) / 1_000_000L);
    }

    public void arm(UUID playerId, long cooldownMillis) {
        long boundedMillis = Math.max(0L, Math.min(30_000L, cooldownMillis));
        nextAllowedNanos.put(playerId, nanoClock.getAsLong() + boundedMillis * 1_000_000L);
        while (nextAllowedNanos.size() > MAX_ENTRIES) {
            Iterator<UUID> iterator = nextAllowedNanos.keySet().iterator();
            if (!iterator.hasNext()) break;
            iterator.next();
            iterator.remove();
        }
    }

    public void forget(UUID playerId) {
        nextAllowedNanos.remove(playerId);
    }
}
