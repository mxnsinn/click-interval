package dev.serverprotection.fabric;

import net.minecraft.world.level.GameType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

final class PlayerViewOriginRestorerTest {
    @Test
    void acceptsEveryDurablySupportedGameMode() {
        assertEquals(GameType.SURVIVAL, PlayerViewOriginRestorer.savedGameMode("survival"));
        assertEquals(GameType.CREATIVE, PlayerViewOriginRestorer.savedGameMode("creative"));
        assertEquals(GameType.ADVENTURE, PlayerViewOriginRestorer.savedGameMode("adventure"));
        assertEquals(GameType.SPECTATOR, PlayerViewOriginRestorer.savedGameMode("spectator"));
    }

    @Test
    void rejectsMissingOrUnknownRecoveryValues() {
        assertNull(PlayerViewOriginRestorer.savedGameMode(null));
        assertNull(PlayerViewOriginRestorer.savedGameMode(""));
        assertNull(PlayerViewOriginRestorer.savedGameMode("not-a-mode"));
    }
}
