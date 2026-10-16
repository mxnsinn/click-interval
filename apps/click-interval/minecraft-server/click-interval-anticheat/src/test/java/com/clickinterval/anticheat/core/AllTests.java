package com.clickinterval.anticheat.core;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class AllTests {
    private int assertions;

    public static void main(String[] args) throws Exception {
        AllTests tests = new AllTests();
        tests.rateWindowExpiresOldSamples();
        tests.violationActionsDecayAndEscalate();
        tests.disabledResponseStillCollectsEvidenceWithoutActions();
        tests.offenseStateSurvivesReload();
        tests.eventFormatIsParseableAndComplete();
        tests.eventLoggerIsBoundedAndPrioritizesActions();
        tests.offenseStoreBoundsAndPrunesRecords();
        tests.violationEngineBoundsStateAndRejectsNonFiniteWeight();
        tests.compatibilityExemptionsArePlayerAndCheckScoped();
        tests.declaredModPolicyIsAdvisoryAndDeterministic();
        tests.modDeclarationParserIsStrictAndBounded();
        tests.protectionMessagesAreConfigurableAndSafe();
        tests.accessRolesAreScopedAndCommandSafe();
        tests.combatEvidenceIsBoundedAndConservative();
        tests.combatPatternEvidenceRequiresRepeatedServerVisibleSignals();
        tests.behaviorPatternsRequireRepeatedAuthoritativeEvidence();
        tests.visibilityMitigationUsesFailOpenHysteresis();
        tests.bukkitResponseCancellationIsExplicitAndConsistent();
        tests.speedThresholdRequiresServerCollisionSupport();
        tests.decimalGraceSecondsPreservePrecision();
        tests.repeatedChatRequiresThreeConsecutiveRecentMessages();
        tests.flightEvidenceRejectsSpoofedGroundAndSustainedFlight();
        tests.flightEvidencePreservesNaturalMovementAndServerSupport();
        tests.spectateRecoveryIsBoundedDeterministicAndExact();
        System.out.println("PASS ServerProtection pure logic tests (" + tests.assertions + " assertions)");
    }

    private void behaviorPatternsRequireRepeatedAuthoritativeEvidence() {
        BehaviorPatternAnalyzer movement = new BehaviorPatternAnalyzer();
        int flags = 0;
        for (int sample = 0; sample < 5; sample++) {
            flags = movement.observeMovement(1_000L + sample * 50L, -0.02, 0.08, true, false,
                    false, false, false, false, 0.6, 0.20, 5, 7, 2, 7);
        }
        check((flags & BehaviorPatternAnalyzer.GROUND_SPOOF) != 0,
                "ground spoof needs the full repeated sample gate");

        movement.reset();
        for (int sample = 0; sample < 6; sample++) {
            flags = movement.observeMovement(2_000L + sample * 50L, 0.0, 0.12, false, false,
                    true, false, false, false, 0.6, 0.20, 5, 7, 2, 7);
            check((flags & BehaviorPatternAnalyzer.WATER_WALK) == 0,
                    "one short liquid run stays below the evidence gate");
        }
        flags = movement.observeMovement(2_300L, 0.0, 0.12, false, false,
                true, false, false, false, 0.6, 0.20, 5, 7, 2, 7);
        check((flags & BehaviorPatternAnalyzer.WATER_WALK) != 0,
                "water walk requires repeated stable surface movement");

        BehaviorPatternAnalyzer timer = new BehaviorPatternAnalyzer();
        long now = 1_000L;
        flags = 0;
        for (int window = 0; window < 3; window++) {
            for (int packet = 0; packet < 30; packet++) {
                timer.observeMovementPacket(now + packet * 20L, 28, 3, false);
            }
            now += 1_000L;
            flags = timer.observeMovementPacket(now, 28, 3, false);
        }
        check((flags & BehaviorPatternAnalyzer.TIMER) != 0,
                "timer needs several complete over-limit windows");

        BehaviorPatternAnalyzer world = new BehaviorPatternAnalyzer();
        for (int sample = 0; sample < 5; sample++) {
            flags = world.observeBreak(5_000L + sample * 40L, sample, 64, 0,
                    6, 300, 3.5);
            check((flags & BehaviorPatternAnalyzer.MULTI_BREAK) == 0,
                    "multi-break does not accuse a partial burst");
        }
        flags = world.observeBreak(5_200L, 5, 64, 0, 6, 300, 3.5);
        check((flags & BehaviorPatternAnalyzer.MULTI_BREAK) != 0,
                "multi-break needs both count and spatial span");

        world.reset();
        for (int sample = 0; sample < 12; sample++) {
            flags = world.observeBreak(10_000L + sample * 20L, sample * 0.1, 64, 0,
                    6, 300, 3.5);
            check((flags & BehaviorPatternAnalyzer.MULTI_BREAK) == 0,
                    "dense legitimate breaks do not satisfy the spatial span");
        }
    }

    private void spectateRecoveryIsBoundedDeterministicAndExact() throws Exception {
        Path folder = Files.createTempDirectory("player-view-recovery-test-");
        Path file = folder.resolve("recovery.state");
        UUID viewer = UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID target = UUID.fromString("00000000-0000-0000-0000-000000000001");
        SpectateRecoveryStore.Origin origin = new SpectateRecoveryStore.Origin(
                viewer, "Viewer_1", target, "Target_1", "minecraft:the_nether",
                12.25, 64.0, -8.5, 181.5f, -22.25f, "creative");
        try {
            SpectateRecoveryStore store = new SpectateRecoveryStore(file);
            store.save(List.of(origin));
            Map<UUID, SpectateRecoveryStore.Origin> restored = store.load();
            equal(1, restored.size(), "one recovered camera session");
            equal(origin, restored.get(viewer), "exact camera origin survives reload");
            String first = Files.readString(file);
            store.save(restored.values());
            equal(first, Files.readString(file), "camera recovery serialization is deterministic");

            SpectateRecoveryStore.Origin retargeted = origin.withTarget(UUID.randomUUID(), "Target_2");
            equal(origin.worldId(), retargeted.worldId(), "retargeting preserves original dimension");
            equal(origin.x(), retargeted.x(), "retargeting preserves original coordinates");

            Files.writeString(file, "server-player-view-recovery-v1\ninvalid\n");
            boolean rejected = false;
            try {
                store.load();
            } catch (java.io.IOException expected) {
                rejected = true;
            }
            check(rejected, "malformed camera recovery state is rejected");
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(folder);
        }
    }

    private void rateWindowExpiresOldSamples() {
        RateWindow window = new RateWindow(4);
        equal(1, window.addAndCount(1_000L, 1_000L), "first event");
        equal(2, window.addAndCount(1_250L, 1_000L), "second event");
        equal(2, window.addAndCount(2_100L, 1_000L), "expired first sample");
        window.addAndCount(2_200L, 1_000L);
        window.addAndCount(2_300L, 1_000L);
        equal(4, window.addAndCount(2_400L, 1_000L), "bounded capacity");
        equal(1, window.addAndCount(5_000L, 1_000L), "fully expired window");
    }

    private void violationActionsDecayAndEscalate() {
        MutableClock clock = new MutableClock();
        ViolationEngine engine = new ViolationEngine(clock);
        ViolationPolicy policy = new ViolationPolicy(4.0, 8.0, 2, 3, 30, 4, 168, 1.0, 1_000L);
        UUID player = UUID.randomUUID();

        equal(EnforcementAction.NONE, engine.report(player, "movement.speed", 3.0, 0, policy).action(), "under alert");
        equal(EnforcementAction.ALERT, engine.report(player, "movement.speed", 1.5, 0, policy).action(), "alert threshold");
        clock.advance(1_100L);
        equal(EnforcementAction.NONE, engine.report(player, "movement.speed", 1.0, 0, policy).action(), "decay and alert hysteresis");
        clock.advance(1_100L);
        ViolationDecision firstOffense = engine.report(player, "movement.speed", 5.0, 0, policy);
        equal(EnforcementAction.ALERT, firstOffense.action(), "first kick-level offense alerts");
        check(firstOffense.countsAsOffense(), "kick-level alert counts as offense");

        clock.advance(1_100L);
        equal(EnforcementAction.KICK,
                engine.report(player, "movement.speed", 1.2, 1, policy).action(), "configured kick offense");

        UUID repeat = UUID.randomUUID();
        ViolationDecision temp = engine.report(repeat, "combat.reach", 9.0, 2, policy);
        equal(EnforcementAction.TEMP_BAN, temp.action(), "repeat temp ban");
        equal(1_800, temp.durationSeconds(), "temporary duration");
        UUID chronic = UUID.randomUUID();
        equal(EnforcementAction.PERMANENT_BAN,
                engine.report(chronic, "world.fastBreak", 9.0, 3, policy).action(), "chronic permanent ban");
        engine.forgive(chronic);
        equal(0.0, engine.score(chronic, "world.fastBreak", policy), "forgive clears score");
    }

    private void disabledResponseStillCollectsEvidenceWithoutActions() {
        MutableClock clock = new MutableClock();
        ViolationEngine engine = new ViolationEngine(clock);
        ViolationPolicy policy = new ViolationPolicy(4.0, 8.0, 1, 3, 30, 7, 168, 0.0, 0L);
        UUID player = UUID.randomUUID();
        ViolationDecision decision = engine.report(player, "combat.reach", 20.0, 6, policy, false);
        equal(EnforcementAction.NONE, decision.action(), "response disabled suppresses enforcement");
        check(!decision.countsAsOffense(), "response disabled does not advance escalation");
        equal(20.0, engine.score(player, "combat.reach", policy), "response disabled still collects evidence");
    }

    private void offenseStateSurvivesReload() throws Exception {
        Path folder = Files.createTempDirectory("ciac-offense-test-");
        Path file = folder.resolve("offenses.properties");
        MutableClock clock = new MutableClock();
        UUID player = UUID.randomUUID();
        try {
            OffenseStore first = new OffenseStore(file, clock);
            first.observe(player, "Alex", "combat.reach", "test detection");
            first.punish(player, EnforcementAction.TEMP_BAN, 90, true);
            first.saveIfDirty();

            OffenseStore restored = new OffenseStore(file, clock);
            restored.load();
            OffenseRecord record = restored.get(player);
            check(record != null, "restored record");
            equal("Alex", record.name(), "restored name");
            equal(1, record.detections(), "restored detections");
            equal(1, record.offenseCount(), "restored offense count");
            check(record.temporaryBanUntil() > clock.nowMillis(), "restored temporary ban");

            UUID inactive = UUID.randomUUID();
            restored.observe(inactive, "Steve", "world.fastPlace", "test detection");
            restored.punish(inactive, EnforcementAction.KICK, 0, true);
            clock.advance(8L * 24L * 60L * 60L * 1000L);
            equal(0, restored.priorOffenseCount(inactive, 7L * 24L * 60L * 60L * 1000L),
                    "inactive non-permanent offenses decay");
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(folder);
        }
    }

    private void eventFormatIsParseableAndComplete() throws Exception {
        Path folder = Files.createTempDirectory("ciac-event-test-");
        Path file = folder.resolve("events.jsonl");
        List<String> console = new ArrayList<>();
        UUID player = UUID.randomUUID();
        try (EventLogger logger = new EventLogger(file, console::add)) {
            logger.event("A\"lex", player, "combat.reach", "combat", EnforcementAction.KICK,
                    "Reach was high", 18.25, 2, 0, Map.of("observed", "4.20"));
        }
        try {
            equal(1, console.size(), "one console event");
            String line = console.get(0);
            check(line.startsWith(EventLogger.PREFIX + "{"), "stable event prefix");
            check(line.contains("\"player\":\"A\\\"lex\""), "escaped player");
            check(line.contains("\"check\":\"combat.reach\""), "check field");
            check(line.contains("\"action\":\"kick\""), "action field");
            check(line.contains("\"offenseCount\":2"), "offense field");
            check(Files.readString(file).contains("\"durationSeconds\":0"), "durable event history");
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(folder);
        }
    }

    private void eventLoggerIsBoundedAndPrioritizesActions() throws Exception {
        Path folder = Files.createTempDirectory("server-protection-event-bounds-");
        Path file = folder.resolve("events.jsonl");
        List<String> console = new ArrayList<>();
        UUID player = UUID.randomUUID();
        EventLogger logger = new EventLogger(file, console::add, 512, 64 * 1024L, 1, 2);
        String largeReason = "R".repeat(2_000);
        String largeDetail = "D".repeat(2_000);
        try {
            for (int index = 0; index < 10_000; index++) {
                logger.event("Alex", player, "movement.speed", "movement", EnforcementAction.NONE,
                        largeReason, index, 0, 0,
                        Map.of("detail", largeDetail, "index", index));
                check(logger.pendingEventCount() <= 512, "history queue stays bounded during a detection burst");
            }
            logger.event("Alex", player, "movement.speed", "movement", EnforcementAction.KICK,
                    "Action event", 20, 1, 0, Map.of());
        } finally {
            logger.close();
        }
        long eventConsoleLines = console.stream().filter(line -> line.startsWith(EventLogger.PREFIX)).count();
        check(eventConsoleLines <= 3, "repetitive console events are globally rate limited");
        check(console.stream().anyMatch(line -> line.contains("\"action\":\"kick\"")),
                "enforcement event bypasses the repetitive console limit");
        check(console.stream().anyMatch(line -> line.contains("Suppressed")),
                "console suppression is summarized");
        check(logger.pendingEventCount() == 0, "close drains queued history events");
        check(logger.droppedEventCount() > 0, "a sustained burst drops work instead of growing memory");
        equal(0L, logger.writeFailureCount(), "bounded burst logging completes without writer failures");
        check(Files.size(file) <= 64 * 1024L, "active history file stays inside its byte bound");
        Path archive = folder.resolve("events.jsonl.1");
        check(Files.isRegularFile(archive), "history rotates into a bounded archive");
        check(Files.size(archive) <= 64 * 1024L, "rotated history stays inside its byte bound");
        String retained = Files.readString(file) + Files.readString(archive);
        check(!retained.contains("D".repeat(300)), "event detail values are truncated");
        for (String sample : List.of("ASCII", "café", "漢字", "🚀", "x\ud800y")) {
            equal(sample.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,
                    EventLogger.utf8Length(sample), "allocation-free UTF-8 sizing matches the JDK encoder");
        }
        Files.deleteIfExists(file);
        Files.deleteIfExists(archive);
        Files.deleteIfExists(folder);
    }

    private void offenseStoreBoundsAndPrunesRecords() throws Exception {
        Path folder = Files.createTempDirectory("server-protection-offense-bounds-");
        Path file = folder.resolve("offenses.properties");
        MutableClock clock = new MutableClock();
        OffenseStore store = new OffenseStore(file, clock, 16, 256 * 1024L);
        List<UUID> players = new ArrayList<>();
        try {
            for (int index = 0; index < 25_000; index++) {
                UUID player = UUID.randomUUID();
                players.add(player);
                store.observe(player, "Player" + index, "combat.reach", "bounded history");
                clock.advance(1L);
            }
            equal(16, store.size(), "offense state is capped");
            check(store.get(players.getFirst()) == null, "oldest low-priority offense state is evicted");
            check(store.findByName("Player24999") != null, "bounded name lookup finds retained records without sorting");
            List<OffenseRecord> recent = store.recent(5);
            equal(5, recent.size(), "recent offense query keeps only its requested working set");
            equal("Player24999", recent.getFirst().name(), "recent offense query remains newest-first");
            UUID boundedPlayer = players.getLast();
            OffenseRecord bounded = store.observe(boundedPlayer, "N".repeat(200), "C".repeat(200), "R".repeat(2_000));
            equal(64, bounded.name().length(), "stored player names are bounded");
            equal(96, bounded.lastCheck().length(), "stored check names are bounded");
            equal(512, bounded.lastReason().length(), "stored reasons are bounded");
            store.saveIfDirty();
            check(Files.size(file) < 256 * 1024L, "bounded offense file stays under its safety limit");
            clock.advance(OffenseStore.DEFAULT_RETENTION_MILLIS + 1L);
            equal(16, store.pruneInactive(OffenseStore.DEFAULT_RETENTION_MILLIS),
                    "inactive unbanned records are pruned");
            equal(0, store.size(), "pruning releases retained offense state");
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(file.resolveSibling(file.getFileName() + ".tmp"));
            Files.deleteIfExists(folder);
        }
    }

    private void violationEngineBoundsStateAndRejectsNonFiniteWeight() {
        MutableClock clock = new MutableClock();
        ViolationEngine engine = new ViolationEngine(clock, 16);
        ViolationPolicy policy = ViolationPolicy.balanced();
        List<UUID> players = new ArrayList<>();
        for (int index = 0; index < 40; index++) {
            UUID player = UUID.randomUUID();
            players.add(player);
            engine.report(player, "movement.speed", 1.0, 0, policy);
            clock.advance(1L);
        }
        equal(16, engine.size(), "violation accumulator is capped");
        equal(0.0, engine.score(players.getFirst(), "movement.speed", policy),
                "oldest violation state is evicted at capacity");
        UUID invalid = UUID.randomUUID();
        engine.report(invalid, "movement.speed", Double.NaN, 0, policy);
        equal(0.0, engine.score(invalid, "movement.speed", policy),
                "non-finite violation weight cannot poison accumulator state");

        ViolationPolicy zeroCooldown = new ViolationPolicy(4, 8, 2, 3, 30, 4, 168, 0, 0);
        UUID noisy = UUID.randomUUID();
        equal(EnforcementAction.ALERT, engine.report(noisy, "combat.reach", 9, 0, zeroCooldown).action(),
                "first high-confidence action is emitted");
        equal(EnforcementAction.NONE, engine.report(noisy, "combat.reach", 9, 0, zeroCooldown).action(),
                "hard safety floor prevents same-instant action spam");
    }

    private void compatibilityExemptionsArePlayerAndCheckScoped() {
        UUID owner = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        CompatibilityPolicy policy = new CompatibilityPolicy(
                Map.of(
                        owner.toString(), List.of("combat.autoClicker", "not.a.check"),
                        "builder", List.of("abuse.inventorySpam"),
                        "wildcard", List.of("*")),
                Map.of("clickinterval.compat.mouse", List.of("abuse.inventorySpam")),
                CompatibilityPolicy.ModPolicy.disabled());

        check(policy.isCheckExempt(owner, "Owner", ignored -> false, "combat.autoClicker"),
                "UUID-scoped auto-clicker exemption");
        check(!policy.isCheckExempt(owner, "Owner", ignored -> false, "combat.reach"),
                "other check remains enabled for exempt player");
        check(!policy.isCheckExempt(other, "Other", ignored -> false, "combat.autoClicker"),
                "other player remains protected");
        CompatibilityPolicy granular = new CompatibilityPolicy(
                Map.of(owner.toString(), List.of("movement.invalidPosition", "movement.noSlow",
                        "combat.wallHit", "combat.multiTarget", "world.scaffold")),
                Map.of(), CompatibilityPolicy.ModPolicy.disabled());
        check(granular.isCheckExempt(owner, "Owner", ignored -> false, "movement.invalidPosition"),
                "invalid-position compatibility exception is recognized");
        check(granular.isCheckExempt(owner, "Owner", ignored -> false, "combat.wallHit"),
                "wall-hit compatibility exception is recognized");
        check(granular.isCheckExempt(owner, "Owner", ignored -> false, "combat.multiTarget"),
                "multi-target compatibility exception is recognized");
        check(granular.isCheckExempt(owner, "Owner", ignored -> false, "movement.noSlow"),
                "new movement compatibility exception is recognized");
        check(granular.isCheckExempt(owner, "Owner", ignored -> false, "world.scaffold"),
                "new world compatibility exception is recognized");
        check(policy.isCheckExempt(other, "Builder", ignored -> false, "abuse.inventorySpam"),
                "case-insensitive name fallback");
        check(policy.isCheckExempt(other, "Other", permission -> permission.equals("clickinterval.compat.mouse"),
                        "abuse.inventorySpam"),
                "server permission grants exact check");
        equal(Set.of("abuse.inventorySpam"),
                policy.exemptionForPlayer(other, "Other", permission -> permission.equals("clickinterval.compat.mouse")),
                "permission exemptions can be resolved once for hot-path caching");
        check(!policy.isCheckExempt(other, "Wildcard", ignored -> false, "movement.speed"),
                "wildcard cannot disable every check");

        Map<String, List<String>> manyRules = new java.util.LinkedHashMap<>();
        for (int index = 0; index < CompatibilityPolicy.MAX_RULES + 100; index++) {
            manyRules.put("player" + index, List.of("combat.reach"));
        }
        CompatibilityPolicy bounded = new CompatibilityPolicy(manyRules, Map.of(), CompatibilityPolicy.ModPolicy.disabled());
        equal(CompatibilityPolicy.MAX_RULES, bounded.playerExemptChecks().size(),
                "compatibility rule count is bounded");
    }

    private void declaredModPolicyIsAdvisoryAndDeterministic() {
        CompatibilityPolicy.ModPolicy policy = new CompatibilityPolicy.ModPolicy(
                true, false, true, 8, CompatibilityPolicy.ModEnforcement.KICK,
                Set.of("mousetweaks", "sodium"), Set.of("example_cheat"));
        equal(CompatibilityPolicy.ModDecisionType.ALLOW,
                policy.evaluate(false, Set.of()).type(), "missing optional declaration is allowed");
        CompatibilityPolicy.ModDecision blocked = policy.evaluate(true, Set.of("sodium", "example_cheat"));
        equal(CompatibilityPolicy.ModDecisionType.BLOCKED_MOD, blocked.type(), "blocked declaration wins");
        equal("example_cheat", blocked.modId(), "blocked mod is identified");
        equal(CompatibilityPolicy.ModDecisionType.NOT_ALLOWED,
                policy.evaluate(true, Set.of("unknown_mod")).type(), "unlisted declared mod is reported");
        equal(CompatibilityPolicy.ModDecisionType.ALLOW,
                policy.evaluate(true, Set.of("MouseTweaks", "sodium")).type(), "allowed IDs are normalized");

        CompatibilityPolicy.ModPolicy required = new CompatibilityPolicy.ModPolicy(
                true, true, false, 1, CompatibilityPolicy.ModEnforcement.REPORT, Set.of(), Set.of());
        equal(3, required.declarationGraceSeconds(), "declaration grace has safe minimum");
        equal(CompatibilityPolicy.ModDecisionType.MISSING_DECLARATION,
                required.evaluate(false, Set.of()).type(), "required missing declaration is reported");
    }

    private void modDeclarationParserIsStrictAndBounded() {
        check(ModDeclaration.isSupportedChannel("serverprotection:mods"), "neutral declaration channel is accepted");
        check(ModDeclaration.isSupportedChannel("clickinterval:mods"), "legacy declaration channel remains compatible");
        Set<String> parsed = ModDeclaration.parse((ModDeclaration.HEADER
                + "\nMouseTweaks@2.26.1\nsodium\nmousetweaks\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        equal(Set.of("mousetweaks", "sodium"), parsed, "declaration parses, normalizes, and deduplicates");
        equal(Set.of("sodium"), ModDeclaration.parse((ModDeclaration.LEGACY_HEADER + "\nsodium\n")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "previous declaration header remains compatible during migration");
        throwsIllegalArgument(() -> ModDeclaration.parse("wrong\nsodium".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "protocol header is required");
        throwsIllegalArgument(() -> ModDeclaration.parse((ModDeclaration.HEADER + "\nbad id")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "invalid mod ID is rejected");
        throwsIllegalArgument(() -> ModDeclaration.parse(new byte[ModDeclaration.MAX_BYTES + 1]),
                "oversized declaration is rejected");
    }

    private void protectionMessagesAreConfigurableAndSafe() {
        ProtectionMessages defaults = ProtectionMessages.defaults();
        String defaultWarning = defaults.warningFor("combat.reach").render(Map.of(
                "player", "Alex",
                "reason", "Attack was too far away"));
        check(defaultWarning.startsWith("§e"), "default warning color");
        check(defaultWarning.contains("Attack was too far away"), "warning placeholder is expanded");
        check(!defaultWarning.toLowerCase().contains("click interval"), "default warning is unbranded");

        ProtectionMessages custom = new ProtectionMessages(
                defaults.warning(), defaults.alert(), defaults.kick(), defaults.temporaryBan(),
                defaults.permanentBan(), defaults.loginTemporaryBan(), defaults.loginPermanentBan(),
                defaults.modPolicyKick(), defaults.banSource(),
                Map.of("combat.reach", new ProtectionMessages.StyledMessage(
                        "{player}: {reason} {unknown}", "#12abef")));
        String reach = custom.warningFor("COMBAT.REACH").render(Map.of(
                "player", "A§clex\n",
                "reason", "far &4away"));
        check(reach.startsWith("§x§1§2§a§b§e§f"), "hex warning color");
        check(reach.contains("Alex: far away"), "dynamic formatting and newlines are stripped");
        check(!reach.contains("{unknown}"), "unknown placeholder is removed");

        ProtectionMessages invalid = new ProtectionMessages(
                new ProtectionMessages.StyledMessage("", "not-a-color"),
                null, null, null, null, null, null, null, "", Map.of());
        equal(defaults.warning(), invalid.warning(), "blank text and invalid color use defaults");
        equal("Server protection", invalid.banSource(), "blank ban source uses default");
        check(ProtectionMessages.render(
                new ProtectionMessages.StyledMessage("{reason}", "red"),
                Map.of("reason", "x".repeat(900))).length() <= ProtectionMessages.MAX_MESSAGE_LENGTH,
                "rendered messages are bounded");
    }

    private void accessRolesAreScopedAndCommandSafe() {
        AccessPolicy.Assignment owner = new AccessPolicy.Assignment(
                "Owner", AccessPolicy.Role.OWNER, Set.of("server"), Set.of("stop"));
        AccessPolicy.Assignment admin = new AccessPolicy.Assignment(
                "Moderator", AccessPolicy.Role.ADMIN, Set.of("moderation"), Set.of("say"));
        AccessPolicy.Assignment member = new AccessPolicy.Assignment(
                "Builder", AccessPolicy.Role.MEMBER, Set.of("server"), Set.of("stop"));
        AccessPolicy policy = new AccessPolicy(List.of(owner, admin, member));

        check(policy.canRun(owner, "/minecraft:stop"), "owner can run any command");
        check(policy.canRun(admin, "/kick Griefer"), "admin group allows its command roots");
        check(policy.canRun(admin, "/minecraft:ban Griefer"), "safe Minecraft namespace is normalized");
        check(policy.canRun(admin, "/bukkit:ban Griefer"), "safe Bukkit namespace is normalized");
        check(!policy.canRun(admin, "/untrusted:ban Griefer"), "arbitrary namespace cannot borrow an allowed root");
        check(policy.canRun(admin, "/say hello"), "custom root is allowed");
        check(!policy.canRun(admin, "/stop"), "admin cannot run unassigned server commands");
        check(!policy.canRun(admin, "/execute run stop"), "nested command bypass is denied");
        check(!policy.canRun(member, "/kick Griefer"), "member receives no administrative commands");
        check(policy.canRun(null, "/tpa Friend"), "roleless players can request teleports");
        check(policy.canRun(null, "/tpaccept"), "roleless players can accept teleport requests");
        check(policy.canRun(null, "/msg Friend hello"), "roleless players can send private messages");
        check(policy.canRun(null, "/whisper Friend hello"), "roleless players can use a registered whisper alias");
        for (AccessPolicy.Assignment assignment : java.util.Arrays.asList(null, member, admin)) {
            check(policy.canRun(assignment, "/bounties"), "all ordinary roles can view funded bounties");
            check(policy.canRun(assignment, "/setbounty Friend"), "all ordinary roles can fund a bounty");
            check(!policy.canRun(assignment, "/set admin"), "bounties never grant unrelated set subcommands");
            for (String command : List.of("market", "auctionhouse", "ah", "enchants",
                    "enchants toggle miner", "serverenchantments toggle harvester")) {
                check(policy.canRun(assignment, command), "ordinary roles can use self-service command: " + command);
            }
            for (String command : List.of("enchant Builder unbreaking 3", "give Builder diamond",
                    "untrusted:enchants", "execute run enchants")) {
                check(!policy.canRun(assignment, command), "self-service commands do not grant: " + command);
            }
        }
        check(!policy.canRun(null, "/stop"), "roleless players cannot run administrative commands");
        check(policy.allowedCommands(member).containsAll(AccessPolicy.DEFAULT_PLAYER_COMMANDS),
                "member permission attachments include every default basic-player command");
        check(policy.enforcesPrivilegedRoles(), "owner or admin assignment enables managed operator access");
        check(policy.allowedCommands(admin).containsAll(Set.of("kick", "ban", "say")),
                "permission attachment roots include grouped and custom commands");
        AccessPolicy.Assignment namespaced = new AccessPolicy.Assignment(
                "ScopedAdmin", AccessPolicy.Role.ADMIN, Set.of(), Set.of("example:manage", "minecraft:say"));
        AccessPolicy namespacedPolicy = new AccessPolicy(List.of(namespaced));
        check(namespacedPolicy.canRun(namespaced, "/example:manage target"),
                "explicit custom namespace is preserved and allowed");
        check(!namespacedPolicy.canRun(namespaced, "/other:manage target"),
                "a different custom namespace remains denied");
        equal(Set.of("example:manage", "say"), namespaced.commands(),
                "custom namespaces persist while safe namespaces normalize");
        equal(AccessPolicy.Role.ADMIN, policy.assignmentFor("moderator").orElseThrow().role(),
                "player matching is case insensitive");
        throwsIllegalArgument(() -> new AccessPolicy(List.of(owner, new AccessPolicy.Assignment(
                "OtherOwner", AccessPolicy.Role.OWNER, Set.of(), Set.of()))), "only one owner is accepted");
        throwsIllegalArgument(() -> new AccessPolicy.Assignment(
                "Bad Name", AccessPolicy.Role.ADMIN, Set.of(), Set.of()), "unsafe player names are rejected");
        throwsIllegalArgument(() -> new AccessPolicy.Assignment(
                "Admin", AccessPolicy.Role.ADMIN, Set.of(), Set.of("execute run stop")),
                "custom commands cannot include arguments");

        AccessPolicy.RoleDefinition builderRole = new AccessPolicy.RoleDefinition(
                "trusted-builder",
                Set.of(AccessPolicy.PLAYER_SPECTATE, AccessPolicy.PLAYER_COORDINATES,
                        AccessPolicy.PLAYER_DIMENSION, AccessPolicy.TRADE_REROLL,
                        AccessPolicy.ENTITY_LABELS, AccessPolicy.ENTITY_INSPECT,
                        AccessPolicy.ENTITY_EDIT, AccessPolicy.SERVER_STOP,
                        AccessPolicy.SERVER_RESTART, AccessPolicy.PROTECTION_MANAGE),
                new AccessPolicy.CommandPolicy(
                        AccessPolicy.CommandMode.ALLOWLIST,
                        Set.of("world", "players"),
                        Set.of("minecraft:say", "example:inspect", "stop"),
                        Set.of("stop", "weather")));
        AccessPolicy.RoleDefinition operatorRole = new AccessPolicy.RoleDefinition(
                "operator-lite",
                Set.of(),
                new AccessPolicy.CommandPolicy(
                        AccessPolicy.CommandMode.ALL, Set.of(), Set.of(), Set.of("stop", "reload")));
        UUID builderId = UUID.fromString("d9428888-122b-11e1-b85c-61cd3cbb3210");
        AccessPolicy.Assignment builder = new AccessPolicy.Assignment(
                "RoleBuilder", builderId.toString(), "trusted-builder");
        AccessPolicy.Assignment operator = new AccessPolicy.Assignment(
                "RoleOperator", "", "operator-lite");
        AccessPolicy.Assignment forcedOwner = new AccessPolicy.Assignment("RootOwner", "", "owner");
        AccessPolicy v2 = new AccessPolicy(List.of(
                new AccessPolicy.RoleDefinition("owner", Set.of(),
                        new AccessPolicy.CommandPolicy(AccessPolicy.CommandMode.ALLOWLIST,
                                Set.of(), Set.of(), Set.of("stop"))),
                builderRole, operatorRole), List.of(builder, operator, forcedOwner));
        check(v2.hasCapability(builder, AccessPolicy.PLAYER_SPECTATE),
                "custom role grants player-view capability");
        check(v2.hasCapability(builder, AccessPolicy.PROTECTION_MANAGE),
                "custom role grants protection-management capability");
        check(!v2.hasCapability(builder, AccessPolicy.PROTECTION_BYPASS),
                "capabilities remain independently scoped");
        check(v2.hasCapability(builder, AccessPolicy.PLAYER_COORDINATES),
                "custom role grants coordinate lookup independently");
        check(v2.hasCapability(builder, AccessPolicy.PLAYER_DIMENSION),
                "custom role grants dimension lookup independently");
        check(v2.hasCapability(builder, AccessPolicy.ENTITY_EDIT),
                "manager-emitted entity capability is accepted by the runtime schema");
        check(v2.canRun(builder, "/tpa Friend"),
                "players command group grants teleport requests");
        check(v2.canRun(builder, "/time set day"), "custom role expands command groups");
        check(!v2.canRun(builder, "/weather clear"), "explicit deny wins over a command group");
        check(!v2.canRun(builder, "/stop"), "explicit deny wins over an explicit allow");
        check(v2.canRun(builder, "/restart"), "restart capability grants its command root");
        check(v2.canRun(builder, "/protect status"),
                "protection-management capability grants the protection command");
        check(v2.canRun(builder, "/ci-spectate Friend"),
                "player-view capability grants the non-conflicting spectate alias");
        check(v2.canRun(builder, "/ci-unspectate"),
                "player-view capability grants the matching return alias");
        check(!v2.canRun(builder, "/spectate Friend"),
                "player-view capability does not take over Minecraft's vanilla spectate root");
        check(v2.canRun(builder, "/view coordinate Friend"),
                "coordinate or dimension lookup capability grants the shared view root");
        check(v2.canRun(builder, "/entityadmin"),
                "entity inspection or editing grants the entity administration help root");
        check(v2.allowedCommands(builder).containsAll(Set.of(
                        "ci-spectate", "ci-unspectate", "unspectate", "view", "entityadmin")),
                "finite permission grants include capability-owned command roots");
        check(v2.canRun(builder, "/example:inspect target"),
                "custom role retains explicitly allowed plugin namespace");
        check(v2.canRun(operator, "/give RoleOperator stone"), "all mode grants unspecified roots");
        check(!v2.canRun(operator, "/minecraft:stop"), "all mode still honors deny roots");
        check(!v2.canRun(operator, "/execute run stop"),
                "a deny list blocks immediate delegated command execution");
        check(!v2.canRun(operator, "/function helpers:stop_server"),
                "a deny list blocks data-pack function delegation");
        check(!v2.canRun(operator, "/schedule function helpers:stop_server 1t"),
                "a deny list blocks scheduled command delegation");
        check(!v2.canRun(operator, "/debug function helpers:stop_server"),
                "a deny list blocks debug-function delegation");
        check(!v2.allowedCommands(operator).contains("execute"),
                "delegation roots are omitted from finite permission grants when denies exist");
        check(v2.hasCapability(forcedOwner, AccessPolicy.PROTECTION_BYPASS),
                "owner bypass cannot be removed by stale configuration");
        check(v2.canRun(forcedOwner, "/stop"), "owner command authority cannot be denied");
        equal("RoleBuilder", v2.assignmentFor("wrong-name", builderId).orElseThrow().player(),
                "UUID assignment lookup takes precedence over player name");
        check(v2.assignmentFor("RoleBuilder", UUID.randomUUID()).isEmpty(),
                "a UUID-bound role cannot be inherited by a different identity with the same name");
        equal(AccessPolicy.Role.ADMIN, v2.compatibilityRole(builder),
                "capability-bearing custom role projects to legacy admin");

        AccessPolicy.RoleDefinition deniedViewerRole = new AccessPolicy.RoleDefinition(
                "denied-viewer", Set.of(AccessPolicy.PLAYER_SPECTATE),
                new AccessPolicy.CommandPolicy(AccessPolicy.CommandMode.ALLOWLIST,
                        Set.of(), Set.of(), Set.of("spectate")));
        AccessPolicy.Assignment deniedViewer = new AccessPolicy.Assignment(
                "DeniedViewer", "", "denied-viewer");
        AccessPolicy deniedViewerPolicy = new AccessPolicy(List.of(deniedViewerRole), List.of(deniedViewer));
        check(!deniedViewerPolicy.canRun(deniedViewer, "/ci-spectate Friend"),
                "a legacy spectate deny remains authoritative for the replacement alias");
        check(!deniedViewerPolicy.allowedCommands(deniedViewer).contains("ci-spectate"),
                "a denied player-view alias is not granted through Bukkit permissions");
        throwsIllegalArgument(() -> new AccessPolicy.RoleDefinition(
                "bad-role", Set.of("unknown.capability"),
                new AccessPolicy.CommandPolicy(AccessPolicy.CommandMode.ALLOWLIST,
                        Set.of(), Set.of(), Set.of())), "unknown capabilities fail closed");
        throwsIllegalArgument(() -> new AccessPolicy.RoleDefinition(
                "bad-group", Set.of(),
                new AccessPolicy.CommandPolicy(AccessPolicy.CommandMode.ALLOWLIST,
                        Set.of("unknown"), Set.of(), Set.of())), "unknown command groups fail closed");
        throwsIllegalArgument(() -> new AccessPolicy(
                List.of(builderRole), List.of(new AccessPolicy.Assignment("NoRole", "", "missing"))),
                "unknown assignment role fails closed");

        List<AccessPolicy.Assignment> tooMany = new ArrayList<>();
        for (int index = 0; index <= AccessPolicy.MAX_ASSIGNMENTS; index++) {
            tooMany.add(new AccessPolicy.Assignment("P" + index, AccessPolicy.Role.MEMBER, Set.of(), Set.of()));
        }
        throwsIllegalArgument(() -> new AccessPolicy(tooMany), "player access assignments are bounded");
    }

    private void combatEvidenceIsBoundedAndConservative() {
        CombatEvidence evidence = new CombatEvidence();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        UUID third = UUID.randomUUID();
        equal(1, evidence.rememberTarget(first, 1_000L, 250L), "first combat target");
        equal(1, evidence.rememberTarget(first, 1_050L, 250L), "duplicate target is counted once");
        equal(2, evidence.rememberTarget(second, 1_100L, 250L), "second distinct target");
        equal(3, evidence.rememberTarget(third, 1_150L, 250L), "third distinct target");
        equal(1, evidence.rememberTarget(first, 2_000L, 250L), "stale target samples expire");

        check(!evidence.observeWallHit(first, false, 2.0, 3_000L, 2, 750L),
                "one blocked hit is not enough");
        check(evidence.observeWallHit(first, false, 2.0, 3_200L, 2, 750L),
                "repeated same-target blocked hits report");
        check(!evidence.observeWallHit(first, false, 2.0, 4_000L, 2, 750L),
                "new wall sequence starts with one sample");
        check(!evidence.observeWallHit(second, false, 2.0, 4_100L, 2, 750L),
                "switching targets resets wall evidence");
        check(!evidence.observeWallHit(second, true, 2.0, 4_150L, 2, 750L),
                "visible target clears wall evidence");
        check(!evidence.observeWallHit(second, false, 1.0, 4_200L, 2, 750L),
                "very near block-edge hit is not wall evidence");
    }

    private void combatPatternEvidenceRequiresRepeatedServerVisibleSignals() {
        CombatPatternAnalyzer analyzer = new CombatPatternAnalyzer();
        CombatPatternAnalyzer.Settings settings = new CombatPatternAnalyzer.Settings(
                50, 3, 1_000, 120, 80, 2, 1_000, 10, 1.0);
        UUID first = UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID second = UUID.fromString("00000000-0000-0000-0000-000000000002");
        CombatPatternAnalyzer.Box ahead = new CombatPatternAnalyzer.Box(-0.3, -0.9, 2.7, 0.3, 0.9, 3.3);
        CombatPatternAnalyzer.Box behind = new CombatPatternAnalyzer.Box(-0.3, -0.9, -3.3, 0.3, 0.9, -2.7);
        CombatPatternAnalyzer.Point eye = new CombatPatternAnalyzer.Point(0, 0, 0);
        CombatPatternAnalyzer.Point right = new CombatPatternAnalyzer.Point(1, 0, 0);
        CombatPatternAnalyzer.Point forward = new CombatPatternAnalyzer.Point(0, 0, 1);
        check(!analyzer.observe(new CombatPatternAnalyzer.Observation(first, 0, eye, right, ahead), settings)
                .has(CombatPatternAnalyzer.AIM_DIRECTION), "one stale rotation packet is tolerated");
        check(!analyzer.observe(new CombatPatternAnalyzer.Observation(first, 100, eye, right, ahead), settings)
                .has(CombatPatternAnalyzer.AIM_DIRECTION), "two stale rotation packets are tolerated");
        check(analyzer.observe(new CombatPatternAnalyzer.Observation(first, 200, eye, right, ahead), settings)
                .has(CombatPatternAnalyzer.AIM_DIRECTION), "repeated off-target attacks produce aim evidence");
        analyzer.reset();
        analyzer.observe(new CombatPatternAnalyzer.Observation(first, 0, eye, forward, ahead), settings);
        check(!analyzer.observe(new CombatPatternAnalyzer.Observation(second, 80, eye,
                        new CombatPatternAnalyzer.Point(0, 0, -1), behind), settings)
                .has(CombatPatternAnalyzer.RAPID_SWITCH), "one wide target switch is tolerated");
        check(analyzer.observe(new CombatPatternAnalyzer.Observation(first, 160, eye, forward, ahead), settings)
                .has(CombatPatternAnalyzer.RAPID_SWITCH), "repeated wide target switching produces evidence");
        analyzer.reset();
        boolean pattern = false;
        for (int index = 0; index < 12; index++) {
            pattern |= analyzer.observe(new CombatPatternAnalyzer.Observation(
                    first, index * 100L, eye, forward, ahead), settings)
                    .has(CombatPatternAnalyzer.CLICK_PATTERN);
        }
        check(pattern, "a long exact click interval sequence produces automation evidence");

        CombatPatternAnalyzer objectApi = new CombatPatternAnalyzer();
        CombatPatternAnalyzer primitiveApi = new CombatPatternAnalyzer();
        for (int index = 0; index < 32; index++) {
            long now = index * 83L;
            UUID target = (index & 1) == 0 ? first : second;
            CombatPatternAnalyzer.Box box = (index & 1) == 0 ? ahead : behind;
            CombatPatternAnalyzer.Point view = (index & 1) == 0
                    ? forward : new CombatPatternAnalyzer.Point(0, 0, -1);
            CombatPatternAnalyzer.Result expected = objectApi.observe(
                    new CombatPatternAnalyzer.Observation(target, now, eye, view, box), settings);
            CombatPatternAnalyzer.Result actual = primitiveApi.observe(
                    target, now,
                    eye.x(), eye.y(), eye.z(), view.x(), view.y(), view.z(),
                    box.minX(), box.minY(), box.minZ(), box.maxX(), box.maxY(), box.maxZ(), settings);
            equal(expected, actual, "primitive combat hot path matches the object API");
        }
    }

    private void visibilityMitigationUsesFailOpenHysteresis() {
        VisibilityEvidence evidence = new VisibilityEvidence();
        equal(VisibilityEvidence.Action.NONE, evidence.observe(true, false, 3, 2, 1_000L),
                "first blocked visibility sample stays visible");
        equal(VisibilityEvidence.Action.NONE, evidence.observe(true, false, 3, 2, 1_100L),
                "second blocked visibility sample stays visible");
        equal(VisibilityEvidence.Action.HIDE, evidence.observe(true, false, 3, 2, 1_200L),
                "configured blocked sample threshold hides");
        check(evidence.hidden(), "visibility state records plugin-owned hide");
        equal(VisibilityEvidence.Action.NONE, evidence.observe(false, false, 3, 2, 1_300L),
                "one visible sample does not flicker a hidden target");
        equal(VisibilityEvidence.Action.SHOW, evidence.observe(false, false, 3, 2, 1_400L),
                "visible hysteresis reveals the target");
        evidence.observe(true, false, 2, 1, 2_000L);
        evidence.observe(true, false, 2, 1, 2_100L);
        equal(VisibilityEvidence.Action.SHOW, evidence.failOpen(2_200L),
                "errors and low TPS reveal instead of preserving hidden state");
        check(!evidence.hidden(), "fail-open state remains visible");
    }

    private void bukkitResponseCancellationIsExplicitAndConsistent() {
        check(!ProtectionRuntimePolicy.shouldCancelDetectedAction(false, true),
                "rate violation stays non-blocking when automatic response is disabled");
        check(!ProtectionRuntimePolicy.shouldCancelDetectedAction(true, false),
                "an action without a detection is never blocked");
        check(ProtectionRuntimePolicy.shouldCancelDetectedAction(true, true),
                "rate violation is blocked when automatic response is enabled");
        check(!ProtectionRuntimePolicy.shouldCancelSpatialAttack(false, true, true),
                "spatial detections stay non-blocking when automatic response is disabled");
        check(ProtectionRuntimePolicy.shouldCancelSpatialAttack(true, true, false),
                "confirmed reach is blocked when automatic response is enabled");
        check(ProtectionRuntimePolicy.shouldCancelSpatialAttack(true, false, true),
                "confirmed wall hit has the same cancellation behavior as reach");
        check(!ProtectionRuntimePolicy.shouldCancelSpatialAttack(true, false, false),
                "unconfirmed spatial attacks remain untouched");
    }

    private void speedThresholdRequiresServerCollisionSupport() {
        equal(0.78, ProtectionRuntimePolicy.horizontalMovementLimit(true, 0.78, 0.92),
                "server collision support selects the configured ground limit");
        equal(0.92, ProtectionRuntimePolicy.horizontalMovementLimit(false, 0.78, 0.92),
                "unsupported movement selects the air limit even if a client claims ground");
        equal(1.25, ProtectionRuntimePolicy.horizontalMovementLimit(false, 2.50, 1.25),
                "unsupported movement cannot select a looser custom ground limit");
    }

    private void decimalGraceSecondsPreservePrecision() {
        equal(2_500L, ProtectionRuntimePolicy.boundedSecondsToMillis(2.5, 4.0, 2.0, 30.0),
                "join grace preserves half seconds");
        equal(3_500L, ProtectionRuntimePolicy.boundedSecondsToMillis(3.5, 3.0, 2.0, 30.0),
                "teleport grace preserves half seconds");
        equal(1_500L, ProtectionRuntimePolicy.boundedSecondsToMillis(1.5, 2.0, 1.0, 15.0),
                "velocity grace preserves half seconds");
        equal(4_000L, ProtectionRuntimePolicy.boundedSecondsToMillis(
                        Double.NaN, 4.0, 2.0, 30.0),
                "non-finite grace uses its safe fallback");
        equal(30_000L, ProtectionRuntimePolicy.boundedSecondsToMillis(90.0, 4.0, 2.0, 30.0),
                "grace values are capped at the supported maximum");
    }

    private void repeatedChatRequiresThreeConsecutiveRecentMessages() {
        RepeatedMessageGate gate = new RepeatedMessageGate();
        check(!gate.observeNormalized("hello world", 1_000L),
                "the first normalized message starts evidence");
        check(!gate.observeNormalized("hello world", 1_100L),
                "the second identical message is not a violation");
        check(gate.observeNormalized("hello world", 1_200L),
                "the third consecutive identical message inside five seconds is repeated");
        check(gate.observeNormalized("hello world", 1_300L),
                "continued identical spam remains repeated");
        check(!gate.observeNormalized("different", 1_400L),
                "a different message resets the consecutive evidence");
        check(!gate.observeNormalized("hello world", 1_500L),
                "returning to an earlier message starts a new sequence");
        check(!gate.observeNormalized("hello world", 6_501L),
                "a gap beyond five seconds expires the repeated sequence");
        check(!gate.observeNormalized("hello world", 6_600L),
                "the second message after expiry is still allowed");
        check(gate.observeNormalized("hello world", 6_700L),
                "the third message after expiry is detected");
        check(!gate.observeNormalized("hello world", 6_000L),
                "clock rollback fails safe and resets repeated evidence");
        gate.reset();
        check(!gate.observeNormalized("hello world", 7_000L),
                "reset clears repeated evidence");
        check(!gate.observeNormalized("", 7_100L),
                "an empty normalized message cannot become repeated evidence");
        check(!gate.observeNormalized("", 7_200L),
                "consecutive empty messages remain ignored");
    }

    private void flightEvidenceRejectsSpoofedGroundAndSustainedFlight() {
        FlightEvidence upward = new FlightEvidence();
        FlightEvidence.Assessment result = FlightEvidence.Assessment.NONE;
        for (int tick = 0; tick < 8; tick++) {
            result = upward.observe(new FlightEvidence.Sample(0.31, 1, true, false, false), 80);
        }
        check(result.report(), "constant upward flight reports after bounded evidence");
        equal(FlightEvidence.Motion.ASCENT, result.motion(), "upward flight is classified");
        check(result.unsupportedGroundClaim(), "client ground claim is recorded but not trusted");

        FlightEvidence hover = new FlightEvidence();
        for (int tick = 0; tick < 80; tick++) {
            check(!hover.observe(new FlightEvidence.Sample(0.0, 1, false, false, false), 80).report(),
                    "hover remains below configured evidence threshold");
        }
        FlightEvidence.Assessment hovered = hover.observe(
                new FlightEvidence.Sample(0.0, 1, false, false, false), 80);
        check(hovered.report(), "sustained unsupported hover reports");
        equal(FlightEvidence.Motion.HOVER, hovered.motion(), "hover is classified");

        FlightEvidence descending = new FlightEvidence();
        for (int tick = 0; tick < 7; tick++) {
            check(!descending.observe(
                    new FlightEvidence.Sample(-0.20, 1, false, false, false), 80).report(),
                    "controlled descent waits for bounded evidence");
        }
        check(descending.observe(new FlightEvidence.Sample(-0.20, 1, false, false, false), 80).report(),
                "sustained controlled descent reports");
    }

    private void flightEvidencePreservesNaturalMovementAndServerSupport() {
        FlightEvidence jump = new FlightEvidence();
        double[] naturalJumpAndFall = {
                0.42, 0.33, 0.25, 0.16, 0.08, 0.0, -0.08, -0.16, -0.24, -0.32,
                -0.40, -0.48, -0.56, -0.64, -0.72, -0.80, -0.88, -0.96, -1.04, -1.12
        };
        for (double delta : naturalJumpAndFall) {
            check(!jump.observe(new FlightEvidence.Sample(delta, 1, false, false, false), 80).report(),
                    "gravity-driven jump and fall does not report");
        }
        double fallingVelocity = -1.12;
        for (int tick = 0; tick < 160; tick++) {
            fallingVelocity = Math.max(-3.92, fallingVelocity - 0.08);
            check(!jump.observe(new FlightEvidence.Sample(fallingVelocity, 1, false, false, false), 80).report(),
                    "long natural and terminal-velocity fall does not report");
        }

        FlightEvidence knockback = new FlightEvidence();
        for (int tick = 0; tick < 20; tick++) {
            check(!knockback.observe(new FlightEvidence.Sample(0.35, 1, false, false, true), 80).report(),
                    "velocity and effect grace resets flight evidence");
        }

        FlightEvidence ledge = new FlightEvidence();
        for (int tick = 0; tick < 100; tick++) {
            check(!ledge.observe(new FlightEvidence.Sample(0.0, 1, false, true, false), 80).report(),
                    "server collision support preserves slabs, stairs and ledges");
        }
        check(!ledge.observe(new FlightEvidence.Sample(0.30, 1, true, false, false), 80).report(),
                "one unsupported sample after support starts fresh evidence");
    }

    private void throwsIllegalArgument(Runnable action, String message) {
        assertions++;
        try {
            action.run();
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError(message);
    }

    private void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    private void equal(Object expected, Object actual, String message) {
        assertions++;
        if (!expected.equals(actual)) {
            throw new AssertionError(message + ": expected " + expected + ", got " + actual);
        }
    }

    private static final class MutableClock implements Clock {
        private long now = 1_000_000L;

        @Override
        public long nowMillis() {
            return now;
        }

        void advance(long millis) {
            now += millis;
        }
    }
}
