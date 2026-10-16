package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.ReachCheckMath;
import com.clickinterval.anticheat.core.ProtectionMessages;
import com.clickinterval.anticheat.core.ViolationPolicy;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Small, dependency-free reader for the bounded scalar subset used by config.yml. */
public record ProtectionConfig(
        boolean enabled,
        boolean responseEnabled,
        boolean warnBeforeThreshold,
        long warningCooldownMillis,
        double minimumTps,
        Checks checks,
        Movement movement,
        Combat combat,
        WorldLimits world,
        AbuseLimits abuse,
        Grace grace,
        ReachCheckMath.Parameters reachParameters,
        ViolationPolicy violationPolicy,
        HiddenOreDetection hiddenOreDetection,
        EntityEsp entityEsp,
        Exemptions exemptions,
        CheckExemptions checkExemptions,
        ProtectionMessages messages
) {
    static final long MAX_CONFIG_BYTES = 256L * 1024L;
    static final int MAX_CONFIG_LINES = 4_096;
    static final int MAX_LINE_LENGTH = 2_048;

    public static ProtectionConfig load(Path file) throws IOException {
        if (!Files.exists(file)) writeDefault(file);
        if (!Files.isRegularFile(file) || Files.size(file) > MAX_CONFIG_BYTES) {
            throw new IOException("Server Protection config must be a regular file no larger than 256 KiB");
        }
        return parse(Files.readString(file, StandardCharsets.UTF_8));
    }

    public static ProtectionConfig parse(String yaml) throws IOException {
        if (yaml == null) yaml = "";
        if (yaml.getBytes(StandardCharsets.UTF_8).length > MAX_CONFIG_BYTES) {
            throw new IOException("Server Protection config exceeds 256 KiB");
        }
        Map<String, String> values = scalarValues(yaml);
        ViolationPolicy balanced = ViolationPolicy.balanced();
        ViolationPolicy policy;
        try {
            policy = new ViolationPolicy(
                    decimal(values, "response.alertVl", balanced.alertVl(), 1.0, 100.0),
                    decimal(values, "response.kickVl", balanced.kickVl(), 2.0, 250.0),
                    integer(values, "response.kickOffenses", balanced.kickOffenses(), 1, 100),
                    integer(values, "response.tempBanOffenses", balanced.tempBanOffenses(), 2, 200),
                    integer(values, "response.tempBanMinutes", balanced.tempBanMinutes(), 1, 43_200),
                    integer(values, "response.permanentBanOffenses", balanced.permanentBanOffenses(), 3, 1_000),
                    integer(values, "response.offenseDecayHours", balanced.offenseDecayHours(), 1, 8_760),
                    decimal(values, "violation-decay", balanced.decayPerSecond(), 0.0, 10.0),
                    integer(values, "response.actionCooldownSeconds", 8, 1, 3_600) * 1_000L);
        } catch (IllegalArgumentException invalid) {
            policy = balanced;
        }

        ReachCheckMath.Parameters reach = new ReachCheckMath.Parameters(
                decimal(values, "reach.geometryAllowance", 0.05, 0.025, 0.25),
                decimal(values, "reach.maxPingAllowance", 0.25, 0.15, 0.50),
                decimal(values, "reach.pingAllowancePerMs", 0.0008, 0.0005, 0.002),
                decimal(values, "reach.maxTickAllowance", 0.10, 0.05, 0.25),
                decimal(values, "reach.tickAllowancePerMissingTps", 0.05, 0.025, 0.10),
                decimal(values, "reach.maxTargetRewind", 0.45, 0.25, 0.75),
                decimal(values, "reach.baseRewindTicks", 0.50, 0.25, 1.50),
                decimal(values, "reach.pingRewindTicksPerMs", 0.010, 0.005, 0.020),
                decimal(values, "reach.maxRewindTicks", 3.00, 1.50, 5.00),
                decimal(values, "reach.immediateExcess", 0.75, 0.50, 2.00),
                integer(values, "reach.consecutiveSamples", 2, 2, 6),
                integer(values, "reach.evidenceWindowMillis", 1_250, 750, 5_000));

        AbuseLimits abuse = abuseLimits(values);
        return new ProtectionConfig(
                bool(values, "enabled", true),
                bool(values, "response.enabled", true),
                values.getOrDefault("response.preThresholdAction", "warn").equalsIgnoreCase("warn"),
                integer(values, "messages.warningCooldownSeconds", 10, 1, 300) * 1_000L,
                decimal(values, "minimum-tps", 18.0, 10.0, 20.0),
                new Checks(
                        bool(values, "checks.movement.speed", true),
                        bool(values, "checks.movement.flight", true),
                        bool(values, "checks.movement.phase", false),
                        bool(values, "checks.movement.invalidPosition", true),
                        bool(values, "checks.movement.invalidRotation", true),
                        bool(values, "checks.movement.groundSpoof", true),
                        bool(values, "checks.movement.waterWalk", true),
                        bool(values, "checks.movement.step", true),
                        bool(values, "checks.movement.timer", true),
                        bool(values, "checks.movement.noSlow", false),
                        bool(values, "checks.combat.reach", true),
                        bool(values, "checks.combat.wallHit", true),
                        bool(values, "checks.combat.autoClicker", true),
                        bool(values, "checks.combat.multiTarget", true),
                        bool(values, "checks.combat.aimDirection", false),
                        bool(values, "checks.combat.killAura", false),
                        bool(values, "checks.combat.clickPattern", true),
                        bool(values, "checks.combat.criticals", false),
                        bool(values, "checks.world.fastBreak", true),
                        bool(values, "checks.world.fastPlace", true),
                        bool(values, "checks.world.breakReach", true),
                        bool(values, "checks.world.placeReach", true),
                        bool(values, "checks.world.scaffold", false),
                        bool(values, "checks.world.multiBreak", false),
                        bool(values, "checks.abuse.chatSpam", true),
                        bool(values, "checks.abuse.commandSpam", true),
                        bool(values, "checks.abuse.inventorySpam", true)),
                new Movement(
                        decimal(values, "limits.movement.maxGroundBlocksPerTick", 0.78, 0.25, 5.0),
                        decimal(values, "limits.movement.maxAirBlocksPerTick", 0.92, 0.25, 5.0),
                        integer(values, "limits.movement.maxAirTicks", 80, 20, 1_200),
                        integer(values, "limits.movement.phaseSamples", 4, 2, 10),
                        integer(values, "limits.movement.groundSpoofSamples", 5, 3, 12),
                        integer(values, "limits.movement.waterWalkSamples", 7, 3, 16),
                        integer(values, "limits.movement.stepSamples", 2, 2, 8),
                        decimal(values, "limits.movement.maxUseItemBlocksPerTick", 0.20, 0.08, 0.50),
                        integer(values, "limits.movement.noSlowSamples", 7, 3, 16),
                        integer(values, "limits.movement.maxPacketsPerSecond", 28, 21, 100),
                        integer(values, "limits.movement.timerEvidenceWindows", 3, 2, 6)),
                new Combat(
                        decimal(values, "limits.combat.maxReach", 3.45, 2.5, 8.0),
                        integer(values, "limits.combat.maxCps", 20, 5, 40),
                        integer(values, "limits.combat.multiTargetCount", 4, 2, 16),
                        integer(values, "limits.combat.multiTargetWindowMillis", 250, 100, 5_000),
                        integer(values, "limits.combat.wallHitSamples", 2, 1, 10),
                        decimal(values, "limits.combat.maxAimDeviationDegrees", 55.0, 20.0, 120.0),
                        integer(values, "limits.combat.aimEvidenceSamples", 4, 2, 12),
                        integer(values, "limits.combat.aimEvidenceWindowMillis", 1_500, 500, 5_000),
                        integer(values, "limits.combat.rapidSwitchMillis", 90, 40, 300),
                        decimal(values, "limits.combat.rapidSwitchAngleDegrees", 110.0, 45.0, 170.0),
                        integer(values, "limits.combat.rapidSwitchSamples", 3, 2, 8),
                        integer(values, "limits.combat.rapidSwitchEvidenceWindowMillis", 1_200, 300, 5_000),
                        integer(values, "limits.combat.clickPatternSamples", 16, 8, 24),
                        decimal(values, "limits.combat.clickPatternMaxDeviationMillis", 1.5, 0.0, 20.0),
                        integer(values, "limits.combat.criticalSamples", 3, 2, 8),
                        integer(values, "limits.combat.criticalWindowMillis", 2_500, 500, 10_000)),
                new WorldLimits(
                        integer(values, "limits.world.maxBreaksPerSecond", 18, 1, 100),
                        integer(values, "limits.world.maxPlacesPerSecond", 16, 1, 100),
                        decimal(values, "limits.world.blockReachAllowance", 0.75, 0.25, 3.0),
                        decimal(values, "limits.world.scaffoldAimDegrees", 80.0, 45.0, 140.0),
                        integer(values, "limits.world.scaffoldSamples", 4, 2, 10),
                        integer(values, "limits.world.scaffoldWindowMillis", 2_000, 500, 10_000),
                        integer(values, "limits.world.multiBreakSamples", 6, 3, 12),
                        integer(values, "limits.world.multiBreakWindowMillis", 300, 100, 2_000),
                        decimal(values, "limits.world.multiBreakMinSpan", 3.5, 1.5, 10.0)),
                abuse,
                new Grace(
                        decimal(values, "grace.joinSeconds", 5.0, 2.0, 60.0),
                        decimal(values, "grace.teleportSeconds", 4.0, 2.0, 30.0),
                        decimal(values, "grace.velocitySeconds", 2.0, 1.0, 15.0)),
                reach,
                policy,
                hiddenOreDetection(values),
                entityEsp(values),
                exemptions(values, yaml),
                checkExemptions(yaml),
                messages(values));
    }

    private static Map<String, String> scalarValues(String yaml) throws IOException {
        HashMap<String, String> values = new HashMap<>();
        ArrayDeque<Section> sections = new ArrayDeque<>();
        String[] lines = yaml.split("\\R", -1);
        if (lines.length > MAX_CONFIG_LINES) throw new IOException("Server Protection config has too many lines");
        for (String raw : lines) {
            if (raw.length() > MAX_LINE_LENGTH) throw new IOException("Server Protection config contains an oversized line");
            String noComment = stripComment(raw);
            if (noComment.isBlank()) continue;
            int indentation = indentation(noComment);
            String line = noComment.strip();
            int separator = line.indexOf(':');
            if (separator <= 0) continue;
            String key = line.substring(0, separator).trim();
            if (!key.matches("[A-Za-z][A-Za-z0-9_-]{0,63}")) continue;
            while (!sections.isEmpty() && sections.peekLast().indentation() >= indentation) sections.removeLast();
            String value = line.substring(separator + 1).trim();
            if (value.isEmpty()) {
                if (sections.size() < 12) sections.addLast(new Section(indentation, key));
                continue;
            }
            StringBuilder path = new StringBuilder();
            for (Section section : sections) path.append(section.name()).append('.');
            path.append(key);
            String fullPath = path.toString();
            values.put(fullPath, unquote(value, fullPath.endsWith(".text") ? 1_024 : 256));
            if (values.size() > 512) throw new IOException("Server Protection config has too many settings");
        }
        return values;
    }

    private static int indentation(String line) {
        int count = 0;
        while (count < line.length() && count < 64 && line.charAt(count) == ' ') count++;
        return count;
    }

    private static String stripComment(String line) {
        boolean single = false;
        boolean doubled = false;
        boolean escaped = false;
        for (int index = 0; index < line.length(); index++) {
            char c = line.charAt(index);
            if (doubled && c == '\\' && !escaped) {
                escaped = true;
                continue;
            }
            if (c == '\'' && !doubled) single = !single;
            else if (c == '"' && !single && !escaped) doubled = !doubled;
            else if (c == '#' && !single && !doubled) return line.substring(0, index);
            escaped = false;
        }
        return line;
    }

    private static String unquote(String value) {
        return unquote(value, 256);
    }

    private static String unquote(String value, int maximum) {
        String clean = value.trim();
        if (clean.length() >= 2 && clean.startsWith("\"") && clean.endsWith("\"")) {
            clean = clean.substring(1, clean.length() - 1);
            clean = decodeJsonEscapes(clean);
        } else if (clean.length() >= 2 && clean.startsWith("'") && clean.endsWith("'")) {
            clean = clean.substring(1, clean.length() - 1);
        }
        int bound = Math.max(1, Math.min(1_024, maximum));
        return clean.length() > bound ? clean.substring(0, bound) : clean;
    }

    /** The manager emits JSON-quoted YAML scalars, so decode that exact bounded escape subset. */
    private static String decodeJsonEscapes(String value) {
        StringBuilder output = new StringBuilder(Math.min(value.length(), 1_024));
        for (int index = 0; index < value.length() && output.length() < 1_024; index++) {
            char character = value.charAt(index);
            if (character != '\\') {
                output.append(character);
                continue;
            }
            if (++index >= value.length()) return "";
            char escaped = value.charAt(index);
            switch (escaped) {
                case '"', '\\', '/' -> output.append(escaped);
                case 'b' -> output.append('\b');
                case 'f' -> output.append('\f');
                case 'n' -> output.append('\n');
                case 'r' -> output.append('\r');
                case 't' -> output.append('\t');
                case 'u' -> {
                    if (index + 4 >= value.length()) return "";
                    int decoded = 0;
                    for (int digit = 1; digit <= 4; digit++) {
                        int hex = Character.digit(value.charAt(index + digit), 16);
                        if (hex < 0) return "";
                        decoded = (decoded << 4) | hex;
                    }
                    output.append((char) decoded);
                    index += 4;
                }
                default -> { return ""; }
            }
        }
        return output.toString();
    }

    private static boolean bool(Map<String, String> values, String key, boolean fallback) {
        String value = values.get(key);
        if (value == null) return fallback;
        if (value.equalsIgnoreCase("true")) return true;
        if (value.equalsIgnoreCase("false")) return false;
        return fallback;
    }

    private static int integer(Map<String, String> values, String key, int fallback, int minimum, int maximum) {
        try {
            return Math.max(minimum, Math.min(maximum, Integer.parseInt(values.get(key))));
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static double decimal(Map<String, String> values, String key, double fallback, double minimum, double maximum) {
        try {
            double parsed = Double.parseDouble(values.get(key));
            return Double.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static void writeDefault(Path file) throws IOException {
        Path parent = file.getParent();
        if (parent != null) Files.createDirectories(parent);
        Path temporary = file.resolveSibling(file.getFileName() + ".tmp");
        try (InputStream input = ProtectionConfig.class.getResourceAsStream("/default-config.yml")) {
            if (input == null) throw new IOException("Bundled default config is missing");
            Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING);
        }
        try {
            Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException unsupported) {
            Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public record Checks(boolean speed, boolean flight, boolean phase, boolean invalidPosition,
                         boolean invalidRotation, boolean groundSpoof, boolean waterWalk, boolean step,
                         boolean timer, boolean noSlow, boolean reach, boolean wallHit, boolean autoClicker,
                         boolean multiTarget, boolean aimDirection, boolean killAura, boolean clickPattern,
                         boolean criticals, boolean fastBreak, boolean fastPlace, boolean breakReach, boolean placeReach,
                         boolean scaffold, boolean multiBreak, boolean chatSpam,
                         boolean commandSpam, boolean inventorySpam) { }
    public record Movement(double maxGroundBlocksPerTick, double maxAirBlocksPerTick,
                           int maxAirTicks, int phaseSamples, int groundSpoofSamples,
                           int waterWalkSamples, int stepSamples, double maxUseItemBlocksPerTick,
                           int noSlowSamples, int maxPacketsPerSecond, int timerEvidenceWindows) { }
    public record Combat(double maxReach, int maxCps, int multiTargetCount,
                         int multiTargetWindowMillis, int wallHitSamples,
                         double maxAimDeviationDegrees, int aimEvidenceSamples,
                         int aimEvidenceWindowMillis, int rapidSwitchMillis,
                         double rapidSwitchAngleDegrees, int rapidSwitchSamples,
                         int rapidSwitchEvidenceWindowMillis, int clickPatternSamples,
                         double clickPatternMaxDeviationMillis, int criticalSamples,
                         int criticalWindowMillis) { }
    public record WorldLimits(int maxBreaksPerSecond, int maxPlacesPerSecond,
                              double blockReachAllowance, double scaffoldAimDegrees,
                              int scaffoldSamples, int scaffoldWindowMillis,
                              int multiBreakSamples, int multiBreakWindowMillis,
                              double multiBreakMinSpan) { }
    public record AbuseLimits(int maxChatPerFiveSeconds, int maxCommandsPerFiveSeconds,
                              int maxInventoryClicksPerSecond, int inventoryEvidenceSamples,
                              int inventorySampleIntervalMillis, int inventoryEvidenceWindowMillis,
                              int maxInventoryBurstPacketsPerSecond,
                              int inventoryViolationCooldownMillis) { }
    public record Grace(double joinSeconds, double teleportSeconds, double velocitySeconds) { }
    public record HiddenOreDetection(boolean enabled, int requiredSamples, long windowMillis) { }
    public record EntityEsp(boolean enabled, double minimumTps, double nearRevealRadius,
                            double maximumVisibleDistance, int scanIntervalTicks,
                            int maxPairsPerTick, int hideAfterSamples, int revealAfterSamples,
                            int maxTrackedPairs, int maxOnlinePlayers) { }
    public record Exemptions(boolean owners, boolean admins, Set<String> players) {
        public Exemptions {
            players = players == null ? Set.of() : Set.copyOf(players);
        }
    }
    public record CheckExemptions(Map<String, Set<String>> playersByCheck) {
        public CheckExemptions {
            LinkedHashMap<String, Set<String>> copy = new LinkedHashMap<>();
            if (playersByCheck != null) {
                playersByCheck.forEach((check, players) -> {
                    if (check != null && players != null && !players.isEmpty()) {
                        copy.put(check, Set.copyOf(players));
                    }
                });
            }
            playersByCheck = Map.copyOf(copy);
        }

        public boolean contains(String check, String playerName, String playerUuid) {
            Set<String> players = playersByCheck.get(check);
            if (players == null || players.isEmpty()) return false;
            String name = playerName == null ? "" : playerName.toLowerCase(Locale.ROOT);
            String uuid = playerUuid == null ? "" : playerUuid.toLowerCase(Locale.ROOT);
            return players.contains(name) || players.contains(uuid);
        }
    }
    private record Section(int indentation, String name) { }

    private static EntityEsp entityEsp(Map<String, String> values) {
        double near = decimal(values, "mitigations.entityEsp.nearRevealRadius", 12.0, 2.0, 32.0);
        double maximum = decimal(values, "mitigations.entityEsp.maximumVisibleDistance", 96.0, 16.0, 256.0);
        return new EntityEsp(
                bool(values, "mitigations.entityEsp.enabled", false),
                decimal(values, "mitigations.entityEsp.minimumTps", 18.0, 10.0, 20.0),
                near,
                Math.max(near + 4.0, maximum),
                integer(values, "mitigations.entityEsp.scanIntervalTicks", 5, 1, 20),
                integer(values, "mitigations.entityEsp.maxPairsPerTick", 64, 4, 256),
                integer(values, "mitigations.entityEsp.hideAfterSamples", 3, 2, 8),
                integer(values, "mitigations.entityEsp.revealAfterSamples", 2, 1, 4),
                integer(values, "mitigations.entityEsp.maxTrackedPairs", 2_048, 128, 8_192),
                integer(values, "mitigations.entityEsp.maxOnlinePlayers", 128, 2, 256));
    }

    private static HiddenOreDetection hiddenOreDetection(Map<String, String> values) {
        return new HiddenOreDetection(
                bool(values, "detection.antiXray.enabled", false),
                integer(values, "detection.antiXray.requiredConcealedSamples", 3, 2, 8),
                integer(values, "detection.antiXray.windowSeconds", 300, 30, 1_800) * 1_000L);
    }

    private static AbuseLimits abuseLimits(Map<String, String> values) {
        int inventoryRate = integer(values,
                "limits.abuse.maxInventoryClicksPerSecond", 35, 1, 200);
        int evidenceSamples = integer(values,
                "limits.abuse.inventoryEvidenceSamples", 3, 2, 8);
        int sampleInterval = integer(values,
                "limits.abuse.inventorySampleIntervalMillis", 250, 100, 1_000);
        int minimumWindow = sampleInterval * (evidenceSamples - 1);
        int evidenceWindow = Math.max(minimumWindow, integer(values,
                "limits.abuse.inventoryEvidenceWindowMillis", 1_500, 500, 10_000));
        int hardLimit = Math.max(inventoryRate + 1, integer(values,
                "limits.abuse.maxInventoryBurstPacketsPerSecond", 120, 20, 1_000));
        return new AbuseLimits(
                integer(values, "limits.abuse.maxChatPerFiveSeconds", 6, 1, 100),
                integer(values, "limits.abuse.maxCommandsPerFiveSeconds", 10, 1, 200),
                inventoryRate,
                evidenceSamples,
                sampleInterval,
                evidenceWindow,
                hardLimit,
                integer(values, "limits.abuse.inventoryViolationCooldownMillis", 3_000, 500, 30_000));
    }

    private static Exemptions exemptions(Map<String, String> values, String yaml) throws IOException {
        LinkedHashSet<String> players = new LinkedHashSet<>();
        for (String player : stringList(yaml, "exempt-players", 256)) {
            if (players.size() == 256) break;
            players.add(player);
        }
        for (String player : stringList(yaml, "exemptions.players", 256)) {
            if (players.size() == 256) break;
            players.add(player);
        }
        return new Exemptions(
                bool(values, "exemptions.owners", false),
                bool(values, "exemptions.admins", false),
                Set.copyOf(players));
    }

    private static CheckExemptions checkExemptions(String yaml) throws IOException {
        String[] checks = {
                "movement.speed", "movement.flight", "movement.phase", "movement.invalidPosition", "movement.invalidRotation",
                "movement.groundSpoof", "movement.waterWalk", "movement.step", "movement.timer", "movement.noSlow",
                "combat.reach", "combat.wallHit", "combat.autoClicker", "combat.multiTarget",
                "combat.aimDirection", "combat.killAura", "combat.clickPattern", "combat.criticals",
                "world.fastBreak", "world.fastPlace", "world.breakReach", "world.placeReach", "world.scaffold", "world.multiBreak", "abuse.chatSpam", "abuse.commandSpam",
                "abuse.inventorySpam"
        };
        LinkedHashMap<String, Set<String>> rules = new LinkedHashMap<>();
        for (String check : checks) {
            Set<String> players = stringList(yaml, "check-exemptions." + check, 512);
            if (!players.isEmpty()) rules.put(check, players);
        }
        return new CheckExemptions(rules);
    }

    private static ProtectionMessages messages(Map<String, String> values) {
        ProtectionMessages defaults = ProtectionMessages.defaults();
        LinkedHashMap<String, ProtectionMessages.StyledMessage> checks = new LinkedHashMap<>();
        String[] supported = {
                "movement.speed", "movement.flight", "movement.phase", "movement.invalidPosition", "movement.invalidRotation",
                "movement.groundSpoof", "movement.waterWalk", "movement.step", "movement.timer", "movement.noSlow",
                "combat.reach", "combat.wallHit", "combat.autoClicker", "combat.multiTarget",
                "combat.aimDirection", "combat.killAura", "combat.clickPattern", "combat.criticals",
                "world.fastBreak", "world.fastPlace", "world.breakReach", "world.placeReach", "world.scaffold", "world.multiBreak", "world.hiddenOre", "abuse.chatSpam", "abuse.commandSpam",
                "abuse.inventorySpam"
        };
        for (String check : supported) {
            String path = "messages.checks." + check;
            if (values.containsKey(path + ".text") || values.containsKey(path + ".color")) {
                checks.put(check, styled(values, path));
            }
        }
        return new ProtectionMessages(
                styled(values, "messages.warning"),
                styled(values, "messages.alert"),
                styled(values, "messages.kick"),
                styled(values, "messages.temporaryBan"),
                styled(values, "messages.permanentBan"),
                styled(values, "messages.loginTemporaryBan"),
                styled(values, "messages.loginPermanentBan"),
                styled(values, "messages.modPolicyKick"),
                values.getOrDefault("messages.banSource", defaults.banSource()),
                checks);
    }

    private static ProtectionMessages.StyledMessage styled(Map<String, String> values, String path) {
        return new ProtectionMessages.StyledMessage(
                values.getOrDefault(path + ".text", ""),
                values.getOrDefault(path + ".color", ""));
    }

    /** Reads the small string-list subset emitted by the manager, without accepting arbitrary YAML. */
    private static Set<String> stringList(String yaml, String requestedPath, int maximum) throws IOException {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        ArrayDeque<Section> sections = new ArrayDeque<>();
        boolean collecting = false;
        int listIndent = -1;
        for (String raw : yaml.split("\\R", -1)) {
            if (raw.length() > MAX_LINE_LENGTH) throw new IOException("Server Protection config contains an oversized line");
            String clean = stripComment(raw);
            if (clean.isBlank()) continue;
            int indentation = indentation(clean);
            String line = clean.strip();
            if (collecting) {
                if (indentation <= listIndent) collecting = false;
                else if (line.startsWith("- ")) {
                    addPlayer(result, unquote(line.substring(2).trim()), maximum);
                    continue;
                } else continue;
            }
            int separator = line.indexOf(':');
            if (separator <= 0) continue;
            String key = line.substring(0, separator).trim();
            while (!sections.isEmpty() && sections.peekLast().indentation() >= indentation) sections.removeLast();
            StringBuilder path = new StringBuilder();
            for (Section section : sections) path.append(section.name()).append('.');
            path.append(key);
            String value = line.substring(separator + 1).trim();
            if (path.toString().equals(requestedPath)) {
                if (value.isEmpty()) {
                    collecting = true;
                    listIndent = indentation;
                } else if (!value.equals("[]")) {
                    for (String item : value.replace("[", "").replace("]", "").split(",")) {
                        addPlayer(result, unquote(item), maximum);
                    }
                }
            }
            if (value.isEmpty() && sections.size() < 12) sections.addLast(new Section(indentation, key));
        }
        return Set.copyOf(result);
    }

    private static void addPlayer(Set<String> result, String value, int maximum) {
        String name = value == null ? "" : value.strip();
        boolean playerName = name.matches("[A-Za-z0-9_]{1,16}");
        boolean uuid = name.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
        if (result.size() >= maximum || (!playerName && !uuid)) return;
        result.add(name.toLowerCase(Locale.ROOT));
    }
}
