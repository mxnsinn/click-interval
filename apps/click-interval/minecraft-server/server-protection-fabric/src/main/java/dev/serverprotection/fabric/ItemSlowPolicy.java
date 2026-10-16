package dev.serverprotection.fabric;

/** A held item is not evidence of slowdown: sprint-capable weapons have different physics. */
final class ItemSlowPolicy {
    static boolean check(boolean using, boolean canSprint, float speedMultiplier) {
        return using && !canSprint && Float.isFinite(speedMultiplier)
                && speedMultiplier >= 0 && speedMultiplier <= 0.2F;
    }
}
