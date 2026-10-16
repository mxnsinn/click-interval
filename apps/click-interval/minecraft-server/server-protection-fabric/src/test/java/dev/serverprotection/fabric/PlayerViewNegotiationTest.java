package dev.serverprotection.fabric;

import dev.serverprotection.fabric.playerview.PlayerViewPayload;
import dev.serverprotection.fabric.playerview.PlayerViewReadyPayload;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PlayerViewNegotiationTest {
    private static final UUID PLAYER = UUID.fromString("12345678-1234-4234-8234-1234567890ab");

    @Test
    void newServerAcceptsOnlyAnExplicitV2ReadyClient() {
        PlayerViewNegotiation negotiation = new PlayerViewNegotiation();
        assertFalse(negotiation.supports(PLAYER, PlayerViewPayload.PROTOCOL_VERSION),
                "an old companion sends no READY and must fail before any v2 payload is sent");

        negotiation.announce(PLAYER, PlayerViewReadyPayload.current());
        assertTrue(negotiation.supports(PLAYER, PlayerViewPayload.PROTOCOL_VERSION));

        negotiation.remove(PLAYER);
        assertFalse(negotiation.supports(PLAYER, PlayerViewPayload.PROTOCOL_VERSION),
                "disconnect must invalidate the negotiated connection");
    }

    @Test
    void protocolRangesAndChannelIdsKeepOldAndNewPairsSeparated() {
        PlayerViewNegotiation negotiation = new PlayerViewNegotiation();
        negotiation.announce(PLAYER, new PlayerViewReadyPayload(1, 1));
        assertTrue(negotiation.supports(PLAYER, PlayerViewPayload.LEGACY_PROTOCOL_VERSION));
        assertFalse(negotiation.supports(PLAYER, PlayerViewPayload.PROTOCOL_VERSION));
        assertNotEquals(PlayerViewPayload.LEGACY_TYPE.id(), PlayerViewPayload.TYPE.id(),
                "an old v1 decoder must never receive a v2 state packet on its legacy channel");
    }
}
