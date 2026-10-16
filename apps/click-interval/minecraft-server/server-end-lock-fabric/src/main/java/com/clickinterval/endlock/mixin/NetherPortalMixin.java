package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.EndLockState;
import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.NetherPortalBlock;
import net.minecraft.world.level.portal.TeleportTransition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(NetherPortalBlock.class)
public abstract class NetherPortalMixin {
    @Inject(method = "getPortalDestination", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$netherDestination(ServerLevel level, Entity entity, BlockPos pos, CallbackInfoReturnable<TeleportTransition> callback) {
        if (!level.dimension().equals(Level.NETHER) && ServerEndLock.locked(level, EndLockState.Domain.NETHER)) {
            ServerEndLock.notifyBlocked(entity, EndLockState.Domain.NETHER);
            callback.setReturnValue(null);
        }
    }
}
