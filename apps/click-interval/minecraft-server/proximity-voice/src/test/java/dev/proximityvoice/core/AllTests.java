package dev.proximityvoice.core;

import dev.proximityvoice.plugin.VoiceRelayServer;
import dev.proximityvoice.plugin.RelayLifecycle;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;

public final class AllTests {
    private int assertions;

    public static void main(String[] args) throws Exception {
        AllTests tests = new AllTests();
        tests.authenticatedPacketRoundTripAndTamperRejection();
        tests.packetBoundsAndVersionAreStrict();
        tests.replayWindowAcceptsReorderingOnlyOnce();
        tests.tokenBucketIsBoundedAndRefills();
        tests.proximityRoutingRequiresSameWorldAndRadius();
        tests.proximityRoutingCapsTheNearestRecipients();
        tests.controlHandshakeRoundTrips();
        tests.controlRosterRoundTrips();
        tests.preAuthenticationFloodIsBoundedWithoutEndpointStateGrowth();
        tests.endpointRejectionDoesNotDrainGlobalAdmissionBudget();
        tests.relayAssociatesAndRoutesAuthenticatedVoice();
        tests.relayBoundsAggregateVoiceDeliveries();
        tests.relayRejectsWrongEndpointReplayAndMutedAudio();
        tests.udpSocketRelayAcknowledgesAssociation();
        tests.unexpectedUdpReceiverFailureIsTerminalAndObservable();
        tests.lifecyclePreservesStartupAndReceiverErrorsOnDisable();
        tests.sessionRegistryReplacesAndExpiresSessions();
        tests.statusFileIsAtomicAndEscaped();
        System.out.println("PASS ProximityVoice core tests (" + tests.assertions + " assertions)");
    }

    private void authenticatedPacketRoundTripAndTamperRejection() throws Exception {
        PacketCodec codec = new PacketCodec();
        byte[] key = bytes(Protocol.KEY_BYTES, 7);
        byte[] payload = new byte[]{1, 2, 3, 4, 5};
        byte[] encoded = codec.encode(PacketType.VOICE, 91L, 3L, payload, key, Direction.CLIENT_TO_SERVER);
        check(encoded.length == Protocol.HEADER_BYTES + Protocol.AUTH_TAG_BYTES + payload.length,
                "encoded length is bounded and deterministic");
        PacketEnvelope envelope = codec.readEnvelope(encoded);
        equal(PacketType.VOICE, envelope.type(), "packet type");
        equal(91L, envelope.sessionId(), "session id");
        equal(3L, envelope.sequence(), "sequence");
        check(Arrays.equals(payload, codec.decode(envelope, key, Direction.CLIENT_TO_SERVER).payload()),
                "authenticated payload round trip");

        byte[] tampered = encoded.clone();
        tampered[tampered.length - 1] ^= 0x20;
        throwsProtocol(() -> codec.decode(codec.readEnvelope(tampered), key, Direction.CLIENT_TO_SERVER),
                "ciphertext tampering is rejected");
        throwsProtocol(() -> codec.decode(envelope, key, Direction.SERVER_TO_CLIENT),
                "direction-separated nonce rejects reflection");
        byte[] wrongKey = bytes(Protocol.KEY_BYTES, 8);
        throwsProtocol(() -> codec.decode(envelope, wrongKey, Direction.CLIENT_TO_SERVER),
                "wrong session key is rejected");
    }

