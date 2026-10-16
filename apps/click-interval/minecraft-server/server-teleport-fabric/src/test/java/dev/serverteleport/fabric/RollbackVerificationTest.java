package dev.serverteleport.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class RollbackVerificationTest {
    @Test
    void rollbackRequiresPositionsRidesAndLeashesToAllBeRestored() {
        assertTrue(ServerTeleportFabric.rollbackComplete(true, true, true));
        assertFalse(ServerTeleportFabric.rollbackComplete(false, true, true));
        assertFalse(ServerTeleportFabric.rollbackComplete(true, false, true));
        assertFalse(ServerTeleportFabric.rollbackComplete(true, true, false));
        assertFalse(ServerTeleportFabric.rollbackComplete(false, false, false));
    }
}
