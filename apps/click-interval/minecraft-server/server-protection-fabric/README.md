# Server Protection for Fabric

This is the server-only Fabric adapter for Server Protection. It is built and tested for one exact
runtime combination:

- Minecraft `26.3`
- Fabric Loader `0.19.5` or newer compatible `0.19.x`
- Fabric API `0.161.0+26.3` (distributed beside the protection mod)
- Java `25`
- Fabric Loom `1.17.21` for the build

Minecraft 26.3 is published as a Mojang-named, non-obfuscated development artifact. Loom rejects an
extra mappings dependency with `Cannot use Mojang mappings in a non-obfuscated environment`, so the
build intentionally does not add Yarn or `officialMojangMappings()` on top of 26.3.

The output is not standalone. Put both files from `dist` in the server's `mods` directory:

- `ServerProtection-Fabric-1.3.0+mc26.3.jar`
- `fabric-api-0.161.0+26.3.jar`

Do not install this build on 26.2 or any other Minecraft version. The mod descriptor requires exact
Minecraft 26.3 and runs only in the server environment. Protection checks remain server-only; the
camera-only player POV feature additionally requires Server Protection Companion 1.3.0 on the
viewing owner's/admin's client. Vanilla clients can still join. The shared source no longer
contains typing payloads, receivers, state or broadcast hooks. This removal is released as
1.4.4 for the 26.2 adapter; historical 26.3 artifacts are unchanged and have not been rebuilt.

## Implemented checks

These are the exact check IDs understood by this adapter. Every check has its own Boolean in
`config/server-protection/config.yml`.

| ID | Behavior |
| --- | --- |
| `movement.speed` | Requires consecutive horizontal-speed evidence and scales the limit for the player's movement-speed attribute. |
| `movement.flight` | Detects sustained unsupported air movement after join, teleport, velocity, vehicle, water, climb, effect, and low-TPS exemptions. |
| `movement.phase` | Detects repeated movement while intersecting solid collision. Disabled by default because custom blocks can need tuning. |
| `movement.invalidPosition` | Rejects non-finite and out-of-world position samples. |
| `movement.invalidRotation` | Rejects non-finite or impossible pitch values. |
| `movement.groundSpoof` | Requires repeated client ground claims without server collision support; this covers common no-fall ground spoofing. |
| `movement.waterWalk` | Requires repeated stable horizontal movement on a liquid surface while the player is not inside the liquid. |
| `movement.step` | Requires repeated climbs above the player's server step-height attribute. |
| `movement.timer` | Requires several complete one-second windows above the normal movement-packet rate. |
| `movement.noSlow` | Requires repeated full-speed movement while actively using a slowing item. Strict-only by default. |
| `combat.reach` | Measures eye-to-hitbox distance, reconciles target velocity, ping and TPS, and honors the player's actual entity-interaction-range attribute. Confirmed impossible hits are cancelled. |
| `combat.wallHit` | Requires repeated attacks without server line of sight. Confirmed occluded hits are cancelled. |
| `combat.autoClicker` | Scores attack packets over a fixed one-second timestamp window, including attempts vanilla rejects before applying damage. |
| `combat.multiTarget` | Scores too many distinct attacked entities inside a fixed short window. |
| `combat.aimDirection` | Requires repeated attacks while the server-visible view misses the expanded target hitbox. |
| `combat.killAura` | Requires repeated implausibly fast, wide-angle target switches. |
| `combat.clickPattern` | Detects only long sequences of near-identical attack intervals. |
| `combat.criticals` | Requires repeated server-supported micro-fall critical states. Strict-only by default. |
| `world.fastBreak` | Scores successful block breaks above the configured rolling one-second limit. A narrow list of sweep-harvest plants (including sugar cane, bamboo, crops, kelp, and vines) uses an independent 40/s floor, so normal harvesting cannot contaminate solid-block evidence while packet floods remain detectable. |
| `world.fastPlace` | Scores successful vanilla block-item placements above the configured rolling one-second limit. |
| `world.breakReach` | Scores successful breaks beyond the server interaction range plus a latency margin. |
| `world.placeReach` | Scores successful placements beyond the server interaction range plus a latency margin. |
| `world.scaffold` | Requires repeated beneath-player placements far outside the server-visible aim direction. Strict-only by default. |
| `world.multiBreak` | Requires a wide cluster of accepted breaks inside a very short window. Strict-only by default. |
| `abuse.chatSpam` | Blocks chat above the configured five-second limit and repeated normalized messages after three consecutive sends. |
| `abuse.commandSpam` | Gates every signed and unsigned player command immediately before server-side parsing/execution; console commands are not counted. |
| `abuse.inventorySpam` | Requires several time-separated over-limit samples before blocking sustained inventory traffic, while retaining an independent hard ceiling for immediate packet floods. |

## Selective mob griefing

The Fabric adapter keeps Minecraft's global `mob_griefing` rule enabled so Villagers can collect
food and breed, Piglins can collect gold and barter, and ordinary mob item pickup remains vanilla.
Two destructive behaviors are narrowed server-side: Endermen cannot take or place blocks, and
Creeper explosions keep entity damage and knockback while leaving blocks intact.

Movement evidence also treats server-observed entity/projectile damage as authoritative knockback.
That grace applies to horizontal speed and phase checks, while fluid and special-surface movement
uses a bounded allowance plus additional consecutive evidence instead of disabling detection.

