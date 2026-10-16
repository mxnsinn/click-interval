package dev.serverteleport.fabric.core;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Bounded, server-session storage for the position a player occupied before a teleport.
 *
 * <p>Entries intentionally do not survive a server restart or disconnect. That prevents stale
 * destinations from outliving world changes, while still allowing {@code /tpa back} to toggle
 * between the two most recent successful teleport positions.</p>
 */
public final class ReturnLocationBook {
    private final int maximumEntries;
    private final LinkedHashMap<UUID, ReturnPoint> locations = new LinkedHashMap<>();

    public ReturnLocationBook(int maximumEntries) {
        if (maximumEntries < 1 || maximumEntries > 65_536) {
            throw new IllegalArgumentException("maximum entries must be between 1 and 65536");
        }
        this.maximumEntries = maximumEntries;
    }

    public synchronized Optional<ReturnPoint> find(UUID playerId) {
        return playerId == null ? Optional.empty() : Optional.ofNullable(locations.get(playerId));
    }

    public synchronized void put(UUID playerId, ReturnPoint location) {
        if (playerId == null || location == null) return;
        locations.remove(playerId);
        locations.put(playerId, location);
        while (locations.size() > maximumEntries) {
            UUID oldest = locations.keySet().iterator().next();
            locations.remove(oldest);
        }
    }

    public synchronized void remove(UUID playerId) {
        if (playerId != null) locations.remove(playerId);
    }

    public synchronized void clear() {
        locations.clear();
    }

    public synchronized int size() {
        return locations.size();
    }

    public synchronized Map<UUID, ReturnPoint> snapshot() {
        return Map.copyOf(locations);
    }
}
