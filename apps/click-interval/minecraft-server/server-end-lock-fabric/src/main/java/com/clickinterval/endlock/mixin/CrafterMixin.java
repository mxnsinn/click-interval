package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.crafting.*;
import net.minecraft.world.level.block.CrafterBlock;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import java.util.Optional;

@Mixin(CrafterBlock.class)
public abstract class CrafterMixin {
    // A denied recipe must never enter vanilla's shared cache as a permanent miss. Otherwise
    // the identical ingredient grid can remain uncraftable after an administrator unlocks.
    @Inject(method = "getPotentialResults", at = @At("HEAD"), cancellable = true)
    private static void serverEndLock$avoidCachingLockedMiss(ServerLevel level, CraftingInput input,
            CallbackInfoReturnable<Optional<RecipeHolder<CraftingRecipe>>> callback) {
        if (ServerEndLock.blocksEyes(level)) callback.setReturnValue(
                level.getServer().getRecipeManager().getRecipeFor(RecipeType.CRAFTING, input, level));
    }

    @Inject(method = "getPotentialResults", at = @At("RETURN"), cancellable = true)
    private static void serverEndLock$cachedCrafter(ServerLevel level, CraftingInput input,
            CallbackInfoReturnable<Optional<RecipeHolder<CraftingRecipe>>> callback) {
        if (ServerEndLock.blocksRecipe(input, callback.getReturnValue().orElse(null), level)) callback.setReturnValue(Optional.empty());
    }
}
