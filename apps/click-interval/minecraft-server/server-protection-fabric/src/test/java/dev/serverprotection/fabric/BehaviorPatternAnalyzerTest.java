package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class BehaviorPatternAnalyzerTest {
    @Test
    void repeatedGatesAndExemptionsAreConservative() {
        BehaviorPatternAnalyzer analyzer = new BehaviorPatternAnalyzer();
        int flags = 0;
        for (int sample = 0; sample < 4; sample++) {
            flags = analyzer.observeMovement(1_000L + sample * 50L, -0.01, 0.1, true, false,
                    false, false, false, false, 0.6, 0.2, 5, 7, 2, 7);
            assertEquals(0, flags & BehaviorPatternAnalyzer.GROUND_SPOOF);
        }
        flags = analyzer.observeMovement(1_200L, -0.01, 0.1, true, false,
                false, false, false, false, 0.6, 0.2, 5, 7, 2, 7);
        assertTrue((flags & BehaviorPatternAnalyzer.GROUND_SPOOF) != 0);

        analyzer.reset();
        for (int sample = 0; sample < 20; sample++) {
            flags = analyzer.observeMovement(2_000L + sample * 50L, 0.0, 0.3, true, false,
                    false, false, true, true, 0.6, 0.2, 5, 7, 2, 7);
            assertEquals(0, flags);
        }
    }

    @Test
    void timerNeedsCompleteOverLimitWindows() {
        BehaviorPatternAnalyzer analyzer = new BehaviorPatternAnalyzer();
        long start = 1_000L;
        int flags = 0;
        for (int window = 0; window < 3; window++) {
            for (int packet = 0; packet < 30; packet++) {
                analyzer.observeMovementPacket(start + packet * 20L, 28, 3, false);
            }
            start += 1_000L;
            flags = analyzer.observeMovementPacket(start, 28, 3, false);
        }
        assertTrue((flags & BehaviorPatternAnalyzer.TIMER) != 0);
    }
}
