package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.ReachCheckMath;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

final class CombatAnalyzerTest {
    @Test
    void teleportLineOfSightAcceptsEitherLegitimateHitbox() {
        assertTrue(ServerProtectionFabric.reconciledCombatLineOfSight(true, false, false));
        assertTrue(ServerProtectionFabric.reconciledCombatLineOfSight(false, true, true));
        assertTrue(ServerProtectionFabric.reconciledCombatLineOfSight(true, false, true));
        assertFalse(ServerProtectionFabric.reconciledCombatLineOfSight(false, true, false));
        assertFalse(ServerProtectionFabric.reconciledCombatLineOfSight(false, false, true));
    }

    @Test
    void spatialCancellationRequiresResponsesToBeEnabled() {
        assertFalse(ServerProtectionFabric.shouldCancelSpatialAttack(false, true, true));
        assertFalse(ServerProtectionFabric.shouldCancelSpatialAttack(false, true, false));
        assertFalse(ServerProtectionFabric.shouldCancelSpatialAttack(true, false, false));
        assertTrue(ServerProtectionFabric.shouldCancelSpatialAttack(true, true, false));
        assertTrue(ServerProtectionFabric.shouldCancelSpatialAttack(true, false, true));
    }

    @Test
    void confirmsGrossReachImmediatelyAndBorderlineReachOnlyAfterEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("");
        CombatAnalyzer gross = new CombatAnalyzer();
        CombatAnalyzer.Result impossible = gross.evaluate(attack(UUID.randomUUID(), 1_000, 5.0, true), config);
        assertTrue(impossible.has(CombatAnalyzer.REACH));

        CombatAnalyzer borderline = new CombatAnalyzer();
        CombatAnalyzer.Result first = borderline.evaluate(attack(UUID.randomUUID(), 1_000, 3.9, true), config);
        CombatAnalyzer.Result second = borderline.evaluate(attack(UUID.randomUUID(), 1_100, 3.9, true), config);
        assertFalse(first.has(CombatAnalyzer.REACH));
        assertTrue(second.has(CombatAnalyzer.REACH));
    }

    @Test
    void independentlyFlagsAttackRateMultiTargetAndRepeatedWallHits() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                checks:
                  combat:
                    reach: false
                limits:
                  combat:
                    maxCps: 5
                    multiTargetCount: 3
                    multiTargetWindowMillis: 250
                    wallHitSamples: 6
                """);
        CombatAnalyzer analyzer = new CombatAnalyzer();
        CombatAnalyzer.Result result = null;
        for (int i = 0; i < 6; i++) {
            result = analyzer.evaluate(attack(UUID.randomUUID(), 1_000 + i * 20L, 2.0, true), config);
        }
        assertNotNull(result);
        assertTrue(result.has(CombatAnalyzer.AUTO_CLICKER));
        assertTrue(result.has(CombatAnalyzer.MULTI_TARGET));

        CombatAnalyzer wall = new CombatAnalyzer();
        UUID occludedTarget = UUID.randomUUID();
        for (int sample = 0; sample < 5; sample++) {
            assertFalse(wall.evaluate(attack(occludedTarget, 2_000 + sample * 100L, 2.0, false), config)
                    .has(CombatAnalyzer.WALL_HIT));
        }
        assertTrue(wall.evaluate(attack(occludedTarget, 2_500, 2.0, false), config)
                .has(CombatAnalyzer.WALL_HIT));

        CombatAnalyzer changingTargets = new CombatAnalyzer();
        for (int sample = 0; sample < 12; sample++) {
            assertFalse(changingTargets.evaluate(attack(UUID.randomUUID(), 3_000 + sample * 100L, 2.0, false), config)
                    .has(CombatAnalyzer.WALL_HIT));
        }
    }

    @Test
    void targetHistoryAndRateWindowsRemainFixedCapacity() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                checks:
                  combat:
                    reach: false
                    wallHit: false
                limits:
                  combat:
                    maxCps: 40
                    multiTargetCount: 8
                """);
        CombatAnalyzer analyzer = new CombatAnalyzer();
        for (int i = 0; i < 10_000; i++) {
            CombatAnalyzer.Result result = analyzer.evaluate(
                    attack(new UUID(0, i), i * 2L, 2.0, true), config);
            assertTrue(result.distinctTargets() <= 16);
            assertTrue(result.cps() <= 64);
        }
    }

    @Test
    void recentTeleportResetsOnlySpatialPatternsAndPreservesClickEvidence() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                checks:
                  combat:
                    reach: false
                    wallHit: false
                    autoClicker: false
                    multiTarget: false
                    aimDirection: true
                    killAura: false
                    clickPattern: true
                limits:
                  combat:
                    aimEvidenceSamples: 2
                    clickPatternSamples: 8
                    clickPatternMaxDeviationMillis: 0
                """);
        UUID enderman = UUID.randomUUID();
        CombatAnalyzer analyzer = new CombatAnalyzer();
        assertFalse(analyzer.evaluate(missedAttack(enderman, 1_000, false), config)
                .has(CombatAnalyzer.AIM_DIRECTION));
        assertFalse(analyzer.evaluate(missedAttack(enderman, 1_100, true), config)
                .has(CombatAnalyzer.AIM_DIRECTION), "teleport must clear pre-teleport aim evidence");
        assertFalse(analyzer.evaluate(missedAttack(enderman, 1_200, false), config)
                .has(CombatAnalyzer.AIM_DIRECTION));
        assertTrue(analyzer.evaluate(missedAttack(enderman, 1_300, false), config)
                .has(CombatAnalyzer.AIM_DIRECTION), "stable misses remain detectable after grace");

        CombatAnalyzer.Result result = null;
        for (long now = 1_400; now <= 1_800; now += 100) {
            result = analyzer.evaluate(missedAttack(enderman, now, false), config);
        }
        assertNotNull(result);
        assertTrue(result.has(CombatAnalyzer.CLICK_PATTERN),
                "the attack observed during teleport grace must remain in click-timing evidence");
    }

    private static CombatAnalyzer.Attack attack(UUID target, long now, double targetMinimumX, boolean sight) {
        return attack(target, now, targetMinimumX, sight, false);
    }

    private static CombatAnalyzer.Attack attack(UUID target, long now, double targetMinimumX, boolean sight,
                                                boolean recentlyTeleportedTarget) {
        return new CombatAnalyzer.Attack(target, now, 0, 20.0, 3.0, sight,
                new ReachCheckMath.Point(0, 1.62, 0),
                new ReachCheckMath.Box(targetMinimumX, 0, -0.3, targetMinimumX + 0.6, 1.8, 0.3),
                new ReachCheckMath.Point(0, 0, 0),
                new ReachCheckMath.Point(1, 0, 0), recentlyTeleportedTarget);
    }

    private static CombatAnalyzer.Attack missedAttack(UUID target, long now, boolean recentlyTeleportedTarget) {
        return new CombatAnalyzer.Attack(target, now, 0, 20.0, 3.0, true,
                new ReachCheckMath.Point(0, 1.62, 0),
                new ReachCheckMath.Box(2.0, 0, -0.3, 2.6, 1.8, 0.3),
                new ReachCheckMath.Point(0, 0, 0),
                new ReachCheckMath.Point(-1, 0, 0), recentlyTeleportedTarget);
    }
}