    private void packetBoundsAndVersionAreStrict() throws Exception {
        PacketCodec codec = new PacketCodec();
        byte[] key = bytes(Protocol.KEY_BYTES, 1);
        throwsProtocol(() -> codec.encode(PacketType.VOICE, 1L, 1L,
                        new byte[Protocol.MAX_PLAINTEXT_BYTES + 1], key, Direction.CLIENT_TO_SERVER),
                "oversized plaintext is rejected");
        throwsProtocol(() -> codec.readEnvelope(new byte[Protocol.MAX_DATAGRAM_BYTES + 1]),
                "oversized datagram is rejected");
        byte[] valid = codec.encode(PacketType.PING, 1L, 1L, new byte[0], key, Direction.CLIENT_TO_SERVER);
        valid[4] = (byte) (Protocol.VERSION + 1);
        throwsProtocol(() -> codec.readEnvelope(valid), "future protocol version is rejected");
        throwsProtocol(() -> codec.encode(PacketType.PING, 0L, 1L, new byte[0], key, Direction.CLIENT_TO_SERVER),
                "zero session id is rejected");
        throwsProtocol(() -> codec.encode(PacketType.PING, 1L, 0L, new byte[0], key, Direction.CLIENT_TO_SERVER),
                "zero sequence is rejected");
    }

    private void replayWindowAcceptsReorderingOnlyOnce() {
        ReplayWindow window = new ReplayWindow();
        check(window.accept(100), "first sequence accepted");
        check(window.accept(102), "new sequence accepted");
        check(window.accept(101), "one reordered sequence accepted");
        check(!window.accept(101), "duplicate reordered sequence rejected");
        check(!window.accept(100), "duplicate original sequence rejected");
        check(window.accept(170), "far future sequence accepted");
        check(!window.accept(102), "sequence outside replay window rejected");
        check(!window.accept(0), "nonpositive sequence rejected");
    }

    private void tokenBucketIsBoundedAndRefills() {
        AtomicLong nanos = new AtomicLong(1_000L);
        TokenBucket bucket = new TokenBucket(3.0, 2.0, nanos::get);
        check(bucket.tryConsume(1), "first token");
        check(bucket.tryConsume(2), "remaining burst");
        check(!bucket.tryConsume(1), "empty bucket rejects");
        nanos.addAndGet(500_000_000L);
        check(bucket.tryConsume(1), "half-second refill adds one token");
        nanos.addAndGet(10_000_000_000L);
        close(3.0, bucket.available(), 0.0001, "refill is capped at burst capacity");
        check(!bucket.tryConsume(4), "single request cannot exceed burst");
    }

    private void proximityRoutingRequiresSameWorldAndRadius() {
        UUID source = UUID.randomUUID();
        UUID near = UUID.randomUUID();
        UUID edge = UUID.randomUUID();
        UUID far = UUID.randomUUID();
        UUID nether = UUID.randomUUID();
        UUID disabled = UUID.randomUUID();
        Map<UUID, PlayerSnapshot> snapshots = Map.of(
                source, snapshot(source, "overworld", 0, 64, 0, true),
                near, snapshot(near, "overworld", 3, 64, 4, true),
                edge, snapshot(edge, "overworld", 10, 64, 0, true),
                far, snapshot(far, "overworld", 10.01, 64, 0, true),
                nether, snapshot(nether, "nether", 1, 64, 1, true),
                disabled, snapshot(disabled, "overworld", 1, 64, 1, false));
        List<UUID> recipients = ProximityRouter.recipients(source, snapshots, 10.0);
        check(recipients.contains(near), "near player routed");
        check(recipients.contains(edge), "exact-radius player routed");
        check(!recipients.contains(far), "outside-radius player excluded");
        check(!recipients.contains(nether), "different world excluded");
        check(!recipients.contains(disabled), "voice-disabled player excluded");
        check(!recipients.contains(source), "source excluded");
    }

