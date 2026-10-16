package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.ProtectionMessages;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class ProtectionConfigTest {
    @Test
    void parsesEverySupportedCheckAndIgnoresUnknownFields() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                unknown:
                  field: harmless
                checks:
                  movement:
                    speed: false
                    flight: false
                    phase: true
                    invalidPosition: false
                    groundSpoof: false
                    waterWalk: false
                    step: false
                    timer: false
                    noSlow: true
                  combat:
                    reach: false
                    wallHit: false
                    autoClicker: false
                    multiTarget: false
                    criticals: true
                  world:
                    fastBreak: false
                    fastPlace: false
                    scaffold: true
                    multiBreak: true
                  abuse:
                    chatSpam: false
                    commandSpam: false
                    inventorySpam: false
                limits:
                  combat:
                    maxReach: 4.25
                  world:
                    maxBreaksPerSecond: 25
                    maxPlacesPerSecond: 24
                  abuse:
                    maxChatPerFiveSeconds: 7
                    maxCommandsPerFiveSeconds: 12
                    maxInventoryClicksPerSecond: 42
                    inventoryEvidenceSamples: 4
                    inventorySampleIntervalMillis: 300
                    inventoryEvidenceWindowMillis: 1800
                    maxInventoryBurstPacketsPerSecond: 140
                    inventoryViolationCooldownMillis: 4500
                grace:
                  joinSeconds: 2.5
                  teleportSeconds: 3.5
                  velocitySeconds: 1.5
                detection:
                  antiXray:
                    enabled: true
                    requiredConcealedSamples: 4
                    windowSeconds: 90
                """);
        assertFalse(config.checks().speed());
        assertFalse(config.checks().flight());
        assertTrue(config.checks().phase());
        assertFalse(config.checks().invalidPosition());
        assertFalse(config.checks().groundSpoof());
        assertFalse(config.checks().waterWalk());
        assertFalse(config.checks().step());
        assertFalse(config.checks().timer());
        assertTrue(config.checks().noSlow());
        assertFalse(config.checks().reach());
        assertFalse(config.checks().wallHit());
        assertFalse(config.checks().autoClicker());
        assertFalse(config.checks().multiTarget());
        assertTrue(config.checks().criticals());
        assertFalse(config.checks().fastBreak());
        assertFalse(config.checks().fastPlace());
        assertTrue(config.checks().scaffold());
        assertTrue(config.checks().multiBreak());
        assertFalse(config.checks().chatSpam());
        assertFalse(config.checks().commandSpam());
        assertFalse(config.checks().inventorySpam());
        assertEquals(4.25, config.combat().maxReach(), 0.0001);
        assertEquals(25, config.world().maxBreaksPerSecond());
        assertEquals(24, config.world().maxPlacesPerSecond());
        assertEquals(7, config.abuse().maxChatPerFiveSeconds());
        assertEquals(12, config.abuse().maxCommandsPerFiveSeconds());
        assertEquals(42, config.abuse().maxInventoryClicksPerSecond());
        assertEquals(4, config.abuse().inventoryEvidenceSamples());
        assertEquals(300, config.abuse().inventorySampleIntervalMillis());
        assertEquals(1_800, config.abuse().inventoryEvidenceWindowMillis());
        assertEquals(140, config.abuse().maxInventoryBurstPacketsPerSecond());
        assertEquals(4_500, config.abuse().inventoryViolationCooldownMillis());
        assertEquals(2.5, config.grace().joinSeconds());
        assertEquals(3.5, config.grace().teleportSeconds());
        assertEquals(1.5, config.grace().velocitySeconds());
        assertEquals(2_500L, ServerProtectionFabric.secondsToMillis(config.grace().joinSeconds()));
        assertTrue(config.hiddenOreDetection().enabled());
        assertEquals(4, config.hiddenOreDetection().requiredSamples());
        assertEquals(90_000L, config.hiddenOreDetection().windowMillis());
    }

    @Test
    void supportedCheckDeclarationIsExactAndStable() {
        assertEquals(List.of(
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
                "abuse.inventorySpam"), List.of(ServerProtectionFabric.SUPPORTED_CHECKS));
    }

    @Test
    void clampsUnsafeThresholdsAndRejectsOversizedInput() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                minimum-tps: -100
                limits:
                  movement:
                    maxGroundBlocksPerTick: 999
                    maxAirTicks: 999999
                  combat:
                    maxCps: -1
                    multiTargetCount: 500
                    maxReach: 200
                  world:
                    maxBreaksPerSecond: 999
                  abuse:
                    maxCommandsPerFiveSeconds: 999
                    maxInventoryClicksPerSecond: -1
                    inventoryEvidenceSamples: 999
                    inventorySampleIntervalMillis: -1
                    inventoryEvidenceWindowMillis: -1
                    maxInventoryBurstPacketsPerSecond: -1
                    inventoryViolationCooldownMillis: 999999
                """);
        assertEquals(10.0, config.minimumTps());
        assertEquals(5.0, config.movement().maxGroundBlocksPerTick());
        assertEquals(1_200, config.movement().maxAirTicks());
        assertEquals(5, config.combat().maxCps());
        assertEquals(16, config.combat().multiTargetCount());
        assertEquals(8.0, config.combat().maxReach());
        assertEquals(100, config.world().maxBreaksPerSecond());
        assertEquals(200, config.abuse().maxCommandsPerFiveSeconds());
        assertEquals(1, config.abuse().maxInventoryClicksPerSecond());
        assertEquals(8, config.abuse().inventoryEvidenceSamples());
        assertEquals(100, config.abuse().inventorySampleIntervalMillis());
        assertEquals(700, config.abuse().inventoryEvidenceWindowMillis());
        assertEquals(20, config.abuse().maxInventoryBurstPacketsPerSecond());
        assertEquals(30_000, config.abuse().inventoryViolationCooldownMillis());
        assertThrows(IOException.class, () -> ProtectionConfig.parse("x: " + "a".repeat(300_000)));
    }

    @Test
    void parsesVisibilityExemptionsAndManagedMessages() throws Exception {
        ProtectionConfig config = ProtectionConfig.parse("""
                response:
                  preThresholdAction: log
                messages:
                  warningCooldownSeconds: 999
                  kick:
                    text: "Custom {player}: {reason}"
                    color: "#123456"
                  checks:
                    combat:
                      reach:
                        text: "Reach: {reason}"
                        color: red
                mitigations:
                  entityEsp:
                    enabled: true
                    nearRevealRadius: 40
                    maximumVisibleDistance: 20
                    maxPairsPerTick: 999
                exemptions:
                  owners: true
                  admins: true
                  players:
                    - Alice
                exempt-players:
                  - BOB
                  - not-a-player-name-that-is-too-long
                check-exemptions:
                  combat:
                    autoClicker: [BOB]
                  abuse:
                    inventorySpam:
                      - Alice
                      - 123e4567-e89b-12d3-a456-426614174000
                      - invalid player
                """);
        assertFalse(config.warnBeforeThreshold());
        assertEquals(300_000L, config.warningCooldownMillis());
        assertTrue(config.entityEsp().enabled());
        assertEquals(32.0, config.entityEsp().nearRevealRadius());
        assertEquals(36.0, config.entityEsp().maximumVisibleDistance());
        assertEquals(256, config.entityEsp().maxPairsPerTick());
        assertTrue(config.exemptions().owners());
        assertTrue(config.exemptions().admins());
        assertEquals(Set.of("alice", "bob"), config.exemptions().players());
        assertTrue(config.checkExemptions().contains(
                "abuse.inventorySpam", "Alice", "00000000-0000-4000-8000-000000000000"));
        assertTrue(config.checkExemptions().contains(
                "abuse.inventorySpam", "Someone", "123e4567-e89b-12d3-a456-426614174000"));
        assertFalse(config.checkExemptions().contains(
                "combat.reach", "Alice", "123e4567-e89b-12d3-a456-426614174000"));
        assertTrue(config.checkExemptions().contains(
                "combat.autoClicker", "bob", "00000000-0000-4000-8000-000000000000"));
        assertTrue(config.messages().kick().render(Map.of("player", "Test", "reason", "Reach"))
                .contains("Custom Test: Reach"));
        assertTrue(config.messages().warningFor("combat.reach")
                .render(Map.of("reason", "Too far")).contains("Reach: Too far"));
    }

    @Test
    void managedJsonQuotedMessagesRoundTripEscapesAndMoreThan256Characters() throws Exception {
        String longText = "A".repeat(600) + " {reason}";
        ProtectionConfig longConfig = ProtectionConfig.parse(
                "messages:\n  kick:\n    text: \"" + longText + "\"\n    color: red\n");
        assertEquals(longText, longConfig.messages().kick().text());
        assertEquals(512, longConfig.messages().kick().render(Map.of("reason", "done")).length());

        ProtectionConfig escaped = ProtectionConfig.parse(
                "messages:\n  kick:\n"
                        + "    text: \"He said \\\"hi\\\" at C:\\\\mods # kept: {reason}\" # ignored\n"
                        + "    color: red\n");
        assertTrue(escaped.messages().kick().render(Map.of("reason", "ok"))
                .contains("He said \"hi\" at C:\\mods # kept: ok"));

        ProtectionConfig malformed = ProtectionConfig.parse(
                "messages:\n  kick:\n    text: \"bad\\qescape\"\n");
        assertTrue(malformed.messages().kick().render(Map.of("reason", "fallback"))
                .contains("Removed for suspicious activity: fallback."));
    }

    @Test
    void enforcementMessagesReceiveEveryManagedPlaceholder() {
        Map<String, Object> values = ServerProtectionFabric.enforcementMessageValues(
                "Alex", "abuse.commandSpam", "Too many commands", "temp-ban", 12.75, 3, 90);
        assertEquals("Alex", values.get("player"));
        assertEquals("abuse.commandSpam", values.get("check"));
        assertEquals("Too many commands", values.get("reason"));
        assertEquals("temp-ban", values.get("action"));
        assertEquals("12.75", values.get("violations"));
        assertEquals(3, values.get("offenses"));
        assertEquals(90, values.get("duration_seconds"));
        assertEquals(1, values.get("duration_minutes"));
        String rendered = ProtectionMessages.render(new ProtectionMessages.StyledMessage(
                "{player}|{check}|{reason}|{action}|{violations}|{offenses}|"
                        + "{duration_seconds}|{duration_minutes}", "none"), values);
        assertEquals("Alex|abuse.commandSpam|Too many commands|temp-ban|12.75|3|90|1", rendered);
    }
}
