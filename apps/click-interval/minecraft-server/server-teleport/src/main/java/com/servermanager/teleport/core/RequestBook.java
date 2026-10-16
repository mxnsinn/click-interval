package com.servermanager.teleport.core;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * In-memory teleport-request state. Bukkit invokes commands and the cleanup task on its main
 * thread, but the methods are synchronized so the state remains safe if an integration calls it
 * from another thread in the future.
 */
public final class RequestBook {
    public static final long MIN_EXPIRY_MILLIS = 5_000L;
    public static final long MAX_EXPIRY_MILLIS = 300_000L;
    public static final long MAX_COOLDOWN_MILLIS = 300_000L;
    public static final int MAX_INCOMING_LIMIT = 32;

    private final Clock clock;
    private final Map<UUID, TeleportRequest> outgoing = new LinkedHashMap<>();
    private final Map<UUID, LinkedHashMap<UUID, TeleportRequest>> incoming = new LinkedHashMap<>();
    private final Map<UUID, Long> cooldownUntil = new LinkedHashMap<>();
    private long expiryMillis;
    private long cooldownMillis;
    private int maxIncoming;

    public RequestBook(Clock clock, long expiryMillis, long cooldownMillis, int maxIncoming) {
        this.clock = Objects.requireNonNull(clock, "clock");
        configure(expiryMillis, cooldownMillis, maxIncoming);
    }

    public synchronized void configure(long expiryMillis, long cooldownMillis, int maxIncoming) {
        if (expiryMillis < MIN_EXPIRY_MILLIS || expiryMillis > MAX_EXPIRY_MILLIS) {
            throw new IllegalArgumentException("expiry must be between 5 and 300 seconds");
        }
        if (cooldownMillis < 0L || cooldownMillis > MAX_COOLDOWN_MILLIS) {
            throw new IllegalArgumentException("cooldown must be between 0 and 300 seconds");
        }
        if (maxIncoming < 1 || maxIncoming > MAX_INCOMING_LIMIT) {
            throw new IllegalArgumentException("incoming limit must be between 1 and 32");
        }
        this.expiryMillis = expiryMillis;
        this.cooldownMillis = cooldownMillis;
        this.maxIncoming = maxIncoming;
    }

    public synchronized RequestOutcome create(
            UUID requesterId,
            String requesterName,
            UUID targetId,
            String targetName,
            boolean bypassCooldown
    ) {
        Objects.requireNonNull(requesterId, "requesterId");
        Objects.requireNonNull(targetId, "targetId");
        if (requesterId.equals(targetId)) return RequestOutcome.of(RequestOutcome.Status.SELF_TARGET);

        long now = clock.nowMillis();
        TeleportRequest existing = outgoing.get(requesterId);
        if (existing != null && existing.isExpired(now)) remove(existing);
        if (outgoing.containsKey(requesterId)) {
            return RequestOutcome.of(RequestOutcome.Status.OUTGOING_EXISTS, outgoing.get(requesterId));
        }

        if (!bypassCooldown) {
            long until = cooldownUntil.getOrDefault(requesterId, 0L);
            if (until > now) return RequestOutcome.cooldown(until - now);
            cooldownUntil.remove(requesterId);
        }

        LinkedHashMap<UUID, TeleportRequest> targetRequests = incoming.computeIfAbsent(
                targetId, ignored -> new LinkedHashMap<>());
        removeExpiredFromTarget(targetRequests, now);
        targetRequests = incoming.computeIfAbsent(targetId, ignored -> new LinkedHashMap<>());
        if (targetRequests.size() >= maxIncoming) {
            if (targetRequests.isEmpty()) incoming.remove(targetId);
            return RequestOutcome.of(RequestOutcome.Status.TARGET_LIMIT);
        }

        long expiresAt;
        try {
            expiresAt = Math.addExact(now, expiryMillis);
        } catch (ArithmeticException overflow) {
            expiresAt = Long.MAX_VALUE;
        }
        TeleportRequest request = new TeleportRequest(
                requesterId, requesterName, targetId, targetName, now, expiresAt);
        outgoing.put(requesterId, request);
        targetRequests.put(requesterId, request);
        if (!bypassCooldown && cooldownMillis > 0L) {
            cooldownUntil.put(requesterId, safeAdd(now, cooldownMillis));
        }
        return RequestOutcome.of(RequestOutcome.Status.CREATED, request);
    }

