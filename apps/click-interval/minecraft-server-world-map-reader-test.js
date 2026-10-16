const assert = require('assert');
const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createTerrainReader, normalizeTerrainCells, normalizeGeneratedRegions } = require('./minecraft-server/world-map-data');

const main = fsSync.readFileSync(path.join(__dirname, 'minecraft-server', 'main.js'), 'utf8');
const start = main.indexOf('function normalizeWorldMapTerrainCells');
const end = main.indexOf('async function getWorldMapSnapshot', start);
assert(start >= 0 && end > start, 'world-map reader functions should remain extractable');

const sandbox = {
  fs,
  Buffer,
  MAX_NATIVE_WORLD_MAP_BYTES: 32 * 1024 * 1024,
  MAX_NATIVE_WORLD_MAP_TERRAIN_BYTES: 96 * 1024 * 1024,
  NATIVE_WORLD_MAP_FRESH_MS: 15_000,
  MAX_PLAYER_STATUS_SAMPLE: 250,
  nativeWorldMapSnapshotCache: { file: '', mtimeMs: -1, size: -1, value: null },
  nativeWorldMapTerrainCache: { file: '', mtimeMs: -1, size: -1, value: null },
  nativeWorldMapTerrainReader: createTerrainReader(),
  normalizeTerrainCells,
  normalizeGeneratedRegions,
  serverState: 'running',
  normalizePlayerUuid: value => String(value || '').replace(/-/g, '').toLowerCase()
};
vm.runInNewContext(`${main.slice(start, end)}
this.readNativeWorldMapSnapshot = readNativeWorldMapSnapshot;`, sandbox, { filename: 'world-map-reader-extract.js' });

