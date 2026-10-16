package com.clickinterval.chat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.ChatFormatting;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderOwner;
import net.minecraft.network.chat.ChatType;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FilterMask;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.LastSeenMessages;
import net.minecraft.network.chat.MessageSignature;
import net.minecraft.network.chat.SignedMessageBody;
import net.minecraft.network.chat.Style;
import net.minecraft.network.protocol.game.ClientboundPlayerChatPacket;
import net.minecraft.resources.ResourceKey;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;

import static org.junit.jupiter.api.Assertions.*;

final class MentionPacketDecoratorTest {
    @BeforeAll static void nativeRegistries() {
        net.minecraft.SharedConstants.tryDetectVersion();
        net.minecraft.server.Bootstrap.bootStrap();
    }
    private static ClientboundPlayerChatPacket packet(String text, Component decorated, FilterMask mask, ResourceKey<ChatType> type) {
        var bound = new ChatType.Bound(Holder.Reference.createStandAlone(new HolderOwner<ChatType>() {}, type),
                Component.literal("Original sender"), Optional.of(Component.literal("Original target")));
        var body = new SignedMessageBody.Packed(text, Instant.ofEpochSecond(123456), 987654321L, LastSeenMessages.Packed.EMPTY);
        return new ClientboundPlayerChatPacket(39, UUID.fromString("11111111-2222-3333-4444-555555555555"), 27,
                new MessageSignature(new byte[256]), body, decorated, mask, bound);
    }

    @Test void preservesEverySignedFieldAndHighlightsOnlyAddressedRecipient() {
        var before = packet("Hello @Alice @VRG @\"Night Watch\" @Other", null, FilterMask.PASS_THROUGH, ChatType.CHAT);
        var after = MentionPacketDecorator.decorate(before, "Alice", List.of("VRG", "Night Watch"));
        assertNotSame(before, after);
        assertEquals(List.of("@Alice", "@VRG", "@\"Night Watch\""), yellow(after.unsignedContent()));
        assertEquals(before.globalIndex(), after.globalIndex());
        assertSame(before.sender(), after.sender());
        assertEquals(before.index(), after.index());
        assertSame(before.signature(), after.signature());
        assertSame(before.body(), after.body());
        assertSame(before.filterMask(), after.filterMask());
        assertSame(before.chatType(), after.chatType());
        assertEquals(before.body().content(), after.unsignedContent().getString());
        assertNull(before.unsignedContent());
        assertSame(before, MentionPacketDecorator.decorate(before, "Bob", List.of()));
    }

    @Test void leavesFullyAndPartiallyFilteredContentUntouchedEvenIfUnsignedTextContainsMention() {
        var partial = new FilterMask(20); partial.setFiltered(1);
        for (var mask : List.of(partial, FilterMask.FULLY_FILTERED, new FilterMask(20))) {
            var packet = packet("secret @Alice", Component.literal("visible @Alice"), mask, ChatType.CHAT);
            assertSame(packet, MentionPacketDecorator.decorate(packet, "Alice", List.of()));
        }
    }

    @Test void excludesAllPrivateCommandAndTeamChatTypes() {
        for (var type : List.of(ChatType.MSG_COMMAND_INCOMING, ChatType.MSG_COMMAND_OUTGOING,
                ChatType.TEAM_MSG_COMMAND_INCOMING, ChatType.TEAM_MSG_COMMAND_OUTGOING,
                ChatType.EMOTE_COMMAND, ChatType.SAY_COMMAND)) {
            var packet = packet("@Alice", null, FilterMask.PASS_THROUGH, type);
            assertSame(packet, MentionPacketDecorator.decorate(packet, "Alice", List.of()));
        }
    }

