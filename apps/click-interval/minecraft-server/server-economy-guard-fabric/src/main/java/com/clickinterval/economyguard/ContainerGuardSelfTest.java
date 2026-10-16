package com.clickinterval.economyguard;

import com.mojang.authlib.GameProfile;
import it.unimi.dsi.fastutil.ints.Int2ObjectOpenHashMap;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.Connection;
import net.minecraft.network.HashedStack;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.network.protocol.game.ServerboundContainerClickPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.CompoundContainer;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.vehicle.VehicleEntity;
import net.minecraft.world.entity.vehicle.boat.AbstractChestBoat;
import net.minecraft.world.entity.vehicle.minecart.AbstractMinecartContainer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.ShulkerBoxMenu;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemContainerContents;
import net.minecraft.world.level.Explosion;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.ServerExplosion;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.entity.HopperBlockEntity;
import net.minecraft.world.level.block.entity.ShulkerBoxBlockEntity;
import net.minecraft.world.level.block.state.properties.ChestType;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.TagValueOutput;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Opt-in, isolated-world native tests. Never enabled in a user's saved world. */
final class ContainerGuardSelfTest {
    private static final BlockPos ORIGIN = new BlockPos(47, 240, 48);
    private static final AABB AREA = new AABB(ORIGIN).inflate(16);

    static void run(MinecraftServer server) {
        ServerLevel level = server.overworld();
        level.getChunk(ORIGIN);
        level.getChunk(ORIGIN.east());
        ServerPlayer player = player(server);
        player.setPos(ORIGIN.getX() + .5, ORIGIN.getY(), ORIGIN.getZ() + 2);
        try {
            doubleChest(level, player);
            shulker(level, player, false);
            shulker(level, player, true);
            hopper(level);
            for (Entity.RemovalReason reason : List.of(Entity.RemovalReason.CHANGED_DIMENSION, Entity.RemovalReason.UNLOADED_TO_CHUNK)) {
                vehicle(level, EntityTypes.CHEST_MINECART, Items.CHEST_MINECART, reason);
                vehicle(level, EntityTypes.HOPPER_MINECART, Items.HOPPER_MINECART, reason);
                vehicle(level, EntityTypes.OAK_CHEST_BOAT, Items.OAK_CHEST_BOAT, reason);
            }
            LoggerFactory.getLogger("servereconomyguard").info("SERVER_ECONOMY_CONTAINER_TEST_PASS: chunk-border double-chest conservation, stale packet rejection, normal/explosion shulker contents, container-vehicle unload/transfer save roundtrip, stale removal/destruction rejection, hopper pickup/remainder conservation, legitimate drops exactly once.");
        } finally {
            player.containerMenu = player.inventoryMenu;
            player.discard();
            clearDrops(level);
            level.setBlock(ORIGIN, Blocks.AIR.defaultBlockState(), Block.UPDATE_SKIP_ALL_SIDEEFFECTS);
            level.setBlock(ORIGIN.east(), Blocks.AIR.defaultBlockState(), Block.UPDATE_SKIP_ALL_SIDEEFFECTS);
        }
    }

    private static void doubleChest(ServerLevel level, ServerPlayer player) {
        clearDrops(level);
        var leftState = Blocks.CHEST.defaultBlockState().setValue(ChestBlock.FACING, Direction.NORTH).setValue(ChestBlock.TYPE, ChestType.LEFT);
        var rightState = leftState.setValue(ChestBlock.TYPE, ChestType.RIGHT);
        level.setBlock(ORIGIN, leftState, Block.UPDATE_CLIENTS);
        level.setBlock(ORIGIN.east(), rightState, Block.UPDATE_CLIENTS);
        ChestBlockEntity left = (ChestBlockEntity) level.getBlockEntity(ORIGIN);
        ChestBlockEntity right = (ChestBlockEntity) level.getBlockEntity(ORIGIN.east());
        require(left != null && right != null, "both chest halves exist across chunk border");
        left.setItem(0, new ItemStack(Items.DIAMOND, 17));
        right.setItem(0, new ItemStack(Items.EMERALD, 19));
        ChestMenu oldMenu = ChestMenu.sixRows(201, player.getInventory(), new CompoundContainer(left, right));
        player.containerMenu = oldMenu;
        require(oldMenu.stillValid(player), "native double chest menu initially valid");
        require(level.destroyBlock(ORIGIN, true), "first chest half breaks");
        require(!oldMenu.stillValid(player), "old double chest menu invalid immediately after half breaks");
        staleClick(player, oldMenu, 27);
        require(oldMenu.getCarried().isEmpty() && right.getItem(0).getCount() == 19, "delayed chest click cannot take items through stale menu");
        require(countDrops(level, Items.DIAMOND) == 17 && countDrops(level, Items.EMERALD) == 0, "only broken chest half emits its inventory");
        require(!level.destroyBlock(ORIGIN, true), "repeated chest break has no source block");
        require(level.destroyBlock(ORIGIN.east(), true), "second chest half breaks");
        require(countDrops(level, Items.DIAMOND) == 17 && countDrops(level, Items.EMERALD) == 19, "both inventories conserved exactly once");
        player.containerMenu = player.inventoryMenu;
    }

