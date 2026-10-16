package dev.serverprotection.fabric.attestation;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.Arrays;

public record FabricAttestationPayload(byte[] data) implements CustomPacketPayload {
    public static final Type<FabricAttestationPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath(
            AttestationProtocol.CHANNEL_NAMESPACE, AttestationProtocol.CHANNEL_PATH));
    public static final StreamCodec<RegistryFriendlyByteBuf, FabricAttestationPayload> CODEC =
            CustomPacketPayload.codec(FabricAttestationPayload::write, FabricAttestationPayload::read);

    public FabricAttestationPayload {
        if (data == null || data.length == 0 || data.length > AttestationProtocol.MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Invalid attestation payload length");
        }
        data = Arrays.copyOf(data, data.length);
    }

    @Override
    public byte[] data() {
        return Arrays.copyOf(data, data.length);
    }

    private void write(RegistryFriendlyByteBuf output) {
        output.writeBytes(data);
    }

    private static FabricAttestationPayload read(RegistryFriendlyByteBuf input) {
        int length = input.readableBytes();
        if (length < 1 || length > AttestationProtocol.MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Invalid attestation payload length");
        }
        byte[] data = new byte[length];
        input.readBytes(data);
        return new FabricAttestationPayload(data);
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
