package dev.serverprotection.fabric;

import net.minecraft.world.level.Level;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SelectiveMobGriefingTest {
    @Test
    void restoresTheGlobalRuleOnlyWhenDisabled() {
        assertTrue(SelectiveMobGriefing.shouldRestoreGlobalRule(false));
        assertTrue(SelectiveMobGriefing.shouldRestoreGlobalRule(null));
        assertFalse(SelectiveMobGriefing.shouldRestoreGlobalRule(true));
    }

    @Test
    void creepersUseANonDestructiveExplosionInteraction() {
        assertEquals(Level.ExplosionInteraction.NONE,
                SelectiveMobGriefing.creeperExplosionInteraction(Level.ExplosionInteraction.MOB));
    }
}
