package dev.serverprotection.fabric;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.GameType;

/** Restores and verifies the one piece of saved POV state not covered by teleportTo. */
final class PlayerViewOriginRestorer {
    private PlayerViewOriginRestorer() { }

    static boolean restoreGameMode(ServerPlayer viewer, String savedName) {
        if (viewer == null) return false;
        GameType expected = savedGameMode(savedName);
        if (expected == null) return false;
        if (viewer.gameMode() != expected) viewer.setGameMode(expected);
        return viewer.gameMode() == expected;
    }

    static boolean matchesGameMode(ServerPlayer viewer, String savedName) {
        GameType expected = savedGameMode(savedName);
        return viewer != null && expected != null && viewer.gameMode() == expected;
    }

    static GameType savedGameMode(String savedName) {
        if (savedName == null || savedName.isBlank()) return null;
        return GameType.byName(savedName, null);
    }
}
