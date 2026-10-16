package dev.proximityvoice.client.protocol;

public enum PacketType {
    ASSOCIATE(1),
    KEEPALIVE(2),
    VOICE(3),
    STATE(4),
    PING(5),
    ACK(6),
    ERROR(7);

    private final int id;

    PacketType(int id) {
        this.id = id;
    }

    public int id() {
        return id;
    }

    public static PacketType fromId(int id) throws ProtocolException {
        for (PacketType type : values()) {
            if (type.id == id) return type;
        }
        throw new ProtocolException("Unknown packet type.");
    }
}
