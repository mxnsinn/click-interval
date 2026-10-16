'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBoundedWorldBackup, hashFile, readFabricModDescriptor } = require('./pending-mod-queue');
const { contained, assertPlainPath, assertPlainTree } = require('./world-reset');

const PINNED_LOOTR = Object.freeze({
  modId: 'lootr', version: '1.24.41.124', size: 1584138,
  sha256: '6669f8415aa4280eae0959d6e8cac0bb0dab02dbfd3efd6a153c1fad02e80a6b'
});
const REMOVAL_GUIDE = 'https://github.com/LootrMinecraft/Lootr/wiki/FAQs#how-do-i-remove-lootr';

async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function hasWorldProgress(root, levelName) {
  const world = contained(root, path.join(root, levelName));
  await assertPlainPath(root, world);
  const stat = await statOrNull(world);
  if (!stat) return false;
  if (!stat.isDirectory()) throw new Error('The configured world is not a regular directory.');
  const preservedDirectories = new Set(['datapacks', 'server-enchantments']);
  const preservedFiles = new Set(['paper-world.yml', 'server-advancement-silence.json']);
  for (const entry of await fs.readdir(world, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Lootr retirement cannot follow linked world entries.');
    if (entry.isDirectory() && preservedDirectories.has(entry.name)) {
      await assertPlainTree(root, path.join(world, entry.name));
      continue;
    }
    if (entry.isFile() && preservedFiles.has(entry.name)) continue;
    if (entry.isDirectory() && ['server-end-lock', 'DIM-1', 'DIM1'].includes(entry.name)) {
      const children = await fs.readdir(path.join(world, entry.name), { withFileTypes: true });
      const preservedName = entry.name === 'server-end-lock' ? 'state.properties' : 'paper-world.yml';
      if (children.every(child => child.isFile() && child.name === preservedName)) continue;
    }
    // This deliberately fails closed: unknown mod data, region files, player
    // saves, dimensions and level.dat all mean the world may contain Lootr data.
    return true;
  }
  return false;
}

async function inspectLootrRetirement({ profileRoot, config, expectedArtifact = PINNED_LOOTR }) {
  const root = path.resolve(profileRoot);
  const mods = contained(root, path.join(root, 'mods'));
  await assertPlainPath(root, mods);
  const entries = await fs.readdir(mods, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length > 512) throw new Error('The mods folder is too large to inspect for Lootr safely.');
  const artifacts = [];
  for (const entry of entries) {
    if (!/\.jar$/i.test(entry.name)) continue;
    const file = contained(root, path.join(mods, entry.name));
    await assertPlainPath(root, file);
    if (!entry.isFile()) throw new Error('The mods folder contains a non-file JAR entry.');
    let descriptor;
    try { descriptor = await readFabricModDescriptor(file); } catch (error) {
      if (/lootr/i.test(entry.name)) throw new Error(`Cannot verify ${entry.name} as Lootr; it was left installed.`);
      continue;
    }
    if (descriptor.id !== 'lootr') continue;
    const actual = await hashFile(file, ['sha256']);
    if (actual.size !== expectedArtifact.size || actual.hashes.sha256 !== expectedArtifact.sha256) {
      return { state: 'deferred', retired: [], message: `${entry.name} differs from the verified managed Lootr build and was left installed.`, guide: REMOVAL_GUIDE };
    }
    artifacts.push({ name: entry.name, file, sha256: actual.hashes.sha256, size: actual.size });
  }
  if (!artifacts.length) return { state: 'not-installed', retired: [] };
  if (!config || !config.levelName || path.basename(config.levelName) !== config.levelName || /[\\/:]/.test(config.levelName)) {
    throw new Error('The configured world name is unsafe for Lootr retirement.');
  }
  const worldHasProgress = await hasWorldProgress(root, config.levelName);
  return { state: 'installed', root, artifacts, worldHasProgress };
}

async function retireLootrBeforeStart({ profileRoot, config, serverStopped = false, revalidate,
  expectedArtifact = PINNED_LOOTR, backupWorld = createBoundedWorldBackup,
  worldBackupLimits = {} } = {}) {
  if (serverStopped !== true || typeof revalidate !== 'function') throw new Error('Lootr can only be retired during a verified stopped-server startup.');
  await revalidate();
  const inspection = await inspectLootrRetirement({ profileRoot, config, expectedArtifact });
  if (inspection.state !== 'installed') return inspection;
  if (inspection.worldHasProgress) {
    return { state: 'deferred', retired: [], guide: REMOVAL_GUIDE,
      message: 'Lootr is no longer auto-installed. It remains on this existing world because removing it also removes Lootr containers. Reset Data will back up the old world and remove Lootr together.' };
  }
  const root = inspection.root;
  await revalidate();
  const worldBackup = await backupWorld({ profileRoot: root, serverStopped: true,
    reasons: ['lootr-retirement'], limits: worldBackupLimits });
  if (!worldBackup?.ok || !worldBackup.path) throw new Error('Lootr was left installed because its world backup was not verified.');
  await revalidate();
  const archiveParent = contained(root, path.join(root, 'pending-mods', 'retired-lootr'));
  await assertPlainPath(root, archiveParent);
  await fs.mkdir(archiveParent, { recursive: true });
  const archive = contained(root, path.join(archiveParent, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`));
  await fs.mkdir(archive);
  const receipt = { schemaVersion: 1, phase: 'prepared', createdAt: new Date().toISOString(),
    worldBackup: worldBackup.path, removedFromFreshWorld: true,
    guide: REMOVAL_GUIDE, artifacts: inspection.artifacts.map(({ file, ...artifact }) => artifact), moved: [] };
  const saveReceipt = () => fs.writeFile(path.join(archive, 'retirement.json'), JSON.stringify(receipt, null, 2) + '\n');
  await saveReceipt();
  try {
    for (const artifact of inspection.artifacts) {
      await revalidate();
      await assertPlainPath(root, artifact.file);
      const current = await hashFile(artifact.file, ['sha256']);
      if (current.hashes.sha256 !== artifact.sha256 || current.size !== artifact.size) throw new Error(`${artifact.name} changed after inspection.`);
      await fs.rename(artifact.file, contained(archive, path.join(archive, artifact.name)));
      receipt.moved.push(artifact.name);
      await saveReceipt();
    }
    await revalidate();
    receipt.phase = 'complete';
    await saveReceipt();
    return { state: 'retired', retired: receipt.moved, archivePath: archive, worldBackupPath: worldBackup.path,
      message: 'Lootr was archived before startup. Its previous world and JAR are backed up; joining players no longer need Lootr.' };
  } catch (error) {
    const rollbackErrors = [];
    for (const name of [...receipt.moved].reverse()) {
      try {
        const original = contained(root, path.join(root, 'mods', name));
        await assertPlainPath(root, original);
        if (await statOrNull(original)) throw new Error(`${name} was recreated during retirement.`);
        await fs.rename(contained(archive, path.join(archive, name)), original);
      } catch (restoreError) { rollbackErrors.push(restoreError.message); }
    }
    receipt.phase = rollbackErrors.length ? 'recovery-required' : 'rolled-back';
    receipt.rollbackErrors = rollbackErrors;
    await saveReceipt().catch(() => {});
    throw new Error(`Lootr retirement failed: ${error.message}. Backup: ${worldBackup.path}. ${rollbackErrors.length ? 'Keep the server stopped; JAR recovery is required.' : 'Original JARs were restored.'}`);
  }
}

async function planLootrRemovalWithWorldReset({ profileRoot, config, expectedArtifact = PINNED_LOOTR }) {
  const inspection = await inspectLootrRetirement({ profileRoot, config, expectedArtifact });
  if (inspection.state === 'deferred') throw new Error(inspection.message + ' Resolve this before resetting the world so Lootr can be removed with its data.');
  return { move: (inspection.artifacts || []).map(artifact => path.relative(profileRoot, artifact.file)),
    retiredMods: inspection.state === 'installed' ? ['lootr'] : [] };
}

module.exports = { PINNED_LOOTR, REMOVAL_GUIDE, hasWorldProgress, inspectLootrRetirement,
  planLootrRemovalWithWorldReset, retireLootrBeforeStart };
