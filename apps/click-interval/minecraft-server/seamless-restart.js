'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEFAULT_PUBLIC_PORT = 25_565;
const MIN_UNPRIVILEGED_PORT = 1_024;
const MAX_PORT = 65_535;
const LOOPBACK_HOST = '127.0.0.1';
const MIN_JAVA_MAJOR = 25;
const MIN_SHARED_SECRET_BYTES = 32;
const SUPPORTED_FABRIC_VERSIONS = Object.freeze(['26.2', '26.3']);
const REQUIRED_ARTIFACTS = Object.freeze([
  Object.freeze({ key: 'velocity', label: 'Velocity' }),
  Object.freeze({ key: 'nanoLimbo', label: 'NanoLimbo' }),
  Object.freeze({ key: 'fabricProxyLite', label: 'FabricProxy-Lite' })
]);

function booleanValue(value, fallback = false) {
  if (value === true || value === 1 || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || value === 0 || String(value).trim().toLowerCase() === 'false') return false;
  return fallback;
}

function normalizePort(value, fallback = null) {
  const parsed = typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value)
    ? Number(value.trim())
    : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PORT ? parsed : fallback;
}

function normalizeHost(value, fallback) {
  const host = String(value ?? '').trim();
  if (!host || /[\s/\\]/.test(host) || host.includes('://')) return fallback;
  return host.replace(/^\[([^\]]+)]$/, '$1');
}

function isLoopbackHost(value) {
  const host = normalizeHost(value, '').toLowerCase().replace(/%[0-9a-z_.-]+$/i, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').slice(1).every(part => Number(part) <= 255);
  }
  const mapped = host.match(/^::ffff:(127(?:\.\d{1,3}){3})$/);
  return Boolean(mapped && isLoopbackHost(mapped[1]));
}

function normalizeReservedPorts(values) {
  const ports = new Set();
  for (const value of values || []) {
    const port = normalizePort(value);
    if (port !== null) ports.add(port);
  }
  return ports;
}

function nextPort(port, minimum, maximum) {
  return port >= maximum ? minimum : port + 1;
}

function findFreePort(preferred, blocked, minimum, maximum) {
  let candidate = normalizePort(preferred);
  if (candidate === null || candidate < minimum || candidate > maximum) candidate = minimum;
  const rangeSize = maximum - minimum + 1;
  for (let attempt = 0; attempt < rangeSize; attempt += 1) {
    if (!blocked.has(candidate)) return candidate;
    candidate = nextPort(candidate, minimum, maximum);
  }
  const error = new Error('No two safe loopback ports are available for seamless restart services.');
  error.code = 'NO_SEAMLESS_RESTART_PORTS';
  throw error;
}

/**
 * Choose deterministic, non-overlapping backend and limbo ports. The caller
 * should pass every other managed TCP/UDP port (query, RCON, voice, etc.) in
 * reservedPorts. OS port availability remains a separate runtime preflight.
 */
function deriveSeamlessRestartPorts(publicPort, options = {}) {
  const proxyPort = normalizePort(publicPort);
  if (proxyPort === null) throw new RangeError('The public Minecraft port must be between 1 and 65535.');

  const minimum = normalizePort(options.rangeStart, MIN_UNPRIVILEGED_PORT);
  const maximum = normalizePort(options.rangeEnd, MAX_PORT);
  if (minimum > maximum || maximum - minimum < 1) {
    const error = new RangeError('The seamless-restart port range must contain at least two ports.');
    error.code = 'INVALID_SEAMLESS_RESTART_PORT_RANGE';
    throw error;
  }

  const blocked = normalizeReservedPorts(options.reservedPorts);
  blocked.add(proxyPort);
  const defaultBackend = proxyPort >= minimum && proxyPort < maximum ? proxyPort + 1 : minimum;
  const backendPort = findFreePort(options.backendPort ?? defaultBackend, blocked, minimum, maximum);
  blocked.add(backendPort);
  const limboPort = findFreePort(options.limboPort ?? nextPort(backendPort, minimum, maximum), blocked, minimum, maximum);
  return Object.freeze({ publicPort: proxyPort, backendPort, limboPort });
}

