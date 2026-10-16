package com.clickinterval.villagertrades;

import com.clickinterval.villagertrades.mixin.VillagerTradingAccess;
import com.clickinterval.villagertrades.network.CycleRequest;
import com.clickinterval.villagertrades.network.CycleStatus;
import net.minecraft.core.GlobalPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.village.poi.PoiTypes;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerProfession;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.trading.MerchantOffers;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Optional client button; native merchant opening, payment slots and closing remain untouched. */
public final class TradeCycling {
    private static final Map<UUID, RequestBudget> REQUESTS = new HashMap<>(); // Server thread, cleared at disconnect.
    private TradeCycling() { }

    public static boolean eligible(Villager villager, Player player) {
        if (!(player instanceof ServerPlayer) || !(villager.level() instanceof ServerLevel level)
                || player.level() != level || !player.isAlive() || player.isSpectator()
                || !villager.isAlive() || villager.isRemoved() || villager.isBaby() || villager.isSleeping()
                || villager.getTradingPlayer() != player || !villager.stillValid(player)) return false;
        // The exact native menu/customer is already checked by process(). Native merchant validity
        // includes its movement tolerance and permits interacting through an opening at body height;
        // an additional eye-to-eye ray or zero-tolerance range would reject a still-valid trade.
        var data = villager.getVillagerData();
        if (data.profession().is(VillagerProfession.NONE) || data.profession().is(VillagerProfession.NITWIT)) return false;
        if (!CyclePolicy.untraded(villager.getVillagerXp(), data.level(),
                villager.getOffers().stream().anyMatch(offer -> offer.getUses() != 0))) return false;
        GlobalPos job = villager.getBrain().getMemory(MemoryModuleType.JOB_SITE).orElse(null);
        if (job == null || !job.dimension().equals(level.dimension()) || !level.hasChunkAt(job.pos())
                || !job.pos().closerThan(villager.blockPosition(), 48.0)) return false;
        return PoiTypes.forState(level.getBlockState(job.pos())).filter(data.profession().value().heldJobSite()).isPresent()
                && !villager.getOffers().isEmpty();
    }

    /** Call only on the server thread. Null means unrelated, replayed or rate-limited input. */
    public static CycleStatus process(ServerPlayer player, CycleRequest request) {
        if (player.hasDisconnected() || request.containerId() < 0 || !(player.containerMenu instanceof MerchantMenu menu)
                || menu.containerId != request.containerId()) return null;
        long now = player.level().getGameTime();
        if (!REQUESTS.computeIfAbsent(player.getUUID(), ignored -> new RequestBudget()).acquire(now)) return null;
        MerchantMenuCycleAccess access = (MerchantMenuCycleAccess) menu;
        if (!(access.clickInterval$merchant() instanceof Villager villager)) return null;
        CycleMenuSession session = access.clickInterval$cycleSession();
        if (!request.cycle()) {
            if (request.nonce() != 0) return null;
            if (session.nonce() == 0) session.capture(villager);
            return status(menu, session, session.matches(villager) && eligible(villager, player));
        }
        if (session.nonce() == 0 || request.nonce() != session.nonce()) return null;
        // Every recognized cycle rotates its token, including safe rejection, releasing client pending state.
        session.rotateNonce();
        boolean canCycle = session.matches(villager) && eligible(villager, player);
        if (!canCycle || !emptyInputs(menu) || !((CycleState) villager).clickInterval$acquireCycle(now))
            return status(menu, session, canCycle);

        MerchantOffers previous = villager.getOffers();
        try {
            villager.setOffers(null);
            if (villager.getOffers().isEmpty()) villager.setOffers(previous);
            else ((VillagerTradingAccess) villager).clickInterval$updateSpecialPrices(player);
        } catch (RuntimeException failure) {
            villager.setOffers(previous);
            ServerVillagerTrades.LOGGER.warn("Could not cycle villager offers; previous offers restored", failure);
        }
        // Keep the same menu; native offers and slot synchronization precede the status response.
        menu.setSelectionHint(0);
        player.sendMerchantOffers(menu.containerId, villager.getOffers(), villager.getVillagerData().level(),
                villager.getVillagerXp(), villager.showProgressBar(), villager.canRestock());
        menu.broadcastChanges();
        session.capture(villager);
        return status(menu, session, eligible(villager, player));
    }
    static boolean emptyInputs(MerchantMenu menu) {
        return menu.getCarried().isEmpty() && menu.getSlot(0).getItem().isEmpty()
                && menu.getSlot(1).getItem().isEmpty() && menu.getSlot(2).getItem().isEmpty();
    }
    private static CycleStatus status(MerchantMenu menu, CycleMenuSession session, boolean eligible) {
        return new CycleStatus(menu.containerId, session.nonce(), eligible);
    }
    public static void disconnect(ServerPlayer player) { REQUESTS.remove(player.getUUID()); }
    public static void stop() { REQUESTS.clear(); }

    static final class RequestBudget {
        private long window = Long.MIN_VALUE;
        private int requests;
        boolean acquire(long tick) {
            if (window == Long.MIN_VALUE || tick < window || tick - window >= 20) { window = tick; requests = 0; }
            if (requests >= 8) return false;
            requests++;
            return true;
        }
    }
}
