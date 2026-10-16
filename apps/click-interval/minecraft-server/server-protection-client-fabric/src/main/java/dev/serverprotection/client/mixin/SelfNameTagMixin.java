package dev.serverprotection.client.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import dev.serverprotection.client.IrisShadowPass;
import dev.serverprotection.client.SelfNameTagClient;
import dev.serverprotection.client.SelfNameTagPolicy;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

/** Leaves native name content, attachments, depth, distance, HUD and avatar rendering intact. */
@Mixin(LivingEntityRenderer.class)
public abstract class SelfNameTagMixin {
    @ModifyExpressionValue(method = "shouldShowName(Lnet/minecraft/world/entity/LivingEntity;D)Z",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Minecraft;getCameraEntity()Lnet/minecraft/world/entity/Entity;"))
    private Entity serverProtection$allowOwnThirdPersonName(Entity cameraEntity, LivingEntity entity, double distanceSquared) {
        Minecraft client = Minecraft.getInstance();
        // Remote entities and alternative camera targets always receive the exact original result.
        if (entity != client.player || cameraEntity != entity) return cameraEntity;
        var team = entity.getTeam();
        return SelfNameTagPolicy.allowCameraBypass(SelfNameTagClient.enabled(), true, true,
                !client.options.getCameraType().isFirstPerson(), entity.isInvisible(), client.player.isSpectator(),
                IrisShadowPass.isActive(), team == null ? null : team.getNameTagVisibility()) ? null : cameraEntity;
    }
}
