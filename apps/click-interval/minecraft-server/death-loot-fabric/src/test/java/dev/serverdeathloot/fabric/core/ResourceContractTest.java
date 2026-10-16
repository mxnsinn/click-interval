package dev.serverdeathloot.fabric.core;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ResourceContractTest {
    @Test
    void metadataPinsTheServerOnlyRuntime() throws IOException {
        String metadata = resourceText("/fabric.mod.json");
        assertTrue(metadata.contains("\"id\": \"serverdeathloot_fabric\""));
        assertTrue(metadata.contains("\"environment\": \"server\""));
        assertTrue(metadata.contains("\"fabricloader\": \">=0.19.5\""));
        assertTrue(metadata.contains("\"minecraft\": \"=26.2\""));
        assertTrue(metadata.contains("\"fabric-api\": \">=0.161.0+26.2\""));
        assertFalse(metadata.contains("\"client\""));
    }

    @Test
    void everyRequiredMixinIsPackaged() throws IOException {
        String mixins = resourceText("/serverdeathloot_fabric.mixins.json");
        assertTrue(mixins.contains("\"required\": true"));
        assertTrue(mixins.contains("\"ChestBlockEntityMixin\""));
        assertTrue(mixins.contains("\"ItemEntityMixin\""));
        assertTrue(mixins.contains("\"PlayerMixin\""));
    }

    @Test
    void distributedDefaultsMatchRuntimeDefaults() throws IOException {
        Properties properties = new Properties();
        try (InputStream input = getClass().getResourceAsStream("/default-config.properties")) {
            assertNotNull(input);
            properties.load(new java.io.InputStreamReader(input, StandardCharsets.UTF_8));
        }
        DeathLootConfig defaults = DeathLootConfig.defaults();
        assertEquals(defaults.mode().configValue(), properties.getProperty("mode"));
        assertEquals(Integer.toString(defaults.deathDropLifetimeSeconds()),
                properties.getProperty("death-drop-lifetime-seconds"));
        assertEquals(Integer.toString(defaults.deathChestLifetimeSeconds()),
                properties.getProperty("death-chest-lifetime-seconds"));
        assertEquals(Boolean.toString(defaults.placeTorches()), properties.getProperty("place-torches"));
    }

    private String resourceText(String name) throws IOException {
        try (InputStream input = getClass().getResourceAsStream(name)) {
            assertNotNull(input, "missing resource " + name);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
