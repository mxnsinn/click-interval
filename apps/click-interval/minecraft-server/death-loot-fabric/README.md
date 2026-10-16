# Server Death Loot for Fabric 26.2

Server Death Loot is a lightweight server-only mod. It changes only item stacks that vanilla is
about to drop from a player's inventory because that player died. Manually dropped items, broken
block drops, mob drops, container contents, and every other item entity keep normal Minecraft
behavior.

## Runtime

- Minecraft Java Edition 26.2
- Fabric Loader 0.19.5 or newer
- Fabric API 0.161.0+26.2 or a compatible newer 26.2 build
- Java 25 or newer

Players do not install this mod. Put `dist/ServerDeathLoot-Fabric-1.0.0+mc26.2.jar` and the pinned
Fabric API JAR in the server's `mods` directory. The managed filename used by the server host is
`ServerDeathLoot-Fabric.jar`.

## Configuration

The mod creates `config/server-death-loot/config.properties` on first start:

```properties
mode=chest
death-drop-lifetime-seconds=300
death-chest-lifetime-seconds=900
place-torches=true
```

`mode` accepts:

- `vanilla`: Minecraft handles the death inventory normally.
- `timed`: player-death item entities expire after `death-drop-lifetime-seconds`.
- `chest`: eligible inventory, armor, and offhand stacks are put into a chest near the death.

`death-drop-lifetime-seconds` accepts 1 through 86,400 seconds. It also controls the safe item-drop
fallback if chest placement is impossible. `death-chest-lifetime-seconds` accepts 1 through
604,800 seconds; `0` makes generated death chests permanent. `place-torches` accepts only `true` or
`false`.

Run `/serverdeathloot reload` as a Minecraft administrator after editing the file. Run
`/serverdeathloot status` to see the active mode and lifetimes.

## Death chest behavior

- `keepInventory` is respected. The mod's interception point is inside vanilla's existing
  `keepInventory=false` branch and runs after Curse of Vanishing items have been removed.
- A single chest is used when the compacted stacks fit in 27 slots; otherwise a correctly joined
  double chest is used for up to 54 stacks.
- Placement searches a bounded four-block area around the death without loading chunks. It checks
  build height, world border, spawn/build permission, collision, access space, and requires empty
  air so existing blocks and block entities are never overwritten.
- Torches are optional. Each torch is placed only if its target is free air and it can survive
  normally. Failure to place either torch does not risk the chest or its contents.
- If placement or commit fails, every captured stack is materialized exactly once as a timed death
  drop. Partially created chest blocks are cleared and removed without dropping a second copy.
- Generated chest halves carry a persistent random death ID and wall-clock expiry. Only a chest
  block entity with the matching marker can be expired. If a player breaks it and later places a
  different chest at the same coordinates, that new chest is not touched.
- Expiry clears the remaining inventory before removing the marked chest, so expired contents do
  not spill back into the world. Expiry survives restarts and chunk unloads. Unloaded chunks are
  never force-loaded; an overdue chest expires when its chunk next loads.

Timed death drops also persist their deadline in the entity data. They use Minecraft's unlimited
age marker until the deadline, which prevents them from merging with ordinary dropped items. This
keeps the custom lifetime strictly limited to the death stacks.

## Build and tests

`test.ps1` runs the pure configuration, placement, expiry, and stack-conservation tests.
`build.ps1` performs a clean test/build and copies the release JAR plus the exact Fabric API
dependency into `dist`.
