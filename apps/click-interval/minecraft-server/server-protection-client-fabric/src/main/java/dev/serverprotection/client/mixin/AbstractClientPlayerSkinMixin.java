package dev.serverprotection.client.mixin;

import dev.serverprotection.client.ServerProtectionCompanion;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Uses the viewed player's skin texture for bare first-person arms without changing game mode. */
@Mixin(AbstractClientPlayer.class)
abstract class AbstractClientPlayerSkinMixin {
    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true)
    private void serverprotection$useViewedPlayerSkin(CallbackInfoReturnable<PlayerSkin> callback) {
        if (!((Object) this instanceof LocalPlayer)) return;
        AbstractClientPlayer viewed = ServerProtectionCompanion.viewedPlayerForRender();
        if (viewed != null && viewed != (Object) this) {
            callback.setReturnValue(viewed.getSkin());
        }
    }
}
