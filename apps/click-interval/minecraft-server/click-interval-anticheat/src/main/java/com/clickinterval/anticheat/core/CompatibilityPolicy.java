package com.clickinterval.anticheat.core;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;

/**
 * Narrow anti-cheat exemptions and best-effort policy for client-declared mods.
 *
 * <p>Player/permission exemptions are authoritative server-side data. Client mod declarations are
 * deliberately kept separate: a modified client can omit or forge them, so they are never used to
 * exempt an anti-cheat check.</p>
 */
public final class CompatibilityPolicy {
    public static final int MAX_RULES = 512;
    public static final Set<String> KNOWN_CHECKS = Set.of(
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

    private final Map<String, Set<String>> playerExemptChecks;
    private final Map<String, Set<String>> permissionExemptChecks;
    private final ModPolicy modPolicy;

    public CompatibilityPolicy(
            Map<String, ? extends Collection<String>> playerExemptChecks,
            Map<String, ? extends Collection<String>> permissionExemptChecks,
            ModPolicy modPolicy
    ) {
        this.playerExemptChecks = normalizeRules(playerExemptChecks, true);
        this.permissionExemptChecks = normalizeRules(permissionExemptChecks, false);
        this.modPolicy = modPolicy == null ? ModPolicy.disabled() : modPolicy;
    }

    public static CompatibilityPolicy disabled() {
        return new CompatibilityPolicy(Map.of(), Map.of(), ModPolicy.disabled());
    }

    /**
     * Returns true only for an exact check granted to this exact UUID/name or a server permission.
     * There is intentionally no global wildcard and client-declared mods are not consulted.
     */
    public boolean isCheckExempt(
            UUID playerId,
            String playerName,
            Predicate<String> hasPermission,
            String check
    ) {
        String normalizedCheck = normalizeCheck(check);
        if (normalizedCheck == null) return false;
        if (playerId != null && contains(playerExemptChecks.get(playerId.toString().toLowerCase(Locale.ROOT)), normalizedCheck)) {
            return true;
        }
        String normalizedName = normalizeKey(playerName);
        if (normalizedName != null && contains(playerExemptChecks.get(normalizedName), normalizedCheck)) {
            return true;
        }
        if (hasPermission == null) return false;
        for (Map.Entry<String, Set<String>> rule : permissionExemptChecks.entrySet()) {
            if (rule.getValue().contains(normalizedCheck) && hasPermission.test(rule.getKey())) return true;
        }
        return false;
    }

    public Set<String> exemptionForPlayer(UUID playerId, String playerName) {
        LinkedHashSet<String> checks = new LinkedHashSet<>();
        if (playerId != null) {
            checks.addAll(playerExemptChecks.getOrDefault(
                    playerId.toString().toLowerCase(Locale.ROOT), Set.of()));
        }
        String normalizedName = normalizeKey(playerName);
        if (normalizedName != null) checks.addAll(playerExemptChecks.getOrDefault(normalizedName, Set.of()));
        return Set.copyOf(checks);
    }

    /** Resolve direct and permission-backed exemptions once so hot event paths can cache the result. */
    public Set<String> exemptionForPlayer(
            UUID playerId,
            String playerName,
            Predicate<String> hasPermission
    ) {
        LinkedHashSet<String> checks = new LinkedHashSet<>(exemptionForPlayer(playerId, playerName));
        if (hasPermission != null) {
            for (Map.Entry<String, Set<String>> rule : permissionExemptChecks.entrySet()) {
                if (hasPermission.test(rule.getKey())) checks.addAll(rule.getValue());
            }
        }
        return Set.copyOf(checks);
    }

    public Map<String, Set<String>> playerExemptChecks() {
        return playerExemptChecks;
    }

    public Map<String, Set<String>> permissionExemptChecks() {
        return permissionExemptChecks;
    }

    public ModPolicy modPolicy() {
        return modPolicy;
    }

    private static boolean contains(Set<String> checks, String check) {
        return checks != null && checks.contains(check);
    }

    private static Map<String, Set<String>> normalizeRules(
            Map<String, ? extends Collection<String>> source,
            boolean allowPlayerName
    ) {
        if (source == null || source.isEmpty()) return Map.of();
        LinkedHashMap<String, Set<String>> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, ? extends Collection<String>> entry : source.entrySet()) {
            String key = normalizeKey(entry.getKey());
            if (key == null) continue;
            if (!allowPlayerName && !validPermission(key)) continue;
            LinkedHashSet<String> checks = new LinkedHashSet<>();
            Collection<String> values = entry.getValue();
            if (values != null) {
                for (String value : values) {
                    String check = normalizeCheck(value);
                    if (check != null) checks.add(check);
                }
            }
            if (!checks.isEmpty()) normalized.put(key, Set.copyOf(checks));
            if (normalized.size() == MAX_RULES) break;
        }
        return Map.copyOf(normalized);
    }

