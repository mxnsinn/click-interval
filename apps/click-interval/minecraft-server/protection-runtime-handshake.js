'use strict';

const DEFAULT_EXPECTED_CHECK_COUNT = 13;
const DEFAULT_RELOAD_TIMEOUT_MS = 10_000;
const MAX_LOG_LINE_LENGTH = 4_096;
const MAX_DETAIL_LENGTH = 512;
const MAX_ADAPTER_ID_LENGTH = 64;
const MAX_REQUEST_ID_LENGTH = 128;
const MIN_RELOAD_TIMEOUT_MS = 100;
const MAX_RELOAD_TIMEOUT_MS = 300_000;

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MINECRAFT_FORMATTING = /\u00a7[0-9a-fk-orx]/gi;

function boundedText(value, maximum, fallback = '') {
  const text = String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return (text || fallback).slice(0, maximum);
}

function normalizeGeneration(value) {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0 ? Math.floor(timestamp) : null;
}

function adapterFamily(adapterId) {
  if (adapterId === 'bukkit') return 'bukkit';
  if (/^fabric-[a-z0-9][a-z0-9._-]*$/i.test(adapterId)) return 'fabric';
  return '';
}

function normalizeAdapterId(value) {
  const adapterId = boundedText(value, MAX_ADAPTER_ID_LENGTH).toLowerCase();
  return adapterFamily(adapterId) ? adapterId : '';
}

function normalizeExpectedCheckCount(value) {
  if (value === null) return null;
  const count = Number(value ?? DEFAULT_EXPECTED_CHECK_COUNT);
  return Number.isSafeInteger(count) && count > 0 && count <= 256
    ? count
    : DEFAULT_EXPECTED_CHECK_COUNT;
}

function freezeIssue(issue) {
  if (!issue) return null;
  return Object.freeze({
    code: boundedText(issue.code, 64, 'unknown'),
    message: boundedText(issue.message, MAX_DETAIL_LENGTH, 'Protection runtime reported a failure.')
  });
}

function freezeReload(reload = {}) {
  return Object.freeze({
    status: reload.status || 'idle',
    requestId: boundedText(reload.requestId, MAX_REQUEST_ID_LENGTH),
    requestedAt: normalizeTimestamp(reload.requestedAt),
    deadlineAt: normalizeTimestamp(reload.deadlineAt),
    completedAt: normalizeTimestamp(reload.completedAt),
    failure: freezeIssue(reload.failure)
  });
}

function freezeState(value = {}) {
  const startupFailure = freezeIssue(value.startupFailure);
  const inheritedWarning = freezeIssue(value.startupWarning);
  const inheritedPacketWarning = ['packet-antixray-missing', 'packet-antixray-inactive']
    .includes(inheritedWarning?.code);
  const hasGeneralWarning = Object.prototype.hasOwnProperty.call(value, 'generalStartupWarning');
  const hasPacketWarning = Object.prototype.hasOwnProperty.call(value, 'packetAntiXrayWarning');
  const generalStartupWarning = freezeIssue(
    hasGeneralWarning ? value.generalStartupWarning : (!inheritedPacketWarning ? inheritedWarning : null)
  );
  const packetAntiXrayWarning = freezeIssue(
    hasPacketWarning ? value.packetAntiXrayWarning : (inheritedPacketWarning ? inheritedWarning : null)
  );
  const startupWarning = generalStartupWarning || packetAntiXrayWarning;
  const reload = freezeReload(value.reload);
  const startupConfirmed = Boolean(value.startupConfirmed);
  const stopped = value.phase === 'stopped';
  const active = startupConfirmed && !startupFailure && !stopped;
  const degraded = Boolean(
    startupFailure ||
    startupWarning ||
    reload.status === 'failed' ||
    reload.status === 'timed-out'
  );
  const phase = stopped
    ? 'stopped'
    : startupFailure
      ? 'failed'
      : startupConfirmed
        ? 'active'
        : value.generation === null || value.generation === undefined
          ? 'idle'
          : 'starting';
  const observedCheckCount = Number.isSafeInteger(value.observedCheckCount)
    ? value.observedCheckCount
    : null;
  const packetAntiXrayActive = value.packetAntiXrayActive === true
    ? true
    : value.packetAntiXrayActive === false ? false : null;

  return Object.freeze({
    generation: normalizeGeneration(value.generation),
    expectedAdapterId: normalizeAdapterId(value.expectedAdapterId),
    adapterFamily: value.adapterFamily || '',
    phase,
    startupConfirmed,
    startupFailure,
    startupWarning,
    generalStartupWarning,
    packetAntiXrayWarning,
    expectedCheckCount: Number.isSafeInteger(value.expectedCheckCount) ? value.expectedCheckCount : null,
    observedCheckCount,
    checkCount: observedCheckCount,
    packetAntiXrayActive,
    active,
    degraded,
    reload,
    lastMarkerAt: normalizeTimestamp(value.lastMarkerAt)
  });
}

