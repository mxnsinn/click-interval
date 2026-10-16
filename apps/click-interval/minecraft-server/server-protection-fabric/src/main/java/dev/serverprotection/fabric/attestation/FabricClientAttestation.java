package dev.serverprotection.fabric.attestation;

import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Objects;

/** Thin Fabric-network adapter around the bounded, server-thread-only attestation state. */
public final class FabricClientAttestation {
    private final ClientAttestationSessions sessions = new ClientAttestationSessions();
    private final Logger logger;
    private final OutcomeHandler handler;
    private ClientModPolicy policy = ClientModPolicy.disabled();

    public FabricClientAttestation(Logger logger, OutcomeHandler handler) {
        this.logger = Objects.requireNonNull(logger, "logger");
        this.handler = Objects.requireNonNull(handler, "handler");
    }

    /** Must be called once during mod initialization, before play connections are accepted. */
    public void registerPayload() {
        PayloadTypeRegistry.serverboundPlay().register(FabricAttestationPayload.TYPE, FabricAttestationPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(FabricAttestationPayload.TYPE, FabricAttestationPayload.CODEC);
        ServerPlayNetworking.registerGlobalReceiver(FabricAttestationPayload.TYPE,
                (payload, context) -> receive(context.player(), payload.data()));
    }

    public void load(Path configFile) {
        sessions.clear();
        try {
            policy = FabricModPolicyConfig.load(configFile);
        } catch (IOException | RuntimeException error) {
            policy = ClientModPolicy.disabled();
            logger.error("Client mod policy could not be loaded and is disabled: {}", error.getMessage());
        }
    }

    public void clear() {
        sessions.clear();
        policy = ClientModPolicy.disabled();
    }

    public void onJoin(ServerPlayer player, long nowMillis) {
        if (player == null || !policy.enabled()) return;
        boolean available = ServerPlayNetworking.canSend(player, FabricAttestationPayload.TYPE);
        ClientAttestationSessions.ChallengeRequest challenge = sessions.begin(
                player.getUUID(), available, policy, nowMillis);
        if (challenge == null) {
            logger.info("Client mod report for {} is unavailable; this means unverified, not cheating.",
                    player.getGameProfile().name());
            return;
        }
        try {
            ServerPlayNetworking.send(player, new FabricAttestationPayload(challenge.payload()));
        } catch (RuntimeException error) {
            logger.warn("Could not send client mod report challenge to {}: {}",
                    player.getGameProfile().name(), error.getMessage());
        }
    }

    public void onDisconnect(ServerPlayer player) {
        if (player != null) sessions.remove(player.getUUID());
    }

    /** Call at a low fixed cadence (for example, once per second), not every packet. */
    public void tick(long nowMillis) {
        for (ClientAttestationSessions.Outcome outcome : sessions.expire(policy, nowMillis)) {
            handler.handle(outcome);
        }
    }

    public ClientAttestationSessions.Snapshot status(ServerPlayer player) {
        return sessions.status(player == null ? null : player.getUUID());
    }

    public ClientModPolicy policy() {
        return policy;
    }

    private void receive(ServerPlayer player, byte[] payload) {
        if (player == null) return;
        ClientAttestationSessions.Outcome outcome = sessions.receive(
                player.getUUID(), payload, policy, System.currentTimeMillis());
        if (outcome == null) return;
        if (!outcome.error().isEmpty()) {
            logger.warn("Invalid client mod report from {}{}: {}",
                    player.getGameProfile().name(),
                    outcome.terminal() ? "; retry limit reached" : "",
                    outcome.error());
        }
        if (outcome.terminal()) handler.handle(outcome);
    }

    @FunctionalInterface
    public interface OutcomeHandler {
        void handle(ClientAttestationSessions.Outcome outcome);
    }
}
