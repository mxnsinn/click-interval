package com.clickinterval.anticheat;

import com.clickinterval.anticheat.core.AccessPolicy;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandMap;
import org.bukkit.configuration.InvalidConfigurationException;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandSendEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.permissions.PermissionAttachment;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Applies the manager-owned access policy without granting custom roles blanket operator status. */
public final class AccessControlListener implements Listener {
    private static final String DEFAULT_DENIED_MESSAGE = "&cYou do not have access to that command.";
    private static final int MAX_KNOWN_COMMANDS = 4_096;

    private final JavaPlugin plugin;
    private final File configFile;
    private final CommandMap commandMap;
    private final Map<UUID, PermissionAttachment> roleAttachments = new HashMap<>();
    private AccessPolicy policy = AccessPolicy.empty();
    private String deniedMessage = DEFAULT_DENIED_MESSAGE;
    private boolean managedPolicy;
    private boolean invalidPolicyLockdown;

    public AccessControlListener(JavaPlugin plugin) {
        this.plugin = plugin;
        this.configFile = new File(plugin.getDataFolder(), "access.yml");
        this.commandMap = resolveCommandMap();
    }

    /** Loads either the v2 role schema or its bounded v1 compatibility projection. */
    public void reload() {
        AccessPolicy previous = policy;
        AccessPolicy updated;
        String updatedMessage;
        boolean configExists;
        try {
            configExists = configFile.exists();
            YamlConfiguration config = new YamlConfiguration();
            if (configExists) {
                if (!configFile.isFile()) {
                    throw new IOException("access.yml must be a regular file");
                }
                config.load(configFile);
            }
            updated = readPolicy(config);
            updatedMessage = readDeniedMessage(config);
        } catch (IOException | InvalidConfigurationException | RuntimeException invalid) {
            policy = AccessPolicy.empty();
            deniedMessage = DEFAULT_DENIED_MESSAGE;
            managedPolicy = true;
            invalidPolicyLockdown = true;
            applyRoles(previous, policy);
            throw new IllegalArgumentException("access.yml is invalid: " + safeMessage(invalid), invalid);
        }
        policy = updated;
        deniedMessage = updatedMessage;
        managedPolicy = configExists;
        invalidPolicyLockdown = false;
        applyRoles(previous, updated);
    }

    public void shutdown() {
        clearRoleAttachments();
        for (AccessPolicy.Assignment assignment : policy.assignments()) {
            if (policy.compatibilityRole(assignment) != AccessPolicy.Role.OWNER) {
                setOfflineOp(assignment.player(), false);
            }
        }
        policy = AccessPolicy.empty();
        managedPolicy = false;
        invalidPolicyLockdown = false;
    }

    /** Compatibility helper retained for callers that still reason in the original three roles. */
    public boolean isOwnerOrAdmin(String playerName) {
        AccessPolicy.Assignment assignment = policy.assignmentFor(playerName).orElse(null);
        return assignment != null && policy.compatibilityRole(assignment) != AccessPolicy.Role.MEMBER;
    }

    public boolean hasCapability(Player player, String capability) {
        return player != null && policy.hasCapability(player.getName(), player.getUniqueId(), capability);
    }

