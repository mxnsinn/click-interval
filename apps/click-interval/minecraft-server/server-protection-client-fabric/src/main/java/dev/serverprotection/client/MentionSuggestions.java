package dev.serverprotection.client;

import com.clickinterval.chat.protocol.MentionNames;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import java.util.Collection;
import java.util.Locale;
import java.util.TreeSet;

/** Pure local completion, using only the vanilla player directory and server-authored public aliases. */
public final class MentionSuggestions {
    private MentionSuggestions() { }

    public static Suggestions build(String input, int cursor, Collection<String> candidates) {
        int start = tokenStart(input, cursor);
        if (start < 0) return null;
        String prefix = input.substring(start + 1, cursor);
        if (prefix.startsWith("\"")) prefix = prefix.substring(1);
        prefix = prefix.toLowerCase(Locale.ROOT);
        SuggestionsBuilder builder = new SuggestionsBuilder(input.substring(0, cursor), start);
        TreeSet<String> matches = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        int examined = 0;
        for (String candidate : candidates) {
            if (++examined > 2048) break;
            if (candidate == null) continue;
            String name;
            if (candidate.startsWith("@\"") && candidate.endsWith("\"") && candidate.length() > 3) {
                name = candidate.substring(2, candidate.length() - 1);
            } else if (candidate.startsWith("@")) {
                name = candidate.substring(1);
            } else {
                if (!candidate.matches("[A-Za-z0-9_]{1,16}")) continue;
                name = candidate;
            }
            if (MentionNames.valid(name) && name.toLowerCase(Locale.ROOT).startsWith(prefix)) {
                matches.add(MentionNames.token(name));
            }
        }
        matches.stream().limit(100).forEach(builder::suggest);
        return builder.build();
    }

    static int tokenStart(String input, int cursor) {
        if (input == null || input.length() > 256 || cursor < 1 || cursor > input.length()
                || input.stripLeading().startsWith("/")) return -1;
        int start = input.lastIndexOf('@', cursor - 1);
        if (start < 0 || (start > 0 && (MentionNames.word(input.charAt(start - 1)) || input.charAt(start - 1) == '@'))) return -1;
        String prefix = input.substring(start + 1, cursor);
        boolean quoted = prefix.startsWith("\"");
        if (quoted) prefix = prefix.substring(1);
        if (prefix.length() > MentionNames.MAX_NAME) return -1;
        for (int i = 0; i < prefix.length(); i++) {
            char c = prefix.charAt(i);
            if (!MentionNames.word(c) && !(quoted && c == ' ')) return -1;
        }
        return start;
    }
}
