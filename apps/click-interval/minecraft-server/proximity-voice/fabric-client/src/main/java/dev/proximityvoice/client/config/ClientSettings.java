package dev.proximityvoice.client.config;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;

public final class ClientSettings {
    private final Path file;
    private String inputDevice = "";
    private String outputDevice = "";
    private double masterVolume = 1.0;
    private MicrophoneMode microphoneMode = MicrophoneMode.HOLD_TO_SPEAK;
    private boolean toggleMuted;
    private final Map<UUID, PlayerAudio> playerAudio = new LinkedHashMap<>();

    public ClientSettings(Path file) {
        this.file = file.toAbsolutePath().normalize();
    }

    public synchronized void load() throws IOException {
        Properties properties = new Properties();
        if (Files.isRegularFile(file)) {
            try (InputStream input = Files.newInputStream(file)) {
                properties.load(input);
            }
        }
        inputDevice = cleanDevice(properties.getProperty("audio.input", ""));
        outputDevice = cleanDevice(properties.getProperty("audio.output", ""));
        masterVolume = parseVolume(properties.getProperty("audio.masterVolume"), 1.0);
        microphoneMode = parseMode(properties.getProperty("microphone.mode"));
        toggleMuted = Boolean.parseBoolean(properties.getProperty("microphone.muted", "false"));
        playerAudio.clear();
        for (String key : properties.stringPropertyNames()) {
            if (!key.startsWith("player.") || !key.endsWith(".volume")) continue;
            String idText = key.substring("player.".length(), key.length() - ".volume".length());
            try {
                UUID id = UUID.fromString(idText);
                double volume = parseVolume(properties.getProperty(key), 1.0);
                boolean muted = Boolean.parseBoolean(properties.getProperty("player." + id + ".muted", "false"));
                playerAudio.put(id, new PlayerAudio(volume, muted));
            } catch (IllegalArgumentException ignored) {
                // Ignore malformed local settings rather than making voice unavailable.
            }
        }
    }

    public synchronized void save() throws IOException {
        Files.createDirectories(file.getParent());
        Properties properties = new Properties();
        properties.setProperty("audio.input", inputDevice);
        properties.setProperty("audio.output", outputDevice);
        properties.setProperty("audio.masterVolume", Double.toString(masterVolume));
        properties.setProperty("microphone.mode", microphoneMode.name());
        properties.setProperty("microphone.muted", Boolean.toString(toggleMuted));
        playerAudio.forEach((id, audio) -> {
            properties.setProperty("player." + id + ".volume", Double.toString(audio.volume()));
            properties.setProperty("player." + id + ".muted", Boolean.toString(audio.muted()));
        });
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        try (OutputStream output = Files.newOutputStream(temporary)) {
            properties.store(output, "Proximity Voice client settings - no audio is recorded");
        }
        try {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public synchronized String inputDevice() { return inputDevice; }
    public synchronized String outputDevice() { return outputDevice; }
    public synchronized double masterVolume() { return masterVolume; }
    public synchronized MicrophoneMode microphoneMode() { return microphoneMode; }
    public synchronized boolean toggleMuted() { return toggleMuted; }

    public synchronized void setInputDevice(String value) { inputDevice = cleanDevice(value); }
    public synchronized void setOutputDevice(String value) { outputDevice = cleanDevice(value); }
    public synchronized void setMasterVolume(double value) { masterVolume = clampVolume(value); }
    public synchronized void setMicrophoneMode(MicrophoneMode value) {
        microphoneMode = value == null ? MicrophoneMode.HOLD_TO_SPEAK : value;
    }
    public synchronized void setToggleMuted(boolean value) { toggleMuted = value; }

    public synchronized PlayerAudio playerAudio(UUID playerId) {
        return playerAudio.getOrDefault(playerId, PlayerAudio.DEFAULT);
    }

    public synchronized void setPlayerVolume(UUID playerId, double volume) {
        PlayerAudio current = playerAudio(playerId);
        playerAudio.put(playerId, new PlayerAudio(clampVolume(volume), current.muted()));
    }

    public synchronized void setPlayerMuted(UUID playerId, boolean muted) {
        PlayerAudio current = playerAudio(playerId);
        playerAudio.put(playerId, new PlayerAudio(current.volume(), muted));
    }

    private static String cleanDevice(String value) {
        String cleaned = String.valueOf(value == null ? "" : value).replaceAll("[\\p{Cntrl}]", " ").trim();
        return cleaned.length() <= 180 ? cleaned : cleaned.substring(0, 180);
    }

    private static double parseVolume(String value, double fallback) {
        try {
            return clampVolume(Double.parseDouble(value));
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static double clampVolume(double value) {
        if (!Double.isFinite(value)) return 1.0;
        return Math.max(0.0, Math.min(2.0, value));
    }

    private static MicrophoneMode parseMode(String value) {
        try {
            return MicrophoneMode.valueOf(String.valueOf(value));
        } catch (IllegalArgumentException ignored) {
            return MicrophoneMode.HOLD_TO_SPEAK;
        }
    }

    public enum MicrophoneMode {
        HOLD_TO_SPEAK,
        TOGGLE
    }

    public record PlayerAudio(double volume, boolean muted) {
        public static final PlayerAudio DEFAULT = new PlayerAudio(1.0, false);
    }
}
