'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const uiPath = path.join(root, 'minecraft-server-ui.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const uiText = fs.readFileSync(uiPath, 'utf8');
const descriptorIndexText = fs.readFileSync(path.join(root, 'minecraft-server', 'addon-descriptor-index.js'), 'utf8');
const source = `${mainText}\nmodule.exports.__toolLifecycleTest = {\n` +
  '  createSingleFlightCoordinator, runPlayitMutation, getBundledVoiceMinecraftVersion,\n' +
  '  isBundledVoiceClientCompatible, describeBundledVoiceRuntime, boundedPlayitOutputText,\n' +
  '  shutdownOwnedPlayitForQuit\n' +
  '};';

const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'tool-lifecycle-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
const sandbox = {
  module: moduleMock,
  exports: moduleMock.exports,
  __dirname: path.dirname(mainPath),
  __filename: mainPath,
  Buffer,
  URL,
  URLSearchParams,
  process,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  require: id => {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: mainPath });
const test = moduleMock.exports.__toolLifecycleTest;

assert.equal(test.isBundledVoiceClientCompatible('26.2'), true);
for (const version of ['26.1', '26.2.1', 'latest', 'custom', '', '1.21.11']) {
  assert.equal(test.isBundledVoiceClientCompatible(version), false, `${version || 'empty'} must not pass exact client compatibility`);
}
assert.equal(
  test.getBundledVoiceMinecraftVersion({ serverVersion: '26.1' }, { minecraftVersion: '26.2' }),
  '26.2',
  'the installed platform identity must win over a stale configured version'
);

const freshError = test.describeBundledVoiceRuntime({
  state: 'error', associatedClients: 0, lastError: 'UDP port is already in use'
}, true, 'running');
assert.match(freshError, /relay error: UDP port is already in use/);
assert.match(test.describeBundledVoiceRuntime({ state: 'disabled', associatedClients: 0, lastError: '' }, true, 'running'), /relay is disabled/);
assert.match(test.describeBundledVoiceRuntime({ state: 'stopped', associatedClients: 0, lastError: 'bind failed' }, true, 'running'), /stopped unexpectedly: bind failed/);
assert.match(test.describeBundledVoiceRuntime(null, false, 'running'), /not reporting current status/);
assert.match(test.describeBundledVoiceRuntime(null, false, 'stopped'), /Start the server/);

const teleportRemoveSource = mainText.slice(
  mainText.indexOf('function removeBundledTeleport()'),
  mainText.indexOf('function getBundledVoiceServerJarPath')
);
const voiceStatusSource = mainText.slice(
  mainText.indexOf('async function getBundledVoiceStatus'),
  mainText.indexOf('function installBundledVoice()')
);
const voiceRemoveSource = mainText.slice(
  mainText.indexOf('function removeBundledVoice()'),
  mainText.indexOf('async function inspectInstalledBundledProtection')
);
assert.doesNotMatch(teleportRemoveSource, /requireBundledTeleportRuntime/, 'managed TPA removal must not depend on the current platform');
assert.doesNotMatch(voiceRemoveSource, /requireBundledVoiceRuntime/, 'managed voice removal must not depend on the current platform/version');
assert.match(mainText, /canRemove: Boolean\(serverStopped && classification\.managed\)/,
  'verified managed removal should only require a stopped server');
assert.match(voiceStatusSource, /clientCompatible/);
assert.match(voiceStatusSource, /runtimeCompatible = relayCompatible && clientCompatible/);
assert.match(voiceStatusSource, /profileId,/);
assert.match(voiceStatusSource, /readJson\(paths\.config, DEFAULT_CONFIG\)/,
  'voice status must read the captured profile path without recreating another active profile');
assert.match(mainText, /getPluginDescriptorIndex\(paths\)/,
  'built-in status checks must share the profile plugin descriptor index');
assert.match(descriptorIndexText, /error\?\.code === 'ENOENT'[^\n]+files: \[\]/,
  'read-only descriptor scans must not recreate a deleted profile plugin directory');
