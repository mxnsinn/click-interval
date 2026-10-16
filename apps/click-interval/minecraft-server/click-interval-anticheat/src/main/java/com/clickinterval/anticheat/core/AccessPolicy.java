package com.clickinterval.anticheat.core;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/** Immutable, runtime-independent access policy shared by Bukkit and Fabric adapters. */
public final class AccessPolicy {
    public static final int MAX_ASSIGNMENTS = 256;
    public static final int MAX_ROLES = MAX_ASSIGNMENTS + 64 + 3;
    public static final int MAX_CUSTOM_ROLES = 64;
    public static final int MAX_COMMANDS_PER_ROLE = 64;
    public static final Set<String> PUBLIC_BOUNTY_COMMANDS = Set.of("bounties", "setbounty");
    public static final Set<String> PUBLIC_TEAM_COMMANDS = Set.of(
            "teams", "create;team", "team;invite", "team;accept", "team;decline", "team;leave", "team;disband");
    /** Public self-service roots; adapters must execute these without operator elevation. */
    public static final Set<String> PUBLIC_SELF_SERVICE_COMMANDS = Set.of(
            "bounties", "setbounty", "market", "auctionhouse", "ah", "enchants", "serverenchantments",
            "tc", "ceasefire", "teams", "create;team", "team;invite", "team;accept", "team;decline", "team;leave", "team;disband");
    public static final Set<String> DEFAULT_PLAYER_COMMANDS = Set.of(
            "tpa", "rtpa", "tpaccept", "tpdeny", "tpacancel",
            "msg", "tell", "w", "whisper", "bounties", "setbounty", "market", "auctionhouse", "ah",
            "enchants", "serverenchantments", "tc", "ceasefire", "teams", "create;team", "team;invite", "team;accept", "team;decline", "team;leave", "team;disband");
    public static final String PLAYER_SPECTATE = "player.spectate";
    public static final String PLAYER_COORDINATES = "player.coordinates";
    public static final String PLAYER_DIMENSION = "player.dimension";
    public static final String TRADE_REROLL = "trade.reroll";
    public static final String ENTITY_LABELS = "entity.labels";
    public static final String ENTITY_INSPECT = "entity.inspect";
    public static final String ENTITY_EDIT = "entity.edit";
    public static final String SERVER_STOP = "server.stop";
    public static final String SERVER_RESTART = "server.restart";
    public static final String PROTECTION_MANAGE = "protection.manage";
    public static final String PROTECTION_BYPASS = "protection.bypass";

    private static final Pattern PLAYER_NAME = Pattern.compile("^[A-Za-z0-9_]{1,16}$");
    private static final Pattern UUID_TEXT = Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern ROLE_ID = Pattern.compile("^[a-z0-9][a-z0-9._-]{0,31}$");
    private static final Pattern COMMAND_ROOT = Pattern.compile("^(?:[a-z0-9._-]+:)?[a-z0-9._-]{1,64}$");
    private static final String LEGACY_ADMIN_PREFIX = "legacy-admin-";
    private static final Set<String> CAPABILITIES = Set.of(
            PLAYER_SPECTATE, PLAYER_COORDINATES, PLAYER_DIMENSION,
            TRADE_REROLL, ENTITY_LABELS, ENTITY_INSPECT, ENTITY_EDIT,
            SERVER_STOP, SERVER_RESTART, PROTECTION_MANAGE, PROTECTION_BYPASS);
    /** Roots capable of running another command now or from a data-pack callback. */
    private static final Set<String> DELEGATION_COMMANDS = Set.of(
            "execute", "function", "schedule", "debug", "return");
    private static final Map<String, Set<String>> COMMAND_GROUPS = commandGroups();

    /** Compatibility projection used by legacy config and owner/admin exemption switches. */
    public enum Role {
        OWNER,
        ADMIN,
        MEMBER;

        public static Role parse(String value) {
            try {
                return Role.valueOf(String.valueOf(value).trim().toUpperCase(Locale.ROOT));
            } catch (RuntimeException invalid) {
                throw new IllegalArgumentException("Role must be owner, admin, or member.");
            }
        }
    }

    public enum CommandMode {
        ALL,
        ALLOWLIST;

