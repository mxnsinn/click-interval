package dev.servertradeassistant.fabric.access;

import dev.servertradeassistant.fabric.core.TradePricing;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Reads only the manager-owned role fields required by this module. It deliberately does not try
 * to implement a general YAML parser: the app emits a strict, bounded schema and unknown fields
 * are ignored.
 */
public final class RoleAccessPolicy {
    private static final long MAX_BYTES = 256L * 1024L;
    private static final int MAX_LINES = 8_192;
    private static final int MAX_LINE_LENGTH = 4_096;
    private static final Pattern PLAYER_NAME = Pattern.compile("^[A-Za-z0-9_]{1,16}$");
    private static final Pattern ROLE_ID = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,31}$");

    public record Decision(boolean rerollAllowed, int tradeDiscountPercent, String roleId) { }

    private static final Set<String> KNOWN_CAPABILITIES = Set.of(
            "trade.reroll", "entity.labels", "entity.inspect", "entity.edit");
    private record RoleRule(String id, int discount, boolean rerollAllowed, Set<String> capabilities) { }
    private record Assignment(String player, String uuid, String roleId) { }

    private final Map<String, RoleRule> roles;
    private final Map<String, Assignment> byName;
    private final Map<String, Assignment> byUuid;

    private RoleAccessPolicy(List<RoleRule> roleRules, List<Assignment> assignments) {
        LinkedHashMap<String, RoleRule> roleMap = new LinkedHashMap<>();
        for (RoleRule role : roleRules) {
            if (roleMap.size() >= 323) break;
            roleMap.putIfAbsent(role.id(), role);
        }
        LinkedHashMap<String, Assignment> names = new LinkedHashMap<>();
        LinkedHashMap<String, Assignment> uuids = new LinkedHashMap<>();
        for (Assignment assignment : assignments) {
            if (names.size() >= 256 || !roleMap.containsKey(assignment.roleId())) continue;
            names.putIfAbsent(assignment.player().toLowerCase(Locale.ROOT), assignment);
            if (!assignment.uuid().isEmpty()) uuids.putIfAbsent(assignment.uuid(), assignment);
        }
        roles = Map.copyOf(roleMap);
        byName = Map.copyOf(names);
        byUuid = Map.copyOf(uuids);
    }

    public static RoleAccessPolicy empty() {
        return new RoleAccessPolicy(List.of(), List.of());
    }

    public static RoleAccessPolicy read(Path file) throws IOException {
        if (!Files.isRegularFile(file)) return empty();
        if (Files.size(file) > MAX_BYTES) throw new IOException("access.yml exceeds 256 KiB");
        return parse(Files.readString(file, StandardCharsets.UTF_8));
    }

    public static RoleAccessPolicy parse(String yaml) throws IOException {
        String[] lines = String.valueOf(yaml == null ? "" : yaml).split("\\R", -1);
        if (lines.length > MAX_LINES) throw new IOException("access.yml has too many lines");
        List<RoleRule> roles = new ArrayList<>();
        List<Assignment> assignments = new ArrayList<>();
        MutableRole role = null;
        MutableAssignment assignment = null;
        Section section = Section.NONE;
        String listName = "";

        for (int index = 0; index < lines.length; index++) {
            String raw = lines[index];
            if (raw.length() > MAX_LINE_LENGTH) throw new IOException("Oversized access.yml line " + (index + 1));
            if (raw.indexOf('\t') >= 0) throw new IOException("Tabs are not allowed in access.yml");
            int indent = indentation(raw);
            String line = raw.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            if (indent == 0 && line.equals("roles:")) {
                if (assignment != null) assignments.add(assignment.finish());
                assignment = null;
                section = Section.ROLES;
                listName = "";
                continue;
            }
            if (indent == 0 && (line.equals("assignments:") || line.equals("assignments: []"))) {
                if (role != null) roles.add(role.finish());
                role = null;
                section = Section.ASSIGNMENTS;
                listName = "";
                continue;
            }
            if (section == Section.ROLES) {
                if (indent == 2 && line.startsWith("- id:")) {
                    if (role != null) roles.add(role.finish());
                    role = new MutableRole(scalar(line.substring(5)));
                    listName = "";
                } else if (role != null && indent == 4 && line.startsWith("tradeDiscountPercent:")) {
                    role.discount = parseInteger(scalar(line.substring("tradeDiscountPercent:".length())), 0);
                } else if (role != null && indent == 4 && line.startsWith("tradeRerollAllowed:")) {
                    role.explicitAllowed = parseBoolean(scalar(line.substring("tradeRerollAllowed:".length())));
                } else if (role != null && indent == 4 && line.startsWith("capabilities:")) {
                    listName = "capabilities";
                } else if (role != null && indent == 6 && line.startsWith("mode:")) {
                    role.commandModeAll = scalar(line.substring(5)).equalsIgnoreCase("all");
                    listName = "";
                } else if (role != null && indent == 6 && line.startsWith("allow:")) {
                    listName = "allow";
                } else if (role != null && line.startsWith("- ")) {
                    String value = scalar(line.substring(2)).toLowerCase(Locale.ROOT);
                    if (listName.equals("capabilities") && KNOWN_CAPABILITIES.contains(value)) {
                        role.capabilities.add(value);
                        if (value.equals("trade.reroll")) role.capabilityAllowed = true;
                    }
                    if (listName.equals("allow") && isTradeCommand(value)) role.commandAllowed = true;
                }
            } else if (section == Section.ASSIGNMENTS) {
                if (indent == 2 && line.startsWith("- player:")) {
                    if (assignment != null) assignments.add(assignment.finish());
                    assignment = new MutableAssignment(scalar(line.substring(9)));
                } else if (assignment != null && indent == 4 && line.startsWith("uuid:")) {
                    assignment.uuid = scalar(line.substring(5)).toLowerCase(Locale.ROOT);
                } else if (assignment != null && indent == 4 && line.startsWith("roleId:")) {
                    assignment.roleId = scalar(line.substring(7)).toLowerCase(Locale.ROOT);
                }
            }
        }
        if (role != null) roles.add(role.finish());
        if (assignment != null) assignments.add(assignment.finish());
        return new RoleAccessPolicy(roles, assignments);
    }

    public Decision decide(String playerName, UUID playerId, boolean requirePermission, int defaultDiscount) {
        Assignment assignment = assignment(playerName, playerId);
        RoleRule role = assignment == null ? null : roles.get(assignment.roleId());
        int discount = role == null
                ? TradePricing.clampDiscountPercent(defaultDiscount)
                : role.discount();
        boolean allowed = !requirePermission || (role != null && role.rerollAllowed());
        return new Decision(allowed, discount, role == null ? "" : role.id());
    }

    public boolean hasCapability(String playerName, UUID playerId, String capability) {
        String id = String.valueOf(capability == null ? "" : capability).trim().toLowerCase(Locale.ROOT);
        if (!KNOWN_CAPABILITIES.contains(id)) return false;
        Assignment assignment = assignment(playerName, playerId);
        RoleRule role = assignment == null ? null : roles.get(assignment.roleId());
        return role != null && (role.id().equals("owner") || role.capabilities().contains(id));
    }

    private Assignment assignment(String playerName, UUID playerId) {
        Assignment assignment = playerId == null ? null : byUuid.get(playerId.toString().toLowerCase(Locale.ROOT));
        if (assignment == null && playerName != null) {
            Assignment byPlayerName = byName.get(playerName.toLowerCase(Locale.ROOT));
            if (byPlayerName != null && (byPlayerName.uuid().isEmpty() || playerId == null
                    || byPlayerName.uuid().equalsIgnoreCase(playerId.toString()))) {
                assignment = byPlayerName;
            }
        }
        return assignment;
    }

    private static boolean isTradeCommand(String value) {
        int namespace = value.indexOf(':');
        String command = namespace >= 0 ? value.substring(namespace + 1) : value;
        return command.equals("tradeassistant") || command.equals("tradecycle") || command.equals("cycletrades");
    }

    private static int indentation(String value) {
        int count = 0;
        while (count < value.length() && value.charAt(count) == ' ') count++;
        return count;
    }

    private static String scalar(String value) throws IOException {
        String clean = String.valueOf(value == null ? "" : value).trim();
        if (clean.startsWith("\"") && clean.endsWith("\"") && clean.length() >= 2) {
            String body = clean.substring(1, clean.length() - 1);
            StringBuilder decoded = new StringBuilder(body.length());
            boolean escaped = false;
            for (int index = 0; index < body.length(); index++) {
                char character = body.charAt(index);
                if (escaped) {
                    decoded.append(switch (character) {
                        case 'n' -> '\n';
                        case 'r' -> '\r';
                        case 't' -> '\t';
                        case '\\', '\"', '/' -> character;
                        default -> throw new IOException("Unsupported escape in access.yml");
                    });
                    escaped = false;
                } else if (character == '\\') {
                    escaped = true;
                } else {
                    decoded.append(character);
                }
            }
            if (escaped) throw new IOException("Invalid quoted value in access.yml");
            return decoded.toString();
        }
        int comment = clean.indexOf(" #");
        return comment < 0 ? clean : clean.substring(0, comment).trim();
    }

    private static int parseInteger(String value, int fallback) {
        try { return Integer.parseInt(value); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static boolean parseBoolean(String value) {
        return value.equalsIgnoreCase("true") || value.equalsIgnoreCase("yes") || value.equals("1");
    }

    private enum Section { NONE, ROLES, ASSIGNMENTS }

    private static final class MutableRole {
        private final String id;
        private int discount;
        private boolean explicitAllowed;
        private boolean capabilityAllowed;
        private boolean commandAllowed;
        private boolean commandModeAll;
        private final Set<String> capabilities = new LinkedHashSet<>();

        private MutableRole(String id) {
            this.id = id.toLowerCase(Locale.ROOT);
        }

        private RoleRule finish() throws IOException {
            if (!ROLE_ID.matcher(id).matches()) throw new IOException("Invalid role ID in access.yml");
            boolean allowed = id.equals("owner") || explicitAllowed || capabilityAllowed || commandAllowed || commandModeAll;
            return new RoleRule(id, TradePricing.clampDiscountPercent(discount), allowed,
                    Set.copyOf(capabilities));
        }
    }

    private static final class MutableAssignment {
        private final String player;
        private String uuid = "";
        private String roleId = "";

        private MutableAssignment(String player) {
            this.player = player;
        }

        private Assignment finish() throws IOException {
            if (!PLAYER_NAME.matcher(player).matches() || !ROLE_ID.matcher(roleId).matches()) {
                throw new IOException("Invalid role assignment in access.yml");
            }
            try {
                if (!uuid.isEmpty()) UUID.fromString(uuid);
            } catch (IllegalArgumentException invalid) {
                throw new IOException("Invalid UUID in access.yml", invalid);
            }
            return new Assignment(player, uuid, roleId);
        }
    }
}
