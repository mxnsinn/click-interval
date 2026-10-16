'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fsp = require('node:fs/promises');

const SUPPORTED_MINECRAFT_VERSION = '26.2';
const VELOCITY_CONFIG_VERSION = '2.9';
const SETUP_MANIFEST_SCHEMA_VERSION = 1;
const DEFAULT_SECRET_BYTES = 48;
const MINIMUM_SECRET_BYTES = 32;
const VELOCITY_SERVER_NAMES = Object.freeze({ backend: 'main', limbo: 'maintenance' });
const LEGACY_MOTD_COLORS = Object.freeze({
  0: 'black',
  1: 'dark_blue',
  2: 'dark_green',
  3: 'dark_aqua',
  4: 'dark_red',
  5: 'dark_purple',
  6: 'gold',
  7: 'gray',
  8: 'dark_gray',
  9: 'blue',
  a: 'green',
  b: 'aqua',
  c: 'red',
  d: 'light_purple',
  e: 'yellow',
  f: 'white'
});
const LEGACY_MOTD_DECORATIONS = Object.freeze({
  k: 'obfuscated',
  l: 'bold',
  m: 'strikethrough',
  n: 'underlined',
  o: 'italic'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

const PINNED_ARTIFACTS = deepFreeze({
  velocity: {
    name: 'Velocity',
    version: '4.2.0',
    build: 30,
    fileName: 'velocity-4.2.0-30.jar',
    targetPath: 'velocity/velocity.jar',
    url: 'https://fill-data.papermc.io/v1/objects/35a5596a5468a035d8a32c8de5ebb0dc6b8d8f0cc3ff5169d514aca762af8aa8/velocity-4.2.0-30.jar',
    sha256: '35a5596a5468a035d8a32c8de5ebb0dc6b8d8f0cc3ff5169d514aca762af8aa8',
    size: 42_163_652,
    license: 'GPL-3.0-only',
    source: 'https://github.com/PaperMC/Velocity'
  },
  nanoLimbo: {
    name: 'NanoLimbo',
    version: '1.13.0',
    fileName: 'NanoLimbo.jar',
    targetPath: 'limbo/NanoLimbo.jar',
    url: 'https://github.com/Nan1t/NanoLimbo/releases/download/v1.13.0/NanoLimbo.jar',
    sha256: '884dc3d4941fb0964dfd348cebc66afb692b156a213cc980d6f47f02441432cf',
    size: 5_375_509,
    license: 'GPL-3.0-only',
    source: 'https://github.com/Nan1t/NanoLimbo'
  },
  fabricProxyLite: {
    name: 'FabricProxy-Lite',
    version: '2.12.0',
    fileName: 'FabricProxy-Lite-2.12.0.jar',
    targetPath: 'backend/mods/FabricProxy-Lite.jar',
    url: 'https://cdn.modrinth.com/data/8dI2tmqs/versions/CsEpiziv/FabricProxy-Lite-2.12.0.jar',
    sha256: 'dca0d05685afaa25d554372ad118d90b6b27f85ded93e6db0b85d822aa29342a',
    size: 73_512,
    license: 'MIT',
    source: 'https://github.com/OKTW-Network/FabricProxy-Lite'
  }
});

const DEFAULT_PATHS = deepFreeze({
  velocityConfig: 'velocity/velocity.toml',
  velocitySecret: 'velocity/forwarding.secret',
  nanoLimboSettings: 'limbo/settings.yml',
  nanoLimboSecret: 'limbo/forwarding.secret',
  fabricProxyLiteConfig: 'backend/config/FabricProxy-Lite.toml',
  thirdPartyNotices: 'THIRD-PARTY-NOTICES.txt',
  manifest: 'setup-manifest.json'
});

function assertSupportedMinecraftVersion(value = SUPPORTED_MINECRAFT_VERSION) {
  const version = String(value ?? '').trim();
  if (version !== SUPPORTED_MINECRAFT_VERSION) {
    const error = new RangeError(
      `Seamless restart setup supports Minecraft ${SUPPORTED_MINECRAFT_VERSION} only.`
    );
    error.code = 'SEAMLESS_RESTART_MINECRAFT_VERSION_UNSUPPORTED';
    throw error;
  }
  return version;
}

function requirePort(value, name, fallback) {
  const candidate = value === undefined ? fallback : value;
  const port = typeof candidate === 'string' && /^\d+$/.test(candidate.trim())
    ? Number(candidate.trim())
    : candidate;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function requireInteger(value, name, fallback, minimum, maximum) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return candidate;
}

function requireText(value, name, fallback, maximumLength = 512) {
  const text = String(value === undefined ? fallback : value);
  if (!text || text.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(`${name} must be non-empty text without control characters.`);
  }
  return text;
}

function normalizeHost(value, name, fallback) {
  let host = requireText(value, name, fallback, 253).trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || /[\s/\\?#@]/u.test(host) || host.includes('://')) {
    throw new TypeError(`${name} is not a safe host name or IP address.`);
  }
  if (!/^[a-z0-9_.:%-]+$/iu.test(host)) {
    throw new TypeError(`${name} is not a safe host name or IP address.`);
  }
  return host;
}

function isLoopbackHost(value) {
  const host = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const match = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  return Boolean(match && match.slice(1).every(part => Number(part) <= 255));
}

function requireLoopbackHost(value, name, fallback = '127.0.0.1') {
  const host = normalizeHost(value, name, fallback);
  if (!isLoopbackHost(host)) {
    const error = new TypeError(`${name} must use a loopback address.`);
    error.code = 'SEAMLESS_RESTART_NON_LOOPBACK_BIND';
    throw error;
  }
  return host;
}

function endpoint(host, port) {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function escapeMiniMessageText(value) {
  return String(value).replace(/\\/gu, '\\\\').replace(/</gu, '\\<');
}

/**
 * The server MOTD editor stores vanilla legacy formatting (section-sign
 * codes), while Velocity 4 parses its MOTD as MiniMessage and deliberately
 * rejects those codes. Render the legacy state into self-contained
 * MiniMessage spans so user text cannot accidentally become a tag and no
 * formatting state leaks between spans.
 */
function legacyMotdToMiniMessage(value) {
  const source = String(value ?? '');
  const state = { color: '', decorations: [] };
  let output = '';
  let text = '';

  const flush = () => {
    if (!text) return;
    const tags = [
      ...(state.color ? [state.color] : []),
      ...state.decorations
    ];
    output += tags.map(tag => `<${tag}>`).join('');
    output += escapeMiniMessageText(text);
    output += [...tags].reverse().map(tag => `</${tag}>`).join('');
    text = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '\u00a7') {
      text += source[index];
      continue;
    }

    const hex = source.slice(index).match(/^\u00a7x(?:\u00a7[0-9a-f]){6}/iu)?.[0];
    if (hex) {
      flush();
      state.color = `#${[...hex.matchAll(/\u00a7([0-9a-f])/giu)].map(match => match[1]).join('')}`;
      state.decorations = [];
      index += hex.length - 1;
      continue;
    }

    const code = String(source[index + 1] || '').toLowerCase();
    if (Object.hasOwn(LEGACY_MOTD_COLORS, code)) {
      flush();
      state.color = LEGACY_MOTD_COLORS[code];
      state.decorations = [];
      index += 1;
      continue;
    }
    if (Object.hasOwn(LEGACY_MOTD_DECORATIONS, code)) {
      flush();
      const decoration = LEGACY_MOTD_DECORATIONS[code];
      if (!state.decorations.includes(decoration)) state.decorations.push(decoration);
      index += 1;
      continue;
    }
    if (code === 'r') {
      flush();
      state.color = '';
      state.decorations = [];
      index += 1;
      continue;
    }

    // Never pass a section sign through to Velocity. Adventure intentionally
    // rejects legacy markers in MiniMessage input, including malformed user
    // sequences on newer releases. Preserve the following character as text.
  }
  flush();
  return output;
}

function requireForwardingSecret(value) {
  const secret = String(value ?? '');
  if (Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES ||
      /[\u0000-\u001f\u007f]/u.test(secret)) {
    const error = new TypeError(
      `The forwarding secret must contain at least ${MINIMUM_SECRET_BYTES} UTF-8 bytes and no control characters.`
    );
    error.code = 'SEAMLESS_RESTART_SECRET_INVALID';
    throw error;
  }
  return secret;
}

function normalizeSecretFile(value, fallback = 'forwarding.secret') {
  const fileName = requireText(value, 'secret file name', fallback, 100);
  if (path.posix.basename(fileName) !== fileName || path.win32.basename(fileName) !== fileName ||
      fileName === '.' || fileName === '..') {
    throw new TypeError('The secret file name must be a plain file name in the component working directory.');
  }
  return fileName;
}

function renderVelocityConfig(options = {}) {
  assertSupportedMinecraftVersion(options.minecraftVersion);
  const publicHost = normalizeHost(options.publicHost, 'Velocity bind host', '0.0.0.0');
  const publicPort = requirePort(options.publicPort, 'Velocity bind port', 25_565);
  const backendHost = requireLoopbackHost(options.backendHost, 'Minecraft backend host');
  const backendPort = requirePort(options.backendPort, 'Minecraft backend port', 25_566);
  const limboHost = requireLoopbackHost(options.limboHost, 'NanoLimbo host');
  const limboPort = requirePort(options.limboPort, 'NanoLimbo port', 25_567);
  if (new Set([publicPort, backendPort, limboPort]).size !== 3) {
    throw new RangeError('Velocity, the Minecraft backend, and NanoLimbo must use different ports.');
  }
  const motd = legacyMotdToMiniMessage(
    requireText(options.motd, 'Velocity MOTD', 'Click Interval Server', 512)
  ) || 'Click Interval Server';
  const showMaxPlayers = requireInteger(
    options.showMaxPlayers ?? options.maxPlayers,
    'Velocity displayed maximum players',
    100,
    1,
    100_000
  );
  const secretFile = normalizeSecretFile(options.secretFile);

  return [
    '# Generated by Click Interval. Changes may be replaced by seamless-restart setup.',
    `config-version = ${quote(VELOCITY_CONFIG_VERSION)}`,
    `bind = ${quote(endpoint(publicHost, publicPort))}`,
    `motd = ${quote(motd)}`,
    `show-max-players = ${showMaxPlayers}`,
    'online-mode = true',
    'force-key-authentication = true',
    'prevent-client-proxy-connections = false',
    'player-info-forwarding-mode = "modern"',
    `forwarding-secret-file = ${quote(secretFile)}`,
    'announce-forge = false',
    'kick-existing-players = false',
    'sample-players-in-ping = false',
    'enable-player-address-logging = false',
    '',
    '[ping-passthrough]',
    'version = false',
    'players = false',
    'description = false',
    'favicon = false',
    'modinfo = true',
    '',
    '[packet-limiter]',
    'interval = 7',
    'packets-per-second = -1',
    'bytes-per-second = -1',
    'decompressed-bytes-per-second = 5242880',
    '',
    '[servers]',
    `${VELOCITY_SERVER_NAMES.backend} = ${quote(endpoint(backendHost, backendPort))}`,
    `${VELOCITY_SERVER_NAMES.limbo} = ${quote(endpoint(limboHost, limboPort))}`,
    `try = [${quote(VELOCITY_SERVER_NAMES.backend)}]`,
    '',
    '[forced-hosts]',
    '',
    '[advanced]',
    'compression-threshold = 256',
    'compression-level = -1',
    'login-ratelimit = 3000',
    'connection-timeout = 5000',
    'read-timeout = 30000',
    'haproxy-protocol = false',
    'tcp-fast-open = false',
    'bungee-plugin-message-channel = true',
    'show-ping-requests = false',
    '# Maintenance routing is explicitly armed by the coordinator; never park ordinary failures.',
    'failover-on-unexpected-server-disconnect = false',
    'announce-proxy-commands = true',
    'log-command-executions = false',
    'log-player-connections = true',
    'accepts-transfers = false',
    'enable-reuse-port = false',
    'command-rate-limit = 50',
    'forward-commands-if-rate-limited = true',
    'kick-after-rate-limited-commands = 0',
    'tab-complete-rate-limit = 10',
    'kick-after-rate-limited-tab-completes = 0',
    '',
    '[query]',
    'enabled = false',
    `port = ${publicPort}`,
    'map = "Velocity"',
    'show-plugins = false',
    ''
  ].join('\n');
}

function renderNanoLimboSettings(options = {}) {
  assertSupportedMinecraftVersion(options.minecraftVersion);
  const host = requireLoopbackHost(options.host ?? options.limboHost, 'NanoLimbo host');
  const port = requirePort(options.port ?? options.limboPort, 'NanoLimbo port', 25_567);
  const maxPlayers = requireInteger(options.maxPlayers, 'NanoLimbo maximum players', 100, 1, 100_000);
  const message = requireText(
    options.message,
    'NanoLimbo restart message',
    '<yellow>The server is restarting. You will reconnect automatically.',
    512
  );
  const secretFile = normalizeSecretFile(options.secretFile);

  return [
    '# Generated by Click Interval for Windows. NanoLimbo is loopback-only.',
    'bind:',
    `  ip: ${quote(host)}`,
    `  port: ${port}`,
    `maxPlayers: ${maxPlayers}`,
    'ping:',
    `  description: ${quote(message)}`,
    '  version: "Click Interval restart lobby"',
    '  protocol: -1',
    'dimension: THE_END',
    'playerList:',
    '  enable: true',
    '  username: "Restarting"',
    'headerAndFooter:',
    '  enable: true',
    `  header: ${quote(message)}`,
    '  footer: "<gray>Please stay connected"',
    'gameMode: 3',
    'secureProfile: false',
    'brandName:',
    '  enable: true',
    '  content: "Click Interval restart lobby"',
    'joinMessage:',
    '  enable: true',
    `  text: ${quote(message)}`,
    'bossBar:',
    '  enable: true',
    `  text: ${quote(message)}`,
    '  health: 1.0',
    '  color: YELLOW',
    '  division: SOLID',
    'title:',
    '  enable: false',
    '  title: ""',
    '  subtitle: ""',
    '  fadeIn: 10',
    '  stay: 100',
    '  fadeOut: 10',
    'infoForwarding:',
    '  type: MODERN',
    `  secret: ${quote(`@${secretFile}`)}`,
    '  tokens: []',
    'readTimeout: 30000',
    'logPlayersIp: false',
    'debugLevel: 2',
    'netty:',
    '  transportType: NIO',
    '  threads:',
    '    bossGroup: 1',
    '    workerGroup: 2',
    'traffic:',
    '  enable: true',
    '  maxPacketSize: 8192',
    '  interval: 7.0',
    '  maxPacketRate: 500.0',
    '  maxPacketBytesRate: 2048.0',
    ''
  ].join('\n');
}

function renderFabricProxyLiteConfig(options = {}) {
  assertSupportedMinecraftVersion(options.minecraftVersion);
  const secret = requireForwardingSecret(options.forwardingSecret ?? options.secret);
  const disconnectMessage = requireText(
    options.disconnectMessage,
    'FabricProxy-Lite disconnect message',
    'Connect through the Click Interval server address.',
    512
  );
  return [
    '# Generated by Click Interval. This file contains a forwarding credential.',
    `hackOnlineMode = ${options.hackOnlineMode === false ? 'false' : 'true'}`,
    `hackEarlySend = ${options.hackEarlySend === true ? 'true' : 'false'}`,
    `hackMessageChain = ${options.hackMessageChain === true ? 'true' : 'false'}`,
    `disconnectMessage = ${quote(disconnectMessage)}`,
    `secret = ${quote(secret)}`,
    ''
  ].join('\n');
}

function parseFabricProxyLiteConfig(text) {
  const source = String(text || '');
  const stringValue = (key) => {
    const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*$`, 'mu'));
    if (!match) return '';
    try { return JSON.parse(match[1]); } catch { return ''; }
  };
  const booleanValue = (key) => {
    const match = source.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`, 'imu'));
    return match ? match[1].toLowerCase() === 'true' : null;
  };
  return Object.freeze({
    hackOnlineMode: booleanValue('hackOnlineMode'),
    hackEarlySend: booleanValue('hackEarlySend'),
    hackMessageChain: booleanValue('hackMessageChain'),
    disconnectMessage: stringValue('disconnectMessage'),
    secret: stringValue('secret')
  });
}

