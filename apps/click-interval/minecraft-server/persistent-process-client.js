'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { STATE_SCHEMA_VERSION } = require('./persistent-process-host');

const HOST_SOURCE = path.join(__dirname, 'persistent-process-host.js');
const MAX_STATE_BYTES = 128 * 1024;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function processExists(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

async function readState(statePath) {
  const stat = await fs.lstat(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_STATE_BYTES) {
    throw new Error('Persistent process handoff state is invalid.');
  }
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  if (state?.schemaVersion !== STATE_SCHEMA_VERSION || !/^[a-z][a-z0-9-]{0,47}$/.test(String(state?.role || '')) ||
      !Number.isInteger(Number(state?.hostPid)) || !Number.isInteger(Number(state?.childPid)) ||
      !Number.isInteger(Number(state?.port)) || Number(state.port) < 1 || Number(state.port) > 65535 ||
      typeof state?.token !== 'string' || state.token.length < 32 ||
      (state.handoffAfterSequence !== undefined && state.handoffAfterSequence !== null &&
        (!Number.isSafeInteger(Number(state.handoffAfterSequence)) || Number(state.handoffAfterSequence) < 0))) {
    throw new Error('Persistent process handoff state is malformed.');
  }
  return state;
}

class PersistentInput extends EventEmitter {
  constructor(owner) {
    super();
    this.on('error', () => {});
    this.owner = owner;
    this.writable = true;
    this.destroyed = false;
    this.writableEnded = false;
  }

  write(data, callback) {
    if (!this.writable || this.destroyed || this.writableEnded) {
      callback?.(new Error('Persistent process input is closed.'));
      return false;
    }
    const accepted = this.owner._send({ type: 'stdin', data: String(data ?? '') });
    if (!accepted) {
      const error = new Error('Persistent process input is temporarily unavailable.');
      this.emit('error', error);
      callback?.(error);
      return false;
    }
    callback?.();
    return true;
  }

  end(data) {
    if (data !== undefined) this.write(data);
    this.writableEnded = true;
    this.writable = false;
  }

  destroy() {
    this.destroyed = true;
    this.writable = false;
  }
}

class PersistentProcessAdapter extends EventEmitter {
  constructor(statePath, state, connection) {
    super();
    this.on('error', () => {});
    this.statePath = statePath;
    this.state = state;
    this.pid = Number(state.childPid);
    this.hostPid = Number(state.hostPid);
    this.metadata = state.metadata || {};
    this.exitCode = state.status === 'exited' ? state.exitCode : null;
    this.signalCode = state.status === 'exited' ? state.signalCode : null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PersistentInput(this);
    this._socket = connection.socket;
    this._buffered = '';
    this._lastSequence = Math.max(0, Number(connection.replayAfterSequence) || 0);
    this._detached = false;
    this._finished = false;
    this._reconnecting = false;
    this._handoffPromise = null;
    this._handoffResolve = null;
    this._handoffTimer = null;
    this._handoffCutoff = null;
    this._handoffClaimId = connection.handoffClaimId || null;
    this._claimCommitPromise = null;
    this._claimCommitResolve = null;
    this._claimCommitReject = null;
    this._claimCommitTimer = null;
    this._bindSocket(connection.socket);
  }

  _bindSocket(socket) {
    this._socket = socket;
    socket.setNoDelay(true);
    socket.unref?.();
    socket.on('data', chunk => this._receive(chunk));
    socket.on('error', error => {
      if (!this._detached && !this._finished) this.emit('host-error', error);
    });
    socket.on('close', () => {
      if (this._socket !== socket) return;
      this._buffered = '';
      if (this._claimCommitReject) {
        this._detached = true;
        this._settleClaimCommit(new Error('Persistent process handoff claim disconnected before commit.'));
      }
      if (this._handoffResolve) this._completeHandoff(false);
      if (!this._detached && !this._finished) this._scheduleReconnect();
    });
    socket.resume?.();
  }

  _receive(chunk) {
    this._buffered += chunk.toString('utf8');
    let newline;
    while ((newline = this._buffered.indexOf('\n')) >= 0) {
      const line = this._buffered.slice(0, newline);
      this._buffered = this._buffered.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'handoff-commit-ack') {
        if (message.claimId === this._handoffClaimId) this._settleClaimCommit();
        continue;
      }
      if (message.type === 'handoff-commit-rejected') {
        this._settleClaimCommit(new Error(String(message.message || 'Persistent process handoff claim was rejected.')));
        continue;
      }
      if (message.type === 'handoff-ack') {
        if (Number(message.afterSequence) === this._handoffCutoff) this._completeHandoff(true);
        continue;
      }
      const messageSequence = Number(message.sequence);
      const sequenced = Number.isSafeInteger(messageSequence) && messageSequence >= 0;
      if (sequenced && this._handoffCutoff !== null && messageSequence > this._handoffCutoff) {
        // Once handoff starts, the replacement app owns every later event. Do not
        // process those events here and then replay them into the replacement too.
        continue;
      }
      if (message.type === 'output') {
        const stream = message.channel === 'stderr' ? this.stderr : this.stdout;
        stream.write(Buffer.from(String(message.data || ''), 'base64'));
      } else if (message.type === 'error') {
        this.emit('error', new Error(String(message.message || 'Persistent child process failed.')));
      } else if (message.type === 'exit') {
        this._finish(message.code, message.signal);
      }
      if (sequenced) this._lastSequence = Math.max(this._lastSequence, messageSequence);
    }
  }

  async _scheduleReconnect() {
    if (this._reconnecting || this._detached || this._finished) return;
    this._reconnecting = true;
    for (const wait of [50, 100, 250, 500, 1000, 1500]) {
      await delay(wait);
      if (this._detached || this._finished) break;
      try {
        const state = await readState(this.statePath);
        if (state.status === 'exited' || !processExists(state.hostPid) || !processExists(state.childPid)) {
          this._finish(state.exitCode ?? null, state.signalCode || null);
          break;
        }
        const connection = await connectAuthenticated(state, { afterSequence: this._lastSequence });
        this.state = state;
        this._bindSocket(connection.socket);
        this._reconnecting = false;
        return;
      } catch {}
    }
    this._reconnecting = false;
    if (!this._detached && !this._finished) this._finish(null, 'HOST_DISCONNECTED');
  }

  _send(message) {
    if (!this._socket || this._socket.destroyed || !this._socket.writable) return false;
    try { return this._socket.write(`${JSON.stringify(message)}\n`); } catch { return false; }
  }

  _finish(code, signal) {
    if (this._finished) return;
    this._finished = true;
    this.exitCode = Number.isInteger(code) ? code : null;
    this.signalCode = signal || null;
    this.stdin.destroy();
    this.stdout.end();
    this.stderr.end();
    this.emit('exit', this.exitCode, this.signalCode);
    this.emit('close', this.exitCode, this.signalCode);
  }

  kill(signal) {
    if (this._finished) return false;
    return this._send({ type: 'kill', signal: signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM' });
  }

  unref() {
    this._socket?.unref?.();
  }

  _settleClaimCommit(error = null) {
    if (!this._claimCommitResolve && !this._claimCommitReject) return;
    clearTimeout(this._claimCommitTimer);
    this._claimCommitTimer = null;
    const resolve = this._claimCommitResolve;
    const reject = this._claimCommitReject;
    this._claimCommitResolve = null;
    this._claimCommitReject = null;
    if (error) {
      this._detached = true;
      try { this._socket?.destroy(); } catch {}
      this.stdout.end();
      this.stderr.end();
      reject?.(error);
      return;
    }
    this.state = { ...this.state, handoffAfterSequence: null };
    this._handoffClaimId = null;
    resolve?.({ committed: true });
  }

  commitHandoffClaim(timeoutMs = 2000) {
    if (!this._handoffClaimId) return Promise.resolve({ committed: false });
    if (this._claimCommitPromise) return this._claimCommitPromise;
    this._claimCommitPromise = new Promise((resolve, reject) => {
      this._claimCommitResolve = resolve;
      this._claimCommitReject = reject;
      this._claimCommitTimer = setTimeout(() => {
        this._settleClaimCommit(new Error('Persistent process handoff claim was not committed in time.'));
      }, Math.max(100, Number(timeoutMs) || 2000));
    });
    if (!this._send({
      type: 'handoff-commit',
      claimId: this._handoffClaimId,
      afterSequence: Number(this.state.handoffAfterSequence)
    })) {
      queueMicrotask(() => this._settleClaimCommit(new Error('Persistent process handoff claim could not be committed.')));
    }
    return this._claimCommitPromise;
  }

  _completeHandoff(checkpointed) {
    if (!this._handoffResolve) return;
    clearTimeout(this._handoffTimer);
    this._handoffTimer = null;
    const resolve = this._handoffResolve;
    this._handoffResolve = null;
    try { this._socket?.destroy(); } catch {}
    this.stdout.end();
    this.stderr.end();
    resolve({ checkpointed: Boolean(checkpointed), afterSequence: this._handoffCutoff });
  }

  disconnectForHandoff(timeoutMs = 1200) {
    if (this._handoffPromise) return this._handoffPromise;
    this._detached = true;
    this.stdin.destroy();
    this._handoffCutoff = this._lastSequence;
    if (this._finished) {
      this.stdout.end();
      this.stderr.end();
      this._handoffPromise = Promise.resolve({ checkpointed: false, afterSequence: this._handoffCutoff });
      return this._handoffPromise;
    }
    this._handoffPromise = new Promise(resolve => {
      this._handoffResolve = resolve;
      this._handoffTimer = setTimeout(() => this._completeHandoff(false), Math.max(100, Number(timeoutMs) || 1200));
    });
    if (!this._send({ type: 'handoff', afterSequence: this._handoffCutoff })) {
      queueMicrotask(() => this._completeHandoff(false));
    }
    return this._handoffPromise;
  }
}

function connectAuthenticated(state, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(state.port) });
    let settled = false;
    let buffered = '';
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || 4000);
    const finish = (error, connection = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) { socket.destroy(); reject(error); } else resolve(connection);
    };
    const onError = error => finish(error);
    const onData = chunk => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      let message;
      try { message = JSON.parse(buffered.slice(0, newline)); } catch { finish(new Error('Persistent process host returned invalid data.')); return; }
      if (message?.type !== 'attached') { finish(new Error('Persistent process host rejected the handoff.')); return; }
      const remainder = buffered.slice(newline + 1);
      socket.pause();
      if (remainder) socket.unshift(Buffer.from(remainder));
      finish(null, {
        socket,
        state: message.state,
        sequence: Number(message.sequence),
        replayAfterSequence: Math.max(0, Number(message.replayAfterSequence) || 0),
        handoffClaimId: typeof message.handoffClaimId === 'string' && message.handoffClaimId ? message.handoffClaimId : null
      });
    };
    const timer = setTimeout(() => finish(new Error('Persistent process host did not answer in time.')), timeoutMs);
    timer.unref?.();
    socket.on('error', onError);
    socket.on('data', onData);
    socket.on('connect', () => socket.write(`${JSON.stringify({
      type: 'attach',
      token: state.token,
      tail: options.tail === true,
      afterSequence: options.afterSequence,
      consumeHandoff: options.consumeHandoff === true
    })}\n`));
  });
}

