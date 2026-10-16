'use strict';

const net = require('node:net');

const DEFAULT_VOICE_UDP_PORT = 24_454;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const PLAYIT_TCP_HOST_SUFFIXES = Object.freeze([
  'playit.gg',
  'playit.cloud',
  'joinmc.link',
  'ply.gg'
]);

function normalizeOptionalUdpPort(value, fallback = null) {
  let port = null;
  if (typeof value === 'number') {
    port = Number.isInteger(value) ? value : null;
  } else if (typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value)) {
    port = Number(value.trim());
  }
  if (port !== null && port >= MIN_PORT && port <= MAX_PORT) return port;

  if (fallback === null || fallback === undefined || fallback === '') return null;
  if (typeof fallback === 'number' && Number.isInteger(fallback) && fallback >= MIN_PORT && fallback <= MAX_PORT) {
    return fallback;
  }
  if (typeof fallback === 'string' && /^\s*\d{1,5}\s*$/.test(fallback)) {
    const fallbackPort = Number(fallback.trim());
    if (fallbackPort >= MIN_PORT && fallbackPort <= MAX_PORT) return fallbackPort;
  }
  return null;
}

function detectNewline(text) {
  const match = String(text ?? '').match(/\r\n|\n|\r/);
  return match?.[0] || '\n';
}

function hasOddTrailingBackslashes(value) {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '\\'; index -= 1) count += 1;
  return (count & 1) === 1;
}

function splitPhysicalLines(text) {
  const source = String(text ?? '');
  const lines = [];
  const matcher = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match;
  while ((match = matcher.exec(source))) {
    if (!match[0]) break;
    lines.push({ content: match[1], eol: match[2], raw: match[0] });
    if (!match[2]) break;
  }
  return lines;
}

function decodeJavaPropertyEscapes(value) {
  const source = String(value ?? '');
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== '\\' || index + 1 >= source.length) {
      result += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped === 't') result += '\t';
    else if (escaped === 'n') result += '\n';
    else if (escaped === 'r') result += '\r';
    else if (escaped === 'f') result += '\f';
    else if (escaped === 'u') {
      while (source[index + 1] === 'u') index += 1;
      const code = source.slice(index + 1, index + 5);
      if (/^[0-9a-f]{4}$/i.test(code)) {
        result += String.fromCharCode(Number.parseInt(code, 16));
        index += 4;
      } else {
        // Java would reject a malformed Unicode escape. Keeping it readable is
        // safer for inspection and never turns it into a different key.
        result += '\\u';
      }
    } else {
      result += escaped;
    }
  }
  return result;
}

function encodeJavaPropertyKey(value) {
  const source = String(value ?? '');
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' || character === '=' || character === ':' ||
        character === '#' || character === '!' || /[ \t\f]/.test(character)) {
      result += `\\${character}`;
    } else if (character === '\n') result += '\\n';
    else if (character === '\r') result += '\\r';
    else result += character;
  }
  return result;
}

function encodeJavaPropertyValue(value) {
  const source = String(value ?? '');
  let result = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') result += '\\\\';
    else if (character === '\n') result += '\\n';
    else if (character === '\r') result += '\\r';
    else if (character === '\t') result += '\\t';
    else if (character === '\f') result += '\\f';
    else if (index === 0 && (character === ' ' || character === '#' || character === '!')) {
      result += `\\${character}`;
    } else result += character;
  }
  return result;
}

