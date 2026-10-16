package dev.serverenchantments.fabric;

import com.mojang.authlib.GameProfile;
import dev.serverenchantments.fabric.core.SmeltAmounts;
import net.fabricmc.fabric.api.event.player.AttackBlockCallback;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.tags.EnchantmentTags;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.entity.EntitySection;
import net.minecraft.world.level.entity.EntitySectionStorage;
import net.minecraft.world.level.entity.PersistentEntitySectionManager;
import net.minecraft.world.phys.AABB;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Opt-in disposable-world tests; called only from serverenchantments.selftest. */
final class SmelterSelfTest {
    private static final Logger LOGGER = LoggerFactory.getLogger("serverenchantments_fabric");
    private static final UUID PLAYER_ID = UUID.fromString("de3c3c3c-9238-456d-bdce-91c3af868415");
    private SmelterSelfTest() { }

    static void run(MinecraftServer server, ServerEnchantmentsFabric mod) {
        ServerLevel level = server.overworld();
        var registry = server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT);
        Holder<Enchantment> smelter = registry.getOrThrow(Smelter.KEY);
        Holder<Enchantment> silk = registry.getOrThrow(Enchantments.SILK_TOUCH);
        Holder<Enchantment> fortune = registry.getOrThrow(Enchantments.FORTUNE);
        Holder<Enchantment> sweep = registry.getOrThrow(ResourceKey.create(Registries.ENCHANTMENT,
                Identifier.fromNamespaceAndPath("serverenchantments", "wide_miner")));
        require("Smelter".equals(smelter.value().description().getString()), "Smelter display name");
        require(smelter.value().getMaxLevel() == 1 && smelter.value().getWeight() == 1, "rare single Smelter level");
        require(smelter.is(EnchantmentTags.IN_ENCHANTING_TABLE) && smelter.is(EnchantmentTags.TRADEABLE), "table and librarian tags");
        require(smelter.value().isSupportedItem(new ItemStack(Items.DIAMOND_PICKAXE)), "pickaxe accepted");
        require(!smelter.value().isSupportedItem(new ItemStack(Items.DIAMOND_AXE)), "axe rejected");
        require(!Enchantment.areCompatible(smelter, silk) && !Enchantment.areCompatible(silk, smelter), "symmetric Silk incompatibility");
        require(Enchantment.areCompatible(smelter, fortune) && Enchantment.areCompatible(smelter, sweep), "Fortune and Sweep compatibility");