/** Read-only authenticated startup evidence for a preserved child. This is NOT
 * an adapter attachment: no handoff claim/checkpoint, stdin, replayed gameplay
 * events or automatic reconnect. Missing/truncated startup fails closed. */
async function inspectPersistentProcessBacklog(statePath, options = {}) {
  const expected = options.expectedState;
  const predicates = Object.entries(options.predicates || {});
  if (!expected || !predicates.length || predicates.some(([, predicate]) => typeof predicate !== 'function')) {
    throw new Error('A preserved process identity and output predicates are required.');
  }
  const sameGeneration = state => Boolean(state && state.role === expected.role &&
    state.childPid === expected.childPid && state.hostPid === expected.hostPid &&
    typeof state.startedAt === 'string' && state.startedAt === expected.startedAt &&
    typeof state.nonce === 'string' && state.nonce.length > 0 && state.nonce === expected.nonce &&
    state.status === 'running' && state.metadata?.profileId === expected.metadata?.profileId);
  const state = await readState(statePath);
  if (!sameGeneration(state) || !processExists(state.hostPid) || !processExists(state.childPid)) {
    throw new Error('The preserved process changed before startup evidence could be inspected.');
  }
  const connection = await connectAuthenticated(state, {
    afterSequence: 0, tail: false, consumeHandoff: false, timeoutMs: options.timeoutMs || 2000
  });
  if (!sameGeneration(connection.state) || !Number.isSafeInteger(connection.sequence) || connection.sequence < 0) {
    connection.socket.destroy();
    throw new Error('The authenticated startup evidence belongs to a different process generation.');
  }
  const matches = Object.fromEntries(predicates.map(([key]) => [key, false]));
  const result = await new Promise((resolve, reject) => {
    const socket = connection.socket;
    let buffered = '', window = '', lastSequence = 0, received = 0, settled = false;
    const finish = (error, complete = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve({ complete, matches });
    };
    const timer = setTimeout(() => finish(null), Math.max(100, Math.min(5000, Number(options.timeoutMs) || 2000)));
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(null));
    socket.on('data', chunk => {
      received += chunk.length;
      if (received > 4 * 1024 * 1024) { finish(null); return; }
      buffered += chunk.toString('utf8');
      if (buffered.length > 3 * 1024 * 1024) { finish(null); return; }
      let newline;
      while (!settled && (newline = buffered.indexOf('\n')) >= 0) {
        let event;
        try { event = JSON.parse(buffered.slice(0, newline)); } catch { finish(null); return; }
        buffered = buffered.slice(newline + 1);
        if (!Number.isSafeInteger(event.sequence) || event.sequence !== lastSequence + 1 ||
            event.sequence > connection.sequence) { finish(null); return; }
        lastSequence = event.sequence;
        if (event.type === 'output') {
          if (typeof event.data !== 'string' || event.data.length > 3 * 1024 * 1024) { finish(null); return; }
          window = `${window}${Buffer.from(event.data, 'base64').toString('utf8')}`.slice(-131072);
          try {
            for (const [key, predicate] of predicates) if (!matches[key]) matches[key] = predicate(window) === true;
          } catch (error) { finish(error); return; }
        }
        if (Object.values(matches).every(Boolean) || lastSequence === connection.sequence) finish(null, true);
      }
    });
    if (connection.sequence === 0) finish(null, true);
    else socket.resume();
  });
  const current = await readState(statePath);
  if (!sameGeneration(current) || !processExists(current.hostPid) || !processExists(current.childPid)) {
    throw new Error('The preserved process changed during startup evidence inspection.');
  }
  return Object.freeze({ complete: result.complete, matches: Object.freeze(result.matches),
    pid: current.childPid, startedAt: current.startedAt });
}

