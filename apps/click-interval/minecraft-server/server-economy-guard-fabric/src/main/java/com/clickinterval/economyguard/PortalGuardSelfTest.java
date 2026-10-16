package com.clickinterval.economyguard;

import com.mojang.authlib.GameProfile;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.Stat;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.item.FallingBlockEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.vehicle.minecart.AbstractMinecartContainer;
import net.minecraft.world.entity.vehicle.minecart.MinecartChest;
import net.minecraft.world.entity.vehicle.minecart.MinecartHopper;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.portal.TeleportTransition;
import net.minecraft.world.phys.Vec3;
import org.slf4j.LoggerFactory;

import java.util.UUID;

/** Native, disposable-world-only checks; no players, client input or live data. */
public final class PortalGuardSelfTest {
    private PortalGuardSelfTest() { }

    public static void run(MinecraftServer server) {
        ServerLevel overworld = server.overworld();
        ServerLevel end = server.getLevel(Level.END);
        require(end != null, "End exists in disposable test server");
        Block[] materials = { Blocks.SAND, Blocks.RED_SAND, Blocks.GRAVEL,
                Blocks.CONCRETE_POWDER.white(), Blocks.DRAGON_EGG, Blocks.ANVIL };
        int index = 0;
        for (Block material : materials) {
            fallingTransfer(overworld, end, material, index++);
            fallingTransfer(end, overworld, material, index++);
        }
        normalFalling(overworld);
        itemTransfer(server, overworld, end);
        containerTransfer(overworld, end, false);
        containerTransfer(overworld, end, true);
        duplicateUuidAndChunkMove(overworld);
        LoggerFactory.getLogger("ServerEconomyGuard").info("SERVER_ECONOMY_PORTAL_TEST_PASS: 12 cross-End falling-block transfers preserve exactly one placed result; normal falling blocks, item transfers, exact-once pickup and stale portal-source pickup rejection, chest/hopper minecart cargo, source replay rejection, same-UUID refusal and chunk-border identity.");
    }

    private static TeleportTransition destination(ServerLevel level, Vec3 position) {
        return new TeleportTransition(level, position, Vec3.ZERO, 0, 0, TeleportTransition.DO_NOTHING);
    }

    private static void fallingTransfer(ServerLevel sourceLevel, ServerLevel targetLevel, Block material, int index) {
        BlockPos origin = new BlockPos(64 + index * 4, 96, 64);
        BlockPos destination = new BlockPos(64 + index * 4, 96, 80);
        sourceLevel.getChunk(origin);
        targetLevel.getChunk(destination);
        var sourceBefore = sourceLevel.getBlockState(origin);
        var sourceFloor = sourceLevel.getBlockState(origin.below());
        var targetBefore = targetLevel.getBlockState(destination);
        var targetFloor = targetLevel.getBlockState(destination.below());
        FallingBlockEntity source = null;
        FallingBlockEntity target = null;
        try {
            sourceLevel.setBlock(origin.below(), Blocks.STONE.defaultBlockState(), 3);
            targetLevel.setBlock(destination.below(), Blocks.STONE.defaultBlockState(), 3);
            sourceLevel.setBlock(origin, material.defaultBlockState(), 3);
            targetLevel.setBlock(destination, Blocks.AIR.defaultBlockState(), 3);
            source = FallingBlockEntity.fall(sourceLevel, origin, material.defaultBlockState());
            source.setDeltaMovement(Vec3.ZERO);
            source.setOnGround(true);
            Entity transported = source.teleport(destination(targetLevel, Vec3.atBottomCenterOf(destination)));
            require(transported instanceof FallingBlockEntity, "falling transport allowed: " + material);
            target = (FallingBlockEntity) transported;
            require(source.isRemoved(), "successful transfer retires source: " + material);
            source.tick(); // Reproduce the removed-source tail tick that otherwise creates the extra block.
            require(sourceLevel.getBlockState(origin).isAir(), "source has no duplicate block: " + material);
            require(!source.forceTickAfterTeleportToDuplicate, "removed source cannot continue duplicate placement: " + material);
            require(source.teleport(destination(targetLevel, Vec3.atBottomCenterOf(destination))) == null,
                    "replaying removed source transfer rejected: " + material);
            target.setDeltaMovement(Vec3.ZERO);
            target.setOnGround(true);
            target.tick();
            require(targetLevel.getBlockState(destination).is(material), "exact destination block retained: " + material);
            require(target.isRemoved(), "destination falling entity consumed once: " + material);
        } finally {
            if (source != null && !source.isRemoved()) source.discard();
            if (target != null && !target.isRemoved()) target.discard();
            sourceLevel.setBlock(origin, sourceBefore, 3);
            sourceLevel.setBlock(origin.below(), sourceFloor, 3);
            targetLevel.setBlock(destination, targetBefore, 3);
            targetLevel.setBlock(destination.below(), targetFloor, 3);
        }
    }

