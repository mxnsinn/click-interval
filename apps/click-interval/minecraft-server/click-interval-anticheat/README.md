# Server Protection

Bundled server-side protection for Paper-compatible servers. It checks movement
(speed, flight, phase, ground spoof/no-fall, water walk, step, timer, no-slow, and invalid
positions/rotations), combat (reach, wall attacks, click rate, multi-target attacks, repeated
off-target attacks, rapid wide-angle switching, robotic click timing, and critical spoofing),
world interaction (fast or out-of-range break/place, scaffold patterns, and multi-break), and abuse (chat, command, and
inventory spam). Every check is independently configurable and the evidence-based combat checks
require repeated server-visible behavior.

The old `mitigations.entityEsp` mode is retired. Withholding a Bukkit player also removes their
nametag and causes unavoidable PvP pop-in, so Server Protection now always leaves player tracking
to vanilla. The compatibility keys remain readable, but `enabled: true` is ignored.

## Build and test

Requirements: Windows PowerShell and a JDK 21 or newer.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

`build.ps1` downloads pinned compile-only Paper API dependencies into a unique system temporary
directory, verifies every dependency with a pinned SHA-512 digest, and deletes the temporary
directory afterward. Dependencies are not executed or bundled. The output is always:

`dist/ServerProtection.jar`

## Runtime data and app integration

- Settings: `plugins/ServerProtection/config.yml`
- Persistent player state: `plugins/ServerProtection/offenses.properties`
- Append-only event history: `plugins/ServerProtection/events.jsonl`
- Commands: `/protect status`, `/protect history`, `/protect reload`, `/protect pardon <name|uuid>`,
  `/protect mods <online-player>`, `/protect compatibility <online-player>`,
  `/ci-spectate <online-player>`, `/ci-unspectate`, `/entityadmin`
- Minecraft's built-in `/spectate` remains untouched; the `ci-` commands use the managed,
  crash-safe player-view session and exact return location.
- Bypass permission: `serverprotection.bypass`

Top-level `enabled` turns detection on or off. `response.enabled` only controls automatic player
warnings, kicks, and bans; detections continue to be scored and logged while automatic response is
off. `response.kickOffenses`, `tempBanOffenses`, and `permanentBanOffenses` define the escalation
steps. Non-permanent offense counts reset after `response.offenseDecayHours` without activity.

### Narrow compatibility exceptions

Compatibility exceptions apply to one player (or one server permission) and one or more exact
checks. They do not turn off protection globally. UUID keys are preferred because player names can
change. For example:

```yaml
compatibility:
  playerOverrides:
    "01234567-89ab-cdef-0123-456789abcdef":
      exemptChecks: [combat.autoClicker, abuse.inventorySpam]
  permissionOverrides:
    - permission: serverprotection.compat.inventory
      exemptChecks: [abuse.inventorySpam]
```

Use `combat.autoClicker` only for a player intentionally using an auto clicker while playing. A
Mouse Tweaks-style inventory helper should normally need only `abuse.inventorySpam`. This keeps
movement, reach, phase, world, and every other check active for that player.

### Allowed and blocked client mods

A Paper server does not receive a trustworthy list of arbitrary client-only mods. The optional
`modPolicy` therefore evaluates only a list explicitly sent by a compatible companion client on
the `serverprotection:mods` plugin-message channel. The protocol is UTF-8 text:
`SERVER_PROTECTION_MODS_1` on the first line, followed by one lowercase mod ID (optionally
`@version`) per line. The previous v1 channel and header remain accepted for upgrade compatibility.
The declaration is
advisory: a hostile client can omit or forge it, and it is never used to exempt anti-cheat checks.

```yaml
modPolicy:
  enabled: false
  enforcement: report       # report or kick
  requireDeclaration: false # needs the companion client before enabling
  declarationGraceSeconds: 8
  enforceAllowlist: false
  allowed: [mousetweaks]
  blocked: [example_cheat]
```

When `enforceAllowlist` is on, a reported mod that is not in `allowed` violates policy. A reported
entry in `blocked` always violates policy. `blocked` wins if an ID appears in both lists. With
`requireDeclaration` off, normal clients that do not implement the channel can still join. `/protect
mods <player>` clearly reports whether a compatible declaration was received.

