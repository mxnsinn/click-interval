const api = window.worldMap;
const $ = id => document.getElementById(id);
const canvas = $('mapCanvas');
const context = canvas.getContext('2d', { alpha: false });
const empty = $('mapEmpty');
const playerList = $('playerList');
const search = $('playerSearch');
const selectedPanel = $('selectedPlayer');
const moderationForm = $('moderationForm');
const durationRow = $('durationRow');

let snapshot = null;
let selectedName = '';
let selectedDimension = 'minecraft:overworld';
let moderationAction = '';
let refreshBusy = false;
let refreshTimer = null;
let scale = 0.55;
let centerX = 0;
let centerZ = 0;
let fittedDimension = '';
let dragging = false;
let dragStart = null;
let pointerMoved = false;
let terrainBuckets = new Map();
let terrainTiles = new Map();
let terrainCountsByDimension = new Map();
let terrainBoundsByDimension = new Map();
let terrainMainBoundsByDimension = new Map();
let terrainBucketCoordinatesByDimension = new Map();
let terrainOverviewBuckets = new Map();
let terrainOverviewTiles = new Map();
let terrainOverviewBucketCoordinatesByDimension = new Map();
let terrainGlobalOverviews = new Map();
let generatedRegionsByDimension = new Map();
let generatedRegionTiles = new Map();
let generatedBoundsByDimension = new Map();
let generatedMainBoundsByDimension = new Map();
let generatedChunkCountsByDimension = new Map();
let hiddenWorldBorderChunks = 0;
let terrainGeneration = 0;
let fittedTerrainGeneration = -1;
let drawFrame = 0;
let terrainTileClock = 0;
let cachedTheme = null;
const playerHeadImages = new Map();
const pendingPlayerHeads = new Set();
const failedPlayerHeads = new Map();
const markerImages = new Map();
const layerSettings = { grid: false, slime: false, seed: true, players: true, offline: false, structures: true, hiddenStructures: new Set() };
let layerSignature = '';
let slimeResult = null;
let terrainLayer = null;
let terrainLayerKey = '';
let seedResult = null;
let seedRaster = null;
let seedRequest = '';
let overlayTimer = null;
let overlayRetryAt = 0;
let rasterDeadline = 0;
let rasterIdleScheduled = false;
let rasterWorldToken = '';
let terrainIndexEpoch = 0;
let refreshAgain = false;
const rasterJobs = new Map();
const TERRAIN_BUCKET_SIZE = 128;
const TERRAIN_RASTER_STEP = 4;
const TERRAIN_TILE_PIXELS = TERRAIN_BUCKET_SIZE / TERRAIN_RASTER_STEP;
const MAX_TERRAIN_TILE_CACHE = 4096;
const TERRAIN_OVERVIEW_BUCKET_SIZE = 2048;
const TERRAIN_OVERVIEW_RASTER_STEP = 16;
const TERRAIN_OVERVIEW_TILE_PIXELS = TERRAIN_OVERVIEW_BUCKET_SIZE / TERRAIN_OVERVIEW_RASTER_STEP;
const MAX_TERRAIN_OVERVIEW_TILE_CACHE = 512;
const MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS = 2048;
const GENERATED_REGION_WORLD_SIZE = 32 * 16;
const GENERATED_REGION_PIXELS = 32;
const WORLD_BORDER_OUTLIER_START = 29_900_000;
const AXIS_LEFT_WIDTH = 42;
const AXIS_BOTTOM_HEIGHT = 28;
const STRUCTURE_TYPES = ['spawn', 'mineshaft', 'stronghold', 'village', 'mansion', 'monument', 'ancient_city', 'trial_chambers', 'outpost', 'fortress', 'bastion', 'end_city', 'ruined_portal', 'desert_pyramid', 'jungle_pyramid', 'shipwreck', 'buried_treasure', 'igloo', 'swamp_hut', 'ocean_ruin', 'trail_ruins'];

function rasterEdge(value) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  return Math.round(value * ratio) / ratio;
}

function queueRasterJob(key, steps, finish) {
  if (rasterJobs.has(key)) return;
  if (rasterJobs.size >= 1024) return;
  rasterJobs.set(key, { steps, finish });
  scheduleRasterWork();
}

function scheduleRasterWork() {
  if (rasterIdleScheduled || !rasterJobs.size) return;
  rasterIdleScheduled = true;
  const idle = window.requestIdleCallback || (callback => setTimeout(callback, 16));
  idle(() => {
    rasterIdleScheduled = false;
    const deadline = performance.now() + 4;
    let completed = false;
    while (rasterJobs.size && performance.now() < deadline) {
      const [key, job] = rasterJobs.entries().next().value;
      if (job.steps.next().done) {
        rasterJobs.delete(key);
        job.finish();
        completed = true;
      }
    }
    if (completed) { terrainLayerKey = ''; scheduleDraw(); }
    scheduleRasterWork();
  }, { timeout: 100 });
}

function* paintOverviewSteps(cells, target, worldX, worldZ, pixelScale) {
  const coarseChunks = new Set();
  let count = 0;
  for (const cell of cells) {
    if ((Number(cell.size) || TERRAIN_RASTER_STEP) >= 16) coarseChunks.add(`${Math.floor(Number(cell.x) / 16)}|${Math.floor(Number(cell.z) / 16)}`);
    if (++count % 64 === 0) yield;
  }
  for (const cell of cells) {
    const size = Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP);
    if (size >= 16 || !coarseChunks.has(`${Math.floor(Number(cell.x) / 16)}|${Math.floor(Number(cell.z) / 16)}`)) {
      const left = Math.floor((Number(cell.x) - worldX) * pixelScale);
      const top = Math.floor((Number(cell.z) - worldZ) * pixelScale);
      const right = Math.ceil((Number(cell.x) - worldX + size) * pixelScale);
      const bottom = Math.ceil((Number(cell.z) - worldZ + size) * pixelScale);
      target.fillStyle = /^#[0-9a-f]{6}$/i.test(String(cell.color || '')) ? cell.color : '#8b8f87';
      target.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
    if (++count % 64 === 0) yield;
  }
}

function playerHasPosition(player) {
  return Boolean(player?.dimension) && [player.x, player.y, player.z].every(value => value !== null && value !== '' && Number.isFinite(Number(value)));
}

function stalePlayerPosition(player) {
  return Number(player?.lastPositionAt) > 0 && Date.now() - Number(player.lastPositionAt) > 30_000;
}

function rosterPlayers() {
  return (Array.isArray(snapshot?.playerRoster) ? snapshot.playerRoster : snapshot?.players || [])
    .slice().sort((a, b) => Number(b.online !== false) - Number(a.online !== false) || String(a.name).localeCompare(String(b.name)));
}

function structureType(marker) {
  if (marker.kind === 'spawn') return 'spawn';
  const id = String(marker.id || '').replace(/^minecraft:/, '');
  return STRUCTURE_TYPES.find(type => id === type || id.startsWith(`${type}_`) || id.endsWith(`_${type}`)) || id;
}

function markerVisible(marker) {
  return marker.dimension === selectedDimension && layerSettings.structures && !layerSettings.hiddenStructures.has(structureType(marker));
}

function loadMarkerImages() {
  for (const type of STRUCTURE_TYPES) {
    const image = new Image();
    image.onload = () => { markerImages.set(type, image); scheduleDraw(); };
    image.src = `assets/map-icons/${type}.png`;
  }
}

function readableError(error) {
  return String(error?.message || error || 'Something went wrong.')
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '');
}

function notice(message = '', error = false) {
  $('mapNotice').textContent = message;
  $('mapNotice').classList.toggle('error', error);
}

