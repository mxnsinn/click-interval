package com.clickinterval.anticheat;

import com.clickinterval.anticheat.core.Clock;
import com.clickinterval.anticheat.core.EventLogger;
import com.clickinterval.anticheat.core.ModDeclaration;
import com.clickinterval.anticheat.core.OffenseRecord;
import com.clickinterval.anticheat.core.OffenseStore;
import com.clickinterval.anticheat.core.ViolationEngine;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.messaging.PluginMessageListener;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

public final class ClickIntervalAntiCheat extends JavaPlugin implements PluginMessageListener {
    private static final long MAINTENANCE_WARNING_INTERVAL_MILLIS = 60_000L;

    private ProtectionConfig protectionConfig;
    private ProtectionListener listener;
    private AccessControlListener accessControl;
    private PlayerSpectateController playerSpectate;
    private OffenseStore offenses;
    private EventLogger events;
    private ViolationEngine violations;
    private volatile long lastMaintenanceWarningAt;
    private int maintenanceRuns;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        accessControl = new AccessControlListener(this);
        try {
            accessControl.reload();
        } catch (RuntimeException invalidAccess) {
            getLogger().warning("Player access config was rejected; keeping managed commands locked down: "
                    + invalidAccess.getMessage());
        }
        playerSpectate = new PlayerSpectateController(this, accessControl);
        playerSpectate.start();
        try {
            protectionConfig = ProtectionConfig.from(getConfig());
        } catch (RuntimeException invalidConfig) {
            getLogger().severe("Protection config is invalid: " + invalidConfig.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        Path data = getDataFolder().toPath();
        offenses = new OffenseStore(data.resolve("offenses.properties"), Clock.SYSTEM);
        try {
            offenses.load();
        } catch (IOException error) {
            getLogger().warning("Could not load offense state; starting with an empty in-memory state: " + error.getMessage());
        }
        events = new EventLogger(data.resolve("events.jsonl"), message -> Bukkit.getConsoleSender().sendMessage(message));
        violations = new ViolationEngine(Clock.SYSTEM);
        listener = new ProtectionListener(this, protectionConfig, violations, offenses, events);
        getServer().getPluginManager().registerEvents(listener, this);
        getServer().getPluginManager().registerEvents(accessControl, this);
        getServer().getPluginManager().registerEvents(playerSpectate, this);
        getServer().getMessenger().registerIncomingPluginChannel(this, ModDeclaration.CHANNEL, this);
        getServer().getMessenger().registerIncomingPluginChannel(this, ModDeclaration.LEGACY_CHANNEL, this);

        Bukkit.getScheduler().runTaskTimerAsynchronously(this, () -> {
            try {
                offenses.saveIfDirty();
                if (++maintenanceRuns % 3 == 0) {
                    violations.prune(30L * 60L * 1000L);
                    offenses.pruneInactive(OffenseStore.DEFAULT_RETENTION_MILLIS);
                }
            } catch (IOException error) {
                warnMaintenance("Could not save protection history: " + error.getMessage());
            }
        }, 400L, 400L);
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            if (listener != null) listener.pruneSessions();
        }, 1_200L, 1_200L);
        getLogger().info("Server Protection enabled with the " + protectionConfig.preset() + " preset.");
    }

    @Override
    public void onDisable() {
        if (playerSpectate != null) playerSpectate.shutdown();
        if (accessControl != null) accessControl.shutdown();
        if (listener != null) listener.shutdown();
        getServer().getMessenger().unregisterIncomingPluginChannel(this, ModDeclaration.CHANNEL, this);
        getServer().getMessenger().unregisterIncomingPluginChannel(this, ModDeclaration.LEGACY_CHANNEL, this);
        if (offenses != null) {
            try {
                offenses.saveIfDirty();
            } catch (IOException error) {
                getLogger().warning("Could not save protection history during shutdown: " + error.getMessage());
            }
        }
        if (events != null) events.close();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("whisper")) {
            if (args.length < 2) {
                sender.sendMessage("Usage: /whisper <player> <message>");
                return true;
            }
            if (!Bukkit.dispatchCommand(sender, "minecraft:msg " + String.join(" ", args))) {
                sender.sendMessage("§cPrivate messaging is not available on this server.");
            }
            return true;
        }
        if (command.getName().equalsIgnoreCase("ci-spectate")
                || command.getName().equalsIgnoreCase("ci-unspectate")
                || command.getName().equalsIgnoreCase("unspectate")) {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("Only a player can use this command.");
                return true;
            }
            String line = command.getName() + (args.length == 0 ? "" : " " + String.join(" ", args));
            PlayerSpectateController.Result result = playerSpectate.handle(player, line);
            player.sendMessage(result.message());
            return true;
        }
        if (command.getName().equalsIgnoreCase("entityadmin")) {
            if (args.length > 1 || (args.length == 1 && !args[0].equalsIgnoreCase("help"))) {
                sender.sendMessage("Usage: /entityadmin [help]");
                return true;
            }
            sender.sendMessage("Open Click Interval > Minecraft Server > Entity Viewer to inspect loaded entities and edit supported values.");
            return true;
        }
        if (!command.getName().equalsIgnoreCase("serverprotection")) return false;
        if (args.length == 0 || args[0].equalsIgnoreCase("status")) {
            sender.sendMessage("§bServer Protection§7 — preset: §f" + protectionConfig.preset());
            sender.sendMessage(protectionConfig.enabled()
                    ? "§7Checks are active. Use §f/protect history§7 for recent offenses."
                    : "§7Checks are disabled. Stored history is still available with §f/protect history§7.");
            sender.sendMessage("§7PvP visibility uses vanilla player and nametag tracking.");
            if (events != null && (events.droppedEventCount() > 0 || events.writeFailureCount() > 0)) {
                sender.sendMessage("§eHistory writer: " + events.droppedEventCount() + " dropped, "
                        + events.writeFailureCount() + " failed batch(es). Detection remains active.");
            }
            return true;
        }
        if (!sender.hasPermission("serverprotection.admin") && !sender.hasPermission("clickinterval.anticheat.admin")) {
            sender.sendMessage("§cYou do not have permission to manage protection.");
            return true;
        }
        if (args[0].equalsIgnoreCase("reload")) {
            try {
                reloadConfig();
                ProtectionConfig updated = ProtectionConfig.from(getConfig());
                protectionConfig = updated;
                listener.updateConfig(updated);
                try {
                    accessControl.reload();
                    playerSpectate.restoreUnauthorized();
                    sender.sendMessage("§aServer Protection and player access reloaded.");
                } catch (RuntimeException invalidAccess) {
                    // AccessControlListener fails closed to an empty policy. End any camera
                    // sessions immediately even though the malformed file was rejected.
                    playerSpectate.restoreUnauthorized();
                    sender.sendMessage("§eProtection reloaded, but player access was rejected: "
                            + invalidAccess.getMessage());
                }
            } catch (RuntimeException invalidConfig) {
                sender.sendMessage("§cReload rejected: " + invalidConfig.getMessage());
            }
            return true;
        }
        if (args[0].equalsIgnoreCase("history")) {
            List<OffenseRecord> records = offenses.recent(10);
            if (records.isEmpty()) {
                sender.sendMessage("§7No protection history yet.");
                return true;
            }
            sender.sendMessage("§bRecent Server Protection events:");
            for (OffenseRecord record : records) {
                sender.sendMessage("§7• §f" + record.name() + " §8— §7" + record.lastCheck()
                        + " §8(§7" + record.lastAction() + ", " + record.offenseCount() + " offenses§8)");
            }
            return true;
        }
        if (args[0].equalsIgnoreCase("mods")) {
            if (args.length < 2) {
                sender.sendMessage("§7Usage: §f/protect mods <online-player>");
                return true;
            }
            Player player = Bukkit.getPlayerExact(args[1]);
            if (player == null) {
                sender.sendMessage("§cThat player is not online.");
                return true;
            }
            ProtectionListener.ModStatus status = listener.modStatus(player);
            if (!status.declarationReceived()) {
                sender.sendMessage("§e" + player.getName() + " has not sent a compatible mod declaration.");
                sender.sendMessage("§7A Paper server cannot discover an arbitrary client mod list on its own.");
            } else if (status.mods().isEmpty()) {
                sender.sendMessage("§7" + player.getName() + " declared no client mods.");
            } else {
                sender.sendMessage("§bDeclared mods for " + player.getName() + ": §f"
                        + String.join("§7, §f", status.mods().stream().sorted().toList()));
                sender.sendMessage("§7Client declarations are advisory and may be incomplete or spoofed.");
            }
            return true;
        }
        if (args[0].equalsIgnoreCase("compatibility")) {
            if (args.length < 2) {
                sender.sendMessage("§7Usage: §f/protect compatibility <online-player>");
                return true;
            }
            Player player = Bukkit.getPlayerExact(args[1]);
            if (player == null) {
                sender.sendMessage("§cThat player is not online.");
                return true;
            }
            var checks = protectionConfig.compatibility()
                    .exemptionForPlayer(player.getUniqueId(), player.getName());
            sender.sendMessage(checks.isEmpty()
                    ? "§7No direct check exemptions are assigned to " + player.getName() + "."
                    : "§bCheck exemptions for " + player.getName() + ": §f"
                    + String.join("§7, §f", checks.stream().sorted().toList()));
            return true;
        }
        if (args[0].equalsIgnoreCase("pardon") && args.length >= 2) {
            UUID match = findPlayerId(args[1]);
            OffenseRecord record = match == null ? null : offenses.get(match);
            if (record == null || !offenses.pardon(match)) {
                sender.sendMessage("§cNo stored player matched " + args[1] + ".");
            } else {
                violations.forgive(match);
                Bukkit.getBanList(org.bukkit.BanList.Type.NAME).pardon(record.name());
                sender.sendMessage("§aCleared protection offenses for " + args[1] + ".");
            }
            return true;
        }
        sender.sendMessage("§7Usage: §f/protect status§7, §f/protect history§7, §f/protect reload§7, "
                + "§f/protect pardon <name|uuid>§7, §f/protect mods <player>§7, §f/protect compatibility <player>");
        return true;
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (!ModDeclaration.isSupportedChannel(channel) || listener == null) return;
        listener.receiveModDeclaration(player, message);
    }

    private UUID findPlayerId(String query) {
        try {
            return UUID.fromString(query);
        } catch (IllegalArgumentException ignored) {
            OffenseRecord record = offenses.findByName(query);
            return record == null ? null : record.uuid();
        }
    }

    private void warnMaintenance(String message) {
        long now = System.currentTimeMillis();
        if (now - lastMaintenanceWarningAt < MAINTENANCE_WARNING_INTERVAL_MILLIS) return;
        lastMaintenanceWarningAt = now;
        getLogger().warning(message);
    }
}
