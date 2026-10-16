package com.clickinterval.economyguard.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.TripWireHookBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

/** A neighbor callback may remove a hook before calculateState writes its cached state. */
@Mixin(TripWireHookBlock.class)
public abstract class TripwireHookGuardMixin {
    @WrapOperation(method = "calculateState", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/level/Level;setBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/level/block/state/BlockState;I)Z"), require = 3)
    private static boolean clickInterval$neverRecreateRemovedHook(Level level, BlockPos pos,
            BlockState next, int flags, Operation<Boolean> original) {
        if (!level.isClientSide() && next.is(Blocks.TRIPWIRE_HOOK)) {
            BlockState current = level.getBlockState(pos);
            if (!current.is(Blocks.TRIPWIRE_HOOK)
                    || current.getValue(TripWireHookBlock.FACING) != next.getValue(TripWireHookBlock.FACING)) {
                return false;
            }
        }
        return original.call(level, pos, next, flags);
    }
}
