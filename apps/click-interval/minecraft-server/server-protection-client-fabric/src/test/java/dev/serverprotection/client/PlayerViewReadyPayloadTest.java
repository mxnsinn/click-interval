package dev.serverprotection.client;

import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PlayerViewReadyPayloadTest {
    @Test
    void currentCompanionNegotiatesBothLiveAndUpgradedServerProtocols() {
        PlayerViewReadyPayload readiness = PlayerViewReadyPayload.current();

        assertTrue(readiness.supports(PlayerViewPayload.LEGACY_PROTOCOL_VERSION));
        assertTrue(readiness.supports(PlayerViewPayload.PROTOCOL_VERSION));
        assertFalse(readiness.supports(PlayerViewPayload.PROTOCOL_VERSION + 1));
    }

    @Test
    void rejectsInvertedOrUnboundedProtocolRanges() {
        assertThrows(IllegalArgumentException.class, () -> new PlayerViewReadyPayload(0, 2));
        assertThrows(IllegalArgumentException.class, () -> new PlayerViewReadyPayload(2, 1));
        assertThrows(IllegalArgumentException.class, () -> new PlayerViewReadyPayload(1, 1_001));
    }
}
