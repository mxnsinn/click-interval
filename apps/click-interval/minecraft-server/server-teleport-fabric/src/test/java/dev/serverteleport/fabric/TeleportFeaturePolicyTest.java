package dev.serverteleport.fabric;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

final class TeleportFeaturePolicyTest {
    private String source() throws Exception {
        return Files.readString(Path.of("src/main/java/dev/serverteleport/fabric/ServerTeleportFabric.java"));
    }

    @Test void allRoutesShareFinalDimensionAndReturnLockChecksBeforeFirstEntityMoves() throws Exception {
        String source = source();
        int travel = source.indexOf("private boolean teleportTravelGroup(");
        int requestedCheck = source.indexOf("travelAllowed(traveler, destination, requestedLanding)", travel);
        int actualCheck = source.indexOf("travelAllowed(traveler, destination, actualLanding)", requestedCheck);
        int firstMove = source.indexOf("root.teleportTo(", actualCheck);
        int arm = source.indexOf("returnLocks.arm(", firstMove);
        int allArrived = source.indexOf("arrived == null || arrived.level() != destination", firstMove);
        assertTrue(requestedCheck > travel && actualCheck > requestedCheck && firstMove > actualCheck);
        assertTrue(arm > allArrived && allArrived > firstMove);
        String lifecycle = source.substring(source.indexOf("private void onDisconnect("), source.indexOf("private void markRecentPvp("));
        assertFalse(lifecycle.contains("returnLocks.arm("));
        assertTrue(lifecycle.contains("clearDeathReturnLock(playerId)"));
    }

    @Test void directionalTrustUsesNormalAcceptanceAndCannotBypassFinalChecks() throws Exception {
        String source = source();
        assertTrue(source.contains("TeamBridge.trusts(target.getUUID(), requester.getUUID())"));
        assertTrue(source.contains("respond(target.createCommandSourceStack(), requester.getGameProfile().name(), true)"));
        assertFalse(TeamBridge.trusts(UUID.randomUUID(), UUID.randomUUID()), "no optional teams API means no auto-consent");
    }

    @Test void terrainPreparationRemainsBoundedAndDoesNotMoveTheClientCacheAtDeparture() throws Exception {
        String source = source();
        assertTrue(source.contains("destinationBounds(location, traveler).inflate(16, 0, 16)"));
        assertTrue(source.contains("root.setNoGravity(true)"));
        assertTrue(source.contains("guard.root().resetFallDistance()"));
        assertTrue(source.contains("player.connection.chunkSender.sendNextChunks(player)"));
        assertFalse(source.contains("new ClientboundSetChunkCacheCenterPacket"));
        assertFalse(source.contains("new ClientboundLevelChunkWithLightPacket"), "do not bypass Anti-Xray with raw chunk packets");
    }
}
