package dev.proximityvoice.core;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.UUID;
import java.util.function.Predicate;

public final class ProximityRouter {
    private ProximityRouter() {}

    public static List<UUID> recipients(
            UUID sourceId,
            Map<UUID, PlayerSnapshot> snapshots,
            double radius
    ) {
        return recipients(sourceId, snapshots, radius, Integer.MAX_VALUE);
    }

    /**
     * Selects the nearest eligible listeners while enforcing a hard fan-out cap.
     * The bounded heap prevents a single authenticated speaker from turning one
     * UDP frame into an unbounded number of encrypted datagrams.
     */
    public static List<UUID> recipients(
            UUID sourceId,
            Map<UUID, PlayerSnapshot> snapshots,
            double radius,
            int maximumRecipients
    ) {
        return recipients(sourceId, snapshots, radius, maximumRecipients, ignored -> true);
    }

    static List<UUID> recipients(
            UUID sourceId,
            Map<UUID, PlayerSnapshot> snapshots,
            double radius,
            int maximumRecipients,
            Predicate<UUID> eligibleRecipient
    ) {
        if (sourceId == null || snapshots == null || snapshots.isEmpty()) return List.of();
        if (!Double.isFinite(radius) || radius <= 0.0 || radius > 512.0) {
            throw new IllegalArgumentException("Voice radius must be between 0 and 512 blocks.");
        }
        if (maximumRecipients <= 0) return List.of();
        if (eligibleRecipient == null) throw new IllegalArgumentException("Recipient filter is required.");
        PlayerSnapshot source = snapshots.get(sourceId);
        if (source == null || !source.voiceEnabled()) return List.of();
        double radiusSquared = radius * radius;
        int boundedMaximum = Math.min(maximumRecipients, Math.max(0, snapshots.size() - 1));
        if (boundedMaximum == 0) return List.of();
        Comparator<Candidate> nearestFirst = Comparator
                .comparingDouble(Candidate::distanceSquared)
                .thenComparing(Candidate::playerId);
        PriorityQueue<Candidate> nearest = new PriorityQueue<>(
                Math.min(boundedMaximum, 64), nearestFirst.reversed());
        for (PlayerSnapshot target : snapshots.values()) {
            if (target.playerId().equals(sourceId) || !target.voiceEnabled()) continue;
            if (!eligibleRecipient.test(target.playerId())) continue;
            if (!target.worldId().equals(source.worldId())) continue;
            double dx = target.x() - source.x();
            double dy = target.y() - source.y();
            double dz = target.z() - source.z();
            double distanceSquared = dx * dx + dy * dy + dz * dz;
            if (distanceSquared > radiusSquared) continue;
            Candidate candidate = new Candidate(target.playerId(), distanceSquared);
            if (nearest.size() < boundedMaximum) {
                nearest.add(candidate);
            } else if (nearestFirst.compare(candidate, nearest.peek()) < 0) {
                nearest.poll();
                nearest.add(candidate);
            }
        }
        List<Candidate> ordered = new ArrayList<>(nearest);
        ordered.sort(nearestFirst);
        return ordered.stream().map(Candidate::playerId).toList();
    }

    private record Candidate(UUID playerId, double distanceSquared) {}
}
