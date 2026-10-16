package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.EndPortalBlock;
import net.minecraft.world.level.portal.TeleportTransition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(EndPortalBlock.class)
public abstract class EndPortalMixin {
    // Abort before vanilla creates/clears an arrival platform in the locked End.
    @Inject(method = "getPortalDestination", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$portal(ServerLevel level, Entity entity, BlockPos pos, CallbackInfoReturnable<TeleportTransition> callback) {
        if (!level.dimension().equals(Level.END) && ServerEndLock.locked(level)) {
            ServerEndLock.notifyBlocked(entity, com.clickinterval.endlock.EndLockState.Domain.END);
            callback.setReturnValue(null);
        }
    }
}
