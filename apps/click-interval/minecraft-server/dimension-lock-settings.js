'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPlainPath } = require('./world-reset');
const KEYS = Object.freeze({ lockEnd: 'end', lockNether: 'nether' });
const MOD_ID = 'serverendlock_fabric';
const ARTIFACT = 'ServerEndLock-Fabric-1.2.0+mc26.2.jar';
const KNOWN_HASHES = Object.freeze([
  '86a1f3eff6788cfd60a685d853370ed96929a81a1989da1f426928373cf64e6b',
  '3b489f3351dfdddc16b71cb4e3feae3a9e2af6fca700f37a9660e038eab784d6',
  '669826ee672801501d92488858b2fae943f84801dc110123628ab662562fa364',
  'd2a47a4c034772e88de7eedc7ef797377aa9d50fa1110f0d7c25911a66711a0a'
]);
const SHA256 = KNOWN_HASHES[3];
const MAX_DURATION = 365 * 24 * 60 * 60 * 1000;
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const emptyLock = locked => ({ locked, unlockAtMillis: '0', startOnLaunchMillis: '0', openingDurationMillis: '0' });
function defaults() { return { end: emptyLock(false), nether: emptyLock(false), eyeCraftingBlocked: true, frameInsertionBlocked: true }; }
function statePath(root, worldName) {
  if (typeof worldName !== 'string' || !worldName || worldName === '.' || worldName === '..' || /[\\/:\0]/.test(worldName)) throw Error('Invalid dimension-lock world name.');
  return path.join(root, worldName, 'server-end-lock', 'state.properties');
}
function parseState(raw) {
  if (Buffer.byteLength(raw, 'utf8') > 512) throw Error('Dimension-lock state is too large.');
  const text = raw.replace(/\r\n/g, '\n');
  if (/^version=1\nlocked=(true|false)\n$/.test(text)) return { ...defaults(), end: emptyLock(text.includes('locked=true')) };
  const lines = text.split('\n');
  const v3 = lines.length === 12 && lines[0] === 'version=3' && lines[11] === '';
  if (!v3 && !(lines.length === 8 && lines[0] === 'version=2' && lines[7] === '')) throw Error('Invalid dimension-lock state format.');
  function boolean(line, key) {
    if (line === `${key}=true`) return true;
    if (line === `${key}=false`) return false;
    throw Error(`Invalid dimension-lock setting: ${key}`);
  }
  function millis(line, key, duration = false) {
    if (!line.startsWith(`${key}=`)) throw Error(`Missing dimension-lock setting: ${key}`);
    const value = line.slice(key.length + 1);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 9223372036854775807n ||
      (duration && value !== '0' && (BigInt(value) < 1000n || BigInt(value) > BigInt(MAX_DURATION)))) throw Error(`Invalid dimension-lock time: ${key}`);
    return value;
  }
  const result = defaults();
  for (const [domain, line, launch] of [['end', 1, 7], ['nether', 3, 9]]) {
    const lock = { locked: boolean(lines[line], `${domain}.locked`), unlockAtMillis: millis(lines[line + 1], `${domain}.unlockAtMillis`),
      startOnLaunchMillis: v3 ? millis(lines[launch], `${domain}.startOnLaunchMillis`, true) : '0',
      openingDurationMillis: v3 ? millis(lines[launch + 1], `${domain}.openingDurationMillis`, true) : '0' };
    if ((!lock.locked && (lock.unlockAtMillis !== '0' || lock.openingDurationMillis !== '0')) ||
        (lock.startOnLaunchMillis !== '0' && (!lock.locked || lock.unlockAtMillis !== '0' || lock.startOnLaunchMillis !== lock.openingDurationMillis))) throw Error('Invalid dimension-lock schedule.');
    result[domain] = lock;
  }
  result.eyeCraftingBlocked = boolean(lines[5], 'eyeCraftingBlocked');
  result.frameInsertionBlocked = boolean(lines[6], 'frameInsertionBlocked');
  return result;
}
function serializeState(state) {
  const v3 = ['end', 'nether'].some(domain => state[domain].startOnLaunchMillis !== '0' || state[domain].openingDurationMillis !== '0');
  const lines = [`version=${v3 ? 3 : 2}`];
  for (const domain of ['end', 'nether']) lines.push(`${domain}.locked=${state[domain].locked}`, `${domain}.unlockAtMillis=${state[domain].unlockAtMillis}`);
  lines.push(`eyeCraftingBlocked=${state.eyeCraftingBlocked}`, `frameInsertionBlocked=${state.frameInsertionBlocked}`);
  if (v3) for (const domain of ['end', 'nether']) lines.push(`${domain}.startOnLaunchMillis=${state[domain].startOnLaunchMillis}`, `${domain}.openingDurationMillis=${state[domain].openingDurationMillis}`);
  const text = lines.join('\n') + '\n'; parseState(text); return text;
}
async function readState(root, worldName) {
  const file = statePath(root, worldName);
  await assertPlainPath(root, file);
  let stat;
  try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return { file, exists: false, revision: 'missing', state: defaults() }; throw error; }
  if (!stat.isFile() || stat.size > 512) throw Error('Dimension-lock state must be a regular file of at most 512 bytes.');
  const raw = await fs.readFile(file, 'utf8');
  return { file, exists: true, revision: hash(raw), state: parseState(raw) };
}
function normalizeChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Invalid dimension-lock settings changes.');
  const normalized = {};
  for (const [key, desired] of Object.entries(changes)) {
    if (!Object.hasOwn(KEYS, key)) throw Error('Invalid dimension-lock setting change.');
    if (typeof desired === 'boolean') { normalized[key] = { locked: desired, autoOpen: false }; continue; }
    if (!desired || typeof desired !== 'object' || Array.isArray(desired) ||
        Object.keys(desired).some(field => !['locked', 'autoOpen', 'durationSeconds'].includes(field)) ||
        typeof desired.locked !== 'boolean' || typeof desired.autoOpen !== 'boolean') throw Error('Invalid dimension-lock setting change.');
    if (desired.autoOpen) {
      if (!desired.locked || !Number.isSafeInteger(desired.durationSeconds) || desired.durationSeconds < 1 || desired.durationSeconds > MAX_DURATION / 1000) {
        throw Error('Automatic opening requires a locked dimension and a whole-number duration from 1 second to 365 days.');
      }
      normalized[key] = { locked: true, autoOpen: true, durationSeconds: desired.durationSeconds };
    } else {
      if (Object.hasOwn(desired, 'durationSeconds')) throw Error('An opening duration requires automatic opening to be enabled.');
      normalized[key] = { locked: desired.locked, autoOpen: false };
    }
  }
  return normalized;
}
function describeLock(lock, now = Date.now()) {
  const autoOpen = lock.locked && (lock.unlockAtMillis !== '0' || lock.startOnLaunchMillis !== '0');
  const original = BigInt(lock.startOnLaunchMillis) || BigInt(lock.openingDurationMillis);
  const remaining = BigInt(lock.unlockAtMillis) > BigInt(now) ? BigInt(lock.unlockAtMillis) - BigInt(now) : 0n;
  const duration = original || remaining;
  const seconds = (duration + 999n) / 1000n;
  return { ...lock, autoOpen, durationSeconds: autoOpen && duration > 0n ? Number(seconds > BigInt(MAX_DURATION / 1000) ? BigInt(MAX_DURATION / 1000) : seconds) : null };
}
function applyChanges(state, changes) {
  const next = structuredClone(state);
  for (const [key, desired] of Object.entries(normalizeChanges(changes))) {
    const lock = emptyLock(desired.locked);
    if (desired.autoOpen) lock.startOnLaunchMillis = lock.openingDurationMillis = String(desired.durationSeconds * 1000);
    next[KEYS[key]] = lock;
  }
  return next;
}
async function writeChanges(root, worldName, changes, expectedRevision, revalidate = async () => {}) {
  const previous = await readState(root, worldName);
  if (expectedRevision !== undefined && previous.revision !== expectedRevision) throw Error('Dimension locks changed since Settings was opened. Reload Settings before changing a lock.');
  const next = applyChanges(previous.state, changes);
  if (!Object.keys(changes).length) return previous;
  const file = previous.file, temporary = `${file}.settings-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  await revalidate(); await assertPlainPath(root, file); await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(serializeState(next), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await revalidate(); await assertPlainPath(root, file);
    if ((await readState(root, worldName)).revision !== previous.revision) throw Error('Dimension locks changed during Settings save. Reload Settings and try again.');
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  return readState(root, worldName);
}
function requestedChanges(request) {
  if (request === undefined) return null;
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.revision !== 'string' || typeof request.worldName !== 'string' || typeof request.profileId !== 'string' || !request.profileId) throw Error('Invalid dimension-lock settings request.');
  const changes = request.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Invalid dimension-lock settings changes.');
  normalizeChanges(changes);
  return { revision: request.revision, worldName: request.worldName, profileId: request.profileId, changes: structuredClone(changes) };
}
function isSupported(config, platform = {}) {
  const build = String(platform.build || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  const loaderSupported = platform.installedType !== 'fabric' || Boolean(build && (Number(build[1]) > 0 || Number(build[2]) > 19 || (Number(build[2]) === 19 && Number(build[3]) >= 5)));
  return config?.serverType === 'fabric' && String(platform.minecraftVersion || config.serverVersion) === '26.2' && platform.compatible !== false && loaderSupported;
}
function isFabricApiVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)\+26\.2$/);
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 161));
}
function isLockMod(descriptor) {
  return descriptor?.fabricModId === MOD_ID && descriptor.fabricMainEntrypoints?.includes('com.clickinterval.endlock.ServerEndLock') &&
    ['=26.2', '26.2'].includes(descriptor.fabricMinecraftDependency) && descriptor.fabricEnvironment !== 'client';
}
async function applyRunningChanges({ root, worldName, request, revalidate, sendCommand, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const changes = normalizeChanges(request.changes); // Validate both dimensions before sending either command.
  let current = await readState(root, worldName);
  if (current.revision !== request.revision) throw Error('Dimension locks changed since Settings was opened. Reload Settings before changing a lock.');
  for (const [key, desired] of Object.entries(changes)) {
    await revalidate();
    if ((await readState(root, worldName)).revision !== current.revision) throw Error('Dimension locks changed during Settings save. Reload Settings and try again.');
    const sentAt = now();
    const action = desired.autoOpen ? `for ${desired.durationSeconds}s` : desired.locked ? 'on' : 'off';
    if (!sendCommand(`${KEYS[key]}lock ${action}`)) throw Error('The owned server console is unavailable. Reload Settings before trying again.');
    let applied = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      await wait(100); await revalidate(); current = await readState(root, worldName);
      const lock = current.state[KEYS[key]];
      const acknowledged = desired.autoOpen
        ? lock.locked && lock.startOnLaunchMillis === '0' && lock.openingDurationMillis === '0' &&
          BigInt(lock.unlockAtMillis) >= BigInt(sentAt + desired.durationSeconds * 1000) && BigInt(lock.unlockAtMillis) <= BigInt(now() + desired.durationSeconds * 1000)
        : lock.locked === desired.locked && lock.unlockAtMillis === '0' && lock.startOnLaunchMillis === '0' && lock.openingDurationMillis === '0';
      if (acknowledged) { applied = true; break; }
    }
    if (!applied) throw Error('The server did not confirm the dimension-lock change. Reload Settings to check which changes were applied.');
  }
  return current;
}

async function prepareRuntime({ root, mods, artifact, dependency, inspectJar, getIndex, revalidate }) {
  await revalidate(); await assertPlainPath(root, mods);
  const bundled = await inspectJar(artifact);
  if (!isLockMod(bundled) || bundled.sha256 !== SHA256 || bundled.fabricVersion !== '1.2.0') throw Error('Bundled dimension-lock runtime failed its integrity check.');
  const index = await getIndex();
  if (index.partial) throw Error('The mods folder could not be fully checked before preparing dimension locks.');
  const installed = index.files.filter(entry => entry.descriptor?.fabricModId === MOD_ID);
  if (installed.length > 1) throw Error('Multiple dimension-lock mods are installed. Remove duplicates while stopped before starting.');
  const apis = index.files.filter(entry => entry.descriptor?.fabricModId === 'fabric-api');
  if (apis.length > 1 || (apis.length && !isFabricApiVersion(apis[0].descriptor.fabricVersion))) throw Error('Dimension locks need Fabric API 0.161.0 or later for Minecraft 26.2.');
  const existing = installed[0];
  const target = path.join(mods, existing?.name || 'ServerEndLock-Fabric.jar');
  if (existing && (path.basename(existing.name) !== existing.name || !isLockMod(existing.descriptor))) throw Error('The installed dimension-lock mod could not be verified.');
  await assertPlainPath(root, target);
  let previous = null;
  try { previous = await inspectJar(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (!isLockMod(previous) || !KNOWN_HASHES.includes(previous.sha256))) throw Error('The existing dimension-lock JAR differs from known releases and was left unchanged.');
  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const temporary = `${target}.settings-${token}`;
  let backup = '', published = false, dependencyPublished = '';
  await fs.mkdir(mods, { recursive: true });
  try {
    if (!apis.length) {
      if (!dependency) throw Error('Bundled Fabric API is missing. Install Fabric API for Minecraft 26.2 before starting.');
      const checked = await inspectJar(dependency.path);
      if (checked.fabricModId !== 'fabric-api' || checked.sha256 !== dependency.sha256 || !isFabricApiVersion(checked.fabricVersion)) throw Error('Bundled Fabric API failed its integrity check.');
      const destination = path.join(mods, path.basename(dependency.path));
      const stagedDependency = `${destination}.settings-${token}`;
      try {
        await revalidate(); await assertPlainPath(root, destination);
        await fs.copyFile(dependency.path, stagedDependency, 1);
        if ((await inspectJar(stagedDependency)).sha256 !== dependency.sha256) throw Error('Staged Fabric API changed during copy.');
        await revalidate(); await assertPlainPath(root, destination);
        await fs.link(stagedDependency, destination); dependencyPublished = destination;
      } finally { await fs.rm(stagedDependency, { force: true }).catch(() => {}); }
    }
    if (previous?.sha256 !== SHA256) {
      await fs.copyFile(artifact, temporary, 1);
      if ((await inspectJar(temporary)).sha256 !== SHA256) throw Error('Staged dimension-lock runtime changed during copy.');
      await revalidate(); await assertPlainPath(root, target);
      const fresh = await getIndex();
      if (fresh.partial || fresh.files.filter(entry => entry.descriptor?.fabricModId === MOD_ID).some(entry => entry.name !== existing?.name)) throw Error('The mods folder changed during dimension-lock preparation.');
      if (previous) {
        if ((await inspectJar(target)).sha256 !== previous.sha256) throw Error('The installed dimension-lock runtime changed during preparation.');
        backup = path.join(root, '.click-interval-dimension-lock-backups', `${path.basename(target)}-${previous.sha256}.backup`);
        await assertPlainPath(root, backup); await fs.mkdir(path.dirname(backup), { recursive: true });
        try { await fs.copyFile(target, backup, 1); } catch (error) {
          if (error.code !== 'EEXIST' || hash(await fs.readFile(backup)) !== previous.sha256) throw error;
        }
        await fs.rename(temporary, target);
      } else {
        await fs.link(temporary, target);
      }
      published = true;
    }
    await revalidate();
    const metadata = path.join(root, '.click-interval-dimension-lock.json');
    await assertPlainPath(root, metadata);
    const metadataTemporary = `${metadata}.tmp-${token}`;
    try {
      await fs.writeFile(metadataTemporary, JSON.stringify({ version: 1, file: path.basename(target), modId: MOD_ID, sha256: SHA256, backup, installedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
      await fs.rename(metadataTemporary, metadata);
    } finally { await fs.rm(metadataTemporary, { force: true }).catch(() => {}); }
    return { installed: true, updated: published, previouslyInstalled: Boolean(previous), backup };
  } catch (error) {
    if (published) {
      if (backup) { await fs.copyFile(backup, temporary); await fs.rename(temporary, target); }
      else await fs.rm(target, { force: true });
    }
    if (dependencyPublished) await fs.rm(dependencyPublished, { force: true });
    throw error;
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

module.exports = { KEYS, MOD_ID, ARTIFACT, SHA256, KNOWN_HASHES, MAX_DURATION, defaults, statePath, parseState, serializeState, normalizeChanges, describeLock,
  readState, applyChanges, writeChanges, requestedChanges, isSupported, isLockMod, applyRunningChanges, prepareRuntime };
