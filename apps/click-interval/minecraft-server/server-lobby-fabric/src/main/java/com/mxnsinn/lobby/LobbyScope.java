package com.mxnsinn.lobby;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Optional;
import java.util.Locale;

/** Opt in by exact marker contents, never by a coincidentally matching display name. */
public final class LobbyScope {
    public static final String MARKER = ".mxnsinn-lobby-preview";
    public static final String CONTENTS = "MXNSINN Lobby Preview v1";
    public static final String CANDIDATE_MARKER = ".clickinterval-lobby-candidate";
    public static final String SETTINGS = ".mxnsinn-lobby-settings.json";
    public static final String HOLDING_MARKER = ".clickinterval-holding-lobby";
    public record Profile(LobbySettings settings, boolean holding) {}
    private LobbyScope() {}
    public static boolean marked(Path world) {
        return settings(world).isPresent();
    }
    public static Optional<LobbySettings> settings(Path world) {
        return profile(world, false).map(Profile::settings);
    }
    public static boolean holdingPath(Path world) {
        Path normalized = world.toAbsolutePath().normalize(), parent = normalized.getParent();
        return normalized.getFileName().toString().equals("HoldingLobby") && parent != null
                && parent.getFileName().toString().equals("holding-fabric") && parent.getParent() != null
                && parent.getParent().getFileName().toString().equals(".click-interval-seamless-restart");
    }
    public static Optional<Profile> profile(Path world, boolean dedicated) {
        String name = world.toAbsolutePath().normalize().getFileName().toString();
        // Explicit additional protection for the user's actual game saves.
        if (name.toLowerCase(Locale.ROOT).equals("smp") || name.equalsIgnoreCase("TreeChopTest")) return Optional.empty();
        if (name.equalsIgnoreCase("HoldingLobby")) {
            if (!dedicated || !holdingPath(world)) return Optional.empty();
            Optional<LobbySettings> settings = configuredSettings(world, name, HOLDING_MARKER, "Click Interval holding lobby v1");
            if (settings.isEmpty()) throw new IllegalStateException("HOLDING_LOBBY_UNSAFE: reserved holding world has invalid marker or settings; refusing startup");
            return Optional.of(new Profile(settings.get(), true));
        }
        if (name.startsWith("LobbyCandidate-")) return candidateSettings(world, name).map(settings -> new Profile(settings, false));
        Path marker = world.resolve(MARKER);
        try {
            return Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)
                    && Files.size(marker) < 128 && CONTENTS.equals(Files.readString(marker).strip())
                    ? Optional.of(new Profile(LobbySettings.LEGACY, false)) : Optional.empty();
        } catch (IOException | SecurityException ignored) { return Optional.empty(); }
    }
    private static Optional<LobbySettings> candidateSettings(Path world, String name) {
        if (!name.matches("LobbyCandidate-0[1-3]") || Files.isSymbolicLink(world)) return Optional.empty();
        return configuredSettings(world, name, CANDIDATE_MARKER, "Click Interval lobby candidate v1");
    }
    private static Optional<LobbySettings> configuredSettings(Path world, String name, String markerName, String prefix) {
        if (Files.isSymbolicLink(world)) return Optional.empty();
        Path marker = world.resolve(markerName), config = world.resolve(SETTINGS);
        try {
            if (!Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS) || Files.size(marker) > 256
                    || !Files.isRegularFile(config, LinkOption.NOFOLLOW_LINKS) || Files.size(config) > 8192
                    || !Files.readString(marker).replace("\r\n", "\n")
                    .equals(prefix + "\nworld=" + name + "\n")) return Optional.empty();
            return Optional.of(LobbySettings.parse(Files.readString(config), name));
        } catch (IOException | RuntimeException ignored) { return Optional.empty(); }
    }
}
