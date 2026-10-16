package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.EntityTeleportHistory;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Group;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.function.Predicate;

/** Captures only successful random teleports, including the Enderman paths in 26.2 and 26.3. */
@Mixin(LivingEntity.class)
public abstract class LivingEntityTeleportMixin implements EntityTeleportHistory {
    @Unique private double serverProtection$teleportFromX = Double.NaN;
    @Unique private double serverProtection$teleportFromY = Double.NaN;
    @Unique private double serverProtection$teleportFromZ = Double.NaN;
    @Unique private AABB serverProtection$pendingBounds;
    @Unique private AABB serverProtection$beforeTeleportBounds;
    @Unique private long serverProtection$teleportedAtMillis;

    // Minecraft 26.2 random-teleport signature.
    @Group(name = "serverProtection$randomTeleportHead", min = 1, max = 2)
    @Inject(method = "randomTeleport(DDDZ)Z", at = @At("HEAD"), require = 0)
    private void serverProtection$captureTeleportOrigin26_2(double x, double y, double z, boolean particles,
                                                             CallbackInfoReturnable<Boolean> callback) {
        serverProtection$captureTeleportOrigin();
    }

    @Group(name = "serverProtection$randomTeleportReturn", min = 1, max = 2)
    @Inject(method = "randomTeleport(DDDZ)Z", at = @At("RETURN"), require = 0)
    private void serverProtection$observeTeleport26_2(double x, double y, double z, boolean particles,
                                                       CallbackInfoReturnable<Boolean> callback) {
        serverProtection$observeTeleport(callback);
    }

    // Minecraft 26.3 performs the move in its predicate overload; the TagKey overload delegates here.
    @Group(name = "serverProtection$randomTeleportHead", min = 1, max = 2)
    @Inject(method = "randomTeleport(DDDZLjava/util/function/Predicate;)Z", at = @At("HEAD"), require = 0)
    private void serverProtection$captureTeleportOrigin26_3(double x, double y, double z, boolean particles,
                                                             Predicate<BlockState> allowedState,
                                                             CallbackInfoReturnable<Boolean> callback) {
        serverProtection$captureTeleportOrigin();
    }

    @Group(name = "serverProtection$randomTeleportReturn", min = 1, max = 2)
    @Inject(method = "randomTeleport(DDDZLjava/util/function/Predicate;)Z", at = @At("RETURN"), require = 0)
    private void serverProtection$observeTeleport26_3(double x, double y, double z, boolean particles,
                                                       Predicate<BlockState> allowedState,
                                                       CallbackInfoReturnable<Boolean> callback) {
        serverProtection$observeTeleport(callback);
    }

    @Unique
    private void serverProtection$captureTeleportOrigin() {
        LivingEntity entity = (LivingEntity) (Object) this;
        serverProtection$teleportFromX = entity.getX();
        serverProtection$teleportFromY = entity.getY();
        serverProtection$teleportFromZ = entity.getZ();
        serverProtection$pendingBounds = entity.getBoundingBox();
    }

    @Unique
    private void serverProtection$observeTeleport(CallbackInfoReturnable<Boolean> callback) {
        LivingEntity entity = (LivingEntity) (Object) this;
        if (serverProtection$pendingBounds != null && EntityTeleportHistory.shouldRecordTeleport(
                Boolean.TRUE.equals(callback.getReturnValue()),
                serverProtection$teleportFromX,
                serverProtection$teleportFromY,
                serverProtection$teleportFromZ,
                entity.getX(), entity.getY(), entity.getZ())) {
            serverProtection$beforeTeleportBounds = serverProtection$pendingBounds;
            serverProtection$teleportedAtMillis = System.currentTimeMillis();
        }
        serverProtection$teleportFromX = Double.NaN;
        serverProtection$teleportFromY = Double.NaN;
        serverProtection$teleportFromZ = Double.NaN;
        serverProtection$pendingBounds = null;
    }

    @Override
    public AABB serverProtection$beforeTeleportBounds() {
        return serverProtection$beforeTeleportBounds;
    }

    @Override
    public long serverProtection$teleportedAtMillis() {
        return serverProtection$teleportedAtMillis;
    }
}
