package dev.serverprotection.client;

import net.minecraft.world.scores.Team;

/** Only the local camera-player exclusion may change; vanilla handles every other render rule. */
public final class SelfNameTagPolicy {
    private SelfNameTagPolicy() {}

    public static boolean allowCameraBypass(boolean enabled, boolean localPlayer, boolean ownCamera,
                                            boolean thirdPerson, boolean invisible, boolean spectator,
                                            boolean shadowPass, Team.Visibility visibility) {
        if (!enabled || !localPlayer || !ownCamera || !thirdPerson || invisible || spectator || shadowPass) {
            return false;
        }
        // The viewer is this same player, so it is necessarily on its own team.
        return visibility == null || visibility == Team.Visibility.ALWAYS
                || visibility == Team.Visibility.HIDE_FOR_OTHER_TEAMS;
    }
}
