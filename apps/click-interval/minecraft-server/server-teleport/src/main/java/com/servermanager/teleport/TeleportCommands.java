package com.servermanager.teleport;

import com.servermanager.teleport.core.PlaceBook;
import com.servermanager.teleport.core.PlaceNames;
import com.servermanager.teleport.core.RequestBook;
import com.servermanager.teleport.core.RequestOutcome;
import com.servermanager.teleport.core.SavedPlace;
import com.servermanager.teleport.core.TeleportRequest;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.WorldBorder;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent;
import net.md_5.bungee.api.ChatColor;
import net.md_5.bungee.api.chat.ClickEvent;
import net.md_5.bungee.api.chat.TextComponent;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

public final class TeleportCommands implements CommandExecutor, TabCompleter {
    private static final String REQUEST_PERMISSION = "serverteleport.request";
    private static final String PLACES_PERMISSION = "serverteleport.places";
    private static final String RESPOND_PERMISSION = "serverteleport.respond";
    private static final String CANCEL_PERMISSION = "serverteleport.cancel";
    private static final String RELOAD_PERMISSION = "serverteleport.reload";
    private static final String COOLDOWN_BYPASS_PERMISSION = "serverteleport.bypass.cooldown";

    private final ServerTeleportPlugin plugin;
    private final RequestBook requests;

    public TeleportCommands(ServerTeleportPlugin plugin, RequestBook requests) {
        this.plugin = plugin;
        this.requests = requests;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String name = command.getName().toLowerCase(Locale.ROOT);
        if (name.equals("serverteleport")) return handleAdmin(sender, args);
        if (!(sender instanceof Player player)) {
            plugin.message(sender, "players-only", Map.of());
            return true;
        }
        plugin.expireRequests();
        return switch (name) {
            case "tpa" -> handleRequest(player, args);
            case "tpaccept" -> handleResponse(player, args, true);
            case "tpdeny" -> handleResponse(player, args, false);
            case "tpacancel" -> handleCancel(player, args);
            default -> false;
        };
    }

    private boolean handleRequest(Player requester, String[] args) {
        if (args.length >= 1 && args[0].equalsIgnoreCase("accept")) {
            return handleResponse(requester, Arrays.copyOfRange(args, 1, args.length), true);
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("decline")) {
            return handleResponse(requester, Arrays.copyOfRange(args, 1, args.length), false);
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("set")) {
            if (args.length != 2) {
                plugin.message(requester, "usage-location-set", Map.of());
                return true;
            }
            return handleSetPlace(requester, args[1]);
        }
        if (args.length == 1 && args[0].equalsIgnoreCase("list")) {
            return handleListPlaces(requester);
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("delete")) {
            if (args.length != 2) {
                plugin.message(requester, "usage-location-delete", Map.of());
                return true;
            }
            return handleDeletePlace(requester, args[1]);
        }
        if (args.length != 1) {
            plugin.message(requester, "usage-tpa", Map.of());
            return true;
        }
        Player target = findVisiblePlayer(requester, args[0]);
        if (target != null) return sendRequest(requester, target);
        return handlePlaceTeleport(requester, args[0]);
    }

    private boolean sendRequest(Player requester, Player target) {
        if (!permitted(requester, REQUEST_PERMISSION)) return true;

        RequestOutcome outcome = requests.create(
                requester.getUniqueId(), requester.getName(),
                target.getUniqueId(), target.getName(),
                requester.hasPermission(COOLDOWN_BYPASS_PERMISSION)
        );
        switch (outcome.status()) {
            case CREATED -> {
                TeleportRequest request = outcome.request();
                LinkedHashMap<String, Object> values = values(request);
                values.put("seconds", plugin.settings().requestExpirySeconds());
                plugin.message(requester, "request-sent", values);
                sendRequestPrompt(target, request);
            }
            case SELF_TARGET -> plugin.message(requester, "cannot-target-self", Map.of());
            case OUTGOING_EXISTS -> plugin.message(requester, "already-pending", values(outcome.request()));
            case TARGET_LIMIT -> plugin.message(requester, "target-limit", Map.of("target", target.getName()));
            case COOLDOWN -> plugin.message(requester, "cooldown", Map.of(
                    "seconds", Math.max(1L, (outcome.retryAfterMillis() + 999L) / 1_000L)));
            default -> plugin.message(requester, "teleport-failed", Map.of());
        }
        return true;
    }

