# Click Interval Map (Fabric 26.2)

Version 1.1.4 preserves terrain detail, chunk coverage limits and gameplay, while pacing historical
backfill more conservatively.

## Saved void completion (1.1.4)

Fully generated all-air chunks, common between End islands, now complete on the first disk read.
Previously they returned no surface, were retried at the end of the entire queue, and finally counted
as failed. A single internal coarse coverage record (`minecraft:air`, empty color, size 16) remembers
confirmed void in the existing bounded 500,000-chunk cache. It is never emitted as colored terrain.
Cache persistence, including mixed v2 migration caches, prevents repeat reads after a clean restart;
an interrupted run can repeat work not yet saved by the existing two-minute cache flush.

Void confirmation requires FULL status, complete unique decoded sections, explicit canonical air
block palettes, and valid biome palettes. Missing/malformed data and protochunks still retry; no
empty marker is inferred from native decoder defaults. Empty reads skip surface sampling and detail
arrays. Live loaded sampling can replace cached void after construction, and an older asynchronous
void read cannot overwrite newer live coarse terrain. Other existing air-colored samples retain their
previous behavior. All read/tick/worker budgets from 1.1.3 remain unchanged.

Tests cover native full-air NBT, malformed/proto rejection, invisible JSON serialization, persisted
coverage, mixed-cache migration, and loaded-sample replacement. To additionally test real saved End
NBT without loading/generating chunks or writing to the world, run Gradle with
`-PmapAuditWorldRoot=<world directory>`. The optional test opens `dimensions/minecraft/the_end/region/r.0.0.mca`
read-only, checks at most 64 saved chunks, and requires both a solid island and valid empty chunk.

## Saved-chunk decoding fix (1.1.3)

Historical readers now copy Minecraft's height accessor in the native `(minimumY, height)` order.
The reversed arguments had excluded valid saved chunk sections, causing failed reads to be retried
without adding terrain. The fallback scan also includes `getMaxY()`, which is inclusive in 26.2.
Existing valid cached terrain is retained; missing stored chunks are rediscovered on startup. No
chunks are generated, no world files are changed, and no cache deletion is required.

Historical backfill starts at most one read per tick (about 20/second at full TPS), down from two.
The six-read in-flight ceiling, three-worker shared terrain pool and 30 ms average-tick pause gate
remain unchanged. Initial full saved-world coverage may take about twice as long at the start-rate
limit, but colors, detail and eventual coverage are unchanged. Terrain and status workers explicitly
use `Thread.NORM_PRIORITY - 1`, preventing accidental inheritance of the tick thread's higher priority.
Java thread priority is only a scheduling hint; the explicit per-tick work cap remains the hard bound.

Native regression tests bootstrap Minecraft's registries, round-trip compressed NBT, and use the real
`SerializableChunkData` decoder. They reproduce the old rejection and verify grass/heightmaps,
Nether/End palettes and the topmost legal block layer at Y=319.

## Tick I/O improvements (1.1.2)

- The historical work queue uses `LinkedBlockingQueue`'s built-in atomic count. Progress reporting
  no longer walks every queued chunk on the server thread; additions, retries, polls and clears all
  use the same concurrency-safe counter.
- Player/marker status is captured as immutable JSON on the server thread once per second. A separate
  daemon writes it using an atomic file replacement; no world or player objects cross to that worker.
- Only one writer task and one replaceable latest snapshot are retained. A slow disk cannot build an
  unbounded status-task backlog or make stale snapshots take priority over newer ones. Terrain parsing
  uses a separate executor, so historical indexing does not starve status writes.
- Shutdown seals a final snapshot and waits at most five seconds for the single writer. A storage
  error/timeout is logged; there is no competing synchronous fallback which could reorder writes.

No view/simulation distance, entity visibility, anti-cheat rules, world generation, or gameplay setting
is changed. These changes remove identifiable server-tick overhead; they do not promise a client FPS
target or eliminate unrelated chunk/shader rendering cost.

Run `test build` with the project's Gradle wrapper and JDK 25. The tests cover coalescing under blocked
I/O, the bounded task queue, resuming after idle/error, concurrent producers, shutdown final-write
ordering, atomic-file replacement, and the server-thread adapter contracts.
