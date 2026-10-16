package com.clickinterval.villagertrades.mixin;

import com.clickinterval.villagertrades.CyclePolicy;
import com.clickinterval.villagertrades.CycleState;
import net.minecraft.world.entity.npc.villager.Villager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import net.minecraft.world.item.trading.MerchantOffers;
import net.minecraft.server.level.ServerLevel;
import com.clickinterval.villagertrades.UnlimitedOffer;

@Mixin(Villager.class)
public abstract class VillagerCyclingMixin implements CycleState {
    @Unique private long clickInterval$lastCycle = Long.MIN_VALUE;

    @Inject(method = "setOffers", at = @At("TAIL"))
    private void clickInterval$unlockAssignedOffers(MerchantOffers offers, CallbackInfo callback) {
        // Existing exhausted/decoded lists can also be assigned directly by other mods.
        // Apply availability immediately without resetting usage, demand, discounts or villager XP.
        if (offers == null || !(((Villager) (Object) this).level() instanceof ServerLevel)) return;
        for (var offer : offers) ((UnlimitedOffer) offer).clickInterval$setUnlimited(true);
    }

    @Override public boolean clickInterval$acquireCycle(long now) {
        if (!CyclePolicy.cooldownReady(clickInterval$lastCycle, now)) return false;
        clickInterval$lastCycle = now;
        return true;
    }

}