    private void sendRequestPrompt(Player target, TeleportRequest request) {
        TextComponent intro = coloredText("You got a TPA request from ", ChatColor.YELLOW);
        TextComponent requester = coloredText(request.requesterName(), ChatColor.WHITE);
        TextComponent question = coloredText(". Would you like to ", ChatColor.YELLOW);
        TextComponent accept = coloredText("Accept", ChatColor.GREEN);
        accept.setClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/tpa accept " + request.requesterName()));
        TextComponent separator = coloredText(" or ", ChatColor.YELLOW);
        TextComponent decline = coloredText("Decline", ChatColor.RED);
        decline.setClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/tpa decline " + request.requesterName()));
        TextComponent suffix = coloredText("?", ChatColor.YELLOW);
        target.spigot().sendMessage(intro, requester, question, accept, separator, decline, suffix);
    }

    private static TextComponent coloredText(String text, ChatColor color) {
        TextComponent component = new TextComponent(text);
        component.setColor(color);
        return component;
    }

    private boolean handleSetPlace(Player player, String inputName) {
        if (!permitted(player, PLACES_PERMISSION)) return true;
        if (!PlaceNames.isValid(inputName)) {
            plugin.message(player, "location-invalid-name", Map.of());
            return true;
        }
        if (!placeStorageReady(player)) return true;

        Location current = player.getLocation();
        World world = current.getWorld();
        if (world == null || !isSafeDestination(world, current)) {
            plugin.message(player, "location-unsafe", Map.of("name", inputName));
            return true;
        }
        SavedPlace place;
        try {
            place = new SavedPlace(
                    world.getUID(), world.getName(),
                    current.getX(), current.getY(), current.getZ(),
                    current.getYaw(), current.getPitch()
            );
        } catch (IllegalArgumentException invalidLocation) {
            plugin.message(player, "location-unsafe", Map.of("name", inputName));
            return true;
        }

        try {
            PlaceBook.PutResult result = plugin.savePlace(player.getUniqueId(), inputName, place);
            if (result == PlaceBook.PutResult.LIMIT_REACHED) {
                plugin.message(player, "location-limit", Map.of("limit", PlaceBook.MAX_PLACES_PER_PLAYER));
            } else {
                plugin.message(player, "location-saved", Map.of("name", PlaceNames.normalize(inputName)));
            }
        } catch (IOException error) {
            logStorageFailure("save", player, error);
            plugin.message(player, "location-storage-failed", Map.of());
        }
        return true;
    }

    private boolean handleListPlaces(Player player) {
        if (!permitted(player, PLACES_PERMISSION)) return true;
        if (!placeStorageReady(player)) return true;
        List<String> names = plugin.placeNames(player.getUniqueId());
        if (names.isEmpty()) {
            plugin.message(player, "location-none", Map.of());
        } else {
            plugin.message(player, "location-list", Map.of("locations", String.join(", ", names)));
        }
        return true;
    }

    private boolean handleDeletePlace(Player player, String inputName) {
        if (!permitted(player, PLACES_PERMISSION)) return true;
        if (!PlaceNames.isValid(inputName)) {
            plugin.message(player, "location-invalid-name", Map.of());
            return true;
        }
        if (!placeStorageReady(player)) return true;
        try {
            if (plugin.deletePlace(player.getUniqueId(), inputName)) {
                plugin.message(player, "location-deleted", Map.of("name", PlaceNames.normalize(inputName)));
            } else {
                plugin.message(player, "location-not-found", Map.of("name", inputName));
            }
        } catch (IOException error) {
            logStorageFailure("delete", player, error);
            plugin.message(player, "location-storage-failed", Map.of());
        }
        return true;
    }

