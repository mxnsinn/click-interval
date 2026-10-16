'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const consoleText = fs.readFileSync(path.join(root, 'server-console.js'), 'utf8');
const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const source = `${mainText}\nmodule.exports.__lifecycleResilienceTest = {\n` +
  '  hasChildExited, waitForChildExit, stopOwnedServerProcess, recoverServerStateAfterFailedStop,\n' +
  '  assertServerStartContinues, startServer, stopServer,\n' +
  '  setLifecycle(processRef, state, readyGeneration, generation) {\n' +
  '    serverProcess = processRef; serverState = state;\n' +
  '    serverReadyGeneration = readyGeneration; serverLifecycleGeneration = generation;\n' +
  '  },\n' +
  '  setPreparingStart(request) { serverProcess = null; serverState = "starting"; pendingServerStart = request; },\n' +
  '  getState() { return serverState; },\n' +
  '  hasPendingStart() { return Boolean(pendingServerStart); },\n' +
  '  clearPreparingStart() { pendingServerStart = null; }\n' +
  '};';

const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'lifecycle-resilience-unused'), on: () => {} },
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
  setImmediate,
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
const lifecycle = moduleMock.exports.__lifecycleResilienceTest;

function childProcessDouble() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write: (_value, callback) => {
      callback?.();
      return true;
    }
  };
  return child;
}

assert.match(mainText, /const request = \{ canceled: false \}/,
  'startup must expose a cancelable pre-spawn request');
