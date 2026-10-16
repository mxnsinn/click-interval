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
const source = `${mainText}\nmodule.exports.__announcedShutdownTest = {\n` +
  '  parseAnnouncedServerShutdownArgs, formatAnnouncedServerShutdownText,\n' +
  '  getAnnouncedServerShutdownStatus, requestAnnouncedServerShutdown, cancelPendingAnnouncedServerShutdown,\n' +
  '  setRunningProcess(processRef) {\n' +
  '    serverProcess = processRef; serverState = "running"; serverLifecycleGeneration = 41; serverReadyGeneration = 41;\n' +
  '    serverStopPromise = null; pendingAnnouncedServerShutdown = null; stopRequestedGeneration = 0;\n' +
  '  },\n' +
  '  getState() { return serverState; }\n' +
  '};';

const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'announced-shutdown-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
  powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
let clockOffsetMs = 0;
const controlledTimers = [];
class ControlledDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [Date.now() + clockOffsetMs]));
  }

  static now() {
    return Date.now() + clockOffsetMs;
  }
}
function controlledSetTimeout(callback, delay, ...args) {
  const delayMs = Math.max(0, Number(delay) || 0);
  if (delayMs > 1000) {
    const timer = {
      callback: () => callback(...args),
      delayMs,
      canceled: false,
      unref() {}
    };
    controlledTimers.push(timer);
    return timer;
  }
  return setTimeout(callback, delayMs, ...args);
}
function controlledClearTimeout(timer) {
  if (timer && controlledTimers.includes(timer)) {
    timer.canceled = true;
    return;
  }
  clearTimeout(timer);
}
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
  Date: ControlledDate,
  setImmediate,
  setTimeout: controlledSetTimeout,
  clearTimeout: controlledClearTimeout,
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
const shutdown = moduleMock.exports.__announcedShutdownTest;

function serverProcessDouble() {
  const child = new EventEmitter();
  const writes = [];
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = {
    writable: true,
    destroyed: false,
    writableEnded: false,
    write(value, callback) {
      writes.push(value);
      if (value === 'stop\n') child.exitCode = 0;
      callback?.();
      return true;
    }
  };
  child.kill = () => { throw new Error('test server should stop gracefully'); };
  return { child, writes };
}

assert.deepEqual(
  JSON.parse(JSON.stringify(shutdown.parseAnnouncedServerShutdownArgs(['30', 'Update', 'ready']))),
  { countdownSeconds: 30, message: 'Update ready' }
);
assert.equal(
  shutdown.parseAnnouncedServerShutdownArgs(['5', 'line one\nstop']).message,
  'line one stop',
  'control characters must not be able to inject another server-console command'
);
assert.throws(() => shutdown.parseAnnouncedServerShutdownArgs(['601', 'too long']), /0 to 600 seconds/);
assert.throws(() => shutdown.parseAnnouncedServerShutdownArgs(['-1', 'invalid']), /0 to 600 seconds/);
assert.throws(() => shutdown.parseAnnouncedServerShutdownArgs(['1.5', 'invalid']), /whole number/);
assert.throws(
  () => shutdown.parseAnnouncedServerShutdownArgs(['0', 'x'.repeat(241)]),
  /240 characters or fewer/
);
assert.equal(shutdown.formatAnnouncedServerShutdownText(1, 'Save your work.'),
  'Server shutting down in 1 second. Save your work.');
assert.equal(shutdown.formatAnnouncedServerShutdownText(0, ''), 'Server shutting down now.');

assert.match(mainText, /SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS = 10 \* 60/,
  'announced shutdowns need a hard upper bound');
assert.match(mainText, /tellraw @a \$\{component\}/,
  'shutdown notices must use a JSON chat component instead of interpolated raw commands');
assert.match(mainText, /if \(command === 'stop' \|\| command === 'shutdown'\)/,
  'both console spellings should reach the safe shutdown manager');
assert.match(consoleText, /'stop', 'shutdown'/,
  'stop arguments and shutdown commands must route through the app command handler');
assert.match(consoleText, /\/shutdown 30 /,
  'the console should advertise the announced shutdown syntax');

(async () => {
  const delayed = serverProcessDouble();
  shutdown.setRunningProcess(delayed.child);
  const scheduled = await shutdown.requestAnnouncedServerShutdown({
    countdownSeconds: 30,
    message: 'Maintenance\nplease reconnect later.'
  });
  assert.equal(scheduled.scheduled, true);
  assert.equal(shutdown.getAnnouncedServerShutdownStatus().pending, true);
  assert.equal(delayed.writes.length, 1, 'scheduling should emit one initial announcement');
  assert.equal(delayed.writes[0].split('\n').length, 2,
    'a hostile newline in the message must not create a second console command');
  assert.match(delayed.writes[0], /^tellraw @a \{"text":"Server shutting down in 30 seconds\./);
  assert.equal(shutdown.cancelPendingAnnouncedServerShutdown({ log: false }), true);
  assert.equal(shutdown.getAnnouncedServerShutdownStatus().pending, false);
  assert.equal(delayed.writes.some(value => value === 'stop\n'), false,
    'canceling a countdown must not stop the server');

  const immediate = serverProcessDouble();
  shutdown.setRunningProcess(immediate.child);
  const immediateStop = shutdown.requestAnnouncedServerShutdown({
    countdownSeconds: 0,
    message: 'Time to sleep.'
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(immediate.writes[0], /^tellraw @a /);
  assert.equal(immediate.writes.some(value => value === 'stop\n'), false,
    'the final chat packet needs an output turn before the server stop command');
  const stopped = await immediateStop;
  assert.equal(stopped.state, 'stopped');
  assert.equal(immediate.writes.at(-1), 'stop\n');
  assert.equal(shutdown.getState(), 'stopped');

  const overdue = serverProcessDouble();
  shutdown.setRunningProcess(overdue.child);
  const overdueScheduled = await shutdown.requestAnnouncedServerShutdown({
    countdownSeconds: 30,
    message: 'Maintenance.'
  });
  assert.equal(overdueScheduled.scheduled, true);
  const overdueTimer = [...controlledTimers].reverse().find(timer => !timer.canceled && timer.delayMs > 10_000);
  assert.ok(overdueTimer, 'the first countdown checkpoint should be scheduled');
  clockOffsetMs += 31_000;
  overdueTimer.callback();
  assert.equal(
    overdue.writes.filter(value => /shutting down in (?:10|5|4|3|2|1) second/.test(value)).length,
    0,
    'an overdue timer must not flood players with stale countdown milestones'
  );
  assert.match(overdue.writes.at(-1), /Server shutting down now\./,
    'an overdue countdown should advance directly to its final notice');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(overdue.writes.at(-1), 'stop\n');

  console.log('PASS announced and bounded server shutdown console commands');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