    private static void shulker(ServerLevel level, ServerPlayer player, boolean explosion) {
        clearDrops(level);
        level.setBlock(ORIGIN, Blocks.DYED_SHULKER_BOX.purple().defaultBlockState(), Block.UPDATE_CLIENTS);
        ShulkerBoxBlockEntity box = (ShulkerBoxBlockEntity) level.getBlockEntity(ORIGIN);
        require(box != null, "shulker exists");
        box.setItem(0, new ItemStack(Items.DIAMOND, 23));
        box.setItem(12, new ItemStack(Items.EMERALD, 11));
        ShulkerBoxMenu oldMenu = new ShulkerBoxMenu(202, player.getInventory(), box);
        player.containerMenu = oldMenu;
        require(oldMenu.stillValid(player), "native shulker menu initially valid");
        List<ItemStack> outputs = new ArrayList<>();
        if (explosion) {
            var blast = new ServerExplosion(level, null, null, null, Vec3.atCenterOf(ORIGIN), 2, false, Explosion.BlockInteraction.DESTROY);
            level.getBlockState(ORIGIN).onExplosionHit(level, ORIGIN, blast, (stack, pos) -> outputs.add(stack.copy()));
            level.getBlockState(ORIGIN).onExplosionHit(level, ORIGIN, blast, (stack, pos) -> outputs.add(stack.copy()));
        } else {
            require(level.destroyBlock(ORIGIN, true), "ordinary shulker breaks");
            require(!level.destroyBlock(ORIGIN, true), "repeated shulker break has no source block");
            for (ItemEntity entity : drops(level)) outputs.add(entity.getItem().copy());
        }
        require(!oldMenu.stillValid(player), "removed shulker menu invalid immediately");
        staleClick(player, oldMenu, 0);
        require(oldMenu.getCarried().isEmpty(), "delayed shulker click cannot extract the boxed inventory again");
        require(outputs.stream().filter(s -> s.is(Items.DYED_SHULKER_BOX.purple())).mapToInt(ItemStack::getCount).sum() == 1, "exactly one legitimate shulker item");
        require(outputs.stream().noneMatch(s -> s.is(Items.DIAMOND) || s.is(Items.EMERALD)), "shulker does not separately spill contained items");
        int diamonds = 0, emeralds = 0;
        for (ItemStack output : outputs) for (ItemStack nested : output.getOrDefault(DataComponents.CONTAINER, ItemContainerContents.EMPTY).nonEmptyItemCopyStream().toList()) {
            if (nested.is(Items.DIAMOND)) diamonds += nested.getCount();
            if (nested.is(Items.EMERALD)) emeralds += nested.getCount();
        }
        require(diamonds == 23 && emeralds == 11, "normal and explosion drops preserve shulker contents exactly once");
        player.containerMenu = player.inventoryMenu;
    }

    private static <T extends VehicleEntity> void vehicle(ServerLevel level, EntityType<T> type, Item vehicleItem, Entity.RemovalReason removal) {
        clearDrops(level);
        T source = type.create(level, EntitySpawnReason.COMMAND);
        require(source instanceof Container, "container vehicle fixture");
        source.setPos(ORIGIN.getX() + .5, ORIGIN.getY(), ORIGIN.getZ() + .5);
        ((Container) source).setItem(0, new ItemStack(Items.DIAMOND, 29));
        var saved = TagValueOutput.createWithContext(ProblemReporter.DISCARDING, level.registryAccess());
        source.saveWithoutId(saved);
        source.remove(removal);
        require(source.isRemoved() && ((Container) source).getItem(0).getCount() == 29, "transfer/unload retains serialized source data without dropping it");
        require(drops(level).isEmpty(), "unload/transfer creates no item drops");
        T loaded = type.create(level, EntitySpawnReason.COMMAND);
        require(loaded instanceof Container, "loaded container fixture");
        loaded.load(TagValueInput.create(ProblemReporter.DISCARDING, level.registryAccess(), saved.buildResult()));
        loaded.setPos(ORIGIN.getX() + 1.5, ORIGIN.getY(), ORIGIN.getZ() + .5);
        require(((Container) loaded).getItem(0).getCount() == 29, "native save/load keeps destination inventory across chunk boundary");
        source.remove(Entity.RemovalReason.DISCARDED);
        destroy(source, level);
        require(drops(level).isEmpty(), "stale transferred/unloaded source cannot emit duplicated contents or vehicle");
        require(((Container) loaded).getItem(0).getCount() == 29, "guard leaves legitimate loaded inventory untouched");
        destroy(loaded, level);
        destroy(loaded, level);
        loaded.remove(Entity.RemovalReason.DISCARDED);
        require(countDrops(level, Items.DIAMOND) == 29 && countDrops(level, vehicleItem) == 1, "legitimate vehicle destruction pays exactly once despite repeated callbacks");
    }

