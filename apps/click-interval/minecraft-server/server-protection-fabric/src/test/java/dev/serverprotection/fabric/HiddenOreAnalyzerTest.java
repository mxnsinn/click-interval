package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class HiddenOreAnalyzerTest {
    @Test
    void requiresSeveralConcealedValuableBreaksAndResetsAfterReport() {
        HiddenOreAnalyzer analyzer = new HiddenOreAnalyzer();
        assertFalse(analyzer.observe(1_000L, false, false, 3, 300_000L).violation());
        assertFalse(analyzer.observe(2_000L, true, false, 3, 300_000L).violation());
        assertFalse(analyzer.observe(3_000L, true, false, 3, 300_000L).violation());
        HiddenOreAnalyzer.Assessment third = analyzer.observe(4_000L, true, false, 3, 300_000L);
        assertTrue(third.violation());
        assertEquals(3, third.samples());
        assertEquals(0, analyzer.size());
    }

    @Test
    void exposedOreDecaysEvidenceAndOldSamplesExpire() {
        HiddenOreAnalyzer analyzer = new HiddenOreAnalyzer();
        analyzer.observe(1_000L, true, false, 3, 30_000L);
        analyzer.observe(2_000L, true, false, 3, 30_000L);
        analyzer.observe(3_000L, true, true, 3, 30_000L);
        assertEquals(1, analyzer.size());
        assertFalse(analyzer.observe(40_001L, true, false, 3, 30_000L).violation());
        assertEquals(1, analyzer.size());
    }

    @Test
    void storageAndThresholdStayBounded() {
        HiddenOreAnalyzer analyzer = new HiddenOreAnalyzer();
        for (int index = 0; index < 50; index++) {
            analyzer.observe(1_000L + index, true, false, 8, 300_000L);
        }
        assertTrue(analyzer.size() < 8);
        analyzer.reset();
        assertEquals(0, analyzer.size());
    }
}
