package com.clickinterval.villagertrades;

import com.clickinterval.villagertrades.mixin.MerchantMenuStockAccess;
import com.mojang.authlib.GameProfile;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.GlobalPos;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.common.ClientboundShowDialogPacket;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.MenuProvider;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerProfession;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.trading.ItemCost;
import net.minecraft.world.item.trading.MerchantOffer;
import net.minecraft.world.item.trading.MerchantOffers;
import net.minecraft.world.level.GameType;
import java.lang.reflect.Method;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;

/** Runs the original mod's actual, transformed handler; never installs a substitute protocol. */
final class OriginalTradeCycleSelfTest {
    private OriginalTradeCycleSelfTest() { }

    static void runIfInstalled(MinecraftServer server) throws Exception {
        if (!FabricLoader.getInstance().isModLoaded("trade_cycling")) {
            require(!Boolean.getBoolean("servervillagertrades.originaltest"), "original mod required by test flag");
            ServerVillagerTrades.LOGGER.info("SERVER_ORIGINAL_TRADE_CYCLE_SELFTEST_SKIPPED: original mod not installed; stock-only mode.");
            return;
        }
        Method cycle = Class.forName("de.maxhenkel.tradecycling.TradeCyclingMod")
                .getMethod("onCycleTrades", ServerPlayer.class);
        var level = server.overworld();
        SmokePlayer player = new SmokePlayer(server, "OriginalCycle");
        SmokePlayer other = new SmokePlayer(server, "OtherCustomer");
        Villager villager = EntityTypes.VILLAGER.create(level, EntitySpawnReason.COMMAND);
        require(villager != null, "fixture villager");
        try {
            villager.setVillagerData(villager.getVillagerData().withProfession(server.registryAccess(), VillagerProfession.LIBRARIAN));
            int y = level.getMaxY() - 4;
            villager.setPos(0.5, y, 1.5);
            player.setPos(1.5, y, 1.5);
            other.setPos(1.5, y, 2.5);
            // Original upstream checks assigned memory only: compatibility adds no chunk load,
            // matching-block, line-of-sight, custom session or nonce restriction.
            villager.getBrain().setMemory(MemoryModuleType.JOB_SITE,
                    GlobalPos.of(level.dimension(), new BlockPos(0, y, 0)));
            villager.mobInteract(player, InteractionHand.MAIN_HAND);
            require(player.containerMenu instanceof MerchantMenu, "ordinary right-click opens native merchant");
            MerchantMenu menu = (MerchantMenu) player.containerMenu;
            require(villager.getTradingPlayer() == player, "native current customer");
            require(player.sentOffers > 0, "normal offers sent before first click");
            MerchantOffers initial = villager.getOffers();
            int sends = player.sentOffers;
            cycle.invoke(null, player);
            MerchantOffers changed = villager.getOffers();
            require(changed != initial && !changed.isEmpty(), "first original click immediately regenerates offers");
            require(player.sentOffers == sends + 1 && player.containerMenu == menu, "original response and same native screen");
            require(changed.stream().noneMatch(MerchantOffer::isOutOfStock), "regenerated offers keep unlimited stock");

            // Payment and cursor contents do not suppress the original button's normal operation.
            OriginalTradeGuard.disconnect(player);
            MerchantOffers known = new MerchantOffers();
            known.add(new MerchantOffer(new ItemCost(Items.EMERALD, 3), Optional.empty(), new ItemStack(Items.BREAD), 12, 2, 0.05F));
            villager.setOffers(known);
            menu.setSelectionHint(0);
            menu.getSlot(0).set(new ItemStack(Items.EMERALD, 6));
            menu.setCarried(new ItemStack(Items.DIAMOND, 2));
            require(menu.getSlot(2).getItem().is(Items.BREAD), "old preview exists before reroll");
            cycle.invoke(null, player);
            require(villager.getOffers() != known, "original click works with payment and carried stack");
            require(menu.getSlot(0).getItem().is(Items.EMERALD) && menu.getSlot(0).getItem().getCount() == 6,
                    "reroll never consumes or duplicates real payment");
            require(menu.getCarried().is(Items.DIAMOND) && menu.getCarried().getCount() == 2, "cursor retained exactly");
            var active = ((MerchantMenuStockAccess) menu).clickInterval$stockContainer().getActiveOffer();
            require(active == null || villager.getOffers().contains(active), "result uses only new authoritative offers");
            require(menu.getSlot(2).getItem().isEmpty() || (active != null
                    && ItemStack.matches(menu.getSlot(2).getItem(), active.assemble())), "no stale free preview after reroll");
            player.closeContainer();
            require(player.getInventory().countItem(Items.EMERALD) == 6 && player.getInventory().countItem(Items.DIAMOND) == 2,
                    "native close returns payment and cursor once");
            require(player.getInventory().countItem(Items.BREAD) == 0 && villager.getTradingPlayer() == null,
                    "native close does not award preview and releases customer immediately");
            MerchantOffers closed = villager.getOffers();
            cycle.invoke(null, player);
            require(villager.getOffers() == closed, "closed menu cannot reroll");

            villager.mobInteract(player, InteractionHand.MAIN_HAND);
            menu = (MerchantMenu) player.containerMenu;
            OriginalTradeGuard.disconnect(player);
            MerchantOffers locked = villager.getOffers();
            villager.setVillagerXp(1);
            cycle.invoke(null, player);
            require(villager.getOffers() == locked, "traded villager blocked even with empty inputs");
            villager.setVillagerXp(0);
            locked.getFirst().increaseUses();
            cycle.invoke(null, player);
            require(villager.getOffers() == locked, "used offers block forged zero-XP reroll");
            locked.getFirst().resetUses();
            villager.setVillagerData(villager.getVillagerData().withLevel(2));
            cycle.invoke(null, player);
            require(villager.getOffers() == locked, "higher-level zero-XP villager remains locked");
            villager.setVillagerData(villager.getVillagerData().withLevel(1));

            villager.setTradingPlayer(other);
            cycle.invoke(null, player);
            require(villager.getOffers() == locked && villager.getTradingPlayer() == other, "stale menu cannot steal another customer");
            villager.setTradingPlayer(player);
            player.setPos(100, y, 100);
            require(!menu.stillValid(player), "out-of-range native fixture");
            cycle.invoke(null, player);
            require(villager.getOffers() == locked, "invalid native merchant blocked");
            player.setPos(4.5, y, 1.5);
            require(menu.stillValid(player), "normal native movement tolerance remains valid");
            OriginalTradeGuard.disconnect(player);
            cycle.invoke(null, player);
            require(villager.getOffers() != locked, "native valid distance can cycle without extra reach restriction");
            player.setPos(1.5, y, 1.5);

            OriginalTradeGuard.disconnect(player);
            for (int i = 0; i < OriginalTradeRateLimit.MAX_PER_SECOND; i++) {
                MerchantOffers before = villager.getOffers();
                cycle.invoke(null, player);
                require(villager.getOffers() != before, "ordinary bounded click burst " + i);
            }
            MerchantOffers bounded = villager.getOffers();
            cycle.invoke(null, player);
            require(villager.getOffers() == bounded, "packet spam cannot exceed per-player regeneration budget");
            player.closeContainer();
            villager.mobInteract(player, InteractionHand.MAIN_HAND);
            cycle.invoke(null, player);
            require(villager.getOffers() == bounded, "reopening screen cannot reset rate limit");
            require(player.uiMessages == 0 && player.listener.dialogs == 0, "no custom chat, dialog or close instruction");
            ServerVillagerTrades.LOGGER.info("SERVER_ORIGINAL_TRADE_CYCLE_SELFTEST_PASS: actual unchanged upstream handler, immediate first click, ordinary native screen and close, payment/cursor conservation and result recalculation, unlimited regenerated stock, zero-input traded lock, used-offer/level/customer/native-distance guards, request bounds across reopen; no custom handshake/chat/dialog.");
        } finally {
            OriginalTradeGuard.disconnect(player);
            OriginalTradeGuard.disconnect(other);
            player.closeContainer();
            other.closeContainer();
        }
    }