    private void proximityRoutingCapsTheNearestRecipients() {
        UUID source = new UUID(0L, 1L);
        Map<UUID, PlayerSnapshot> snapshots = new HashMap<>();
        snapshots.put(source, snapshot(source, "world", 0, 64, 0, true));
        for (int distance = 1; distance <= 80; distance++) {
            UUID target = new UUID(0L, distance + 1L);
            snapshots.put(target, snapshot(target, "world", distance, 64, 0, true));
        }
        List<UUID> recipients = ProximityRouter.recipients(source, snapshots, 100.0, 8);
        equal(8, recipients.size(), "routing fan-out is capped");
        for (int distance = 1; distance <= 8; distance++) {
            equal(new UUID(0L, distance + 1L), recipients.get(distance - 1),
                    "routing cap keeps nearest player " + distance);
        }
        check(!recipients.contains(new UUID(0L, 81L)),
                "far listener is excluded when the fan-out cap is full");
        UUID onlyVoiceClient = new UUID(0L, 81L);
        equal(List.of(onlyVoiceClient), ProximityRouter.recipients(
                        source, snapshots, 100.0, 1, onlyVoiceClient::equals),
                "players without voice sessions do not consume the fan-out cap");
    }

    private void controlHandshakeRoundTrips() throws Exception {
        ControlCodec.ClientHello hello = ControlCodec.decodeClientHello(ControlCodec.encodeClientHello(0x1234));
        equal(0x1234, hello.capabilities(), "client capabilities");
        byte[] key = bytes(Protocol.KEY_BYTES, 3);
        byte[] challenge = bytes(Protocol.CHALLENGE_BYTES, 9);
        ControlCodec.Welcome welcome = new ControlCodec.Welcome(88L, key, challenge, 24454, 48.0, "voice.example.test");
        ControlCodec.Welcome restored = ControlCodec.decodeWelcome(ControlCodec.encodeWelcome(welcome));
        equal(88L, restored.sessionId(), "welcome session");
        equal(24454, restored.port(), "welcome port");
        close(48.0, restored.voiceRadius(), 0.0, "welcome radius");
        equal("voice.example.test", restored.publicHost(), "welcome host");
        check(Arrays.equals(key, restored.key()), "welcome key");
        check(Arrays.equals(challenge, restored.challenge()), "welcome challenge");
        byte[] malformed = ControlCodec.encodeClientHello(1);
        malformed[4] = 99;
        throwsProtocol(() -> ControlCodec.decodeClientHello(malformed), "control version mismatch rejected");
    }

    private void controlRosterRoundTrips() throws Exception {
        UUID connected = UUID.randomUUID();
        UUID muted = UUID.randomUUID();
        List<ControlCodec.RosterEntry> entries = List.of(
                new ControlCodec.RosterEntry(connected, ControlCodec.ROSTER_FLAG_CONNECTED),
                new ControlCodec.RosterEntry(muted,
                        ControlCodec.ROSTER_FLAG_CONNECTED | ControlCodec.ROSTER_FLAG_MUTED));
        ControlCodec.Roster roster = ControlCodec.decodeRoster(ControlCodec.encodeRoster(7L, entries));
        equal(7L, roster.revision(), "roster revision");
        equal(2, roster.entries().size(), "roster size");
        equal(connected, roster.entries().get(0).playerId(), "connected roster player");
        check(roster.entries().get(0).connected(), "connected roster flag");
        check(!roster.entries().get(0).muted(), "unmuted roster flag");
        check(roster.entries().get(1).muted(), "muted roster flag");

        byte[] invalidFlags = ControlCodec.encodeRoster(8L, entries);
        invalidFlags[invalidFlags.length - 1] = (byte) 0x40;
        throwsProtocol(() -> ControlCodec.decodeRoster(invalidFlags), "unknown roster flags rejected");
        throwsProtocol(() -> ControlCodec.encodeRoster(0L, entries), "zero roster revision rejected");
    }