    private static void destroy(VehicleEntity vehicle, ServerLevel level) {
        if (vehicle instanceof AbstractMinecartContainer cart) cart.destroy(level, level.damageSources().generic());
        else ((AbstractChestBoat) vehicle).destroy(level, level.damageSources().generic());
    }
    private static void hopper(ServerLevel level) {
        for (Entity.RemovalReason removal : List.of(Entity.RemovalReason.CHANGED_DIMENSION, Entity.RemovalReason.UNLOADED_TO_CHUNK)) {
            SimpleContainer inventory = new SimpleContainer(5);
            ItemEntity source = new ItemEntity(level, ORIGIN.getX(), ORIGIN.getY(), ORIGIN.getZ(), new ItemStack(Items.DIAMOND, 13));
            source.remove(removal);
            require(!HopperBlockEntity.addItem(inventory, source) && inventory.isEmpty(), "hopper rejects stale transferred/unloaded item");
            ItemEntity legitimate = new ItemEntity(level, ORIGIN.getX(), ORIGIN.getY(), ORIGIN.getZ(), new ItemStack(Items.DIAMOND, 13));
            require(HopperBlockEntity.addItem(inventory, legitimate), "hopper still collects legitimate item");
            HopperBlockEntity.addItem(inventory, legitimate);
            require(inventory.getItem(0).getCount() == 13 && legitimate.isRemoved(), "repeated hopper pickup conserves quantity");
        }
        SimpleContainer nearlyFull = new SimpleContainer(1);
        nearlyFull.setItem(0, new ItemStack(Items.DIAMOND, 62));
        ItemEntity remainder = new ItemEntity(level, ORIGIN.getX(), ORIGIN.getY(), ORIGIN.getZ(), new ItemStack(Items.DIAMOND, 7));
        require(!HopperBlockEntity.addItem(nearlyFull, remainder), "partial hopper pickup reports remaining entity");
        require(nearlyFull.getItem(0).getCount() == 64 && remainder.getItem().getCount() == 5 && !remainder.isRemoved(), "partial pickup preserves exact remainder");
        remainder.discard();
    }
    private static void staleClick(ServerPlayer player, AbstractContainerMenu menu, int slot) {
        player.connection.handleContainerClick(new ServerboundContainerClickPacket(menu.containerId, menu.getStateId(), (short) slot,
                (byte) 0, ContainerInput.PICKUP, new Int2ObjectOpenHashMap<>(), HashedStack.EMPTY));
    }
    private static ServerPlayer player(MinecraftServer server) {
        GameProfile profile = new GameProfile(UUID.fromString("25ef9f2c-2039-4252-a2b8-592647dfd9bc"), "ContainerGuard");
        ServerPlayer player = new ServerPlayer(server, server.overworld(), profile, ClientInformation.createDefault());
        player.connection = new ServerGamePacketListenerImpl(server, new Connection(PacketFlow.SERVERBOUND), player, CommonListenerCookie.createInitial(profile, false));
        player.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);
        return player;
    }
    private static List<ItemEntity> drops(ServerLevel level) { return level.getEntitiesOfClass(ItemEntity.class, AREA, entity -> !entity.isRemoved()); }
    private static int countDrops(ServerLevel level, Item item) { return drops(level).stream().map(ItemEntity::getItem).filter(s -> s.is(item)).mapToInt(ItemStack::getCount).sum(); }
    private static void clearDrops(ServerLevel level) { for (ItemEntity entity : drops(level)) entity.discard(); }
    private static void require(boolean value, String message) { if (!value) throw new IllegalStateException("Container guard selftest: " + message); }
}
