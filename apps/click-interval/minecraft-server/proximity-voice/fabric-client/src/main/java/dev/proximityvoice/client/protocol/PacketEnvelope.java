package dev.proximityvoice.client.protocol;

public record PacketEnvelope(PacketType type, long sessionId, long sequence, byte[] ciphertext) {
    public PacketEnvelope {
        ciphertext = ciphertext == null ? new byte[0] : ciphertext.clone();
    }

    @Override
    public byte[] ciphertext() {
        return ciphertext.clone();
    }
}
