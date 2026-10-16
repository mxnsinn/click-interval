package dev.serverprotection.fabric;

import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class PacketAntiXrayExemptionGateTest {
    private static final UUID ALICE = UUID.fromString("12345678-1234-4234-8234-1234567890ab");
    private static final UUID BOB = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    @Test
    void followsTheLiveExactUuidExemptionSetWithoutCachingOrBroadening() {
        Set<UUID> exemptions = new HashSet<>();
        PacketAntiXrayExemptionGate gate = new PacketAntiXrayExemptionGate(exemptions::contains);

        assertFalse(gate.shouldBypass(null));
        assertFalse(gate.shouldBypass(ALICE));
        assertFalse(gate.shouldBypass(BOB));

        exemptions.add(ALICE);
        assertTrue(gate.shouldBypass(ALICE));
        assertFalse(gate.shouldBypass(BOB));

        exemptions.remove(ALICE);
        assertFalse(gate.shouldBypass(ALICE));
    }

    @Test
    void bypassMixinIsPackagedAndRegistered() throws Exception {
        try (InputStream input = PacketAntiXrayExemptionGateTest.class.getClassLoader()
                .getResourceAsStream("serverprotection.fabric.mixins.json")) {
            assertNotNull(input);
            String config = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(config.contains("\"PacketAntiXrayBypassMixin\""));
        }
    }
}