    private boolean handlePlaceTeleport(Player player, String inputName) {
        if (!permitted(player, PLACES_PERMISSION)) return true;
        if (!PlaceNames.isValid(inputName)) {
            plugin.message(player, "location-not-found", Map.of("name", inputName));
            return true;
        }
        if (!placeStorageReady(player)) return true;
        SavedPlace place = plugin.findPlace(player.getUniqueId(), inputName);
        if (place == null) {
            plugin.message(player, "location-not-found", Map.of("name", inputName));
            return true;
        }

        World world = resolveWorld(place);
        if (world == null) {
            plugin.message(player, "location-world-unavailable", Map.of(
                    "name", PlaceNames.normalize(inputName), "world", place.worldName()));
            return true;
        }
        if (!plugin.settings().allowCrossWorld() && !player.getWorld().getUID().equals(world.getUID())) {
            plugin.message(player, "cross-world-disabled", Map.of("name", PlaceNames.normalize(inputName)));
            return true;
        }
        Location destination = new Location(
                world, place.x(), place.y(), place.z(), place.yaw(), place.pitch());
        if (!isSafeDestination(world, destination)) {
            plugin.message(player, "location-unsafe", Map.of("name", PlaceNames.normalize(inputName)));
            return true;
        }

        boolean teleported;
        try {
            teleported = player.teleport(destination, PlayerTeleportEvent.TeleportCause.COMMAND);
        } catch (RuntimeException error) {
            plugin.getLogger().warning(
                    "Saved-place teleport for " + player.getName() + " failed: " + safeError(error));
            teleported = false;
        }
        if (teleported) {
            plugin.message(player, "location-teleported", Map.of("name", PlaceNames.normalize(inputName)));
        } else {
            plugin.message(player, "teleport-failed", Map.of("name", PlaceNames.normalize(inputName)));
        }
        return true;
    }

    private boolean handleResponse(Player target, String[] args, boolean accept) {
        if (!permitted(target, RESPOND_PERMISSION)) return true;
        String usageKey = accept ? "usage-tpaccept" : "usage-tpdeny";
        if (args.length > 1) {
            plugin.message(target, usageKey, Map.of());
            return true;
        }
        String selectedName = args.length == 1 ? args[0] : "";
        RequestOutcome outcome = requests.respond(target.getUniqueId(), selectedName, accept);
        if (outcome.status() == RequestOutcome.Status.AMBIGUOUS) {
            String names = outcome.candidates().stream()
                    .map(TeleportRequest::requesterName)
                    .sorted(String.CASE_INSENSITIVE_ORDER)
                    .reduce((left, right) -> left + ", " + right)
                    .orElse("");
            plugin.message(target, "choose-request", Map.of("requests", names));
            return true;
        }
        if (outcome.status() == RequestOutcome.Status.NONE) {
            plugin.message(target, selectedName.isBlank() ? "no-pending" : "no-matching-request",
                    selectedName.isBlank() ? Map.of() : Map.of("requester", selectedName));
            return true;
        }
        TeleportRequest request = outcome.request();
        LinkedHashMap<String, Object> values = values(request);
        Player requester = Bukkit.getPlayer(request.requesterId());
        if (outcome.status() == RequestOutcome.Status.DENIED) {
            plugin.message(target, "denied-target", values);
            if (requester != null && requester.isOnline()) plugin.message(requester, "denied-requester", values);
            return true;
        }
        if (outcome.status() != RequestOutcome.Status.ACCEPTED) {
            plugin.message(target, "teleport-failed", values);
            return true;
        }
        if (requester == null || !requester.isOnline() || !target.canSee(requester)) {
            plugin.message(target, "requester-left-target", values);
            return true;
        }
        if (!plugin.settings().allowCrossWorld() && !requester.getWorld().equals(target.getWorld())) {
            plugin.message(target, "cross-world-disabled", values);
            plugin.message(requester, "cross-world-disabled", values);
            return true;
        }

        boolean teleported;
        try {
            teleported = requester.teleport(
                    target.getLocation().clone(),
                    PlayerTeleportEvent.TeleportCause.COMMAND
            );
        } catch (RuntimeException error) {
            plugin.getLogger().warning("Teleport for " + requester.getName() + " failed: " + error.getMessage());
            teleported = false;
        }
        if (!teleported) {
            plugin.message(target, "teleport-failed", values);
            plugin.message(requester, "teleport-failed", values);
            return true;
        }
        plugin.message(target, "accepted-target", values);
        plugin.message(requester, "accepted-requester", values);
        return true;
    }

