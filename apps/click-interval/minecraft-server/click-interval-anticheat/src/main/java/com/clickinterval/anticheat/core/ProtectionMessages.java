package com.clickinterval.anticheat.core;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Immutable, dependency-free player message templates for protection actions.
 *
 * <p>Templates only expand placeholders explicitly supplied by the caller. Dynamic values cannot
 * inject formatting, control characters, or extra lines. This keeps editable messages useful
 * without allowing a player name or a future detail value to alter the rest of the message.</p>
 */
public final class ProtectionMessages {
    public static final int MAX_MESSAGE_LENGTH = 512;
    private static final int MAX_TEMPLATE_LENGTH = 1_024;
    private static final int MAX_VALUE_LENGTH = 256;
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-z][a-z0-9_]{0,31})}");
    private static final Pattern LEGACY_COLOR = Pattern.compile("(?i)&([0-9a-fk-or])");
    private static final Pattern VALUE_COLOR = Pattern.compile("(?i)(?:&|§)[0-9a-fk-or]");
    private static final Map<String, String> COLORS = colors();

    private final StyledMessage warning;
    private final StyledMessage alert;
    private final StyledMessage kick;
    private final StyledMessage temporaryBan;
    private final StyledMessage permanentBan;
    private final StyledMessage loginTemporaryBan;
    private final StyledMessage loginPermanentBan;
    private final StyledMessage modPolicyKick;
    private final String banSource;
    private final Map<String, StyledMessage> checkWarnings;

    public ProtectionMessages(
            StyledMessage warning,
            StyledMessage alert,
            StyledMessage kick,
            StyledMessage temporaryBan,
            StyledMessage permanentBan,
            StyledMessage loginTemporaryBan,
            StyledMessage loginPermanentBan,
            StyledMessage modPolicyKick,
            String banSource,
            Map<String, StyledMessage> checkWarnings
    ) {
        ProtectionMessages defaults = defaultsInternal();
        this.warning = usable(warning, defaults.warning);
        this.alert = usable(alert, defaults.alert);
        this.kick = usable(kick, defaults.kick);
        this.temporaryBan = usable(temporaryBan, defaults.temporaryBan);
        this.permanentBan = usable(permanentBan, defaults.permanentBan);
        this.loginTemporaryBan = usable(loginTemporaryBan, defaults.loginTemporaryBan);
        this.loginPermanentBan = usable(loginPermanentBan, defaults.loginPermanentBan);
        this.modPolicyKick = usable(modPolicyKick, defaults.modPolicyKick);
        this.banSource = plainSetting(banSource, defaults.banSource, 64);
        LinkedHashMap<String, StyledMessage> overrides = new LinkedHashMap<>();
        if (checkWarnings != null) {
            checkWarnings.forEach((check, message) -> {
                String normalized = normalizeCheck(check);
                if (!normalized.isEmpty() && message != null) {
                    overrides.put(normalized, merge(this.warning, message));
                }
            });
        }
        this.checkWarnings = Map.copyOf(overrides);
    }

    private ProtectionMessages(boolean ignored) {
        warning = new StyledMessage("{reason}. Please stop.", "yellow");
        alert = new StyledMessage("Suspicious activity detected: {reason}.", "red");
        kick = new StyledMessage("Removed for suspicious activity: {reason}.", "red");
        temporaryBan = new StyledMessage(
                "Temporarily banned for suspicious activity: {reason} ({duration_minutes}m).", "dark_red");
        permanentBan = new StyledMessage("Banned for suspicious activity: {reason}.", "dark_red");
        loginTemporaryBan = new StyledMessage("Temporarily banned ({remaining_minutes}m remaining).", "red");
        loginPermanentBan = new StyledMessage("You are banned from this server.", "red");
        modPolicyKick = new StyledMessage("Client mod policy: {reason}.", "red");
        banSource = "Server protection";
        checkWarnings = Map.of();
    }

    public static ProtectionMessages defaults() {
        return defaultsInternal();
    }

    private static ProtectionMessages defaultsInternal() {
        return new ProtectionMessages(true);
    }

    public StyledMessage warning() {
        return warning;
    }

    public StyledMessage alert() {
        return alert;
    }

    public StyledMessage kick() {
        return kick;
    }

    public StyledMessage temporaryBan() {
        return temporaryBan;
    }

    public StyledMessage permanentBan() {
        return permanentBan;
    }

    public StyledMessage loginTemporaryBan() {
        return loginTemporaryBan;
    }

    public StyledMessage loginPermanentBan() {
        return loginPermanentBan;
    }

    public StyledMessage modPolicyKick() {
        return modPolicyKick;
    }

    public String banSource() {
        return banSource;
    }

    public Map<String, StyledMessage> checkWarnings() {
        return checkWarnings;
    }

    public StyledMessage warningFor(String check) {
        return checkWarnings.getOrDefault(normalizeCheck(check), warning);
    }

    /** Render a message with a bounded, sanitized set of placeholder values. */
    public static String render(StyledMessage message, Map<String, ?> placeholders) {
        StyledMessage selected = usable(message, defaultsInternal().warning);
        Map<String, String> values = safeValues(placeholders);
        Matcher matcher = PLACEHOLDER.matcher(selected.text());
        StringBuffer output = new StringBuffer();
        while (matcher.find()) {
            String replacement = values.getOrDefault(matcher.group(1), "");
            matcher.appendReplacement(output, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(output);
        String body = singleLine(output.toString()).trim();
        if (body.isEmpty()) body = "Protection action";
        String colored = colorCode(selected.color()) + translateLegacyColors(body);
        if (colored.length() <= MAX_MESSAGE_LENGTH) return colored;
        String shortened = colored.substring(0, MAX_MESSAGE_LENGTH).stripTrailing();
        return shortened.endsWith("§") ? shortened.substring(0, shortened.length() - 1) : shortened;
    }

    /** Merge a possibly partial override over a complete base message. */
    public static StyledMessage merge(StyledMessage base, StyledMessage override) {
        StyledMessage safeBase = usable(base, defaultsInternal().warning);
        if (override == null) return safeBase;
        String text = setting(override.text(), safeBase.text(), MAX_TEMPLATE_LENGTH);
        String color = supportedColor(override.color()) ? override.color() : safeBase.color();
        return new StyledMessage(text, color);
    }

    public static boolean supportedColor(String value) {
        if (value == null || value.isBlank()) return false;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return COLORS.containsKey(normalized)
                || normalized.matches("(?:&|§)[0-9a-f]")
                || normalized.matches("#[0-9a-f]{6}");
    }

    public record StyledMessage(String text, String color) {
        public StyledMessage {
            text = text == null ? "" : singleLine(text).strip();
            if (text.length() > MAX_TEMPLATE_LENGTH) text = text.substring(0, MAX_TEMPLATE_LENGTH).stripTrailing();
            color = color == null ? "" : color.strip();
        }

        public String render(Map<String, ?> placeholders) {
            return ProtectionMessages.render(this, placeholders);
        }
    }

    private static StyledMessage usable(StyledMessage value, StyledMessage fallback) {
        if (value == null) return fallback;
        String text = setting(value.text(), fallback.text(), MAX_TEMPLATE_LENGTH);
        String color = supportedColor(value.color()) ? value.color() : fallback.color();
        return new StyledMessage(text, color);
    }

    private static Map<String, String> safeValues(Map<String, ?> input) {
        if (input == null || input.isEmpty()) return Map.of();
        LinkedHashMap<String, String> safe = new LinkedHashMap<>();
        input.forEach((key, value) -> {
            if (key == null || !key.matches("[a-z][a-z0-9_]{0,31}")) return;
            String rendered = value == null ? "" : String.valueOf(value);
            rendered = VALUE_COLOR.matcher(singleLine(rendered)).replaceAll("").strip();
            if (rendered.length() > MAX_VALUE_LENGTH) {
                rendered = rendered.substring(0, MAX_VALUE_LENGTH).stripTrailing();
            }
            safe.put(key, rendered);
        });
        return Map.copyOf(safe);
    }

    private static String normalizeCheck(String value) {
        if (value == null) return "";
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        return normalized.matches("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*){1,3}") ? normalized : "";
    }

    private static String translateLegacyColors(String value) {
        Matcher matcher = LEGACY_COLOR.matcher(value);
        StringBuffer output = new StringBuffer();
        while (matcher.find()) {
            matcher.appendReplacement(output, Matcher.quoteReplacement("§" + matcher.group(1).toLowerCase(Locale.ROOT)));
        }
        matcher.appendTail(output);
        return output.toString();
    }

    private static String colorCode(String value) {
        if (value == null) return "";
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        String named = COLORS.get(normalized);
        if (named != null) return named;
        if (normalized.matches("(?:&|§)[0-9a-f]")) return "§" + normalized.charAt(1);
        if (normalized.matches("#[0-9a-f]{6}")) {
            StringBuilder legacy = new StringBuilder("§x");
            for (int index = 1; index < normalized.length(); index++) {
                legacy.append('§').append(normalized.charAt(index));
            }
            return legacy.toString();
        }
        return "";
    }

    private static Map<String, String> colors() {
        return Map.ofEntries(
                Map.entry("none", ""),
                Map.entry("black", "§0"),
                Map.entry("dark_blue", "§1"),
                Map.entry("dark_green", "§2"),
                Map.entry("dark_aqua", "§3"),
                Map.entry("dark_red", "§4"),
                Map.entry("dark_purple", "§5"),
                Map.entry("gold", "§6"),
                Map.entry("gray", "§7"),
                Map.entry("grey", "§7"),
                Map.entry("dark_gray", "§8"),
                Map.entry("dark_grey", "§8"),
                Map.entry("blue", "§9"),
                Map.entry("green", "§a"),
                Map.entry("aqua", "§b"),
                Map.entry("red", "§c"),
                Map.entry("light_purple", "§d"),
                Map.entry("yellow", "§e"),
                Map.entry("white", "§f")
        );
    }

    private static String plainSetting(String value, String fallback, int maxLength) {
        String selected = setting(value, fallback, maxLength);
        selected = VALUE_COLOR.matcher(selected.replace("§x", "")).replaceAll("").strip();
        return selected.isEmpty() ? fallback : selected;
    }

    private static String setting(String value, String fallback, int maxLength) {
        String selected = value == null ? "" : singleLine(value).strip();
        if (selected.isEmpty()) selected = fallback;
        return selected.length() <= maxLength ? selected : selected.substring(0, maxLength).stripTrailing();
    }

    private static String singleLine(String value) {
        StringBuilder output = new StringBuilder(value.length());
        boolean previousSpace = false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '\r' || character == '\n' || character == '\t') character = ' ';
            if (Character.isISOControl(character)) continue;
            if (Character.isWhitespace(character)) {
                if (previousSpace) continue;
                character = ' ';
                previousSpace = true;
            } else {
                previousSpace = false;
            }
            output.append(character);
        }
        return output.toString();
    }
}
