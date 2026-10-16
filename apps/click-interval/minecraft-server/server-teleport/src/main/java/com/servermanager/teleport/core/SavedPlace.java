package com.servermanager.teleport.core;

import java.util.Objects;
import java.util.UUID;

/** A server-independent snapshot of an exact player location. */
public record SavedPlace(
        UUID worldId,
        String worldName,
        double x,
        double y,
        double z,
        float yaw,
        float pitch
) {
    public static final double MAX_ABSOLUTE_COORDINATE = 30_000_000.0D;
    public static final int MAX_WORLD_NAME_LENGTH = 128;

    public SavedPlace {
        worldId = Objects.requireNonNull(worldId, "worldId");
        worldName = cleanWorldName(worldName);
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || Math.abs(x) > MAX_ABSOLUTE_COORDINATE
                || Math.abs(y) > MAX_ABSOLUTE_COORDINATE
                || Math.abs(z) > MAX_ABSOLUTE_COORDINATE) {
            throw new IllegalArgumentException("saved coordinates are not finite or are outside the hard world limit");
        }
        if (!Float.isFinite(yaw) || !Float.isFinite(pitch) || pitch < -90.0F || pitch > 90.0F) {
            throw new IllegalArgumentException("saved rotation is invalid");
        }
    }

    private static String cleanWorldName(String value) {
        String clean = value == null ? "" : value.strip();
        if (clean.isEmpty() || clean.length() > MAX_WORLD_NAME_LENGTH) {
            throw new IllegalArgumentException("worldName is missing or too long");
        }
        for (int index = 0; index < clean.length(); index++) {
            if (Character.isISOControl(clean.charAt(index))) {
                throw new IllegalArgumentException("worldName contains control characters");
            }
        }
        return clean;
    }
}