    private static String normalizeCheck(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        return KNOWN_CHECKS.contains(normalized) ? normalized : null;
    }

    private static String normalizeKey(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.isEmpty() || normalized.length() > 128 ? null : normalized;
    }

    private static boolean validPermission(String value) {
        if (value.length() > 128) return false;
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (!(character >= 'a' && character <= 'z')
                    && !(character >= '0' && character <= '9')
                    && character != '.' && character != '_' && character != '-') return false;
        }
        return true;
    }

    public enum ModEnforcement {
        REPORT,
        KICK;

        public static ModEnforcement parse(String value) {
            return value != null && value.equalsIgnoreCase("kick") ? KICK : REPORT;
        }
    }

    public enum ModDecisionType {
        ALLOW,
        MISSING_DECLARATION,
        BLOCKED_MOD,
        NOT_ALLOWED
    }

    public record ModDecision(ModDecisionType type, String modId) {
        public static ModDecision allow() {
            return new ModDecision(ModDecisionType.ALLOW, "");
        }

        public boolean violation() {
            return type != ModDecisionType.ALLOW;
        }
    }

    public record ModPolicy(
            boolean enabled,
            boolean requireDeclaration,
            boolean enforceAllowlist,
            int declarationGraceSeconds,
            ModEnforcement enforcement,
            Set<String> allowed,
            Set<String> blocked
    ) {
        public ModPolicy {
            declarationGraceSeconds = Math.max(3, Math.min(60, declarationGraceSeconds));
            enforcement = enforcement == null ? ModEnforcement.REPORT : enforcement;
            allowed = normalizeMods(allowed);
            blocked = normalizeMods(blocked);
        }

        public static ModPolicy disabled() {
            return new ModPolicy(false, false, false, 8, ModEnforcement.REPORT, Set.of(), Set.of());
        }

        /**
         * Evaluates only what the client explicitly declared. This is useful as an administrative
         * policy but is not cheat proof because a hostile client controls its declaration.
         */
        public ModDecision evaluate(boolean declarationReceived, Collection<String> declaredMods) {
            if (!enabled) return ModDecision.allow();
            if (!declarationReceived) {
                return requireDeclaration
                        ? new ModDecision(ModDecisionType.MISSING_DECLARATION, "")
                        : ModDecision.allow();
            }
            Set<String> mods = normalizeMods(declaredMods);
            String blockedMatch = firstSortedMatch(mods, blocked, false);
            if (blockedMatch != null) return new ModDecision(ModDecisionType.BLOCKED_MOD, blockedMatch);
            if (enforceAllowlist) {
                String outsideAllowlist = firstSortedMatch(mods, allowed, true);
                if (outsideAllowlist != null) return new ModDecision(ModDecisionType.NOT_ALLOWED, outsideAllowlist);
            }
            return ModDecision.allow();
        }

        private static String firstSortedMatch(Set<String> candidates, Set<String> policy, boolean invert) {
            String selected = null;
            for (String candidate : candidates) {
                boolean matches = policy.contains(candidate);
                if ((invert ? !matches : matches) && (selected == null || candidate.compareTo(selected) < 0)) {
                    selected = candidate;
                }
            }
            return selected;
        }

        private static Set<String> normalizeMods(Collection<String> source) {
            if (source == null || source.isEmpty()) return Set.of();
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String value : source) {
                String mod = ModDeclaration.normalizeModId(value);
                if (mod != null) normalized.add(mod);
                if (normalized.size() == ModDeclaration.MAX_MODS) break;
            }
            return Set.copyOf(normalized);
        }
    }
}
