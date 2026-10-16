const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = __dirname;
const root = process.env.CLICK_INTERVAL_MAP_ASSET_ROOT || projectRoot;
const output = process.env.CLICK_INTERVAL_MAP_SCREENSHOT
  || path.join(projectRoot, 'work', 'world-map-render-smoke.png');
const requestedSnapshot = process.env.CLICK_INTERVAL_MAP_SNAPSHOT || '';
const benchmarkFrames = Math.max(1, Math.min(240, Number(process.env.CLICK_INTERVAL_MAP_BENCHMARK_FRAMES) || 120));
const benchmarkScale = Math.max(0.000001, Math.min(8, Number(process.env.CLICK_INTERVAL_MAP_SCALE) || 0.04));
const fitAllTerrain = process.env.CLICK_INTERVAL_MAP_FIT_ALL === '1';

function syntheticSnapshot() {
  const terrain = [];
  const regionMasks = new Map();
  const dimensions = ['minecraft:overworld', 'minecraft:the_nether'];
  for (const dimension of dimensions) {
    const radius = dimension.endsWith('overworld') ? 110 : 42;
    for (let chunkZ = -radius; chunkZ <= radius; chunkZ++) {
      for (let chunkX = -radius; chunkX <= radius; chunkX++) {
        if ((chunkX * chunkX) + (chunkZ * chunkZ) > radius * radius) continue;
        const x = chunkX * 16;
        const z = chunkZ * 16;
        const shade = Math.abs((chunkX * 13 + chunkZ * 7) % 30);
        const color = dimension.endsWith('overworld')
          ? `#${(70 + shade).toString(16).padStart(2, '0')}a45b`
          : `#${(95 + shade).toString(16).padStart(2, '0')}3939`;
        terrain.push({ dimension, x, z, y: 64, color, block: 'minecraft:grass_block', size: 16 });
        const regionX = Math.floor(chunkX / 32);
        const regionZ = Math.floor(chunkZ / 32);
        const localX = ((chunkX % 32) + 32) % 32;
        const localZ = ((chunkZ % 32) + 32) % 32;
        const key = `${dimension}|${regionX}|${regionZ}`;
        const mask = regionMasks.get(key) || Buffer.alloc(128);
        const bit = localX + localZ * 32;
        mask[bit >>> 3] |= 1 << (bit & 7);
        regionMasks.set(key, mask);
      }
    }
  }
  // A saved chunk with no color yet exercises the muted coverage underlay used during indexing.
  const pendingChunkX = 111;
  const pendingChunkZ = 0;
  const pendingRegionX = Math.floor(pendingChunkX / 32);
  const pendingRegionZ = Math.floor(pendingChunkZ / 32);
  const pendingKey = `minecraft:overworld|${pendingRegionX}|${pendingRegionZ}`;
  const pendingMask = regionMasks.get(pendingKey) || Buffer.alloc(128);
  const pendingBit = ((pendingChunkX % 32) + 32) % 32
    + ((((pendingChunkZ % 32) + 32) % 32) * 32);
  pendingMask[pendingBit >>> 3] |= 1 << (pendingBit & 7);
  regionMasks.set(pendingKey, pendingMask);
  const borderChunkX = 1_874_998;
  const borderChunkZ = 1_874_998;
  const borderRegionX = Math.floor(borderChunkX / 32);
  const borderRegionZ = Math.floor(borderChunkZ / 32);
  const borderKey = `minecraft:overworld|${borderRegionX}|${borderRegionZ}`;
  const borderMask = regionMasks.get(borderKey) || Buffer.alloc(128);
  const borderBit = ((borderChunkX % 32) + 32) % 32
    + ((((borderChunkZ % 32) + 32) % 32) * 32);
  borderMask[borderBit >>> 3] |= 1 << (borderBit & 7);
  regionMasks.set(borderKey, borderMask);
  terrain.unshift({
    dimension: 'minecraft:overworld', x: borderChunkX * 16, z: borderChunkZ * 16,
    y: 62, color: '#3478b8', block: 'minecraft:water', size: 16
  });
  return {
    serverState: 'running',
    serverName: 'Map render smoke test',
    players: [],
    markers: [{ kind: 'spawn', id: 'minecraft:spawn', dimension: 'minecraft:overworld', x: 0, z: 0 }],
    terrain,
    generatedRegions: [...regionMasks].map(([key, mask]) => {
      const [dimension, regionX, regionZ] = key.split('|');
      return { dimension, regionX: Number(regionX), regionZ: Number(regionZ), chunks: mask.toString('base64') };
    }),
    terrainRevision: 1,
    terrainToken: 'smoke:1',
    generatedAt: Date.now(),
    map: { message: '' }
  };
}

