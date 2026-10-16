package dev.serverprotection.fabric;

import dev.serverprotection.fabric.attestation.AttestationProtocol;
import dev.serverprotection.fabric.attestation.ClientModPolicy;
import dev.serverprotection.fabric.attestation.ClientAttestationSessions;
import dev.serverprotection.fabric.attestation.FabricModPolicyConfig;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class AttestationProtocolTest {
    private static final byte[] NONCE = new byte[] {
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
    };

    @Test
    void challengeAndReportRoundTripAreNonceBoundAndNormalized() {
        assertArrayEquals(NONCE, AttestationProtocol.decodeChallenge(
                AttestationProtocol.encodeChallenge(NONCE)).nonce());

        byte[] response = AttestationProtocol.encodeReport(NONCE, "1.0.0", List.of(
                new AttestationProtocol.ModEntry("Fabric-API", "0.161.0"),
                new AttestationProtocol.ModEntry("example_mod", "2.0"),
                new AttestationProtocol.ModEntry("fabric-api", "duplicate ignored")));
        AttestationProtocol.Report report = AttestationProtocol.decodeReport(response, NONCE);
        assertEquals("1.0.0", report.reporterVersion());
        assertEquals(Set.of("fabric-api", "example_mod"), report.mods().keySet());
        assertEquals("0.161.0", report.mods().get("fabric-api"));
        assertFalse(report.truncated());

        byte[] otherNonce = NONCE.clone();
        otherNonce[15] = 42;
        assertThrows(IllegalArgumentException.class,
                () -> AttestationProtocol.decodeReport(response, otherNonce));
    }

    @Test
    void reportsAreBoundedAndTruncationIsExplicit() {
        List<AttestationProtocol.ModEntry> mods = new ArrayList<>();
        for (int index = 0; index < 300; index++) {
            mods.add(new AttestationProtocol.ModEntry("mod_" + index, "1"));
        }
        AttestationProtocol.Report report = AttestationProtocol.decodeReport(
                AttestationProtocol.encodeReport(NONCE, "1", mods), NONCE);
        assertEquals(AttestationProtocol.MAX_MODS, report.mods().size());
        assertTrue(report.truncated());

        byte[] oversized = new byte[AttestationProtocol.MAX_PAYLOAD_BYTES + 1];
        assertThrows(IllegalArgumentException.class,
                () -> AttestationProtocol.decodeReport(oversized, NONCE));
    }

    @Test
    void malformedDuplicateAndTrailingReportsAreRejected() {
        byte[] valid = AttestationProtocol.encodeReport(NONCE, "1", List.of(
                new AttestationProtocol.ModEntry("one", "1")));
        byte[] trailing = java.util.Arrays.copyOf(valid, valid.length + 1);
        assertThrows(IllegalArgumentException.class,
                () -> AttestationProtocol.decodeReport(trailing, NONCE));

        byte[] damaged = valid.clone();
        damaged[0] ^= 1;
        assertThrows(IllegalArgumentException.class,
                () -> AttestationProtocol.decodeReport(damaged, NONCE));
    }

    @Test
    void policyUsesPreciseAdvisorySemanticsAndBlockedWins() {
        ClientModPolicy policy = new ClientModPolicy(
                true, true, true, 8, ClientModPolicy.Enforcement.KICK,
                Set.of("fabricloader", "safe_mod"), Set.of("bad_mod"));

        ClientModPolicy.Decision missing = policy.evaluate(null);
        assertEquals(ClientModPolicy.Violation.MISSING_REPORT, missing.violation());
        assertEquals(ClientModPolicy.Status.UNVERIFIED, missing.status());

        AttestationProtocol.Report blocked = new AttestationProtocol.Report(
                "1", java.util.Map.of("bad_mod", "9"), false);
        assertEquals(ClientModPolicy.Violation.BLOCKED_MOD_REPORTED,
                policy.evaluate(blocked).violation());

        AttestationProtocol.Report outside = new AttestationProtocol.Report(
                "1", java.util.Map.of("unknown_mod", "1"), false);
        assertEquals(ClientModPolicy.Violation.MOD_OUTSIDE_ALLOWLIST_REPORTED,
                policy.evaluate(outside).violation());

        AttestationProtocol.Report safe = new AttestationProtocol.Report(
                "1", java.util.Map.of("safe_mod", "1"), false);
        ClientModPolicy.Decision allowed = policy.evaluate(safe);
        assertFalse(allowed.violatesPolicy());
        assertEquals(ClientModPolicy.Status.REPORTED_ADVISORY, allowed.status());
    }

    @Test
    void fabricPolicyReaderAcceptsManagerShapeAndRejectsAmbiguity() throws Exception {
        ClientModPolicy policy = FabricModPolicyConfig.parse("""
                enabled: true
                modPolicy:
                  enabled: true
                  enforcement: kick
                  requireDeclaration: true
                  declarationGraceSeconds: 9
                  enforceAllowlist: true
                  allowed: ["fabricloader", "safe_mod"]
                  blocked: ["bad_mod"]
                grace:
                  joinSeconds: 5
                """);
        assertTrue(policy.enabled());
        assertTrue(policy.requireReport());
        assertTrue(policy.enforceAllowlist());
        assertEquals(9, policy.graceSeconds());
        assertEquals(ClientModPolicy.Enforcement.KICK, policy.enforcement());
        assertEquals(Set.of("fabricloader", "safe_mod"), policy.allowed());
        assertEquals(Set.of("bad_mod"), policy.blocked());

        assertThrows(java.io.IOException.class, () -> FabricModPolicyConfig.parse("""
                modPolicy:
                  enabled: true
                  allowed: ["same"]
                  blocked: ["same"]
                """));
        assertThrows(java.io.IOException.class, () -> FabricModPolicyConfig.parse("""
                modPolicy:
                  enabled: true
                  enabled: false
                """));
    }

    @Test
    void allowlistDoesNotRejectAuditedFabricInfrastructureEntries() {
        ClientModPolicy policy = new ClientModPolicy(
                true, true, true, 8, ClientModPolicy.Enforcement.KICK,
                Set.of("sodium"), Set.of());
        AttestationProtocol.Report report = new AttestationProtocol.Report("1", java.util.Map.of(
                "minecraft", "26.3",
                "java", "25",
                "fabricloader", "0.19.5",
                "fabric-api", "0.161.0",
                "fabric-command-api-v2", "1",
                "serverprotection_companion", "1.0.0",
                "sodium", "1.0"), false);

        assertFalse(policy.evaluate(report).violatesPolicy());
        assertFalse(AttestationProtocol.isInfrastructureMod("sodium"));
        assertTrue(AttestationProtocol.isInfrastructureMod("fabric-command-api-v2"));
    }

    @Test
    void sessionsRejectReplayExpireOnceAndBoundInvalidAttempts() {
        ClientAttestationSessions sessions = new ClientAttestationSessions(target -> {
            for (int index = 0; index < target.length; index++) target[index] = (byte) (index + 1);
        });
        ClientModPolicy policy = new ClientModPolicy(
                true, true, false, 3, ClientModPolicy.Enforcement.REPORT, Set.of(), Set.of());
        java.util.UUID player = java.util.UUID.randomUUID();
        ClientAttestationSessions.ChallengeRequest challenge = sessions.begin(player, true, policy, 1_000L);
        byte[] nonce = AttestationProtocol.decodeChallenge(challenge.payload()).nonce();
        byte[] report = AttestationProtocol.encodeReport(nonce, "1", List.of(
                new AttestationProtocol.ModEntry("safe", "1")));

        ClientAttestationSessions.Outcome accepted = sessions.receive(player, report, policy, 2_000L);
        assertNotNull(accepted);
        assertTrue(accepted.terminal());
        assertEquals(ClientAttestationSessions.State.REPORTED_ADVISORY, accepted.state());
        assertNull(sessions.receive(player, report, policy, 2_001L), "accepted report cannot be replayed");

        java.util.UUID missing = java.util.UUID.randomUUID();
        sessions.begin(missing, false, policy, 5_000L);
        List<ClientAttestationSessions.Outcome> expired = sessions.expire(policy, 8_000L);
        assertEquals(1, expired.size());
        assertEquals(ClientAttestationSessions.State.UNAVAILABLE, expired.getFirst().state());
        assertTrue(expired.getFirst().decision().violatesPolicy());
        assertTrue(sessions.expire(policy, 9_000L).isEmpty(), "deadline emits once");

        java.util.UUID invalid = java.util.UUID.randomUUID();
        sessions.begin(invalid, true, policy, 10_000L);
        assertFalse(sessions.receive(invalid, new byte[] {1}, policy, 10_100L).terminal());
        assertFalse(sessions.receive(invalid, new byte[] {1}, policy, 10_200L).terminal());
        ClientAttestationSessions.Outcome rejected = sessions.receive(
                invalid, new byte[] {1}, policy, 10_300L);
        assertTrue(rejected.terminal());
        assertEquals(ClientAttestationSessions.State.INVALID, rejected.state());
    }
}
