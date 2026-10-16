package dev.proximityvoice.client.protocol;

import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ProtocolCompatibilityTest {
    @Test
    void encryptedPacketRoundTripsInBothDirections() throws Exception {
        PacketCodec codec = new PacketCodec();
        byte[] key = new byte[Protocol.KEY_BYTES];
        for (int index = 0; index < key.length; index++) key[index] = (byte) (index * 7);
        byte[] encoded = codec.encode(PacketType.VOICE, 42L, 9L, new byte[]{1, 2, 3},
                key, Direction.CLIENT_TO_SERVER);
        PacketEnvelope envelope = codec.readEnvelope(encoded);
        DecodedPacket decoded = codec.decode(envelope, key, Direction.CLIENT_TO_SERVER);
        assertEquals(PacketType.VOICE, decoded.type());
        assertArrayEquals(new byte[]{1, 2, 3}, decoded.payload());
        assertThrows(ProtocolException.class,
                () -> codec.decode(envelope, key, Direction.SERVER_TO_CLIENT));
    }

    @Test
    void decodesExactRosterWireSchema() throws Exception {
        UUID id = UUID.randomUUID();
        byte[] wire = ByteBuffer.allocate(6 + 8 + 2 + 17).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION).put((byte) ControlCodec.ROSTER)
                .putLong(17L).putShort((short) 1)
                .putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).put((byte) 0x03)
                .array();
        ControlCodec.Roster roster = assertInstanceOf(ControlCodec.Roster.class,
                ControlCodec.decodeServerMessage(wire));
        assertEquals(17L, roster.revision());
        assertTrue(roster.players().get(id).connected());
        assertTrue(roster.players().get(id).muted());
    }

    @Test
    void rejectsUnknownRosterFlags() {
        UUID id = UUID.randomUUID();
        byte[] wire = ByteBuffer.allocate(6 + 8 + 2 + 17).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION).put((byte) ControlCodec.ROSTER)
                .putLong(1L).putShort((short) 1)
                .putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).put((byte) 0x04)
                .array();
        assertThrows(ProtocolException.class, () -> ControlCodec.decodeServerMessage(wire));
    }
}
