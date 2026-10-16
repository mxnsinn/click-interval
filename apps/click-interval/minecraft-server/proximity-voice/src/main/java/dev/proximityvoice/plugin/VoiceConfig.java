package dev.proximityvoice.plugin;

import org.bukkit.configuration.file.FileConfiguration;

public record VoiceConfig(
        boolean enabled,
        String bindAddress,
        String publicHost,
        int port,
        double voiceRadius,
        long sessionTimeoutMillis
) {
    public static VoiceConfig from(FileConfiguration config) {
        boolean enabled = config.getBoolean("enabled", true);
        String bindAddress = cleanHost(config.getString("bindAddress", ""));
        String publicHost = cleanHost(config.getString("publicHost", ""));
        int port = clamp(config.getInt("port", 24454), 1, 65535);
        double radius = clamp(config.getDouble("voiceDistance", 48.0), 1.0, 512.0);
        long timeout = clamp(config.getLong("sessionTimeoutSeconds", 45L), 15L, 300L) * 1000L;
        return new VoiceConfig(enabled, bindAddress, publicHost, port, radius, timeout);
    }

    private static String cleanHost(String value) {
        String host = String.valueOf(value == null ? "" : value).trim();
        if (host.equals("*")) return "";
        if (host.length() > 253 || host.chars().anyMatch(character -> character < 0x21 || character > 0x7e)) {
            throw new IllegalArgumentException("Voice host values must contain only printable ASCII and be at most 253 characters.");
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
        if (!Double.isFinite(value)) return 48.0;
        return Math.max(minimum, Math.min(maximum, value));
    }
}
