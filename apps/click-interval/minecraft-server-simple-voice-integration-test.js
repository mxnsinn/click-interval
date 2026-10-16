'use strict';

const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const mainPath = path.join(root, 'minecraft-server', 'main.js');
const mainText = fs.readFileSync(mainPath, 'utf8');
const source = `${mainText}\nmodule.exports.__simpleVoiceTest = {\n` +
  '  getSimpleVoiceChatKind, getSimpleVoiceChatConfigPath, resolveSimpleVoiceBindAddress, isGloballyRoutableIpv4, resolveMappedUdpPublicRoute, normalizeVoiceNetworkMetadata,\n' +
  '  resolveManagedSimpleVoiceHost, isUdpPortAvailable, readConfiguredQueryPort, getVoicePortReservations, allocateSimpleVoiceUdpPort, parsePlayitSignal\n' +
  '};';

const electronMock = {
  app: { getPath: () => path.join(root, 'work', 'simple-voice-integration-unused'), on: () => {} },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: () => {} },
  dialog: {}, shell: {}, Menu: {}, clipboard: {}, nativeImage: {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value, 'utf8'),
    decryptString: value => value.toString('utf8')
  }
};
const moduleMock = { exports: {} };
const sandbox = {
  module: moduleMock,
  exports: moduleMock.exports,
  __dirname: path.dirname(mainPath),
  __filename: mainPath,
  Buffer,
  URL,
  URLSearchParams,
  process,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  require: id => {
    if (id === 'electron') return electronMock;
    if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
    if (id.startsWith('./')) return require(path.join(path.dirname(mainPath), id));
    return require(id);
  }
};
vm.runInNewContext(source, sandbox, { filename: mainPath });
const test = moduleMock.exports.__simpleVoiceTest;

assert.equal(test.getSimpleVoiceChatKind('fabric'), 'mods');
assert.equal(test.getSimpleVoiceChatKind('neoforge'), 'mods');
assert.equal(test.getSimpleVoiceChatKind('paper'), 'plugins');
assert.equal(test.getSimpleVoiceChatKind('vanilla'), '');
assert.equal(test.getSimpleVoiceChatConfigPath({
  simpleVoiceModConfig: 'mod-config',
  simpleVoicePluginConfig: 'plugin-config'
}, 'mods'), 'mod-config');
assert.equal(test.getSimpleVoiceChatConfigPath({
  simpleVoiceModConfig: 'mod-config',
  simpleVoicePluginConfig: 'plugin-config'
}, 'plugins'), 'plugin-config');
assert.equal(test.resolveSimpleVoiceBindAddress('').bindAddress, '*');
assert.equal(test.resolveSimpleVoiceBindAddress('127.0.0.1').bindAddress, '*');
assert.match(test.resolveSimpleVoiceBindAddress('127.0.0.1').warning, /external UDP/);
assert.equal(test.resolveSimpleVoiceBindAddress('not-an-interface').bindAddress, '*');
assert.equal(test.resolveSimpleVoiceBindAddress('*', true).bindAddress, '127.0.0.1',
  'local-only mode must keep Simple Voice Chat off LAN/public interfaces');
assert.equal(test.isGloballyRoutableIpv4('8.8.8.8'), true);
assert.equal(test.isGloballyRoutableIpv4('192.168.1.4'), false);
assert.equal(test.isGloballyRoutableIpv4('100.64.12.2'), false);
assert.equal(test.isGloballyRoutableIpv4('203.0.113.7'), false);
const confirmedRoute = test.resolveMappedUdpPublicRoute('8.8.8.8', '8.8.8.8');
assert.equal(confirmedRoute.publicIp, '8.8.8.8');
assert.equal(confirmedRoute.upstreamNatLikely, false);
assert.equal(confirmedRoute.publicRouteConfirmed, true);
assert.equal(test.resolveMappedUdpPublicRoute('', '8.8.8.8').publicRouteConfirmed, false,
  'a public-IP lookup without a gateway external address must not prove the UPnP route');
