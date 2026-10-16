const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('minecraft-server/main.js');
const mapData = read('minecraft-server/world-map-data.js');
const preload = read('preload.js');
const mapPreload = read('world-map-preload.js');
const html = read('world-map.html');
const renderer = read('world-map.js');
const css = read('world-map.css');
const index = read('index.html');
const serverUi = read('minecraft-server-ui.js');
const updateBuilder = read('build-development-update.ps1');
const modRoot = path.join(root, 'minecraft-server', 'click-interval-map-fabric');

assert.match(index, /id="msOpenConsoleWindow"[\s\S]*id="msOpenWorldMap"[\s\S]*id="msOpenFolder"/,
  'the map launcher should sit beside Console in the server workspace');
assert.match(serverUi, /msOpenWorldMap[\s\S]*api\.openWorldMap/,
  'the embedded workspace should open the separate map window');
assert.match(preload, /openWorldMap:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('world-map:open'\)/,
  'the host preload should expose only the map-open IPC method');
assert.match(main, /async function createWorldMapWindow\(options = \{\}\)[\s\S]*new BrowserWindow\(/,
  'the map should use its own BrowserWindow');
assert.doesNotMatch(main.match(/async function createWorldMapWindow\(options = \{\}\)[\s\S]*?return getWorldMapStatus\(\);\n}/)?.[0] || '', /startServer|stopServer|restartServer/,
  'opening the map must not change the server lifecycle');
assert.doesNotMatch(main.match(/async function createWorldMapWindow\(options = \{\}\)[\s\S]*?return getWorldMapStatus\(\);\n}/)?.[0] || '', /webSecurity:\s*false/,
  'the map window must not disable Electron web security');

assert.doesNotMatch(html, /iframe|frame-src|squaremap/i,
  'the native map must not embed or connect to squaremap');
assert.match(html, /id="mapCanvas"/, 'the native map should provide a canvas');
assert.match(html, /data-dimension="minecraft:overworld"[\s\S]*data-dimension="minecraft:the_nether"[\s\S]*data-dimension="minecraft:the_end"/,
  'the native canvas should expose all three dimensions');
assert.doesNotMatch(html, /Bridge unavailable/,
  'fake unavailable layers must stay removed');
assert.match(html, /data-map-layer="grid"[\s\S]*data-map-layer="slime"[\s\S]*id="structureLayers"/,
  'the map should expose working fixed-chunk, slime, and structure layer controls');
assert.match(css, /#mapCanvas[\s\S]*cursor:\s*grab/,
  'the terrain canvas should visibly support panning');
