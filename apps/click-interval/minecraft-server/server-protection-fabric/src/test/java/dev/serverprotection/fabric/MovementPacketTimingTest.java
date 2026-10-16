package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class MovementPacketTimingTest {
    private static final int LIMIT = 25;

    @Test void delayedWindowUsesActualDurationInsteadOfTreatingAllPacketsAsOneSecond() {
        var analyzer = new BehaviorPatternAnalyzer();
        long start = 1_000L;
        assertEquals(0, analyzer.observeMovementPacket(start, LIMIT, 2, false));
        for (int window = 0; window < 12; window++) {
            // 30 accepted packets across a 1.5-second delivery window are 20/s, not 30/s.
            for (int packet = 1; packet < 30; packet++)
                assertEquals(0, analyzer.observeMovementPacket(start + packet * 20L, LIMIT, 2, false));
            start += 1_500L;
            assertEquals(0, analyzer.observeMovementPacket(start, LIMIT, 2, false));
        }
    }

    @Test void normalTwentyTickCadenceNeverFlagsIncludingWindowBoundaries() {
        var analyzer = new BehaviorPatternAnalyzer();
        for (long now = 1_000L; now < 61_000L; now += 50L)
            assertEquals(0, analyzer.observeMovementPacket(now, LIMIT, 2, false));
    }

    @Test void exactConfiguredRateIsAllowedIncludingNonSecondAlignedWindows() {
        var steady = new BehaviorPatternAnalyzer();
        for (long now = 1_000L; now < 61_000L; now += 40L)
            assertEquals(0, steady.observeMovementPacket(now, LIMIT, 2, false));
        var analyzer = new BehaviorPatternAnalyzer();
        long start = 1_000L;
        analyzer.observeMovementPacket(start, LIMIT, 2, false);
        for (int window = 0; window < 12; window++) {
            // Exactly 26 packets / 1.04 seconds = 25 packets/s, not an over-rate window.
            for (int packet = 1; packet < 26; packet++)
                assertEquals(0, analyzer.observeMovementPacket(start + packet * 20L, LIMIT, 2, false));
            start += 1_040L;
            assertEquals(0, analyzer.observeMovementPacket(start, LIMIT, 2, false));
        }
    }

    @Test void separateBurstsCannotAccumulateAcrossHealthyWindows() {
        var analyzer = new BehaviorPatternAnalyzer();
        long start = 1_000L;
        analyzer.observeMovementPacket(start, LIMIT, 3, false);
        for (int count : new int[]{40,40,20,40,40,20,40,40,20}) {
            for (int packet = 1; packet < count; packet++)
                assertEquals(0, analyzer.observeMovementPacket(start + packet * 1_000L / count, LIMIT, 3, false));
            start += 1_000L;
            assertEquals(0, analyzer.observeMovementPacket(start, LIMIT, 3, false));
        }
    }

    @Test void sustainedFortyPacketsPerSecondStillTriggersAtConfiguredConsecutiveWindowCount() {
        var analyzer = new BehaviorPatternAnalyzer();
        long start = 1_000L;
        analyzer.observeMovementPacket(start, LIMIT, 3, false);
        for (int window = 1; window <= 3; window++) {
            for (int packet = 1; packet < 40; packet++)
                assertEquals(0, analyzer.observeMovementPacket(start + packet * 25L, LIMIT, 3, false));
            start += 1_000L;
            int flags = analyzer.observeMovementPacket(start, LIMIT, 3, false);
            assertEquals(window == 3 ? BehaviorPatternAnalyzer.TIMER : 0, flags);
        }
    }

    @Test void explicitTransportGraceClearsExistingTimerEvidence() {
        var analyzer = new BehaviorPatternAnalyzer();
        analyzer.observeMovementPacket(1_000L, LIMIT, 2, false);
        for (int packet = 1; packet < 40; packet++)
            analyzer.observeMovementPacket(1_000L + packet * 25L, LIMIT, 2, false);
        assertEquals(0, analyzer.observeMovementPacket(2_000L, LIMIT, 2, false));
        assertEquals(0, analyzer.observeMovementPacket(2_001L, LIMIT, 2, true));
        for (int packet = 0; packet < 40; packet++)
            assertEquals(0, analyzer.observeMovementPacket(3_000L + packet * 25L, LIMIT, 2, false));
        assertEquals(0, analyzer.observeMovementPacket(4_000L, LIMIT, 2, false));
    }

    @Test void longSilenceAndClockRegressionDiscardOldEvidence() {
        for (long resume : new long[]{500L, 6_000L}) {
            var analyzer = new BehaviorPatternAnalyzer();
            for (int packet = 0; packet < 40; packet++)
                analyzer.observeMovementPacket(1_000L + packet * 25L, LIMIT, 2, false);
            assertEquals(0, analyzer.observeMovementPacket(2_000L, LIMIT, 2, false));
            assertEquals(0, analyzer.observeMovementPacket(resume, LIMIT, 2, false));
            for (int packet = 1; packet < 40; packet++)
                assertEquals(0, analyzer.observeMovementPacket(resume + packet * 25L, LIMIT, 2, false));
            assertEquals(0, analyzer.observeMovementPacket(resume + 1_000L, LIMIT, 2, false));
        }
    }
}
