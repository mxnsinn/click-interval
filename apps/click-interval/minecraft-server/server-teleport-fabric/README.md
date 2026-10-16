# Server Teleport for Fabric 26.2

Server Teleport is a lightweight, logical-server teleport request mod for exact Minecraft Java
Edition 26.2. It supports dedicated servers and single-player integrated servers. Multiplayer
players need no client install when the server already has it.

## Manual installation

1. Install Fabric Loader 0.19.5 or newer for Minecraft 26.2.
2. Copy `dist/ServerTeleport-Fabric-1.8.1+mc26.2.jar` into the server's `mods` folder during an approved stop.
3. Copy `dist/fabric-api-0.161.0+26.2.jar` into the same `mods` folder unless that exact or a
   compatible newer 26.2 Fabric API is already installed.
4. Start the server normally. The mod creates
   `config/server-teleport/config.properties` on first start. Saved places are kept separately in
   `<world>/server-teleport/locations.tsv`.

Required runtime:

- Minecraft Java Edition 26.2 exactly
- Java 25 or newer
- Fabric Loader 0.19.5 or newer
- Fabric API 0.161.0+26.2 or a compatible newer Fabric API for Minecraft 26.2

For single-player, put the same mod and Fabric API in the Fabric client's `mods` folder. Each
save keeps its own settings at `<save>/server-teleport/config.properties` and saved places at
`<save>/server-teleport/locations.tsv`; no single-player data is written into a dedicated server.
Normal `/tpa set`, `/tpa go`, `/rtpa`, and `/tpa back` need no Protection/anti-cheat mod or
operator permission. Request/accept and actual PvP testing need a second player (for example, LAN).
Closing a world releases its pending travel, chunk tickets, terrain state, and server references
before another world starts. No client-side gameplay hooks or client dependencies are added.

Do not also install the Bukkit `ServerTeleport.jar` on a
hybrid server: the two implementations are separate and intentionally provide the same command
names.

## Commands

- `/tpa <destination>` resolves the complete name against both the player's own saved places and
  exact online player names. A saved place teleports directly; an online player receives a request.
  Multiword saved places work without quotes, and the first completion popup shows bare saved-place
  and player names. There is no partial or fuzzy player matching.
- `/tpa player <username>` explicitly sends a request to an exact online player match.
- `/rtpa` explores a random safe Overworld surface. It is available to normal players and
  appears in tab completion. `/tpa random` no longer invokes random travel; saved places and
  players named `random` follow ordinary exact-name matching.
- If an online player and one of the sender's saved places have the same exact name, the shorthand
  refuses to guess and instructs the sender to use `/tpa go <place>` or `/tpa player <username>`.
- `/tpa set <name>` saves the player's current world, position, yaw, and pitch. Place names may
  contain spaces; for example, `/tpa set End Portal`.
- `/tpa go <name>` teleports only to the player's own saved place. For example,
  `/tpa go End Portal`.
- `/tpa list` lists the player's saved places.
- `/tpa delete <name>` permanently deletes one of the player's saved places.
- `/tpa back` returns to the position occupied immediately before the last successful player TPA,
  saved-place/random teleport, or `/tpa back`. Repeating it toggles between the two most recent positions.
- `/tpa accept` accepts the pending request.
- `/tpa decline` declines the pending request.
- `/tpaccept [player]` and `/tpdeny [player]` remain compatibility aliases; a player name can select
  one request when several are pending.
- `/tpacancel` cancels the sender's outgoing request or active teleport countdown.
- `/serverteleport reload` reloads the config. This requires Minecraft's native admin permission.

Normal request and saved-place commands are player-only and need no operator permission. A player
can only list, use, replace, or delete places stored under their own UUID. Minecraft admins bypass
the request cooldown. Console and command blocks cannot use player commands.

## Travel groups

Every successful player TPA, saved-place teleport, and `/tpa back` automatically moves a small,
bounded travel group with the player. This behavior is available to ordinary players and does not
require operator or administrator permission:

- The vehicle the player is riding, including a horse, camel, or boat, and its non-player passenger
  stack. If any other player is in that vehicle tree, the teleport is rejected instead of moving
  somebody who did not consent.
- Owned animals within 16 blocks, unless a tameable animal is ordered to sit or currently sitting.
  This includes nearby horses and camels as well as tameable pets.
- Nearby mobs attached by leads to the player or to another entity already in the travel group.
  A led boat moves with every non-player passenger in it, including two villagers. If the player
  is riding that boat, the complete boat and passenger tree moves as the primary vehicle instead.
