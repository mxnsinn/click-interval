package dev.serverprotection.fabric.mixin;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Minecraft 26.3+ spelling of the two Enderman block-moving goals. */
@Pseudo
@Mixin(targets = {
        "net.minecraft.world.entity.monster.Enderman$EndermanTakeBlockGoal",
        "net.minecraft.world.entity.monster.Enderman$EndermanLeaveBlockGoal"
})
abstract class Enderman26_3BlockGriefingMixin {
    @Inject(method = "canUse", at = @At("HEAD"), cancellable = true)
    private void serverProtection$disableBlockMovement(CallbackInfoReturnable<Boolean> callback) {
        callback.setReturnValue(false);
    }
}
