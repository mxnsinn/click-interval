package com.clickinterval.chat.mixin;

import com.clickinterval.chat.ServerChat;
import net.minecraft.network.protocol.Packet;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/** Keeps vanilla signature packing, sending, cache updates and last-seen accounting in place. */
@Mixin(ServerGamePacketListenerImpl.class)
abstract class RecipientMentionMixin {
    @Shadow public ServerPlayer player;

    @ModifyArg(method = "sendPlayerChatMessage(Lnet/minecraft/network/chat/PlayerChatMessage;Lnet/minecraft/network/chat/ChatType$Bound;)V",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/server/network/ServerGamePacketListenerImpl;send(Lnet/minecraft/network/protocol/Packet;)V"), index = 0)
    private Packet<?> serverChat$decorateRecipient(Packet<?> packet) {
        return ServerChat.decorateOutgoing(packet, player);
    }
}