assert.equal(test.resolveMappedUdpPublicRoute('100.64.1.2', '8.8.8.8').upstreamNatLikely, true);
assert.equal(test.resolveMappedUdpPublicRoute('1.1.1.1', '8.8.8.8').publicRouteConfirmed, false);

const playitMapped = test.resolveManagedSimpleVoiceHost({
  config: { customHostname: 'example.gl.at.ply.gg:12345', voicePublicAddress: '' },
  existingVoiceHost: '',
  metadata: {},
  udpPort: 24_460,
  network: { mapped: true, publicRouteConfirmed: true, publicIp: '203.0.113.8' }
});
assert.equal(playitMapped.voiceHost, '203.0.113.8:24460');
assert.equal(playitMapped.source, 'direct-udp-beside-playit-tcp');

const playitBlocked = test.resolveManagedSimpleVoiceHost({
  config: { customHostname: 'example.playit.gg:12345', voicePublicAddress: '' },
  existingVoiceHost: '',
  metadata: {},
  udpPort: 24_461,
  network: { mapped: false, publicIp: '' }
});
assert.equal(playitBlocked.voiceHost, '');
assert.match(playitBlocked.warning, /TCP-only/);

const playitUnconfirmed = test.resolveManagedSimpleVoiceHost({
  config: { customHostname: 'example.playit.gg:12345', voicePublicAddress: '' },
  existingVoiceHost: '',
  metadata: {},
  udpPort: 24_461,
  network: { mapped: true, publicRouteConfirmed: false, publicIp: '198.18.0.2' }
});
assert.equal(playitUnconfirmed.voiceHost, '');
assert.match(playitUnconfirmed.warning, /could not be confirmed/);

const cgnatBlocked = test.resolveManagedSimpleVoiceHost({
  config: { customHostname: 'example.playit.gg:12345', voicePublicAddress: '' },
  existingVoiceHost: '',
  metadata: {},
  udpPort: 24_461,
  network: { mapped: true, publicIp: '203.0.113.7', upstreamNatLikely: true }
});
assert.equal(cgnatBlocked.voiceHost, '');
assert.match(cgnatBlocked.warning, /CGNAT/);

const explicitTunnel = test.resolveManagedSimpleVoiceHost({
  config: { customHostname: 'example.playit.gg:12345', voicePublicAddress: 'voice.gl.at.ply.gg:31234' },
  existingVoiceHost: '',
  metadata: {},
  udpPort: 24_462,
  network: { mapped: false, publicIp: '' }
});
assert.equal(explicitTunnel.voiceHost, 'voice.gl.at.ply.gg:31234');

const userOverride = test.resolveManagedSimpleVoiceHost({
  config: { voicePublicAddress: '' },
  existingVoiceHost: 'voice.example.test:40000',
  metadata: {},
  udpPort: 24_463,
  network: { mapped: true, publicIp: '203.0.113.9' }
});
assert.equal(userOverride.voiceHost, 'voice.example.test:40000');
assert.equal(userOverride.managed, false);

const localOnlyVoice = test.resolveManagedSimpleVoiceHost({
  config: { localOnly: true, voicePublicAddress: 'voice.example.test:40000' },
  existingVoiceHost: 'voice.example.test:40000',
  metadata: {},
  udpPort: 24_464,
  network: { mapped: true, publicIp: '203.0.113.9' }
});
assert.equal(localOnlyVoice.voiceHost, '24464');
assert.equal(localOnlyVoice.source, 'local-only');
assert.equal(localOnlyVoice.managed, true);

const stalePlayitTcpOverride = test.resolveManagedSimpleVoiceHost({
  config: { publicAddress: 'example.gl.at.ply.gg:12345', voicePublicAddress: '' },
  existingVoiceHost: 'example.gl.at.ply.gg:12345',
  metadata: {},
  udpPort: 24_463,
  network: { mapped: false, publicIp: '' }
});
assert.equal(stalePlayitTcpOverride.voiceHost, '');
assert.match(stalePlayitTcpOverride.warning, /TCP-only/);