function findPropertyParts(logicalLine) {
  const source = String(logicalLine ?? '');
  let cursor = 0;
  while (cursor < source.length && /[ \t\f]/.test(source[cursor])) cursor += 1;
  const leadingEnd = cursor;
  if (cursor >= source.length || source[cursor] === '#' || source[cursor] === '!') return null;

  let escaped = false;
  let separatorStart = -1;
  for (; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (!escaped && (character === '=' || character === ':' || /[ \t\f]/.test(character))) {
      separatorStart = cursor;
      break;
    }
    if (character === '\\') escaped = !escaped;
    else escaped = false;
  }

  const keyEnd = separatorStart < 0 ? source.length : separatorStart;
  let valueStart = source.length;
  if (separatorStart >= 0) {
    cursor = separatorStart;
    while (cursor < source.length && /[ \t\f]/.test(source[cursor])) cursor += 1;
    if (cursor < source.length && (source[cursor] === '=' || source[cursor] === ':')) cursor += 1;
    while (cursor < source.length && /[ \t\f]/.test(source[cursor])) cursor += 1;
    valueStart = cursor;
  }

  return {
    key: decodeJavaPropertyEscapes(source.slice(leadingEnd, keyEnd)),
    value: decodeJavaPropertyEscapes(source.slice(valueStart)),
    leading: source.slice(0, leadingEnd),
    rawKey: source.slice(leadingEnd, keyEnd),
    separator: separatorStart < 0 ? '=' : source.slice(keyEnd, valueStart),
    valueStart
  };
}

