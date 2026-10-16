package dev.proximityvoice.core;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public final class ControlCodec {
    public static final int HELLO = 1;
    public static final int WELCOME = 2;
    public static final int ERROR = 3;
    public static final int ROSTER = 4;
    public static final int ROSTER_FLAG_CONNECTED = 1;
    public static final int ROSTER_FLAG_MUTED = 1 << 1;

    private ControlCodec() {}

    public static byte[] encodeClientHello(int capabilities) {
        return ByteBuffer.allocate(10).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.CONTROL_MAGIC)
                .put((byte) Protocol.VERSION)
                .put((byte) HELLO)
                .putInt(capabilities)
                .array();
    }

    public static ClientHello decodeClientHello(byte[] message) throws ProtocolException {
        ByteBuffer input = controlHeader(message, HELLO, 10);
        int capabilities = input.getInt();
        if (input.hasRemaining()) throw new ProtocolException("Unexpected client hello data.");
        return new ClientHello(capabilities);
    }

    public static byte[] encodeWelcome(Welcome welcome) throws ProtocolException {
        if (welcome == null || welcome.sessionId() == 0L) throw new ProtocolException("Invalid welcome session.");
        if (welcome.key() == null || welcome.key().length != Protocol.KEY_BYTES) {
            throw new ProtocolException("Invalid welcome key.");
        }
        if (welcome.challenge() == null || welcome.challenge().length != Protocol.CHALLENGE_BYTES) {
            throw new ProtocolException("Invalid welcome challenge.");
        }
        if (welcome.port() < 1 || welcome.port() > 65535) throw new ProtocolException("Invalid voice port.");
        if (!Double.isFinite(welcome.voiceRadius()) || welcome.voiceRadius() <= 0 || welcome.voiceRadius() > 512) {
            throw new ProtocolException("Invalid voice radius.");
        }
        byte[] host = cleanHost(welcome.publicHost()).getBytes(StandardCharsets.UTF_8);
        ByteBuffer output = ByteBuffer.allocate(4 + 1 + 1 + 8 + 4 + 8 + 1 + host.length
                + Protocol.CHALLENGE_BYTES + Protocol.KEY_BYTES).order(ByteOrder.BIG_ENDIAN);
        output.putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION).put((byte) WELCOME)
                .putLong(welcome.sessionId()).putInt(welcome.port()).putDouble(welcome.voiceRadius())
                .put((byte) host.length).put(host).put(welcome.challenge()).put(welcome.key());
        return output.array();
    }

    public static Welcome decodeWelcome(byte[] message) throws ProtocolException {
        int minimum = 4 + 1 + 1 + 8 + 4 + 8 + 1 + Protocol.CHALLENGE_BYTES + Protocol.KEY_BYTES;
        ByteBuffer input = controlHeader(message, WELCOME, minimum);
        long sessionId = input.getLong();
        int port = input.getInt();
        double radius = input.getDouble();
        int hostLength = Byte.toUnsignedInt(input.get());
        if (hostLength > 253 || input.remaining() != hostLength + Protocol.CHALLENGE_BYTES + Protocol.KEY_BYTES) {
            throw new ProtocolException("Invalid welcome host length.");
        }
        byte[] host = new byte[hostLength];
        byte[] challenge = new byte[Protocol.CHALLENGE_BYTES];
        byte[] key = new byte[Protocol.KEY_BYTES];
        input.get(host).get(challenge).get(key);
        Welcome welcome = new Welcome(sessionId, key, challenge, port, radius,
                cleanHost(new String(host, StandardCharsets.UTF_8)));
        validateWelcome(welcome);
        return welcome;
    }

    public static byte[] encodeRoster(long revision, Collection<RosterEntry> entries)
            throws ProtocolException {
        if (revision < 1L) throw new ProtocolException("Invalid roster revision.");
        if (entries == null || entries.size() > Protocol.MAX_ROSTER_ENTRIES) {
            throw new ProtocolException("Invalid roster size.");
        }
        ByteBuffer output = ByteBuffer.allocate(4 + 1 + 1 + 8 + 2 + entries.size() * 17)
                .order(ByteOrder.BIG_ENDIAN);
        output.putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION).put((byte) ROSTER)
                .putLong(revision).putShort((short) entries.size());
        for (RosterEntry entry : entries) {
            if (entry == null || entry.playerId() == null || (entry.flags() & ~0x03) != 0) {
                throw new ProtocolException("Invalid roster entry.");
            }
            output.putLong(entry.playerId().getMostSignificantBits())
                    .putLong(entry.playerId().getLeastSignificantBits())
                    .put((byte) entry.flags());
        }
        return output.array();
    }

    public static Roster decodeRoster(byte[] message) throws ProtocolException {
        ByteBuffer input = controlHeader(message, ROSTER, 4 + 1 + 1 + 8 + 2);
        long revision = input.getLong();
        int count = Short.toUnsignedInt(input.getShort());
        if (revision < 1L || count > Protocol.MAX_ROSTER_ENTRIES || input.remaining() != count * 17) {
            throw new ProtocolException("Invalid roster payload.");
        }
        List<RosterEntry> entries = new ArrayList<>(count);
        for (int index = 0; index < count; index++) {
            UUID playerId = new UUID(input.getLong(), input.getLong());
            int flags = Byte.toUnsignedInt(input.get());
            if ((flags & ~0x03) != 0) throw new ProtocolException("Invalid roster flags.");
            entries.add(new RosterEntry(playerId, flags));
        }
        return new Roster(revision, entries);
    }

    public static byte[] encodeError(String message) {
        byte[] text = String.valueOf(message == null ? "Voice service unavailable." : message)
                .replaceAll("[\\p{Cntrl}]", " ").trim().getBytes(StandardCharsets.UTF_8);
        if (text.length > 240) {
            byte[] bounded = new byte[240];
            System.arraycopy(text, 0, bounded, 0, bounded.length);
            text = bounded;
        }
        return ByteBuffer.allocate(4 + 1 + 1 + 1 + text.length).order(ByteOrder.BIG_ENDIAN)
                .putInt(Protocol.CONTROL_MAGIC).put((byte) Protocol.VERSION).put((byte) ERROR)
                .put((byte) text.length).put(text).array();
    }

    private static ByteBuffer controlHeader(byte[] message, int expectedType, int minimumLength)
            throws ProtocolException {
        if (message == null || message.length < minimumLength
                || message.length > Protocol.MAX_CONTROL_MESSAGE_BYTES) {
            throw new ProtocolException("Invalid control message length.");
        }
        ByteBuffer input = ByteBuffer.wrap(message).order(ByteOrder.BIG_ENDIAN);
        if (input.getInt() != Protocol.CONTROL_MAGIC) throw new ProtocolException("Invalid control magic.");
        if (Byte.toUnsignedInt(input.get()) != Protocol.VERSION) {
            throw new ProtocolException("Unsupported control protocol version.");
        }
        if (Byte.toUnsignedInt(input.get()) != expectedType) throw new ProtocolException("Unexpected control message.");
        return input;
    }

    private static String cleanHost(String value) throws ProtocolException {
        String host = String.valueOf(value == null ? "" : value).trim();
        if (host.length() > 253 || host.chars().anyMatch(character -> character < 0x21 || character > 0x7e)) {
            throw new ProtocolException("Invalid public voice host.");
        }
        return host;
    }

    private static void validateWelcome(Welcome welcome) throws ProtocolException {
        if (welcome.sessionId() == 0L) throw new ProtocolException("Invalid welcome session.");
        if (welcome.port() < 1 || welcome.port() > 65535) throw new ProtocolException("Invalid voice port.");
        if (!Double.isFinite(welcome.voiceRadius()) || welcome.voiceRadius() <= 0
                || welcome.voiceRadius() > 512) {
            throw new ProtocolException("Invalid voice radius.");
        }
    }

    public record ClientHello(int capabilities) {}

    public record RosterEntry(UUID playerId, int flags) {
        public boolean connected() { return (flags & ROSTER_FLAG_CONNECTED) != 0; }
        public boolean muted() { return (flags & ROSTER_FLAG_MUTED) != 0; }
    }

    public record Roster(long revision, List<RosterEntry> entries) {
        public Roster {
            entries = entries == null ? List.of() : List.copyOf(entries);
        }
    }

    public record Welcome(
            long sessionId,
            byte[] key,
            byte[] challenge,
            int port,
            double voiceRadius,
            String publicHost
    ) {
        public Welcome {
            key = key == null ? null : key.clone();
            challenge = challenge == null ? null : challenge.clone();
            publicHost = String.valueOf(publicHost == null ? "" : publicHost);
        }

        @Override public byte[] key() { return key == null ? null : key.clone(); }
        @Override public byte[] challenge() { return challenge == null ? null : challenge.clone(); }
    }
}