const distinctPlayitUdpOverride = test.resolveManagedSimpleVoiceHost({
  config: { publicAddress: 'minecraft.gl.at.ply.gg:25565', voicePublicAddress: '' },
  existingVoiceHost: 'voice.gl.at.ply.gg:30123',
  metadata: {},
  udpPort: 24_463,
  network: { mapped: false, publicIp: '' }
});
assert.equal(distinctPlayitUdpOverride.voiceHost, 'voice.gl.at.ply.gg:30123');
assert.equal(distinctPlayitUdpOverride.managed, false);

assert.equal(test.parsePlayitSignal('tunnel = alpha.gl.at.ply.gg:30123').address, 'alpha.gl.at.ply.gg:30123');
assert.equal(test.parsePlayitSignal('connect at beta.joinmc.link:25565').address, 'beta.joinmc.link:25565');

const managedUpdate = test.resolveManagedSimpleVoiceHost({
  config: { voicePublicAddress: '' },
  existingVoiceHost: '24454',
  metadata: { voiceHostManaged: true, managedVoiceHost: '24454' },
  udpPort: 24_464,
  network: { mapped: true, publicIp: '203.0.113.10' }
});
assert.equal(managedUpdate.voiceHost, '24464');
assert.equal(managedUpdate.managed, true);

const legacyPortUpdate = test.resolveManagedSimpleVoiceHost({
  config: { voicePublicAddress: '' },
  existingVoiceHost: '24454',
  existingPort: 24_454,
  metadata: {},
  udpPort: 24_466,
  network: { mapped: true, publicIp: '203.0.113.10' }
});
assert.equal(legacyPortUpdate.voiceHost, '24466',
  'a legacy port-only host must track a collision-driven local UDP port migration');
assert.equal(legacyPortUpdate.managed, true);

const normalized = test.normalizeVoiceNetworkMetadata({
  provider: { type: 'simple-voice-chat', kind: 'mods', file: '../voicechat.jar' },
  udpPort: '24465',
  network: { attempted: true, mapped: true, port: 24_465 },
  firewall: { attempted: true, configured: true }
});
assert.equal(normalized.provider.file, 'voicechat.jar');
assert.equal(normalized.udpPort, 24_465);
assert.equal(normalized.network.mapped, true);
assert.equal(normalized.firewall.configured, true);

const startSource = mainText.slice(
  mainText.indexOf('async function startServerOperation'),
  mainText.indexOf('function getMissingStartSettings')
);
assert.ok(startSource.indexOf('prepareSimpleVoiceNetworkForStartup') < startSource.indexOf('launchPersistentProcess'),
  'Simple Voice Chat networking must be persisted before Java starts');
assert.match(mainText, /simpleVoiceModConfig:[^\n]+config[^\n]+voicechat[^\n]+voicechat-server\.properties/);
assert.match(mainText, /simpleVoicePluginConfig:[^\n]+plugins[^\n]+voicechat[^\n]+voicechat-server\.properties/);
assert.match(mainText, /forceVoiceOnly: true/,
  'voice UDP must be mapped independently when Minecraft TCP uses another route');
assert.match(mainText, /description: 'Minecraft Voice Chat'/);
assert.match(mainText, /ensureInboundUdpRule/);
assert.match(mainText, /voiceUdpPort: 0,[\s\S]*voicePublicAddress: '',[\s\S]*levelName/,
  'new profiles must not inherit another server\'s UDP allocation or endpoint');
const prepareVoiceSource = mainText.slice(
  mainText.indexOf('async function prepareSimpleVoiceNetworkForStartup'),
  mainText.indexOf('async function verifySimpleVoiceUdpListenerAfterStartup')
);
assert.ok(prepareVoiceSource.indexOf('if (!discovery.complete)') < prepareVoiceSource.indexOf('cleanupProfileFirewallRules'),
  'an incomplete provider scan must preserve existing network access instead of tearing it down');
const deleteJarSource = mainText.slice(
  mainText.indexOf('function deleteManagedJar'),
  mainText.indexOf('function normalizeAddonKind')
);
assert.match(deleteJarSource, /!remaining\.complete \|\| serverProcess/,
  'add-on deletion must defer network cleanup when provider discovery is incomplete or still running');

