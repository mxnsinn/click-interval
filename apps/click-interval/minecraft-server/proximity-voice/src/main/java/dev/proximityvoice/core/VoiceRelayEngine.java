package dev.proximityvoice.core;

import java.net.SocketAddress;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

public final class VoiceRelayEngine {
    static final int MAX_RECIPIENTS_PER_VOICE_FRAME = 64;
    private static final double OUTBOUND_DELIVERY_BURST = 2_048.0;
    private static final double OUTBOUND_DELIVERIES_PER_SECOND = 4_096.0;

    private final SessionRegistry sessions;
    private final PacketCodec codec;
    private final Clock clock;
    private final PreAuthRateLimiter preAuthRateLimiter;
    private final TokenBucket outboundDeliveryRate;
    private final RelayMetrics metrics = new RelayMetrics();
    private final AtomicReference<RoutingSnapshot> routing = new AtomicReference<>(
            new RoutingSnapshot(Map.of(), 48.0, null));
    private volatile double voiceRadius;

    public VoiceRelayEngine(SessionRegistry sessions, double voiceRadius) {
        this(sessions, voiceRadius, Clock.systemUTC(), new PacketCodec(), new PreAuthRateLimiter(),
                new TokenBucket(OUTBOUND_DELIVERY_BURST, OUTBOUND_DELIVERIES_PER_SECOND));
    }

    VoiceRelayEngine(SessionRegistry sessions, double voiceRadius, Clock clock, PacketCodec codec) {
        this(sessions, voiceRadius, clock, codec, new PreAuthRateLimiter(),
                new TokenBucket(OUTBOUND_DELIVERY_BURST, OUTBOUND_DELIVERIES_PER_SECOND));
    }

    VoiceRelayEngine(
            SessionRegistry sessions,
            double voiceRadius,
            Clock clock,
            PacketCodec codec,
            PreAuthRateLimiter preAuthRateLimiter
    ) {
        this(sessions, voiceRadius, clock, codec, preAuthRateLimiter,
                new TokenBucket(OUTBOUND_DELIVERY_BURST, OUTBOUND_DELIVERIES_PER_SECOND));
    }

    VoiceRelayEngine(
            SessionRegistry sessions,
            double voiceRadius,
            Clock clock,
            PacketCodec codec,
            PreAuthRateLimiter preAuthRateLimiter,
            TokenBucket outboundDeliveryRate
    ) {
        this.sessions = Objects.requireNonNull(sessions, "sessions");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.codec = Objects.requireNonNull(codec, "codec");
        this.preAuthRateLimiter = Objects.requireNonNull(preAuthRateLimiter, "preAuthRateLimiter");
        this.outboundDeliveryRate = Objects.requireNonNull(outboundDeliveryRate, "outboundDeliveryRate");
        setVoiceRadius(voiceRadius);
    }

    public synchronized void setSnapshots(Map<UUID, PlayerSnapshot> value) {
        Map<UUID, PlayerSnapshot> immutable = value == null || value.isEmpty()
                ? Map.of()
                : Map.copyOf(value);
        routing.set(new RoutingSnapshot(immutable, voiceRadius, sessions));
    }

    public synchronized void setVoiceRadius(double radius) {
        if (!Double.isFinite(radius) || radius <= 0.0 || radius > 512.0) {
            throw new IllegalArgumentException("Voice radius must be between 0 and 512 blocks.");
        }
        voiceRadius = radius;
        routing.set(new RoutingSnapshot(routing.get().snapshots(), radius, sessions));
    }

    public double voiceRadius() {
        return voiceRadius;
    }

    public RelayMetrics metrics() {
        return metrics;
    }

    public List<OutboundDatagram> handle(byte[] datagram, SocketAddress remote) {
        metrics.received();
        if (remote == null || datagram == null || datagram.length > Protocol.MAX_DATAGRAM_BYTES) {
            metrics.rejected();
            return List.of();
        }
        if (!preAuthRateLimiter.allow(remote, datagram.length)) {
            metrics.rateLimited();
            return List.of();
        }
        PacketEnvelope envelope;
        try {
            envelope = codec.readEnvelope(datagram);
        } catch (ProtocolException invalid) {
            metrics.rejected();
            return List.of();
        }
        VoiceSession session = sessions.get(envelope.sessionId()).orElse(null);
        if (session == null || session.destroyed()) {
            metrics.rejected();
            return List.of();
        }
        if (envelope.type() != PacketType.ASSOCIATE && !session.isAssociatedWith(remote)) {
            metrics.rejected();
            return List.of();
        }
        if (!session.allowPreAuthDatagram(datagram.length)) {
            metrics.rateLimited();
            return List.of();
        }
        DecodedPacket packet;
        try {
            packet = codec.decode(envelope, session.keyMaterial(), Direction.CLIENT_TO_SERVER);
        } catch (ProtocolException unauthenticated) {
            metrics.rejected();
            return List.of();
        }
        if (packet.type() != PacketType.ASSOCIATE && !session.isAssociatedWith(remote)) {
            metrics.rejected();
            return List.of();
        }
        if (!session.allowDatagram(datagram.length)) {
            metrics.rateLimited();
            return List.of();
        }
        if (!session.acceptInboundSequence(packet.sequence())) {
            metrics.replayed();
            return List.of();
        }
        metrics.authenticated();
        long now = clock.millis();
        session.touch(now);
        try {
            return switch (packet.type()) {
                case ASSOCIATE -> associate(session, packet.payload(), remote, now);
                case KEEPALIVE, PING -> acknowledged(session, packet.type(), packet.payload(), remote);
                case STATE -> updateState(session, packet.payload(), remote);
                case VOICE -> routeVoice(session, packet.payload(), remote);
                case ACK, ERROR -> List.of();
            };
        } catch (ProtocolException invalid) {
            metrics.rejected();
            return List.of();
        }
    }

