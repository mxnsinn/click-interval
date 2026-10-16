package dev.serverprotection.client;

import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class MentionSuggestionsTest {
    private static final List<String> NAMES = List.of("Alice", "Bob", "@Alice", "@VRG", "@\"Night Watch\"");

    @Test void atOpensNamesTagsAndFullNamesWithCaseInsensitivePrefixFiltering() {
        assertEquals(List.of("@\"Night Watch\"", "@Alice", "@Bob", "@VRG"), texts("@"));
        assertEquals(List.of("@Alice"), texts("hey @aL"));
        assertEquals(List.of("@VRG"), texts("@vr"));
        assertEquals(List.of("@\"Night Watch\""), texts("@ni"));
        assertEquals(List.of("@\"Night Watch\""), texts("@\"night w"));
    }

    @Test void tabAppliesWholeQuotedTokenAndPreservesTheRestOfChat() {
        String draft = "hi @\"night w";
        var suggestion = MentionSuggestions.build(draft, draft.length(), NAMES).getList().getFirst();
        assertEquals("hi @\"Night Watch\"", suggestion.apply(draft));
        String middle = "hi @ali see you";
        var second = MentionSuggestions.build(middle, 7, NAMES).getList().getFirst();
        assertEquals("hi @Alice see you", second.apply(middle));
    }

    @Test void commandsWhispersEmailDoubleAtAndCompletedTokensDoNotOpenTheMentionDropdown() {
        for (String input : List.of("/msg Bob @", " /tell Bob @", "/team chat @", "hello", "email@", "@@", "x@VR", "@Alice ", "@\"Night Watch\"", "a".repeat(256) + "@")) {
            assertNull(MentionSuggestions.build(input, input.length(), NAMES), input);
        }
        assertEquals(List.of("@Alice"), texts("(@al"));
    }

    @Test void suggestionsCannotInjectCommandsOrMarkupAndAreBounded() {
        var names = new java.util.ArrayList<>(List.of("@bad\nname", "@bad\"name", "@§cBAD", "/kill"));
        for (int i = 0; i < 500; i++) names.add("@User" + i);
        var result = MentionSuggestions.build("@", 1, names);
        assertEquals(100, result.getList().size());
        assertTrue(result.getList().stream().allMatch(suggestion -> suggestion.getText().startsWith("@User")));
    }

    private static List<String> texts(String input) {
        return MentionSuggestions.build(input, input.length(), NAMES).getList().stream().map(value -> value.getText()).toList();
    }
}
