'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'minecraft-server', 'main.js');
const main = fs.readFileSync(mainPath, 'utf8');
const start = main.indexOf('function resumeSeamlessRestartPlayers(options = {})');
const end = main.indexOf('function silentRestartServer', start);
assert(start >= 0 && end > start);
const source = main.slice(start, end);

function rejection(result = 'main_unreachable', operation = 'ready', state = 'ARMED') {
  const error = new Error(result);
  error.code = 'SEAMLESS_RESTART_PROXY_REJECTED';
  error.event = { result, operation, state };
  return error;
}

function fixture(responses, onDelay) {
  let now = 1_000;
  const sent = [];
  const delays = [];
  const logs = [];
  const context = vm.createContext({
    seamlessResumePromise: null,
    seamlessRestartPromise: null,
    seamlessVelocityProcess: {},
    serverProcess: {},
    seamlessRuntimeProfileId: 'smp',
    seamlessMaintenanceArmed: true,
    SEAMLESS_RESTART_CONTROL_TIMEOUT_MS: 45_000,
    Date: { now: () => now },
    setTimeout: (callback, delay) => {
      delays.push(delay);
      now += delay;
      onDelay?.(context);
      queueMicrotask(callback);
    },
    hasChildExited: () => false,
    isServerRuntimeReady: () => true,
    buildMaintenanceCommand: action => `maintenance ${action}`,
    isMaintenanceReadyAcknowledgement: () => true,
    sendSeamlessVelocityControl: async (...args) => {
      sent.push(args);
      const response = responses[Math.min(sent.length - 1, responses.length - 1)];
      if (response instanceof Error) throw response;
      return response;
    },
    appendServerLog: message => logs.push(message)
  });
  vm.runInContext(source, context);
  return { context, sent, delays, logs, resume: () => context.resumeSeamlessRestartPlayers() };
}

async function test() {
  const ready = { operation: 'ready_complete', state: 'ACTIVE' };
  const recovering = fixture([rejection(), rejection(), ready]);
  assert.equal(await recovering.resume(), ready);
  assert.equal(recovering.sent.length, 3);
  assert.deepEqual(recovering.delays, [2_000, 2_000]);
  assert(recovering.sent.every(call => call[0] === 'maintenance off'));
  assert.equal(recovering.context.seamlessMaintenanceArmed, false);
  assert.equal(recovering.context.seamlessResumePromise, null);
  assert.equal(recovering.logs.filter(line => line.includes('returned')).length, 1);

  const exhausted = fixture([rejection()]);
  await assert.rejects(exhausted.resume(), /main_unreachable/);
  assert.equal(exhausted.sent.length, 16);
  assert.equal(exhausted.delays.reduce((sum, delay) => sum + delay, 0), 30_000);
  assert.equal(exhausted.context.seamlessMaintenanceArmed, true);
  assert.equal(exhausted.context.seamlessResumePromise, null);

  for (const error of [
    rejection('restore_failed', 'ready_complete'),
    rejection('main_unreachable', 'ready', 'ACTIVE'),
    Object.assign(new Error('timeout'), { code: 'SEAMLESS_RESTART_PROXY_TIMEOUT' })
  ]) {
    const failed = fixture([error]);
    await assert.rejects(failed.resume());
    assert.equal(failed.sent.length, 1, 'unknown/permanent outcomes must not repeat routing');
    assert.deepEqual(failed.delays, []);
    assert.equal(failed.context.seamlessMaintenanceArmed, true);
  }

  for (const field of ['serverProcess', 'seamlessVelocityProcess', 'seamlessRuntimeProfileId']) {
    const changed = fixture([rejection(), ready], context => { context[field] = {}; });
    await assert.rejects(changed.resume(), /changed/);
    assert.equal(changed.sent.length, 1, 'never resume into a replacement runtime');
    assert.equal(changed.context.seamlessMaintenanceArmed, true);
  }

  const restartSource = main.slice(end, main.indexOf('function isServerRuntimeReady', end));
  assert.match(restartSource, /resumeAttempted = true;\s+await resumeSeamlessRestartPlayers/);
  assert.match(restartSource, /isServerRuntimeReady\(\) && !resumeAttempted/,
    'the outer restart recovery must not repeat an exhausted resume operation');
  console.log('PASS bounded seamless resume retry, terminal errors, and runtime identity guards');
}

test().catch(error => { console.error(error); process.exitCode = 1; });
