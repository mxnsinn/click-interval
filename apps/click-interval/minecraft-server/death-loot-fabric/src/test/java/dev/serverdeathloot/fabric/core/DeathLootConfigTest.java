package dev.serverdeathloot.fabric.core;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DeathLootConfigTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void defaultsAreSafeAndExplicit() {
        DeathLootConfig config = DeathLootConfig.defaults();
        assertEquals(DeathLootMode.CHEST, config.mode());
        assertEquals(300, config.deathDropLifetimeSeconds());
        assertEquals(900, config.deathChestLifetimeSeconds());
        assertTrue(config.placeTorches());
    }

    @Test
    void missingConfigIsCreatedAtomicallyAndReloadable() throws IOException {
        Path configPath = temporaryDirectory.resolve("nested/config.properties");
        DeathLootConfig.LoadResult first = DeathLootConfig.load(configPath);
        DeathLootConfig.LoadResult second = DeathLootConfig.load(configPath);

        assertTrue(first.created());
        assertFalse(second.created());
        assertEquals(first.config(), second.config());
        assertTrue(Files.readString(configPath).contains("mode=chest"));
        try (var files = Files.list(configPath.getParent())) {
            assertEquals(1L, files.count());
        }
    }

    @Test
    void everySupportedModeParses() throws IOException {
        assertEquals(DeathLootMode.VANILLA, load("mode=vanilla\n").mode());
        assertEquals(DeathLootMode.TIMED, load("mode=timed\n").mode());
        assertEquals(DeathLootMode.CHEST, load("mode=chest\n").mode());
    }

    @Test
    void friendlyModeAliasesAreAccepted() throws IOException {
        assertEquals(DeathLootMode.VANILLA, load("mode=disabled\n").mode());
        assertEquals(DeathLootMode.TIMED, load("mode=timed_drops\n").mode());
        assertEquals(DeathLootMode.CHEST, load("mode=death chest\n").mode());
    }

    @Test
    void invalidValuesUseDefaultsAndProduceWarnings() throws IOException {
        DeathLootConfig.LoadResult result = loadResult("""
                mode=anything
                death-drop-lifetime-seconds=nope
                death-chest-lifetime-seconds=wat
                place-torches=yes
                """);

        assertEquals(DeathLootConfig.defaults(), result.config());
        assertEquals(4, result.warnings().size());
    }

    @Test
    void numbersClampAndZeroMeansPermanentChest() throws IOException {
        DeathLootConfig.LoadResult clamped = loadResult("""
                mode=timed
                death-drop-lifetime-seconds=-20
                death-chest-lifetime-seconds=999999999999
                place-torches=false
                """);
        assertEquals(1, clamped.config().deathDropLifetimeSeconds());
        assertEquals(604_800, clamped.config().deathChestLifetimeSeconds());
        assertFalse(clamped.config().placeTorches());

        DeathLootConfig permanent = load("""
                mode=chest
                death-drop-lifetime-seconds=60
                death-chest-lifetime-seconds=0
                place-torches=true
                """);
        assertEquals(0, permanent.deathChestLifetimeSeconds());
    }

    @Test
    void canonicalWriteRoundTripsWithoutWarnings() throws IOException {
        Path path = temporaryDirectory.resolve("config.properties");
        DeathLootConfig expected = new DeathLootConfig(DeathLootMode.TIMED, 45, 0, false);
        DeathLootConfig.writeAtomically(path, expected);
        DeathLootConfig.LoadResult actual = DeathLootConfig.load(path);

        assertEquals(expected, actual.config());
        assertTrue(actual.warnings().isEmpty());
        assertTrue(Files.readString(path).endsWith("place-torches=false\n"));
    }

    @Test
    void oversizedConfigIsRejectedWithoutModification() throws IOException {
        Path path = temporaryDirectory.resolve("config.properties");
        String oversized = "x".repeat((int) DeathLootConfig.MAX_CONFIG_BYTES + 1);
        Files.writeString(path, oversized, StandardCharsets.UTF_8);

        assertThrows(IOException.class, () -> DeathLootConfig.load(path));
        assertEquals(oversized.length(), Files.readString(path).length());
    }

    @Test
    void constructorRejectsOutOfRangeValues() {
        assertThrows(IllegalArgumentException.class,
                () -> new DeathLootConfig(DeathLootMode.TIMED, 0, 30, true));
        assertThrows(IllegalArgumentException.class,
                () -> new DeathLootConfig(DeathLootMode.CHEST, 30, -1, true));
    }

    private DeathLootConfig load(String content) throws IOException {
        return loadResult(complete(content)).config();
    }

    private DeathLootConfig.LoadResult loadResult(String content) throws IOException {
        Path path = temporaryDirectory.resolve("config-" + Math.abs(content.hashCode()) + ".properties");
        Files.writeString(path, content, StandardCharsets.UTF_8);
        return DeathLootConfig.load(path);
    }

    private String complete(String content) {
        StringBuilder result = new StringBuilder(content);
        if (!content.contains("death-drop-lifetime-seconds")) {
            result.append("death-drop-lifetime-seconds=300\n");
        }
        if (!content.contains("death-chest-lifetime-seconds")) {
            result.append("death-chest-lifetime-seconds=900\n");
        }
        if (!content.contains("place-torches")) result.append("place-torches=true\n");
        return result.toString();
    }
}
