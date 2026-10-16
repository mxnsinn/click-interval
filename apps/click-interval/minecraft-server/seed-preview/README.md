# Native seed preview

This helper draws a seed-derived **biome layer at Y=64**, not generated surface
blocks. Saved/live terrain must be drawn above it. It never instantiates a
Minecraft server, level, chunk generator, chunk, or save and never loads chunks.
It writes nothing to the world or its own working directory. Biome colors are a
deliberate map palette; trees, caves, buildings, player edits, and exact shorelines
are not inferred as real blocks.

Only Minecraft Java **26.2** is enabled. The helper uses the already-installed
26.2 server jar and libraries, bootstraps its vanilla registries, and invokes the
native `RandomState` / `BiomeSource.getNoiseBiome` algorithms. No third-party
world generator is substituted. The seed is read as a signed 64-bit decimal
string from the saved world, sent over the helper's private stdin, and never
included in renderer responses or command-line arguments.

The saved generator must match a supported vanilla noise preset. Local packs or
mod archives containing biome/noise/density/dimension registry replacements
disable the preview. Code-only worldgen modifications cannot be reliably
inferred from registry paths; the layer remains a vanilla seed preview, not a
promise of modded terrain parity. Existing saved terrain always takes precedence.

## Resource and lifecycle bounds

- One helper process, 384 MiB maximum heap, one JVM processor, below-normal OS
  priority, serial GC; no additional server and no sockets.
- At most 4,096 samples per viewport and 128 cells per axis; aligned power-of-two
  sample size, including at the world border.
- A maximum of one in-flight request and one latest pending request. Superseded
  queued viewports are cancelled. Sampling yields between rows.
- At most 24 cached viewports; 30-second idle shutdown. `close()` cancels work,
  kills only the owned helper, and resolves after its exit.
- Metadata parsing bounds compressed data, inflated data, nesting, collection
  size, and node count. Cached metadata is invalidated when saved metadata
  changes, with a 30-second resource-pack audit TTL.
- Stale world tokens cannot retrieve a different world's preview or slime grid.

## Verification

Run `node work/build-seed-preview.cjs` to compile the small helper against local
26.2 libraries, then `node work/test-seed-preview.cjs`. The tests compare slime
chunks to the native 26.2 implementation (including overflow and full signed
seeds), and biome samples to already-generated private test-world NBT. No game or
server is opened during these tests.

Chunkbase's own documentation distinguishes biome seed maps from exact terrain
and warns about world-version and modded-generation differences:
https://www.chunkbase.com/apps/seed-map

The inspected upstream Cubiomes version table did not include 26.2, so it is not
used as a substitute: https://github.com/Cubitect/cubiomes/blob/master/biomes.h
