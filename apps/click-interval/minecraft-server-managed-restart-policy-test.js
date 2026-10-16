'use strict';

// Executes the production managed-restart function against inert lifecycle
// doubles. No JVM, files, ports, live profiles or UI are created/touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('./minecraft-server/seamless-restart-runtime');
const main = fs.readFileSync(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');
const start = main.indexOf('function silentRestartServer(');
const end = main.indexOf('\nfunction isServerRuntimeReady(', start);
assert(start > 0 && end > start);

function scenario(overrides = {}) {
  const events = [];
  const old = { pid: 1234, exitCode: null, signalCode: null };
  const profile = { id: 'SMP' };
  const config = { serverType: 'fabric', serverVersion: '26.2', jarPath: 'test.jar', levelName: 'world' };
  const root = path.resolve(__dirname, 'work', 'inert-restart-profile');
  const sandbox = {
    ...runtime, Promise, Object, Error, TypeError, Date, Boolean, Number, String,
    setTimeout: callback => { callback(); return 0; },
    seamlessRestartPromise: null, seamlessRestartOwner: null, seamlessResumePromise: null,
    pendingAnnouncedServerShutdown: null, pendingServerStart: null,
    serverProcess: old, seamlessVelocityProcess: { pid: 2345 }, seamlessLimboProcess: { pid: 3456 },
    seamlessRuntimeProfileId: 'SMP', seamlessMaintenanceArmed: false, seamlessFabricProxyLiteLoaded: true,
    PENDING_SMP_MOD_MANIFEST: 'inert-manifest', SEAMLESS_RESTART_CONTROL_TIMEOUT_MS: 1,
    fs: { access: async () => events.push('jar-verified') },
    os: { totalmem: () => 32768 * 1024 * 1024, freemem: () => 1500 * 1024 * 1024 },
    getActiveProfile: async () => profile,
    getPathsForProfile: () => ({ root }), readConfig: async () => config,
    validateWorldName: name => name,
    inspectJarDescriptor: async () => ({ fabricModId: 'test', fabricVersion: '1' }),
    getServerPlatformStatus: async () => ({ type: 'fabric', minecraftVersion: '26.2' }),
    resolveJava: async () => ({ available: true, major: 25 }),
    getSeamlessRestartInspection: async () => ({ config: { enabled: true }, status: { canSilentRestart: true },
      holding: { enabled: true, ready: true, type: 'fabric', memoryMb: 1024 },
      runtime: { velocityRunning: true, limboRunning: true } }),
    normalizeServerType: text => text, normalizeAddonVersion: text => text,
    isRegularFile: async () => true,
    getPendingModQueueStatus: async () => { events.push('queue-verified'); return { ok: true }; },
    getProtectionConfig: async () => ({}), getBundledProtectionAdapter: () => ({}),
    isFabricPacketAntiXrayConfigured: () => true,
    planMinecraftStartupResources: () => ({ requiredMemoryMb: 8192 }),
    isServerRuntimeReady: () => Boolean(sandbox.serverProcess && sandbox.serverProcess.exitCode == null),
    hasChildExited: child => !child || child.exitCode != null,
    processExists: pid => pid === old.pid && old.exitCode == null,
    appendServerLog: text => events.push(`log:${text}`),
    tryWriteServerInput: (_child, command) => { events.push(command); return true; },
    sendSeamlessVelocityControl: async () => { events.push('park'); return {}; },
    stopServerAndWait: async options => {
      assert.equal(options.requireGraceful, true);
      assert.strictEqual(options.seamlessRestartOwner, sandbox.seamlessRestartOwner);
      events.push('stop'); old.exitCode = 0; sandbox.serverProcess = null;
    },
    startServer: async options => {
      assert.equal(old.exitCode, 0);
      assert.strictEqual(options.seamlessRestartRequest.owner, sandbox.seamlessRestartOwner);
      events.push('start'); sandbox.serverProcess = { pid: 4567, exitCode: null }; return { ready: true };
    },
    resumeSeamlessRestartPlayers: async () => { events.push('resume'); sandbox.seamlessMaintenanceArmed = false; },
    ...overrides
  };
  vm.createContext(sandbox);
  vm.runInContext(main.slice(start, end), sandbox);
  return { events, old, sandbox, config, profile };
}

(async () => {
  const success = scenario();
  let captured;
  const first = success.sandbox.silentRestartServer('Test', { prepareUpdate: async context => {
    captured = context;
    assert.equal(context.previousPid, 1234);
    assert.equal(typeof context.inspectJar, 'function');
    await assert.rejects(context.assertStoppedBoundary(), /outside/);
    success.events.push('prepare');
    return { publish: async () => {
      await context.assertStoppedBoundary();
      success.events.push('publish');
    } };
  } });
  assert.strictEqual(success.sandbox.silentRestartServer('duplicate'), first, 'duplicate restarts share one lifecycle');
  assert.equal((await first).playersReconnected, true);
  const order = success.events.filter(event => ['queue-verified', 'prepare', 'save-all flush', 'park', 'stop', 'publish', 'start', 'resume'].includes(event));
  assert.deepEqual(order, ['queue-verified', 'prepare', 'save-all flush', 'park', 'stop', 'publish', 'start', 'resume']);
  await assert.rejects(captured.assertStoppedBoundary(), /outside/);
  assert.equal(success.sandbox.seamlessRestartOwner, null);

  const failedPreparation = scenario();
  await assert.rejects(failedPreparation.sandbox.silentRestartServer('Test', { prepareUpdate: async () => {
    throw new Error('untrusted update');
  } }), /untrusted update/);
  assert.equal(failedPreparation.events.includes('park'), false);
  assert.equal(failedPreparation.events.includes('stop'), false);

  const failedPublication = scenario();
  await assert.rejects(failedPublication.sandbox.silentRestartServer('Test', { prepareUpdate: async () => ({
    publish: async () => { throw new Error('publication failed'); }
  }) }), /publication failed/);
  assert.equal(failedPublication.events.includes('start'), false);
  assert.equal(failedPublication.events.includes('resume'), false);
  assert.equal(failedPublication.sandbox.seamlessMaintenanceArmed, true);

  const slowSave = scenario({ stopServerAndWait: async () => { throw new Error('still saving'); } });
  await assert.rejects(slowSave.sandbox.silentRestartServer('Test'), /still saving/);
  assert.equal(slowSave.events.includes('resume'), false, 'never restore players after native stop was requested');
  assert.equal(slowSave.events.includes('start'), false);
  assert.equal(slowSave.sandbox.seamlessMaintenanceArmed, true);

  const pidStillAlive = scenario({ processExists: () => true });
  await assert.rejects(pidStillAlive.sandbox.silentRestartServer('Test'), /second world server/);
  assert.equal(pidStillAlive.events.includes('start'), false);

  const changedWorld = scenario();
  await assert.rejects(changedWorld.sandbox.silentRestartServer('Test', { prepareUpdate: async () => {
    changedWorld.config.levelName = 'another-world'; return { publish: async () => {} };
  } }), /world changed/);
  assert.equal(changedWorld.events.includes('park'), false);

  const pendingStart = scenario();
  await assert.rejects(pendingStart.sandbox.silentRestartServer('Test', { prepareUpdate: async context => ({
    publish: async () => {
      pendingStart.sandbox.pendingServerStart = {};
      await context.assertStoppedBoundary();
    }
  }) }), /outside/);
  assert.equal(pendingStart.events.includes('start'), false);
  console.log('PASS managed restart transaction ordering, stopped-boundary ownership and failure recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
