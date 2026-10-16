'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { inspectPersistentProcessBacklog } = require('./minecraft-server/persistent-process-client');
const { isFabricProxyLiteReadyLog, isBackendReadyLog } = require('./minecraft-server/seamless-restart-setup');
const projectWork = path.join(__dirname, 'work');
fs.mkdirSync(projectWork, { recursive: true });
const directory = fs.mkdtempSync(path.join(projectWork, 'startup-evidence-test-'));
let testNumber = 0;

async function fixture(options = {}) {
  const file = path.join(directory, `${++testNumber}.json`);
  const received = [];
  let state;
  const chunks = options.chunks || [
    'Loading Minecraft 26.2\n\t- fabricproxy-',
    'lite 2.12.0\n',
    '[Server thread/INFO]: Done (1.020s)! For help, type "help"\n'
  ];
  const events = chunks.map((text, index) => ({ type: 'output', channel: 'stdout',
    sequence: index + (options.firstSequence || 1), data: Buffer.from(text).toString('base64') }));
  const server = net.createServer(socket => {
    let pending = '';
    socket.on('error', () => {});
    socket.on('data', data => {
      pending += data.toString();
      const newline = pending.indexOf('\n');
      if (newline < 0) return;
      const command = JSON.parse(pending.slice(0, newline));
      received.push(command.type);
      assert.equal(command.type, 'attach');
      assert.equal(command.consumeHandoff, false);
      assert.equal(command.afterSequence, 0);
      assert.equal(command.tail, false);
      assert.equal(command.token, state.token);
      const wireState = { ...state, ...(options.responsePatch || {}) };
      const records = [{ type: 'attached', state: wireState, sequence: events.at(-1)?.sequence || 0,
        replayAfterSequence: 0, handoffClaimId: null }, ...events];
      socket.write(records.map(record => JSON.stringify(record)).join('\n') + '\n');
      if (options.changedOnDisk) fs.writeFileSync(file, JSON.stringify({ ...state, startedAt: '2026-10-09T00:00:00Z' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  state = { schemaVersion: 1, role: 'minecraft-server', childPid: process.pid, hostPid: process.pid,
    startedAt: '2026-10-08T15:36:18.194Z', nonce: 'startup-evidence-native-fixture',
    token: 'test-only-token-not-used-by-any-live-service', port: server.address().port, status: 'running',
    handoffAfterSequence: 900, metadata: { profileId: 'SMP' } };
  fs.writeFileSync(file, JSON.stringify(state));
  try {
    const result = await inspectPersistentProcessBacklog(file, { expectedState: state, timeoutMs: 300,
      predicates: { fabricProxyLite: isFabricProxyLiteReadyLog, backendReady: isBackendReadyLog } });
    assert.deepEqual(received, ['attach'], 'no stdin, checkpoint, claim or routing commands');
    assert.equal(JSON.parse(fs.readFileSync(file)).handoffAfterSequence, 900, 'inspection must not consume the real app checkpoint');
    return result;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const exact = await fixture();
  assert.equal(exact.complete, true);
  assert.deepEqual(exact.matches, { fabricProxyLite: true, backendReady: true });
  assert.equal(exact.pid, process.pid);
  const truncated = await fixture({ firstSequence: 20 });
  assert.equal(truncated.complete, false, 'do not infer startup evidence from a truncated tail');
  assert.equal(truncated.matches.fabricProxyLite, false);
  const noPlugin = await fixture({ chunks: ['Loading Minecraft\n', 'Done (1s)! For help, type "help"\n'] });
  assert.equal(noPlugin.matches.fabricProxyLite, false);
  const noDone = await fixture({ chunks: ['- fabricproxy-lite 2.12.0\n'] });
  assert.equal(noDone.matches.backendReady, false);
  await assert.rejects(fixture({ responsePatch: { childPid: process.pid + 1 } }), /different process generation/);
  await assert.rejects(fixture({ responsePatch: { startedAt: '2026-10-07T15:36:18.194Z' } }), /different process generation/);
  await assert.rejects(fixture({ changedOnDisk: true }), /changed during/);
  const main = fs.readFileSync(path.join(__dirname, 'minecraft-server/main.js'), 'utf8');
  assert.match(main, /const statusPort = seamless\.enabled \? seamless\.backendPort/);
  assert.match(main, /inspectPersistentProcessBacklog\(paths\.persistentServerState,[\s\S]*expectedState: serverRef\.state/);
  assert.match(main, /evidence\.complete && evidence\.matches\.fabricProxyLite && evidence\.matches\.backendReady/);
  console.log('PASS authenticated preserved-startup evidence, generation checks and non-mutating replay');
})().catch(error => { console.error(error); process.exitCode = 1; });
