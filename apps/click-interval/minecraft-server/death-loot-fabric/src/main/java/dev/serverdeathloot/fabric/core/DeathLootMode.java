package dev.serverdeathloot.fabric.core;

import java.util.Locale;
import java.util.Optional;

public enum DeathLootMode {
    VANILLA("vanilla"),
    TIMED("timed"),
    CHEST("chest");

    private final String configValue;

    DeathLootMode(String configValue) {
        this.configValue = configValue;
    }

    public String configValue() {
        return configValue;
    }

    public static Optional<DeathLootMode> parse(String value) {
        if (value == null) return Optional.empty();
        String normalized = value.strip().toLowerCase(Locale.ROOT)
                .replace('_', '-')
                .replace(' ', '-');
        return switch (normalized) {
            case "vanilla", "off", "disabled" -> Optional.of(VANILLA);
            case "timed", "timed-drops", "drops" -> Optional.of(TIMED);
            case "chest", "death-chest", "grave" -> Optional.of(CHEST);
            default -> Optional.empty();
        };
    }
}