function planSeamlessRestartConfiguration(rawConfig = {}, context = {}) {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const localOnly = booleanValue(source.localOnly, booleanValue(context.localOnly, false));
  const publicPort = normalizePort(source.proxyPort ?? source.publicPort ?? context.publicPort, DEFAULT_PUBLIC_PORT);
  const requestedProxyHost = normalizeHost(
    source.proxyHost ?? source.publicHost ?? context.publicHost,
    localOnly ? LOOPBACK_HOST : '0.0.0.0'
  );
  const proxyHost = localOnly && !isLoopbackHost(requestedProxyHost) ? LOOPBACK_HOST : requestedProxyHost;
  const requestedBackendHost = normalizeHost(source.backendHost, LOOPBACK_HOST);
  const requestedLimboHost = normalizeHost(source.limboHost, LOOPBACK_HOST);
  const ports = deriveSeamlessRestartPorts(publicPort, {
    backendPort: source.backendPort,
    limboPort: source.limboPort,
    reservedPorts: context.reservedPorts,
    rangeStart: context.portRangeStart,
    rangeEnd: context.portRangeEnd
  });
  const config = Object.freeze({
    schemaVersion: 1,
    enabled: booleanValue(source.enabled, false),
    localOnly,
    proxyHost,
    proxyPort: ports.publicPort,
    backendHost: isLoopbackHost(requestedBackendHost) ? requestedBackendHost : LOOPBACK_HOST,
    backendPort: ports.backendPort,
    limboHost: isLoopbackHost(requestedLimboHost) ? requestedLimboHost : LOOPBACK_HOST,
    limboPort: ports.limboPort
  });
  const changes = [];
  if (source.enabled === undefined) changes.push('Seamless restart remains disabled until its proxy stack passes preflight.');
  if (proxyHost !== requestedProxyHost) changes.push('The proxy bind was restricted to loopback for local-only mode.');
  if (config.backendHost !== requestedBackendHost) changes.push('The backend bind was restricted to loopback.');
  if (config.limboHost !== requestedLimboHost) changes.push('The limbo bind was restricted to loopback.');
  const requestedBackendPort = normalizePort(source.backendPort);
  const requestedLimboPort = normalizePort(source.limboPort);
  if (requestedBackendPort !== null && requestedBackendPort !== config.backendPort) {
    changes.push(`Backend port ${requestedBackendPort} collided with another managed port; planned ${config.backendPort}.`);
  }
  if (requestedLimboPort !== null && requestedLimboPort !== config.limboPort) {
    changes.push(`Limbo port ${requestedLimboPort} collided with another managed port; planned ${config.limboPort}.`);
  }
  return Object.freeze({ config, changes: Object.freeze(changes) });
}

function normalizeSeamlessRestartConfig(rawConfig = {}, context = {}) {
  return planSeamlessRestartConfiguration(rawConfig, context).config;
}

