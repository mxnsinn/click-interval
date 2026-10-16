package dev.serverprotection.client.mixin;

import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Keep players eligible at Sodium's chunk-occlusion layer; vanilla visibility rules still apply. */
@Pseudo
@Mixin(targets = "net.caffeinemc.mods.sodium.client.render.SodiumWorldRenderer", remap = false)
public abstract class SodiumPlayerVisibilityMixin {
    @Inject(method = "isEntityVisible(Lnet/minecraft/client/renderer/entity/EntityRenderer;"
            + "Lnet/minecraft/world/entity/Entity;)Z", at = @At("HEAD"),
            cancellable = true, require = 0, remap = false)
    private void serverProtection$preservePlayer26_2(EntityRenderer<?, ?> renderer, Entity entity,
                                                   CallbackInfoReturnable<Boolean> callback) {
        serverProtection$preservePlayer(entity, callback);
    }

    @Inject(method = "isEntityVisible(Lnet/minecraft/client/renderer/entity/EntityRenderer;"
            + "Lnet/minecraft/world/entity/Entity;F)Z", at = @At("HEAD"),
            cancellable = true, require = 0, remap = false)
    private void serverProtection$preservePlayer26_3(EntityRenderer<?, ?> renderer, Entity entity,
                                                   float partialTick, CallbackInfoReturnable<Boolean> callback) {
        serverProtection$preservePlayer(entity, callback);
    }

    private static void serverProtection$preservePlayer(Entity entity, CallbackInfoReturnable<Boolean> callback) {
        if (entity instanceof Player) callback.setReturnValue(true);
    }
}
