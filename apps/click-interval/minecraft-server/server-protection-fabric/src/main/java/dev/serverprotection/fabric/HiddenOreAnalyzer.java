package dev.serverprotection.fabric;

/** Bounded, allocation-free evidence window for impossible concealed-ore breaks. */
final class HiddenOreAnalyzer {
    private static final int CAPACITY = 8;
    private final long[] concealedAt = new long[CAPACITY];
    private int size;

    Assessment observe(long now, boolean valuableOre, boolean exposedToAir,
                       int requiredSamples, long windowMillis) {
        int threshold = Math.max(2, Math.min(CAPACITY, requiredSamples));
        long window = Math.max(30_000L, Math.min(30L * 60_000L, windowMillis));
        prune(now, window);
        if (!valuableOre) return new Assessment(false, size, threshold);
        if (exposedToAir) {
            // A normal exposed find is contrary evidence. Decay one stored concealed sample.
            if (size > 0) removeOldest();
            return new Assessment(false, size, threshold);
        }
        if (size == CAPACITY) removeOldest();
        concealedAt[size++] = now;
        if (size < threshold) return new Assessment(false, size, threshold);
        int evidence = size;
        size = 0; // Require a fresh multi-sample sequence before another report.
        return new Assessment(true, evidence, threshold);
    }

    void reset() {
        size = 0;
    }

    int size() {
        return size;
    }

    private void prune(long now, long windowMillis) {
        int expired = 0;
        while (expired < size) {
            long sample = concealedAt[expired];
            if (now >= sample && now - sample > windowMillis) expired++;
            else break;
        }
        if (expired == 0) return;
        System.arraycopy(concealedAt, expired, concealedAt, 0, size - expired);
        size -= expired;
    }

    private void removeOldest() {
        if (size <= 0) return;
        System.arraycopy(concealedAt, 1, concealedAt, 0, size - 1);
        size--;
    }

    record Assessment(boolean violation, int samples, int threshold) { }
}