- A nearby non-player entity currently caught by the traveler's fishing hook.

The group is capped at 32 total entities. The destination is checked before anything moves. A TPA
request to a moving player can use a nearby vehicle-safe fallback, while saved places and `/tpa
back` always put the traveler at the exact recorded coordinates without a vertical adjustment—even
when that position has no floor. Mounted travel compensates the vehicle root so the rider, not the
vehicle, lands on those exact coordinates. Companion landing positions are allocated near the
player without block or entity overlap, and Minecraft's native passenger-aware transfer performs
the move. A partial failure restores the original dimensions, positions, riding links, and lead
links. The mod never creates entity copies.

Fishing hooks never pull an unrelated player without consent. If the hooked player is the accepted
TPA target, the traveler is already moving to that player; otherwise the hooked player stays behind.
Shoulder pets are stored inside player data rather than existing as world entities and therefore use
Minecraft's normal player-transfer behavior.

## Safety and resource bounds

- Random travel stays within 10,000 blocks of spawn, the configured radius and the world border.
  Before loading a candidate, a bounded background reader checks Anvil headers in an eight-chunk
  buffer. Saved terrain or currently loaded chunks reject the candidate. After preparation, any
  structure start/reference in the footprint rejects it, including strongholds and mansions.
  This conservatively avoids explored terrain; it is not a historical block-edit audit.
  All TPA routes reject Nether, End and cross-dimension travel, even if an old config enabled it.
  Random landing requires loaded collision data, a dry, broad full supporting surface
  (at least 3x3 blocks for an ordinary player), free body/head space and no
  lava, water, cactus, magma, fire, campfires, powder snow, berries, wither roses, dripstone,
  cobwebs or portals. Empty space/void/oceans fail safely; no descending into caves or Nether roofs.
  The final travel-group plan revalidates safety after loading/warmup and preserves automatic
  companions and `/tpa back`. Existing saved/back destinations remain exact, even when hazardous.
  At most two random searches run at once, one area is scanned per tick (81 columns maximum),
  and each request tries at most eight small asynchronously prepared footprints within 30 seconds.
  The same shared terrain loader, one-new-load/one-arrival-per-tick limits, PvP warmup and
  movement/damage/attack/manual cancellation apply. Failed searches never move the player.
  Random attempts share `request-cooldown-seconds` with player requests (including failures and
  cancellation); native admins retain their existing bypass. The cooldown survives quick relogs.
  No whole-map pre-generation is performed. A place already named `random` remains stored unchanged.
- On every login, including Nether and End logins, the player's exact saved dimension and position
  are held with zero velocity and damage protection until the destination chunk is fully loaded for
  two consecutive server ticks. If loading fails for 30 seconds, the player is disconnected at the
  preserved position instead of being released into unloaded terrain or the void.
- An already-loaded destination executes immediately outside PvP combat (subject to the one-arrival
  per-tick work budget). A bounded landing neighborhood, normally 3x3 chunks, is prepared
  asynchronously while the player stays at the origin. A wider bounded footprint is used for
  the random surface scan and when accompanying animals need landing space.
  Commands never wait for disk reads or world generation. At most four distinct areas load
  concurrently, with one new area and
  one arriving travel group per tick, and 32 queued teleports. Players going to the same area share
  a load. Dedicated loading-only tickets do not activate mobs or redstone and are released on
  completion, cancellation, disconnect, timeout, or shutdown. Preparation times out after 30 seconds
  without moving the player. A moving target can change destination chunks at most four times before
  the attempt is released for retry. Normal client-acknowledged chunk streaming supplies the wider view.
  Border and travel-group checks still reject any bounds crossing unloaded chunks.
- For newly sent destination terrain, movement/gravity and server fall accumulation are held until vanilla has sent the landing
  chunks and the client acknowledges a position packet sent after them. Already-sent nearby terrain
  needs no extra handshake. Vanilla's budgeted sender is prompted immediately at arrival, preserving
  Anti-Xray processing. The client cache center is not moved while the player is still at departure.
  There is no fixed delay, extra loading screen, or invulnerability. Initial teleport acknowledgements
  still complete normally. Actual damage immediately ends
  the delivery hold; a stalled delivery/acknowledgement disconnects after ten seconds. Intentional
  airborne destinations begin falling as soon as the terrain handoff completes.
  This is server terrain preparation and a bounded packet-order handoff, not a guarantee that every
  client has already rendered the full view. Distant terrain generation and client rendering can take time.
