package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.ReachCheckMath;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class CombatTargetStabilityTest {
    @Test
    void rejectedRandomTeleportCannotLeaveAStaleCandidateHitbox() {
        assertFalse(EntityTeleportHistory.shouldRecordTeleport(false,
                2.0, 64.0, 2.0, 30.0, 70.0, -20.0));
        assertTrue(EntityTeleportHistory.shouldRecordTeleport(true,
                2.0, 64.0, 2.0, 30.0, 70.0, -20.0));
        assertTrue(EntityTeleportHistory.shouldRecordTeleport(true,
                2.0, 64.0, 2.0, 2.01, 64.0, 2.0),
                "short semantic teleports still need stale-packet reconciliation");
        assertFalse(EntityTeleportHistory.shouldRecordTeleport(true,
                2.0, 64.0, 2.0, 2.0, 64.0, 2.0));
    }

    @Test
    void firstAttackAfterTeleportUsesReachablePreviousHitbox() {
        ReachCheckMath.Point eye = new ReachCheckMath.Point(0.0, 1.62, 0.0);
        ReachCheckMath.Box current = boxAt(24.67);
        ReachCheckMath.Box beforeTeleport = boxAt(2.60);

        CombatTargetStability.Selection selection = CombatTargetStability.reconcile(
                eye, current, beforeTeleport, 1_000L, 1_050L, 22);

        assertTrue(selection.recentTeleport());
        assertTrue(selection.usesPreviousBox());
        assertSame(beforeTeleport, selection.box());
        assertTrue(ReachCheckMath.distanceToBox(eye, selection.box()) < 3.0,
                "the very first stale packet is reconciled without requiring an earlier attack");
    }

    @Test
    void graceExpiresAndAlwaysChoosesTheNearerHitbox() {
        ReachCheckMath.Point eye = new ReachCheckMath.Point(0.0, 1.62, 0.0);
        ReachCheckMath.Box current = boxAt(2.0);
        ReachCheckMath.Box beforeTeleport = boxAt(20.0);
        CombatTargetStability.Selection currentIsNearer = CombatTargetStability.reconcile(
                eye, current, beforeTeleport, 1_000L, 1_100L, 50);
        assertTrue(currentIsNearer.recentTeleport());
        assertFalse(currentIsNearer.usesPreviousBox());
        assertSame(current, currentIsNearer.box());

        CombatTargetStability.Selection expired = CombatTargetStability.reconcile(
                eye, boxAt(24.67), boxAt(2.60), 1_000L, 4_001L, 10_000);
        assertFalse(expired.recentTeleport());
        assertFalse(expired.usesPreviousBox());
    }

    private static ReachCheckMath.Box boxAt(double minimumX) {
        return new ReachCheckMath.Box(minimumX, 0.0, -0.3, minimumX + 0.6, 2.9, 0.3);
    }
}
