package dev.serverprotection.fabric;

import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Per-connection player-view protocol negotiation; absence always fails closed. */
final class PlayerViewNegotiation {
    private final ConcurrentHashMap<UUID, PlayerViewReadyPayload> clients = new ConcurrentHashMap<>();

    void announce(UUID playerId, PlayerViewReadyPayload readiness) {
        if (playerId != null && readiness != null) clients.put(playerId, readiness);
    }

    boolean supports(UUID playerId, int protocolVersion) {
        PlayerViewReadyPayload readiness = playerId == null ? null : clients.get(playerId);
        return readiness != null && readiness.supports(protocolVersion);
    }

    void remove(UUID playerId) {
        if (playerId != null) clients.remove(playerId);
    }

    void clear() {
        clients.clear();
    }
}