    private void preAuthenticationFloodIsBoundedWithoutEndpointStateGrowth() throws Exception {
        AtomicLong nanos = new AtomicLong(1_000L);
        PreAuthRateLimiter limiter = new PreAuthRateLimiter(
                4,
                3.0, 1.0,
                4_096.0, 1_024.0,
                2.0, 1.0,
                4_096.0, 1_024.0,
                nanos::get);
        equal(4, limiter.endpointStripeCount(), "endpoint limiter has fixed storage");

        long now = 1_700_000_000_000L;
        SessionRegistry sessions = new SessionRegistry();
        VoiceSession session = sessions.create(UUID.randomUUID(), "FloodTarget", now);
        PacketCodec codec = new PacketCodec();
        VoiceRelayEngine engine = new VoiceRelayEngine(
                sessions, 48.0, new MutableClock(now), codec, limiter);
        InetSocketAddress remote = new InetSocketAddress("127.0.0.1", 33001);
        byte[] wrongKey = bytes(Protocol.KEY_BYTES, 99);
        for (long sequence = 1; sequence <= 10; sequence++) {
            byte[] unauthenticated = codec.encode(
                    PacketType.ASSOCIATE,
                    session.sessionId(),
                    sequence,
                    session.challenge(),
                    wrongKey,
                    Direction.CLIENT_TO_SERVER);
            check(engine.handle(unauthenticated, remote).isEmpty(),
                    "unauthenticated flood packet is never answered");
        }
        RelayMetrics.Snapshot metrics = engine.metrics().snapshot();
        equal(10L, metrics.received(), "all flood datagrams counted");
        equal(2L, metrics.rejected(), "only admitted flood packets reach authentication");
        equal(8L, metrics.rateLimited(), "remaining flood rejected before AES-GCM");
        equal(0L, metrics.authenticated(), "flood did not authenticate");

        for (int index = 0; index < 10_000; index++) {
            limiter.allow(new InetSocketAddress("192.0.2." + (index & 0xff), 1024 + (index % 50_000)), 64);
        }
        equal(4, limiter.endpointStripeCount(),
                "rotating spoofed endpoints cannot allocate limiter entries");

        int admittedForSession = 0;
        while (session.allowPreAuthDatagram(64)) admittedForSession++;
        check(admittedForSession > 0 && admittedForSession <= 192,
                "session pre-authentication budget is independently bounded");
    }

    private void endpointRejectionDoesNotDrainGlobalAdmissionBudget() {
        AtomicLong nanos = new AtomicLong(1_000L);
        PreAuthRateLimiter limiter = new PreAuthRateLimiter(
                4,
                2.0, 1.0,
                4_096.0, 1_024.0,
                1.0, 1.0,
                4_096.0, 1_024.0,
                nanos::get);
        InetSocketAddress noisy = new InetSocketAddress("192.0.2.10", 34001);
        InetSocketAddress legitimate = null;
        for (int port = 34002; port < 35000; port++) {
            InetSocketAddress candidate = new InetSocketAddress("198.51.100.20", port);
            if (limiter.endpointStripeIndex(candidate) != limiter.endpointStripeIndex(noisy)) {
                legitimate = candidate;
                break;
            }
        }
        check(legitimate != null, "test endpoints occupy independent fixed stripes");
        InetSocketAddress capped = null;
        for (int port = 35001; port < 36000; port++) {
            InetSocketAddress candidate = new InetSocketAddress("203.0.113.30", port);
            int candidateStripe = limiter.endpointStripeIndex(candidate);
            if (candidateStripe != limiter.endpointStripeIndex(noisy)
                    && candidateStripe != limiter.endpointStripeIndex(legitimate)) {
                capped = candidate;
                break;
            }
        }
        check(capped != null, "global-cap endpoint occupies a third fixed stripe");
        check(limiter.allow(noisy, 64), "noisy endpoint receives its one-packet burst");
        check(!limiter.allow(noisy, 64), "noisy endpoint is then rejected locally");
        check(limiter.allow(legitimate, 64),
                "endpoint-denied traffic did not spend the remaining global token");
        check(!limiter.allow(capped, 64),
                "aggregate global cap still applies after two admitted endpoints");
    }

