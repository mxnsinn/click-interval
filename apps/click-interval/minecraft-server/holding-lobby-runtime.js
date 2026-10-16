'use strict';

// Read-only, opt-in selection of the approved Fabric holding world. An absent
// manifest retains the existing NanoLimbo installation; a bad one fails closed.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getJavaProperty } = require('./simple-voice-network');
const { isFabricProxyLiteConfigSemanticallyValid } = require('./seamless-restart-setup');

const WORLD = 'HoldingLobby';
const DIRECTORY = 'holding-fabric';
const MANIFEST = 'holding-lobby.json';
const GUARD_NAME = 'LobbyPreviewGuard-Fabric-1.1.0+mc26.2.jar';
const ARTIFACTS = Object.freeze({
  'minecraft-server.jar': 'f1d2bafd0b3b97630b0cdd8e890cd102db3dbe60877a38a5c813aa929e691127',
  'mods/fabric-api-0.161.0+26.2.jar': 'e5b858ceb13290c274e31cb888ff5a1a40cb91067e7ffab0b5b775aec51e216a',
  'mods/voicechat-fabric-2.6.22+26.2.jar': '1b6a8c6c41d6d7edaa10543ac623a70b0c60f22f34567969b6999c345aa277b2',
  'mods/FabricProxy-Lite.jar': 'dca0d05685afaa25d554372ad118d90b6b27f85ded93e6db0b85d822aa29342a'
});
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

async function ordinary(file, directory = false) {
  const resolved = path.resolve(file);
  for (let current = resolved;; current = path.dirname(current)) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current === resolved
      ? (directory ? !stat.isDirectory() : !stat.isFile()) : !stat.isDirectory())) {
      throw new Error('Holding lobby contains a linked or nonordinary path.');
    }
    if (path.dirname(current) === current) return resolved;
  }
}
async function text(file, maximum = 65536) {
  await ordinary(file);
  if ((await fs.stat(file)).size > maximum) throw new Error('Holding lobby configuration is too large.');
  return fs.readFile(file, 'utf8');
}
function validateManifest(manifest, options = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.type !== 'fabric-holding-lobby' ||
      manifest.state !== 'installed' || manifest.minecraftVersion !== '26.2' ||
      manifest.runtimeDirectory !== DIRECTORY || manifest.worldName !== WORLD ||
      (options.expectedHost !== undefined && options.expectedHost !== '127.0.0.1') ||
      ![512, 640, 768].includes(manifest.heapMb) || !Number.isInteger(manifest.tcpPort) ||
      manifest.tcpPort < 1024 || manifest.tcpPort > 65535 ||
      manifest.tcpPort !== options.expectedPort || !Number.isInteger(manifest.voicePort) ||
      manifest.voicePort < 1024 || manifest.voicePort > 65535 ||
      manifest.voicePort === Number(options.mainVoicePort || 24454) ||
      manifest.voiceHost !== String(manifest.voicePort) ||
      !/^[a-f0-9]{64}$/.test(manifest.worldSettingsSha256 || '')) {
    throw new Error('Holding lobby manifest does not match the verified runtime/ports.');
  }
  return manifest;
}
function serverProperties(manifest) {
  return {
    'server-ip': '127.0.0.1', 'server-port': String(manifest.tcpPort), 'level-name': WORLD,
    'online-mode': 'true', 'enforce-secure-profile': 'true',
    'enable-rcon': 'false', 'enable-query': 'false', 'enable-command-block': 'false',
    'gamemode': 'survival', 'force-gamemode': 'true', 'difficulty': 'peaceful',
    'hardcore': 'false', 'pvp': 'false', 'allow-flight': 'false',
    'view-distance': '6', 'simulation-distance': '2', 'spawn-protection': '0',
    'max-players': '100',
    'allow-nether': 'false', 'generate-structures': 'false',
    'pause-when-empty-seconds': '1', 'sync-chunk-writes': 'true',
    'max-tick-time': '60000', 'white-list': 'false', 'enforce-whitelist': 'false'
  };
}
function voiceProperties(manifest) {
  return { port: String(manifest.voicePort), bind_address: '*', voice_host: manifest.voiceHost,
    max_voice_distance: '48.0', whisper_distance: '24.0',
    enable_groups: 'false', force_voice_chat: 'false', allow_recording: 'false' };
}
function renderProperties(values) {
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
}
function assertProperties(source, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (getJavaProperty(source, key, '') !== value) throw new Error(`${label} setting ${key} is not verified.`);
  }
}
function startupPredicates(voicePort) {
  return {
    guard: value => value.includes('[LobbyGuard] Holding lobby active: HoldingLobby'),
    server: value => /Done \([\d.]+s\)!/u.test(value),
    forwarding: value => /fabricproxy-lite\s+2\.12\.0\b/u.test(value),
    voice: value => new RegExp(`\\[voicechat\\] Voice chat server started at (?:port |[^\\s\\r\\n]+:)${voicePort}(?:\\s|$)`, 'u').test(value)
  };
}