        GameProfile profile = new GameProfile(PLAYER_ID, "SmelterSelfTest");
        ServerPlayer player = new ServerPlayer(server, level, profile, ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(profile, false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        BlockPos origin = new BlockPos(136, level.getMaxY() - 16, 136);
        level.getChunk(origin.getX() >> 4, origin.getZ() >> 4);
        player.setPos(origin.getX() + .5, origin.getY(), origin.getZ() + 2.5);
        boolean[] deny = {false};
        PlayerBlockBreakEvents.BEFORE.register((world, actor, pos, state, blockEntity) ->
                !PLAYER_ID.equals(actor.getUUID()) || !deny[0]);
        try (Fixture fixture = new Fixture(level, origin)) {
            ItemStack pick = tool(smelter);
            player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            List<ItemStack> raw = List.of(new ItemStack(Items.RAW_IRON, 3), new ItemStack(Items.RAW_COPPER, 17), new ItemStack(Items.RAW_GOLD, 130));
            List<ItemStack> cooked = Smelter.transformDrops(raw, Blocks.IRON_ORE.defaultBlockState(), level, player, pick);
            require(count(cooked, Items.IRON_INGOT) == 3 && count(cooked, Items.COPPER_INGOT) == 17 && count(cooked, Items.GOLD_INGOT) == 130,
                    "exact already-resolved quantity conversion and oversized split");
            require(cooked.stream().allMatch(item -> item.getCount() <= item.getMaxStackSize()), "cooked output split to legal stack sizes");
            require(raw.get(0).is(Items.RAW_IRON) && raw.get(2).getCount() == 130, "source stacks are never consumed/mutated");

            ItemStack named = new ItemStack(Items.DIAMOND, 7);
            named.set(DataComponents.CUSTOM_NAME, Component.literal("Untouched native data"));
            List<ItemStack> untouched = List.of(named);
            require(Smelter.transformDrops(untouched, Blocks.DIAMOND_ORE.defaultBlockState(), level, player, pick) == untouched,
                    "no-recipe list and its components kept exactly");
            List<ItemStack> mixed = Smelter.transformDrops(List.of(raw.getFirst(), named), Blocks.IRON_ORE.defaultBlockState(), level, player, pick);
            require(mixed.getLast() == named, "unmatched components preserved even beside a smelted drop");
            require(Smelter.transformDrops(raw, Blocks.FURNACE.defaultBlockState(), level, player, pick) == raw, "containers excluded");
            require(Smelter.transformDrops(raw, Blocks.IRON_ORE.defaultBlockState(), level, null, pick) == raw, "non-player drops excluded");
            ItemStack axe = new ItemStack(Items.DIAMOND_AXE); axe.enchant(smelter, 1);
            require(Smelter.transformDrops(raw, Blocks.IRON_ORE.defaultBlockState(), level, player, axe) == raw, "forced wrong tool ignored");
            List<ItemStack> excessive = new ArrayList<>();
            for (int index = 0; index <= SmeltAmounts.MAX_INPUT_STACKS; index++) excessive.add(new ItemStack(Items.RAW_IRON));
            require(Smelter.transformDrops(excessive, Blocks.IRON_ORE.defaultBlockState(), level, player, pick) == excessive,
                    "pathological loot list takes bounded unchanged fallback");

            // Native loot-table roll, then exact conversion of that same Fortune-resolved list.
            pick.enchant(fortune, 3);
            List<ItemStack> fortuneDrops = Block.getDrops(Blocks.COPPER_ORE.defaultBlockState(), level, origin, null, player, pick);
            int copperCount = count(fortuneDrops, Items.RAW_COPPER);
            require(copperCount >= 2, "actual native Fortune copper drops obtained");
            List<ItemStack> fortuneCooked = Smelter.transformDrops(fortuneDrops, Blocks.COPPER_ORE.defaultBlockState(), level, player, pick);
            require(count(fortuneCooked, Items.COPPER_INGOT) == copperCount && count(fortuneCooked, Items.RAW_COPPER) == 0,
                    "native Fortune loot exact count preserved without reroll");

            fixture.set(origin, Blocks.IRON_ORE.defaultBlockState());
            pick = tool(smelter); player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            require(player.gameMode.destroyBlock(origin), "native Smelter iron break");
            require(fixture.drops(Items.IRON_INGOT) == 1 && fixture.drops(Items.RAW_IRON) == 0, "native pipeline emits only one cooked item");
            require(pick.getDamageValue() == 1 && fixture.experienceOrbs() == 0, "native durability paid, no smelting XP invented");

            fixture.reset(); fixture.set(origin, Blocks.STONE.defaultBlockState());
            pick = tool(smelter); player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            require(player.gameMode.destroyBlock(origin), "native stone break");
            require(fixture.drops(Items.STONE) == 1 && fixture.drops(Items.COBBLESTONE) == 0 && fixture.drops(Items.SMOOTH_STONE) == 0,
                    "cobblestone cooked once, never recursively into smooth stone");

            fixture.reset(); fixture.set(origin, Blocks.IRON_ORE.defaultBlockState());
            pick = tool(smelter); pick.setDamageValue(pick.getMaxDamage() - 1); player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            require(player.gameMode.destroyBlock(origin), "native final-durability break");
            require(player.getMainHandItem().isEmpty() && fixture.drops(Items.IRON_INGOT) == 1 && fixture.drops(Items.RAW_IRON) == 0,
                    "broken pick still uses native pre-damage loot snapshot");

            fixture.reset(); fixture.set(origin, Blocks.IRON_ORE.defaultBlockState());
            pick = tool(smelter); pick.enchant(silk, 1); player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            require(player.gameMode.destroyBlock(origin), "forced Silk plus Smelter break");
            require(fixture.drops(Items.IRON_ORE) == 1 && fixture.drops(Items.IRON_INGOT) == 0,
                    "forced incompatible combination prioritizes intact Silk Touch drop");

            fixture.reset(); fixture.set(origin, Blocks.IRON_ORE.defaultBlockState());
            pick = tool(smelter); player.setItemInHand(InteractionHand.MAIN_HAND, pick); deny[0] = true;
            require(!player.gameMode.destroyBlock(origin), "protection cancellation honored");
            require(level.getBlockState(origin).is(Blocks.IRON_ORE) && pick.getDamageValue() == 0 && fixture.drops(Items.IRON_INGOT) == 0,
                    "denied block produces no cooked item or durability charge");
            deny[0] = false;

            fixture.reset();
            for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) fixture.set(origin.offset(x, y, 0), Blocks.IRON_ORE.defaultBlockState());
            pick = tool(smelter); pick.enchant(sweep, 2); player.setItemInHand(InteractionHand.MAIN_HAND, pick);
            mod.beginTick(server);
            AttackBlockCallback.EVENT.invoker().interact(player, level, InteractionHand.MAIN_HAND, origin, Direction.NORTH);
            require(player.gameMode.destroyBlock(origin), "native Smelter plus Sweep center");
            for (int tick = 0; tick < 20; tick++) { mod.beginTick(server); mod.tick(server); }
            require(fixture.drops(Items.IRON_INGOT) == 9 && fixture.drops(Items.RAW_IRON) == 0 && pick.getDamageValue() == 9,
                    "all nine native Sweep breaks smelt once with exact drops and durability");
            nativeAnvilCompatibility(player, smelter, silk);
            LOGGER.info("SERVER_SMELTER_SELFTEST_PASS: native cooking recipes/Fortune counts, legal split/component preservation, native and final-durability drops, no duplicate XP, forced Silk safety/symmetric anvil rejection, BEFORE protection and nine-block Sweep integration.");
        } catch (Throwable failure) {
            LOGGER.error("SERVER_SMELTER_SELFTEST_FAIL", failure);
            throw new IllegalStateException("Smelter disposable-world test failed", failure);
        } finally {
            deny[0] = false;
            player.discard();
        }
    }