function isFabricProxyLiteConfigSemanticallyValid(text, expectedSecret) {
  const parsed = parseFabricProxyLiteConfig(text);
  return Boolean(
    expectedSecret &&
    parsed.secret === expectedSecret &&
    parsed.hackOnlineMode === true &&
    parsed.hackEarlySend === false &&
    parsed.hackMessageChain === false &&
    parsed.disconnectMessage
  );
}

function renderThirdPartyNotices() {
  const sections = [
    'CLICK INTERVAL SEAMLESS RESTART - THIRD-PARTY NOTICES',
    '',
    'The seamless-restart setup uses the following unmodified third-party artifacts.',
    'Their respective licenses govern those artifacts.',
    ''
  ];
  for (const artifact of Object.values(PINNED_ARTIFACTS)) {
    const buildSuffix = artifact.build ? ` (build ${artifact.build})` : '';
    sections.push(
      `${artifact.name} ${artifact.version}${buildSuffix}`,
      `License: ${artifact.license}`,
      `Source: ${artifact.source}`,
      `Artifact: ${artifact.url}`,
      `SHA-256: ${artifact.sha256}`,
      `Size: ${artifact.size} bytes`,
      ''
    );
  }
  return `${sections.join('\n').trimEnd()}\n`;
}

function generateForwardingSecret(options = {}) {
  const bytes = requireInteger(
    options.bytes,
    'forwarding secret byte count',
    DEFAULT_SECRET_BYTES,
    MINIMUM_SECRET_BYTES,
    4_096
  );
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const random = randomBytes(bytes);
  if (!Buffer.isBuffer(random) || random.length !== bytes) {
    throw new TypeError('The secure random source did not return the requested Buffer.');
  }
  return random.toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeRelativePath(value, name, fallback) {
  const raw = requireText(value, name, fallback, 240).replace(/\\/gu, '/');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || raw.includes(':')) {
    throw new TypeError(`${name} must be a relative setup path.`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') ||
      normalized.includes('/../')) {
    throw new TypeError(`${name} cannot leave the setup directory.`);
  }
  return normalized;
}

function normalizePaths(overrides = {}) {
  const paths = {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_PATHS)) {
    paths[key] = normalizeRelativePath(overrides[key], `${key} path`, defaultValue);
  }
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) {
    throw new TypeError('Every seamless-restart setup file must have a unique path.');
  }
  return Object.freeze(paths);
}

