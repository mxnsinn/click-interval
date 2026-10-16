package dev.serverteleport.fabric.mixin;

import dev.serverteleport.fabric.ServerTeleportFabric;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerGamePacketListenerImpl.class)
abstract class ArrivalConnectionMixin {
    @Shadow public ServerPlayer player;
    @Shadow private Vec3 awaitingPositionFromClient;

    // Run only after vanilla has switched from the network thread to the server thread.
    // The original teleport ACK is deliberately left untouched: deferring it would prolong
    // vanilla dimension-change invulnerability. This gate restricts movement/interaction only.
    @Inject(method = {"handleMovePlayer", "handleMoveVehicle", "handleInteract"}, at = @At(
            value = "INVOKE", target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverteleport$awaitArrivalTerrain(CallbackInfo callback) {
        if (ServerTeleportFabric.isAwaitingArrival(player)) callback.cancel();
    }

    @Inject(method = "handleAcceptTeleportPacket", at = @At("TAIL"))
    private void serverteleport$arrivalPositionAccepted(CallbackInfo callback) {
        if (awaitingPositionFromClient == null) ServerTeleportFabric.onArrivalPositionAccepted(player);
    }
}
