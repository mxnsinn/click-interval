package dev.serverprotection.fabric.attestation;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/** Policy over an advisory client-controlled mod report. */
public record ClientModPolicy(
        boolean enabled,
        boolean requireReport,
        boolean enforceAllowlist,
        int graceSeconds,
        Enforcement enforcement,
        Set<String> allowed,
        Set<String> blocked
) {
    public ClientModPolicy {
        graceSeconds = Math.max(3, Math.min(60, graceSeconds));
        enforcement = enforcement == null ? Enforcement.REPORT : enforcement;
        allowed = normalize(allowed);
        blocked = normalize(blocked);
    }

    public static ClientModPolicy disabled() {
        return new ClientModPolicy(false, false, false, 8, Enforcement.REPORT, Set.of(), Set.of());
    }

    /**
     * A successful result means only that the companion reported an acceptable list. It never
     * proves that the client is clean.
     */
    public Decision evaluate(AttestationProtocol.Report report) {
        if (!enabled) return Decision.allow(report == null ? Status.UNVERIFIED : Status.REPORTED_ADVISORY);
        if (report == null) {
            return requireReport
                    ? new Decision(Violation.MISSING_REPORT, "", Status.UNVERIFIED)
                    : Decision.allow(Status.UNVERIFIED);
        }
        String blockedMatch = firstMatch(report.mods().keySet(), blocked, false);
        if (blockedMatch != null) {
            return new Decision(Violation.BLOCKED_MOD_REPORTED, blockedMatch, report.truncated()
                    ? Status.REPORTED_TRUNCATED : Status.REPORTED_ADVISORY);
        }
        if (report.truncated() && (requireReport || enforceAllowlist)) {
            return new Decision(Violation.INCOMPLETE_REPORT, "", Status.REPORTED_TRUNCATED);
        }
        if (enforceAllowlist) {
            String outside = firstAllowlistViolation(report.mods().keySet(), allowed);
            if (outside != null) {
                return new Decision(Violation.MOD_OUTSIDE_ALLOWLIST_REPORTED, outside,
                        Status.REPORTED_ADVISORY);
            }
        }
        return Decision.allow(report.truncated() ? Status.REPORTED_TRUNCATED : Status.REPORTED_ADVISORY);
    }

    private static String firstAllowlistViolation(Collection<String> candidates, Set<String> allowlist) {
        String selected = null;
        if (candidates == null) return null;
        for (String candidate : candidates) {
            String normalized = AttestationProtocol.normalizeModId(candidate);
            if (normalized == null || AttestationProtocol.isInfrastructureMod(normalized)
                    || allowlist.contains(normalized)) continue;
            if (selected == null || normalized.compareTo(selected) < 0) selected = normalized;
        }
        return selected;
    }

    private static String firstMatch(Collection<String> candidates, Set<String> policy, boolean invert) {
        String selected = null;
        if (candidates == null) return null;
        for (String candidate : candidates) {
            String normalized = AttestationProtocol.normalizeModId(candidate);
            if (normalized == null) continue;
            boolean match = policy.contains(normalized);
            if ((invert ? !match : match) && (selected == null || normalized.compareTo(selected) < 0)) {
                selected = normalized;
            }
        }
        return selected;
    }

    private static Set<String> normalize(Collection<String> values) {
        if (values == null || values.isEmpty()) return Set.of();
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String value : values) {
            String id = AttestationProtocol.normalizeModId(value);
            if (id != null) normalized.add(id);
            if (normalized.size() == AttestationProtocol.MAX_MODS) break;
        }
        return Set.copyOf(normalized);
    }

    public enum Enforcement { REPORT, KICK }

    public enum Status {
        UNVERIFIED,
        UNAVAILABLE,
        TIMED_OUT,
        WAITING,
        REPORTED_ADVISORY,
        REPORTED_TRUNCATED,
        INVALID
    }

    public enum Violation {
        NONE,
        MISSING_REPORT,
        INCOMPLETE_REPORT,
        BLOCKED_MOD_REPORTED,
        MOD_OUTSIDE_ALLOWLIST_REPORTED
    }

    public record Decision(Violation violation, String modId, Status status) {
        public Decision {
            violation = violation == null ? Violation.NONE : violation;
            modId = modId == null ? "" : modId;
            status = status == null ? Status.UNVERIFIED : status;
        }

        public static Decision allow(Status status) {
            return new Decision(Violation.NONE, "", status);
        }

        public boolean violatesPolicy() {
            return violation != Violation.NONE;
        }
    }
}