async function attachPersistentProcess(statePath, options = {}) {
  let state;
  try { state = await readState(statePath); } catch (error) {
    if (error?.code === 'ENOENT' && options.optional) return null;
    throw error;
  }
  if (options.role && state.role !== options.role) throw new Error('Persistent process role does not match its handoff file.');
  if (options.nonce && state.nonce !== options.nonce) throw new Error('Persistent process startup nonce does not match.');
  if (state.status === 'exited' || state.status === 'spawn-error' || state.status === 'host-error' ||
      !processExists(state.hostPid) || !processExists(state.childPid)) {
    if (options.optional) return null;
    throw new Error('The preserved process is no longer running.');
  }
  const savedHandoffSequence = Number(state.handoffAfterSequence);
  const hasSavedHandoff = state.handoffAfterSequence !== undefined && state.handoffAfterSequence !== null &&
    Number.isSafeInteger(savedHandoffSequence) && savedHandoffSequence >= 0;
  const replayFromStart = options.replayFromStart === true || Boolean(options.nonce);
  const connection = await connectAuthenticated(state, {
    afterSequence: replayFromStart ? 0 : (hasSavedHandoff ? savedHandoffSequence : undefined),
    tail: !replayFromStart && !hasSavedHandoff,
    consumeHandoff: !replayFromStart && hasSavedHandoff,
    timeoutMs: options.timeoutMs
  });
  const adapter = new PersistentProcessAdapter(statePath, state, connection);
  await adapter.commitHandoffClaim(options.timeoutMs);
  return adapter;
}

