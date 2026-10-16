# Click Interval Economy Guard

Server-side Fabric **26.2**, Java 25. Dedicated servers and integrated singleplayer are supported; multiplayer clients do not need this mod. Build with `build.ps1`. Release: `dist/ServerEconomyGuard-Fabric-1.0.0+mc26.2.jar`.

## Targeted protection

| Area | Protection / verified behavior |
| --- | --- |
| Gravity-block End portal duplication | Clear 26.2's explicit `forceTickAfterTeleportToDuplicate` flag after transfer. The legitimate destination survives; the removed source cannot also place/drop. Sand, red sand, gravel, concrete powder, dragon eggs and anvils are tested both directions. |
| Tripwire hooks | A cached redstone update cannot recreate a hook that was removed/replaced during neighbor callbacks. Ordinary attachment/power remains unchanged. |
| Old item entity references | Player and hopper pickup reject an already removed item, including a portal/unload source that still retains serialized item data. Partial legitimate pickup preserves its remainder. |
| Container vehicles | Chest/hopper minecarts and chest boats cannot emit cargo or a vehicle again through callbacks on a removed source. First destruction and ordinary transport retain their contents. |
| Chest/shulker desync | Native menu validity/state synchronization is retained and regression-tested with delayed click packets after destruction. No new inventory wiping, shulker tagging or stack-size limits. Ordinary and explosion shulker drops contain the original contents exactly once. |
| Entity/chunk identity | Native duplicate-UUID rejection, chunk movement, serialization and transfer replay rejection are tested. No UUID regeneration or heuristic removal of similar-looking items. |
| Dragon egg piston collection | Normal piston collection is tested to yield one egg; it is not blocked. The gravity portal patch also covers falling dragon eggs. A generic label is not proof of a separate current piston exploit. |

All production checks are constant-time at the relevant operation. There are no periodic player/entity/chunk scans, cooldowns, punishments, hidden players, background world generation or per-item synchronous disk writes.

`StringDupersReturn` deliberately restores a tripwire duplication mechanic and conflicts with this policy. Fabric metadata rejects that incompatible combination; retirement preserves a recoverable copy rather than deleting it.

## Crash/rollback limitations

This is **not a guarantee against every possible dupe**. Vanilla player saves, chunk saves and entity files are not a single atomic transaction. Arbitrary crashes, power loss, selective save restores, third-party mods or untested machines can still create inconsistencies. `sync-chunk-writes=true`, graceful shutdowns and consistent whole-save backups reduce operational risk but do not make those files transactional. No change here silently confiscates items to guess at recovery.

The separate Bounties mod already journals its own escrow/payment/refund transactions. Its native replay and interruption tests run alongside these guards. Those transaction guarantees do not extend to all vanilla item movement or Death Loot chest placement.

Known physics reference: [Paper's documented duplication fixes](https://docs.papermc.io/paper/misc/paper-bug-fixes/). This implementation was checked against this installation's actual 26.2 bytecode; it does not replace Fabric with Paper or blindly apply Paper configuration options.

## Verification and activation

`node work/economy-guard-smoke.cjs` from the parent application creates a fresh loopback-only disposable profile using the installed server mod hashes, removes only the incompatible duplication mod and adds this release. It runs native block/portal/container tests plus existing bounty and trading tests with a 2 GiB heap and two active processors. Results bind the tested JAR hashes. Tests intentionally exercise stale callbacks as defense-in-depth; this does not establish that every callback is reachable from an unmodified vanilla client.

Native selftests require both `-Dservereconomyguard.selftest=true` and a `.economy-guard-disposable-test` marker in the newly created test world. **Never set either in SMP or TreeChopTest.** They intentionally create items and test entities. The installed release runs only the lightweight guards by default.

Before activation, take and verify whole-save and mod backups. Do not hot-swap a running world's mods. Use the app's graceful managed restart for a running backend; if already stopped, publish first and use the app's managed start. Never run two backends against the same world. Singleplayer loads the new JAR on the next Minecraft launch.
