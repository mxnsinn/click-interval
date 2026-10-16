package dev.serverenchantments.fabric.core;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public record HarvestConfig(int maxTreeLogs, int breaksPerTick, int scansPerTick, int maxJobs) {
    public static HarvestConfig defaults() { return new HarvestConfig(128, 32, 1024, 8); }
    public static HarvestConfig load(Path path) throws IOException {
        if (!Files.isRegularFile(path)) return defaults();
        Properties values = new Properties();
        try (Reader reader = Files.newBufferedReader(path)) { values.load(reader); }
        return new HarvestConfig(number(values, "max-tree-logs", 128, 1, 128),
                number(values, "breaks-per-tick", 32, 1, 64),
                number(values, "scans-per-tick", 1024, 16, 4096),
                number(values, "max-jobs", 8, 1, 16));
    }
    private static int number(Properties values, String key, int fallback, int min, int max) {
        try { return Math.max(min, Math.min(max, Integer.parseInt(values.getProperty(key, "")))); }
        catch (NumberFormatException ignored) { return fallback; }
    }
}
