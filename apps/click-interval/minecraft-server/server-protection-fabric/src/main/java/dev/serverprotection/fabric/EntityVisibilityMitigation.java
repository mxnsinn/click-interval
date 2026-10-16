package dev.serverprotection.fabric;

/**
 * PvP visibility policy.
 *
 * <p>Server-side entity withholding removes the whole player entity and its nametag from the
 * viewer. It therefore cannot prevent ESP without also creating legitimate wall/distance pop-in.
 * Server Protection keeps vanilla tracking intact and relies on non-visual combat checks such as
 * wall-hit, reach, aim and multi-target analysis instead.</p>
 */
final class EntityVisibilityMitigation {
    private EntityVisibilityMitigation() {}

    static boolean pvpSafeAllowsTracking(boolean configured, boolean occluded, double distanceSquared) {
        return true;
    }
}
