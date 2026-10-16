package com.clickinterval.endlock.mixin;

import com.clickinterval.endlock.ServerEndLock;
import net.minecraft.world.item.crafting.*;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import java.util.Optional;

@Mixin(RecipeManager.class)
public abstract class RecipeManagerMixin {
    @Inject(method = "getRecipeFor(Lnet/minecraft/world/item/crafting/RecipeType;Lnet/minecraft/world/item/crafting/RecipeInput;Lnet/minecraft/world/level/Level;)Ljava/util/Optional;", at = @At("RETURN"), cancellable = true)
    private void serverEndLock$filter(RecipeType<?> type, RecipeInput input, Level level,
            CallbackInfoReturnable<Optional<RecipeHolder<?>>> callback) {
        if (ServerEndLock.blocksRecipe(input, callback.getReturnValue().orElse(null), level)) callback.setReturnValue(Optional.empty());
    }

    @Inject(method = "getRecipeFor(Lnet/minecraft/world/item/crafting/RecipeType;Lnet/minecraft/world/item/crafting/RecipeInput;Lnet/minecraft/world/level/Level;Lnet/minecraft/world/item/crafting/RecipeHolder;)Ljava/util/Optional;", at = @At("RETURN"), cancellable = true)
    private void serverEndLock$filterCached(RecipeType<?> type, RecipeInput input, Level level, RecipeHolder<?> cached,
            CallbackInfoReturnable<Optional<RecipeHolder<?>>> callback) {
        if (ServerEndLock.blocksRecipe(input, callback.getReturnValue().orElse(null), level)) callback.setReturnValue(Optional.empty());
    }
}
