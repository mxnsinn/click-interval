package dev.serverteleport.fabric.core;

import java.util.Objects;
import java.util.UUID;

public record TeleportRequest(
        UUID requesterId,
        String requesterName,
        UUID targetId,
        String targetName,
        long createdAtMillis,
        long expiresAtMillis
) {
    public TeleportRequest {
        requesterId = Objects.requireNonNull(requesterId, "requesterId");
        targetId = Objects.requireNonNull(targetId, "targetId");
        requesterName = safeName(requesterName, "requesterName");
        targetName = safeName(targetName, "targetName");
        if (requesterId.equals(targetId)) {
            throw new IllegalArgumentException("requester and target must differ");
        }
        if (createdAtMillis < 0L || expiresAtMillis <= createdAtMillis) {
            throw new IllegalArgumentException("request timestamps are invalid");
        }
    }

    public boolean isExpired(long nowMillis) {
        return nowMillis >= expiresAtMillis;
    }

    private static String safeName(String value, String field) {
        String clean = value == null ? "" : value.strip();
        if (!clean.matches("[A-Za-z0-9_]{1,16}")) {
            throw new IllegalArgumentException(field + " is not a valid player name");
        }
        return clean;
    }
}
