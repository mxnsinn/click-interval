'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PROTECTION_FILES = Object.freeze({
  mods: Object.freeze(['ServerProtection-Fabric.jar']),
  plugins: Object.freeze(['ServerProtection.jar', 'ClickIntervalAntiCheat.jar'])
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function resolveCheck(value, checks) {
  if (typeof value !== 'string') throw new Error('Choose an exact anti-cheat check ID from /anticheat list.');
  for (const [id, category] of Object.entries(checks)) {
    if (value === id || value === `${category}.${id}`) return id;
  }
  throw new Error(`Unknown anti-cheat check: ${value}. Use /anticheat list for exact IDs.`);
}

// Dependencies are bound to one selected profile by the console caller. mutateConfig
// must use the existing serialized protection mutation API, not a read/save pair.
function createAntiCheatConsoleBindings(dependencies) {
  const { checks, getConfig, mutateConfig, listCustom, removeCustom } = dependencies;
  if (!checks || typeof checks !== 'object' || [getConfig, mutateConfig, listCustom, removeCustom].some(fn => typeof fn !== 'function')) {
    throw new Error('Anti-cheat console bindings require profile-bound backend operations.');
  }
  return Object.freeze({
    async list() {
      const [config, custom] = await Promise.all([getConfig(), listCustom()]);
      return {
        enabled: Boolean(config.enabled), builtInEnabled: Boolean(config.layers?.builtIn),
        checks: Object.entries(checks).map(([id, category]) => ({
          id: `${category}.${id}`, shortId: id, category, enabled: Boolean(config.checks?.[id]),
          effective: Boolean(config.enabled && config.layers?.builtIn && config.checks?.[id])
        })),
        custom: custom.map(row => ({ id: row.id, name: row.name, file: row.file,
          kind: row.kind, active: Boolean(row.active), integrityVerified: Boolean(row.integrityVerified) }))
      };
    },
    async setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Anti-cheat enablement must be true or false.');
      return mutateConfig(() => ({ enabled }));
    },
    async setCheckEnabled(value, enabled) {
      const id = resolveCheck(value, checks);
      if (typeof enabled !== 'boolean') throw new Error('Anti-cheat check enablement must be true or false.');
      // persistProtectionConfig merges this narrow patch with the freshest state
      // under its lock, preserving other checks, tuning, messages, and policy.
      return mutateConfig(() => ({ preset: 'custom', checks: { [id]: enabled } }));
    },
    async removeCustom(id) {
      if (typeof id !== 'string' || !/^[a-f0-9-]{8,64}$/i.test(id)) throw new Error('Choose an exact custom anti-cheat ID from /anticheat list.');
      return removeCustom(id);
    }
  });
}

function contained(root, value) {
  const result = path.resolve(value), relative = path.relative(root, result);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Protection removal must remain inside the selected server directory.');
  }
  return result;
}

async function ordinary(root, target, allowMissing = false) {
  const resolvedRoot = path.resolve(root);
  const rootStat = await fs.lstat(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.relative(resolvedRoot, await fs.realpath(resolvedRoot))) {
    throw new Error('Protection removal cannot use a linked server directory.');
  }
  let current = resolvedRoot;
  const safe = contained(resolvedRoot, target);
  for (const piece of path.relative(resolvedRoot, safe).split(path.sep)) {
    current = path.join(current, piece);
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink() || (current !== safe && !stat.isDirectory()) || path.relative(current, await fs.realpath(current))) {
      throw new Error('Protection removal cannot follow linked or nonordinary paths.');
    }
  }
}

async function verifyJar(root, target, expectedHash) {
  await ordinary(root, target);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size < 1 || stat.size > 64 * 1024 * 1024 || sha256(await fs.readFile(target)) !== expectedHash) {
    throw new Error('Server Protection changed or is not the verified managed file. It was left untouched.');
  }
}

// Caller holds the stopped-server tool and protection-state locks. Only the
// exact bundled artifact is archived; dependencies and saved settings stay.
// commit performs the profile-bound config/metadata change, and rollback restores
// its pre-operation snapshot if commit can fail after a partial write.
async function archivePinnedProtection(options) {
  const { kind, file, revalidate, commit, rollback } = options;
  const expectedHash = String(options.sha256 || '').toLowerCase();
  if (!PROTECTION_FILES[kind]?.includes(file) || !/^[a-f0-9]{64}$/.test(expectedHash) ||
      typeof revalidate !== 'function' || typeof commit !== 'function' || typeof rollback !== 'function') {
    throw new Error('Protection removal requires a verified managed artifact and guarded transaction callbacks.');
  }
  const root = path.resolve(options.root), source = contained(root, path.join(root, kind, file));
  await revalidate();
  await verifyJar(root, source, expectedHash);
  const archiveRoot = contained(root, path.join(root, '.click-interval-anticheat-backups'));
  await ordinary(root, archiveRoot, true);
  await fs.mkdir(archiveRoot, { recursive: true });
  await ordinary(root, archiveRoot);
  const archive = await fs.mkdtemp(path.join(archiveRoot, 'removed-'));
  const destination = contained(root, path.join(archive, file));
  const manifest = contained(root, path.join(archive, 'manifest.json'));
  const receipt = { version: 1, kind, file, sha256: expectedHash, source, archive: destination,
    createdAt: new Date().toISOString(), phase: 'preparing' };
  await ordinary(root, archive);
  const writeReceipt = phase => fs.writeFile(manifest, JSON.stringify({ ...receipt, phase }, null, 2) + '\n');
  let moved = false, commitStarted = false;
  try {
    await writeReceipt('preparing');
    await revalidate();
    await verifyJar(root, source, expectedHash);
    await ordinary(root, destination, true);
    await fs.rename(source, destination);
    moved = true;
    await verifyJar(root, destination, expectedHash);
    await writeReceipt('archived');
    await revalidate();
    commitStarted = true;
    const result = await commit();
    await writeReceipt('complete');
    return { removed: true, file, kind, archivePath: destination, dependenciesRetained: true, settingsRetained: true,
      restartRequired: false, result };
  } catch (error) {
    const failures = [];
    if (commitStarted) await rollback().catch(failure => failures.push(failure));
    if (moved) {
      try {
        await verifyJar(root, destination, expectedHash);
        await ordinary(root, source, true);
        try { await fs.lstat(source); throw new Error('Another file appeared at the protection destination; the backup was retained.'); }
        catch (check) { if (check.code !== 'ENOENT') throw check; }
        await fs.rename(destination, source);
      } catch (failure) { failures.push(failure); }
    }
    await writeReceipt(failures.length ? 'recovery-required' : 'rolled-back').catch(failure => failures.push(failure));
    if (failures.length) throw new AggregateError([error, ...failures], `Protection removal needs recovery from ${archive}: ${error.message}`);
    throw error;
  }
}

module.exports = { PROTECTION_FILES, resolveCheck, createAntiCheatConsoleBindings, archivePinnedProtection };
