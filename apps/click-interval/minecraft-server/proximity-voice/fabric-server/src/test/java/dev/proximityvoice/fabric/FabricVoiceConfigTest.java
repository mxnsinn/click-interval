package dev.proximityvoice.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FabricVoiceConfigTest {
    @TempDir Path temporary;

    @Test
    void createsBoundedDefaults() throws Exception {
        Path file = temporary.resolve("voice").resolve("config.properties");
        FabricVoiceConfig config = FabricVoiceConfig.load(file);
        assertTrue(Files.isRegularFile(file));
        assertTrue(config.enabled());
        assertEquals(24_454, config.port());
        assertEquals(48.0, config.voiceRadius());
        assertEquals(45_000L, config.sessionTimeoutMillis());
    }

    @Test
    void clampsUntrustedValues() throws Exception {
        Path file = temporary.resolve("config.properties");
        Files.writeString(file, "port=90000\nvoiceDistance=9999\nsessionTimeoutSeconds=1\n");
        FabricVoiceConfig config = FabricVoiceConfig.load(file);
        assertEquals(65_535, config.port());
        assertEquals(512.0, config.voiceRadius());
        assertEquals(15_000L, config.sessionTimeoutMillis());
    }

    @Test
    void rejectsControlCharactersInHosts() throws Exception {
        Path file = temporary.resolve("config.properties");
        Files.writeString(file, "publicHost=bad\\u000ahost\n");
        assertThrows(IllegalArgumentException.class, () -> FabricVoiceConfig.load(file));
    }
}
