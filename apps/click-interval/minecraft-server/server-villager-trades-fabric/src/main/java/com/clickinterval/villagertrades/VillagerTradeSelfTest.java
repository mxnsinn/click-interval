package com.clickinterval.villagertrades;

import io.netty.buffer.Unpooled;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.wanderingtrader.WanderingTrader;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.trading.ItemCost;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;

import java.util.Optional;
import com.mojang.serialization.JsonOps;
import net.minecraft.resources.RegistryOps;

/** Opt-in integration check for isolated smoke worlds; entities are never added to the world. */
final class VillagerTradeSelfTest {
    private VillagerTradeSelfTest() { }

    static void run(MinecraftServer server) {
        try {
            Villager villager = EntityTypes.VILLAGER.create(server.overworld(), EntitySpawnReason.COMMAND);
            require(villager != null, "test villager creation");
            MerchantOffers restored = restoredExhaustedOffers(server);
            MerchantOffer legacy = restored.getFirst();
            require(legacy.isOutOfStock() && legacy.getUses() == 12, "saved codec restores old exhausted offer before ownership");
            RegistryFriendlyByteBuf unownedBuffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
            try {
                MerchantOffer.STREAM_CODEC.encode(unownedBuffer, legacy);
                MerchantOffer unownedClient = MerchantOffer.STREAM_CODEC.decode(unownedBuffer);
                require(unownedClient.getMaxUses() == 12 && unownedClient.getUses() == 12 && unownedClient.isOutOfStock(),
                        "unowned/remote-client exhausted offers retain original stock on wire");
                require(!((UnlimitedOffer) unownedClient).clickInterval$isUnlimited(), "decoding never invents unlimited server authority");
                unownedClient.increaseUses();
                require(unownedClient.getUses() == 13 && unownedClient.isOutOfStock(), "unowned client counters stay native");
            } finally { unownedBuffer.release(); }
            var ops = RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
            var beforeUnlock = MerchantOffers.CODEC.encodeStart(ops, restored).getOrThrow();
            int savedPrice = legacy.getCostA().getCount();
            villager.setVillagerXp(27);
            villager.setOffers(restored);
            require(!legacy.isOutOfStock(), "assigned old exhausted offer unlocks before getOffers/menu synchronization");
            require(villager.getOffers() == restored && villager.getVillagerXp() == 27, "existing offers and villager XP retained");
            require(legacy.getUses() == 12 && legacy.getMaxUses() == 12 && legacy.getDemand() == 7,
                    "legacy uses, original maximum and demand retained");
            require(legacy.getSpecialPriceDiff() == -1 && legacy.getCostA().getCount() == savedPrice && legacy.getXp() == 2,
                    "saved discounts, effective price and trade XP retained");
            require(beforeUnlock.equals(MerchantOffers.CODEC.encodeStart(ops, restored).getOrThrow()),
                    "availability recovery does not rewrite any persisted offer data");
            RegistryFriendlyByteBuf legacyBuffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
            try {
                MerchantOffers.STREAM_CODEC.encode(legacyBuffer, restored);
                MerchantOffer clientLegacy = MerchantOffers.STREAM_CODEC.decode(legacyBuffer).getFirst();
                require(!clientLegacy.isOutOfStock() && clientLegacy.getUses() < clientLegacy.getMaxUses(),
                        "old exhausted offers are immediately available in vanilla client's decoded list");
                require(clientLegacy.getCostA().getCount() == savedPrice && clientLegacy.getDemand() == legacy.getDemand(),
                        "old offer wire price/demand preserved");
            } finally { legacyBuffer.release(); }
            villager.setVillagerXp(0);
            MerchantOffer offer = exhaustedOffer();
            MerchantOffers offers = new MerchantOffers();
            offers.add(offer);
            villager.setOffers(offers);
            require(villager.getOffers().getFirst() == offer, "existing offer identity retained");
            require(!offer.isOutOfStock(), "existing exhausted villager offer unlocked");
            require(offer.getMaxUses() == 12, "original stock limit retained for saves/demand");
            int initialPrice = offer.getCostA().getCount();
            for (int trade = 0; trade < 100; trade++) {
                ItemStack payment = offer.getCostA().copy();
                require(offer.take(payment, ItemStack.EMPTY), "paid trade succeeds");
                require(payment.isEmpty(), "full price deducted on every trade");
                offer.increaseUses();
                require(!offer.isOutOfStock(), "offer never exhausts");
            }
            require(offer.getUses() == 12, "daily demand counter capped at original stock");
            require(offer.getCostA().getCount() == initialPrice, "price unchanged before native restock");
            require(!offer.take(ItemStack.EMPTY, ItemStack.EMPTY), "no free trades");
            require(offer.getXp() == 2, "trade XP preserved");
            require(!offer.copy().isOutOfStock(), "copied offer retains unlimited flag");

            RegistryFriendlyByteBuf buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
            try {
                MerchantOffer.STREAM_CODEC.encode(buffer, offer);
                MerchantOffer clientOffer = MerchantOffer.STREAM_CODEC.decode(buffer);
                require(clientOffer.getMaxUses() == Integer.MAX_VALUE, "vanilla client stock advertised");
                require(!clientOffer.isOutOfStock(), "vanilla client sees available offer");
                require(clientOffer.getCostA().getCount() == initialPrice, "wire price preserved");
            } finally {
                buffer.release();
            }
            offer.updateDemand();
            require(offer.getDemand() == 12, "native full-stock demand increase preserved");
            offer.resetUses();
            require(offer.getUses() == 0 && !offer.isOutOfStock(), "native restock remains valid");

            WanderingTrader wandering = EntityTypes.WANDERING_TRADER.create(server.overworld(), EntitySpawnReason.COMMAND);
            require(wandering != null, "test wandering trader creation");
            MerchantOffers wanderingOffers = wandering.getOffers();
            MerchantOffer limited = exhaustedOffer();
            wanderingOffers.clear();
            wanderingOffers.add(limited);
            require(wandering.getOffers().getFirst().isOutOfStock(), "wandering trader stock unchanged");
            require(limited.getMaxUses() == 12, "wandering trader maximum unchanged");
            OriginalTradeCycleSelfTest.runIfInstalled(server);
            ServerVillagerTrades.LOGGER.info("SERVER_VILLAGER_TRADES_SELFTEST_PASS: serialized exhausted offers recovered before menu sync without persisted changes, 100 paid trades, old/client wire stock, copied offers, native demand, XP/discounts retained, wandering exclusion.");
        } catch (Throwable failure) {
            ServerVillagerTrades.LOGGER.error("SERVER_VILLAGER_TRADES_SELFTEST_FAIL", failure);
            throw new IllegalStateException("Unlimited villager trade smoke test failed", failure);
        }
    }

    private static MerchantOffer exhaustedOffer() {
        return new MerchantOffer(new ItemCost(Items.EMERALD, 3), Optional.empty(),
                new ItemStack(Items.BREAD), 12, 12, 2, 0.05F);
    }
    static MerchantOffers restoredExhaustedOffers(MinecraftServer server) {
        var ops = RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
        MerchantOffer old = new MerchantOffer(new ItemCost(Items.EMERALD, 3), Optional.empty(),
                new ItemStack(Items.BREAD), 12, 12, 2, .05F, 7);
        old.setSpecialPriceDiff(-1);
        MerchantOffers persisted = new MerchantOffers(); persisted.add(old);
        var saved = MerchantOffers.CODEC.encodeStart(ops, persisted).getOrThrow();
        return MerchantOffers.CODEC.parse(ops, saved).getOrThrow();
    }

    private static void require(boolean condition, String label) {
        if (!condition) throw new IllegalStateException(label);
    }
}
