package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.ReachCheckMath;

/**
 * Reconciles a recent pre-teleport hitbox with current server geometry. Minecraft's teleport path
 * deliberately updates the entity's old-position fields to the destination, so comparing
 * {@code xOld/yOld/zOld} at attack time cannot identify the first stale packet after a teleport.
 */
final class CombatTargetStability {
    private static final long BASE_GRACE_MILLIS = 750L;
    private static final long MAX_LATENCY_GRACE_MILLIS = 1_250L;

    private CombatTargetStability() { }

    static Selection reconcile(ReachCheckMath.Point eye,
                               ReachCheckMath.Box current,
                               ReachCheckMath.Box beforeTeleport,
                               long teleportedAt,
                               long nowMillis,
                               int pingMillis) {
        if (eye == null || current == null || beforeTeleport == null
                || teleportedAt <= 0L || nowMillis < teleportedAt) {
            return new Selection(current, false, false);
        }
        long latencyGrace = Math.min(MAX_LATENCY_GRACE_MILLIS,
                (long) Math.max(0, pingMillis) * 3L);
        long grace = BASE_GRACE_MILLIS + latencyGrace;
        if (nowMillis - teleportedAt > grace) return new Selection(current, false, false);
        double currentDistance = ReachCheckMath.distanceToBox(eye, current);
        double previousDistance = ReachCheckMath.distanceToBox(eye, beforeTeleport);
        boolean usePrevious = previousDistance < currentDistance;
        return new Selection(usePrevious ? beforeTeleport : current, true, usePrevious);
    }

    record Selection(ReachCheckMath.Box box, boolean recentTeleport, boolean usesPreviousBox) { }
}
