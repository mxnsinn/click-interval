package dev.serverprotection.fabric;

import net.minecraft.world.phys.AABB;

/** Mixin-backed, per-entity history for reconciling stale combat packets after a teleport. */
public interface EntityTeleportHistory {
    double MINIMUM_TELEPORT_DISTANCE_SQUARED = 1.0e-8;

    AABB serverProtection$beforeTeleportBounds();

    long serverProtection$teleportedAtMillis();

    static boolean shouldRecordTeleport(boolean successful,
                                        double fromX, double fromY, double fromZ,
                                        double toX, double toY, double toZ) {
        if (!successful || !Double.isFinite(fromX) || !Double.isFinite(fromY) || !Double.isFinite(fromZ)
                || !Double.isFinite(toX) || !Double.isFinite(toY) || !Double.isFinite(toZ)) return false;
        double dx = toX - fromX;
        double dy = toY - fromY;
        double dz = toZ - fromZ;
        return dx * dx + dy * dy + dz * dz >= MINIMUM_TELEPORT_DISTANCE_SQUARED;
    }
}