function coordinate(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const rounded = Math.round(number * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function dimensionName(value) {
  const clean = String(value || '').replace(/^minecraft:/, '').replace(/^the_/, '');
  return clean ? clean.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Unknown';
}

function terrainCellCount() {
  return terrainCountsByDimension.get(selectedDimension) || 0;
}

function generatedChunkCount() {
  return generatedChunkCountsByDimension.get(selectedDimension) || 0;
}

function isWorldBorderOutlier(x, z) {
  return Math.abs(Number(x)) >= WORLD_BORDER_OUTLIER_START
    || Math.abs(Number(z)) >= WORLD_BORDER_OUTLIER_START;
}

function decodeGeneratedRegion(entry) {
  try {
    const binary = atob(String(entry?.chunks || ''));
    if (binary.length !== 128) return null;
    return Uint8Array.from(binary, value => value.charCodeAt(0));
  } catch {
    return null;
  }
}

function rebuildGeneratedCoverageIndex() {
  const previousTiles = generatedRegionTiles;
  generatedRegionsByDimension = new Map();
  generatedRegionTiles = new Map();
  generatedBoundsByDimension = new Map();
  generatedMainBoundsByDimension = new Map();
  generatedChunkCountsByDimension = new Map();
  hiddenWorldBorderChunks = 0;
  const regionBoundsByDimension = new Map();
  for (const source of Array.isArray(snapshot?.generatedRegions) ? snapshot.generatedRegions : []) {
    const dimension = String(source?.dimension || '');
    const regionX = Number(source?.regionX);
    const regionZ = Number(source?.regionZ);
    if (!dimension || !Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionZ)) continue;
    const bytes = decodeGeneratedRegion(source);
    if (!bytes) continue;
    const entry = { dimension, regionX, regionZ, bytes, mask: String(source.chunks) };
    const tileKey = `${dimension}|${regionX}|${regionZ}`;
    const previous = previousTiles.get(tileKey);
    if (previous?.mask === entry.mask) generatedRegionTiles.set(tileKey, previous);
    let count = 0;
    let regionBounds = null;
    for (let index = 0; index < 1024; index++) {
      if (!(bytes[index >>> 3] & (1 << (index & 7)))) continue;
      const chunkX = regionX * 32 + index % 32;
      const chunkZ = regionZ * 32 + Math.floor(index / 32);
      const x = chunkX * 16;
      const z = chunkZ * 16;
      if (isWorldBorderOutlier(x, z)) {
        hiddenWorldBorderChunks++;
        continue;
      }
      count++;
      if (regionBounds) {
        regionBounds.minX = Math.min(regionBounds.minX, x);
        regionBounds.maxX = Math.max(regionBounds.maxX, x + 16);
        regionBounds.minZ = Math.min(regionBounds.minZ, z);
        regionBounds.maxZ = Math.max(regionBounds.maxZ, z + 16);
      } else {
        regionBounds = { minX: x, maxX: x + 16, minZ: z, maxZ: z + 16 };
      }
    }
    if (!count || !regionBounds) continue;
    entry.count = count;
    entry.bounds = regionBounds;
    const entries = generatedRegionsByDimension.get(dimension);
    if (entries) entries.push(entry);
    else generatedRegionsByDimension.set(dimension, [entry]);
    generatedChunkCountsByDimension.set(dimension,
      (generatedChunkCountsByDimension.get(dimension) || 0) + count);
    const bounds = generatedBoundsByDimension.get(dimension);
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, regionBounds.minX);
      bounds.maxX = Math.max(bounds.maxX, regionBounds.maxX);
      bounds.minZ = Math.min(bounds.minZ, regionBounds.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, regionBounds.maxZ);
    } else generatedBoundsByDimension.set(dimension, { ...regionBounds });
    const regionBoundsMap = regionBoundsByDimension.get(dimension) || new Map();
    regionBoundsMap.set(`${regionX}|${regionZ}`, entry);
    regionBoundsByDimension.set(dimension, regionBoundsMap);
  }
  for (const [dimension, regions] of regionBoundsByDimension) {
    const remaining = new Map(regions);
    let largest = null;
    while (remaining.size) {
      const [startKey, start] = remaining.entries().next().value;
      remaining.delete(startKey);
      const queue = [start];
      const component = [];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const region = queue[cursor];
        component.push(region);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const key = `${region.regionX + dx}|${region.regionZ + dz}`;
            const neighbor = remaining.get(key);
            if (!neighbor) continue;
            remaining.delete(key);
            queue.push(neighbor);
          }
        }
      }
      if (!largest || component.reduce((sum, region) => sum + region.count, 0) > largest.count) {
        largest = { component, count: component.reduce((sum, region) => sum + region.count, 0) };
      }
    }
    if (!largest) continue;
    const bounds = { ...largest.component[0].bounds };
    for (const region of largest.component.slice(1)) {
      bounds.minX = Math.min(bounds.minX, region.bounds.minX);
      bounds.maxX = Math.max(bounds.maxX, region.bounds.maxX);
      bounds.minZ = Math.min(bounds.minZ, region.bounds.minZ);
      bounds.maxZ = Math.max(bounds.maxZ, region.bounds.maxZ);
    }
    generatedMainBoundsByDimension.set(dimension, bounds);
  }
}

