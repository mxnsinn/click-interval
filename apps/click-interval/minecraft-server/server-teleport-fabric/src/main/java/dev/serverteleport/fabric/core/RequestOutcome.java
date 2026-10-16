package dev.serverteleport.fabric.core;

import java.util.List;

public record RequestOutcome(
        Status status,
        TeleportRequest request,
        List<TeleportRequest> candidates,
        long retryAfterMillis,
        AcceptanceReservation reservation
) {
    public RequestOutcome {
        if (status == null) throw new IllegalArgumentException("status is required");
        candidates = candidates == null ? List.of() : List.copyOf(candidates);
        retryAfterMillis = Math.max(0L, retryAfterMillis);
        if (status == Status.RESERVED) {
            if (reservation == null || request != reservation.request()) {
                throw new IllegalArgumentException("reserved outcome requires its exact reservation request");
            }
        } else if (reservation != null) {
            throw new IllegalArgumentException("only reserved outcomes may carry a reservation");
        }
    }

    public static RequestOutcome of(Status status) {
        return new RequestOutcome(status, null, List.of(), 0L, null);
    }

    public static RequestOutcome of(Status status, TeleportRequest request) {
        return new RequestOutcome(status, request, List.of(), 0L, null);
    }

    public static RequestOutcome ambiguous(List<TeleportRequest> requests) {
        return new RequestOutcome(Status.AMBIGUOUS, null, requests, 0L, null);
    }

    public static RequestOutcome cooldown(long retryAfterMillis) {
        return new RequestOutcome(Status.COOLDOWN, null, List.of(), retryAfterMillis, null);
    }

    public static RequestOutcome reserved(AcceptanceReservation reservation) {
        return new RequestOutcome(
                Status.RESERVED,
                reservation.request(),
                List.of(),
                0L,
                reservation);
    }

    public enum Status {
        CREATED,
        SELF_TARGET,
        OUTGOING_EXISTS,
        TARGET_LIMIT,
        SERVER_LIMIT,
        COOLDOWN,
        NONE,
        AMBIGUOUS,
        RESERVED,
        BUSY,
        ACCEPTED,
        DENIED,
        CANCELLED
    }
}