function scanJavaPropertyRecords(text) {
  const physicalLines = splitPhysicalLines(text);
  const records = [];
  for (let index = 0; index < physicalLines.length;) {
    const start = index;
    const recordLines = [physicalLines[index]];
    let logical = physicalLines[index].content;
    while (hasOddTrailingBackslashes(recordLines.at(-1).content) && index + 1 < physicalLines.length) {
      logical = logical.slice(0, -1);
      index += 1;
      recordLines.push(physicalLines[index]);
      logical += physicalLines[index].content.replace(/^[ \t\f]+/, '');
    }
    const parts = findPropertyParts(logical);
    records.push({
      type: parts ? 'property' : (/^\s*[#!]/.test(logical) ? 'comment' : /^\s*$/.test(logical) ? 'blank' : 'other'),
      raw: recordLines.map(line => line.raw).join(''),
      logical,
      startLine: start,
      endLine: index,
      eol: recordLines.at(-1).eol || recordLines[0].eol,
      ...parts
    });
    index += 1;
  }
  return records;
}

function parseJavaProperties(text) {
  const source = String(text ?? '');
  const records = scanJavaPropertyRecords(source);
  const values = Object.create(null);
  for (const record of records) {
    if (record.type === 'property') values[record.key] = record.value;
  }
  return {
    newline: detectNewline(source),
    trailingNewline: /(?:\r\n|\n|\r)$/.test(source),
    records,
    values
  };
}

function getJavaProperty(text, key) {
  const target = String(key ?? '');
  const records = scanJavaPropertyRecords(text);
  let found;
  for (const record of records) {
    if (record.type === 'property' && record.key === target) found = record.value;
  }
  return found;
}

function normalizePropertyUpdates(updates) {
  const pairs = updates instanceof Map ? [...updates.entries()] : Object.entries(updates || {});
  const normalized = new Map();
  for (const [rawKey, rawValue] of pairs) {
    const key = String(rawKey ?? '');
    if (!key || /[\r\n]/.test(key)) throw new TypeError('Java property keys must be non-empty single-line strings.');
    normalized.set(key, rawValue === null || rawValue === undefined ? '' : String(rawValue));
  }
  return normalized;
}

function upsertJavaProperties(text, updates) {
  const source = String(text ?? '');
  const normalizedUpdates = normalizePropertyUpdates(updates);
  if (!normalizedUpdates.size) return source;

  const records = scanJavaPropertyRecords(source);
  const seen = new Set();
  let output = '';
  for (const record of records) {
    if (record.type !== 'property' || !normalizedUpdates.has(record.key)) {
      output += record.raw;
      continue;
    }
    const separator = record.separator || '=';
    const firstPhysical = splitPhysicalLines(record.raw)[0] || { eol: record.eol || '' };
    output += `${record.leading}${record.rawKey}${separator}${encodeJavaPropertyValue(normalizedUpdates.get(record.key))}${firstPhysical.eol}`;
    seen.add(record.key);
  }

  const additions = [...normalizedUpdates.entries()]
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${encodeJavaPropertyKey(key)}=${encodeJavaPropertyValue(value)}`);
  if (!additions.length) return output;
  const newline = detectNewline(source);
  if (!output) return additions.join(newline);

  const hadTrailingNewline = /(?:\r\n|\n|\r)$/.test(output);
  const suffix = additions.join(newline);
  return hadTrailingNewline
    ? `${output}${suffix}${newline}`
    : `${output}${newline}${suffix}`;
}

function addNormalizedPorts(target, values) {
  if (values === null || values === undefined || values === '') return;
  const collection = Array.isArray(values) ||
    (typeof values !== 'string' && typeof values?.[Symbol.iterator] === 'function')
    ? values
    : [values];
  for (const value of collection) {
    const port = normalizeOptionalUdpPort(value);
    if (port !== null) target.add(port);
  }
}

async function selectAvailableUdpPort({
  preferredPort = DEFAULT_VOICE_UDP_PORT,
  rangeStart = DEFAULT_VOICE_UDP_PORT,
  rangeEnd = null,
  reservedPorts = [],
  forbiddenPorts = [],
  minecraftPort = null,
  queryPort = null,
  isAvailable
} = {}) {
  const start = normalizeOptionalUdpPort(rangeStart);
  const end = rangeEnd === null || rangeEnd === undefined || rangeEnd === ''
    ? (start === null ? null : Math.min(MAX_PORT, start + 255))
    : normalizeOptionalUdpPort(rangeEnd);
  if (start === null || end === null || start > end) {
    throw new RangeError('UDP port range must contain valid ports in ascending order.');
  }
  if (typeof isAvailable !== 'function') throw new TypeError('isAvailable must be an async UDP availability probe.');

  const unavailable = new Set();
  addNormalizedPorts(unavailable, reservedPorts);
  addNormalizedPorts(unavailable, forbiddenPorts);
  addNormalizedPorts(unavailable, minecraftPort);
  addNormalizedPorts(unavailable, queryPort);

  let preferred = normalizeOptionalUdpPort(preferredPort, start);
  if (preferred < start || preferred > end) preferred = start;
  const candidates = [];
  for (let port = preferred; port <= end; port += 1) candidates.push(port);
  for (let port = start; port < preferred; port += 1) candidates.push(port);

  const probedPorts = [];
  const probeErrors = [];
  for (const port of candidates) {
    if (unavailable.has(port)) continue;
    probedPorts.push(port);
    try {
      if (await isAvailable(port, { protocol: 'udp' })) return port;
    } catch (error) {
      probeErrors.push({ port, error: String(error?.message || error || 'UDP availability probe failed.') });
    }
  }

  const error = new RangeError(`No available UDP port exists in the configured range ${start}-${end}.`);
  error.code = 'NO_AVAILABLE_UDP_PORT';
  error.probedPorts = probedPorts;
  error.probeErrors = probeErrors;
  throw error;
}

function normalizeEndpointHost(host) {
  let value = String(host ?? '').trim();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (!value || /[\x00-\x20/\\?#@]/.test(value)) return '';
  if (value.includes(':') && net.isIP(value) !== 6) return '';
  return value;
}

function parseExternalHostPort(value, defaultPort = null) {
  const source = String(value ?? '').trim();
  if (!source || /[\x00-\x20/\\?#@]/.test(source)) return null;
  const fallbackPort = normalizeOptionalUdpPort(defaultPort);

  if (source.startsWith('[')) {
    const match = source.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
    if (!match) return null;
    const host = normalizeEndpointHost(match[1]);
    if (!host || net.isIP(host) !== 6) return null;
    const port = match[2] ? normalizeOptionalUdpPort(match[2]) : fallbackPort;
    if (match[2] && port === null) return null;
    return { host, port };
  }

  const colonCount = (source.match(/:/g) || []).length;
  if (colonCount > 1) {
    const host = normalizeEndpointHost(source);
    if (!host || net.isIP(host) !== 6) return null;
    return { host, port: fallbackPort };
  }

  if (colonCount === 1) {
    const separator = source.lastIndexOf(':');
    const host = normalizeEndpointHost(source.slice(0, separator));
    const port = normalizeOptionalUdpPort(source.slice(separator + 1));
    if (!host || port === null) return null;
    return { host, port };
  }

  const host = normalizeEndpointHost(source);
  return host ? { host, port: fallbackPort } : null;
}

function formatExternalHostPort(endpointOrHost, portOverride = undefined) {
  const supplied = endpointOrHost && typeof endpointOrHost === 'object'
    ? endpointOrHost
    : { host: endpointOrHost, port: portOverride };
  const host = normalizeEndpointHost(supplied.host);
  if (!host) return '';
  const port = normalizeOptionalUdpPort(portOverride === undefined ? supplied.port : portOverride);
  if (port === null) return host;
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function isKnownPlayitTcpEndpoint(value) {
  const endpoint = typeof value === 'object' && value
    ? { host: normalizeEndpointHost(value.host), port: normalizeOptionalUdpPort(value.port) }
    : parseExternalHostPort(value);
  const host = String(endpoint?.host || '').toLowerCase().replace(/\.$/, '');
  return Boolean(host && PLAYIT_TCP_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`)));
}

