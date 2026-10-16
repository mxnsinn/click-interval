package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Covers direct health setters and kill-removal in addition to ordinary damage. Never interferes with logout removal. */
@Mixin(value = LivingEntity.class, priority = 2000)
public abstract class LivingEntityMixin {
    @Shadow protected boolean dead;
    @ModifyVariable(method = "setHealth", at = @At("HEAD"), argsOnly = true)
    private float lobby$keepHealth(float requested) {
        if ((Object) this instanceof ServerPlayer player && LobbyPreviewGuard.active(player.level())
                && (!Float.isFinite(requested) || requested <= 0 || requested < player.getHealth())) {
            dead = false;
            return player.getMaxHealth();
        }
        return requested;
    }
    @Inject(method = "remove", at = @At("HEAD"), cancellable = true)
    private void lobby$noKilledRemoval(Entity.RemovalReason reason, CallbackInfo ci) {
        if (reason == Entity.RemovalReason.KILLED && (Object) this instanceof ServerPlayer player && LobbyPreviewGuard.active(player.level())) {
            dead = false;
            player.deathTime = 0;
            player.setHealth(player.getMaxHealth());
            ci.cancel();
        }
    }
}