- Player-versus-player damage marks both participants in combat for 15 seconds. Starting any TPA
  travel while marked begins a private chat countdown from 10 through 1. Looking around,
  inventory use, and hotbar changes do not cancel it. Any server-position change—including a small
  knockback or push—changing dimension, dying, disconnecting, taking any damage, or attacking
  another player cancels it. A cancelled accepted request is consumed, so the requester must send
  a new request before the target can accept again. This prevents a
  countdown from being started and then used to disappear immediately after another attack. The
  combat marker survives a quick disconnect/rejoin and expires normally, so relogging cannot bypass
  the countdown. Actual death clears only the deceased player's old combat marker and shared
  request/random cooldown, cancels prior-life queued travel and requests, and leaves saved places
  and `/tpa back` history intact. Respawn does not inherit the old countdown; new PvP damage starts
  normal combat timing again. Terrain prepares during the countdown, and full stillness remains required if
  terrain is still loading when the countdown finishes.
- A successful voluntary TPA while still PvP-tagged adds a five-minute, 160-block horizontal
  return lock around the departure point in its original dimension. Every TPA route (player,
  trusted autoaccept, saved place, random and back) checks both requested and actual landing.
  Overlapping active fight areas remain locked independently; another escape cannot erase one.
  Reconnect preserves these locks in `<world>/server-teleport/return-locks.tsv`; death clears them.
  Failed/cancelled TPA and death/respawn/reconnect never create a lock. This never bans anyone.
  Remaining seconds are shown on rejection. Corrupt lock storage is preserved and fails TPA closed.
- If optional Server Teams is present, a recipient's directional trust automatically accepts a
  request from that teammate. Trust never bypasses PvP warmup, movement/damage cancellation,
  return locks, dimension policy or destination checks. Team/ceasefire-prevented friendly damage
  does not activate PvP tagging.
- One outgoing request is allowed per player.
- Incoming requests are capped per recipient from 1 to 32.
- All pending requests are hard-capped server-wide from 1 to 4,096.
- Requests expire from 5 to 300 seconds and are cleaned once per second.
- Starting saved-place travel or `/tpa back` first revokes any older outgoing player request and
  notifies both players, so a late acceptance cannot pull the traveler somewhere else.
- Accepting first reserves the exact request. It remains indexed and counted until the teleport
  commits; validation or teleport failure releases the same consent for retry without changing its
  original expiry or cooldown. Reservation handles are single-use to prevent replay.
- Disconnecting removes requests in both directions immediately.
- Place names are case-insensitive, limited to 24 letters, numbers, spaces, underscores, or
  hyphens, and each player can store at most 30. Existing location files remain compatible and
  lists are paged into complete ten-place chat lines. Repeated spaces collapse to one; tabs and line
  breaks are rejected. `accept`, `decline`, `set`, `list`, and `delete` are reserved.
  A legacy place named `back` remains usable with `/tpa go back`.
- Saved-place updates use a flushed same-directory temporary file and atomic replacement. Invalid
  or corrupt storage is rejected without overwriting the existing file.
- Saved/back destinations stay at the exact recorded coordinates, including air, solid blocks or
  lava. They must remain inside the world's build height and border and have loaded collision/fluid
  data. The mod does not rescue an intentionally dangerous saved position. Companion and player-
  request landing searches retain their existing collision/lava checks.
- Dimension names remain stored and validated for future support, but only Overworld-to-Overworld
  travel is enabled now. Existing Nether/End saved data is retained, not deleted. Legacy
  `allow-cross-dimension` remains parse-compatible but cannot override Overworld-only travel.
  `random-teleport-radius` can reduce the radius but cannot exceed the hard 10,000-block cap.
- `/tpa back` state is bounded to 4,096 online session entries and is removed when a player
  disconnects or the server stops, preventing stale locations after world changes.
- Names, config size, message length, placeholders, numeric ranges, and positions are validated.
- One low-priority worker reads region headers; its queue is bounded to four jobs. No network
  services, databases, Bukkit classes or client code are used.
  Two server packet-listener mixins handle the bounded terrain-delivery handshake and successful
  chunk writes, including asynchronous Anti-Xray rewrites.

## Configuration

Edit `config/server-teleport/config.properties`, then run `/serverteleport reload`. Invalid values
do not replace the currently active configuration. Every player-facing message is editable in
English and may be set to an empty value to suppress it. Supported placeholders are listed in the
generated file.

## Build and tests

`test.ps1` runs the pure JUnit request/config tests without starting Minecraft. `build.ps1` performs
a clean test/build and copies the mod and its Fabric API dependency into `dist`.
