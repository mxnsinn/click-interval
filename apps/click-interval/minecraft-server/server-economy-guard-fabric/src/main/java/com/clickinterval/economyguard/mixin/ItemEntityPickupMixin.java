package com.clickinterval.economyguard.mixin;

import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** A removed (picked-up, unloaded or transferred) entity is no longer an item owner. */
@Mixin(ItemEntity.class)
public abstract class ItemEntityPickupMixin {
    @Inject(method = "playerTouch", at = @At("HEAD"), cancellable = true)
    private void clickInterval$noStalePickup(Player player, CallbackInfo callback) {
        if (((ItemEntity) (Object) this).isRemoved()) callback.cancel();
    }
}