function createProtectionRuntimeHandshake() {
  return freezeState({
    generation: null,
    expectedAdapterId: '',
    adapterFamily: '',
    phase: 'idle',
    startupConfirmed: false,
    expectedCheckCount: null,
    observedCheckCount: null,
    packetAntiXrayActive: null,
    reload: { status: 'idle' }
  });
}

function beginProtectionRuntimeLifecycle(state, options = {}) {
  void state;
  const generation = normalizeGeneration(options.generation);
  const expectedAdapterId = normalizeAdapterId(options.adapterId);
  if (generation === null) throw new TypeError('generation must be a non-negative safe integer');
  if (!expectedAdapterId) throw new TypeError('adapterId must be bukkit or a bounded fabric adapter id');

  return freezeState({
    generation,
    expectedAdapterId,
    adapterFamily: adapterFamily(expectedAdapterId),
    phase: 'starting',
    startupConfirmed: false,
    startupFailure: null,
    startupWarning: null,
    generalStartupWarning: null,
    packetAntiXrayWarning: null,
    expectedCheckCount: normalizeExpectedCheckCount(options.expectedCheckCount),
    observedCheckCount: null,
    packetAntiXrayActive: null,
    reload: { status: 'idle' },
    lastMarkerAt: normalizeTimestamp(options.now)
  });
}

function extractTrustedServerMessage(line) {
  if (typeof line !== 'string' || line.length === 0 || line.length > MAX_LOG_LINE_LENGTH) return null;
  const clean = line.replace(ANSI_SEQUENCE, '').replace(MINECRAFT_FORMATTING, '').trim();
  if (!clean || clean.includes('\n') || clean.includes('\r')) return null;

  const vanilla = /^\[[^\]\r\n]{1,64}\]\s+\[Server thread\/(INFO|WARN|ERROR|FATAL)\]:\s*(.{1,3072})$/.exec(clean);
  if (vanilla) return Object.freeze({ level: vanilla[1], message: vanilla[2].trim() });

  const bukkit = /^\[[0-9:.\-TZ+ ]{1,48}\s+(INFO|WARN|ERROR|SEVERE|FATAL)\]:\s*(.{1,3072})$/.exec(clean);
  if (bukkit) return Object.freeze({ level: bukkit[1], message: bukkit[2].trim() });
  return null;
}

function marker(adapterFamilyValue, kind, issue = null, observedCheckCount = null) {
  return Object.freeze({
    adapterFamily: adapterFamilyValue,
    kind,
    issue: freezeIssue(issue),
    observedCheckCount: Number.isSafeInteger(observedCheckCount) ? observedCheckCount : null
  });
}

