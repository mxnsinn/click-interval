package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.BehaviorPatternAnalyzer;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class TeleportArrivalGuardTest {
    @Test void absentModAndNullNeverExemptAnyone() throws Exception {
        TeleportArrivalGuard guard = TeleportArrivalGuard.load(false, null, Object.class);
        assertFalse(guard.isAwaiting(new Object()));
        assertFalse(guard.isAwaiting(null));
    }
    @Test void exactHeldPlayerOnlyAndNoExemptionPersistsAfterRelease() throws Exception {
        TeleportArrivalGuard guard = TeleportArrivalGuard.fromProvider(Provider.class, Object.class);
        Object held = new Object();
        Object other = new Object();
        assertFalse(guard.isAwaiting(held));
        Provider.active = held;
        try {
            assertTrue(guard.isAwaiting(held));
            assertFalse(guard.isAwaiting(other));
            assertFalse(guard.isAwaiting(null));
        } finally { Provider.active = null; }
        assertFalse(guard.isAwaiting(held));
    }
    @Test void providerExceptionsAndInvalidSignaturesFailClosed() throws Exception {
        assertFalse(TeleportArrivalGuard.fromProvider(Broken.class, Object.class).isAwaiting(new Object()));
        assertThrows(NoSuchMethodException.class, () -> TeleportArrivalGuard.fromProvider(String.class, Object.class));
        assertThrows(NoSuchMethodException.class, () -> TeleportArrivalGuard.fromProvider(InstanceMethod.class, Object.class));
        assertThrows(NoSuchMethodException.class, () -> TeleportArrivalGuard.fromProvider(WrongType.class, Object.class));
    }
    @Test void holdResetsMovementButPreservesCombatMiningAndPlacementEvidence() throws Exception {
        TeleportArrivalGuard guard = TeleportArrivalGuard.fromProvider(Provider.class, Object.class);
        Object held = new Object();
        MovementAnalyzer movement = new MovementAnalyzer();
        BehaviorPatternAnalyzer behavior = new BehaviorPatternAnalyzer();
        ProtectionConfig config = ProtectionConfig.parse("");
        movement.evaluate(sample(0), config);
        movement.evaluate(sample(1), config);
        assertEquals(0, behavior.observeCritical(1_000, true, 2, 1_000));
        assertEquals(0, behavior.observeScaffold(1_000, true, 2, 1_000));
        assertEquals(0, behavior.observeBreak(1_000, 0, 1, 0, 3, 1_000, 1.5));
        assertEquals(0, behavior.observeBreak(1_001, 1, 1, 0, 3, 1_000, 1.5));
        Provider.active = held;
        try {
            assertTrue(guard.resetMovementIfAwaiting(held, movement, behavior));
            assertEquals(0, movement.evaluate(sample(1_000), config).flags(), "old position must not score after reset");
            assertEquals(BehaviorPatternAnalyzer.CRITICALS, behavior.observeCritical(1_002, true, 2, 1_000));
            assertEquals(BehaviorPatternAnalyzer.SCAFFOLD, behavior.observeScaffold(1_002, true, 2, 1_000));
            assertEquals(BehaviorPatternAnalyzer.MULTI_BREAK, behavior.observeBreak(1_002, 2, 1, 0, 3, 1_000, 1.5));
        } finally { Provider.active = null; }
        assertFalse(guard.resetMovementIfAwaiting(held, movement, behavior));
    }
    private static MovementAnalyzer.Sample sample(double x) {
        return new MovementAnalyzer.Sample(x, 100, 0, false, false, false, false, false, false, true, false, 1, 20, 1);
    }
    @Test void movementPacketEvidenceResetsAcrossTheHold() throws Exception {
        TeleportArrivalGuard guard = TeleportArrivalGuard.fromProvider(Provider.class, Object.class);
        Object held = new Object();
        BehaviorPatternAnalyzer behavior = new BehaviorPatternAnalyzer();
        for (int packet = 0; packet < 30; packet++) behavior.observeMovementPacket(1_000 + packet, 21, 2, false);
        assertEquals(0, behavior.observeMovementPacket(2_000, 21, 2, false), "one prior high-rate window");
        Provider.active = held;
        try { assertTrue(guard.resetMovementIfAwaiting(held, new MovementAnalyzer(), behavior)); }
        finally { Provider.active = null; }
        for (int packet = 0; packet < 30; packet++) behavior.observeMovementPacket(2_001 + packet, 21, 2, false);
        assertEquals(0, behavior.observeMovementPacket(3_001, 21, 2, false), "old packet evidence cannot combine with resume");
    }
    public static final class Provider {
        static Object active;
        public static boolean isAwaitingArrival(Object player) { return active != null && player == active; }
    }
    public static final class Broken {
        public static boolean isAwaitingArrival(Object player) { throw new IllegalStateException("unavailable"); }
    }
    public static final class InstanceMethod {
        public boolean isAwaitingArrival(Object player) { return true; }
    }
    public static final class WrongType {
        public static String isAwaitingArrival(Object player) { return "true"; }
    }
}
