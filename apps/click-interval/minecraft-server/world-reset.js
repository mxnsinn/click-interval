'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const JOURNAL = '.click-interval-world-reset.json';
const BACKUPS = '.click-interval-world-backups';
// These Settings controls reset with the general checkbox. Server identity,
// software selections and the icon always require their own explicit selection.
const SETTINGS_KEYS = Object.freeze([
  'seed', 'difficulty', 'gamemode', 'maxPlayers',
  'voicePublicAddress', 'bindIp', 'port', 'memoryMb', 'javaPath',
  'viewDistance', 'emptyServerAction', 'emptyServerStopMinutes',
  'keepSystemAwakeWhileRunning', 'onlineMode', 'pvp', 'playerLocatorBar', 'allowFlight', 'allowCheats',
  'whiteList', 'hardcore', 'forceGamemode', 'allowNether', 'generateStructures', 'spawnAnimals',
  'lockNether', 'lockEnd',
  'spawnMonsters', 'spawnNpcs', 'acceptEula', 'spawnProtection', 'doInsomnia', 'mobGriefing',
  'doFireTick', 'keepInventory', 'deathLootMode', 'deathDropLifetimeSeconds', 'deathChestLifetimeSeconds',
  'deathChestTorches', 'doImmediateRespawn', 'showDeathMessages', 'announceAdvancements',
  'doTraderSpawning', 'doPatrolSpawning', 'playersSleepingPercentage', 'spawnRadius', 'randomTickSpeed',
  'playerHistoryLimit'
]);
const RESET_FIELDS = Object.freeze([
  'serverIcon', 'serverType', 'serverVersion', 'levelName', 'motd', 'publicAddress', 'simulationDistance'
]);
const RESERVED_WORLD_NAMES = new Set([
  'config', 'mods', 'plugins', 'libraries', 'versions', 'logs', 'cache', 'backups', 'crash-reports',
  'squaremap', 'click-interval-map', '.click-interval-runtime', '.click-interval-seamless-restart', BACKUPS
]);
const EXTERNAL_WORLD_DATA = Object.freeze([
  'assembly-player-history.json', 'usercache.json', 'assembly-bans.json',
  'banned-players.json', 'banned-ips.json', 'logs',
  'config/server-protection/offenses.properties', 'plugins/ServerProtection/offenses.properties',
  'plugins/ClickIntervalAntiCheat/offenses.properties',
  'click-interval-map', 'squaremap/web/tiles',
  'config/servertradeassistant/map-snapshot.json', 'config/servertradeassistant/map-snapshot.json.tmp',
  'config/servertradeassistant/requests', 'config/servertradeassistant/processing',
  'config/servertradeassistant/responses',
  'player-view-recovery.json', 'config/server-protection/player-view-recovery.state',
  'plugins/ServerProtection/player-view-recovery.state',
  'plugins/ClickIntervalAntiCheat/player-view-recovery.state',
  'plugins/ServerTeleport/places.properties'
]);
// These files describe world behavior/preferences, not terrain, inventory or saved locations.
// Datapacks are installed world software and must survive a data reset too.
const WORLD_SETTINGS = Object.freeze([
  'datapacks', 'paper-world.yml', 'DIM-1/paper-world.yml', 'DIM1/paper-world.yml', 'server-advancement-silence.json',
  'server-enchantments', 'server-end-lock/state.properties', 'icon.png'
]);

function contained(root, target, allowRoot = false) {
  const base = path.resolve(root), resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if ((!allowRoot && !relative) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Refusing a world reset outside the selected server directory.');
  }
  return resolved;
}

async function statOrNull(file, io = fs) {
  try { return await io.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function assertPlainPath(root, target, io = fs) {
  const base = path.resolve(root), safe = contained(base, target, true);
  const rootStat = await io.lstat(base);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('World reset requires a regular server directory, not a link or junction.');
  const realRoot = await io.realpath(base);
  // Reject aliases in the profile root's ancestors as well as in its children.
  if (path.relative(base, realRoot)) throw new Error('World reset cannot use a linked or redirected server directory.');
  let cursor = base;
  for (const part of path.relative(base, safe).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await statOrNull(cursor, io);
    if (!stat) return safe;
    if (stat.isSymbolicLink()) throw new Error(`World reset cannot follow a link or junction: ${path.relative(base, cursor)}`);
    contained(realRoot, await io.realpath(cursor), true);
  }
  return safe;
}

async function assertPlainTree(root, target, io = fs) {
  await assertPlainPath(root, target, io);
  const stat = await statOrNull(target, io);
  if (!stat || !stat.isDirectory()) return;
  const pending = [target];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await io.readdir(directory, { withFileTypes: true })) {
      // Only copied settings need this recursive scan; whole world directories are
      // renamed as an entry, which never follows links inside terrain/data folders.
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('A world settings backup contains a link or junction.');
      if (entry.isDirectory()) pending.push(child);
    }
  }
}