function publicManifestArtifact(artifact, targetPath) {
  return Object.freeze({
    name: artifact.name,
    version: artifact.version,
    ...(artifact.build ? { build: artifact.build } : {}),
    fileName: artifact.fileName,
    targetPath,
    url: artifact.url,
    sha256: artifact.sha256,
    size: artifact.size,
    license: artifact.license,
    source: artifact.source
  });
}

function createSetupManifest(options = {}) {
  const minecraftVersion = assertSupportedMinecraftVersion(options.minecraftVersion);
  const preparedAt = String(options.preparedAt || new Date().toISOString());
  if (Number.isNaN(Date.parse(preparedAt))) throw new TypeError('preparedAt must be an ISO-compatible timestamp.');
  const topology = options.topology || {};
  const publicHost = normalizeHost(topology.publicHost, 'manifest public host', '0.0.0.0');
  const publicPort = requirePort(topology.publicPort, 'manifest public port', 25_565);
  const backendHost = requireLoopbackHost(topology.backendHost, 'manifest backend host');
  const backendPort = requirePort(topology.backendPort, 'manifest backend port', 25_566);
  const limboHost = requireLoopbackHost(topology.limboHost, 'manifest limbo host');
  const limboPort = requirePort(topology.limboPort, 'manifest limbo port', 25_567);
  const fileMetadata = (options.files || []).map(file => {
    const relativePath = normalizeRelativePath(file.relativePath, 'prepared file path', '');
    const content = String(file.content ?? '');
    return Object.freeze({
      path: relativePath,
      sha256: sha256Text(content),
      size: Buffer.byteLength(content, 'utf8'),
      sensitive: file.sensitive === true
    });
  });
  const targets = options.artifactTargets || {};
  const artifacts = {};
  for (const [key, artifact] of Object.entries(PINNED_ARTIFACTS)) {
    const targetPath = normalizeRelativePath(
      targets[key],
      `${artifact.name} artifact target`,
      artifact.targetPath
    );
    artifacts[key] = publicManifestArtifact(artifact, targetPath);
  }
  return deepFreeze({
    schemaVersion: SETUP_MANIFEST_SCHEMA_VERSION,
    feature: 'seamless-restart',
    state: 'prepared',
    commitMarker: 'complete',
    preparedAt: new Date(preparedAt).toISOString(),
    minecraftVersion,
    velocityConfigVersion: VELOCITY_CONFIG_VERSION,
    topology: {
      public: { host: publicHost, port: publicPort },
      backend: { host: backendHost, port: backendPort },
      limbo: { host: limboHost, port: limboPort }
    },
    artifacts,
    files: fileMetadata,
    credentials: {
      forwardingSecret: {
        valueStoredInManifest: false,
        minimumBytes: MINIMUM_SECRET_BYTES,
        rotateByRepreparingSetup: true
      }
    }
  });
}

