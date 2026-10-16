package com.clickinterval.economyguard.mixin;

import net.minecraft.world.Container;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.level.block.entity.HopperBlockEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Portal/unload sources are no longer authoritative inventory. */
@Mixin(HopperBlockEntity.class)
abstract class HopperItemGuardMixin {
    @Inject(method = "addItem(Lnet/minecraft/world/Container;Lnet/minecraft/world/entity/item/ItemEntity;)Z",
            at = @At("HEAD"), cancellable = true)
    private static void economyGuard$rejectStaleItem(Container destination, ItemEntity item, CallbackInfoReturnable<Boolean> cir) {
        if (item.isRemoved()) cir.setReturnValue(false);
    }
}
