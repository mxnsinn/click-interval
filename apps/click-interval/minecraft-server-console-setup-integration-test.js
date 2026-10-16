'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SETUP_CATALOG, runSetupConsoleCommand } = require('./minecraft-server/setup-console');
const { runAddonConsoleCommand, runAntiCheatConsoleCommand } = require('./minecraft-server/addon-console');
const { PINNED_ARTIFACTS } = require('./minecraft-server/seamless-restart-setup');

const source = fs.readFileSync(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');

function sourceFunction(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Cannot find production function ${name}`);
  const afterDeclaration = source.indexOf('\n', start) + 1;
  const next = source.slice(afterDeclaration).search(/^(?:async )?function [A-Za-z]/m);
  return source.slice(start, next < 0 ? source.length : afterDeclaration + next);
}

const production = ['getAntiCheatConsoleHandlers', 'getSetupConsoleHandlers', 'listConsoleAddons', 'removeConsoleAddon', 'runAssemblyConsoleCommand']
  .map(sourceFunction).join('\n');

function harness() {
  const calls = [];
  const logs = [];
  const failures = new Map();
  const inventory = {
    mods: [{ name: 'Example  Mod.jar' }, { name: 'Other.jar' }, { name: 'FabricProxy-Lite.jar' }, { name: 'ClickIntervalMap-Fabric.jar' }, { name: 'ServerProtection-Fabric.jar' }],
    plugins: [{ name: 'Some Plugin.jar' }, { name: 'ServerProtection.jar' }]
  };
  const customAddons = [];
  const snapshot = { profileId: 'test-profile', paths: { root: 'D:/fixture/SMP' } };
  const mock = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    if (failures.has(name)) throw failures.get(name);
    return typeof result === 'function' ? result(...args) : result;
  };
  const context = {
    module: { exports: {} }, console, Promise, Map, Set, path,
    runSetupConsoleCommand, runAddonConsoleCommand, runAntiCheatConsoleCommand,
    SEAMLESS_RESTART_PINNED_ARTIFACTS: PINNED_ARTIFACTS,
    NATIVE_WORLD_MAP_JAR: 'ClickIntervalMap-Fabric.jar',
    BUNDLED_PROTECTION_FABRIC_JAR: 'ServerProtection-Fabric.jar',
    BUNDLED_PROTECTION_JAR: 'ServerProtection.jar',
    LEGACY_BUNDLED_PROTECTION_JAR: 'ClickIntervalAntiCheat.jar',
    appendServerLog: (value) => logs.push(value),
    setupSeamlessRestart: mock('setupSeamlessRestart', { enabled: true, reused: true }),
    disableSeamlessRestart: mock('disableSeamlessRestart', { enabled: false }),
    silentRestartServer: mock('silentRestartServer', { playersReconnected: true }),
    resumeSeamlessRestartPlayers: mock('resumeSeamlessRestartPlayers', true),
    getSeamlessRestartConsoleStatus: mock('getSeamlessRestartConsoleStatus', { config: { enabled: true }, status: { setupReady: true } }),
    formatSeamlessRestartConsoleStatus: () => 'Silent restart enabled; verified',
    startServer: mock('startServer'),
    stopServer: mock('stopServer'),
    restartServer: mock('restartServer'),
    getBundledTeleportStatus: mock('getBundledTeleportStatus', { message: 'Teleport installed', managed: true }),
    removeBundledTeleport: mock('removeBundledTeleport', { changed: true }),
    getBundledVoiceStatus: mock('getBundledVoiceStatus', { message: 'Voice installed', managed: true }),
    removeBundledVoice: mock('removeBundledVoice', { changed: true }),
    getWorldMapStatus: mock('getWorldMapStatus', { message: 'Map installed' }),
    removeWorldMap: mock('removeWorldMap', { queued: true }),
    getDirectHostingStatus: mock('getDirectHostingStatus', { message: 'Direct enabled' }),
    disableDirectHosting: mock('disableDirectHosting', { message: 'Direct disabled' }),
    getLocalOnlyModeStatus: mock('getLocalOnlyModeStatus', { enabled: false }),
    setLocalOnlyMode: mock('setLocalOnlyMode', { enabled: false }),
    getBundledAntiCheatStatus: mock('getBundledAntiCheatStatus', { message: 'Protection installed' }),
    removeBundledProtectionFromConsole: mock('removeBundledProtectionFromConsole', 'Protection archived and disabled'),
    getPaths: mock('getPaths', snapshot.paths),
    getAddonTargetDir: (paths, kind) => path.join(paths.root, kind),
    assertWorldResetPlainPath: mock('assertWorldResetPlainPath', true),
    captureActiveServerToolProfile: mock('captureActiveServerToolProfile', snapshot),
    revalidateServerToolProfile: mock('revalidateServerToolProfile', snapshot.paths),
    listManagedAddonFiles: mock('listManagedAddonFiles', (_paths, kind) => inventory[kind]),
    listCustomAntiCheats: mock('listCustomAntiCheats', () => customAddons),
    removeConsoleCustomAntiCheat: mock('removeCustom', 'Custom add-on removed'),
    deleteManagedJar: mock('deleteManagedJar', true),
    // The anti-cheat backend has its own state/ownership tests; here we test
    // that manager routing reaches its typed parser instead of Java commands.
    serverToolMutationCoordinator: { run: (_key, work) => work() },
    bindAntiCheatConsoleToPaths: () => ({
      list: mock('listAntiCheat', { enabled: true, builtInEnabled: true, checks: [{ id: 'speed', enabled: true, effective: true }], custom: [] }),
      setCheckEnabled: mock('setCheck', { appliedLive: true }),
      setEnabled: mock('setEnabled', { appliedLive: true })
    })
  };
  vm.runInNewContext(`${production}\nmodule.exports = { runAssemblyConsoleCommand };`, context,
    { filename: 'production-console-setup-harness.js' });
  return { calls, logs, failures, inventory, customAddons, snapshot, run: context.module.exports.runAssemblyConsoleCommand };
}

const normalized = (value) => JSON.parse(JSON.stringify(value));
const names = (calls) => calls.map(([name]) => name);

(async () => {
  for (const command of ['silent restart setup', 'silent-restart setup', 'seamless-restart setup']) {
    const { calls, run } = harness();
    await run(command);
    await run(command);
    assert.deepEqual(names(calls), ['setupSeamlessRestart', 'setupSeamlessRestart'],
      'setup and repeated setup must never start or restart Minecraft');
  }
  for (const alias of ['silent restart', 'silent-restart', 'seamless-restart']) {
    for (const action of ['delete', 'remove', 'disable']) {
      const { calls, run } = harness();
      assert.match(await run(`${alias} ${action}`), /disabled/);
      assert.deepEqual(names(calls), ['disableSeamlessRestart']);
    }
    for (const suffix of ['steup', 'reboot', 'setup extra', 'delete all', 'resume now', 'status now', 'unexpected message']) {
      const { calls, run } = harness();
      await assert.rejects(run(`${alias} ${suffix}`), /Usage:/);
      assert.deepEqual(calls, [], 'unknown or extra silent-restart arguments must not trigger any operation');
    }
    {
      const { calls, run } = harness();
      await run(`${alias} now Planned maintenance`);
      assert.deepEqual(normalized(calls), [['silentRestartServer', 'Planned maintenance']]);
    }
    {
      const { calls, run } = harness();
      await run(alias);
      assert.deepEqual(normalized(calls), [['silentRestartServer', '']]);
    }
  }
  {
    const { calls, run } = harness();
    await assert.rejects(run('silent setup'), /Usage:/);
    assert.deepEqual(calls, []);
  }
  {
    const { calls, run } = harness();
    await run('silent restart status');
    await run('silent restart resume');
    assert.deepEqual(names(calls), ['getSeamlessRestartConsoleStatus', 'resumeSeamlessRestartPlayers']);
  }

  const removers = {
    'silent-restart': 'disableSeamlessRestart', teleport: 'removeBundledTeleport', voice: 'removeBundledVoice',
    'world-map': 'removeWorldMap', anticheat: 'removeBundledProtectionFromConsole',
    'direct-hosting': 'disableDirectHosting', 'local-only': 'setLocalOnlyMode'
  };
  for (const entry of SETUP_CATALOG) {
    const { calls, run } = harness();
    await run(`setup delete ${entry.name}`);
    assert.deepEqual(names(calls), [removers[entry.name]], 'each setup must use only its existing backend');
    if (entry.name === 'local-only') assert.deepEqual(normalized(calls), [['setLocalOnlyMode', false]]);
  }
  {
    const { calls, run } = harness();
    const output = await run('setup list');
    for (const entry of SETUP_CATALOG) assert.ok(output.includes(`/setup delete ${entry.name}`));
    assert.equal(calls.length, SETUP_CATALOG.length);
    assert.ok(names(calls).every(name => name.startsWith('get')), 'listing setup must not invoke removers');
  }
  for (const command of ['setup delete ../SMP', 'setup delete all', 'setup delete teleport extra', 'setup list extra',
    'addons delete mods ../A.jar', 'addons delete world A.jar', 'addons list mods extra', 'anticheat disable speed extra']) {
    const { calls, run } = harness();
    await assert.rejects(run(command));
    assert.deepEqual(calls, [], 'malformed typed commands must not invoke backends');
  }

  {
    const { calls, run } = harness();
    const output = await run('addons list mods');
    assert.match(output, /Example  Mod\.jar/);
    assert.doesNotMatch(output, /Some Plugin\.jar/);
    assert.deepEqual(names(calls), ['getPaths', 'listManagedAddonFiles']);
    assert.equal(calls[1][2], 'mods');
  }
  {
    const { calls, run } = harness();
    const output = await run('addons list');
    assert.match(output, /Some Plugin\.jar/);
    assert.deepEqual(names(calls), ['getPaths', 'listManagedAddonFiles', 'listManagedAddonFiles']);
  }
  for (const [command, kind, file] of [
    ['addons delete mods Example  Mod.jar', 'mods', 'Example  Mod.jar'],
    ['addons remove plugins Some Plugin.jar', 'plugins', 'Some Plugin.jar']
  ]) {
    const { calls, snapshot, run } = harness();
    await run(command);
    assert.deepEqual(names(calls), ['captureActiveServerToolProfile', 'listManagedAddonFiles', 'revalidateServerToolProfile', 'assertWorldResetPlainPath', 'listCustomAntiCheats', 'deleteManagedJar']);
    assert.deepEqual(normalized(calls.at(-1).slice(0, 3)), ['deleteManagedJar', kind, file]);
    assert.equal(calls.at(-1)[3], snapshot, 'generic removal must retain the profile snapshot captured before async lookups');
    assert.deepEqual(calls.find(([name]) => name === 'assertWorldResetPlainPath').slice(1),
      [snapshot.paths.root, path.join(snapshot.paths.root, kind, file)]);
  }
  {
    const { calls, inventory, customAddons, snapshot, run } = harness();
    const id = '12345678-abcd-4abc-9abc-123456789abc';
    inventory.mods.push({ name: 'ManagedAntiCheat.jar' });
    customAddons.push({ id, kind: 'mods', file: 'ManagedAntiCheat.jar' });
    await run('addons delete mods ManagedAntiCheat.jar');
    assert.deepEqual(normalized(calls.at(-1).slice(0, 2)), ['removeCustom', id]);
    assert.equal(calls.at(-1)[2], snapshot, 'custom removal must retain the profile snapshot captured before async lookups');
    assert.ok(!names(calls).includes('deleteManagedJar'), 'custom anti-cheats must keep their metadata synchronized through their own remover');
  }
  {
    const { calls, failures, run } = harness();
    const linkedPath = new Error('Refusing linked or reparse-point add-on path');
    failures.set('assertWorldResetPlainPath', linkedPath);
    await assert.rejects(run('addons delete mods Example  Mod.jar'), (error) => error === linkedPath);
    assert.deepEqual(names(calls), ['captureActiveServerToolProfile', 'listManagedAddonFiles', 'revalidateServerToolProfile', 'assertWorldResetPlainPath']);
    assert.ok(!names(calls).some(name => name.startsWith('remove') || name === 'deleteManagedJar'),
      'a linked add-on path must fail before any removal handler is invoked');
  }
  {
    const { calls, run } = harness();
    await assert.rejects(run('addons delete mods example  Mod.jar'), /exact installed filename was not found/);
    assert.deepEqual(names(calls), ['captureActiveServerToolProfile', 'listManagedAddonFiles']);
  }
  for (const [kind, file, backend] of [
    ['mods', 'ClickIntervalMap-Fabric.jar', 'removeWorldMap'],
    ['mods', 'FabricProxy-Lite.jar', 'disableSeamlessRestart'],
    ['mods', 'ServerProtection-Fabric.jar', 'removeBundledProtectionFromConsole'],
    ['plugins', 'ServerProtection.jar', 'removeBundledProtectionFromConsole'],
    ['plugins', 'ClickIntervalAntiCheat.jar', 'removeBundledProtectionFromConsole']
  ]) {
    const { calls, run } = harness();
    await run(`addons delete ${kind} ${file}`);
    assert.deepEqual(names(calls), [backend], 'managed add-ons must delegate instead of generic JAR removal');
  }

  {
    const { calls, run } = harness();
    await run('anticheat disable autoClicker');
    await run('anticheat enable all');
    await run('anticheat delete 12345678-abcd-4abc-9abc-123456789abc');
    assert.deepEqual(normalized(calls), [['getPaths'], ['setCheck', 'autoClicker', false], ['getPaths'], ['setEnabled', true],
      ['removeCustom', '12345678-abcd-4abc-9abc-123456789abc']]);
  }
  for (const [command, backend] of [
    ['silent restart setup', 'setupSeamlessRestart'], ['silent-restart delete', 'disableSeamlessRestart'],
    ['setup delete voice', 'removeBundledVoice'], ['addons delete mods ClickIntervalMap-Fabric.jar', 'removeWorldMap'],
    ['addons delete mods Example  Mod.jar', 'deleteManagedJar'], ['anticheat disable speed', 'setCheck']
  ]) {
    const { calls, failures, run } = harness();
    const failure = new Error('Profile or lifecycle guard rejected this operation');
    failures.set(backend, failure);
    await assert.rejects(run(command), (error) => error === failure);
    assert.equal(names(calls).filter(name => name === backend).length, 1);
    assert.ok(!names(calls).some(name => ['startServer', 'stopServer', 'restartServer', 'silentRestartServer'].includes(name)),
      'failed setup/removal must not fall back to a lifecycle operation');
  }

  console.log('PASS production console setup/add-on routing, repeated setup, strict silent-restart actions, exact filenames, managed delegation, and guarded errors');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
