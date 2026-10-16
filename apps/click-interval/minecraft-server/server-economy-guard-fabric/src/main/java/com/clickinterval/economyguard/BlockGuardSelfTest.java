package com.clickinterval.economyguard;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.TripWireBlock;
import net.minecraft.world.level.block.TripWireHookBlock;
import net.minecraft.world.level.block.piston.PistonBaseBlock;

/** Native block-update regression fixtures; disposable saves only. */
public final class BlockGuardSelfTest {
    private BlockGuardSelfTest() { }
    public static void run(MinecraftServer server) {
        var level = server.overworld();
        var pos = new BlockPos(64, 100, 64);
        var hook = Blocks.TRIPWIRE_HOOK.defaultBlockState().setValue(TripWireHookBlock.FACING, Direction.EAST);
        level.setBlock(pos.west(), Blocks.STONE.defaultBlockState(), Block.UPDATE_ALL);
        level.setBlock(pos, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL);
        TripWireHookBlock.calculateState(level, pos, hook, false, true, -1, null);
        require(level.getBlockState(pos).isAir(), "cached hook cannot recreate a removed hook");
        level.setBlock(pos, Blocks.DIRT.defaultBlockState(), Block.UPDATE_ALL);
        TripWireHookBlock.calculateState(level, pos, hook, false, true, -1, null);
        require(level.getBlockState(pos).is(Blocks.DIRT), "cached hook cannot overwrite a replacement block");
        level.setBlock(pos, hook, Block.UPDATE_ALL);
        var other = pos.east(3);
        level.setBlock(other.east(), Blocks.STONE.defaultBlockState(), Block.UPDATE_ALL);
        level.setBlock(other, hook.setValue(TripWireHookBlock.FACING, Direction.WEST), Block.UPDATE_ALL);
        level.setBlock(pos.east(), Blocks.TRIPWIRE.defaultBlockState(), Block.UPDATE_ALL);
        level.setBlock(pos.east(2), Blocks.TRIPWIRE.defaultBlockState(), Block.UPDATE_ALL);
        TripWireHookBlock.calculateState(level, pos, hook, false, true, -1, null);
        require(level.getBlockState(pos).getValue(TripWireHookBlock.ATTACHED), "ordinary tripwire still attaches");
        require(level.getBlockState(other).getValue(TripWireHookBlock.ATTACHED), "ordinary receiver still attaches");
        var poweredWire = level.getBlockState(pos.east()).setValue(TripWireBlock.POWERED, true);
        level.setBlock(pos.east(), poweredWire, Block.UPDATE_CLIENTS);
        TripWireHookBlock.calculateState(level, pos, level.getBlockState(pos), false, true, 1, poweredWire);
        require(level.getBlockState(pos).getValue(TripWireHookBlock.POWERED), "ordinary tripwire still powers");
        require(level.getBlockState(other).getValue(TripWireHookBlock.POWERED), "ordinary receiver still powers");
        level.destroyBlock(pos, true);
        TripWireHookBlock.calculateState(level, pos, hook, false, true, -1, null);
        require(level.getBlockState(pos).isAir(), "drop plus stale callback cannot restore the hook");
        // The ordinary piston collection mechanic must still yield one egg, never confiscate it.
        var pistonPos = new BlockPos(80, 110, 64);
        level.getChunk(pistonPos);
        level.setBlock(pistonPos.east().below(), Blocks.STONE.defaultBlockState(), Block.UPDATE_ALL);
        var piston = Blocks.PISTON.defaultBlockState().setValue(PistonBaseBlock.FACING, Direction.EAST);
        level.setBlock(pistonPos, piston, Block.UPDATE_CLIENTS);
        level.setBlock(pistonPos.east(), Blocks.DRAGON_EGG.defaultBlockState(), Block.UPDATE_CLIENTS);
        level.setBlock(pistonPos.west(), Blocks.REDSTONE_BLOCK.defaultBlockState(), Block.UPDATE_CLIENTS);
        require(piston.triggerEvent(level, pistonPos, 0, Direction.EAST.get3DDataValue()), "ordinary egg piston extends");
        int eggs = level.getEntitiesOfClass(ItemEntity.class, new AABB(pistonPos).inflate(4), e -> !e.isRemoved())
                .stream().filter(e -> e.getItem().is(Items.DRAGON_EGG)).mapToInt(e -> e.getItem().getCount()).sum();
        require(eggs == 1, "ordinary piston collection yields exactly one dragon egg");
        ServerEconomyGuard.LOGGER.info("SERVER_ECONOMY_BLOCK_TEST_PASS: removed/replaced hook updates rejected; legitimate attachment, redstone and single-egg piston collection retained");
    }
    private static void require(boolean condition, String label) {
        if (!condition) throw new IllegalStateException("Economy block guard: " + label);
    }
}
