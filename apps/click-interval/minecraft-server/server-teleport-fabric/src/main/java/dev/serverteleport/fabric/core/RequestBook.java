package dev.serverteleport.fabric.core;

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
 * Bounded in-memory request state. The Fabric adapter uses it only on the server thread; methods
 * remain synchronized so pure tests and future integrations cannot corrupt its two indexes.
 */
public final class RequestBook {
    public static final long MIN_EXPIRY_MILLIS = 5_000L;
    public static final long MAX_EXPIRY_MILLIS = 300_000L;
    public static final long MAX_COOLDOWN_MILLIS = 300_000L;
    public static final int MAX_INCOMING_LIMIT = 32;
    public static final int MAX_TOTAL_LIMIT = 4_096;

    private final Clock clock;
    private final Map<UUID, TeleportRequest> outgoing = new LinkedHashMap<>();
    private final Map<UUID, LinkedHashMap<UUID, TeleportRequest>> incoming = new LinkedHashMap<>();
    private final Map<UUID, Long> cooldownUntil = new LinkedHashMap<>();
    private final Map<UUID, AcceptanceReservation> reservations = new LinkedHashMap<>();
    private long nextReservationId = 1L;
    private long expiryMillis;
    private long cooldownMillis;
    private int maxIncoming;
    private int maxTotal;

    public RequestBook(Clock clock, long expiryMillis, long cooldownMillis, int maxIncoming, int maxTotal) {
        this.clock = Objects.requireNonNull(clock, "clock");
        configure(expiryMillis, cooldownMillis, maxIncoming, maxTotal);
    }

    public synchronized void configure(long expiryMillis, long cooldownMillis, int maxIncoming, int maxTotal) {
        if (expiryMillis < MIN_EXPIRY_MILLIS || expiryMillis > MAX_EXPIRY_MILLIS) {
            throw new IllegalArgumentException("expiry must be between 5 and 300 seconds");
        }
        if (cooldownMillis < 0L || cooldownMillis > MAX_COOLDOWN_MILLIS) {
            throw new IllegalArgumentException("cooldown must be between 0 and 300 seconds");
        }
        if (maxIncoming < 1 || maxIncoming > MAX_INCOMING_LIMIT) {
            throw new IllegalArgumentException("incoming limit must be between 1 and 32");
        }
        if (maxTotal < 1 || maxTotal > MAX_TOTAL_LIMIT) {
            throw new IllegalArgumentException("total limit must be between 1 and 4096");
        }
        this.expiryMillis = expiryMillis;
        this.cooldownMillis = cooldownMillis;
        this.maxIncoming = maxIncoming;
        this.maxTotal = maxTotal;
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
        // An accepted request owns the outgoing slot until its asynchronous move commits,
        // fails, or is cancelled. Its original request deadline must not revoke that consent
        // while terrain is loading or allow a new command to replace the reservation.
        if (existing != null && existing.isExpired(now)
                && !reservations.containsKey(requesterId)) remove(existing);
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
        if (outgoing.size() >= maxTotal) {
            if (targetRequests.isEmpty()) incoming.remove(targetId);
            return RequestOutcome.of(RequestOutcome.Status.SERVER_LIMIT);
        }

        long expiresAt = safeAdd(now, expiryMillis);
        TeleportRequest request = new TeleportRequest(
                requesterId, requesterName, targetId, targetName, now, expiresAt);
        outgoing.put(requesterId, request);
        targetRequests.put(requesterId, request);
        if (!bypassCooldown && cooldownMillis > 0L) {
            cooldownUntil.put(requesterId, safeAdd(now, cooldownMillis));
        }
        return RequestOutcome.of(RequestOutcome.Status.CREATED, request);
    }

    /** Shared request/random-travel limiter. Failed/cancelled searches do not refund terrain work. */
    public synchronized long remainingCooldownMillis(UUID playerId, boolean bypassCooldown) {
        Objects.requireNonNull(playerId, "playerId");
        return bypassCooldown ? 0L : Math.max(0L, cooldownUntil.getOrDefault(playerId, 0L) - clock.nowMillis());
    }

    public synchronized void startLocalTravelCooldown(UUID playerId, boolean bypassCooldown) {
        Objects.requireNonNull(playerId, "playerId");
        if (!bypassCooldown && cooldownMillis > 0L) {
            cooldownUntil.put(playerId, safeAdd(clock.nowMillis(), cooldownMillis));
        }
    }

