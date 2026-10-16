package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ResultSlot;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ResultSlot.class)
public abstract class ResultSlotMixin {
    @Shadow @Final private Player player;

    @Inject(method = "remove", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$remove(int count, CallbackInfoReturnable<ItemStack> callback) {
        if (((Slot) (Object) this).getItem().is(Items.ENDER_EYE) && ServerEndLock.blocksEyes(player.level())) callback.setReturnValue(ItemStack.EMPTY);
    }

    @Inject(method = "safeClone", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$clone(Player actor, CallbackInfoReturnable<ItemStack> callback) {
        if (((Slot) (Object) this).getItem().is(Items.ENDER_EYE) && ServerEndLock.blocksEyes(actor.level())) callback.setReturnValue(ItemStack.EMPTY);
    }
}
