package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.AccessPolicy;

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
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Bounded, fail-closed reader for the manager-owned access.yml file.
 *
 * <p>The app deliberately emits a small YAML subset. Keeping that subset parser here avoids
 * shipping another YAML implementation in the server mod while still validating every field
 * that can grant a runtime privilege.</p>
 */
final class FabricAccessPolicy {
    static final long MAX_BYTES = 256L * 1024L;
    static final int MAX_LINES = 16_384;
    static final int MAX_LINE_LENGTH = 2_048;
    static final int MAX_ASSIGNMENTS = AccessPolicy.MAX_ASSIGNMENTS;
    static final int MAX_ROLES = AccessPolicy.MAX_ROLES;
    static final String DEFAULT_DENIED_MESSAGE = "You do not have access to that command.";

    private volatile AccessPolicy policy = AccessPolicy.empty();
    private volatile String deniedMessage = DEFAULT_DENIED_MESSAGE;
    private volatile boolean invalid;
    private volatile boolean managed;

    void load(Path file) throws IOException {
        if (Files.notExists(file)) {
            managed = false;
            clear(false);
            return;
        }
        // While an existing managed file is being validated, never retain grants from the
        // previous snapshot. Reads normally happen on the server thread, but the flag also
        // makes the transition fail closed if another caller observes it concurrently.
        managed = true;
        invalid = true;
        try {
            if (!Files.isRegularFile(file) || Files.size(file) > MAX_BYTES) {
                throw new IOException("access.yml must be a regular file no larger than 256 KiB");
            }
            Parsed parsed = parse(Files.readString(file, StandardCharsets.UTF_8));
            policy = parsed.policy();
            deniedMessage = parsed.deniedMessage();
            invalid = false;
        } catch (IOException | RuntimeException error) {
            clear(true);
            if (error instanceof IOException io) throw io;
            throw new IOException("Invalid access.yml: " + error.getMessage(), error);
        }
    }

    private void clear(boolean malformedExistingFile) {
        if (malformedExistingFile) invalid = true;
        policy = AccessPolicy.empty();
        deniedMessage = DEFAULT_DENIED_MESSAGE;
        invalid = malformedExistingFile;
    }

    Optional<AccessPolicy.Assignment> assignmentFor(String playerName, UUID uuid) {
        return policy.assignmentFor(playerName, uuid);
    }

    AccessPolicy.Role compatibilityRoleFor(String playerName, UUID uuid) {
        return policy.compatibilityRole(assignmentFor(playerName, uuid).orElse(null));
    }

    /** Single predicate shared by Brigadier tree pruning and the packet execution boundary. */
    boolean canUsePlayerView(String playerName, UUID uuid, String commandRoot) {
        String root = AccessPolicy.commandRoot(commandRoot);
        if (!root.equals("ci-spectate") && !root.equals("ci-unspectate")
                && !root.equals("unspectate")) return false;
        String legacyRoot = root.equals("ci-spectate") ? "spectate" : "unspectate";
        return hasCapability(playerName, uuid, AccessPolicy.PLAYER_SPECTATE)
                && !explicitlyDenies(playerName, uuid, root)
                && !explicitlyDenies(playerName, uuid, legacyRoot);
    }

    boolean hasCapability(String playerName, UUID uuid, String capability) {
        return policy.hasCapability(playerName, uuid, capability);
    }

    boolean explicitlyDenies(String playerName, UUID uuid, String commandRoot) {
        AccessPolicy.Assignment assignment = assignmentFor(playerName, uuid).orElse(null);
        return assignment != null && policy.deniedCommands(assignment)
                .contains(AccessPolicy.commandRoot(commandRoot));
    }

    boolean canRun(AccessPolicy.Assignment assignment, String commandLine) {
        return policy.canRun(assignment, commandLine);
    }

