package dev.servertradeassistant.fabric.mixin;

import dev.servertradeassistant.fabric.ServerTradeAssistantRuntime;
import dev.servertradeassistant.fabric.core.TradePricing;
import dev.servertradeassistant.fabric.core.VillagerTradeState;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.gen.Invoker;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.IdentityHashMap;
import java.util.Map;

@Mixin(Villager.class)
public abstract class VillagerMixin implements VillagerTradeState {
    @Unique private static final String REROLL_COUNT_KEY = "TradeAssistantRerolls";
    @Unique private static final String PROFESSION_KEY = "TradeAssistantProfession";
    @Unique private int tradeAssistant$rerollCount;
    @Unique private String tradeAssistant$professionId = "";
    @Unique private final Map<MerchantOffer, Integer> tradeAssistant$roleDeltas = new IdentityHashMap<>();
    @Unique private boolean tradeAssistant$discountSuspended;

    @Invoker("updateTrades")
    public abstract void tradeAssistant$regenerateTrades(ServerLevel level);

    @Invoker("updateSpecialPrices")
    public abstract void tradeAssistant$applyVanillaPrices(Player player);

    @Override
    public int tradeAssistant$rerollCount() {
        return tradeAssistant$rerollCount;
    }

    @Override
    public void tradeAssistant$prepareProfession(String professionId) {
        String clean = String.valueOf(professionId == null ? "" : professionId);
        if (!clean.equals(tradeAssistant$professionId)) {
            tradeAssistant$professionId = clean;
            tradeAssistant$rerollCount = 0;
        }
    }

    @Override
    public int tradeAssistant$incrementRerollCount() {
        if (tradeAssistant$rerollCount < 1_000_000) tradeAssistant$rerollCount++;
        return tradeAssistant$rerollCount;
    }

    @Override
    public void tradeAssistant$applyRoleDiscount(int percent) {
        tradeAssistant$removeRoleDiscount();
        int discount = TradePricing.clampDiscountPercent(percent);
        if (discount == 0) return;
        Villager villager = (Villager) (Object) this;
        for (MerchantOffer offer : villager.getOffers()) {
            int currentCost = offer.getCostA().getCount();
            int delta = TradePricing.discountDelta(currentCost, discount);
            if (delta == 0) continue;
            offer.setSpecialPriceDiff(offer.getSpecialPriceDiff() + delta);
            tradeAssistant$roleDeltas.put(offer, delta);
        }
    }

    @Override
    public void tradeAssistant$removeRoleDiscount() {
        if (tradeAssistant$discountSuspended) {
            tradeAssistant$roleDeltas.clear();
            tradeAssistant$discountSuspended = false;
            return;
        }
        for (Map.Entry<MerchantOffer, Integer> entry : tradeAssistant$roleDeltas.entrySet()) {
            MerchantOffer offer = entry.getKey();
            offer.setSpecialPriceDiff(offer.getSpecialPriceDiff() - entry.getValue());
        }
        tradeAssistant$roleDeltas.clear();
    }

    @Unique
    private void tradeAssistant$suspendRoleDiscount() {
        if (tradeAssistant$discountSuspended || tradeAssistant$roleDeltas.isEmpty()) return;
        for (Map.Entry<MerchantOffer, Integer> entry : tradeAssistant$roleDeltas.entrySet()) {
            MerchantOffer offer = entry.getKey();
            offer.setSpecialPriceDiff(offer.getSpecialPriceDiff() - entry.getValue());
        }
        tradeAssistant$discountSuspended = true;
    }

    @Unique
    private void tradeAssistant$resumeRoleDiscount() {
        if (!tradeAssistant$discountSuspended) return;
        for (Map.Entry<MerchantOffer, Integer> entry : tradeAssistant$roleDeltas.entrySet()) {
            MerchantOffer offer = entry.getKey();
            offer.setSpecialPriceDiff(offer.getSpecialPriceDiff() + entry.getValue());
        }
        tradeAssistant$discountSuspended = false;
    }

    @Inject(method = "startTrading", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/entity/npc/villager/Villager;setTradingPlayer(Lnet/minecraft/world/entity/player/Player;)V",
            shift = At.Shift.BEFORE))
    private void tradeAssistant$applySessionDiscount(Player player, CallbackInfo callback) {
        ServerTradeAssistantRuntime.active().applySessionDiscount((Villager) (Object) this, player);
    }

    @Inject(method = "stopTrading", at = @At("TAIL"))
    private void tradeAssistant$clearSessionDiscount(CallbackInfo callback) {
        // Vanilla has just reset special prices to zero, so only discard our bookkeeping.
        tradeAssistant$roleDeltas.clear();
        tradeAssistant$discountSuspended = false;
    }

    @Inject(method = "addAdditionalSaveData", at = @At("HEAD"))
    private void tradeAssistant$beforeSave(ValueOutput output, CallbackInfo callback) {
        // Never serialize the player-scoped role modifier into the villager's shared offers.
        tradeAssistant$suspendRoleDiscount();
    }

    @Inject(method = "addAdditionalSaveData", at = @At("TAIL"))
    private void tradeAssistant$afterSave(ValueOutput output, CallbackInfo callback) {
        output.putInt(REROLL_COUNT_KEY, Math.max(0, tradeAssistant$rerollCount));
        if (!tradeAssistant$professionId.isEmpty()) output.putString(PROFESSION_KEY, tradeAssistant$professionId);
        tradeAssistant$resumeRoleDiscount();
    }

    @Inject(method = "readAdditionalSaveData", at = @At("TAIL"))
    private void tradeAssistant$afterLoad(ValueInput input, CallbackInfo callback) {
        tradeAssistant$rerollCount = Math.max(0, input.getIntOr(REROLL_COUNT_KEY, 0));
        tradeAssistant$professionId = input.getStringOr(PROFESSION_KEY, "");
        tradeAssistant$roleDeltas.clear();
        tradeAssistant$discountSuspended = false;
    }
}