    private void relayAssociatesAndRoutesAuthenticatedVoice() throws Exception {
        long now = 1_700_000_000_000L;
        MutableClock clock = new MutableClock(now);
        SessionRegistry sessions = new SessionRegistry();
        VoiceSession alex = sessions.create(UUID.randomUUID(), "Alex", now);
        VoiceSession sam = sessions.create(UUID.randomUUID(), "Sam", now);
        PacketCodec codec = new PacketCodec();
        VoiceRelayEngine engine = new VoiceRelayEngine(sessions, 32.0, clock, codec);
        engine.setSnapshots(Map.of(
                alex.playerId(), snapshot(alex.playerId(), "world", 0, 64, 0, true),
                sam.playerId(), snapshot(sam.playerId(), "world", 6, 64, 8, true)));
        InetSocketAddress alexAddress = new InetSocketAddress("127.0.0.1", 31001);
        InetSocketAddress samAddress = new InetSocketAddress("127.0.0.1", 31002);
        associate(engine, codec, alex, alexAddress, 1);
        associate(engine, codec, sam, samAddress, 1);
        equal(2L, sessions.associatedCount(), "both sessions associated");

        byte[] opus = new byte[]{11, 22, 33, 44, 55};
        byte[] datagram = codec.encode(PacketType.VOICE, alex.sessionId(), 2L, opus,
                alex.key(), Direction.CLIENT_TO_SERVER);
        List<OutboundDatagram> routed = engine.handle(datagram, alexAddress);
        equal(1, routed.size(), "one nearby recipient");
        equal(samAddress, routed.get(0).destination(), "routed destination");
        DecodedPacket received = codec.decode(codec.readEnvelope(routed.get(0).data()),
                sam.key(), Direction.SERVER_TO_CLIENT);
        equal(PacketType.VOICE, received.type(), "routed packet type");
        VoiceFrame frame = VoiceFrameCodec.decode(received.payload());
        equal(alex.playerId(), frame.sourcePlayerId(), "trusted source UUID attached by relay");
        check(Arrays.equals(opus, frame.opusFrame()), "Opus frame preserved");
        equal(1L, engine.metrics().snapshot().voiceFrames(), "voice metric");
        equal(1L, engine.metrics().snapshot().routedRecipients(), "recipient metric");

        engine.setSnapshots(Map.of(
                alex.playerId(), snapshot(alex.playerId(), "world", 0, 64, 0, true),
                sam.playerId(), snapshot(sam.playerId(), "nether", 1, 64, 1, true)));
        byte[] isolated = codec.encode(PacketType.VOICE, alex.sessionId(), 3L, opus,
                alex.key(), Direction.CLIENT_TO_SERVER);
        check(engine.handle(isolated, alexAddress).isEmpty(), "cross-world audio not routed");
    }

    private void relayBoundsAggregateVoiceDeliveries() throws Exception {
        long now = 1_700_000_000_000L;
        AtomicLong nanos = new AtomicLong(1_000L);
        SessionRegistry sessions = new SessionRegistry();
        VoiceSession source = sessions.create(new UUID(0L, 101L), "Source", now);
        VoiceSession first = sessions.create(new UUID(0L, 102L), "First", now);
        VoiceSession second = sessions.create(new UUID(0L, 103L), "Second", now);
        VoiceSession third = sessions.create(new UUID(0L, 104L), "Third", now);
        PacketCodec codec = new PacketCodec();
        VoiceRelayEngine engine = new VoiceRelayEngine(
                sessions,
                48.0,
                new MutableClock(now),
                codec,
                new PreAuthRateLimiter(),
                new TokenBucket(2.0, 1.0, nanos::get));
        engine.setSnapshots(Map.of(
                source.playerId(), snapshot(source.playerId(), "world", 0, 64, 0, true),
                first.playerId(), snapshot(first.playerId(), "world", 1, 64, 0, true),
                second.playerId(), snapshot(second.playerId(), "world", 2, 64, 0, true),
                third.playerId(), snapshot(third.playerId(), "world", 3, 64, 0, true)));
        InetSocketAddress sourceAddress = new InetSocketAddress("127.0.0.1", 32101);
        associate(engine, codec, source, sourceAddress, 1L);
        associate(engine, codec, first, new InetSocketAddress("127.0.0.1", 32102), 1L);
        associate(engine, codec, second, new InetSocketAddress("127.0.0.1", 32103), 1L);
        associate(engine, codec, third, new InetSocketAddress("127.0.0.1", 32104), 1L);

        byte[] voice = codec.encode(PacketType.VOICE, source.sessionId(), 2L, new byte[]{7, 8, 9},
                source.key(), Direction.CLIENT_TO_SERVER);
        equal(2, engine.handle(voice, sourceAddress).size(),
                "aggregate delivery budget bounds one frame's amplification");
        check(engine.metrics().snapshot().rateLimited() >= 1,
                "delivery budget exhaustion is observable in rate-limit metrics");
    }