    /**
     * Accept or deny a request. A blank requester name selects the request only when there is one
     * unambiguous incoming request.
     */
    public synchronized RequestOutcome respond(UUID targetId, String requesterName, boolean accept) {
        Objects.requireNonNull(targetId, "targetId");
        LinkedHashMap<UUID, TeleportRequest> targetRequests = incoming.get(targetId);
        if (targetRequests == null || targetRequests.isEmpty()) return RequestOutcome.of(RequestOutcome.Status.NONE);
        removeExpiredFromTarget(targetRequests, clock.nowMillis());
        if (targetRequests.isEmpty()) {
            incoming.remove(targetId);
            return RequestOutcome.of(RequestOutcome.Status.NONE);
        }

        String selectedName = requesterName == null ? "" : requesterName.strip();
        TeleportRequest selected = null;
        if (selectedName.isEmpty()) {
            if (targetRequests.size() > 1) {
                return RequestOutcome.ambiguous(sorted(targetRequests.values()));
            }
            selected = targetRequests.values().iterator().next();
        } else {
            for (TeleportRequest request : targetRequests.values()) {
                if (request.requesterName().equalsIgnoreCase(selectedName)) {
                    selected = request;
                    break;
                }
            }
        }
        if (selected == null) return RequestOutcome.of(RequestOutcome.Status.NONE);
        remove(selected);
        return RequestOutcome.of(accept ? RequestOutcome.Status.ACCEPTED : RequestOutcome.Status.DENIED, selected);
    }

    public synchronized RequestOutcome cancel(UUID requesterId) {
        Objects.requireNonNull(requesterId, "requesterId");
        TeleportRequest request = outgoing.get(requesterId);
        if (request == null) return RequestOutcome.of(RequestOutcome.Status.NONE);
        remove(request);
        return RequestOutcome.of(RequestOutcome.Status.CANCELLED, request);
    }

    public synchronized List<TeleportRequest> expire() {
        long now = clock.nowMillis();
        List<TeleportRequest> expired = outgoing.values().stream()
                .filter(request -> request.isExpired(now))
                .sorted(Comparator.comparingLong(TeleportRequest::createdAtMillis))
                .toList();
        expired.forEach(this::remove);
        cooldownUntil.entrySet().removeIf(entry -> entry.getValue() <= now);
        return List.copyOf(expired);
    }

    /** Remove every request where the player is either participant. */
    public synchronized List<TeleportRequest> removePlayer(UUID playerId) {
        Objects.requireNonNull(playerId, "playerId");
        Set<TeleportRequest> removed = new LinkedHashSet<>();
        TeleportRequest sent = outgoing.get(playerId);
        if (sent != null) removed.add(sent);
        LinkedHashMap<UUID, TeleportRequest> received = incoming.get(playerId);
        if (received != null) removed.addAll(received.values());
        removed.forEach(this::remove);
        cooldownUntil.remove(playerId);
        return List.copyOf(removed);
    }

    public synchronized List<TeleportRequest> incomingFor(UUID targetId) {
        LinkedHashMap<UUID, TeleportRequest> requests = incoming.get(targetId);
        return requests == null ? List.of() : List.copyOf(sorted(requests.values()));
    }

    public synchronized TeleportRequest outgoingFor(UUID requesterId) {
        return outgoing.get(requesterId);
    }

    public synchronized int size() {
        return outgoing.size();
    }

    public synchronized void clear() {
        outgoing.clear();
        incoming.clear();
        cooldownUntil.clear();
    }

    private void removeExpiredFromTarget(Map<UUID, TeleportRequest> targetRequests, long now) {
        List<TeleportRequest> expired = targetRequests.values().stream()
                .filter(request -> request.isExpired(now))
                .toList();
        expired.forEach(this::remove);
    }

    private void remove(TeleportRequest request) {
        outgoing.remove(request.requesterId(), request);
        LinkedHashMap<UUID, TeleportRequest> targetRequests = incoming.get(request.targetId());
        if (targetRequests != null) {
            targetRequests.remove(request.requesterId(), request);
            if (targetRequests.isEmpty()) incoming.remove(request.targetId());
        }
    }

    private static List<TeleportRequest> sorted(Iterable<TeleportRequest> requests) {
        List<TeleportRequest> result = new ArrayList<>();
        requests.forEach(result::add);
        result.sort(Comparator.comparing(request -> request.requesterName().toLowerCase(Locale.ROOT)));
        return result;
    }

    private static long safeAdd(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException overflow) {
            return Long.MAX_VALUE;
        }
    }
}
