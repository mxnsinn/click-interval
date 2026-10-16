package dev.serverteleport.fabric.core;

/** Normal TPA may cross valid dimensions; random travel chooses its origin separately. */
public final class TeleportDimensionPolicy {
    private TeleportDimensionPolicy() { }
    public static boolean allows(String origin, String destination) {
        return origin != null && !origin.isBlank() && destination != null && !destination.isBlank();
    }
}
