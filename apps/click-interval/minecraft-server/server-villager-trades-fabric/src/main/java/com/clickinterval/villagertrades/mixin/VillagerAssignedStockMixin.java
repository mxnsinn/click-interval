package com.clickinterval.villagertrades.mixin;

import com.clickinterval.villagertrades.UnlimitedOffer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.item.trading.MerchantOffers;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Villager.class)
public abstract class VillagerAssignedStockMixin {
    @Inject(method = "setOffers", at = @At("TAIL"))
    private void clickInterval$unlockAssignedOffers(MerchantOffers offers, CallbackInfo callback) {
        // Includes decoded exhausted lists and lists assigned by the original Trade Cycling mod.
        // Availability must not erase uses, demand, discounts, or evidence of a completed trade.
        if (offers == null || !(((Villager) (Object) this).level() instanceof ServerLevel)) return;
        for (var offer : offers) ((UnlimitedOffer) offer).clickInterval$setUnlimited(true);
    }
}
