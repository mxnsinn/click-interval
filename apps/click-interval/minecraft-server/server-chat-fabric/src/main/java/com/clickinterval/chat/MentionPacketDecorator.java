package com.clickinterval.chat;

import java.util.ArrayDeque;
import java.util.List;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.PlainTextContents;
import net.minecraft.network.protocol.game.ClientboundPlayerChatPacket;

/** Copies only the permitted unsigned presentation field; the signed body is never edited. */
public final class MentionPacketDecorator {
    private MentionPacketDecorator() { }

    public static boolean eligible(ClientboundPlayerChatPacket packet) {
        return packet != null && packet.filterMask().isEmpty() && packet.chatType().chatType().is(ChatType.CHAT);
    }

    public static ClientboundPlayerChatPacket decorate(ClientboundPlayerChatPacket packet, String recipientName, List<String> ownTeamNames) {
        if (!eligible(packet)) return packet;
        Component content = packet.unsignedContent();
        if (content == null) {
            if (packet.body().content().length() > 32_768 || packet.body().content().indexOf('@') < 0) return packet;
            content = Component.literal(packet.body().content());
        }
        if (!plainBounded(content)) return packet;
        Component highlighted = MentionHighlighter.highlight(content, recipientName, ownTeamNames);
        if (highlighted == content) return packet;
        return new ClientboundPlayerChatPacket(packet.globalIndex(), packet.sender(), packet.index(), packet.signature(),
                packet.body(), highlighted, packet.filterMask(), packet.chatType());
    }

    private static boolean plainBounded(Component component) {
        // Flattening translations, selectors, scores or object components on the server would change
        // client-side meaning/localization. Preserve those packets intact instead.
        var pending = new ArrayDeque<Component>();
        pending.add(component);
        int count = 0, chars = 0;
        while (!pending.isEmpty()) {
            Component next = pending.removeLast();
            if (++count > 256 || !(next.getContents() instanceof PlainTextContents plain)) return false;
            chars += plain.text().length();
            if (chars > 32_768 || pending.size() + next.getSiblings().size() > 256) return false;
            pending.addAll(next.getSiblings());
        }
        return true;
    }
}