    public boolean canUsePlayerView(Player player, String commandRoot) {
        if (player == null) return false;
        AccessPolicy.Assignment assignment = assignmentFor(player);
        String root = AccessPolicy.commandRoot(commandRoot);
        String legacyRoot = root.equals("ci-spectate") ? "spectate" : "unspectate";
        return assignment != null
                && policy.hasCapability(assignment, AccessPolicy.PLAYER_SPECTATE)
                && !policy.deniedCommands(assignment).contains(root)
                && !policy.deniedCommands(assignment).contains(legacyRoot);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        if (!managedPolicy) return;
        AccessPolicy.Assignment assignment = assignmentFor(event.getPlayer());
        applyRole(event.getPlayer(), invalidPolicyLockdown ? null : assignment);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        AccessPolicy.Assignment assignment = assignmentFor(event.getPlayer());
        removeRoleAttachment(event.getPlayer());
        boolean owner = !invalidPolicyLockdown && assignment != null
                && policy.compatibilityRole(assignment) == AccessPolicy.Role.OWNER;
        if (managedPolicy && !owner && event.getPlayer().isOp()) {
            event.getPlayer().setOp(false);
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onCommandsSent(PlayerCommandSendEvent event) {
        if (!managedPolicy) return;
        if (invalidPolicyLockdown) {
            event.getCommands().clear();
            return;
        }
        AccessPolicy.Assignment assignment = assignmentFor(event.getPlayer());
        if (assignment != null && policy.compatibilityRole(assignment) == AccessPolicy.Role.OWNER) return;
        event.getCommands().removeIf(command -> !policy.canRun(assignment, command));
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        if (!managedPolicy) return;
        Player player = event.getPlayer();
        AccessPolicy.Assignment assignment = invalidPolicyLockdown ? null : assignmentFor(player);
        if (!invalidPolicyLockdown && assignment != null
                && policy.compatibilityRole(assignment) == AccessPolicy.Role.OWNER) return;
        ensureRoleAccess(player, assignment);
        if (!invalidPolicyLockdown && policy.canRun(assignment, event.getMessage())) {
            // Commands can be registered after our policy reload. Grant the exact allowed root
            // on demand so an ALL role does not depend on command-map registration order.
            ensureCommandAccess(player, AccessPolicy.commandRoot(event.getMessage()));
            return;
        }
        event.setCancelled(true);
        player.sendMessage(ChatColor.translateAlternateColorCodes('&', deniedMessage));
    }

    private AccessPolicy readPolicy(FileConfiguration config) {
        Object versionValue = config.get("version");
        if (versionValue == null) return new AccessPolicy(readV1Assignments(config));
        if (!(versionValue instanceof Number number) || number.intValue() != 2
                || number.doubleValue() != number.intValue()) {
            throw new IllegalArgumentException("access policy version must be 2");
        }
        return readV2Policy(config);
    }

    private AccessPolicy readV2Policy(FileConfiguration config) {
        List<Map<?, ?>> roleMaps = mapList(config.get("roles"), "roles", AccessPolicy.MAX_ROLES);
        List<AccessPolicy.RoleDefinition> roles = new ArrayList<>(roleMaps.size());
        Set<String> roleIds = new LinkedHashSet<>();
        for (Map<?, ?> value : roleMaps) {
            String id = requiredString(value.get("id"), "role id");
            Set<String> capabilities = stringSet(value.get("capabilities"), "role capabilities",
                    AccessPolicy.capabilityIds().size(), false);
            Object commandPolicyValue = value.get("commandPolicy");
            if (!(commandPolicyValue instanceof Map<?, ?> commands)) {
                throw new IllegalArgumentException("role " + id + " is missing commandPolicy");
            }
            AccessPolicy.CommandMode mode = AccessPolicy.CommandMode.parse(
                    requiredString(commands.get("mode"), "command access mode"));
            Set<String> groups = stringSet(commands.get("groups"), "command groups", 5, false);
            Set<String> allow = stringSet(commands.get("allow"), "allowed commands",
                    AccessPolicy.MAX_COMMANDS_PER_ROLE, false);
            Set<String> deny = stringSet(commands.get("deny"), "denied commands",
                    AccessPolicy.MAX_COMMANDS_PER_ROLE, false);
            AccessPolicy.RoleDefinition role = new AccessPolicy.RoleDefinition(
                    id, capabilities, new AccessPolicy.CommandPolicy(mode, groups, allow, deny));
            roles.add(role);
            roleIds.add(role.id());
        }
        if (!roleIds.containsAll(Set.of("owner", "admin", "member"))) {
            throw new IllegalArgumentException("v2 access policy must define owner, admin, and member roles");
        }

        List<Map<?, ?>> assignmentMaps = mapList(config.get("assignments"), "assignments",
                AccessPolicy.MAX_ASSIGNMENTS);
        List<AccessPolicy.Assignment> assignments = new ArrayList<>(assignmentMaps.size());
        for (Map<?, ?> value : assignmentMaps) {
            assignments.add(new AccessPolicy.Assignment(
                    requiredString(value.get("player"), "assignment player"),
                    optionalString(value.get("uuid"), "assignment UUID"),
                    requiredString(value.get("roleId"), "assignment role ID")));
        }
        return new AccessPolicy(roles, assignments);
    }

    private List<AccessPolicy.Assignment> readV1Assignments(FileConfiguration config) {
        Object raw = config.get("assignments");
        if (raw == null) return List.of();
        List<Map<?, ?>> values = mapList(raw, "assignments", AccessPolicy.MAX_ASSIGNMENTS);
        List<AccessPolicy.Assignment> assignments = new ArrayList<>(values.size());
        for (Map<?, ?> value : values) {
            String role = value.get("role") == null ? "member" : requiredString(value.get("role"), "assignment role");
            assignments.add(new AccessPolicy.Assignment(
                    requiredString(value.get("player"), "assignment player"),
                    AccessPolicy.Role.parse(role),
                    stringSet(value.get("groups"), "command groups", 32, true),
                    stringSet(value.get("commands"), "commands", 32, true)));
        }
        return assignments;
    }

    private String readDeniedMessage(FileConfiguration config) {
        Object value = config.get("deniedMessage");
        if (value == null) return DEFAULT_DENIED_MESSAGE;
        if (!(value instanceof String text)) throw new IllegalArgumentException("deniedMessage must be text");
        String clean = text.trim();
        return clean.isEmpty() ? DEFAULT_DENIED_MESSAGE : clean.substring(0, Math.min(clean.length(), 240));
    }

    private static List<Map<?, ?>> mapList(Object value, String label, int maximum) {
        if (!(value instanceof Collection<?> entries)) {
            throw new IllegalArgumentException(label + " must be a list");
        }
        if (entries.size() > maximum) throw new IllegalArgumentException(label + " contains too many entries");
        List<Map<?, ?>> result = new ArrayList<>(entries.size());
        for (Object entry : entries) {
            if (!(entry instanceof Map<?, ?> map)) throw new IllegalArgumentException(label + " contains an invalid entry");
            result.add(map);
        }
        return result;
    }

    private static Set<String> stringSet(Object value, String label, int maximum, boolean optional) {
        if (value == null && optional) return Set.of();
        if (!(value instanceof Collection<?> values)) throw new IllegalArgumentException(label + " must be a list");
        if (values.size() > maximum) throw new IllegalArgumentException(label + " contains too many entries");
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (Object entry : values) {
            if (!(entry instanceof String text) || text.isBlank()) {
                throw new IllegalArgumentException(label + " contains an invalid value");
            }
            result.add(text);
        }
        return Set.copyOf(result);
    }

    private static String requiredString(Object value, String label) {
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException(label + " is required");
        }
        return text;
    }

    private static String optionalString(Object value, String label) {
        if (value == null) return "";
        if (!(value instanceof String text)) throw new IllegalArgumentException(label + " must be text");
        return text;
    }

    private AccessPolicy.Assignment assignmentFor(Player player) {
        return policy.assignmentFor(player.getName(), player.getUniqueId()).orElse(null);
    }

    private void applyRoles(AccessPolicy previous, AccessPolicy updated) {
        clearRoleAttachments();
        for (AccessPolicy.Assignment assignment : previous.assignments()) {
            if (updated.assignmentFor(assignment.player()).isPresent()) continue;
            setOfflineOp(assignment.player(), false);
        }
        for (AccessPolicy.Assignment assignment : updated.assignments()) {
            setOfflineOp(assignment.player(), updated.compatibilityRole(assignment) == AccessPolicy.Role.OWNER);
        }
        if (!managedPolicy) return;
        for (Player player : plugin.getServer().getOnlinePlayers()) {
            AccessPolicy.Assignment assignment = assignmentFor(player);
            applyRole(player, invalidPolicyLockdown ? null : assignment);
        }
    }

    private void applyRole(Player player, AccessPolicy.Assignment assignment) {
        if (assignment != null && policy.compatibilityRole(assignment) == AccessPolicy.Role.OWNER) {
            removeRoleAttachment(player);
            if (!player.isOp()) player.setOp(true);
            player.updateCommands();
            return;
        }
        ensureRoleAccess(player, assignment);
    }

    private void ensureRoleAccess(Player player, AccessPolicy.Assignment assignment) {
        if (player.isOp()) player.setOp(false);
        PermissionAttachment existing = roleAttachments.get(player.getUniqueId());
        if (existing != null) return;
        PermissionAttachment attachment = player.addAttachment(plugin);
        for (Map.Entry<String, Boolean> entry : permissionNodes(assignment).entrySet()) {
            attachment.setPermission(entry.getKey(), entry.getValue());
        }
        roleAttachments.put(player.getUniqueId(), attachment);
        player.recalculatePermissions();
        player.updateCommands();
    }

    private Map<String, Boolean> permissionNodes(AccessPolicy.Assignment assignment) {
        LinkedHashMap<String, Boolean> permissions = new LinkedHashMap<>();
        LinkedHashSet<String> allowed = new LinkedHashSet<>();
        if (!invalidPolicyLockdown && assignment == null) {
            allowed.addAll(AccessPolicy.DEFAULT_PLAYER_COMMANDS);
        } else if (!invalidPolicyLockdown) {
            allowed.addAll(policy.allowedCommands(assignment));
        }
        if (!invalidPolicyLockdown && policy.allowsAllCommands(assignment)) {
            for (String command : knownCommandNames()) {
                if (policy.canRun(assignment, command)) allowed.add(command);
            }
        }
        // Deny every currently registered command outside the policy. The preprocess event remains
        // authoritative for commands registered later, while allowed permissions are applied last
        // so aliases sharing a permission node cannot accidentally erase a baseline grant.
        for (String command : knownCommandNames()) {
            if (invalidPolicyLockdown || !policy.canRun(assignment, command)) {
                addCommandPermissions(permissions, command, false);
            }
        }
        for (String command : policy.deniedCommands(assignment)) {
            addCommandPermissions(permissions, command, false);
        }
        for (String command : allowed) addCommandPermissions(permissions, command, true);

        boolean canManage = !invalidPolicyLockdown
                && policy.hasCapability(assignment, AccessPolicy.PROTECTION_MANAGE);
        boolean canBypass = !invalidPolicyLockdown
                && policy.hasCapability(assignment, AccessPolicy.PROTECTION_BYPASS);
        permissions.put("serverprotection.admin", canManage);
        permissions.put("clickinterval.anticheat.admin", canManage);
        permissions.put("serverprotection.bypass", canBypass);
        permissions.put("clickinterval.anticheat.bypass", canBypass);
        if (invalidPolicyLockdown || assignment == null) {
            permissions.put("serverprotection.player-view", false);
            permissions.put("serverprotection.entity-admin", false);
        }
        return Map.copyOf(permissions);
    }

    private void ensureCommandAccess(Player player, String commandName) {
        PermissionAttachment attachment = roleAttachments.get(player.getUniqueId());
        if (attachment == null) return;
        LinkedHashMap<String, Boolean> permissions = new LinkedHashMap<>();
        addCommandPermissions(permissions, commandName, true);
        boolean changed = false;
        for (Map.Entry<String, Boolean> entry : permissions.entrySet()) {
            if (Boolean.TRUE.equals(attachment.getPermissions().get(entry.getKey()))) continue;
            attachment.setPermission(entry.getKey(), entry.getValue());
            changed = true;
        }
        if (changed) player.recalculatePermissions();
    }

    private void addCommandPermissions(Map<String, Boolean> permissions, String commandName, boolean value) {
        String root = AccessPolicy.commandRoot(commandName);
        if (root.isEmpty()) return;
        int namespaceSeparator = root.indexOf(':');
        if (namespaceSeparator < 0) {
            permissions.put("minecraft.command." + root, value);
            permissions.put("bukkit.command." + root, value);
            addRegisteredPermission(permissions, root, value);
            addRegisteredPermission(permissions, "minecraft:" + root, value);
            addRegisteredPermission(permissions, "bukkit:" + root, value);
        } else {
            addRegisteredPermission(permissions, root, value);
        }
    }

    private void addRegisteredPermission(Map<String, Boolean> permissions, String commandName, boolean value) {
        Command command = commandMap == null ? plugin.getServer().getPluginCommand(commandName)
                : commandMap.getCommand(commandName);
        if (command == null || command.getPermission() == null) return;
        for (String permission : command.getPermission().split(";")) {
            String clean = permission.trim();
            if (!clean.isEmpty()) permissions.put(clean, value);
        }
    }

    private Set<String> knownCommandNames() {
        if (commandMap == null) return Set.of();
        Object value = invokeKnownCommands(commandMap);
        if (!(value instanceof Map<?, ?> commands)) return Set.of();
        LinkedHashSet<String> roots = new LinkedHashSet<>();
        for (Object key : commands.keySet()) {
            String root = AccessPolicy.commandRoot(String.valueOf(key));
            if (!root.isEmpty()) roots.add(root);
            if (roots.size() == MAX_KNOWN_COMMANDS) break;
        }
        return Set.copyOf(roots);
    }

    private static Object invokeKnownCommands(CommandMap map) {
        try {
            Method method = map.getClass().getMethod("getKnownCommands");
            return method.invoke(map);
        } catch (ReflectiveOperationException ignored) {
        }
        for (Class<?> type = map.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field field = type.getDeclaredField("knownCommands");
                field.setAccessible(true);
                return field.get(map);
            } catch (ReflectiveOperationException | RuntimeException ignored) {
            }
        }
        return null;
    }

