package dev.proximityvoice.client.core;

import dev.proximityvoice.client.protocol.ControlCodec;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class VoiceRoster {
    private final ConcurrentHashMap<UUID, Entry> entries = new ConcurrentHashMap<>();
    private volatile long revision;
    private volatile boolean hasRevision;

    public synchronized boolean apply(ControlCodec.Roster roster) {
        if (roster == null || hasRevision && Long.compareUnsigned(roster.revision(), revision) <= 0) return false;
        Map<UUID, Entry> previous = Map.copyOf(entries);
        entries.clear();
        roster.players().forEach((id, state) -> {
            Entry old = previous.get(id);
            entries.put(id, new Entry(state.connected(), state.muted(), old == null ? 0L : old.lastVoiceMillis()));
        });
        revision = roster.revision();
        hasRevision = true;
        return true;
    }

    public void markSpeaking(UUID playerId, long nowMillis) {
        entries.compute(playerId, (id, current) -> current == null
                ? new Entry(true, false, nowMillis)
                : new Entry(current.connected(), current.muted(), nowMillis));
    }

    public Status status(UUID playerId, long nowMillis) {
        Entry entry = entries.get(playerId);
        if (entry == null || !entry.connected()) return Status.DISCONNECTED;
        if (entry.muted()) return Status.MUTED;
        return nowMillis - entry.lastVoiceMillis() <= 350L ? Status.SPEAKING : Status.IDLE;
    }

    public Map<UUID, Entry> snapshot() {
        return Map.copyOf(entries);
    }

    public synchronized void clear() {
        entries.clear();
        revision = 0L;
        hasRevision = false;
    }

    public enum Status { DISCONNECTED, MUTED, IDLE, SPEAKING }

    public record Entry(boolean connected, boolean muted, long lastVoiceMillis) {}
}
