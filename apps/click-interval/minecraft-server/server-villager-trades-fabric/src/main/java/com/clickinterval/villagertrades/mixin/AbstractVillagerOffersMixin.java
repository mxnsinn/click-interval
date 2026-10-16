package com.clickinterval.villagertrades.mixin;

import com.clickinterval.villagertrades.UnlimitedOffer;
import net.minecraft.world.entity.npc.villager.AbstractVillager;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(AbstractVillager.class)
public abstract class AbstractVillagerOffersMixin {
    @Inject(method = "getOffers", at = @At("RETURN"))
    private void clickInterval$applyVillagerStockPolicy(CallbackInfoReturnable<MerchantOffers> callback) {
        boolean unlimited = (Object) this instanceof Villager villager && villager.level() instanceof ServerLevel;
        // Includes persisted offers and new offers created by career leveling or Trade Cycling.
        for (MerchantOffer offer : callback.getReturnValue()) {
            ((UnlimitedOffer) offer).clickInterval$setUnlimited(unlimited);
        }
    }
}
