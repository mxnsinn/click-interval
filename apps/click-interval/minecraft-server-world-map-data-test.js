'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTerrainReader, createRosterReader, mergePlayerRoster, normalizeTerrainCells, normalizeGeneratedRegions } = require('./minecraft-server/world-map-data');

const firstUuid = '00112233445566778899aabbccddeeff';
const otherUuid = 'ffeeddccbbaa99887766554433221100';
const pose = { dimension: 'minecraft:overworld', x: -42, y: 71, z: 456 };
const now = 1_900_000_000_000;
const player = { name: 'MapTester', uuid: firstUuid, ...pose };

async function temporary(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'map-data-test-'));
  try { return await work(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('terrain normalization preserves exact sample origins and dimensions without rounding', () => {
  const cells = normalizeTerrainCells([
    ['minecraft:overworld', -4, -16, 80, '#12abEF', 'minecraft:grass_block', 4],
    { dimension: 'minecraft:the_nether', x: 16, z: 16, y: 63, color: '#ff0044', block: 'minecraft:netherrack', size: 16 },
    ['minecraft:overworld', 40_000_000, 0, 4, '#ffffff', 'minecraft:stone', 4],
    ['minecraft:overworld', 'bad', 0, 4, '#ffffff', 'minecraft:stone', 4]
  ], 10);
  assert.equal(cells.length, 2);
  assert.deepEqual(cells[0], { dimension: 'minecraft:overworld', x: -4, z: -16, y: 80, color: '#12abEF', block: 'minecraft:grass_block', size: 4 });
  assert.equal(cells[1].size, 16);
});

test('generated region masks must be canonical, bounded and deduplicated', () => {
  const mask = Buffer.alloc(128); mask[0] = 3;
  const row = ['minecraft:overworld', -1, 3, mask.toString('base64')];
  assert.equal(normalizeGeneratedRegions([row, row, ['minecraft:overworld', 1, 1, 'bad'], ['', 1, 1, mask.toString('base64')]]).length, 1);
});

test('real worker reads coarse beneath detail, caches unchanged revisions, and survives corrupt publication', async () => temporary(async root => {
  const file = path.join(root, 'terrain.json');
  await fs.writeFile(file, JSON.stringify({ terrainRevision: 9, coarseTerrain: [['minecraft:overworld', 0, 0, 64, '#779944', 'minecraft:grass_block', 16]], terrain: [['minecraft:overworld', 4, 4, 65, '#223344', 'minecraft:water', 4]] }));
  const reader = createTerrainReader();
  const first = await reader.read(file);
  assert.equal(first.terrain.length, 2);
  assert.equal(first.terrain[0].size, 16);
  assert.equal(first.terrain[1].size, 4);
  assert.equal(first.terrainRevision, 9);
  assert.strictEqual(await reader.read(file), first);
  await fs.writeFile(file, '{partial');
  assert.strictEqual(await reader.read(file), first);
  const other = path.join(root, 'other.json');
  await fs.writeFile(other, '{partial');
  assert.deepEqual((await reader.read(other)).terrain, []);
  reader.clear();
  assert.deepEqual((await reader.read(file)).terrain, []);
}));

test('concurrent read requests share one worker, and different profiles are serialized', async () => temporary(async root => {
  const a = path.join(root, 'a.json'), b = path.join(root, 'b.json');
  await fs.writeFile(a, '{}'); await fs.writeFile(b, '{}');
  let count = 0, active = 0, peak = 0;
  const reader = createTerrainReader({ runWorker: async file => {
    count++; peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active--;
    const stat = await fs.stat(file);
    return { fingerprint: `${stat.mtimeMs}:${stat.size}`, value: { terrain: [], generatedRegions: [], terrainRevision: count } };
  } });
  const [one, two] = await Promise.all([reader.read(a), reader.read(a), reader.read(b)]);
  assert.strictEqual(one, two);
  assert.equal(count, 2);
  assert.equal(peak, 1);
}));

test('roster includes historical and cached players, puts online first and leaves unknown coordinates null', () => {
  const rows = mergePlayerRoster({ now, generatedAt: now, serverRunning: true, players: [player],
    history: { a: { name: 'Alpha', lastSeen: new Date(now - 1000).toISOString() } },
    userCache: [{ name: 'Zed', uuid: otherUuid }] });
  assert.deepEqual(rows.map(row => [row.name, row.online]), [['MapTester', true], ['Alpha', false], ['Zed', false]]);
  assert.equal(rows[1].x, null); assert.equal(rows[1].dimension, '');
  assert.equal(rows[0].x, -42); assert.equal(rows[0].lastPositionAt, now);
});

test('stale, future and stopped snapshots never leave players online', () => {
  for (const input of [{ generatedAt: now - 15_001, serverRunning: true }, { generatedAt: now + 5001, serverRunning: true }, { generatedAt: now, serverRunning: false }]) {
    const rows = mergePlayerRoster({ now, players: [player], ...input });
    assert.equal(rows[0].online, false);
    assert.equal(rows[0].x, null);
  }
});

test('newer authoritative absence and logout events defeat an older otherwise fresh snapshot', () => {
  assert.equal(mergePlayerRoster({ now, generatedAt: now - 1000, serverRunning: true, players: [player], authoritativeNames: [], authoritativeAt: now })[0].online, false);
  const history = { test: { name: player.name, lastEvent: 'left', lastActive: new Date(now).toISOString() } };
  assert.equal(mergePlayerRoster({ now, generatedAt: now - 1000, serverRunning: true, players: [player], history })[0].online, false);
  assert.equal(mergePlayerRoster({ now, generatedAt: now - 2000, serverRunning: true, players: [player], history, authoritativeNames: [player.name], authoritativeAt: now - 1000 })[0].online, false);
});

test('fresh roster can show a newly joined player without inventing coordinates', () => {
  const rows = mergePlayerRoster({ now, generatedAt: now - 1000, serverRunning: true, players: [], authoritativeNames: ['JoinedNow'], authoritativeAt: now });
  assert.equal(rows[0].online, true); assert.equal(rows[0].x, null);
});

test('last known position survives logout but is never transferred to a different UUID', () => {
  const lastPositions = new Map();
  mergePlayerRoster({ now, generatedAt: now, serverRunning: true, players: [player], lastPositions });
  const history = { tester: { name: player.name, uuid: firstUuid, lastSeen: now } };
  const offline = mergePlayerRoster({ now: now + 20_000, serverRunning: false, history, lastPositions });
  assert.equal(offline[0].online, false); assert.equal(offline[0].x, pose.x); assert.equal(offline[0].lastPositionAt, now);
  const renamedOwner = mergePlayerRoster({ now, history: { tester: { name: player.name, uuid: otherUuid } }, lastPositions });
  assert.equal(renamedOwner[0].x, null);
});

test('UUID identity deduplicates a renamed player using the latest authenticated cache name', () => {
  const rows = mergePlayerRoster({ history: { old: { name: 'OldName', uuid: firstUuid } }, userCache: [{ name: 'NewName', uuid: firstUuid }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'NewName');
});

test('offline NBT positions are read only, bounded, cached, and scoped to the world token', async () => temporary(async root => {
  const paths = { root, playerHistory: path.join(root, 'history.json'), playerCache: path.join(root, 'usercache.json') };
  const worldRoot = path.join(root, 'world');
  await fs.mkdir(path.join(worldRoot, 'playerdata'), { recursive: true });
  await fs.writeFile(path.join(worldRoot, 'playerdata', '00112233-4455-6677-8899-aabbccddeeff.dat'), Buffer.from('fake-nbt-fixture'));
  await fs.writeFile(paths.playerHistory, JSON.stringify({ old: { name: player.name, uuid: firstUuid } }));
  await fs.writeFile(paths.playerCache, '[]');
  let reads = 0;
  const reader = createRosterReader({ readNbtFile: async (_file, options) => { reads++; assert.equal(options.maxUncompressedBytes, 8 * 1024 * 1024); return { Pos: [-40, 72, 400], Dimension: 'minecraft:overworld' }; } });
  const input = { paths, worldRoot, worldToken: 'one', players: [], serverRunning: false };
  const first = await reader.read(input);
  assert.equal(first[0].x, -40); assert.equal(first[0].online, false);
  await reader.read(input); assert.equal(reads, 1);
  await reader.read({ ...input, worldToken: 'two' }); assert.equal(reads, 2);
}));

test('26.2 players/data takes precedence over the migrated legacy playerdata file', async () => temporary(async root => {
  const paths = { root, playerHistory: path.join(root, 'history.json'), playerCache: path.join(root, 'usercache.json') };
  const worldRoot = path.join(root, 'world');
  const filename = '00112233-4455-6677-8899-aabbccddeeff.dat';
  await fs.mkdir(path.join(worldRoot, 'players', 'data'), { recursive: true });
  await fs.mkdir(path.join(worldRoot, 'playerdata'), { recursive: true });
  await fs.writeFile(path.join(worldRoot, 'players', 'data', filename), 'new');
  await fs.writeFile(path.join(worldRoot, 'playerdata', filename), 'old');
  await fs.writeFile(paths.playerHistory, JSON.stringify({ test: { name: player.name, uuid: firstUuid } }));
  await fs.writeFile(paths.playerCache, '[]');
  const reader = createRosterReader({ readNbtFile: async file => ({ Pos: [file.includes(`${path.sep}players${path.sep}`) ? 42 : 9000, 72, 0], Dimension: 'minecraft:overworld' }) });
  const rows = await reader.read({ paths, worldRoot, worldToken: 'test', serverRunning: false });
  assert.equal(rows[0].x, 42);
}));
