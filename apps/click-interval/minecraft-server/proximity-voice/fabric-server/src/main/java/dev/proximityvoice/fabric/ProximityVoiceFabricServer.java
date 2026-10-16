package dev.proximityvoice.fabric;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
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
import dev.proximityvoice.plugin.RelayLifecycle;
import dev.proximityvoice.plugin.VoiceRelayServer;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.permissions.Permissions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Fabric 26.2 server adapter for the shared encrypted UDP voice relay. */
public final class ProximityVoiceFabricServer implements ModInitializer {
    public static final String MOD_ID = "proximityvoice_fabric_server";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final long HELLO_COOLDOWN_MILLIS = 1_000L;
    private static final int SNAPSHOT_INTERVAL_TICKS = 5;
    private static final int MAINTENANCE_INTERVAL_TICKS = 100;

    private final Path configDirectory = FabricLoader.getInstance().getConfigDir().resolve("proximity-voice-server");
    private final Path configFile = configDirectory.resolve("config.properties");
    private final Path statusFile = configDirectory.resolve("status.json");
    private final Map<UUID, Long> lastHelloAt = new HashMap<>();
    private Map<UUID, Integer> lastRosterState = Map.of();
    private SessionRegistry sessions;
    private VoiceRelayEngine engine;
    private VoiceRelayServer relay;
    private FabricVoiceConfig voiceConfig;
    private MinecraftServer server;
    private String startupError = "";
    private long rosterRevision;
    private int snapshotTicks;
    private int maintenanceTicks;

