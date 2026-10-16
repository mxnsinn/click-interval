package dev.proximityvoice.client.core;

/** Sliding 64-packet replay window for authenticated server datagrams. */
public final class ReplayWindow {
    private long highest;
    private long seenBits;

    public synchronized boolean accept(long sequence) {
        if (sequence <= 0) return false;
        if (highest == 0) {
            highest = sequence;
            seenBits = 1;
            return true;
        }
        if (sequence > highest) {
            long shift = sequence - highest;
            seenBits = shift >= 64 ? 1 : (seenBits << (int) shift) | 1;
            highest = sequence;
            return true;
        }
        long behind = highest - sequence;
        if (behind >= 64) return false;
        long mask = 1L << (int) behind;
        if ((seenBits & mask) != 0) return false;
        seenBits |= mask;
        return true;
    }

    public synchronized void reset() {
        highest = 0;
        seenBits = 0;
    }
}