    @Test void neverResurrectsRawSignedTextWhenAnotherDecoratorRemovedIt() {
        var packet = packet("@Alice secret", Component.literal("[redacted]"), FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(packet, MentionPacketDecorator.decorate(packet, "Alice", List.of()));
    }

    @Test void preservesInheritedClickHoverBoldItalicAndNonMentionStyles() {
        var style = Style.EMPTY.withColor(ChatFormatting.AQUA).withBold(true)
                .withClickEvent(new ClickEvent.SuggestCommand("/msg Alice "))
                .withHoverEvent(new HoverEvent.ShowText(Component.literal("Original tooltip")));
        var content = Component.literal("hello @Al").setStyle(style).append(Component.literal("ice!").withStyle(ChatFormatting.ITALIC));
        var packet = packet("hello @Alice!", content, FilterMask.PASS_THROUGH, ChatType.CHAT);
        var output = MentionPacketDecorator.decorate(packet, "Alice", List.of()).unsignedContent();
        assertEquals(content.getString(), output.getString());
        assertEquals(List.of("@Al", "ice"), yellow(output));
        output.visit((actual, text) -> {
            assertEquals(style.getClickEvent(), actual.getClickEvent());
            assertEquals(style.getHoverEvent(), actual.getHoverEvent());
            assertTrue(actual.isBold());
            if (text.equals("ice") || text.equals("!")) assertTrue(actual.isItalic());
            if (text.equals("hello ") || text.equals("!")) assertEquals(style.getColor(), actual.getColor());
            return Optional.empty();
        }, Style.EMPTY);
        assertTrue(yellow(content).isEmpty());
    }

    @Test void exactCaseInsensitiveTokensAndQuotedTeamNamesDoNotMatchPartialWords() {
        var packet = packet("@Alice @ALICE @Alice2 x@Alice @@Alice @VRG @VRG-Other @\"night watch\"", null,
                FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertEquals(List.of("@Alice", "@ALICE", "@VRG", "@\"night watch\""), yellow(
                MentionPacketDecorator.decorate(packet, "Alice", List.of("VRG", "Night Watch")).unsignedContent()));
    }

    @Test void unchangedPacketsKeepIdentityAndInvalidNamesDoNotCreatePatterns() {
        var packet = packet("@Alice", null, FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(packet, MentionPacketDecorator.decorate(packet, null, List.of()));
        assertSame(packet, MentionPacketDecorator.decorate(packet, "Alice|Bob", List.of()));
        assertSame(packet, MentionPacketDecorator.decorate(packet, "Bob", List.of("", "A|B")));
    }

    @Test void leavesTranslationsAndNonTextComponentsUntouched() {
        var translated = Component.translatableWithFallback("test", "@Alice %s", "hello");
        var packet = packet("@Alice", translated, FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(packet, MentionPacketDecorator.decorate(packet, "Alice", List.of()));
        var nested = packet("@Alice", Component.literal("@Alice").append(translated), FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(nested, MentionPacketDecorator.decorate(nested, "Alice", List.of()));
    }

    @Test void boundsMentionCountTextLengthAndComponentComplexity() {
        var repeated = packet("@Alice ".repeat(50), null, FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertEquals(16, yellow(MentionPacketDecorator.decorate(repeated, "Alice", List.of()).unsignedContent()).size());
        var huge = packet("@Alice "+"x".repeat(32_768), null, FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(huge, MentionPacketDecorator.decorate(huge, "Alice", List.of()));
        var wide = Component.literal("@Alice"); for (int i=0; i<256; i++) wide.append(Component.literal("x"));
        var widePacket = packet("@Alice", wide, FilterMask.PASS_THROUGH, ChatType.CHAT);
        assertSame(widePacket, MentionPacketDecorator.decorate(widePacket, "Alice", List.of()));
    }

    private static List<String> yellow(Component component) {
        List<String> result = new ArrayList<>();
        component.visit((style, text) -> {
            if (style.getColor() != null && style.getColor().getValue() == 0xffff55) result.add(text);
            return Optional.empty();
        }, Style.EMPTY);
        return result;
    }
}
