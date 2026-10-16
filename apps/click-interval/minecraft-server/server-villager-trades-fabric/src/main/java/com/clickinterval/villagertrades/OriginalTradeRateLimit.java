package com.clickinterval.villagertrades;

/** Bounded per-player reroll work, without a handshake or a timer that holds the menu open. */
final class OriginalTradeRateLimit {
    static final int MAX_PER_SECOND = 8;
    private long windowStart = Long.MIN_VALUE;
    private int count;

    boolean acquire(long tick) {
        if (windowStart == Long.MIN_VALUE || tick < windowStart || tick - windowStart >= 20) {
            windowStart = tick;
            count = 0;
        }
        if (count >= MAX_PER_SECOND) return false;
        count++;
        return true;
    }
}
