package dev.serverprotection.fabric;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.vehicle.boat.AbstractBoat;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** A packet-local repair for shallow boat-top bobbing, never a nearby-entity movement exemption. */
public final class BoatHullMovement {
    private static final double EPSILON = 1.0E-7;
    private static final double MAX_HORIZONTAL = 0.4;
    private static final double MAX_VERTICAL = 0.12;

    private BoatHullMovement() {}

    public record Correction(AbstractBoat boat, AABB hull, AABB before, AABB target, Vec3 destination) {}

    /** Both ends must remain on the same real hull; jumping, entering from its side and speed are not covered. */
    static boolean eligibleGeometry(AABB before, AABB target, AABB hull) {
        if (!finite(before) || !finite(target) || !finite(hull)
                || !BoatSupportProbe.supports(before, hull) || !BoatSupportProbe.supports(target, hull)) return false;
        double dx = target.minX - before.minX, dy = target.minY - before.minY, dz = target.minZ - before.minZ;
        return dx * dx + dz * dz <= MAX_HORIZONTAL * MAX_HORIZONTAL + EPSILON
                && Math.abs(dy) <= MAX_VERTICAL + EPSILON
                && Math.abs(before.getXsize() - target.getXsize()) < EPSILON
                && Math.abs(before.getYsize() - target.getYsize()) < EPSILON
                && Math.abs(before.getZsize() - target.getZsize()) < EPSILON;
    }

    public static Correction prepare(ServerPlayer player, Vec3 movement, Vec3 requested) {
        if (player.isPassenger() || player.isSpectator() || player.isCreative() || player.isSleeping()
                || player.isFallFlying() || player.isChangingDimension() || player.noPhysics
                || player.getAbilities().flying || !finite(movement) || !finite(requested)
                || player.position().add(movement).distanceToSqr(requested) > EPSILON * EPSILON) return null;
        AbstractBoat support = BoatSupportProbe.find(player);
        if (support == null) return null;
        AABB before = player.getBoundingBox(), target = before.move(movement), hull = support.getBoundingBox();
        if (!eligibleGeometry(before, target, hull)) return null;
        Correction correction = new Correction(support, hull, before, target, requested);
        return clearSweep(player, correction) ? correction : null;
    }

    /** Called only after the normal move has run, and after vanilla's too-fast check. */
    public static void finishMove(ServerPlayer player, Correction correction) {
        if (correction == null || !clearSweep(player, correction)) return;
        Vec3 residual = correction.destination().subtract(player.position());
        if (!finite(residual) || residual.horizontalDistanceSqr() > MAX_HORIZONTAL * MAX_HORIZONTAL + EPSILON
                || Math.abs(residual.y) > MAX_VERTICAL + EPSILON) return;
        // The entire swept body was checked; the only ignored obstacle is this shallow supporting hull.
        player.setPos(correction.destination());
    }

    public static boolean onlySupportingHull(ServerPlayer player, Correction correction, AABB before,
                                              double x, double y, double z) {
        return correction != null && correction.before().equals(before)
                && correction.destination().distanceToSqr(new Vec3(x, y, z)) < EPSILON * EPSILON
                && eligibleGeometry(correction.before(), correction.target(), correction.hull())
                && clearSweep(player, correction);
    }

    private static boolean clearSweep(ServerPlayer player, Correction correction) {
        AbstractBoat boat = correction.boat();
        if (boat.isRemoved() || !boat.isAlive() || boat.level() != player.level()
                || !boat.canBeCollidedWith(player) || !boat.getBoundingBox().equals(correction.hull())) return false;
        AABB sweep = correction.before().minmax(correction.target()).deflate(EPSILON);
        var level = player.level();
        if (!level.hasChunksAt(BlockPos.containing(sweep.minX, sweep.minY, sweep.minZ),
                BlockPos.containing(sweep.maxX, sweep.maxY, sweep.maxZ))
                || !level.noBlockCollision(player, sweep) || !level.noBorderCollision(player, sweep)) return false;
        // Match vanilla EntityGetter's collidable-entity predicate, excluding only the identified support.
        return level.getEntities(player, sweep.inflate(EPSILON), entity -> entity != boat
                && !entity.isSpectator() && player.canCollideWith(entity)).isEmpty();
    }

    private static boolean finite(Vec3 value) {
        return Double.isFinite(value.x) && Double.isFinite(value.y) && Double.isFinite(value.z);
    }
    private static boolean finite(AABB box) {
        return Double.isFinite(box.minX) && Double.isFinite(box.minY) && Double.isFinite(box.minZ)
                && Double.isFinite(box.maxX) && Double.isFinite(box.maxY) && Double.isFinite(box.maxZ);
    }
}
