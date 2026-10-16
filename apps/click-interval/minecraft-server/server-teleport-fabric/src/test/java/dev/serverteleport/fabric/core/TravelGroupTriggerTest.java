package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TravelGroupTriggerTest {
    @Test
    void onlyRecordedDestinationsRequireExactPlayerCoordinates() {
        assertFalse(TravelGroupTrigger.PLAYER_REQUEST.exactPlayerDestination());
        assertFalse(TravelGroupTrigger.RANDOM.exactPlayerDestination());
        assertTrue(TravelGroupTrigger.SAVED_PLACE.exactPlayerDestination());
        assertTrue(TravelGroupTrigger.BACK.exactPlayerDestination());
    }
}
