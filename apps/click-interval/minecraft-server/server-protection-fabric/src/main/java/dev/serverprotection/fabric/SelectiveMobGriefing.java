package dev.serverprotection.fabric;

import net.minecraft.world.level.Level;

/**
 * Keeps normal mob interactions enabled while narrowing the two destructive
 * behaviours managed by Server Protection.
 */
public final class SelectiveMobGriefing {
    private SelectiveMobGriefing() {
    }

    public static boolean shouldRestoreGlobalRule(Boolean currentValue) {
        return !Boolean.TRUE.equals(currentValue);
    }

    public static Level.ExplosionInteraction creeperExplosionInteraction(
            Level.ExplosionInteraction ignoredVanillaInteraction) {
        // NONE maps to KEEP for blocks, but ServerExplosion still runs its
        // entity-damage and knockback pass.
        return Level.ExplosionInteraction.NONE;
    }
}
