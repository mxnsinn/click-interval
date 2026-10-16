package com.clickinterval.chat;

import net.fabricmc.api.ModInitializer;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundPlayerChatPacket;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Optional mention directory; no chat interception, typing state, enforcement or anti-xray hooks. */
public final class ServerChat implements ModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("ServerChat");
    private static MentionService mentions;

    @Override public void onInitialize() {
        mentions = new MentionService();
        mentions.register();
        LOGGER.info("Server Chat mention directory active; typing tracking and relay are not installed.");
    }

    /** Transforms only this existing recipient's packet, never sends or acknowledges another one. */
    public static Packet<?> decorateOutgoing(Packet<?> packet, ServerPlayer recipient) {
        if (!(packet instanceof ClientboundPlayerChatPacket chat) || recipient == null || mentions == null
                || !MentionPacketDecorator.eligible(chat) || !recipient.level().getServer().isSameThread()) return packet;
        try {
            return MentionPacketDecorator.decorate(chat, recipient.getGameProfile().name(), mentions.ownNames(recipient.getUUID()));
        } catch (RuntimeException | LinkageError unavailable) {
            // A presentation failure must not interrupt or alter normal signed-chat delivery.
            return packet;
        }
    }
}