Console events use one stable line format:

```text
[ServerProtection] EVENT {"player":"Alex","uuid":"...","check":"combat.reach","category":"combat","action":"kick","reason":"...","violations":17.2,"offenseCount":1,"timestamp":"...","durationSeconds":0,"details":{}}
```

### Resource and overload limits

Protection must not stall the Minecraft tick loop when a server is under attack. The bundled
adapter therefore uses explicit safety limits:

- Event history has one 512-entry non-blocking queue and one writer thread. Writes are batched in
  groups of up to 64. When the queue is full, an enforcement event replaces the oldest queued
  diagnostic event; further overload is counted and dropped instead of blocking a game event.
- `events.jsonl` rotates at 16 MiB and keeps two 16 MiB archives (`events.jsonl.1` and `.2`). Event
  fields and detail counts are bounded, so a single event cannot grow without limit.
- Normal console history is limited to 200 events per second, with a hard ceiling of 400 events per
  second when enforcement events are included. Suppressed repetitive output is summarized.
- In-memory violation state is capped at 32,768 player/check pairs. Durable offense state is capped
  at 16,384 players; inactive, unbanned records are pruned after 180 days. Under extreme unique-player
  churn, the least recently used record is evicted instead of allowing unbounded memory growth.
- Per-player live sessions are removed on quit, checked for stale entries once per minute, and capped
  at 16,384. Client mod declarations are parsed at most once per player per second, and invalid-payload
  warnings are limited to once per player per minute.
- Player entity tracking is left to vanilla; the protection plugin performs no visibility scans,
  raycasts, pair-state allocation, or calls to Bukkit's player-hiding API.
- Player access and compatibility policy tables accept at most 512 entries each. Stored names,
  reasons, checks, and event details have fixed length limits.

These limits deliberately favor server availability. During sustained overload, repetitive
diagnostic events can be suppressed or dropped; kicks and bans are prioritized but still subject to
the absolute console ceiling. The normal protection thresholds and action cooldowns apply before
events reach these limits.

## Compatibility tiers and limits

Server Protection is one product in the server manager, but its capabilities depend on what the
selected Minecraft runtime can load:

- Vanilla, Fabric, Quilt, Forge, NeoForge, Paper, Purpur, and Spigot can all use manager-level
  baseline hardening. This covers settings such as online-mode, secure profiles, remote management
  surfaces, command blocks, and managed player access. Baseline hardening is not cheat detection.
- Paper, Purpur, and Spigot use the bundled Bukkit adapter and receive movement, combat,
  world-interaction, and abuse checks after the adapter is installed and the server is restarted.
- Fabric Minecraft 26.2 and 26.3 use separate bundled, server-only Fabric adapters with movement, reach,
  wall-hit, click-rate, and multi-target checks. Its descriptor, exact Minecraft dependency, Fabric
  API dependency, size, and SHA-256 are verified before installation. Other Fabric versions, Quilt,
  Forge, and NeoForge still require a separately supplied adapter built for that exact runtime.
- Vanilla has no plugin or mod loader, so it cannot run an in-process event-level adapter.
- Native Anti-Xray configuration is available only on Paper and Purpur. It is not presented as a
  universal feature.

The app does not download or silently substitute a third-party anti-cheat. A previous managed
third-party install can be detected and removed by its recorded hash, but it is not part of the
Server Protection install path.

The Bukkit plugin is compiled against Paper API 1.21.4 with Java 21. It uses long-standing Bukkit/Paper
event APIs and is intended for Paper 1.20.6 and current 1.21.x servers, but the compiled artifact is
validated against 1.21.4 only. The Fabric build is separate and is pinned to Minecraft 26.3, Fabric
Loader 0.19.5, Fabric API 0.161.0+26.3, and Java 25. Neither adapter is a Vanilla or proxy plugin.

These are conservative event-level checks, not packet inspection. They provide useful layered
protection with TPS, ping, teleport, velocity, game-mode, vehicle, flight, and movement-mechanic
exemptions. They cannot prove that a client is legitimate, catch every private cheat, or guarantee
zero false positives. Start with the balanced preset, review history, and tune limits for unusual
minigames before enabling automatic permanent bans.
