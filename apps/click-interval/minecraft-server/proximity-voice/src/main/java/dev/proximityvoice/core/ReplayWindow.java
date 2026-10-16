package dev.proximityvoice.core;

public final class ReplayWindow {
    private long highest;
    private long seenMask;

    public synchronized boolean accept(long sequence) {
        if (sequence <= 0L) return false;
        if (highest == 0L) {
            highest = sequence;
            seenMask = 1L;
            return true;
        }
        if (sequence > highest) {
            long advance = sequence - highest;
            seenMask = advance >= Long.SIZE ? 1L : (seenMask << (int) advance) | 1L;
            highest = sequence;
            return true;
        }
        long age = highest - sequence;
        if (age >= Long.SIZE) return false;
        long bit = 1L << (int) age;
        if ((seenMask & bit) != 0L) return false;
        seenMask |= bit;
        return true;
    }

    public synchronized long highest() {
        return highest;
    }
}
