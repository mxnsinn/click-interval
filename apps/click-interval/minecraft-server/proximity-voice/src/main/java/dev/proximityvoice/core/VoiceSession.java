package dev.proximityvoice.core;

import java.net.SocketAddress;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

public final class VoiceSession {
    private static final double PACKET_BURST = 120.0;
    private static final double PACKETS_PER_SECOND = 80.0;
    private static final double BYTE_BURST = 192.0 * 1024.0;
    private static final double BYTES_PER_SECOND = 96.0 * 1024.0;
    private static final double PRE_AUTH_PACKET_BURST = 192.0;
    private static final double PRE_AUTH_PACKETS_PER_SECOND = 120.0;
    private static final double PRE_AUTH_BYTE_BURST = 256.0 * 1024.0;
    private static final double PRE_AUTH_BYTES_PER_SECOND = 128.0 * 1024.0;

    private final long sessionId;
    private final UUID playerId;
    private final String playerName;
    private final byte[] key;
    private final byte[] challenge;
    private final ReplayWindow inboundReplay = new ReplayWindow();
    private final AtomicLong outboundSequence = new AtomicLong(1L);
    private final TokenBucket packetRate;
    private final TokenBucket byteRate;
    private final TokenBucket preAuthPacketRate;
    private final TokenBucket preAuthByteRate;
    private volatile SocketAddress endpoint;
    private volatile boolean muted;
    private volatile long lastActivityMillis;
    private volatile boolean destroyed;

    public VoiceSession(
            long sessionId,
            UUID playerId,
            String playerName,
            byte[] key,
            byte[] challenge,
            long nowMillis
    ) {
        this(sessionId, playerId, playerName, key, challenge, nowMillis,
                new TokenBucket(PACKET_BURST, PACKETS_PER_SECOND),
                new TokenBucket(BYTE_BURST, BYTES_PER_SECOND),
                new TokenBucket(PRE_AUTH_PACKET_BURST, PRE_AUTH_PACKETS_PER_SECOND),
                new TokenBucket(PRE_AUTH_BYTE_BURST, PRE_AUTH_BYTES_PER_SECOND));
    }

    VoiceSession(
            long sessionId,
            UUID playerId,
            String playerName,
            byte[] key,
            byte[] challenge,
            long nowMillis,
            TokenBucket packetRate,
            TokenBucket byteRate,
            TokenBucket preAuthPacketRate,
            TokenBucket preAuthByteRate
    ) {
        if (sessionId == 0L) throw new IllegalArgumentException("sessionId cannot be zero");
        if (key == null || key.length != Protocol.KEY_BYTES) throw new IllegalArgumentException("invalid key");
        if (challenge == null || challenge.length != Protocol.CHALLENGE_BYTES) {
            throw new IllegalArgumentException("invalid challenge");
        }
        this.sessionId = sessionId;
        this.playerId = Objects.requireNonNull(playerId, "playerId");
        this.playerName = sanitizePlayerName(playerName);
        this.key = key.clone();
        this.challenge = challenge.clone();
        this.lastActivityMillis = nowMillis;
        this.packetRate = Objects.requireNonNull(packetRate, "packetRate");
        this.byteRate = Objects.requireNonNull(byteRate, "byteRate");
        this.preAuthPacketRate = Objects.requireNonNull(preAuthPacketRate, "preAuthPacketRate");
        this.preAuthByteRate = Objects.requireNonNull(preAuthByteRate, "preAuthByteRate");
    }

    public long sessionId() {
        return sessionId;
    }

    public UUID playerId() {
        return playerId;
    }

    public String playerName() {
        return playerName;
    }

    public byte[] key() {
        return key.clone();
    }

    byte[] keyMaterial() {
        return key;
    }

    public byte[] challenge() {
        return challenge.clone();
    }

    public boolean verifyChallenge(byte[] supplied) {
        return supplied != null && java.security.MessageDigest.isEqual(challenge, supplied);
    }

    public boolean acceptInboundSequence(long sequence) {
        return !destroyed && inboundReplay.accept(sequence);
    }

    public long nextOutboundSequence() throws ProtocolException {
        long sequence = outboundSequence.getAndIncrement();
        if (sequence <= 0L) throw new ProtocolException("Session sequence is exhausted; reconnect required.");
        return sequence;
    }

    public boolean allowDatagram(int bytes) {
        if (destroyed || bytes <= 0 || bytes > Protocol.MAX_DATAGRAM_BYTES) return false;
        if (!packetRate.tryConsume(1.0)) return false;
        return byteRate.tryConsume(bytes);
    }

    /** Limits AES-GCM attempts independently from the authenticated traffic budget. */
    public boolean allowPreAuthDatagram(int bytes) {
        if (destroyed || bytes <= 0 || bytes > Protocol.MAX_DATAGRAM_BYTES) return false;
        if (!preAuthPacketRate.tryConsume(1.0)) return false;
        return preAuthByteRate.tryConsume(bytes);
    }

    public SocketAddress endpoint() {
        return endpoint;
    }

    public void associate(SocketAddress endpoint, long nowMillis) {
        if (destroyed) return;
        this.endpoint = Objects.requireNonNull(endpoint, "endpoint");
        this.lastActivityMillis = nowMillis;
    }

    public boolean isAssociatedWith(SocketAddress address) {
        return endpoint != null && endpoint.equals(address);
    }

    public boolean muted() {
        return muted;
    }

    public void setMuted(boolean muted) {
        this.muted = muted;
    }

    public long lastActivityMillis() {
        return lastActivityMillis;
    }

    public void touch(long nowMillis) {
        if (!destroyed) lastActivityMillis = nowMillis;
    }

    public boolean destroyed() {
        return destroyed;
    }

    public void destroy() {
        destroyed = true;
        endpoint = null;
        Arrays.fill(key, (byte) 0);
        Arrays.fill(challenge, (byte) 0);
    }

    private static String sanitizePlayerName(String value) {
        String clean = String.valueOf(value == null ? "" : value).replaceAll("[^A-Za-z0-9_]", "");
        clean = clean.substring(0, Math.min(16, clean.length()));
        return clean.isEmpty() ? "Player" : clean;
    }
}
