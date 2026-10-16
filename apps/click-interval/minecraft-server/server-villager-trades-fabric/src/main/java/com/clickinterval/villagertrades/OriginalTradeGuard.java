package com.clickinterval.villagertrades;

import com.clickinterval.villagertrades.mixin.MerchantMenuStockAccess;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.inventory.MerchantMenu;
import java.util.Map;
import java.util.WeakHashMap;

/** Optional safety checks around upstream's unchanged server handler, on the server thread only. */
public final class OriginalTradeGuard {
    private static final Map<ServerPlayer, OriginalTradeRateLimit> BUDGETS = new WeakHashMap<>();
    private OriginalTradeGuard() { }

    public static boolean allow(ServerPlayer player) {
        if (player == null || !player.level().getServer().isSameThread()
                || !player.isAlive() || player.isRemoved() || player.isSpectator()
                || !(player.containerMenu instanceof MerchantMenu menu)
                || !(((MerchantMenuStockAccess) menu).clickInterval$stockTrader() instanceof Villager villager)
                || !villager.isAlive() || villager.isRemoved()
                || villager.level() != player.level() || villager.getTradingPlayer() != player
                || !menu.stillValid(player)) return false;
        if (!BUDGETS.computeIfAbsent(player, ignored -> new OriginalTradeRateLimit())
                .acquire(player.level().getServer().getTickCount())) return false;
        // Upstream 1.0.22 checks XP only when there is an active payment/result offer.
        // Empty payment slots must not let a forged packet reroll a previously traded villager.
        return villager.getVillagerXp() == 0 && villager.getVillagerData().level() == 1
                && villager.getOffers().stream().noneMatch(offer -> offer.getUses() > 0);
    }

    public static void synchronizeResult(ServerPlayer player) {
        if (player != null && player.containerMenu instanceof MerchantMenu menu
                && ((MerchantMenuStockAccess) menu).clickInterval$stockTrader() instanceof Villager villager
                && villager.getTradingPlayer() == player) {
            // Upstream recalculates the native result after replacing offers. Send changed native
            // slots immediately, retaining all real payment/cursor stacks and vanilla close behavior.
            menu.broadcastChanges();
        }
    }

    public static void disconnect(ServerPlayer player) { BUDGETS.remove(player); }
    public static void stop() { BUDGETS.clear(); }
}
