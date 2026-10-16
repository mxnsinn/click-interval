package dev.serverenchantments.fabric;

import com.mojang.authlib.GameProfile;
import dev.serverenchantments.fabric.core.HarvestArea;
import dev.serverenchantments.fabric.core.HarvestBudget;
import dev.serverenchantments.fabric.core.TreeScan;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.entity.EntitySection;
import net.minecraft.world.level.entity.EntitySectionStorage;
import net.minecraft.world.level.entity.PersistentEntitySectionManager;
import net.minecraft.world.phys.AABB;
import org.slf4j.LoggerFactory;

import java.util.*;

/** Native integration checks, called only by the explicitly opted-in disposable-world selftest. */
final class HarvesterSelfTest {
    private static final UUID PLAYER_ID = UUID.fromString("cc7c949b-f06d-458b-8f02-4cc4067a07dd");
    private HarvesterSelfTest() { }

    static void run(MinecraftServer server, ServerEnchantmentsFabric mod) {
        ServerLevel level = server.overworld();
        Holder<Enchantment> enchantment = server.registryAccess().lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(
                ResourceKey.create(Registries.ENCHANTMENT, Identifier.fromNamespaceAndPath("serverenchantments", "harvester_sweep")));
        require(enchantment.value().getMaxLevel() == 3, "three Harvester levels");
        require(enchantment.value().isSupportedItem(new ItemStack(Items.DIAMOND_HOE)), "hoe support");
        require(!enchantment.value().isSupportedItem(new ItemStack(Items.DIAMOND_PICKAXE)), "pickaxe rejected");
        GameProfile profile = new GameProfile(PLAYER_ID, "HarvesterTest");
        ServerPlayer player = new ServerPlayer(server, level, profile, ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player,
                CommonListenerCookie.createInitial(profile, false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        BlockPos origin = new BlockPos(168, level.getMaxY() - 16, 168);
        level.getChunk(origin.getX() >> 4, origin.getZ() >> 4);
        player.setPos(origin.getX() + .5, origin.getY(), origin.getZ() + 2.5);
        BlockPos[] deniedBreak = {null};
        boolean[] denyPlacement = {false};
        PlayerBlockBreakEvents.BEFORE.register((world, actor, pos, state, blockEntity) ->
                !PLAYER_ID.equals(actor.getUUID()) || !pos.equals(deniedBreak[0]));
        UseBlockCallback.EVENT.register((actor, world, hand, hit) ->
                PLAYER_ID.equals(actor.getUUID()) && denyPlacement[0] ? InteractionResult.FAIL : InteractionResult.PASS);
        HarvestBudget original = budget(mod);
        try (Farm farm = new Farm(level, origin)) {
            setBudget(mod, new HarvestBudget(Long.MAX_VALUE));
            for (int tier = 1; tier <= 3; tier++) for (float yaw : new float[]{0, 90}) {
                farm.reset(); farm.wheat(); player.getInventory().clearContent(); player.setYRot(yaw);
                ItemStack hoe = equip(player, enchantment, tier);
                player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64));
                mod.beginTick(server);
                require(player.gameMode.destroyBlock(origin), "native crop center break");
                advance(server, mod);
                Set<BlockPos> cells = cells(origin, yaw == 0, tier);
                farm.assertHarvest(cells, tier >= 2);
                require(player.getInventory().getItem(9).getCount() == 64 - (tier >= 2 ? cells.size() : 0), "one inventory seed per replanted cell");
                int actualWheat = farm.drops(Items.WHEAT);
                LoggerFactory.getLogger("serverenchantments_fabric").info(
                        "SERVER_HARVESTER_NATIVE_LOOT: tier={}, yaw={}, expectedWheat={}, actualWheat={}, inventorySeeds={}",
                        tier, yaw, cells.size(), actualWheat, player.getInventory().getItem(9).getCount());
                require(actualWheat == cells.size(), "one native wheat drop per mature crop; tier=" + tier + ", yaw=" + yaw
                        + ", expected=" + cells.size() + ", actual=" + actualWheat);
                require(hoe.getDamageValue() == 0, "zero-hardness crops preserve native hoe durability behavior");
            }

            // Immature neighbors and unrelated blocks are never harvested or replanted.
            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64));
            BlockPos immature = origin.offset(-1, 0, -1), stone = origin.offset(1, 0, 1);
            farm.set(immature, ((CropBlock) Blocks.WHEAT).getStateForAge(3)); farm.set(stone, Blocks.STONE.defaultBlockState());
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "mixed maturity center"); advance(server, mod);
            require(((CropBlock) Blocks.WHEAT).getAge(level.getBlockState(immature)) == 3, "immature crop left intact");
            require(level.getBlockState(stone).is(Blocks.STONE), "stone left intact");
            require(player.getInventory().getItem(9).getCount() == 57 && farm.drops(Items.WHEAT) == 7, "only seven ripe cells consume seeds and drop wheat");

            // Each supported crop replants its own native planting item, never wheat everywhere.
            for (Block crop : List.of(Blocks.CARROTS, Blocks.POTATOES, Blocks.BEETROOTS)) {
                farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
                BlockState ripe = ((CropBlock) crop).getStateForAge(((CropBlock) crop).getMaxAge());
                farm.set(origin, ripe);
                Item seed = CropHarvest.plantingItem(ripe);
                player.getInventory().setItem(35, new ItemStack(seed, 2));
                mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "native other crop break"); advance(server, mod);
                require(level.getBlockState(origin).is(crop) && ((CropBlock) crop).getAge(level.getBlockState(origin)) == 0, "matching crop replanted");
                require(player.getInventory().getItem(35).getCount() == 1, "matching planting item consumed once");
            }

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 3);
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "zero-seed center"); advance(server, mod);
            farm.assertHarvest(cells(origin, true, 3), false);
            require(farm.drops(Items.WHEAT) == 25, "no-seed harvest retains native world drops");

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(35, new ItemStack(Items.WHEAT_SEEDS));
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "last-seed center"); advance(server, mod);
            require(player.getInventory().getItem(35).isEmpty(), "last seed consumed exactly once");
            require(level.getBlockState(origin).is(Blocks.WHEAT), "center gets first available seed");
            for (BlockPos pos : cells(origin, true, 2)) if (!pos.equals(origin)) require(level.getBlockState(pos).isAir(), "no invented extra seeds");

            farm.reset(); farm.wheat(); player.getInventory().clearContent();
            for (int slot = 0; slot < 36; slot++) player.getInventory().setItem(slot, new ItemStack(Items.DIAMOND, 64));
            equip(player, enchantment, 2); player.getInventory().setItem(35, new ItemStack(Items.WHEAT_SEEDS, 64));
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "full-inventory center"); advance(server, mod);
            require(player.getInventory().getItem(35).getCount() == 55 && farm.drops(Items.WHEAT) == 9, "full inventory spends seeds in last slot and leaves drops in world");

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64));
            deniedBreak[0] = origin.offset(-1, 0, -1);
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "break cancellation center"); advance(server, mod);
            require(CropHarvest.isRipe(level.getBlockState(deniedBreak[0])), "native BEFORE cancellation keeps crop");
            require(player.getInventory().getItem(9).getCount() == 63 && farm.drops(Items.WHEAT) == 1, "denied crop consumes no seed or loot and stops job");
            deniedBreak[0] = null;

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64)); denyPlacement[0] = true;
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "placement cancellation center"); advance(server, mod);
            farm.assertHarvest(cells(origin, true, 2), false);
            require(player.getInventory().getItem(9).getCount() == 64 && farm.drops(Items.WHEAT) == 9, "placement cancellation consumes no seeds, native harvest remains");
            denyPlacement[0] = false;

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS));
            BlockState ripe = level.getBlockState(origin);
            farm.set(origin, Blocks.AIR.defaultBlockState()); farm.set(origin.below(), Blocks.DIRT.defaultBlockState());
            require(!CropHarvest.replant(player, level, origin, ripe), "invalid soil cannot replant");
            require(player.getInventory().getItem(9).getCount() == 1, "invalid soil does not spend seed");

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 3);
            mod.beginTick(server); budget(mod).reset(0, 0);
            require(player.gameMode.destroyBlock(origin), "exhausted budget native center");
            require(farm.drops(Items.WHEAT) == 1, "automatic work shares depleted budget");
            advance(server, mod); require(farm.drops(Items.WHEAT) == 25, "next-tick bounded continuation completes");

            // A second manual center can arrive before the shared neighbor-work budget recovers.
            // It must still be replanted; the previous sweep never visits this outside center.
            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64));
            BlockPos rapidCenter = origin.offset(2, 0, 0);
            mod.beginTick(server); budget(mod).reset(0, 0);
            require(player.gameMode.destroyBlock(origin), "first rapid crop center");
            require(player.gameMode.destroyBlock(rapidCenter), "second rapid crop center with prior work queued");
            advance(server, mod);
            require(level.getBlockState(origin).is(Blocks.WHEAT) && level.getBlockState(rapidCenter).is(Blocks.WHEAT),
                    "both manual centers replant even while neighbor work is queued");
            require(player.getInventory().getItem(9).getCount() == 54 && farm.drops(Items.WHEAT) == 10,
                    "queued rapid harvest has ten native drops and ten paid replants");

            // Holding attack can send another break for the same zero-hardness crop immediately
            // after age0 is restored. Protect immature crops unless the player deliberately sneaks.
            require(!player.gameMode.destroyBlock(origin), "held attack cannot destroy freshly replanted crop");
            require(player.getInventory().getItem(9).getCount() == 54 && farm.drops(Items.WHEAT) == 10,
                    "repeated attack neither spends another seed nor duplicates ripe loot");
            player.setShiftKeyDown(true);
            require(player.gameMode.destroyBlock(origin), "sneak explicitly bypasses immature crop protection");
            require(level.getBlockState(origin).isAir(), "sneak removes young crop without replanting");
            player.setShiftKeyDown(false);

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.setItemInHand(InteractionHand.OFF_HAND, new ItemStack(Items.WHEAT_SEEDS, 64));
            mod.beginTick(server); require(player.gameMode.destroyBlock(origin), "offhand-only planting supply"); advance(server, mod);
            farm.assertHarvest(cells(origin, true, 2), true);
            require(player.getOffhandItem().getCount() == 55, "offhand inventory supplies pay one seed per crop");
            player.setItemInHand(InteractionHand.OFF_HAND, ItemStack.EMPTY);

            farm.reset(); farm.wheat(); player.getInventory().clearContent(); equip(player, enchantment, 2);
            player.getInventory().setItem(9, new ItemStack(Items.WHEAT_SEEDS, 64)); deniedBreak[0] = origin;
            mod.beginTick(server); require(!player.gameMode.destroyBlock(origin), "denied original crop break"); advance(server, mod);
            require(CropHarvest.isRipe(level.getBlockState(origin)) && player.getInventory().getItem(9).getCount() == 64
                    && farm.drops(Items.WHEAT) == 0, "denied original never spends seed or yields loot");
            deniedBreak[0] = null;

            LoggerFactory.getLogger("serverenchantments_fabric").info("SERVER_HARVESTER_REPLANT_SELFTEST_PASS: queued rapid manual centers, held-attack young-crop protection, sneak bypass, offhand seeds and denied original break.");

            LoggerFactory.getLogger("serverenchantments_fabric").info("SERVER_HARVESTER_SELFTEST_PASS: native 3/9/25 crops, four seed types, ripe-only, no-seed/last-seed/full-inventory, BEFORE/placement cancellation, invalid soil, exact loot and shared-budget continuation.");
        } finally {
            player.setShiftKeyDown(false); player.setItemInHand(InteractionHand.OFF_HAND, ItemStack.EMPTY);
            setBudget(mod, original); mod.beginTick(server); player.discard();
        }
    }

    private static ItemStack equip(ServerPlayer player, Holder<Enchantment> enchantment, int tier) {
        ItemStack hoe = new ItemStack(Items.DIAMOND_HOE); hoe.enchant(enchantment, tier);
        player.setItemInHand(InteractionHand.MAIN_HAND, hoe); return hoe;
    }
    private static Set<BlockPos> cells(BlockPos origin, boolean alongX, int tier) {
        Set<BlockPos> cells = new HashSet<>(); cells.add(origin);
        HarvestArea.extras(new TreeScan.Point(origin.getX(), origin.getY(), origin.getZ()), alongX, tier)
                .forEach(p -> cells.add(new BlockPos(p.x(), p.y(), p.z()))); return cells;
    }
    private static void advance(MinecraftServer server, ServerEnchantmentsFabric mod) {
        for (int index = 0; index < 5; index++) { mod.beginTick(server); mod.tick(server); }
    }
    private static HarvestBudget budget(ServerEnchantmentsFabric mod) {
        try { var field = ServerEnchantmentsFabric.class.getDeclaredField("budget"); field.setAccessible(true); return (HarvestBudget) field.get(mod); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException(e); }
    }
    private static void setBudget(ServerEnchantmentsFabric mod, HarvestBudget budget) {
        try { var field = ServerEnchantmentsFabric.class.getDeclaredField("budget"); field.setAccessible(true); field.set(mod, budget); }
        catch (ReflectiveOperationException e) { throw new IllegalStateException(e); }
    }
    private static void require(boolean condition, String message) { if (!condition) throw new IllegalStateException("Harvester: " + message); }

    private static final class Farm implements AutoCloseable {
        final ServerLevel level; final BlockPos origin;
        final Map<BlockPos, BlockState> originals = new LinkedHashMap<>();
        final EntitySectionStorage<Entity> sections; final Set<UUID> oldItems = new HashSet<>(); final AABB area;
        @SuppressWarnings("unchecked") Farm(ServerLevel level, BlockPos origin) {
            this.level = level; this.origin = origin;
            area = new AABB(origin.getX() - 3, origin.getY() - 2, origin.getZ() - 3, origin.getX() + 4, origin.getY() + 3, origin.getZ() + 4);
            try {
                var manager = ServerLevel.class.getDeclaredField("entityManager"); manager.setAccessible(true);
                var storage = PersistentEntitySectionManager.class.getDeclaredField("sectionStorage"); storage.setAccessible(true);
                sections = (EntitySectionStorage<Entity>) storage.get(manager.get(level));
            } catch (ReflectiveOperationException e) { throw new IllegalStateException(e); }
            items().forEach(item -> oldItems.add(item.getUUID()));
        }
        void set(BlockPos pos, BlockState state) { originals.putIfAbsent(pos.immutable(), level.getBlockState(pos)); level.setBlock(pos, state, 2); }
        void wheat() {
            for (int z = -2; z <= 2; z++) for (int x = -2; x <= 2; x++) {
                BlockPos pos = origin.offset(x, 0, z); set(pos.below(), Blocks.FARMLAND.defaultBlockState());
                set(pos, ((CropBlock) Blocks.WHEAT).getStateForAge(7));
            }
        }
        void assertHarvest(Set<BlockPos> selected, boolean replanted) {
            for (int z = -2; z <= 2; z++) for (int x = -2; x <= 2; x++) {
                BlockPos pos = origin.offset(x, 0, z); BlockState state = level.getBlockState(pos);
                if (!selected.contains(pos)) require(CropHarvest.isRipe(state), "unselected mature crop intact at " + pos);
                else if (replanted) require(state.is(Blocks.WHEAT) && ((CropBlock) Blocks.WHEAT).getAge(state) == 0, "selected crop replanted age0 at " + pos);
                else require(state.isAir(), "selected crop not replanted at " + pos);
            }
        }
        List<ItemEntity> items() {
            return sections.getExistingSectionsInChunk(ChunkPos.pack(origin.getX() >> 4, origin.getZ() >> 4))
                    .flatMap(EntitySection::getEntities).filter(entity -> entity instanceof ItemEntity)
                    .map(entity -> (ItemEntity) entity).filter(item -> !item.isRemoved() && area.intersects(item.getBoundingBox())).toList();
        }
        int drops(Item item) { return items().stream().filter(e -> !oldItems.contains(e.getUUID()) && e.getItem().is(item)).mapToInt(e -> e.getItem().getCount()).sum(); }
        void reset() {
            items().stream().filter(e -> !oldItems.contains(e.getUUID())).forEach(ItemEntity::discard);
            originals.forEach((pos, state) -> level.setBlock(pos, state, 2)); originals.clear();
            // Restoring the pre-fixture air below untouched crops can legitimately pop those
            // crops via vanilla shape updates. Those teardown-only drops belong to this fixture,
            // not the next harvest measurement, so remove them after restoration as well.
            items().stream().filter(e -> !oldItems.contains(e.getUUID())).forEach(ItemEntity::discard);
        }
        @Override public void close() { reset(); }
    }
}
