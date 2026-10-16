package com.clickinterval.lavasource;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class SafeLavaSourceArchitectureTest {
    private static final Path MAIN_SOURCE = Path.of(
            "src/main/java/com/clickinterval/lavasource/SafeLavaSourceFabric.java");
    private static final Path METADATA = Path.of("src/main/resources/fabric.mod.json");

    @Test
    void usesOnlyTheNativeRuleAtServerStartup() throws IOException {
        String source = Files.readString(MAIN_SOURCE);

        assertTrue(source.contains("ServerLifecycleEvents.SERVER_STARTED"));
        assertTrue(source.contains("GameRules.LAVA_SOURCE_CONVERSION"));
        assertFalse(source.contains("ServerTickEvents"));
        assertFalse(source.contains("CommandRegistrationCallback"));
        assertFalse(source.contains("net.minecraft.world.entity"));
    }

    @Test
    void preservesTheLegacyModIdWithoutMixins() throws IOException {
        String metadata = Files.readString(METADATA);

        assertTrue(metadata.contains("\"id\": \"mr_lava_source\""));
        assertFalse(metadata.contains("\"mixins\""));
    }
}