function parseProtectionRuntimeLine(line) {
  const envelope = extractTrustedServerMessage(line);
  if (!envelope) return null;
  const message = envelope.message;

  let match = /^Server Protection Fabric started with ([0-9]{1,3}) bounded checks\.$/.exec(message);
  if (match) return marker('fabric', 'startup-success', null, Number(match[1]));
  if (message === 'Server Protection Fabric packet Anti-Xray provider loaded; concealed-ore detection remains available as a secondary signal.') {
    return marker('fabric', 'packet-antixray-ready');
  }
  if (message === 'Server Protection Fabric packet Anti-Xray provider is missing; ore packets are not being obfuscated.') {
    return marker('fabric', 'packet-antixray-missing', {
      code: 'packet-antixray-missing',
      message: 'Fabric packet Anti-Xray did not load; concealed ore data is not being obfuscated.'
    });
  }
  if (message === 'Server Protection Fabric packet Anti-Xray provider is inactive; ore packets are not being obfuscated.') {
    return marker('fabric', 'packet-antixray-missing', {
      code: 'packet-antixray-inactive',
      message: 'Fabric packet Anti-Xray loaded but did not activate; concealed ore data is not being obfuscated.'
    });
  }
  if (message === 'Server Protection Fabric packet Anti-Xray provider loaded but ore obfuscation is disabled.') {
    return marker('fabric', 'packet-antixray-disabled');
  }
  if (message === 'Server Protection Fabric packet Anti-Xray provider is missing and ore protection is disabled.') {
    return marker('fabric', 'packet-antixray-disabled');
  }
  match = /^Server Protection could not load config\.yml; protection is disabled: (.+)$/.exec(message);
  if (match) return marker('fabric', 'startup-failure', {
    code: 'config-load-failed',
    message: match[1]
  });
  match = /^Server Protection ignored access\.yml exemptions: (.+)$/.exec(message);
  if (match) return marker('fabric', 'startup-warning', {
    code: 'access-config-rejected',
    message: match[1]
  });
  match = /^Server Protection could not load offense state; starting with bounded empty state: (.+)$/.exec(message);
  if (match) return marker('fabric', 'startup-warning', {
    code: 'offense-state-load-failed',
    message: match[1]
  });
  if (message === 'Server Protection config reloaded.') return marker('fabric', 'reload-success');
  match = /^Server Protection reload failed: (.+)$/.exec(message);
  if (match) return marker('fabric', 'reload-failure', {
    code: 'reload-rejected',
    message: match[1]
  });

  match = /^\[ServerProtection\] Server Protection enabled with the ([A-Za-z0-9._ -]{1,64}) preset\.$/.exec(message);
  if (match) return marker('bukkit', 'startup-success');
  match = /^\[ServerProtection\] Protection config is invalid: (.+)$/.exec(message);
  if (match) return marker('bukkit', 'startup-failure', {
    code: 'config-load-failed',
    message: match[1]
  });
  match = /^\[ServerProtection\] Player access config was rejected; keeping normal server permissions: (.+)$/.exec(message);
  if (match) return marker('bukkit', 'startup-warning', {
    code: 'access-config-rejected',
    message: match[1]
  });
  match = /^\[ServerProtection\] Could not load offense state; starting with an empty in-memory state: (.+)$/.exec(message);
  if (match) return marker('bukkit', 'startup-warning', {
    code: 'offense-state-load-failed',
    message: match[1]
  });
  if (message === 'Server Protection and player access reloaded.') return marker('bukkit', 'reload-success');
  match = /^Protection reloaded, but player access was rejected: (.+)$/.exec(message);
  if (match) return marker('bukkit', 'reload-failure', {
    code: 'access-reload-rejected',
    message: match[1]
  });
  match = /^Reload rejected: (.+)$/.exec(message);
  if (match) return marker('bukkit', 'reload-failure', {
    code: 'reload-rejected',
    message: match[1]
  });
  return null;
}

function matchesLifecycle(state, context = {}) {
  return Boolean(
    state &&
    state.phase !== 'idle' &&
    normalizeGeneration(context.generation) === state.generation &&
    normalizeAdapterId(context.adapterId) === state.expectedAdapterId
  );
}

