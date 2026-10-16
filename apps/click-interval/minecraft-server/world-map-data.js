'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const MAX_TERRAIN_BYTES = 96 * 1024 * 1024;
const MAX_HISTORY_BYTES = 8 * 1024 * 1024;
const MAX_ROSTER = 10_000;
const MAX_COORDINATE = 30_000_000;

function normalizeTerrainCells(entries, limit) {
  if (!Array.isArray(entries)) return [];
  const output = [];
  for (let index = 0; index < Math.min(entries.length, limit); index++) {
    const cell = entries[index];
    const compact = Array.isArray(cell);
    const dimension = String((compact ? cell[0] : cell?.dimension) || '').slice(0, 128);
    const x = Number(compact ? cell[1] : cell?.x);
    const z = Number(compact ? cell[2] : cell?.z);
    const y = Number(compact ? cell[3] : cell?.y);
    const rawColor = String((compact ? cell[4] : cell?.color) || '');
    const block = String((compact ? cell[5] : cell?.block) || '').slice(0, 128);
    const size = Math.max(1, Math.min(32, Number(compact ? cell[6] : cell?.size) || 4));
    if (!dimension || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)
        || Math.abs(x) > MAX_COORDINATE || Math.abs(z) > MAX_COORDINATE) continue;
    output.push({ dimension, x, z, y, color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#777b7c', block, size });
  }
  return output;
}

function normalizeGeneratedRegions(entries) {
  if (!Array.isArray(entries)) return [];
  const unique = new Map();
  for (const entry of entries.slice(0, 4096)) {
    const compact = Array.isArray(entry);
    const dimension = String((compact ? entry[0] : entry?.dimension) || '').slice(0, 128);
    const regionX = Number(compact ? entry[1] : entry?.regionX);
    const regionZ = Number(compact ? entry[2] : entry?.regionZ);
    const chunks = String((compact ? entry[3] : entry?.chunks) || '');
    if (!dimension || !Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionZ)
        || Math.abs(regionX) > 60_000 || Math.abs(regionZ) > 60_000
        || chunks.length !== 172 || !/^[A-Za-z0-9+/]+=$/.test(chunks)) continue;
    const decoded = Buffer.from(chunks, 'base64');
    if (decoded.length !== 128 || decoded.toString('base64') !== chunks) continue;
    unique.set(`${dimension}|${regionX}|${regionZ}`, { dimension, regionX, regionZ, chunks });
  }
  return [...unique.values()];
}

async function readTerrainInWorker(file) {
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_TERRAIN_BYTES) throw new Error('Invalid terrain size.');
    const buffer = Buffer.allocUnsafe(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Terrain changed while reading.');
    }
    const parsed = JSON.parse(buffer.toString('utf8', 0, length));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || ![parsed.coarseTerrain, parsed.terrain, parsed.generatedRegions].some(Array.isArray)) {
      throw new Error('Invalid terrain snapshot.');
    }
    const coarseTerrain = normalizeTerrainCells(parsed?.coarseTerrain, 500_000);
    const detailedTerrain = normalizeTerrainCells(parsed?.terrain, 250_000);
    return {
      fingerprint: `${after.mtimeMs}:${after.size}`,
      value: {
        terrain: [...coarseTerrain, ...detailedTerrain],
        generatedRegions: normalizeGeneratedRegions(parsed?.generatedRegions),
        terrainRevision: Number(parsed?.terrainRevision) || Number(after.mtimeMs) || 0,
        generatedAt: Number(parsed?.generatedAt) || Number(after.mtimeMs) || 0
      }
    };
  } finally {
    await handle.close();
  }
}

function emptyTerrain() {
  return { terrain: [], generatedRegions: [], terrainRevision: 0, generatedAt: 0 };
}

