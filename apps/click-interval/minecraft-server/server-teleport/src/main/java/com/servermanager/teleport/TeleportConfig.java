package com.servermanager.teleport;

import com.servermanager.teleport.core.MessageCatalog;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;

import java.util.LinkedHashMap;
import java.util.Map;

public record TeleportConfig(
        long requestExpiryMillis,
        long requestCooldownMillis,
        int maxIncomingRequests,
        boolean allowCrossWorld,
        MessageCatalog messages
) {
    private static final int DEFAULT_EXPIRY_SECONDS = 60;
    private static final int DEFAULT_COOLDOWN_SECONDS = 10;
    private static final int DEFAULT_MAX_INCOMING = 8;

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
        if (messages == null) messages = MessageCatalog.defaults();
    }

    public static TeleportConfig from(FileConfiguration source) {
        int expirySeconds = boundedInt(source, "requests.expiry-seconds", DEFAULT_EXPIRY_SECONDS, 5, 300);
        int cooldownSeconds = boundedInt(source, "requests.cooldown-seconds", DEFAULT_COOLDOWN_SECONDS, 0, 300);
        int maximumIncoming = boundedInt(source, "requests.max-incoming-per-player", DEFAULT_MAX_INCOMING, 1, 32);
        boolean allowCrossWorld = source == null || source.getBoolean("requests.allow-cross-world", true);
        return new TeleportConfig(
                expirySeconds * 1_000L,
                cooldownSeconds * 1_000L,
                maximumIncoming,
                allowCrossWorld,
                new MessageCatalog(readMessageOverrides(source))
        );
    }

    public long requestExpirySeconds() {
        return requestExpiryMillis / 1_000L;
    }

    private static int boundedInt(FileConfiguration source, String path, int fallback, int minimum, int maximum) {
        int value = source != null && source.isInt(path) ? source.getInt(path) : fallback;
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static Map<String, String> readMessageOverrides(FileConfiguration source) {
        if (source == null) return Map.of();
        ConfigurationSection section = source.getConfigurationSection("messages");
        if (section == null) return Map.of();
        LinkedHashMap<String, String> result = new LinkedHashMap<>();
        for (String key : MessageCatalog.defaultTemplates().keySet()) {
            if (!section.contains(key)) continue;
            Object value = section.get(key);
            if (value instanceof String text) result.put(key, text);
        }
        return Map.copyOf(result);
    }
}
