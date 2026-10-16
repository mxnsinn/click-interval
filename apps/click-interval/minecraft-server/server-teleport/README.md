# Server Teleport

Small server-side teleport plugin for Paper, Purpur, and Spigot servers. It provides player
requests plus persistent personal named locations, with bounded state, permissions, tab completion,
safe destination validation, and fully editable neutral messages.

## Build and test

Requirements: Windows PowerShell and a JDK 21 or newer.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

`build.ps1` downloads pinned compile-only API dependencies into a unique system temporary
directory and verifies every dependency with SHA-512 before compilation. Dependencies are not
executed or bundled. Temporary build files are removed afterward. The output is:

`dist/ServerTeleport.jar`

## Commands

- `/tpa <player>` sends a request to an exact online, visible player.
- `/tpa set <name>` saves the player's exact world, coordinates, yaw, and pitch.
- `/tpa <name>` teleports to the player's saved location when no exact online player matches.
- `/tpa list` lists the player's saved locations.
- `/tpa delete <name>` deletes one saved location.
- `/tpa accept [player]` accepts a request. The player argument is required when several requests
  are waiting.
- `/tpa decline [player]` denies a request with the same ambiguity rule.
- `/tpaccept [player]` and `/tpdeny [player]` remain available as compatibility aliases.
- `/tpacancel` cancels the sender's outgoing request.
- `/serverteleport reload` reloads settings and messages without Bukkit `/reload`.

## Permissions

- `serverteleport.request` — send requests; granted by default.
- `serverteleport.places` — save, list, delete, and use personal locations; granted by default.
- `serverteleport.respond` — accept or deny requests; granted by default.
- `serverteleport.cancel` — cancel an outgoing request; granted by default.
- `serverteleport.reload` — reload configuration; operators by default.
- `serverteleport.bypass.cooldown` — bypass request cooldowns; operators by default.

## Runtime behavior

Settings are stored in `plugins/ServerTeleport/config.yml`. Requests are intentionally held only
in memory and never survive a server restart. One player can have only one outgoing request, while
the number of requests waiting for a target is configurable and capped at 32. Expired requests and
requests involving a disconnected player are removed from both indexes.

Named locations are stored in `plugins/ServerTeleport/places.properties`. Names are
case-insensitive, limited to 1-24 letters, numbers, underscores, or hyphens, and each player can
store at most 16. `set`, `list`, and `delete` are reserved. Every mutation is forced to a sibling
temporary file and atomically replaces the prior snapshot; a failed write leaves both the prior
file and in-memory state intact. World UUID is authoritative and world name is retained for
diagnostics, so a different replacement world cannot silently receive an old teleport.

All player-facing text is in `config.yml`. Dynamic placeholder values cannot inject formatting or
extra lines, rendered messages are length-bounded, and an explicitly empty message suppresses that
notification. The defaults contain no application branding.

## Compatibility

The plugin compiles against the pinned Paper API used by the server manager but imports only Bukkit
commands, players, locations, world borders, events, scheduling, and configuration APIs. Teleports
run on the main server thread and use `PlayerTeleportEvent.TeleportCause.COMMAND`. It is intended for the same Java
21+, Minecraft 1.20.6, and current 1.21.x Paper/Purpur/Spigot runtimes supported by the bundled
server tooling. It is not a Vanilla, Fabric, Forge, or proxy plugin.
