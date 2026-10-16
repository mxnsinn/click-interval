package dev.serverprotection.client;

import dev.serverprotection.fabric.attestation.AttestationProtocol;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.Arrays;

public record AttestationPayload(byte[] data) implements CustomPacketPayload {
    public static final Type<AttestationPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath(
            AttestationProtocol.CHANNEL_NAMESPACE, AttestationProtocol.CHANNEL_PATH));
    public static final StreamCodec<RegistryFriendlyByteBuf, AttestationPayload> CODEC =
            CustomPacketPayload.codec(AttestationPayload::write, AttestationPayload::read);

    public AttestationPayload {
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

    private static AttestationPayload read(RegistryFriendlyByteBuf input) {
        int length = input.readableBytes();
        if (length < 1 || length > AttestationProtocol.MAX_PAYLOAD_BYTES) {
            throw new IllegalArgumentException("Invalid attestation payload length");
        }
        byte[] data = new byte[length];
        input.readBytes(data);
        return new AttestationPayload(data);
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
