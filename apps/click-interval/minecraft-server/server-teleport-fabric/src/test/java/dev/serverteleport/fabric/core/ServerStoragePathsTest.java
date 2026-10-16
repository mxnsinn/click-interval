package dev.serverteleport.fabric.core;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

final class ServerStoragePathsTest {
    @Test void dedicatedConfigRetainsItsExistingLocation() {
        Path config = Path.of("server", "config");
        assertEquals(config.resolve("server-teleport/config.properties"),
                ServerStoragePaths.configFile(config, Path.of("server", "world"), true));
    }

    @Test void integratedConfigAndPlacesAreIsolatedBySave() {
        Path config = Path.of("client", "config");
        Path first = Path.of("client", "saves", "TreeChopTest");
        Path second = Path.of("client", "saves", "OtherWorld");
        assertEquals(first.resolve("server-teleport/config.properties"),
                ServerStoragePaths.configFile(config, first, false));
        assertNotEquals(ServerStoragePaths.configFile(config, first, false),
                ServerStoragePaths.configFile(config, second, false));
        assertEquals(first.resolve("server-teleport/locations.tsv"), ServerStoragePaths.locationsFile(first));
        assertNotEquals(ServerStoragePaths.locationsFile(first), ServerStoragePaths.locationsFile(second));
    }
}
