package com.servermanager.teleport.core;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Configurable, bounded, single-line player messages with safe placeholder expansion. */
public final class MessageCatalog {
    public static final int MAX_MESSAGE_LENGTH = 512;
    private static final int MAX_TEMPLATE_LENGTH = 1_024;
    private static final int MAX_VALUE_LENGTH = 256;
    private static final Pattern KEY = Pattern.compile("[a-z][a-z0-9-]{0,63}");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([a-z][a-z0-9_]{0,31})}");
    private static final Pattern LEGACY_COLOR = Pattern.compile("(?i)&([0-9a-fk-or])");
    private static final Pattern VALUE_COLOR = Pattern.compile("(?i)(?:&|§)[0-9a-fk-orx]");
    private static final Map<String, String> DEFAULTS = defaultsInternal();

    private final Map<String, String> templates;

    public MessageCatalog(Map<String, String> overrides) {
        LinkedHashMap<String, String> merged = new LinkedHashMap<>(DEFAULTS);
        if (overrides != null) {
            overrides.forEach((key, value) -> {
                String normalized = normalizeKey(key);
                if (!DEFAULTS.containsKey(normalized) || value == null) return;
                merged.put(normalized, cleanTemplate(value));
            });
        }
        templates = Map.copyOf(merged);
    }

    public static MessageCatalog defaults() {
        return new MessageCatalog(Map.of());
    }

    public static Map<String, String> defaultTemplates() {
        return DEFAULTS;
    }

    public String render(String key, Map<String, ?> placeholders) {
        String template = templates.getOrDefault(normalizeKey(key), "");
        if (template.isEmpty()) return "";
        Map<String, String> values = safeValues(placeholders);
        Matcher matcher = PLACEHOLDER.matcher(template);
        StringBuffer output = new StringBuffer();
        while (matcher.find()) {
            matcher.appendReplacement(output, Matcher.quoteReplacement(values.getOrDefault(matcher.group(1), "")));
        }
        matcher.appendTail(output);
        String rendered = translateLegacyColors(singleLine(output.toString()).strip());
        if (rendered.length() <= MAX_MESSAGE_LENGTH) return rendered;
        String shortened = rendered.substring(0, MAX_MESSAGE_LENGTH).stripTrailing();
        return shortened.endsWith("§") ? shortened.substring(0, shortened.length() - 1) : shortened;
    }

    public String template(String key) {
        return templates.getOrDefault(normalizeKey(key), "");
    }

    private static String normalizeKey(String value) {
        String normalized = value == null ? "" : value.strip().toLowerCase(Locale.ROOT);
        return KEY.matcher(normalized).matches() ? normalized : "";
    }

    private static String cleanTemplate(String value) {
        String clean = singleLine(value == null ? "" : value).strip();
        return clean.length() <= MAX_TEMPLATE_LENGTH
                ? clean
                : clean.substring(0, MAX_TEMPLATE_LENGTH).stripTrailing();
    }

    private static Map<String, String> safeValues(Map<String, ?> input) {
        if (input == null || input.isEmpty()) return Map.of();
        LinkedHashMap<String, String> safe = new LinkedHashMap<>();
        input.forEach((key, value) -> {
            if (key == null || !key.matches("[a-z][a-z0-9_]{0,31}")) return;
            String rendered = singleLine(value == null ? "" : String.valueOf(value));
            rendered = VALUE_COLOR.matcher(rendered).replaceAll("").strip();
            if (rendered.length() > MAX_VALUE_LENGTH) {
                rendered = rendered.substring(0, MAX_VALUE_LENGTH).stripTrailing();
            }
            safe.put(key, rendered);
        });
        return Map.copyOf(safe);
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

    private static Map<String, String> defaultsInternal() {
        return Map.ofEntries(
                Map.entry("players-only", "&cOnly a player can use that command."),
                Map.entry("no-permission", "&cYou do not have permission to do that."),
                Map.entry("usage-tpa", "&eUsage: /tpa <player|location>, /tpa accept, /tpa decline, /tpa set <name>, /tpa list, or /tpa delete <name>"),
                Map.entry("usage-location-set", "&eUsage: /tpa set <name>"),
                Map.entry("usage-location-delete", "&eUsage: /tpa delete <name>"),
                Map.entry("usage-tpaccept", "&eUsage: /tpa accept [player]"),
                Map.entry("usage-tpdeny", "&eUsage: /tpa decline [player]"),
                Map.entry("usage-tpacancel", "&eUsage: /tpacancel"),
                Map.entry("usage-admin", "&eUsage: /serverteleport reload"),
                Map.entry("player-unavailable", "&cThat player is not available."),
                Map.entry("location-invalid-name", "&cLocation names must use 1-24 letters, numbers, underscores, or hyphens. accept, decline, set, list, and delete are reserved."),
                Map.entry("location-limit", "&cYou can save at most {limit} locations. Delete one before adding another."),
                Map.entry("location-saved", "&aSaved your current location as {name}."),
                Map.entry("location-deleted", "&aDeleted saved location {name}."),
                Map.entry("location-list", "&eSaved locations: {locations}"),
                Map.entry("location-none", "&eYou have no saved locations. Use /tpa set <name> to add one."),
                Map.entry("location-not-found", "&cNo online player or saved location named {name} was found."),
                Map.entry("location-storage-failed", "&cSaved locations are temporarily unavailable. Check the server log."),
                Map.entry("location-world-unavailable", "&cThe world for {name} ({world}) is not loaded or no longer matches."),
                Map.entry("location-unsafe", "&cThat location is outside the world's safe teleport bounds."),
                Map.entry("location-teleported", "&aTeleported to {name}."),
                Map.entry("cannot-target-self", "&cYou cannot send a teleport request to yourself."),
                Map.entry("already-pending", "&eCancel your request to {target} before sending another."),
                Map.entry("target-limit", "&cThat player already has too many pending requests."),
                Map.entry("cooldown", "&eWait {seconds}s before sending another teleport request."),
                Map.entry("request-sent", "&aTeleport request sent to {target}."),
                Map.entry("request-received", "&eYou got a TPA request from {requester}. Would you like to accept or decline?"),
                Map.entry("choose-request", "&eChoose a pending request: {requests}"),
                Map.entry("no-pending", "&cYou have no pending teleport requests."),
                Map.entry("no-matching-request", "&cThere is no pending request from {requester}."),
                Map.entry("accepted-requester", "&a{target} accepted your teleport request."),
                Map.entry("accepted-target", "&aAccepted {requester}'s teleport request."),
                Map.entry("denied-requester", "&c{target} denied your teleport request."),
                Map.entry("denied-target", "&eDenied {requester}'s teleport request."),
                Map.entry("cancelled-requester", "&eYour teleport request was cancelled."),
                Map.entry("cancelled-target", "&e{requester} cancelled their teleport request."),
                Map.entry("expired-requester", "&eYour teleport request to {target} expired."),
                Map.entry("expired-target", "&e{requester}'s teleport request expired."),
                Map.entry("requester-left-target", "&e{requester} left, so their teleport request was cancelled."),
                Map.entry("target-left-requester", "&e{target} left, so your teleport request was cancelled."),
                Map.entry("cross-world-disabled", "&cCross-world teleports are disabled."),
                Map.entry("teleport-failed", "&cThe teleport could not be completed."),
                Map.entry("reload-complete", "&aTeleport settings reloaded."),
                Map.entry("reload-failed", "&cTeleport settings could not be reloaded. Check the server log.")
        );
    }
}