const playitStartSource = mainText.slice(
  mainText.indexOf('async function startPlayitAgentUnlocked()'),
  mainText.indexOf('function stopPlayitAgent()')
);
const playitStopSource = mainText.slice(
  mainText.indexOf('function stopPlayitAgent()'),
  mainText.indexOf('async function getVersionManifest()')
);
const serverStartSource = mainText.slice(
  mainText.indexOf('function startServer(options'),
  mainText.indexOf('function getMissingStartSettings')
);
const quitSource = mainText.slice(
  mainText.indexOf('async function shutdownOwnedServerForQuit'),
  mainText.indexOf('function rememberEmbeddedSender')
);
const platformInstallSource = mainText.slice(
  mainText.indexOf('function installServerPlatform'),
  mainText.indexOf('async function downloadVanillaVersion')
);
const protectionInstallSource = mainText.slice(
  mainText.indexOf('function installBundledAntiCheat'),
  mainText.indexOf('function removeLegacyProtection')
);
const protectionRemoveSource = mainText.slice(
  mainText.indexOf('function removeLegacyProtection'),
  mainText.indexOf('function renderPaperAntiXrayBlock')
);
const customPlatformSource = mainText.slice(
  mainText.indexOf('async function selectServerJar()'),
  mainText.indexOf('async function importJarFiles')
);
const customAddonImportSource = mainText.slice(
  mainText.indexOf('async function importJarFiles'),
  mainText.indexOf('function deleteManagedJar')
);
const customAddonDeleteSource = mainText.slice(
  mainText.indexOf('function deleteManagedJar'),
  mainText.indexOf('function normalizeAddonKind')
);
assert.match(playitStartSource, /if \(status\.running\) return status/,
  'an already-running external Playit agent must prevent a duplicate spawn');
assert.ok((playitStartSource.match(/assertApplicationAllowsOwnedChildStart/g) || []).length >= 4,
  'Playit start must recheck the quit gate before work, after awaits, and immediately before spawn');
assert.match(playitStartSource, /attachBoundedPlayitOutput\(processRef\)/,
  'Playit stdout and stderr must use bounded asynchronous ingestion');
assert.match(playitStartSource, /if \(playitProcess === processRef\) playitProcess = null/,
  'a stale Playit exit handler must not clear a newer owned process');
assert.match(playitStopSource, /runPlayitMutation/,
  'Playit stop/start transitions must share the serialized mutation queue');
assert.match(playitStopSource, /await waitForChildExit\(processRef, 2500\)/,
  'Playit stop must await the captured owned child before another start can run');
assert.match(playitStopSource, /processRef\.kill\('SIGKILL'\)/,
  'a stuck app-owned Playit child must be force-stopped before another start can run');
assert.doesNotMatch(playitStopSource, /isPlayitProcessRunning|execPowershell/,
  'Playit stop must never discover and kill an arbitrary external process');
assert.match(playitStopSource, /const processRef = playitProcess;[\s\S]*processRef\.kill/,
  'Playit stop must target only the captured app-owned child reference');
assert.ok(serverStartSource.lastIndexOf("assertServerStartAllowed();") < serverStartSource.indexOf('processRef = await launchPersistentProcess('),
  'server start must check its lifecycle gate before spawn');
assert.ok(serverStartSource.lastIndexOf("assertServerStartAllowed();") > serverStartSource.indexOf('const args = await buildServerJavaArgs'),
  'server start must recheck its lifecycle gate after awaited preparation');
assert.match(mainText, /shutdownOwnedServerForQuit\(ownedServerProcess\)/,
  'before-quit cleanup must shut down the captured owned Java child');
assert.match(mainText, /shutdownOwnedPlayitForQuit\(ownedPlayitProcess\)/,
  'before-quit cleanup must shut down only the captured owned Playit child');
assert.ok(quitSource.indexOf('applicationQuitting = true') < quitSource.indexOf('const ownedServerProcess = serverProcess'),
  'the quit gate must close before owned-child snapshots are captured');
assert.match(quitSource, /shutdownOwnedPlayitForQuit[\s\S]*kill\('SIGKILL'\)/,
  'bounded quit cleanup must force-stop a captured Playit child after its grace period');
assert.match(quitSource, /shutdownOwnedChildrenForQuit[\s\S]*ownedServerProcess = serverProcess[\s\S]*ownedPlayitProcess = playitProcess/,
  'quit cleanup must recheck app-owned child references that appear after the initial snapshot');
assert.match(platformInstallSource, /platformInstallCoordinator\.run[\s\S]*serverToolMutationCoordinator\.run/,
  'platform replacement must serialize with profile and built-in tool mutations');
assert.match(platformInstallSource, /captureActiveServerToolProfile\('the server platform'\)/,
  'platform replacement must bind itself to the active profile');
assert.match(platformInstallSource, /getServerPlatformStatus\(nextConfig, paths\)/,
  'platform verification must stay on the captured profile paths');
assert.match(mainText, /beforeCommit: revalidate/,
  'a downloaded platform JAR must revalidate its profile and stopped state immediately before commit');