async function inspectHoldingLobby(options = {}) {
  const manifestFile = path.join(options.seamlessRoot, MANIFEST);
  try { await fs.lstat(manifestFile); } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false, ready: true, type: 'nanolimbo', memoryMb: 256 };
    return { enabled: true, ready: false, type: 'fabric', memoryMb: 1024, error: 'Holding lobby manifest cannot be inspected.' };
  }
  try {
    const manifest = validateManifest(JSON.parse(await text(manifestFile)), options);
    const runtimeRoot = path.join(options.seamlessRoot, DIRECTORY);
    await ordinary(runtimeRoot, true);
    const worldRoot = path.join(runtimeRoot, WORLD);
    await ordinary(path.join(worldRoot, 'level.dat'));
    if (await text(path.join(worldRoot, '.clickinterval-holding-lobby')) !==
        `Click Interval holding lobby v1\nworld=${WORLD}\n`) throw new Error('Holding lobby marker is invalid.');
    const settingsText = await text(path.join(worldRoot, '.mxnsinn-lobby-settings.json'), 8192);
    if (hash(settingsText) !== manifest.worldSettingsSha256 || JSON.parse(settingsText).world !== WORLD) {
      throw new Error('Holding lobby spawn/bounds changed after verification.');
    }
    await ordinary(path.join(runtimeRoot, 'libraries'), true);
    await ordinary(path.join(runtimeRoot, 'versions'), true);
    // Match the distribution-owned guard, not a hash supplied by runtime data.
    const guardSource = path.join(__dirname, 'server-lobby-fabric', 'dist', GUARD_NAME);
    await ordinary(guardSource);
    const artifacts = { ...ARTIFACTS, [`mods/${GUARD_NAME}`]: hash(await fs.readFile(guardSource)) };
    const expectedMods = Object.keys(artifacts).filter(file => file.startsWith('mods/')).map(file => file.slice(5)).sort();
    if (JSON.stringify((await fs.readdir(path.join(runtimeRoot, 'mods'))).sort()) !== JSON.stringify(expectedMods)) {
      throw new Error('Holding lobby must contain only Fabric API, Voice Chat, forwarding and its guard.');
    }
    for (const [relative, expected] of Object.entries(artifacts)) {
      const artifact = path.join(runtimeRoot, relative);
      await ordinary(artifact);
      if (hash(await fs.readFile(artifact)) !== expected) throw new Error(`Holding lobby artifact failed verification: ${path.basename(relative)}`);
    }
    assertProperties(await text(path.join(runtimeRoot, 'server.properties')), serverProperties(manifest), 'Holding lobby');
    assertProperties(await text(path.join(runtimeRoot, 'eula.txt')), { eula: 'true' }, 'Holding lobby');
    assertProperties(await text(path.join(runtimeRoot, 'config', 'voicechat', 'voicechat-server.properties')), voiceProperties(manifest), 'Lobby voice');
    if (!isFabricProxyLiteConfigSemanticallyValid(
      await text(path.join(runtimeRoot, 'config', 'FabricProxy-Lite.toml')), options.forwardingSecret)) {
      throw new Error('Holding lobby forwarding is not authenticated with the current proxy.');
    }
    return {
      enabled: true, ready: true, type: 'fabric', manifest, runtimeRoot, memoryMb: manifest.heapMb + 256,
      args: ['-Xms128M', `-Xmx${manifest.heapMb}M`, '-XX:ActiveProcessorCount=2',
        '-Dfile.encoding=UTF-8', '-jar', 'minecraft-server.jar', 'nogui'],
      voicePublicReachabilityVerified: false
    };
  } catch (error) {
    return { enabled: true, ready: false, type: 'fabric', memoryMb: 1024,
      error: `Holding lobby preflight failed: ${error.message}` };
  }
}

module.exports = { ARTIFACTS, DIRECTORY, GUARD_NAME, MANIFEST, WORLD, inspectHoldingLobby,
  renderProperties, serverProperties, startupPredicates, validateManifest, voiceProperties };