function normalizeSnapshot(parsed) {
  const normalizeCell = cell => {
    const compact = Array.isArray(cell);
    return {
      dimension: String(compact ? cell[0] : cell.dimension),
      x: Number(compact ? cell[1] : cell.x),
      z: Number(compact ? cell[2] : cell.z),
      y: Number(compact ? cell[3] : cell.y),
      color: String(compact ? cell[4] : cell.color),
      block: String(compact ? cell[5] : cell.block),
      size: Number(compact ? cell[6] : cell.size) || 4
    };
  };
  const coarse = Array.isArray(parsed.coarseTerrain) ? parsed.coarseTerrain.map(normalizeCell) : [];
  let detailed = Array.isArray(parsed.terrain) ? parsed.terrain.map(normalizeCell) : [];
  if (!coarse.length && Number(parsed.version) === 1) {
    const chunks = new Map();
    for (const original of detailed) {
      const cell = original.dimension === 'minecraft:overworld' && original.block === 'minecraft:dirt'
        ? { ...original, color: '#67a84f' }
        : original;
      const key = `${cell.dimension}|${Math.floor(cell.x / 16)}|${Math.floor(cell.z / 16)}`;
      const chunk = chunks.get(key);
      if (chunk) chunk.push(cell);
      else chunks.set(key, [cell]);
    }
    const representativeFor = chunk => {
      const counts = new Map();
      for (const cell of chunk) {
        if (cell.block === 'minecraft:air' || cell.block === 'minecraft:cave_air') continue;
        const key = `${cell.color}|${cell.block}`;
        const current = counts.get(key);
        if (current) current.count++;
        else counts.set(key, { count: 1, cell });
      }
      return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.cell || null;
    };
    const representatives = new Map();
    for (const [key, chunk] of chunks) {
      const representative = representativeFor(chunk);
      if (representative) representatives.set(key, representative);
    }
    const nearbyRepresentative = (dimension, chunkX, chunkZ) => {
      for (let radius = 1; radius <= 2; radius++) {
        const nearby = [];
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
            const representative = representatives.get(`${dimension}|${chunkX + dx}|${chunkZ + dz}`);
            if (representative) nearby.push(representative);
          }
        }
        if (nearby.length) return representativeFor(nearby);
      }
      return null;
    };
    const underlays = [];
    const repairedDetails = [];
    for (const [chunkKey, chunk] of chunks) {
      const first = chunk[0];
      const chunkX = Math.floor(first.x / 16);
      const chunkZ = Math.floor(first.z / 16);
      const localX = ((Math.floor(first.x) % 16) + 16) % 16;
      const localZ = ((Math.floor(first.z) % 16) + 16) % 16;
      const representative = representatives.get(chunkKey) || (
        first.dimension === 'minecraft:overworld'
          ? nearbyRepresentative(first.dimension, chunkX, chunkZ)
          : null
      );
      if (representative && (chunk.length > 1 || (localX === 8 && localZ === 8))) {
        underlays.push({ ...representative, x: chunkX * 16, z: chunkZ * 16, size: 16 });
      }
      if (chunk.length > 1) {
        repairedDetails.push(...chunk.filter(cell => cell.block !== 'minecraft:air' && cell.block !== 'minecraft:cave_air'));
      } else if ((localX !== 8 || localZ !== 8) && first.block !== 'minecraft:air' && first.block !== 'minecraft:cave_air') {
        repairedDetails.push(first);
      }
    }
    detailed = [...underlays, ...repairedDetails];
  }
  return {
    serverState: 'running',
    serverName: 'Map render smoke test',
    players: [],
    markers: Array.isArray(parsed.markers) ? parsed.markers : [],
    terrain: [...coarse, ...detailed],
    generatedRegions: Array.isArray(parsed.generatedRegions) ? parsed.generatedRegions.map(entry => ({
      dimension: String(Array.isArray(entry) ? entry[0] : entry.dimension),
      regionX: Number(Array.isArray(entry) ? entry[1] : entry.regionX),
      regionZ: Number(Array.isArray(entry) ? entry[2] : entry.regionZ),
      chunks: String(Array.isArray(entry) ? entry[3] : entry.chunks)
    })) : [],
    terrainRevision: Number(parsed.terrainRevision) || 1,
    terrainToken: `smoke:${Number(parsed.terrainRevision) || 1}`,
    generatedAt: Date.now(),
    map: { message: '' }
  };
}

