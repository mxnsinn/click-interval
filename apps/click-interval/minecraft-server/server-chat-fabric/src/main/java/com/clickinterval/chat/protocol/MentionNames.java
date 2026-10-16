package com.clickinterval.chat.protocol;

/** Shared bounded syntax: plain player/tag tokens or quoted full names, never regex/user markup. */
public final class MentionNames {
    public static final int MAX_NAME = 32;
    private MentionNames() { }

    public static boolean valid(String name) {
        return name != null && !name.isBlank() && name.length() <= MAX_NAME
                && name.equals(name.strip()) && name.chars().allMatch(c ->
                Character.isLetterOrDigit(c) || c == '_' || c == '-' || c == ' ');
    }

    public static String token(String name) {
        if (!valid(name)) throw new IllegalArgumentException("Invalid mention name");
        return name.indexOf(' ') >= 0 ? "@\"" + name + "\"" : "@" + name;
    }

    public static boolean word(char c) { return Character.isLetterOrDigit(c) || c == '_' || c == '-'; }
}
