package com.mxnsinn.lobby.mixin;

import com.mxnsinn.lobby.LobbyPreviewGuard;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ClientboundBlockUpdatePacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.ServerPlayerGameMode;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.BlockHitResult;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = ServerPlayerGameMode.class, priority = 2000)
public abstract class ServerPlayerGameModeMixin {
    @Shadow @Final protected ServerPlayer player;
    @Inject(method = "handleBlockBreakAction", at = @At("HEAD"), cancellable = true)
    private void lobby$noBreakPacket(BlockPos pos, ServerboundPlayerActionPacket.Action action, Direction direction,
                                    int worldHeight, int sequence, CallbackInfo ci) {
        if (LobbyPreviewGuard.active(player.level())) {
            player.connection.ackBlockChangesUpTo(sequence);
            player.connection.send(new ClientboundBlockUpdatePacket(player.level(), pos));
            player.level().destroyBlockProgress(player.getId(), pos, -1);
            ci.cancel();
        }
    }
    @Inject(method = "changeGameModeForPlayer", at = @At("HEAD"), cancellable = true)
    private void lobby$onlySurvival(GameType requested, CallbackInfoReturnable<Boolean> cir) {
        if (requested != GameType.SURVIVAL && LobbyPreviewGuard.active(player.level())) cir.setReturnValue(false);
    }
    @Inject(method = "destroyBlock", at = @At("HEAD"), cancellable = true)
    private void lobby$noBreak(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
        if (LobbyPreviewGuard.active(player.level())) cir.setReturnValue(false);
    }
    @Inject(method = "useItemOn", at = @At("HEAD"), cancellable = true)
    private void lobby$noPlace(ServerPlayer player, Level world, ItemStack stack, InteractionHand hand, BlockHitResult hit,
                              CallbackInfoReturnable<InteractionResult> cir) {
        if (LobbyPreviewGuard.active(world)) cir.setReturnValue(InteractionResult.FAIL);
    }
    @Inject(method = "useItem", at = @At("HEAD"), cancellable = true)
    private void lobby$noItem(ServerPlayer player, Level world, ItemStack stack, InteractionHand hand,
                             CallbackInfoReturnable<InteractionResult> cir) {
        if (LobbyPreviewGuard.active(world)) cir.setReturnValue(InteractionResult.FAIL);
    }
}
