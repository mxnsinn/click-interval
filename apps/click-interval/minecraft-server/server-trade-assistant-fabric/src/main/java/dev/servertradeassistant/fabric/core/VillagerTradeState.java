package dev.servertradeassistant.fabric.core;

import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.player.Player;

/** Methods mixed into Villager without exposing mixin implementation classes to runtime code. */
public interface VillagerTradeState {
    int tradeAssistant$rerollCount();
    void tradeAssistant$prepareProfession(String professionId);
    int tradeAssistant$incrementRerollCount();
    void tradeAssistant$regenerateTrades(ServerLevel level);
    void tradeAssistant$applyVanillaPrices(Player player);
    void tradeAssistant$applyRoleDiscount(int percent);
    void tradeAssistant$removeRoleDiscount();

    static VillagerTradeState of(Villager villager) {
        return (VillagerTradeState) villager;
    }
}
