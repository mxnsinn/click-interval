'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const main = fs.readFileSync(mainPath, 'utf8');
const consoleSource = fs.readFileSync(path.join(root, 'server-console.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(root, 'build-development-update.ps1'), 'utf8');

function block(startMarker, endMarker) {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Missing integration block: ${startMarker}`);
  return main.slice(start, end);
}

const propertyWriter = block('async function writeServerProperties', 'async function readWorldSavedVersion');
assert.match(propertyWriter, /backendBehindProxy \? seamless\.backendHost : config\.bindIp/);
assert.match(propertyWriter, /backendBehindProxy \? seamless\.backendPort : config\.port/);
assert.match(propertyWriter, /'enable-query': backendBehindProxy \|\| config\.localOnly \? false/);
const configWriter = block('async function writeConfig', 'function serializeDeathLootRuntimeConfig');
assert.match(configWriter, /allowSeamlessRestartMutation !== true/);
assert.match(configWriter, /source\.seamlessRestart = current\.seamlessRestart/,
  'ordinary stale config writers must preserve transaction-owned seamless state under the file lock');

const startup = block('async function startServerOperationInternal', 'function getMissingStartSettings');
const sidecarsAt = startup.indexOf('startSeamlessRestartSidecars');
const javaSpawnAt = startup.indexOf('processRef = await launchPersistentProcess');
assert(sidecarsAt >= 0 && javaSpawnAt > sidecarsAt,
  'the maintenance stack must be ready before the Fabric backend starts');
assert.match(startup, /seamlessRuntime\.config\.backendPort/,
  'backend readiness must probe the loopback backend, not the public proxy');
const startupWrapper = block('async function startServerOperation(options = {}, request = null)', 'async function startServerOperationInternal');
assert.match(startupWrapper, /seamlessRuntimeProfileId && !seamlessMaintenanceArmed/,
  'a failed retry must never kill the holding stack while players are parked');
assert.match(startup, /recoverInterruptedSeamlessRestartTransaction\(paths, config, profile\.id\)/,
  'startup must recover an interrupted setup/disable transaction before Java can run');
assert.match(startup, /readConfiguredRconPort\(paths, config\)/,
  'startup must reject a seamless topology that collides with enabled RCON');

const silentRestart = block('function silentRestartServer', 'function isServerRuntimeReady');
const saveAt = silentRestart.indexOf('save-all flush');
const armAt = silentRestart.indexOf("buildMaintenanceCommand('on'");
const stopAt = silentRestart.indexOf('stopServerAndWait');
const startAt = silentRestart.indexOf('startServer({');
const resumeAt = silentRestart.indexOf('resumeSeamlessRestartPlayers', startAt);
assert(saveAt >= 0 && armAt > saveAt && stopAt > armAt && startAt > stopAt && resumeAt > startAt,
  'safe restart order must save, park, stop, start, then restore');
assert.match(silentRestart, /isMaintenanceArmedAcknowledgement/,
  'Minecraft must not stop before the proxy confirms every player is parked');
assert.match(silentRestart, /Could not fully undo the canceled player drain/,
  'a partial/failed drain must restore already parked players while the backend is still alive');
assert.match(silentRestart, /preserveSeamless: true/,
  'the proxy and holding server must survive the backend stop');
assert.match(silentRestart, /requireGraceful: true/,
  'managed updates must not force-kill an unfinished world save');
assert(silentRestart.indexOf('getPendingModQueueStatus') < armAt &&
  silentRestart.indexOf('evaluateSeamlessRestartPreparationMemory') < armAt,
  'artifact and memory preparation must happen before players are parked');
assert(silentRestart.indexOf('assertSeamlessRestartBackendExited', stopAt) < startAt,
  'the old backend PID must be confirmed gone before replacement launch');
assert.match(startup, /assertSeamlessRestartTarget\(restart\.target/,
  'the replacement must retain the same profile directory and world');
assert.match(startup, /validateManagedRestartLaunch\(\);[\s\S]*processRef = await launchPersistentProcess/,
  'world and old-backend ownership must be checked at launch');
assert.match(startup, /isSeamlessRestartReadinessSource\(source, Boolean\(options\.seamlessRestartRequest\)\)/,
  'managed replacements must not accept early socket readiness before the Done marker');
assert.match(startup, /stopServer\(options\.seamlessRestartRequest[\s\S]*preserveSeamless: true/,
  'a replacement startup timeout must preserve the holding lobby');
assert.match(startup, /datapackLoadFailed && !safeMode && !intentionalStop && !options\.seamlessRestartRequest/,
  'failed update loading must not silently retry by dropping custom datapacks');
assert.match(startup, /pendingSidecarMemoryMb = seamlessSidecarMemoryReserveMb/,
  'startup memory must account for reused sidecars instead of reserving their whole heaps again');
assert(silentRestart.indexOf('options.prepareUpdate(updateContext)') < armAt,
  'internal update preparation runs while the original world is playable');
const publishAt = silentRestart.indexOf('preparedUpdate.publish(updateContext)');
assert(publishAt > stopAt && publishAt < startAt,
  'transaction publication must be owned by the stopped-backend boundary');
assert.match(main, /seamlessRestartPromise && options\?\.seamlessRestartRequest\?\.owner !== seamlessRestartOwner/,
  'ordinary Start cannot race managed publication with a second backend');
assert.match(silentRestart, /!atStoppedBoundary \|\| pendingServerStart/,
  'a new pending startup invalidates stopped-boundary publication');

const stop = block('function stopServer(options = {})', 'async function stopServerAndWait');
assert.match(stop, /options\?\.preserveSeamless !== true/,
  'ordinary Stop must clean up sidecars while silent restart may preserve them');
assert.match(stop, /serverProcess === processRef && options\.requireGraceful !== true/,
  'a graceful-only timeout must not mark the stopping old backend ready again');

const command = block('async function runAssemblyConsoleCommand', 'async function saveConfigAndApply');
assert.match(command, /command === 'silent-restart'/);
assert.match(command, /setupSeamlessRestart\(\)/);
assert.match(command, /disableSeamlessRestart\(\)/);
assert.match(consoleSource, /'silent-restart'/);
assert.match(consoleSource, /\/silent-restart setup/);
const configSave = block('async function saveConfigAndApply', 'async function setUiMode');
assert.match(configSave, /serverToolMutationCoordinator\.run\(mutationKey/,
  'settings and console set writes must serialize against setup/disable transactions');

assert.match(main, /shutdownOwnedSeamlessSidecarForQuit/,
  'app shutdown must not orphan Velocity or NanoLimbo');
assert.match(main, /reuseExisting: reuseOriginalBackups/,
  'an installed setup rerun must preserve the genuine original backend-file backups');
const setupTransaction = block('async function setupSeamlessRestart', 'async function disableSeamlessRestart');
assert(setupTransaction.indexOf("state: 'preparing'") < setupTransaction.indexOf('await writeTextAtomically(destination'),
  'the durable preparing journal must be committed before the first managed-file mutation');
assert.match(setupTransaction, /isInstalledSeamlessRestartMetadata\(previousMetadata, profile\.id\)/,
  'only complete same-profile installed provenance may reuse original backups');
assert.match(setupTransaction, /restoreOriginalSeamlessRestartBackendFiles\(paths, originalBackendFiles\)/,
  'every post-journal setup failure must restore the original backend files');
assert.match(setupTransaction, /if \(!rollbackErrors\.length\) \{[\s\S]*state: 'disabled'/,
  'a failed rollback must retain the recoverable transaction journal instead of committing disabled');
assert(setupTransaction.indexOf('await writeConfig(candidate, paths)') <
  setupTransaction.indexOf('await writeJsonAtomically(paths.seamlessRestartMetadata, metadata)'),
  'installed provenance must be published only after enabled config commits');
const disableTransaction = block('async function disableSeamlessRestart', 'async function readWorldSavedVersion');
assert(disableTransaction.indexOf("state: 'disabling'") < disableTransaction.indexOf('restoreOriginalSeamlessRestartBackendFiles'),
  'disable must journal its recovery state before restoring either backend file');
assert.match(main, /FabricProxy-Lite rewrites its TOML formatting/,
  'the mutable FabricProxy-Lite config must use semantic rather than byte-for-byte validation');
assert.match(main, /function assertOriginalSeamlessRestartBackendFileProvenance/,
  'rollback provenance must be shape-validated before it can remove or restore backend files');
assert.match(main, /did not exit after stop and forced termination/,
  'sidecars that survive forced termination must retain their handles and fail closed');
assert.match(main, /let seamlessResumePromise = null/);
assert.match(silentRestart, /if \(seamlessResumePromise\)/,
  'a restart must not race a manual resume control operation');
for (const directory of [
  'minecraft-server\\click-interval-restart-proxy\\.gradle',
  'minecraft-server\\click-interval-restart-proxy\\build'
]) {
  assert(buildSource.includes(`'${directory}'`), `release must exclude ${directory}`);
}

const coordinator = path.join(
  root,
  'minecraft-server',
  'click-interval-restart-proxy',
  'dist',
  'ClickIntervalRestartProxy-1.0.1.jar'
);
const bytes = fs.readFileSync(coordinator);
assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'bundled coordinator must be a JAR/ZIP');
assert.equal(
  crypto.createHash('sha256').update(bytes).digest('hex'),
  '7ece562d608edc1e8ea808d48dba36f682ccabf61229b150fb9ba2cf635f2895'
);

console.log('PASS seamless restart integration and packaging guards');