function loadSnapshot() {
  if (!requestedSnapshot) return syntheticSnapshot();
  return normalizeSnapshot(JSON.parse(fs.readFileSync(requestedSnapshot, 'utf8')));
}

app.setPath('userData', path.join(os.tmpdir(), `click-interval-map-smoke-${process.pid}`));
app.whenReady().then(async () => {
  const snapshot = loadSnapshot();
  ipcMain.on('load-app-settings', event => { event.returnValue = {}; });
  ipcMain.handle('world-map:snapshot', () => snapshot);
  ipcMain.handle('players:getSkin', () => ({}));
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 760,
    backgroundColor: '#15171a',
    webPreferences: {
      preload: path.join(root, 'world-map-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadFile(path.join(root, 'world-map.html'));
  await new Promise(resolve => setTimeout(resolve, 750));
  const benchmark = await window.webContents.executeJavaScript(`(() => {
    fittedDimension = '';
    fitTerrain(${fitAllTerrain ? 'true' : 'false'});
    scale = ${benchmarkScale};
    const started = performance.now();
    const frames = ${benchmarkFrames};
    for (let index = 0; index < frames; index++) draw();
    const elapsed = performance.now() - started;
    const tileCount = typeof terrainTiles === 'undefined' ? 0 : terrainTiles.size;
    const generated = typeof generatedChunkCount === 'function' ? generatedChunkCount() : 0;
    const colored = typeof terrainCellCount === 'function' ? terrainCellCount() : 0;
    const coverageTiles = typeof generatedRegionTiles === 'undefined' ? 0 : generatedRegionTiles.size;
    const bounds = typeof mapBounds === 'function' ? mapBounds('minecraft:overworld', true) : null;
    const hidden = typeof hiddenWorldBorderChunks === 'number' ? hiddenWorldBorderChunks : 0;
    return { elapsed, averageFrameMs: elapsed / frames, frames, tiles: tileCount, coverageTiles, generated, colored, hidden, bounds, cells: snapshot.terrain.length };
  })()`);
  if (snapshot.generatedRegions.length
      && (!benchmark.generated || !benchmark.coverageTiles || benchmark.generated <= benchmark.colored
        || !benchmark.hidden || !benchmark.bounds || benchmark.bounds.maxX >= 100_000)) {
    throw new Error('Generated terrain coverage did not reach the renderer.');
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const image = await window.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());
  process.stdout.write(`${JSON.stringify({ ...benchmark, output })}\n`);
  window.destroy();
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
