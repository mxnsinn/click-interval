package dev.proximityvoice.client.protocol;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

public final class ControlCodec {
    public static final int HELLO = 1;
    public static final int WELCOME = 2;
    public static final int ERROR = 3;
    public static final int ROSTER = 4;

    private ControlCodec() {}

    public static byte[] encodeClientHello(int capabilities) {
        return ByteBuffer.allocate(10).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION)
                .put((byte) HELLO).putInt(capabilities).array();
    }

    public static ControlMessage decodeServerMessage(byte[] message) throws ProtocolException {
        if (message == null || message.length < 6 || message.length > Protocol.MAX_CONTROL_BYTES) {
            throw new ProtocolException("Invalid control message length.");
        }
        ByteBuffer input = ByteBuffer.wrap(message).order(ByteOrder.BIG_ENDIAN);
        if (input.getInt() != Protocol.CONTROL_MAGIC) throw new ProtocolException("Invalid control magic.");
        if (Byte.toUnsignedInt(input.get()) != Protocol.VERSION) {
            throw new ProtocolException("Unsupported control protocol version.");
        }
        int type = Byte.toUnsignedInt(input.get());
        return switch (type) {
            case WELCOME -> decodeWelcomeBody(input);
            case ERROR -> decodeErrorBody(input);
            case ROSTER -> decodeRosterBody(input);
            default -> throw new ProtocolException("Unexpected control message.");
        };
    }

    private static Welcome decodeWelcomeBody(ByteBuffer input) throws ProtocolException {
        int minimum = 8 + 4 + 8 + 1 + Protocol.CHALLENGE_BYTES + Protocol.KEY_BYTES;
        if (input.remaining() < minimum) throw new ProtocolException("Invalid welcome message.");
        long sessionId = input.getLong();
        int port = input.getInt();
        double voiceRadius = input.getDouble();
        int hostLength = Byte.toUnsignedInt(input.get());
        if (sessionId == 0 || port < 1 || port > 65535 || !Double.isFinite(voiceRadius)
                || voiceRadius <= 0 || voiceRadius > 512 || hostLength > 253
                || input.remaining() != hostLength + Protocol.CHALLENGE_BYTES + Protocol.KEY_BYTES) {
            throw new ProtocolException("Invalid welcome fields.");
        }
        byte[] host = new byte[hostLength];
        byte[] challenge = new byte[Protocol.CHALLENGE_BYTES];
        byte[] key = new byte[Protocol.KEY_BYTES];
        input.get(host).get(challenge).get(key);
        String decodedHost = new String(host, StandardCharsets.UTF_8);
        if (decodedHost.chars().anyMatch(c -> c < 0x21 || c > 0x7e)) {
            throw new ProtocolException("Invalid voice host.");
        }
        return new Welcome(sessionId, key, challenge, port, voiceRadius, decodedHost);
    }

    private static ErrorMessage decodeErrorBody(ByteBuffer input) throws ProtocolException {
        if (!input.hasRemaining()) throw new ProtocolException("Invalid error message.");
        int length = Byte.toUnsignedInt(input.get());
        if (length > 240 || input.remaining() != length) throw new ProtocolException("Invalid error text.");
        byte[] text = new byte[length];
        input.get(text);
        return new ErrorMessage(new String(text, StandardCharsets.UTF_8));
    }

    private static Roster decodeRosterBody(ByteBuffer input) throws ProtocolException {
        if (input.remaining() < 10) throw new ProtocolException("Invalid voice roster.");
        long revision = input.getLong();
        int count = Short.toUnsignedInt(input.getShort());
        if (count > 1_024 || input.remaining() != count * 17) {
            throw new ProtocolException("Invalid voice roster size.");
        }
        java.util.Map<java.util.UUID, RosterState> states = new java.util.LinkedHashMap<>();
        for (int index = 0; index < count; index++) {
            java.util.UUID playerId = new java.util.UUID(input.getLong(), input.getLong());
            int flags = Byte.toUnsignedInt(input.get());
            if ((flags & ~0x03) != 0) throw new ProtocolException("Invalid voice roster flags.");
            states.put(playerId, new RosterState((flags & 0x01) != 0, (flags & 0x02) != 0));
        }
        return new Roster(revision, java.util.Map.copyOf(states));
    }

    public sealed interface ControlMessage permits Welcome, ErrorMessage, Roster {}

    public record Welcome(long sessionId, byte[] key, byte[] challenge, int port,
                          double voiceRadius, String publicHost) implements ControlMessage {
        public Welcome {
            key = key == null ? null : key.clone();
            challenge = challenge == null ? null : challenge.clone();
            publicHost = String.valueOf(publicHost == null ? "" : publicHost);
        }

        @Override public byte[] key() { return key == null ? null : key.clone(); }
        @Override public byte[] challenge() { return challenge == null ? null : challenge.clone(); }
    }

    public record ErrorMessage(String message) implements ControlMessage {}

    public record Roster(long revision, java.util.Map<java.util.UUID, RosterState> players)
            implements ControlMessage {
        public Roster {
            players = players == null ? java.util.Map.of() : java.util.Map.copyOf(players);
        }
    }

    public record RosterState(boolean connected, boolean muted) {}
}
