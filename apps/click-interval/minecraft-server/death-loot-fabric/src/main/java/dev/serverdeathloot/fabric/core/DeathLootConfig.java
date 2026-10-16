package dev.serverdeathloot.fabric.core;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.UUID;

public record DeathLootConfig(
        DeathLootMode mode,
        int deathDropLifetimeSeconds,
        int deathChestLifetimeSeconds,
        boolean placeTorches
) {
    public static final int MIN_DROP_LIFETIME_SECONDS = 1;
    public static final int MAX_DROP_LIFETIME_SECONDS = 86_400;
    public static final int MIN_CHEST_LIFETIME_SECONDS = 1;
    public static final int MAX_CHEST_LIFETIME_SECONDS = 604_800;
    public static final long MAX_CONFIG_BYTES = 65_536L;

    public DeathLootConfig {
        if (mode == null) throw new IllegalArgumentException("mode is required");
        if (deathDropLifetimeSeconds < MIN_DROP_LIFETIME_SECONDS
                || deathDropLifetimeSeconds > MAX_DROP_LIFETIME_SECONDS) {
            throw new IllegalArgumentException("death drop lifetime is outside the accepted range");
        }
        if (deathChestLifetimeSeconds != 0
                && (deathChestLifetimeSeconds < MIN_CHEST_LIFETIME_SECONDS
                || deathChestLifetimeSeconds > MAX_CHEST_LIFETIME_SECONDS)) {
            throw new IllegalArgumentException("death chest lifetime is outside the accepted range");
        }
    }

    public static DeathLootConfig defaults() {
        return new DeathLootConfig(DeathLootMode.CHEST, 300, 900, true);
    }

    public static LoadResult load(Path path) throws IOException {
        DeathLootConfig defaults = defaults();
        if (!Files.exists(path)) {
            writeAtomically(path, defaults);
            return new LoadResult(defaults, List.of(), true);
        }
        if (!Files.isRegularFile(path)) {
            throw new IOException("Config path is not a regular file: " + path);
        }
        if (Files.size(path) > MAX_CONFIG_BYTES) {
            throw new IOException("Config exceeds " + MAX_CONFIG_BYTES + " bytes: " + path);
        }

        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }

        List<String> warnings = new ArrayList<>();
        DeathLootMode mode = DeathLootMode.parse(properties.getProperty("mode"))
                .orElseGet(() -> {
                    warnings.add("mode was invalid; using " + defaults.mode.configValue());
                    return defaults.mode;
                });
        int dropLifetime = boundedInteger(
                properties.getProperty("death-drop-lifetime-seconds"),
                defaults.deathDropLifetimeSeconds,
                MIN_DROP_LIFETIME_SECONDS,
                MAX_DROP_LIFETIME_SECONDS,
                false,
                "death-drop-lifetime-seconds",
                warnings);
        int chestLifetime = boundedInteger(
                properties.getProperty("death-chest-lifetime-seconds"),
                defaults.deathChestLifetimeSeconds,
                MIN_CHEST_LIFETIME_SECONDS,
                MAX_CHEST_LIFETIME_SECONDS,
                true,
                "death-chest-lifetime-seconds",
                warnings);
        boolean torches = strictBoolean(
                properties.getProperty("place-torches"),
                defaults.placeTorches,
                "place-torches",
                warnings);

        return new LoadResult(
                new DeathLootConfig(mode, dropLifetime, chestLifetime, torches),
                List.copyOf(warnings),
                false);
    }

    public static void writeAtomically(Path path, DeathLootConfig config) throws IOException {
        Path parent = path.toAbsolutePath().normalize().getParent();
        if (parent == null) throw new IOException("Config path has no parent: " + path);
        Files.createDirectories(parent);
        Path temporary = parent.resolve(path.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.writeString(
                    temporary,
                    config.toCanonicalText(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW,
                    StandardOpenOption.WRITE);
            try {
                Files.move(temporary, path,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    public String toCanonicalText() {
        return "# Server Death Loot for Fabric 26.2\n"
                + "# Modes: vanilla, timed, chest.\n"
                + "mode=" + mode.configValue() + "\n"
                + "# Only item entities created by a player's death use this lifetime.\n"
                + "death-drop-lifetime-seconds=" + deathDropLifetimeSeconds + "\n"
                + "# 0 means death chests never expire. Maximum: 604800 seconds.\n"
                + "death-chest-lifetime-seconds=" + deathChestLifetimeSeconds + "\n"
                + "# Torches are placed only into free air and never replace blocks.\n"
                + "place-torches=" + placeTorches + "\n";
    }

    private static int boundedInteger(
            String raw,
            int fallback,
            int minimum,
            int maximum,
            boolean allowZero,
            String key,
            List<String> warnings
    ) {
        if (raw == null || raw.isBlank()) {
            warnings.add(key + " was missing; using " + fallback);
            return fallback;
        }
        final long parsed;
        try {
            parsed = Long.parseLong(raw.strip());
        } catch (NumberFormatException error) {
            warnings.add(key + " was not a whole number; using " + fallback);
            return fallback;
        }
        if (allowZero && parsed == 0L) return 0;
        if (parsed < minimum) {
            warnings.add(key + " was below " + minimum + "; clamped to " + minimum);
            return minimum;
        }
        if (parsed > maximum) {
            warnings.add(key + " was above " + maximum + "; clamped to " + maximum);
            return maximum;
        }
        return (int) parsed;
    }

    private static boolean strictBoolean(
            String raw,
            boolean fallback,
            String key,
            List<String> warnings
    ) {
        if (raw == null) {
            warnings.add(key + " was missing; using " + fallback);
            return fallback;
        }
        return switch (raw.strip().toLowerCase(Locale.ROOT)) {
            case "true" -> true;
            case "false" -> false;
            default -> {
                warnings.add(key + " must be true or false; using " + fallback);
                yield fallback;
            }
        };
    }

    public record LoadResult(DeathLootConfig config, List<String> warnings, boolean created) {
        public LoadResult {
            if (config == null || warnings == null) throw new IllegalArgumentException("load result is incomplete");
            warnings = List.copyOf(warnings);
        }
    }
}
