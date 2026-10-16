package com.clickinterval.anticheat.core;

public final class ReachCheckMathTests {
    private static final ReachCheckMath.Parameters BALANCED = ReachCheckMath.Parameters.balancedDefaults();
    private int assertions;

    public static void main(String[] args) {
        ReachCheckMathTests tests = new ReachCheckMathTests();
        tests.usesActualThreeDimensionalHitbox();
        tests.respectsServerInteractionRange();
        tests.boundsLatencyAndMovingTargetTolerance();
        tests.requiresConsecutiveMarginalEvidence();
        tests.reportsClearlyImpossibleReachImmediately();
        tests.explicitParametersControlReconciliationAndEvidence();
        tests.parametersRejectUnsafeExtremes();
        System.out.println("PASS reach geometry tests (" + tests.assertions + " assertions)");
    }

    private void usesActualThreeDimensionalHitbox() {
        ReachCheckMath.Point eye = new ReachCheckMath.Point(0.0, 1.62, 0.0);
        ReachCheckMath.Box wideMob = new ReachCheckMath.Box(3.40, 0.0, -0.95, 5.30, 2.20, 0.95);
        close(3.40, ReachCheckMath.distanceToBox(eye, wideMob), 0.000_001,
                "distance is measured to a wide mob's near hitbox face");

        ReachCheckMath.Box lowMob = new ReachCheckMath.Box(3.0, 0.0, -0.2, 3.4, 0.5, 0.2);
        close(Math.sqrt(3.0 * 3.0 + 1.12 * 1.12), ReachCheckMath.distanceToBox(eye, lowMob), 0.000_001,
                "vertical separation is included");
    }

    private void respectsServerInteractionRange() {
        ReachCheckMath.Assessment assessment = assess(
                new ReachCheckMath.Box(4.40, 0.0, -0.3, 5.0, 1.9, 0.3),
                new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 4.5, 0, 20.0);
        check(!assessment.suspicious(), "the player's server-side interaction-range attribute is honored");
    }

    private void boundsLatencyAndMovingTargetTolerance() {
        ReachCheckMath.Box target = new ReachCheckMath.Box(3.75, 0.0, -0.3, 4.35, 1.9, 0.3);
        ReachCheckMath.Assessment stationary = assess(
                target, new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 3.0, 100, 20.0);
        ReachCheckMath.Assessment moving = assess(
                target, new ReachCheckMath.Point(0.20, 0.0, 0.0), 3.45, 3.0, 100, 20.0);
        check(stationary.suspicious(), "a stationary target beyond the allowance remains suspicious");
        check(!moving.suspicious(), "bounded rewind covers normal target movement visible to a lagged client");

        ReachCheckMath.Assessment extremePing = assess(
                target, new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 3.0, 20_000, 20.0);
        check(extremePing.allowed() <= 3.75, "spoofed or extreme ping cannot grant unbounded reach");
    }

    private void requiresConsecutiveMarginalEvidence() {
        ReachCheckMath.EvidenceGate gate = new ReachCheckMath.EvidenceGate();
        ReachCheckMath.Assessment marginal = new ReachCheckMath.Assessment(3.90, 3.60, 0.30);
        check(!gate.observe(marginal, BALANCED, 1_000L), "one marginal sample does not report");
        check(gate.observe(marginal, BALANCED, 1_900L), "a second consecutive marginal sample reports");

        check(!gate.observe(marginal, BALANCED, 4_000L), "a new sequence starts with one sample");
        check(!gate.observe(marginal, BALANCED, 6_000L), "expired evidence is not treated as consecutive");
        gate.observe(new ReachCheckMath.Assessment(3.0, 3.6, 0.0), BALANCED, 6_100L);
        check(!gate.observe(marginal, BALANCED, 6_200L), "a legal hit resets marginal evidence");
    }

