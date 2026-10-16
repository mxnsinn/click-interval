package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin({CraftingMenu.class, InventoryMenu.class})
public abstract class QuickCraftMixin {
    @Inject(method = "quickMoveStack", at = @At("HEAD"), cancellable = true)
    private void serverEndLock$shiftClick(Player player, int slot, CallbackInfoReturnable<ItemStack> callback) {
        if (slot == 0 && ServerEndLock.blocksEyes(player.level())
                && ((AbstractContainerMenu) (Object) this).getSlot(0).getItem().is(Items.ENDER_EYE)) callback.setReturnValue(ItemStack.EMPTY);
    }
}
