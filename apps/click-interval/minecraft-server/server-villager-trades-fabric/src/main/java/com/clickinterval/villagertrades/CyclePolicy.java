package com.clickinterval.villagertrades;

public final class CyclePolicy {
    public static final int COOLDOWN_TICKS = 10;

    private CyclePolicy() { }

    public static boolean cooldownReady(long previous, long now) {
        return previous == Long.MIN_VALUE || now >= previous && now - previous >= COOLDOWN_TICKS;
    }

    public static boolean untraded(int xp, int level, boolean anyUsedOffer) {
        return xp == 0 && level == 1 && !anyUsedOffer;
    }
}
