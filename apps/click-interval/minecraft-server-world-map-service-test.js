'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { mergePlayerRoster } = require('./minecraft-server/world-map-data');
const source = fs.readFileSync(path.join(__dirname, 'minecraft-server', 'main.js'), 'utf8');
const start = source.indexOf('async function getWorldMapSnapshot(');
const end = source.indexOf('async function getWorldMapFabricApiState(', start);
assert(start >= 0 && end > start);

function fixture(overrides = {}) {
  const now = Date.now();
  const sandbox = {
    path, crypto, Promise,
    nativeWorldMapSeedEngineScope: '', nativeWorldMapSeedEngine: null, nativeWorldMapSeedEngineEpoch: 0,
    nativeWorldMapSeedEngineClosing: Promise.resolve(),
    serverState: 'running', livePlayers: new Map([['tester', 'Tester']]), lastPlayerRosterAuthoritativeAt: now,
    getActiveProfile: async () => ({ id: 'fixture', name: 'Fixture' }),
    getPathsForProfile: () => ({ root: path.resolve('work/live-map-improvement/service-fixture') }),
    getWorldMapStatus: async () => ({ capabilities: {} }),
    readConfig: async () => ({ levelName: 'world', serverVersion: '26.2', javaPath: 'fixture-java.exe' }),
    readNativeWorldMapSnapshot: async () => ({ terrainRevision: 42, generatedAt: now,
      terrain: [{ x: 0, z: 0, y: 64, size: 16, dimension: 'minecraft:overworld', color: '#667788' }],
      generatedRegions: [], markers: [], players: [{ name: 'Tester', dimension: 'minecraft:overworld', x: 12, y: 65, z: 23 }] }),
    readWorldMapSeedMetadata: async () => ({ seedString: '1234567890123456789', worldToken: 'private-world-token', seedAvailable: true, previewAvailable: true }),
    nativeWorldMapRosterReader: { read: async input => mergePlayerRoster({ ...input, now }) },
    normalizeWorldMapTerrainIndex: () => ({}),
    resolveContainedPath: (root, file) => {
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside profile');
      return file;
    },
    validatePlayerName: value => {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(value)) throw new Error('Invalid name'); return value;
    },
    getSlimeChunks: (metadata, request) => ({ seedAvailable: metadata.seedAvailable, worldToken: metadata.worldToken,
      chunks: request.worldToken === metadata.worldToken ? [{ x: 1, z: 2 }] : [] }),
    app: { getPath: () => path.resolve('work/live-map-improvement/service-fixture/app-cache') },
    ...overrides
  };
  vm.runInNewContext(`${source.slice(start, end)}
this.api = { getWorldMapSnapshot, getWorldMapSlimeChunks, getWorldMapSeedPreview, getWorldMapPlayerDetails, closeWorldMapSeedEngine };`, sandbox);
  return sandbox;
}

test('snapshot retains terrain by world-scoped token and never exposes the seed', async () => {
  const { api } = fixture();
  const first = await api.getWorldMapSnapshot();
  assert.equal(first.terrain.length, 1);
  assert.equal(first.worldToken, 'private-world-token');
  assert.equal(first.playerRoster[0].online, true);
  assert.equal(first.playerRoster[0].x, 12);
  assert(!JSON.stringify(first).includes('1234567890123456789'));
  const next = await api.getWorldMapSnapshot(first.terrainToken);
  assert.equal(next.terrainUnchanged, true); assert.equal(next.terrain.length, 0);
});

test('absent or corrupt seed metadata leaves saved terrain and roster available', async () => {
  const { api } = fixture({ readWorldMapSeedMetadata: async () => { throw new Error('Truncated world save'); } });
  const snapshot = await api.getWorldMapSnapshot();
  assert.equal(snapshot.terrain.length, 1); assert.equal(snapshot.playerRoster.length, 1);
  assert.equal(snapshot.seedPreviewAvailable, false); assert.equal(snapshot.slimeChunksAvailable, false);
  assert.match(snapshot.worldToken, /^unavailable:[a-f0-9]{24}$/);
});

test('a profile switch during a snapshot rejects the old profile result', async () => {
  let calls = 0;
  const { api } = fixture({ getActiveProfile: async () => ({ id: ++calls === 1 ? 'first' : 'second' }) });
  await assert.rejects(api.getWorldMapSnapshot(), /selected server changed/);
});

test('map player details come only from snapshot/playerdata, never console commands', async () => {
  const detailsSource = source.slice(source.indexOf('async function getWorldMapPlayerDetails('), end);
  assert.doesNotMatch(detailsSource, /capturePlayerPose|sendServerCommand|sendCommand|bridge\.request/);
  const { api } = fixture();
  const result = await api.getWorldMapPlayerDetails('Tester');
  assert.equal(result.x, 12); assert.equal(result.z, 23);
  await assert.rejects(api.getWorldMapPlayerDetails('Unknown'), /has not been seen/);
});

test('preview is optional, never starts for an outdated world token, and closes only its own helper', async () => {
  let created = 0, closed = 0;
  class Engine {
    constructor() { created++; }
    preview(metadata) { return Promise.resolve({ available: true, worldToken: metadata.worldToken, cells: [] }); }
    close() { closed++; return Promise.resolve(); }
  }
  const { api } = fixture({ SeedPreviewEngine: Engine });
  assert.equal((await api.getWorldMapSeedPreview({ worldToken: 'wrong' })).available, false);
  assert.equal(created, 0);
  assert.equal((await api.getWorldMapSeedPreview({ worldToken: 'private-world-token' })).available, true);
  assert.equal(created, 1);
  await api.closeWorldMapSeedEngine(); assert.equal(closed, 1);
});

test('concurrent close/reopen waits for the previous preview JVM exit before creating another', async () => {
  let created = 0, alive = 0, peak = 0, releaseOld;
  class Engine {
    constructor() { this.id = ++created; peak = Math.max(peak, ++alive); }
    preview(metadata) { return Promise.resolve({ available: true, worldToken: metadata.worldToken, cells: [] }); }
    close() {
      if (this.id === 1) return new Promise(resolve => { releaseOld = () => { alive--; resolve(); }; });
      alive--; return Promise.resolve();
    }
  }
  const { api } = fixture({ SeedPreviewEngine: Engine });
  await api.getWorldMapSeedPreview({ worldToken: 'private-world-token' });
  const closing = api.closeWorldMapSeedEngine();
  const requests = [api.getWorldMapSeedPreview({ worldToken: 'private-world-token' }), api.getWorldMapSeedPreview({ worldToken: 'private-world-token' })];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created, 1); assert.equal(alive, 1);
  releaseOld(); await closing; await Promise.all(requests);
  assert.equal(created, 2); assert.equal(peak, 1);
  await api.closeWorldMapSeedEngine(); assert.equal(alive, 0);
});