async function run() {
  const tempRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'click-interval-map-reader-'));
  try {
    const splitRoot = path.join(tempRoot, 'split');
    fsSync.mkdirSync(splitRoot, { recursive: true });
    const splitPaths = {
      nativeWorldMapSnapshot: path.join(splitRoot, 'snapshot.json'),
      nativeWorldMapTerrain: path.join(splitRoot, 'terrain.json')
    };
    fsSync.writeFileSync(splitPaths.nativeWorldMapSnapshot, JSON.stringify({
      version: 3,
      generatedAt: Date.now(),
      terrainRevision: 11,
      terrainIndex: { total: 187373, indexed: 4200, failed: 2, omitted: 5, remaining: 183173, discovering: false },
      players: [{ name: 'MapTester', uuid: '00112233-4455-6677-8899-aabbccddeeff', dimension: 'minecraft:overworld', x: 3, y: 70, z: -4 }],
      markers: [{ kind: 'spawn', id: 'minecraft:spawn', dimension: 'minecraft:overworld', x: 0, z: 0 }]
    }));
    const generatedMask = Buffer.alloc(128);
    generatedMask[0] = 0b00000011;
    fsSync.writeFileSync(splitPaths.nativeWorldMapTerrain, JSON.stringify({
      version: 1,
      generatedAt: Date.now(),
      terrainRevision: 12,
      generatedRegions: [
        ['minecraft:overworld', 0, 0, generatedMask.toString('base64')],
        ['minecraft:overworld', 1, 0, 'not-a-bitmap']
      ],
      coarseTerrain: [['minecraft:overworld', 0, 0, 64, '#67a84f', 'minecraft:grass_block', 16]],
      terrain: [['minecraft:overworld', 4, 4, 65, '#3579bd', 'minecraft:water', 4]]
    }));

    const split = await sandbox.readNativeWorldMapSnapshot(splitPaths);
    assert.strictEqual(split.players.length, 1, 'fresh status players should remain live');
    assert.strictEqual(split.terrainRevision, 12, 'the published terrain file revision should win over status lag');
    assert.strictEqual(split.terrainIndex.total, 187373, 'saved-world indexing progress should reach the renderer');
    assert.strictEqual(split.terrainIndex.indexed, 4200, 'indexed chunk progress should be normalized');
    assert.strictEqual(split.terrainIndex.omitted, 5, 'bounded coverage omissions should remain explicit');
    assert.strictEqual(split.terrain.length, 2, 'coarse and detailed terrain layers should both load');
    assert.strictEqual(split.terrain[0].size, 16, 'coarse coverage should be ordered beneath detail');
    assert.strictEqual(split.terrain[1].size, 4, 'detailed samples should overlay coarse coverage');
    assert.strictEqual(split.generatedRegions.length, 1,
      'only canonical 128-byte generated-chunk masks should reach the renderer');
    assert.strictEqual(split.generatedRegions[0].chunks, generatedMask.toString('base64'));

    const legacyRoot = path.join(tempRoot, 'legacy');
    fsSync.mkdirSync(legacyRoot, { recursive: true });
    const legacyPaths = {
      nativeWorldMapSnapshot: path.join(legacyRoot, 'snapshot.json'),
      nativeWorldMapTerrain: path.join(legacyRoot, 'terrain.json')
    };
    fsSync.writeFileSync(legacyPaths.nativeWorldMapSnapshot, JSON.stringify({
      version: 2,
      generatedAt: Date.now(),
      terrainRevision: 7,
      players: [],
      terrain: [
        ['minecraft:the_nether', 8, 8, 126, '#777777', 'minecraft:bedrock'],
        ['minecraft:overworld', -8, -8, 63, '#79553b', 'minecraft:dirt'],
        ['minecraft:overworld', 32, 32, 64, '#67a84f', 'minecraft:grass_block'],
        ['minecraft:overworld', 36, 32, 64, '#67a84f', 'minecraft:grass_block'],
        ['minecraft:overworld', 48, 48, 64, '#3579bd', 'minecraft:water']
      ],
      markers: []
    }));
    const legacy = await sandbox.readNativeWorldMapSnapshot(legacyPaths);
    assert.strictEqual(legacy.terrainRevision, 7, 'legacy combined snapshots should retain their revision');
    assert.strictEqual(legacy.terrain.length, 6, 'legacy combined snapshots should retain details with seamless chunk underlays');
    assert.strictEqual(legacy.terrain[0].dimension, 'minecraft:the_nether');
    assert.deepStrictEqual(
      { x: legacy.terrain[0].x, z: legacy.terrain[0].z, size: legacy.terrain[0].size, color: legacy.terrain[0].color },
      { x: 0, z: 0, size: 16, color: '#67383a' },
      'a singleton legacy center sample should become full chunk coverage with repaired Nether coloring'
    );
    assert.deepStrictEqual(
      { x: legacy.terrain[1].x, z: legacy.terrain[1].z, size: legacy.terrain[1].size, color: legacy.terrain[1].color },
      { x: -16, z: -16, size: 16, color: '#67a84f' },
      'negative singleton chunks should align to their true chunk origin and repair old dirt coloring'
    );
    assert.deepStrictEqual(
      { x: legacy.terrain[2].x, z: legacy.terrain[2].z, size: legacy.terrain[2].size },
      { x: 32, z: 32, size: 16 },
      'multi-sample legacy chunks should receive a dominant-color underlay'
    );
    assert.strictEqual(legacy.terrain[3].size, 4, 'multi-sample legacy chunks should retain detailed resolution');
    assert.deepStrictEqual(
      { x: legacy.terrain[5].x, z: legacy.terrain[5].z, size: legacy.terrain[5].size },
      { x: 48, z: 48, size: 4 },
      'a non-center singleton must stay a detail sample instead of fabricating full-chunk coverage'
    );

    const airGapRoot = path.join(tempRoot, 'legacy-air-gap');
    fsSync.mkdirSync(airGapRoot, { recursive: true });
    const airGapPaths = {
      nativeWorldMapSnapshot: path.join(airGapRoot, 'snapshot.json'),
      nativeWorldMapTerrain: path.join(airGapRoot, 'terrain.json')
    };
    fsSync.writeFileSync(airGapPaths.nativeWorldMapSnapshot, JSON.stringify({
      version: 1,
      generatedAt: Date.now(),
      terrainRevision: 8,
      players: [],
      terrain: [
        ['minecraft:overworld', 8, 8, 64, '#67a84f', 'minecraft:grass_block'],
        ['minecraft:overworld', 24, 8, 65, '#20242a', 'minecraft:air']
      ],
      markers: []
    }));
    const repairedAirGap = await sandbox.readNativeWorldMapSnapshot(airGapPaths);
    assert.strictEqual(repairedAirGap.terrain.length, 2,
      'legacy overworld air holes should inherit a nearby surface until the saved chunk is re-indexed');
    assert.deepStrictEqual(
      { x: repairedAirGap.terrain[1].x, z: repairedAirGap.terrain[1].z, size: repairedAirGap.terrain[1].size,
        color: repairedAirGap.terrain[1].color, block: repairedAirGap.terrain[1].block },
      { x: 16, z: 0, size: 16, color: '#67a84f', block: 'minecraft:grass_block' },
      'legacy air holes should never be painted as opaque black chunks'
    );

    const terrainOnlyRoot = path.join(tempRoot, 'terrain-only');
    fsSync.mkdirSync(terrainOnlyRoot, { recursive: true });
    const terrainOnlyPaths = {
      nativeWorldMapSnapshot: path.join(terrainOnlyRoot, 'snapshot.json'),
      nativeWorldMapTerrain: path.join(terrainOnlyRoot, 'terrain.json')
    };
    fsSync.writeFileSync(terrainOnlyPaths.nativeWorldMapTerrain, JSON.stringify({
      version: 1,
      generatedAt: 12345,
      terrainRevision: 19,
      coarseTerrain: [['minecraft:overworld', 0, 0, 64, '#67a84f', 'minecraft:grass_block', 16]],
      terrain: []
    }));
    const withoutStatus = await sandbox.readNativeWorldMapSnapshot(terrainOnlyPaths);
    assert.strictEqual(withoutStatus.terrain.length, 1,
      'terrain should remain available while the lightweight status snapshot is missing');
    assert.strictEqual(withoutStatus.terrainRevision, 19,
      'terrain-only snapshots should retain their own revision');
    assert.strictEqual(withoutStatus.players.length, 0,
      'a missing status file must never preserve stale players');
    fsSync.writeFileSync(terrainOnlyPaths.nativeWorldMapSnapshot, '{broken-json');
    const corruptStatus = await sandbox.readNativeWorldMapSnapshot(terrainOnlyPaths);
    assert.strictEqual(corruptStatus.terrain.length, 1,
      'terrain should remain available while the lightweight status snapshot is corrupt');
    assert.strictEqual(corruptStatus.players.length, 0,
      'a corrupt status file must never preserve stale players');

    const coverageOnlyRoot = path.join(tempRoot, 'coverage-only');
    fsSync.mkdirSync(coverageOnlyRoot, { recursive: true });
    const coverageOnlyPaths = {
      nativeWorldMapSnapshot: path.join(coverageOnlyRoot, 'snapshot.json'),
      nativeWorldMapTerrain: path.join(coverageOnlyRoot, 'terrain.json')
    };
    fsSync.writeFileSync(coverageOnlyPaths.nativeWorldMapTerrain, JSON.stringify({
      version: 1,
      generatedAt: 23456,
      terrainRevision: 23,
      generatedRegions: [['minecraft:overworld', 0, 0, generatedMask.toString('base64')]],
      coarseTerrain: [],
      terrain: []
    }));
    const coverageOnly = await sandbox.readNativeWorldMapSnapshot(coverageOnlyPaths);
    assert.strictEqual(coverageOnly.terrainRevision, 23,
      'generated coverage should carry the terrain-file revision before its colors finish indexing');
    assert.strictEqual(coverageOnly.generatedRegions.length, 1,
      'generated coverage should render even before the first colored chunk is published');

    console.log('minecraft split/legacy world-map reader checks passed');
  } finally {
    fsSync.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
