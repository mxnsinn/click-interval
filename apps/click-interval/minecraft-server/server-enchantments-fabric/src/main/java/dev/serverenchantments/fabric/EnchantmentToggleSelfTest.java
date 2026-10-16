package dev.serverenchantments.fabric;

import com.mojang.authlib.GameProfile;
import dev.serverenchantments.fabric.core.HarvestBudget;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.minecraft.core.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.*;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.*;
import net.minecraft.resources.*;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.*;
import net.minecraft.server.network.*;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.*;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.*;
import org.slf4j.LoggerFactory;

import java.util.UUID;
import static dev.serverenchantments.fabric.PlayerToggleStore.Feature.*;

/** Explicitly gated fresh-world tests of real transformed native packets and native block transactions. */
final class EnchantmentToggleSelfTest {
    static void run(MinecraftServer server, ServerEnchantmentsFabric mod) throws Exception {
        ServerPlayer player = player(server, "EnchantToggle", "4fa46f2f-0200-44c7-9f0c-428857cbab71");
        ServerPlayer other = player(server, "OtherToggle", "3c20b64b-c8cd-479e-8b0d-49c74fe398b2");
        var level = server.overworld();
        BlockPos origin = new BlockPos(200, level.getMaxY() - 16, 200);
        level.getChunk(origin.getX() >> 4, origin.getZ() >> 4);
        player.setPos(origin.getX() + .5, origin.getY(), origin.getZ() + 2.5);
        var budgetField = ServerEnchantmentsFabric.class.getDeclaredField("budget");
        budgetField.setAccessible(true);
        HarvestBudget oldBudget = (HarvestBudget) budgetField.get(mod);
        budgetField.set(mod, new HarvestBudget(Long.MAX_VALUE));
        boolean[] deny = {false};
        PlayerBlockBreakEvents.BEFORE.register((world, actor, pos, state, entity) ->
                !actor.getUUID().equals(player.getUUID()) || !deny[0] || pos.equals(origin));
        try (var fixture = new EnchantmentSelfTest.Fixture(level, origin)) {
            require(mod.toggleSnapshot(player).state().equals(PlayerToggleStore.State.DEFAULT), "new player defaults ON");
            require(mod.toggleSnapshot(other).state().equals(PlayerToggleStore.State.DEFAULT), "other defaults independently ON");
            ItemStack pick = tool(server, Items.DIAMOND_PICKAXE, "wide_miner", 2);
            pick.enchant(enchantment(server, "smelter"), 1);
            pick.setDamageValue(17);
            pick.set(DataComponents.CUSTOM_NAME, Component.literal("Unchanged named tool"));
            player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            player.setItemInHand(InteractionHand.OFF_HAND, new ItemStack(Items.DIAMOND, 7));
            ItemStack originalPick = pick.copy(), originalOffhand = player.getOffhandItem().copy();

            var dispatcher = server.getCommands().getDispatcher();
            require(dispatcher.execute("enchants", player.createCommandSourceStack()) == 1, "unprivileged menu command");
            require(player.containerMenu instanceof EnchantmentToggleMenu, "native chest menu opened");
            var firstMenu = (EnchantmentToggleMenu) player.containerMenu;
            require(firstMenu.getSlot(2).getItem().getHoverName().getString().contains("ON"), "visible ON label");
            for (ContainerInput input : ContainerInput.values()) if (input != ContainerInput.PICKUP)
                firstMenu.clicked(2, 0, input, player);
            firstMenu.clicked(9, 0, ContainerInput.PICKUP, player);
            firstMenu.clicked(2, 1, ContainerInput.PICKUP, player);
            firstMenu.clicked(2, 0, ContainerInput.PICKUP, other);
            require(firstMenu.getCarried().isEmpty() && firstMenu.quickMoveStack(player, 2).isEmpty(), "all inventory transfers blocked");
            require(ItemStack.matches(originalPick, pick) && ItemStack.matches(originalOffhand, player.getOffhandItem()), "menu never mutates tool or offhand");
            require(mod.toggleSnapshot(player).state().miner(), "ignored click types never toggle");

            // Packet state mismatches must be rejected, not applied followed by vanilla resynchronization.
            player.connection.handleContainerClick(click(firstMenu, firstMenu.getStateId() + 1, 2));
            require(mod.toggleSnapshot(player).state().miner(), "stale packet state rejected");
            var accepted = click(firstMenu, firstMenu.getStateId(), 2);
            player.connection.handleContainerClick(accepted);
            require(!mod.toggleSnapshot(player).state().miner(), "native current click toggles OFF");
            require(player.containerMenu != firstMenu, "accepted action invalidates old menu");
            require(player.containerMenu.getSlot(2).getItem().getHoverName().getString().contains("OFF"), "visible current OFF label");
            advance(server, mod, 7);
            player.connection.handleContainerClick(accepted);
            firstMenu.clicked(2, 0, ContainerInput.PICKUP, player);
            require(!mod.toggleSnapshot(player).state().miner(), "replayed packet and retired menu stay inert after cooldown");
            require(mod.toggleSnapshot(other).state().miner(), "other player unchanged");

            var stale = (EnchantmentToggleMenu) player.containerMenu;
            require(dispatcher.execute("enchants toggle miner", player.createCommandSourceStack()) == 1, "self-only literal command toggles ON");
            advance(server, mod, 7);
            stale.clicked(2, 0, ContainerInput.PICKUP, player);
            require(mod.toggleSnapshot(player).state().miner(), "old snapshot after command cannot undo change");
            require(dispatcher.parse("enchants toggle miner " + other.getUUID(), player.createCommandSourceStack()).getReader().canRead(),
                    "no arbitrary target UUID accepted by command grammar");
            player.closeContainer();

            // Real transformed swap packet: qualifying crouch shortcut keeps both stacks byte-equivalent.
            player.setShiftKeyDown(true);
            swap(player);
            require(!mod.toggleSnapshot(player).state().miner(), "crouch+F toggles held enchanted pickaxe");
            advance(server, mod, 20); swap(player);
            require(!mod.toggleSnapshot(player).state().miner(), "delayed first OS repeat after one second stays suppressed");
            for (int repeat = 0; repeat < 20; repeat++) { advance(server, mod, 1); swap(player); }
            require(!mod.toggleSnapshot(player).state().miner(), "held repeat stream never flips repeatedly");
            advance(server, mod, 26); swap(player);
            require(mod.toggleSnapshot(player).state().miner(), "deliberate later F press works after quiet window");
            advance(server, mod, 26); swap(player);
            require(!mod.toggleSnapshot(player).state().miner(), "deliberate later F press can turn OFF again");
            require(ItemStack.matches(originalPick, player.getMainHandItem()) && ItemStack.matches(originalOffhand, player.getOffhandItem()),
                    "shortcut and repeated packets neither swap nor alter components/damage/counts");
            player.setShiftKeyDown(false);
            swap(player);
            require(ItemStack.matches(originalOffhand, player.getMainHandItem()) && ItemStack.matches(originalPick, player.getOffhandItem()),
                    "ordinary noncrouching F still swaps");
            player.setShiftKeyDown(true);
            swap(player);
            require(ItemStack.matches(originalPick, player.getMainHandItem()), "crouch+F with unsupported item still swaps");
            player.setShiftKeyDown(false);
            advance(server, mod, 7);

            // Disabled mining is exactly one native transaction; Smelter still cooks that block.
            fixture.cube();
            strike(player, origin);
            require(player.gameMode.destroyBlock(origin), "disabled Sweep center breaks normally");
            advance(server, mod, 7);
            require(level.getBlockState(origin.east()).is(Blocks.STONE) && level.getBlockState(origin.west()).is(Blocks.STONE), "disabled miner has no extras");
            require(pick.getDamageValue() == 18 && fixture.drops(Items.STONE) == 1 && fixture.drops(Items.COBBLESTONE) == 0,
                    "disabled mining retains one durability charge and one native Smelter drop");
            ItemStack expectedPick = originalPick.copy(); expectedPick.setDamageValue(18);
            require(ItemStack.matches(expectedPick, pick), "toggle leaves all other tool components unchanged");

            set(server, mod, player, MINER, true);
            fixture.reset(); fixture.cube();
            mod.beginTick(server); ((HarvestBudget) budgetField.get(mod)).reset(0, 0);
            strike(player, origin); require(player.gameMode.destroyBlock(origin), "center queues under exhausted shared budget");
            require(fixture.drops(Items.STONE) == 1, "extras initially queued");
            require(mod.toggle(player, MINER), "turn queued miner OFF");
            advance(server, mod, 7);
            require(fixture.drops(Items.STONE) == 1 && level.getBlockState(origin.east()).is(Blocks.STONE), "OFF cancels queued extras without duplicate drops");
            set(server, mod, player, MINER, true);
            fixture.reset(); fixture.cube();
            mod.beginTick(server); ((HarvestBudget) budgetField.get(mod)).reset(0, 0);
            strike(player, origin); require(player.gameMode.destroyBlock(origin), "another queued miner center");
            require(mod.toggle(player, TREE), "unrelated tree preference OFF");
            advance(server, mod, 7);
            require(fixture.drops(Items.STONE) == 9, "turning tree OFF does not cancel an unrelated miner job");
            fixture.reset(); fixture.cube(); deny[0] = true;
            strike(player, origin); require(player.gameMode.destroyBlock(origin), "enabled protected center");
            advance(server, mod, 7); deny[0] = false;
            require(fixture.drops(Items.STONE) == 1 && level.getBlockState(origin.east()).is(Blocks.STONE), "reenabling cannot bypass native protection");

            set(server, mod, player, TREE, false);
            fixture.reset(); fixture.tree();
            ItemStack axe = tool(server, Items.DIAMOND_AXE, "cheery_chop", 1);
            player.setItemInHand(InteractionHand.MAIN_HAND, axe);
            require(player.gameMode.destroyBlock(origin), "disabled tree root"); advance(server, mod, 7);
            require(level.getBlockState(origin.above()).is(Blocks.OAK_LOG) && axe.getDamageValue() == 1 && fixture.drops(Items.OAK_LOG) == 1,
                    "disabled tree one native block, durability and loot");
            set(server, mod, player, TREE, true);
            fixture.reset(); fixture.tree();
            mod.beginTick(server); ((HarvestBudget) budgetField.get(mod)).reset(0, 0);
            require(player.gameMode.destroyBlock(origin), "tree scan queued under shared budget");
            require(mod.toggle(player, TREE), "queued tree OFF");
            advance(server, mod, 7);
            require(fixture.drops(Items.OAK_LOG) == 1 && level.getBlockState(origin.above()).is(Blocks.OAK_LOG), "OFF cancels queued tree scan safely");

            set(server, mod, player, HARVESTER, false);
            fixture.reset();
            fixture.set(origin.below(), Blocks.FARMLAND.defaultBlockState());
            fixture.set(origin, ((CropBlock) Blocks.WHEAT).getStateForAge(7));
            fixture.set(origin.east().below(), Blocks.FARMLAND.defaultBlockState());
            fixture.set(origin.east(), ((CropBlock) Blocks.WHEAT).getStateForAge(7));
            ItemStack hoe = tool(server, Items.DIAMOND_HOE, "harvester_sweep", 3);
            player.setItemInHand(InteractionHand.MAIN_HAND, hoe);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64));
            require(player.gameMode.destroyBlock(origin), "disabled harvester center"); advance(server, mod, 7);
            require(level.getBlockState(origin).isAir() && CropHarvest.isRipe(level.getBlockState(origin.east()))
                    && player.getInventory().getItem(9).getCount() == 64 && fixture.drops(Items.WHEAT) == 1,
                    "disabled farmer is normal single crop with no replant/extra seed charge");
            fixture.set(origin, ((CropBlock) Blocks.WHEAT).getStateForAge(0));
            require(player.gameMode.destroyBlock(origin), "disabled harvester leaves vanilla young-crop breaking unchanged");
            set(server, mod, player, HARVESTER, true);
            fixture.set(origin, ((CropBlock) Blocks.WHEAT).getStateForAge(7));
            mod.beginTick(server); ((HarvestBudget) budgetField.get(mod)).reset(0, 0);
            require(player.gameMode.destroyBlock(origin), "harvester queues extras after paid center");
            int paidSeeds = player.getInventory().getItem(9).getCount();
            require(paidSeeds == 63 && !CropHarvest.isRipe(level.getBlockState(origin)), "already completed native center replant costs exactly one seed");
            require(mod.toggle(player, HARVESTER), "queued harvester OFF");
            advance(server, mod, 7);
            require(CropHarvest.isRipe(level.getBlockState(origin.east())) && player.getInventory().getItem(9).getCount() == paidSeeds,
                    "OFF cancels queued crops without restoring/spending any extra seeds");
            require(mod.toggleSnapshot(other).state().equals(PlayerToggleStore.State.DEFAULT), "all changes remain per-player");
            var reloaded = new PlayerToggleStore(server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT)
                    .resolve("server-enchantments"), message -> { throw new IllegalStateException(message); });
            require(reloaded.get(player.getUUID()).state().equals(mod.toggleSnapshot(player).state()), "native changes persist and reload by UUID");
            LoggerFactory.getLogger("serverenchantments_fabric").info("SERVER_ENCHANTMENT_TOGGLE_NATIVE_TEST_PASS: public self commands; native locked menu, stale/replay guards; crouch-F repeat debounce and ordinary swaps; per-player OFF single-block loot/durability, Smelter retained, pending cancel, protection and crop fallback.");
        } finally {
            player.setShiftKeyDown(false); player.closeContainer();
            budgetField.set(mod, oldBudget); mod.beginTick(server);
            player.discard(); other.discard();
        }
    }
    private static ServerPlayer player(MinecraftServer server, String name, String uuid) {
        GameProfile profile = new GameProfile(UUID.fromString(uuid), name);
        ServerPlayer player = new ServerPlayer(server, server.overworld(), profile, ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(profile, false));
        player.connection.handleAcceptPlayerLoad(new ServerboundPlayerLoadedPacket());
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        return player;
    }
    private static ServerboundContainerClickPacket click(EnchantmentToggleMenu menu, int state, int slot) {
        return new ServerboundContainerClickPacket(menu.containerId, state, (short) slot, (byte) 0,
                ContainerInput.PICKUP, new Int2ObjectOpenHashMap<>(), HashedStack.EMPTY);
    }
    private static void swap(ServerPlayer player) {
        player.connection.handlePlayerAction(new ServerboundPlayerActionPacket(
                ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND, BlockPos.ZERO, Direction.DOWN));
    }
    private static Holder<Enchantment> enchantment(MinecraftServer server, String id) {
        return server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(ResourceKey.create(
                Registries.ENCHANTMENT, Identifier.fromNamespaceAndPath("serverenchantments", id)));
    }
    private static ItemStack tool(MinecraftServer server, Item item, String id, int tier) {
        ItemStack tool = new ItemStack(item); tool.enchant(enchantment(server, id), tier); return tool;
    }
    private static void strike(ServerPlayer player, BlockPos origin) {
        AttackBlockCallback.EVENT.invoker().interact(player, player.level(), InteractionHand.MAIN_HAND, origin, Direction.NORTH);
    }
    private static void set(MinecraftServer server, ServerEnchantmentsFabric mod, ServerPlayer player,
                            PlayerToggleStore.Feature feature, boolean desired) {
        advance(server, mod, 7);
        if (mod.toggleSnapshot(player).state().enabled(feature) != desired) require(mod.toggle(player, feature), "set preference");
        advance(server, mod, 7);
    }
    private static void advance(MinecraftServer server, ServerEnchantmentsFabric mod, int ticks) {
        for (int index = 0; index < ticks; index++) { mod.beginTick(server); mod.tick(server); }
    }
    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException("Enchantment toggles: " + message);
    }
}
