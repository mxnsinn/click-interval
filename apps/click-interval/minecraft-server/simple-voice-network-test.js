'use strict';

const assert = require('node:assert/strict');
const {
  chooseVoiceHost,
  detectSimpleVoiceChatIdentity,
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
} = require('./simple-voice-network');

async function main() {
  assert.equal(normalizeOptionalUdpPort(24_454), 24_454);
  assert.equal(normalizeOptionalUdpPort(' 24455 '), 24_455);
  assert.equal(normalizeOptionalUdpPort('1e3'), null);
  assert.equal(normalizeOptionalUdpPort(12.5), null);
  assert.equal(normalizeOptionalUdpPort(0), null);
  assert.equal(normalizeOptionalUdpPort(65_536, 24_454), 24_454);
  assert.equal(normalizeOptionalUdpPort('', '24456'), 24_456);
  assert.equal(normalizeOptionalUdpPort(null), null);

  const original = [
    '# Simple Voice Chat\r\n',
    'port = 24454\r\n',
    'bind_address=\r\n',
    '! An unknown setting must survive\r\n',
    'packet_size=1024\r\n',
    'escaped\\ key:old\\ value\r\n'
  ].join('');
  const parsed = parseJavaProperties(original);
  assert.equal(parsed.newline, '\r\n');
  assert.equal(parsed.trailingNewline, true);
  assert.equal(parsed.values.port, '24454');
  assert.equal(parsed.values['escaped key'], 'old value');

  const configured = upsertJavaProperties(original, {
    port: 24_460,
    voice_host: 'voice.example.test:24460'
  });
  assert.equal(configured, [
    '# Simple Voice Chat\r\n',
    'port = 24460\r\n',
    'bind_address=\r\n',
    '! An unknown setting must survive\r\n',
    'packet_size=1024\r\n',
    'escaped\\ key:old\\ value\r\n',
    'voice_host=voice.example.test:24460\r\n'
  ].join(''));
  assert.equal(getJavaProperty(configured, 'voice_host'), 'voice.example.test:24460');
  assert.equal(getJavaProperty(configured, 'packet_size'), '1024');

  const noFinalNewline = upsertJavaProperties('port: 24454\nunknown=yes', new Map([
    ['port', '24461'],
    ['voice_host', '24461']
  ]));
  assert.equal(noFinalNewline, 'port: 24461\nunknown=yes\nvoice_host=24461');

  const duplicate = upsertJavaProperties('port=1\nport=2\n', { port: '24462' });
  assert.equal(duplicate, 'port=24462\nport=24462\n');
  assert.equal(getJavaProperty(duplicate, 'port'), '24462');

  const continued = 'voice_host=voice.\\\n  example.test:24454\nkeep=this\n';
  assert.equal(getJavaProperty(continued, 'voice_host'), 'voice.example.test:24454');
  assert.equal(upsertJavaProperties(continued, { voice_host: 'new.example.test:24463' }),
    'voice_host=new.example.test:24463\nkeep=this\n');

  const escapedValue = upsertJavaProperties('', { 'custom key': ' leading\\path\nnext' });
  assert.equal(escapedValue, 'custom\\ key=\\ leading\\\\path\\nnext');
  assert.equal(getJavaProperty(escapedValue, 'custom key'), ' leading\\path\nnext');

  const probed = [];
  const selected = await selectAvailableUdpPort({
    preferredPort: 24_454,
    rangeStart: 24_454,
    rangeEnd: 24_460,
    reservedPorts: [24_454, '24455'],
    forbiddenPorts: new Set([24_456]),
    minecraftPort: 24_457,
    queryPort: 24_458,
    isAvailable: async port => {
      probed.push(port);
      return port === 24_460;
    }
  });
  assert.equal(selected, 24_460);
  assert.deepEqual(probed, [24_459, 24_460]);

  assert.equal(await selectAvailableUdpPort({
    preferredPort: 30_002,
    rangeStart: 30_000,
    rangeEnd: 30_003,
    reservedPorts: [30_002],
    isAvailable: async port => port === 30_000
  }), 30_000, 'bounded selection wraps once inside the declared range');
  assert.equal(await selectAvailableUdpPort({
    preferredPort: 60_000,
    rangeStart: 60_000,
    isAvailable: async port => port === 60_001
  }), 60_001, 'an omitted range end is derived from the custom range start');

  await assert.rejects(() => selectAvailableUdpPort({
    rangeStart: 40_000,
    rangeEnd: 40_001,
    reservedPorts: [40_000],
    isAvailable: async () => false
  }), error => error?.code === 'NO_AVAILABLE_UDP_PORT' &&
    Array.isArray(error.probedPorts) && error.probedPorts.length === 1);
  await assert.rejects(() => selectAvailableUdpPort({
    rangeStart: 50_000,
    rangeEnd: 50_000
  }), /isAvailable/);

  assert.deepEqual(parseExternalHostPort('voice.example.test:24454'), {
    host: 'voice.example.test', port: 24_454
  });
  assert.deepEqual(parseExternalHostPort('voice.example.test', 24_455), {
    host: 'voice.example.test', port: 24_455
  });
  assert.deepEqual(parseExternalHostPort('[2001:db8::7]:24456'), {
    host: '2001:db8::7', port: 24_456
  });
  assert.deepEqual(parseExternalHostPort('2001:db8::7', 24_457), {
    host: '2001:db8::7', port: 24_457
  });
  assert.equal(parseExternalHostPort('voice.example.test:70000'), null);
  assert.equal(parseExternalHostPort('https://voice.example.test:24454'), null);
  assert.equal(formatExternalHostPort({ host: '2001:db8::8', port: 24_458 }), '[2001:db8::8]:24458');
  assert.equal(formatExternalHostPort('voice.example.test', 24_459), 'voice.example.test:24459');

  assert.equal(isKnownPlayitTcpEndpoint('server.playit.gg:25565'), true);
  assert.equal(isKnownPlayitTcpEndpoint('example.gl.joinmc.link:25565'), true);
  assert.equal(isKnownPlayitTcpEndpoint('voice.example.test:24454'), false);

  assert.equal(chooseVoiceHost({
    minecraftEndpoint: 'server.playit.gg:25565',
    publicAddress: '203.0.113.9:25565',
    voicePort: 24_470
  }), '203.0.113.9:24470');
  assert.deepEqual(resolveVoiceHost({
    minecraftEndpoint: 'server.playit.gg:25565',
    voicePort: 24_471
  }), {
    voiceHost: '',
    source: 'blocked-playit-tcp',
    requiresUdpOverride: true
  });
  assert.equal(chooseVoiceHost({
    explicitUdpEndpoint: 'udp.playit.gg:40123',
    minecraftEndpoint: 'tcp.playit.gg:25565',
    voicePort: 24_472
  }), 'udp.playit.gg:40123', 'an explicit UDP endpoint is authoritative even on a Playit hostname');
  assert.deepEqual(resolveVoiceHost({
    explicitUdpEndpoint: 'bad host',
    voicePort: 24_473
  }), {
    voiceHost: '',
    source: 'invalid-explicit-udp',
    requiresUdpOverride: true
  });
  assert.equal(chooseVoiceHost({ voicePort: 24_474 }), '24474');
  assert.equal(chooseVoiceHost({
    directPublicEndpoint: '[2001:db8::9]:25565',
    voicePort: 24_475
  }), '[2001:db8::9]:24475');

  assert.equal(isSimpleVoiceChatArtifact({ fabricModId: 'voicechat' }, 'anything.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ forgeModId: 'voicechat' }, 'renamed.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ forgeModIds: ['example', 'voicechat'] }, 'renamed.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ quiltModId: 'voicechat' }, 'renamed.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ pluginName: 'SimpleVoiceChat' }, 'renamed.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ pluginName: 'voicechat' }, 'renamed.jar'), true);
  assert.equal(isSimpleVoiceChatArtifact({ pluginName: 'MyVoiceChat' }, 'renamed.jar'), false);
  assert.equal(isSimpleVoiceChatArtifact({ fabricModId: 'simplevoicechat' }, 'renamed.jar'), false);
  assert.equal(isSimpleVoiceChatArtifact({ descriptor: 'fabric.mod.json', fabricModId: 'not-voicechat' }, 'voicechat-fabric-2.6.22.jar'), false,
    'a parsed unrelated descriptor must not be overridden by a suggestive filename');
  assert.equal(isSimpleVoiceChatArtifact({ name: 'voicechat-fabric-1.21.1-2.6.6.jar', descriptor: {} }), true);
  assert.equal(isSimpleVoiceChatArtifact({ name: 'voicechat-forge-1.21.1-2.6.6.jar' }), true);
  assert.equal(isExactSimpleVoiceChatFileName('voicechat-bukkit-2.6.6.jar'), true);
  assert.equal(isExactSimpleVoiceChatFileName('simple-voice-chat-2.6.6.jar'), true);
  assert.equal(isExactSimpleVoiceChatFileName('voicechat-helper.jar'), false);
  assert.equal(isExactSimpleVoiceChatFileName('my-voicechat.jar'), false);
  assert.equal(detectSimpleVoiceChatIdentity({ descriptor: { fabricModId: 'voicechat' }, name: 'mod.jar' }).source,
    'mod-id');

  console.log('PASS Simple Voice Chat network helper tests');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
