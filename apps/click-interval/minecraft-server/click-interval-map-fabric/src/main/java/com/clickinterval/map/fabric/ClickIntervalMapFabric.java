package com.clickinterval.map.fabric;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerChunkEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;
import net.fabricmc.fabric.api.event.player.UseBlockCallback;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.SectionPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ChunkMap;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.util.SimpleBitStorage;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.LevelHeightAccessor;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.chunk.PalettedContainerFactory;
import net.minecraft.world.level.chunk.storage.SerializableChunkData;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.level.dimension.DimensionType;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.levelgen.structure.StructureStart;
import net.minecraft.world.level.storage.LevelResource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ClickIntervalMapFabric implements ModInitializer {
    public static final String MOD_ID = "clickinterval_map";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final int STATUS_INTERVAL_TICKS = 20;
    private static final int TERRAIN_QUEUE_INTERVAL_TICKS = 100;
    private static final int TERRAIN_PUBLISH_INTERVAL_TICKS = 400;
    private static final int TERRAIN_BACKFILL_PUBLISH_INTERVAL_TICKS = 2_400;
    private static final int DETAILED_RESCAN_INTERVAL_TICKS = 400;
    private static final int SCAN_RADIUS_CHUNKS = 4;
    private static final int SAMPLE_STEP = 4;
    private static final int HISTORICAL_DETAIL_STEP = 8;
    private static final int MAX_CELLS = 250_000;
    private static final int MAX_HISTORICAL_DETAIL_CELLS = 160_000;
    private static final int MAX_COARSE_CHUNKS = 500_000;
    private static final int MAX_CHUNKS_PER_TICK = 1;
    // Stored chunks are read without tickets or generation. A small amount of parallelism keeps a
    // large existing world from taking days to appear while the tick-time gate below protects play.
    private static final int MAX_HISTORICAL_READS = 6;
    private static final int MAX_HISTORICAL_STARTS_PER_TICK = 1;
    private static final int TERRAIN_IO_THREADS = 3;
    private static final int MAX_PENDING_CHUNKS = 2_048;
    private static final double HISTORICAL_PAUSE_TICK_MS = 30.0D;
    private static final long TERRAIN_CACHE_INTERVAL_MS = 120_000L;
    private static final String TERRAIN_CACHE_HEADER = "# click-interval-map-cache-v3";
    private static final String PROVISIONAL_TERRAIN_CACHE_HEADER = "# click-interval-map-cache-v2";
    private static final int[] HISTORICAL_SAMPLE_OFFSETS = {8, 4, 12, 0};
    private static final Pattern REGION_FILE = Pattern.compile("r\\.(-?\\d+)\\.(-?\\d+)\\.mca");

    private final Map<String, TerrainCell> terrain = new LinkedHashMap<>(32_768, 0.75f, true);
    private final Map<String, TerrainCell> coarseTerrain = new LinkedHashMap<>();
    private final Map<String, MapMarker> markers = new LinkedHashMap<>();
    private final ArrayDeque<ChunkScan> pendingChunks = new ArrayDeque<>();
    private final Set<String> queuedChunks = new HashSet<>();
    private final Set<String> structureScannedChunks = new HashSet<>();
    private final Set<String> provisionalCoarseChunks = new HashSet<>();
    private final Map<String, Long> lastScannedChunks = new LinkedHashMap<>();
    // LinkedBlockingQueue maintains its exact size with an atomic counter. ConcurrentLinkedQueue
    // traversed hundreds of thousands of saved chunks on the server thread for every status update.
    private final LinkedBlockingQueue<HistoricalChunk> historicalChunks = new LinkedBlockingQueue<>();
    private final AtomicBoolean terrainWriteInFlight = new AtomicBoolean();
    private final AtomicBoolean historicalDiscoveryInFlight = new AtomicBoolean();
    private final AtomicInteger historicalReadsInFlight = new AtomicInteger();
    private Path outputDirectory;
    private ExecutorService terrainIo;
    private CoalescingSnapshotWriter statusWriter;
    private int ticksUntilStatus = STATUS_INTERVAL_TICKS;
    private int ticksUntilTerrainQueue = TERRAIN_QUEUE_INTERVAL_TICKS;
    private int ticksUntilTerrainPublish = TERRAIN_QUEUE_INTERVAL_TICKS;
    private volatile boolean terrainDirty;
    private volatile long lastTerrainCacheWrite;
    private volatile long terrainRevision;
    private volatile long publishedTerrainRevision;
    private volatile long serverTicks;
    private volatile int historicalTotalChunks;
    private volatile int historicalOmittedChunks;
    private volatile List<GeneratedRegion> generatedRegions = List.of();
    private final AtomicInteger historicalCompletedChunks = new AtomicInteger();
    private final AtomicInteger historicalFailedChunks = new AtomicInteger();
    private boolean historicalIndexingLastTick;
    private volatile boolean stopping;

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTING.register(this::onStarting);
        ServerLifecycleEvents.SERVER_STARTED.register(this::onStarted);
        ServerLifecycleEvents.SERVER_STOPPING.register(this::onStopping);
        ServerTickEvents.END_SERVER_TICK.register(this::onTick);
        ServerChunkEvents.CHUNK_LOAD.register((level, chunk, newlyGenerated) ->
                queueChunk(level, chunk.getPos().x(), chunk.getPos().z(), true));
        ServerChunkEvents.CHUNK_UNLOAD.register((level, chunk) -> {
            String key = chunkKey(level, chunk.getPos().x(), chunk.getPos().z());
            lastScannedChunks.remove(key);
            structureScannedChunks.remove(key);
        });
        PlayerBlockBreakEvents.AFTER.register((level, player, pos, state, blockEntity) -> {
            if (level instanceof ServerLevel serverLevel) queueTouchedChunk(serverLevel, pos);
        });
        UseBlockCallback.EVENT.register((player, level, hand, hitResult) -> {
            if (level instanceof ServerLevel serverLevel) {
                queueTouchedChunk(serverLevel, hitResult.getBlockPos());
                queueTouchedChunk(serverLevel, hitResult.getBlockPos().relative(hitResult.getDirection()));
            }
            return InteractionResult.PASS;
        });
    }

    private void onStarting(MinecraftServer server) {
        outputDirectory = FabricLoader.getInstance().getGameDir().resolve("click-interval-map");
        terrain.clear();
        coarseTerrain.clear();
        markers.clear();
        terrainDirty = false;
        pendingChunks.clear();
        queuedChunks.clear();
        structureScannedChunks.clear();
        provisionalCoarseChunks.clear();
        lastScannedChunks.clear();
        historicalChunks.clear();
        terrainRevision = 0L;
        publishedTerrainRevision = 0L;
        serverTicks = 0L;
        historicalTotalChunks = 0;
        historicalOmittedChunks = 0;
        generatedRegions = List.of();
        historicalCompletedChunks.set(0);
        historicalFailedChunks.set(0);
        historicalIndexingLastTick = false;
        lastTerrainCacheWrite = 0L;
        ticksUntilStatus = 1;
        ticksUntilTerrainQueue = 1;
        ticksUntilTerrainPublish = 1;
        terrainWriteInFlight.set(false);
        historicalDiscoveryInFlight.set(false);
        historicalReadsInFlight.set(0);
        stopping = false;
        terrainIo = Executors.newFixedThreadPool(TERRAIN_IO_THREADS,
                task -> MapBackgroundThreads.create(task, "click-interval-map-io"));
        statusWriter = new CoalescingSnapshotWriter(outputDirectory,
                error -> LOGGER.warn("Could not write native map status: {}", error.getMessage()));
        try {
            Files.createDirectories(outputDirectory);
            loadTerrainCache();
            LOGGER.info("Click Interval Map 1.1.4 initialized. Native snapshots: {}", outputDirectory);
        } catch (IOException error) {
            LOGGER.error("Click Interval Map output is unavailable: {}", error.getMessage());
        }
    }

    private void onStarted(MinecraftServer server) {
        scheduleHistoricalDiscovery(server);
    }

    private void onStopping(MinecraftServer server) {
        stopping = true;
        historicalChunks.clear();
        ExecutorService io = terrainIo;
        if (io != null) {
            io.shutdown();
            try {
                if (!io.awaitTermination(15, TimeUnit.SECONDS)) {
                    LOGGER.warn("Native terrain writer did not finish within the shutdown grace period.");
                    io.shutdownNow();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                io.shutdownNow();
            }
        }
        if (outputDirectory != null) {
            List<TerrainCell> finalCoarse = List.copyOf(coarseTerrain.values());
            List<TerrainCell> finalDetailed = List.copyOf(terrain.values());
            List<TerrainCell> finalCells = combineTerrainLayers(finalCoarse, finalDetailed);
            try {
                Files.createDirectories(outputDirectory);
                writeAtomically(outputDirectory.resolve("terrain.json.tmp"), outputDirectory.resolve("terrain.json"),
                        terrainJson(finalCoarse, finalDetailed, generatedRegions, terrainRevision));
                writeTerrainCache(outputDirectory, finalCells, cacheHeaderForCurrentCoverage());
                publishedTerrainRevision = terrainRevision;
            } catch (IOException error) {
                LOGGER.warn("Could not finish native terrain files during shutdown: {}", error.getMessage());
            }
        }
        CoalescingSnapshotWriter writer = statusWriter;
        if (writer != null) {
            try {
                if (!writer.closeAndFlush(statusJson(server), 5, TimeUnit.SECONDS)) {
                    LOGGER.warn("Native map status writer did not finish within the shutdown grace period.");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                LOGGER.warn("Interrupted while finishing native map status during shutdown.");
            }
        }
        terrain.clear();
        coarseTerrain.clear();
        markers.clear();
        pendingChunks.clear();
        queuedChunks.clear();
        structureScannedChunks.clear();
        provisionalCoarseChunks.clear();
        lastScannedChunks.clear();
        historicalChunks.clear();
        generatedRegions = List.of();
        outputDirectory = null;
        terrainIo = null;
        statusWriter = null;
    }

    private void onTick(MinecraftServer server) {
        serverTicks++;
        scanPendingTerrain();
        startHistoricalReads(server);
        boolean indexingSavedTerrain = isHistoricalIndexing();
        if (historicalIndexingLastTick && !indexingSavedTerrain) {
            ticksUntilTerrainPublish = Math.min(ticksUntilTerrainPublish, 1);
        }
        historicalIndexingLastTick = indexingSavedTerrain;
        if (--ticksUntilTerrainQueue <= 0) {
            ticksUntilTerrainQueue = TERRAIN_QUEUE_INTERVAL_TICKS;
            queueLoadedTerrain(server);
        }
        if (--ticksUntilStatus <= 0) {
            ticksUntilStatus = STATUS_INTERVAL_TICKS;
            writeStatusSnapshot(server);
        }
        if (--ticksUntilTerrainPublish <= 0) {
            indexingSavedTerrain = isHistoricalIndexing();
            ticksUntilTerrainPublish = indexingSavedTerrain
                    ? TERRAIN_BACKFILL_PUBLISH_INTERVAL_TICKS : TERRAIN_PUBLISH_INTERVAL_TICKS;
            scheduleTerrainWrite(false);
        }
    }

    private boolean isHistoricalIndexing() {
        return historicalDiscoveryInFlight.get()
                || !historicalChunks.isEmpty() || historicalReadsInFlight.get() > 0;
    }

    private void scheduleHistoricalDiscovery(MinecraftServer server) {
        ExecutorService io = terrainIo;
        if (io == null || io.isShutdown() || stopping
                || !historicalDiscoveryInFlight.compareAndSet(false, true)) return;
        historicalIndexingLastTick = true;

        Path worldRoot = server.getWorldPath(LevelResource.ROOT);
        PalettedContainerFactory containerFactory = PalettedContainerFactory.create(server.registryAccess());
        List<HistoricalDimension> dimensions = new ArrayList<>();
        int priority = 0;
        for (ServerLevel level : server.getAllLevels()) {
            BlockPos focus = level == server.overworld() ? server.overworld().getRespawnData().pos() : BlockPos.ZERO;
            var border = level.getWorldBorder();
            dimensions.add(new HistoricalDimension(
                    level,
                    historicalHeightAccessor(level),
                    containerFactory,
                    DimensionType.getStorageFolder(level.dimension(), worldRoot).resolve("region"),
                    level.dimension().identifier().toString(),
                    focus.getX() >> 4,
                    focus.getZ() >> 4,
                    blockToChunk(border.getMinX()),
                    blockToChunk(border.getMaxX() - 0.000_001D),
                    blockToChunk(border.getMinZ()),
                    blockToChunk(border.getMaxZ() - 0.000_001D),
                    priority++
            ));
        }
        pruneOutsideWorldBorders(dimensions);
        Set<String> alreadyMapped = new HashSet<>();
        for (TerrainCell cell : coarseTerrain.values()) {
            String chunk = chunkKey(cell.dimension, Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16));
            if (!provisionalCoarseChunks.contains(chunk)) alreadyMapped.add(chunk);
        }
        historicalCompletedChunks.set(alreadyMapped.size());
        try {
            io.execute(() -> discoverHistoricalChunks(server, dimensions, alreadyMapped));
        } catch (RejectedExecutionException rejected) {
            historicalDiscoveryInFlight.set(false);
        }
    }

    private void pruneOutsideWorldBorders(List<HistoricalDimension> dimensions) {
        Map<String, HistoricalDimension> byId = new LinkedHashMap<>();
        for (HistoricalDimension dimension : dimensions) byId.put(dimension.id, dimension);
        boolean removedCoarse = coarseTerrain.entrySet().removeIf(entry -> {
            TerrainCell cell = entry.getValue();
            HistoricalDimension dimension = byId.get(cell.dimension);
            return dimension == null || !dimension.containsChunk(
                    Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16));
        });
        boolean removedDetailed = terrain.entrySet().removeIf(entry -> {
            TerrainCell cell = entry.getValue();
            HistoricalDimension dimension = byId.get(cell.dimension);
            return dimension == null || !dimension.containsChunk(
                    Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16));
        });
        if (removedCoarse || removedDetailed) {
            provisionalCoarseChunks.removeIf(chunk -> {
                int separator = chunk.lastIndexOf(':');
                int previous = separator <= 0 ? -1 : chunk.lastIndexOf(':', separator - 1);
                if (previous <= 0) return true;
                try {
                    String dimension = chunk.substring(0, previous);
                    int chunkX = Integer.parseInt(chunk.substring(previous + 1, separator));
                    int chunkZ = Integer.parseInt(chunk.substring(separator + 1));
                    HistoricalDimension policy = byId.get(dimension);
                    return policy == null || !policy.containsChunk(chunkX, chunkZ);
                } catch (RuntimeException malformed) {
                    return true;
                }
            });
            terrainDirty = true;
            terrainRevision++;
        }
    }

    private void discoverHistoricalChunks(MinecraftServer server, List<HistoricalDimension> dimensions,
                                          Set<String> alreadyMapped) {
        List<HistoricalChunk> discovered = new ArrayList<>();
        List<GeneratedRegion> coverage = new ArrayList<>();
        try {
            for (HistoricalDimension dimension : dimensions) {
                if (stopping) break;
                if (!Files.isDirectory(dimension.regionDirectory)) continue;
                try (var paths = Files.list(dimension.regionDirectory)) {
                    for (Path region : paths.filter(Files::isRegularFile).toList()) {
                        if (stopping) break;
                        Matcher matcher = REGION_FILE.matcher(region.getFileName().toString());
                        if (!matcher.matches()) continue;
                        long regionSize;
                        try {
                            regionSize = Files.size(region);
                        } catch (IOException ignored) {
                            continue;
                        }
                        // A valid Anvil file has two 4 KiB header sectors. Ignore zero-byte leftovers.
                        if (regionSize < 8_192L) continue;
                        int regionX;
                        int regionZ;
                        try {
                            regionX = Integer.parseInt(matcher.group(1));
                            regionZ = Integer.parseInt(matcher.group(2));
                        } catch (NumberFormatException ignored) {
                            continue;
                        }
                        if (!dimension.intersectsRegion(regionX, regionZ)) continue;
                        GeneratedRegion generated = discoverRegionChunks(region, regionSize, dimension,
                                regionX, regionZ, alreadyMapped, discovered);
                        if (generated != null) coverage.add(generated);
                    }
                } catch (IOException error) {
                    LOGGER.warn("Could not index native map regions for {}: {}", dimension.id, error.getMessage());
                }
            }
            discovered.sort(Comparator
                    .comparingLong(HistoricalChunk::distanceFromFocus)
                    .thenComparingInt(chunk -> chunk.dimension.priority));
            int availableCoverage = Math.max(0, MAX_COARSE_CHUNKS - alreadyMapped.size());
            int omittedForMemory = Math.max(0, discovered.size() - availableCoverage);
            if (omittedForMemory > 0) discovered.subList(availableCoverage, discovered.size()).clear();
            if (!stopping) {
                historicalTotalChunks = alreadyMapped.size() + discovered.size();
                historicalOmittedChunks = omittedForMemory;
                historicalChunks.addAll(discovered);
                coverage.sort(Comparator.comparing(GeneratedRegion::dimension)
                        .thenComparingInt(GeneratedRegion::regionX)
                        .thenComparingInt(GeneratedRegion::regionZ));
                generatedRegions = List.copyOf(coverage);
                server.execute(() -> {
                    if (stopping) return;
                    terrainDirty = true;
                    terrainRevision++;
                    ticksUntilTerrainPublish = Math.min(ticksUntilTerrainPublish, 1);
                });
            }
            LOGGER.info("Click Interval Map queued {} generated chunks for asynchronous surface indexing.",
                    stopping ? 0 : discovered.size());
            if (omittedForMemory > 0) {
                LOGGER.warn("Click Interval Map omitted {} farthest saved chunks to preserve its {}-chunk memory ceiling.",
                        omittedForMemory, MAX_COARSE_CHUNKS);
            }
        } finally {
            historicalDiscoveryInFlight.set(false);
        }
    }

    private static GeneratedRegion discoverRegionChunks(Path region, long regionSize,
                                                         HistoricalDimension dimension,
                                                         int regionX, int regionZ,
                                                         Set<String> alreadyMapped,
                                                         List<HistoricalChunk> discovered) {
        ByteBuffer header = ByteBuffer.allocate(4_096);
        try (FileChannel channel = FileChannel.open(region, StandardOpenOption.READ)) {
            while (header.hasRemaining()) {
                int read = channel.read(header);
                if (read < 0) break;
            }
        } catch (IOException error) {
            LOGGER.debug("Could not read native map region header {}: {}", region.getFileName(), error.getMessage());
            return null;
        }
        if (header.position() < 4_096) return null;
        header.flip();
        byte[] generated = new byte[128];
        boolean found = false;
        for (int index = 0; index < 1_024; index++) {
            int location = header.getInt();
            int sectorOffset = location >>> 8;
            int sectorCount = location & 0xff;
            if (sectorOffset < 2 || sectorCount == 0
                    || ((long) sectorOffset + sectorCount) * 4_096L > regionSize) continue;
            int chunkX = regionX * 32 + index % 32;
            int chunkZ = regionZ * 32 + index / 32;
            if (!dimension.containsChunk(chunkX, chunkZ)) continue;
            generated[index >>> 3] |= (byte) (1 << (index & 7));
            found = true;
            if (alreadyMapped.contains(chunkKey(dimension.id, chunkX, chunkZ))) continue;
            discovered.add(new HistoricalChunk(dimension, chunkX, chunkZ, 0));
        }
        return found ? new GeneratedRegion(dimension.id, regionX, regionZ,
                Base64.getEncoder().encodeToString(generated)) : null;
    }

    private void startHistoricalReads(MinecraftServer server) {
        if (stopping || averageTickMillis(server) >= HISTORICAL_PAUSE_TICK_MS) return;
        int starts = 0;
        while (starts < MAX_HISTORICAL_STARTS_PER_TICK
                && historicalReadsInFlight.get() < MAX_HISTORICAL_READS) {
            HistoricalChunk target;
            while ((target = historicalChunks.poll()) != null
                    && coarseTerrain.containsKey(coarseTerrainKey(target.dimension.id, target.chunkX, target.chunkZ))
                    && !provisionalCoarseChunks.contains(
                    chunkKey(target.dimension.id, target.chunkX, target.chunkZ))) {
                historicalCompletedChunks.incrementAndGet();
            }
            if (target == null) return;
            historicalReadsInFlight.incrementAndGet();
            starts++;
            startHistoricalRead(server, target);
        }
    }

    private void startHistoricalRead(MinecraftServer server, HistoricalChunk selected) {
        try {
            selected.dimension.level.getChunkSource().chunkMap.read(new ChunkPos(selected.chunkX, selected.chunkZ))
                    .whenComplete((stored, readError) -> {
                        if (readError != null || stored.isEmpty() || stopping) {
                            if (readError != null) {
                                LOGGER.debug("Could not asynchronously read generated chunk {},{} in {}: {}",
                                        selected.chunkX, selected.chunkZ, selected.dimension.id,
                                        readError.getMessage());
                            }
                            finishHistoricalRead(selected, false);
                            return;
                        }
                        ExecutorService io = terrainIo;
                        if (io == null || io.isShutdown()) {
                            finishHistoricalRead(selected, false);
                            return;
                        }
                        try {
                            io.execute(() -> parseHistoricalChunk(server, selected, stored.get()));
                        } catch (RejectedExecutionException rejected) {
                            finishHistoricalRead(selected, false);
                        }
                    });
        } catch (RuntimeException error) {
            LOGGER.debug("Could not begin generated chunk read {},{} in {}: {}",
                    selected.chunkX, selected.chunkZ, selected.dimension.id, error.getMessage());
            finishHistoricalRead(selected, false);
        }
    }

    private void finishHistoricalRead(HistoricalChunk target, boolean success) {
        if (success) {
            historicalCompletedChunks.incrementAndGet();
        } else if (!stopping && target.attempt < 1) {
            historicalChunks.add(target.retry());
        } else {
            historicalCompletedChunks.incrementAndGet();
            historicalFailedChunks.incrementAndGet();
        }
        historicalReadsInFlight.updateAndGet(value -> Math.max(0, value - 1));
    }

    private void parseHistoricalChunk(MinecraftServer server, HistoricalChunk target, CompoundTag stored) {
        HistoricalSurface surface = null;
        try {
            CompoundTag dataFixContext = ChunkMap.getChunkDataFixContextTag(
                    target.dimension.level.dimension(),
                    target.dimension.level.getChunkSource().getGenerator().getTypeNameForDataFixer());
            int currentDataVersion = SharedConstants.getCurrentVersion().dataVersion().version();
            int storedDataVersion = stored.getIntOr("DataVersion", -1);
            // Running the complete DataFixer graph for every already-current chunk dominated the
            // backfill time on large worlds. Older chunks still take the fully supported upgrade path.
            CompoundTag upgraded = storedDataVersion == currentDataVersion
                    ? stored
                    : target.dimension.level.getChunkSource().chunkMap.upgradeChunkTag(
                    stored, -1, dataFixContext, currentDataVersion);
            surface = historicalSurface(target, upgraded);
        } catch (RuntimeException error) {
            LOGGER.debug("Could not decode generated chunk {},{} in {}: {}",
                    target.chunkX, target.chunkZ, target.dimension.id, error.getMessage());
        }
        if (stopping) {
            historicalReadsInFlight.updateAndGet(value -> Math.max(0, value - 1));
            return;
        }
        HistoricalSurface result = surface;
        server.execute(() -> {
            try {
                if (stopping || result == null) return;
                applyHistoricalSurface(result);
            } finally {
                finishHistoricalRead(target, result != null);
            }
        });
    }

    private void applyHistoricalSurface(HistoricalSurface result) {
        TerrainCell coarse = result.coarse;
        String chunk = chunkKey(coarse.dimension, Math.floorDiv(coarse.x, 16), Math.floorDiv(coarse.z, 16));
        String key = coarseTerrainKey(coarse.dimension, Math.floorDiv(coarse.x, 16), Math.floorDiv(coarse.z, 16));
        // A player may have built here while this saved snapshot was being decoded.
        // Never let an older empty read replace a newer live surface sample.
        if (isKnownEmpty(coarse) && coarseTerrain.containsKey(key)
                && !provisionalCoarseChunks.contains(chunk)) return;
        TerrainCell previousCoarse = coarseTerrain.put(key, coarse);
        if (!coarse.equals(previousCoarse)) {
            terrainDirty = true;
            terrainRevision++;
        }
        boolean wasProvisional = provisionalCoarseChunks.remove(chunk);
        if (wasProvisional && removeDetailedChunkCells(coarse.dimension,
                Math.floorDiv(coarse.x, 16), Math.floorDiv(coarse.z, 16))) {
            terrainDirty = true;
            terrainRevision++;
        }
        for (TerrainCell detail : result.details) {
            String detailKey = terrainKey(detail);
            TerrainCell previous = terrain.get(detailKey);
            if (previous != null && previous.sampleSize <= detail.sampleSize) continue;
            if (previous == null && terrain.size() >= MAX_HISTORICAL_DETAIL_CELLS) break;
            terrain.put(detailKey, detail);
            terrainDirty = true;
            terrainRevision++;
        }
    }

    static LevelHeightAccessor historicalHeightAccessor(LevelHeightAccessor level) {
        // Minecraft 26.2 takes (minimum Y, total height), not (height, minimum Y).
        // Keep an immutable snapshot for the off-thread reader, never a live level reference.
        return LevelHeightAccessor.create(level.getMinY(), level.getHeight());
    }

    static HistoricalSurface historicalSurface(HistoricalChunk target, CompoundTag stored) {
        SerializableChunkData data = SerializableChunkData.parse(
                target.dimension.heightAccessor, target.dimension.containerFactory, stored);
        if (data == null) return null;

        Map<Integer, LevelChunkSection> sections = new LinkedHashMap<>();
        for (SerializableChunkData.SectionData section : data.sectionData()) {
            if (section.chunkSection() != null) sections.put(section.y(), section.chunkSection());
        }
        if (sections.isEmpty()) return null;

        boolean onlyAir = true;
        for (LevelChunkSection section : sections.values()) onlyAir &= section.hasOnlyAir();
        if (onlyAir) {
            // Void is a completed read, not a failed surface that needs another disk read. Keep
            // one non-rendered cache record; no sample list, column scans or detail arrays.
            if (!isCompleteSavedVoid(target, data, stored, sections)) return null;
            return new HistoricalSurface(new TerrainCell(target.dimension.id,
                    target.chunkX << 4, target.chunkZ << 4, target.dimension.heightAccessor.getMinY(),
                    "", "minecraft:air", 16), List.of());
        }

        List<SurfaceTileReducer.Sample> samples = new ArrayList<>(HISTORICAL_SAMPLE_OFFSETS.length
                * HISTORICAL_SAMPLE_OFFSETS.length);
        for (int localZ : HISTORICAL_SAMPLE_OFFSETS) {
            for (int localX : HISTORICAL_SAMPLE_OFFSETS) {
                SurfaceTileReducer.Sample sample = historicalSurfaceSample(
                        target, data, sections, localX, localZ);
                if (sample != null) samples.add(sample);
            }
        }
        SurfaceTileReducer.Result reduced = SurfaceTileReducer.reduce(samples, HISTORICAL_DETAIL_STEP);
        if (reduced == null) return null;
        int chunkX = target.chunkX << 4;
        int chunkZ = target.chunkZ << 4;
        SurfaceTileReducer.Cell base = reduced.coarse();
        TerrainCell coarse = new TerrainCell(target.dimension.id, chunkX, chunkZ, base.y(),
                base.color(), base.block(), base.size());
        List<TerrainCell> details = reduced.details().stream()
                .map(cell -> new TerrainCell(target.dimension.id, chunkX + cell.localX(),
                        chunkZ + cell.localZ(), cell.y(), cell.color(), cell.block(), cell.size()))
                .toList();
        return new HistoricalSurface(coarse, details);
    }

    private static boolean isCompleteSavedVoid(HistoricalChunk target, SerializableChunkData data,
                                                CompoundTag stored, Map<Integer, LevelChunkSection> sections) {
        LevelHeightAccessor bounds = target.dimension.heightAccessor;
        int count = bounds.getSectionsCount();
        // Vanilla full chunks save each in-bounds section. Be conservative with partial/corrupt
        // data: native parsing can silently substitute air for a missing block_states palette.
        if (data.chunkStatus() != ChunkStatus.FULL || count <= 0 || count > Long.SIZE
                || sections.size() != count || stored.getInt("xPos").isEmpty() || stored.getInt("zPos").isEmpty()
                || data.chunkPos().x() != target.chunkX || data.chunkPos().z() != target.chunkZ) return false;
        long seen = 0;
        int accepted = 0;
        for (var tag : stored.getListOrEmpty("sections")) {
            if (!(tag instanceof CompoundTag section) || section.getByte("Y").isEmpty()) return false;
            int y = section.getByteOr("Y", (byte) 0);
            int index = y - bounds.getMinSectionY();
            if (index < 0 || index >= count) continue; // Extra light-only boundary sections.
            long bit = 1L << index;
            if ((seen & bit) != 0 || !sections.containsKey(y)) return false;
            seen |= bit;
            var states = section.getCompoundOrEmpty("block_states");
            var palette = states.getListOrEmpty("palette");
            if (palette.size() != 1 || !(palette.get(0) instanceof CompoundTag entry)
                    || !"minecraft:air".equals(entry.getStringOr("Name", ""))
                    || entry.contains("Properties") || states.contains("data")) return false;
            // Do not cache a malformed biome palette which the native chunk parser recovered
            // with a default biome. This validation is bounded to the section's 64 biome cells.
            var biomes = section.getCompound("biomes");
            if (biomes.isEmpty() || biomes.get().getListOrEmpty("palette").isEmpty()
                    || target.dimension.containerFactory.biomeContainerCodec()
                    .parse(NbtOps.INSTANCE, biomes.get()).error().isPresent()) return false;
            accepted++;
        }
        return accepted == count;
    }

    static boolean isKnownEmpty(TerrainCell cell) {
        // Exact internal marker only; real cached air-like/unknown colors retain prior behavior.
        return cell.sampleSize == 16 && "minecraft:air".equals(cell.block) && cell.color.isEmpty();
    }

    private static SurfaceTileReducer.Sample historicalSurfaceSample(HistoricalChunk target,
                                                                      SerializableChunkData data,
                                                                      Map<Integer, LevelChunkSection> sections,
                                                                      int localX, int localZ) {
        int surfaceY = surfaceHeight(data, target.dimension.heightAccessor, localX, localZ);
        BlockState state = blockStateAt(sections, localX, surfaceY, localZ);
        if (state == null || state.isAir()) {
            surfaceY = findSurfaceHeight(sections, target.dimension.heightAccessor, localX, localZ);
            state = blockStateAt(sections, localX, surfaceY, localZ);
        }
        if (state == null || state.isAir()) return null;
        String block = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        if ("minecraft:the_nether".equals(target.dimension.id) && block.endsWith(":bedrock")) {
            for (int y = surfaceY - 1; y >= target.dimension.heightAccessor.getMinY(); y--) {
                BlockState candidate = blockStateAt(sections, localX, y, localZ);
                if (candidate == null || candidate.isAir()) continue;
                String candidateBlock = BuiltInRegistries.BLOCK.getKey(candidate.getBlock()).toString();
                if (candidateBlock.endsWith(":bedrock")) continue;
                surfaceY = y;
                state = candidate;
                block = candidateBlock;
                break;
            }
        }
        LevelChunkSection section = sections.get(SectionPos.blockToSectionCoord(surfaceY));
        String biome = "";
        if (section != null) {
            biome = section.getNoiseBiome(localX >> 2, Math.floorMod(surfaceY, 16) >> 2, localZ >> 2)
                    .unwrapKey().map(key -> key.identifier().toString()).orElse("");
        }
        return new SurfaceTileReducer.Sample(localX, localZ, surfaceY,
                TerrainColorPalette.colorFor(block, biome), block);
    }

    private static int surfaceHeight(SerializableChunkData data, LevelHeightAccessor heightAccessor,
                                     int localX, int localZ) {
        long[] raw = data.heightmaps().get(Heightmap.Types.WORLD_SURFACE);
        if (raw == null) raw = data.heightmaps().get(Heightmap.Types.WORLD_SURFACE_WG);
        if (raw == null) return Integer.MIN_VALUE;
        try {
            SimpleBitStorage heights = new SimpleBitStorage(
                    Mth.ceillog2(heightAccessor.getHeight() + 1), 256, raw);
            return heights.get(localX + localZ * 16) + heightAccessor.getMinY() - 1;
        } catch (RuntimeException malformedHeightmap) {
            return Integer.MIN_VALUE;
        }
    }

    private static int findSurfaceHeight(Map<Integer, LevelChunkSection> sections,
                                         LevelHeightAccessor heightAccessor, int localX, int localZ) {
        // getMaxY() is inclusive in 26.2, including the highest legal block layer.
        for (int y = heightAccessor.getMaxY(); y >= heightAccessor.getMinY(); y--) {
            BlockState state = blockStateAt(sections, localX, y, localZ);
            if (state != null && !state.isAir()) return y;
        }
        return Integer.MIN_VALUE;
    }

    private static BlockState blockStateAt(Map<Integer, LevelChunkSection> sections,
                                           int localX, int y, int localZ) {
        if (y == Integer.MIN_VALUE) return null;
        LevelChunkSection section = sections.get(SectionPos.blockToSectionCoord(y));
        return section == null ? null : section.getBlockState(localX, Math.floorMod(y, 16), localZ);
    }

    private void queueLoadedTerrain(MinecraftServer server) {
        ServerLevel overworld = server.overworld();
        BlockPos spawn = overworld.getRespawnData().pos();
        queueAround(overworld, spawn.getX() >> 4, spawn.getZ() >> 4, 2);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            ServerLevel level = player.level();
            queueAround(level, player.chunkPosition().x(), player.chunkPosition().z(), SCAN_RADIUS_CHUNKS);
        }
        while (terrain.size() > MAX_CELLS) {
            evictOldestDetailedChunk();
        }
        while (coarseTerrain.size() > MAX_COARSE_CHUNKS) {
            String oldest = coarseTerrain.keySet().iterator().next();
            coarseTerrain.remove(oldest);
            terrainDirty = true;
            terrainRevision++;
        }
    }

    private void queueAround(ServerLevel level, int centerChunkX, int centerChunkZ, int radius) {
        for (int chunkZ = centerChunkZ - radius; chunkZ <= centerChunkZ + radius; chunkZ++) {
            for (int chunkX = centerChunkX - radius; chunkX <= centerChunkX + radius; chunkX++) {
                if (!queueChunk(level, chunkX, chunkZ, false)) return;
            }
        }
    }

    private void queueTouchedChunk(ServerLevel level, BlockPos pos) {
        queueChunk(level, pos.getX() >> 4, pos.getZ() >> 4, true);
    }

    private boolean queueChunk(ServerLevel level, int chunkX, int chunkZ, boolean force) {
        if (pendingChunks.size() >= MAX_PENDING_CHUNKS) return false;
        String key = chunkKey(level, chunkX, chunkZ);
        Long lastScanned = lastScannedChunks.get(key);
        if (!force && lastScanned != null && serverTicks - lastScanned < DETAILED_RESCAN_INTERVAL_TICKS) return true;
        if (queuedChunks.add(key)) pendingChunks.addLast(new ChunkScan(level, chunkX, chunkZ, key));
        return true;
    }

    private void scanPendingTerrain() {
        for (int count = 0; count < MAX_CHUNKS_PER_TICK && !pendingChunks.isEmpty(); count++) {
            ChunkScan scan = pendingChunks.removeFirst();
            queuedChunks.remove(scan.key);
            LevelChunk chunk = scan.level.getChunkSource().getChunkNow(scan.chunkX, scan.chunkZ);
            if (chunk != null) {
                scanChunk(scan.level, chunk, scan.chunkX, scan.chunkZ);
                lastScannedChunks.put(scan.key, serverTicks);
            }
        }
    }

    private void scanChunk(ServerLevel level, LevelChunk chunk, int chunkX, int chunkZ) {
        String dimension = level.dimension().identifier().toString();
        for (int localZ = 0; localZ < 16; localZ += SAMPLE_STEP) {
            for (int localX = 0; localX < 16; localX += SAMPLE_STEP) {
                scanTerrainCell(level, chunk, chunkX, chunkZ, localX, localZ, SAMPLE_STEP);
            }
        }
        updateCoarseFromLoadedSamples(dimension, chunkX, chunkZ);
        if (structureScannedChunks.add(chunkKey(level, chunkX, chunkZ))) scanStructures(level, chunk);
    }

    private void updateCoarseFromLoadedSamples(String dimension, int chunkX, int chunkZ) {
        String coarseKey = coarseTerrainKey(dimension, chunkX, chunkZ);
        TerrainCell representative = terrain.get(dimension + ':' + ((chunkX << 4) + 8) + ':' + ((chunkZ << 4) + 8));
        if (representative != null) {
            TerrainCell coarse = new TerrainCell(dimension, chunkX << 4, chunkZ << 4, representative.y,
                    representative.color, representative.block, 16);
            TerrainCell previous = coarseTerrain.put(coarseKey, coarse);
            // This complete live scan is finer than historical refinement and supersedes v2.
            boolean wasProvisional = provisionalCoarseChunks.remove(chunkKey(dimension, chunkX, chunkZ));
            if (!coarse.equals(previous) || wasProvisional) {
                terrainDirty = true;
                terrainRevision++;
            }
        }
    }

    private void evictOldestDetailedChunk() {
        if (terrain.isEmpty()) return;
        TerrainCell oldest = terrain.values().iterator().next();
        int chunkX = Math.floorDiv(oldest.x, 16);
        int chunkZ = Math.floorDiv(oldest.z, 16);
        boolean removed = removeDetailedChunkCells(oldest.dimension, chunkX, chunkZ);
        if (removed) {
            terrainDirty = true;
            terrainRevision++;
        }
    }

    private boolean removeDetailedChunkCells(String dimension, int chunkX, int chunkZ) {
        boolean removed = false;
        for (int localZ = 0; localZ < 16; localZ += SAMPLE_STEP) {
            for (int localX = 0; localX < 16; localX += SAMPLE_STEP) {
                removed |= terrain.remove(dimension + ':' + ((chunkX << 4) + localX) + ':'
                        + ((chunkZ << 4) + localZ)) != null;
            }
        }
        return removed;
    }

    private void scanStructures(ServerLevel level, LevelChunk chunk) {
        var registry = level.registryAccess().lookupOrThrow(Registries.STRUCTURE);
        for (Map.Entry<net.minecraft.world.level.levelgen.structure.Structure, StructureStart> entry
                : chunk.getAllStarts().entrySet()) {
            StructureStart start = entry.getValue();
            if (start == null || !start.isValid()) continue;
            var id = registry.getKey(entry.getKey());
            if (id == null) continue;
            BlockPos center = start.getBoundingBox().getCenter();
            String dimension = level.dimension().identifier().toString();
            String key = dimension + ':' + id + ':' + center.getX() + ':' + center.getZ();
            markers.put(key, new MapMarker("structure", id.toString(), dimension,
                    center.getX(), center.getZ()));
        }
    }

    private void scanTerrainCell(ServerLevel level, LevelChunk chunk, int chunkX, int chunkZ,
                                 int localX, int localZ, int sampleSize) {
        String dimension = level.dimension().identifier().toString();
        int x = (chunkX << 4) + localX;
        int z = (chunkZ << 4) + localZ;
        int y = chunk.getHeight(Heightmap.Types.WORLD_SURFACE, localX, localZ);
        BlockPos pos = new BlockPos(x, y, z);
        BlockState state = chunk.getBlockState(pos);
        String block = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        if ("minecraft:the_nether".equals(dimension) && block.endsWith(":bedrock")) {
            for (int candidateY = y - 1; candidateY >= level.getMinY(); candidateY--) {
                BlockPos candidatePos = new BlockPos(x, candidateY, z);
                BlockState candidateState = chunk.getBlockState(candidatePos);
                if (candidateState.isAir()) continue;
                String candidateBlock = BuiltInRegistries.BLOCK.getKey(candidateState.getBlock()).toString();
                if (candidateBlock.endsWith(":bedrock")) continue;
                y = candidateY;
                pos = candidatePos;
                state = candidateState;
                block = candidateBlock;
                break;
            }
        }
        String biome = level.getBiome(pos).unwrapKey().map(key -> key.identifier().toString()).orElse("");
        String key = dimension + ':' + x + ':' + z;
        int minecraftMapColor = state.getMapColor(level, pos).col;
        TerrainCell next = new TerrainCell(dimension, x, z, y,
                TerrainColorPalette.colorFor(block, biome, minecraftMapColor), block, sampleSize);
        TerrainCell previous = terrain.put(key, next);
        if (!next.equals(previous)) {
            terrainDirty = true;
            terrainRevision++;
        }
    }

    private void writeStatusSnapshot(MinecraftServer server) {
        CoalescingSnapshotWriter writer = statusWriter;
        if (writer == null || stopping) return;
        // Read Minecraft state only on this server thread. The worker receives immutable text,
        // never player/world objects, and replaces a pending snapshot instead of queuing more work.
        writer.submit(statusJson(server));
    }

    private void scheduleTerrainWrite(boolean forceCache) {
        Path directory = outputDirectory;
        ExecutorService io = terrainIo;
        if (directory == null || io == null || io.isShutdown()) return;
        if (!terrainDirty && publishedTerrainRevision == terrainRevision && !forceCache) return;
        if (!terrainWriteInFlight.compareAndSet(false, true)) {
            ticksUntilTerrainPublish = Math.min(ticksUntilTerrainPublish, 1);
            return;
        }

        long revision = terrainRevision;
        List<TerrainCell> coarseCells = List.copyOf(coarseTerrain.values());
        List<TerrainCell> detailedCells = List.copyOf(terrain.values());
        List<GeneratedRegion> coverage = generatedRegions;
        long now = System.currentTimeMillis();
        boolean writeCache = forceCache || lastTerrainCacheWrite == 0L
                || now - lastTerrainCacheWrite >= TERRAIN_CACHE_INTERVAL_MS;
        String cacheHeader = cacheHeaderForCurrentCoverage();
        List<TerrainCell> cells = writeCache
                ? combineTerrainLayers(coarseCells, detailedCells) : List.of();
        io.execute(() -> {
            boolean terrainWritten = false;
            try {
                Files.createDirectories(directory);
                Path target = directory.resolve("terrain.json");
                Path temporary = directory.resolve("terrain.json.tmp");
                writeAtomically(temporary, target, terrainJson(coarseCells, detailedCells, coverage, revision));
                publishedTerrainRevision = revision;
                terrainWritten = true;
            } catch (IOException error) {
                LOGGER.warn("Could not publish native terrain tiles: {}", error.getMessage());
            }
            if (writeCache) {
                try {
                    writeTerrainCache(directory, cells, cacheHeader);
                    lastTerrainCacheWrite = System.currentTimeMillis();
                } catch (IOException error) {
                    LOGGER.warn("Could not save native terrain cache: {}", error.getMessage());
                }
            }
            if (terrainWritten && terrainRevision == revision) terrainDirty = false;
            terrainWriteInFlight.set(false);
        });
    }

    private static List<TerrainCell> combineTerrainLayers(List<TerrainCell> coarseCells,
                                                           List<TerrainCell> detailedCells) {
        List<TerrainCell> cells = new ArrayList<>(coarseCells.size() + detailedCells.size());
        cells.addAll(coarseCells);
        cells.addAll(detailedCells);
        return List.copyOf(cells);
    }

    private void loadTerrainCache() throws IOException {
        Path cache = outputDirectory.resolve("terrain.tsv");
        if (!Files.isRegularFile(cache)) {
            if (Files.isRegularFile(outputDirectory.resolve("terrain.json"))) {
                terrainRevision = 1L;
                terrainDirty = true;
            }
            return;
        }
        Map<String, List<TerrainCell>> legacyChunks = new LinkedHashMap<>();
        List<TerrainCell> currentCells = new ArrayList<>();
        int acceptedRows = 0;
        boolean migratingV2;
        try (BufferedReader reader = Files.newBufferedReader(cache, StandardCharsets.UTF_8)) {
            String header = reader.readLine();
            migratingV2 = PROVISIONAL_TERRAIN_CACHE_HEADER.equals(header);
            if (!TERRAIN_CACHE_HEADER.equals(header) && !migratingV2) {
                LOGGER.info("Ignoring an older terrain cache so corrected surface colors can be indexed.");
                terrainRevision = 1L;
                terrainDirty = true;
                return;
            }
            String line;
            while ((line = reader.readLine()) != null && acceptedRows < MAX_CELLS + MAX_COARSE_CHUNKS) {
                String[] columns = line.split("\\t", -1);
                if (columns.length != 7 && columns.length != 8) continue;
                try {
                    boolean legacy = columns.length == 7;
                    int x = Integer.parseInt(columns[1]);
                    int z = Integer.parseInt(columns[2]);
                    int sampleSize = legacy ? SAMPLE_STEP : Integer.parseInt(columns[6]);
                    TerrainCell cell = new TerrainCell(columns[0], x, z, Integer.parseInt(columns[3]),
                            cacheColor(columns[0], columns[4], columns[5], sampleSize, legacy, migratingV2), columns[5],
                            sampleSize);
                    if (legacy) {
                        String chunkKey = columns[0] + ':' + Math.floorDiv(x, 16) + ':' + Math.floorDiv(z, 16);
                        legacyChunks.computeIfAbsent(chunkKey, ignored -> new ArrayList<>()).add(cell);
                    } else {
                        currentCells.add(cell);
                    }
                    acceptedRows++;
                } catch (RuntimeException ignored) {
                    // Ignore a malformed cache row without discarding the rest of the map.
                }
            }
        }

        for (List<TerrainCell> chunkCells : legacyChunks.values()) {
            if (chunkCells.isEmpty()) continue;
            TerrainCell representative = chunkCells.stream()
                    .filter(cell -> Math.floorMod(cell.x, 16) == 8 && Math.floorMod(cell.z, 16) == 8)
                    .findFirst().orElse(chunkCells.get(0));
            int chunkX = Math.floorDiv(representative.x, 16);
            int chunkZ = Math.floorDiv(representative.z, 16);
            TerrainCell coarse = new TerrainCell(representative.dimension, chunkX << 4, chunkZ << 4,
                    representative.y, representative.color, representative.block, 16);
            coarseTerrain.put(coarseTerrainKey(representative.dimension, chunkX, chunkZ), coarse);

            boolean singleBackfillSample = chunkCells.size() == 1
                    && Math.floorMod(representative.x, 16) == 8 && Math.floorMod(representative.z, 16) == 8;
            if (!singleBackfillSample) {
                for (TerrainCell cell : chunkCells) terrain.put(terrainKey(cell), cell);
            }
        }
        for (TerrainCell cell : currentCells) {
            if (cell.sampleSize >= 16) {
                coarseTerrain.put(coarseTerrainKey(cell.dimension, Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16)), cell);
            } else {
                terrain.put(terrainKey(cell), cell);
            }
        }
        while (terrain.size() > MAX_CELLS) evictOldestDetailedChunk();
        while (coarseTerrain.size() > MAX_COARSE_CHUNKS) {
            coarseTerrain.remove(coarseTerrain.keySet().iterator().next());
        }
        if (migratingV2) {
            for (TerrainCell cell : coarseTerrain.values()) {
                if (isKnownEmpty(cell)) continue; // Confirmed full void, even in a mixed migration cache.
                provisionalCoarseChunks.add(chunkKey(cell.dimension,
                        Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16)));
            }
            LOGGER.info("Preserved {} cached saved chunks as provisional coverage while v3 refines them in the background.",
                    provisionalCoarseChunks.size());
        }
        terrainRevision = (long) terrain.size() + coarseTerrain.size();
        terrainDirty = terrainRevision > 0;
    }

    private static void writeTerrainCache(Path directory, List<TerrainCell> cells, String header) throws IOException {
        StringBuilder body = new StringBuilder(Math.max(4_096, cells.size() * 60));
        body.append(header).append('\n');
        for (TerrainCell cell : cells) {
            body.append(cell.dimension).append('\t').append(cell.x).append('\t').append(cell.z).append('\t')
                    .append(cell.y).append('\t').append(cell.color).append('\t').append(cell.block).append('\t')
                    .append(cell.sampleSize).append('\t').append(terrainKey(cell)).append('\n');
        }
        Path target = directory.resolve("terrain.tsv");
        Path temporary = directory.resolve("terrain.tsv.tmp");
        writeAtomically(temporary, target, body.toString());
    }

    private String cacheHeaderForCurrentCoverage() {
        return provisionalCoarseChunks.isEmpty() ? TERRAIN_CACHE_HEADER : PROVISIONAL_TERRAIN_CACHE_HEADER;
    }

    private String statusJson(MinecraftServer server) {
        StringBuilder json = new StringBuilder(8_192);
        json.append("{\"version\":3,\"generatedAt\":").append(System.currentTimeMillis())
                .append(",\"terrainRevision\":").append(publishedTerrainRevision).append(",\"players\":[");
        List<ServerPlayer> players = new ArrayList<>(server.getPlayerList().getPlayers());
        players.sort(Comparator.comparing(player -> player.getGameProfile().name(), String.CASE_INSENSITIVE_ORDER));
        for (int i = 0; i < players.size(); i++) {
            if (i > 0) json.append(',');
            ServerPlayer player = players.get(i);
            json.append("{\"name\":\"").append(escape(player.getGameProfile().name()))
                    .append("\",\"uuid\":\"").append(player.getUUID())
                    .append("\",\"dimension\":\"").append(escape(player.level().dimension().identifier().toString()))
                    .append("\",\"x\":").append(number(player.getX()))
                    .append(",\"y\":").append(number(player.getY()))
                    .append(",\"z\":").append(number(player.getZ()))
                    .append(",\"yaw\":").append(number(player.getYRot())).append('}');
        }
        json.append("],\"markers\":[");
        int markerIndex = 0;
        ServerLevel overworld = server.overworld();
        BlockPos spawn = overworld.getRespawnData().pos();
        json.append("{\"kind\":\"spawn\",\"id\":\"minecraft:spawn\",\"dimension\":\"minecraft:overworld\",\"x\":")
                .append(spawn.getX()).append(",\"z\":").append(spawn.getZ()).append('}');
        markerIndex++;
        for (MapMarker marker : markers.values()) {
            if (markerIndex++ > 0) json.append(',');
            json.append("{\"kind\":\"").append(escape(marker.kind)).append("\",\"id\":\"")
                    .append(escape(marker.id)).append("\",\"dimension\":\"")
                    .append(escape(marker.dimension)).append("\",\"x\":").append(marker.x)
                    .append(",\"z\":").append(marker.z).append('}');
        }
        json.append("],\"terrainIndex\":{\"total\":").append(historicalTotalChunks)
                .append(",\"indexed\":").append(historicalCompletedChunks.get())
                .append(",\"failed\":").append(historicalFailedChunks.get())
                .append(",\"omitted\":").append(historicalOmittedChunks)
                .append(",\"remaining\":").append(historicalChunks.size() + historicalReadsInFlight.get())
                .append(",\"discovering\":").append(historicalDiscoveryInFlight.get()).append('}');
        return json.append('}').toString();
    }

    private static String terrainJson(List<TerrainCell> coarseCells, List<TerrainCell> detailedCells,
                                      List<GeneratedRegion> coverage, long revision) {
        StringBuilder json = new StringBuilder(Math.max(8_192, (coarseCells.size() + detailedCells.size()) * 62));
        json.append("{\"version\":1,\"generatedAt\":").append(System.currentTimeMillis())
                .append(",\"terrainRevision\":").append(revision).append(",\"generatedRegions\":[");
        for (int index = 0; index < coverage.size(); index++) {
            if (index > 0) json.append(',');
            GeneratedRegion region = coverage.get(index);
            json.append("[\"").append(escape(region.dimension)).append("\",")
                    .append(region.regionX).append(',').append(region.regionZ).append(",\"")
                    .append(region.chunks).append("\"]");
        }
        json.append("],\"coarseTerrain\":[");
        appendTerrainJson(json, coarseCells);
        json.append("],\"terrain\":[");
        appendTerrainJson(json, detailedCells);
        return json.append("]}").toString();
    }

    static void appendTerrainJson(StringBuilder json, List<TerrainCell> cells) {
        int written = 0;
        for (TerrainCell cell : cells) {
            if (isKnownEmpty(cell)) continue;
            if (written++ > 0) json.append(',');
            json.append("[\"").append(escape(cell.dimension)).append("\",")
                    .append(cell.x).append(',').append(cell.z).append(',').append(cell.y)
                    .append(",\"").append(cell.color).append("\",\"").append(escape(cell.block)).append("\",")
                    .append(cell.sampleSize).append(']');
        }
    }

    private static String terrainKey(TerrainCell cell) {
        if (cell.sampleSize >= 16) {
            return coarseTerrainKey(cell.dimension, Math.floorDiv(cell.x, 16), Math.floorDiv(cell.z, 16));
        }
        return cell.dimension + ':' + cell.x + ':' + cell.z;
    }

    private static String coarseTerrainKey(String dimension, int chunkX, int chunkZ) {
        return dimension + ':' + chunkX + ':' + chunkZ + ":coarse";
    }

    private static String chunkKey(ServerLevel level, int chunkX, int chunkZ) {
        return chunkKey(level.dimension().identifier().toString(), chunkX, chunkZ);
    }

    private static String chunkKey(String dimension, int chunkX, int chunkZ) {
        return dimension + ':' + chunkX + ':' + chunkZ;
    }

    private static String cacheColor(String dimension, String color, String block, int sampleSize,
                                     boolean legacyChunkSample, boolean migratingV2) {
        if (sampleSize == 16 && "minecraft:air".equals(block) && color.isEmpty()) return color;
        if ((legacyChunkSample || migratingV2)
                && "minecraft:the_nether".equals(dimension) && block.endsWith(":bedrock")) {
            return "#67383a";
        }
        if (migratingV2 && block != null && !block.isBlank()) {
            return TerrainColorPalette.colorFor(block, "");
        }
        return color;
    }

    private static void writeAtomically(Path temporary, Path target, String body) throws IOException {
        Files.writeString(temporary, body, StandardCharsets.UTF_8);
        try {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException unsupportedAtomicMove) {
            Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static int blockToChunk(double blockCoordinate) {
        long floored = (long) Math.floor(blockCoordinate);
        long chunk = Math.floorDiv(floored, 16L);
        return (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, chunk));
    }

    private static double averageTickMillis(MinecraftServer server) {
        long nanos = server.getAverageTickTimeNanos();
        return nanos <= 0L ? 0.0D : nanos / 1_000_000.0D;
    }

    private static String number(double value) {
        return String.format(Locale.ROOT, "%.2f", value);
    }

    private static String escape(String value) {
        return String.valueOf(value).replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }

    record TerrainCell(String dimension, int x, int z, int y, String color, String block, int sampleSize) {}
    private record ChunkScan(ServerLevel level, int chunkX, int chunkZ, String key) {}
    record HistoricalDimension(ServerLevel level, LevelHeightAccessor heightAccessor,
                                       PalettedContainerFactory containerFactory, Path regionDirectory, String id,
                                       int focusChunkX, int focusChunkZ, int minChunkX, int maxChunkX,
                                       int minChunkZ, int maxChunkZ, int priority) {
        private boolean containsChunk(int chunkX, int chunkZ) {
            return chunkX >= minChunkX && chunkX <= maxChunkX
                    && chunkZ >= minChunkZ && chunkZ <= maxChunkZ;
        }

        private boolean intersectsRegion(int regionX, int regionZ) {
            long minX = (long) regionX * 32L;
            long minZ = (long) regionZ * 32L;
            long maxX = minX + 31L;
            long maxZ = minZ + 31L;
            return maxX >= minChunkX && minX <= maxChunkX
                    && maxZ >= minChunkZ && minZ <= maxChunkZ;
        }
    }
    record HistoricalChunk(HistoricalDimension dimension, int chunkX, int chunkZ, int attempt) {
        private long distanceFromFocus() {
            long deltaX = (long) chunkX - dimension.focusChunkX;
            long deltaZ = (long) chunkZ - dimension.focusChunkZ;
            return deltaX * deltaX + deltaZ * deltaZ;
        }

        private HistoricalChunk retry() {
            return new HistoricalChunk(dimension, chunkX, chunkZ, attempt + 1);
        }
    }
    record HistoricalSurface(TerrainCell coarse, List<TerrainCell> details) {}
    private record GeneratedRegion(String dimension, int regionX, int regionZ, String chunks) {}
    private record MapMarker(String kind, String id, String dimension, int x, int z) {}
}
