package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class MovementAnalyzerTest {
    @Test
    void flagsHorizontalSpeedButHonorsGraceAndLowTps() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("minimum-tps: 18\n");
        MovementAnalyzer analyzer = new MovementAnalyzer();
        assertEquals(0, analyzer.evaluate(sample(0, 64, 0, true, false, true, 20), config).flags());
        assertFalse(analyzer.evaluate(sample(1, 64, 0, true, false, true, 20), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
        MovementAnalyzer.Result fast = analyzer.evaluate(sample(2, 64, 0, true, false, true, 20), config);
        assertTrue(fast.has(MovementAnalyzer.HORIZONTAL_SPEED));

        analyzer.reset();
        analyzer.evaluate(sample(0, 64, 0, true, false, true, 20), config);
        assertFalse(analyzer.evaluate(sample(2, 64, 0, true, true, true, 20), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));

        analyzer.reset();
        analyzer.evaluate(sample(0, 64, 0, true, false, true, 20), config);
        assertFalse(analyzer.evaluate(sample(2, 64, 0, true, false, true, 15), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));

        analyzer.reset();
        analyzer.evaluate(sample(0, 64, 0, true, false, true, 20), config);
        assertFalse(analyzer.evaluate(sample(5, 64, 0, true, false, true, 20), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
        assertFalse(analyzer.evaluate(sample(5, 64, 0, true, false, true, 20), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
    }

    @Test
    void authoritativeForcedMovementClearsHorizontalEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(movementSample(0, false, false), config);
        assertFalse(analyzer.evaluate(movementSample(1, false, false), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));

        // A hit or server velocity between two otherwise fast samples must break the chain.
        assertFalse(analyzer.evaluate(movementSample(2, true, false), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
        assertFalse(analyzer.evaluate(movementSample(3, false, false), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
        assertTrue(analyzer.evaluate(movementSample(4, false, false), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
    }

    @Test
    void environmentalMovementNeedsStrongerEvidenceButDoesNotDisableSpeedCheck() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(movementSample(0, false, true), config);
        for (int sample = 1; sample < 4; sample++) {
            assertFalse(analyzer.evaluate(movementSample(sample * 2.0, false, true), config)
                    .has(MovementAnalyzer.HORIZONTAL_SPEED));
        }
        assertTrue(analyzer.evaluate(movementSample(8.0, false, true), config)
                .has(MovementAnalyzer.HORIZONTAL_SPEED));
    }

    @Test
    void forcedAndFluidMovementCannotAccumulatePhaseEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                checks:
                  movement:
                    phase: true
                limits:
                  movement:
                    maxGroundBlocksPerTick: 5
                    phaseSamples: 2
                """);
        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(phaseSample(0.0, false, false), config);
        assertFalse(analyzer.evaluate(phaseSample(0.1, true, false), config)
                .has(MovementAnalyzer.PHASE));
        assertFalse(analyzer.evaluate(phaseSample(0.2, true, false), config)
                .has(MovementAnalyzer.PHASE));
        assertFalse(analyzer.evaluate(phaseSample(0.3, false, true), config)
                .has(MovementAnalyzer.PHASE));
        assertFalse(analyzer.evaluate(phaseSample(0.4, false, false), config)
                .has(MovementAnalyzer.PHASE));
        assertTrue(analyzer.evaluate(phaseSample(0.5, false, false), config)
                .has(MovementAnalyzer.PHASE));
    }

    @Test
    void requiresSustainedUnsupportedFlightEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                limits:
                  movement:
                    maxAirTicks: 20
                """);
        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(sample(0, 80, 0, false, false, true, 20), config);
        MovementAnalyzer.Result result = null;
        for (int i = 0; i < 21; i++) {
            result = analyzer.evaluate(sample(0, 80, 0, false, false, true, 20), config);
        }
        assertNotNull(result);
        assertTrue(result.has(MovementAnalyzer.VERTICAL_FLIGHT));

        MovementAnalyzer exempt = new MovementAnalyzer();
        exempt.evaluate(flightSample(true), config);
        for (int i = 0; i < 30; i++) {
            assertFalse(exempt.evaluate(flightSample(true), config).has(MovementAnalyzer.VERTICAL_FLIGHT));
        }
    }

    @Test
    void catchesSustainedUpwardAndDownwardFlight() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");

        MovementAnalyzer ascending = new MovementAnalyzer();
        ascending.evaluate(verticalSample(64.0, true, false), config);
        MovementAnalyzer.Result ascent = null;
        for (int sample = 1; sample <= 8; sample++) {
            ascent = ascending.evaluate(verticalSample(64.0 + sample * 0.30, false, false), config);
        }
        assertNotNull(ascent);
        assertTrue(ascent.has(MovementAnalyzer.VERTICAL_FLIGHT));

        MovementAnalyzer descending = new MovementAnalyzer();
        descending.evaluate(verticalSample(80.0, true, false), config);
        MovementAnalyzer.Result descent = null;
        for (int sample = 1; sample <= 8; sample++) {
            descent = descending.evaluate(verticalSample(80.0 - sample * 0.30, false, false), config);
        }
        assertNotNull(descent);
        assertTrue(descent.has(MovementAnalyzer.VERTICAL_FLIGHT));
    }

    @Test
    void spoofedOnGroundWithoutServerSupportDoesNotResetFlightEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        boolean groundSupported = ServerProtectionFabric.resolveGroundSupport(true, false, false);
        assertFalse(groundSupported);
        assertTrue(ServerProtectionFabric.resolveGroundSupport(true, false, true));
        assertTrue(ServerProtectionFabric.resolveGroundSupport(false, true, false));

        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(verticalSample(64.0, true, false), config);
        MovementAnalyzer.Result result = null;
        for (int sample = 1; sample <= 8; sample++) {
            result = analyzer.evaluate(verticalSample(64.0 + sample * 0.30, groundSupported, false), config);
        }
        assertNotNull(result);
        assertTrue(result.has(MovementAnalyzer.VERTICAL_FLIGHT));
    }

    @Test
    void naturalJumpFallAndVelocityGraceDoNotBecomeFlightEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        MovementAnalyzer natural = new MovementAnalyzer();
        double y = 64.0;
        double velocity = 0.42;
        natural.evaluate(verticalSample(y, true, false), config);
        for (int tick = 0; tick < 100; tick++) {
            y += velocity;
            assertFalse(natural.evaluate(verticalSample(y, false, false), config)
                    .has(MovementAnalyzer.VERTICAL_FLIGHT));
            velocity = (velocity - 0.08) * 0.98;
        }

        MovementAnalyzer knockback = new MovementAnalyzer();
        knockback.evaluate(verticalSample(64.0, true, false), config);
        for (int sample = 1; sample <= 30; sample++) {
            assertFalse(knockback.evaluate(verticalSample(64.0 + sample * 0.35, false, true), config)
                    .has(MovementAnalyzer.VERTICAL_FLIGHT));
        }
    }

    @Test
    void phaseIsIndependentDisabledByDefaultAndNeedsConsecutiveSamples() throws Exception {
        ProtectionConfig enabled = ProtectionConfig.parse("""
                checks:
                  movement:
                    phase: true
                limits:
                  movement:
                    maxGroundBlocksPerTick: 5
                    phaseSamples: 2
                """);
        MovementAnalyzer analyzer = new MovementAnalyzer();
        analyzer.evaluate(sample(0, 64, 0, true, false, true, 20), enabled);
        assertFalse(analyzer.evaluate(sample(0.1, 64, 0, true, false, false, 20), enabled)
                .has(MovementAnalyzer.PHASE));
        assertTrue(analyzer.evaluate(sample(0.2, 64, 0, true, false, false, 20), enabled)
                .has(MovementAnalyzer.PHASE));

        MovementAnalyzer doorTransition = new MovementAnalyzer();
        doorTransition.evaluate(sample(0, 64, 0, true, false, true, 20), enabled);
        assertFalse(doorTransition.evaluate(sample(0.1, 64, 0, true, false, false, true, 20), enabled)
                .has(MovementAnalyzer.PHASE));
        assertFalse(doorTransition.evaluate(sample(0.2, 64, 0, true, false, false, true, 20), enabled)
                .has(MovementAnalyzer.PHASE));
        assertFalse(doorTransition.evaluate(sample(0.3, 64, 0, true, false, false, false, 20), enabled)
                .has(MovementAnalyzer.PHASE));
        assertTrue(doorTransition.evaluate(sample(0.4, 64, 0, true, false, false, false, 20), enabled)
                .has(MovementAnalyzer.PHASE));

        ProtectionConfig disabled = ProtectionConfig.parse("");
        MovementAnalyzer other = new MovementAnalyzer();
        other.evaluate(sample(0, 64, 0, true, false, true, 20), disabled);
        assertFalse(other.evaluate(sample(0.2, 64, 0, true, false, false, 20), disabled)
                .has(MovementAnalyzer.PHASE));
    }

    @Test
    void rejectsNonFiniteOrOutOfWorldCoordinates() throws Exception {
        MovementAnalyzer analyzer = new MovementAnalyzer();
        ProtectionConfig config = ProtectionConfig.parse("");
        assertTrue(analyzer.evaluate(sample(Double.NaN, 0, 0, true, false, true, 20), config)
                .has(MovementAnalyzer.INVALID_POSITION));
        assertTrue(analyzer.evaluate(sample(30_000_101, 0, 0, true, false, true, 20), config)
                .has(MovementAnalyzer.INVALID_POSITION));
    }

    private static MovementAnalyzer.Sample sample(double x, double y, double z, boolean onGround,
                                                   boolean grace, boolean collisionFree, double tps) {
        return sample(x, y, z, onGround, grace, collisionFree, false, tps);
    }

    private static MovementAnalyzer.Sample sample(double x, double y, double z, boolean onGround,
                                                   boolean grace, boolean collisionFree,
                                                   boolean phaseExempt, double tps) {
        return new MovementAnalyzer.Sample(x, y, z, onGround, false, false, false, false, grace,
                collisionFree, phaseExempt, 1.0, tps, 1);
    }

    private static MovementAnalyzer.Sample movementSample(double x, boolean forcedMovement,
                                                           boolean environmentalMovement) {
        return new MovementAnalyzer.Sample(x, 64, 0, true, false, forcedMovement,
                forcedMovement, environmentalMovement, false, true, false, 1.0, 20, 1);
    }

    private static MovementAnalyzer.Sample phaseSample(double x, boolean forcedMovement,
                                                        boolean environmentalMovement) {
        return new MovementAnalyzer.Sample(x, 64, 0, true, false, forcedMovement,
                forcedMovement, environmentalMovement, false, false, false, 1.0, 20, 1);
    }

    private static MovementAnalyzer.Sample flightSample(boolean exempt) {
        return new MovementAnalyzer.Sample(0, 80, 0, false, false, exempt, false, false, false,
                true, false, 1.0, 20, 1);
    }

    private static MovementAnalyzer.Sample verticalSample(double y, boolean supported, boolean velocityGrace) {
        return new MovementAnalyzer.Sample(0, y, 0, supported, false, velocityGrace,
                velocityGrace, false, false,
                true, false, 1.0, 20, 1);
    }
}
