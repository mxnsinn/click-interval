package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class DirectDestinationMatchTest {
    @Test
    void resolvesTheCompleteCollisionSafeTruthTable() {
        assertEquals(DirectDestinationMatch.SAVED_PLACE,
                DirectDestinationMatch.resolve(true, false));
        assertEquals(DirectDestinationMatch.ONLINE_PLAYER,
                DirectDestinationMatch.resolve(false, true));
        assertEquals(DirectDestinationMatch.AMBIGUOUS,
                DirectDestinationMatch.resolve(true, true));
        assertEquals(DirectDestinationMatch.NOT_FOUND,
                DirectDestinationMatch.resolve(false, false));
    }
}