    private static void normalFalling(ServerLevel level) {
        BlockPos pos = new BlockPos(64, 96, 100);
        level.getChunk(pos);
        var original = level.getBlockState(pos);
        var floor = level.getBlockState(pos.below());
        try {
            level.setBlock(pos.below(), Blocks.STONE.defaultBlockState(), 3);
            level.setBlock(pos, Blocks.SAND.defaultBlockState(), 3);
            FallingBlockEntity sand = FallingBlockEntity.fall(level, pos, Blocks.SAND.defaultBlockState());
            sand.setDeltaMovement(Vec3.ZERO);
            sand.setOnGround(true);
            sand.tick();
            require(sand.isRemoved() && level.getBlockState(pos).is(Blocks.SAND), "ordinary sand falls and lands normally");
        } finally {
            level.setBlock(pos, original, 3);
            level.setBlock(pos.below(), floor, 3);
        }
    }

    private static void itemTransfer(MinecraftServer server, ServerLevel sourceLevel, ServerLevel targetLevel) {
        ItemEntity source = new ItemEntity(sourceLevel, 160, 96, 64, new ItemStack(Items.DIAMOND, 19));
        sourceLevel.getChunk(source.blockPosition());
        targetLevel.getChunk(new BlockPos(160, 96, 80));
        require(sourceLevel.addFreshEntity(source), "source item registered");
        Entity result = source.teleport(destination(targetLevel, new Vec3(160, 96, 80)));
        require(result instanceof ItemEntity, "ordinary item portal transfer remains allowed");
        ItemEntity target = (ItemEntity) result;
        try {
            require(source.isRemoved() && target.isAlive(), "exactly one live transferred item entity");
            require(target.getUUID().equals(source.getUUID()), "item identity retained across dimension");
            require(target.getItem().is(Items.DIAMOND) && target.getItem().getCount() == 19,
                    "portal preserves exact item count");
            require(source.teleport(destination(targetLevel, new Vec3(164, 96, 80))) == null,
                    "removed item source cannot be transferred twice");
            TestPlayer player = new TestPlayer(server, targetLevel);
            source.setNoPickUpDelay();
            source.playerTouch(player);
            require(countDiamonds(player) == 0, "removed portal-source callback cannot duplicate its serialized item");
            target.setNoPickUpDelay();
            target.playerTouch(player);
            require(target.isRemoved() && countDiamonds(player) == 19, "normal destination pickup preserves exact count");
            target.playerTouch(player);
            require(countDiamonds(player) == 19, "repeated stale pickup cannot duplicate restored native item stack");
        } finally { target.discard(); }
    }

    private static int countDiamonds(TestPlayer player) {
        int count = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (stack.is(Items.DIAMOND)) count += stack.getCount();
        }
        return count;
    }

    private static final class TestPlayer extends ServerPlayer {
        TestPlayer(MinecraftServer server, ServerLevel level) {
            super(server, level, new GameProfile(UUID.randomUUID(), "EconomyPickup"), ClientInformation.createDefault());
        }
        @Override public void take(Entity entity, int amount) { }
        @Override public void awardStat(Stat<?> stat, int amount) { }
        @Override public void onItemPickup(ItemEntity item) { }
    }

    private static void containerTransfer(ServerLevel sourceLevel, ServerLevel targetLevel, boolean hopper) {
        AbstractMinecartContainer source = hopper
                ? new MinecartHopper(EntityTypes.HOPPER_MINECART, sourceLevel)
                : new MinecartChest(EntityTypes.CHEST_MINECART, sourceLevel);
        source.setPos(176 + (hopper ? 4 : 0), 96, 64);
        source.setItem(0, new ItemStack(Items.EMERALD, 23));
        sourceLevel.getChunk(source.blockPosition());
        targetLevel.getChunk(new BlockPos(176 + (hopper ? 4 : 0), 96, 80));
        require(sourceLevel.addFreshEntity(source), "source minecart registered");
        Entity result = source.teleport(destination(targetLevel, new Vec3(source.getX(), 96, 80)));
        require(result instanceof AbstractMinecartContainer, "cargo minecart portal transfer allowed");
        AbstractMinecartContainer target = (AbstractMinecartContainer) result;
        try {
            require(source.isRemoved() && target.isAlive(), "exactly one live cargo minecart");
            require(target.getItem(0).is(Items.EMERALD) && target.getItem(0).getCount() == 23,
                    "minecart cargo count preserved");
            require(source.teleport(destination(targetLevel, new Vec3(target.getX(), 96, 84))) == null,
                    "removed minecart source cannot be replayed");
        } finally {
            target.clearContent();
            target.discard();
        }
    }

    private static void duplicateUuidAndChunkMove(ServerLevel level) {
        ItemEntity existing = new ItemEntity(level, 191.5, 96, 64, new ItemStack(Items.GOLD_INGOT, 7));
        ItemEntity duplicate = new ItemEntity(level, 191.5, 96, 64, new ItemStack(Items.GOLD_INGOT, 7));
        duplicate.setUUID(existing.getUUID());
        level.getChunk(existing.blockPosition());
        level.getChunk(new BlockPos(193, 96, 64));
        require(level.addFreshEntity(existing), "existing entity registered");
        try {
            require(!level.addFreshEntity(duplicate), "native UUID uniqueness rejects duplicated reload entity");
            var identity = existing.getUUID();
            existing.setPos(192.5, 96, 64);
            require(existing.getUUID().equals(identity) && existing.isAlive() && existing.getItem().getCount() == 7,
                    "crossing chunk boundary retains exact entity and item count");
        } finally {
            existing.discard();
            duplicate.discard();
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException("Economy portal guard: " + message);
    }
}
