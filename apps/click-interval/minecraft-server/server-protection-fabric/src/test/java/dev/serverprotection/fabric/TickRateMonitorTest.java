package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class TickRateMonitorTest {
    @Test
    void estimateIsFiniteAndBounded() {
        TickRateMonitor monitor = new TickRateMonitor();
        long now = 1_000_000_000L;
        monitor.tick(now);
        for (int i = 0; i < 100; i++) now += 200_000_000L;
        double slow = monitor.tick(now);
        assertTrue(Double.isFinite(slow));
        assertTrue(slow >= 1.0 && slow <= 20.0);
        assertTrue(monitor.tick(now - 1) >= 1.0);
    }
}