assert.match(renderer, /function createTerrainTile\([\s\S]*document\.createElement\('canvas'\)[\s\S]*tileContext\.fillRect/,
  'visible terrain samples should be rasterized lazily into reusable native canvas tiles');
assert.match(renderer, /function drawTerrainTiles\(\)[\s\S]*context\.drawImage\(tile\.canvas/,
  'wide-map frames should composite cached tiles instead of repainting every terrain sample');
assert.match(renderer, /TERRAIN_TILE_PIXELS = TERRAIN_BUCKET_SIZE \/ TERRAIN_RASTER_STEP/,
  'terrain tiles should use the four-block sample resolution instead of full-size transparent canvases');
assert.match(renderer, /rangeArea <= Math\.max\(4096, coordinates\.length \* 3\)[\s\S]*for \(const coordinate of coordinates\)/,
  'extreme whole-world views should iterate occupied buckets instead of billions of empty coordinates');
assert.match(renderer, /function createTerrainGlobalOverview\([\s\S]*MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS[\s\S]*overviewRenderableCells/,
  'far-out saved chunks should use a bounded whole-dimension overview instead of churning the tile cache');
assert.match(renderer, /function rebuildGeneratedCoverageIndex\([\s\S]*decodeGeneratedRegion[\s\S]*generatedMainBoundsByDimension/,
  'region-header coverage should expose every generated chunk while its surface color is still indexing');
assert.match(renderer, /function drawTerrainLayer\(\) \{[\s\S]*drawGeneratedCoverage\(\);[\s\S]*drawTerrainTiles\(\);/,
  'generated-but-not-yet-colored chunks should render as a seamless muted underlay');
assert.match(renderer, /WORLD_BORDER_OUTLIER_START = 29_900_000[\s\S]*isWorldBorderOutlier\(x, z\)[\s\S]*continue/,
  'isolated hard-border chunks must not poison ordinary terrain bounds and canvas precision');
assert.match(renderer, /function mapViewport\([\s\S]*AXIS_LEFT_WIDTH[\s\S]*AXIS_BOTTOM_HEIGHT[\s\S]*function screenPoint/,
  'map transforms should reserve the coordinate rulers instead of fitting terrain underneath them');
assert.match(renderer, /function coordinateSpacing\([\s\S]*minimumPixels \/ Math\.max\(scale/,
  'coordinate ruler spacing should expand as the user zooms out');
assert.match(renderer, /function drawAxes\(\)[\s\S]*--theme-surface[\s\S]*fillText\('X'[\s\S]*fillText\('Z'/,
  'the canvas should use themed compact X and Z coordinate rulers');
assert.doesNotMatch(renderer, /--theme-panel/,
  'the ruler must not fall back from an undefined theme variable');
assert.match(renderer, /addEventListener\('wheel'[\s\S]*addEventListener\('pointerdown'/,
  'the native map should support zooming and panning');
assert.match(renderer, /api\.onPlayers\(\(\) => refresh\(\)\)/,
  'player events must refresh the authoritative native snapshot instead of merging stale names');
assert.match(renderer, /drawImage\(head, 8, 8, 8, 8/,
  'player markers should use the authenticated Minecraft skin head when it is available');
const rendererDraw = renderer.match(/function draw\(\) \{[\s\S]*?\n\}/)?.[0] || '';
assert(rendererDraw.indexOf('context.clip();') < rendererDraw.indexOf('drawTerrainLayer();')
  && rendererDraw.indexOf('drawTerrainLayer();') < rendererDraw.indexOf('drawPlayerMarker(player, point, selected);')
  && rendererDraw.indexOf('drawPlayerMarker(player, point, selected);') < rendererDraw.indexOf('drawAxes();'),
  'markers must be clipped to terrain and coordinate rulers must remain unobstructed on top');
assert.match(renderer, /function terrainGlobalOverviewScale\(dimension\) \{\s*const bounds = terrainBoundsByDimension\.get\(dimension\)/,
  'far zoom must retain disconnected saved areas instead of cropping to the largest component');
assert.match(renderer, /terrainMainBoundsByDimension[\s\S]*function mainTerrainBounds\(dimension\)[\s\S]*terrainMainBoundsByDimension\.set/,
  'main connected bounds should be cached instead of recomputed on every frame');
assert.match(mapPreload, /getPlayerSkin: player => ipcRenderer\.invoke\('players:getSkin', player\)/,
  'the sandboxed map preload should expose the existing bounded player-skin lookup');

assert.match(main, /NATIVE_WORLD_MAP_JAR = 'ClickIntervalMap-Fabric\.jar'/,
  'the host should manage the native Fabric map module');
assert.match(main, /nativeWorldMapSnapshot:\s*path\.join\(root, 'click-interval-map', 'snapshot\.json'\)/,
  'the host should read the native snapshot file');
assert.match(main, /nativeWorldMapTerrain:\s*path\.join\(root, 'click-interval-map', 'terrain\.json'\)/,
  'large terrain data should use a separate snapshot file');
assert.match(main, /MAX_NATIVE_WORLD_MAP_BYTES[\s\S]*MAX_NATIVE_WORLD_MAP_TERRAIN_BYTES[\s\S]*NATIVE_WORLD_MAP_FRESH_MS/,
  'native status and terrain reads must be independently bounded and freshness checked');
assert.match(main, /const fresh = Boolean\(status && serverState === 'running'[\s\S]*Date\.now\(\) - status\.generatedAt <= NATIVE_WORLD_MAP_FRESH_MS\)/,
  'offline or stale player arrays must be discarded');
assert.match(main, /players:\s*fresh \? status\.players : \[\]/,
  'only a fresh server-authored online-player list should reach the map');
assert.match(mapData, /coarseTerrain = normalizeTerrainCells[\s\S]*detailedTerrain = normalizeTerrainCells[\s\S]*terrain: \[\.\.\.coarseTerrain, \.\.\.detailedTerrain\]/,
  'coarse coverage must reach the renderer before the bounded detailed overlay');
assert.match(mapData, /function normalizeGeneratedRegions[\s\S]*decoded\.length !== 128[\s\S]*generatedRegions: normalizeGeneratedRegions/,
  'compact generated-chunk masks should be bounded and validated before reaching the renderer');
assert.match(main, /async function readNativeWorldMapTerrain\(paths\) \{\s*return nativeWorldMapTerrainReader\.read/,
  'large terrain JSON decoding must be delegated to the bounded worker reader');
assert.match(mapData, /new Worker\(__filename[\s\S]*resourceLimits:[\s\S]*maxOldGenerationSizeMb: 512[\s\S]*pending\.has\(resolved\)/,
  'terrain decoding must limit worker memory and share simultaneous reads');
assert.match(main, /function normalizeLegacyWorldMapTerrainCells[\s\S]*chunks\.get\(key\)[\s\S]*chunk\.length === 1[\s\S]*x: chunkX \* 16[\s\S]*size: 16[\s\S]*underlays\.push/,
  'legacy chunks should receive seamless dominant-color coverage beneath retained detail');
assert.match(main, /terrain: terrainUnchanged \? \[\] : nativeSnapshot\.terrain/,
  'unchanged native terrain should not be recopied across IPC on every player refresh');
assert.match(main, /const terrainToken = `\$\{profile\.id\}:\$\{seedMetadata\.worldToken \|\| config\.levelName\}:\$\{terrainRevision\}`[\s\S]*String\(knownTerrainToken\) === terrainToken/,
  'terrain identity must include the profile and world so equal revisions cannot leak terrain across servers or world resets');
assert.match(main, /const terrainPromise = readNativeWorldMapTerrain\(paths\)[\s\S]*const terrainFile = await terrainPromise/,
  'terrain reads must survive a missing, corrupt, or oversized status snapshot');
assert.match(renderer, /next\?\.terrainUnchanged[\s\S]*next\.terrain = snapshot\.terrain/,
  'the renderer should retain its indexed terrain when a lightweight snapshot omits unchanged cells');
assert.match(renderer, /api\.getSnapshot\(snapshot\?\.terrainToken \|\| ''\)/,
  'the renderer should use the profile-scoped terrain identity token');
assert.match(main, /async function ensureWorldMapFabricApiBeforeStart[\s\S]*findBundledFabricApiArtifact[\s\S]*publishStagedFileIfAbsent/,
  'enabling the native map must safely install its pinned Fabric API dependency when missing');
assert.match(main, /serverToolMutationCoordinator\.run\(`world-map:\$\{profileId\}:\$\{action\}`/,
  'map enable and disable requests should serialize with profile and server-tool changes');
assert.match(main, /applyQueuedWorldMapChangeBeforeStart[\s\S]*!isWorldMapRuntimeSupported\(config\)[\s\S]*disabled-world-map[\s\S]*ensureWorldMapFabricApiBeforeStart/,
  'startup must quarantine the native map on incompatible runtimes and only refresh it on Fabric 26.2');
assert.match(main, /Retired \$\{entry\.name\}; the native Click Interval map engine replaces it/,
  'squaremap jars should be retired recoverably before startup');
const applyIndex = main.indexOf('applyQueuedWorldMapChangeBeforeStart(paths, revalidateStartupProfile)');
const spawnIndex = main.indexOf('processRef = await launchPersistentProcess', applyIndex);
assert(applyIndex >= 0 && spawnIndex > applyIndex,
  'the native map module must be verified before Java starts');

assert.ok(fs.existsSync(path.join(modRoot, 'dist', 'ClickIntervalMap-Fabric-1.1.1+mc26.2.jar')),
  'the built native Fabric map artifact should exist');
const modSource = fs.readFileSync(path.join(modRoot, 'src', 'main', 'java', 'com', 'clickinterval', 'map', 'fabric', 'ClickIntervalMapFabric.java'), 'utf8');
assert.match(modSource, /ServerTickEvents\.END_SERVER_TICK[\s\S]*scanPendingTerrain[\s\S]*queueLoadedTerrain[\s\S]*writeStatusSnapshot/,
  'the Fabric module should spread loaded-terrain sampling across a bounded per-tick queue');
assert.match(modSource, /ServerChunkEvents\.CHUNK_LOAD\.register[\s\S]*queueChunk/,
  'every chunk load should enter the native terrain sampling queue');
assert.match(modSource, /PlayerBlockBreakEvents\.AFTER\.register[\s\S]*queueTouchedChunk[\s\S]*UseBlockCallback\.EVENT\.register[\s\S]*queueTouchedChunk/,
  'player terrain edits should queue an incremental refresh without polling the whole world');
assert.match(modSource, /TERRAIN_IO_THREADS = 3[\s\S]*Executors\.newFixedThreadPool\(TERRAIN_IO_THREADS[\s\S]*scheduleTerrainWrite[\s\S]*terrainJson/,
  'terrain parsing and serialization should run on bounded I/O workers rather than the Minecraft tick thread');
assert.match(modSource, /legacyChunks\.computeIfAbsent[\s\S]*singleBackfillSample[\s\S]*coarseTerrain\.put/,
  'legacy rows should be grouped so one-sample chunks become coarse coverage without collapsing detailed chunks');
assert.match(modSource, /MAX_COARSE_CHUNKS = 500_000[\s\S]*coarseTerrain[\s\S]*evictOldestDetailedChunk/,
  'detailed eviction must retain a bounded coarse chunk underneath instead of reopening map holes');
assert.match(modSource, /server\.getPlayerList\(\)\.getPlayers\(\)/,
  'the Fabric module should source online players directly from Minecraft');
assert.match(modSource, /getChunkNow\(/,
  'terrain scans must only inspect already-loaded chunks');
assert.match(modSource, /server\.overworld\(\)[\s\S]*getRespawnData\(\)\.pos\(\)[\s\S]*queueAround\(overworld[\s\S]*2\)/,
  'loaded spawn terrain should render even when no players are online');
assert.match(modSource, /loadTerrainCache\(\)[\s\S]*terrain\.tsv[\s\S]*writeTerrainCache\(/,
  'explored terrain should persist across server restarts and empty-player periods');
assert.match(modSource, /MAX_CELLS = 250_000/,
  'persistent native terrain memory must remain bounded');
assert.match(modSource, /MAX_HISTORICAL_READS = 6[\s\S]*historicalReadsInFlight\.get\(\) < MAX_HISTORICAL_READS[\s\S]*chunkMap\.read\(new ChunkPos/,
  'historical region indexing should use bounded parallel background reads for useful saved-world coverage');
assert.match(modSource, /MAX_HISTORICAL_STARTS_PER_TICK = 1[\s\S]*starts < MAX_HISTORICAL_STARTS_PER_TICK/,
  'historical reads must enter the bounded queue gradually instead of spiking a server tick');
assert.match(modSource, /HISTORICAL_PAUSE_TICK_MS[\s\S]*getAverageTickTimeNanos/,
  'saved-world backfill should pause automatically when the server tick time is elevated');
assert.match(modSource, /historicalIndexingLastTick && !indexingSavedTerrain[\s\S]*ticksUntilTerrainPublish = Math\.min\(ticksUntilTerrainPublish, 1\)/,
  'the final saved-world terrain batch should publish immediately when indexing completes');
assert.match(modSource, /REGION_FILE[\s\S]*FileChannel\.open[\s\S]*SerializableChunkData\.parse/,
  'the map should discover generated region entries and parse stored chunk data without generation');
assert.match(modSource, /byte\[\] generated = new byte\[128\][\s\S]*Base64\.getEncoder\(\)\.encodeToString[\s\S]*generatedRegions/,
  'region headers should publish exact compact coverage before slow surface coloring finishes');
assert.match(modSource, /storedDataVersion == currentDataVersion[\s\S]*\? stored[\s\S]*upgradeChunkTag/,
  'current-version chunks should bypass the expensive DataFixer while old chunks stay supported');
assert.match(modSource, /regionSize < 8_192L[\s\S]*intersectsRegion[\s\S]*sectorOffset < 2[\s\S]*containsChunk/,
  'empty, malformed, and out-of-world-border region entries must be ignored before chunk reads');
assert.doesNotMatch(modSource, /\.getChunk\(|addTicket\(|RandomAccessFile/,
  'historical backfill must never synchronously load, generate, or ticket chunks');
assert.doesNotMatch(modSource, /getHeight\(Heightmap\.Types\.WORLD_SURFACE, localX, localZ\)\s*-\s*1/,
  'loaded terrain sampling must not subtract twice and turn grass into dirt');
assert.match(modSource, /"minecraft:the_nether"\.equals\(dimension\)[\s\S]*candidateY = y - 1[\s\S]*candidateState\.isAir\(\)[\s\S]*candidateBlock\.endsWith\(":bedrock"\)/,
  'live Nether samples should descend below the roof instead of painting the map as bedrock');
assert.match(modSource, /surfaceHeight\([\s\S]*get\(localX \+ localZ \* 16\) \+ heightAccessor\.getMinY\(\) - 1/,
  'raw stored heightmaps should continue converting first-available height to the top block once');
assert.match(modSource, /TERRAIN_CACHE_HEADER = "# click-interval-map-cache-v3"[\s\S]*PROVISIONAL_TERRAIN_CACHE_HEADER = "# click-interval-map-cache-v2"[\s\S]*migratingV2[\s\S]*provisionalCoarseChunks\.add/,
  'v2 coverage should remain immediately visible while corrected v3 terrain is refined in the background');
assert.match(modSource, /cacheHeaderForCurrentCoverage[\s\S]*provisionalCoarseChunks\.isEmpty\(\) \? TERRAIN_CACHE_HEADER : PROVISIONAL_TERRAIN_CACHE_HEADER/,
  'an interrupted migration must remain provisional and resume on the next server start');
assert.match(modSource, /cacheColor\([\s\S]*migratingV2[\s\S]*TerrainColorPalette\.colorFor/,
  'provisional cache rows should receive safe palette repairs before their background refinement');
assert.match(modSource, /MAX_HISTORICAL_DETAIL_CELLS = 160_000[\s\S]*terrain\.size\(\) >= MAX_HISTORICAL_DETAIL_CELLS[\s\S]*SurfaceTileReducer\.reduce/,
  'historical quadrant detail should improve color variety while preserving a hard memory ceiling');
assert.match(modSource, /DETAILED_RESCAN_INTERVAL_TICKS = 400[\s\S]*lastScannedChunks/,
  'periodic player-radius scans should be throttled instead of saturating every five seconds');

assert.match(mapPreload, /disable:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('world-map:remove'\)/,
  'the map window should let owners disable the native map entirely');
assert.match(mapPreload, /install:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('world-map:install'\)/,
  'the map window should let owners re-enable a disabled native map');
assert.match(main, /ipcMain\.handle\('world-map:install', installWorldMap\)[\s\S]*ipcMain\.handle\('world-map:remove', removeWorldMap\)/,
  'native map enable and disable controls should reach the serialized server-tool workflow');
assert.doesNotMatch(mapPreload, /renderTerrain|world-map:export/,
  'the map renderer should not expose legacy squaremap operations');
for (const file of ['world-map.html', 'world-map.js', 'world-map.css', 'world-map-preload.js']) {
  assert.ok(updateBuilder.includes(`'${file}'`), `${file} should ship in app updates`);
}

console.log('minecraft native world map checks passed');
