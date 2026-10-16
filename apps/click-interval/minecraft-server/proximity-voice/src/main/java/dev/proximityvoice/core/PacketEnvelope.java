package dev.proximityvoice.core;

public record PacketEnvelope(
        PacketType type,
        long sessionId,
        long sequence,
        byte[] ciphertext
) {
    public PacketEnvelope {
        ciphertext = ciphertext.clone();
    }

    @Override
    public byte[] ciphertext() {
        return ciphertext.clone();
    }
}
