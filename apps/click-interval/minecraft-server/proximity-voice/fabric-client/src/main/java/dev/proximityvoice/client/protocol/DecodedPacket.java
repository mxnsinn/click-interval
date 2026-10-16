package dev.proximityvoice.client.protocol;

public record DecodedPacket(PacketType type, long sessionId, long sequence, byte[] payload) {
    public DecodedPacket {
        payload = payload == null ? new byte[0] : payload.clone();
    }

    @Override
    public byte[] payload() {
        return payload.clone();
    }
}
