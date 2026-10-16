package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.EnderEyeItem;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.world.level.block.Blocks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(EnderEyeItem.class)
public abstract class EnderEyeMixin {
    @Inject(method = "useOn", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$frame(UseOnContext context, CallbackInfoReturnable<InteractionResult> callback) {
        if (ServerEndLock.blocksFrames(context.getLevel()) && context.getLevel().getBlockState(context.getClickedPos()).is(Blocks.END_PORTAL_FRAME)) {
            ServerEndLock.notifyBlocked(context.getPlayer(), com.clickinterval.endlock.EndLockState.Domain.END);
            callback.setReturnValue(InteractionResult.FAIL);
        }
    }
}