    private boolean handleCancel(Player requester, String[] args) {
        if (!permitted(requester, CANCEL_PERMISSION)) return true;
        if (args.length != 0) {
            plugin.message(requester, "usage-tpacancel", Map.of());
            return true;
        }
        RequestOutcome outcome = requests.cancel(requester.getUniqueId());
        if (outcome.status() == RequestOutcome.Status.NONE) {
            plugin.message(requester, "no-pending", Map.of());
            return true;
        }
        TeleportRequest request = outcome.request();
        LinkedHashMap<String, Object> values = values(request);
        plugin.message(requester, "cancelled-requester", values);
        Player target = Bukkit.getPlayer(request.targetId());
        if (target != null && target.isOnline()) plugin.message(target, "cancelled-target", values);
        return true;
    }

    private boolean handleAdmin(CommandSender sender, String[] args) {
        if (!sender.hasPermission(RELOAD_PERMISSION)) {
            plugin.message(sender, "no-permission", Map.of());
            return true;
        }
        if (args.length != 1 || !args[0].equalsIgnoreCase("reload")) {
            plugin.message(sender, "usage-admin", Map.of());
            return true;
        }
        plugin.reloadRuntimeConfig(sender);
        return true;
    }

    private boolean permitted(Player player, String permission) {
        if (player.hasPermission(permission)) return true;
        plugin.message(player, "no-permission", Map.of());
        return false;
    }

    private boolean placeStorageReady(Player player) {
        if (plugin.placeStorageAvailable()) return true;
        plugin.message(player, "location-storage-failed", Map.of());
        return false;
    }

    private static World resolveWorld(SavedPlace place) {
        World byId = Bukkit.getWorld(place.worldId());
        if (byId != null) return byId;
        World byName = Bukkit.getWorld(place.worldName());
        return byName != null && byName.getUID().equals(place.worldId()) ? byName : null;
    }

