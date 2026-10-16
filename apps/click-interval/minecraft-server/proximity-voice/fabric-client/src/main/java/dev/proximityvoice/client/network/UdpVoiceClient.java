package dev.proximityvoice.client.network;

import dev.proximityvoice.client.core.ClientStateMachine;
import dev.proximityvoice.client.core.ConnectionState;
import dev.proximityvoice.client.core.ReplayWindow;
import dev.proximityvoice.client.protocol.ControlCodec;
import dev.proximityvoice.client.protocol.DecodedPacket;
import dev.proximityvoice.client.protocol.Direction;
import dev.proximityvoice.client.protocol.PacketCodec;
import dev.proximityvoice.client.protocol.PacketEnvelope;
import dev.proximityvoice.client.protocol.PacketType;
import dev.proximityvoice.client.protocol.Protocol;
import dev.proximityvoice.client.protocol.ProtocolException;
import dev.proximityvoice.client.protocol.VoiceFrame;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

public final class UdpVoiceClient implements AutoCloseable {
    private static final long MONOTONIC_ORIGIN_NANOS = System.nanoTime();
    private static final int SOCKET_POLL_MILLIS = 200;
    private static final long KEEPALIVE_INTERVAL_MILLIS = 5_000L;
    private static final long SERVER_SILENCE_BEFORE_REBIND_MILLIS = 12_000L;
    private static final long ASSOCIATION_INITIAL_RETRY_MILLIS = 250L;
    private static final long ASSOCIATION_MAXIMUM_RETRY_MILLIS = 2_000L;
    private static final long ASSOCIATION_TIMEOUT_MILLIS = 10_000L;
    private static final int ASSOCIATION_MAXIMUM_ATTEMPTS = 7;
    private static final double INBOUND_PACKET_BURST = 512.0;
    private static final double INBOUND_PACKETS_PER_SECOND = 1_024.0;
    private static final double INBOUND_BYTE_BURST = 512.0 * 1024.0;
    private static final double INBOUND_BYTES_PER_SECOND = 1024.0 * 1024.0;

    private final PacketCodec codec = new PacketCodec();
    private final ReplayWindow replayWindow = new ReplayWindow();
    private final ClientStateMachine state;
    private final Consumer<VoiceFrame> voiceSink;
    private final Runnable associatedSink;
    private final Runnable renegotiationSink;
    private final AtomicLong outboundSequence = new AtomicLong();
    private final AtomicLong transportGeneration = new AtomicLong();
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile DatagramSocket socket;
    private volatile long sessionId;
    private volatile byte[] key = new byte[0];
    private volatile boolean locallyMuted = true;
    private volatile long lastServerPacketMillis;
    private volatile long lastKeepaliveMillis;
    private Thread networkThread;

    public UdpVoiceClient(ClientStateMachine state, Consumer<VoiceFrame> voiceSink, Runnable associatedSink) {
        this(state, voiceSink, associatedSink, () -> {});
    }

    public UdpVoiceClient(ClientStateMachine state, Consumer<VoiceFrame> voiceSink,
                          Runnable associatedSink, Runnable renegotiationSink) {
        this.state = Objects.requireNonNull(state, "state");
        this.voiceSink = Objects.requireNonNull(voiceSink, "voiceSink");
        this.associatedSink = Objects.requireNonNull(associatedSink, "associatedSink");
        this.renegotiationSink = Objects.requireNonNull(renegotiationSink, "renegotiationSink");
    }

    public synchronized void connect(ControlCodec.Welcome welcome, String fallbackHost) {
        // Ignore duplicate or unsolicited welcomes while a transport generation
        // is active. This keeps a broken server from creating overlapping DNS,
        // socket, and receiver threads on the client.
        if (running.get()) return;
        closeTransport(false);
        if (welcome == null) {
            state.fail("The server returned an empty voice session");
            return;
        }
        sessionId = welcome.sessionId();
        key = welcome.key();
        String host = welcome.publicHost().isBlank() ? cleanHost(fallbackHost) : welcome.publicHost();
        long generation = transportGeneration.get();
        running.set(true);
        state.beginAssociation();
        networkThread = new Thread(() -> networkLoop(generation, host, welcome.port(), welcome.challenge()), "ProximityVoice-UDP");
        networkThread.setDaemon(true);
        networkThread.start();
    }

