'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const { getJavaProperty } = require('./simple-voice-network');
const { inspectHoldingLobby, renderProperties, serverProperties, voiceProperties,
  startupPredicates, validateManifest } = require('./holding-lobby-runtime');
const options = { expectedPort: 25567, mainVoicePort: 24454 };
const manifest = { schemaVersion: 1, type: 'fabric-holding-lobby', state: 'installed',
  minecraftVersion: '26.2', runtimeDirectory: 'holding-fabric', worldName: 'HoldingLobby',
  heapMb: 768, tcpPort: 25567, voicePort: 24455, voiceHost: '24455', worldSettingsSha256: '1'.repeat(64) };

test('only the explicit approved runtime and bounded heap can be selected', () => {
  assert.equal(validateManifest(manifest, options), manifest);
  for (const changed of [{ runtimeDirectory: '../SMP' }, { worldName: 'SMP' }, { worldName: 'TreeChopTest' },
    { state: 'preparing' }, { type: 'nanolimbo' }, { heapMb: 10240 }, { heapMb: 768.1 },
    { tcpPort: 25565 }, { voicePort: 24454 }, { voicePort: 65536 }, { voiceHost: 'external.invalid' },
    { minecraftVersion: '26.3' }, { worldSettingsSha256: '' }]) {
    assert.throws(() => validateManifest({ ...manifest, ...changed }, options));
  }
});
test('properties keep authenticated forwarding, no admin endpoints and lightweight peaceful survival', () => {
  const properties = renderProperties(serverProperties(manifest));
  for (const [key, value] of Object.entries({ 'server-ip': '127.0.0.1', 'level-name': 'HoldingLobby',
    'online-mode': 'true', 'enable-rcon': 'false', 'enable-query': 'false', 'enable-command-block': 'false',
    gamemode: 'survival', difficulty: 'peaceful', pvp: 'false', 'allow-flight': 'false',
    'view-distance': '6', 'simulation-distance': '2', 'pause-when-empty-seconds': '1' })) {
    assert.equal(getJavaProperty(properties, key), value);
  }
});
test('voice uses its own port and keeps proximity/whisper distances', () => {
  const values = voiceProperties(manifest);
  assert.equal(values.port, '24455');assert.equal(values.voice_host, '24455');
  assert.equal(values.max_voice_distance, '48.0');assert.equal(values.whisper_distance, '24.0');
  assert.equal(values.force_voice_chat, 'false');
});
test('a TCP-open or ordinary preview log cannot claim production readiness', () => {
  const checks = startupPredicates(24455);
  assert.equal(checks.guard('LOBBY_PREVIEW_GUARD_ACTIVE'), false);
  assert.equal(checks.guard('[LobbyGuard] Holding lobby active: HoldingLobby'), true);
  assert.equal(checks.server('Starting minecraft server'), false);
  assert.equal(checks.server('Done (1.45s)! For help, type "help"'), true);
  assert.equal(checks.forwarding('- fabricproxy-lite 2.12.0'), true);
  assert.equal(checks.forwarding('- fabricproxy-lite 2.11.0'), false);
  assert.equal(checks.voice('[voicechat] Voice chat server started at 0.0.0.0:24454'), false);
  assert.equal(checks.voice('[voicechat] Voice chat server started at 0.0.0.0:24455\n'), true);
  assert.equal(checks.voice('[voicechat] Voice chat server started at port 24455\n'), true);
  assert.equal(checks.voice('[voicechat] Voice chat server started at port 24454\n'), false);
  assert.equal(checks.voice('[voicechat] Voice chat server started at port 244550\n'), false);
});
test('missing manifest preserves legacy selection but malformed opt-in fails closed', async () => {
  const work = path.resolve(__dirname, '../work');
  const fixture = await fs.mkdtemp(path.join(work, 'holding-runtime-test-'));
  try {
    const old = await inspectHoldingLobby({ ...options, seamlessRoot: fixture });
    assert.equal(old.enabled, false);assert.equal(old.ready, true);
    const file = path.join(fixture, 'holding-lobby.json');
    await fs.writeFile(file, '{}', { flag: 'wx' });
    const bad = await inspectHoldingLobby({ ...options, seamlessRoot: fixture });
    assert.equal(bad.enabled, true);assert.equal(bad.ready, false);assert.equal(bad.type, 'fabric');
    await fs.writeFile(file, JSON.stringify(manifest));
    const missingRuntime = await inspectHoldingLobby({ ...options, seamlessRoot: fixture });
    assert.equal(missingRuntime.ready, false);
  } finally {
    if (path.dirname(fixture) !== work || !path.basename(fixture).startsWith('holding-runtime-test-')) throw Error('Unsafe fixture cleanup');
    await fs.rm(fixture, { recursive: true });
  }
});
