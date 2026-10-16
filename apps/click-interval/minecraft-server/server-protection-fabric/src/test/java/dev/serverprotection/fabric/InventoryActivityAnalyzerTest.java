package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class InventoryActivityAnalyzerTest {
    @Test
    void oneQuickInventoryBurstDoesNotBecomeEvidenceByPacketCountAlone() {
        InventoryActivityAnalyzer analyzer = new InventoryActivityAnalyzer();
        InventoryActivityAnalyzer.Assessment result = null;
        for (int index = 0; index < 40; index++) {
            result = analyzer.observe(1_000L + index, 28, 3, 250, 1_500, 120, 3_000);
        }

        assertEquals(40, result.count());
        assertEquals(1, result.evidenceSamples());
        assertFalse(result.confirmed());
        assertFalse(result.report());
    }

    @Test
    void sustainedOverLimitTrafficRequiresDistinctTimeSeparatedEvidence() {
        InventoryActivityAnalyzer analyzer = new InventoryActivityAnalyzer();
        for (int index = 0; index < 36; index++) {
            analyzer.observe(1_000L + index, 35, 3, 250, 1_500, 120, 3_000);
        }
        InventoryActivityAnalyzer.Assessment second = analyzer.observe(
                1_300L, 35, 3, 250, 1_500, 120, 3_000);
        InventoryActivityAnalyzer.Assessment confirmed = analyzer.observe(
                1_600L, 35, 3, 250, 1_500, 120, 3_000);

        assertEquals(2, second.evidenceSamples());
        assertFalse(second.confirmed());
        assertEquals(3, confirmed.evidenceSamples());
        assertTrue(confirmed.confirmed());
        assertTrue(confirmed.report());

        InventoryActivityAnalyzer.Assessment coolingDown = analyzer.observe(
                1_601L, 35, 3, 250, 1_500, 120, 3_000);
        assertTrue(coolingDown.confirmed());
        assertFalse(coolingDown.report());
    }

    @Test
    void aHardFloodIsBlockedImmediatelyButReportsAtMostOncePerCooldown() {
        InventoryActivityAnalyzer analyzer = new InventoryActivityAnalyzer();
        InventoryActivityAnalyzer.Assessment flood = null;
        for (int index = 0; index < 122; index++) {
            flood = analyzer.observe(2_000L, 35, 3, 250, 1_500, 120, 3_000);
        }
        assertTrue(flood.hardFlood());
        assertTrue(flood.confirmed());
        assertFalse(flood.report(), "the first hard-limit packet reported; later packets are cooled down");

        analyzer.reset();
        for (int index = 0; index < 120; index++) {
            assertFalse(analyzer.observe(5_000L, 35, 3, 250, 1_500, 120, 3_000).hardFlood());
        }
        InventoryActivityAnalyzer.Assessment firstFlood = analyzer.observe(
                5_000L, 35, 3, 250, 1_500, 120, 3_000);
        assertTrue(firstFlood.hardFlood());
        assertTrue(firstFlood.report());
    }

    @Test
    void expiredEvidenceAndResetDoNotCarryAcrossIndependentBursts() {
        InventoryActivityAnalyzer analyzer = new InventoryActivityAnalyzer();
        for (int index = 0; index < 40; index++) {
            analyzer.observe(1_000L, 35, 3, 250, 1_000, 120, 3_000);
        }
        InventoryActivityAnalyzer.Assessment expired = analyzer.observe(
                2_101L, 35, 3, 250, 1_000, 120, 3_000);
        assertEquals(0, expired.evidenceSamples());
        assertFalse(expired.confirmed());

        analyzer.reset();
        InventoryActivityAnalyzer.Assessment fresh = analyzer.observe(
                2_200L, 35, 3, 250, 1_000, 120, 3_000);
        assertEquals(1, fresh.count());
        assertEquals(0, fresh.evidenceSamples());
    }
}