    private static void nativeAnvilCompatibility(ServerPlayer player, Holder<Enchantment> smelter, Holder<Enchantment> silk) {
        AnvilMenu menu = new AnvilMenu(84, player.getInventory());
        player.containerMenu = menu;
        try {
            for (boolean reverse : List.of(false, true)) {
                ItemStack pick = new ItemStack(Items.DIAMOND_PICKAXE); pick.enchant(reverse ? silk : smelter, 1);
                ItemStack book = new ItemStack(Items.ENCHANTED_BOOK); book.enchant(reverse ? smelter : silk, 1);
                menu.getSlot(0).set(pick); menu.getSlot(1).set(book); menu.createResult();
                require(menu.getSlot(2).getItem().isEmpty(), "native anvil rejects Silk/Smelter in either order");
            }
        } finally {
            menu.setCarried(ItemStack.EMPTY); menu.getSlot(0).set(ItemStack.EMPTY); menu.getSlot(1).set(ItemStack.EMPTY); menu.createResult();
            player.containerMenu = player.inventoryMenu;
        }
    }
    private static ItemStack tool(Holder<Enchantment> smelter) {
        ItemStack stack = new ItemStack(Items.DIAMOND_PICKAXE); stack.enchant(smelter, 1); return stack;
    }
    private static int count(List<ItemStack> stacks, Item item) { return stacks.stream().filter(stack -> stack.is(item)).mapToInt(ItemStack::getCount).sum(); }
    private static void require(boolean condition, String message) { if (!condition) throw new IllegalStateException(message); }

    private static final class Fixture implements AutoCloseable {
        private final ServerLevel level;
        private final BlockPos origin;
        private final Map<BlockPos, BlockState> original = new LinkedHashMap<>();
        private final EntitySectionStorage<Entity> sections;
        private final AABB bounds;
        private final Set<UUID> existing = new HashSet<>();
        @SuppressWarnings("unchecked") Fixture(ServerLevel level, BlockPos origin) {
            this.level = level; this.origin = origin;
            bounds = new AABB(origin.getX() - 4, origin.getY() - 4, origin.getZ() - 4,
                    origin.getX() + 5, origin.getY() + 5, origin.getZ() + 5);
            try {
                var manager = ServerLevel.class.getDeclaredField("entityManager"); manager.setAccessible(true);
                var storage = PersistentEntitySectionManager.class.getDeclaredField("sectionStorage"); storage.setAccessible(true);
                sections = (EntitySectionStorage<Entity>) storage.get(manager.get(level));
            } catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
            all().forEach(entity -> existing.add(entity.getUUID()));
        }
        private List<Entity> all() {
            return sections.getExistingSectionsInChunk(ChunkPos.pack(origin.getX() >> 4, origin.getZ() >> 4))
                    .flatMap(EntitySection::getEntities).filter(entity -> !entity.isRemoved() && bounds.intersects(entity.getBoundingBox())
                            && (entity instanceof ItemEntity || entity instanceof ExperienceOrb)).toList();
        }
        private List<Entity> created() { return all().stream().filter(entity -> !existing.contains(entity.getUUID())).toList(); }
        void set(BlockPos pos, BlockState state) { original.putIfAbsent(pos.immutable(), level.getBlockState(pos)); level.setBlock(pos, state, 2); }
        int drops(Item item) { return created().stream().filter(entity -> entity instanceof ItemEntity drop && drop.getItem().is(item))
                .mapToInt(entity -> ((ItemEntity) entity).getItem().getCount()).sum(); }
        long experienceOrbs() { return created().stream().filter(entity -> entity instanceof ExperienceOrb).count(); }
        void reset() { created().forEach(Entity::discard); original.forEach((pos, state) -> level.setBlock(pos, state, 2)); original.clear(); }
        @Override public void close() { reset(); }
    }
}
