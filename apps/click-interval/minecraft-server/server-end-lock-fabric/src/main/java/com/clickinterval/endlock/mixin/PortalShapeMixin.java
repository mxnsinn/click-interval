package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.EndLockState;
import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.portal.PortalShape;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PortalShape.class)
public abstract class PortalShapeMixin {
    @Inject(method = "createPortalBlocks", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$netherIgnition(LevelAccessor level, CallbackInfo callback) {
        if (level instanceof ServerLevel serverLevel && !serverLevel.dimension().equals(Level.NETHER)
                && ServerEndLock.locked(serverLevel, EndLockState.Domain.NETHER)) callback.cancel();
    }
}
