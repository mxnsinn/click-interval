# Server Protection for Fabric 26.2

This build ports the bounded Server Protection Fabric adapter to the exact runtime used by the SMP:

- Minecraft `26.2` exactly
- Fabric Loader `0.19.5`
- Fabric API `0.161.0+26.2`
- Java `25`
- Fabric Loom `1.17.21`

The Java implementation and tests are shared with the 26.3 adapter so both variants retain the
same thirteen movement, combat, world-action, and abuse checks; reach reconciliation;
PvP-safe vanilla player visibility; managed messages; access-role/direct-player exemptions;
per-player/per-check compatibility exemptions; sustained inventory evidence with an independent
hard flood ceiling; response behavior; and resource bounds. The mod descriptor rejects every
Minecraft version except 26.2.

Install both files from this project's `dist` directory into the server's `mods` directory:

- `ServerProtection-Fabric-1.4.4+mc26.2.jar`
- `fabric-api-0.161.0+26.2.jar`

The adapter reads `config/server-protection/config.yml` and the manager-owned
`config/server-protection/access.yml`. Server checks do not require a client mod. Camera-only player
POV requires Server Protection Companion 1.3.0 on the viewing owner's/admin's client and is exposed
to the host through `serverprotection view start <viewer> <target>` and
`serverprotection view stop <viewer>`.

Version 1.3.3 makes `/bounties` and `/setbounty` baseline player commands, including
for custom roles unless explicitly denied. These menus never elevate the player to
operator authority. The generic `/set` root is deliberately not granted.

Console and authorized protection administrators can persistently bypass anti-cheat detection,
punishment, and packet Anti-Xray for one exact player with
`anticheat disable <player-or-uuid>`, then restore both protections with
`anticheat enable <player-or-uuid>`. `anticheat status` and the paged `anticheat list` report the
current exemptions. Access control and other server features remain active for exempt
players. For an online player, changing the switch queues a paced resend of only their currently
tracked, already-loaded chunks so the packet view updates without generating terrain.

Version 1.4.4 removes public-chat typing completely: no typing payloads, receiver, per-player state,
tick hook, or overlay broadcasts are installed. Older companions check channel availability and
therefore do not announce typing to this server. No client update is required to join. Player/team
mentions and their autocomplete directory remain in Server Chat 1.1.1; all protection checks,
access control, advisory mod reports and authorized player-view behavior are unchanged.

Build and test without starting Minecraft or the desktop application:

```powershell
.\test.ps1
.\build.ps1
```
