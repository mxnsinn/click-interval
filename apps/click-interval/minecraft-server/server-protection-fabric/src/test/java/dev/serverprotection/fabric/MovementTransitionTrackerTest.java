package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class MovementTransitionTrackerTest {
    @org.junit.jupiter.api.Test
    void packetTimingGraceIsBoundedAndSeparateFromGliding() {
        MovementTransitionTracker tracker = new MovementTransitionTracker();
        for (long now = 1000; now <= 2200; now += 50) tracker.observePacket(now);
        org.junit.jupiter.api.Assertions.assertFalse(tracker.packetTimingUncertain(2200));
        org.junit.jupiter.api.Assertions.assertTrue(tracker.exempt(2200, true, false));
        org.junit.jupiter.api.Assertions.assertFalse(tracker.packetTimingUncertain(2200));
        tracker.observePacket(3000);
        org.junit.jupiter.api.Assertions.assertTrue(tracker.packetTimingUncertain(3000));
        for (long now = 3050; now <= 4000; now += 50) tracker.observePacket(now);
        org.junit.jupiter.api.Assertions.assertFalse(tracker.packetTimingUncertain(4000));
    }
    @Test
    void elytraAndRiptideKeepTheirLandingMomentumExempt() {
        MovementTransitionTracker tracker = new MovementTransitionTracker();
        tracker.observePacket(1_000);
        for (long now = 1_050; now <= 3_000; now += 50) tracker.observePacket(now);
        assertFalse(tracker.exempt(3_000, false, false));
        assertTrue(tracker.exempt(3_000, true, false));
        for (long now = 3_050; now < 5_500; now += 50) {
            tracker.observePacket(now);
            assertTrue(tracker.exempt(now, false, false), "gliding momentum persists after landing");
        }
        tracker.observePacket(5_500);
        assertFalse(tracker.exempt(5_500, false, false));
        assertTrue(tracker.exempt(5_500, false, true));
    }

    @Test
    void frozenClientAndBufferedResumeCannotAccumulateFlightOrSpeedEvidence() {
        MovementTransitionTracker tracker = new MovementTransitionTracker();
        assertTrue(tracker.exempt(1_000, false, false));
        for (long now = 1_000; now <= 2_000; now += 50) tracker.observePacket(now);
        assertFalse(tracker.exempt(2_000, false, false));
        assertTrue(tracker.exempt(2_251, false, false));
        tracker.observePacket(4_000);
        for (long now = 4_000; now < 5_000; now += 50) {
            tracker.observePacket(now);
            assertTrue(tracker.exempt(now, false, false));
        }
        tracker.observePacket(5_000);
        assertFalse(tracker.exempt(5_000, false, false));
    }

    @Test
    void glidingExemptionClearsExistingSpeedAndFlightEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        MovementAnalyzer analyzer = new MovementAnalyzer();
        MovementTransitionTracker tracker = new MovementTransitionTracker();
        for (int tick = 0; tick < 100; tick++) {
            long now = 1_000 + tick * 50L;
            tracker.observePacket(now);
            boolean exempt = tracker.exempt(now, true, false);
            MovementAnalyzer.Result result = analyzer.evaluate(new MovementAnalyzer.Sample(
                    tick * 3.0, 100 + tick * 0.3, 0, false, exempt,
                    exempt, false, false, false, true, false, 1, 20, 1), config);
            assertEquals(0, result.flags(), "fast Elytra flight is not ordinary walking");
        }
    }
}
