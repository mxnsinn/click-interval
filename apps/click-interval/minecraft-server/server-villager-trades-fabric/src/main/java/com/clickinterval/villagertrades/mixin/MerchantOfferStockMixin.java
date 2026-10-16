package com.clickinterval.villagertrades.mixin;

import com.clickinterval.villagertrades.StockPolicy;
import com.clickinterval.villagertrades.UnlimitedOffer;
import net.minecraft.world.item.trading.MerchantOffer;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(MerchantOffer.class)
public abstract class MerchantOfferStockMixin implements UnlimitedOffer {
    @Shadow private int uses;
    @Shadow @Final private int maxUses;
    @Unique private boolean clickInterval$unlimited;

    @Override
    public void clickInterval$setUnlimited(boolean unlimited) { clickInterval$unlimited = unlimited; }

    @Override
    public boolean clickInterval$isUnlimited() { return clickInterval$unlimited; }

    @Inject(method = "isOutOfStock", at = @At("HEAD"), cancellable = true)
    private void clickInterval$allowPaidVillagerTrades(CallbackInfoReturnable<Boolean> callback) {
        if (clickInterval$unlimited) callback.setReturnValue(false);
    }

    @Inject(method = "increaseUses", at = @At("HEAD"), cancellable = true)
    private void clickInterval$boundDemandCounter(CallbackInfo callback) {
        if (!clickInterval$unlimited) return;
        uses = StockPolicy.nextUses(uses, maxUses);
        callback.cancel();
    }

    @Inject(method = "copy", at = @At("RETURN"))
    private void clickInterval$copyStockPolicy(CallbackInfoReturnable<MerchantOffer> callback) {
        ((UnlimitedOffer) callback.getReturnValue()).clickInterval$setUnlimited(clickInterval$unlimited);
    }

    @Redirect(method = "writeToStream", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/item/trading/MerchantOffer;getMaxUses()I"))
    private static int clickInterval$encodeAvailableClientStock(MerchantOffer offer) {
        return ((UnlimitedOffer) offer).clickInterval$isUnlimited() ? Integer.MAX_VALUE : offer.getMaxUses();
    }

    @Redirect(method = "writeToStream", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/item/trading/MerchantOffer;getUses()I"))
    private static int clickInterval$encodeClientUses(MerchantOffer offer) {
        return ((UnlimitedOffer) offer).clickInterval$isUnlimited()
                ? StockPolicy.clientUses(offer.getUses()) : offer.getUses();
    }
}
