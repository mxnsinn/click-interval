'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_RESPONSE_BYTES,
  MAX_SNAPSHOT_ENTITIES,
  PROTOCOL,
  __testing,
  createTradeAssistantControl,
  normalizeOperationPayload,
  readTradeAssistantControlToken,
  readTradeAssistantMapSnapshot,
  resolveTradeAssistantPaths
} = require('./entity-control');

const TOKEN = 'a'.repeat(64);
const ENTITY_UUID = '11111111-1111-4111-8111-111111111111';

async function temporaryProfile(t, token = TOKEN) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trade-assistant-control-'));
  const paths = resolveTradeAssistantPaths(root);
  await fs.mkdir(paths.controlRoot, { recursive: true });
  await fs.writeFile(paths.tokenFile, `${token}\n`, 'utf8');
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { root, paths };
}

async function waitForRequest(paths, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const names = await fs.readdir(paths.requestsRoot).catch(error => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    const requestName = names.find(name => /^[A-Za-z0-9_-]{1,64}\.json$/.test(name));
    if (requestName) {
      const file = path.join(paths.requestsRoot, requestName);
      return { file, request: JSON.parse(await fs.readFile(file, 'utf8')), names };
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for test request');
}

async function writeResponse(paths, requestId, value) {
  const destination = path.join(paths.responsesRoot, `${requestId}.json`);
  const temporary = path.join(paths.responsesRoot, `.${requestId}.test.tmp`);
  await fs.writeFile(temporary, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  await fs.rename(temporary, destination);
}

test('publishes one complete correlated request and consumes only its response', async t => {
  const { root, paths } = await temporaryProfile(t);
  const bridge = createTradeAssistantControl(root, { timeoutMs: 1_000, pollIntervalMs: 5 });
  const pending = bridge.request('inspectEntity', { entityUuid: ENTITY_UUID });
  const observed = await waitForRequest(paths);

  assert.equal(observed.request.protocol, PROTOCOL);
  assert.equal(observed.request.requestId, path.basename(observed.file, '.json'));
  assert.equal(observed.request.token, TOKEN);
  assert.equal(observed.request.operation, 'inspectEntity');
  assert.equal(observed.request.entityUuid, ENTITY_UUID);
  assert.equal(observed.names.some(name => name.endsWith('.tmp')), false,
    'the inbox must never expose a partially written JSON request');

  await writeResponse(paths, observed.request.requestId, {
    protocol: PROTOCOL,
    requestId: observed.request.requestId,
    ok: true,
    data: { entityUuid: ENTITY_UUID, name: 'Villager' }
  });
  assert.deepEqual(await pending, { entityUuid: ENTITY_UUID, name: 'Villager' });
  await assert.rejects(fs.access(path.join(paths.responsesRoot, `${observed.request.requestId}.json`)),
    error => error?.code === 'ENOENT');
});

test('exclusive atomic publication never overwrites an existing request', async t => {
  const { paths } = await temporaryProfile(t);
  const requestId = 'ta_existing_request';
  const destination = path.join(paths.requestsRoot, `${requestId}.json`);
  await fs.mkdir(paths.requestsRoot, { recursive: true });
  await fs.writeFile(destination, 'keep-me', 'utf8');
  await assert.rejects(
    __testing.writeRequestAtomically(paths, requestId, {
      protocol: PROTOCOL,
      requestId,
      token: TOKEN,
      operation: 'inspectEntity',
      entityUuid: ENTITY_UUID
    }),
    error => error?.code === 'EEXIST'
  );
  assert.equal(await fs.readFile(destination, 'utf8'), 'keep-me');
  assert.deepEqual((await fs.readdir(paths.requestsRoot)).filter(name => name.endsWith('.tmp')), []);
});

test('rejects traversal-shaped IDs, fields, roots, and linked control directories', async t => {
  assert.throws(() => __testing.assertSafeRequestId('../escape'), error =>
    error?.code === 'TRADE_ASSISTANT_UNSAFE_PATH');
  assert.throws(() => normalizeOperationPayload('inspectEntity', {
    entityUuid: '../../outside',
    path: '../../outside'
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
  assert.throws(() => normalizeOperationPayload('listLoadedEntities', {
    dimension: 'minecraft:../outside'
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
  assert.throws(() => resolveTradeAssistantPaths(path.parse(process.cwd()).root), error =>
    error?.code === 'TRADE_ASSISTANT_UNSAFE_PATH');

  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trade-assistant-linked-profile-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'trade-assistant-outside-'));
  t.after(async () => {
    for (const target of [profile, outside]) {
      const resolved = path.resolve(target);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
      await fs.rm(resolved, { recursive: true, force: true });
    }
  });
  const linkedPaths = resolveTradeAssistantPaths(profile);
  await assert.rejects(__testing.writeRequestAtomically({
    ...linkedPaths,
    requestsRoot: outside
  }, 'ta_escape_attempt', {
    protocol: PROTOCOL,
    requestId: 'ta_escape_attempt',
    token: TOKEN,
    operation: 'inspectEntity',
    entityUuid: ENTITY_UUID
  }), error => error?.code === 'TRADE_ASSISTANT_UNSAFE_PATH');
  await fs.mkdir(linkedPaths.configRoot);
  try {
    await fs.symlink(outside, linkedPaths.controlRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.diagnostic('Symlink creation is unavailable; lexical traversal assertions still ran.');
      return;
    }
    throw error;
  }
  await assert.rejects(readTradeAssistantControlToken(profile), error =>
    error?.code === 'TRADE_ASSISTANT_UNSAFE_PATH');
});

test('enforces token, request, and response byte limits', async t => {
  const invalid = await temporaryProfile(t, 'b'.repeat(129));
  await assert.rejects(readTradeAssistantControlToken(invalid.root), error =>
    error?.code === 'TRADE_ASSISTANT_FILE_TOO_LARGE');

  const valid = await temporaryProfile(t);
  await assert.rejects(__testing.writeRequestAtomically(valid.paths, 'ta_oversized', {
    protocol: PROTOCOL,
    requestId: 'ta_oversized',
    token: TOKEN,
    operation: 'inspectEntity',
    padding: 'x'.repeat(70 * 1024)
  }), error => error?.code === 'TRADE_ASSISTANT_REQUEST_TOO_LARGE');

  const bridge = createTradeAssistantControl(valid.root, { timeoutMs: 1_000, pollIntervalMs: 5 });
  const pending = bridge.request('inspectEntity', { entityUuid: ENTITY_UUID });
  const observed = await waitForRequest(valid.paths);
  await fs.writeFile(path.join(valid.paths.responsesRoot, `${observed.request.requestId}.json`),
    Buffer.alloc(MAX_RESPONSE_BYTES + 1, 0x20));
  await assert.rejects(pending, error => error?.code === 'TRADE_ASSISTANT_FILE_TOO_LARGE');
});

test('rejects invalid token content before publishing a request', async t => {
  const { root, paths } = await temporaryProfile(t, 'not-a-token');
  const bridge = createTradeAssistantControl(root, { timeoutMs: 100, pollIntervalMs: 5 });
  await assert.rejects(bridge.request('inspectEntity', { entityUuid: ENTITY_UUID }), error =>
    error?.code === 'TRADE_ASSISTANT_INVALID_TOKEN');
  assert.deepEqual(await fs.readdir(paths.requestsRoot), []);
});

test('rejects wrong response protocol, correlation ID, or data, then deletes each response', async t => {
  for (const variant of ['protocol', 'requestId', 'data']) {
    await t.test(variant, async child => {
      const { root, paths } = await temporaryProfile(child);
      const bridge = createTradeAssistantControl(root, { timeoutMs: 1_000, pollIntervalMs: 5 });
      const pending = bridge.request('inspectEntity', { entityUuid: ENTITY_UUID });
      const observed = await waitForRequest(paths);
      const response = {
        protocol: variant === 'protocol' ? 'wrong-protocol' : PROTOCOL,
        requestId: variant === 'requestId' ? 'ta_wrong' : observed.request.requestId,
        ok: true,
        data: variant === 'data' ? [] : {}
      };
      const responseFile = path.join(paths.responsesRoot, `${observed.request.requestId}.json`);
      await writeResponse(paths, observed.request.requestId, response);
      await assert.rejects(pending, error => error?.code === 'TRADE_ASSISTANT_INVALID_RESPONSE');
      await assert.rejects(fs.access(responseFile), error => error?.code === 'ENOENT');
    });
  }
});

test('surfaces server token rejection without exposing or accepting response data', async t => {
  const { root, paths } = await temporaryProfile(t);
  const bridge = createTradeAssistantControl(root, { timeoutMs: 1_000, pollIntervalMs: 5 });
  const pending = bridge.request('inspectEntity', { entityUuid: ENTITY_UUID });
  const observed = await waitForRequest(paths);
  await writeResponse(paths, observed.request.requestId, {
    protocol: PROTOCOL,
    requestId: observed.request.requestId,
    ok: false,
    error: 'Authentication failed.'
  });
  await assert.rejects(pending, error => error?.code === 'TRADE_ASSISTANT_REJECTED' &&
    error.message === 'Authentication failed.');
});

test('uses a bounded timeout and removes an unclaimed request', async t => {
  const { root, paths } = await temporaryProfile(t);
  const bridge = createTradeAssistantControl(root, { timeoutMs: 35, pollIntervalMs: 5 });
  await assert.rejects(bridge.request('inspectEntity', { entityUuid: ENTITY_UUID }), error =>
    error?.code === 'TRADE_ASSISTANT_TIMEOUT');
  assert.deepEqual(await fs.readdir(paths.requestsRoot), []);
  assert.throws(() => createTradeAssistantControl(root, { timeoutMs: 5_001 }), error =>
    error?.code === 'TRADE_ASSISTANT_INVALID_TIMEOUT');
});

test('validates every operation and rejects out-of-range or hidden fields', () => {
  assert.deepEqual(normalizeOperationPayload('listLoadedEntities', {
    dimension: 'minecraft:overworld', limit: 512
  }), { dimension: 'minecraft:overworld', limit: 512 });
  assert.deepEqual(normalizeOperationPayload('listNearbyEntities', {
    x: 1.5, y: -64, z: 2, radius: 32, limit: 100
  }), { x: 1.5, y: -64, z: 2, radius: 32, limit: 100 });
  assert.deepEqual(normalizeOperationPayload('setVillagerOffer', {
    entityUuid: ENTITY_UUID,
    offerIndex: 0,
    costAItem: 'minecraft:emerald',
    costACount: 12,
    costBCount: 0,
    resultItem: 'minecraft:book',
    resultCount: 1,
    maxUses: 20,
    xp: 5,
    priceMultiplier: 0.2
  }), {
    entityUuid: ENTITY_UUID,
    offerIndex: 0,
    costAItem: 'minecraft:emerald',
    costACount: 12,
    costBCount: 0,
    resultItem: 'minecraft:book',
    resultCount: 1,
    maxUses: 20,
    xp: 5,
    priceMultiplier: 0.2
  });
  assert.deepEqual(normalizeOperationPayload('setVillagerBabyAge', {
    entityUuid: ENTITY_UUID, babyAgeTicks: -24_000
  }), { entityUuid: ENTITY_UUID, babyAgeTicks: -24_000 });
  for (const operation of ['setVillagerBreedingCooldown', 'setAnimalBreedingCooldown']) {
    assert.deepEqual(normalizeOperationPayload(operation, {
      entityUuid: ENTITY_UUID, cooldownTicks: 12_000
    }), { entityUuid: ENTITY_UUID, cooldownTicks: 12_000 });
  }

  assert.throws(() => normalizeOperationPayload('runCommand', {}), error =>
    error?.code === 'TRADE_ASSISTANT_INVALID_OPERATION');
  assert.throws(() => normalizeOperationPayload('listNearbyEntities', {
    x: 0, y: 0, z: 0, radius: 257
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
  assert.throws(() => normalizeOperationPayload('setVillagerOffer', {
    entityUuid: ENTITY_UUID, offerIndex: 0, resultCount: 65
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
  assert.throws(() => normalizeOperationPayload('setVillagerOffer', {
    entityUuid: ENTITY_UUID, offerIndex: 0, resultCount: 1.5
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
  assert.throws(() => normalizeOperationPayload('setVillagerOffer', {
    entityUuid: ENTITY_UUID, offerIndex: 0, nbt: '{Unsafe:1b}'
  }), error => error?.code === 'TRADE_ASSISTANT_INVALID_PAYLOAD');
});

test('normalizes and truncates map snapshots to 512 whitelisted entities', async t => {
  const { root, paths } = await temporaryProfile(t);
  const entities = Array.from({ length: MAX_SNAPSHOT_ENTITIES + 9 }, (_, index) => {
    const tail = index.toString(16).padStart(12, '0');
    return {
      entityUuid: `00000000-0000-4000-8000-${tail}`,
      entityType: 'minecraft:villager',
      name: `Villager ${index}`,
      dimension: 'minecraft:overworld',
      x: index,
      y: 64,
      z: -index,
      stableId: tail.slice(-8).toUpperCase(),
      player: false,
      baby: false,
      ageTicks: 0,
      breedingCooldownTicks: 0
    };
  });
  await fs.writeFile(paths.snapshotFile, JSON.stringify({
    protocol: PROTOCOL,
    generatedAt: 1_800_000_000_000,
    truncated: false,
    entities
  }));
  const snapshot = await readTradeAssistantMapSnapshot(root);
  assert.equal(snapshot.entities.length, MAX_SNAPSHOT_ENTITIES);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.entities[0].stableId, '00000000');
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.entities[0], 'nbt'), false);
});
