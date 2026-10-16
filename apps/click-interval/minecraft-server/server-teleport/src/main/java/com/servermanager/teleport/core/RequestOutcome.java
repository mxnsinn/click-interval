package com.servermanager.teleport.core;

import java.util.List;

public record RequestOutcome(
        Status status,
        TeleportRequest request,
        List<TeleportRequest> candidates,
        long retryAfterMillis
) {
    public RequestOutcome {
        if (status == null) throw new IllegalArgumentException("status is required");
        candidates = candidates == null ? List.of() : List.copyOf(candidates);
        retryAfterMillis = Math.max(0L, retryAfterMillis);
    }

    public static RequestOutcome of(Status status) {
        return new RequestOutcome(status, null, List.of(), 0L);
    }

    public static RequestOutcome of(Status status, TeleportRequest request) {
        return new RequestOutcome(status, request, List.of(), 0L);
    }

    public static RequestOutcome ambiguous(List<TeleportRequest> requests) {
        return new RequestOutcome(Status.AMBIGUOUS, null, requests, 0L);
    }

    public static RequestOutcome cooldown(long retryAfterMillis) {
        return new RequestOutcome(Status.COOLDOWN, null, List.of(), retryAfterMillis);
    }

    public enum Status {
        CREATED,
        SELF_TARGET,
        OUTGOING_EXISTS,
        TARGET_LIMIT,
        COOLDOWN,
        NONE,
        AMBIGUOUS,
        ACCEPTED,
        DENIED,
        CANCELLED
    }
}