async function launchPersistentProcess(options) {
  const statePath = path.resolve(String(options?.statePath || ''));
  const role = String(options?.role || '');
  if (!path.isAbsolute(statePath) || !/^[a-z][a-z0-9-]{0,47}$/.test(role)) throw new Error('Persistent process launch target is invalid.');
  const existing = await attachPersistentProcess(statePath, { role, optional: true }).catch(() => null);
  if (existing) throw new Error(`A managed ${role} process is already running.`);
  await fs.rm(statePath, { force: true }).catch(() => {});
  const nonce = crypto.randomBytes(18).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    role,
    executable: String(options.executable || ''),
    args: Array.isArray(options.args) ? options.args : [],
    cwd: path.resolve(String(options.cwd || '')),
    statePath,
    nonce,
    metadata: options.metadata || {}
  }), 'utf8').toString('base64url');
  const host = spawn(process.execPath, [HOST_SOURCE, '--persistent-process-host', payload], {
    cwd: __dirname,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  host.unref();
  const deadline = Date.now() + Math.max(2000, Number(options.timeoutMs) || 15_000);
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await attachPersistentProcess(statePath, { role, nonce, replayFromStart: true, timeoutMs: 1500 });
    } catch (error) {
      lastError = error;
      if (!processExists(host.pid)) break;
      await delay(50);
    }
  }
  throw new Error(`The managed ${role} process host did not start. ${lastError?.message || ''}`.trim());
}

function disconnectPersistentProcess(processRef) {
  return processRef?.disconnectForHandoff?.() || Promise.resolve({ checkpointed: false, afterSequence: null });
}

module.exports = {
  PersistentProcessAdapter,
  attachPersistentProcess,
  disconnectPersistentProcess,
  inspectPersistentProcessBacklog,
  launchPersistentProcess,
  processExists,
  readState
};