    private static boolean isSafeDestination(World world, Location location) {
        if (world == null || location == null || location.getWorld() == null
                || !world.getUID().equals(location.getWorld().getUID())) {
            return false;
        }
        double x = location.getX();
        double y = location.getY();
        double z = location.getZ();
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
                || !Float.isFinite(location.getYaw()) || !Float.isFinite(location.getPitch())
                || Math.abs(x) > SavedPlace.MAX_ABSOLUTE_COORDINATE
                || Math.abs(z) > SavedPlace.MAX_ABSOLUTE_COORDINATE
                || y < world.getMinHeight() || y >= world.getMaxHeight()) {
            return false;
        }
        try {
            WorldBorder border = world.getWorldBorder();
            Location center = border.getCenter();
            double halfSize = border.getSize() / 2.0D;
            return Double.isFinite(halfSize) && halfSize >= 0.0D
                    && x >= center.getX() - halfSize && x <= center.getX() + halfSize
                    && z >= center.getZ() - halfSize && z <= center.getZ() + halfSize;
        } catch (RuntimeException unavailableBorder) {
            return false;
        }
    }

    private void logStorageFailure(String operation, Player player, IOException error) {
        plugin.getLogger().warning(
                "Could not " + operation + " a saved place for " + player.getName() + ": " + safeError(error));
    }

    private static String safeError(Throwable error) {
        String message = error == null ? "unknown error" : error.getMessage();
        if (message == null || message.isBlank()) return error == null ? "unknown error" : error.getClass().getSimpleName();
        String oneLine = message.replace('\r', ' ').replace('\n', ' ').strip();
        return oneLine.length() <= 240 ? oneLine : oneLine.substring(0, 240);
    }

    private static Player findVisiblePlayer(Player viewer, String input) {
        String selected = input == null ? "" : input.strip();
        for (Player candidate : Bukkit.getOnlinePlayers()) {
            if (candidate.isOnline() && candidate.getName().equalsIgnoreCase(selected) && viewer.canSee(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private static LinkedHashMap<String, Object> values(TeleportRequest request) {
        return new LinkedHashMap<>(ServerTeleportPlugin.placeholders(request));
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        String name = command.getName().toLowerCase(Locale.ROOT);
        if (name.equals("serverteleport")) {
            if (args.length == 1 && sender.hasPermission(RELOAD_PERMISSION)) {
                return prefixMatches(List.of("reload"), args[0]);
            }
            return List.of();
        }
        if (!(sender instanceof Player player)) return List.of();
        if (name.equals("tpa")) {
            if (args.length == 1) {
                Map<String, String> candidates = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
                if (player.hasPermission(REQUEST_PERMISSION)) {
                    for (Player candidate : Bukkit.getOnlinePlayers()) {
                        if (!candidate.getUniqueId().equals(player.getUniqueId())
                                && candidate.isOnline() && player.canSee(candidate)) {
                            candidates.putIfAbsent(candidate.getName(), candidate.getName());
                        }
                    }
                }
                if (player.hasPermission(PLACES_PERMISSION)) {
                    for (String subcommand : List.of("set", "list", "delete")) {
                        candidates.putIfAbsent(subcommand, subcommand);
                    }
                    for (String place : plugin.placeNames(player.getUniqueId())) {
                        candidates.putIfAbsent(place, place);
                    }
                }
                if (player.hasPermission(RESPOND_PERMISSION)) {
                    candidates.putIfAbsent("accept", "accept");
                    candidates.putIfAbsent("decline", "decline");
                }
                return prefixMatches(new ArrayList<>(candidates.values()), args[0]);
            }
            if (args.length == 2 && args[0].equalsIgnoreCase("delete")
                    && player.hasPermission(PLACES_PERMISSION)) {
                return prefixMatches(plugin.placeNames(player.getUniqueId()), args[1]);
            }
            if (args.length == 2 && (args[0].equalsIgnoreCase("accept") || args[0].equalsIgnoreCase("decline"))
                    && player.hasPermission(RESPOND_PERMISSION)) {
                return prefixMatches(pendingRequesterNames(player), args[1]);
            }
            return List.of();
        }
        if (args.length == 1 && (name.equals("tpaccept") || name.equals("tpdeny"))
                && player.hasPermission(RESPOND_PERMISSION)) {
            return prefixMatches(pendingRequesterNames(player), args[0]);
        }
        return List.of();
    }

    private List<String> pendingRequesterNames(Player player) {
        return requests.incomingFor(player.getUniqueId()).stream()
                .map(TeleportRequest::requesterName)
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .toList();
    }

    private static List<String> prefixMatches(List<String> candidates, String input) {
        String prefix = input == null ? "" : input.toLowerCase(Locale.ROOT);
        return candidates.stream()
                .filter(candidate -> candidate.toLowerCase(Locale.ROOT).startsWith(prefix))
                .sorted(Comparator.comparing(value -> value.toLowerCase(Locale.ROOT)))
                .toList();
    }
}
