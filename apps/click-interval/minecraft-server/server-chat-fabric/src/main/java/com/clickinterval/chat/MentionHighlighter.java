package com.clickinterval.chat;

import com.clickinterval.chat.protocol.MentionNames;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/** Same bounded exact-token matching and inherited-style splitting as the optional client highlighter. */
final class MentionHighlighter {
    private MentionHighlighter() { }

    static Component highlight(Component message, String recipientName, List<String> ownTeamNames) {
        if (message == null || recipientName == null || !recipientName.matches("[A-Za-z0-9_]{1,16}")) return message;
        String plain = message.getString();
        if (plain.length() > 32_768 || plain.indexOf('@') < 0) return message;
        List<String> tokens = new ArrayList<>();
        tokens.add("@" + recipientName);
        ownTeamNames.stream().limit(64).filter(MentionNames::valid).map(MentionNames::token).forEach(tokens::add);
        String alternatives = tokens.stream().distinct().sorted(java.util.Comparator.comparingInt(String::length).reversed())
                .map(Pattern::quote).collect(java.util.stream.Collectors.joining("|"));
        var matcher = Pattern.compile("(?<![\\p{L}\\p{N}_@-])(?:" + alternatives + ")(?![\\p{L}\\p{N}_-])",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(plain);
        List<Range> mentions = new ArrayList<>();
        while (mentions.size() < 16 && matcher.find()) mentions.add(new Range(matcher.start(), matcher.end()));
        if (mentions.isEmpty()) return message;
        MutableComponent result = Component.empty();
        int[] offset = {0};
        message.visit((style, text) -> {
            int end = offset[0] + text.length();
            int cursor = offset[0];
            for (Range mention : mentions) {
                int start = Math.max(cursor, mention.start());
                int stop = Math.min(end, mention.end());
                if (start >= stop) continue;
                append(result, text, cursor - offset[0], start - offset[0], style);
                append(result, text, start - offset[0], stop - offset[0], style.withColor(ChatFormatting.YELLOW));
                cursor = stop;
            }
            append(result, text, cursor - offset[0], text.length(), style);
            offset[0] = end;
            return Optional.empty();
        }, Style.EMPTY);
        return result;
    }

    private static void append(MutableComponent output, String text, int start, int end, Style style) {
        if (start < end) output.append(Component.literal(text.substring(start, end)).setStyle(style));
    }
    private record Range(int start, int end) { }
}
