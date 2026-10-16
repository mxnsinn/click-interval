# Lobby Guard 1.1.0

Fabric 26.2 / Java 25. Install with Fabric API. The world-scoped guard can remain in the normal client profile alongside the user's existing client mods; it does not alter their HUDs, settings or mod selection.
No extra client installation is needed for a dedicated lobby; Simple Voice Chat still requires its usual client mod.

The mod is inert unless an explicit validated marker enables it. Ordinary worlds, multiplayer servers, and the SMP and TreeChopTest saves are unaffected. The old `.mxnsinn-lobby-preview` marker with exactly `MXNSINN Lobby Preview v1` still supports the original default geometry; that marker cannot bypass candidate validation.

Downloaded candidates must have a folder named exactly `LobbyCandidate-01`, `LobbyCandidate-02`, or `LobbyCandidate-03`, and both files below at the save root. Candidate marker `.clickinterval-lobby-candidate` must contain exactly the following (LF or CRLF; trailing newline required):

```
Click Interval lobby candidate v1
world=LobbyCandidate-01
```

The settings file `.mxnsinn-lobby-settings.json` uses this exact schema; coordinates must be selected from the actual imported world's safe walkable platform before opening it:

```json
{"version":1,"world":"LobbyCandidate-01","spawn":{"x":103.5,"y":85,"z":-210.5,"yaw":90,"pitch":5},"bounds":{"minX":32,"maxX":200,"minY":60,"maxY":150,"minZ":-300,"maxZ":-100}}
```

Spawn must be strictly inside the boundaries, all numbers finite, Y boundaries within -64..320, horizontal widths at most 4096 blocks, yaw -360..360 and pitch -90..90. Unknown fields and mismatched world names are rejected. Config and enabled state are cached once for each server lifecycle; edits require reopening the world. No file reads occur per tick. Missing or invalid files refuse candidate protection with a warning, rather than applying a default spawn to an unknown map. The importer must validate settings before opening the candidate.

Marked worlds enforce survival without flight; player block breaking (including start/stop/abort packets and attack-triggered block behavior), item/block/entity interaction and outgoing/incoming damage are blocked. Direct kill/death, reduced/zero health setters and killed-removal cannot kill protected players; normal logout removal is still permitted. Item/XP/projectile/mob/TNT/falling-block/cloud entities do not spawn; manual Q drops are rejected. Peaceful difficulty, fixed midday, clear weather, disabled random ticks/fire spread, mob spawning and command blocks keep the static lobby lightweight. Candidate arrivals and boundary/void rescues use their configured spawn. Legacy worlds still use (0.5, 70, 25.5). Player commands are limited to communication/help; dimension and out-of-bounds teleports are denied before relocation. Console commands remain available. There is no client entrypoint, HUD/input hook or screenshot code in activation.

## Production holding world

Production protection requires a **dedicated server** world at this exact relative path inside the managed profile:

```
.click-interval-seamless-restart/holding-fabric/HoldingLobby
```

The world root must contain `.clickinterval-holding-lobby` with the exact text below (including trailing newline), and the same settings schema above with `world` equal to `HoldingLobby`:

```
Click Interval holding lobby v1
world=HoldingLobby
```

An invalid marker/config in this reserved dedicated-server location aborts startup (`HOLDING_LOBBY_UNSAFE`) instead of hosting an unprotected lobby. A valid configuration still requires a real solid spawn floor plus two clear dry blocks. Admission readiness is emitted only after these checks and policy setup:

```
[LobbyGuard] Holding lobby active: HoldingLobby
```

Holding joins and exits clear **only the separate holding world's** stale inventory/cursor/XP/effects and reset movement. Candidate inventories are not cleared; SMP player data is never opened. Use only Fabric API, this guard, Simple Voice Chat, and the required proxy-forwarding mod in the production holding server. Proxy/voice bridging and backend handoff are app responsibilities, not handled by this mod. Existing clients must reconnect/restart as needed to load newly installed client-side integrated-server mods; copying a JAR cannot retrofit the already-running JVM.

No broad world scans occur per tick. Only connected players are checked; gamerules are refreshed once per minute. Unmarked worlds do not have game rules, abilities, inventories or entities changed.

Build using the neighboring server-market-fabric Gradle wrapper with `-p` set to this project. Run `node native-test.cjs` for seven isolated loopback-only test servers (legacy, configured candidate, negative-Y candidate, invalid candidate configuration, protected production holding, invalid holding configuration, and unsafe holding spawn). They use new folders strictly under this project's `build/native-fixtures`, a separate explicit disposable-test marker and the cached Minecraft runtime; no live/client save is used. Native policy assertions emit `LOBBY_PREVIEW_NATIVE_TEST_PASS`, and the invalid candidate fixture proves no changes to ordinary creative mode, flight, position or gamerules with `LOBBY_PREVIEW_INACTIVE_NATIVE_TEST_PASS`. Invalid production fixtures must stop without ever emitting holding readiness.

Protection assumes the guard actually loads and the production minimal mod set remains trusted. Arbitrary additional server mods or direct NBT/data modifications are outside this guarantee. Do not admit users to a holding backend based solely on Minecraft's generic `Done` log; require the guard-specific readiness marker too.