assert.match(mainText, /startRequest\.canceled = true;[\s\S]*setState\('stopping'\)[\s\S]*serverStartCoordinator\.run\('start'/,
  'Stop must cancel preparation and wait for its bounded side effects to settle');
assert.match(mainText, /pendingServerStart\?\.canceled[\s\S]*previous startup is still canceling/,
  'a new start must fail promptly instead of joining a canceled preparation task');
assert.match(mainText, /Promise\.allSettled\(\[\.\.\.protectionIncidentQueues\.keys\(\)\]/,
  'incident persistence must not delay delivery of the Java stop command');
assert.match(mainText, /processRef\.kill\('SIGKILL'\)/,
  'a graceful-stop timeout must escalate to a forceful stop');
assert.match(mainText, /setState\(recoverServerStateAfterFailedStop\(processRef\)\)/,
  'a failed force-stop must leave the UI in a retryable state');
assert.match(mainText, /function stopServer\(options = \{\}\) \{[\s\S]*cancelPendingServerRestart\(\);[\s\S]*if \(serverStopPromise\) return serverStopPromise/,
  'an explicit Stop must cancel a pending restart even when it joins an existing stop');
assert.match(mainText, /await stopServerAndWait\(\{ preserveRestart: true \}\);[\s\S]*if \(request\.canceled\) return \{ state: 'stopped', canceled: true \}/,
  'Restart must re-check its cancel token after the owned child finishes stopping');
assert.match(mainText, /function scheduleSafeModeRetry\(context\)[\s\S]*serverLifecycleGeneration !== retry\.generation[\s\S]*profile\?\.id !== retry\.profileId/,
  'safe-mode recovery must stay bound to the failed lifecycle and server profile');
assert.match(mainText, /serverProcessFinalizers\.get\(processRef\)[\s\S]*finalizeProcess\(processRef\.exitCode/,
  'the silent-exit fallback must execute the real process finalizer so startup promises settle');
assert.match(mainText, /retryReadyPlayerSpectateRecovery\(lifecycleContext\)[\s\S]*revalidateServerLifecycleContext\(lifecycleContext\)[\s\S]*readConfig\(paths\)/,
  'ready-time recovery and configuration work must be pinned to the spawned process and profile');
assert.match(mainText, /webContents\.on\('did-finish-load',[\s\S]*webContents\.send\('server:state', serverState\)/,
  'a newly loaded console must receive the current lifecycle state even if it opened mid-start');
assert.match(consoleText, /\(!running && !starting\) \|\| stopping/,
  'the console Stop button must remain usable while Minecraft starts');
assert.match(consoleText, /stateEventVersion === initialStateEventVersion/,
  'console hydration must not overwrite a newer pushed lifecycle state');
assert.match(consoleText, /setState\(action === 'start' \? 'starting' : 'stopping'\)/,
  'console lifecycle controls must acknowledge the click immediately');
assert.match(consoleText, /await api\.getStatus\(\)\.catch\(\(\) => null\)/,
  'console lifecycle controls must reconcile their optimistic state if no push event arrives');
assert.match(uiText, /finally \{[\s\S]*await refresh\(true\)\.catch\(\(\) => \{\}\)/,
  'the overview must refresh after successful and failed lifecycle commands');
assert.match(uiText, /applyImmediateServerState\(stopping \? 'stopping' : 'starting'\)[\s\S]*?await refresh\(true\)\.catch/,
  'the overview Start control must react immediately and force a fresh status after completion');
assert.match(uiText, /serverStateEventVersion !== requestedAtStateVersion && latestServerState/,
  'an older status response must not overwrite a newer pushed lifecycle state');

(async () => {
  const preparingRequest = { canceled: false };
  lifecycle.setPreparingStart(preparingRequest);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await lifecycle.stopServer())),
    { state: 'stopped', canceledStart: true }
  );
  assert.equal(preparingRequest.canceled, true);
  assert.equal(lifecycle.getState(), 'stopped');
  lifecycle.clearPreparingStart();

  lifecycle.setLifecycle(null, 'stopped', 0, 0);
  const immediateStart = lifecycle.startServer();
  const immediateStop = await lifecycle.stopServer();
  const canceledStart = await immediateStart;
  assert.equal(immediateStop.canceledStart, true);
  assert.equal(canceledStart.canceled, true,
    'a Stop arriving before the startup worker begins must still settle Start as canceled');
  assert.equal(lifecycle.hasPendingStart(), false,
    'an immediate cancellation must release the pending-start gate');

  const racedChild = childProcessDouble();
  const originalOnce = racedChild.once;
  let changedDuringAttachment = false;
  racedChild.once = function once(event, listener) {
    const result = originalOnce.call(this, event, listener);
    if (event === 'exit' && !changedDuringAttachment) {
      changedDuringAttachment = true;
      this.exitCode = 0;
    }
    return result;
  };
  assert.equal(await lifecycle.waitForChildExit(racedChild, 25), true,
    'an exit between the first state check and listener attachment must not wait for the timeout');
  assert.equal(racedChild.listenerCount('exit'), 0);
  assert.equal(racedChild.listenerCount('close'), 0);

  const gracefulChild = childProcessDouble();
  let gracefulInput = '';
  gracefulChild.stdin.write = (value, callback) => {
    gracefulInput += value;
    gracefulChild.exitCode = 0;
    callback?.();
    return true;
  };
  gracefulChild.kill = () => { throw new Error('graceful exit must not be killed'); };
  assert.equal(await lifecycle.stopOwnedServerProcess(gracefulChild, 5, 5), true);
  assert.equal(gracefulInput, 'stop\n');

  const slowSavingChild = childProcessDouble();
  slowSavingChild.kill = () => { throw new Error('managed restart must never force-kill an unfinished world save'); };
  const gracefulOnlyKeepAlive = setTimeout(() => {}, 100);
  assert.equal(await lifecycle.stopOwnedServerProcess(slowSavingChild, 3, 3, { requireGraceful: true }), false,
    'managed restart stops the sequence when a graceful save/exit has not completed');
  clearTimeout(gracefulOnlyKeepAlive);
  assert.equal(slowSavingChild.signalCode, null);

  const managedSilentExit = childProcessDouble();
  managedSilentExit.stdin.write = (_value, callback) => {
    managedSilentExit.exitCode = 0;
    callback?.();
    return true;
  };
  lifecycle.setLifecycle(managedSilentExit, 'running', 11, 11);
  const firstManagedStop = lifecycle.stopServer();
  const joinedManagedStop = lifecycle.stopServer();
  assert.strictEqual(joinedManagedStop, firstManagedStop,
    'concurrent Stop requests must share one owned-child transition');
  await firstManagedStop;
  assert.equal(lifecycle.getState(), 'stopped');

  const forcedChild = childProcessDouble();
  const killSignals = [];
  forcedChild.kill = signal => {
    killSignals.push(signal);
    forcedChild.signalCode = signal;
    setImmediate(() => forcedChild.emit('exit', null, signal));
    return true;
  };
  const keepAlive = setTimeout(() => {}, 100);
  assert.equal(await lifecycle.stopOwnedServerProcess(forcedChild, 5, 20), true);
  clearTimeout(keepAlive);
  assert.deepEqual(killSignals, ['SIGKILL']);

  const stubbornChild = childProcessDouble();
  stubbornChild.kill = () => false;
  const stubbornKeepAlive = setTimeout(() => {}, 100);
  assert.equal(await lifecycle.stopOwnedServerProcess(stubbornChild, 3, 3), false,
    'a child that survives both deadlines must settle as a failure instead of hanging forever');
  clearTimeout(stubbornKeepAlive);
  lifecycle.setLifecycle(stubbornChild, 'stopping', 0, 7);
  assert.equal(lifecycle.recoverServerStateAfterFailedStop(stubbornChild), 'starting');
  lifecycle.setLifecycle(stubbornChild, 'stopping', 7, 7);
  assert.equal(lifecycle.recoverServerStateAfterFailedStop(stubbornChild), 'running');

  assert.throws(
    () => lifecycle.assertServerStartContinues({ canceled: true }),
    error => error?.code === 'SERVER_START_CANCELED'
  );

  console.log('PASS Minecraft server lifecycle race and recovery guards');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
