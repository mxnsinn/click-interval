package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PlayerViewCommandSecurityTest {
    @Test
    void onlyPrivateDetachAndRetargetRootsAreAcceptedDuringView() {
        assertTrue(ServerProtectionFabric.isPlayerViewControlCommand("/ci-unspectate"));
        assertTrue(ServerProtectionFabric.isPlayerViewControlCommand("unspectate"));
        assertTrue(ServerProtectionFabric.isPlayerViewControlCommand("ci-spectate Friend"));
        assertTrue(ServerProtectionFabric.isPlayerViewControlCommand(
                "/serverprotection_fabric:ci-unspectate"));

        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/gamemode creative"));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/tp ~ ~ ~"));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/execute at Friend run setblock ~ ~ ~ air"));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/minecraft:ci-unspectate"));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/view coordinate Friend"));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand("/ci-spectate " + "x".repeat(300)));
        assertFalse(ServerProtectionFabric.isPlayerViewControlCommand(""));
    }

    @Test
    void suggestionRootParsingNeverTreatsArgumentsAsAuthority() {
        assertEquals("gamemode", ServerProtectionFabric.literalCommandRoot(" //gamemode survival"));
        assertEquals("example:manage", ServerProtectionFabric.literalCommandRoot("/example:manage target"));
        assertEquals("", ServerProtectionFabric.literalCommandRoot("/bad\u0000root value"));
    }

    @Test
    void forgedSuggestionsHonorActiveViewAndManagedStaleOpPolicy() {
        assertFalse(ServerProtectionFabric.shouldAllowCommandSuggestions(
                true, FabricAccessPolicy.CommandDecision.ELEVATE, false));
        assertFalse(ServerProtectionFabric.shouldAllowCommandSuggestions(
                false, FabricAccessPolicy.CommandDecision.DENY, false));
        assertTrue(ServerProtectionFabric.shouldAllowCommandSuggestions(
                false, FabricAccessPolicy.CommandDecision.ELEVATE, true));
        assertTrue(ServerProtectionFabric.shouldAllowCommandSuggestions(
                false, FabricAccessPolicy.CommandDecision.BASELINE, true));
        assertFalse(ServerProtectionFabric.shouldAllowCommandSuggestions(
                false, FabricAccessPolicy.CommandDecision.VANILLA, true));
        assertTrue(ServerProtectionFabric.shouldAllowCommandSuggestions(
                false, FabricAccessPolicy.CommandDecision.VANILLA, false));
    }
}