    private void reportsClearlyImpossibleReachImmediately() {
        ReachCheckMath.EvidenceGate gate = new ReachCheckMath.EvidenceGate();
        ReachCheckMath.Assessment impossible = assess(
                new ReachCheckMath.Box(5.20, 0.0, -0.3, 5.8, 1.9, 0.3),
                new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 3.0, 250, 18.0);
        check(impossible.excess() >= BALANCED.immediateExcess(),
                "long reach remains well beyond all bounded tolerances");
        check(gate.observe(impossible, BALANCED, 10_000L),
                "clearly impossible reach reports on the first hit");
    }

    private void explicitParametersControlReconciliationAndEvidence() {
        ReachCheckMath.Parameters supplied = new ReachCheckMath.Parameters(
                0.035, 0.18, 0.0006, 0.075, 0.035,
                0.35, 0.40, 0.008, 2.50,
                0.65, 3, 1_000L);
        ReachCheckMath.Box target = new ReachCheckMath.Box(3.75, 0.0, -0.3, 4.35, 1.9, 0.3);
        ReachCheckMath.Assessment balanced = assess(
                target, new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 3.0, 100, 20.0, BALANCED);
        ReachCheckMath.Assessment configured = assess(
                target, new ReachCheckMath.Point(0.0, 0.0, 0.0), 3.45, 3.0, 100, 20.0, supplied);
        check(configured.allowed() < balanced.allowed(), "explicit tighter reconciliation values are used");

        ReachCheckMath.EvidenceGate gate = new ReachCheckMath.EvidenceGate();
        ReachCheckMath.Assessment marginal = new ReachCheckMath.Assessment(3.90, 3.60, 0.30);
        check(!gate.observe(marginal, supplied, 1_000L), "configured evidence needs its first sample");
        check(!gate.observe(marginal, supplied, 1_500L), "configured evidence needs its second sample");
        check(gate.observe(marginal, supplied, 1_900L), "configured third consecutive sample reports");
    }

    private void parametersRejectUnsafeExtremes() {
        ReachCheckMath.Parameters bounded = new ReachCheckMath.Parameters(
                Double.NaN, -1.0, 0.0, 9.0, -1.0,
                0.0, 0.0, 1.0, 99.0,
                0.0, 1, 1L);
        close(0.05, bounded.geometryAllowance(), 0.0, "non-finite geometry uses balanced fallback");
        close(0.15, bounded.maxPingAllowance(), 0.0, "ping allowance has a safe minimum");
        close(0.0005, bounded.pingAllowancePerMs(), 0.0, "ping rate has a safe minimum");
        close(0.25, bounded.maxTickAllowance(), 0.0, "tick allowance has a safe maximum");
        close(0.25, bounded.maxTargetRewind(), 0.0, "rewind distance has a safe minimum");
        close(5.0, bounded.maxRewindTicks(), 0.0, "rewind ticks have a safe maximum");
        close(0.50, bounded.immediateExcess(), 0.0, "immediate threshold has a safe minimum");
        check(bounded.consecutiveSamples() == 2, "one-sample marginal reports are rejected");
        check(bounded.evidenceWindowMillis() == 750L, "evidence window has a safe minimum");
    }

    private static ReachCheckMath.Assessment assess(
            ReachCheckMath.Box target,
            ReachCheckMath.Point velocity,
            double configured,
            double serverRange,
            int ping,
            double tps,
            ReachCheckMath.Parameters parameters
    ) {
        return ReachCheckMath.assess(
                new ReachCheckMath.Point(0.0, 1.62, 0.0), target, velocity,
                configured, serverRange, ping, tps, parameters);
    }

    private static ReachCheckMath.Assessment assess(
            ReachCheckMath.Box target,
            ReachCheckMath.Point velocity,
            double configured,
            double serverRange,
            int ping,
            double tps
    ) {
        return assess(target, velocity, configured, serverRange, ping, tps, BALANCED);
    }

    private void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private void close(double expected, double actual, double tolerance, String message) {
        assertions++;
        if (Math.abs(expected - actual) > tolerance) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }
}
