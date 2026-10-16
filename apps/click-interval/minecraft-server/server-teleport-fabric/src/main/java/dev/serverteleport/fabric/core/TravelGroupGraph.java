package dev.serverteleport.fabric.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Builds a bounded vehicle/passenger/leash graph without depending on Minecraft classes.
 *
 * <p>The Fabric adapter supplies the live entity relationships. Keeping the traversal here makes
 * the consent, deduplication, capacity, and chained-leash rules directly testable.</p>
 */
public final class TravelGroupGraph<T> {
    public enum Result {
        ADDED,
        ALREADY_PRESENT,
        CONTAINS_OTHER_PLAYER,
        TOO_LARGE,
        UNAVAILABLE;

        public boolean accepted() {
            return this == ADDED || this == ALREADY_PRESENT;
        }
    }

    public interface Adapter<T> {
        UUID id(T entity);

        boolean unavailable(T entity);

        boolean player(T entity);

        T rootVehicle(T entity);

        List<T> selfAndPassengers(T root);

        List<T> eligibleEntitiesLeashedTo(T holder);
    }

    private final int maximumEntities;
    private final Adapter<T> adapter;
    private final LinkedHashMap<UUID, T> roots = new LinkedHashMap<>();
    private final LinkedHashMap<UUID, T> members = new LinkedHashMap<>();

    public TravelGroupGraph(int maximumEntities, Adapter<T> adapter) {
        if (maximumEntities < 1) throw new IllegalArgumentException("maximumEntities must be positive");
        this.maximumEntities = maximumEntities;
        this.adapter = Objects.requireNonNull(adapter, "adapter");
    }

    /** Adds an entire vehicle tree atomically. No member is retained when validation fails. */
    public Result addRoot(T root, T traveler) {
        if (root == null || traveler == null || adapter.unavailable(root)) return Result.UNAVAILABLE;
        UUID rootId = adapter.id(root);
        UUID travelerId = adapter.id(traveler);
        if (rootId == null || travelerId == null) return Result.UNAVAILABLE;
        if (roots.containsKey(rootId)) return Result.ALREADY_PRESENT;

        List<T> supplied = adapter.selfAndPassengers(root);
        if (supplied == null || supplied.isEmpty()) return Result.UNAVAILABLE;
        LinkedHashMap<UUID, T> candidates = new LinkedHashMap<>();
        for (T member : supplied) {
            if (member == null || adapter.unavailable(member)) return Result.UNAVAILABLE;
            UUID memberId = adapter.id(member);
            if (memberId == null) return Result.UNAVAILABLE;
            candidates.putIfAbsent(memberId, member);
            if (adapter.player(member) && !memberId.equals(travelerId)) {
                return Result.CONTAINS_OTHER_PLAYER;
            }
        }
        if (!candidates.containsKey(rootId)) return Result.UNAVAILABLE;

        long additional = candidates.keySet().stream().filter(id -> !members.containsKey(id)).count();
        if (members.size() + additional > maximumEntities) return Result.TOO_LARGE;

        roots.put(rootId, root);
        candidates.forEach(members::putIfAbsent);
        return Result.ADDED;
    }

    /**
     * Follows every eligible leash away from every member, including vehicle passengers and
     * chained leash holders. UUID sets make cycles terminate and keep each entity in the plan once.
     */
    public Result expandLeashClosure(T traveler) {
        if (traveler == null || adapter.id(traveler) == null) return Result.UNAVAILABLE;
        ArrayDeque<T> holders = new ArrayDeque<>();
        HashSet<UUID> queued = new HashSet<>();
        HashSet<UUID> scanned = new HashSet<>();
        enqueueUnscannedMembers(holders, queued, scanned);

        while (!holders.isEmpty()) {
            T holder = holders.removeFirst();
            UUID holderId = adapter.id(holder);
            if (holderId == null || !scanned.add(holderId)) continue;
            List<T> attachedEntities = adapter.eligibleEntitiesLeashedTo(holder);
            if (attachedEntities == null) continue;
            for (T attached : attachedEntities) {
                if (attached == null || adapter.unavailable(attached)) continue;
                T root = adapter.rootVehicle(attached);
                Result result = addRoot(root, traveler);
                if (!result.accepted()) return result;
                if (result == Result.ADDED) enqueueUnscannedMembers(holders, queued, scanned);
            }
        }
        return Result.ADDED;
    }

    public List<T> roots() {
        return List.copyOf(roots.values());
    }

    public List<T> members() {
        return List.copyOf(members.values());
    }

    public int size() {
        return members.size();
    }

    private void enqueueUnscannedMembers(
            ArrayDeque<T> holders,
            HashSet<UUID> queued,
            HashSet<UUID> scanned) {
        for (T member : members.values()) {
            UUID memberId = adapter.id(member);
            if (memberId != null && !scanned.contains(memberId) && queued.add(memberId)) {
                holders.addLast(member);
            }
        }
    }
}
