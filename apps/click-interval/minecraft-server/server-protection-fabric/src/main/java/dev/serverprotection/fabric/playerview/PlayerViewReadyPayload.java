package dev.serverprotection.fabric.playerview;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * Client-to-server protocol negotiation for player view.
 *
 * <p>The client sends this only when the server advertises the channel. That keeps the v2 companion
 * compatible with a currently running v1 server while allowing an upgraded server to reject an old
 * companion before sending a payload that the old decoder cannot understand.</p>
 */
public record PlayerViewReadyPayload(int minimumProtocol, int maximumProtocol)
        implements CustomPacketPayload {
    private static final int MAX_REASONABLE_PROTOCOL = 1_000;

    public static final Type<PlayerViewReadyPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath(
            "serverprotection", "player_view_ready"));
    public static final StreamCodec<RegistryFriendlyByteBuf, PlayerViewReadyPayload> CODEC =
            CustomPacketPayload.codec(PlayerViewReadyPayload::write, PlayerViewReadyPayload::read);

    public PlayerViewReadyPayload {
        if (minimumProtocol < 1 || maximumProtocol < minimumProtocol
                || maximumProtocol > MAX_REASONABLE_PROTOCOL) {
            throw new IllegalArgumentException("Invalid player-view protocol range");
        }
    }

    public static PlayerViewReadyPayload current() {
        return new PlayerViewReadyPayload(
                PlayerViewPayload.LEGACY_PROTOCOL_VERSION,
                PlayerViewPayload.PROTOCOL_VERSION);
    }

    public boolean supports(int protocolVersion) {
        return protocolVersion >= minimumProtocol && protocolVersion <= maximumProtocol;
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }

    private void write(RegistryFriendlyByteBuf output) {
        output.writeVarInt(minimumProtocol);
        output.writeVarInt(maximumProtocol);
    }

    private static PlayerViewReadyPayload read(RegistryFriendlyByteBuf input) {
        PlayerViewReadyPayload result = new PlayerViewReadyPayload(input.readVarInt(), input.readVarInt());
        if (input.isReadable()) throw new IllegalArgumentException("Trailing player-view readiness bytes");
        return result;
    }
}
