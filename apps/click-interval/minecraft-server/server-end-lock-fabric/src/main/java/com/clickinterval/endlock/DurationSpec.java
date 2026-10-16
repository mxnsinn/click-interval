package com.clickinterval.endlock;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Strict, bounded console durations; deadlines are persisted as wall-clock epoch milliseconds. */
public final class DurationSpec {
    public static final long MIN_MILLIS = 1_000;
    public static final long MAX_MILLIS = 365L * 24 * 60 * 60 * 1_000;
    private static final Pattern TOKEN = Pattern.compile("([0-9]+)([smhd])", Pattern.CASE_INSENSITIVE);

    private DurationSpec() { }

    public static long parseMillis(String token) {
        if (token == null) throw new IllegalArgumentException("Duration is required (for example 20s, 30m, 6h, or 2d)");
        Matcher match = TOKEN.matcher(token);
        if (!match.matches()) throw new IllegalArgumentException("Use a whole-number duration such as 20s, 30m, 6h, or 2d");
        long unit = switch (Character.toLowerCase(match.group(2).charAt(0))) {
            case 's' -> 1_000L;
            case 'm' -> 60_000L;
            case 'h' -> 3_600_000L;
            case 'd' -> 86_400_000L;
            default -> throw new IllegalArgumentException("Unknown duration unit");
        };
        final long millis;
        try { millis = Math.multiplyExact(Long.parseLong(match.group(1)), unit); }
        catch (NumberFormatException | ArithmeticException overflow) {
            throw new IllegalArgumentException("Duration is too large; maximum is 365d", overflow);
        }
        validateMillis(millis);
        return millis;
    }

    static void validateMillis(long millis) {
        if (millis < MIN_MILLIS || millis > MAX_MILLIS) {
            throw new IllegalArgumentException("Duration must be between 1s and 365d");
        }
    }

    /** Rounds a positive partial second up, so an active countdown never displays zero early. */
    public static String formatMillis(long millis) {
        if (millis == -1) return "indefinite";
        if (millis < 0) throw new IllegalArgumentException("Remaining duration must not be negative");
        long seconds = millis / 1_000 + (millis % 1_000 == 0 ? 0 : 1);
        if (seconds == 0) return "0s";
        StringBuilder text = new StringBuilder();
        append(text, seconds / 86_400, 'd');
        append(text, seconds / 3_600 % 24, 'h');
        append(text, seconds / 60 % 60, 'm');
        append(text, seconds % 60, 's');
        return text.toString();
    }

    private static void append(StringBuilder text, long amount, char unit) {
        if (amount == 0) return;
        if (!text.isEmpty()) text.append(' ');
        text.append(amount).append(unit);
    }
}
