package dev.serverprotection.fabric;

/**
 * Bounded per-player evidence that a hand-openable door actually changed state near the player.
 * Minecraft collision inspection remains in the Fabric adapter; this class only owns the short,
 * spatially exact transition window.
 */
final class DoorTransitionTracker {
    static final long TRANSITION_MILLIS = 750L;

    private Object level;
    private long observedAt;
    private int x;
    private int lowerY;
    private int z;
    private boolean previousOpen;

    void observe(long now, Object level, int x, int lowerY, int z, boolean open) {
        if (level == null) {
            reset();
            return;
        }
        this.level = level;
        observedAt = now;
        this.x = x;
        this.lowerY = lowerY;
        this.z = z;
        previousOpen = open;
    }

    boolean coversChangedDoor(long now, Object level, int x, int lowerY, int z, boolean open) {
        if (!isActive(now, level)) return false;
        return this.x == x && this.lowerY == lowerY && this.z == z && previousOpen != open;
    }

    boolean isActive(long now, Object level) {
        return this.level == level && now >= observedAt && now - observedAt <= TRANSITION_MILLIS;
    }

    void reset() {
        level = null;
        observedAt = 0L;
        x = 0;
        lowerY = 0;
        z = 0;
        previousOpen = false;
    }
}