    CommandDecision commandDecision(String playerName, UUID uuid, String commandLine) {
        if (invalid) return CommandDecision.DENY;
        Optional<AccessPolicy.Assignment> assignment = assignmentFor(playerName, uuid);
        if (AccessPolicy.PUBLIC_SELF_SERVICE_COMMANDS.contains(AccessPolicy.commandRoot(commandLine))
                || AccessPolicy.isTeamSelfServiceCommand(commandLine)) {
            return policy.canRun(assignment.orElse(null), commandLine)
                    ? CommandDecision.BASELINE : CommandDecision.DENY;
        }
        if (assignment.isEmpty()) {
            if (!managed) return CommandDecision.VANILLA;
            return policy.canRun(null, commandLine) ? CommandDecision.BASELINE : CommandDecision.DENY;
        }
        AccessPolicy.RoleDefinition role = policy.roleFor(assignment.get());
        if (role != null && role.id().equals("member")) {
            return canRun(assignment.get(), commandLine) ? CommandDecision.BASELINE : CommandDecision.DENY;
        }
        return canRun(assignment.get(), commandLine) ? CommandDecision.ELEVATE : CommandDecision.DENY;
    }

    /**
     * Applies the same managed-root decision to the command tree that execution uses later.
     * {@code vanillaUsable} is true only after vanilla has already admitted the node with the
     * permission source selected for this player.
     */
    boolean canSeeCommandRoot(String playerName, UUID uuid, String commandRoot, boolean vanillaUsable) {
        if (!vanillaUsable) return false;
        if (commandRoot.equals("create")) {
            return commandDecision(playerName, uuid, "create team") != CommandDecision.DENY;
        }
        String root = AccessPolicy.commandRoot(commandRoot);
        if (root.equals("ci-spectate") || root.equals("ci-unspectate") || root.equals("unspectate")) {
            return canUsePlayerView(playerName, uuid, root);
        }
        return commandDecision(playerName, uuid, commandRoot) != CommandDecision.DENY;
    }

    boolean canSeeCommandPath(String playerName, UUID uuid, String path) {
        String root = AccessPolicy.commandRoot(path);
        // Only these public roots share a namespace with operator commands. Other roots retain
        // their existing native argument requirements and managed root grants.
        if (!root.equals("team") && !root.equals("create")) return true;
        return commandDecision(playerName, uuid, path) != CommandDecision.DENY;
    }

