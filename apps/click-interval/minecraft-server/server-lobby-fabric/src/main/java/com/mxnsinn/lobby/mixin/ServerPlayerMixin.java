package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Relative;
import net.minecraft.world.level.portal.TeleportTransition;
import java.util.Set;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value = ServerPlayer.class, priority = 2000)
public abstract class ServerPlayerMixin {
    @Inject(method = "die", at = @At("HEAD"), cancellable = true)
    private void lobby$noDeath(DamageSource source, CallbackInfo ci) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        if (LobbyPreviewGuard.active(player.level())) {
            player.setHealth(player.getMaxHealth());
            player.deathTime = 0;
            ci.cancel();
        }
    }
    @Inject(method = "teleportTo(Lnet/minecraft/server/level/ServerLevel;DDDLjava/util/Set;FFZ)Z", at = @At("HEAD"), cancellable = true)
    private void lobby$noTeleportEscape(ServerLevel target, double x, double y, double z, Set<Relative> relative, float yaw, float pitch,
                                       boolean resetCamera, CallbackInfoReturnable<Boolean> cir) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        if (LobbyPreviewGuard.deniedTeleport(player, target,
                x + (relative.contains(Relative.X) ? player.getX() : 0),
                y + (relative.contains(Relative.Y) ? player.getY() : 0),
                z + (relative.contains(Relative.Z) ? player.getZ() : 0))) cir.setReturnValue(false);
    }
    @Inject(method = "teleport(Lnet/minecraft/world/level/portal/TeleportTransition;)Lnet/minecraft/server/level/ServerPlayer;", at = @At("HEAD"), cancellable = true)
    private void lobby$noPortalEscape(TeleportTransition transition, CallbackInfoReturnable<ServerPlayer> cir) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        var pos = transition.position();
        if (LobbyPreviewGuard.deniedTeleport(player, transition.newLevel(),
                pos.x + (transition.relatives().contains(Relative.X) ? player.getX() : 0),
                pos.y + (transition.relatives().contains(Relative.Y) ? player.getY() : 0),
                pos.z + (transition.relatives().contains(Relative.Z) ? player.getZ() : 0))) cir.setReturnValue(null);
    }
    @Inject(method = "hurtServer", at = @At("HEAD"), cancellable = true)
    private void lobby$noDamage(ServerLevel world, DamageSource source, float damage, CallbackInfoReturnable<Boolean> cir) {
        if (LobbyPreviewGuard.active(world)) cir.setReturnValue(false);
    }
    @Inject(method = "drop(Z)V", at = @At("HEAD"), cancellable = true)
    private void lobby$noManualDrop(boolean entireStack, CallbackInfo ci) {
        ServerPlayer player = (ServerPlayer) (Object) this;
        if (LobbyPreviewGuard.active(player.level())) {
            player.containerMenu.sendAllDataToRemote();
            ci.cancel();
        }
    }
}
