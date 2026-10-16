package dev.serverteleport.fabric.core;

import java.util.Objects;
import java.util.UUID;

/** Player and primary vehicle-root origins captured immediately before a successful TPA. */
public record ReturnPoint(
        SavedLocation playerLocation,
        UUID primaryRootId,
        SavedLocation primaryRootLocation
) {
    public ReturnPoint {
        Objects.requireNonNull(playerLocation, "player location");
        Objects.requireNonNull(primaryRootId, "primary root id");
        Objects.requireNonNull(primaryRootLocation, "primary root location");
        if (!playerLocation.dimension().equals(primaryRootLocation.dimension())) {
            throw new IllegalArgumentException("player and vehicle root must be in the same dimension");
        }
    }
}
