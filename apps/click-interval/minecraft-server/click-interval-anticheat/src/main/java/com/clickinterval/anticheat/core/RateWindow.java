package com.clickinterval.anticheat.core;

import java.util.Arrays;

/** Fixed-size sliding timestamp window. Old events are overwritten instead of allocating. */
public final class RateWindow {
    private final long[] timestamps;
    private int head;
    private int size;

    public RateWindow(int capacity) {
        if (capacity < 2) throw new IllegalArgumentException("capacity must be at least 2");
        timestamps = new long[capacity];
    }

    public synchronized int addAndCount(long nowMillis, long windowMillis) {
        prune(nowMillis - Math.max(1, windowMillis));
        int tail = (head + size) % timestamps.length;
        if (size == timestamps.length) {
            head = (head + 1) % timestamps.length;
            tail = (head + size - 1) % timestamps.length;
        } else {
            size++;
        }
        timestamps[tail] = nowMillis;
        return size;
    }

    public synchronized void clear() {
        Arrays.fill(timestamps, 0L);
        head = 0;
        size = 0;
    }

    private void prune(long oldestAllowed) {
        while (size > 0 && timestamps[head] < oldestAllowed) {
            head = (head + 1) % timestamps.length;
            size--;
        }
    }
}
