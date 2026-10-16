package com.servermanager.teleport;

import com.servermanager.teleport.core.Clock;
import com.servermanager.teleport.core.PlaceBook;
import com.servermanager.teleport.core.PlaceFile;
import com.servermanager.teleport.core.RequestBook;
import com.servermanager.teleport.core.SavedPlace;
import com.servermanager.teleport.core.TeleportRequest;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public final class ServerTeleportPlugin extends JavaPlugin {
    private TeleportConfig settings;
    private RequestBook requests;
    private PlaceBook places = new PlaceBook();
    private PlaceFile placeFile;
    private boolean placeStorageAvailable;
    private BukkitTask cleanupTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        settings = TeleportConfig.from(getConfig());
        requests = new RequestBook(
                Clock.SYSTEM,
                settings.requestExpiryMillis(),
                settings.requestCooldownMillis(),
                settings.maxIncomingRequests()
        );
        loadPlaces();

        TeleportCommands commands = new TeleportCommands(this, requests);
        for (String commandName : List.of("tpa", "tpaccept", "tpdeny", "tpacancel", "serverteleport")) {
            var command = Objects.requireNonNull(getCommand(commandName), "Missing command: " + commandName);
            command.setExecutor(commands);
            command.setTabCompleter(commands);
        }
        getServer().getPluginManager().registerEvents(new PlayerLifecycleListener(this), this);
        cleanupTask = Bukkit.getScheduler().runTaskTimer(this, this::expireRequests, 20L, 20L);
        getLogger().info("Player teleport requests are ready.");
    }

    @Override
    public void onDisable() {
        if (cleanupTask != null) cleanupTask.cancel();
        if (requests != null) requests.clear();
    }

    public TeleportConfig settings() {
        return settings;
    }

    public synchronized boolean placeStorageAvailable() {
        return placeStorageAvailable;
    }

    public synchronized PlaceBook.PutResult savePlace(UUID playerId, String name, SavedPlace place)
            throws IOException {
        ensurePlaceStorage();
        PlaceBook candidate = places.copy();
        PlaceBook.PutResult result = candidate.put(playerId, name, place);
        if (result == PlaceBook.PutResult.LIMIT_REACHED) return result;
        placeFile.save(candidate.snapshot());
        places = candidate;
        return result;
    }

    public synchronized boolean deletePlace(UUID playerId, String name) throws IOException {
        ensurePlaceStorage();
        PlaceBook candidate = places.copy();
        if (!candidate.delete(playerId, name)) return false;
        placeFile.save(candidate.snapshot());
        places = candidate;
        return true;
    }

    public synchronized SavedPlace findPlace(UUID playerId, String name) {
        return placeStorageAvailable ? places.get(playerId, name) : null;
    }

    public synchronized List<String> placeNames(UUID playerId) {
        return placeStorageAvailable ? places.names(playerId) : List.of();
    }

    public boolean reloadRuntimeConfig(CommandSender sender) {
        try {
            reloadConfig();
            TeleportConfig updated = TeleportConfig.from(getConfig());
            requests.configure(
                    updated.requestExpiryMillis(),
                    updated.requestCooldownMillis(),
                    updated.maxIncomingRequests()
            );
            settings = updated;
            message(sender, "reload-complete", Map.of());
            return true;
        } catch (RuntimeException error) {
            getLogger().warning("Could not reload teleport settings: " + error.getMessage());
            message(sender, "reload-failed", Map.of());
            return false;
        }
    }

    public void expireRequests() {
        for (TeleportRequest request : requests.expire()) {
            Map<String, Object> values = placeholders(request);
            Player requester = Bukkit.getPlayer(request.requesterId());
            Player target = Bukkit.getPlayer(request.targetId());
            if (requester != null && requester.isOnline()) message(requester, "expired-requester", values);
            if (target != null && target.isOnline()) message(target, "expired-target", values);
        }
    }

    public void handleDeparture(Player departing) {
        for (TeleportRequest request : requests.removePlayer(departing.getUniqueId())) {
            Map<String, Object> values = placeholders(request);
            if (departing.getUniqueId().equals(request.requesterId())) {
                Player target = Bukkit.getPlayer(request.targetId());
                if (target != null && target.isOnline()) message(target, "requester-left-target", values);
            } else {
                Player requester = Bukkit.getPlayer(request.requesterId());
                if (requester != null && requester.isOnline()) message(requester, "target-left-requester", values);
            }
        }
    }

    public void message(CommandSender recipient, String key, Map<String, ?> placeholders) {
        String rendered = settings.messages().render(key, placeholders);
        if (!rendered.isEmpty()) recipient.sendMessage(rendered);
    }

    public static Map<String, Object> placeholders(TeleportRequest request) {
        return Map.of(
                "requester", request.requesterName(),
                "target", request.targetName()
        );
    }

    private void loadPlaces() {
        Path path = getDataFolder().toPath().resolve("places.properties");
        placeFile = new PlaceFile(path);
        try {
            PlaceFile.LoadResult loaded = placeFile.load();
            places = loaded.places();
            placeStorageAvailable = true;
            for (String warning : loaded.warnings()) {
                getLogger().warning("Saved places: " + warning);
            }
        } catch (IOException error) {
            placeStorageAvailable = false;
            getLogger().severe(
                    "Saved places are disabled because " + path + " could not be loaded: " + error.getMessage());
        }
    }

    private void ensurePlaceStorage() throws IOException {
        if (!placeStorageAvailable || placeFile == null) {
            throw new IOException("saved-place storage is unavailable");
        }
    }
}