    private void networkLoop(long generation, String host, int port, byte[] challenge) {
        DatagramSocket opened = null;
        boolean requestNewSession = false;
        try {
            InetAddress address = InetAddress.getByName(host);
            opened = openSocket(address, port);
            installSocket(generation, opened);
            long now = monotonicMillis();
            lastServerPacketMillis = now;
            lastKeepaliveMillis = now;
            AssociationRetryPolicy association = newAssociationPolicy(now);
            sendAssociation(generation, challenge, association, now);
            byte[] receiveBuffer = new byte[Protocol.MAX_DATAGRAM_BYTES + 1];
            DatagramPacket packet = new DatagramPacket(receiveBuffer, receiveBuffer.length);
            InboundPacketLimiter inboundLimiter = new InboundPacketLimiter(
                    INBOUND_PACKET_BURST,
                    INBOUND_PACKETS_PER_SECOND,
                    INBOUND_BYTE_BURST,
                    INBOUND_BYTES_PER_SECOND,
                    System::nanoTime);
            while (running.get() && transportGeneration.get() == generation) {
                try {
                    packet.setLength(receiveBuffer.length);
                    opened.receive(packet);
                    if (packet.getLength() > Protocol.MAX_DATAGRAM_BYTES) continue;
                    if (!inboundLimiter.allow(packet.getLength())) continue;
                    byte[] data = Arrays.copyOfRange(packet.getData(), packet.getOffset(), packet.getOffset() + packet.getLength());
                    try {
                        handleInbound(generation, data);
                    } catch (ProtocolException invalidPacket) {
                        // UDP corruption or an invalid authenticated response must not kill a healthy session.
                    }
                } catch (SocketTimeoutException ignored) {
                    // The short timeout drives retry, keepalive, and endpoint recovery decisions.
                }
                now = monotonicMillis();
                ConnectionState currentState = state.state();
                if (currentState == ConnectionState.ASSOCIATING) {
                    AssociationRetryPolicy.Decision decision = association.poll(now);
                    if (decision == AssociationRetryPolicy.Decision.SEND) {
                        sendAssociation(generation, challenge, association, now);
                    } else if (decision == AssociationRetryPolicy.Decision.TIMED_OUT) {
                        requestNewSession = true;
                        break;
                    }
                } else if (currentState == ConnectionState.CONNECTED
                        && now - lastKeepaliveMillis >= KEEPALIVE_INTERVAL_MILLIS) {
                    send(generation, PacketType.KEEPALIVE, new byte[0]);
                    lastKeepaliveMillis = now;
                }
                if (currentState == ConnectionState.CONNECTED
                        && now - lastServerPacketMillis >= SERVER_SILENCE_BEFORE_REBIND_MILLIS) {
                    state.beginAssociation();
                    DatagramSocket replacement = openSocket(address, port);
                    installSocket(generation, replacement);
                    opened.close();
                    opened = replacement;
                    now = monotonicMillis();
                    lastServerPacketMillis = now;
                    lastKeepaliveMillis = now;
                    association = newAssociationPolicy(now);
                    sendAssociation(generation, challenge, association, now);
                }
            }
        } catch (IOException | ProtocolException | RuntimeException error) {
            if (running.get() && transportGeneration.get() == generation) {
                requestNewSession = true;
            }
        } finally {
            if (opened != null) opened.close();
            boolean finishedCurrentGeneration = finishGeneration(generation);
            if (requestNewSession && finishedCurrentGeneration) {
                state.beginNegotiation();
                renegotiationSink.run();
            }
        }
    }

    private static DatagramSocket openSocket(InetAddress address, int port) throws IOException {
        DatagramSocket opened = new DatagramSocket();
        try {
            opened.connect(new InetSocketAddress(address, port));
            opened.setSoTimeout(SOCKET_POLL_MILLIS);
            opened.setReceiveBufferSize(256 * 1024);
            opened.setSendBufferSize(256 * 1024);
            return opened;
        } catch (IOException | RuntimeException error) {
            opened.close();
            throw error;
        }
    }

    private synchronized void installSocket(long generation, DatagramSocket replacement) throws IOException {
        if (!running.get() || transportGeneration.get() != generation) {
            replacement.close();
            throw new IOException("Voice transport was replaced");
        }
        socket = replacement;
    }

    private static AssociationRetryPolicy newAssociationPolicy(long now) {
        return new AssociationRetryPolicy(now,
                ASSOCIATION_INITIAL_RETRY_MILLIS,
                ASSOCIATION_MAXIMUM_RETRY_MILLIS,
                ASSOCIATION_TIMEOUT_MILLIS,
                ASSOCIATION_MAXIMUM_ATTEMPTS);
    }

    private void sendAssociation(long generation, byte[] challenge,
                                 AssociationRetryPolicy association, long now)
            throws ProtocolException, IOException {
        send(generation, PacketType.ASSOCIATE, challenge);
        association.attempted(now);
    }

