package com.clickinterval.villagertrades.mixin;

import com.clickinterval.villagertrades.OriginalTradeGuard;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Optional: the upstream JAR and its trade_cycling:cycle_trades protocol remain unchanged. */
@Pseudo
@Mixin(targets = "de.maxhenkel.tradecycling.TradeCyclingMod", remap = false)
public abstract class OriginalTradeCyclingGuardMixin {
    @Inject(method = "onCycleTrades(Lnet/minecraft/server/level/ServerPlayer;)V", at = @At("HEAD"), cancellable = true, remap = false)
    private static void clickInterval$guardOriginalCycle(ServerPlayer player, CallbackInfo callback) {
        if (!OriginalTradeGuard.allow(player)) callback.cancel();
    }

    @Inject(method = "onCycleTrades(Lnet/minecraft/server/level/ServerPlayer;)V", at = @At("TAIL"), remap = false)
    private static void clickInterval$syncOriginalCycle(ServerPlayer player, CallbackInfo callback) {
        OriginalTradeGuard.synchronizeResult(player);
    }
}
