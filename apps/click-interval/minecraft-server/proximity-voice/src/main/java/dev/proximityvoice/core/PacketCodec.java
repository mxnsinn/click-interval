package dev.proximityvoice.core;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.GeneralSecurityException;

public final class PacketCodec {
    private static final int RESERVED_FLAGS = 0;

    public byte[] encode(
            PacketType type,
            long sessionId,
            long sequence,
            byte[] payload,
            byte[] key,
            Direction direction
    ) throws ProtocolException {
        validateHeader(type, sessionId, sequence);
        validateKey(key);
        if (payload == null || payload.length > Protocol.MAX_PLAINTEXT_BYTES) {
            throw new ProtocolException("Packet payload is too large.");
        }
        byte[] header = encodeHeader(type, sessionId, sequence);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(128, nonce(direction, sequence)));
            cipher.updateAAD(header);
            byte[] ciphertext = cipher.doFinal(payload);
            ByteBuffer datagram = ByteBuffer.allocate(header.length + ciphertext.length);
            datagram.put(header).put(ciphertext);
            return datagram.array();
        } catch (GeneralSecurityException error) {
            throw new ProtocolException("Could not encrypt packet.", error);
        }
    }

    public PacketEnvelope readEnvelope(byte[] datagram) throws ProtocolException {
        if (datagram == null || datagram.length < Protocol.HEADER_BYTES + Protocol.AUTH_TAG_BYTES
                || datagram.length > Protocol.MAX_DATAGRAM_BYTES) {
            throw new ProtocolException("Invalid datagram length.");
        }
        ByteBuffer input = ByteBuffer.wrap(datagram).order(ByteOrder.BIG_ENDIAN);
        int magic = input.getInt();
        int version = Byte.toUnsignedInt(input.get());
        PacketType type = PacketType.fromId(Byte.toUnsignedInt(input.get()));
        int flags = Short.toUnsignedInt(input.getShort());
        long sessionId = input.getLong();
        long sequence = input.getLong();
        if (magic != Protocol.MAGIC) throw new ProtocolException("Invalid packet magic.");
        if (version != Protocol.VERSION) throw new ProtocolException("Unsupported protocol version.");
        if (flags != RESERVED_FLAGS) throw new ProtocolException("Unsupported packet flags.");
        validateHeader(type, sessionId, sequence);
        byte[] ciphertext = new byte[input.remaining()];
        input.get(ciphertext);
        return new PacketEnvelope(type, sessionId, sequence, ciphertext);
    }

    public DecodedPacket decode(PacketEnvelope envelope, byte[] key, Direction direction)
            throws ProtocolException {
        if (envelope == null) throw new ProtocolException("Packet envelope is required.");
        validateKey(key);
        byte[] header = encodeHeader(envelope.type(), envelope.sessionId(), envelope.sequence());
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(128, nonce(direction, envelope.sequence())));
            cipher.updateAAD(header);
            byte[] payload = cipher.doFinal(envelope.ciphertext());
            if (payload.length > Protocol.MAX_PLAINTEXT_BYTES) {
                throw new ProtocolException("Decrypted payload is too large.");
            }
            return new DecodedPacket(envelope.type(), envelope.sessionId(), envelope.sequence(), payload);
        } catch (AEADBadTagException error) {
            throw new ProtocolException("Packet authentication failed.");
        } catch (GeneralSecurityException error) {
            throw new ProtocolException("Could not decrypt packet.", error);
        }
    }

    private static byte[] encodeHeader(PacketType type, long sessionId, long sequence)
            throws ProtocolException {
        validateHeader(type, sessionId, sequence);
        return ByteBuffer.allocate(Protocol.HEADER_BYTES).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.MAGIC)
                .put((byte) Protocol.VERSION)
                .put((byte) type.id())
                .putShort((short) RESERVED_FLAGS)
                .putLong(sessionId)
                .putLong(sequence)
                .array();
    }

    private static byte[] nonce(Direction direction, long sequence) throws ProtocolException {
        if (direction == null) throw new ProtocolException("Packet direction is required.");
        return ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN)
                .putInt(direction.nonceMarker())
                .putLong(sequence)
                .array();
    }

    private static void validateHeader(PacketType type, long sessionId, long sequence)
            throws ProtocolException {
        if (type == null) throw new ProtocolException("Packet type is required.");
        if (sessionId == 0L) throw new ProtocolException("Session id cannot be zero.");
        if (sequence <= 0L) throw new ProtocolException("Sequence must be positive.");
    }

    private static void validateKey(byte[] key) throws ProtocolException {
        if (key == null || key.length != Protocol.KEY_BYTES) {
            throw new ProtocolException("A 256-bit session key is required.");
        }
    }
}
