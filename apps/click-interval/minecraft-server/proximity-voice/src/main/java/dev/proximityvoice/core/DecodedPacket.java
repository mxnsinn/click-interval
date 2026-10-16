package dev.proximityvoice.core;

public record DecodedPacket(
        PacketType type,
        long sessionId,
        long sequence,
        byte[] payload
) {
    public DecodedPacket {
        payload = payload.clone();
    }

    @Override
    public byte[] payload() {
        return payload.clone();
    }
}
