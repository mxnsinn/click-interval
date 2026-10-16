package com.clickinterval.villagertrades;

import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerData;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;
import java.util.List;
import java.util.UUID;

/** One native MerchantMenu owns this capability; closing naturally retires it. */
public final class CycleMenuSession {
    private long nonce;
    private Villager villager;
    private VillagerData data;
    private MerchantOffers expected;
    private List<MerchantOffer> snapshot = List.of();
    public long nonce() { return nonce; }
    public void rotateNonce() {
        long previous = nonce;
        do { nonce = UUID.randomUUID().getMostSignificantBits(); } while (nonce == 0 || nonce == previous);
    }
    public void capture(Villager trader) {
        villager = trader;
        data = trader.getVillagerData();
        expected = trader.getOffers();
        snapshot = expected.stream().map(MerchantOffer::copy).toList();
        if (nonce == 0) rotateNonce();
    }
    public boolean matches(Villager trader) {
        if (trader != villager || !trader.getVillagerData().equals(data)
                || trader.getOffers() != expected || expected.size() != snapshot.size()) return false;
        for (int i = 0; i < expected.size(); i++) {
            MerchantOffer actual = expected.get(i), original = snapshot.get(i);
            if (!ItemStack.matches(actual.getCostA(), original.getCostA())
                    || !ItemStack.matches(actual.getCostB(), original.getCostB())
                    || !ItemStack.matches(actual.getResult(), original.getResult())
                    || actual.getUses() != original.getUses()) return false;
        }
        return true;
    }
}
