package dev.custominchat.client;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PressGateTest {
    @Test void oneRequestPerHeldPressEvenWithRepeatedEvents() {
        PressGate gate = new PressGate();
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
        for (int i = 0; i < 200; i++) assertFalse(gate.accept(true, true, true));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
    }

    @Test void fastTapBetweenTicksIsNotLost() {
        PressGate gate = new PressGate();
        gate.accept(false, false, true);
        assertTrue(gate.accept(true, false, true));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, false, true));
    }

    @Test void openingAndClosingGuiWhileHeldDoesNotRepeat() {
        PressGate gate = new PressGate();
        gate.accept(false, false, true);
        assertTrue(gate.accept(true, true, true));
        assertFalse(gate.accept(false, true, false));
        assertFalse(gate.accept(true, true, false));
        assertFalse(gate.accept(true, true, true));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
    }

    @Test void typingOrRebindingNeverQueuesActionAfterScreenCloses() {
        PressGate gate = new PressGate();
        gate.accept(false, false, false);
        assertFalse(gate.accept(true, true, false));
        assertFalse(gate.accept(false, false, false));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
    }

    @Test void pressingWhileUnfocusedOrDisconnectedIsIgnored() {
        PressGate gate = new PressGate();
        gate.accept(false, false, false);
        assertFalse(gate.accept(true, true, false));
        assertFalse(gate.accept(true, true, true));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
    }

    @Test void keyHeldAtInitializationRequiresRelease() {
        PressGate gate = new PressGate();
        assertFalse(gate.accept(true, true, true));
        assertFalse(gate.accept(false, false, true));
        assertTrue(gate.accept(true, true, true));
    }
}
