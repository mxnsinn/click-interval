package dev.serverprotection.client.mixin;

import dev.serverprotection.client.IrisShadowPass;
import net.minecraft.client.renderer.entity.layers.CapeLayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Lunar's cape renderer cannot submit into Iris's offscreen shadow pass. */
@Mixin(CapeLayer.class)
public abstract class CapeShadowCompatibilityMixin {
    @Inject(method = "submit(Lcom/mojang/blaze3d/vertex/PoseStack;"
            + "Lnet/minecraft/client/renderer/SubmitNodeCollector;I"
            + "Lnet/minecraft/client/renderer/entity/state/AvatarRenderState;FF)V",
            at = @At("HEAD"), cancellable = true)
    private void serverProtection$skipCapeInShadowPass(CallbackInfo callback) {
        // Only cape geometry in the shadow pass is omitted. Normal capes and other shadows remain.
        if (IrisShadowPass.isActive()) callback.cancel();
    }
}
