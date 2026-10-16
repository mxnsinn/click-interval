package dev.servertradeassistant.fabric.core;

import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class CooldownGateTest {
    @Test
    void usesMonotonicTimeAndCanForgetPlayer() {
        AtomicLong now = new AtomicLong(10_000_000L);
        CooldownGate gate = new CooldownGate(now::get);
        UUID player = UUID.randomUUID();

        gate.arm(player, 750L);
        assertEquals(750L, gate.remainingMillis(player));
        now.addAndGet(749_500_000L);
        assertEquals(1L, gate.remainingMillis(player));
        now.addAndGet(500_000L);
        assertEquals(0L, gate.remainingMillis(player));
        gate.arm(player, 1_000L);
        gate.forget(player);
        assertEquals(0L, gate.remainingMillis(player));
    }
}
