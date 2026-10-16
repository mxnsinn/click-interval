package dev.serverprotection.client;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Pins the public 26.2 branding without renaming the compatibility identifiers. */
final class CompanionReleaseMetadataTest {
    @Test void packagedMetadataKeepsStableIdentityAndExactDisplayName() throws IOException {
        JsonObject metadata;
        try (var input = getClass().getResourceAsStream("/fabric.mod.json")) {
            assertNotNull(input);
            metadata = JsonParser.parseReader(new InputStreamReader(input, StandardCharsets.UTF_8)).getAsJsonObject();
        }
        assertEquals("serverprotection_companion", metadata.get("id").getAsString());
        assertEquals("MXN-SI-NN Mod Companion", metadata.get("name").getAsString());
        assertEquals("1.5.3", metadata.get("version").getAsString());
        assertEquals("client", metadata.get("environment").getAsString());
        assertEquals("Proprietary", metadata.get("license").getAsString());
        assertEquals("dev.serverprotection.client.ServerProtectionCompanion",
                metadata.getAsJsonObject("entrypoints").getAsJsonArray("client").get(0).getAsString());
        assertEquals("serverprotection.companion.mixins.json", metadata.getAsJsonArray("mixins").get(0).getAsString());
        var dependencies = metadata.getAsJsonObject("depends");
        assertEquals("=26.2", dependencies.get("minecraft").getAsString());
        assertEquals(">=25", dependencies.get("java").getAsString());
        assertEquals(">=0.19.5", dependencies.get("fabricloader").getAsString());
        assertEquals(">=0.161.0+26.2", dependencies.get("fabric-api").getAsString());
    }

    @Test void distributionPropertiesUseRequestedFilename() throws IOException {
        var properties = new Properties();
        try (var reader = Files.newBufferedReader(Path.of("gradle.properties"), StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        assertEquals("MXN-SI-NN-Mod-Companion-1.5.3+mc26.2.jar",
                properties.getProperty("archives_base_name") + "-" + properties.getProperty("mod_version")
                        + "+mc" + properties.getProperty("minecraft_version") + ".jar");
    }
}