function freezePreparedFiles(files) {
  return Object.freeze(files.map(file => Object.freeze({ ...file })));
}

/**
 * Create all text files needed around the three pinned artifacts. Artifact
 * downloads and process changes deliberately remain the caller's responsibility.
 * The manifest is last: callers can atomically write it only after every other
 * file and artifact has been verified in its final location.
 */
function createSeamlessRestartSetup(options = {}) {
  const minecraftVersion = assertSupportedMinecraftVersion(options.minecraftVersion);
  const paths = normalizePaths(options.paths);
  if (path.posix.dirname(paths.velocityConfig) !== path.posix.dirname(paths.velocitySecret)) {
    throw new TypeError('Velocity configuration and forwarding.secret must share a working directory.');
  }
  if (path.posix.dirname(paths.nanoLimboSettings) !== path.posix.dirname(paths.nanoLimboSecret)) {
    throw new TypeError('NanoLimbo settings and forwarding.secret must share a working directory.');
  }
  const forwardingSecret = options.forwardingSecret
    ? requireForwardingSecret(options.forwardingSecret)
    : generateForwardingSecret(options.secretGeneration);
  const topology = {
    publicHost: normalizeHost(options.publicHost, 'Velocity bind host', '0.0.0.0'),
    publicPort: requirePort(options.publicPort, 'Velocity bind port', 25_565),
    backendHost: requireLoopbackHost(options.backendHost, 'Minecraft backend host'),
    backendPort: requirePort(options.backendPort, 'Minecraft backend port', 25_566),
    limboHost: requireLoopbackHost(options.limboHost, 'NanoLimbo host'),
    limboPort: requirePort(options.limboPort, 'NanoLimbo port', 25_567)
  };
  if (new Set([topology.publicPort, topology.backendPort, topology.limboPort]).size !== 3) {
    throw new RangeError('Velocity, the Minecraft backend, and NanoLimbo must use different ports.');
  }
  const preparedFiles = freezePreparedFiles([
    {
      relativePath: paths.velocityConfig,
      content: renderVelocityConfig({
        ...options,
        minecraftVersion,
        ...topology,
        secretFile: path.posix.basename(paths.velocitySecret)
      }),
      sensitive: false,
      mode: 0o600
    },
    {
      relativePath: paths.velocitySecret,
      content: `${forwardingSecret}\n`,
      sensitive: true,
      mode: 0o600
    },
    {
      relativePath: paths.nanoLimboSettings,
      content: renderNanoLimboSettings({
        minecraftVersion,
        host: topology.limboHost,
        port: topology.limboPort,
        maxPlayers: options.maxPlayers,
        message: options.restartMessage,
        secretFile: path.posix.basename(paths.nanoLimboSecret)
      }),
      sensitive: false,
      mode: 0o600
    },
    {
      relativePath: paths.nanoLimboSecret,
      content: `${forwardingSecret}\n`,
      sensitive: true,
      mode: 0o600
    },
    {
      relativePath: paths.fabricProxyLiteConfig,
      content: renderFabricProxyLiteConfig({
        minecraftVersion,
        forwardingSecret,
        disconnectMessage: options.disconnectMessage,
        hackOnlineMode: options.hackOnlineMode,
        hackEarlySend: options.hackEarlySend,
        hackMessageChain: options.hackMessageChain
      }),
      sensitive: true,
      mode: 0o600
    },
    {
      relativePath: paths.thirdPartyNotices,
      content: renderThirdPartyNotices(),
      sensitive: false,
      mode: 0o644
    }
  ]);
  const manifest = createSetupManifest({
    minecraftVersion,
    preparedAt: options.preparedAt,
    topology,
    files: preparedFiles,
    artifactTargets: options.artifactTargets
  });
  const manifestFile = Object.freeze({
    relativePath: paths.manifest,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
    sensitive: false,
    mode: 0o600,
    commitFile: true
  });
  return Object.freeze({
    minecraftVersion,
    paths,
    artifacts: PINNED_ARTIFACTS,
    files: Object.freeze([...preparedFiles, manifestFile]),
    manifest,
    manifestPath: paths.manifest
  });
}

