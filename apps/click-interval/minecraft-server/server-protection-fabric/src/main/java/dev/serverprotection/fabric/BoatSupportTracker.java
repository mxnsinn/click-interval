package dev.serverprotection.fabric;

import net.minecraft.world.phys.AABB;

/** Short grace earned by actual hull contact; no continuous timer/speed exemption. */
final class BoatSupportTracker {
    private static final long UNSET = Long.MIN_VALUE;
    static final long DEPARTURE_TICKS = 12;
    static final long TIMER_GRACE_TICKS = 8;
    static final long TIMER_COOLDOWN_TICKS = 100;
    private long lastTick = UNSET;
    private long lastSupportTick = UNSET;
    private long timerGraceStart = UNSET;
    private double supportX, supportY, supportZ;
    private boolean touching;

    boolean observe(long tick, AABB player, boolean confirmedContact) {
        if (lastTick != UNSET && tick < lastTick) reset();
        lastTick = tick;
        double x = (player.minX + player.maxX) * 0.5, y = player.minY, z = (player.minZ + player.maxZ) * 0.5;
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) { reset(); return false; }
        if (confirmedContact) {
            if (!touching) correctionGrace(tick);
            touching = true;
            lastSupportTick = tick;
            supportX = x; supportY = y; supportZ = z;
            return false;
        }
        boolean departed = touching;
        touching = false;
        if (lastSupportTick == UNSET) return false;
        double dx = x - supportX, dz = z - supportZ, dy = y - supportY;
        boolean bounded = tick >= lastSupportTick && tick - lastSupportTick <= DEPARTURE_TICKS
                && dx * dx + dz * dz <= 2.5 * 2.5 && dy >= -1.5 && dy <= 1.35;
        if (!bounded) {
            lastSupportTick = UNSET;
            // Keep cooldown history even after moving away so edge toggling cannot refresh it.
            return false;
        }
        if (departed) correctionGrace(tick);
        return true;
    }

    boolean timerGrace(long tick) {
        return timerGraceStart != UNSET && tick >= timerGraceStart && tick - timerGraceStart < TIMER_GRACE_TICKS
                && lastSupportTick != UNSET && tick >= lastSupportTick && tick - lastSupportTick <= DEPARTURE_TICKS;
    }

    private void correctionGrace(long tick) {
        if (timerGraceStart == UNSET || tick < timerGraceStart || tick - timerGraceStart >= TIMER_COOLDOWN_TICKS)
            timerGraceStart = tick;
    }

    void reset() {
        lastTick = UNSET; lastSupportTick = UNSET; timerGraceStart = UNSET; touching = false;
    }
}