assert.match(protectionInstallSource, /serverToolMutationCoordinator\.run\('protection:install'/,
  'Server Protection install must serialize with starts and profile mutations');
assert.match(protectionInstallSource, /captureActiveServerToolProfile\('Server Protection'\)/,
  'Server Protection install must capture the target profile');
assert.match(protectionInstallSource, /const revalidate = typeof context\.revalidate === 'function'/,
  'Server Protection install must accept the start-owned profile gate without weakening manual installs');
assert.ok((protectionInstallSource.match(/await revalidate\(\)/g) || []).length >= 6,
  'Server Protection install must revalidate before staging, publishing, and committing its JAR');
assert.match(protectionInstallSource, /context\.expectedInstalled[\s\S]*latestInstalled\.sha256 !== expectedInstalledHash/,
  'automatic managed updates must compare-and-swap the same verified JAR immediately before publication');
assert.match(protectionInstallSource,
  /movePluginJarToDisabledBackup\(destination\)[\s\S]*claimedDestination\.sha256 !== expectedDestination\.sha256/,
  'the renamed JAR must be verified again as the atomic compare-and-swap claim');
assert.match(protectionInstallSource, /publishStagedFileIfAbsent\(temporary, destination\)/,
  'the verified replacement must publish without overwriting a raced-in destination');
assert.match(protectionInstallSource,
  /serializeProtectionStateTransaction\(paths\.root[\s\S]*installBundledAntiCheatTransactionUnlocked/,
  'installation must serialize with protection and player-access config mutations');
assert.match(mainText,
  /async function mutateProtectionConfigForPaths[\s\S]*serializeProtectionStateTransaction\(paths\.root/,
  'protection settings must share the per-profile installation transaction queue');
assert.match(mainText,
  /async function savePlayerAccess[\s\S]*serializeProtectionStateTransaction\(paths\.root/,
  'player-access settings must share the per-profile installation transaction queue');
assert.match(protectionInstallSource,
  /finally \{[\s\S]*fs\.rm\(temporary, \{ force: true \}\)[\s\S]*fs\.rm\(apiTemporary/,
  'all staged protection files must be cleaned after preparation, commit, or rollback failures');
assert.match(serverStartSource, /revalidateServerStartProfile[\s\S]*refreshManagedBundledProtectionBeforeStartUnlocked/,
  'startup-owned protection refresh must remain profile-bound while the start lock is held');
assert.match(protectionRemoveSource, /serverToolMutationCoordinator\.run\('protection:remove-legacy'/,
  'managed legacy protection removal must serialize with starts and profile mutations');
assert.match(protectionRemoveSource,
  /removeLegacyProtectionUnlocked[\s\S]*serializeProtectionStateTransaction\(paths\.root/,
  'legacy protection metadata removal must serialize with install and settings transactions');
assert.match(protectionRemoveSource, /revalidateServerToolProfile[\s\S]*fs\.rm\(file/,
  'managed protection removal must revalidate the captured profile before deleting a JAR');
assert.match(mainText,
  /async function applyAntiXray\(options[\s\S]*serializeProtectionStateTransaction\(paths\.root[\s\S]*applyAntiXrayTransactionUnlocked/,
  'Anti-Xray config and security metadata must commit inside one profile transaction');
assert.match(mainText,
  /async function applySecurityPreset[\s\S]*serializeProtectionStateTransaction\(paths\.root[\s\S]*readSecurityMetadata\(paths\)/,
  'security preset metadata must re-read and merge inside the profile transaction');
assert.match(mainText, /locallyPinnedCustom = Boolean[\s\S]*userApprovedPlatform === true/,
  'an explicitly selected custom Bukkit runtime must be integrity-pinned before bundled protection is offered');
assert.match(customPlatformSource, /calculateFileHash\(selected, 'sha256'\)[\s\S]*userApprovedPlatform: true/,
  'custom server selection must record a strong integrity pin and explicit platform approval');
assert.match(customPlatformSource, /serverToolMutationCoordinator\.run[\s\S]*revalidateServerToolProfile/,
  'custom server selection must serialize with starts and remain bound to its original profile');
assert.match(customAddonImportSource, /MAX_CUSTOM_ADDON_IMPORT_FILES[\s\S]*MAX_CUSTOM_ADDON_IMPORT_BYTES/,
  'custom add-on imports must cap both selection count and aggregate bytes');
assert.match(customAddonImportSource, /fs\.statfs\(targetDir\)[\s\S]*ADDON_IMPORT_DISK_RESERVE_BYTES/,
  'custom add-on imports must preserve a free-disk reserve when the platform exposes disk statistics');
assert.match(customAddonImportSource, /\.import-\$\{process\.pid\}[\s\S]*replaceFileAtomically/,
  'custom add-ons must be staged and atomically published instead of copied over live JARs');
assert.match(customAddonImportSource, /serverToolMutationCoordinator\.run[\s\S]*revalidateServerToolProfile/,
  'custom add-on imports must be stopped-only, serialized, and profile-bound');
assert.match(customAddonDeleteSource, /serverToolMutationCoordinator\.run[\s\S]*\.removing-\$\{process\.pid\}/,
  'custom add-on deletion must be serialized and use a recoverable quarantine step');

for (const [name, nextName] of [
  ['createProfile', 'switchProfile'],
  ['switchProfile', 'deleteProfile'],
  ['deleteProfile', 'renameProfile']
]) {
  const operationSource = mainText.slice(
    mainText.indexOf(`function ${name}(`),
    mainText.indexOf(`function ${nextName}(`)
  );
  assert.match(operationSource, /serverToolMutationCoordinator\.run\(`profile:/,
    `${name} must serialize with managed server-tool mutations`);
}

assert.doesNotMatch(uiText, /load(?:Voice|Teleport)AddonStatus|renderBundled(?:Voice|Teleport)Result/,
  'the add-ons page must not poll retired built-in promotion cards');
assert.match(uiText, /INSTALLED_ADDON_UPDATE_TTL_MS = 60_000/,
  'installed provider update results should be cached between routine status refreshes');
assert.match(uiText, /INSTALLED_ADDON_UPDATE_CONCURRENCY = 4/,
  'large modpacks must not launch unbounded provider requests');
assert.match(uiText, /installedAddonUpdateGeneration \+= 1/,
  'profile and add-on-kind changes must invalidate stale update requests');
assert.match(uiText, /api\.deleteJar\(kind, file\.name\)/,
  'every installed JAR must keep a normal removal path independent of update state');

(async () => {
  const playitOrder = [];
  let releasePlayit;
  const firstPlayit = test.runPlayitMutation(async () => {
    playitOrder.push('first-start');
    await new Promise(resolve => { releasePlayit = resolve; });
    playitOrder.push('first-end');
  });
  await new Promise(resolve => setImmediate(resolve));
  const secondPlayit = test.runPlayitMutation(async () => { playitOrder.push('second'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(playitOrder, ['first-start'], 'a second Playit mutation must wait for the owned transition');
  releasePlayit();
  await Promise.all([firstPlayit, secondPlayit]);
  assert.deepEqual(playitOrder, ['first-start', 'first-end', 'second']);

  const coordinator = test.createSingleFlightCoordinator('conflict');
  let release;
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const first = coordinator.run('voice:install', async () => {
    startedResolve();
    await new Promise(resolve => { release = resolve; });
    return 'done';
  });
  await started;
  assert.equal(coordinator.getActiveKey(), 'voice:install');
  assert.strictEqual(coordinator.run('voice:install', () => 'wrong'), first,
    'a repeated identical mutation should share its in-flight result');
  await assert.rejects(coordinator.run('profile:switch:other', () => 'wrong'), /conflict/,
    'a profile mutation must not enter while a tool mutation owns the coordinator');
  release();
  assert.equal(await first, 'done');
  assert.equal(coordinator.getActiveKey(), '');
  assert.equal(await coordinator.run('profile:switch:other', () => 'switched'), 'switched');

  const oversizedPlayit = test.boundedPlayitOutputText(Buffer.alloc(100_000, 0x61));
  assert.ok(oversizedPlayit.text.length <= 16 * 1024, 'Playit output chunks must be bounded before string parsing');
  assert.ok(oversizedPlayit.dropped > 0, 'oversized Playit output must report dropped input');

  const stubbornPlayit = new EventEmitter();
  stubbornPlayit.exitCode = null;
  stubbornPlayit.signalCode = null;
  const killSignals = [];
  stubbornPlayit.kill = (signal = 'SIGTERM') => {
    killSignals.push(signal);
    if (signal === 'SIGKILL') {
      setImmediate(() => {
        stubbornPlayit.signalCode = signal;
        stubbornPlayit.emit('exit', null, signal);
      });
    }
    return true;
  };
  const keepAlive = setTimeout(() => {}, 100);
  await test.shutdownOwnedPlayitForQuit(stubbornPlayit, 5, 25);
  clearTimeout(keepAlive);
  assert.deepEqual(killSignals, ['SIGTERM', 'SIGKILL'],
    'quit cleanup must give only the captured Playit child a grace period before force-killing it');
  console.log('PASS managed server-tool lifecycle and voice status guards');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
