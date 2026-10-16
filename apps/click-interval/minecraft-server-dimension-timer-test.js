'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const locks = require('./minecraft-server/dimension-lock-settings');

const scheduled = durationSeconds => ({ locked: true, autoOpen: true, durationSeconds });
let root;
async function save(name, state) {
  const file = locks.statePath(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, locks.serializeState(state));
}
async function main() {
  await fs.mkdir(path.join(__dirname, 'work'), { recursive: true });
  root = await fs.mkdtemp(path.join(__dirname, 'work', 'dimension-timer-test-'));
  const defaults = locks.defaults();
  assert.equal(locks.describeLock(defaults.end).autoOpen, false);
  assert.equal(locks.describeLock(defaults.end).durationSeconds, null, 'an unchecked timer has no implicit duration');
  const request = changes => ({ profileId: 'fixture', worldName: 'world', revision: 'missing', changes });
  for (const value of [null, [], 'true', { locked: true }, { locked: 'true', autoOpen: true, durationSeconds: 60 },
    { locked: true, autoOpen: 'true', durationSeconds: 60 }, { locked: false, autoOpen: true, durationSeconds: 60 },
    { locked: true, autoOpen: false, durationSeconds: 60 }, { locked: true, autoOpen: true, durationSeconds: '60' },
    { ...scheduled(60), command: 'stop' }, ...[0, -1, 1.5, NaN, Infinity, 31536001].map(scheduled)]) {
    assert.throws(() => locks.requestedChanges(request({ lockEnd: value })), /Invalid|requires|duration/);
  }
  assert.throws(() => locks.requestedChanges(request({ end: scheduled(60) })), /Invalid/);
  for (const seconds of [1, 31536000]) {
    const state = locks.applyChanges(defaults, { lockEnd: scheduled(seconds) });
    assert.equal(state.end.unlockAtMillis, '0');
    assert.equal(state.end.startOnLaunchMillis, String(seconds * 1000));
    assert.equal(locks.parseState(locks.serializeState(state)).end.openingDurationMillis, String(seconds * 1000));
  }
  const intent = request({ lockEnd: scheduled(60) });
  const copied = locks.requestedChanges(intent);
  intent.changes.lockEnd.durationSeconds = 10;
  assert.equal(copied.changes.lockEnd.durationSeconds, 60, 'validated intent must not alias mutable request data');

  // Stopped saves arm only the dimension explicitly edited; reads and unrelated saves preserve exact bytes.
  const armed = await locks.writeChanges(root, 'world', { lockEnd: scheduled(7200), lockNether: true }, 'missing');
  assert.equal(armed.state.end.startOnLaunchMillis, '7200000');
  assert.equal(armed.state.end.unlockAtMillis, '0');
  assert.equal(armed.state.nether.startOnLaunchMillis, '0');
  const bytes = await fs.readFile(armed.file, 'utf8');
  assert.equal(locks.describeLock((await locks.readState(root, 'world')).state.end, 12345).durationSeconds, 7200);
  await locks.writeChanges(root, 'world', {}, armed.revision);
  assert.equal(await fs.readFile(armed.file, 'utf8'), bytes);
  await assert.rejects(locks.writeChanges(root, 'world', { lockEnd: scheduled(5) }, 'missing'), /changed since/);
  assert.equal(await fs.readFile(armed.file, 'utf8'), bytes);
  const manual = await locks.writeChanges(root, 'world', { lockEnd: { locked: true, autoOpen: false } }, armed.revision);
  assert.deepEqual(manual.state.end, { locked: true, unlockAtMillis: '0', startOnLaunchMillis: '0', openingDurationMillis: '0' });
  const opened = await locks.writeChanges(root, 'world', { lockEnd: false }, manual.revision);
  assert.equal(opened.state.end.locked, false);
  assert.equal(locks.describeLock(opened.state.end).autoOpen, false);

  // Simulate the existing native console persisting its reply, with an injectable wall clock.
  let time = 1900000000000;
  let pending = null;
  const commands = [];
  await save('running', defaults);
  const execute = async changes => {
    const prior = await locks.readState(root, 'running');
    return locks.applyRunningChanges({ root, worldName: 'running', request: { revision: prior.revision, changes },
      now: () => time, revalidate: async () => {},
      sendCommand(command) { commands.push(command); pending = command; return true; },
      wait: async () => {
        time += 100;
        if (!pending) return;
        const [domain, action, duration] = pending.split(' '); pending = null;
        const state = (await locks.readState(root, 'running')).state;
        const key = domain.slice(0, -4);
        state[key] = { locked: action !== 'off', unlockAtMillis: action === 'for' ? String(time + Number(duration.slice(0, -1)) * 1000) : '0',
          startOnLaunchMillis: '0', openingDurationMillis: '0' };
        await save('running', state);
      } });
  };
  const running = await execute({ lockEnd: scheduled(60), lockNether: scheduled(1) });
  assert.deepEqual(commands, ['endlock for 60s', 'netherlock for 1s']);
  assert.equal(running.state.end.startOnLaunchMillis, '0');
  assert.equal(running.state.end.openingDurationMillis, '0', 'native for commands do not retain the original duration');
  assert.equal(locks.describeLock(running.state.end, time).autoOpen, true);
  assert.equal(locks.describeLock(running.state.end, time).durationSeconds, 60);
  const runningBytes = await fs.readFile(running.file, 'utf8');
  await locks.writeChanges(root, 'running', {}, running.revision);
  assert.equal(await fs.readFile(running.file, 'utf8'), runningBytes, 'unrelated stopped save must not regenerate an active deadline');
  const manualRunning = await execute({ lockEnd: { locked: true, autoOpen: false } });
  assert.equal(commands.at(-1), 'endlock on');
  assert.equal(manualRunning.state.end.locked, true);
  assert.equal(manualRunning.state.end.unlockAtMillis, '0');
  assert.equal(manualRunning.state.nether.unlockAtMillis, running.state.nether.unlockAtMillis, 'cancelling End leaves Nether timer alone');
  assert.equal((await execute({ lockNether: false })).state.nether.unlockAtMillis, '0');
  assert.equal(commands.at(-1), 'netherlock off');

  const invalid = { lockEnd: scheduled(10), lockNether: scheduled(NaN) };
  await assert.rejects(execute(invalid), /duration/);
  assert.equal(commands.length, 4, 'validate every dimension before delivering the first command');
  const stale = await locks.readState(root, 'running');
  await assert.rejects(locks.applyRunningChanges({ root, worldName: 'running', request: { revision: stale.revision, changes: { lockEnd: scheduled(30) } },
    revalidate: async () => { await locks.writeChanges(root, 'running', { lockNether: true }); },
    sendCommand: () => { throw Error('stale intent must not reach console'); }, wait: async () => {} }), /changed during/);
  const noAck = await locks.readState(root, 'running');
  await assert.rejects(locks.applyRunningChanges({ root, worldName: 'running', request: { revision: noAck.revision, changes: { lockEnd: scheduled(30) } },
    revalidate: async () => {}, sendCommand: () => true, wait: async () => {}, now: () => time }), /did not confirm/);
  const unknownDuration = { locked: true, unlockAtMillis: '9223372036854775807', startOnLaunchMillis: '0', openingDurationMillis: '0' };
  assert.equal(locks.describeLock(unknownDuration, time).durationSeconds, 31536000, 'legacy large deadlines remain bounded in editable duration');

  // Execute the actual backend hook against a disposable profile to verify guards for timer requests.
  const source = await fs.readFile(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');
  const from = source.indexOf('async function applyDimensionLockSettingsRequest('), to = source.indexOf('\nasync function prepareDimensionLocksBeforeStart(', from);
  const previous = { levelName: 'guarded', serverType: 'fabric', serverVersion: '26.2' };
  const paths = { root };
  const sandbox = { dimensionLockSettings: locks, path, serverProcess: null, serverLifecycleGeneration: 1, serverState: 'stopped',
    getActiveProfile: async () => ({ id: 'fixture' }), getPathsForProfile: () => paths, isServerRuntimeReady: () => false,
    getDimensionLockSettingsStatus: async () => ({ canEdit: true }), sendServerCommand: () => { throw Error('stopped timer cannot reach console'); } };
  vm.runInNewContext(source.slice(from, to), sandbox);
  const input = { ...previous, _dimensionLockChanges: { ...request({ lockEnd: scheduled(300) }), worldName: previous.levelName } };
  assert.equal(await sandbox.applyDimensionLockSettingsRequest(previous, previous, paths), null);
  sandbox.getDimensionLockSettingsStatus = async () => ({ canEdit: false, canUnlock: true, end: { locked: true }, message: 'Unsupported timer runtime' });
  await assert.rejects(sandbox.applyDimensionLockSettingsRequest(input, previous, paths), /Unsupported timer runtime/);
  assert.equal((await locks.readState(root, previous.levelName)).exists, false);
  sandbox.getDimensionLockSettingsStatus = async () => ({ canEdit: true });
  const guarded = await sandbox.applyDimensionLockSettingsRequest(input, previous, paths);
  assert.equal(guarded.state.end.startOnLaunchMillis, '300000');
  await assert.rejects(sandbox.applyDimensionLockSettingsRequest(input, previous, paths), /changed since/);

  // The actual startup hook must not rearm an existing deadline or a completed timer.
  const startupFrom = source.indexOf('async function prepareDimensionLocksBeforeStart(');
  const startupTo = source.indexOf('\nasync function prepareTeamsBeforeStart(', startupFrom);
  const startup = { dimensionLockSettings: { ...locks, prepareRuntime: async () => ({ installed: true, updated: false, previouslyInstalled: true }) }, path,
    __dirname: path.join(__dirname, 'minecraft-server'), findBundledDeathLootDependencyArtifact: async () => ({}),
    getBundledDeathLootAdapter() {}, inspectAntiCheatJar() {}, getModDescriptorIndex() {}, modDescriptorIndexStore: { invalidate() {} }, appendServerLog() {} };
  vm.runInNewContext(source.slice(startupFrom, startupTo), startup);
  const runStartup = name => startup.prepareDimensionLocksBeforeStart({ paths: { root, mods: path.join(root, 'mods') },
    serverConfig: { serverType: 'fabric', serverVersion: '26.2', levelName: name, lockEnd: true, lockNether: true },
    platform: { verified: true }, revalidate: async () => {} });
  await save('restart-active', running.state);
  const beforeRestart = await locks.readState(root, 'restart-active');
  await runStartup('restart-active');
  assert.equal((await locks.readState(root, 'restart-active')).revision, beforeRestart.revision);
  await save('restart-complete', defaults);
  const beforeComplete = await locks.readState(root, 'restart-complete');
  await runStartup('restart-complete');
  assert.equal((await locks.readState(root, 'restart-complete')).revision, beforeComplete.revision);
  await runStartup('new-no-timer');
  assert.equal(locks.describeLock((await locks.readState(root, 'new-no-timer')).state.end).autoOpen, false, 'startup never invents an opening timer');
  console.log('PASS explicit dimension timers: bounded opt-in, stopped arming, manual cancellation, independent deadlines, console acknowledgement, stale/race rejection, and backend guards');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