    private void handleInbound(long generation, byte[] datagram) throws ProtocolException, IOException {
        PacketEnvelope envelope = codec.readEnvelope(datagram);
        if (envelope.sessionId() != sessionId) return;
        DecodedPacket packet = codec.decode(envelope, key, Direction.SERVER_TO_CLIENT);
        if (!replayWindow.accept(packet.sequence())) return;
        lastServerPacketMillis = monotonicMillis();
        switch (packet.type()) {
            case ACK -> handleAck(generation, packet.payload());
            case VOICE -> voiceSink.accept(VoiceFrame.decode(packet.payload()));
            case ERROR -> throw new IOException("The voice relay rejected this session");
            case PING -> send(generation, PacketType.PING, packet.payload());
            case ASSOCIATE, KEEPALIVE, STATE -> {
                // These packet types are client-originating in protocol version 1.
            }
        }
    }

    private void handleAck(long generation, byte[] payload) throws ProtocolException, IOException {
        if (payload.length != 1) throw new ProtocolException("Invalid voice acknowledgement");
        int acknowledgedType = Byte.toUnsignedInt(payload[0]);
        if (acknowledgedType == PacketType.ASSOCIATE.id() && state.state() == ConnectionState.ASSOCIATING) {
            state.connected();
            associatedSink.run();
            send(generation, PacketType.STATE, new byte[]{(byte) (locallyMuted ? 1 : 0)});
        }
    }

    public void sendVoice(byte[] opusFrame) {
        if (locallyMuted || state.state() != ConnectionState.CONNECTED || opusFrame == null
                || opusFrame.length == 0 || opusFrame.length > Protocol.MAX_OPUS_FRAME_BYTES) return;
        try {
            send(transportGeneration.get(), PacketType.VOICE, opusFrame);
        } catch (ProtocolException | IOException error) {
            if (running.get()) state.fail("Could not send voice: " + safeMessage(error));
        }
    }

    public void setMuted(boolean muted) {
        boolean changed = locallyMuted != muted;
        locallyMuted = muted;
        if (changed && state.state() == ConnectionState.CONNECTED) {
            try {
                send(transportGeneration.get(), PacketType.STATE, new byte[]{(byte) (muted ? 1 : 0)});
            } catch (ProtocolException | IOException error) {
                if (running.get()) state.fail("Could not update microphone state: " + safeMessage(error));
            }
        }
    }

    public boolean isMuted() {
        return locallyMuted;
    }

    private synchronized void send(long generation, PacketType type, byte[] payload) throws ProtocolException, IOException {
        DatagramSocket current = socket;
        if (!running.get() || transportGeneration.get() != generation
                || current == null || current.isClosed()) throw new IOException("Voice socket is closed");
        long sequence = outboundSequence.incrementAndGet();
        if (sequence <= 0) throw new ProtocolException("Voice sequence exhausted");
        byte[] encoded = codec.encode(type, sessionId, sequence, payload, key, Direction.CLIENT_TO_SERVER);
        current.send(new DatagramPacket(encoded, encoded.length));
    }

    private static String cleanHost(String value) {
        String host = String.valueOf(value == null ? "" : value).trim();
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
        if (host.isBlank() || host.length() > 253
                || host.chars().anyMatch(c -> c < 0x21 || c > 0x7e)) return "127.0.0.1";
        return host;
    }

    private static String safeMessage(Throwable error) {
        String message = String.valueOf(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
                .replaceAll("[\\p{Cntrl}]", " ").trim();
        return message.length() <= 140 ? message : message.substring(0, 140);
    }

    private static long monotonicMillis() {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - MONOTONIC_ORIGIN_NANOS);
    }

    private synchronized void closeTransport(boolean updateState) {
        transportGeneration.incrementAndGet();
        running.set(false);
        DatagramSocket current = socket;
        socket = null;
        if (current != null) current.close();
        replayWindow.reset();
        outboundSequence.set(0);
        sessionId = 0;
        Arrays.fill(key, (byte) 0);
        key = new byte[0];
        if (updateState) state.disconnected();
    }

    private synchronized boolean finishGeneration(long generation) {
        if (transportGeneration.get() != generation) return false;
        running.set(false);
        socket = null;
        replayWindow.reset();
        outboundSequence.set(0);
        sessionId = 0;
        Arrays.fill(key, (byte) 0);
        key = new byte[0];
        return true;
    }

    @Override
    public void close() {
        Thread thread;
        synchronized (this) {
            thread = networkThread;
            networkThread = null;
            closeTransport(true);
        }
        if (thread != null && thread != Thread.currentThread()) {
            thread.interrupt();
            try {
                thread.join(1_500L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
