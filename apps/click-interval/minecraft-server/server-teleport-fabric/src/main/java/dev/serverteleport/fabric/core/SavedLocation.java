package dev.serverteleport.fabric.core;

import java.util.Objects;
import java.util.regex.Pattern;

/** A validated, immutable player-owned teleport destination. */
public record SavedLocation(
        String dimension,
        double x,
        double y,
        double z,
        float yaw,
        float pitch
) {
    public static final double MAX_HORIZONTAL_COORDINATE = 30_000_000.0;
    public static final double MAX_VERTICAL_COORDINATE = 20_000_000.0;
    private static final int MAX_DIMENSION_LENGTH = 256;
    private static final Pattern DIMENSION = Pattern.compile(
            "[a-z0-9._-]{1,64}:[a-z0-9/._-]{1,191}");

    public SavedLocation {
        dimension = Objects.requireNonNull(dimension, "dimension").strip();
        if (dimension.length() > MAX_DIMENSION_LENGTH || !DIMENSION.matcher(dimension).matches()) {
            throw new IllegalArgumentException("invalid dimension identifier");
        }
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || Math.abs(x) > MAX_HORIZONTAL_COORDINATE
                || Math.abs(y) > MAX_VERTICAL_COORDINATE
                || Math.abs(z) > MAX_HORIZONTAL_COORDINATE) {
            throw new IllegalArgumentException("invalid location coordinates");
        }
        if (!Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            throw new IllegalArgumentException("invalid location rotation");
        }
    }
}
