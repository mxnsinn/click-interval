package dev.serverenchantments.fabric.mixin;

import dev.serverenchantments.fabric.ServerEnchantmentsFabric;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerPlayerGameMode;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Run extra harvesting only after native original-block drops and durability finish. */
@Mixin(ServerPlayerGameMode.class)
abstract class CompletedBlockBreakMixin {
    @Shadow @Final protected ServerPlayer player;

    @Inject(method="destroyBlock", at=@At("RETURN"))
    private void serverEnchantments$afterNativeTransaction(BlockPos pos, CallbackInfoReturnable<Boolean> callback) {
        ServerEnchantmentsFabric.finishNativeBreak(player, pos, callback.getReturnValueZ());
    }
}
