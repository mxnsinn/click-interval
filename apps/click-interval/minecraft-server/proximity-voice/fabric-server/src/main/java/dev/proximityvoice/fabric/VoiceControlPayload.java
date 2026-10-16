package dev.proximityvoice.fabric;

import dev.proximityvoice.core.Protocol;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

import java.util.Arrays;

public record VoiceControlPayload(byte[] data) implements CustomPacketPayload {
    public static final Type<VoiceControlPayload> TYPE = new Type<>(
            Identifier.fromNamespaceAndPath("proximityvoice", "control"));
    public static final StreamCodec<RegistryFriendlyByteBuf, VoiceControlPayload> CODEC =
            CustomPacketPayload.codec(VoiceControlPayload::write, VoiceControlPayload::read);

    public VoiceControlPayload {
        if (data == null || data.length == 0 || data.length > Protocol.MAX_CONTROL_MESSAGE_BYTES) {
            throw new IllegalArgumentException("Invalid voice control payload length");
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

    private static VoiceControlPayload read(RegistryFriendlyByteBuf input) {
        int length = input.readableBytes();
        if (length < 1 || length > Protocol.MAX_CONTROL_MESSAGE_BYTES) {
            throw new IllegalArgumentException("Invalid voice control payload length");
        }
        byte[] data = new byte[length];
        input.readBytes(data);
        return new VoiceControlPayload(data);
    }

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
