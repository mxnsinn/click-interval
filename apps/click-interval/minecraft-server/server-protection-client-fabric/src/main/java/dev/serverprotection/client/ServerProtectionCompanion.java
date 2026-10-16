package dev.serverprotection.client;

import dev.serverprotection.fabric.attestation.AttestationProtocol;
import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Optional client-controlled mod report. It is useful policy input, never proof of a clean client. */
public final class ServerProtectionCompanion implements ClientModInitializer {
    public static final String MOD_ID = "serverprotection_companion";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final PlayerViewClientSession PLAYER_VIEW = new PlayerViewClientSession(LOGGER);

    private List<AttestationProtocol.ModEntry> installedMods = List.of();
    private String companionVersion = "unknown";

    @Override
    public void onInitializeClient() {
        companionVersion = FabricLoader.getInstance().getModContainer(MOD_ID)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
        installedMods = snapshotInstalledMods();
        PayloadTypeRegistry.serverboundPlay().register(AttestationPayload.TYPE, AttestationPayload.CODEC);
        PayloadTypeRegistry.serverboundPlay().register(PlayerViewReadyPayload.TYPE, PlayerViewReadyPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(AttestationPayload.TYPE, AttestationPayload.CODEC);
        PayloadTypeRegistry.clientboundPlay().register(PlayerViewPayload.LEGACY_TYPE, PlayerViewPayload.LEGACY_CODEC);
        PayloadTypeRegistry.clientboundPlay().register(PlayerViewPayload.TYPE, PlayerViewPayload.CODEC);
        ClientPlayNetworking.registerGlobalReceiver(AttestationPayload.TYPE,
                (payload, context) -> context.client().execute(() -> respond(payload.data())));
        ClientPlayNetworking.registerGlobalReceiver(PlayerViewPayload.LEGACY_TYPE,
                (payload, context) -> context.client().execute(() -> PLAYER_VIEW.accept(payload, context.client())));
        ClientPlayNetworking.registerGlobalReceiver(PlayerViewPayload.TYPE,
                (payload, context) -> context.client().execute(() -> PLAYER_VIEW.accept(payload, context.client())));
        ClientTickEvents.START_CLIENT_TICK.register(PLAYER_VIEW::beforeClientTick);
        ClientTickEvents.END_CLIENT_TICK.register(PLAYER_VIEW::afterClientTick);
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            if (ClientPlayNetworking.canSend(PlayerViewReadyPayload.TYPE)) {
                ClientPlayNetworking.send(PlayerViewReadyPayload.current());
            }
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> PLAYER_VIEW.disconnected(client));
        MentionContextClient.register();
        SelfNameTagClient.register();
        LOGGER.info("Server Protection Companion ready with {} Fabric mod descriptor(s). Reports are advisory.",
                installedMods.size());
    }

    /** Used only by the hand-skin mixin while an authorized player-view session is active. */
    public static AbstractClientPlayer viewedPlayerForRender() {
        return PLAYER_VIEW.viewedPlayer(Minecraft.getInstance());
    }

    private void respond(byte[] payload) {
        try {
            AttestationProtocol.Challenge challenge = AttestationProtocol.decodeChallenge(payload);
            if (!ClientPlayNetworking.canSend(AttestationPayload.TYPE)) return;
            byte[] response = AttestationProtocol.encodeReport(
                    challenge.nonce(), companionVersion, installedMods);
            ClientPlayNetworking.send(new AttestationPayload(response));
        } catch (IllegalArgumentException invalid) {
            LOGGER.warn("Ignored an invalid Server Protection challenge: {}", invalid.getMessage());
        } catch (RuntimeException error) {
            LOGGER.warn("Could not send the advisory Server Protection mod report: {}", error.getMessage());
        }
    }

    private static List<AttestationProtocol.ModEntry> snapshotInstalledMods() {
        ArrayList<AttestationProtocol.ModEntry> result = new ArrayList<>();
        for (ModContainer container : FabricLoader.getInstance().getAllMods()) {
            String id = AttestationProtocol.normalizeModId(container.getMetadata().getId());
            if (id == null) continue;
            String version = container.getMetadata().getVersion().getFriendlyString();
            result.add(new AttestationProtocol.ModEntry(id, version));
        }
        result.sort(Comparator.comparing(AttestationProtocol.ModEntry::id));
        return List.copyOf(result);
    }
}
