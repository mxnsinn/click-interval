package dev.servertradeassistant.fabric.core;

import org.junit.jupiter.api.Test;

import static dev.servertradeassistant.fabric.core.RerollEligibility.Denial;
import static org.junit.jupiter.api.Assertions.assertEquals;

final class RerollEligibilityTest {
    @Test
    void acceptsOnlyUnusedNoviceEmployedVillagerInsideLimit() {
        assertEquals(Denial.NONE, RerollEligibility.evaluate(true, 1, 0, false, 3, 64));
        assertEquals(Denial.NOT_EMPLOYED, RerollEligibility.evaluate(false, 1, 0, false, 0, 64));
        assertEquals(Denial.NOT_NOVICE, RerollEligibility.evaluate(true, 2, 0, false, 0, 64));
        assertEquals(Denial.NOT_NOVICE, RerollEligibility.evaluate(true, 1, 1, false, 0, 64));
        assertEquals(Denial.ALREADY_TRADED, RerollEligibility.evaluate(true, 1, 0, true, 0, 64));
        assertEquals(Denial.LIMIT_REACHED, RerollEligibility.evaluate(true, 1, 0, false, 64, 64));
    }

    @Test
    void zeroLimitMeansUnlimited() {
        assertEquals(Denial.NONE, RerollEligibility.evaluate(true, 1, 0, false, 999_999, 0));
    }
}