function resolveVoiceHost({
  explicitUdpEndpoint = '',
  directPublicEndpoint = '',
  publicAddress = '',
  minecraftEndpoint = '',
  playitTcpEndpoint = '',
  voicePort = DEFAULT_VOICE_UDP_PORT
} = {}) {
  const port = normalizeOptionalUdpPort(voicePort, DEFAULT_VOICE_UDP_PORT);
  const explicit = parseExternalHostPort(explicitUdpEndpoint, port);
  if (String(explicitUdpEndpoint || '').trim()) {
    if (!explicit) {
      return { voiceHost: '', source: 'invalid-explicit-udp', requiresUdpOverride: true };
    }
    return {
      voiceHost: formatExternalHostPort(explicit),
      source: 'explicit-udp',
      requiresUdpOverride: false
    };
  }

  for (const [source, rawEndpoint] of [
    ['direct-public', directPublicEndpoint],
    ['public-address', publicAddress],
    ['minecraft-endpoint', minecraftEndpoint]
  ]) {
    if (!String(rawEndpoint || '').trim()) continue;
    const endpoint = parseExternalHostPort(rawEndpoint);
    if (!endpoint || isKnownPlayitTcpEndpoint(endpoint)) continue;
    return {
      voiceHost: formatExternalHostPort(endpoint.host, port),
      source,
      requiresUdpOverride: false
    };
  }

  const knownTcpTunnel = [playitTcpEndpoint, minecraftEndpoint, publicAddress, directPublicEndpoint]
    .some(endpoint => String(endpoint || '').trim() && isKnownPlayitTcpEndpoint(endpoint));
  if (knownTcpTunnel) {
    return {
      voiceHost: '',
      source: 'blocked-playit-tcp',
      requiresUdpOverride: true
    };
  }

  return {
    // Simple Voice Chat accepts a port-only voice_host and then retains the
    // Minecraft connection host. This is correct when TCP and UDP share the
    // same public host and only their ports differ.
    voiceHost: String(port),
    source: 'minecraft-connection-host',
    requiresUdpOverride: false
  };
}

function chooseVoiceHost(options = {}) {
  return resolveVoiceHost(options).voiceHost;
}

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s._-]+/g, '');
}

