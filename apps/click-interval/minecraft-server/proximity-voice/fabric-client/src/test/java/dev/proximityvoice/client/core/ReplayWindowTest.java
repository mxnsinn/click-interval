package dev.proximityvoice.client.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ReplayWindowTest {
    @Test
    void acceptsReorderingButRejectsDuplicatesAndOldPackets() {
        ReplayWindow window = new ReplayWindow();
        assertTrue(window.accept(100));
        assertTrue(window.accept(102));
        assertTrue(window.accept(101));
        assertFalse(window.accept(101));
        assertFalse(window.accept(38));
        assertTrue(window.accept(103));
    }
}
