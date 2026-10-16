package com.servermanager.teleport.core;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Validation and case-insensitive canonicalization for player-defined place names. */
public final class PlaceNames {
    public static final int MAX_LENGTH = 24;
    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9_-]{1," + MAX_LENGTH + "}");
    private static final Set<String> RESERVED = Set.of("accept", "decline", "set", "list", "delete");

    private PlaceNames() {
    }

    public static boolean isValid(String value) {
        if (value == null || !SAFE_NAME.matcher(value).matches()) return false;
        return !RESERVED.contains(value.toLowerCase(Locale.ROOT));
    }

    public static String normalize(String value) {
        if (!isValid(value)) {
            throw new IllegalArgumentException(
                    "place name must be 1-" + MAX_LENGTH
                            + " letters, numbers, underscores, or hyphens and not a reserved command"
            );
        }
        return value.toLowerCase(Locale.ROOT);
    }
}