function addRasterCell(buckets, coordinatesByDimension, dimension, cell, bucketSize) {
  const x = Number(cell.x); const z = Number(cell.z);
  const size = Math.max(1, Math.min(512, Number(cell.size) || TERRAIN_RASTER_STEP));
  const minX = Math.floor(x / bucketSize); const maxX = Math.ceil((x + size) / bucketSize) - 1;
  const minZ = Math.floor(z / bucketSize); const maxZ = Math.ceil((z + size) / bucketSize) - 1;
  for (let bucketZ = minZ; bucketZ <= maxZ; bucketZ++) {
    for (let bucketX = minX; bucketX <= maxX; bucketX++) {
      const key = `${dimension}|${bucketX}|${bucketZ}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(cell);
      else {
        buckets.set(key, [cell]);
        const coordinates = coordinatesByDimension.get(dimension);
        const entry = { x: bucketX, z: bucketZ };
        if (coordinates) coordinates.push(entry);
        else coordinatesByDimension.set(dimension, [entry]);
      }
    }
  }
}

function terrainIndexState() {
  return { terrainBuckets, terrainTiles, terrainCountsByDimension, terrainBoundsByDimension,
    terrainMainBoundsByDimension, terrainBucketCoordinatesByDimension, terrainOverviewBuckets,
    terrainOverviewTiles, terrainOverviewBucketCoordinatesByDimension, terrainGlobalOverviews };
}

function* buildTerrainIndexSteps(source, previous = terrainIndexState()) {
  const terrainBuckets = new Map();
  const terrainTiles = new Map();
  const terrainCountsByDimension = new Map();
  const terrainBoundsByDimension = new Map();
  const terrainMainBoundsByDimension = new Map();
  const terrainBucketCoordinatesByDimension = new Map();
  const terrainOverviewBuckets = new Map();
  const terrainOverviewTiles = new Map();
  const terrainOverviewBucketCoordinatesByDimension = new Map();
  const terrainGlobalOverviews = rasterWorldToken === (source?.worldToken || '') ? previous.terrainGlobalOverviews : new Map();
  let processed = 0;
  for (const cell of Array.isArray(source?.terrain) ? source.terrain : []) {
    if (++processed % 512 === 0) yield;
    const x = Number(cell.x);
    const z = Number(cell.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    // A one-off teleport at the vanilla hard border can create valid but useless chunks almost
    // 30 million blocks away. Keep them in the source snapshot, but segregate them from rendering
    // so they cannot collapse fit/LOD precision for the actual played world.
    if (isWorldBorderOutlier(x, z)) continue;
    const dimension = String(cell.dimension || 'minecraft:overworld');
    addRasterCell(terrainBuckets, terrainBucketCoordinatesByDimension, dimension, cell, TERRAIN_BUCKET_SIZE);
    addRasterCell(terrainOverviewBuckets, terrainOverviewBucketCoordinatesByDimension, dimension, cell, TERRAIN_OVERVIEW_BUCKET_SIZE);

    terrainCountsByDimension.set(dimension, (terrainCountsByDimension.get(dimension) || 0) + 1);

    const size = Math.max(1, Number(cell.size) || 4);
    const bounds = terrainBoundsByDimension.get(dimension);
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x + size);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxZ = Math.max(bounds.maxZ, z + size);
    } else {
      terrainBoundsByDimension.set(dimension, { minX: x, maxX: x + size, minZ: z, maxZ: z + size });
    }

  }
  // A live update must not discard every raster in the explored world. Retain exact,
  // unchanged buckets; only changed raster inputs invalidate their existing tiles.
  const sameRaster = (a, b) => a?.length === b?.length && a.every((cell, index) => {
    const other = b[index];
    return cell.x === other.x && cell.z === other.z && cell.size === other.size && cell.color === other.color;
  });
  for (const [key, tile] of previous.terrainTiles) {
    if (sameRaster(previous.terrainBuckets.get(key), terrainBuckets.get(key))) terrainTiles.set(key, tile);
    if (++processed % 16 === 0) yield;
  }
  for (const [key, tile] of previous.terrainOverviewTiles) {
    if (sameRaster(previous.terrainOverviewBuckets.get(key), terrainOverviewBuckets.get(key))) terrainOverviewTiles.set(key, tile);
    yield;
  }
  return { terrainBuckets, terrainTiles, terrainCountsByDimension, terrainBoundsByDimension,
    terrainMainBoundsByDimension, terrainBucketCoordinatesByDimension, terrainOverviewBuckets,
    terrainOverviewTiles, terrainOverviewBucketCoordinatesByDimension, terrainGlobalOverviews };
}

function commitTerrainIndex(state, source) {
  ({ terrainBuckets, terrainTiles, terrainCountsByDimension, terrainBoundsByDimension,
    terrainMainBoundsByDimension, terrainBucketCoordinatesByDimension, terrainOverviewBuckets,
    terrainOverviewTiles, terrainOverviewBucketCoordinatesByDimension, terrainGlobalOverviews } = state);
  snapshot = source;
  rasterWorldToken = source?.worldToken || '';
  rasterJobs.clear();
  rebuildGeneratedCoverageIndex();
  terrainLayerKey = '';
  terrainGeneration++;
}

function rebuildTerrainIndex() {
  terrainIndexEpoch++;
  const steps = buildTerrainIndexSteps(snapshot);
  let step;
  do { step = steps.next(); } while (!step.done);
  commitTerrainIndex(step.value, snapshot);
}

async function rebuildTerrainIndexAsync(source) {
  const epoch = ++terrainIndexEpoch;
  if (snapshot && (snapshot.worldToken || '') !== (source.worldToken || '')) {
    // Never retain a previous world's canvas while another world's index builds.
    const emptySource = { ...source, terrain: [], generatedRegions: [] };
    const emptySteps = buildTerrainIndexSteps(emptySource);
    let emptyStep; do { emptyStep = emptySteps.next(); } while (!emptyStep.done);
    commitTerrainIndex(emptyStep.value, emptySource);
    seedRaster = null; seedResult = null; slimeResult = null; render();
  }
  const steps = buildTerrainIndexSteps(source);
  let step;
  do {
    const deadline = performance.now() + 4;
    do { step = steps.next(); } while (!step.done && performance.now() < deadline);
    if (!step.done) await new Promise(resolve => setTimeout(resolve, 0));
    if (epoch !== terrainIndexEpoch) return false;
  } while (!step.done);
  commitTerrainIndex(step.value, source);
  return true;
}

function createTerrainTile(dimension, bucketX, bucketZ) {
  const key = `${dimension}|${bucketX}|${bucketZ}`;
  const cells = terrainBuckets.get(key);
  if (!cells?.length) return null;
  if (rasterDeadline && performance.now() > rasterDeadline) {
    queueRasterJob(`detail|${key}`, (function* () { yield; })(), () => {
      const previousDeadline = rasterDeadline; rasterDeadline = 0;
      createTerrainTile(dimension, bucketX, bucketZ); rasterDeadline = previousDeadline;
    });
    return null;
  }
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = TERRAIN_TILE_PIXELS;
  tileCanvas.height = TERRAIN_TILE_PIXELS;
  const tileContext = tileCanvas.getContext('2d', { alpha: true });
  tileContext.imageSmoothingEnabled = false;
  const worldX = bucketX * TERRAIN_BUCKET_SIZE;
  const worldZ = bucketZ * TERRAIN_BUCKET_SIZE;
  for (const cell of cells) {
    const size = Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP);
    const left = Math.floor((Number(cell.x) - worldX) / TERRAIN_RASTER_STEP);
    const top = Math.floor((Number(cell.z) - worldZ) / TERRAIN_RASTER_STEP);
    const right = Math.ceil((Number(cell.x) - worldX + size) / TERRAIN_RASTER_STEP);
    const bottom = Math.ceil((Number(cell.z) - worldZ + size) / TERRAIN_RASTER_STEP);
    tileContext.fillStyle = /^#[0-9a-f]{6}$/i.test(String(cell.color || '')) ? cell.color : '#8b8f87';
    tileContext.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  }
  const tile = { canvas: tileCanvas, worldX, worldZ, used: ++terrainTileClock };
  terrainTiles.set(key, tile);
  trimTerrainTileCache();
  return tile;
}

function trimTerrainTileCache() {
  if (terrainTiles.size <= MAX_TERRAIN_TILE_CACHE + 256) return;
  const overflow = terrainTiles.size - (MAX_TERRAIN_TILE_CACHE - 256);
  const oldest = [...terrainTiles.entries()]
    .sort((left, right) => left[1].used - right[1].used)
    .slice(0, overflow);
  for (const [key] of oldest) terrainTiles.delete(key);
}

function overviewRenderableCells(cells) {
  const coarseChunks = new Set(cells
    .filter(cell => Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP) >= 16)
    .map(cell => `${Math.floor(Number(cell.x) / 16)}|${Math.floor(Number(cell.z) / 16)}`));
  return cells.filter(cell => {
    const size = Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP);
    return size >= 16 || !coarseChunks.has(`${Math.floor(Number(cell.x) / 16)}|${Math.floor(Number(cell.z) / 16)}`);
  });
}

function createTerrainOverviewTile(dimension, bucketX, bucketZ) {
  const key = `${dimension}|${bucketX}|${bucketZ}`;
  const cells = terrainOverviewBuckets.get(key);
  if (!cells?.length) return null;
  if (rasterJobs.has(`overview|${key}`)) return null;
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = TERRAIN_OVERVIEW_TILE_PIXELS;
  tileCanvas.height = TERRAIN_OVERVIEW_TILE_PIXELS;
  const tileContext = tileCanvas.getContext('2d', { alpha: true });
  tileContext.imageSmoothingEnabled = false;
  const worldX = bucketX * TERRAIN_OVERVIEW_BUCKET_SIZE;
  const worldZ = bucketZ * TERRAIN_OVERVIEW_BUCKET_SIZE;
  if (cells.length > 2000 || (rasterDeadline && performance.now() > rasterDeadline)) {
    queueRasterJob(`overview|${key}`, paintOverviewSteps(cells, tileContext, worldX, worldZ, 1 / TERRAIN_OVERVIEW_RASTER_STEP), () => {
      terrainOverviewTiles.set(key, { canvas: tileCanvas, worldX, worldZ, used: ++terrainTileClock });
      trimTerrainOverviewTileCache();
    });
    return null;
  }
  for (const cell of overviewRenderableCells(cells)) {
    const size = Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP);
    const left = Math.floor((Number(cell.x) - worldX) / TERRAIN_OVERVIEW_RASTER_STEP);
    const top = Math.floor((Number(cell.z) - worldZ) / TERRAIN_OVERVIEW_RASTER_STEP);
    const right = Math.ceil((Number(cell.x) - worldX + size) / TERRAIN_OVERVIEW_RASTER_STEP);
    const bottom = Math.ceil((Number(cell.z) - worldZ + size) / TERRAIN_OVERVIEW_RASTER_STEP);
    tileContext.fillStyle = /^#[0-9a-f]{6}$/i.test(String(cell.color || '')) ? cell.color : '#8b8f87';
    tileContext.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  }
  const tile = { canvas: tileCanvas, worldX, worldZ, used: ++terrainTileClock };
  terrainOverviewTiles.set(key, tile);
  trimTerrainOverviewTileCache();
  return tile;
}

function trimTerrainOverviewTileCache() {
  if (terrainOverviewTiles.size <= MAX_TERRAIN_OVERVIEW_TILE_CACHE + 32) return;
  const overflow = terrainOverviewTiles.size - (MAX_TERRAIN_OVERVIEW_TILE_CACHE - 32);
  const oldest = [...terrainOverviewTiles.entries()]
    .sort((left, right) => left[1].used - right[1].used)
    .slice(0, overflow);
  for (const [key] of oldest) terrainOverviewTiles.delete(key);
}

function terrainGlobalOverviewScale(dimension) {
  const bounds = terrainBoundsByDimension.get(dimension);
  if (!bounds) return 0;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxZ - bounds.minZ);
  return Math.max(0.000000001, Math.min(
    1 / TERRAIN_OVERVIEW_RASTER_STEP,
    MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS / width,
    MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS / height
  ));
}

function createGeneratedRegionTile(entry) {
  const key = `${entry.dimension}|${entry.regionX}|${entry.regionZ}`;
  const existing = generatedRegionTiles.get(key);
  if (existing) return existing;
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = GENERATED_REGION_PIXELS;
  tileCanvas.height = GENERATED_REGION_PIXELS;
  const tileContext = tileCanvas.getContext('2d', { alpha: true });
  tileContext.imageSmoothingEnabled = false;
  tileContext.fillStyle = '#242a30';
  for (let index = 0; index < 1024; index++) {
    if (!(entry.bytes[index >>> 3] & (1 << (index & 7)))) continue;
    const x = (entry.regionX * 32 + index % 32) * 16;
    const z = (entry.regionZ * 32 + Math.floor(index / 32)) * 16;
    if (isWorldBorderOutlier(x, z)) continue;
    tileContext.fillRect(index % 32, Math.floor(index / 32), 1, 1);
  }
  const tile = {
    canvas: tileCanvas,
    mask: entry.mask,
    worldX: entry.regionX * GENERATED_REGION_WORLD_SIZE,
    worldZ: entry.regionZ * GENERATED_REGION_WORLD_SIZE
  };
  generatedRegionTiles.set(key, tile);
  return tile;
}

function drawGeneratedCoverage() {
  const entries = generatedRegionsByDimension.get(selectedDimension) || [];
  if (!entries.length) return;
  const viewport = mapViewport();
  const topLeft = worldPoint(viewport.left, viewport.top);
  const bottomRight = worldPoint(viewport.right, viewport.bottom);
  context.imageSmoothingEnabled = false;
  for (const entry of entries) {
    if (entry.bounds.maxX < topLeft.x || entry.bounds.minX > bottomRight.x
        || entry.bounds.maxZ < topLeft.z || entry.bounds.minZ > bottomRight.z) continue;
    const tile = createGeneratedRegionTile(entry);
    const start = screenPoint(tile.worldX, tile.worldZ);
    const end = screenPoint(tile.worldX + GENERATED_REGION_WORLD_SIZE,
      tile.worldZ + GENERATED_REGION_WORLD_SIZE);
    const left = rasterEdge(start.x);
    const top = rasterEdge(start.y);
    const right = rasterEdge(end.x);
    const bottom = rasterEdge(end.y);
    if (right > left && bottom > top) context.drawImage(tile.canvas, left, top, right - left, bottom - top);
  }
}

function createTerrainGlobalOverview(dimension) {
  const existing = terrainGlobalOverviews.get(dimension);
  if (existing?.generation === terrainGeneration) return existing;
  if (rasterJobs.has(`global|${dimension}`)) return existing || null;
  const bounds = terrainBoundsByDimension.get(dimension);
  const pixelScale = terrainGlobalOverviewScale(dimension);
  if (!bounds || !pixelScale) return null;
  const overviewCanvas = document.createElement('canvas');
  overviewCanvas.width = Math.max(1, Math.min(
    MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS,
    Math.ceil((bounds.maxX - bounds.minX) * pixelScale)
  ));
  overviewCanvas.height = Math.max(1, Math.min(
    MAX_TERRAIN_GLOBAL_OVERVIEW_PIXELS,
    Math.ceil((bounds.maxZ - bounds.minZ) * pixelScale)
  ));
  const overviewContext = overviewCanvas.getContext('2d', { alpha: true });
  overviewContext.imageSmoothingEnabled = false;
  const prefix = `${dimension}|`;
  const generation = terrainGeneration;
  if ((terrainCountsByDimension.get(dimension) || 0) > 2000) {
    const buckets = terrainOverviewBuckets;
    queueRasterJob(`global|${dimension}`, (function* () {
      for (const [key, cells] of buckets) {
        if (key.startsWith(prefix)) yield* paintOverviewSteps(cells, overviewContext, bounds.minX, bounds.minZ, pixelScale);
      }
    })(), () => {
      terrainGlobalOverviews.set(dimension, { canvas: overviewCanvas, bounds, pixelScale, generation });
    });
    return existing || null;
  }
  for (const [key, cells] of terrainOverviewBuckets) {
    if (!key.startsWith(prefix)) continue;
    for (const cell of overviewRenderableCells(cells)) {
      const x = Number(cell.x);
      const z = Number(cell.z);
      const size = Math.max(1, Number(cell.size) || TERRAIN_RASTER_STEP);
      if (x + size <= bounds.minX || x >= bounds.maxX
          || z + size <= bounds.minZ || z >= bounds.maxZ) continue;
      const left = Math.floor((x - bounds.minX) * pixelScale);
      const top = Math.floor((z - bounds.minZ) * pixelScale);
      const right = Math.ceil((x - bounds.minX + size) * pixelScale);
      const bottom = Math.ceil((z - bounds.minZ + size) * pixelScale);
      overviewContext.fillStyle = /^#[0-9a-f]{6}$/i.test(String(cell.color || '')) ? cell.color : '#8b8f87';
      overviewContext.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
  }
  const overview = { canvas: overviewCanvas, bounds, pixelScale, generation };
  terrainGlobalOverviews.set(dimension, overview);
  return overview;
}

function dimensionPlayers() {
  return layerSettings.players ? rosterPlayers().filter(player => player.dimension === selectedDimension
    && playerHasPosition(player) && (player.online !== false || layerSettings.offline)) : [];
}

function selectedPlayer() {
  return rosterPlayers().find(player => String(player.name).toLowerCase() === selectedName.toLowerCase()) || null;
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(bounds.width * ratio));
  const height = Math.max(1, Math.floor(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const fittedMode = fittedDimension.startsWith(`${selectedDimension}|`)
    ? fittedDimension.slice(selectedDimension.length + 1)
    : '';
  if (terrainCellCount() && (fittedMode === 'main' || fittedMode === 'all')) fitTerrain(fittedMode === 'all');
  else draw();
}

function mapViewport() {
  const left = Math.min(AXIS_LEFT_WIDTH, Math.max(0, canvas.clientWidth - 1));
  const right = Math.max(left + 1, canvas.clientWidth);
  const top = 0;
  const bottom = Math.max(top + 1, canvas.clientHeight - AXIS_BOTTOM_HEIGHT);
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2
  };
}

function screenPoint(x, z) {
  const viewport = mapViewport();
  return {
    x: viewport.centerX + (x - centerX) * scale,
    y: viewport.centerY + (z - centerZ) * scale
  };
}

function worldPoint(x, y) {
  const viewport = mapViewport();
  return {
    x: centerX + (x - viewport.centerX) / scale,
    z: centerZ + (y - viewport.centerY) / scale
  };
}

function themeColor(name, fallback) {
  if (!cachedTheme) {
    const styles = getComputedStyle(document.documentElement);
    cachedTheme = new Map([
      ['--theme-bg', styles.getPropertyValue('--theme-bg').trim()],
      ['--theme-surface', styles.getPropertyValue('--theme-surface').trim()],
      ['--theme-border', styles.getPropertyValue('--theme-border').trim()],
      ['--theme-text', styles.getPropertyValue('--theme-text').trim()],
      ['--theme-muted', styles.getPropertyValue('--theme-muted').trim()],
      ['--theme-subtle', styles.getPropertyValue('--theme-subtle').trim()],
      ['--theme-highlight', styles.getPropertyValue('--theme-highlight').trim()]
    ]);
  }
  return cachedTheme.get(name) || fallback;
}

function coordinateSpacing(minimumPixels = 96) {
  const minimumWorldUnits = minimumPixels / Math.max(scale, 0.000000001);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, minimumWorldUnits)));
  for (const multiplier of [1, 2, 5, 10]) {
    const candidate = magnitude * multiplier;
    if (candidate >= minimumWorldUnits) return candidate;
  }
  return magnitude * 10;
}

function drawGrid() {
  if (!layerSettings.grid || scale * 16 < 4) return;
  const viewport = mapViewport();
  const spacing = 16;
  const topLeft = worldPoint(viewport.left, viewport.top);
  const bottomRight = worldPoint(viewport.right, viewport.bottom);
  context.strokeStyle = themeColor('--theme-border', '#34383f');
  context.globalAlpha = Math.min(0.48, scale * 16 / 30);
  context.lineWidth = 1;
  context.beginPath();
  for (let x = Math.floor(topLeft.x / spacing) * spacing; x <= bottomRight.x; x += spacing) {
    const point = screenPoint(x, 0);
    context.moveTo(Math.round(point.x) + 0.5, viewport.top);
    context.lineTo(Math.round(point.x) + 0.5, viewport.bottom);
  }
  for (let z = Math.floor(topLeft.z / spacing) * spacing; z <= bottomRight.z; z += spacing) {
    const point = screenPoint(0, z);
    context.moveTo(viewport.left, Math.round(point.y) + 0.5);
    context.lineTo(viewport.right, Math.round(point.y) + 0.5);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function drawAxes() {
  const foreground = themeColor('--theme-muted', '#aaa');
  const subtle = themeColor('--theme-subtle', '#777');
  const background = themeColor('--theme-surface', '#181818');
  const border = themeColor('--theme-border', '#3a3a3a');
  const accent = themeColor('--theme-highlight', '#42a5f5');
  const bottomHeight = AXIS_BOTTOM_HEIGHT;
  const leftWidth = AXIS_LEFT_WIDTH;
  const viewport = mapViewport();
  context.fillStyle = background;
  context.fillRect(0, canvas.clientHeight - bottomHeight, canvas.clientWidth, bottomHeight);
  context.fillRect(0, 0, leftWidth, canvas.clientHeight);
  context.strokeStyle = border;
  context.globalAlpha = 0.8;
  context.beginPath();
  context.moveTo(leftWidth + 0.5, 0);
  context.lineTo(leftWidth + 0.5, canvas.clientHeight - bottomHeight);
  context.moveTo(leftWidth, canvas.clientHeight - bottomHeight + 0.5);
  context.lineTo(canvas.clientWidth, canvas.clientHeight - bottomHeight + 0.5);
  context.stroke();
  context.globalAlpha = 1;
  context.fillStyle = foreground;
  context.font = '9px "Segoe UI", sans-serif';
  const spacing = coordinateSpacing(104);
  const topLeft = worldPoint(viewport.left, viewport.top);
  const bottomRight = worldPoint(viewport.right, viewport.bottom);
  context.textAlign = 'center';
  for (let x = Math.floor(topLeft.x / spacing) * spacing; x <= bottomRight.x; x += spacing) {
    const point = screenPoint(x, 0);
    if (point.x > leftWidth + 16 && point.x < canvas.clientWidth - 18) {
      context.fillStyle = border;
      context.fillRect(Math.round(point.x), canvas.clientHeight - bottomHeight, 1, 4);
      context.fillStyle = foreground;
      context.fillText(String(x), point.x, canvas.clientHeight - 10);
    }
  }
  context.fillStyle = accent;
  context.font = '700 9px "Segoe UI", sans-serif';
  context.textAlign = 'right';
  context.fillText('X', canvas.clientWidth - 8, canvas.clientHeight - 10);
  context.textAlign = 'center';
  context.fillText('Z', leftWidth / 2, 12);
  context.font = '9px "Segoe UI", sans-serif';
  context.textAlign = 'right';
  for (let z = Math.floor(topLeft.z / spacing) * spacing; z <= bottomRight.z; z += spacing) {
    const point = screenPoint(0, z);
    if (point.y > 20 && point.y < canvas.clientHeight - bottomHeight - 8) {
      context.fillStyle = border;
      context.fillRect(leftWidth - 4, Math.round(point.y), 4, 1);
      context.fillStyle = subtle;
      context.fillText(String(z), leftWidth - 7, point.y + 3);
    }
  }
}

function drawTerrainTiles() {
  const viewport = mapViewport();
  const topLeft = worldPoint(viewport.left, viewport.top);
  const bottomRight = worldPoint(viewport.right, viewport.bottom);
  const globalPixelScale = terrainGlobalOverviewScale(selectedDimension);
  const fallback = terrainGlobalOverviews.get(selectedDimension);
  if (fallback && scale > globalPixelScale) {
    const start = screenPoint(fallback.bounds.minX, fallback.bounds.minZ);
    const end = screenPoint(fallback.bounds.maxX, fallback.bounds.maxZ);
    context.imageSmoothingEnabled = false;
    context.drawImage(fallback.canvas, rasterEdge(start.x), rasterEdge(start.y),
      Math.max(1, rasterEdge(end.x) - rasterEdge(start.x)), Math.max(1, rasterEdge(end.y) - rasterEdge(start.y)));
  }
  // Prepare the next zoom level outside input frames. Existing world colors stay
  // visible below detailed tiles while the bounded background raster jobs finish.
  if (!fallback || fallback.generation !== terrainGeneration) createTerrainGlobalOverview(selectedDimension);
  if (globalPixelScale && scale <= globalPixelScale) {
    const overview = createTerrainGlobalOverview(selectedDimension);
    if (overview) {
      context.imageSmoothingEnabled = false;
      const start = screenPoint(overview.bounds.minX, overview.bounds.minZ);
      const end = screenPoint(overview.bounds.maxX, overview.bounds.maxZ);
      context.drawImage(
        overview.canvas,
        rasterEdge(start.x),
        rasterEdge(start.y),
        Math.max(1, rasterEdge(end.x) - rasterEdge(start.x)),
        Math.max(1, rasterEdge(end.y) - rasterEdge(start.y))
      );
      return;
    }
  }
  const baseMinBucketX = Math.floor(topLeft.x / TERRAIN_BUCKET_SIZE) - 1;
  const baseMaxBucketX = Math.floor(bottomRight.x / TERRAIN_BUCKET_SIZE) + 1;
  const baseMinBucketZ = Math.floor(topLeft.z / TERRAIN_BUCKET_SIZE) - 1;
  const baseMaxBucketZ = Math.floor(bottomRight.z / TERRAIN_BUCKET_SIZE) + 1;
  context.imageSmoothingEnabled = false;
  const baseCoordinates = terrainBucketCoordinatesByDimension.get(selectedDimension) || [];
  // Select LOD from viewport size rather than scanning the whole world's index
  // on every wheel event. The conservative bound also limits tile creation.
  const visibleBaseBuckets = (baseMaxBucketX - baseMinBucketX + 1) * (baseMaxBucketZ - baseMinBucketZ + 1);
  const overview = scale <= (1 / TERRAIN_OVERVIEW_RASTER_STEP)
    || visibleBaseBuckets > MAX_TERRAIN_TILE_CACHE;
  const bucketSize = overview ? TERRAIN_OVERVIEW_BUCKET_SIZE : TERRAIN_BUCKET_SIZE;
  const coordinates = overview
    ? terrainOverviewBucketCoordinatesByDimension.get(selectedDimension) || []
    : baseCoordinates;
  const minBucketX = overview ? Math.floor(topLeft.x / bucketSize) - 1 : baseMinBucketX;
  const maxBucketX = overview ? Math.floor(bottomRight.x / bucketSize) + 1 : baseMaxBucketX;
  const minBucketZ = overview ? Math.floor(topLeft.z / bucketSize) - 1 : baseMinBucketZ;
  const maxBucketZ = overview ? Math.floor(bottomRight.z / bucketSize) + 1 : baseMaxBucketZ;
  const columns = Math.max(0, maxBucketX - minBucketX + 1);
  const rows = Math.max(0, maxBucketZ - minBucketZ + 1);
  const rangeArea = columns * rows;
  const drawBucket = (bucketX, bucketZ) => {
    const key = `${selectedDimension}|${bucketX}|${bucketZ}`;
    const tiles = overview ? terrainOverviewTiles : terrainTiles;
    let tile = tiles.get(key);
    if (!tile) tile = overview
      ? createTerrainOverviewTile(selectedDimension, bucketX, bucketZ)
      : createTerrainTile(selectedDimension, bucketX, bucketZ);
    if (!tile) return;
    tile.used = ++terrainTileClock;
    const start = screenPoint(tile.worldX, tile.worldZ);
    const end = screenPoint(tile.worldX + bucketSize, tile.worldZ + bucketSize);
    const left = rasterEdge(start.x);
    const top = rasterEdge(start.y);
    const right = rasterEdge(end.x);
    const bottom = rasterEdge(end.y);
    if (right > left && bottom > top) context.drawImage(tile.canvas, left, top, right - left, bottom - top);
  };
  if (Number.isSafeInteger(rangeArea) && rangeArea <= Math.max(4096, coordinates.length * 3)) {
    for (let bucketZ = minBucketZ; bucketZ <= maxBucketZ; bucketZ++) {
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) drawBucket(bucketX, bucketZ);
    }
    return;
  }
  for (const coordinate of coordinates) {
    if (coordinate.x < minBucketX || coordinate.x > maxBucketX
        || coordinate.z < minBucketZ || coordinate.z > maxBucketZ) continue;
    drawBucket(coordinate.x, coordinate.z);
  }
}

function paintHead(target, player, left, top, size) {
  target.imageSmoothingEnabled = false;
  target.fillStyle = '#6d4b32';
  target.fillRect(left, top, size, size);
  const head = playerHeadImages.get(String(player.name).toLowerCase());
  if (head) {
    target.drawImage(head, 8, 8, 8, 8, left, top, size, size);
    target.drawImage(head, 40, 8, 8, 8, left, top, size, size);
    return;
  }
  target.fillStyle = '#c98f65';
  target.fillRect(left + size / 8, top + size / 4, size * 3 / 4, size * 5 / 8);
  target.fillStyle = '#eef4ff';
  target.fillRect(left + size / 8, top + size / 2, size / 4, size / 8);
  target.fillRect(left + size * 5 / 8, top + size / 2, size / 4, size / 8);
  target.fillStyle = '#27354d';
  target.fillRect(left + size / 4, top + size / 2, size / 8, size / 8);
  target.fillRect(left + size * 5 / 8, top + size / 2, size / 8, size / 8);
}

function drawPlayerMarker(player, point, selected) {
  const size = selected ? 20 : 18;
  const left = Math.round(point.x - size / 2);
  const top = Math.round(point.y - size / 2);
  context.save();
  context.globalAlpha = player.online === false ? 0.55 : 1;
  context.fillStyle = selected ? themeColor('--theme-highlight', '#6ea8ff') : '#20242a';
  context.fillRect(left - 2, top - 2, size + 4, size + 4);
  paintHead(context, player, left, top, size);
  context.fillStyle = player.online === false ? '#92969b' : '#40c879';
  context.fillRect(left + size - 3, top + size - 3, 5, 5);
  context.restore();
}

async function loadPlayerHead(player) {
  const key = String(player.name || '').toLowerCase();
  if (!key || playerHeadImages.has(key) || pendingPlayerHeads.has(key)
      || pendingPlayerHeads.size >= 4 || (failedPlayerHeads.get(key) || 0) > Date.now()) return;
  pendingPlayerHeads.add(key);
  try {
    const result = await api.getPlayerSkin({ name: player.name, uuid: player.uuid });
    if (!result?.skinDataUrl) throw new Error('No skin available');
    const head = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = result.skinDataUrl;
    });
    playerHeadImages.set(key, head);
    document.querySelectorAll('canvas[data-player-head]').forEach(target => {
      if (target.dataset.playerHead === key) paintHead(target.getContext('2d'), player, 0, 0, target.width);
    });
    scheduleDraw();
  } catch {
    failedPlayerHeads.set(key, Date.now() + 300_000);
  } finally {
    pendingPlayerHeads.delete(key);
  }
}

function markerName(id) {
  return String(id || '').replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/\b\w/g, value => value.toUpperCase());
}

function drawMapMarker(marker, point) {
  const id = String(marker.id || '');
  const icon = markerImages.get(structureType(marker));
  context.imageSmoothingEnabled = false;
  context.lineWidth = 2;
  if (icon) {
    context.drawImage(icon, Math.round(point.x - 12), Math.round(point.y - 12), 24, 24);
  } else if (marker.kind === 'spawn') {
    context.fillStyle = '#f6d45c';
    context.beginPath(); context.moveTo(point.x, point.y - 9); context.lineTo(point.x + 7, point.y);
    context.lineTo(point.x, point.y + 9); context.lineTo(point.x - 7, point.y); context.closePath(); context.fill();
    context.fillStyle = '#20242a'; context.fillRect(point.x - 1, point.y - 5, 2, 10);
  } else if (id.includes('stronghold')) {
    context.fillStyle = '#7757b8'; context.fillRect(point.x - 8, point.y - 8, 16, 16);
    context.fillStyle = '#16191d'; context.fillRect(point.x - 5, point.y - 5, 10, 10);
    context.fillStyle = '#6ee7c5'; context.fillRect(point.x - 2, point.y - 2, 4, 4);
  } else if (id.includes('mansion')) {
    context.fillStyle = '#6d4932'; context.fillRect(point.x - 7, point.y - 2, 14, 10);
    context.fillStyle = '#9a6240'; context.beginPath(); context.moveTo(point.x - 9, point.y - 2);
    context.lineTo(point.x, point.y - 10); context.lineTo(point.x + 9, point.y - 2); context.fill();
    context.fillStyle = '#d4b483'; context.fillRect(point.x - 2, point.y + 2, 4, 6);
  } else {
    context.fillStyle = '#ef7d57'; context.beginPath(); context.arc(point.x, point.y - 2, 6, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.moveTo(point.x - 4, point.y + 2); context.lineTo(point.x, point.y + 10);
    context.lineTo(point.x + 4, point.y + 2); context.fill();
  }
  if (scale >= 0.35) {
    context.font = '10px "Segoe UI", sans-serif'; context.textAlign = 'center';
    context.fillStyle = themeColor('--theme-text', '#f1f2f4');
    context.fillText(markerName(marker.id), point.x, point.y - 13);
  }
}

function drawSeedPreview() {
  if (!layerSettings.seed || !seedRaster || seedResult?.dimension !== selectedDimension
      || seedResult.worldToken !== snapshot?.worldToken) return;
  const bounds = seedRaster.bounds;
  const start = screenPoint(bounds.minX, bounds.minZ);
  const end = screenPoint(bounds.maxX, bounds.maxZ);
  context.imageSmoothingEnabled = false;
  context.drawImage(seedRaster.canvas, rasterEdge(start.x), rasterEdge(start.y),
    Math.max(1, rasterEdge(end.x) - rasterEdge(start.x)), Math.max(1, rasterEdge(end.y) - rasterEdge(start.y)));
}

function buildSeedRaster(result) {
  const cells = Array.isArray(result?.cells) ? result.cells : [];
  if (!result.available || !cells.length) return null;
  const step = Number(cells[0].size);
  if (!(step > 0) || cells.length > 4096) return null;
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const cell of cells) {
    if (![cell.x, cell.z, cell.size].every(Number.isFinite) || cell.size !== step) return null;
    bounds.minX = Math.min(bounds.minX, cell.x); bounds.minZ = Math.min(bounds.minZ, cell.z);
    bounds.maxX = Math.max(bounds.maxX, cell.x + step); bounds.maxZ = Math.max(bounds.maxZ, cell.z + step);
  }
  const width = Math.round((bounds.maxX - bounds.minX) / step);
  const height = Math.round((bounds.maxZ - bounds.minZ) / step);
  if (width < 1 || height < 1 || width > 256 || height > 256) return null;
  const raster = document.createElement('canvas');
  raster.width = width; raster.height = height;
  const target = raster.getContext('2d');
  for (const cell of cells) {
    target.fillStyle = /^#[0-9a-f]{6}$/i.test(cell.color) ? cell.color : '#607759';
    target.fillRect(Math.round((cell.x - bounds.minX) / step), Math.round((cell.z - bounds.minZ) / step), 1, 1);
  }
  return { canvas: raster, bounds };
}

function drawSlimeChunks() {
  if (!layerSettings.slime || scale * 16 < 4 || selectedDimension !== 'minecraft:overworld'
      || slimeResult?.worldToken !== snapshot?.worldToken) return;
  context.fillStyle = '#7ded60';
  context.globalAlpha = 0.28;
  for (const chunk of slimeResult?.chunks || []) {
    const start = screenPoint(chunk.x * 16, chunk.z * 16);
    const end = screenPoint((chunk.x + 1) * 16, (chunk.z + 1) * 16);
    context.fillRect(rasterEdge(start.x), rasterEdge(start.y), rasterEdge(end.x) - rasterEdge(start.x), rasterEdge(end.y) - rasterEdge(start.y));
  }
  context.globalAlpha = 1;
}

function scheduleOverlayRefresh() {
  const viewport = mapViewport();
  const topLeft = worldPoint(viewport.left, viewport.top);
  const bottomRight = worldPoint(viewport.right, viewport.bottom);
  const query = { worldToken: snapshot?.worldToken, dimension: selectedDimension,
    minX: Math.floor(topLeft.x), maxX: Math.ceil(bottomRight.x),
    minZ: Math.floor(topLeft.z), maxZ: Math.ceil(bottomRight.z) };
  if (!query.worldToken) return;
  const key = JSON.stringify([query, layerSettings.seed, layerSettings.slime, snapshot?.seedPreviewAvailable, snapshot?.slimeChunksAvailable]);
  if (key === seedRequest && Date.now() < overlayRetryAt) return;
  seedRequest = key;
  overlayRetryAt = Infinity;
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(async () => {
    if (key !== seedRequest) return;
    const jobs = [];
    if (layerSettings.seed && snapshot?.seedPreviewAvailable !== false && typeof api.getSeedPreview === 'function') {
      jobs.push(api.getSeedPreview(query).then(result => {
        if (key !== seedRequest || query.worldToken !== snapshot?.worldToken) return;
        seedResult = { ...result, dimension: query.dimension, worldToken: query.worldToken };
        seedRaster = buildSeedRaster(seedResult);
        if (!seedRaster) overlayRetryAt = Date.now() + 10_000;
        terrainLayerKey = '';
        $('seedLayer').title = seedRaster ? 'Seed-based biomes, not exact blocks. Saved terrain and player changes appear on top.'
          : 'Seed preview is not available for this world.';
        if (seedRaster) empty.hidden = true;
        scheduleDraw();
      }).catch(() => { if (key === seedRequest) overlayRetryAt = Date.now() + 10_000; }));
    }
    if (layerSettings.slime && snapshot?.slimeChunksAvailable !== false && selectedDimension === 'minecraft:overworld' && scale * 16 >= 4 && typeof api.getSlimeChunks === 'function') {
      const chunks = { worldToken: query.worldToken, dimension: query.dimension,
        minChunkX: Math.floor(query.minX / 16), maxChunkX: Math.floor(query.maxX / 16),
        minChunkZ: Math.floor(query.minZ / 16), maxChunkZ: Math.floor(query.maxZ / 16) };
      if ((chunks.maxChunkX - chunks.minChunkX + 1) * (chunks.maxChunkZ - chunks.minChunkZ + 1) <= 12000) {
        jobs.push(api.getSlimeChunks(chunks).then(result => {
          if (key !== seedRequest || query.worldToken !== snapshot?.worldToken) return;
          slimeResult = result;
          scheduleDraw();
        }).catch(() => { if (key === seedRequest) overlayRetryAt = Date.now() + 10_000; }));
      }
    }
    await Promise.all(jobs);
  }, 350);
}

function drawTerrainLayer() {
  const key = [terrainGeneration, snapshot?.worldToken, selectedDimension, centerX, centerZ, scale, canvas.width, canvas.height,
    layerSettings.seed, themeColor('--theme-bg', '#15171a')].join('|');
  if (terrainLayer && key === terrainLayerKey) {
    context.drawImage(terrainLayer, 0, 0, canvas.clientWidth, canvas.clientHeight);
    return;
  }
  rasterDeadline = performance.now() + 4;
  try {
    drawGeneratedCoverage();
    drawSeedPreview();
    drawTerrainTiles();
  } finally { rasterDeadline = 0; }
  terrainLayer ||= document.createElement('canvas');
  terrainLayer.width = canvas.width;
  terrainLayer.height = canvas.height;
  terrainLayer.getContext('2d').drawImage(canvas, 0, 0);
  terrainLayerKey = key;
}

function scheduleDraw() {
  if (drawFrame) return;
  drawFrame = requestAnimationFrame(() => { drawFrame = 0; draw(); });
}

function draw() {
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  context.fillStyle = themeColor('--theme-bg', '#15171a');
  context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const viewport = mapViewport();
  context.save();
  context.beginPath();
  context.rect(viewport.left, viewport.top, viewport.width, viewport.height);
  context.clip();
  drawTerrainLayer();
  drawSlimeChunks();
  drawGrid();
  const markerSlots = new Set();
  for (const marker of (snapshot?.markers || []).filter(markerVisible).sort((a, b) => Number(b.kind === 'spawn') - Number(a.kind === 'spawn'))) {
    const point = screenPoint(marker.x, marker.z);
    if (point.x < -24 || point.y < -24 || point.x > canvas.clientWidth + 24 || point.y > canvas.clientHeight + 24) continue;
    // At overview zoom, retain useful markers without covering the map with overlapping pins.
    const slot = `${Math.floor(point.x / 28)}|${Math.floor(point.y / 28)}`;
    if (scale < 0.35 && markerSlots.has(slot)) continue;
    markerSlots.add(slot);
    drawMapMarker(marker, point);
  }
  for (const player of dimensionPlayers()) {
    const point = screenPoint(player.x, player.z);
    if (point.x < -20 || point.y < -20 || point.x > canvas.clientWidth + 20 || point.y > canvas.clientHeight + 20) continue;
    const selected = String(player.name).toLowerCase() === selectedName.toLowerCase();
    drawPlayerMarker(player, point, selected);
    if (scale >= 0.2 || selected) {
      context.font = '10px "Segoe UI", sans-serif';
      context.textAlign = 'center';
      context.fillStyle = themeColor('--theme-text', '#f1f2f4');
      context.fillText(`${player.name}${player.online === false ? ' (offline)' : stalePlayerPosition(player) ? ' (last known)' : ''}`, point.x, point.y - 14);
    }
  }
  context.restore();
  drawAxes();
  scheduleOverlayRefresh();
}

function mainTerrainBounds(dimension) {
  if (terrainMainBoundsByDimension.has(dimension)) return terrainMainBoundsByDimension.get(dimension);
  const coordinates = terrainBucketCoordinatesByDimension.get(dimension) || [];
  if (!coordinates.length) {
    const fallback = terrainBoundsByDimension.get(dimension) || null;
    terrainMainBoundsByDimension.set(dimension, fallback);
    return fallback;
  }
  const remaining = new Set(coordinates.map(point => `${point.x}|${point.z}`));
  let largest = null;
  for (const start of coordinates) {
    const startKey = `${start.x}|${start.z}`;
    if (!remaining.delete(startKey)) continue;
    const queue = [start];
    const bounds = { minX: start.x, maxX: start.x, minZ: start.z, maxZ: start.z, count: 0 };
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const point = queue[cursor];
      bounds.count++;
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const key = `${point.x + dx}|${point.z + dz}`;
          if (!remaining.delete(key)) continue;
          queue.push({ x: point.x + dx, z: point.z + dz });
        }
      }
    }
    if (!largest || bounds.count > largest.count) largest = bounds;
  }
  const result = largest ? {
    minX: largest.minX * TERRAIN_BUCKET_SIZE,
    maxX: (largest.maxX + 1) * TERRAIN_BUCKET_SIZE,
    minZ: largest.minZ * TERRAIN_BUCKET_SIZE,
    maxZ: (largest.maxZ + 1) * TERRAIN_BUCKET_SIZE
  } : null;
  terrainMainBoundsByDimension.set(dimension, result);
  return result;
}

function unionBounds(left, right) {
  if (!left) return right ? { ...right } : null;
  if (!right) return { ...left };
  return {
    minX: Math.min(left.minX, right.minX),
    maxX: Math.max(left.maxX, right.maxX),
    minZ: Math.min(left.minZ, right.minZ),
    maxZ: Math.max(left.maxZ, right.maxZ)
  };
}

function mapBounds(dimension, includeRemote) {
  return includeRemote
    ? unionBounds(generatedBoundsByDimension.get(dimension), terrainBoundsByDimension.get(dimension))
    : unionBounds(generatedMainBoundsByDimension.get(dimension), mainTerrainBounds(dimension));
}

function fitTerrain(includeRemote = false) {
  const bounds = mapBounds(selectedDimension, includeRemote);
  if (!bounds) return draw();
  const { minX, maxX, minZ, maxZ } = bounds;
  centerX = (minX + maxX) / 2;
  centerZ = (minZ + maxZ) / 2;
  const width = Math.max(64, maxX - minX + 32);
  const height = Math.max(64, maxZ - minZ + 32);
  const viewport = mapViewport();
  const availableWidth = viewport.width;
  const availableHeight = viewport.height;
  scale = Math.max(0.000001, Math.min(4, Math.min(availableWidth / width, availableHeight / height)));
  fittedDimension = `${selectedDimension}|${includeRemote ? 'all' : 'main'}`;
  fittedTerrainGeneration = terrainGeneration;
  draw();
}

function renderSelected(redraw = true) {
  const player = selectedPlayer();
  if (!player) {
    selectedName = '';
    selectedPanel.hidden = true;
    moderationForm.hidden = true;
    if (redraw) draw();
    return;
  }
  selectedPanel.hidden = false;
  $('selectedName').textContent = player.name;
  $('selectedDimension').textContent = `${player.online === false ? (playerHasPosition(player) ? 'Offline · last known' : 'Offline · location unknown') : stalePlayerPosition(player) ? 'Online · last known' : 'Online'}${player.dimension ? ` · ${dimensionName(player.dimension)}` : ''}`;
  $('selectedX').textContent = coordinate(player.x);
  $('selectedY').textContent = coordinate(player.y);
  $('selectedZ').textContent = coordinate(player.z);
  document.querySelector('[data-player-action="kick"]').disabled = player.online === false;
  if (redraw) draw();
}

function renderPlayers(redraw = true) {
  const filter = search.value.trim().toLowerCase();
  const players = rosterPlayers().filter(player => !filter || String(player.name).toLowerCase().includes(filter));
  for (const player of players) loadPlayerHead(player);
  $('playerCount').textContent = String(players.length);
  $('playerCount').title = `${players.filter(player => player.online !== false).length} online · ${players.length} total`;
  const fragment = document.createDocumentFragment();
  for (const player of players) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'player-row';
    button.classList.toggle('offline', player.online === false);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(String(player.name).toLowerCase() === selectedName.toLowerCase()));
    const dot = document.createElement('i');
    dot.setAttribute('aria-hidden', 'true');
    const head = document.createElement('canvas');
    head.width = 24; head.height = 24; head.className = 'player-head';
    head.dataset.playerHead = String(player.name).toLowerCase();
    head.setAttribute('aria-hidden', 'true');
    paintHead(head.getContext('2d'), player, 0, 0, 24);
    const name = document.createElement('span');
    name.textContent = player.name;
    const coords = document.createElement('small');
    coords.textContent = playerHasPosition(player) ? `${Math.round(player.x)}, ${Math.round(player.z)}` : '—';
    button.title = `${player.name} · ${player.online === false ? 'Offline; last known location' : stalePlayerPosition(player) ? 'Online; last known location' : 'Online'}${playerHasPosition(player) ? ` · ${dimensionName(player.dimension)} · X ${coordinate(player.x)}, Z ${coordinate(player.z)}` : ' · Location unavailable'}`;
    button.setAttribute('aria-label', button.title);
    button.append(dot, head, name, coords);
    button.addEventListener('click', () => {
      selectedName = player.name;
      if (playerHasPosition(player)) {
        selectedDimension = player.dimension;
        centerX = Number(player.x);
        centerZ = Number(player.z);
        scale = Math.max(scale, 0.8);
        fittedDimension = `${selectedDimension}|manual`;
      }
      moderationForm.hidden = true;
      updateDimensionButtons();
      renderPlayers();
    });
    fragment.append(button);
  }
  playerList.replaceChildren(fragment);
  renderSelected(redraw);
}

function updateDimensionButtons() {
  document.querySelectorAll('[data-dimension]').forEach(button => {
    const active = button.dataset.dimension === selectedDimension;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function saveLayerSettings() {
  try { localStorage.setItem('world-map-layers-v2', JSON.stringify({ ...layerSettings, hiddenStructures: [...layerSettings.hiddenStructures] })); } catch {}
}

function renderStructureLayers() {
  const types = [...new Set([...STRUCTURE_TYPES, ...(snapshot?.markers || []).map(structureType).filter(Boolean)])].sort();
  const signature = types.join('|');
  if (signature === layerSignature) return;
  layerSignature = signature;
  const fragment = document.createDocumentFragment();
  for (const type of types) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !layerSettings.hiddenStructures.has(type);
    input.dataset.structureType = type;
    input.addEventListener('change', () => {
      if (input.checked) layerSettings.hiddenStructures.delete(type);
      else layerSettings.hiddenStructures.add(type);
      saveLayerSettings(); scheduleDraw();
    });
    label.append(input);
    if (STRUCTURE_TYPES.includes(type)) {
      const icon = document.createElement('img');
      icon.src = `assets/map-icons/${type}.png`; icon.alt = '';
      icon.onerror = () => { icon.hidden = true; };
      label.append(icon);
    }
    label.append(document.createTextNode(markerName(type)));
    fragment.append(label);
  }
  $('structureLayers').replaceChildren(fragment);
}

function render() {
  $('mapTitle').textContent = snapshot?.serverName ? `${snapshot.serverName} — Live Map` : 'Live World Map';
  const terrainIndex = snapshot?.terrainIndex || {};
  $('mapBackendLabel').textContent = 'Live map';
  const seedToggle = document.querySelector('[data-map-layer="seed"]');
  const slimeToggle = document.querySelector('[data-map-layer="slime"]');
  seedToggle.disabled = snapshot?.seedPreviewAvailable === false;
  slimeToggle.disabled = snapshot?.slimeChunksAvailable === false || selectedDimension !== 'minecraft:overworld';
  if (seedToggle.disabled) $('seedLayer').title = 'Seed preview is unavailable for this world; saved terrain remains visible.';
  const mapToggle = $('mapDisable');
  const queuedAction = String(snapshot?.map?.queuedAction || '');
  mapToggle.disabled = Boolean(queuedAction);
  mapToggle.textContent = queuedAction === 'install'
    ? 'Enable queued'
    : queuedAction === 'remove'
      ? 'Disable queued'
      : snapshot?.map?.installed ? 'Disable map' : 'Enable map';
  const cellCount = terrainCellCount();
  const coverageCount = generatedChunkCount();
  empty.hidden = cellCount > 0 || coverageCount > 0 || Boolean(layerSettings.seed && seedRaster
    && seedResult?.dimension === selectedDimension && seedResult.worldToken === snapshot?.worldToken);
  if (!cellCount && !coverageCount) {
    $('mapEmptyTitle').textContent = snapshot?.serverState === 'running' ? 'Map loading' : 'No saved map';
    $('mapEmptyDetail').textContent = terrainIndex.complete ? 'No saved terrain in this dimension.' : '';
  }
  notice('');
  renderStructureLayers();
  renderPlayers(false);
  const fittedMode = fittedDimension.startsWith(`${selectedDimension}|`)
    ? fittedDimension.slice(selectedDimension.length + 1)
    : '';
  if ((cellCount || coverageCount) && !fittedMode) fitTerrain(false);
  else draw();
}

async function refresh() {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    const next = await api.getSnapshot(snapshot?.terrainToken || '');
    if (next?.terrainUnchanged && snapshot) {
      next.terrain = snapshot.terrain;
      next.generatedRegions = snapshot.generatedRegions;
    }
    const terrainChanged = !snapshot || !next?.terrainUnchanged;
    if (terrainChanged) {
      if (!await rebuildTerrainIndexAsync(next)) return;
    } else snapshot = next;
    render();
  } catch (error) {
    notice(readableError(error), true);
  } finally {
    refreshBusy = false;
  }
}

function beginModeration(action) {
  moderationAction = action;
  moderationForm.hidden = false;
  durationRow.hidden = action !== 'tempban';
  $('moderationReason').value = '';
  $('moderationConfirm').textContent = action === 'kick' ? 'Kick' : action === 'ban' ? 'Ban' : 'Temp ban';
  $('moderationReason').focus();
}

async function submitModeration(event) {
  event.preventDefault();
  const player = selectedPlayer();
  if (!player || !moderationAction) return;
  const reason = $('moderationReason').value.trim();
  moderationForm.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
  try {
    if (moderationAction === 'kick') await api.kickPlayer(player.name, reason);
    else if (moderationAction === 'ban') await api.banPlayer(player.name, reason);
    else {
      const amount = Math.max(1, Math.min(365, Number($('durationValue').value) || 1));
      const multiplier = Number($('durationUnit').value) || 3_600_000;
      await api.tempBanPlayer(player.name, amount * multiplier, reason);
    }
    moderationForm.hidden = true;
    moderationAction = '';
    await refresh();
  } catch (error) {
    notice(readableError(error), true);
  } finally {
    moderationForm.querySelectorAll('button,input,select').forEach(element => { element.disabled = false; });
  }
}

document.querySelectorAll('[data-window-action]').forEach(button => button.addEventListener('click', () => api.windowAction(button.dataset.windowAction)));
document.querySelectorAll('[data-dimension]').forEach(button => button.addEventListener('click', () => {
  selectedDimension = button.dataset.dimension;
  fittedDimension = '';
  updateDimensionButtons();
  render();
}));
$('mapFit').addEventListener('click', () => fitTerrain(false));
$('mapFitAll').addEventListener('click', () => fitTerrain(true));
$('mapRefresh').addEventListener('click', refresh);
$('mapDisable').addEventListener('click', async () => {
  const installed = snapshot?.map?.installed === true;
  if (installed && !confirm('Disable the live map for this server? The module will be removed at the next server start.')) return;
  $('mapDisable').disabled = true;
  try {
    const result = installed ? await api.disable() : await api.install();
    notice(result?.message || (installed
      ? 'Live map disable queued for the next server start.'
      : 'Live map enable queued for the next server start.'));
    await refresh();
  } catch (error) {
    notice(readableError(error), true);
    $('mapDisable').disabled = false;
  }
});
search.addEventListener('input', renderPlayers);
moderationForm.addEventListener('submit', submitModeration);
$('moderationCancel').addEventListener('click', () => { moderationForm.hidden = true; moderationAction = ''; });
document.querySelectorAll('[data-player-action]').forEach(button => button.addEventListener('click', () => {
  const player = selectedPlayer();
  if (!player) return;
  if (button.dataset.playerAction === 'view') api.openPlayerProfile(player.name);
  else beginModeration(button.dataset.playerAction);
}));

canvas.addEventListener('wheel', event => {
  event.preventDefault();
  const before = worldPoint(event.offsetX, event.offsetY);
  const wheelPixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
  scale = Math.max(0.000001, Math.min(8, scale * Math.exp(-Math.max(-240, Math.min(240, wheelPixels)) * 0.00165)));
  const after = worldPoint(event.offsetX, event.offsetY);
  centerX += before.x - after.x;
  centerZ += before.z - after.z;
  fittedDimension = `${selectedDimension}|manual`;
  scheduleDraw();
}, { passive: false });
canvas.addEventListener('pointerdown', event => {
  const viewport = mapViewport();
  if (event.offsetX < viewport.left || event.offsetY >= viewport.bottom) return;
  dragging = true;
  pointerMoved = false;
  dragStart = { x: event.clientX, y: event.clientY, centerX, centerZ };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!dragging || !dragStart) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  pointerMoved ||= Math.abs(dx) + Math.abs(dy) > 3;
  centerX = dragStart.centerX - dx / scale;
  centerZ = dragStart.centerZ - dy / scale;
  fittedDimension = `${selectedDimension}|manual`;
  scheduleDraw();
});
canvas.addEventListener('pointerup', event => {
  if (!dragging) return;
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  if (pointerMoved) return;
  const world = worldPoint(event.offsetX, event.offsetY);
  const player = dimensionPlayers().find(candidate => {
    const point = screenPoint(candidate.x, candidate.z);
    return Math.hypot(point.x - event.offsetX, point.y - event.offsetY) <= 12;
  });
  if (player) {
    selectedName = player.name;
    renderPlayers();
    return;
  }
  const marker = (snapshot?.markers || []).find(candidate => {
    if (!markerVisible(candidate)) return false;
    const point = screenPoint(candidate.x, candidate.z);
    return Math.hypot(point.x - event.offsetX, point.y - event.offsetY) <= 12;
  });
  if (marker) {
    $('mapReadout').hidden = false;
    $('mapReadout').textContent = `${markerName(marker.id)}  ·  X ${Math.round(marker.x)}  ·  Z ${Math.round(marker.z)}`;
    return;
  }
  const bucketX = Math.floor(world.x / TERRAIN_BUCKET_SIZE);
  const bucketZ = Math.floor(world.z / TERRAIN_BUCKET_SIZE);
  let nearest = null;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = terrainBuckets.get(`${selectedDimension}|${bucketX + dx}|${bucketZ + dz}`) || [];
      for (const candidate of bucket) {
        const distance = Math.hypot(candidate.x - world.x, candidate.z - world.z);
        if (!nearest || distance < nearest.distance) nearest = { candidate, distance };
      }
    }
  }
  const cell = nearest?.candidate;
  if (cell) {
    $('mapReadout').hidden = false;
    $('mapReadout').textContent = `X ${Math.round(world.x)}  ·  Z ${Math.round(world.z)}  ·  Y ${cell.y}  ·  ${cell.block.replace(/^minecraft:/, '')}`;
  }
});
canvas.addEventListener('pointercancel', () => { dragging = false; dragStart = null; });

try {
  const saved = JSON.parse(localStorage.getItem('world-map-layers-v2') || '{}');
  for (const name of ['grid', 'slime', 'seed', 'players', 'offline', 'structures']) {
    if (typeof saved[name] === 'boolean') layerSettings[name] = saved[name];
  }
  if (Array.isArray(saved.hiddenStructures)) layerSettings.hiddenStructures = new Set(saved.hiddenStructures.filter(value => typeof value === 'string').slice(0, 128));
} catch {}
document.querySelectorAll('[data-map-layer]').forEach(input => {
  input.checked = layerSettings[input.dataset.mapLayer];
  input.addEventListener('change', () => {
    layerSettings[input.dataset.mapLayer] = input.checked;
    if (input.dataset.mapLayer === 'seed' && !input.checked) api.stopSeedPreview?.().catch(() => {});
    saveLayerSettings(); render();
  });
});
loadMarkerImages();
api.onState(() => refresh());
api.onPlayers(() => refresh());
api.onMapStatus(() => refresh());
new ResizeObserver(resizeCanvas).observe(canvas);
window.bridge?.onAppThemeChanged?.(() => { cachedTheme = null; scheduleDraw(); });
refresh();
refreshTimer = setInterval(refresh, 2500);
