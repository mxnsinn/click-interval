package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Covers fall, void, lava and ordinary damage before the first evacuation tick after login. */
@Mixin(value = ServerPlayer.class, priority = 2000)
public abstract class EvacuationProtectionMixin {
    @Inject(method = "hurtServer", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$protectTransfer(ServerLevel level, DamageSource source, float damage, CallbackInfoReturnable<Boolean> callback) {
        if (ServerEndLock.protectedDuringEvacuation((ServerPlayer) (Object) this)) callback.setReturnValue(false);
    }
}
