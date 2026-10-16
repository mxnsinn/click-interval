package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class LoginSafetyStateTest {
    @Test
    void preservesIntendedCoordinatesUntilChunkIsReadyForConsecutiveTicks() {
        LoginSafetyState state = new LoginSafetyState(
                1_000L, "minecraft:the_nether", 10.25, 72.0, -4.75, 90.0f, 12.0f);

        assertEquals(10.25, state.x());
        assertEquals(72.0, state.y());
        assertEquals(-4.75, state.z());
        assertEquals(LoginSafetyState.Status.HOLD,
                state.update(1_050L, "minecraft:the_nether", false));
        assertEquals(LoginSafetyState.Status.HOLD,
                state.update(1_100L, "minecraft:the_nether", true));
        assertEquals(LoginSafetyState.Status.RELEASE,
                state.update(1_150L, "minecraft:the_nether", true));
    }

    @Test
    void readinessMustBeConsecutiveAndFailureNeverReleasesIntoAnUnloadedChunk() {
        LoginSafetyState state = new LoginSafetyState(
                0L, "minecraft:the_end", 0.0, 64.0, 0.0, 0.0f, 0.0f);

        assertEquals(LoginSafetyState.Status.HOLD, state.update(10L, "minecraft:the_end", true));
        assertEquals(LoginSafetyState.Status.HOLD, state.update(20L, "minecraft:the_end", false));
        assertEquals(LoginSafetyState.Status.HOLD, state.update(30L, "minecraft:the_end", true));
        assertEquals(LoginSafetyState.Status.TIMED_OUT,
                state.update(LoginSafetyState.TIMEOUT_MILLIS, "minecraft:the_end", false));
    }

    @Test
    void anIntentionalDimensionChangeStopsHoldingTheOldPosition() {
        LoginSafetyState state = new LoginSafetyState(
                0L, "minecraft:overworld", 0.0, 64.0, 0.0, 0.0f, 0.0f);
        assertEquals(LoginSafetyState.Status.DIMENSION_CHANGED,
                state.update(10L, "minecraft:the_nether", false));
    }
}
