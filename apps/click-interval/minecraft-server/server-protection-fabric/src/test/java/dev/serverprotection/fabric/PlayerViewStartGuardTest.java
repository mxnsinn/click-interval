package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PlayerViewStartGuardTest {
    @Test
    void stableStandingPlayerIsAccepted() {
        assertTrue(rejection(true, false, false, false, false, false, false, true).isEmpty());
    }

    @Test
    void everyNonRestorableTransientStateIsRejected() {
        assertFalse(rejection(false, false, false, false, false, false, false, true).isEmpty());
        assertFalse(rejection(true, true, false, false, false, false, false, true).isEmpty());
        assertFalse(rejection(true, false, true, false, false, false, false, true).isEmpty());
        assertFalse(rejection(true, false, false, true, false, false, false, true).isEmpty());
        assertFalse(rejection(true, false, false, false, true, false, false, true).isEmpty());
        assertFalse(rejection(true, false, false, false, false, true, false, true).isEmpty());
        assertFalse(rejection(true, false, false, false, false, false, true, true).isEmpty());
        assertFalse(rejection(true, false, false, false, false, false, false, false).isEmpty());
    }

    private static String rejection(boolean alive, boolean changingDimension, boolean sleeping,
                                    boolean passenger, boolean vehicle, boolean fallFlying,
                                    boolean usingItem, boolean inventoryMenuActive) {
        return PlayerViewStartGuard.rejection(alive, changingDimension, sleeping, passenger,
                vehicle, fallFlying, usingItem, inventoryMenuActive);
    }
}
