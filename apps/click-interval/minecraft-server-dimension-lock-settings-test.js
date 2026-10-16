'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const locks = require('./minecraft-server/dimension-lock-settings');
const mainPath = path.join(__dirname, 'minecraft-server/main.js');
let root;
const fixture = `version=3\nend.locked=true\nend.unlockAtMillis=0\nnether.locked=true\nnether.unlockAtMillis=0\neyeCraftingBlocked=false\nframeInsertionBlocked=true\nend.startOnLaunchMillis=259200000\nend.openingDurationMillis=259200000\nnether.startOnLaunchMillis=172800000\nnether.openingDurationMillis=172800000\n`;
async function put(name, data) { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); return file; }
function backend() {
  const module = { exports: {} };
  const source = fss.readFileSync(mainPath, 'utf8') + `\nmodule.exports.test = { inspectAntiCheatJar, normalizeServerConfig, getBundledDeathLootAdapter, findBundledDeathLootDependencyArtifact, DEFAULT_CONFIG };`;
  const sandbox = { module, exports: module.exports, __dirname: path.dirname(mainPath), __filename: mainPath, Buffer, URL, URLSearchParams,
    process, console, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    require(id) {
      if (id === 'electron') return { app: { getPath: () => root, on() {} }, BrowserWindow: { fromWebContents: () => null }, ipcMain: { handle() {} }, dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {}, safeStorage: { isEncryptionAvailable: () => false } };
      if (id === './vendor/node_modules/nat-api') return class {};
      return id.startsWith('./') ? require(path.join(path.dirname(mainPath), id)) : require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: mainPath }); return module.exports.test;
}
async function installationContext(directory, inspectJar, dependency, revalidate = async () => {}) {
  const profileRoot = path.join(root, directory), mods = path.join(profileRoot, 'mods');
  await fs.mkdir(mods, { recursive: true });
  return { root: profileRoot, mods, inspectJar, dependency, revalidate,
    artifact: path.join(__dirname, 'minecraft-server/server-end-lock-fabric/dist', locks.ARTIFACT),
    getIndex: async () => ({ partial: false, files: await Promise.all((await fs.readdir(mods)).filter(name => name.endsWith('.jar')).map(async name => ({ name, descriptor: await inspectJar(path.join(mods, name)) }))) }) };
}
(async () => {
  await fs.mkdir(path.join(__dirname, 'work'), { recursive: true });
  root = await fs.mkdtemp(path.join(__dirname, 'work', 'dimension-lock-test-'));
  const api = backend();
  assert.equal(api.DEFAULT_CONFIG.lockEnd, false); assert.equal(api.DEFAULT_CONFIG.lockNether, false);
  assert.equal(api.normalizeServerConfig({ lockEnd: 'false', lockNether: true }).lockEnd, false);
  assert.equal(locks.isSupported({ serverType: 'paper', serverVersion: '26.2' }), false);
  assert.equal(locks.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, { installedType: 'fabric', build: '0.18.9' }), false);
  assert.equal(locks.isSupported({ serverType: 'fabric', serverVersion: '26.2' }, { installedType: 'fabric', build: '0.19.5' }), true);
  assert.equal(locks.serializeState(locks.parseState(fixture)), fixture);
  const stateFile = await put('scheduled/server-end-lock/state.properties', fixture);
  const initial = await locks.readState(root, 'scheduled');
  assert.equal(await fs.readFile(stateFile, 'utf8'), fixture, 'reading must not start or rewrite scheduled locks');
  const changed = await locks.writeChanges(root, 'scheduled', { lockNether: false }, initial.revision);
  assert.deepEqual(changed.state.end, initial.state.end, 'one toggle must preserve the other launch timer');
  assert.equal(changed.state.nether.locked, false);
  assert.equal(changed.state.nether.startOnLaunchMillis, '0');
  assert.equal(changed.state.eyeCraftingBlocked, false);
  const prior = await fs.readFile(stateFile, 'utf8');
  await assert.rejects(locks.writeChanges(root, 'scheduled', { lockEnd: false }, initial.revision), /changed since/);
  assert.equal(await fs.readFile(stateFile, 'utf8'), prior, 'stale save must not touch the state');
  await locks.writeChanges(root, 'scheduled', { lockNether: false, lockEnd: false }, changed.revision);
  const reset = await locks.readState(root, 'scheduled');
  assert.equal(reset.state.end.startOnLaunchMillis, '0'); assert.equal(reset.state.eyeCraftingBlocked, false);
  for (const bad of ['version=2\n', fixture.replace('172800000', '-1'), fixture.replace('end.locked=true', 'end.locked=false'), fixture + 'extra=true\n']) assert.throws(() => locks.parseState(bad));
  assert.throws(() => locks.requestedChanges({ revision: 'missing', worldName: 'world', changes: { randomCommand: 'stop' } }));
  assert.throws(() => locks.requestedChanges({ revision: 'missing', worldName: 'world', changes: { lockEnd: 'false' } }));
  await assert.rejects(locks.readState(root, '../outside'), /Invalid.*world name/);
  const legacy = await put('legacy/server-end-lock/state.properties', 'version=1\nlocked=true\n');
  await locks.readState(root, 'legacy'); assert.equal(await fs.readFile(legacy, 'utf8'), 'version=1\nlocked=true\n');
  await locks.writeChanges(root, 'legacy', { lockNether: true }, (await locks.readState(root, 'legacy')).revision);
  assert.equal((await locks.readState(root, 'legacy')).state.end.locked, true);
  {
    await put('runtime/server-end-lock/state.properties', fixture);
    const current = await locks.readState(root, 'runtime'); const commands = [];
    let queued = null;
    await locks.applyRunningChanges({ root, worldName: 'runtime', request: { revision: current.revision, changes: { lockEnd: false } },
      revalidate: async () => {}, sendCommand: command => { commands.push(command); queued = { lockEnd: false }; return true; },
      wait: async () => { if (queued) { await locks.writeChanges(root, 'runtime', queued); queued = null; } } });
    assert.deepEqual(commands, ['endlock off']);
    assert.deepEqual((await locks.readState(root, 'runtime')).state.nether, current.state.nether);
    await assert.rejects(locks.applyRunningChanges({ root, worldName: 'runtime', request: { revision: current.revision, changes: { lockEnd: true } },
      revalidate: async () => {}, sendCommand: () => { throw Error('must not deliver stale command'); }, wait: async () => {} }), /changed since/);
    await assert.rejects(locks.applyRunningChanges({ root, worldName: 'runtime', request: { revision: (await locks.readState(root, 'runtime')).revision, changes: { lockEnd: true } },
      revalidate: async () => {}, sendCommand: () => true, wait: async () => {} }), /did not confirm/);
  }
  const dependency = await api.findBundledDeathLootDependencyArtifact(api.getBundledDeathLootAdapter('fabric', '26.2'));
  assert.ok(dependency, 'packaged Fabric API dependency must be available');
  const newContext = await installationContext('new-profile', api.inspectAntiCheatJar, dependency);
  const newInstall = await locks.prepareRuntime(newContext);
  assert.equal(newInstall.previouslyInstalled, false);
  assert.equal((await api.inspectAntiCheatJar(path.join(newContext.mods, 'ServerEndLock-Fabric.jar'))).sha256, locks.SHA256);
  assert.equal((await locks.prepareRuntime(newContext)).updated, false, 'same pinned runtime needs no replacement');
  const upgrade = await installationContext('upgrade-profile', api.inspectAntiCheatJar, dependency);
  const older = path.join(__dirname, 'minecraft-server/server-end-lock-fabric/dist/ServerEndLock-Fabric-1.1.0+mc26.2.jar');
  await fs.copyFile(older, path.join(upgrade.mods, 'server-locks.jar'));
  await fs.mkdir(path.join(upgrade.root, 'world/server-end-lock'), { recursive: true });
  await fs.writeFile(path.join(upgrade.root, 'world/server-end-lock/state.properties'), fixture);
  const updated = await locks.prepareRuntime(upgrade);
  assert.equal(updated.previouslyInstalled, true); assert.ok(updated.backup);
  assert.equal((await api.inspectAntiCheatJar(updated.backup)).sha256, locks.KNOWN_HASHES[2]);
  assert.equal(await fs.readFile(path.join(upgrade.root, 'world/server-end-lock/state.properties'), 'utf8'), fixture, 'updating the mod must preserve all timers');
  const unknown = await installationContext('unknown-profile', api.inspectAntiCheatJar, dependency);
  const unknownFile = path.join(unknown.mods, 'ServerEndLock-Fabric.jar');
  await fs.copyFile(older, unknownFile); await fs.appendFile(unknownFile, '\nmodified');
  const unknownBytes = await fs.readFile(unknownFile);
  await assert.rejects(locks.prepareRuntime(unknown), /differs from known releases/);
  assert.deepEqual(await fs.readFile(unknownFile), unknownBytes);
  {
    const source = fss.readFileSync(mainPath, 'utf8');
    const start = source.indexOf('async function applyDimensionLockSettingsRequest('), end = source.indexOf('\nasync function prepareDimensionLocksBeforeStart(', start);
    const previous = { levelName: 'backend-save', serverType: 'fabric', serverVersion: '26.2' };
    const paths = { root };
    await put('backend-save/server-end-lock/state.properties', fixture);
    const state = await locks.readState(root, previous.levelName);
    const request = { profileId: 'fixture', worldName: previous.levelName, revision: state.revision, changes: { lockNether: false } };
    const sandbox = { dimensionLockSettings: locks, path, serverProcess: null, serverLifecycleGeneration: 1, serverState: 'stopped',
      getActiveProfile: async () => ({ id: 'fixture' }), getPathsForProfile: () => paths, isServerRuntimeReady: () => false,
      getDimensionLockSettingsStatus: async () => ({ canEdit: true }), sendServerCommand: () => { throw Error('stopped save must not send commands'); } };
    vm.runInNewContext(source.slice(start, end), sandbox);
    assert.equal(await sandbox.applyDimensionLockSettingsRequest(previous, previous, paths), null, 'a normal Settings save must not mutate locks');
    await assert.rejects(sandbox.applyDimensionLockSettingsRequest({ ...previous, _dimensionLockChanges: { ...request, profileId: 'other' } }, previous, paths), /selected server changed/);
    await assert.rejects(sandbox.applyDimensionLockSettingsRequest({ ...previous, levelName: 'other-world', _dimensionLockChanges: request }, previous, paths), /separately/);
    sandbox.getDimensionLockSettingsStatus = async () => ({ canEdit: false, message: 'Unsupported test runtime' });
    await assert.rejects(sandbox.applyDimensionLockSettingsRequest({ ...previous, _dimensionLockChanges: request }, previous, paths), /Unsupported test runtime/);
    assert.equal((await locks.readState(root, previous.levelName)).revision, state.revision);
    sandbox.getDimensionLockSettingsStatus = async () => ({ canEdit: true });
    const saved = await sandbox.applyDimensionLockSettingsRequest({ ...previous, _dimensionLockChanges: request }, previous, paths);
    assert.equal(saved.state.nether.locked, false); assert.equal(saved.state.end.startOnLaunchMillis, '259200000');
    sandbox.getDimensionLockSettingsStatus = async () => ({ canEdit: false, canUnlock: true, end: saved.state.end, nether: saved.state.nether, message: 'Unsupported test runtime' });
    const unlock = { ...request, revision: saved.revision, changes: { lockEnd: false } };
    await assert.rejects(sandbox.applyDimensionLockSettingsRequest({ ...previous, _dimensionLockChanges: { ...unlock, changes: { lockNether: true } } }, previous, paths), /Unsupported test runtime/);
    assert.equal((await sandbox.applyDimensionLockSettingsRequest({ ...previous, _dimensionLockChanges: unlock }, previous, paths)).state.end.locked, false,
      'unsupported stopped profile must allow clearing a saved lock to avoid a startup trap');
  }
  {
    const source = fss.readFileSync(path.join(__dirname, 'minecraft-server-ui.js'), 'utf8');
    const start = source.indexOf('  function collectSettings()'), end = source.indexOf('  function formatPlayerDate(', start);
    const controls = [{ dataset: { configKey: 'lockEnd' }, checked: true, disabled: false, type: 'checkbox' }, { dataset: { configKey: 'lockNether' }, checked: true, disabled: false, type: 'checkbox' }];
    const sandbox = { window: { DimensionLockControls: require('./dimension-lock-controls') }, status: { config: { lockEnd: true, lockNether: true } }, dimensionLockDraft: { revision: 'scheduled', worldName: 'world', profileId: 'fixture', lockEnd: { locked: true, autoOpen: false }, lockNether: { locked: true, autoOpen: false } },
      document: { querySelectorAll: () => controls }, $: id => controls.find(item => `msSetting_${item.dataset.configKey}` === id), normalizeNumericSetting() {} };
    vm.runInNewContext(source.slice(start, end), sandbox);
    assert.equal(sandbox.collectSettings()._dimensionLockChanges, undefined, 'unrelated Settings save must not reset timers');
    controls[0].checked = false;
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.collectSettings()._dimensionLockChanges)), { revision: 'scheduled', worldName: 'world', profileId: 'fixture', changes: { lockEnd: false } });
  }
  console.log('PASS dimension locks: schedules, atomic state writes, stale requests, console acknowledgement, pinned runtime upgrades, and UI intent');
})().catch(error => { console.error(error); process.exitCode = 1; });
