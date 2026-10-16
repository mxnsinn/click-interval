'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__runtimeTest = {\n`
  + '  begin(generation = 1, adapterId = "fabric-26.2") {\n'
  + '    const writes = [];\n'
  + '    serverProcess = { stdin: { writable: true, destroyed: false, writableEnded: false, write(value, callback) { writes.push(String(value)); callback?.(); return true; } } };\n'
  + '    serverState = "running"; serverLifecycleGeneration = generation; serverReadyGeneration = generation; protectionLogRemainder = "";\n'
  + '    protectionRuntimeHandshake = beginProtectionRuntimeLifecycle(protectionRuntimeHandshake, { generation, adapterId, expectedCheckCount: 13, now: 1 });\n'
  + '    return writes;\n'
  + '  },\n'
  + '  feed(line, generation = serverLifecycleGeneration, adapterId = protectionRuntimeHandshake.expectedAdapterId) { processProtectionLogEvents(`${line}\\n`, { generation, adapterId }); },\n'
  + '  status(adapterId = protectionRuntimeHandshake.expectedAdapterId) { return getCurrentProtectionRuntimeStatus({ id: adapterId }); },\n'
  + '  reload(adapterId = protectionRuntimeHandshake.expectedAdapterId) { return reloadBundledProtectionRuntime({ id: adapterId, reloadCommand: "serverprotection reload" }); },\n'
  + '  end(adapterId = protectionRuntimeHandshake.expectedAdapterId) { protectionRuntimeHandshake = endProtectionRuntimeLifecycle(protectionRuntimeHandshake, { generation: serverLifecycleGeneration, adapterId, now: Date.now() }); settleProtectionRuntimeReloadWaiter(protectionRuntimeHandshake); return protectionRuntimeHandshake; }\n'
  + '};';

const moduleMock = { exports: {} };
const electronMock = {
  app: { getPath: () => path.join(__dirname, 'work', 'protection-runtime-test'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8')
  },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) }) }
};

vm.runInNewContext(source, {
  module: moduleMock,
  exports: moduleMock.exports,
  __dirname: path.dirname(sourcePath),
  __filename: sourcePath,
  Buffer,
  URL,
  URLSearchParams,
  process,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  require: (id) => {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
    return require(id);
  }
}, { filename: sourcePath });

const test = moduleMock.exports.__runtimeTest;
const fabricLine = (message) => `[16:44:01] [Server thread/INFO]: ${message}`;

async function run() {
  test.begin(1);
  test.feed(fabricLine('<Player> Server Protection Fabric started with 13 bounded checks.'));
  assert.equal(test.status().active, false, 'player chat must not spoof the runtime handshake');
  test.feed(fabricLine('Server Protection Fabric started with 8 bounded checks.'));
  assert.equal(test.status().active, false, 'an old eight-check runtime must not be active');
  assert.equal(test.status().startupFailure.code, 'check-count-mismatch');

  const writes = test.begin(2);
  test.feed(fabricLine('Server Protection Fabric started with 13 bounded checks.'));
  assert.equal(test.status().active, true, 'the exact thirteen-check startup marker must activate the adapter');

  const reload = test.reload();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.at(-1), 'serverprotection reload\n');
  assert.equal(test.status().reload.status, 'pending');
  test.feed(fabricLine('Server Protection config reloaded.'));
  const result = await reload;
  assert.equal(result.appliedLive, true, 'a console write alone must not count as a live apply');
  assert.equal(test.status().reload.status, 'succeeded');

  const stopped = test.end();
  assert.equal(stopped.active, false);
  assert.equal(stopped.phase, 'stopped');
}

run()
  .then(() => console.log('Minecraft Server protection runtime integration tests passed.'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
