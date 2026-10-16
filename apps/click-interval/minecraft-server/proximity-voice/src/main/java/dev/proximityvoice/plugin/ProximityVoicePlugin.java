package dev.proximityvoice.plugin;

import dev.proximityvoice.core.ControlCodec;
import dev.proximityvoice.core.PlayerSnapshot;
import dev.proximityvoice.core.Protocol;
import dev.proximityvoice.core.ProtocolException;
import dev.proximityvoice.core.RelayMetrics;
import dev.proximityvoice.core.RelayStatus;
import dev.proximityvoice.core.SessionRegistry;
import dev.proximityvoice.core.StatusFileWriter;
import dev.proximityvoice.core.VoiceRelayEngine;
import dev.proximityvoice.core.VoiceSession;
import org.bukkit.Location;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.messaging.PluginMessageListener;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ProximityVoicePlugin extends JavaPlugin implements Listener, PluginMessageListener {
    private static final long HELLO_COOLDOWN_MILLIS = 1_000L;

    private SessionRegistry sessions;
    private VoiceRelayEngine engine;
    private VoiceRelayServer relay;
    private VoiceConfig voiceConfig;
    private Path statusFile;
    private String startupError = "";
    private Map<UUID, Integer> lastRosterState = Map.of();
    private final Map<UUID, Long> lastHelloAt = new HashMap<>();
    private long rosterRevision;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        statusFile = getDataFolder().toPath().resolve("status.json");
        try {
            voiceConfig = VoiceConfig.from(getConfig());
        } catch (RuntimeException invalidConfig) {
            startupError = invalidConfig.getMessage() == null || invalidConfig.getMessage().isBlank()
                    ? invalidConfig.getClass().getSimpleName()
                    : invalidConfig.getMessage();
            getLogger().severe("Voice configuration is invalid: " + startupError);
            writeStatus("error");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        sessions = new SessionRegistry();
        engine = new VoiceRelayEngine(sessions, voiceConfig.voiceRadius());
        relay = new VoiceRelayServer(engine, message -> {
            getLogger().warning("UDP relay error: " + message);
            // The receiver marks itself stopped before invoking this callback, so the
            // status file immediately reports an error instead of a stale running state.
            writeStatus(currentState());
        });

        getServer().getMessenger().registerIncomingPluginChannel(this, Protocol.CONTROL_CHANNEL, this);
        getServer().getMessenger().registerOutgoingPluginChannel(this, Protocol.CONTROL_CHANNEL);
        getServer().getPluginManager().registerEvents(this, this);

        if (voiceConfig.enabled()) {
            try {
                int port = relay.start(voiceConfig.bindAddress(), voiceConfig.port());
                getLogger().info("Proximity voice relay listening on UDP port " + port + ".");
            } catch (IOException bindError) {
                startupError = String.valueOf(bindError.getMessage());
                getLogger().severe("Could not start proximity voice UDP relay: " + startupError);
            }
        } else {
            getLogger().info("Proximity voice is disabled in config.yml.");
        }

        getServer().getScheduler().runTaskTimer(this, this::refreshSnapshots, 1L, 5L);
        getServer().getScheduler().runTaskTimer(this, this::maintainSessionsAndStatus, 100L, 100L);
        writeStatus(currentState());
    }

    @Override
    public void onDisable() {
        if (relay != null) relay.close();
        if (sessions != null) sessions.clear();
        lastHelloAt.clear();
        if (getServer() != null) {
            getServer().getMessenger().unregisterIncomingPluginChannel(this, Protocol.CONTROL_CHANNEL, this);
            getServer().getMessenger().unregisterOutgoingPluginChannel(this, Protocol.CONTROL_CHANNEL);
        }
        String relayError = relay == null ? "" : relay.lastError();
        writeStatus(RelayLifecycle.stateAfterDisable(startupError, relayError));
    }

    @Override
    public void onPluginMessageReceived(String channel, Player player, byte[] message) {
        if (!Protocol.CONTROL_CHANNEL.equals(channel) || player == null) return;
        try {
            ControlCodec.decodeClientHello(message);
            long now = System.currentTimeMillis();
            Long previousHello = lastHelloAt.put(player.getUniqueId(), now);
            if (previousHello != null && now - previousHello < HELLO_COOLDOWN_MILLIS) return;
            if (!player.hasPermission("proximityvoice.use")) {
                sendError(player, "Voice chat is not permitted for this player.");
                return;
            }
            if (relay == null || !relay.running()) {
                sendError(player, "The server voice relay is not available.");
                return;
            }
            VoiceSession session = sessions.create(player.getUniqueId(), player.getName(), now);
            ControlCodec.Welcome welcome = new ControlCodec.Welcome(
                    session.sessionId(),
                    session.key(),
                    session.challenge(),
                    relay.boundPort(),
                    voiceConfig.voiceRadius(),
                    voiceConfig.publicHost());
            player.sendPluginMessage(this, Protocol.CONTROL_CHANNEL, ControlCodec.encodeWelcome(welcome));
            broadcastRosterIfChanged(true);
        } catch (ProtocolException invalidMessage) {
            sendError(player, invalidMessage.getMessage());
        } catch (RuntimeException error) {
            getLogger().warning("Voice session setup failed for " + player.getName() + ": " + error.getMessage());
            sendError(player, "The voice session could not be created.");
        }
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        lastHelloAt.remove(event.getPlayer().getUniqueId());
        if (sessions != null && sessions.removePlayer(event.getPlayer().getUniqueId())) {
            broadcastRosterIfChanged(true);
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("proximityvoice")) return false;
        if (!sender.hasPermission("proximityvoice.admin")) {
            sender.sendMessage("§cYou do not have permission to view voice relay status.");
            return true;
        }
        RelayMetrics.Snapshot metrics = engine == null ? new RelayMetrics().snapshot() : engine.metrics().snapshot();
        sender.sendMessage("§bProximity Voice§7 — " + currentState());
        sender.sendMessage("§7UDP port: §f" + (relay == null ? voiceConfig == null ? 0 : voiceConfig.port() : relay.boundPort())
                + "§7, connected clients: §f" + (sessions == null ? 0 : sessions.associatedCount()));
        sender.sendMessage("§eUDP reachability is not automatically verified; expose this port separately from Minecraft TCP.");
        sender.sendMessage("§7Frames: §f" + metrics.voiceFrames()
                + "§7, routed deliveries: §f" + metrics.routedRecipients());
        return true;
    }

    private void refreshSnapshots() {
        if (engine == null) return;
        Map<UUID, PlayerSnapshot> next = new HashMap<>();
        for (Player player : getServer().getOnlinePlayers()) {
            if (!player.hasPermission("proximityvoice.use")) continue;
            Location location = player.getLocation();
            if (location.getWorld() == null) continue;
            next.put(player.getUniqueId(), new PlayerSnapshot(
                    player.getUniqueId(),
                    location.getWorld().getUID().toString(),
                    location.getX(), location.getY(), location.getZ(),
                    true));
        }
        engine.setSnapshots(next);
        broadcastRosterIfChanged(false);
    }

    private void maintainSessionsAndStatus() {
        if (sessions != null && voiceConfig != null) {
            if (sessions.pruneIdle(System.currentTimeMillis(), voiceConfig.sessionTimeoutMillis()) > 0) {
                broadcastRosterIfChanged(true);
            }
        }
        writeStatus(currentState());
    }

    private String currentState() {
        return RelayLifecycle.currentState(
                voiceConfig != null,
                voiceConfig != null && voiceConfig.enabled(),
                relay != null && relay.running(),
                startupError,
                relay == null ? "" : relay.lastError());
    }

    private void sendError(Player player, String message) {
        try {
            player.sendPluginMessage(this, Protocol.CONTROL_CHANNEL, ControlCodec.encodeError(message));
        } catch (RuntimeException ignored) {}
    }

    private void broadcastRosterIfChanged(boolean force) {
        if (sessions == null) return;
        Map<UUID, Integer> state = new HashMap<>();
        for (VoiceSession session : sessions.sessions()) {
            int flags = 0;
            if (session.endpoint() != null) flags |= ControlCodec.ROSTER_FLAG_CONNECTED;
            if (session.muted()) flags |= ControlCodec.ROSTER_FLAG_MUTED;
            state.put(session.playerId(), flags);
        }
        if (!force && state.equals(lastRosterState)) return;
        lastRosterState = Map.copyOf(state);
        rosterRevision = rosterRevision == Long.MAX_VALUE ? 1L : rosterRevision + 1L;
        List<ControlCodec.RosterEntry> entries = state.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> new ControlCodec.RosterEntry(entry.getKey(), entry.getValue()))
                .toList();
        final byte[] payload;
        try {
            payload = ControlCodec.encodeRoster(rosterRevision, entries);
        } catch (ProtocolException error) {
            getLogger().warning("Could not encode voice roster: " + error.getMessage());
            return;
        }
        for (UUID playerId : state.keySet()) {
            Player player = getServer().getPlayer(playerId);
            if (player != null && player.isOnline()) {
                player.sendPluginMessage(this, Protocol.CONTROL_CHANNEL, payload);
            }
        }
    }

    private void writeStatus(String state) {
        if (statusFile == null) return;
        RelayMetrics.Snapshot metrics = engine == null ? new RelayMetrics().snapshot() : engine.metrics().snapshot();
        String relayError = relay == null ? "" : relay.lastError();
        String statusError = startupError == null || startupError.isBlank() ? relayError : startupError;
        RelayStatus status = new RelayStatus(
                state,
                Protocol.VERSION,
                voiceConfig == null ? "" : voiceConfig.bindAddress(),
                voiceConfig == null ? "" : voiceConfig.publicHost(),
                relay != null && relay.boundPort() > 0 ? relay.boundPort() : voiceConfig == null ? 0 : voiceConfig.port(),
                voiceConfig == null ? 0.0 : voiceConfig.voiceRadius(),
                sessions == null ? 0 : sessions.size(),
                sessions == null ? 0 : sessions.associatedCount(),
                metrics,
                statusError,
                Instant.now().toString());
        try {
            StatusFileWriter.write(statusFile, status);
        } catch (IOException error) {
            getLogger().warning("Could not write voice relay status: " + error.getMessage());
        }
    }
}
