package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class ActivityAnalyzerTest {
    @Test
    void independentlyRatesEveryWorldAndAbuseChannel() {
        ActivityAnalyzer analyzer = new ActivityAnalyzer();
        assertFalse(analyzer.breakBlock(1_000L, 2).violation());
        assertFalse(analyzer.breakBlock(1_010L, 2).violation());
        assertTrue(analyzer.breakBlock(1_020L, 2).violation());

        assertFalse(analyzer.placeBlock(1_000L, 1).violation());
        assertTrue(analyzer.placeBlock(1_010L, 1).violation());

        assertFalse(analyzer.command(1_000L, 2).violation());
        assertFalse(analyzer.command(1_010L, 2).violation());
        assertTrue(analyzer.command(1_020L, 2).violation());

        assertFalse(analyzer.inventory(1_000L, 2).violation());
        assertFalse(analyzer.inventory(1_010L, 2).violation());
        assertTrue(analyzer.inventory(1_020L, 2).violation());
    }

    @Test
    void repeatedChatIsNormalizedBoundedAndExpires() {
        ActivityAnalyzer analyzer = new ActivityAnalyzer();
        ActivityAnalyzer.Assessment first = analyzer.chat(1_000L, "  Hello   WORLD ", 10);
        ActivityAnalyzer.Assessment second = analyzer.chat(1_100L, "hello world", 10);
        ActivityAnalyzer.Assessment repeated = analyzer.chat(1_200L, "hello world", 10);
        ActivityAnalyzer.Assessment expired = analyzer.chat(6_201L, "hello world", 10);
        assertFalse(first.violation());
        assertFalse(second.violation());
        assertTrue(repeated.violation());
        assertTrue(repeated.repeated());
        assertFalse(expired.repeated());
        assertFalse(expired.violation());
    }

    @Test
    void rollingWindowsExpireAndResetWithoutRetainingEvents() {
        ActivityAnalyzer analyzer = new ActivityAnalyzer();
        for (int index = 0; index < 10_000; index++) {
            analyzer.inventory(1_000L, 200);
        }
        ActivityAnalyzer.Assessment expired = analyzer.inventory(2_101L, 200);
        assertEquals(1, expired.count());
        assertFalse(expired.violation());
        analyzer.breakBlock(3_000L, 1);
        analyzer.reset();
        assertEquals(1, analyzer.breakBlock(3_010L, 1).count());
    }

    @Test
    void sweepHarvestBreaksUseAnIndependentBoundedWindow() {
        ActivityAnalyzer analyzer = new ActivityAnalyzer();

        assertFalse(analyzer.breakBlock(1_000L, 1, false).violation());
        for (int index = 0; index < 40; index++) {
            assertFalse(analyzer.breakBlock(1_000L + index, 40, true).violation());
        }
        assertTrue(analyzer.breakBlock(1_050L, 40, true).violation());

        // Harvest traffic must not contaminate the ordinary solid-block counter.
        assertTrue(analyzer.breakBlock(1_060L, 1, false).violation());
        analyzer.reset();
        assertEquals(1, analyzer.breakBlock(1_070L, 40, true).count());
    }
}
