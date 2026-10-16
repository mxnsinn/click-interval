package dev.proximityvoice.client.audio;

public record SpatialSnapshot(
        double listenerX,
        double listenerY,
        double listenerZ,
        float listenerYaw,
        double sourceX,
        double sourceY,
        double sourceZ,
        boolean sameWorld
) {
    public static SpatialSnapshot unavailable() {
        return new SpatialSnapshot(0, 0, 0, 0, 0, 0, 0, false);
    }
}
