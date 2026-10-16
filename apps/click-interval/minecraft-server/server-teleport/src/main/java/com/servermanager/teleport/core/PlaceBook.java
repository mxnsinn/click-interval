package com.servermanager.teleport.core;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Bounded, case-insensitive per-player saved-place state. */
public final class PlaceBook {
    public static final int MAX_PLACES_PER_PLAYER = 16;

    private final Map<UUID, LinkedHashMap<String, SavedPlace>> places;

    public PlaceBook() {
        this.places = new LinkedHashMap<>();
    }

    private PlaceBook(Map<UUID, LinkedHashMap<String, SavedPlace>> places) {
        this.places = places;
    }

    public synchronized PutResult put(UUID playerId, String name, SavedPlace place) {
        Objects.requireNonNull(playerId, "playerId");
        Objects.requireNonNull(place, "place");
        String normalized = PlaceNames.normalize(name);
        LinkedHashMap<String, SavedPlace> playerPlaces = places.computeIfAbsent(
                playerId, ignored -> new LinkedHashMap<>());
        boolean existed = playerPlaces.containsKey(normalized);
        if (!existed && playerPlaces.size() >= MAX_PLACES_PER_PLAYER) {
            if (playerPlaces.isEmpty()) places.remove(playerId);
            return PutResult.LIMIT_REACHED;
        }
        playerPlaces.put(normalized, place);
        return existed ? PutResult.UPDATED : PutResult.CREATED;
    }

    public synchronized SavedPlace get(UUID playerId, String name) {
        Objects.requireNonNull(playerId, "playerId");
        if (!PlaceNames.isValid(name)) return null;
        Map<String, SavedPlace> playerPlaces = places.get(playerId);
        return playerPlaces == null ? null : playerPlaces.get(PlaceNames.normalize(name));
    }

    public synchronized boolean delete(UUID playerId, String name) {
        Objects.requireNonNull(playerId, "playerId");
        if (!PlaceNames.isValid(name)) return false;
        LinkedHashMap<String, SavedPlace> playerPlaces = places.get(playerId);
        if (playerPlaces == null) return false;
        boolean removed = playerPlaces.remove(PlaceNames.normalize(name)) != null;
        if (playerPlaces.isEmpty()) places.remove(playerId);
        return removed;
    }

    public synchronized List<String> names(UUID playerId) {
        Objects.requireNonNull(playerId, "playerId");
        Map<String, SavedPlace> playerPlaces = places.get(playerId);
        if (playerPlaces == null) return List.of();
        return playerPlaces.keySet().stream()
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .toList();
    }

    public synchronized int count(UUID playerId) {
        Map<String, SavedPlace> playerPlaces = places.get(playerId);
        return playerPlaces == null ? 0 : playerPlaces.size();
    }

    public synchronized PlaceBook copy() {
        return new PlaceBook(mutableDeepCopy(places));
    }

    public synchronized Map<UUID, Map<String, SavedPlace>> snapshot() {
        LinkedHashMap<UUID, Map<String, SavedPlace>> result = new LinkedHashMap<>();
        places.entrySet().stream()
                .sorted(Map.Entry.comparingByKey(Comparator.comparing(UUID::toString)))
                .forEach(entry -> result.put(entry.getKey(), Map.copyOf(entry.getValue())));
        return Map.copyOf(result);
    }

    private static Map<UUID, LinkedHashMap<String, SavedPlace>> mutableDeepCopy(
            Map<UUID, LinkedHashMap<String, SavedPlace>> source
    ) {
        LinkedHashMap<UUID, LinkedHashMap<String, SavedPlace>> result = new LinkedHashMap<>();
        source.forEach((playerId, playerPlaces) -> result.put(playerId, new LinkedHashMap<>(playerPlaces)));
        return result;
    }

    public enum PutResult {
        CREATED,
        UPDATED,
        LIMIT_REACHED
    }
}