function normalizeResetFields(value = []) {
  if (!Array.isArray(value) || value.length > RESET_FIELDS.length ||
      value.some(key => typeof key !== 'string' || !RESET_FIELDS.includes(key)) ||
      new Set(value).size !== value.length) {
    throw new Error('Choose only the listed Reset Data settings, once each.');
  }
  return RESET_FIELDS.filter(key => value.includes(key));
}

function settingsConfig(current, defaults, generateSeed, { resetSettings = true, resetFields = [] } = {}) {
  const next = { ...current };
  if (resetSettings) {
    for (const key of SETTINGS_KEYS) next[key] = defaults[key];
    next.seed = generateSeed();
  }
  for (const key of normalizeResetFields(resetFields)) {
    // Software selectors record a requested installation; resetting never replaces
    // installed jars or misreports their current type/version.
    if (key === 'serverType') next.requestedServerType = defaults.serverType;
    else if (key === 'serverVersion') next.requestedServerVersion = defaults.serverVersion;
    else if (key === 'publicAddress') {
      next.publicAddress = defaults.publicAddress;
      next.customHostname = defaults.customHostname;
    }
    else if (key !== 'serverIcon') next[key] = defaults[key];
  }
  // Local-only is a separate console setting, outside this Settings tab.
  if (resetSettings && current.localOnly === true) next.bindIp = '127.0.0.1';
  if (current.seamlessRestart?.enabled &&
      (Number(next.port) !== Number(current.port) || String(next.bindIp || '') !== String(current.bindIp || ''))) {
    throw new Error('Resetting these Settings would change the installed seamless-restart endpoint. Disable seamless restart first, or reset the world with Settings unchecked.');
  }
  return next;
}

async function assertNoPendingReset(root, io = fs) {
  const file = contained(root, path.join(root, JOURNAL));
  if (await statOrNull(file, io)) {
    throw new Error(`A previous world reset needs recovery. Keep the server stopped and restore its backup using ${file}.`);
  }
}

async function buildPlan(root, config, nextConfig, io = fs, { resetIcon = false } = {}) {
  const names = [config.levelName, `${config.levelName}_nether`, `${config.levelName}_the_end`];
  const newName = nextConfig?.levelName || config.levelName;
  const newWorlds = [newName, `${newName}_nether`, `${newName}_the_end`];
  for (const name of [...names, ...newWorlds]) {
    if (!name || path.basename(name) !== name || /[\\/:]/.test(name) || RESERVED_WORLD_NAMES.has(name.toLowerCase())) {
      throw new Error('The configured world name overlaps server software/settings or is unsafe. Rename the world before resetting it.');
    }
  }
  const move = [...names, ...EXTERNAL_WORLD_DATA];
  const preserve = [];
  if (newName.toLowerCase() !== config.levelName.toLowerCase()) {
    for (const name of newWorlds) {
      const target = contained(root, path.join(root, name));
      await assertPlainPath(root, target, io);
      if (await statOrNull(target, io)) throw new Error(`The default world folder ${name} already exists. Leave World name unchecked, or move that older world first.`);
    }
  }
  for (const name of names) {
    const target = contained(root, path.join(root, name));
    await assertPlainPath(root, target, io);
    const stat = await statOrNull(target, io);
    if (stat && !stat.isDirectory()) throw new Error(`World folder ${name} is not a directory.`);
    const destinationName = name === config.levelName ? newName : `${newName}${name.slice(config.levelName.length)}`;
    for (const setting of WORLD_SETTINGS) {
      if (resetIcon && setting === 'icon.png') continue;
      const source = path.join(name, setting), destination = path.join(destinationName, setting);
      await assertPlainTree(root, contained(root, path.join(root, source)), io);
      if (await statOrNull(path.join(root, source), io)) preserve.push({ source, destination });
    }
  }
  for (const relative of move) await assertPlainPath(root, contained(root, path.join(root, relative)), io);
  return { move, preserve, newWorlds };
}

