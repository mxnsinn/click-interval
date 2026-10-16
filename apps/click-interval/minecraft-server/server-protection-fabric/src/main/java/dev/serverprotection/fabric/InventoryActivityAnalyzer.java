package dev.serverprotection.fabric;

import java.util.Arrays;

/**
 * Builds inventory-spam evidence from distinct samples instead of treating one client-side
 * sorting burst as a violation. A separate hard ceiling still stops an immediate packet flood.
 */
final class InventoryActivityAnalyzer {
    private static final long ONE_SECOND = 1_000L;
    private static final long UNSET = Long.MIN_VALUE;

    private final BucketWindow clicks = new BucketWindow(ONE_SECOND, 10);
    private int evidenceSamples;
    private long evidenceStartedAt = UNSET;
    private long lastEvidenceAt = UNSET;
    private long lastReportAt = UNSET;

    Assessment observe(long now, int rateLimit, int requiredEvidenceSamples,
                       long sampleIntervalMillis, long evidenceWindowMillis,
                       int hardLimit, long reportCooldownMillis) {
        long timestamp = Math.max(0L, now);
        int safeRateLimit = Math.max(1, rateLimit);
        int safeRequiredSamples = Math.max(2, requiredEvidenceSamples);
        long safeSampleInterval = Math.max(1L, sampleIntervalMillis);
        long safeEvidenceWindow = Math.max(
                safeSampleInterval * (safeRequiredSamples - 1L),
                Math.max(safeSampleInterval, evidenceWindowMillis));
        int safeHardLimit = Math.max(safeRateLimit + 1, hardLimit);
        long safeReportCooldown = Math.max(1L, reportCooldownMillis);
        int count = clicks.addAndCount(timestamp);

        if (lastEvidenceAt != UNSET
                && (timestamp < lastEvidenceAt || timestamp - lastEvidenceAt > safeEvidenceWindow)) {
            clearEvidence();
        }

        boolean overLimit = count > safeRateLimit;
        if (overLimit && (lastEvidenceAt == UNSET
                || timestamp - lastEvidenceAt >= safeSampleInterval)) {
            if (evidenceStartedAt == UNSET || timestamp < evidenceStartedAt
                    || timestamp - evidenceStartedAt > safeEvidenceWindow) {
                clearEvidence();
                evidenceStartedAt = timestamp;
            }
            evidenceSamples = Math.min(safeRequiredSamples, evidenceSamples + 1);
            lastEvidenceAt = timestamp;
        }

        boolean hardFlood = count > safeHardLimit;
        boolean confirmed = hardFlood || (overLimit && evidenceSamples >= safeRequiredSamples);
        boolean report = confirmed && (lastReportAt == UNSET || timestamp < lastReportAt
                || timestamp - lastReportAt >= safeReportCooldown);
        if (report) lastReportAt = timestamp;
        return new Assessment(count, safeRateLimit, evidenceSamples, safeRequiredSamples,
                safeHardLimit, confirmed, hardFlood, report);
    }

    void reset() {
        clicks.clear();
        clearEvidence();
        lastReportAt = UNSET;
    }

    private void clearEvidence() {
        evidenceSamples = 0;
        evidenceStartedAt = UNSET;
        lastEvidenceAt = UNSET;
    }

    record Assessment(int count, int rateLimit, int evidenceSamples, int requiredEvidenceSamples,
                      int hardLimit, boolean confirmed, boolean hardFlood, boolean report) { }

    /** A bounded rolling counter with 100 ms buckets and no retained packet timestamps. */
    private static final class BucketWindow {
        private final long bucketMillis;
        private final long[] epochs;
        private final int[] counts;

        private BucketWindow(long windowMillis, int bucketCount) {
            bucketMillis = Math.max(1L, windowMillis / Math.max(2, bucketCount));
            epochs = new long[Math.max(2, bucketCount)];
            counts = new int[epochs.length];
            Arrays.fill(epochs, UNSET);
        }

        private int addAndCount(long now) {
            long epoch = Math.floorDiv(now, bucketMillis);
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
            Arrays.fill(epochs, UNSET);
            Arrays.fill(counts, 0);
        }
    }
}
