'use strict';

const path = require('node:path');

const PROTOCOL_PREFIXES = Object.freeze(['CI_RESTART_ACK', 'CI_RESTART_NACK']);
const MAX_RESTART_MESSAGE_LENGTH = 240;
const SIDECAR_MEMORY_MB = Object.freeze({ velocity: 512, limbo: 256 });
function lobbyMemoryMb(options) {
  const requested = Number(options.lobbyMemoryMb);
  return Number.isInteger(requested) && requested >= 256 && requested <= 2048
    ? requested : SIDECAR_MEMORY_MB.limbo;
}

/** Cold-start heap + native allowance. Running sidecars are already reflected
 * in OS free memory; reserving their entire budget again needlessly shrinks the
 * replacement backend. The ordinary Java policy still reserves OS headroom. */
function seamlessSidecarMemoryReserveMb(options = {}) {
  if (options.enabled !== true) return 0;
  return (options.velocityRunning === true ? 0 : SIDECAR_MEMORY_MB.velocity) +
    (options.limboRunning === true ? 0 : lobbyMemoryMb(options));
}

/** Admission while the OLD backend is still playing. Never count its Xmx as
 * reclaimable RAM: Xmx is a ceiling, not a measurement of resident memory.
 * The normal startup policy must measure free memory again AFTER its exit. */
function evaluateSeamlessRestartPreparationMemory(options = {}) {
  const total = Math.floor(Number(options.totalMemoryMb));
  const free = Math.floor(Number(options.freeMemoryMb));
  const required = Math.floor(Number(options.requiredBackendMemoryMb));
  const pendingSidecarsMb = seamlessSidecarMemoryReserveMb({ ...options, enabled: true });
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0 ||
      free > total || !Number.isFinite(required) || required < 512) {
    return Object.freeze({ allowed: false, pendingSidecarsMb, code: 'MEMORY_UNVERIFIED',
      message: 'Restart memory could not be verified. Players were not moved.' });
  }
  const operatingSystemReserveMb = Math.max(1024, Math.min(4096, Math.floor(total * 0.2)));
  const minimumFreeMb = Math.max(512, Math.min(1024, Math.floor(total * 0.025))) + pendingSidecarsMb;
  const minimumPhysicalMb = required + SIDECAR_MEMORY_MB.velocity + lobbyMemoryMb(options) + operatingSystemReserveMb;
  const allowed = total >= minimumPhysicalMb && free >= minimumFreeMb;
  return Object.freeze({ allowed, pendingSidecarsMb, minimumFreeMb, minimumPhysicalMb,
    code: allowed ? 'READY' : 'MEMORY_PRESSURE',
    message: allowed ? 'Preparation fits without a second world server; memory is checked again after the old backend exits.'
      : `Restart was not started under memory pressure (${free} MB free). Players were not moved; close memory-heavy apps and retry.` });
}

function canonicalRestartRoot(value) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return '';
  const result = path.resolve(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function assertSeamlessRestartTarget(expected, actual) {
  if (!expected?.profileId || !expected?.worldName || !canonicalRestartRoot(expected.root) ||
      expected.profileId !== actual?.profileId || expected.worldName !== actual?.worldName ||
      canonicalRestartRoot(expected.root) !== canonicalRestartRoot(actual?.root)) {
    const error = new Error('The server profile or world changed during restart. No replacement world was started.');
    error.code = 'SEAMLESS_RESTART_TARGET_CHANGED';
    throw error;
  }
}

function assertSeamlessRestartBackendExited(options = {}) {
  if (!Number.isSafeInteger(options.previousPid) || options.previousPid <= 0 ||
      options.previousExited !== true || options.previousPidAlive !== false ||
      options.currentBackendPresent !== false) {
    const error = new Error('The previous Minecraft backend has not fully exited. A second world server will not be started.');
    error.code = 'SEAMLESS_RESTART_BACKEND_STILL_RUNNING';
    throw error;
  }
}

function isSeamlessRestartReadinessSource(source, managedRestart) {
  return managedRestart !== true || source === 'marker';
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function normalizeSeamlessRestartMessage(value) {
  const message = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (message.length > MAX_RESTART_MESSAGE_LENGTH) {
    throw new RangeError(`Restart messages must be ${MAX_RESTART_MESSAGE_LENGTH} characters or fewer.`);
  }
  return message;
}

function parseSeamlessProxyProtocolLine(value) {
  const line = stripAnsi(value).trim();
  const prefix = PROTOCOL_PREFIXES.find(candidate => line.includes(candidate));
  if (!prefix) return null;
  const payload = line.slice(line.indexOf(prefix));
  const fields = {};
  for (const match of payload.matchAll(/(?:^|\s)([a-z][a-z0-9_-]*)=([^\s]+)/giu)) {
    fields[match[1].toLowerCase()] = match[2];
  }
  return Object.freeze({
    acknowledged: prefix === 'CI_RESTART_ACK',
    prefix,
    operation: String(fields.op || '').toLowerCase(),
    result: String(fields.result || '').toLowerCase(),
    state: String(fields.state || '').toUpperCase(),
    fields: Object.freeze(fields),
    raw: payload
  });
}

function isMaintenanceArmedAcknowledgement(event) {
  return Boolean(event?.acknowledged && event.operation === 'maintenance_on' &&
    event.result === 'armed' && event.state === 'ARMED' &&
    event.fields?.pending === '0' && event.fields?.main_inflight === '0');
}

function isMaintenanceReadyAcknowledgement(event) {
  return Boolean(event?.acknowledged && event.operation === 'ready_complete' &&
    event.result === 'active' && event.state === 'ACTIVE');
}

function isOperationRejection(event, operation) {
  return Boolean(event && !event.acknowledged && event.operation === String(operation || '').toLowerCase());
}

function buildMaintenanceCommand(action, message = '') {
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (!['on', 'off', 'status'].includes(normalizedAction)) {
    throw new TypeError('Maintenance action must be on, off, or status.');
  }
  if (normalizedAction !== 'on') return `cirestart maintenance ${normalizedAction}`;
  const cleanMessage = normalizeSeamlessRestartMessage(message);
  return `cirestart maintenance on${cleanMessage ? ` ${cleanMessage}` : ''}`;
}

module.exports = {
  MAX_RESTART_MESSAGE_LENGTH,
  PROTOCOL_PREFIXES,
  SIDECAR_MEMORY_MB,
  assertSeamlessRestartBackendExited,
  assertSeamlessRestartTarget,
  buildMaintenanceCommand,
  evaluateSeamlessRestartPreparationMemory,
  isMaintenanceArmedAcknowledgement,
  isMaintenanceReadyAcknowledgement,
  isOperationRejection,
  isSeamlessRestartReadinessSource,
  normalizeSeamlessRestartMessage,
  parseSeamlessProxyProtocolLine,
  seamlessSidecarMemoryReserveMb,
  stripAnsi
};
