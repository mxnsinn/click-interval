'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// The on-disk protocol name remains stable so existing server profiles can upgrade in place.
const PROTOCOL = 'trade-assistant-control-v1';
const OPERATIONS = Object.freeze([
  'listLoadedEntities',
  'listNearbyEntities',
  'inspectEntity',
  'setVillagerOffer',
  'setVillagerBabyAge',
  'setVillagerBreedingCooldown',
  'setAnimalBreedingCooldown'
]);
const OPERATION_SET = new Set(OPERATIONS);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_TOKEN_BYTES = 128;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_ENTITIES = 512;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 40;

class TradeAssistantControlError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TradeAssistantControlError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new TradeAssistantControlError(code, message, cause);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${label} must be an object.`);
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${label} contains an unsupported field.`);
    }
  }
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function boundedNumber(value, name, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} must be from ${minimum} to ${maximum}.`);
  }
  return value;
}

function boundedString(value, name, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} must be text.`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} is invalid.`);
  }
  return normalized;
}

function normalizeUuid(value, name = 'entityUuid') {
  const normalized = boundedString(value, name, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} is invalid.`);
  return normalized;
}

function normalizeResourceId(value, name) {
  const normalized = boundedString(value, name, 128).toLowerCase();
  if (!RESOURCE_ID_PATTERN.test(normalized) || normalized.includes('..') || normalized.includes('//')) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', `${name} is invalid.`);
  }
  return normalized;
}

function optionalInteger(source, output, key, minimum, maximum) {
  if (has(source, key)) output[key] = boundedInteger(source[key], key, minimum, maximum);
}

function optionalNumber(source, output, key, minimum, maximum) {
  if (has(source, key)) output[key] = boundedNumber(source[key], key, minimum, maximum);
}

function optionalResourceId(source, output, key) {
  if (has(source, key)) output[key] = normalizeResourceId(source[key], key);
}

function normalizeOperationPayload(operation, payload = {}) {
  if (typeof operation !== 'string' || !OPERATION_SET.has(operation)) {
    fail('TRADE_ASSISTANT_INVALID_OPERATION', 'Unsupported Trade Assistant operation.');
  }
  const source = requireRecord(payload, 'payload');
  const output = {};

  if (operation === 'listLoadedEntities') {
    assertAllowedKeys(source, new Set(['dimension', 'limit']), 'payload');
    optionalResourceId(source, output, 'dimension');
    optionalInteger(source, output, 'limit', 1, 512);
    return output;
  }

  if (operation === 'listNearbyEntities') {
    assertAllowedKeys(source, new Set(['x', 'y', 'z', 'radius', 'dimension', 'limit']), 'payload');
    if (!has(source, 'x') || !has(source, 'y') || !has(source, 'z')) {
      fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'x, y, and z are required.');
    }
    output.x = boundedNumber(source.x, 'x', -30_000_000, 30_000_000);
    output.y = boundedNumber(source.y, 'y', -4_096, 4_096);
    output.z = boundedNumber(source.z, 'z', -30_000_000, 30_000_000);
    optionalNumber(source, output, 'radius', 2, 256);
    optionalResourceId(source, output, 'dimension');
    optionalInteger(source, output, 'limit', 1, 512);
    return output;
  }

  if (!has(source, 'entityUuid')) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'entityUuid is required.');
  }
  output.entityUuid = normalizeUuid(source.entityUuid);

  if (operation === 'inspectEntity') {
    assertAllowedKeys(source, new Set(['entityUuid']), 'payload');
    return output;
  }

  if (operation === 'setVillagerOffer') {
    const editable = [
      'costAItem', 'costACount', 'costBItem', 'costBCount', 'resultItem', 'resultCount',
      'maxUses', 'xp', 'priceMultiplier'
    ];
    assertAllowedKeys(source, new Set(['entityUuid', 'offerIndex', ...editable]), 'payload');
    if (!has(source, 'offerIndex')) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'offerIndex is required.');
    output.offerIndex = boundedInteger(source.offerIndex, 'offerIndex', 0, 255);
    optionalResourceId(source, output, 'costAItem');
    optionalInteger(source, output, 'costACount', 1, 64);
    optionalResourceId(source, output, 'costBItem');
    optionalInteger(source, output, 'costBCount', 0, 64);
    optionalResourceId(source, output, 'resultItem');
    optionalInteger(source, output, 'resultCount', 1, 64);
    optionalInteger(source, output, 'maxUses', 1, 999);
    optionalInteger(source, output, 'xp', 0, 10_000);
    optionalNumber(source, output, 'priceMultiplier', 0, 1);
    if (!editable.some(key => has(source, key))) {
      fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'At least one offer field must be changed.');
    }
    return output;
  }

  if (operation === 'setVillagerBabyAge') {
    assertAllowedKeys(source, new Set(['entityUuid', 'babyAgeTicks']), 'payload');
    if (!has(source, 'babyAgeTicks')) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'babyAgeTicks is required.');
    output.babyAgeTicks = boundedInteger(source.babyAgeTicks, 'babyAgeTicks', -1_200_000, 0);
    return output;
  }

  assertAllowedKeys(source, new Set(['entityUuid', 'cooldownTicks']), 'payload');
  if (!has(source, 'cooldownTicks')) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'cooldownTicks is required.');
  output.cooldownTicks = boundedInteger(source.cooldownTicks, 'cooldownTicks', 0, 1_200_000);
  return output;
}

