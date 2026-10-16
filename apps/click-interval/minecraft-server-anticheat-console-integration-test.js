'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAntiCheatConsoleBindings } = require('./minecraft-server/anticheat-console-bindings');
const source = fs.readFileSync(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');
function section(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Locate ${startText}`);
  return source.slice(start, end);
}
const handlersSource = section('async function removeBundledProtectionFromConsole()', 'function getSetupConsoleHandlers()');
const refreshSource = section('function assessManagedBundledProtectionRefresh(', 'function installBundledAntiCheat()');

(async () => {
  const paths = { root: 'profile-root', protectionConfig: 'protection.json' };
  const profile = { profileId: 'SMP', paths };
  const calls = [];
  let status = { installed: true, integrityVerified: true, kind: 'mods', file: 'ServerProtection-Fabric.jar', sha256: 'b'.repeat(64) };
  let config = { enabled: true, layers: { builtIn: true }, checks: { speed: true, reach: true }, tuning: { keep: 17 } };
  let stateLocked = false;
  const context = vm.createContext({
    createAntiCheatConsoleBindings, PROTECTION_CHECKS: { speed: 'movement', reach: 'combat' },
    serverToolMutationCoordinator: { run: async (key, work) => { calls.push(key); return work(); } },
    serializeProtectionStateTransaction: async (root, work) => {
      assert.equal(root, paths.root); assert.equal(stateLocked, false); stateLocked = true;
      try { return await work(); } finally { stateLocked = false; }
    },
    captureActiveServerToolProfile: async () => profile,
    revalidateServerToolProfile: async value => { assert.equal(value, profile); calls.push('revalidate'); },
    getBundledAntiCheatStatus: async value => { assert.equal(value, paths); return status; },
    captureSmallFileSnapshot: async file => { assert.equal(file, paths.protectionConfig); return { sentinel: true }; },
    restoreSmallFileSnapshot: async snapshot => { assert.equal(snapshot.sentinel, true); calls.push('rollback'); },
    archivePinnedProtection: async options => {
      assert.equal(stateLocked, true); assert.equal(options.root, paths.root);
      assert.equal(options.file, status.file); assert.equal(options.sha256, status.sha256);
      await options.revalidate(); calls.push('archive'); await options.commit();
      assert.equal(typeof options.rollback, 'function'); return { removed: true };
    },
    mutateProtectionConfigForPathsUnlocked: async (value, update) => {
      assert.equal(value, paths); assert.equal(stateLocked, true);
      const patch = await update(config); assert.deepEqual(JSON.parse(JSON.stringify(patch)), { enabled: false });
      config = { ...config, ...patch }; calls.push('disabled'); return config;
    },
    invalidateStatusCache: () => {}, invalidateCachedWork: () => {},
    getPaths: async () => paths, getProtectionConfig: async value => { assert.equal(value, paths); return config; },
    mutateProtectionConfigForPaths: async (value, update) => {
      assert.equal(value, paths); const patch = await update(config);
      config = { ...config, ...patch, checks: { ...config.checks, ...(patch.checks || {}) } }; return config;
    },
    listCustomAntiCheats: async value => { assert.equal(value, paths); return []; },
    removeCustomAntiCheat: async (id, value, revalidate) => {
      assert.equal(value, paths); assert.equal(id, '12345678-abcd');
      assert.equal(typeof revalidate, 'function'); await revalidate(); calls.push('custom-remove');
    }
  });
  vm.runInContext(handlersSource, context);
  const message = await context.removeBundledProtectionFromConsole();
  assert.match(message, /removed and disabled/);
  assert.equal(config.enabled, false);
  assert.deepEqual(config.tuning, { keep: 17 });
  assert.deepEqual(config.layers, { builtIn: true });
  assert(calls.indexOf('archive') < calls.indexOf('disabled'));
  const archives = calls.filter(item => item === 'archive').length;
  status = { ...status, integrityVerified: false };
  await assert.rejects(context.removeBundledProtectionFromConsole(), /not a verified/);
  status = { ...status, integrityVerified: true, targetCollision: true };
  await assert.rejects(context.removeBundledProtectionFromConsole(), /Conflicting/);
  status = { ...status, targetCollision: false, installed: false };
  assert.match(await context.removeBundledProtectionFromConsole(), /not installed/);
  assert.equal(calls.filter(item => item === 'archive').length, archives);
  await context.removeConsoleCustomAntiCheat('12345678-abcd');
  assert(calls.includes('custom-remove'));
  const handlers = context.getAntiCheatConsoleHandlers();
  await handlers.setCheck('movement.speed', false);
  assert.equal(config.checks.speed, false); assert.equal(config.checks.reach, true);
  await assert.rejects(handlers.setCheck('movement.fake', false), /Unknown/);
  assert.match(await handlers.list(), /movement.speed: disabled/);

  const customPaths = { root: path.resolve('fixture-profile'), mods: path.resolve('fixture-profile/mods'),
    plugins: path.resolve('fixture-profile/plugins') };
  const customEvents = [];
  const customRow = { id: '12345678-abcd', kind: 'mods', file: 'ImportedProtection.jar', sha256: 'a'.repeat(64) };
  let customRows = [customRow], validCustomHash = true;
  const customRuntime = vm.createContext({
    path, fs: { stat: async () => ({ isFile: () => true }), rm: async () => customEvents.push('remove') },
    getPaths: async () => customPaths,
    serializeProtectionStateTransaction: async (root, work) => {
      assert.equal(root, customPaths.root); customEvents.push('state-lock'); return work();
    },
    readCustomAntiCheatMetadata: async value => { assert.equal(value, customPaths); customEvents.push('read'); return customRows; },
    resolveContainedPath: (root, file) => { assert.equal(root, customPaths.mods); return file; },
    assertWorldResetPlainPath: async (root, file) => {
      assert.equal(root, customPaths.root); assert.equal(file, path.join(customPaths.mods, customRow.file)); customEvents.push('path-guard');
    },
    fileMatchesExpectedHash: async () => { customEvents.push('hash'); return validCustomHash; },
    writeCustomAntiCheatMetadata: async (value, rows) => { assert.equal(value, customPaths); customRows = rows; customEvents.push('metadata'); },
    invalidateCachedWork: () => {}, serverProcess: null
  });
  vm.runInContext(section('async function removeCustomAntiCheat(', 'async function findBundledAntiCheatArtifact('), customRuntime);
  await assert.rejects(customRuntime.removeCustomAntiCheat(customRow.id, customPaths, async () => {
    customEvents.push('revalidate'); throw new Error('selected profile changed');
  }), /selected profile changed/);
  assert.equal(customEvents.includes('remove'), false);
  customEvents.length = 0;
  validCustomHash = false;
  await assert.rejects(customRuntime.removeCustomAntiCheat(customRow.id, customPaths), /changed after import/);
  assert.equal(customEvents.includes('remove'), false);
  customEvents.length = 0;
  validCustomHash = true;
  await customRuntime.removeCustomAntiCheat(customRow.id, undefined, async () => customEvents.push('revalidate'));
  assert.deepEqual(customEvents, ['state-lock', 'read', 'path-guard', 'hash', 'revalidate', 'path-guard', 'remove', 'metadata']);
  assert.equal(customRows.length, 0);

  let installs = 0;
  const refresh = vm.createContext({
    isBundledFabricProtectionAdapter: adapter => adapter?.id === 'fabric-26.2',
    normalizeServerType: value => value,
    getBundledProtectionAdapter: () => ({ id: 'fabric-26.2' }),
    isBundledProtectionRuntimeCompatible: () => true,
    getBundledProtectionJarPaths: () => ({ current: 'absent-removed-jar' }),
    inspectInstalledBundledProtection: async () => null,
    findBundledAntiCheatArtifact: async () => ({ sha256: 'b'.repeat(64), size: 123 }),
    readSecurityMetadata: async () => ({ installedBefore: true }),
    readBundledProtectionMetadataRecord: () => ({ file: 'ServerProtection-Fabric.jar', sha256: 'b'.repeat(64) }),
    installBundledAntiCheatUnlocked: async () => { installs++; throw new Error('Must not reinstall a removed artifact'); },
    appendServerLog: () => {}
  });
  vm.runInContext(refreshSource, refresh);
  const refreshed = await refresh.refreshManagedBundledProtectionBeforeStartUnlocked({
    profileSnapshot: profile, paths, serverConfig: { serverType: 'fabric', serverVersion: '26.2' },
    platform: { minecraftVersion: '26.2' }, revalidate: async () => {}
  });
  assert.equal(refreshed.reason, 'not-installed');
  assert.equal(refreshed.updated, false); assert.equal(installs, 0);
  console.log('PASS main anti-cheat console integration: guarded profile, scoped check patch, exact custom ID, pinned uninstall, preserved settings, no startup reinstall.');
})().catch(error => { console.error(error); process.exitCode = 1; });
