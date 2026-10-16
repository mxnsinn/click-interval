package com.clickinterval.endlock.mixin;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.CrafterBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** Used only by the explicitly marked disposable-world native test. */
@Mixin(CrafterBlock.class)
public interface CrafterAccessor {
    @Invoker("dispenseFrom") void serverEndLock$dispense(BlockState state, ServerLevel level, BlockPos pos);
}
