package dev.servertradeassistant.fabric.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TradeAssistantConfigTest {
    @TempDir Path temporaryDirectory;

    @Test
    void createsBoundedDefaults() throws Exception {
        Path file = temporaryDirectory.resolve("config").resolve("trade-assistant.properties");
        TradeAssistantConfig config = TradeAssistantConfig.load(file);
        assertTrue(Files.isRegularFile(file));
        assertEquals(750L, config.cooldownMillis());
        assertEquals(64, config.maxRerollsPerVillager());
        assertTrue(config.appControlEnabled());
    }

    @Test
    void clampsValuesAndRejectsEscapingPolicyPath() throws Exception {
        Path file = temporaryDirectory.resolve("trade-assistant.properties");
        Files.writeString(file, """
                cooldown-millis=1
                max-rerolls-per-villager=9000
                maximum-distance-blocks=500
                require-role-permission=yes
                default-trade-discount-percent=90
                access-policy-path=../../outside.yml
                app-control-enabled=off
                """);
        TradeAssistantConfig config = TradeAssistantConfig.load(file);
        assertEquals(100L, config.cooldownMillis());
        assertEquals(1_000, config.maxRerollsPerVillager());
        assertEquals(16.0D, config.maximumDistanceBlocks());
        assertTrue(config.requireRolePermission());
        assertEquals(55, config.defaultTradeDiscountPercent());
        assertEquals(TradeAssistantConfig.DEFAULT_ACCESS_POLICY, config.accessPolicyPath());
        assertFalse(config.appControlEnabled());
    }
}
