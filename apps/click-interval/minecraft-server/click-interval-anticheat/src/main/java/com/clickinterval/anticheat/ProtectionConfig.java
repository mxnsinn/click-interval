package com.clickinterval.anticheat;

import com.clickinterval.anticheat.core.ViolationPolicy;
import com.clickinterval.anticheat.core.CompatibilityPolicy;
import com.clickinterval.anticheat.core.ProtectionMessages;
import com.clickinterval.anticheat.core.ReachCheckMath;
import com.clickinterval.anticheat.core.ProtectionRuntimePolicy;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.FileConfiguration;

import java.util.Collection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public record ProtectionConfig(
        String preset,
        boolean enabled,
        boolean responseEnabled,
        String preThresholdAction,
        Checks checks,
        Limits limits,
        ReachSettings reach,
        ViolationPolicy policy,
        long joinGraceMillis,
        long teleportGraceMillis,
        long velocityGraceMillis,
        double minimumTps,
        String bypassPermission,
        Set<String> exemptWorlds,
        Set<String> exemptPlayers,
        CompatibilityPolicy compatibility,
        ProtectionMessages messages,
        long warningCooldownMillis,
        EntityEsp entityEsp
) {
    private static final int MAX_EXEMPT_WORLDS = 256;
    private static final int MAX_EXEMPT_PLAYERS = 512;
    private static final List<String> MESSAGE_CHECKS = List.of(
            "movement.speed",
            "movement.flight",
            "movement.phase",
            "movement.invalidPosition",
            "movement.invalidRotation",
            "movement.groundSpoof",
            "movement.waterWalk",
            "movement.step",
            "movement.timer",
            "movement.noSlow",
            "combat.reach",
            "combat.wallHit",
            "combat.autoClicker",
            "combat.multiTarget",
            "combat.aimDirection",
            "combat.killAura",
            "combat.clickPattern",
            "combat.criticals",
            "world.fastBreak",
            "world.fastPlace",
            "world.breakReach",
            "world.placeReach",
            "world.scaffold",
            "world.multiBreak",
            "abuse.chatSpam",
            "abuse.commandSpam",
            "abuse.inventorySpam"
    );

    public static ProtectionConfig from(FileConfiguration config) {
        Checks checks = new Checks(
                config.getBoolean("checks.movement.speed", true),
                config.getBoolean("checks.movement.flight", true),
                config.getBoolean("checks.movement.phase", true),
                config.getBoolean("checks.movement.invalidPosition", true),
                config.getBoolean("checks.movement.invalidRotation", true),
                config.getBoolean("checks.movement.groundSpoof", true),
                config.getBoolean("checks.movement.waterWalk", true),
                config.getBoolean("checks.movement.step", true),
                config.getBoolean("checks.movement.timer", true),
                config.getBoolean("checks.movement.noSlow", false),
                config.getBoolean("checks.combat.reach", true),
                config.getBoolean("checks.combat.wallHit", true),
                config.getBoolean("checks.combat.autoClicker", true),
                config.getBoolean("checks.combat.multiTarget", true),
                config.getBoolean("checks.combat.aimDirection", false),
                config.getBoolean("checks.combat.killAura", false),
                config.getBoolean("checks.combat.clickPattern", true),
                config.getBoolean("checks.combat.criticals", false),
                config.getBoolean("checks.world.fastBreak", true),
                config.getBoolean("checks.world.fastPlace", true),
                config.getBoolean("checks.world.breakReach", true),
                config.getBoolean("checks.world.placeReach", true),
                config.getBoolean("checks.world.scaffold", false),
                config.getBoolean("checks.world.multiBreak", false),
                config.getBoolean("checks.abuse.chatSpam", true),
                config.getBoolean("checks.abuse.commandSpam", true),
                config.getBoolean("checks.abuse.inventorySpam", true)
        );
        Limits limits = new Limits(
                config.getDouble("limits.movement.maxGroundBlocksPerTick", 0.78),
                config.getDouble("limits.movement.maxAirBlocksPerTick", 0.92),
                config.getInt("limits.movement.maxAirTicks", 80),
                clamp(config.getInt("limits.movement.phaseSamples", 3), 2, 10),
                clamp(config.getInt("limits.movement.groundSpoofSamples", 5), 3, 12),
                clamp(config.getInt("limits.movement.waterWalkSamples", 7), 3, 16),
                clamp(config.getInt("limits.movement.stepSamples", 2), 2, 8),
                clampFinite(config.getDouble("limits.movement.maxUseItemBlocksPerTick", 0.20), 0.08, 0.50, 0.20),
                clamp(config.getInt("limits.movement.noSlowSamples", 7), 3, 16),
                clamp(config.getInt("limits.movement.maxPacketsPerSecond", 28), 21, 100),
                clamp(config.getInt("limits.movement.timerEvidenceWindows", 3), 2, 6),
                clampFinite(config.getDouble("limits.combat.maxReach", 3.45), 2.5, 8.0, 3.45),
                clamp(config.getInt("limits.combat.maxCps", 20), 5, 40),
                clamp(config.getInt("limits.combat.wallHitSamples", 3), 1, 10),
                clamp(config.getInt("limits.combat.multiTargetCount", 4), 2, 16),
                clamp(config.getInt("limits.combat.multiTargetWindowMillis", 650), 100, 5_000),
                clampFinite(config.getDouble("limits.combat.maxAimDeviationDegrees", 55.0), 20.0, 120.0, 55.0),
                clamp(config.getInt("limits.combat.aimEvidenceSamples", 4), 2, 12),
                clamp(config.getInt("limits.combat.aimEvidenceWindowMillis", 1_500), 500, 5_000),
                clamp(config.getInt("limits.combat.rapidSwitchMillis", 90), 40, 300),
                clampFinite(config.getDouble("limits.combat.rapidSwitchAngleDegrees", 110.0), 45.0, 170.0, 110.0),
                clamp(config.getInt("limits.combat.rapidSwitchSamples", 3), 2, 8),
                clamp(config.getInt("limits.combat.rapidSwitchEvidenceWindowMillis", 1_200), 300, 5_000),
                clamp(config.getInt("limits.combat.clickPatternSamples", 16), 8, 24),
                clampFinite(config.getDouble("limits.combat.clickPatternMaxDeviationMillis", 1.5), 0.0, 20.0, 1.5),
                clamp(config.getInt("limits.combat.criticalSamples", 3), 2, 8),
                clamp(config.getInt("limits.combat.criticalWindowMillis", 2_500), 500, 10_000),
                clamp(config.getInt("limits.world.maxBreaksPerSecond", 18), 1, 60),
                clamp(config.getInt("limits.world.maxPlacesPerSecond", 16), 1, 60),
                clampFinite(config.getDouble("limits.world.blockReachAllowance", 0.75), 0.25, 3.0, 0.75),
                clampFinite(config.getDouble("limits.world.scaffoldAimDegrees", 80.0), 45.0, 140.0, 80.0),
                clamp(config.getInt("limits.world.scaffoldSamples", 4), 2, 10),
                clamp(config.getInt("limits.world.scaffoldWindowMillis", 2_000), 500, 10_000),
                clamp(config.getInt("limits.world.multiBreakSamples", 6), 3, 12),
                clamp(config.getInt("limits.world.multiBreakWindowMillis", 300), 100, 2_000),
                clampFinite(config.getDouble("limits.world.multiBreakMinSpan", 3.5), 1.5, 10.0, 3.5),
                clamp(config.getInt("limits.abuse.maxChatPerFiveSeconds", 6), 1, 30),
                clamp(config.getInt("limits.abuse.maxCommandsPerFiveSeconds", 10), 1, 60),
                clamp(config.getInt("limits.abuse.maxInventoryClicksPerSecond", 35), 1, 100)
        );
        ReachSettings reach = readReachSettings(config);
        ViolationPolicy policy = new ViolationPolicy(
                config.getDouble("response.alertVl", 8.0),
                config.getDouble("response.kickVl", 16.0),
                config.getInt("response.kickOffenses", 1),
                config.getInt("response.tempBanOffenses", 3),
                config.getInt("response.tempBanMinutes", 60),
                config.getInt("response.permanentBanOffenses", 7),
                config.getInt("response.offenseDecayHours", 168),
                config.getDouble("violation-decay", 0.12),
                config.getLong("response.actionCooldownSeconds", 8L) * 1000L
        );
        Set<String> worlds = new HashSet<>();
        for (String world : config.getStringList("exempt-worlds")) {
            String normalized = world == null ? "" : world.trim().toLowerCase(Locale.ROOT);
            if (!normalized.isEmpty() && normalized.length() <= 128) worlds.add(normalized);
            if (worlds.size() == MAX_EXEMPT_WORLDS) break;
        }
        Set<String> players = new HashSet<>();
        for (String player : config.getStringList("exempt-players")) {
            String normalized = player == null ? "" : player.trim().toLowerCase(Locale.ROOT);
            if (normalized.matches("[a-z0-9_]{1,16}")) players.add(normalized);
            if (players.size() == MAX_EXEMPT_PLAYERS) break;
        }
        String preThresholdAction = config.getString("response.preThresholdAction", "log");
        if (!preThresholdAction.equalsIgnoreCase("warn")) preThresholdAction = "log";
        CompatibilityPolicy compatibility = new CompatibilityPolicy(
                readMapExemptionRules(config, "compatibility.playerOverrides"),
                readPermissionExemptionRules(config, "compatibility.permissionOverrides"),
                new CompatibilityPolicy.ModPolicy(
                        config.getBoolean("modPolicy.enabled", false),
                        config.getBoolean("modPolicy.requireDeclaration", false),
                        config.getBoolean("modPolicy.enforceAllowlist", false),
                        config.getInt("modPolicy.declarationGraceSeconds", 8),
                        CompatibilityPolicy.ModEnforcement.parse(
                                config.getString("modPolicy.enforcement", "report")),
                        Set.copyOf(config.getStringList("modPolicy.allowed")),
                        Set.copyOf(config.getStringList("modPolicy.blocked"))
                )
        );
        ProtectionMessages messages = readMessages(config);
        double nearRevealRadius = clampFinite(
                config.getDouble("mitigations.entityEsp.nearRevealRadius", 12.0), 2.0, 32.0, 12.0);
        EntityEsp entityEsp = new EntityEsp(
                // Compatibility-only input: withholding a Bukkit player also removes their
                // nametag and creates unavoidable PvP pop-in, so stale enabled=true values are
                // deliberately ignored.
                false,
                clampFinite(config.getDouble("mitigations.entityEsp.minimumTps", 18.0), 10.0, 20.0, 18.0),
                nearRevealRadius,
                Math.max(nearRevealRadius + 4.0, clampFinite(
                        config.getDouble("mitigations.entityEsp.maximumVisibleDistance", 96.0),
                        16.0, 256.0, 96.0)),
                clamp(config.getInt("mitigations.entityEsp.scanIntervalTicks", 5), 1, 20),
                clamp(config.getInt("mitigations.entityEsp.maxPairsPerTick", 64), 4, 256),
                clamp(config.getInt("mitigations.entityEsp.hideAfterSamples", 3), 2, 8),
                clamp(config.getInt("mitigations.entityEsp.revealAfterSamples", 2), 1, 4),
                clamp(config.getInt("mitigations.entityEsp.maxTrackedPairs", 2_048), 128, 8_192),
                clamp(config.getInt("mitigations.entityEsp.maxOnlinePlayers", 128), 2, 256)
        );
        return new ProtectionConfig(
                config.getString("preset", "balanced"),
                config.getBoolean("enabled", true),
                config.getBoolean("response.enabled", true),
                preThresholdAction.toLowerCase(Locale.ROOT),
                checks, limits, reach, policy,
                ProtectionRuntimePolicy.boundedSecondsToMillis(
                        config.getDouble("grace.joinSeconds", 4.0), 4.0, 2.0, 30.0),
                ProtectionRuntimePolicy.boundedSecondsToMillis(
                        config.getDouble("grace.teleportSeconds", 3.0), 3.0, 2.0, 30.0),
                ProtectionRuntimePolicy.boundedSecondsToMillis(
                        config.getDouble("grace.velocitySeconds", 2.0), 2.0, 1.0, 15.0),
                config.getDouble("minimum-tps", 18.0),
                config.getString("bypass-permission", "serverprotection.bypass"),
                Set.copyOf(worlds),
                Set.copyOf(players),
                compatibility,
                messages,
                clamp(config.getLong("messages.warningCooldownSeconds", 10L), 1L, 300L) * 1000L,
                entityEsp
        );
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static long clamp(long value, long minimum, long maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static double clampFinite(double value, double minimum, double maximum, double fallback) {
        if (!Double.isFinite(value)) return fallback;
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static ReachSettings readReachSettings(FileConfiguration config) {
        ReachCheckMath.Parameters defaults = ReachCheckMath.Parameters.balancedDefaults();
        return new ReachSettings(new ReachCheckMath.Parameters(
                config.getDouble("reach.geometryAllowance", defaults.geometryAllowance()),
                config.getDouble("reach.maxPingAllowance", defaults.maxPingAllowance()),
                config.getDouble("reach.pingAllowancePerMs", defaults.pingAllowancePerMs()),
                config.getDouble("reach.maxTickAllowance", defaults.maxTickAllowance()),
                config.getDouble(
                        "reach.tickAllowancePerMissingTps", defaults.tickAllowancePerMissingTps()),
                config.getDouble("reach.maxTargetRewind", defaults.maxTargetRewind()),
                config.getDouble("reach.baseRewindTicks", defaults.baseRewindTicks()),
                config.getDouble(
                        "reach.pingRewindTicksPerMs", defaults.pingRewindTicksPerMs()),
                config.getDouble("reach.maxRewindTicks", defaults.maxRewindTicks()),
                config.getDouble("reach.immediateExcess", defaults.immediateExcess()),
                config.getInt("reach.consecutiveSamples", defaults.consecutiveSamples()),
                config.getLong("reach.evidenceWindowMillis", defaults.evidenceWindowMillis())
        ));
    }

    private static ProtectionMessages readMessages(FileConfiguration config) {
        ProtectionMessages defaults = ProtectionMessages.defaults();
        LinkedHashMap<String, ProtectionMessages.StyledMessage> checkWarnings = new LinkedHashMap<>();
        for (String check : MESSAGE_CHECKS) {
            String path = "messages.checks." + check;
            if (config.isSet(path + ".text") || config.isSet(path + ".color")) {
                checkWarnings.put(check, readMessage(config, path));
            }
        }
        return new ProtectionMessages(
                readMessage(config, "messages.warning"),
                readMessage(config, "messages.alert"),
                readMessage(config, "messages.kick"),
                readMessage(config, "messages.temporaryBan"),
                readMessage(config, "messages.permanentBan"),
                readMessage(config, "messages.loginTemporaryBan"),
                readMessage(config, "messages.loginPermanentBan"),
                readMessage(config, "messages.modPolicyKick"),
                config.getString("messages.banSource", defaults.banSource()),
                checkWarnings
        );
    }

    private static ProtectionMessages.StyledMessage readMessage(FileConfiguration config, String path) {
        return new ProtectionMessages.StyledMessage(
                config.getString(path + ".text", ""),
                config.getString(path + ".color", "")
        );
    }

    private static Map<String, Collection<String>> readMapExemptionRules(FileConfiguration config, String path) {
        ConfigurationSection section = config.getConfigurationSection(path);
        if (section == null) return Map.of();
        LinkedHashMap<String, Collection<String>> rules = new LinkedHashMap<>();
        // Use the section's raw entries so dotted permission keys are not interpreted as paths.
        for (Map.Entry<String, Object> entry : section.getValues(false).entrySet()) {
            if (!(entry.getValue() instanceof ConfigurationSection rule)) continue;
            List<String> checks = rule.getStringList("exemptChecks");
            if (!checks.isEmpty()) rules.put(entry.getKey(), List.copyOf(checks));
            if (rules.size() == CompatibilityPolicy.MAX_RULES) break;
        }
        return Map.copyOf(rules);
    }

    private static Map<String, Collection<String>> readPermissionExemptionRules(
            FileConfiguration config,
            String path
    ) {
        LinkedHashMap<String, Collection<String>> rules = new LinkedHashMap<>();
        for (Map<?, ?> entry : config.getMapList(path)) {
            if (rules.size() == CompatibilityPolicy.MAX_RULES) break;
            Object permissionValue = entry.get("permission");
            Object checksValue = entry.get("exemptChecks");
            if (!(permissionValue instanceof String permission) || !(checksValue instanceof Collection<?> values)) {
                continue;
            }
            List<String> checks = new ArrayList<>(MESSAGE_CHECKS.size());
            for (Object value : values) {
                if (value instanceof String text) checks.add(text);
                if (checks.size() == MESSAGE_CHECKS.size()) break;
            }
            if (!checks.isEmpty()) rules.put(permission, checks);
        }
        if (!rules.isEmpty()) return Map.copyOf(rules);
        // Backward-compatible support for simple, non-dotted map keys.
        return readMapExemptionRules(config, path);
    }

    public record Checks(
            boolean speed,
            boolean flight,
            boolean phase,
            boolean invalidPosition,
            boolean invalidRotation,
            boolean groundSpoof,
            boolean waterWalk,
            boolean step,
            boolean timer,
            boolean noSlow,
            boolean reach,
            boolean wallHit,
            boolean autoClicker,
            boolean multiTarget,
            boolean aimDirection,
            boolean killAura,
            boolean clickPattern,
            boolean criticals,
            boolean fastBreak,
            boolean fastPlace,
            boolean breakReach,
            boolean placeReach,
            boolean scaffold,
            boolean multiBreak,
            boolean chatSpam,
            boolean commandSpam,
            boolean inventorySpam
    ) {
    }

    public record Limits(
            double maxGroundBlocksPerTick,
            double maxAirBlocksPerTick,
            int maxAirTicks,
            int phaseSamples,
            int groundSpoofSamples,
            int waterWalkSamples,
            int stepSamples,
            double maxUseItemBlocksPerTick,
            int noSlowSamples,
            int maxPacketsPerSecond,
            int timerEvidenceWindows,
            double maxReach,
            int maxCps,
            int wallHitSamples,
            int multiTargetCount,
            int multiTargetWindowMillis,
            double maxAimDeviationDegrees,
            int aimEvidenceSamples,
            int aimEvidenceWindowMillis,
            int rapidSwitchMillis,
            double rapidSwitchAngleDegrees,
            int rapidSwitchSamples,
            int rapidSwitchEvidenceWindowMillis,
            int clickPatternSamples,
            double clickPatternMaxDeviationMillis,
            int criticalSamples,
            int criticalWindowMillis,
            int maxBreaksPerSecond,
            int maxPlacesPerSecond,
            double blockReachAllowance,
            double scaffoldAimDegrees,
            int scaffoldSamples,
            int scaffoldWindowMillis,
            int multiBreakSamples,
            int multiBreakWindowMillis,
            double multiBreakMinSpan,
            int maxChatPerFiveSeconds,
            int maxCommandsPerFiveSeconds,
            int maxInventoryClicksPerSecond
    ) {
    }

    public record ReachSettings(ReachCheckMath.Parameters parameters) {
        public ReachSettings {
            if (parameters == null) throw new IllegalArgumentException("Reach parameters are required");
        }
    }

    public record EntityEsp(
            boolean enabled,
            double minimumTps,
            double nearRevealRadius,
            double maximumVisibleDistance,
            int scanIntervalTicks,
            int maxPairsPerTick,
            int hideAfterSamples,
            int revealAfterSamples,
            int maxTrackedPairs,
            int maxOnlinePlayers
    ) {
    }
}
