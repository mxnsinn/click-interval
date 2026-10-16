package dev.serverprotection.fabric;

import com.clickinterval.anticheat.core.AccessPolicy;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.ParseResults;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

final class FabricAccessPolicyTest {
    private static final UUID ALICE_UUID = UUID.fromString("12345678-1234-4234-8234-1234567890ab");

    @TempDir
    Path temporary;

    @Test
    void publicTeamsAreExactBaselineBranchesNotVanillaAdministration() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        for (String player : java.util.List.of("Unassigned", "Member", "Alice", "Builder", "Boss")) {
            UUID uuid = player.equals("Alice") ? ALICE_UUID : null;
            for (String command : java.util.List.of("team", "team hub", "team settings", "create team",
                    "create team ABC Full Team Name", "teams", "teams help", "teams create ABC",
                    "create;team ABC", "team;invite Friend", "team;accept ABC", "team;decline ABC",
                    "team;leave", "team;disband ABC confirm", "teams kick Friend",
                    "tc hello friends", "ceasefire ABC XYZ", "ceasefire end ABC")) {
                assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                        policy.commandDecision(player, uuid, command), player + ": " + command);
            }
            assertTrue(policy.canSeeCommandRoot(player, uuid, "create", true));
            assertTrue(policy.canSeeCommandPath(player, uuid, "create team"));
            assertTrue(policy.canSeeCommandPath(player, uuid, "team settings"));
        }
        for (String player : java.util.List.of("Unassigned", "Member", "Alice")) {
            UUID uuid = player.equals("Alice") ? ALICE_UUID : null;
            for (String command : java.util.List.of("create", "create op", "team join Secret", "team modify Secret friendlyFire true",
                    "team leave Friend", "team add Secret", "team list", "unknown:team", "unknown:create team",
                    "team;op Friend", "create;op Friend", "minecraft:create;team ABC", "create teamwork ABC")) {
                assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                        policy.commandDecision(player, uuid, command), player + ": " + command);
                if (command.startsWith("team ") || command.startsWith("create ")) {
                    assertFalse(policy.canSeeCommandPath(player, uuid, command), player + ": " + command);
                }
            }
        }
    }

    @Test
    void teamSuggestionsAndExplicitDeniesStayScoped() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        for (String command : java.util.List.of("/create", "/create t", "/create team", "/team s", "/team h")) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                    policy.suggestionDecision("Unassigned", null, command), command);
        }
        for (String command : java.util.List.of("/create op", "/team join", "/team modify", "/team list")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    policy.suggestionDecision("Unassigned", null, command), command);
        }
        FabricAccessPolicy denied = load(v2Yaml().replace("- ban", "- team"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY, denied.commandDecision("Alice", ALICE_UUID, "team"));
        assertFalse(denied.canSeeCommandPath("Alice", ALICE_UUID, "team settings"));
        FabricAccessPolicy deniedCreate = load(v2Yaml().replace("- ban", "- create"));
        assertFalse(deniedCreate.canSeeCommandRoot("Alice", ALICE_UUID, "create", true));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY, deniedCreate.commandDecision("Alice", ALICE_UUID, "create;team ABC"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY, deniedCreate.commandDecision("Alice", ALICE_UUID, "teams create ABC"));
        FabricAccessPolicy deniedTeams = load(v2Yaml().replace("- ban", "- teams"));
        for(String command:java.util.List.of("teams help","create;team ABC","team;invite Friend","team;accept ABC")){
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,deniedTeams.commandDecision("Alice",ALICE_UUID,command));
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,denied.commandDecision("Alice",ALICE_UUID,command));
        }
        FabricAccessPolicy deniedAlias = load(v2Yaml().replace("- ban", "- team;invite"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,deniedAlias.commandDecision("Alice",ALICE_UUID,"team;invite Friend"));
        assertFalse(deniedAlias.canSeeCommandRoot("Alice",ALICE_UUID,"team;invite",true));
        Path bad = temporary.resolve("team-invalid.yml");
        Files.writeString(bad, "version: 999");
        assertThrows(IOException.class, () -> denied.load(bad));
        assertFalse(denied.canSeeCommandRoot("Unassigned", null, "create", true));
    }

    @Test
    void publicMarketAndRandomTpaDoNotGrantAdministrativeCommands() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        for (String command : java.util.List.of("market", "market mine", "market buy 1", "rtpa",
                "auctionhouse", "auctionhouse mine", "ah", "ah claim")) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                    policy.commandDecision("Unassigned", null, command), command);
        }
        assertTrue(policy.canSeeCommandRoot("Unassigned", null, "market", true));
        assertTrue(policy.canSeeCommandRoot("Unassigned", null, "rtpa", true));
        assertTrue(policy.canSeeCommandRoot("Unassigned", null, "auctionhouse", true));
        assertTrue(policy.canSeeCommandRoot("Unassigned", null, "ah", true));
        for (String command : java.util.List.of("op Friend", "give Unassigned diamond", "stop",
                "execute run market", "untrusted:market", "endlock off", "untrusted:ah")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    policy.commandDecision("Unassigned", null, command), command);
        }
    }

    @Test
    void enchantmentAndEconomyMenusRemainBaselineAcrossEveryRole() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        for (String player : java.util.List.of("Unassigned", "Member", "Alice", "Builder", "Boss")) {
            UUID uuid = player.equals("Alice") ? ALICE_UUID : null;
            for (String command : java.util.List.of("enchants", "enchants toggle miner", "enchants toggle tree",
                    "enchants toggle harvester", "serverenchantments", "serverenchantments toggle miner",
                    "market", "market mine", "auctionhouse", "auctionhouse mine", "ah", "ah claim")) {
                assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                        policy.commandDecision(player, uuid, command), player + ": " + command);
            }
            for (String root : AccessPolicy.PUBLIC_SELF_SERVICE_COMMANDS) {
                assertTrue(policy.canSeeCommandRoot(player, uuid, root, true), player + ": " + root);
                assertFalse(policy.canSeeCommandRoot(player, uuid, root, false),
                        "policy must never revive a node denied by its native requirement");
            }
        }
        for (String player : java.util.List.of("Unassigned", "Member")) {
            for (String command : java.util.List.of("enchant Friend unbreaking 3", "give Friend diamond",
                    "op Friend", "execute run enchants", "untrusted:enchants", "untrusted:serverenchantments",
                    "untrusted:market", "untrusted:ah")) {
                assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                        policy.commandDecision(player, null, command), player + ": " + command);
            }
        }
    }

    @Test
    void selfServiceMenusDoNotElevateEmptyCustomRolesOrOverrideDenies() throws Exception {
        FabricAccessPolicy emptyRole = load(v2Yaml().replace("mode: all\n", "mode: allowlist\n"));
        assertEquals(FabricAccessPolicy.CommandTreeMode.RESTRICTED, emptyRole.commandTreeMode("Builder", null));
        for (String root : AccessPolicy.PUBLIC_SELF_SERVICE_COMMANDS) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                    emptyRole.commandDecision("Builder", null, root), root);
        }
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                emptyRole.commandDecision("Builder", null, "enchant Builder unbreaking 3"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                emptyRole.commandDecision("Builder", null, "give Builder diamond"));
        for (String root : java.util.List.of("enchants", "serverenchantments", "market", "auctionhouse", "ah")) {
            FabricAccessPolicy explicitDeny = load(v2Yaml().replace("- ban", "- " + root));
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    explicitDeny.commandDecision("Alice", ALICE_UUID, root), root);
            assertFalse(explicitDeny.canSeeCommandRoot("Alice", ALICE_UUID, root, true), root);
        }
        Path bad = temporary.resolve("self-service-invalid.yml");
        Files.writeString(bad, "version: 999");
        assertThrows(IOException.class, () -> emptyRole.load(bad));
        for (String root : AccessPolicy.PUBLIC_SELF_SERVICE_COMMANDS) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    emptyRole.commandDecision("Unassigned", null, root), root);
        }
    }

    @Test
    void publicBountyMenusStayBaselineAcrossRolesWithoutLeakingOperatorRoots() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        for (String player : java.util.List.of("Unassigned", "Alice", "Builder")) {
            UUID uuid = player.equals("Alice") ? ALICE_UUID : null;
            for (String command : java.util.List.of("bounties", "bounties set", "setbounty", "setbounty Friend")) {
                assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                        policy.commandDecision(player, uuid, command), player + ": " + command);
            }
            assertTrue(policy.canSeeCommandRoot(player, uuid, "bounties", true));
            assertTrue(policy.canSeeCommandRoot(player, uuid, "setbounty", true));
        }
        for (String command : java.util.List.of("set bounty", "set admin", "give Unassigned diamond",
                "execute run give Unassigned diamond", "untrusted:bounties")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    policy.commandDecision("Unassigned", null, command), command);
        }
        CommandDispatcher<String> dispatcher = new CommandDispatcher<>();
        for (String root : java.util.List.of("bounties", "setbounty", "set", "give", "execute", "op")) {
            dispatcher.register(LiteralArgumentBuilder.<String>literal(root).executes(context -> 1));
        }
        var filtered = CommandTreePruner.copy(dispatcher.getRoot(), "source",
                root -> policy.canSeeCommandRoot("Unassigned", null, root, true));
        assertEquals(java.util.Set.of("bounties", "setbounty"), filtered.getChildren().stream()
                .map(com.mojang.brigadier.tree.CommandNode::getName).collect(java.util.stream.Collectors.toSet()));
    }

    @Test
    void explicitBountyDenyAndMalformedPolicyRemainFailClosed() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml().replace("- ban", "- bounties"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", ALICE_UUID, "bounties"));
        assertFalse(policy.canSeeCommandRoot("Alice", ALICE_UUID, "bounties", true));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("Alice", ALICE_UUID, "setbounty"));
        Path bad = temporary.resolve("bounty-invalid.yml");
        Files.writeString(bad, "version: 999");
        assertThrows(IOException.class, () -> policy.load(bad));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Unassigned", null, "bounties"));
    }

    @Test
    void unprivilegedCustomRoleGetsBountyMenusWithoutChangingTreeAuthority() throws Exception {
        // Builder has no capabilities, command groups or explicit grants in this variant.
        FabricAccessPolicy policy = load(v2Yaml().replace("mode: all\n", "mode: allowlist\n"));
        assertEquals(FabricAccessPolicy.CommandTreeMode.RESTRICTED, policy.commandTreeMode("Builder", null));
        for (String root : java.util.List.of("bounties", "setbounty")) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE, policy.commandDecision("Builder", null, root));
            assertTrue(policy.canSeeCommandRoot("Builder", null, root, true));
        }
        for (String root : java.util.List.of("give", "op", "execute", "set")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY, policy.commandDecision("Builder", null, root));
            assertFalse(policy.canSeeCommandRoot("Builder", null, root, true));
        }
    }

    @Test
    void readsV2RolesCapabilitiesGroupsAndDenyPrecedence() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());

        assertEquals(4, policy.size());
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PLAYER_SPECTATE));
        assertTrue(policy.canUsePlayerView("Alice", ALICE_UUID, "ci-unspectate"));
        assertFalse(policy.canUsePlayerView("Alice", ALICE_UUID, "ci-spectate"),
                "the legacy spectate deny must hide and block the replacement start command");
        assertFalse(policy.canSeeCommandRoot("Alice", ALICE_UUID, "ci-spectate", true));
        assertTrue(policy.canSeeCommandRoot("Alice", ALICE_UUID, "ci-unspectate", true));
        assertTrue(policy.canSeeCommandRoot("Alice", ALICE_UUID, "unspectate", true));
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PLAYER_COORDINATES));
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PLAYER_DIMENSION));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "view coordinate Friend"));
        assertTrue(policy.canSeeCommandRoot("Alice", ALICE_UUID, "view", true));
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.SERVER_STOP));
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.SERVER_RESTART));
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PROTECTION_MANAGE));
        assertFalse(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PROTECTION_BYPASS));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "/kick Griefer"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "minecraft:give Alice stone"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "protect reload"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "anticheat disable Friend"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "stop"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "restart"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", ALICE_UUID, "ci-spectate Friend"),
                "the legacy spectate deny must also block the replacement alias");
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Alice", ALICE_UUID, "ci-unspectate"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", ALICE_UUID, "ban Griefer"), "deny must beat a granted group");
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", ALICE_UUID, "weather clear"));
        assertTrue(policy.explicitlyDenies("Alice", ALICE_UUID, "spectate"));

        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Builder", null, "weather clear"), "all mode grants arbitrary roots");
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Builder", null, "stop"), "deny must beat all mode");
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Builder", null, "execute run stop"),
                "roles with denies cannot delegate to a denied command");
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Builder", null, "function tools:stop_server"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Builder", null, "schedule function tools:stop_server 1t"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Unassigned", null, "stop"), "roleless players cannot inherit native operator commands");
        for (String command : java.util.List.of(
                "tpa Friend", "tpaccept", "tpdeny", "tpacancel",
                "msg Friend hello", "tell Friend hello", "w Friend hello", "whisper Friend hello")) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                    policy.commandDecision("Unassigned", null, command), command);
        }
        for (String command : java.util.List.of(
                "gamemode creative", "give Unassigned stone", "help", "list", "say hello", "stop")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    policy.commandDecision("Unassigned", null, command), command);
        }
        assertEquals("§cNope.", policy.deniedMessage());
    }

    @Test
    void playerViewCapabilityAloneControlsAllPrivateCommandRoots() throws Exception {
        FabricAccessPolicy policy = load("""
                version: 2
                roles:
                  - id: owner
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: admin
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: observer
                    capabilities:
                      - player.spectate
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                assignments:
                  - player: Observer
                    roleId: observer
                  - player: Ordinary
                    roleId: member
                """);

        for (String root : java.util.List.of("ci-spectate", "ci-unspectate", "unspectate")) {
            assertTrue(policy.canSeeCommandRoot("Observer", null, root, true),
                    "the capability must expose " + root + " without a duplicate command allow-list entry");
            assertFalse(policy.canSeeCommandRoot("Ordinary", null, root, true),
                    "an ordinary role must never receive the private root " + root);
            assertFalse(policy.canSeeCommandRoot("Observer", null, root, false),
                    "the managed policy must not resurrect a root rejected by Brigadier");
        }
    }

    @Test
    void ownerAuthorityCannotBeRemovedByYaml() throws Exception {
        FabricAccessPolicy policy = load("""
                version: 2
                roles:
                  - id: owner
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny:
                        - stop
                  - id: admin
                    capabilities:
                      - player.spectate
                    commandPolicy:
                      mode: allowlist
                      groups:
                        - moderation
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                assignments:
                  - player: Boss
                    roleId: owner
                """);

        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.PLAYER_SPECTATE));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.PLAYER_COORDINATES));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.PLAYER_DIMENSION));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.SERVER_STOP));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.SERVER_RESTART));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.PROTECTION_MANAGE));
        assertTrue(policy.hasCapability("Boss", null, AccessPolicy.PROTECTION_BYPASS));
        assertEquals(AccessPolicy.Role.OWNER, policy.compatibilityRoleFor("Boss", null));
        assertTrue(policy.canUsePlayerView("Boss", null, "ci-spectate"));
        assertTrue(policy.canUsePlayerView("Boss", null, "ci-unspectate"));
        assertFalse(policy.canUsePlayerView("Boss", null, "spectate"),
                "the vanilla command must never be claimed as the private POV command");
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Boss", null, "stop"));
    }

    @Test
    void uuidBindingAllowsRenameButRejectsSameNameWithWrongUuid() throws Exception {
        FabricAccessPolicy policy = load(v2Yaml());
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("RenamedAlice", ALICE_UUID, "kick Griefer"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "kick Griefer"));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("Alice", UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "tpa Friend"));
        assertFalse(policy.hasCapability("Alice",
                UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), AccessPolicy.PLAYER_SPECTATE));
    }

    @Test
    void preservesV1RoleGroupAndCustomCommandCompatibility() throws Exception {
        FabricAccessPolicy policy = load("""
                version: 1
                assignments:
                  - player: Owner_Name
                    role: owner
                  - player: Admin2
                    role: admin
                    groups:
                      - moderation
                    commands:
                      - weather
                  - player: Member3
                    role: member
                """);

        assertEquals(AccessPolicy.Role.OWNER, policy.compatibilityRoleFor("OWNER_NAME", null));
        assertEquals(AccessPolicy.Role.ADMIN, policy.compatibilityRoleFor("admin2", null));
        assertTrue(policy.canUsePlayerView("Admin2", null, "ci-spectate"));
        assertEquals(AccessPolicy.Role.MEMBER, policy.compatibilityRoleFor("member3", null));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("Member3", null, "tpa Friend"));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("Member3", null, "w Friend hello"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Member3", null, "stop"));
        assertTrue(policy.hasCapability("Admin2", null, AccessPolicy.PLAYER_SPECTATE));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Admin2", null, "ban Somebody"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Admin2", null, "weather clear"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Admin2", null, "stop"));
        assertTrue(policy.canSeeCommandRoot("Admin2", null, "kick", true));
        assertTrue(policy.canSeeCommandRoot("Admin2", null, "ban", true));
        assertTrue(policy.canSeeCommandRoot("Admin2", null, "ci-spectate", true));
        assertFalse(policy.canSeeCommandRoot("Admin2", null, "gamemode", true));
        assertFalse(policy.canSeeCommandRoot("Admin2", null, "give", true));
        assertFalse(policy.canSeeCommandRoot("Admin2", null, "stop", true));
        assertFalse(policy.canSeeCommandRoot("Member3", null, "gamemode", true));
        assertFalse(policy.canSeeCommandRoot("Member3", null, "ci-spectate", true));
        assertFalse(policy.canSeeCommandRoot("Admin2", null, "kick", false),
                "tree filtering can never resurrect a node vanilla already rejected");
    }

    @Test
    void acceptsFullManagerShapeAndIgnoresAppearanceOnlyFields() throws Exception {
        FabricAccessPolicy policy = load("""
                # Managed by Server Manager. Change player access in the app.
                version: 2
                updatedAt: "2026-10-04T12:00:00.000Z"
                deniedMessage: "&cNo access # still text"
                roles:
                  - id: owner
                    capabilities:
                      - player.spectate
                      - protection.manage
                      - protection.bypass
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                  - id: admin
                    capabilities:
                      - player.spectate
                    commandPolicy:
                      mode: allowlist
                      groups:
                        - moderation
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: "helper"
                    name: "Helper"
                    builtIn: false
                    capabilities:
                      - "player.spectate"
                      - "player.coordinates"
                      - "player.dimension"
                      - "trade.reroll"
                      - "entity.labels"
                      - "entity.inspect"
                      - "entity.edit"
                      - "server.stop"
                      - "server.restart"
                      - "protection.manage"
                      - "protection.bypass"
                    commandPolicy:
                      mode: allowlist
                      groups:
                        - "players"
                      allow:
                        - "minecraft:time"
                      deny: []
                    appearance:
                      enabled: true
                      prefix: "§a[H]"
                      suffix: ""
                      color: green
                assignments:
                  - player: "HelperOne"
                    roleId: "helper"
                    role: admin
                    groups: []
                    commands: []
                """);

        assertEquals("§cNo access # still text", policy.deniedMessage());
        assertTrue(policy.hasCapability("HelperOne", null, AccessPolicy.PLAYER_SPECTATE));
        assertTrue(policy.hasCapability("HelperOne", null, AccessPolicy.ENTITY_EDIT));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("HelperOne", null, "time day"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("HelperOne", null, "tpa Friend"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("HelperOne", null, "entityadmin"));
    }

    @Test
    void malformedReloadFailsClosedInsteadOfRetainingPrivilege() throws Exception {
        Path file = temporary.resolve("access.yml");
        Files.writeString(file, v2Yaml());
        FabricAccessPolicy policy = new FabricAccessPolicy();
        policy.load(file);
        assertTrue(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PLAYER_SPECTATE));

        Files.writeString(file, """
                version: 2
                roles:
                  - id: broken
                    capabilities:
                      - system.root
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                assignments:
                  - player: Alice
                    roleId: broken
                """);
        assertThrows(IOException.class, () -> policy.load(file));
        assertEquals(0, policy.size());
        assertFalse(policy.hasCapability("Alice", ALICE_UUID, AccessPolicy.PLAYER_SPECTATE));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("Alice", ALICE_UUID, "stop"));
        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("PreviouslyUnassignedOp", null, "stop"),
                "an existing malformed policy must not restore vanilla operator authority");
    }

    @Test
    void missingPolicyKeepsVanillaCommandBehavior() throws Exception {
        FabricAccessPolicy policy = new FabricAccessPolicy();
        policy.load(temporary.resolve("does-not-exist.yml"));
        assertEquals(FabricAccessPolicy.CommandDecision.VANILLA,
                policy.commandDecision("Operator", null, "stop"));
        assertFalse(policy.enforcesPrivilegedRoles());
        assertEquals(FabricAccessPolicy.CommandTreeMode.VANILLA,
                policy.commandTreeMode("Operator", null));
    }

    @Test
    void existingPolicyMakesTheExactRolelessBaselineAuthoritativeEvenWithoutAssignments() throws Exception {
        FabricAccessPolicy policy = load("""
                version: 2
                roles:
                  - id: owner
                    capabilities: []
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                  - id: admin
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow:
                        - help
                      deny: []
                assignments: []
                """);

        for (String command : java.util.List.of(
                "tpa Friend", "tpaccept", "tpdeny", "tpacancel",
                "msg Friend hello", "tell Friend hello", "w Friend hello", "whisper Friend hello")) {
            assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                    policy.commandDecision("Roleless", null, command), command);
        }
        for (String command : java.util.List.of("help", "list", "say hello", "gamemode creative", "stop")) {
            assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                    policy.commandDecision("Roleless", null, command), command);
        }
        assertTrue(policy.enforcesPrivilegedRoles());
        assertEquals(FabricAccessPolicy.CommandTreeMode.RESTRICTED,
                policy.commandTreeMode("Roleless", null));
    }

    @Test
    void customAllAccessOwnerIsElevatedAndMakesUnassignedNativeOpsRestricted() throws Exception {
        FabricAccessPolicy policy = load("""
                version: 2
                roles:
                  - id: owner
                    capabilities: []
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                  - id: admin
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: owner-custom
                    capabilities:
                      - player.spectate
                      - player.coordinates
                      - player.dimension
                      - trade.reroll
                      - entity.labels
                      - entity.inspect
                      - entity.edit
                      - server.stop
                      - server.restart
                      - protection.manage
                      - protection.bypass
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                assignments:
                  - player: Mxnsinn
                    roleId: owner-custom
                """);

        assertTrue(policy.enforcesPrivilegedRoles());
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Mxnsinn", null, "gamemode creative"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Mxnsinn", null, "minecraft:give Mxnsinn stone"));
        assertEquals(FabricAccessPolicy.CommandDecision.ELEVATE,
                policy.commandDecision("Mxnsinn", null, "stop"));
        assertEquals(FabricAccessPolicy.CommandTreeMode.ELEVATED,
                policy.commandTreeMode("Mxnsinn", null));

        assertEquals(FabricAccessPolicy.CommandDecision.DENY,
                policy.commandDecision("StaleNativeOp", null, "stop"));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("StaleNativeOp", null, "tpaccept"));
        assertEquals(FabricAccessPolicy.CommandDecision.BASELINE,
                policy.commandDecision("StaleNativeOp", null, "tell Friend hello"));
        assertEquals(FabricAccessPolicy.CommandTreeMode.RESTRICTED,
                policy.commandTreeMode("StaleNativeOp", null),
                "roleless players keep zero permissions while policy pruning retains only baseline roots");
    }

    @Test
    void unassignedPlayersKeepPublicCommandsButManagedAdminCommandsFailClosed() {
        CommandDispatcher<String> dispatcher = new CommandDispatcher<>();
        dispatcher.register(LiteralArgumentBuilder.<String>literal("tpa").executes(context -> 1));
        dispatcher.register(LiteralArgumentBuilder.<String>literal("stop")
                .requires("all"::equals).executes(context -> 1));

        ParseResults<String> publicRestricted = dispatcher.parse("tpa", "none");
        ParseResults<String> adminRestricted = dispatcher.parse("stop", "none");
        ParseResults<String> adminElevated = dispatcher.parse("stop", "all");

        assertTrue(ServerProtectionFabric.isCompleteCommandParse(publicRestricted));
        assertFalse(ServerProtectionFabric.shouldDenyUnassignedManagedCommand(true, publicRestricted));
        assertFalse(ServerProtectionFabric.isCompleteCommandParse(adminRestricted));
        assertTrue(ServerProtectionFabric.isCompleteCommandParse(adminElevated));
        assertTrue(ServerProtectionFabric.shouldDenyUnassignedManagedCommand(true, adminRestricted));
        assertFalse(ServerProtectionFabric.shouldDenyUnassignedManagedCommand(false, adminRestricted));
    }

    @Test
    void rejectsUnknownReferencesDuplicatesAndBadIndentation() {
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("""
                version: 2
                roles: []
                assignments:
                  - player: Alice
                    roleId: missing
                """));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("""
                version: 2
                roles: []
                assignments:
                  - player: Alice
                    roleId: member
                  - player: alice
                    roleId: member
                """));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("version: 2\n roles: []\nassignments: []\n"));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("version: 2\nroles: []\nroles: []\nassignments: []\n"));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("version: 3\nroles: []\nassignments: []\n"));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse("version: 2\nroles: []\nassignments: []\n"),
                "v2 must explicitly contain every built-in role");
        String withoutAssignments = v2Yaml().substring(0, v2Yaml().indexOf("assignments:"));
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse(withoutAssignments),
                "v2 must contain an explicit assignments list, even when it is empty");
    }

    @Test
    void elevatedDispatcherRejectsControlCharactersAndOversizedInput() {
        assertTrue(ServerProtectionFabric.isSafeManagedCommand("kick Player reason"));
        assertFalse(ServerProtectionFabric.isSafeManagedCommand("kick Player\nstop"));
        assertFalse(ServerProtectionFabric.isSafeManagedCommand("kick\u0000Player"));
        assertFalse(ServerProtectionFabric.isSafeManagedCommand("x".repeat(2_049)));
    }

    @Test
    void rejectsUnboundedDocumentsInsteadOfPartiallyGrantingThem() {
        StringBuilder yaml = new StringBuilder("version: 1\nassignments:\n");
        for (int index = 0; index <= FabricAccessPolicy.MAX_ASSIGNMENTS; index++) {
            yaml.append("  - player: P").append(index).append("\n    role: admin\n");
        }
        assertThrows(IOException.class, () -> FabricAccessPolicy.parse(yaml.toString()));
        assertThrows(IOException.class,
                () -> FabricAccessPolicy.parse("assignments: []\n#" + "x".repeat(300_000)));
        assertThrows(IOException.class,
                () -> FabricAccessPolicy.parse("assignments: []\n#" + "x".repeat(2_049)));
    }

    private FabricAccessPolicy load(String yaml) throws Exception {
        Path file = temporary.resolve("access-" + Math.abs(yaml.hashCode()) + ".yml");
        Files.writeString(file, yaml);
        FabricAccessPolicy policy = new FabricAccessPolicy();
        policy.load(file);
        return policy;
    }

    private static String v2Yaml() {
        return """
                version: 2
                deniedMessage: "&cNope."
                roles:
                  - id: owner
                    capabilities:
                      - player.spectate
                      - protection.manage
                      - protection.bypass
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny: []
                  - id: admin
                    capabilities:
                      - player.spectate
                    commandPolicy:
                      mode: allowlist
                      groups:
                        - moderation
                      allow: []
                      deny: []
                  - id: member
                    capabilities: []
                    commandPolicy:
                      mode: allowlist
                      groups: []
                      allow: []
                      deny: []
                  - id: helper
                    capabilities:
                      - player.spectate
                      - player.coordinates
                      - player.dimension
                      - server.stop
                      - server.restart
                      - protection.manage
                    commandPolicy:
                      mode: allowlist
                      groups:
                        - moderation
                      allow:
                        - give
                      deny:
                        - ban
                        - spectate
                  - id: builder
                    capabilities: []
                    commandPolicy:
                      mode: all
                      groups: []
                      allow: []
                      deny:
                        - stop
                assignments:
                  - player: Alice
                    uuid: "12345678-1234-4234-8234-1234567890ab"
                    roleId: helper
                  - player: Builder
                    roleId: builder
                  - player: Boss
                    roleId: owner
                  - player: Member
                    roleId: member
                """;
    }
}