    /**
     * A blank requester name succeeds only when the incoming request is unambiguous.
     * Acceptance reserves the request; callers must commit after teleport success, invalidate it
     * after player-driven warmup cancellation, or release it after an operational teleport
     * failure. Denial remains an immediate terminal response.
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
        AcceptanceReservation active = reservations.get(selected.requesterId());
        if (active != null) return RequestOutcome.of(RequestOutcome.Status.BUSY, selected);
        if (accept) {
            AcceptanceReservation reservation = new AcceptanceReservation(
                    allocateReservationId(), selected);
            reservations.put(selected.requesterId(), reservation);
            return RequestOutcome.reserved(reservation);
        }
        remove(selected);
        return RequestOutcome.of(RequestOutcome.Status.DENIED, selected);
    }

    /** Consume a successfully completed acceptance exactly once. */
    public synchronized boolean commit(AcceptanceReservation reservation) {
        return consumeReservation(reservation);
    }

    /**
     * Consume an accepted request whose combat warmup was cancelled. The same consent cannot be
     * accepted again; the requester must create a new TPA request.
     */
    public synchronized boolean invalidate(AcceptanceReservation reservation) {
        return consumeReservation(reservation);
    }

    private boolean consumeReservation(AcceptanceReservation reservation) {
        if (!isActiveReservation(reservation)) return false;
        TeleportRequest request = reservation.request();
        reservations.remove(request.requesterId(), reservation);
        if (outgoing.get(request.requesterId()) != request) return false;
        remove(request);
        return true;
    }

    /**
     * Release a failed acceptance so the same consent can be retried. If it expired while the
     * teleport was being attempted, it is removed instead of being resurrected.
     */
    public synchronized boolean release(AcceptanceReservation reservation) {
        if (!isActiveReservation(reservation)) return false;
        TeleportRequest request = reservation.request();
        reservations.remove(request.requesterId(), reservation);
        if (outgoing.get(request.requesterId()) == request && request.isExpired(clock.nowMillis())) {
            remove(request);
        }
        return true;
    }

    public synchronized RequestOutcome cancel(UUID requesterId) {
        Objects.requireNonNull(requesterId, "requesterId");
        TeleportRequest request = outgoing.get(requesterId);
        if (request == null) return RequestOutcome.of(RequestOutcome.Status.NONE);
        if (reservations.containsKey(requesterId)) {
            return RequestOutcome.of(RequestOutcome.Status.BUSY, request);
        }
        remove(request);
        return RequestOutcome.of(RequestOutcome.Status.CANCELLED, request);
    }

    public synchronized List<TeleportRequest> expire() {
        long now = clock.nowMillis();
        List<TeleportRequest> expired = outgoing.values().stream()
                .filter(request -> !reservations.containsKey(request.requesterId()))
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
        // Keep the short limiter until expiry so reconnecting cannot spam random world generation.
        return List.copyOf(removed);
    }

    /** A real death invalidates prior-life consent and the deceased player's shared travel limiter. */
    public synchronized List<TeleportRequest> removePlayerAfterDeath(UUID playerId) {
        List<TeleportRequest> removed = removePlayer(playerId);
        cooldownUntil.remove(playerId);
        return removed;
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
        reservations.clear();
    }

    private void removeExpiredFromTarget(Map<UUID, TeleportRequest> targetRequests, long now) {
        List<TeleportRequest> expired = targetRequests.values().stream()
                .filter(request -> !reservations.containsKey(request.requesterId()))
                .filter(request -> request.isExpired(now))
                .toList();
        expired.forEach(this::remove);
    }

    private void remove(TeleportRequest request) {
        reservations.remove(request.requesterId());
        outgoing.remove(request.requesterId(), request);
        LinkedHashMap<UUID, TeleportRequest> targetRequests = incoming.get(request.targetId());
        if (targetRequests != null) {
            targetRequests.remove(request.requesterId(), request);
            if (targetRequests.isEmpty()) incoming.remove(request.targetId());
        }
    }

    /** Check immediately before moving; stale/replaced consent must never move a player. */
    public synchronized boolean isActiveReservation(AcceptanceReservation reservation) {
        if (reservation == null) return false;
        AcceptanceReservation active = reservations.get(reservation.request().requesterId());
        return active != null
                && active.id() == reservation.id()
                && active.request() == reservation.request()
                && outgoing.get(reservation.request().requesterId()) == reservation.request();
    }

    private long allocateReservationId() {
        for (int attempts = 0; attempts <= MAX_TOTAL_LIMIT; attempts++) {
            long candidate = nextReservationId;
            nextReservationId = candidate == Long.MAX_VALUE ? 1L : candidate + 1L;
            boolean used = reservations.values().stream()
                    .anyMatch(reservation -> reservation.id() == candidate);
            if (!used) return candidate;
        }
        throw new IllegalStateException("no acceptance reservation id is available");
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
