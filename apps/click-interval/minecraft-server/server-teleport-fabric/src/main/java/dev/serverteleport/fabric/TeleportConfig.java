package dev.serverteleport.fabric;

import dev.serverteleport.fabric.core.MessageCatalog;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

public record TeleportConfig(
        long requestExpiryMillis,
        long requestCooldownMillis,
        int maxIncomingRequests,
        int maxTotalPending,
        boolean allowCrossDimension,
        int randomTeleportRadius,
        MessageCatalog messages
) {
    static final long MAX_CONFIG_BYTES = 128L * 1024L;
    private static final int DEFAULT_EXPIRY_SECONDS = 60;
    private static final int DEFAULT_COOLDOWN_SECONDS = 10;
    private static final int DEFAULT_MAX_INCOMING = 8;
    private static final int DEFAULT_MAX_TOTAL = 1_024;
    private static final String DEFAULT_RESOURCE = "/default-config.properties";

    public TeleportConfig {
        if (requestExpiryMillis < 5_000L || requestExpiryMillis > 300_000L) {
            throw new IllegalArgumentException("request expiry must be between 5 and 300 seconds");
        }
        if (requestCooldownMillis < 0L || requestCooldownMillis > 300_000L) {
            throw new IllegalArgumentException("request cooldown must be between 0 and 300 seconds");
        }
        if (maxIncomingRequests < 1 || maxIncomingRequests > 32) {
            throw new IllegalArgumentException("maximum incoming requests must be between 1 and 32");
        }
        if (maxTotalPending < 1 || maxTotalPending > 4_096) {
            throw new IllegalArgumentException("maximum total pending requests must be between 1 and 4096");
        }
        if (randomTeleportRadius < 16 || randomTeleportRadius > 100_000) {
            throw new IllegalArgumentException("random teleport radius must be between 16 and 100000 blocks");
        }
        if (messages == null) messages = MessageCatalog.defaults();
    }

    public static TeleportConfig defaults() {
        return new TeleportConfig(
                DEFAULT_EXPIRY_SECONDS * 1_000L,
                DEFAULT_COOLDOWN_SECONDS * 1_000L,
                DEFAULT_MAX_INCOMING,
                DEFAULT_MAX_TOTAL,
                true,
                10_000,
                MessageCatalog.defaults());
    }

    public static TeleportConfig load(Path file) throws IOException {
        if (file == null) throw new IOException("config path is required");
        if (Files.notExists(file)) writeDefault(file);
        if (!Files.isRegularFile(file)) throw new IOException("config path is not a regular file");
        long size = Files.size(file);
        if (size > MAX_CONFIG_BYTES) throw new IOException("config exceeds 128 KiB");

        Properties properties = new Properties();
        try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        try {
            return parse(properties);
        } catch (IllegalArgumentException error) {
            throw new IOException("invalid config: " + error.getMessage(), error);
        }
    }

    static TeleportConfig parse(Properties properties) {
        Properties source = properties == null ? new Properties() : properties;
        int expiry = boundedInt(source, "request-expiry-seconds", DEFAULT_EXPIRY_SECONDS, 5, 300);
        int cooldown = boundedInt(source, "request-cooldown-seconds", DEFAULT_COOLDOWN_SECONDS, 0, 300);
        int incoming = boundedInt(source, "max-incoming-per-player", DEFAULT_MAX_INCOMING, 1, 32);
        int total = boundedInt(source, "max-total-pending", DEFAULT_MAX_TOTAL, 1, 4_096);
        boolean crossDimension = strictBoolean(source, "allow-cross-dimension", true);
        int randomRadius = boundedInt(source, "random-teleport-radius", 10_000, 16, 100_000);

        LinkedHashMap<String, String> messages = new LinkedHashMap<>();
        for (String key : MessageCatalog.defaultTemplates().keySet()) {
            String property = "message." + key;
            if (source.containsKey(property)) messages.put(key, source.getProperty(property, ""));
        }
        return new TeleportConfig(
                expiry * 1_000L,
                cooldown * 1_000L,
                incoming,
                total,
                crossDimension,
                randomRadius,
                new MessageCatalog(messages));
    }

    public long requestExpirySeconds() {
        return requestExpiryMillis / 1_000L;
    }

    private static int boundedInt(Properties source, String key, int fallback, int minimum, int maximum) {
        String raw = source.getProperty(key);
        if (raw == null || raw.isBlank()) return fallback;
        final int value;
        try {
            value = Integer.parseInt(raw.strip());
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(key + " must be a whole number");
        }
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException(key + " must be between " + minimum + " and " + maximum);
        }
        return value;
    }

    private static boolean strictBoolean(Properties source, String key, boolean fallback) {
        String raw = source.getProperty(key);
        if (raw == null || raw.isBlank()) return fallback;
        return switch (raw.strip().toLowerCase(Locale.ROOT)) {
            case "true" -> true;
            case "false" -> false;
            default -> throw new IllegalArgumentException(key + " must be true or false");
        };
    }

    private static void writeDefault(Path file) throws IOException {
        byte[] data;
        try (InputStream input = TeleportConfig.class.getResourceAsStream(DEFAULT_RESOURCE)) {
            if (input == null) throw new IOException("bundled default config is missing");
            data = input.readNBytes((int) MAX_CONFIG_BYTES + 1);
        }
        if (data.length > MAX_CONFIG_BYTES) throw new IOException("bundled default config exceeds 128 KiB");

        Path parent = file.toAbsolutePath().normalize().getParent();
        if (parent == null) throw new IOException("config directory is unavailable");
        Files.createDirectories(parent);
        Path temporary = parent.resolve(file.getFileName() + ".tmp");
        Files.write(temporary, data,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE);
        try {
            Files.move(temporary, file,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
