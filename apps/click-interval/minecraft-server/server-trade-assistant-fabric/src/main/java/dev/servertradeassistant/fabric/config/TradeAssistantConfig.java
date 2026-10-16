package dev.servertradeassistant.fabric.config;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Properties;

/** Small, bounded server-owned configuration. */
public record TradeAssistantConfig(
        long cooldownMillis,
        int maxRerollsPerVillager,
        double maximumDistanceBlocks,
        boolean requireRolePermission,
        int defaultTradeDiscountPercent,
        String accessPolicyPath,
        boolean appControlEnabled
) {
    public static final long DEFAULT_COOLDOWN_MILLIS = 750L;
    public static final int DEFAULT_MAX_REROLLS = 64;
    public static final double DEFAULT_MAXIMUM_DISTANCE = 8.0D;
    public static final String DEFAULT_ACCESS_POLICY = "server-protection/access.yml";

    public TradeAssistantConfig {
        cooldownMillis = clamp(cooldownMillis, 100L, 30_000L);
        maxRerollsPerVillager = clamp(maxRerollsPerVillager, 0, 1_000);
        maximumDistanceBlocks = clamp(maximumDistanceBlocks, 2.0D, 16.0D);
        defaultTradeDiscountPercent = clamp(defaultTradeDiscountPercent, 0, 55);
        accessPolicyPath = safeRelativePath(accessPolicyPath);
    }

    public static TradeAssistantConfig defaults() {
        return new TradeAssistantConfig(DEFAULT_COOLDOWN_MILLIS, DEFAULT_MAX_REROLLS,
                DEFAULT_MAXIMUM_DISTANCE, false, 0, DEFAULT_ACCESS_POLICY, true);
    }

    public static TradeAssistantConfig load(Path file) throws IOException {
        TradeAssistantConfig defaults = defaults();
        Properties properties = new Properties();
        if (Files.isRegularFile(file)) {
            if (Files.size(file) > 64L * 1024L) throw new IOException("trade-assistant.properties exceeds 64 KiB");
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                properties.load(reader);
            }
        } else {
            Files.createDirectories(file.getParent());
            properties.setProperty("cooldown-millis", String.valueOf(defaults.cooldownMillis()));
            properties.setProperty("max-rerolls-per-villager", String.valueOf(defaults.maxRerollsPerVillager()));
            properties.setProperty("maximum-distance-blocks", String.valueOf(defaults.maximumDistanceBlocks()));
            properties.setProperty("require-role-permission", String.valueOf(defaults.requireRolePermission()));
            properties.setProperty("default-trade-discount-percent", String.valueOf(defaults.defaultTradeDiscountPercent()));
            properties.setProperty("access-policy-path", defaults.accessPolicyPath());
            properties.setProperty("app-control-enabled", String.valueOf(defaults.appControlEnabled()));
            try (Writer writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                properties.store(writer, "Server Trade Assistant 26.2");
            }
        }
        return new TradeAssistantConfig(
                parseLong(properties, "cooldown-millis", defaults.cooldownMillis()),
                parseInt(properties, "max-rerolls-per-villager", defaults.maxRerollsPerVillager()),
                parseDouble(properties, "maximum-distance-blocks", defaults.maximumDistanceBlocks()),
                parseBoolean(properties, "require-role-permission", defaults.requireRolePermission()),
                parseInt(properties, "default-trade-discount-percent", defaults.defaultTradeDiscountPercent()),
                properties.getProperty("access-policy-path", defaults.accessPolicyPath()),
                parseBoolean(properties, "app-control-enabled", defaults.appControlEnabled()));
    }

    private static long parseLong(Properties properties, String key, long fallback) {
        try { return Long.parseLong(properties.getProperty(key, String.valueOf(fallback)).trim()); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static int parseInt(Properties properties, String key, int fallback) {
        try { return Integer.parseInt(properties.getProperty(key, String.valueOf(fallback)).trim()); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static double parseDouble(Properties properties, String key, double fallback) {
        try { return Double.parseDouble(properties.getProperty(key, String.valueOf(fallback)).trim()); }
        catch (RuntimeException ignored) { return fallback; }
    }

    private static boolean parseBoolean(Properties properties, String key, boolean fallback) {
        String value = properties.getProperty(key);
        if (value == null) return fallback;
        return switch (value.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "true", "yes", "1", "on" -> true;
            case "false", "no", "0", "off" -> false;
            default -> fallback;
        };
    }

    private static String safeRelativePath(String value) {
        String clean = String.valueOf(value == null ? "" : value).trim().replace('\\', '/');
        if (clean.isEmpty() || clean.startsWith("/") || clean.contains(":") || clean.contains("..")) {
            return DEFAULT_ACCESS_POLICY;
        }
        return clean;
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static long clamp(long value, long minimum, long maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static double clamp(double value, double minimum, double maximum) {
        if (!Double.isFinite(value)) return minimum;
        return Math.max(minimum, Math.min(maximum, value));
    }
}