    private void relayRejectsWrongEndpointReplayAndMutedAudio() throws Exception {
        long now = 1_700_000_000_000L;
        SessionRegistry sessions = new SessionRegistry();
        VoiceSession source = sessions.create(UUID.randomUUID(), "Source", now);
        VoiceSession target = sessions.create(UUID.randomUUID(), "Target", now);
        PacketCodec codec = new PacketCodec();
        VoiceRelayEngine engine = new VoiceRelayEngine(sessions, 48.0, new MutableClock(now), codec);
        engine.setSnapshots(Map.of(
                source.playerId(), snapshot(source.playerId(), "world", 0, 0, 0, true),
                target.playerId(), snapshot(target.playerId(), "world", 1, 0, 0, true)));
        InetSocketAddress sourceAddress = new InetSocketAddress("127.0.0.1", 32001);
        InetSocketAddress targetAddress = new InetSocketAddress("127.0.0.1", 32002);
        associate(engine, codec, source, sourceAddress, 1);
        associate(engine, codec, target, targetAddress, 1);

        byte[] voice = codec.encode(PacketType.VOICE, source.sessionId(), 2L, new byte[]{1, 2},
                source.key(), Direction.CLIENT_TO_SERVER);
        InetSocketAddress attackerAddress = new InetSocketAddress("127.0.0.1", 32999);
        check(engine.handle(voice, attackerAddress).isEmpty(), "valid key from unassociated endpoint rejected");
        equal(1, engine.handle(voice, sourceAddress).size(),
                "wrong endpoint cannot consume the legitimate endpoint's sequence");
        check(engine.handle(voice, sourceAddress).isEmpty(), "legitimate packet replay is rejected");

        byte[] mute = codec.encode(PacketType.STATE, source.sessionId(), 3L, new byte[]{1},
                source.key(), Direction.CLIENT_TO_SERVER);
        check(!engine.handle(mute, sourceAddress).isEmpty(), "mute state acknowledged");
        byte[] mutedVoice = codec.encode(PacketType.VOICE, source.sessionId(), 4L, new byte[]{3, 4},
                source.key(), Direction.CLIENT_TO_SERVER);
        check(engine.handle(mutedVoice, sourceAddress).isEmpty(), "muted source audio discarded");
        check(source.muted(), "session records muted state");

        byte[] tampered = codec.encode(PacketType.PING, source.sessionId(), 5L, new byte[0],
                source.key(), Direction.CLIENT_TO_SERVER);
        tampered[tampered.length - 1] ^= 1;
        check(engine.handle(tampered, sourceAddress).isEmpty(), "tampered datagram dropped");
        check(engine.metrics().snapshot().rejected() >= 2, "rejections counted");
    }

