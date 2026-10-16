package dev.proximityvoice.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.proximityvoice.client.audio.AudioEngine;
import dev.proximityvoice.client.audio.SpatialSnapshot;
import dev.proximityvoice.client.config.ClientSettings;
import dev.proximityvoice.client.core.ClientStateMachine;
import dev.proximityvoice.client.core.ConnectionState;
import dev.proximityvoice.client.core.VoiceRoster;
import dev.proximityvoice.client.network.UdpVoiceClient;
import dev.proximityvoice.client.network.VoiceControlPayload;
import dev.proximityvoice.client.protocol.ControlCodec;
import dev.proximityvoice.client.protocol.ProtocolException;
import dev.proximityvoice.client.protocol.VoiceFrame;
import dev.proximityvoice.client.screen.VoiceSettingsScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class ProximityVoiceClient implements ClientModInitializer {
    public static final String MOD_ID = "proximityvoice_client";
    private static final long MONOTONIC_ORIGIN_NANOS = System.nanoTime();
    private static final int MAXIMUM_NEGOTIATION_ATTEMPTS = 4;
    private static final long NEGOTIATION_RESPONSE_TIMEOUT_MILLIS = 8_000L;
    private static final long NEGOTIATION_MAXIMUM_RETRY_MILLIS = 4_000L;
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static volatile ProximityVoiceClient instance;

    private final ClientStateMachine connectionState = new ClientStateMachine();
    private final VoiceRoster roster = new VoiceRoster();
    private final ConcurrentHashMap<UUID, SpatialSnapshot> spatialSnapshots = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, String> playerNames = new ConcurrentHashMap<>();
    private ClientSettings settings;
    private UdpVoiceClient udp;
    private AudioEngine audio;
    private KeyMapping settingsKey;
    private KeyMapping pushToTalkKey;
    private KeyMapping toggleMuteKey;
    private boolean appliedMuted = true;
    private String fallbackVoiceHost = "127.0.0.1";
    private boolean playConnectionActive;
    private volatile long playConnectionEpoch;
    private int negotiationAttempts;
    private long nextNegotiationMillis = -1L;
    private long negotiationDeadlineMillis = -1L;

    @Override
    public void onInitializeClient() {
        instance = this;
        Path settingsFile = FabricLoader.getInstance().getConfigDir().resolve("proximityvoice-client.properties");
        settings = new ClientSettings(settingsFile);
        try {
            settings.load();
        } catch (IOException error) {
            LOGGER.warn("Could not load Proximity Voice settings: {}", error.getMessage());
        }

        udp = new UdpVoiceClient(connectionState, this::handleVoiceFrame,
                this::handleUdpAssociated, this::requestVoiceRenegotiation);
        audio = new AudioEngine(settings, udp::sendVoice,
                () -> connectionState.state() == ConnectionState.CONNECTED && !udp.isMuted(),
                playerId -> spatialSnapshots.getOrDefault(playerId, SpatialSnapshot.unavailable()));

        PayloadTypeRegistry.serverboundPlay().register(VoiceControlPayload.TYPE, VoiceControlPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(VoiceControlPayload.TYPE, VoiceControlPayload.CODEC);
        ClientPlayNetworking.registerGlobalReceiver(VoiceControlPayload.TYPE,
                (payload, context) -> handleControlMessage(payload.data()));

        KeyMapping.Category category = KeyMapping.Category.register(
                Identifier.fromNamespaceAndPath(MOD_ID, "voice"));
        settingsKey = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                "key.proximityvoice_client.settings", InputConstants.Type.KEYSYM, InputConstants.KEY_V, category));
        pushToTalkKey = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                "key.proximityvoice_client.push_to_talk", InputConstants.Type.KEYSYM, InputConstants.KEY_G, category));
        toggleMuteKey = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                "key.proximityvoice_client.toggle_mute", InputConstants.Type.KEYSYM, InputConstants.KEY_M, category));

        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> onJoin(handler.getConnection().getRemoteAddress()));
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> onDisconnect());
        ClientTickEvents.END_CLIENT_TICK.register(this::onClientTick);
    }

    private void onJoin(SocketAddress remoteAddress) {
        onDisconnect();
        playConnectionActive = true;
        fallbackVoiceHost = remoteAddress instanceof InetSocketAddress inet
                ? inet.getHostString() : "127.0.0.1";
        connectionState.beginNegotiation();
        negotiationAttempts = 0;
        nextNegotiationMillis = monotonicMillis();
        negotiationDeadlineMillis = -1L;
        serviceVoiceNegotiation();
    }

    private void handleControlMessage(byte[] bytes) {
        try {
            ControlCodec.ControlMessage message = ControlCodec.decodeServerMessage(bytes);
            switch (message) {
                case ControlCodec.Welcome welcome -> {
                    nextNegotiationMillis = -1L;
                    negotiationDeadlineMillis = -1L;
                    audio.setVoiceRadius(welcome.voiceRadius());
                    udp.connect(welcome, fallbackVoiceHost);
                }
                case ControlCodec.ErrorMessage error -> {
                    nextNegotiationMillis = -1L;
                    negotiationDeadlineMillis = -1L;
                    connectionState.fail(error.message());
                }
                case ControlCodec.Roster update -> roster.apply(update);
            }
        } catch (ProtocolException | RuntimeException error) {
            connectionState.fail("Invalid server voice response");
            LOGGER.warn("Rejected Proximity Voice control payload: {}", error.getMessage());
        }
    }

    private void handleUdpAssociated() {
        long expectedEpoch = playConnectionEpoch;
        Minecraft.getInstance().execute(() -> {
            if (!playConnectionActive || playConnectionEpoch != expectedEpoch
                    || connectionState.state() != ConnectionState.CONNECTED) return;
            negotiationAttempts = 0;
            nextNegotiationMillis = -1L;
            negotiationDeadlineMillis = -1L;
            audio.start();
            applyMicrophoneState();
        });
    }

    private void requestVoiceRenegotiation() {
        long expectedEpoch = playConnectionEpoch;
        Minecraft.getInstance().execute(() -> {
            if (!playConnectionActive || playConnectionEpoch != expectedEpoch) return;
            audio.clearRemoteAudio();
            if (negotiationAttempts >= MAXIMUM_NEGOTIATION_ATTEMPTS) {
                nextNegotiationMillis = -1L;
                negotiationDeadlineMillis = -1L;
                connectionState.fail("Voice relay did not answer after several secure retries");
                return;
            }
            connectionState.beginNegotiation();
            negotiationDeadlineMillis = -1L;
            nextNegotiationMillis = monotonicMillis() + negotiationRetryDelay(negotiationAttempts);
        });
    }

    private void handleVoiceFrame(VoiceFrame frame) {
        long now = System.currentTimeMillis();
        roster.markSpeaking(frame.sourcePlayerId(), now);
        audio.acceptVoice(frame.sourcePlayerId(), frame.opusFrame());
    }

    private void onClientTick(Minecraft client) {
        serviceVoiceNegotiation();
        while (settingsKey.consumeClick()) {
            Screen parent = client.gui.screen();
            client.gui.setScreen(new VoiceSettingsScreen(parent, this));
        }
        while (toggleMuteKey.consumeClick()) {
            settings.setToggleMuted(!settings.toggleMuted());
            saveSettings();
        }
        updateSpatialSnapshots(client);
        applyMicrophoneState();
    }

    private void applyMicrophoneState() {
        boolean muted = switch (settings.microphoneMode()) {
            case HOLD_TO_SPEAK -> settings.toggleMuted() || !pushToTalkKey.isDown();
            case TOGGLE -> settings.toggleMuted();
        };
        if (muted != appliedMuted || udp.isMuted() != muted) {
            appliedMuted = muted;
            udp.setMuted(muted);
        }
    }

    private void updateSpatialSnapshots(Minecraft client) {
        if (client.player == null || client.level == null) {
            spatialSnapshots.clear();
            playerNames.clear();
            return;
        }
        Vec3 listener = client.player.position();
        float yaw = client.player.getYRot();
        java.util.HashSet<UUID> visible = new java.util.HashSet<>();
        for (AbstractClientPlayer player : client.level.players()) {
            UUID id = player.getUUID();
            visible.add(id);
            playerNames.put(id, player.getGameProfile().name());
            Vec3 source = player.position();
            spatialSnapshots.put(id, new SpatialSnapshot(
                    listener.x, listener.y, listener.z, yaw,
                    source.x, source.y, source.z, true));
        }
        spatialSnapshots.keySet().removeIf(id -> !visible.contains(id));
        playerNames.keySet().removeIf(id -> !visible.contains(id));
    }

    private void onDisconnect() {
        playConnectionActive = false;
        playConnectionEpoch++;
        negotiationAttempts = 0;
        nextNegotiationMillis = -1L;
        negotiationDeadlineMillis = -1L;
        if (udp != null) udp.close();
        if (audio != null) audio.close();
        roster.clear();
        spatialSnapshots.clear();
        playerNames.clear();
        appliedMuted = true;
    }

    private void serviceVoiceNegotiation() {
        if (!playConnectionActive || connectionState.state() != ConnectionState.NEGOTIATING) return;
        long now = monotonicMillis();
        if (negotiationDeadlineMillis >= 0L && now >= negotiationDeadlineMillis) {
            negotiationDeadlineMillis = -1L;
            if (negotiationAttempts >= MAXIMUM_NEGOTIATION_ATTEMPTS) {
                connectionState.fail("The server voice handshake timed out");
                return;
            }
            nextNegotiationMillis = now + negotiationRetryDelay(negotiationAttempts);
        }
        if (nextNegotiationMillis < 0L || now < nextNegotiationMillis) return;
        if (negotiationAttempts >= MAXIMUM_NEGOTIATION_ATTEMPTS) {
            connectionState.fail("The server voice handshake timed out");
            nextNegotiationMillis = -1L;
            return;
        }
        if (!ClientPlayNetworking.canSend(VoiceControlPayload.TYPE)) {
            connectionState.fail("This server does not provide Proximity Voice");
            nextNegotiationMillis = -1L;
            return;
        }
        ClientPlayNetworking.send(new VoiceControlPayload(ControlCodec.encodeClientHello(0x07)));
        negotiationAttempts++;
        nextNegotiationMillis = -1L;
        negotiationDeadlineMillis = now + NEGOTIATION_RESPONSE_TIMEOUT_MILLIS;
    }

    private static long negotiationRetryDelay(int completedAttempts) {
        int shift = Math.min(2, Math.max(0, completedAttempts - 1));
        return Math.min(NEGOTIATION_MAXIMUM_RETRY_MILLIS, 1_000L << shift);
    }

    private static long monotonicMillis() {
        return java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(
                System.nanoTime() - MONOTONIC_ORIGIN_NANOS);
    }

    public static ProximityVoiceClient getInstance() {
        return instance;
    }

    public ClientSettings settings() { return settings; }
    public AudioEngine audio() { return audio; }
    public ConnectionState connectionState() { return connectionState.state(); }
    public String connectionDetail() { return connectionState.detail(); }
    public double voiceRadius() { return audio.voiceRadius(); }
    public boolean isLocallyMuted() { return udp == null || udp.isMuted(); }

    public VoiceRoster.Status playerVoiceStatus(UUID playerId) {
        if (playerId == null) return VoiceRoster.Status.DISCONNECTED;
        Minecraft client = Minecraft.getInstance();
        if (client.player != null && playerId.equals(client.player.getUUID())) {
            if (connectionState() != ConnectionState.CONNECTED) return VoiceRoster.Status.DISCONNECTED;
            if (isLocallyMuted()) return VoiceRoster.Status.MUTED;
        }
        return roster.status(playerId, System.currentTimeMillis());
    }

    public List<PlayerView> visiblePlayers() {
        List<PlayerView> result = new ArrayList<>();
        playerNames.forEach((id, name) -> result.add(new PlayerView(id, name)));
        result.sort(Comparator.comparing(PlayerView::name, String.CASE_INSENSITIVE_ORDER));
        return List.copyOf(result);
    }

    public void settingsChanged(boolean restartAudioDevices) {
        saveSettings();
        if (restartAudioDevices && audio != null) audio.restartDevices();
        applyMicrophoneState();
    }

    private void saveSettings() {
        try {
            settings.save();
        } catch (IOException error) {
            LOGGER.warn("Could not save Proximity Voice settings: {}", error.getMessage());
        }
    }

    public record PlayerView(UUID id, String name) {}
}
