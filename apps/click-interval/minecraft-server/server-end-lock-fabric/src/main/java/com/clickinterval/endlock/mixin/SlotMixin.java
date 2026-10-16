package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ResultSlot;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.Items;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Slot.class)
public abstract class SlotMixin {
    @Inject(method = "mayPickup", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$stalePickup(Player player, CallbackInfoReturnable<Boolean> callback) {
        Slot slot = (Slot) (Object) this;
        if (slot instanceof ResultSlot && slot.getItem().is(Items.ENDER_EYE) && ServerEndLock.blocksEyes(player.level())) callback.setReturnValue(false);
    }
}
