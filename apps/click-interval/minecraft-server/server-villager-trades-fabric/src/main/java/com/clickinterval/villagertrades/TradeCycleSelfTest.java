package com.clickinterval.villagertrades;

import com.clickinterval.villagertrades.network.CycleRequest;
import com.clickinterval.villagertrades.network.CycleStatus;
import com.mojang.authlib.GameProfile;
import io.netty.buffer.Unpooled;
import net.minecraft.core.BlockPos;
import net.minecraft.core.GlobalPos;
import net.minecraft.network.Connection;
import net.minecraft.network.RegistryFriendlyByteBuf;
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
import net.minecraft.world.item.trading.MerchantOffers;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import java.util.OptionalInt;
import java.util.UUID;

/** Opt-in, isolated dedicated-server tests: transformed native merchant menus and real wire codecs. */
final class TradeCycleSelfTest {
    private TradeCycleSelfTest() { }
    static void run(MinecraftServer server) {
        var level = server.overworld();
        BlockPos job = new BlockPos(0, level.getMaxY() - 4, 0);
        level.getChunkAt(job);
        var previous = level.getBlockState(job);
        SmokePlayer player = new SmokePlayer(server, "CycleButtonTest");
        SmokePlayer other = new SmokePlayer(server, "CycleOtherTest");
        try {
            level.setBlock(job, Blocks.LECTERN.defaultBlockState(), 3);
            Villager villager = EntityTypes.VILLAGER.create(level, EntitySpawnReason.COMMAND);
            require(villager != null, "villager creation");
            villager.setVillagerData(villager.getVillagerData().withProfession(server.registryAccess(), VillagerProfession.LIBRARIAN));
            villager.setPos(0.5, job.getY(), 1.5);
            villager.getBrain().setMemory(MemoryModuleType.JOB_SITE, GlobalPos.of(level.dimension(), job));
            player.setPos(1.5, job.getY(), 1.5);
            other.setPos(1.5, job.getY(), 2.5);
            player.getInventory().setItem(8, new ItemStack(Items.DIAMOND, 7));
            villager.mobInteract(player, InteractionHand.MAIN_HAND);
            require(player.containerMenu instanceof MerchantMenu && player.sentOffers > 0, "ordinary right-click opens native merchant without addon");
            MerchantMenu menu = (MerchantMenu) player.containerMenu;
            require(villager.getTradingPlayer() == player && menu instanceof MerchantMenuCycleAccess, "native ownership and transformed menu state");
            require(player.listener.dialogs == 0 && player.uiMessages == 0, "no dialog or chat instructions");
            MerchantOffers original = villager.getOffers();
            require(TradeCycling.process(player, new CycleRequest(menu.containerId, 0, true)) == null, "no cycle before query capability");
            CycleStatus status = requireStatus(TradeCycling.process(player, new CycleRequest(menu.containerId, 0, false)));
            require(status.eligible() && status.nonce() != 0, "query grants eligible nonzero menu token");
            require(villager.getOffers() == original, "query never rerolls offers");
            nativeMenuEligibilityTests(player, villager, menu, job);

            RegistryFriendlyByteBuf buffer = new RegistryFriendlyByteBuf(Unpooled.buffer(), server.registryAccess());
            CycleRequest first;
            try {
                CycleRequest request = new CycleRequest(menu.containerId, status.nonce(), true);
                CycleRequest.CODEC.encode(buffer, request);
                first = CycleRequest.CODEC.decode(buffer);
                require(first.equals(request), "bounded request codec round trip");
                CycleStatus.CODEC.encode(buffer, status);
                require(CycleStatus.CODEC.decode(buffer).equals(status), "bounded status codec round trip");
            } finally { buffer.release(); }
            require(TradeCycling.process(other, first) == null, "cross-player nonce without matching menu rejected");
            require(TradeCycling.process(player, new CycleRequest(menu.containerId + 1, status.nonce(), true)) == null, "wrong container rejected");
            require(TradeCycling.process(player, new CycleRequest(menu.containerId, status.nonce() ^ 1, true)) == null, "forged nonce rejected");
            CycleStatus fresh = requireStatus(TradeCycling.process(player, first));
            MerchantOffers cycled = villager.getOffers();
            require(cycled != original && !cycled.isEmpty(), "actual offers regenerated");
            require(fresh.nonce() != first.nonce() && fresh.nonce() != 0, "successful cycle rotates nonzero nonce");
            require(player.containerMenu == menu && villager.getTradingPlayer() == player, "cycle keeps exact merchant menu and customer");
            require(villager.getVillagerXp() == 0 && villager.getVillagerData().level() == 1, "XP and level unchanged");
            require(cycled.stream().noneMatch(offer -> offer.isOutOfStock()), "new offers retain unlimited stock");
            require(TradeCycling.process(player, first) == null && villager.getOffers() == cycled, "replayed token rejected");
            CycleStatus cooldown = requireStatus(TradeCycling.process(player, cycle(menu, fresh)));
            require(villager.getOffers() == cycled && cooldown.nonce() != fresh.nonce(), "cooldown rejects reroll and returns fresh status");
            TradeCycling.disconnect(player); // Reset request budget between independent isolated groups.

            for (int slot = 0; slot < 3; slot++) {
                menu.getSlot(slot).set(new ItemStack(slot == 2 ? Items.BREAD : Items.EMERALD, 3));
                ItemStack before = menu.getSlot(slot).getItem().copy();
                CycleStatus blocked = requireStatus(TradeCycling.process(player, cycle(menu, cooldown)));
                require(blocked.nonce() != cooldown.nonce() && villager.getOffers() == cycled, "filled slot " + slot + " rejects and rotates");
                require(ItemStack.matches(before, menu.getSlot(slot).getItem()), "filled slot " + slot + " preserved");
                cooldown = blocked;
                menu.getSlot(slot).set(ItemStack.EMPTY);
            }
            menu.setCarried(new ItemStack(Items.DIAMOND, 2));
            CycleStatus carried = requireStatus(TradeCycling.process(player, cycle(menu, cooldown)));
            require(villager.getOffers() == cycled && menu.getCarried().getCount() == 2, "carried stack blocks cycle without mutation");
            require(carried.nonce() != cooldown.nonce(), "carried rejection rotates token");
            menu.setCarried(ItemStack.EMPTY);
            require(player.getInventory().getItem(8).is(Items.DIAMOND) && player.getInventory().getItem(8).getCount() == 7, "player inventory unchanged");
            player.closeContainer();
            require(villager.getTradingPlayer() == null, "native close releases merchant");
            require(TradeCycling.process(player, cycle(menu, carried)) == null, "closed menu retires token");
            TradeCycling.disconnect(player);

            player.setShiftKeyDown(true);
            villager.mobInteract(player, InteractionHand.MAIN_HAND);
            require(player.containerMenu instanceof MerchantMenu, "sneak right-click still opens native merchant");
            MerchantMenu reopened = (MerchantMenu) player.containerMenu;
            CycleStatus reopen = requireStatus(TradeCycling.process(player, new CycleRequest(reopened.containerId, 0, false)));
            require(reopen.nonce() != carried.nonce(), "new menu gets independent nonce");
            CycleStatus reopenedCooldown = requireStatus(TradeCycling.process(player, cycle(reopened, reopen)));
            require(villager.getOffers() == cycled, "reopening cannot bypass per-villager cooldown");
            player.setPos(100, job.getY(), 100);
            CycleStatus range = requireStatus(TradeCycling.process(player, cycle(reopened, reopenedCooldown)));
            require(!range.eligible() && villager.getOffers() == cycled, "out-of-range cycle rejected");
            player.setPos(1.5, job.getY(), 1.5);
            villager.setVillagerXp(1);
            CycleStatus traded = requireStatus(TradeCycling.process(player, cycle(reopened, range)));
            require(!traded.eligible() && villager.getOffers() == cycled, "newly traded villager cannot reroll");
            villager.setVillagerXp(0);
            villager.setTradingPlayer(other);
            CycleStatus stolen = requireStatus(TradeCycling.process(player, cycle(reopened, traded)));
            require(!stolen.eligible() && villager.getOffers() == cycled, "changed trading identity rejected");
            villager.setTradingPlayer(player);
            level.setBlock(job, Blocks.STONE.defaultBlockState(), 3);
            CycleStatus missingJob = requireStatus(TradeCycling.process(player, cycle(reopened, stolen)));
            require(!missingJob.eligible() && villager.getOffers() == cycled, "missing workstation rejected");
            level.setBlock(job, Blocks.LECTERN.defaultBlockState(), 3);
            TradeCycling.disconnect(player);
            villager.setOffers(cycled.copy());
            CycleStatus replaced = requireStatus(TradeCycling.process(player, cycle(reopened, missingJob)));
            require(!replaced.eligible(), "out-of-band offers replacement invalidates menu capability");
            MerchantOffers oldExhausted = VillagerTradeSelfTest.restoredExhaustedOffers(server);
            villager.setOffers(oldExhausted);
            require(!villager.getOffers().getFirst().isOutOfStock(), "old serialized exhausted villager stock recovered");
            require(villager.getOffers().getFirst().getUses() == 12 && villager.getVillagerXp() == 0,
                    "stock recovery preserves old-use evidence even with zero villager XP");
            require(!TradeCycling.eligible(villager, player), "restored stock never unlocks cycling for previously used offers");
            require(player.listener.dialogs == 0 && player.uiMessages == 0, "all paths remain chat/dialog free");
            TradeCycling.RequestBudget budget = new TradeCycling.RequestBudget();
            for (int i = 0; i < 8; i++) require(budget.acquire(100), "initial bounded request burst");
            require(!budget.acquire(100) && !budget.acquire(119) && budget.acquire(120), "request work bounded per player");
            ServerVillagerTrades.LOGGER.info("SERVER_VILLAGER_CYCLE_SELFTEST_PASS: native merchant/right-click/close, native movement tolerance and partial-opening eligibility, codecs, same-menu cycles, nonzero rotating nonce/replay/forgery, cooldown/reopen, customer/range/XP/workstation/offers guards, all input/result/carried slots, request bounds, no free items/chat/dialogs; dedicated-server load without client mixins.");
        } finally {
            TradeCycling.disconnect(player); TradeCycling.disconnect(other);
            player.closeContainer(); other.closeContainer();
            level.setBlock(job, previous, 3);
        }
    }
    /** A valid native merchant screen must not lose cycling because its eye ray is obstructed. */
    private static void nativeMenuEligibilityTests(SmokePlayer player, Villager villager, MerchantMenu menu, BlockPos job) {
        var level = player.level();
        Vec3 originalPosition = player.position();
        BlockPos obstruction = new BlockPos(0, job.getY() + 1, 2);
        var originalBlock = level.getBlockState(obstruction);
        MerchantOffers originalOffers = villager.getOffers();
        TradeCycling.disconnect(player); // Independent checks do not consume the protocol group's burst.
        try {
            player.setPos(4.5, job.getY(), 1.5);
            require(!player.isWithinEntityInteractionRange(villager, 0.0), "fixture is outside old zero-tolerance reach");
            require(menu.stillValid(player), "native merchant remains valid with four-block customer separation");
            require(requireStatus(TradeCycling.process(player, new CycleRequest(menu.containerId, 0, false))).eligible(),
                    "native merchant movement tolerance permits eligibility");

            player.setPos(0.5, job.getY(), 4.5);
            level.setBlock(obstruction, Blocks.STONE.defaultBlockState(), 3);
            require(player.isWithinEntityInteractionRange(villager, 0.0), "partial-opening fixture remains within original reach");
            require(!player.hasLineOfSight(villager), "partial-opening fixture blocks the eye-to-eye ray");
            Vec3 lowerBody = new Vec3(villager.getX(), villager.getY() + 0.1, villager.getZ());
            require(level.clip(new ClipContext(player.getEyePosition(), lowerBody,
                    ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player)).getType() == HitResult.Type.MISS,
                    "partial opening leaves a clear native interaction ray to the villager's lower body");
            require(menu.stillValid(player), "native merchant remains valid through partial opening");
            require(requireStatus(TradeCycling.process(player, new CycleRequest(menu.containerId, 0, false))).eligible(),
                    "partial opening does not hide cycling for an untraded villager");

            player.setPos(100, job.getY(), 100);
            require(!menu.stillValid(player), "distant customer fails native merchant validity");
            require(!requireStatus(TradeCycling.process(player, new CycleRequest(menu.containerId, 0, false))).eligible(),
                    "distant customer remains ineligible");
            require(villager.getOffers() == originalOffers, "eligibility checks do not alter offers");
        } finally {
            level.setBlock(obstruction, originalBlock, 3);
            player.setPos(originalPosition.x, originalPosition.y, originalPosition.z);
            TradeCycling.disconnect(player);
        }
    }
    private static CycleRequest cycle(MerchantMenu menu, CycleStatus status) { return new CycleRequest(menu.containerId, status.nonce(), true); }
    private static CycleStatus requireStatus(CycleStatus status) { require(status != null, "expected status response"); return status; }
    private static void require(boolean condition, String label) { if (!condition) throw new IllegalStateException("Cycle button: " + label); }
    private static final class RecordingListener extends ServerGamePacketListenerImpl {
        int dialogs;
        RecordingListener(MinecraftServer server, SmokePlayer player) {
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