        public static CommandMode parse(String value) {
            return switch (String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT)) {
                case "all" -> ALL;
                case "allowlist" -> ALLOWLIST;
                default -> throw new IllegalArgumentException("Command access mode must be all or allowlist.");
            };
        }
    }

    public record CommandPolicy(
            CommandMode mode,
            Set<String> groups,
            Set<String> allow,
            Set<String> deny
    ) {
        public CommandPolicy {
            if (mode == null) throw new IllegalArgumentException("Command access mode is required.");
            groups = normalizeGroups(groups);
            allow = normalizeCommands(allow, MAX_COMMANDS_PER_ROLE);
            deny = normalizeCommands(deny, MAX_COMMANDS_PER_ROLE);
        }

        public static CommandPolicy allowlist(Collection<String> groups, Collection<String> allow) {
            return new CommandPolicy(CommandMode.ALLOWLIST,
                    copy(groups), copy(allow), Set.of());
        }

        private static Set<String> copy(Collection<String> values) {
            return values == null ? Set.of() : new LinkedHashSet<>(values);
        }
    }

    public record RoleDefinition(
            String id,
            Set<String> capabilities,
            CommandPolicy commandPolicy
    ) {
        public RoleDefinition {
            id = normalizeRoleId(id);
            capabilities = normalizeCapabilities(capabilities);
            if (commandPolicy == null) {
                commandPolicy = new CommandPolicy(CommandMode.ALLOWLIST, Set.of(), Set.of(), Set.of());
            }
            // The owner is deliberately non-configurable at runtime. A damaged or stale manager
            // file cannot remove its recovery, management, bypass, or command authority.
            if (id.equals("owner")) {
                capabilities = CAPABILITIES;
                commandPolicy = new CommandPolicy(CommandMode.ALL, Set.of(), Set.of(), Set.of());
            } else if (id.equals("member")) {
                LinkedHashSet<String> basicCommands = new LinkedHashSet<>(DEFAULT_PLAYER_COMMANDS);
                basicCommands.addAll(commandPolicy.allow());
                commandPolicy = new CommandPolicy(commandPolicy.mode(), commandPolicy.groups(),
                        basicCommands, commandPolicy.deny());
            }
        }
    }

    /** Assignment accepts both v2 role IDs and the old role/groups/commands constructor. */
    public static final class Assignment {
        private final String player;
        private final String uuid;
        private final String roleId;
        private final Role legacyRole;
        private final Set<String> legacyGroups;
        private final Set<String> legacyCommands;

        public Assignment(String player, String uuid, String roleId) {
            this.player = normalizePlayer(player);
            this.uuid = normalizeUuid(uuid);
            this.roleId = normalizeRoleId(roleId);
            this.legacyRole = switch (this.roleId) {
                case "owner" -> Role.OWNER;
                case "admin" -> Role.ADMIN;
                default -> Role.MEMBER;
            };
            this.legacyGroups = Set.of();
            this.legacyCommands = Set.of();
        }

        public Assignment(String player, Role role, Set<String> groups, Set<String> commands) {
            this.player = normalizePlayer(player);
            this.uuid = "";
            this.legacyRole = role == null ? Role.MEMBER : role;
            if (this.legacyRole == Role.ADMIN) {
                this.legacyGroups = normalizeGroups(groups);
                this.legacyCommands = normalizeCommands(commands, 32);
                this.roleId = LEGACY_ADMIN_PREFIX + this.player.toLowerCase(Locale.ROOT);
            } else {
                this.legacyGroups = Set.of();
                this.legacyCommands = Set.of();
                this.roleId = this.legacyRole.name().toLowerCase(Locale.ROOT);
            }
        }

        public String player() { return player; }
        public String uuid() { return uuid; }
        public String roleId() { return roleId; }
        public Role role() { return legacyRole; }
        public Set<String> groups() { return legacyGroups; }
        public Set<String> commands() { return legacyCommands; }
    }

    private final Map<String, RoleDefinition> roles;
    private final Map<String, Assignment> assignments;
    private final Map<String, Assignment> assignmentsByUuid;

    /** Creates a v1-compatible policy, retaining each legacy admin's exact command grants. */
    public AccessPolicy(Collection<Assignment> values) {
        this(legacyRoles(values), values);
    }

    public AccessPolicy(Collection<RoleDefinition> roleValues, Collection<Assignment> assignmentValues) {
        LinkedHashMap<String, RoleDefinition> normalizedRoles = new LinkedHashMap<>();
        int customRoles = 0;
        for (RoleDefinition role : roleValues == null ? List.<RoleDefinition>of() : roleValues) {
            if (role == null) continue;
            if (normalizedRoles.putIfAbsent(role.id(), role) != null) {
                throw new IllegalArgumentException("Duplicate access role: " + role.id());
            }
            if (!isBuiltInRole(role.id()) && !role.id().startsWith(LEGACY_ADMIN_PREFIX)
                    && ++customRoles > MAX_CUSTOM_ROLES) {
                throw new IllegalArgumentException("At most " + MAX_CUSTOM_ROLES + " custom roles can be assigned.");
            }
            if (normalizedRoles.size() > MAX_ROLES) {
                throw new IllegalArgumentException("At most " + MAX_ROLES + " total roles can be loaded.");
            }
        }
        addBuiltInRoles(normalizedRoles);

        LinkedHashMap<String, Assignment> normalized = new LinkedHashMap<>();
        LinkedHashMap<String, Assignment> byUuid = new LinkedHashMap<>();
        String owner = null;
        for (Assignment assignment : assignmentValues == null ? List.<Assignment>of() : assignmentValues) {
            if (assignment == null) continue;
            if (!normalizedRoles.containsKey(assignment.roleId())) {
                throw new IllegalArgumentException("Unknown access role: " + assignment.roleId());
            }
            String key = assignment.player().toLowerCase(Locale.ROOT);
            if (normalized.containsKey(key)) {
                throw new IllegalArgumentException("Duplicate player access entry: " + assignment.player());
            }
            if (!assignment.uuid().isEmpty() && byUuid.putIfAbsent(assignment.uuid(), assignment) != null) {
                throw new IllegalArgumentException("Duplicate Minecraft UUID in player access: " + assignment.uuid());
            }
            if (assignment.roleId().equals("owner")) {
                if (owner != null) throw new IllegalArgumentException("Only one owner can be assigned.");
                owner = key;
            }
            normalized.put(key, assignment);
            if (normalized.size() > MAX_ASSIGNMENTS) {
                throw new IllegalArgumentException("At most " + MAX_ASSIGNMENTS + " player access entries can be assigned.");
            }
        }
        roles = Map.copyOf(normalizedRoles);
        assignments = Map.copyOf(normalized);
        assignmentsByUuid = Map.copyOf(byUuid);
    }

    public static AccessPolicy empty() {
        return new AccessPolicy(defaultRoles(), List.of());
    }

    public static List<RoleDefinition> defaultRoles() {
        return List.of(
                new RoleDefinition("owner", CAPABILITIES,
                        new CommandPolicy(CommandMode.ALL, Set.of(), Set.of(), Set.of())),
                new RoleDefinition("admin", Set.of(PLAYER_SPECTATE),
                        new CommandPolicy(CommandMode.ALLOWLIST, Set.of("moderation"), Set.of(), Set.of())),
                new RoleDefinition("member", Set.of(),
                        new CommandPolicy(CommandMode.ALLOWLIST, Set.of(), DEFAULT_PLAYER_COMMANDS, Set.of())));
    }

    public Optional<Assignment> assignmentFor(String player) {
        if (player == null) return Optional.empty();
        return Optional.ofNullable(assignments.get(player.trim().toLowerCase(Locale.ROOT)));
    }

    public Optional<Assignment> assignmentFor(String player, UUID uuid) {
        Assignment byId = uuid == null ? null : assignmentsByUuid.get(uuid.toString().toLowerCase(Locale.ROOT));
        if (byId != null) return Optional.of(byId);
        Assignment byName = player == null ? null : assignments.get(player.trim().toLowerCase(Locale.ROOT));
        // Once the manager has learned a UUID, do not let the same display name on another
        // identity inherit that role (especially Owner) on offline/proxy-backed servers.
        if (byName != null && uuid != null && !byName.uuid().isEmpty()
                && !byName.uuid().equalsIgnoreCase(uuid.toString())) return Optional.empty();
        return Optional.ofNullable(byName);
    }

    public Collection<Assignment> assignments() {
        return assignments.values();
    }

    public Collection<RoleDefinition> roles() {
        return roles.values();
    }

    public RoleDefinition roleFor(Assignment assignment) {
        return assignment == null ? null : roles.get(assignment.roleId());
    }

    public RoleDefinition roleFor(String player) {
        return roleFor(assignmentFor(player).orElse(null));
    }

    public boolean enforcesPrivilegedRoles() {
        for (Assignment assignment : assignments.values()) {
            RoleDefinition role = roleFor(assignment);
            if (role == null) continue;
            if (role.id().equals("member")) continue;
            if (role.id().equals("owner") || !role.capabilities().isEmpty()
                    || role.commandPolicy().mode() == CommandMode.ALL
                    || !role.commandPolicy().groups().isEmpty()
                    || !role.commandPolicy().allow().isEmpty()) return true;
        }
        return false;
    }

    public boolean hasCapability(Assignment assignment, String capability) {
        String id = String.valueOf(capability == null ? "" : capability).trim().toLowerCase(Locale.ROOT);
        RoleDefinition role = roleFor(assignment);
        return CAPABILITIES.contains(id) && role != null && role.capabilities().contains(id);
    }

    public boolean hasCapability(String player, UUID uuid, String capability) {
        return hasCapability(assignmentFor(player, uuid).orElse(null), capability);
    }

    public boolean canRun(Assignment assignment, String commandLine) {
        RoleDefinition role = roleFor(assignment);
        String root = commandRoot(commandLine);
        if (root.isEmpty()) return false;
        if (role == null) return DEFAULT_PLAYER_COMMANDS.contains(root) || isTeamSelfServiceCommand(commandLine);
        if (role.id().equals("owner")) return true;
        CommandPolicy commands = role.commandPolicy();
        if (commands.deny().contains(root)) return false;
        // An existing team-wide deny must not be bypassed with a newly added alias.
        if (PUBLIC_TEAM_COMMANDS.contains(root)
                && (commands.deny().contains("team") || commands.deny().contains("teams"))) return false;
        if ((root.equals("create;team") || commandLine.stripLeading().matches("/?teams create(?: .*|$)"))
                && commands.deny().contains("create")) return false;
        // Player-funded menus and self-only enchantment switches need no operator authority,
        // including on custom roles. Explicit deny above remains authoritative.
        // Do not admit the generic /set root: unrelated mods can register privileged children.
        if (PUBLIC_SELF_SERVICE_COMMANDS.contains(root) || isTeamSelfServiceCommand(commandLine)) return true;
        // A deny list cannot be authoritative if the same role can delegate to the denied root
        // through /execute, a function, or a scheduled callback. Fail closed on all known
        // delegation roots whenever the role has at least one explicit deny.
        if (!commands.deny().isEmpty() && DELEGATION_COMMANDS.contains(root)) return false;
        if (hasCapability(assignment, PROTECTION_MANAGE)
                && (root.equals("serverprotection") || root.equals("protect")
                || root.equals("anticheat"))) return true;
        if (hasCapability(assignment, PLAYER_SPECTATE)
                && isPlayerViewCommand(root)
                && !deniesLegacyPlayerViewRoot(commands.deny(), root)) return true;
        if ((hasCapability(assignment, PLAYER_COORDINATES)
                || hasCapability(assignment, PLAYER_DIMENSION)) && root.equals("view")) return true;
        if ((hasCapability(assignment, ENTITY_INSPECT) || hasCapability(assignment, ENTITY_EDIT))
                && root.equals("entityadmin")) return true;
        if (hasCapability(assignment, SERVER_STOP) && root.equals("stop")) return true;
        if (hasCapability(assignment, SERVER_RESTART) && root.equals("restart")) return true;
        if (commands.mode() == CommandMode.ALL || commands.allow().contains(root)) return true;
        for (String group : commands.groups()) {
            if (COMMAND_GROUPS.getOrDefault(group, Set.of()).contains(root)) return true;
        }
        return false;
    }

    /** Finite grants for permission attachments. ALL roles additionally enumerate the command map. */
    public Set<String> allowedCommands(Assignment assignment) {
        RoleDefinition role = roleFor(assignment);
        if (role == null) return Set.of();
        LinkedHashSet<String> commands = new LinkedHashSet<>(role.commandPolicy().allow());
        commands.addAll(PUBLIC_SELF_SERVICE_COMMANDS);
        for (String group : role.commandPolicy().groups()) {
            commands.addAll(COMMAND_GROUPS.getOrDefault(group, Set.of()));
        }
        if (role.capabilities().contains(PROTECTION_MANAGE)) {
            commands.add("serverprotection");
            commands.add("protect");
            commands.add("anticheat");
        }
        if (role.capabilities().contains(PLAYER_SPECTATE)) {
            commands.add("ci-spectate");
            commands.add("ci-unspectate");
            commands.add("unspectate");
        }
        if (role.capabilities().contains(PLAYER_COORDINATES)
                || role.capabilities().contains(PLAYER_DIMENSION)) commands.add("view");
        if (role.capabilities().contains(ENTITY_INSPECT)
                || role.capabilities().contains(ENTITY_EDIT)) commands.add("entityadmin");
        if (role.capabilities().contains(SERVER_STOP)) commands.add("stop");
        if (role.capabilities().contains(SERVER_RESTART)) commands.add("restart");
        commands.removeAll(role.commandPolicy().deny());
        if (role.commandPolicy().deny().contains("spectate")) commands.remove("ci-spectate");
        if (role.commandPolicy().deny().contains("unspectate")) {
            commands.remove("ci-unspectate");
            commands.remove("unspectate");
        }
        if (!role.commandPolicy().deny().isEmpty()) commands.removeAll(DELEGATION_COMMANDS);
        return Set.copyOf(commands);
    }

    private static boolean isPlayerViewCommand(String root) {
        return root.equals("ci-spectate") || root.equals("ci-unspectate") || root.equals("unspectate");
    }

    private static boolean deniesLegacyPlayerViewRoot(Set<String> denied, String root) {
        return (root.equals("ci-spectate") && denied.contains("spectate"))
                || ((root.equals("ci-unspectate") || root.equals("unspectate"))
                && denied.contains("unspectate"));
    }

    public Set<String> deniedCommands(Assignment assignment) {
        RoleDefinition role = roleFor(assignment);
        return role == null ? Set.of() : role.commandPolicy().deny();
    }

    public boolean allowsAllCommands(Assignment assignment) {
        RoleDefinition role = roleFor(assignment);
        return role != null && role.commandPolicy().mode() == CommandMode.ALL;
    }

    public Role compatibilityRole(Assignment assignment) {
        RoleDefinition role = roleFor(assignment);
        if (role == null) return Role.MEMBER;
        if (role.id().equals("owner")) return Role.OWNER;
        if (role.id().equals("member")) return Role.MEMBER;
        if (!role.capabilities().isEmpty() || role.commandPolicy().mode() == CommandMode.ALL
                || !role.commandPolicy().groups().isEmpty() || !role.commandPolicy().allow().isEmpty()) {
            return Role.ADMIN;
        }
        return Role.MEMBER;
    }

    /** Exact public branches, never a grant for vanilla team administration or other /create children. */
    public static boolean isTeamSelfServiceCommand(String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).strip();
        if (clean.startsWith("/")) clean = clean.substring(1);
        return clean.equals("team") || clean.equals("team hub") || clean.equals("team settings")
                || clean.equals("create team") || clean.startsWith("create team ");
    }

    public static String commandRoot(String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).trim().toLowerCase(Locale.ROOT);
        while (clean.startsWith("/")) clean = clean.substring(1);
        int separator = clean.indexOf(' ');
        return canonicalCommand(separator < 0 ? clean : clean.substring(0, separator));
    }

    public static Set<String> groupIds() {
        return COMMAND_GROUPS.keySet();
    }

    public static Set<String> capabilityIds() {
        return CAPABILITIES;
    }

    private static List<RoleDefinition> legacyRoles(Collection<Assignment> values) {
        LinkedHashMap<String, RoleDefinition> roles = new LinkedHashMap<>();
        for (RoleDefinition role : defaultRoles()) roles.put(role.id(), role);
        for (Assignment assignment : values == null ? List.<Assignment>of() : values) {
            if (assignment == null || assignment.role() != Role.ADMIN) continue;
            roles.put(assignment.roleId(), new RoleDefinition(
                    assignment.roleId(), Set.of(PLAYER_SPECTATE),
                    new CommandPolicy(CommandMode.ALLOWLIST,
                            assignment.groups(), assignment.commands(), Set.of())));
        }
        return List.copyOf(roles.values());
    }

    private static void addBuiltInRoles(Map<String, RoleDefinition> roles) {
        for (RoleDefinition role : defaultRoles()) roles.putIfAbsent(role.id(), role);
        // Re-normalize owner even if supplied by a stale v2 file.
        RoleDefinition owner = roles.get("owner");
        roles.put("owner", new RoleDefinition(owner.id(), owner.capabilities(), owner.commandPolicy()));
    }

    private static boolean isBuiltInRole(String id) {
        return id.equals("owner") || id.equals("admin") || id.equals("member");
    }

    private static String normalizePlayer(String value) {
        String clean = String.valueOf(value == null ? "" : value).trim();
        if (!PLAYER_NAME.matcher(clean).matches()) throw new IllegalArgumentException("Invalid Minecraft player name.");
        return clean;
    }

    private static String normalizeUuid(String value) {
        String clean = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
        if (!clean.isEmpty() && !UUID_TEXT.matcher(clean).matches()) {
            throw new IllegalArgumentException("Invalid Minecraft UUID.");
        }
        return clean;
    }

    private static String normalizeRoleId(String value) {
        String id = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
        if (!ROLE_ID.matcher(id).matches()) throw new IllegalArgumentException("Invalid access role ID.");
        return id;
    }

    private static Set<String> normalizeCapabilities(Collection<String> values) {
        LinkedHashSet<String> capabilities = new LinkedHashSet<>();
        for (String value : values == null ? List.<String>of() : values) {
            String capability = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
            if (!CAPABILITIES.contains(capability)) {
                throw new IllegalArgumentException("Unknown role capability: " + capability);
            }
            capabilities.add(capability);
        }
        return Set.copyOf(capabilities);
    }

    private static Set<String> normalizeGroups(Collection<String> values) {
        LinkedHashSet<String> groups = new LinkedHashSet<>();
        for (String value : values == null ? List.<String>of() : values) {
            String group = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
            if (!COMMAND_GROUPS.containsKey(group)) throw new IllegalArgumentException("Unknown command group: " + group);
            groups.add(group);
        }
        return Set.copyOf(groups);
    }

    private static Set<String> normalizeCommands(Collection<String> values, int maximum) {
        LinkedHashSet<String> commands = new LinkedHashSet<>();
        for (String value : values == null ? List.<String>of() : values) {
            String root = String.valueOf(value).trim().toLowerCase(Locale.ROOT);
            while (root.startsWith("/")) root = root.substring(1);
            if (root.indexOf(' ') >= 0 || (!PUBLIC_TEAM_COMMANDS.contains(root) && !COMMAND_ROOT.matcher(root).matches())) {
                throw new IllegalArgumentException("Custom commands must be command names without arguments.");
            }
            commands.add(canonicalCommand(root));
            if (commands.size() > maximum) {
                throw new IllegalArgumentException("At most " + maximum + " commands can be assigned to a role.");
            }
        }
        return Set.copyOf(commands);
    }

    private static String canonicalCommand(String value) {
        String command = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
        if (PUBLIC_TEAM_COMMANDS.contains(command)) return command;
        if (!COMMAND_ROOT.matcher(command).matches()) return "";
        int separator = command.indexOf(':');
        if (separator < 0) return command;
        String namespace = command.substring(0, separator);
        String root = command.substring(separator + 1);
        return namespace.equals("minecraft") || namespace.equals("bukkit") ? root : command;
    }

    private static Map<String, Set<String>> commandGroups() {
        LinkedHashMap<String, Set<String>> groups = new LinkedHashMap<>();
        groups.put("moderation", Set.of("kick", "ban", "ban-ip", "pardon", "pardon-ip", "whitelist"));
        groups.put("players", Set.of(
                "teleport", "tp", "gamemode", "give", "clear", "effect", "experience", "xp",
                "tpa", "rtpa", "tpaccept", "tpdeny", "tpacancel"));
        groups.put("world", Set.of("time", "weather", "difficulty", "gamerule", "setworldspawn", "spawnpoint"));
        groups.put("server", Set.of("stop", "reload", "save-all", "save-off", "save-on"));
        groups.put("protection", Set.of("serverprotection", "protect", "anticheat"));
        return Map.copyOf(groups);
    }
}