async function resetWorldTransaction({ root, profileId, plan, resetSettings, resetFields = [], revalidate, applySettings, io = fs }) {
  const selectedFields = normalizeResetFields(resetFields);
  await assertPlainPath(root, path.join(root, JOURNAL), io);
  await assertNoPendingReset(root, io);
  for (const relative of plan.move) await assertPlainPath(root, contained(root, path.join(root, relative)), io);
  const backupParent = contained(root, path.join(root, BACKUPS));
  await assertPlainPath(root, backupParent, io);
  await io.mkdir(backupParent, { recursive: true });
  const backupPath = contained(root, path.join(backupParent, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(5).toString('hex')}`));
  await io.mkdir(backupPath);
  const dataPath = path.join(backupPath, 'data');
  await io.mkdir(dataPath);
  const journalFile = path.join(root, JOURNAL);
  const manifest = { version: 1, profileId, backupPath, resetSettings, resetFields: selectedFields, phase: 'prepared', paths: plan.move, moved: [], preserved: plan.preserve };
  await revalidate();
  // Exclusive journal creation also prevents simultaneous calls outside the app coordinator.
  await io.writeFile(journalFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const writeManifest = async () => io.writeFile(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const moved = [];
  let replacementsStarted = false;
  try {
    await writeManifest();
    for (const relative of plan.move) {
      await revalidate();
      const source = contained(root, path.join(root, relative));
      await assertPlainPath(root, source, io);
      if (!await statOrNull(source, io)) continue;
      const destination = contained(dataPath, path.join(dataPath, relative));
      await io.mkdir(path.dirname(destination), { recursive: true });
      await io.rename(source, destination);
      moved.push(relative);
      manifest.moved = moved.slice();
      await writeManifest();
    }
    replacementsStarted = true;
    for (const item of plan.preserve) {
      await revalidate();
      const source = contained(dataPath, path.join(dataPath, item.source));
      const destination = contained(root, path.join(root, item.destination));
      await assertPlainTree(backupPath, source, io);
      await assertPlainPath(root, destination, io);
      await io.mkdir(path.dirname(destination), { recursive: true });
      await io.cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    }
    if (applySettings) await applySettings({ backupPath, dataPath });
    await revalidate();
    manifest.phase = 'complete';
    await writeManifest();
    await io.unlink(journalFile);
    return { reset: true, profileId, backupPath, resetSettings: Boolean(resetSettings), resetFields: selectedFields };
  } catch (error) {
    const rollbackErrors = [];
    // Keep any failed replacement output in the backup as well; never recursively
    // delete a live path while recovering a destructive operation.
    if (replacementsStarted) {
      const generated = [...new Set([...plan.move, ...plan.newWorlds])];
      for (const relative of generated) {
        try {
          const target = contained(root, path.join(root, relative));
          await assertPlainPath(root, target, io);
          if (!await statOrNull(target, io)) continue;
          const failed = contained(backupPath, path.join(backupPath, 'failed-replacement', relative));
          await io.mkdir(path.dirname(failed), { recursive: true });
          await io.rename(target, failed);
        } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
    }
    for (const relative of moved.slice().reverse()) {
      try {
        const destination = contained(root, path.join(root, relative));
        await assertPlainPath(root, destination, io);
        if (await statOrNull(destination, io)) throw new Error(`Cannot overwrite ${relative} during recovery.`);
        await io.mkdir(path.dirname(destination), { recursive: true });
        await io.rename(contained(dataPath, path.join(dataPath, relative)), destination);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    manifest.phase = rollbackErrors.length ? 'recovery-required' : 'rolled-back';
    manifest.error = error.message;
    manifest.rollbackErrors = rollbackErrors.map(item => item.message);
    await writeManifest().catch(() => {});
    if (!rollbackErrors.length) await io.unlink(journalFile).catch(() => {});
    const recovery = rollbackErrors.length ? ' Keep the server stopped; recovery is required.' : ' Original data was restored.';
    throw new Error(`World reset failed: ${error.message}.${recovery} Backup: ${backupPath}`);
  }
}

module.exports = { SETTINGS_KEYS, RESET_FIELDS, EXTERNAL_WORLD_DATA, WORLD_SETTINGS, JOURNAL, BACKUPS, contained,
  assertPlainPath, assertPlainTree, assertNoPendingReset, normalizeResetFields, settingsConfig, buildPlan, resetWorldTransaction };
