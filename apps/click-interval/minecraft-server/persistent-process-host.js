'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const STATE_SCHEMA_VERSION = 1;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BACKLOG_BYTES = 2 * 1024 * 1024;

function writeJsonAtomically(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
    fs.rmSync(file, { force: true });
    fs.renameSync(temporary, file);
  }
}

function decodeConfiguration(encoded) {
  if (!encoded || encoded.length > 256 * 1024) throw new Error('Persistent process configuration is missing or too large.');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persistent process configuration is invalid.');
  const role = String(value.role || '');
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(role)) throw new Error('Persistent process role is invalid.');
  const executable = String(value.executable || '');
  const cwd = path.resolve(String(value.cwd || ''));
  const statePath = path.resolve(String(value.statePath || ''));
  if (!executable || !path.isAbsolute(cwd) || !path.isAbsolute(statePath)) throw new Error('Persistent process paths are invalid.');
  if (!Array.isArray(value.args) || value.args.length > 4096) throw new Error('Persistent process arguments are invalid.');
  return {
    role,
    executable,
    args: value.args.map(argument => String(argument)),
    cwd,
    statePath,
    nonce: String(value.nonce || ''),
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? value.metadata : {}
  };
}

function runHost(configuration) {
  const token = crypto.randomBytes(32).toString('base64url');
  const clients = new Set();
  const backlog = [];
  let backlogBytes = 0;
  let sequence = 0;
  let child = null;
  let state = null;
  let terminal = false;
  let activeHandoffClaim = null;

  const publishState = (patch = {}) => {
    state = {
      schemaVersion: STATE_SCHEMA_VERSION,
      role: configuration.role,
      nonce: configuration.nonce,
      token,
      hostPid: process.pid,
      childPid: child?.pid || state?.childPid || 0,
      port: server.address()?.port || state?.port || 0,
      status: 'starting',
      startedAt: state?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: configuration.metadata,
      ...state,
      ...patch
    };
    writeJsonAtomically(configuration.statePath, state);
  };

  const send = (socket, message) => {
    if (!socket || socket.destroyed || !socket.writable) return;
    try { socket.write(`${JSON.stringify(message)}\n`); } catch {}
  };

  const publish = (message, retain = true) => {
    const event = { ...message, sequence: ++sequence };
    if (retain) {
      const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      backlog.push({ event, bytes });
      backlogBytes += bytes;
      while (backlogBytes > MAX_BACKLOG_BYTES && backlog.length > 1) {
        backlogBytes -= backlog.shift().bytes;
      }
    }
    for (const socket of clients) send(socket, event);
  };

  const server = net.createServer(socket => {
    socket.setNoDelay(true);
    let authenticated = false;
    let buffered = '';
    socket.on('data', chunk => {
      buffered += chunk.toString('utf8');
      if (Buffer.byteLength(buffered, 'utf8') > MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!authenticated) {
          const suppliedToken = Buffer.from(String(message?.token || ''));
          const expectedToken = Buffer.from(token);
          if (message?.type !== 'attach' || suppliedToken.length !== expectedToken.length ||
              !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
            socket.destroy();
            return;
          }
          authenticated = true;
          clients.add(socket);
          const requestedAfterSequence = Number(message.afterSequence);
          const hasRequestedSequence = message.afterSequence !== undefined && message.afterSequence !== null &&
            Number.isSafeInteger(requestedAfterSequence) && requestedAfterSequence >= 0;
          const afterSequence = message.tail === true
            ? sequence
            : Math.min(sequence, hasRequestedSequence ? requestedAfterSequence : 0);
          let handoffClaimId = null;
          if (message.consumeHandoff === true) {
            const savedHandoffSequence = Number(state?.handoffAfterSequence);
            if (!Number.isSafeInteger(savedHandoffSequence) || savedHandoffSequence < 0 || savedHandoffSequence !== afterSequence ||
                (activeHandoffClaim && activeHandoffClaim.socket !== socket)) {
              clients.delete(socket);
              socket.destroy();
              return;
            }
            handoffClaimId = crypto.randomBytes(18).toString('base64url');
            activeHandoffClaim = { socket, afterSequence, claimId: handoffClaimId };
          }
          send(socket, { type: 'attached', state, sequence, replayAfterSequence: afterSequence, handoffClaimId });
          for (const record of backlog) if (record.event.sequence > afterSequence) send(socket, record.event);
          continue;
        }
        if (message?.type === 'handoff-commit') {
          const claim = activeHandoffClaim;
          if (!claim || claim.socket !== socket || message.claimId !== claim.claimId ||
              Number(message.afterSequence) !== claim.afterSequence) {
            send(socket, { type: 'handoff-commit-rejected' });
            continue;
          }
          try {
            publishState({
              handoffAfterSequence: null,
              handoffClaimedAt: new Date().toISOString(),
              handoffCommittedAt: new Date().toISOString()
            });
            activeHandoffClaim = null;
            send(socket, { type: 'handoff-commit-ack', claimId: claim.claimId, afterSequence: claim.afterSequence });
          } catch (error) {
            send(socket, { type: 'handoff-commit-rejected', message: String(error?.message || error) });
          }
        } else if (message?.type === 'stdin') {
          const data = String(message.data || '');
          if (Buffer.byteLength(data, 'utf8') <= MAX_MESSAGE_BYTES && child?.stdin?.writable) {
            child.stdin.write(data);
          }
        } else if (message?.type === 'kill' && child && child.exitCode === null) {
          try { child.kill(message.signal === 'SIGKILL' ? 'SIGKILL' : undefined); } catch {}
        } else if (message?.type === 'ping') {
          send(socket, { type: 'pong', sequence });
        } else if (message?.type === 'handoff') {
          const afterSequence = Number(message.afterSequence);
          if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || afterSequence > sequence ||
              (activeHandoffClaim && activeHandoffClaim.socket !== socket)) {
            send(socket, { type: 'handoff-rejected' });
            continue;
          }
          try {
            publishState({ handoffAfterSequence: afterSequence, handoffPreparedAt: new Date().toISOString() });
            send(socket, { type: 'handoff-ack', afterSequence });
          } catch (error) {
            send(socket, { type: 'handoff-rejected', message: String(error?.message || error) });
          }
        }
      }
    });
    const detach = () => {
      clients.delete(socket);
      if (activeHandoffClaim?.socket === socket) activeHandoffClaim = null;
    };
    socket.on('close', detach);
    socket.on('error', detach);
  });

  server.on('error', error => {
    try { publishState({ status: 'host-error', error: String(error?.message || error) }); } catch {}
    process.exitCode = 1;
  });

  server.listen(0, '127.0.0.1', () => {
    try {
      child = spawn(configuration.executable, configuration.args, {
        cwd: configuration.cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      terminal = true;
      try { publishState({ status: 'spawn-error', error: String(error?.message || error), exitedAt: new Date().toISOString() }); } catch {}
      publish({ type: 'error', message: String(error?.message || error) });
      server.close(() => { process.exitCode = 1; });
      return;
    }
    try {
      publishState({ status: 'running', childPid: child.pid });
    } catch (error) {
      terminal = true;
      try { child.kill('SIGKILL'); } catch {}
      publish({ type: 'error', message: `Could not publish persistent process state: ${error?.message || error}` });
      server.close(() => { process.exitCode = 1; });
      return;
    }

    const forward = channel => data => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      publish({ type: 'output', channel, data: bytes.toString('base64') });
    };
    child.stdout.on('data', forward('stdout'));
    child.stderr.on('data', forward('stderr'));
    child.stdin.on('error', error => publish({ type: 'error', message: `Child console failed: ${error?.message || error}` }, false));
    child.on('error', error => publish({ type: 'error', message: String(error?.message || error) }));
    const finish = (code, signal) => {
      if (terminal) return;
      terminal = true;
      try {
        publishState({
          status: 'exited',
          exitCode: Number.isInteger(code) ? code : null,
          signalCode: signal || null,
          exitedAt: new Date().toISOString()
        });
      } catch {}
      publish({ type: 'exit', code: Number.isInteger(code) ? code : null, signal: signal || null });
      setTimeout(() => server.close(() => process.exit()), 1000).unref?.();
    };
    child.once('exit', finish);
    child.once('close', finish);
  });
}

if (require.main === module) {
  try {
    const marker = process.argv.indexOf('--persistent-process-host');
    runHost(decodeConfiguration(marker >= 0 ? process.argv[marker + 1] : ''));
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { STATE_SCHEMA_VERSION, decodeConfiguration, runHost };
