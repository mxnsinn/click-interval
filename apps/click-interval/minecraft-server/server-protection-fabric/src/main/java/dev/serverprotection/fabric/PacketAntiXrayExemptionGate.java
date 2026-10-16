package dev.serverprotection.fabric;

import java.util.UUID;
import java.util.function.Predicate;

/**
 * Bridges the persistent per-player anti-cheat switch into packet Anti-Xray without granting the
 * player operator status or a broad permission node.
 */
final class PacketAntiXrayExemptionGate {
    private final Predicate<UUID> exemptions;

    PacketAntiXrayExemptionGate(Predicate<UUID> exemptions) {
        if (exemptions == null) throw new IllegalArgumentException("exemptions");
        this.exemptions = exemptions;
    }

    boolean shouldBypass(UUID playerId) {
        return playerId != null && exemptions.test(playerId);
    }
}
