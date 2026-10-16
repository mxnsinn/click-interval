# Single-player test launcher

Version 1.0.3 adds the exact save directory `TestWorld` (display name `Test World`), while preserving the original `TreeChopTest` one-shot opening and host-only test tools. The opener also continues to allow exactly `LobbyCandidate-01`, `LobbyCandidate-02`, and `LobbyCandidate-03` inside the configured Minecraft saves directory.

`TestWorld` must already have an ordinary `level.dat` and `.clickinterval-test-world` marker. The marker must contain these exact UTF-8 bytes, with no BOM, LF line endings, and a final newline:

```text
Click Interval test world v1
world=TestWorld
```

The marker is rechecked for every `/testhub` permission check and after an optional native opening. Copying it into another directory does not authorize that world. The launcher never creates, renames, deletes, or replaces a save.

Each lobby candidate must already have a normal `level.dat` and a normal file named `.clickinterval-lobby-candidate`. Its UTF-8 contents must match this example exactly, including the final newline and matching folder name:

```text
Click Interval lobby candidate v1
world=LobbyCandidate-01
```

Normal manual world selection needs no one-shot request. Only when the user explicitly approves opening on a fresh client launch, place an explicit request at `.minecraft/config/clickinterval-solo-test-open.json`:

```json
{"world":"LobbyCandidate-01","ticket":"02928f23-e3ed-42ea-81e2-61088c6a010e","expiresAt":"REPLACE_WITH_UTC_EXPIRY_WITHIN_30_MINUTES","screenshot":true}
```

Use a new canonical UUID ticket each time. `screenshot` is optional and defaults to false; true is accepted only for the three lobby candidates. When requested, one native screenshot is taken after ten seconds in the opened world with no menu or overlay. It never changes the camera, controls, inventory, graphics settings, or game mode. Screenshots are saved in the normal `.minecraft/screenshots` folder as `<world>-<ticket>.png`.

For the new test world, use `"world":"TestWorld"` and omit `screenshot` (or set it to false). Requests expire within 30 minutes and remain one-shot. Merely installing the jar never opens a world by itself.

Only the first ready title screen in a fresh client launch checks for a request. The launcher will never disconnect an existing session or reopen a world after the user exits it. Linked paths, unmarked candidates, arbitrary names/paths, invalid JSON, expired requests, and replayed tickets are refused. Requests are retained or archived, never silently deleted. Phase reports are written under `.minecraft/config/clickinterval-solo-test-launcher/status`.

All original `/testhub` commands are restricted to the actual integrated single-player server, its host, enabled cheat permissions, and either legacy `TreeChopTest` or the exact marked `TestWorld`. They are not granted in lobby candidates, copied/renamed saves, remote servers, or LAN guests. `/testhub settings`, `/testhub kit`, and `/testhub demos` keep their existing behavior; no arbitrary command or inventory overwrite is added. No launcher credentials or authentication settings are accessed or changed. No live multiplayer server is started, stopped, or modified by this mod.
