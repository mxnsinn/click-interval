package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.BoatHullMovement;
import net.minecraft.network.protocol.game.ServerboundMovePlayerPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.level.LevelReader;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Leaves packet validity, speed, block collision and non-boat movement on the vanilla paths. */
@Mixin(ServerGamePacketListenerImpl.class)
abstract class BoatHullMovementMixin {
    @Shadow public ServerPlayer player;
    @Unique private BoatHullMovement.Correction serverProtection$hullCorrection;

    @Inject(method = "handleMovePlayer", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER))
    private void serverProtection$clearHullCorrection(ServerboundMovePlayerPacket packet, CallbackInfo callback) {
        serverProtection$hullCorrection = null;
    }

    @Redirect(method = "handleMovePlayer", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/server/level/ServerPlayer;move(Lnet/minecraft/world/entity/MoverType;Lnet/minecraft/world/phys/Vec3;)V"))
    private void serverProtection$moveOnHull(ServerPlayer moved, MoverType type, Vec3 movement,
                                             ServerboundMovePlayerPacket packet) {
        Vec3 target = new Vec3(packet.getX(moved.getX()), packet.getY(moved.getY()), packet.getZ(moved.getZ()));
        serverProtection$hullCorrection = type == MoverType.PLAYER && packet.hasPosition()
                ? BoatHullMovement.prepare(moved, movement, target) : null;
        moved.move(type, movement);
        BoatHullMovement.finishMove(moved, serverProtection$hullCorrection);
    }

    @Inject(method = "isEntityCollidingWithAnythingNew", at = @At("RETURN"), cancellable = true)
    private void serverProtection$retainEveryCollisionExceptSupport(LevelReader level, Entity entity,
            AABB before, double x, double y, double z, CallbackInfoReturnable<Boolean> callback) {
        if (callback.getReturnValueZ() && entity == player
                && BoatHullMovement.onlySupportingHull(player, serverProtection$hullCorrection, before, x, y, z))
            callback.setReturnValue(false);
    }

    @Inject(method = "handleMovePlayer", at = @At("RETURN"))
    private void serverProtection$discardHullCorrection(ServerboundMovePlayerPacket packet, CallbackInfo callback) {
        serverProtection$hullCorrection = null;
    }
}
