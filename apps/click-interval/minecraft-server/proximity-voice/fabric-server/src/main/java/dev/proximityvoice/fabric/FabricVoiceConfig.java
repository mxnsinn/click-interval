package dev.proximityvoice.fabric;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Properties;
import java.util.UUID;

public record FabricVoiceConfig(
        boolean enabled,
        String bindAddress,
        String publicHost,
        int port,
        double voiceRadius,
        long sessionTimeoutMillis
) {
    public static FabricVoiceConfig defaults() {
        return new FabricVoiceConfig(true, "", "", 24_454, 48.0, 45_000L);
    }

    public static FabricVoiceConfig load(Path file) throws IOException {
        FabricVoiceConfig fallback = defaults();
        if (!Files.isRegularFile(file)) {
            save(file, fallback);
            return fallback;
        }
        if (Files.size(file) > 64 * 1024) throw new IOException("config.properties is too large");
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(file)) {
            properties.load(input);
        }
        return new FabricVoiceConfig(
                parseBoolean(properties.getProperty("enabled"), fallback.enabled()),
                cleanHost(properties.getProperty("bindAddress", fallback.bindAddress())),
                cleanHost(properties.getProperty("publicHost", fallback.publicHost())),
                clamp(parseInt(properties.getProperty("port"), fallback.port()), 1, 65_535),
                clamp(parseDouble(properties.getProperty("voiceDistance"), fallback.voiceRadius()), 1.0, 512.0),
                clamp(parseLong(properties.getProperty("sessionTimeoutSeconds"),
                        fallback.sessionTimeoutMillis() / 1_000L), 15L, 300L) * 1_000L);
    }

    private static void save(Path file, FabricVoiceConfig config) throws IOException {
        Files.createDirectories(file.toAbsolutePath().normalize().getParent());
        Properties properties = new Properties();
        properties.setProperty("enabled", Boolean.toString(config.enabled()));
        properties.setProperty("bindAddress", config.bindAddress());
        properties.setProperty("publicHost", config.publicHost());
        properties.setProperty("port", Integer.toString(config.port()));
        properties.setProperty("voiceDistance", Double.toString(config.voiceRadius()));
        properties.setProperty("sessionTimeoutSeconds", Long.toString(config.sessionTimeoutMillis() / 1_000L));
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            try (OutputStream output = Files.newOutputStream(temporary)) {
                properties.store(output, "Proximity Voice Fabric server settings");
            }
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static boolean parseBoolean(String value, boolean fallback) {
        if (value == null) return fallback;
        if (value.equalsIgnoreCase("true")) return true;
        if (value.equalsIgnoreCase("false")) return false;
        return fallback;
    }

    private static int parseInt(String value, int fallback) {
        try { return Integer.parseInt(String.valueOf(value).trim()); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static long parseLong(String value, long fallback) {
        try { return Long.parseLong(String.valueOf(value).trim()); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static double parseDouble(String value, double fallback) {
        try {
            double parsed = Double.parseDouble(String.valueOf(value).trim());
            return Double.isFinite(parsed) ? parsed : fallback;
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static String cleanHost(String value) {
        String host = String.valueOf(value == null ? "" : value).trim();
        if (host.equals("*")) return "";
        if (host.length() > 253 || host.chars().anyMatch(character -> character < 0x21 || character > 0x7e)) {
            throw new IllegalArgumentException("Voice host values must be printable ASCII and at most 253 characters");
        }
        return host;
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static long clamp(long value, long minimum, long maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
