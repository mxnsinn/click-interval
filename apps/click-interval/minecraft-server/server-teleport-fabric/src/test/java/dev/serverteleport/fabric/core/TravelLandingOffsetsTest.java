package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TravelLandingOffsetsTest {
    @Test
    void ordinaryPlayerKeepsTheExactPrimaryDestination() {
        assertEquals(
                List.of(new TravelLandingOffsets.Offset(0.0, 0.0)),
                TravelLandingOffsets.candidates(true, false, false, 0.0, 0.0, 2.0, 4));
    }

    @Test
    void riddenBoatTriesExactDestinationThenNearbyFallbacks() {
        List<TravelLandingOffsets.Offset> candidates = TravelLandingOffsets.candidates(
                true, true, false, 0.0, 0.0, 2.0, 2);

        assertEquals(new TravelLandingOffsets.Offset(0.0, 0.0), candidates.getFirst());
        assertEquals(25, candidates.size());
        assertTrue(candidates.contains(new TravelLandingOffsets.Offset(-2.0, -2.0)));
        assertTrue(candidates.contains(new TravelLandingOffsets.Offset(4.0, 4.0)));
    }

    @Test
    void separatelyLedBoatKeepsItsRelativePreferenceAndAlsoGetsFallbacks() {
        List<TravelLandingOffsets.Offset> candidates = TravelLandingOffsets.candidates(
                false, true, false, 3.0, -2.0, 2.0, 1);

        assertEquals(new TravelLandingOffsets.Offset(3.0, -2.0), candidates.getFirst());
        assertEquals(9, candidates.size());
        assertTrue(candidates.contains(new TravelLandingOffsets.Offset(2.0, 2.0)));
    }

    @Test
    void exactSavedDestinationNeverAddsHorizontalOrVerticalFallbacks() {
        assertEquals(
                List.of(new TravelLandingOffsets.Offset(0.0, 0.0)),
                TravelLandingOffsets.candidates(true, true, true, 0.0, 0.0, 2.0, 4));
        assertEquals(List.of(0), TravelLandingOffsets.verticalOffsets(true, true, true));
    }

    @Test
    void mountedTravelerDestinationCompensatesForVehicleRootOffset() {
        TravelLandingOffsets.Position rootDestination = TravelLandingOffsets.exactRootDestination(
                100.25, 64.0, -30.75,
                12.0, 70.0, 8.0,
                12.5, 71.25, 7.75);

        assertEquals(99.75, rootDestination.x());
        assertEquals(62.75, rootDestination.y());
        assertEquals(-30.5, rootDestination.z());
    }
}