    private void udpSocketRelayAcknowledgesAssociation() throws Exception {
        long now = System.currentTimeMillis();
        SessionRegistry sessions = new SessionRegistry();
        VoiceSession session = sessions.create(UUID.randomUUID(), "SocketUser", now);
        PacketCodec codec = new PacketCodec();
        VoiceRelayEngine engine = new VoiceRelayEngine(sessions, 48.0);
        java.util.ArrayList<String> errors = new java.util.ArrayList<>();
        try (VoiceRelayServer server = new VoiceRelayServer(engine, errors::add);
             DatagramSocket client = new DatagramSocket(new InetSocketAddress("127.0.0.1", 0))) {
            client.setSoTimeout(2_000);
            int port = server.start("127.0.0.1", 0);
            check(port > 0, "UDP relay bound an ephemeral port");
            byte[] request = codec.encode(PacketType.ASSOCIATE, session.sessionId(), 1L,
                    session.challenge(), session.key(), Direction.CLIENT_TO_SERVER);
            client.send(new DatagramPacket(request, request.length,
                    new InetSocketAddress("127.0.0.1", port)));
            byte[] responseBuffer = new byte[Protocol.MAX_DATAGRAM_BYTES];
            DatagramPacket response = new DatagramPacket(responseBuffer, responseBuffer.length);
            client.receive(response);
            byte[] responseData = Arrays.copyOfRange(response.getData(), response.getOffset(),
                    response.getOffset() + response.getLength());
            DecodedPacket ack = codec.decode(codec.readEnvelope(responseData),
                    session.key(), Direction.SERVER_TO_CLIENT);
            equal(PacketType.ACK, ack.type(), "live UDP association acknowledgement");
            check(session.endpoint() != null, "live UDP endpoint associated");
            check(errors.isEmpty(), "live UDP relay reported no errors");
        }
    }

    private void unexpectedUdpReceiverFailureIsTerminalAndObservable() throws Exception {
        VoiceRelayEngine engine = new VoiceRelayEngine(new SessionRegistry(), 48.0);
        java.util.ArrayList<String> errors = new java.util.ArrayList<>();
        try (VoiceRelayServer server = new VoiceRelayServer(engine, errors::add)) {
            server.start("127.0.0.1", 0);
            Field socketField = VoiceRelayServer.class.getDeclaredField("socket");
            socketField.setAccessible(true);
            DatagramSocket socket = (DatagramSocket) socketField.get(server);
            socket.close(); // Deliberately bypass close() to simulate unexpected receiver failure.
            await(() -> !server.running(), 2_000L,
                    "unexpected socket closure stops the receiver");
            check(!server.lastError().isBlank(), "receiver failure records an error");
            check(!errors.isEmpty(), "receiver failure reaches the error sink");
            equal(0, server.boundPort(), "failed receiver does not advertise a live port");
        }
    }

    private void lifecyclePreservesStartupAndReceiverErrorsOnDisable() {
        equal("error", RelayLifecycle.currentState(false, false, false,
                        "invalid config", ""),
                "invalid startup config reports error");
        equal("error", RelayLifecycle.stateAfterDisable("invalid config", ""),
                "disable cannot overwrite startup error with stopped");
        equal("error", RelayLifecycle.stateAfterDisable("", "receiver failed"),
                "disable preserves receiver failure");
        equal("stopped", RelayLifecycle.stateAfterDisable("", ""),
                "clean disable reports stopped");
        equal("error", RelayLifecycle.stateAfterDisable(null, "receiver failed"),
                "null startup message cannot hide receiver failure");
        equal("disabled", RelayLifecycle.currentState(true, false, false, "", ""),
                "configuration-disabled relay reports disabled while loaded");
    }

    private void sessionRegistryReplacesAndExpiresSessions() {
        SessionRegistry sessions = new SessionRegistry();
        UUID player = UUID.randomUUID();
        VoiceSession first = sessions.create(player, "Player", 1_000L);
        VoiceSession second = sessions.create(player, "Player", 2_000L);
        check(first.destroyed(), "replaced session key material destroyed");
        equal(1, sessions.size(), "one session per player");
        equal(second.sessionId(), sessions.getByPlayer(player).orElseThrow().sessionId(), "replacement active");
        equal(0, sessions.pruneIdle(3_000L, 2_000L), "timeout edge retained");
        equal(1, sessions.pruneIdle(4_001L, 2_000L), "idle session expired");
        equal(0, sessions.size(), "expired session removed");
    }