function normalizeSha256(value) {
  const hash = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

async function sha256File(filePath, options = {}) {
  const createReadStream = options.createReadStream || fs.createReadStream;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function artifactReasonCode(key, suffix) {
  return `${key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_${suffix}`;
}

/**
 * Verify only caller-supplied, pinned artifact metadata. This module does not
 * guess versions, URLs, file names, or hashes and never downloads a file.
 */
async function verifySeamlessRestartArtifacts(metadata = {}, options = {}) {
  const stat = options.stat || fsp.stat;
  const hashFile = options.hashFile || (filePath => sha256File(filePath, options));
  const artifacts = {};
  for (const required of REQUIRED_ARTIFACTS) {
    const descriptor = metadata?.[required.key] || {};
    const filePath = String(descriptor.filePath ?? descriptor.path ?? '').trim();
    const expectedSha256 = normalizeSha256(descriptor.sha256);
    const result = {
      key: required.key,
      label: required.label,
      filePath,
      metadataReady: Boolean(filePath && expectedSha256),
      exists: false,
      hashVerified: false,
      ready: false,
      code: '',
      message: ''
    };
    if (!result.metadataReady) {
      result.code = artifactReasonCode(required.key, 'METADATA_MISSING');
      result.message = `${required.label} needs a pinned local path and SHA-256 before it can be installed.`;
      artifacts[required.key] = Object.freeze(result);
      continue;
    }
    try {
      const info = await stat(filePath);
      result.exists = Boolean(info?.isFile?.());
      if (!result.exists) {
        result.code = artifactReasonCode(required.key, 'NOT_A_FILE');
        result.message = `${required.label} is not a regular file.`;
      } else {
        const actualSha256 = normalizeSha256(await hashFile(filePath));
        result.hashVerified = Boolean(actualSha256 && actualSha256 === expectedSha256);
        if (!result.hashVerified) {
          result.code = artifactReasonCode(required.key, 'HASH_MISMATCH');
          result.message = `${required.label} failed SHA-256 verification.`;
        } else {
          result.ready = true;
          result.code = 'VERIFIED';
          result.message = `${required.label} passed SHA-256 verification.`;
        }
      }
    } catch (error) {
      result.code = error?.code === 'ENOENT'
        ? artifactReasonCode(required.key, 'MISSING')
        : artifactReasonCode(required.key, 'INSPECTION_FAILED');
      result.message = error?.code === 'ENOENT'
        ? `${required.label} is not installed.`
        : `${required.label} could not be safely inspected.`;
    }
    artifacts[required.key] = Object.freeze(result);
  }
  const ready = REQUIRED_ARTIFACTS.every(({ key }) => artifacts[key].ready);
  return Object.freeze({ ready, artifacts: Object.freeze(artifacts) });
}

function parseJavaMajor(value) {
  if (Number.isInteger(value) && value > 0) return value;
  const text = String(value ?? '').trim();
  const quoted = text.match(/(?:version\s+)?["']?((?:1\.)?\d+)(?:\.|["'])/i);
  const plain = text.match(/^((?:1\.)?\d+)(?:\.|$)/);
  const token = (quoted || plain)?.[1] || '';
  if (!token) return null;
  const parts = token.split('.').map(Number);
  return parts[0] === 1 && parts[1] ? parts[1] : parts[0];
}

function secretState(input = {}, minimumBytes = MIN_SHARED_SECRET_BYTES) {
  const requestedMinimum = Number.parseInt(minimumBytes, 10);
  const requiredBytes = Number.isInteger(requestedMinimum)
    ? Math.max(MIN_SHARED_SECRET_BYTES, requestedMinimum)
    : MIN_SHARED_SECRET_BYTES;
  const proxySecret = typeof input.velocity === 'string' ? input.velocity : input.proxySecret;
  const backendSecret = typeof input.fabricProxyLite === 'string' ? input.fabricProxyLite : input.backendSecret;
  if (typeof proxySecret === 'string' || typeof backendSecret === 'string') {
    const proxyBuffer = Buffer.from(String(proxySecret ?? ''), 'utf8');
    const backendBuffer = Buffer.from(String(backendSecret ?? ''), 'utf8');
    const configured = proxyBuffer.length > 0 && backendBuffer.length > 0;
    const matches = configured && proxyBuffer.length === backendBuffer.length &&
      crypto.timingSafeEqual(proxyBuffer, backendBuffer);
    const strongEnough = configured && proxyBuffer.length >= requiredBytes && backendBuffer.length >= requiredBytes;
    return Object.freeze({ configured, matches, strongEnough, ready: configured && matches && strongEnough });
  }
  const configured = input.configured === true;
  const matches = input.matches === true;
  const strongEnough = input.strongEnough === true;
  return Object.freeze({ configured, matches, strongEnough, ready: configured && matches && strongEnough });
}

function componentState(components, key) {
  const value = components?.[key];
  return value && typeof value === 'object' ? value : {};
}

function addReason(reasons, code, message, component, phase = 'setup') {
  reasons.push(Object.freeze({ code, message, component, phase, blocking: true }));
}

function matchesBinding(actual, expectedHost, expectedPort) {
  if (!actual || typeof actual !== 'object') return false;
  return normalizeHost(actual.host, '') === normalizeHost(expectedHost, '') &&
    normalizePort(actual.port) === normalizePort(expectedPort);
}

/**
 * Turn observed setup/runtime facts into a fail-closed command status. Missing
 * facts are blockers; a desired config is never mistaken for an installed or
 * running proxy stack.
 */
function evaluateSeamlessRestartPreflight(configInput = {}, observed = {}, options = {}) {
  const config = normalizeSeamlessRestartConfig(configInput, {
    localOnly: observed.localOnly,
    publicPort: observed.publicPort,
    publicHost: observed.publicHost,
    reservedPorts: observed.reservedPorts,
    portRangeStart: options.portRangeStart,
    portRangeEnd: options.portRangeEnd
  });
  const supportedVersions = Array.isArray(options.supportedFabricVersions) && options.supportedFabricVersions.length
    ? options.supportedFabricVersions.map(value => String(value).trim())
    : SUPPORTED_FABRIC_VERSIONS;
  const minimumJavaMajor = Math.max(
    MIN_JAVA_MAJOR,
    Number.parseInt(options.minimumJavaMajor, 10) || MIN_JAVA_MAJOR
  );
  const minimumSecretBytes = Math.max(
    MIN_SHARED_SECRET_BYTES,
    Number.parseInt(options.minimumSecretBytes, 10) || MIN_SHARED_SECRET_BYTES
  );
  const reasons = [];

  if (!config.enabled) {
    addReason(reasons, 'FEATURE_DISABLED', 'Seamless restart is disabled until setup passes preflight.', 'feature', 'enablement');
  }

  const serverType = String(observed.serverType ?? observed.server?.type ?? '').trim().toLowerCase();
  const minecraftVersion = String(observed.minecraftVersion ?? observed.server?.minecraftVersion ?? '').trim();
  if (serverType !== 'fabric') {
    addReason(reasons, 'FABRIC_REQUIRED', 'Seamless restart currently requires a Fabric backend.', 'backend');
  }
  if (!supportedVersions.includes(minecraftVersion)) {
    addReason(reasons, 'MINECRAFT_VERSION_UNSUPPORTED',
      `Seamless restart supports Fabric ${supportedVersions.join(' or ')}; this backend reports ${minecraftVersion || 'no version'}.`,
      'backend');
  }
  const javaAvailable = observed.javaAvailable ?? observed.java?.available;
  const javaMajor = parseJavaMajor(observed.javaMajor ?? observed.javaVersion ??
    observed.java?.major ?? observed.java?.version);
  if (javaAvailable === false) {
    addReason(reasons, 'JAVA_UNAVAILABLE', 'A verified Java runtime is not available.', 'java');
  } else if (javaMajor === null) {
    addReason(reasons, 'JAVA_VERSION_UNVERIFIED', 'The Java runtime version has not been verified.', 'java');
  } else if (javaMajor < minimumJavaMajor) {
    addReason(reasons, 'JAVA_VERSION_UNSUPPORTED',
      `Java ${minimumJavaMajor} or newer is required; Java ${javaMajor} was detected.`, 'java');
  }

  const artifactReport = observed.artifactReport || observed.artifacts || {};
  const artifactStates = artifactReport.artifacts || artifactReport;
  for (const required of REQUIRED_ARTIFACTS) {
    const state = artifactStates?.[required.key];
    if (state?.ready !== true || state?.hashVerified !== true) {
      addReason(reasons, state?.code || artifactReasonCode(required.key, 'UNVERIFIED'),
        state?.message || `${required.label} has not passed pinned SHA-256 verification.`, required.key);
    }
  }

  const components = observed.components || {};
  const velocity = componentState(components, 'velocity');
  const nanoLimbo = componentState(components, 'nanoLimbo');
  const fabricProxyLite = componentState(components, 'fabricProxyLite');
  const backend = componentState(components, 'backend');
  if (velocity.configured !== true) {
    addReason(reasons, 'VELOCITY_NOT_CONFIGURED', 'Velocity routing and forwarding are not verified.', 'velocity');
  }
  if (nanoLimbo.configured !== true) {
    addReason(reasons, 'NANO_LIMBO_NOT_CONFIGURED', 'NanoLimbo is not configured as the restart holding server.', 'nanoLimbo');
  }
  if (fabricProxyLite.configured !== true) {
    addReason(reasons, 'FABRIC_PROXY_LITE_NOT_CONFIGURED', 'FabricProxy-Lite forwarding is not verified on the backend.', 'fabricProxyLite');
  }
  if (backend.configured !== true) {
    addReason(reasons, 'BACKEND_NOT_CONFIGURED', 'The managed Minecraft backend has not been moved behind the proxy.', 'backend');
  }

  const secret = secretState(observed.sharedSecret, minimumSecretBytes);
  if (!secret.configured) {
    addReason(reasons, 'SHARED_SECRET_MISSING', 'Velocity and FabricProxy-Lite need a shared forwarding secret.', 'forwarding');
  } else if (!secret.matches) {
    addReason(reasons, 'SHARED_SECRET_MISMATCH', 'Velocity and FabricProxy-Lite forwarding secrets do not match.', 'forwarding');
  } else if (!secret.strongEnough) {
    addReason(reasons, 'SHARED_SECRET_TOO_SHORT',
      `The forwarding secret must contain at least ${minimumSecretBytes} UTF-8 bytes.`,
      'forwarding');
  }

  const bindings = observed.bindings;
  const observedLocalOnly = typeof observed.localOnly === 'boolean' ? observed.localOnly : null;
  if (observedLocalOnly !== null && observedLocalOnly !== config.localOnly) {
    addReason(reasons, 'NETWORK_MODE_MISMATCH',
      'The observed public/local-only mode does not match the seamless-restart plan.', 'network');
  }
  if (!bindings || typeof bindings !== 'object') {
    addReason(reasons, 'NETWORK_BINDINGS_UNVERIFIED', 'Proxy, limbo, and backend bindings have not been inspected.', 'network');
  } else {
    if (!matchesBinding(bindings.proxy, config.proxyHost, config.proxyPort)) {
      addReason(reasons, 'PROXY_BIND_MISMATCH', 'Velocity is not bound to the planned public endpoint.', 'velocity');
    }
    if ((config.localOnly || observedLocalOnly === true) && !isLoopbackHost(bindings.proxy?.host)) {
      addReason(reasons, 'LOCAL_ONLY_PROXY_EXPOSED', 'Local-only mode requires the Velocity listener to use loopback.', 'velocity');
    }
    if (!matchesBinding(bindings.backend, config.backendHost, config.backendPort) ||
        !isLoopbackHost(bindings.backend?.host)) {
      addReason(reasons, 'BACKEND_NOT_LOOPBACK', 'The Minecraft backend must use its planned loopback endpoint.', 'backend');
    }
    if (!matchesBinding(bindings.limbo, config.limboHost, config.limboPort) ||
        !isLoopbackHost(bindings.limbo?.host)) {
      addReason(reasons, 'LIMBO_NOT_LOOPBACK', 'NanoLimbo must use its planned loopback endpoint.', 'nanoLimbo');
    }
    const actualPorts = [bindings.proxy?.port, bindings.backend?.port, bindings.limbo?.port]
      .map(value => normalizePort(value)).filter(value => value !== null);
    if (new Set(actualPorts).size !== actualPorts.length) {
      addReason(reasons, 'NETWORK_PORT_COLLISION', 'Proxy, backend, and limbo endpoints cannot share a port.', 'network');
    }
  }

  if (velocity.running !== true) {
    addReason(reasons, 'VELOCITY_NOT_RUNNING', 'The persistent Velocity proxy is not running.', 'velocity', 'runtime');
  }
  if (nanoLimbo.ready !== true) {
    addReason(reasons, 'NANO_LIMBO_NOT_READY', 'The holding server is not ready to receive players.', 'nanoLimbo', 'runtime');
  }
  if (fabricProxyLite.loaded !== true) {
    addReason(reasons, 'FABRIC_PROXY_LITE_NOT_LOADED', 'The backend has not confirmed FabricProxy-Lite is loaded.', 'fabricProxyLite', 'runtime');
  }
  if (backend.ready !== true) {
    addReason(reasons, 'BACKEND_NOT_READY', 'The managed backend is not ready for a controlled restart.', 'backend', 'runtime');
  }

  const setupReasons = reasons.filter(reason => !['enablement', 'runtime'].includes(reason.phase));
  const runtimeReasons = reasons.filter(reason => reason.phase === 'runtime');
  const setupReady = setupReasons.length === 0;
  const runtimeReady = runtimeReasons.length === 0;
  const canEnable = setupReady;
  const canSilentRestart = config.enabled && setupReady && runtimeReady;
  const state = canSilentRestart ? 'ready'
    : !config.enabled ? 'disabled'
      : !setupReady ? 'blocked'
        : 'waiting';
  return Object.freeze({
    state,
    enabled: config.enabled,
    available: canSilentRestart,
    canEnable,
    canSilentRestart,
    setupReady,
    runtimeReady,
    server: Object.freeze({ type: serverType, minecraftVersion, javaAvailable: javaAvailable !== false, javaMajor, minimumJavaMajor }),
    network: Object.freeze({
      localOnly: config.localOnly,
      proxy: Object.freeze({ host: config.proxyHost, port: config.proxyPort }),
      backend: Object.freeze({ host: config.backendHost, port: config.backendPort }),
      limbo: Object.freeze({ host: config.limboHost, port: config.limboPort })
    }),
    artifactsReady: REQUIRED_ARTIFACTS.every(({ key }) =>
      artifactStates?.[key]?.ready === true && artifactStates?.[key]?.hashVerified === true),
    secret,
    reasons: Object.freeze(reasons)
  });
}

async function createSeamlessRestartPlan(rawConfig = {}, environment = {}, options = {}) {
  const configuration = planSeamlessRestartConfiguration(rawConfig, {
    localOnly: environment.localOnly,
    publicPort: environment.publicPort,
    publicHost: environment.publicHost,
    reservedPorts: environment.reservedPorts,
    portRangeStart: options.portRangeStart,
    portRangeEnd: options.portRangeEnd
  });
  const artifactReport = options.artifactReport || await verifySeamlessRestartArtifacts(
    options.artifactMetadata,
    options.artifactVerification
  );
  const status = evaluateSeamlessRestartPreflight(configuration.config, {
    ...environment,
    artifactReport
  }, options);
  return Object.freeze({
    config: configuration.config,
    changes: configuration.changes,
    artifactReport,
    status,
    requiredComponents: Object.freeze(REQUIRED_ARTIFACTS.map(item => item.label))
  });
}

module.exports = {
  DEFAULT_PUBLIC_PORT,
  LOOPBACK_HOST,
  MAX_PORT,
  MIN_JAVA_MAJOR,
  MIN_SHARED_SECRET_BYTES,
  MIN_UNPRIVILEGED_PORT,
  REQUIRED_ARTIFACTS,
  SUPPORTED_FABRIC_VERSIONS,
  createSeamlessRestartPlan,
  deriveSeamlessRestartPorts,
  evaluateSeamlessRestartPreflight,
  isLoopbackHost,
  normalizePort,
  normalizeSeamlessRestartConfig,
  parseJavaMajor,
  planSeamlessRestartConfiguration,
  secretState,
  sha256File,
  verifySeamlessRestartArtifacts
};
