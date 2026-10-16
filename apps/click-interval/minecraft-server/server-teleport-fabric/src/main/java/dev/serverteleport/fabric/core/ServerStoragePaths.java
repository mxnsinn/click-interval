package dev.serverteleport.fabric.core;

import java.nio.file.Path;

/** Dedicated config stays compatible; integrated worlds never share mutable config or places. */
public final class ServerStoragePaths {
    private ServerStoragePaths() { }

    public static Path configFile(Path loaderConfigDirectory, Path worldRoot, boolean dedicated) {
        Path directory = dedicated ? loaderConfigDirectory : worldRoot;
        return directory.resolve("server-teleport").resolve("config.properties");
    }

    public static Path locationsFile(Path worldRoot) {
        return worldRoot.resolve("server-teleport").resolve("locations.tsv");
    }
}
