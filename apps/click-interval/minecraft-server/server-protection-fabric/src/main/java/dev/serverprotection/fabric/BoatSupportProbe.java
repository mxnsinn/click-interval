package dev.serverprotection.fabric;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.vehicle.boat.AbstractBoat;
import net.minecraft.world.phys.AABB;

/** Authoritative hull-top contact, never a general nearby-boat exemption. */
final class BoatSupportProbe {
    private static final double FEET_TOLERANCE = 0.12;
    private static final double MINIMUM_OVERLAP = 0.02;

    static AbstractBoat find(ServerPlayer player) {
        AABB playerBox = player.getBoundingBox();
        AABB feet = new AABB(playerBox.minX, playerBox.minY - FEET_TOLERANCE - 0.001,
                playerBox.minZ, playerBox.maxX, playerBox.minY + FEET_TOLERANCE + 0.001, playerBox.maxZ);
        AbstractBoat best = null;
        double nearest = Double.POSITIVE_INFINITY;
        for (AbstractBoat boat : player.level().getEntitiesOfClass(AbstractBoat.class, feet,
                entity -> entity.isAlive() && !entity.isRemoved() && entity.canBeCollidedWith(player))) {
            AABB hull = boat.getBoundingBox();
            if (!supports(playerBox, hull)) continue;
            double distance = Math.abs(playerBox.minY - hull.maxY);
            if (distance < nearest) { best = boat; nearest = distance; }
        }
        return best;
    }

    static boolean supports(AABB player, AABB hull) {
        double gap = player.minY - hull.maxY;
        double overlapX = Math.min(player.maxX, hull.maxX) - Math.max(player.minX, hull.minX);
        double overlapZ = Math.min(player.maxZ, hull.maxZ) - Math.max(player.minZ, hull.minZ);
        return Double.isFinite(gap) && gap >= -FEET_TOLERANCE && gap <= FEET_TOLERANCE
                && Double.isFinite(overlapX) && Double.isFinite(overlapZ)
                && overlapX >= MINIMUM_OVERLAP && overlapZ >= MINIMUM_OVERLAP;
    }

    static boolean collisionFree(ServerPlayer player, AABB probe, AbstractBoat support) {
        if (player.level().noCollision(player, probe)) return true;
        if (support == null || support.isRemoved() || !support.isAlive()
                || !support.canBeCollidedWith(player) || !supports(player.getBoundingBox(), support.getBoundingBox())) return false;
        // A bobbing hull may overlap the bottom few centimeters of the player's body. Ignore only
        // that entity overlap. A solid block anywhere in the original body probe still fails.
        if (player.level().getBlockCollisions(player, probe).iterator().hasNext()) return false;
        double aboveHull = Math.max(probe.minY, support.getBoundingBox().maxY + 0.001);
        if (aboveHull >= probe.maxY) return false;
        return player.level().noCollision(player, new AABB(probe.minX, aboveHull, probe.minZ,
                probe.maxX, probe.maxY, probe.maxZ));
    }
}