`combat.wallHit` is not an ESP detector. A server cannot reliably know whether a modified client is
rendering entities through walls. The old `mitigations.entityEsp` layer was retired because hiding
tracking data also hides legitimate player models and nametags, creating unacceptable PvP pop-in.
Fabric now preserves vanilla player visibility and keeps the non-visual wall-hit, reach, aim, and
multi-target checks active.

## Files and commands

The adapter keeps its data separate from Bukkit/Paper plugin data:

- Config: `config/server-protection/config.yml`
- Manager access roles: `config/server-protection/access.yml`
- Offense state: `config/server-protection/offenses.properties`
- Event history: `config/server-protection/events.jsonl`

The offense properties and `[ServerProtection] EVENT {...}` JSONL records use the same core format
as the Paper adapter. Unknown YAML fields are ignored. Scalar input is limited to 256 KiB, 4,096
lines, 2,048 characters per line, 512 settings, and 12 nesting levels.

Administrative commands require Minecraft's admin command permission:

- `/serverprotection status` (alias `/protect status`)
- `/serverprotection reload`
- `/serverprotection pardon <player>`
- `/serverprotection view start <viewer> <target>`
- `/serverprotection view stop <viewer>`

Authorized owners/admins can also use `/ci-spectate <online-player>` and `/ci-unspectate` in game.
The `ci-` prefix deliberately leaves Minecraft's built-in `/spectate` command untouched. Player
POV preserves the viewer's actual game mode and return position, blocks viewer gameplay input, and
uses the companion channel for the target hotbar, hands, health, hunger, and experience HUD.
Roles with entity inspection or editing access can use `/entityadmin` for directions to the app's
Entity Viewer.

The supported check settings are:

```yaml
checks:
  movement:
    speed: true
    flight: true
    phase: false
    invalidPosition: true
  combat:
    reach: true
    wallHit: true
    autoClicker: true
    multiTarget: true
  world:
    fastBreak: true
    fastPlace: true
  abuse:
    chatSpam: true
    commandSpam: true
    inventorySpam: true
```

Reach uses `limits.combat.maxReach`; the remaining thresholds are documented in the generated
default config.

The adapter also consumes the managed `messages.*` templates/colors, check-specific warning
templates under `messages.checks.<category>.<check>`, `response.preThresholdAction`,
`messages.warningCooldownSeconds`, the retired compatibility-only `mitigations.entityEsp.*` block, and these protection
exemption settings:

```yaml
exemptions:
  owners: false
  admins: false
  players: []
exempt-players: []

# Optional player/UUID exceptions scoped to exactly one check.
check-exemptions:
  abuse:
    inventorySpam: ["player_using_a_trusted_inventory_helper"]
```

Owner/admin roles are resolved from `access.yml`; direct names are case-insensitive. This adapter
uses those roles only for protection exemptions. It does not implement the manager's Bukkit-style
command-group/custom-command permission system for Fabric.

A server cannot securely discover every hidden client-only mod. The manager's Mouse Tweaks and
Quick Inventory compatibility presets therefore create an explicit per-player exception for only
`abuse.inventorySpam`; they do not trust a client declaration and do not disable movement, combat,
world, chat, or command checks. The same narrow rule can be configured for any supported check by
placing a player name or UUID under `check-exemptions.<category>.<check>`.

Inventory protection keeps `maxInventoryClicksPerSecond` as the normal rate threshold, then uses
`inventoryEvidenceSamples`, `inventorySampleIntervalMillis`, and
`inventoryEvidenceWindowMillis` to distinguish a one-off sorting burst from sustained traffic.
`maxInventoryBurstPacketsPerSecond` remains an immediate flood ceiling, and
`inventoryViolationCooldownMillis` limits repeated reports without allowing confirmed excess
packets through while response enforcement is enabled.

## Resource bounds

- At most 16,384 live player sessions and 32,768 player/check violation states are retained.
- Attack rate uses 64 timestamps and multi-target evidence uses 16 UUID slots.
- Break, placement, chat, command, and inventory rates use ten fixed time buckets per channel;
  event timestamps and packet payloads are never retained.
- Player entity tracking is left to vanilla; the protection adapter performs no visibility scans,
  raycasts, pair-state allocation, or tracking interception.
- Movement checks do constant work per online player per tick and collision lookup runs only while
  the independently configurable phase check is enabled.
- Detection emission is limited to one event per player/check per 250 ms.
- Event history uses the shared 512-entry non-blocking queue, one daemon writer, 16 MiB rotation,
  and two archives. Enforcement events receive priority when the queue is saturated.
- Durable offense state is capped at 16,384 records and 16 MiB. Saves are coalesced onto one
  minimum-priority daemon writer rather than blocking a game tick.
- Movement scoring pauses below the configured TPS floor. Teleports/corrections larger than 16
  blocks reset movement evidence, and smaller speed anomalies require consecutive samples so a
  one-tick same-world teleport does not become a violation.

These checks use bounded server-state and selected packet evidence, but cannot identify every
private cheat or guarantee zero false positives. Tune thresholds for heavily modded movement,
combat attributes, vehicles, custom blocks, or minigames before enabling severe automatic bans.

## Build and test

From this directory:

```powershell
.\test.ps1
.\build.ps1
```

The scripts reuse the repository's pinned Gradle wrapper, do not start Minecraft or the desktop
application, and copy the Fabric API artifact from Gradle's resolved dependency graph rather than
using an ad-hoc download URL.