    private CommandMap resolveCommandMap() {
        try {
            Object value = plugin.getServer().getClass().getMethod("getCommandMap").invoke(plugin.getServer());
            return value instanceof CommandMap map ? map : null;
        } catch (NoSuchMethodException | IllegalAccessException | InvocationTargetException ignored) {
            return null;
        }
    }

    private void clearRoleAttachments() {
        for (PermissionAttachment attachment : List.copyOf(roleAttachments.values())) {
            try {
                attachment.remove();
            } catch (RuntimeException ignored) {
            }
        }
        roleAttachments.clear();
        for (Player player : plugin.getServer().getOnlinePlayers()) {
            player.recalculatePermissions();
            player.updateCommands();
        }
    }

    private void removeRoleAttachment(Player player) {
        PermissionAttachment attachment = roleAttachments.remove(player.getUniqueId());
        if (attachment == null) return;
        try {
            attachment.remove();
        } catch (RuntimeException ignored) {
        }
        player.recalculatePermissions();
        player.updateCommands();
    }

    private void setOfflineOp(String playerName, boolean op) {
        try {
            OfflinePlayer player = plugin.getServer().getOfflinePlayer(playerName);
            if (player.isOp() != op) player.setOp(op);
        } catch (RuntimeException error) {
            plugin.getLogger().warning("Could not update access for " + playerName + ": " + error.getMessage());
        }
    }

    private static String safeMessage(Throwable error) {
        String message = error == null ? "unknown error" : error.getMessage();
        if (message == null || message.isBlank()) return error == null ? "unknown error" : error.getClass().getSimpleName();
        return message.substring(0, Math.min(message.length(), 240));
    }
}