function observeProtectionRuntimeLine(state, observation = {}) {
  if (!matchesLifecycle(state, observation) || state.phase === 'stopped') return state;
  const parsed = parseProtectionRuntimeLine(observation.line);
  if (!parsed || parsed.adapterFamily !== state.adapterFamily) return state;
  const markedAt = normalizeTimestamp(observation.now);

  if (parsed.kind === 'startup-failure') {
    return freezeState({
      ...state,
      startupFailure: state.startupFailure || parsed.issue,
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'startup-warning') {
    return freezeState({
      ...state,
      generalStartupWarning: state.generalStartupWarning || parsed.issue,
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'startup-success') {
    if (state.startupConfirmed) return state;
    const observedCheckCount = parsed.observedCheckCount;
    const mismatch = observedCheckCount !== null &&
      state.expectedCheckCount !== null &&
      observedCheckCount !== state.expectedCheckCount;
    return freezeState({
      ...state,
      startupConfirmed: true,
      observedCheckCount,
      startupFailure: state.startupFailure || (mismatch ? {
        code: 'check-count-mismatch',
        message: `Protection runtime reported ${observedCheckCount} checks; expected ${state.expectedCheckCount}.`
      } : null),
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'packet-antixray-ready') {
    return freezeState({
      ...state,
      packetAntiXrayActive: true,
      packetAntiXrayWarning: null,
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'packet-antixray-disabled') {
    return freezeState({
      ...state,
      packetAntiXrayActive: false,
      packetAntiXrayWarning: null,
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'packet-antixray-missing') {
    return freezeState({
      ...state,
      packetAntiXrayActive: false,
      packetAntiXrayWarning: state.packetAntiXrayWarning || parsed.issue,
      lastMarkerAt: markedAt
    });
  }
  if (parsed.kind === 'reload-success' || parsed.kind === 'reload-failure') {
    if (state.reload.status !== 'pending') return state;
    return freezeState({
      ...state,
      reload: {
        ...state.reload,
        status: parsed.kind === 'reload-success' ? 'succeeded' : 'failed',
        completedAt: markedAt,
        failure: parsed.kind === 'reload-failure' ? parsed.issue : null
      },
      lastMarkerAt: markedAt
    });
  }
  return state;
}

function requestProtectionRuntimeReload(state, request = {}) {
  if (!matchesLifecycle(state, request) || !state.active || state.reload.status === 'pending') return state;
  const requestId = boundedText(request.requestId, MAX_REQUEST_ID_LENGTH);
  const requestedAt = normalizeTimestamp(request.now);
  if (!requestId) throw new TypeError('requestId must be a non-empty bounded value');
  if (requestedAt === null) throw new TypeError('now must be a non-negative finite timestamp');
  const requestedTimeout = Math.floor(Number(request.timeoutMs));
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(MIN_RELOAD_TIMEOUT_MS, Math.min(MAX_RELOAD_TIMEOUT_MS, requestedTimeout))
    : DEFAULT_RELOAD_TIMEOUT_MS;

  return freezeState({
    ...state,
    reload: {
      status: 'pending',
      requestId,
      requestedAt,
      deadlineAt: requestedAt + timeoutMs,
      completedAt: null,
      failure: null
    }
  });
}

function expireProtectionRuntimeReload(state, context = {}) {
  if (!matchesLifecycle(state, context) || state.phase === 'stopped' || state.reload.status !== 'pending') return state;
  const now = normalizeTimestamp(context.now);
  if (now === null) throw new TypeError('now must be a non-negative finite timestamp');
  if (now < state.reload.deadlineAt) return state;
  return freezeState({
    ...state,
    reload: {
      ...state.reload,
      status: 'timed-out',
      completedAt: now,
      failure: {
        code: 'reload-timeout',
        message: 'Protection runtime did not acknowledge the reload before its deadline.'
      }
    }
  });
}

function endProtectionRuntimeLifecycle(state, context = {}) {
  if (!matchesLifecycle(state, context) || state.phase === 'stopped') return state;
  return freezeState({
    ...state,
    phase: 'stopped',
    reload: state.reload.status === 'pending' ? {
      ...state.reload,
      status: 'failed',
      completedAt: normalizeTimestamp(context.now),
      failure: {
        code: 'runtime-stopped',
        message: 'Protection runtime stopped before acknowledging the reload.'
      }
    } : state.reload
  });
}

function getProtectionRuntimeStatus(state) {
  return state && typeof state === 'object' ? state : createProtectionRuntimeHandshake();
}

module.exports = {
  DEFAULT_EXPECTED_CHECK_COUNT,
  DEFAULT_RELOAD_TIMEOUT_MS,
  MAX_LOG_LINE_LENGTH,
  createProtectionRuntimeHandshake,
  beginProtectionRuntimeLifecycle,
  observeProtectionRuntimeLine,
  requestProtectionRuntimeReload,
  expireProtectionRuntimeReload,
  endProtectionRuntimeLifecycle,
  getProtectionRuntimeStatus,
  parseProtectionRuntimeLine
};
