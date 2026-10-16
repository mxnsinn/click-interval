package dev.proximityvoice.core;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public final class SessionRegistry {
    private final ConcurrentMap<Long, VoiceSession> bySession = new ConcurrentHashMap<>();
    private final ConcurrentMap<UUID, Long> byPlayer = new ConcurrentHashMap<>();
    private final SecureRandom random;

    public SessionRegistry() {
        this(new SecureRandom());
    }

    SessionRegistry(SecureRandom random) {
        this.random = random;
    }

    public synchronized VoiceSession create(UUID playerId, String playerName, long nowMillis) {
        removePlayer(playerId);
        long sessionId;
        do {
            sessionId = random.nextLong();
        } while (sessionId == 0L || bySession.containsKey(sessionId));
        byte[] key = new byte[Protocol.KEY_BYTES];
        byte[] challenge = new byte[Protocol.CHALLENGE_BYTES];
        random.nextBytes(key);
        random.nextBytes(challenge);
        VoiceSession session = new VoiceSession(sessionId, playerId, playerName, key, challenge, nowMillis);
        bySession.put(sessionId, session);
        byPlayer.put(playerId, sessionId);
        return session;
    }

    public Optional<VoiceSession> get(long sessionId) {
        return Optional.ofNullable(bySession.get(sessionId));
    }

    public Optional<VoiceSession> getByPlayer(UUID playerId) {
        Long sessionId = byPlayer.get(playerId);
        return sessionId == null ? Optional.empty() : get(sessionId);
    }

    boolean hasActivePlayer(UUID playerId) {
        Long sessionId = byPlayer.get(playerId);
        VoiceSession session = sessionId == null ? null : bySession.get(sessionId);
        return session != null && !session.destroyed();
    }

    public synchronized boolean removePlayer(UUID playerId) {
        Long sessionId = byPlayer.remove(playerId);
        if (sessionId == null) return false;
        VoiceSession session = bySession.remove(sessionId);
        if (session != null) session.destroy();
        return session != null;
    }

    public synchronized int pruneIdle(long nowMillis, long timeoutMillis) {
        if (timeoutMillis <= 0L) return 0;
        List<UUID> expired = new ArrayList<>();
        for (VoiceSession session : bySession.values()) {
            if (nowMillis - session.lastActivityMillis() > timeoutMillis) expired.add(session.playerId());
        }
        expired.forEach(this::removePlayer);
        return expired.size();
    }

    public Collection<VoiceSession> sessions() {
        return List.copyOf(bySession.values());
    }

    public int size() {
        return bySession.size();
    }

    public long associatedCount() {
        return bySession.values().stream().filter(session -> session.endpoint() != null).count();
    }

    public synchronized void clear() {
        bySession.values().forEach(VoiceSession::destroy);
        bySession.clear();
        byPlayer.clear();
    }
}
