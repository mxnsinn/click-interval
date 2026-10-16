package dev.serverprotection.client;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.junit.jupiter.api.Assertions.*;

final class SelfNameTagSettingsTest {
    @TempDir Path directory;

    @Test void defaultsOffWithoutWritingAFile() throws IOException {
        Path file = directory.resolve("preference.properties");
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        settings.load();
        assertFalse(settings.enabled());
        assertFalse(Files.exists(file));
    }

    @Test void explicitSavedOnPreferenceSurvivesNewOffDefaultWithoutRewriting() throws IOException {
        Path file = directory.resolve("preference.properties");
        String existing = "# Explicit user preference from an earlier release\nshowOwnNametag=true\n";
        Files.writeString(file, existing);
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        settings.load();
        assertTrue(settings.enabled());
        assertEquals(existing, Files.readString(file));
    }

    @Test void togglePersistsAcrossFreshLoadsWithoutTemporaryFiles() throws IOException {
        Path file = directory.resolve("config/preference.properties");
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        settings.setEnabled(false);
        SelfNameTagSettings afterRestart = new SelfNameTagSettings(file);
        afterRestart.load();
        assertFalse(afterRestart.enabled());
        afterRestart.setEnabled(true);
        settings.load();
        assertTrue(settings.enabled());
        try (var paths = Files.list(file.getParent())) { assertEquals(1, paths.count()); }
    }

    @Test void invalidExistingPreferenceFailsClosedAndRemainsUnchanged() throws IOException {
        Path file = directory.resolve("preference.properties");
        String before = "showOwnNametag=maybe\n";
        Files.writeString(file, before);
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        assertThrows(IOException.class, settings::load);
        assertFalse(settings.enabled());
        assertEquals(before, Files.readString(file));
    }

    @Test void oversizedOrMalformedInputIsBoundedAndFailsClosed() throws IOException {
        Path file = directory.resolve("preference.properties");
        Files.writeString(file, "#".repeat(SelfNameTagSettings.MAX_BYTES + 1));
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        assertThrows(IOException.class, settings::load);
        assertFalse(settings.enabled());
        Files.writeString(file, "showOwnNametag=\\uZZZZ\n");
        assertThrows(IOException.class, settings::load);
        assertFalse(settings.enabled());
    }

    @Test void failedSaveDoesNotChangeStateOrReplaceNonFileTarget() throws IOException {
        Path file = directory.resolve("not-a-file");
        Files.createDirectory(file);
        SelfNameTagSettings settings = new SelfNameTagSettings(file);
        assertThrows(IOException.class, () -> settings.setEnabled(true));
        assertFalse(settings.enabled());
        assertTrue(Files.isDirectory(file));
    }
}