    private static void require(boolean condition, String label) {
        if (!condition) throw new IllegalStateException("Original Trade Cycling: " + label);
    }

    private static final class RecordingListener extends ServerGamePacketListenerImpl {
        int dialogs;
        RecordingListener(MinecraftServer server, ServerPlayer player) {
            super(server, new Connection(PacketFlow.SERVERBOUND), player, CommonListenerCookie.createInitial(player.getGameProfile(), false));
        }
        @Override public void send(Packet<?> packet) { if (packet instanceof ClientboundShowDialogPacket) dialogs++; }
    }

    private static final class SmokePlayer extends ServerPlayer {
        final RecordingListener listener;
        int nextMenu, sentOffers, uiMessages;
        SmokePlayer(MinecraftServer server, String name) {
            super(server, server.overworld(), new GameProfile(UUID.randomUUID(), name), ClientInformation.createDefault());
            listener = new RecordingListener(server, this);
            connection = listener;
            gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        }
        @Override public OptionalInt openMenu(MenuProvider provider) {
            closeContainer();
            containerMenu = provider.createMenu(++nextMenu, getInventory(), this);
            return containerMenu == null ? OptionalInt.empty() : OptionalInt.of(nextMenu);
        }
        @Override public void closeContainer() {
            if (containerMenu != inventoryMenu) { containerMenu.removed(this); containerMenu = inventoryMenu; }
        }
        @Override public void sendMerchantOffers(int id, MerchantOffers offers, int level, int xp, boolean progress, boolean restock) { sentOffers++; }
        @Override public void sendSystemMessage(Component text) { uiMessages++; }
        @Override public void sendSystemMessage(Component text, boolean overlay) { uiMessages++; }
        @Override public void sendOverlayMessage(Component text) { uiMessages++; }
        @Override public void awardStat(Identifier stat) { }
        @Override public boolean hasDisconnected() { return false; }
    }
}
