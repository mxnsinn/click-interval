package dev.serverteleport.fabric;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TeleportConfigTest {
    @Test
    void parsesStrictBoundedSettingsAndMessageOverrides() {
        Properties input = new Properties();
        input.setProperty("request-expiry-seconds", "5");
        input.setProperty("request-cooldown-seconds", "0");
        input.setProperty("max-incoming-per-player", "32");
        input.setProperty("max-total-pending", "4096");
        input.setProperty("allow-cross-dimension", "false");
        input.setProperty("random-teleport-radius", "12000");
        input.setProperty("message.request-sent", "Sent to {target}.");

        TeleportConfig config = TeleportConfig.parse(input);

        assertEquals(5_000L, config.requestExpiryMillis());
        assertEquals(0L, config.requestCooldownMillis());
        assertEquals(32, config.maxIncomingRequests());
        assertEquals(4_096, config.maxTotalPending());
        assertFalse(config.allowCrossDimension());
        assertEquals(12_000, config.randomTeleportRadius());
        assertEquals("Sent to Sam.", config.messages().render("request-sent", java.util.Map.of("target", "Sam")));
    }

    @Test
    void rejectsMalformedOrOutOfRangeValues() {
        assertInvalid("request-expiry-seconds", "4");
        assertInvalid("request-cooldown-seconds", "301");
        assertInvalid("max-incoming-per-player", "0");
        assertInvalid("max-total-pending", "4097");
        assertInvalid("allow-cross-dimension", "yes");
        assertInvalid("random-teleport-radius", "15");
        assertInvalid("random-teleport-radius", "100001");
        assertInvalid("random-teleport-radius", "NaN");
    }

    @Test
    void createsAndLoadsTheBundledDefault(@TempDir Path directory) throws IOException {
        Path file = directory.resolve("nested").resolve("config.properties");

        TeleportConfig loaded = TeleportConfig.load(file);

        assertTrue(Files.isRegularFile(file));
        assertEquals(60_000L, loaded.requestExpiryMillis());
        assertEquals(1_024, loaded.maxTotalPending());
        assertTrue(loaded.allowCrossDimension());
        assertEquals(10_000, loaded.randomTeleportRadius());
    }

    @Test
    void rejectsOversizedFiles(@TempDir Path directory) throws IOException {
        Path file = directory.resolve("config.properties");
        Files.write(file, new byte[(int) TeleportConfig.MAX_CONFIG_BYTES + 1]);
        assertThrows(IOException.class, () -> TeleportConfig.load(file));
    }

    private static void assertInvalid(String key, String value) {
        Properties input = new Properties();
        input.setProperty(key, value);
        assertThrows(IllegalArgumentException.class, () -> TeleportConfig.parse(input));
    }
}