function isExactSimpleVoiceChatFileName(fileName) {
  const baseName = String(fileName ?? '').trim().split(/[\\/]/).at(-1) || '';
  return /^(?:voicechat(?:-(?:fabric|quilt|forge|neoforge|bukkit|paper|spigot))?|simple[-_. ]?voice[-_. ]?chat)(?:-[0-9][0-9a-z.+_-]*)?\.jar$/i.test(baseName);
}

function detectSimpleVoiceChatIdentity(input, fileName = '') {
  const wrapper = input && typeof input === 'object' ? input : {};
  const descriptor = wrapper.descriptor && typeof wrapper.descriptor === 'object'
    ? wrapper.descriptor
    : wrapper;
  const inferredFileName = fileName || wrapper.fileName || wrapper.filename || wrapper.file ||
    (wrapper.descriptor || /\.jar$/i.test(String(wrapper.name || '')) ? wrapper.name : '');

  const modIds = [
    descriptor.fabricModId,
    descriptor.quiltModId,
    descriptor.forgeModId,
    descriptor.neoforgeModId,
    descriptor.modId,
    descriptor.modid,
    descriptor.id
  ].concat(
    Array.isArray(descriptor.forgeModIds) ? descriptor.forgeModIds : [],
    Array.isArray(descriptor.neoforgeModIds) ? descriptor.neoforgeModIds : []
  ).map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
  if (modIds.includes('voicechat')) {
    return { matches: true, source: 'mod-id', identity: 'voicechat', fileName: String(inferredFileName || '') };
  }

  const pluginName = descriptor.pluginName ?? descriptor.bukkitPluginName ?? descriptor.name;
  const normalizedPluginName = normalizeIdentity(pluginName);
  if (normalizedPluginName === 'simplevoicechat' || normalizedPluginName === 'voicechat') {
    return {
      matches: true,
      source: 'plugin-name',
      identity: String(pluginName).trim(),
      fileName: String(inferredFileName || '')
    };
  }

  const pluginMain = String(descriptor.pluginMain ?? descriptor.main ?? '').trim();
  if (/^(?:de\.maxhenkel\.)?voicechat(?:\.|$)/i.test(pluginMain)) {
    return {
      matches: true,
      source: 'plugin-main',
      identity: pluginMain,
      fileName: String(inferredFileName || '')
    };
  }

  const hasNestedDescriptor = Object.prototype.hasOwnProperty.call(wrapper, 'descriptor');
  const descriptorWasInspected = hasNestedDescriptor
    ? Object.keys(descriptor).length > 0
    : Object.keys(descriptor).some(key =>
        !['fileName', 'filename', 'file'].includes(key) && (key !== 'name' || Boolean(fileName))
      );
  if (!descriptorWasInspected && isExactSimpleVoiceChatFileName(inferredFileName)) {
    return {
      matches: true,
      source: 'file-name',
      identity: String(inferredFileName).split(/[\\/]/).at(-1),
      fileName: String(inferredFileName)
    };
  }
  return { matches: false, source: '', identity: '', fileName: String(inferredFileName || '') };
}

function isSimpleVoiceChatArtifact(input, fileName = '') {
  return detectSimpleVoiceChatIdentity(input, fileName).matches;
}

module.exports = {
  DEFAULT_VOICE_UDP_PORT,
  MAX_PORT,
  MIN_PORT,
  PLAYIT_TCP_HOST_SUFFIXES,
  chooseVoiceHost,
  decodeJavaPropertyEscapes,
  detectSimpleVoiceChatIdentity,
  detectNewline,
  encodeJavaPropertyKey,
  encodeJavaPropertyValue,
  formatExternalHostPort,
  getJavaProperty,
  isExactSimpleVoiceChatFileName,
  isKnownPlayitTcpEndpoint,
  isSimpleVoiceChatArtifact,
  normalizeOptionalUdpPort,
  parseExternalHostPort,
  parseJavaProperties,
  resolveVoiceHost,
  selectAvailableUdpPort,
  upsertJavaProperties
};