const uiText = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
assert.match(uiText, /status\?\.voiceNetwork\?\.udpPort/);
assert.match(uiText, /Simple Voice Chat/);
assert.match(uiText, /\['voicePublicAddress', 'Voice UDP address', 'text'\]/,
  'the UI must expose an actual UDP tunnel endpoint for CGNAT/tunnel users');

(async () => {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind({ address: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const port = socket.address().port;
  assert.equal(await test.isUdpPortAvailable(port, '127.0.0.1'), false,
    'the allocator must reject a UDP port already owned by another process');
  await new Promise(resolve => socket.close(resolve));
  assert.equal(await test.isUdpPortAvailable(port, '127.0.0.1'), true,
    'the allocator must accept the UDP port once it is actually free');

  const wildcardSocket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    wildcardSocket.once('error', reject);
    wildcardSocket.bind({ address: '0.0.0.0', port: 0, exclusive: true }, resolve);
  });
  const wildcardPort = wildcardSocket.address().port;
  assert.equal(await test.isUdpPortAvailable(wildcardPort, '*'), false,
    'wildcard SVC allocation must reject a collision on any IPv4 interface');
  await new Promise(resolve => wildcardSocket.close(resolve));
  assert.equal(await test.isUdpPortAvailable(wildcardPort, '*'), true);

  const testUserData = path.join(root, 'work', 'simple-voice-integration-unused');
  const profilesRoot = path.join(testUserData, 'minecraft-servers');
  fs.rmSync(testUserData, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(profilesRoot, 'server-a'), { recursive: true });
    fs.mkdirSync(path.join(profilesRoot, 'server-b'), { recursive: true });
    fs.writeFileSync(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
      activeProfileId: 'server-a',
      profiles: [{ id: 'server-a', name: 'A' }, { id: 'server-b', name: 'B' }]
    }));
    fs.writeFileSync(path.join(profilesRoot, 'server-a', 'assembly-config.json'), JSON.stringify({
      serverType: 'fabric', port: 25_565, voiceUdpPort: 0
    }));
    fs.writeFileSync(path.join(profilesRoot, 'server-b', 'assembly-config.json'), JSON.stringify({
      serverType: 'fabric', port: 25_566, voiceUdpPort: 24_454, enableQuery: true
    }));
    fs.writeFileSync(path.join(profilesRoot, 'server-b', 'server.properties'), 'enable-query=true\nquery.port=24455\n');
    assert.equal(await test.readConfiguredQueryPort({
      serverProperties: path.join(profilesRoot, 'server-b', 'server.properties')
    }, { enableQuery: true, port: 25_566 }), 24_455);
    const reservations = await test.getVoicePortReservations('server-a');
    assert.equal(reservations.forbiddenPorts.has(24_455), true,
      'saved Minecraft Query UDP ports must be reserved before voice allocation');
    const allocated = await test.allocateSimpleVoiceUdpPort(
      { id: 'server-a', name: 'A' },
      { serverType: 'fabric', port: 25_565, voiceUdpPort: 0, bindIp: '', enableQuery: false },
      0,
      '*'
    );
    assert.notEqual(allocated, 24_454, 'another saved server must retain its own voice UDP port');
    assert.notEqual(allocated, 24_455, 'Minecraft Query UDP ports must never be allocated to voice chat');

    const customPortSocket = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => {
      customPortSocket.once('error', reject);
      customPortSocket.bind({ address: '0.0.0.0', port: 0, exclusive: true }, resolve);
    });
    const customPort = customPortSocket.address().port;
    await new Promise(resolve => customPortSocket.close(resolve));
    if (customPort < 24_454 || customPort > 24_965) {
      assert.equal(await test.allocateSimpleVoiceUdpPort(
        { id: 'server-a', name: 'A' },
        { serverType: 'fabric', port: 25_565, voiceUdpPort: customPort, bindIp: '', enableQuery: false },
        customPort,
        '*'
      ), customPort, 'a valid existing custom UDP port outside the managed range must be preserved');
    }
  } finally {
    fs.rmSync(testUserData, { recursive: true, force: true });
  }
  console.log('PASS Simple Voice Chat host integration contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
