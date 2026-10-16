package dev.serverprotection.client;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.Style;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

final class ChatMentionHighlighterTest {
    @Test
    void onlyRecipientTeamsAreHighlightedWithExactQuotedNamesAndTokenBoundaries() {
        Component input = Component.literal("@VRG @vrg @VRG2 @VRG-Other x@VRG @@VRG @\"Night Watch\" @\"night watch\" @OTHER");
        assertEquals(List.of("@VRG", "@vrg", "@\"Night Watch\"", "@\"night watch\""),
                yellow(ChatMentionHighlighter.highlight(input, "Alice", List.of("VRG", "Night Watch"))));
        assertSame(input, ChatMentionHighlighter.highlight(input, "Bob", List.of()));
        assertEquals(List.of("@OTHER"), yellow(ChatMentionHighlighter.highlight(input, "Carol", List.of("OTHER"))));
        assertSame(input, ChatMentionHighlighter.highlight(input, "Alice", List.of()), "leave/disband clears old aliases");
        assertEquals(input.getString(), ChatMentionHighlighter.highlight(input, "Alice", List.of("VRG")).getString());
        assertTrue(yellow(input).isEmpty());
    }

    @Test
    void repeatedMentionsAreQuietBoundedLocalFormattingOnly() {
        Component input = Component.literal("@VRG ".repeat(50));
        assertEquals(16, yellow(ChatMentionHighlighter.highlight(input, "Alice", List.of("VRG"))).size());
        assertEquals(input.getString(), ChatMentionHighlighter.highlight(input, "Alice", List.of("VRG")).getString());
    }

    @Test
    void onlyExactLocalUsernameIsHighlightedCaseInsensitively() {
        Component input = Component.literal("Hi @Alice, (@ALICE)! @Bob @Alice_2 @Alice2 x@Alice @@Alice");
        Component output = ChatMentionHighlighter.highlight(input, "Alice");
        assertEquals(input.getString(), output.getString());
        assertEquals(List.of("@Alice", "@ALICE"), yellow(output));
        assertEquals(List.of("@Bob"), yellow(ChatMentionHighlighter.highlight(input, "Bob")));
        assertSame(input, ChatMentionHighlighter.highlight(input, "Carol"));
        assertSame(input, ChatMentionHighlighter.highlight(input, null));
        assertSame(input, ChatMentionHighlighter.highlight(input, "Alice|Bob"));
        assertTrue(yellow(input).isEmpty(), "original signed display component must not be mutated");
    }

    @Test
    void preservesInheritedClickHoverAndFormattingAcrossStyleBoundaries() {
        Style originalStyle = Style.EMPTY.withColor(ChatFormatting.AQUA).withBold(true)
                .withClickEvent(new ClickEvent.SuggestCommand("/msg Alice "))
                .withHoverEvent(new HoverEvent.ShowText(Component.literal("Original tooltip")));
        Component input = Component.literal("hello @Al").setStyle(originalStyle)
                .append(Component.literal("ice!").withStyle(ChatFormatting.ITALIC));
        Component output = ChatMentionHighlighter.highlight(input, "Alice");
        assertEquals("hello @Alice!", output.getString());
        assertEquals(List.of("@Al", "ice"), yellow(output));
        output.visit((style, text) -> {
            assertEquals(originalStyle.getClickEvent(), style.getClickEvent());
            assertEquals(originalStyle.getHoverEvent(), style.getHoverEvent());
            assertTrue(style.isBold());
            if (text.equals("ice") || text.equals("!")) assertTrue(style.isItalic());
            if (text.equals("hello ") || text.equals("!")) assertEquals(originalStyle.getColor(), style.getColor());
            return Optional.empty();
        }, Style.EMPTY);
    }

    @Test
    void respectsTranslatedChatAndMultipleRecipientsWithoutRewritingMessageText() {
        Component input = Component.translatableWithFallback("test.chat", "<%s> %s",
                "Bob", Component.literal("@Alice come here, @Carol too"));
        Component output = ChatMentionHighlighter.highlight(input, "Alice");
        assertEquals(input.getString(), output.getString());
        assertEquals(List.of("@Alice"), yellow(output));
        assertSame(input, ChatMentionHighlighter.highlight(input, "Bob"));
    }

    private static List<String> yellow(Component component) {
        List<String> result = new ArrayList<>();
        component.visit((style, text) -> {
            if (style.getColor() != null && style.getColor().getValue() == 0xFFFF55) {
                result.add(text);
            }
            return Optional.empty();
        }, Style.EMPTY);
        return result;
    }
}
