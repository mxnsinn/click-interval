package dev.serverenchantments.fabric.mixin;

import dev.serverenchantments.fabric.ServerEnchantmentsFabric;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BlockItem.class)
abstract class PlacedLogMixin {
    @Inject(method="placeBlock", at=@At("RETURN"))
    private void serverEnchantments$rememberPlacement(BlockPlaceContext context, BlockState state,
                                                      CallbackInfoReturnable<Boolean> callback) {
        if (callback.getReturnValueZ()) ServerEnchantmentsFabric.recordPlacedLog(context, state);
    }
}
