package com.clickinterval.anticheat;

import com.clickinterval.anticheat.core.AccessPolicy;
import com.clickinterval.anticheat.core.SpectateRecoveryStore;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.UUID;

/** Owner/Admin player cameras with a bounded crash-recovery journal. */
final class PlayerSpectateController implements Listener {
    private static final double POSITION_EPSILON_SQUARED = 0.0004;
    private static final float ROTATION_EPSILON = 0.1f;

    private final JavaPlugin plugin;
    private final AccessControlListener access;
    private final SpectateRecoveryStore store;
    private final LinkedHashMap<UUID, SpectateRecoveryStore.Origin> sessions = new LinkedHashMap<>();
    private boolean journalHealthy;

    PlayerSpectateController(JavaPlugin plugin, AccessControlListener access) {
        this.plugin = plugin;
        this.access = access;
        Path file = plugin.getDataFolder().toPath().resolve("player-view-recovery.state");
        store = new SpectateRecoveryStore(file);
    }

    void start() {
        sessions.clear();
        try {
            sessions.putAll(store.load());
            journalHealthy = true;
        } catch (IOException error) {
            journalHealthy = false;
            plugin.getLogger().severe("Player-view recovery could not be loaded; new camera sessions are disabled: "
                    + error.getMessage());
        }
        for (Player player : plugin.getServer().getOnlinePlayers()) recoverOnJoin(player);
    }