    CommandDecision suggestionDecision(String playerName, UUID uuid, String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).stripLeading();
        if (clean.startsWith("/")) clean = clean.substring(1);
        if ("create team".startsWith(clean.stripTrailing()) && clean.startsWith("create")) {
            return commandDecision(playerName, uuid, "create team");
        }
        String root = AccessPolicy.commandRoot(clean);
        if (root.equals("team") || root.equals("create")) {
            if ("team hub".startsWith(clean.stripTrailing()) || "team settings".startsWith(clean.stripTrailing())) {
                return commandDecision(playerName, uuid, "team");
            }
            return commandDecision(playerName, uuid, clean);
        }
        return commandDecision(playerName, uuid, root);
    }

    /**
     * Once the manager assigns any privileged role, its role model becomes authoritative for
     * native server permissions too. Unassigned players may still use commands that are genuinely
     * public, but an old ops.json entry must not bypass the manager's role assignments.
     */
    boolean enforcesPrivilegedRoles() {
        return !invalid && managed;
    }

    CommandTreeMode commandTreeMode(String playerName, UUID uuid) {
        if (invalid) return CommandTreeMode.RESTRICTED;
        Optional<AccessPolicy.Assignment> assignment = assignmentFor(playerName, uuid);
        if (assignment.isPresent()) {
            AccessPolicy.RoleDefinition role = policy.roleFor(assignment.get());
            if (role != null && role.id().equals("member")) return CommandTreeMode.RESTRICTED;
            if (role != null && (role.id().equals("owner") || !role.capabilities().isEmpty()
                    || role.commandPolicy().mode() == AccessPolicy.CommandMode.ALL
                    || !role.commandPolicy().groups().isEmpty()
                    || !role.commandPolicy().allow().isEmpty())) {
                // Use an elevated source so Brigadier exposes the granted root's argument tree;
                // CommandTreePruner then removes every unrelated root before sending it.
                return CommandTreeMode.ELEVATED;
            }
            return CommandTreeMode.RESTRICTED;
        }
        return managed
                ? CommandTreeMode.RESTRICTED : CommandTreeMode.VANILLA;
    }

    String deniedMessage() {
        return deniedMessage;
    }

    int size() {
        return policy.assignments().size();
    }

    enum CommandDecision {
        /** Player has no managed assignment; preserve the normal server permission path. */
        VANILLA,
        /** Roleless player may run an exact basic-player root without elevated permissions. */
        BASELINE,
        /** Managed role explicitly does not grant the command root. */
        DENY,
        /** Managed role grants the root; run once with an elevated player command source. */
        ELEVATE
    }

    enum CommandTreeMode {
        VANILLA,
        RESTRICTED,
        ELEVATED
    }

    static Parsed parse(String yaml) throws IOException {
        if (yaml == null) yaml = "";
        if (yaml.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IOException("access.yml exceeds 256 KiB");
        }
        Object document = new YamlSubsetParser(yaml).parse();
        Map<String, Object> root = requireMap(document, "document");
        int version = integer(root.getOrDefault("version", "1"), "version");
        if (version != 1 && version != 2) {
            throw new IOException("access.yml version must be 1 or 2");
        }
        String denied = deniedMessage(root.get("deniedMessage"));
        try {
            AccessPolicy access = version >= 2 ? parseV2(root) : parseV1(root);
            return new Parsed(access, denied);
        } catch (IllegalArgumentException error) {
            throw new IOException("Invalid access.yml: " + error.getMessage(), error);
        }
    }

    private static AccessPolicy parseV2(Map<String, Object> root) throws IOException {
        List<Object> roleEntries = requireList(root.get("roles"), "roles");
        if (roleEntries.size() > MAX_ROLES) throw new IOException("access.yml has too many roles");
        List<AccessPolicy.RoleDefinition> roles = new ArrayList<>(roleEntries.size());
        for (int index = 0; index < roleEntries.size(); index++) {
            Map<String, Object> value = requireMap(roleEntries.get(index), "roles[" + index + "]");
            String id = requiredScalar(value, "id", "roles[" + index + "]");
            Set<String> capabilities = stringSet(value.get("capabilities"),
                    "roles[" + index + "].capabilities", true, AccessPolicy.capabilityIds().size());
            Map<String, Object> commands = requireMap(value.get("commandPolicy"),
                    "roles[" + index + "].commandPolicy");
            AccessPolicy.CommandMode mode = AccessPolicy.CommandMode.parse(
                    requiredScalar(commands, "mode", "roles[" + index + "].commandPolicy"));
            Set<String> groups = stringSet(commands.get("groups"),
                    "roles[" + index + "].commandPolicy.groups", true, 5);
            Set<String> allow = stringSet(commands.get("allow"),
                    "roles[" + index + "].commandPolicy.allow", true,
                    AccessPolicy.MAX_COMMANDS_PER_ROLE);
            Set<String> deny = stringSet(commands.get("deny"),
                    "roles[" + index + "].commandPolicy.deny", true,
                    AccessPolicy.MAX_COMMANDS_PER_ROLE);
            roles.add(new AccessPolicy.RoleDefinition(id, capabilities,
                    new AccessPolicy.CommandPolicy(mode, groups, allow, deny)));
        }
        Set<String> roleIds = new LinkedHashSet<>();
        for (AccessPolicy.RoleDefinition role : roles) roleIds.add(role.id());
        if (!roleIds.containsAll(Set.of("owner", "admin", "member"))) {
            throw new IOException("v2 access.yml must define owner, admin, and member roles");
        }
        List<AccessPolicy.Assignment> assignments = parseV2Assignments(root.get("assignments"));
        return new AccessPolicy(roles, assignments);
    }

    private static List<AccessPolicy.Assignment> parseV2Assignments(Object source) throws IOException {
        List<Object> entries = requireList(source, "assignments");
        if (entries.size() > MAX_ASSIGNMENTS) throw new IOException("access.yml has too many assignments");
        List<AccessPolicy.Assignment> assignments = new ArrayList<>(entries.size());
        for (int index = 0; index < entries.size(); index++) {
            Map<String, Object> value = requireMap(entries.get(index), "assignments[" + index + "]");
            String player = requiredScalar(value, "player", "assignments[" + index + "]");
            String uuid = optionalScalar(value.get("uuid"));
            String roleId = requiredScalar(value, "roleId", "assignments[" + index + "]");
            assignments.add(new AccessPolicy.Assignment(player, uuid, roleId));
        }
        return assignments;
    }

    private static AccessPolicy parseV1(Map<String, Object> root) throws IOException {
        Object source = root.get("assignments");
        List<Object> entries = source == null ? List.of() : requireList(source, "assignments");
        if (entries.size() > MAX_ASSIGNMENTS) throw new IOException("access.yml has too many assignments");
        List<AccessPolicy.Assignment> assignments = new ArrayList<>(entries.size());
        for (int index = 0; index < entries.size(); index++) {
            Map<String, Object> value = requireMap(entries.get(index), "assignments[" + index + "]");
            String player = requiredScalar(value, "player", "assignments[" + index + "]");
            AccessPolicy.Role role = AccessPolicy.Role.parse(
                    optionalScalar(value.getOrDefault("role", "member")));
            Set<String> groups = stringSet(value.get("groups"),
                    "assignments[" + index + "].groups", false, 32);
            Set<String> commands = stringSet(value.get("commands"),
                    "assignments[" + index + "].commands", false, 32);
            assignments.add(new AccessPolicy.Assignment(player, role, groups, commands));
        }
        return new AccessPolicy(assignments);
    }

    private static Map<String, Object> requireMap(Object value, String path) throws IOException {
        if (!(value instanceof Map<?, ?> source)) throw new IOException(path + " must be a map");
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            if (!(entry.getKey() instanceof String key)) throw new IOException(path + " has a non-string key");
            result.put(key, entry.getValue());
        }
        return result;
    }

    private static List<Object> requireList(Object value, String path) throws IOException {
        if (!(value instanceof List<?> source)) throw new IOException(path + " must be a list");
        return new ArrayList<>(source);
    }

    private static Set<String> stringSet(Object value, String path, boolean required, int maximum) throws IOException {
        if (value == null && !required) return Set.of();
        List<Object> source = requireList(value, path);
        if (source.size() > maximum) throw new IOException(path + " contains too many entries");
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (int index = 0; index < source.size(); index++) {
            if (!(source.get(index) instanceof String item) || item.isBlank()) {
                throw new IOException(path + "[" + index + "] must be a non-empty string");
            }
            result.add(item);
        }
        return result;
    }

    private static String requiredScalar(Map<String, Object> source, String name, String path) throws IOException {
        if (!source.containsKey(name)) throw new IOException(path + "." + name + " is required");
        Object value = source.get(name);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IOException(path + "." + name + " must be a non-empty string");
        }
        return text;
    }

    private static String optionalScalar(Object value) throws IOException {
        if (value == null) return "";
        if (!(value instanceof String text)) throw new IOException("Expected a scalar string");
        return text;
    }

    private static int integer(Object value, String path) throws IOException {
        if (!(value instanceof String text)) throw new IOException(path + " must be an integer");
        try {
            return Integer.parseInt(text.strip());
        } catch (NumberFormatException error) {
            throw new IOException(path + " must be an integer", error);
        }
    }

    private static String deniedMessage(Object value) throws IOException {
        if (value == null) return DEFAULT_DENIED_MESSAGE;
        if (!(value instanceof String text)) throw new IOException("deniedMessage must be a string");
        if (text.length() > 256) throw new IOException("deniedMessage is too long");
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character < 0x20) {
                throw new IOException("deniedMessage contains a control character");
            }
        }
        StringBuilder formatted = new StringBuilder(text.length());
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character == '&' && index + 1 < text.length()
                    && "0123456789abcdefklmnor".indexOf(Character.toLowerCase(text.charAt(index + 1))) >= 0) {
                formatted.append('§').append(Character.toLowerCase(text.charAt(++index)));
            } else {
                formatted.append(character);
            }
        }
        return formatted.toString().strip().isEmpty() ? DEFAULT_DENIED_MESSAGE : formatted.toString().strip();
    }

    record Parsed(AccessPolicy policy, String deniedMessage) { }

    /** Parser for maps, lists, quoted scalars, and the inline empty list emitted by the manager. */
    private static final class YamlSubsetParser {
        private final List<Line> lines;
        private int cursor;

        private YamlSubsetParser(String yaml) throws IOException {
            String[] rawLines = yaml.split("\\R", -1);
            if (rawLines.length > MAX_LINES) throw new IOException("access.yml has too many lines");
            lines = new ArrayList<>(rawLines.length);
            for (int index = 0; index < rawLines.length; index++) {
                String raw = rawLines[index];
                if (raw.length() > MAX_LINE_LENGTH) {
                    throw new IOException("access.yml contains an oversized line at " + (index + 1));
                }
                if (raw.indexOf('\t') >= 0) {
                    throw new IOException("access.yml cannot contain tabs at line " + (index + 1));
                }
                String uncommented = stripComment(raw).stripTrailing();
                if (uncommented.isBlank()) continue;
                int indentation = indentation(uncommented);
                if (indentation > 64 || (indentation & 1) != 0) {
                    throw new IOException("Invalid indentation at line " + (index + 1));
                }
                lines.add(new Line(indentation, uncommented.substring(indentation), index + 1));
            }
        }

        Object parse() throws IOException {
            if (lines.isEmpty()) return Map.of();
            if (lines.get(0).indentation() != 0) {
                throw error(lines.get(0), "Document must start at indentation zero");
            }
            Object result = parseBlock(0);
            if (cursor != lines.size()) throw error(lines.get(cursor), "Unexpected trailing content");
            return result;
        }

        private Object parseBlock(int indentation) throws IOException {
            if (cursor >= lines.size() || lines.get(cursor).indentation() != indentation) {
                throw new IOException("Missing YAML block at indentation " + indentation);
            }
            return lines.get(cursor).text().startsWith("- ") || lines.get(cursor).text().equals("-")
                    ? parseList(indentation)
                    : parseMap(indentation);
        }

        private Map<String, Object> parseMap(int indentation) throws IOException {
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            while (cursor < lines.size()) {
                Line line = lines.get(cursor);
                if (line.indentation() < indentation) break;
                if (line.indentation() > indentation) throw error(line, "Unexpected indentation");
                if (line.text().startsWith("- ") || line.text().equals("-")) break;
                cursor++;
                putMapEntry(result, line.text(), indentation, line);
            }
            return result;
        }

        private List<Object> parseList(int indentation) throws IOException {
            List<Object> result = new ArrayList<>();
            while (cursor < lines.size()) {
                Line line = lines.get(cursor);
                if (line.indentation() < indentation) break;
                if (line.indentation() > indentation) throw error(line, "Unexpected list indentation");
                if (!line.text().startsWith("-")
                        || (line.text().length() > 1 && line.text().charAt(1) != ' ')) break;
                String item = line.text().substring(1).stripLeading();
                cursor++;
                if (item.isEmpty()) {
                    result.add(requireNestedBlock(indentation, line));
                } else if (mappingSeparator(item) >= 0) {
                    LinkedHashMap<String, Object> map = new LinkedHashMap<>();
                    putMapEntry(map, item, indentation + 2, line);
                    while (cursor < lines.size()) {
                        Line next = lines.get(cursor);
                        if (next.indentation() < indentation + 2) break;
                        if (next.indentation() > indentation + 2) {
                            throw error(next, "Unexpected map indentation in list item");
                        }
                        if (next.text().startsWith("- ") || next.text().equals("-")) break;
                        cursor++;
                        putMapEntry(map, next.text(), indentation + 2, next);
                    }
                    result.add(map);
                } else {
                    result.add(parseScalar(item, line));
                }
            }
            return result;
        }

        private void putMapEntry(Map<String, Object> target, String text, int indentation, Line line)
                throws IOException {
            int separator = mappingSeparator(text);
            if (separator <= 0) throw error(line, "Expected a key/value pair");
            String key = text.substring(0, separator).strip();
            if (!key.matches("[A-Za-z][A-Za-z0-9._-]{0,63}")) throw error(line, "Invalid key: " + key);
            if (target.containsKey(key)) throw error(line, "Duplicate key: " + key);
            String remainder = text.substring(separator + 1).strip();
            Object value;
            if (remainder.isEmpty()) value = requireNestedBlock(indentation, line);
            else if (remainder.equals("[]")) value = List.of();
            else value = parseScalar(remainder, line);
            target.put(key, value);
        }

        private Object requireNestedBlock(int parentIndentation, Line parent) throws IOException {
            if (cursor >= lines.size() || lines.get(cursor).indentation() <= parentIndentation) {
                throw error(parent, "Empty YAML blocks must be written as []");
            }
            if (lines.get(cursor).indentation() != parentIndentation + 2) {
                throw error(lines.get(cursor), "Nested blocks must use two-space indentation");
            }
            return parseBlock(parentIndentation + 2);
        }

        private static String parseScalar(String value, Line line) throws IOException {
            String clean = value.strip();
            if (clean.isEmpty()) return "";
            if (clean.charAt(0) == '"') return parseDoubleQuoted(clean, line);
            if (clean.charAt(0) == '\'') return parseSingleQuoted(clean, line);
            if (clean.startsWith("[") || clean.startsWith("{") || clean.startsWith("&")
                    || clean.startsWith("*") || clean.startsWith("!") || clean.equals("|")
                    || clean.equals(">")) {
                throw error(line, "Unsupported YAML scalar");
            }
            return clean;
        }

        private static String parseDoubleQuoted(String value, Line line) throws IOException {
            if (value.length() < 2 || value.charAt(value.length() - 1) != '"') {
                throw error(line, "Unterminated double-quoted string");
            }
            StringBuilder result = new StringBuilder(value.length() - 2);
            for (int index = 1; index < value.length() - 1; index++) {
                char character = value.charAt(index);
                if (character != '\\') {
                    if (character < 0x20) throw error(line, "Control character in quoted string");
                    result.append(character);
                    continue;
                }
                if (++index >= value.length() - 1) throw error(line, "Invalid quoted-string escape");
                char escaped = value.charAt(index);
                switch (escaped) {
                    case '"', '\\', '/' -> result.append(escaped);
                    case 'b' -> result.append('\b');
                    case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n');
                    case 'r' -> result.append('\r');
                    case 't' -> result.append('\t');
                    case 'u' -> {
                        if (index + 4 >= value.length()) throw error(line, "Invalid Unicode escape");
                        String hex = value.substring(index + 1, index + 5);
                        try {
                            result.append((char) Integer.parseInt(hex, 16));
                        } catch (NumberFormatException error) {
                            throw error(line, "Invalid Unicode escape");
                        }
                        index += 4;
                    }
                    default -> throw error(line, "Unsupported quoted-string escape");
                }
            }
            return result.toString();
        }

        private static String parseSingleQuoted(String value, Line line) throws IOException {
            if (value.length() < 2 || value.charAt(value.length() - 1) != '\'') {
                throw error(line, "Unterminated single-quoted string");
            }
            String body = value.substring(1, value.length() - 1);
            for (int index = 0; index < body.length(); index++) {
                if (body.charAt(index) == '\'' && (index + 1 >= body.length() || body.charAt(index + 1) != '\'')) {
                    throw error(line, "Single quotes must be doubled inside a quoted string");
                }
                if (body.charAt(index) == '\'') index++;
            }
            return body.replace("''", "'");
        }

        private static int mappingSeparator(String text) {
            boolean single = false;
            boolean doubled = false;
            boolean escaped = false;
            for (int index = 0; index < text.length(); index++) {
                char character = text.charAt(index);
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (character == '\\' && doubled) {
                    escaped = true;
                    continue;
                }
                if (character == '\'' && !doubled) single = !single;
                else if (character == '"' && !single) doubled = !doubled;
                else if (character == ':' && !single && !doubled) return index;
            }
            return -1;
        }

        private static String stripComment(String line) {
            boolean single = false;
            boolean doubled = false;
            boolean escaped = false;
            for (int index = 0; index < line.length(); index++) {
                char character = line.charAt(index);
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (character == '\\' && doubled) {
                    escaped = true;
                    continue;
                }
                if (character == '\'' && !doubled) single = !single;
                else if (character == '"' && !single) doubled = !doubled;
                else if (character == '#' && !single && !doubled) return line.substring(0, index);
            }
            return line;
        }

        private static int indentation(String line) {
            int count = 0;
            while (count < line.length() && line.charAt(count) == ' ') count++;
            return count;
        }

        private static IOException error(Line line, String message) {
            return new IOException(message + " at line " + line.number());
        }
    }

    private record Line(int indentation, String text, int number) { }
}