function assertContained(base, target, label = 'path') {
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', `${label} escapes the server profile.`);
  }
}

function resolveTradeAssistantPaths(profileRoot) {
  if (typeof profileRoot !== 'string' || !profileRoot.trim() || profileRoot.includes('\u0000')) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'A server profile root is required.');
  }
  const profile = path.resolve(profileRoot);
  if (profile === path.parse(profile).root) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'The filesystem root cannot be used as a server profile.');
  }
  const config = path.resolve(profile, 'config');
  const control = path.resolve(config, 'servertradeassistant');
  const requests = path.resolve(control, 'requests');
  const responses = path.resolve(control, 'responses');
  for (const [label, value] of Object.entries({ config, control, requests, responses })) {
    assertContained(profile, value, label);
  }
  return Object.freeze({
    profileRoot: profile,
    configRoot: config,
    controlRoot: control,
    requestsRoot: requests,
    responsesRoot: responses,
    tokenFile: path.resolve(control, 'control-token.txt'),
    snapshotFile: path.resolve(control, 'map-snapshot.json')
  });
}

function assertCanonicalControlPaths(paths) {
  if (!isRecord(paths) || typeof paths.profileRoot !== 'string') {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'Trade Assistant paths are invalid.');
  }
  const expected = resolveTradeAssistantPaths(paths.profileRoot);
  const comparable = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  for (const key of Object.keys(expected)) {
    if (typeof paths[key] !== 'string' || comparable(paths[key]) !== comparable(expected[key])) {
      fail('TRADE_ASSISTANT_UNSAFE_PATH', 'Trade Assistant paths must remain inside the server profile.');
    }
  }
  return expected;
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensurePlainDirectory(directory) {
  let stat = await lstatOrNull(directory);
  if (!stat) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    stat = await fs.lstat(directory);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'Trade Assistant control directories cannot be links or files.');
  }
}

async function ensureControlTree(paths) {
  const profileStat = await lstatOrNull(paths.profileRoot);
  if (!profileStat || profileStat.isSymbolicLink() || !profileStat.isDirectory()) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'The server profile must be an existing regular directory.');
  }
  const profileReal = await fs.realpath(paths.profileRoot);
  for (const directory of [paths.configRoot, paths.controlRoot, paths.requestsRoot, paths.responsesRoot]) {
    await ensurePlainDirectory(directory);
    const real = await fs.realpath(directory);
    assertContained(profileReal, real, 'control directory');
  }
  return profileReal;
}

