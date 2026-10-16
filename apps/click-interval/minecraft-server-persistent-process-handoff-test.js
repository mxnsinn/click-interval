'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  attachPersistentProcess,
  launchPersistentProcess,
  processExists
} = require('./minecraft-server/persistent-process-client');

function waitFor(stream, pattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let value = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Received: ${JSON.stringify(value)}`));
    }, timeoutMs);
    const onData = chunk => {
      value += chunk.toString();
      if (pattern.test(value)) {
        cleanup();
        resolve(value);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off('data', onData);
    };
    stream.on('data', onData);
  });
}

function abandonHandoffClaim(statePath, timeoutMs = 4000) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(state.port) });
    let settled = false;
    let buffered = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Timed out creating an abandoned replay claim.')), timeoutMs);
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(`${JSON.stringify({
      type: 'attach',
      token: state.token,
      afterSequence: state.handoffAfterSequence,
      consumeHandoff: true
    })}\n`));
    socket.on('data', chunk => {
      buffered += chunk.toString('utf8');
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type !== 'attached') continue;
        if (!message.handoffClaimId) {
          finish(new Error('The host did not create a two-phase handoff claim.'));
          return;
        }
        finish(null, message.handoffClaimId);
        return;
      }
    });
  });
}

async function waitForExit(processRef, timeoutMs = 8000) {
  if (processRef.exitCode !== null) return;
  await Promise.race([
    new Promise(resolve => processRef.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Persistent child did not exit.')), timeoutMs))
  ]);
}

(async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-handoff-'));
  const statePath = path.join(temporaryRoot, 'echo-state.json');
  let first;
  let second;
  try {
    first = await launchPersistentProcess({
      role: 'handoff-test',
      executable: process.execPath,
      args: ['-e', [
        "process.stdin.setEncoding('utf8');",
        "process.stdout.write('[Server thread/INFO]: Done (1.000s)! For help, type help\\n');",
        "process.stdin.on('data', value => {",
        "  process.stdout.write('ECHO:' + value);",
        "  if (value.includes('PREPARE')) { process.stdout.write('PREPARED\\n'); setTimeout(() => process.stdout.write('GAP-EVENT\\n'), 200); }",
        "  if (value.includes('EXIT')) process.exit(0);",
        "});"
      ].join('')],
      cwd: temporaryRoot,
      statePath,
      metadata: { profileId: 'test-profile' }
    });
    await waitFor(first.stdout, /Done \(1\.000s\)/);
    first.stdin.write('FIRST\n');
    await waitFor(first.stdout, /ECHO:FIRST/);
    first.stdin.write('PREPARE\n');
    await waitFor(first.stdout, /PREPARED/);
    const childPid = first.pid;
    const hostPid = first.hostPid;
    const handoff = await first.disconnectForHandoff();
    assert.equal(handoff.checkpointed, true, 'the old app must persist its last consumed output sequence before exiting');
    const preparedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(preparedState.handoffAfterSequence, handoff.afterSequence, 'the host must persist the exact acknowledged replay boundary');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(processExists(childPid), true, 'disconnecting the app-side adapter must not stop the managed child');
    assert.equal(processExists(hostPid), true, 'the detached host must survive the first app-side adapter');

    const abandonedClaimId = await abandonHandoffClaim(statePath);
    assert.equal(typeof abandonedClaimId, 'string');
    await new Promise(resolve => setTimeout(resolve, 100));
    const abandonedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(abandonedState.handoffAfterSequence, handoff.afterSequence,
      'disconnecting before commit must leave the durable replay boundary available to another claimant');

    second = await attachPersistentProcess(statePath, { role: 'handoff-test' });
    assert.equal(second.pid, childPid, 'the replacement app must reattach to the same child PID');
    assert.equal(second.metadata.profileId, 'test-profile');
    const replayed = await new Promise((resolve, reject) => {
      let output = '';
      let settleTimer = null;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for the saved gap output. Received: ${JSON.stringify(output)}`));
      }, 4000);
      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        second.stdout.off('data', onData);
      };
      const onData = chunk => {
        output += chunk.toString();
        if (!output.includes('GAP-EVENT') || settleTimer) return;
        settleTimer = setTimeout(() => {
          cleanup();
          resolve(output);
        }, 100);
      };
      second.stdout.on('data', onData);
    });
    assert.doesNotMatch(replayed, /Done \(1\.000s\)|ECHO:FIRST|PREPARED/, 'reattach must not replay consumed chat, player, or readiness output');
    assert.equal((replayed.match(/GAP-EVENT/g) || []).length, 1, 'the reclaimed update-gap output must be delivered exactly once');
    const claimedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(claimedState.handoffAfterSequence, null, 'a successful replacement attach must claim the persisted boundary once');
    second.stdin.write('SECOND\n');
    await waitFor(second.stdout, /ECHO:SECOND/);
    second.stdin.write('EXIT\n');
    await waitForExit(second);
    assert.equal(second.exitCode, 0);
    process.stdout.write('Persistent process handoff regression test passed.\n');
  } finally {
    if (second && second.exitCode === null) second.kill('SIGKILL');
    if (first && first.exitCode === null) first.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
