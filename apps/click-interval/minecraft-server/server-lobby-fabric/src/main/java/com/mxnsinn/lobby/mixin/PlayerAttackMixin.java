package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Player.class)
public abstract class PlayerAttackMixin {
    @Inject(method = "attack", at = @At("HEAD"), cancellable = true)
    private void lobby$noAttack(Entity target, CallbackInfo ci) {
        if (LobbyPreviewGuard.active(((Player) (Object) this).level())) ci.cancel();
    }
    @Inject(method = "interactOn", at = @At("HEAD"), cancellable = true)
    private void lobby$noEntityChanges(Entity target, InteractionHand hand, Vec3 hit, CallbackInfoReturnable<InteractionResult> cir) {
        if (LobbyPreviewGuard.active(((Player) (Object) this).level())) cir.setReturnValue(InteractionResult.FAIL);
    }
}