async function writeSetupManifestAtomic(targetPath, manifest, io = {}) {
  const mkdir = io.mkdir || fsp.mkdir;
  const writeFile = io.writeFile || fsp.writeFile;
  const rename = io.rename || fsp.rename;
  const unlink = io.unlink || fsp.unlink;
  const randomBytes = io.randomBytes || crypto.randomBytes;
  const absoluteTarget = path.resolve(String(targetPath));
  const directory = path.dirname(absoluteTarget);
  const rawNonce = io.nonce || randomBytes(8).toString('hex');
  const nonce = String(rawNonce).replace(/[^a-z0-9_-]/giu, '');
  if (!nonce) throw new TypeError('The atomic manifest nonce is invalid.');
  const temporaryPath = path.join(directory, `.${path.basename(absoluteTarget)}.${nonce}.tmp`);
  const content = typeof manifest === 'string'
    ? `${manifest.trimEnd()}\n`
    : `${JSON.stringify(manifest, null, 2)}\n`;
  let temporaryCreated = false;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    temporaryCreated = true;
    await rename(temporaryPath, absoluteTarget);
    temporaryCreated = false;
  } catch (error) {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original failure; the uniquely named temp file is inert.
      }
    }
    throw error;
  }
  return Object.freeze({
    path: absoluteTarget,
    size: Buffer.byteLength(content, 'utf8'),
    sha256: sha256Text(content)
  });
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function isVelocityReadyLog(line) {
  const text = stripAnsi(line);
  return /\bListening on \/?(?:\[[^\]]+\]|[^\s:]+):\d{1,5}\b/iu.test(text) ||
    /\bDone \([\d.]+s\)!\b.*\bVelocity\b/iu.test(text);
}

