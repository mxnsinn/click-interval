package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.ServerProtectionFabric;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Gives an active POV viewer spectator-like server physics without changing or synchronizing their
 * actual game mode. Their permissions, inventory, abilities, and client game-mode HUD remain intact.
 */
@Mixin(Player.class)
abstract class ServerPlayerMixin {
    @Inject(method = "isSpectator", at = @At("HEAD"), cancellable = true)
    private void serverProtection$cameraOnlySpectator(CallbackInfoReturnable<Boolean> callback) {
        if ((Object) this instanceof ServerPlayer serverPlayer
                && ServerProtectionFabric.isPlayerViewActive(serverPlayer)) {
            callback.setReturnValue(true);
        }
    }
}
