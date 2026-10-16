package dev.proximityvoice.core;

import java.util.Objects;
import java.util.UUID;

public record PlayerSnapshot(
        UUID playerId,
        String worldId,
        double x,
        double y,
        double z,
        boolean voiceEnabled
) {
    public PlayerSnapshot {
        Objects.requireNonNull(playerId, "playerId");
        worldId = String.valueOf(worldId == null ? "" : worldId).trim();
        if (worldId.isEmpty()) throw new IllegalArgumentException("worldId is required");
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
            throw new IllegalArgumentException("coordinates must be finite");
        }
    }
}