function isNanoLimboReadyLog(line) {
  return /\bServer started on \/?(?:\[[^\]]+\]|[^\s:]+):\d{1,5}\b/iu.test(stripAnsi(line));
}

function isBackendReadyLog(line) {
  return /\bDone \([^)]+\)!\s+For help, type ["']?help["']?/iu.test(stripAnsi(line));
}

function isFabricProxyLiteReadyLog(line) {
  return /(?:^|\s|[-:])fabricproxy-lite(?:\s+|@|\s+v)2\.12\.0\b/iu.test(stripAnsi(line));
}

const READINESS_PREDICATES = Object.freeze({
  velocity: isVelocityReadyLog,
  nanoLimbo: isNanoLimboReadyLog,
  backend: isBackendReadyLog,
  fabricProxyLite: isFabricProxyLiteReadyLog
});

function matchesReadinessLog(component, line) {
  const key = String(component ?? '').replace(/[-_\s]/gu, '').toLowerCase();
  const aliases = {
    velocity: 'velocity',
    nanolimbo: 'nanoLimbo',
    limbo: 'nanoLimbo',
    maintenance: 'nanoLimbo',
    backend: 'backend',
    minecraft: 'backend',
    fabricproxylite: 'fabricProxyLite'
  };
  const predicate = READINESS_PREDICATES[aliases[key]];
  if (!predicate) throw new TypeError(`Unknown seamless-restart component: ${component}`);
  return predicate(line);
}