function runTerrainWorker(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { action: 'terrain', file },
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 }
    });
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Terrain reader timed out.')), 20_000);
    timeout.unref?.();
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.removeAllListeners();
      // Do not retain a worker or its parsed 96 MiB source between map polls.
      worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(value);
    }
    worker.once('message', message => message?.ok
      ? finish(null, message.result) : finish(new Error('Terrain file could not be decoded.')));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Terrain reader exited (${code}).`)); });
  });
}

function createTerrainReader({ runWorker = runTerrainWorker } = {}) {
  let cached = null;
  let generation = 0;
  let queue = Promise.resolve();
  const pending = new Map();
  return {
    clear() { generation++; cached = null; },
    async read(file) {
      const resolved = path.resolve(file);
      let stat;
      try { stat = await fs.stat(resolved); } catch { return emptyTerrain(); }
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_TERRAIN_BYTES) return emptyTerrain();
      const fingerprint = `${stat.mtimeMs}:${stat.size}`;
      if (cached?.file === resolved && cached.fingerprint === fingerprint) return cached.value;
      if (pending.has(resolved)) return pending.get(resolved);
      const capturedGeneration = generation;
      const task = queue.catch(() => {}).then(async () => {
        try {
          const result = await runWorker(resolved);
          if (generation === capturedGeneration) cached = { file: resolved, ...result };
          return result.value;
        } catch {
          // An atomic publisher can briefly expose a missing/partial revision. Retain only the
          // same file's last good data; never use another profile's terrain as a fallback.
          return generation === capturedGeneration && cached?.file === resolved ? cached.value : emptyTerrain();
        }
      }).finally(() => pending.delete(resolved));
      pending.set(resolved, task);
      queue = task.then(() => undefined, () => undefined);
      return task;
    }
  };
}

function normalizedName(value) {
  const name = String(value || '').trim();
  return /^[A-Za-z0-9_]{1,16}$/.test(name) ? name : '';
}

function normalizedUuid(value) {
  const uuid = String(value || '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(uuid) ? uuid : '';
}

function normalizedPosition(value) {
  const source = value?.position || value;
  const number = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
  const x = number(source?.x), y = number(source?.y), z = number(source?.z);
  const dimension = String(value?.dimension || value?.world || '').slice(0, 128);
  if (!dimension || x === null || y === null || z === null || Math.abs(x) > MAX_COORDINATE || Math.abs(z) > MAX_COORDINATE) return null;
  return { x, y, z, dimension };
}

function timestamp(value) {
  const result = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function mergePlayerRoster({ history = {}, userCache = [], players = [], savedPositions = [],
  lastPositions = new Map(), generatedAt = 0, now = Date.now(), serverRunning = false,
  authoritativeNames = null, authoritativeAt = 0 } = {}) {
  const roster = new Map();
  const currentNameByUuid = new Map();
  for (const value of [...userCache.slice(0, MAX_ROSTER), ...players]) {
    const uuid = normalizedUuid(value?.uuid || value?.id);
    const name = normalizedName(value?.name);
    if (uuid && name) currentNameByUuid.set(uuid, name);
  }
  const get = (value, fallbackName = '') => {
    const uuid = normalizedUuid(value?.uuid || value?.id);
    const name = currentNameByUuid.get(uuid) || normalizedName(value?.name || fallbackName);
    if (!name) return null;
    const key = name.toLowerCase();
    let row = roster.get(key);
    if (!row) {
      if (roster.size >= MAX_ROSTER) return null;
      row = { name, uuid: '', online: false, x: null, y: null, z: null, dimension: '', lastSeen: 0, lastPositionAt: 0 };
      roster.set(key, row);
    }
    row.name = name;
    if (uuid) row.uuid = uuid;
    return row;
  };
  // Online players are admitted first even for an unusually large history file.
  for (const player of players) get(player);
  for (const value of Array.isArray(history) ? history : Object.values(history || {})) {
    const row = get(value);
    if (!row) continue;
    row.lastSeen = Math.max(timestamp(value.lastSeen), timestamp(value.lastActive));
  }
  for (const value of userCache.slice(0, MAX_ROSTER)) get(value);
  for (const value of savedPositions) {
    const row = get(value);
    const pose = normalizedPosition(value);
    if (row && pose && timestamp(value.lastPositionAt) >= row.lastPositionAt) {
      Object.assign(row, pose, { lastPositionAt: timestamp(value.lastPositionAt) });
    }
  }
  for (const [key, value] of lastPositions) {
    const row = roster.get(key);
    if (!row || (row.uuid && value.uuid && row.uuid !== value.uuid)) continue;
    const pose = normalizedPosition(value);
    if (pose && value.lastPositionAt >= row.lastPositionAt) Object.assign(row, pose, { lastPositionAt: value.lastPositionAt });
  }
  const fresh = serverRunning && generatedAt > 0 && now - generatedAt >= -5000 && now - generatedAt <= 15_000;
  const authorityFresh = serverRunning && Array.isArray(authoritativeNames)
    && authoritativeAt >= generatedAt && now - authoritativeAt >= -5000 && now - authoritativeAt <= 30_000;
  const allowedNames = authorityFresh ? new Set(authoritativeNames.map(v => normalizedName(v?.name || v).toLowerCase())) : null;
  const historyRows = new Map((Array.isArray(history) ? history : Object.values(history || {}))
    .map(value => [String(value?.name || '').toLowerCase(), value]));
  if (fresh) for (const player of players) {
    const row = get(player);
    if (!row) continue;
    const key = row.name.toLowerCase();
    const recentHistory = historyRows.get(key);
    const hasNewerLogout = ['left', 'disconnected'].includes(recentHistory?.lastEvent)
      && Math.max(timestamp(recentHistory.lastSeen), timestamp(recentHistory.lastActive)) > generatedAt;
    row.online = !hasNewerLogout && (!allowedNames || allowedNames.has(key));
    const pose = normalizedPosition(player);
    if (pose && generatedAt >= row.lastPositionAt) {
      Object.assign(row, pose, { lastPositionAt: generatedAt });
      lastPositions.set(key, { ...pose, uuid: row.uuid, lastPositionAt: generatedAt });
    }
    if (row.online) row.lastSeen = Math.max(row.lastSeen, generatedAt);
  }
  if (authorityFresh) for (const value of authoritativeNames) {
    const row = get(typeof value === 'object' ? value : { name: value });
    const recentHistory = row && historyRows.get(row.name.toLowerCase());
    const hasNewerLogout = ['left', 'disconnected'].includes(recentHistory?.lastEvent)
      && Math.max(timestamp(recentHistory.lastSeen), timestamp(recentHistory.lastActive)) > authoritativeAt;
    if (row && !hasNewerLogout) { row.online = true; row.lastSeen = Math.max(row.lastSeen, authoritativeAt); }
  }
  while (lastPositions.size > MAX_ROSTER) lastPositions.delete(lastPositions.keys().next().value);
  return [...roster.values()].sort((a, b) => Number(b.online) - Number(a.online)
    || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function createRosterReader({ readNbtFile } = {}) {
  const jsonCache = new Map();
  const positionCache = new Map();
  const lastPositions = new Map();
  let scope = '';
  async function readJson(file, fallback) {
    if (!file) return fallback;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_HISTORY_BYTES) return fallback;
      const fingerprint = `${stat.mtimeMs}:${stat.size}`;
      if (jsonCache.get(file)?.fingerprint === fingerprint) return jsonCache.get(file).value;
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      jsonCache.set(file, { fingerprint, value });
      return value;
    } catch { return fallback; }
  }
  async function savedPosition(worldRoot, row) {
    const uuid = normalizedUuid(row.uuid);
    if (!uuid || !worldRoot || !readNbtFile) return null;
    const dashed = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
    // 26.2 migrated playerdata to players/data. Read the new location first; the old
    // location is only a fallback for older worlds, never a second source of truth.
    const candidates = [path.join(worldRoot, 'players', 'data', `${dashed}.dat`), path.join(worldRoot, 'playerdata', `${dashed}.dat`)];
    for (const file of candidates) {
      try {
        const previous = positionCache.get(file);
        if (previous && Date.now() - previous.checkedAt < 30_000) {
          if (previous.missing) continue;
          return previous.value;
        }
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
        const fingerprint = `${stat.mtimeMs}:${stat.size}`;
        if (previous?.fingerprint === fingerprint) { previous.checkedAt = Date.now(); return previous.value; }
        const nbt = await readNbtFile(file, { maxCompressedBytes: 2 * 1024 * 1024, maxUncompressedBytes: 8 * 1024 * 1024 });
        const data = nbt?.Data || nbt;
        const coordinates = data?.Pos;
        const value = Array.isArray(coordinates) && coordinates.length >= 3
          ? { name: row.name, uuid, x: coordinates[0], y: coordinates[1], z: coordinates[2], dimension: data.Dimension, lastPositionAt: stat.mtimeMs } : null;
        positionCache.set(file, { fingerprint, value, checkedAt: Date.now() });
        return value;
      } catch (error) {
        const missing = error?.code === 'ENOENT';
        positionCache.set(file, { value: null, missing, checkedAt: Date.now() });
        if (!missing) return null;
      }
    }
    return null;
  }
  return {
    async read({ paths, worldRoot, worldToken = '', ...input }) {
      const nextScope = `${path.resolve(paths.root)}|${worldRoot || ''}|${worldToken}`;
      if (scope !== nextScope) { scope = nextScope; jsonCache.clear(); positionCache.clear(); lastPositions.clear(); }
      const [history, userCache] = await Promise.all([
        readJson(paths.playerHistory, {}), readJson(paths.playerCache, [])
      ]);
      const normalizedCache = Array.isArray(userCache) ? userCache : [];
      const base = mergePlayerRoster({ ...input, history, userCache: normalizedCache, lastPositions });
      const savedPositions = [];
      // A fixed two-reader queue keeps hundreds of historical players from causing an I/O burst.
      let index = 0;
      await Promise.all([0, 1].map(async () => {
        while (index < base.length) {
          const row = base[index++];
          if (row.online) continue;
          const pose = await savedPosition(worldRoot, row);
          if (pose) savedPositions.push(pose);
        }
      }));
      // A profile switch during disk reads must not publish the previous profile's roster.
      if (scope !== nextScope) return [];
      return mergePlayerRoster({ ...input, history, userCache: normalizedCache, lastPositions, savedPositions });
    }
  };
}

if (!isMainThread && workerData?.action === 'terrain') {
  readTerrainInWorker(workerData.file).then(
    result => parentPort.postMessage({ ok: true, result }),
    () => parentPort.postMessage({ ok: false })
  );
}

module.exports = { createTerrainReader, createRosterReader, mergePlayerRoster, normalizeTerrainCells, normalizeGeneratedRegions };
