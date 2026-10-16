package dev.proximityvoice.core;

import java.util.UUID;

public record VoiceFrame(UUID sourcePlayerId, byte[] opusFrame) {
    public VoiceFrame {
        if (sourcePlayerId == null) throw new IllegalArgumentException("sourcePlayerId is required");
        if (opusFrame == null || opusFrame.length == 0 || opusFrame.length > Protocol.MAX_OPUS_FRAME_BYTES) {
            throw new IllegalArgumentException("invalid Opus frame length");
        }
        opusFrame = opusFrame.clone();
    }

    @Override
    public byte[] opusFrame() {
        return opusFrame.clone();
    }
}
