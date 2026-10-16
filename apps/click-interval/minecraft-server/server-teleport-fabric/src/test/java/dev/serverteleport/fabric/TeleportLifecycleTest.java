package dev.serverteleport.fabric;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TeleportLifecycleTest {
    private String source() throws Exception {
        return Files.readString(Path.of("src/main/java/dev/serverteleport/fabric/ServerTeleportFabric.java"));
    }

    @Test void loadsInIntegratedClientsWithoutClientClassesOrProtectionDependency() throws Exception {
        String metadata = Files.readString(Path.of("src/main/resources/fabric.mod.json"));
        assertTrue(metadata.contains("\"environment\": \"*\""));
        assertFalse(metadata.contains("serverprotection"));
        assertFalse(source().contains("net.minecraft.client"));
    }

    @Test void worldStartAndStopResetAllSessionStateAndStaticServerReferences() throws Exception {
        String source = source();
        int start = source.indexOf("private void onServerStarting(");
        int reset = source.indexOf("private void clearSessionState(");
        int stop = source.indexOf("private void onServerStopping(");
        int tick = source.indexOf("private void onServerTick(");
        assertTrue(source.substring(start, reset).contains("clearSessionState()"));
        assertTrue(source.substring(start, reset).contains("minecraftServer.isDedicatedServer()"));
        String cleanup = source.substring(reset, stop);
        for (String expected : new String[]{"randomNativeTest.close()", "requests.clear()",
                "returnLocations.clear()", "recentPvpUntil.clear()", "pendingTeleports.clear()",
                "destinationLoads.clear()", "preparationTickets.clear()", "loginGuards.clear()",
                "clearArrivalGuards()", "sentTerrain.clear()", "locations = null"}) {
            assertTrue(cleanup.contains(expected), expected);
        }
        String stopping = source.substring(stop, tick);
        assertTrue(stopping.contains("activeInstance = null"));
        assertTrue(stopping.contains("activeServer = null"));
        assertTrue(stopping.contains("configFile = null"));
        assertTrue(stopping.contains("clearSessionState()"));
        assertTrue(source.contains("player.level().getServer() == activeInstance.activeServer"));
    }

    @Test void deathEventClearsPriorLifeButNotPlacesOrBackAndJobsCannotFollowRespawn() throws Exception {
        String source = source();
        assertTrue(source.contains("ServerLivingEntityEvents.AFTER_DEATH.register"));
        int reset = source.indexOf("List<TeleportRequest> resetPlayerLife(");
        int next = source.indexOf("private static ServerPlayer damagingPlayer(", reset);
        String life = source.substring(reset, next);
        assertTrue(life.contains("recentPvpUntil.remove(playerId)"));
        assertTrue(life.contains("cancelPendingTeleport(playerId)"));
        assertTrue(life.contains("requests.removePlayerAfterDeath(playerId)"));
        assertTrue(life.contains("cancelPendingTeleport(request.requesterId())"));
        assertTrue(life.contains("finishArrival(playerId)"));
        assertFalse(life.contains("returnLocations."));
        assertFalse(life.contains("locations."));
        assertTrue(source.contains("player != pending.player || !player.isAlive()"));
        assertTrue(source.contains("guard.player() == player && guard.state().acknowledge(true)"));
    }
}
