package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.EndLockState;
import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(CraftingMenu.class)
public abstract class CraftingNoticeMixin {
    @Inject(method = "slotChangedCraftingGrid", at = @At("TAIL"))
    private static void serverEndLock$eyeNotice(AbstractContainerMenu menu, ServerLevel level, Player player,
            CraftingContainer input, ResultContainer result, RecipeHolder<CraftingRecipe> recipe, CallbackInfo callback) {
        if (!ServerEndLock.blocksEyes(level)) return;
        int pearls = 0, powder = 0, occupied = 0;
        for (var item : input.getItems()) if (!item.isEmpty()) {
            occupied++;
            if (item.is(Items.ENDER_PEARL)) pearls++;
            if (item.is(Items.BLAZE_POWDER)) powder++;
        }
        if (occupied == 2 && pearls == 1 && powder == 1) ServerEndLock.notifyBlocked(player, EndLockState.Domain.END);
    }
}