function readinessFromLogs(logs = {}) {
  const values = component => {
    const value = logs[component];
    return Array.isArray(value) ? value : value === undefined ? [] : [value];
  };
  return Object.freeze({
    velocity: values('velocity').some(isVelocityReadyLog),
    nanoLimbo: [...values('nanoLimbo'), ...values('limbo'), ...values('maintenance')].some(isNanoLimboReadyLog),
    backend: [...values('backend'), ...values('minecraft')].some(isBackendReadyLog),
    fabricProxyLite: values('fabricProxyLite').some(isFabricProxyLiteReadyLog)
  });
}

module.exports = {
  DEFAULT_PATHS,
  DEFAULT_SECRET_BYTES,
  MINIMUM_SECRET_BYTES,
  PINNED_ARTIFACTS,
  READINESS_PREDICATES,
  SETUP_MANIFEST_SCHEMA_VERSION,
  SUPPORTED_MINECRAFT_VERSION,
  VELOCITY_SERVER_NAMES,
  VELOCITY_CONFIG_VERSION,
  assertSupportedMinecraftVersion,
  createSeamlessRestartSetup,
  createSetupManifest,
  generateForwardingSecret,
  isBackendReadyLog,
  isFabricProxyLiteConfigSemanticallyValid,
  isFabricProxyLiteReadyLog,
  isLoopbackHost,
  isNanoLimboReadyLog,
  isVelocityReadyLog,
  legacyMotdToMiniMessage,
  matchesReadinessLog,
  parseFabricProxyLiteConfig,
  readinessFromLogs,
  renderFabricProxyLiteConfig,
  renderNanoLimboSettings,
  renderThirdPartyNotices,
  renderVelocityConfig,
  sha256Text,
  writeSetupManifestAtomic
};
