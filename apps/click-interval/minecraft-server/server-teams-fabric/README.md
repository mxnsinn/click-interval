# Server Teams (Fabric 26.2, 1.0.4)

Server-side private-test module. Source/build artifacts only: this module does not install itself, start Minecraft, or change the live SMP. Requires Java 25, Fabric Loader 0.19.5+, and Fabric API for 26.2. Vanilla 26.2 clients support the native dialogs; there are no chest menus, new items, shops, or casino features.

## Player controls

All membership and settings operations also work through ordinary commands, with no client mod or custom-payload handshake:

- /create;team ABC or /teams create ABC [full name] creates a team with a unique three-letter tag. The default name is Team ABC and default color is aqua. /create team ABC [full name] also works.
- /team;invite Player or /teams invite Player sends an owner-only invitation. /teams invites, /teams accept ABC, and /teams decline ABC list or respond to invitations. /teams accept works when exactly one invitation is pending. /team;accept ABC and /team;decline ABC are aliases.
- /teams list, /teams leave (alias /team;leave), /teams kick Player, and /teams transfer Player manage membership. Only the owner can invite, kick, transfer or edit. Player arguments are names, never selectors.
- /teams disband ABC confirm (alias /team;disband ABC confirm) explicitly removes the owner's whole team, invitations, trust and ceasefires in one durable transaction. The current tag and confirm are required. A last member uses this command instead of silently disbanding through /teams leave.
- /teams name Full Name, /teams tag ABC, and /teams color aqua edit team identity. /teams trust Player on|off and /teams alerts on|off control personal settings.
- /teams help lists these controls. Existing native /team menus remain optional and backward compatible; a vanilla 26.2 client already supports them.

The permission adapter admits only the new public roots (teams, create;team, team;invite, team;accept, team;decline, team;leave, team;disband) at baseline player permissions. Generic vanilla /team administration and unrelated /create branches remain restricted. Explicit team-wide deny rules apply across the aliases.

- `/create team`: native form for a unique 3–32-character full name, unique three-letter A–Z tag, and color. Names support ASCII letters, digits, spaces, `_`, and `-`; tags are normalized to uppercase. Name/tag collisions are case-insensitively rejected.
- `/team` or `/team hub`: roster, invitations (accept/decline), invite, manage members (kick/ownership transfer), leave, personal settings, and ceasefire status. Team cap: five, including owner. The owner must transfer ownership before leaving a nonempty team; the last member explicitly confirms disbanding.
- `/team settings`: personal, directional TPA trust and attack-alert preference. Trust means the selected teammate's request to **you** can be auto-accepted; it is not reciprocal, does not bypass teleport safety checks, and is removed on either player's leave/kick. Alerts default on, remain team-private, contain no coordinates, and are limited to once per victim per ten seconds after actual attributed opponent damage.
- `/tc message`: team-private chat, 256-character limit and 750 ms send cooldown.
- `/ceasefire TAG TAG...`: owner-only, independent requests from your team to each listed team (at most ten). Incoming requests expire after five minutes. The receiving owner uses `/ceasefire accept TAG...` or `/ceasefire decline TAG...`; the sender may `/ceasefire cancel TAG...` while pending.
- Accepted ceasefires are indefinite. Either owner can `/ceasefire end TAG...`: both teams receive 30 seconds' notice, with protection active until that deadline. Restart does not erase the deadline. A–B and A–C agreements never imply B–C protection. Ownership transfer cancels pending requests, not accepted agreements. Disbanding removes that team's agreements.

Overhead nameplates show colored `[TAG]`; Tab shows the colored full team name followed by the player's name. Team and accepted-ceasefire damage/attributed knockback are blocked; melee, spear, projectile, pet owner, harmful potion application, and attributed explosion paths are covered. Explosion damage and push processing exclude only protected player targets; source-less environmental explosions, block destruction, and unrelated PvP are not changed. Self-damage is unchanged. No global PvP/gamerule setting is modified.

## Permissions and integration

The vanilla operator-only `/team` command already exists. The module preserves each existing immediate child's original root permission gate **before** exposing only the new `/team` root, `/team hub`, and `/team settings` player routes. Vanilla `add`, `remove`, `list`, `empty`, `join`, `leave`, and `modify` retain their operator gate. Management actions use player-bound native dialog callbacks, not privileged console commands. ServerProtection additionally permits only the three safe routes and must execute them with baseline player permissions.

Additional safe command roots: `/create team` (exact route), `/tc`, `/ceasefire`. Do not broadly allow arbitrary `/create` or vanilla `/team` subcommands in a command allowlist.

An existing foreign/admin scoreboard team is **not overwritten**: creation/join is rejected with a clear message. This includes styled-role `ci_r_*` teams or app PvE `asm_pve` assignment. Production deployment alongside those features needs a deliberate app integration first. The private test module does not edit the app or live server to achieve that.

Optional public reflection API, all under `dev.serverteams.fabric.TeamApi`:

```java
static boolean trusts(UUID recipient, UUID requester);
static boolean isFriendly(UUID first, UUID second); // team OR active pairwise ceasefire
static Map<String, Set<UUID>> mentionGroups();       // immutable tag + full-name aliases
static long revision();                            // advances on committed mutations
```

Combat integration uses `dev.serverteleport.fabric.ServerTeleportFabric.isPvpTagged(UUID)` and also records local 15-second opponent combat windows. Death/respawn clears the victim's local tag; disconnect/reconnect does not. Every member of both rosters must be out of combat before ceasefire acceptance. Joining a team is blocked while the joining player is in combat. When teleport is absent, local windows apply; if an installed teleport bridge is incompatible or fails, ceasefire activation fails closed while the rest of Teams remains available.

## Storage and safety

Per-world `data/serverteams/teams.json`, schema 1. Changes clone and validate the state, check the serialized size, force-write a temporary file, preserve the last committed file as `.bak`, atomically replace the main file, then publish the new state. A failed write leaves the prior live state untouched. Corrupt state disables loading; it is never silently reset or rolled back. Restore a verified backup manually while the isolated server is stopped. The 16 MiB file-size cap is enforced on both save and load; teams/invitations are capped at 4096 and all pending/accepted ceasefires at 8192; ten pending invitations per recipient and ten pending ceasefires per team. Stale invitations and sessions expire, and all exposed team/mention snapshots are immutable.

Native dialog actions use random one-shot session IDs bound to the authenticated connection/player, expire after two minutes, validate bounded payloads, and recheck owner/membership permissions when used. Cross-player, replayed, expired, and forged actions are ignored. No user-supplied data is interpolated into commands.

## Build and verification

Run `./build.ps1` with JDK 25 configured. This only builds/tests the module and writes `dist/ServerTeams-Fabric-1.0.4+mc26.2.jar`.

`TeamStoreTest` covers naming/collision rules, last-slot invitation races, invite expiry/decline, directional trust and revocation, ownership/disband, pairwise owner-only ceasefires, combat rejection, pending cancellation, 30-second restart-safe endings, ownership transfer, immutable snapshots, backup/corruption handling, failed commits, and atomic personal settings.

The separate project-only combined native fixture exercises actual 26.2 command permissions, native form packets, callback identity/replay protection, scoreboard/Tab presentation, and damage/knockback with synthetic players. Fixture code and launch controls intentionally do not ship in this production jar.
