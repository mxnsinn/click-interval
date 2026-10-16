package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class TeleportWarmupStateTest {
    @Test
    void announcesTenThroughOnePrivatelyWithoutTreatingUnrelatedInputAsMovement() {
        TeleportWarmupState state = new TeleportWarmupState(1_000L, "minecraft:overworld", 4.0, 64.0, 8.0);

        List<Integer> announced = new ArrayList<>();
        announced.add(10); // dispatchTeleport sends the initial private-chat line.

        assertEquals(TeleportWarmupState.Status.WAITING,
                state.update(1_000L, "minecraft:overworld", 4.0, 64.0, 8.0, true).status());
        assertEquals(TeleportWarmupState.Status.WAITING,
                state.update(1_999L, "minecraft:overworld", 4.0, 64.0, 8.0, true).status());
        for (int expected = 9; expected >= 1; expected--) {
            long now = 1_000L + (10 - expected) * 1_000L;
            TeleportWarmupState.Update update = state.update(
                    now, "minecraft:overworld", 4.0, 64.0, 8.0, true);
            assertEquals(TeleportWarmupState.Status.COUNTDOWN, update.status());
            assertEquals(expected, update.secondsRemaining());
            announced.add(update.secondsRemaining());
            assertEquals(TeleportWarmupState.Status.WAITING,
                    state.update(now + 999L, "minecraft:overworld", 4.0, 64.0, 8.0, true).status());
        }
        assertEquals(TeleportWarmupState.Status.COMPLETE,
                state.update(11_000L, "minecraft:overworld", 4.0, 64.0, 8.0, true).status());
        assertEquals(List.of(10, 9, 8, 7, 6, 5, 4, 3, 2, 1), announced);
    }

    @Test
    void cancelsForAnyServerPositionChangeIncludingTinyPushes() {
        TeleportWarmupState state = new TeleportWarmupState(0L, "minecraft:the_nether", 0.0, 70.0, 0.0);

        assertEquals(TeleportWarmupState.Status.MOVED,
                state.update(100L, "minecraft:the_nether", Math.ulp(1.0), 70.0, 0.0, true).status());

        TeleportWarmupState vertical = new TeleportWarmupState(
                0L, "minecraft:the_nether", 0.0, 70.0, 0.0);
        assertEquals(TeleportWarmupState.Status.MOVED,
                vertical.update(100L, "minecraft:the_nether", 0.0, Math.nextUp(70.0), 0.0, true).status());

        TeleportWarmupState pushed = new TeleportWarmupState(
                0L, "minecraft:the_nether", 0.0, 70.0, 0.0);
        assertEquals(TeleportWarmupState.Status.MOVED,
                pushed.update(100L, "minecraft:the_nether", 0.0, 70.0, -0.01, true).status());
    }

    @Test
    void unchangedPositionAllowsLookingInventoryAndHotbarActivity() {
        TeleportWarmupState state = new TeleportWarmupState(
                0L, "minecraft:overworld", 12.25, 64.0, -9.75);

        // Those actions are intentionally absent from the position-only state contract.
        assertEquals(TeleportWarmupState.Status.WAITING,
                state.update(500L, "minecraft:overworld", 12.25, 64.0, -9.75, true).status());
    }

    @Test
    void dimensionChangesAndUnsafePlayerStateCancel() {
        TeleportWarmupState dimension = new TeleportWarmupState(0L, "minecraft:overworld", 0.0, 64.0, 0.0);
        assertEquals(TeleportWarmupState.Status.UNSAFE,
                dimension.update(100L, "minecraft:the_nether", 0.0, 64.0, 0.0, true).status());

        TeleportWarmupState unsafe = new TeleportWarmupState(0L, "minecraft:overworld", 0.0, 64.0, 0.0);
        assertEquals(TeleportWarmupState.Status.UNSAFE,
                unsafe.update(100L, "minecraft:overworld", 0.0, 64.0, 0.0, false).status());
    }
}
