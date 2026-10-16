package dev.proximityvoice.client.protocol;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;

public record VoiceFrame(UUID sourcePlayerId, byte[] opusFrame) {
    public VoiceFrame {
        opusFrame = opusFrame == null ? new byte[0] : opusFrame.clone();
    }

    @Override public byte[] opusFrame() { return opusFrame.clone(); }

    public static VoiceFrame decode(byte[] payload) throws ProtocolException {
        if (payload == null || payload.length <= 16 || payload.length > Protocol.MAX_PLAINTEXT_BYTES) {
            throw new ProtocolException("Invalid routed voice frame.");
        }
        ByteBuffer input = ByteBuffer.wrap(payload).order(ByteOrder.BIG_ENDIAN);
        UUID source = new UUID(input.getLong(), input.getLong());
        byte[] frame = new byte[input.remaining()];
        input.get(frame);
        return new VoiceFrame(source, frame);
    }
}
