package dev.serverprotection.fabric;

import java.util.Arrays;
import java.util.Locale;

/**
 * Compact, allocation-free-after-construction activity windows for the world and abuse checks.
 * Ten time buckets give a rolling window without retaining one timestamp per packet.
 */
final class ActivityAnalyzer {
    static final long ONE_SECOND = 1_000L;
    static final long FIVE_SECONDS = 5_000L;

    private final BucketWindow breaks = new BucketWindow(ONE_SECOND, 10);
    private final BucketWindow sweepHarvestBreaks = new BucketWindow(ONE_SECOND, 10);
    private final BucketWindow places = new BucketWindow(ONE_SECOND, 10);
    private final BucketWindow chat = new BucketWindow(FIVE_SECONDS, 10);
    private final BucketWindow commands = new BucketWindow(FIVE_SECONDS, 10);
    private final BucketWindow inventory = new BucketWindow(ONE_SECOND, 10);
    private String lastMessage = "";
    private long lastMessageAt;
    private int consecutiveMessageCount;

    Assessment breakBlock(long now, int limit) {
        return breakBlock(now, limit, false);
    }

    Assessment breakBlock(long now, int limit, boolean sweepHarvest) {
        BucketWindow window = sweepHarvest ? sweepHarvestBreaks : breaks;
        return assessment(window.addAndCount(now), limit, false);
    }

    Assessment placeBlock(long now, int limit) {
        return assessment(places.addAndCount(now), limit, false);
    }

    Assessment chat(long now, String message, int limit) {
        int count = chat.addAndCount(now);
        String normalized = normalize(message);
        boolean sameRecentMessage = !normalized.isEmpty()
                && normalized.equals(lastMessage)
                && now >= lastMessageAt
                && now - lastMessageAt <= FIVE_SECONDS;
        consecutiveMessageCount = sameRecentMessage ? Math.min(3, consecutiveMessageCount + 1) : 1;
        boolean repeated = sameRecentMessage && consecutiveMessageCount >= 3;
        lastMessage = normalized;
        lastMessageAt = now;
        return assessment(count, limit, repeated);
    }

    Assessment command(long now, int limit) {
        return assessment(commands.addAndCount(now), limit, false);
    }

    Assessment inventory(long now, int limit) {
        return assessment(inventory.addAndCount(now), limit, false);
    }

    void resetBreakActivity() {
        breaks.clear();
        sweepHarvestBreaks.clear();
    }

    void reset() {
        resetBreakActivity();
        places.clear();
        chat.clear();
        commands.clear();
        inventory.clear();
        lastMessage = "";
        lastMessageAt = 0L;
        consecutiveMessageCount = 0;
    }

    private static Assessment assessment(int count, int limit, boolean repeated) {
        int safeLimit = Math.max(1, limit);
        return new Assessment(count, safeLimit, count > safeLimit || repeated, repeated);
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) return "";
        String source = value.toLowerCase(Locale.ROOT);
        StringBuilder normalized = new StringBuilder(Math.min(source.length(), 256));
        boolean spacing = false;
        for (int index = 0; index < source.length() && normalized.length() < 256; index++) {
            char character = source.charAt(index);
            if (Character.isWhitespace(character)) {
                spacing = normalized.length() > 0;
            } else {
                if (spacing) normalized.append(' ');
                normalized.append(character);
                spacing = false;
            }
        }
        return normalized.toString();
    }

    record Assessment(int count, int limit, boolean violation, boolean repeated) { }

    /** A ten-slot rolling counter: 100 ms buckets for one second, 500 ms for five seconds. */
    private static final class BucketWindow {
        private final long bucketMillis;
        private final long[] epochs;
        private final int[] counts;

        private BucketWindow(long windowMillis, int bucketCount) {
            this.bucketMillis = Math.max(1L, windowMillis / Math.max(2, bucketCount));
            this.epochs = new long[Math.max(2, bucketCount)];
            this.counts = new int[this.epochs.length];
            Arrays.fill(epochs, Long.MIN_VALUE);
        }

        private int addAndCount(long now) {
            long epoch = Math.floorDiv(Math.max(0L, now), bucketMillis);
            int slot = Math.floorMod(epoch, epochs.length);
            if (epochs[slot] != epoch) {
                epochs[slot] = epoch;
                counts[slot] = 0;
            }
            if (counts[slot] < Integer.MAX_VALUE) counts[slot]++;
            long oldest = epoch - epochs.length + 1L;
            int total = 0;
            for (int index = 0; index < epochs.length; index++) {
                if (epochs[index] >= oldest && epochs[index] <= epoch) {
                    total = Math.min(Integer.MAX_VALUE, total + counts[index]);
                }
            }
            return total;
        }

        private void clear() {
            Arrays.fill(epochs, Long.MIN_VALUE);
            Arrays.fill(counts, 0);
        }
    }
}
