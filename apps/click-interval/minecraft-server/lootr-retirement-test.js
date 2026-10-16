'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeFabricJar, artifactFor, makeProfile, writeManifest } = require('./pending-mod-queue-test');
const { queuePendingMods, getPendingModQueueStatus, applyPendingModQueue, exportClientModBundle,
  profilePaths, loadManifest, createBoundedWorldBackup } = require('./pending-mod-queue');
const { retireLootrBeforeStart, planLootrRemovalWithWorldReset, PINNED_LOOTR } = require('./lootr-retirement');
const { buildPlan, resetWorldTransaction, contained } = require('./world-reset');

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function main() {
  const work = path.resolve(__dirname, '..', 'work');
  await fs.mkdir(work, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(work, 'lootr-retirement-test-'));
  try {
    const lootrSource = path.join(temporary, 'lootr.jar');
    const coreSource = path.join(temporary, 'servercore.jar');
    await makeFabricJar(lootrSource, { id: 'lootr' });
    await makeFabricJar(coreSource, { id: 'servercore' });
    const bytes = await fs.readFile(lootrSource);
    const expectedArtifact = { ...PINNED_LOOTR, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    const config = { levelName: 'world' };
    const limits = { maxBytes: 65536, maxEntries: 100, diskReserveBytes: 1 };
    const profile = path.join(temporary, 'existing');
    await makeProfile(profile);
    await fs.copyFile(lootrSource, path.join(profile, 'mods', 'lootr.jar'));
    const common = { profileRoot: profile, config, serverStopped: true, revalidate: async () => {}, expectedArtifact, worldBackupLimits: limits };
    const deferred = await retireLootrBeforeStart({ ...common, backupWorld: async () => { throw new Error('must not back up or mutate an ordinary existing-world start'); } });
    assert.equal(deferred.state, 'deferred');
    assert.match(deferred.message, /Reset Data/);
    assert.deepEqual(await fs.readFile(path.join(profile, 'mods', 'lootr.jar')), bytes);
    assert.equal(await exists(path.join(profile, 'pending-mods')), false);
    await assert.rejects(retireLootrBeforeStart({ ...common, serverStopped: false }), /stopped-server/);

    const removal = await planLootrRemovalWithWorldReset({ profileRoot: profile, config, expectedArtifact });
    assert.deepEqual(removal.retiredMods, ['lootr']);
    const resetPlan = await buildPlan(profile, config, config);
    resetPlan.move.push(...removal.move);
    const reset = await resetWorldTransaction({ root: profile, profileId: 'existing', plan: resetPlan,
      resetSettings: false, revalidate: async () => {} });
    assert.equal(await exists(path.join(profile, 'mods', 'lootr.jar')), false);
    assert.equal(await exists(path.join(profile, 'world', 'level.dat')), false);
    assert.deepEqual(await fs.readFile(path.join(reset.backupPath, 'data/mods/lootr.jar')), bytes);
    assert.equal(await exists(path.join(reset.backupPath, 'data/world/level.dat')), true);

    const rollback = path.join(temporary, 'rollback');
    await makeProfile(rollback);
    await fs.copyFile(lootrSource, path.join(rollback, 'mods', 'lootr.jar'));
    const rollbackRemoval = await planLootrRemovalWithWorldReset({ profileRoot: rollback, config, expectedArtifact });
    const rollbackPlan = await buildPlan(rollback, config, config);
    rollbackPlan.move.push(...rollbackRemoval.move);
    await assert.rejects(resetWorldTransaction({ root: rollback, profileId: 'rollback', plan: rollbackPlan,
      resetSettings: true, revalidate: async () => {}, applySettings: async () => { throw new Error('injected settings failure'); } }), /Original data was restored/);
    assert.deepEqual(await fs.readFile(path.join(rollback, 'mods', 'lootr.jar')), bytes);
    assert.equal(await exists(path.join(rollback, 'world', 'level.dat')), true);

    const fresh = path.join(temporary, 'fresh');
    await makeProfile(fresh);
    await fs.rename(path.join(fresh, 'world'), path.join(fresh, 'prior-world'));
    await fs.copyFile(lootrSource, path.join(fresh, 'mods', 'lootr.jar'));
    await assert.rejects(retireLootrBeforeStart({ ...common, profileRoot: fresh,
      backupWorld: async () => { throw new Error('backup failed'); } }), /backup failed/);
    assert.equal(await exists(path.join(fresh, 'mods', 'lootr.jar')), true);
    const retired = await retireLootrBeforeStart({ ...common, profileRoot: fresh });
    assert.equal(retired.state, 'retired');
    assert.equal(await exists(path.join(fresh, 'mods', 'lootr.jar')), false);
    assert.deepEqual(await fs.readFile(path.join(retired.archivePath, 'lootr.jar')), bytes);
    assert.equal(JSON.parse(await fs.readFile(path.join(retired.worldBackupPath, 'world-backup.json'))).worldPresent, false);
    assert.equal(await exists(path.join(fresh, 'prior-world', 'level.dat')), true);

    const backup = await createBoundedWorldBackup({ profileRoot: rollback, serverStopped: true, limits });
    const receipt = JSON.parse(await fs.readFile(path.join(backup.path, 'world-backup.json')));
    assert.equal(receipt.verification.algorithm, 'sha256');
    assert(receipt.verification.files.some(file => file.path === 'level.dat' && /^[a-f0-9]{64}$/.test(file.sha256)));
    await fs.appendFile(path.join(rollback, 'mods', 'lootr.jar'), 'changed');
    await assert.rejects(planLootrRemovalWithWorldReset({ profileRoot: rollback, config, expectedArtifact }), /differs from the verified/);

    // A known manifest revision can retain verified performance mods without
    // downloading or installing the removed client-required mod again.
    const queueProfile = path.join(temporary, 'queue');
    await makeProfile(queueProfile);
    const manifestPath = path.join(temporary, 'manifest.json');
    const oldManifest = await writeManifest(manifestPath, 'retirement-queue', [
      await artifactFor(lootrSource, { key: 'lootr', clientRequired: true, serverOnly: false }),
      await artifactFor(coreSource, { key: 'servercore' })
    ]);
    await queuePendingMods({ profileRoot: queueProfile, manifestPath, downloadFile: async (artifact, destination) => {
      await fs.copyFile(artifact.key === 'lootr' ? lootrSource : coreSource, destination);
    } });
    const previousDigest = (await loadManifest(manifestPath)).digest;
    await writeManifest(manifestPath, oldManifest.id, oldManifest.artifacts.filter(item => item.key !== 'lootr'),
      { compatiblePreviousManifestDigests: [previousDigest] });
    const status = await getPendingModQueueStatus({ profileRoot: queueProfile, manifestPath });
    assert.equal(status.ok, true);
    assert.deepEqual(status.artifacts.map(item => item.key), ['servercore']);
    await assert.rejects(exportClientModBundle({ profileRoot: queueProfile, manifestPath }), error => error.code === 'client-bundle-empty');
    await applyPendingModQueue({ profileRoot: queueProfile, manifestPath, serverStopped: true });
    assert.deepEqual(await fs.readdir(path.join(queueProfile, 'mods')), ['servercore.jar']);
    const paths = profilePaths(queueProfile, oldManifest.id);
    const migrated = JSON.parse(await fs.readFile(paths.queueState));
    assert.deepEqual(migrated.artifacts.map(item => item.key), ['servercore']);
    assert.equal(migrated.manifestDigest, (await loadManifest(manifestPath)).digest);
    assert.equal(JSON.parse(await fs.readFile(paths.queueManifest)).artifacts.some(item => item.modId === 'lootr'), false);
    migrated.manifestDigest = '0'.repeat(64);
    await fs.writeFile(paths.queueState, JSON.stringify(migrated));
    assert.equal((await getPendingModQueueStatus({ profileRoot: queueProfile, manifestPath })).state, 'not-downloaded');
    console.log('Lootr retirement tests passed: existing worlds untouched, reset/world+JAR rollback, fresh-world backup, checksum verification, trusted queue migration, and no required companion export.');
  } finally {
    const safe = contained(work, temporary);
    if (path.basename(safe).startsWith('lootr-retirement-test-')) await fs.rm(safe, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