async function readBoundedRegularFile(file, maximumBytes, label, { optional = false } = {}) {
  const stat = await lstatOrNull(file);
  if (!stat) {
    if (optional) return null;
    fail('TRADE_ASSISTANT_FILE_MISSING', `${label} is missing.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', `${label} must be a regular file.`);
  }
  if (stat.size > maximumBytes) fail('TRADE_ASSISTANT_FILE_TOO_LARGE', `${label} is too large.`);
  const handle = await fs.open(file, 'r');
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size > maximumBytes) {
      fail('TRADE_ASSISTANT_FILE_TOO_LARGE', `${label} is too large.`);
    }
    const bytes = await handle.readFile();
    if (bytes.length > maximumBytes) fail('TRADE_ASSISTANT_FILE_TOO_LARGE', `${label} is too large.`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readTokenFromPaths(paths) {
  await ensureControlTree(paths);
  const real = await fs.realpath(paths.tokenFile).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (real) {
    const profileReal = await fs.realpath(paths.profileRoot);
    assertContained(profileReal, real, 'control token');
  }
  const bytes = await readBoundedRegularFile(paths.tokenFile, MAX_TOKEN_BYTES, 'Trade Assistant control token');
  const source = bytes.toString('utf8');
  if (!/^[a-f0-9]{64}(?:\r?\n)?$/i.test(source)) {
    fail('TRADE_ASSISTANT_INVALID_TOKEN', 'Trade Assistant control token is invalid.');
  }
  const token = source.trim().toLowerCase();
  if (!TOKEN_PATTERN.test(token)) fail('TRADE_ASSISTANT_INVALID_TOKEN', 'Trade Assistant control token is invalid.');
  return token;
}

async function readTradeAssistantControlToken(profileRoot) {
  return readTokenFromPaths(resolveTradeAssistantPaths(profileRoot));
}

function assertSafeRequestId(requestId) {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    fail('TRADE_ASSISTANT_UNSAFE_PATH', 'Request ID is unsafe.');
  }
  return requestId;
}

function generateSafeRequestId(randomBytes = crypto.randomBytes) {
  if (typeof randomBytes !== 'function') fail('TRADE_ASSISTANT_RANDOM_FAILED', 'Secure randomness is unavailable.');
  let bytes;
  try {
    bytes = Buffer.from(randomBytes(16));
  } catch (error) {
    fail('TRADE_ASSISTANT_RANDOM_FAILED', 'Could not create a secure request ID.', error);
  }
  if (bytes.length < 16) fail('TRADE_ASSISTANT_RANDOM_FAILED', 'Secure request ID was too short.');
  return assertSafeRequestId(`ta_${bytes.subarray(0, 16).toString('hex')}`);
}

async function writeRequestAtomically(paths, requestId, request, randomBytes = crypto.randomBytes) {
  paths = assertCanonicalControlPaths(paths);
  assertSafeRequestId(requestId);
  await ensureControlTree(paths);
  const target = path.resolve(paths.requestsRoot, `${requestId}.json`);
  assertContained(paths.requestsRoot, target, 'request file');
  const bytes = Buffer.from(JSON.stringify(request), 'utf8');
  if (bytes.length > MAX_REQUEST_BYTES) {
    fail('TRADE_ASSISTANT_REQUEST_TOO_LARGE', 'Trade Assistant request is too large.');
  }
  const suffix = generateSafeRequestId(randomBytes).slice(3);
  const temporary = path.resolve(paths.requestsRoot, `.${requestId}.${suffix}.tmp`);
  assertContained(paths.requestsRoot, temporary, 'temporary request file');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    // A hard-link publishes a complete file atomically and fails rather than replacing an
    // existing request with the same correlation ID.
    await fs.link(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return target;
}

function normalizeTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 25 || value > MAX_TIMEOUT_MS) {
    fail('TRADE_ASSISTANT_INVALID_TIMEOUT', `timeoutMs must be from 25 to ${MAX_TIMEOUT_MS}.`);
  }
  return value;
}

function normalizePollInterval(value) {
  if (value === undefined) return DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(value) || value < 5 || value > 250) {
    fail('TRADE_ASSISTANT_INVALID_TIMEOUT', 'pollIntervalMs must be from 5 to 250.');
  }
  return value;
}

function cloneSafeJson(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 16_384 || depth > 12) {
    fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant response is too complex.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response contains an invalid number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 16_384) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response contains oversized text.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2_048) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response contains an oversized list.');
    return value.map(entry => cloneSafeJson(entry, state, depth + 1));
  }
  if (!isRecord(value)) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response contains an unsupported value.');
  const keys = Object.keys(value);
  if (keys.length > 128) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response object has too many fields.');
  const output = {};
  for (const key of keys) {
    if (!key || key.length > 128 || key === '__proto__' || key === 'prototype' || key === 'constructor') {
      fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Response contains an unsafe field.');
    }
    output[key] = cloneSafeJson(value[key], state, depth + 1);
  }
  return output;
}

function parseResponse(bytes, expectedRequestId) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant returned invalid JSON.', error);
  }
  if (!isRecord(parsed) || parsed.protocol !== PROTOCOL || parsed.requestId !== expectedRequestId ||
      typeof parsed.ok !== 'boolean') {
    fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant returned a mismatched response.');
  }
  const allowedKeys = new Set(parsed.ok
    ? ['protocol', 'requestId', 'ok', 'data']
    : ['protocol', 'requestId', 'ok', 'error']);
  for (const key of Reflect.ownKeys(parsed)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant response contains an unsupported field.');
    }
  }
  if (parsed.ok) {
    if (!isRecord(parsed.data)) fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant response data is invalid.');
    return cloneSafeJson(parsed.data);
  }
  if (typeof parsed.error !== 'string' || !parsed.error.trim() || parsed.error.length > 1_024) {
    fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant returned an invalid error.');
  }
  fail('TRADE_ASSISTANT_REJECTED', parsed.error.trim());
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForMatchingResponse(paths, requestId, timeoutMs, pollIntervalMs) {
  paths = assertCanonicalControlPaths(paths);
  assertSafeRequestId(requestId);
  const responseFile = path.resolve(paths.responsesRoot, `${requestId}.json`);
  assertContained(paths.responsesRoot, responseFile, 'response file');
  const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
  while (process.hrtime.bigint() < deadline) {
    const stat = await lstatOrNull(responseFile);
    if (stat) {
      try {
        const bytes = await readBoundedRegularFile(responseFile, MAX_RESPONSE_BYTES,
          'Trade Assistant response');
        return parseResponse(bytes, requestId);
      } finally {
        await fs.unlink(responseFile).catch(error => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
    }
    const remainingNanos = deadline - process.hrtime.bigint();
    if (remainingNanos <= 0n) break;
    const remainingMillis = Number(remainingNanos / 1_000_000n);
    await delay(Math.max(1, Math.min(pollIntervalMs, remainingMillis)));
  }
  fail('TRADE_ASSISTANT_TIMEOUT', 'Trade Assistant did not respond in time.');
}

function normalizeMapEntity(value) {
  const source = requireRecord(value, 'snapshot entity');
  const allowed = new Set([
    'entityUuid', 'entityType', 'name', 'dimension', 'x', 'y', 'z', 'stableId', 'player',
    'baby', 'ageTicks', 'breedingCooldownTicks'
  ]);
  assertAllowedKeys(source, allowed, 'snapshot entity');
  const output = {
    entityUuid: normalizeUuid(source.entityUuid),
    entityType: normalizeResourceId(source.entityType, 'entityType'),
    name: boundedString(source.name, 'name', 256, { allowEmpty: true }),
    dimension: normalizeResourceId(source.dimension, 'dimension'),
    x: boundedNumber(source.x, 'x', -30_000_000, 30_000_000),
    y: boundedNumber(source.y, 'y', -4_096, 4_096),
    z: boundedNumber(source.z, 'z', -30_000_000, 30_000_000)
  };
  if (typeof source.stableId !== 'string' || !/^[A-F0-9]{8}$/i.test(source.stableId)) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'stableId is invalid.');
  }
  output.stableId = source.stableId.toUpperCase();
  if (source.player !== false) fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'Map snapshots may only contain non-player entities.');
  output.player = false;
  if (has(source, 'baby')) {
    if (typeof source.baby !== 'boolean') fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'baby must be true or false.');
    output.baby = source.baby;
  }
  optionalInteger(source, output, 'ageTicks', -1_200_000, 1_200_000);
  optionalInteger(source, output, 'breedingCooldownTicks', 0, 1_200_000);
  return output;
}

function normalizeMapSnapshot(value) {
  const source = requireRecord(value, 'map snapshot');
  assertAllowedKeys(source, new Set(['protocol', 'generatedAt', 'truncated', 'entities']), 'map snapshot');
  if (source.protocol !== PROTOCOL || !Number.isSafeInteger(source.generatedAt) || source.generatedAt < 0 ||
      typeof source.truncated !== 'boolean' || !Array.isArray(source.entities)) {
    fail('TRADE_ASSISTANT_INVALID_PAYLOAD', 'Map snapshot metadata is invalid.');
  }
  const wasTruncated = source.entities.length > MAX_SNAPSHOT_ENTITIES;
  const entities = source.entities.slice(0, MAX_SNAPSHOT_ENTITIES).map(normalizeMapEntity);
  return {
    protocol: PROTOCOL,
    generatedAt: source.generatedAt,
    truncated: source.truncated || wasTruncated,
    entities
  };
}

async function readMapSnapshotFromPaths(paths) {
  paths = assertCanonicalControlPaths(paths);
  await ensureControlTree(paths);
  const bytes = await readBoundedRegularFile(paths.snapshotFile, MAX_RESPONSE_BYTES,
    'Trade Assistant map snapshot', { optional: true });
  if (bytes === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail('TRADE_ASSISTANT_INVALID_RESPONSE', 'Trade Assistant map snapshot is invalid JSON.', error);
  }
  return normalizeMapSnapshot(parsed);
}

async function readTradeAssistantMapSnapshot(profileRoot) {
  return readMapSnapshotFromPaths(resolveTradeAssistantPaths(profileRoot));
}

class TradeAssistantControl {
  constructor(profileRoot, options = {}) {
    if (!isRecord(options)) fail('TRADE_ASSISTANT_INVALID_OPTIONS', 'Bridge options must be an object.');
    assertAllowedKeys(options, new Set(['timeoutMs', 'pollIntervalMs']), 'options');
    Object.defineProperties(this, {
      paths: { value: resolveTradeAssistantPaths(profileRoot), enumerable: true },
      timeoutMs: { value: normalizeTimeout(options.timeoutMs), enumerable: true },
      pollIntervalMs: { value: normalizePollInterval(options.pollIntervalMs), enumerable: true }
    });
    Object.seal(this);
  }

  async request(operation, payload = {}, options = {}) {
    if (!isRecord(options)) fail('TRADE_ASSISTANT_INVALID_OPTIONS', 'Request options must be an object.');
    assertAllowedKeys(options, new Set(['timeoutMs']), 'request options');
    const timeoutMs = normalizeTimeout(options.timeoutMs, this.timeoutMs);
    const normalizedPayload = normalizeOperationPayload(operation, payload);
    const token = await readTokenFromPaths(this.paths);
    let requestId;
    let requestFile;
    let lastCollision;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      requestId = generateSafeRequestId();
      const responseFile = path.resolve(this.paths.responsesRoot, `${requestId}.json`);
      if (await lstatOrNull(responseFile)) {
        lastCollision = new Error('response collision');
        continue;
      }
      const request = { protocol: PROTOCOL, requestId, token, operation, ...normalizedPayload };
      try {
        requestFile = await writeRequestAtomically(this.paths, requestId, request);
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        lastCollision = error;
      }
    }
    if (!requestFile) {
      fail('TRADE_ASSISTANT_REQUEST_COLLISION', 'Could not reserve a unique request ID.', lastCollision);
    }
    try {
      return await waitForMatchingResponse(this.paths, requestId, timeoutMs, this.pollIntervalMs);
    } finally {
      // Remove only the request this instance created. If the server already claimed it this is a no-op.
      await fs.unlink(requestFile).catch(error => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  async readMapSnapshot() {
    return readMapSnapshotFromPaths(this.paths);
  }
}

function createTradeAssistantControl(profileRoot, options) {
  return new TradeAssistantControl(profileRoot, options);
}

async function requestTradeAssistant(profileRoot, operation, payload, options = {}) {
  if (!isRecord(options)) fail('TRADE_ASSISTANT_INVALID_OPTIONS', 'Bridge options must be an object.');
  assertAllowedKeys(options, new Set(['timeoutMs', 'pollIntervalMs']), 'options');
  const bridgeOptions = {};
  for (const key of ['timeoutMs', 'pollIntervalMs']) {
    if (has(options, key)) bridgeOptions[key] = options[key];
  }
  return createTradeAssistantControl(profileRoot, bridgeOptions).request(operation, payload,
    has(options, 'timeoutMs') ? { timeoutMs: options.timeoutMs } : {});
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_SNAPSHOT_ENTITIES,
  MAX_TIMEOUT_MS,
  OPERATIONS,
  PROTOCOL,
  TradeAssistantControl,
  TradeAssistantControlError,
  createTradeAssistantControl,
  normalizeMapSnapshot,
  normalizeOperationPayload,
  readTradeAssistantControlToken,
  readTradeAssistantMapSnapshot,
  requestTradeAssistant,
  resolveTradeAssistantPaths,
  __testing: Object.freeze({
    assertContained,
    assertSafeRequestId,
    generateSafeRequestId,
    parseResponse,
    writeRequestAtomically
  })
};
