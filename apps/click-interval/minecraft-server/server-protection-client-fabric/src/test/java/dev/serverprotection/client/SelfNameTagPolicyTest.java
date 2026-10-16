package dev.serverprotection.client;

import net.minecraft.world.scores.Team;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class SelfNameTagPolicyTest {
    @Test void visibleSelfIsAllowedOnlyWithAnAppropriateTeamRule() {
        assertTrue(allow(null));
        assertTrue(allow(Team.Visibility.ALWAYS));
        assertTrue(allow(Team.Visibility.HIDE_FOR_OTHER_TEAMS));
        assertFalse(allow(Team.Visibility.NEVER));
        assertFalse(allow(Team.Visibility.HIDE_FOR_OWN_TEAM));
    }

    @Test void everyPrivacyCameraAndPreferenceGateMustPass() {
        for (int mask = 0; mask < 128; mask++) {
            boolean enabled = (mask & 1) != 0;
            boolean self = (mask & 2) != 0;
            boolean ownCamera = (mask & 4) != 0;
            boolean thirdPerson = (mask & 8) != 0;
            boolean invisible = (mask & 16) != 0;
            boolean spectator = (mask & 32) != 0;
            boolean shadowPass = (mask & 64) != 0;
            assertEquals(mask == 15, SelfNameTagPolicy.allowCameraBypass(enabled, self, ownCamera,
                    thirdPerson, invisible, spectator, shadowPass, Team.Visibility.ALWAYS), "mask " + mask);
        }
    }

    @Test void remotePlayerNeverGetsAnExceptionForAnyTeamRule() {
        for (var visibility : Team.Visibility.values()) {
            assertFalse(SelfNameTagPolicy.allowCameraBypass(true, false, true, true, false, false, false, visibility));
        }
    }

    private static boolean allow(Team.Visibility visibility) {
        return SelfNameTagPolicy.allowCameraBypass(true, true, true, true, false, false, false, visibility);
    }
}