    void shutdown() {
        for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
            Player viewer = plugin.getServer().getPlayer(origin.viewerId());
            if (viewer != null) restore(viewer);
        }
        persist();
        sessions.clear();
    }

    boolean canUse(Player player) {
        return player != null && access.hasCapability(player, AccessPolicy.PLAYER_SPECTATE);
    }

    Result handle(Player player, String commandLine) {
        String clean = String.valueOf(commandLine == null ? "" : commandLine).trim();
        while (clean.startsWith("/")) clean = clean.substring(1).trim();
        if (clean.isEmpty() || clean.length() > 256) return Result.notHandled();
        String[] parts = clean.split("\\s+", 3);
        String root = parts[0].toLowerCase(Locale.ROOT);
        int namespace = root.indexOf(':');
        if (namespace >= 0) {
            String owner = root.substring(0, namespace);
            if (!owner.equals("serverprotection")) return Result.notHandled();
            root = root.substring(namespace + 1);
        }
        if (!root.equals("ci-spectate") && !root.equals("ci-unspectate")
                && !root.equals("unspectate")) return Result.notHandled();
        if (!access.canUsePlayerView(player, root)) return Result.fail("Your role does not allow player viewing.");
        if (!root.equals("ci-spectate")) {
            return parts.length == 1 ? restore(player) : Result.fail("Usage: /ci-unspectate");
        }
        if (parts.length != 2 || !parts[1].matches("[A-Za-z0-9_]{1,16}")) {
            return Result.fail("Usage: /ci-spectate <online-player>");
        }
        Player target = plugin.getServer().getOnlinePlayers().stream()
                .filter(candidate -> candidate.getName().equalsIgnoreCase(parts[1]))
                .findFirst().orElse(null);
        return begin(player, target);
    }

    void restoreUnauthorized() {
        for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
            Player viewer = plugin.getServer().getPlayer(origin.viewerId());
            if (viewer == null || canUse(viewer)) continue;
            Result result = restore(viewer);
            viewer.sendMessage("Your player-view access changed. " + result.message());
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        Result result = handle(event.getPlayer(), event.getMessage());
        if (!result.handled()) return;
        event.setCancelled(true);
        event.getPlayer().sendMessage(result.message());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        recoverOnJoin(event.getPlayer());
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onQuit(PlayerQuitEvent event) {
        Player leaving = event.getPlayer();
        if (sessions.containsKey(leaving.getUniqueId())) restore(leaving);
        restoreViewersOf(leaving.getUniqueId());
    }

    private Result begin(Player viewer, Player target) {
        if (!journalHealthy) return Result.fail("Player viewing is unavailable until its recovery file is repaired.");
        if (target == null || !target.isOnline()) return Result.fail("That player is not online.");
        if (viewer.getUniqueId().equals(target.getUniqueId())) return Result.fail("You cannot view yourself.");
        SpectateRecoveryStore.Origin previous = sessions.get(viewer.getUniqueId());
        SpectateRecoveryStore.Origin updated;
        try {
            updated = previous == null ? capture(viewer, target)
                    : previous.withTarget(target.getUniqueId(), target.getName());
        } catch (IllegalArgumentException invalid) {
            return Result.fail("Your current location could not be saved safely.");
        }
        if (previous == null && sessions.size() >= SpectateRecoveryStore.MAX_RECORDS) {
            return Result.fail("Too many player-view sessions are already active.");
        }
        sessions.put(viewer.getUniqueId(), updated);
        if (!persist()) {
            if (previous == null) sessions.remove(viewer.getUniqueId());
            else sessions.put(viewer.getUniqueId(), previous);
            return Result.fail("Your return location could not be saved. Nothing was changed.");
        }
        try {
            viewer.setGameMode(GameMode.SPECTATOR);
            viewer.setSpectatorTarget(target);
            return Result.ok("Now viewing " + target.getName() + ". Use /ci-unspectate to return.");
        } catch (RuntimeException failed) {
            Result restored = restore(viewer);
            return Result.fail(restored.success()
                    ? "The camera could not follow that player. Your previous state was restored."
                    : "The camera failed and automatic recovery is still pending.");
        }
    }

    private Result restore(Player viewer) {
        SpectateRecoveryStore.Origin origin = sessions.get(viewer.getUniqueId());
        if (origin == null) return Result.fail("You are not viewing another player.");
        World world = resolveWorld(origin.worldId());
        if (world == null) return Result.fail("Your saved world is not currently available.");
        GameMode mode = parseGameMode(origin.gameMode());
        Location destination = new Location(world, origin.x(), origin.y(), origin.z(), origin.yaw(), origin.pitch());
        try {
            if (viewer.getGameMode() == GameMode.SPECTATOR) viewer.setSpectatorTarget(null);
            boolean teleported = viewer.teleport(destination);
            viewer.setGameMode(mode);
            if (!teleported || !matches(viewer, destination, mode)) {
                return Result.fail("Your saved state could not be verified; recovery remains pending.");
            }
            sessions.remove(viewer.getUniqueId());
            if (!persist()) {
                sessions.put(viewer.getUniqueId(), origin);
                return Result.fail("You returned, but recovery cleanup is pending. Try /ci-unspectate again.");
            }
            return Result.ok("Returned to your previous location and game mode.");
        } catch (RuntimeException failed) {
            plugin.getLogger().warning("Could not restore player-view session for " + origin.viewerName()
                    + ": " + failed.getMessage());
            return Result.fail("Your saved state could not be restored yet. Try /ci-unspectate again.");
        }
    }

    private void recoverOnJoin(Player player) {
        if (!sessions.containsKey(player.getUniqueId())) return;
        Result result = restore(player);
        player.sendMessage(result.message());
    }

    private void restoreViewersOf(UUID targetId) {
        for (SpectateRecoveryStore.Origin origin : new ArrayList<>(sessions.values())) {
            if (!origin.targetId().equals(targetId)) continue;
            Player viewer = plugin.getServer().getPlayer(origin.viewerId());
            if (viewer == null) continue;
            Result result = restore(viewer);
            viewer.sendMessage("The player you were viewing left. " + result.message());
        }
    }

    private SpectateRecoveryStore.Origin capture(Player viewer, Player target) {
        Location location = viewer.getLocation();
        return new SpectateRecoveryStore.Origin(
                viewer.getUniqueId(), viewer.getName(), target.getUniqueId(), target.getName(),
                viewer.getWorld().getUID().toString(), location.getX(), location.getY(), location.getZ(),
                location.getYaw(), location.getPitch(), viewer.getGameMode().name().toLowerCase(Locale.ROOT));
    }

    private World resolveWorld(String value) {
        try {
            return plugin.getServer().getWorld(UUID.fromString(value));
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private boolean persist() {
        if (!journalHealthy) return false;
        try {
            store.save(sessions.values());
            return true;
        } catch (IOException error) {
            plugin.getLogger().severe("Player-view recovery could not be saved: " + error.getMessage());
            return false;
        }
    }

    private static GameMode parseGameMode(String value) {
        try {
            return GameMode.valueOf(String.valueOf(value).toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException invalid) {
            return GameMode.SURVIVAL;
        }
    }

    private static boolean matches(Player player, Location expected, GameMode mode) {
        Location actual = player.getLocation();
        return actual.getWorld() != null && actual.getWorld().getUID().equals(expected.getWorld().getUID())
                && actual.distanceSquared(expected) <= POSITION_EPSILON_SQUARED
                && angularDistance(actual.getYaw(), expected.getYaw()) <= ROTATION_EPSILON
                && Math.abs(actual.getPitch() - expected.getPitch()) <= ROTATION_EPSILON
                && player.getGameMode() == mode;
    }

    private static float angularDistance(float first, float second) {
        float delta = Math.abs((first - second) % 360.0f);
        return Math.min(delta, 360.0f - delta);
    }

    record Result(boolean handled, boolean success, String message) {
        static Result notHandled() { return new Result(false, false, ""); }
        static Result ok(String message) { return new Result(true, true, message); }
        static Result fail(String message) { return new Result(true, false, message); }
    }
}
