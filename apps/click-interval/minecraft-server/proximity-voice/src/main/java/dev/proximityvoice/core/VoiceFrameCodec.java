package dev.proximityvoice.core;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;

public final class VoiceFrameCodec {
    private VoiceFrameCodec() {}

    public static byte[] encode(UUID sourcePlayerId, byte[] opusFrame) throws ProtocolException {
        if (sourcePlayerId == null) throw new ProtocolException("Voice source is required.");
        if (opusFrame == null || opusFrame.length == 0 || opusFrame.length > Protocol.MAX_OPUS_FRAME_BYTES) {
            throw new ProtocolException("Invalid Opus frame length.");
        }
        return ByteBuffer.allocate(16 + opusFrame.length).order(ByteOrder.BIG_ENDIAN)
                .putLong(sourcePlayerId.getMostSignificantBits())
                .putLong(sourcePlayerId.getLeastSignificantBits())
                .put(opusFrame)
                .array();
    }

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