    @Override
    public void onInitialize() {
        PayloadTypeRegistry.serverboundPlay().register(VoiceControlPayload.TYPE, VoiceControlPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(VoiceControlPayload.TYPE, VoiceControlPayload.CODEC);
        ServerPlayNetworking.registerGlobalReceiver(VoiceControlPayload.TYPE,
                (payload, context) -> handleControlMessage(context.player(), payload.data()));
        ServerPlayConnectionEvents.DISCONNECT.register((handler, minecraftServer) ->
                onDisconnect(handler.getPlayer()));
        ServerLifecycleEvents.SERVER_STARTING.register(this::onServerStarting);
        ServerLifecycleEvents.SERVER_STARTED.register(this::onServerStarted);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onServerStopping);
        ServerTickEvents.END_SERVER_TICK.register(this::onServerTick);
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                dispatcher.register(statusCommand()));
    }

    private void onServerStarting(MinecraftServer minecraftServer) {
        server = minecraftServer;
        startupError = "";
        rosterRevision = 0L;
        snapshotTicks = 0;
        maintenanceTicks = 0;
        lastHelloAt.clear();
        lastRosterState = Map.of();
        try {
            voiceConfig = FabricVoiceConfig.load(configFile);
        } catch (IOException | RuntimeException error) {
            voiceConfig = FabricVoiceConfig.defaults();
            startupError = cleanError(error);
            LOGGER.error("Voice configuration could not be loaded; safe defaults are active: {}", startupError);
        }
        sessions = new SessionRegistry();
        engine = new VoiceRelayEngine(sessions, voiceConfig.voiceRadius());
        relay = new VoiceRelayServer(engine, message -> {
            LOGGER.warn("UDP relay error: {}", message);
            writeStatus(currentState());
        });
        if (voiceConfig.enabled()) {
            try {
                int port = relay.start(voiceConfig.bindAddress(), voiceConfig.port());
                LOGGER.info("Proximity Voice Fabric relay listening on UDP port {}.", port);
            } catch (IOException error) {
                startupError = cleanError(error);
                LOGGER.error("Could not start proximity voice UDP relay: {}", startupError);
            }
        } else {
            LOGGER.info("Proximity Voice Fabric relay is disabled in config.properties.");
        }
        writeStatus(currentState());
    }

    private void onServerStarted(MinecraftServer minecraftServer) {
        if (server != minecraftServer) return;
        refreshSnapshots();
        writeStatus(currentState());
    }

    private void onServerStopping(MinecraftServer minecraftServer) {
        if (relay != null) relay.close();
        if (sessions != null) sessions.clear();
        lastHelloAt.clear();
        lastRosterState = Map.of();
        String relayError = relay == null ? "" : relay.lastError();
        writeStatus(RelayLifecycle.stateAfterDisable(startupError, relayError));
        server = null;
    }

    private void onServerTick(MinecraftServer minecraftServer) {
        if (++snapshotTicks >= SNAPSHOT_INTERVAL_TICKS) {
            snapshotTicks = 0;
            refreshSnapshots();
        }
        if (++maintenanceTicks >= MAINTENANCE_INTERVAL_TICKS) {
            maintenanceTicks = 0;
            maintainSessionsAndStatus();
        }
    }

    private void handleControlMessage(ServerPlayer player, byte[] message) {
        if (player == null || sessions == null || voiceConfig == null) return;
        try {
            ControlCodec.decodeClientHello(message);
            long now = System.currentTimeMillis();
            Long previousHello = lastHelloAt.put(player.getUUID(), now);
            if (previousHello != null && now - previousHello < HELLO_COOLDOWN_MILLIS) return;
            if (relay == null || !relay.running()) {
                sendError(player, "The server voice relay is not available.");
                return;
            }
            VoiceSession session = sessions.create(player.getUUID(), player.getGameProfile().name(), now);
            ControlCodec.Welcome welcome = new ControlCodec.Welcome(
                    session.sessionId(), session.key(), session.challenge(), relay.boundPort(),
                    voiceConfig.voiceRadius(), voiceConfig.publicHost());
            send(player, ControlCodec.encodeWelcome(welcome));
            broadcastRosterIfChanged(true);
        } catch (ProtocolException invalidMessage) {
            sendError(player, invalidMessage.getMessage());
        } catch (RuntimeException error) {
            LOGGER.warn("Voice session setup failed for {}: {}", player.getGameProfile().name(), cleanError(error));
            sendError(player, "The voice session could not be created.");
        }
    }

    private void onDisconnect(ServerPlayer player) {
        if (player == null) return;
        lastHelloAt.remove(player.getUUID());
        if (sessions != null && sessions.removePlayer(player.getUUID())) broadcastRosterIfChanged(true);
    }

    private LiteralArgumentBuilder<CommandSourceStack> statusCommand() {
        return Commands.literal("proximityvoice")
                .requires(source -> source.permissions().hasPermission(Permissions.COMMANDS_ADMIN))
                .executes(context -> showStatus(context.getSource()));
    }

    private int showStatus(CommandSourceStack source) {
        RelayMetrics.Snapshot metrics = engine == null ? new RelayMetrics().snapshot() : engine.metrics().snapshot();
        int port = relay != null && relay.boundPort() > 0
                ? relay.boundPort() : voiceConfig == null ? 0 : voiceConfig.port();
        source.sendSystemMessage(Component.literal("Proximity Voice — " + currentState()));
        source.sendSystemMessage(Component.literal("UDP port: " + port + ", connected clients: "
                + (sessions == null ? 0 : sessions.associatedCount())));
        source.sendSystemMessage(Component.literal("UDP reachability is not automatically verified; expose this port separately from Minecraft TCP."));
        source.sendSystemMessage(Component.literal("Frames: " + metrics.voiceFrames()
                + ", routed deliveries: " + metrics.routedRecipients()));
        return 1;
    }

    private void refreshSnapshots() {
        if (engine == null || server == null) return;
        // Fabric fires SERVER_STARTING before Minecraft constructs PlayerList.
        // The relay may bind during that phase, but player snapshots must wait
        // until the list exists (normally the first server tick).
        var playerList = server.getPlayerList();
        if (playerList == null) {
            engine.setSnapshots(Map.of());
            return;
        }
        Map<UUID, PlayerSnapshot> next = new HashMap<>();
        for (ServerPlayer player : playerList.getPlayers()) {
            if (player.hasDisconnected()) continue;
            next.put(player.getUUID(), new PlayerSnapshot(
                    player.getUUID(),
                    player.level().dimension().identifier().toString(),
                    player.getX(), player.getY(), player.getZ(), true));
        }
        engine.setSnapshots(next);
        broadcastRosterIfChanged(false);
    }

    private void maintainSessionsAndStatus() {
        if (sessions != null && voiceConfig != null &&
                sessions.pruneIdle(System.currentTimeMillis(), voiceConfig.sessionTimeoutMillis()) > 0) {
            broadcastRosterIfChanged(true);
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

    private void sendError(ServerPlayer player, String message) {
        try {
            send(player, ControlCodec.encodeError(message));
        } catch (RuntimeException ignored) {
        }
    }

    private void send(ServerPlayer player, byte[] payload) {
        if (player == null || player.hasDisconnected()) return;
        ServerPlayNetworking.send(player, new VoiceControlPayload(payload));
    }

    private void broadcastRosterIfChanged(boolean force) {
        if (sessions == null || server == null) return;
        var playerList = server.getPlayerList();
        if (playerList == null) return;
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
            LOGGER.warn("Could not encode voice roster: {}", error.getMessage());
            return;
        }
        for (UUID playerId : state.keySet()) {
            ServerPlayer player = playerList.getPlayer(playerId);
            if (player != null && !player.hasDisconnected()) {
                try { send(player, payload); }
                catch (RuntimeException ignored) { }
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
            LOGGER.warn("Could not write voice relay status: {}", cleanError(error));
        }
    }

    private static String cleanError(Throwable error) {
        String message = error == null ? "Unknown error" : error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }
}
