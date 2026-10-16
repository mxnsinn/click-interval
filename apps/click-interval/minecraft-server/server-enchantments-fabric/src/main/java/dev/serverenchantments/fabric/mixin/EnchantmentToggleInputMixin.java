package dev.serverenchantments.fabric.mixin;

import dev.serverenchantments.fabric.EnchantmentToggleMenu;
import dev.serverenchantments.fabric.ServerEnchantmentsFabric;
import net.minecraft.network.protocol.game.ServerboundContainerClickPacket;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerGamePacketListenerImpl.class)
abstract class EnchantmentToggleInputMixin {
    @Shadow public ServerPlayer player;

    @Inject(method = "handlePlayerAction", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverEnchantments$swap(ServerboundPlayerActionPacket packet, CallbackInfo callback) {
        if (packet.getAction() == ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND
                && ServerEnchantmentsFabric.handleToggleSwap(player)) callback.cancel();
    }

    @Inject(method = "handleContainerClick", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/PacketUtils;ensureRunningOnSameThread(Lnet/minecraft/network/protocol/Packet;Lnet/minecraft/network/PacketListener;Lnet/minecraft/server/level/ServerLevel;)V",
            shift = At.Shift.AFTER), cancellable = true)
    private void serverEnchantments$staleClick(ServerboundContainerClickPacket packet, CallbackInfo callback) {
        if (player.containerMenu instanceof EnchantmentToggleMenu
                && (packet.containerId() != player.containerMenu.containerId || packet.stateId() != player.containerMenu.getStateId())) {
            player.containerMenu.sendAllDataToRemote();
            callback.cancel();
        }
    }
}
