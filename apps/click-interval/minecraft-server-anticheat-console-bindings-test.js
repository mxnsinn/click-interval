'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAntiCheatConsoleBindings, archivePinnedProtection } = require('./minecraft-server/anticheat-console-bindings');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  let config = { enabled: true, preset: 'balanced', layers: { builtIn: true, antiXray: true },
    checks: { speed: true, reach: true }, tuning: { untouched: 19 }, modPolicy: { untouched: ['example'] } };
  let queue = Promise.resolve(), removedId = '';
  const bindings = createAntiCheatConsoleBindings({ checks: { speed: 'movement', reach: 'combat' },
    getConfig: async () => config,
    mutateConfig: update => (queue = queue.then(async () => {
      const patch = await update(config);
      config = { ...config, ...patch, checks: { ...config.checks, ...(patch.checks || {}) } };
      return config;
    })),
    listCustom: async () => [{ id: '12345678-abcd', name: 'Example', file: 'custom.jar', kind: 'mods', active: true, integrityVerified: true }],
    removeCustom: async id => { removedId = id; return { removed: true, id }; }
  });
  const before = await bindings.list();
  assert.deepEqual(before.checks.map(row => row.id), ['movement.speed', 'combat.reach']);
  await Promise.all([bindings.setCheckEnabled('speed', false), bindings.setCheckEnabled('combat.reach', false)]);
  assert.deepEqual(config.checks, { speed: false, reach: false });
  assert.equal(config.preset, 'custom');
  assert.deepEqual(config.tuning, { untouched: 19 });
  assert.deepEqual(config.modPolicy, { untouched: ['example'] });
  await bindings.setEnabled(false);
  assert.deepEqual(config.layers, { builtIn: true, antiXray: true });
  await assert.rejects(bindings.setCheckEnabled('speed.extra', false), /Unknown/);
  await assert.rejects(bindings.setCheckEnabled('speed', 'false'), /true or false/);
  await assert.rejects(bindings.removeCustom('../custom.jar'), /exact/);
  assert.equal(removedId, '');
  await bindings.removeCustom('12345678-abcd');
  assert.equal(removedId, '12345678-abcd');

  const work = path.resolve(__dirname, 'work', 'anticheat-console-tests');
  await fs.mkdir(work, { recursive: true });
  const directory = await fs.mkdtemp(path.join(work, 'run-'));
  let fixtureIndex = 0;
  const body = Buffer.from('verified fixture artifact');
  async function fixture() {
    const root = path.join(directory, String(++fixtureIndex));
    await fs.mkdir(path.join(root, 'mods'), { recursive: true });
    const source = path.join(root, 'mods', 'ServerProtection-Fabric.jar');
    await fs.writeFile(source, body);
    await fs.writeFile(path.join(root, 'mods', 'fabric-api.jar'), 'retained dependency');
    await fs.writeFile(path.join(root, 'config.json'), 'enabled');
    return { root, source, kind: 'mods', file: 'ServerProtection-Fabric.jar', sha256: hash(body),
      revalidate: async () => {},
      commit: async () => { await fs.writeFile(path.join(root, 'config.json'), 'disabled'); },
      rollback: async () => { await fs.writeFile(path.join(root, 'config.json'), 'enabled'); } };
  }
  try {
    const success = await fixture();
    const result = await archivePinnedProtection(success);
    assert.equal(result.removed, true);
    await assert.rejects(fs.stat(success.source), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(result.archivePath), body);
    assert.equal(await fs.readFile(path.join(success.root, 'mods', 'fabric-api.jar'), 'utf8'), 'retained dependency');
    assert.equal(await fs.readFile(path.join(success.root, 'config.json'), 'utf8'), 'disabled');
    assert.equal(JSON.parse(await fs.readFile(path.join(path.dirname(result.archivePath), 'manifest.json'))).phase, 'complete');

    const bad = await fixture();
    await assert.rejects(archivePinnedProtection({ ...bad, file: '../outside.jar' }), /verified managed artifact/);
    await assert.rejects(archivePinnedProtection({ ...bad, file: 'fabric-api.jar' }), /verified managed artifact/);
    await assert.rejects(archivePinnedProtection({ ...bad, sha256: 'a'.repeat(64) }), /left untouched/);
    assert.deepEqual(await fs.readFile(bad.source), body);

    const linked = await fixture();
    const actualMods = path.join(linked.root, 'actual-mods');
    await fs.rename(path.join(linked.root, 'mods'), actualMods);
    await fs.symlink(actualMods, path.join(linked.root, 'mods'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(archivePinnedProtection(linked), /linked|nonordinary/);
    assert.deepEqual(await fs.readFile(path.join(actualMods, linked.file)), body);

    const lifecycle = await fixture();
    let checkpoints = 0;
    await assert.rejects(archivePinnedProtection({ ...lifecycle, revalidate: async () => {
      if (++checkpoints === 3) throw new Error('profile changed');
    } }), /profile changed/);
    assert.deepEqual(await fs.readFile(lifecycle.source), body);
    assert.equal(await fs.readFile(path.join(lifecycle.root, 'config.json'), 'utf8'), 'enabled');

    const commitFailure = await fixture();
    await assert.rejects(archivePinnedProtection({ ...commitFailure, commit: async () => {
      await commitFailure.commit(); throw new Error('commit failed after write');
    } }), /commit failed after write/);
    assert.deepEqual(await fs.readFile(commitFailure.source), body);
    assert.equal(await fs.readFile(path.join(commitFailure.root, 'config.json'), 'utf8'), 'enabled');

    const replacement = await fixture();
    await assert.rejects(archivePinnedProtection({ ...replacement, commit: async () => {
      await fs.writeFile(replacement.source, 'external replacement'); throw new Error('commit rejected');
    } }), /needs recovery/);
    assert.equal(await fs.readFile(replacement.source, 'utf8'), 'external replacement');
    const archived = await fs.readdir(path.join(replacement.root, '.click-interval-anticheat-backups'));
    assert.deepEqual(await fs.readFile(path.join(replacement.root, '.click-interval-anticheat-backups', archived[0], replacement.file)), body);
  } finally {
    const relative = path.relative(work, directory);
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'cleanup remains inside explicit test workspace');
    await fs.rm(directory, { recursive: true, force: true });
  }
  console.log('PASS anti-cheat console: exact IDs, serialized narrow changes, pinned archive, dependencies retained, lifecycle/commit rollback, replacement preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; });