    private List<OutboundDatagram> associate(
            VoiceSession session,
            byte[] payload,
            SocketAddress remote,
            long now
    ) throws ProtocolException {
        if (payload.length != Protocol.CHALLENGE_BYTES || !session.verifyChallenge(payload)) {
            throw new ProtocolException("Association challenge failed.");
        }
        session.associate(remote, now);
        metrics.associated();
        return List.of(ack(session, PacketType.ASSOCIATE, remote));
    }

    private List<OutboundDatagram> acknowledged(
            VoiceSession session,
            PacketType requestType,
            byte[] payload,
            SocketAddress remote
    ) throws ProtocolException {
        requireAssociatedEndpoint(session, remote);
        if (payload.length > 32) throw new ProtocolException("Control payload is too large.");
        return List.of(ack(session, requestType, remote));
    }

    private List<OutboundDatagram> updateState(
            VoiceSession session,
            byte[] payload,
            SocketAddress remote
    ) throws ProtocolException {
        requireAssociatedEndpoint(session, remote);
        if (payload.length != 1 || (payload[0] != 0 && payload[0] != 1)) {
            throw new ProtocolException("Invalid microphone state.");
        }
        session.setMuted(payload[0] == 1);
        return List.of(ack(session, PacketType.STATE, remote));
    }

    private List<OutboundDatagram> routeVoice(
            VoiceSession source,
            byte[] opusFrame,
            SocketAddress remote
    ) throws ProtocolException {
        requireAssociatedEndpoint(source, remote);
        if (source.muted()) return List.of();
        if (opusFrame.length == 0 || opusFrame.length > Protocol.MAX_OPUS_FRAME_BYTES) {
            throw new ProtocolException("Invalid Opus frame length.");
        }
        List<UUID> recipients = routing.get().recipients(source.playerId());
        if (recipients.isEmpty()) {
            metrics.voiceFrame();
            return List.of();
        }
        byte[] routedFrame = VoiceFrameCodec.encode(source.playerId(), opusFrame);
        List<OutboundDatagram> outbound = new ArrayList<>(recipients.size());
        for (UUID playerId : recipients) {
            VoiceSession target = sessions.getByPlayer(playerId).orElse(null);
            if (target == null || target.endpoint() == null || target.destroyed()) continue;
            if (!outboundDeliveryRate.tryConsume(1.0)) {
                metrics.rateLimited();
                break;
            }
            byte[] encoded = codec.encode(
                    PacketType.VOICE,
                    target.sessionId(),
                    target.nextOutboundSequence(),
                    routedFrame,
                    target.keyMaterial(),
                    Direction.SERVER_TO_CLIENT);
            outbound.add(new OutboundDatagram(target.endpoint(), encoded));
        }
        metrics.voiceFrame();
        metrics.routedRecipients(outbound.size());
        return List.copyOf(outbound);
    }

    private OutboundDatagram ack(VoiceSession session, PacketType requestType, SocketAddress remote)
            throws ProtocolException {
        byte[] encoded = codec.encode(
                PacketType.ACK,
                session.sessionId(),
                session.nextOutboundSequence(),
                new byte[]{(byte) requestType.id()},
                session.keyMaterial(),
                Direction.SERVER_TO_CLIENT);
        return new OutboundDatagram(remote, encoded);
    }

    private static void requireAssociatedEndpoint(VoiceSession session, SocketAddress remote)
            throws ProtocolException {
        if (!session.isAssociatedWith(remote)) {
            throw new ProtocolException("UDP endpoint is not associated with this session.");
        }
    }

    /**
     * Immutable position generation with a lazy per-speaker route cache. Routes
     * are computed at most once per snapshot generation instead of once per 20 ms
     * voice frame; swapping the generation also bounds cache lifetime and size.
     */
    private static final class RoutingSnapshot {
        private final Map<UUID, PlayerSnapshot> snapshots;
        private final double radius;
        private final SessionRegistry sessions;
        private final ConcurrentHashMap<UUID, List<UUID>> routes = new ConcurrentHashMap<>();

        private RoutingSnapshot(Map<UUID, PlayerSnapshot> snapshots, double radius, SessionRegistry sessions) {
            this.snapshots = snapshots;
            this.radius = radius;
            this.sessions = sessions;
        }

        private Map<UUID, PlayerSnapshot> snapshots() {
            return snapshots;
        }

        private List<UUID> recipients(UUID sourceId) {
            return routes.computeIfAbsent(sourceId, id -> ProximityRouter.recipients(
                    id,
                    snapshots,
                    radius,
                    MAX_RECIPIENTS_PER_VOICE_FRAME,
                    playerId -> sessions != null && sessions.hasActivePlayer(playerId)));
        }
    }
}
