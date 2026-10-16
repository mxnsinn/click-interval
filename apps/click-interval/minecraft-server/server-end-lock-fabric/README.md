# Server End Lock 1.2.0

Server-only Fabric 26.2 dimension-opening controls. Requires Fabric Loader, Fabric API and Java 25; remote players need no client companion.

## First-launch schedule

While the server is stopped, its world-local `server-end-lock/state.properties` can be armed with the following exact contents (LF or CRLF, including the final newline):

```properties
version=3
end.locked=true
end.unlockAtMillis=0
nether.locked=true
nether.unlockAtMillis=0
eyeCraftingBlocked=true
frameInsertionBlocked=true
end.startOnLaunchMillis=259200000
end.openingDurationMillis=259200000
nether.startOnLaunchMillis=172800000
nether.openingDurationMillis=172800000
```

Reading this file does not start either timer. When the server next reaches `SERVER_STARTED`, one atomic write changes the pending periods into absolute wall-clock deadlines: Nether +48 hours, End +72 hours. Restarts do not reset those deadlines, and later downtime counts. Do not replace the file with the armed template again after launch unless intentionally resetting the opening period.

Existing v1 and v2 files remain supported. Malformed or unwritable state fails closed. Both timers are committed together before becoming active; a storage error does not partially open either dimension.

## Locked dimensions

- Nether portal ignition and existing-portal transit are blocked. Entering through commands or other ordinary dimension-teleport paths is blocked too.
- End entry, Eye of Ender crafting and frame insertion stay blocked by default while the End is closed.
- Blocked players receive a private, rate-limited chat notice with the opening period and remaining time. There is no automatic broadcast spam.
- Console commands remain `netherlock on|off|status|for <duration>` and `endlock on|off|status|for <duration>`. The End additionally supports `eyes true|false` and `frames true|false`. An explicit on/off or new timer cancels that dimension's pending schedule. Dedicated-server player OP status alone cannot run these controls; the physical console/RCON can, and a local singleplayer host with cheats can.

## Safe return for players already in the Nether

Players who log in inside a locked Nether are returned safely, one landing search/teleport per tick. The mod first tries its per-player saved Overworld origin; for trips predating this mod it can recover vanilla's persisted `entered_nether_pos`. It never guesses a portal by multiplying current Nether coordinates or borrowing someone else's position.

Only one known-origin 3×3 chunk neighborhood loads at a time, asynchronously, with a 10-second deadline. Landing checks require solid supporting ground, standing headroom, world-border clearance, loaded chunks, no obstructing entities, no fluids and no dangerous blocks or portal interior. Players land beside the portal if its interior is unsafe. Missing, inaccessible or unsafe history falls back to a separately verified Overworld spawn; if no landing is verified yet, the player waits rather than being teleported into air or lava.

Living players awaiting this locked-Nether evacuation cannot take damage. Successful arrivals receive five seconds of transfer-damage grace. Protected players cannot deal ordinary living-entity damage during that time. These protections use transient server state: no inventory, health, persistent invulnerability flag, potion or game-mode changes. Fall distance, momentum and fire are cleared on arrival. Vehicles, pets and portal structures are not deleted.

## Verification

`gradle --offline --no-daemon --max-workers=1 build` runs unit and Minecraft bytecode-contract tests. Native tests are opt-in via `-Dserverendlock.selftest=true` and require an explicitly marked disposable world containing `server-market-test-fixture`; never set that flag on a real world.

Expected native success markers include `SERVER_END_LOCK_NATIVE_TEST_PASS`, `SERVER_DIMENSION_LOCK_NATIVE_TEST_PASS`, and `SERVER_OPENING_PERIOD_NATIVE_TEST_PASS`. The opening-period fixture exercises exact deadlines, persisted restart behavior, pre-installation vanilla origin recovery, lava/void waiting immunity and arrival grace.
