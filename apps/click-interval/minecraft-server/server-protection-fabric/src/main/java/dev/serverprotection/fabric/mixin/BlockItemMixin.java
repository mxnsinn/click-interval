package dev.serverprotection.fabric.mixin;

import dev.serverprotection.fabric.ServerProtectionFabric;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Counts only block-item placements that vanilla accepted on the logical server. */
@Mixin(BlockItem.class)
abstract class BlockItemMixin {
    @Inject(method = "place", at = @At("RETURN"))
    private void serverProtection$afterPlace(BlockPlaceContext context,
                                                CallbackInfoReturnable<InteractionResult> callback) {
        InteractionResult result = callback.getReturnValue();
        if (result != null && result.consumesAction()) {
            ServerProtectionFabric.observeSuccessfulPlacement(context.getPlayer(), context.getClickedPos());
        }
    }
}
