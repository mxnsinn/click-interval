package com.clickinterval.economyguard.mixin;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.level.portal.TeleportTransition;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Keeps the destination falling block, but never ticks a removed copy into a second block/item. */
@Mixin(FallingBlockEntity.class)
public abstract class FallingBlockPortalMixin {
    @Shadow public boolean forceTickAfterTeleportToDuplicate;

    @Inject(method = "teleport", at = @At("RETURN"))
    private void clickInterval$singlePortalOutcome(TeleportTransition transition,
                                                 CallbackInfoReturnable<Entity> result) {
        // 26.2 deliberately re-enables placement on the removed source after a successful
        // cross-End transfer. Suppress only that extra outcome, not the transfer itself.
        forceTickAfterTeleportToDuplicate = false;
    }
}
