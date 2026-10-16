package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import com.clickinterval.endlock.NetherOriginStore;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.portal.TeleportTransition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value = ServerPlayer.class, priority = 2000)
public abstract class PlayerTeleportMixin {
    @Unique private NetherOriginStore.Origin serverEndLock$pendingOrigin;
    @Inject(method = "teleport(Lnet/minecraft/world/level/portal/TeleportTransition;)Lnet/minecraft/server/level/ServerPlayer;", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$incomingPlayer(TeleportTransition transition, CallbackInfoReturnable<ServerPlayer> callback) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        serverEndLock$pendingOrigin = null;
        if (ServerEndLock.blocksEntry(player, transition.newLevel())) callback.setReturnValue(null);
        else serverEndLock$pendingOrigin = ServerEndLock.captureNetherOrigin(player, transition.newLevel());
    }

    @Inject(method = "teleport(Lnet/minecraft/world/level/portal/TeleportTransition;)Lnet/minecraft/server/level/ServerPlayer;", at = @At("RETURN"))
    private void serverEndLock$rememberSuccessfulEntry(TeleportTransition transition, CallbackInfoReturnable<ServerPlayer> callback) {
        if (callback.getReturnValue() != null) ServerEndLock.completedNetherEntry(callback.getReturnValue(), serverEndLock$pendingOrigin);
        serverEndLock$pendingOrigin = null;
    }
}