    private void statusFileIsAtomicAndEscaped() throws Exception {
        Path folder = Files.createTempDirectory("proximity-voice-status-");
        Path file = folder.resolve("status.json");
        try {
            RelayStatus status = new RelayStatus("running", Protocol.VERSION, "0.0.0.0",
                    "voice.example.test", 24454, 48.0, 2, 1,
                    new RelayMetrics().snapshot(), "quote \" and newline\n", Instant.EPOCH.toString());
            StatusFileWriter.write(file, status);
            String json = Files.readString(file);
            check(json.contains("\"state\": \"running\""), "status state serialized");
            check(json.contains("\"transport\": \"udp\""), "status declares UDP transport");
            check(json.contains("\"udpReachability\": \"not-verified\""),
                    "status does not pretend public UDP reachability was tested");
            check(json.contains("UDP port 24454 must be reachable separately from Minecraft TCP"),
                    "status exposes separate UDP mapping requirement");
            check(json.contains("quote \\\" and newline"), "status JSON escapes quotes");
            check(!json.contains("newline\n\""), "control newline sanitized from status value");
            try (var children = Files.list(folder)) {
                equal(1L, children.count(), "temporary status file removed");
            }
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(folder);
        }
    }

    private static void associate(
            VoiceRelayEngine engine,
            PacketCodec codec,
            VoiceSession session,
            InetSocketAddress address,
            long sequence
    ) throws Exception {
        byte[] request = codec.encode(PacketType.ASSOCIATE, session.sessionId(), sequence,
                session.challenge(), session.key(), Direction.CLIENT_TO_SERVER);
        List<OutboundDatagram> responses = engine.handle(request, address);
        if (responses.size() != 1) throw new AssertionError("association was not acknowledged");
        DecodedPacket ack = codec.decode(codec.readEnvelope(responses.get(0).data()),
                session.key(), Direction.SERVER_TO_CLIENT);
        if (ack.type() != PacketType.ACK || ack.payload().length != 1
                || Byte.toUnsignedInt(ack.payload()[0]) != PacketType.ASSOCIATE.id()) {
            throw new AssertionError("association acknowledgement was invalid");
        }
    }

    private static PlayerSnapshot snapshot(
            UUID id, String world, double x, double y, double z, boolean enabled
    ) {
        return new PlayerSnapshot(id, world, x, y, z, enabled);
    }

    private static byte[] bytes(int length, int seed) {
        byte[] value = new byte[length];
        for (int index = 0; index < length; index++) value[index] = (byte) (seed + index * 13);
        return value;
    }

    private static void await(BooleanSupplier condition, long timeoutMillis, String message)
            throws InterruptedException {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) {
            Thread.sleep(10L);
        }
        if (!condition.getAsBoolean()) throw new AssertionError(message);
    }

    private void throwsProtocol(ThrowingRunnable action, String message) {
        assertions++;
        try {
            action.run();
        } catch (ProtocolException expected) {
            return;
        } catch (Exception other) {
            throw new AssertionError(message + ": wrong exception " + other, other);
        }
        throw new AssertionError(message);
    }

    private void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private void equal(Object expected, Object actual, String message) {
        assertions++;
        if (!expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    private void close(double expected, double actual, double tolerance, String message) {
        assertions++;
        if (Math.abs(expected - actual) > tolerance) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final class MutableClock extends Clock {
        private final AtomicLong millis;

        private MutableClock(long millis) {
            this.millis = new AtomicLong(millis);
        }

        @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return Instant.ofEpochMilli(millis.get()); }
        @Override public long millis() { return millis.get(); }
    }
}
