package dev.serverteleport.fabric.core;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Configurable, bounded, single-line messages with safe placeholder expansion. */
public final class MessageCatalog {
    public static final int MAX_MESSAGE_LENGTH = 512;
    private static final int MAX_TEMPLATE_LENGTH = 1_024;
    private static final int MAX_VALUE_LENGTH = 448;
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
                Map.entry("players-only", "Only a player can use that command."),
                Map.entry("usage-tpa", "Usage: /tpa <saved place or player> | /rtpa | /tpa player <player> | /tpa accept | /tpa decline | /tpa back | /tpa set <place> | /tpa go <place> | /tpa list | /tpa delete <place>"),
                Map.entry("usage-tpa-set", "Usage: /tpa set <name>"),
                Map.entry("usage-tpa-go", "Usage: /tpa go <name>"),
                Map.entry("usage-tpa-player", "Usage: /tpa player <username>"),
                Map.entry("usage-tpa-delete", "Usage: /tpa delete <name>"),
                Map.entry("usage-tpaccept", "Usage: /tpa accept [player]"),
                Map.entry("usage-tpdeny", "Usage: /tpa decline [player]"),
                Map.entry("usage-tpacancel", "Usage: /tpacancel"),
                Map.entry("usage-admin", "Usage: /serverteleport reload"),
                Map.entry("player-unavailable", "That player is not online."),
                Map.entry("destination-unavailable", "No exact online player or saved place named {name} was found."),
                Map.entry("destination-ambiguous", "That name matches both your saved place and online player {player}. Use /tpa go {name} for the saved place or /tpa player {player} for the player."),
                Map.entry("cannot-target-self", "You cannot send a teleport request to yourself."),
                Map.entry("already-pending", "Cancel your request to {target} before sending another."),
                Map.entry("target-limit", "That player already has too many pending requests."),
                Map.entry("server-limit", "The server has reached its pending teleport request limit. Try again shortly."),
                Map.entry("cooldown", "Wait {seconds}s before sending another teleport request."),
                Map.entry("request-sent", "Teleport request sent to {target}."),
                Map.entry("request-received-prompt", "You got a TPA request from {requester}. Would you like to"),
                Map.entry("choose-request", "Choose a pending request: {requests}"),
                Map.entry("no-pending", "You have no pending teleport requests."),
                Map.entry("no-matching-request", "There is no pending request from {requester}."),
                Map.entry("request-processing", "That teleport request is already being processed."),
                Map.entry("accepted-requester", "{target} accepted your teleport request."),
                Map.entry("accepted-target", "Accepted {requester}'s teleport request."),
                Map.entry("denied-requester", "{target} denied your teleport request."),
                Map.entry("denied-target", "Denied {requester}'s teleport request."),
                Map.entry("cancelled-requester", "Your teleport request was cancelled."),
                Map.entry("cancelled-target", "{requester} cancelled their teleport request."),
                Map.entry("cancelled-for-local-travel-requester", "Your pending teleport request to {target} was cancelled before local travel."),
                Map.entry("cancelled-for-local-travel-target", "{requester} chose another destination, so their teleport request was cancelled."),
                Map.entry("expired-requester", "Your teleport request to {target} expired."),
                Map.entry("expired-target", "{requester}'s teleport request expired."),
                Map.entry("requester-left-target", "{requester} left, so their teleport request was cancelled."),
                Map.entry("target-left-requester", "{target} left, so your teleport request was cancelled."),
                Map.entry("cross-dimension-disabled", "Cross-dimension teleporting is disabled on this server."),
                Map.entry("overworld-only", "TPA currently works only within the Overworld. Nether, End and cross-dimension travel are disabled."),
                Map.entry("return-lock-blocked", "You escaped PvP by TPA. Wait {seconds}s before teleporting within 160 blocks of that fight."),
                Map.entry("return-lock-armed", "PvP escape: TPA return within 160 blocks of your departure is locked for {seconds}s. Death clears this lock."),
                Map.entry("return-lock-storage-failed", "TPA is temporarily unavailable because combat return-lock data could not be safely saved or read. Ask an administrator to check the log."),
                Map.entry("trusted-auto-accept", "Automatically accepted trusted teammate {requester}'s TPA request. Normal combat and destination rules still apply."),
                Map.entry("request-failed-target", "TPA from {requester} failed its combat, dimension, availability or destination checks. They have not completed that TPA; they received the reason. You can retry acceptance if the request remains pending."),
                Map.entry("request-cancelled-target", "TPA from {requester} was cancelled before completion. A new request is needed."),
                Map.entry("teleport-failed", "The teleport could not be completed safely."),
                Map.entry("destination-loading", "Preparing the destination terrain..."),
                Map.entry("destination-busy", "Several teleports are being prepared. Try again shortly."),
                Map.entry("destination-moving", "The destination player is moving too far. Ask them to stop briefly and accept again."),
                Map.entry("destination-chunk-unavailable", "The destination terrain could not be loaded safely. Try again."),
                Map.entry("random-searching", "Searching for a safe random place in the Overworld..."),
                Map.entry("random-teleported", "Teleported to a random safe place in the Overworld. Use /tpa back to return."),
                Map.entry("random-no-safe-destination", "No safe random Overworld surface was found within the current world border. You have not moved; try again shortly."),
                Map.entry("random-cooldown", "Wait {seconds}s before requesting another random teleport."),
                Map.entry("warmup-countdown", "Teleporting in {seconds}..."),
                Map.entry("warmup-already-running", "A teleport countdown is already running."),
                Map.entry("warmup-cancelled-moved", "Teleport cancelled because you moved."),
                Map.entry("warmup-cancelled-damage", "Teleport cancelled because you took damage."),
                Map.entry("warmup-cancelled-combat", "Teleport cancelled because you attacked another player."),
                Map.entry("warmup-cancelled-unsafe", "Teleport cancelled because your player state changed."),
                Map.entry("warmup-cancelled-manual", "Teleport countdown cancelled."),
                Map.entry("travel-player-passenger", "Another player is riding in your travel group and has not consented to move."),
                Map.entry("travel-group-too-large", "Your vehicle, pets, and attached entities exceed the safe travel limit of {max}."),
                Map.entry("travel-destination-unsafe", "There is not enough safe space for your vehicle and nearby animals at the destination."),
                Map.entry("travel-dimension-unsupported", "{entity} cannot safely travel to that world."),
                Map.entry("travel-entity-unavailable", "An animal or vehicle moved before the teleport could finish. Try again."),
                Map.entry("back-unavailable", "There is no previous TPA location to return to."),
                Map.entry("back-world-unavailable", "The world for your previous TPA location is not available."),
                Map.entry("back-teleported", "Returned to your previous TPA location."),
                Map.entry("location-invalid-name", "Place names must be 1-{max} letters, numbers, spaces, underscores, or hyphens and cannot be accept, decline, set, list, or delete."),
                Map.entry("location-invalid-name-v2", "Place names must be 1-{max} letters, numbers, spaces, underscores, or hyphens and cannot be accept, decline, set, list, or delete."),
                Map.entry("location-limit", "You can save at most {max} places. Delete one before adding another."),
                Map.entry("location-saved", "Saved this place as {name}. Use /tpa go {name} to return."),
                Map.entry("location-saved-go", "Saved this place as {name}. Use /tpa go {name} to return."),
                Map.entry("location-list", "Saved places: {locations}"),
                Map.entry("location-none", "You have no saved places. Use /tpa set home to save one."),
                Map.entry("location-not-found", "You do not have a saved place named {name}."),
                Map.entry("location-deleted", "Deleted the saved place {name}."),
                Map.entry("location-storage-failed", "Saved places are temporarily unavailable. Ask a server administrator to check the log."),
                Map.entry("location-world-unavailable", "The world for {name} is not available."),
                Map.entry("location-unsafe", "The saved place {name} is no longer safe to enter."),
                Map.entry("location-teleported", "Teleported to {name}."),
                Map.entry("reload-complete", "Server Teleport settings reloaded."),
                Map.entry("reload-failed", "Server Teleport settings could not be reloaded. Check the server log.")
        );
    }
}
