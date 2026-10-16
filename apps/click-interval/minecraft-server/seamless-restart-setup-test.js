'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  PINNED_ARTIFACTS,
  SUPPORTED_MINECRAFT_VERSION,
  VELOCITY_CONFIG_VERSION,
  VELOCITY_SERVER_NAMES,
  createSeamlessRestartSetup,
  generateForwardingSecret,
  isBackendReadyLog,
  isFabricProxyLiteConfigSemanticallyValid,
  isFabricProxyLiteReadyLog,
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
  writeSetupManifestAtomic
} = require('./seamless-restart-setup');

const FIXED_SECRET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';

async function main() {
  assert.equal(SUPPORTED_MINECRAFT_VERSION, '26.2');
  assert.equal(VELOCITY_CONFIG_VERSION, '2.9');
  assert.deepEqual(VELOCITY_SERVER_NAMES, { backend: 'main', limbo: 'maintenance' });
  assert.deepEqual(PINNED_ARTIFACTS.velocity, {
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
  });
  assert.equal(PINNED_ARTIFACTS.nanoLimbo.url,
    'https://github.com/Nan1t/NanoLimbo/releases/download/v1.13.0/NanoLimbo.jar');
  assert.equal(PINNED_ARTIFACTS.nanoLimbo.sha256,
    '884dc3d4941fb0964dfd348cebc66afb692b156a213cc980d6f47f02441432cf');
  assert.equal(PINNED_ARTIFACTS.nanoLimbo.size, 5_375_509);
  assert.equal(PINNED_ARTIFACTS.fabricProxyLite.url,
    'https://cdn.modrinth.com/data/8dI2tmqs/versions/CsEpiziv/FabricProxy-Lite-2.12.0.jar');
  assert.equal(PINNED_ARTIFACTS.fabricProxyLite.sha256,
    'dca0d05685afaa25d554372ad118d90b6b27f85ded93e6db0b85d822aa29342a');
  assert.equal(PINNED_ARTIFACTS.fabricProxyLite.size, 73_512);
  assert(Object.isFrozen(PINNED_ARTIFACTS));
  assert(Object.isFrozen(PINNED_ARTIFACTS.velocity));

  const velocity = renderVelocityConfig({
    minecraftVersion: '26.2',
    publicHost: '0.0.0.0',
    publicPort: 25_565,
    backendPort: 25_566,
    limboPort: 25_567,
    motd: 'Click "Interval"',
    maxPlayers: 20
  });
  assert.match(velocity, /^config-version = "2\.9"$/m);
  assert.match(velocity, /^bind = "0\.0\.0\.0:25565"$/m);
  assert.match(velocity, /^motd = "Click \\"Interval\\""$/m,
    'TOML strings must quote user-controlled text');
  assert.match(velocity, /^show-max-players = 20$/m);
  assert.match(velocity, /^player-info-forwarding-mode = "modern"$/m);
  assert.match(velocity, /^main = "127\.0\.0\.1:25566"$/m);
  assert.match(velocity, /^maintenance = "127\.0\.0\.1:25567"$/m);
  assert.match(velocity, /^try = \["main"\]$/m);
  assert.match(velocity, /^failover-on-unexpected-server-disconnect = false$/m,
    'ordinary backend failures must not silently park players in maintenance');
  assert.throws(() => renderVelocityConfig({ backendHost: '0.0.0.0' }),
    error => error?.code === 'SEAMLESS_RESTART_NON_LOOPBACK_BIND');
  assert.throws(() => renderVelocityConfig({ publicPort: 25_565, backendPort: 25_565 }),
    /different ports/i);
  assert.throws(() => renderVelocityConfig({ motd: 'good"\n[servers]' }),
    /control characters/i);
  assert.throws(() => renderVelocityConfig({ minecraftVersion: '26.3' }),
    error => error?.code === 'SEAMLESS_RESTART_MINECRAFT_VERSION_UNSUPPORTED');

  const legacyMotd = '\u00a74---\u00a7kkkk\u00a74 BLYAT \u00a7kkkk\u00a74---';
  const convertedLegacyMotd = legacyMotdToMiniMessage(legacyMotd);
  assert.equal(convertedLegacyMotd,
    '<dark_red>---</dark_red><dark_red><obfuscated>kkk</obfuscated></dark_red>' +
    '<dark_red> BLYAT </dark_red><dark_red><obfuscated>kkk</obfuscated></dark_red>' +
    '<dark_red>---</dark_red>');
  assert(!convertedLegacyMotd.includes('\u00a7'),
    'Velocity 4 must never receive vanilla legacy formatting codes');
  assert.equal(legacyMotdToMiniMessage('\u00a7x\u00a71\u00a72\u00a73\u00a74\u00a75\u00a76Hex'),
    '<#123456>Hex</#123456>', 'modern legacy hex colors should survive conversion');
  assert.equal(legacyMotdToMiniMessage('<red>literal \\ tag'), '\\<red>literal \\\\ tag',
    'plain Minecraft MOTD text must not become executable MiniMessage tags');
  assert.equal(legacyMotdToMiniMessage('section \u00a7z text'), 'section z text',
    'malformed section-sign sequences must not reach Velocity either');

  const legacyVelocity = renderVelocityConfig({ motd: legacyMotd });
  assert.doesNotMatch(legacyVelocity, /\u00a7[0-9a-fk-or]/iu,
    'the generated Velocity config must contain no rejected legacy formatting');
  assert.match(legacyVelocity, /^motd = "<dark_red>---<\/dark_red>/m,
    'the generated Velocity config should contain valid MiniMessage formatting');

  const nanoLimbo = renderNanoLimboSettings({
    minecraftVersion: '26.2',
    host: '127.0.0.1',
    port: 25_567,
    message: '<yellow>Restart: "almost done"'
  });
  assert.match(nanoLimbo, /^  ip: "127\.0\.0\.1"$/m);
  assert.match(nanoLimbo, /^  port: 25567$/m);
  assert.match(nanoLimbo, /^  type: MODERN$/m);
  assert.match(nanoLimbo, /^  secret: "@forwarding\.secret"$/m);
  assert.match(nanoLimbo, /^  transportType: NIO$/m,
    'Windows must use the portable NIO transport rather than epoll');
  assert.match(nanoLimbo, /^logPlayersIp: false$/m);
  assert.match(nanoLimbo, /Restart: \\"almost done\\"/);
  assert.throws(() => renderNanoLimboSettings({ host: '192.168.1.5' }),
    error => error?.code === 'SEAMLESS_RESTART_NON_LOOPBACK_BIND');

  const fabricProxyLite = renderFabricProxyLiteConfig({
    minecraftVersion: '26.2',
    forwardingSecret: FIXED_SECRET
  });
  assert.match(fabricProxyLite, /^hackOnlineMode = true$/m);
  assert.match(fabricProxyLite, /^hackEarlySend = false$/m);
  assert.match(fabricProxyLite, /^hackMessageChain = false$/m,
    'FabricProxy-Lite 2.12 leaves the chat-chain hack disabled across modern server switches');
  assert.match(fabricProxyLite, new RegExp(`^secret = "${FIXED_SECRET}"$`, 'm'));
  const rewrittenFabricProxyLite = fabricProxyLite
    .split(/\r?\n/u)
    .filter(line => line && !line.startsWith('#'))
    .reverse()
    .join('\n');
  assert.equal(parseFabricProxyLiteConfig(rewrittenFabricProxyLite).secret, FIXED_SECRET);
  assert.equal(isFabricProxyLiteConfigSemanticallyValid(rewrittenFabricProxyLite, FIXED_SECRET), true,
    'FabricProxy-Lite may rewrite comments/order without invalidating verified forwarding semantics');
  assert.equal(isFabricProxyLiteConfigSemanticallyValid(
    rewrittenFabricProxyLite.replace('hackOnlineMode = true', 'hackOnlineMode = false'),
    FIXED_SECRET
  ), false, 'security-relevant FabricProxy-Lite changes must fail closed');
  assert.throws(() => renderFabricProxyLiteConfig({ forwardingSecret: 'too-short' }),
    error => error?.code === 'SEAMLESS_RESTART_SECRET_INVALID');

  const notices = renderThirdPartyNotices();
  for (const artifact of Object.values(PINNED_ARTIFACTS)) {
    assert(notices.includes(`${artifact.name} ${artifact.version}`));
    assert(notices.includes(`License: ${artifact.license}`));
    assert(notices.includes(artifact.url));
    assert(notices.includes(artifact.sha256));
  }

  const generatedSecret = generateForwardingSecret({
    bytes: 48,
    randomBytes(bytes) {
      assert.equal(bytes, 48);
      return Buffer.alloc(bytes, 0xab);
    }
  });
  assert.equal(generatedSecret.length, 64);
  assert.match(generatedSecret, /^[a-z0-9_-]+$/i);
  assert(!/[+/=]/u.test(generatedSecret), 'generated secrets must be file/TOML-friendly base64url');
  assert.throws(() => generateForwardingSecret({ bytes: 16 }), /between 32 and 4096/i);
  assert.throws(() => generateForwardingSecret({ randomBytes: () => 'not-a-buffer' }),
    /secure random source/i);

  const preparedAt = '2026-10-06T00:00:00.000Z';
  const setup = createSeamlessRestartSetup({
    minecraftVersion: '26.2',
    publicHost: '127.0.0.1',
    publicPort: 25_565,
    backendPort: 25_566,
    limboPort: 25_567,
    forwardingSecret: FIXED_SECRET,
    preparedAt
  });
  assert.equal(setup.files.at(-1).relativePath, 'setup-manifest.json');
  assert.equal(setup.files.at(-1).commitFile, true,
    'the atomic completion manifest must be committed after all payload files');
  assert.equal(setup.manifest.commitMarker, 'complete');
  assert.equal(setup.manifest.preparedAt, preparedAt);
  assert.equal(setup.manifest.minecraftVersion, '26.2');
  assert.equal(setup.manifest.topology.backend.host, '127.0.0.1');
  assert.equal(setup.manifest.artifacts.velocity.sha256, PINNED_ARTIFACTS.velocity.sha256);
  assert.equal(setup.manifest.artifacts.fabricProxyLite.targetPath,
    'backend/mods/FabricProxy-Lite.jar');
  assert.equal(setup.manifest.files.length, setup.files.length - 1);
  assert(setup.manifest.files.every(file => /^[a-f0-9]{64}$/u.test(file.sha256)));
  assert(!JSON.stringify(setup.manifest).includes(FIXED_SECRET),
    'the manifest must never contain the forwarding secret');
  assert.equal(setup.manifest.credentials.forwardingSecret.valueStoredInManifest, false);
  assert.equal(
    setup.files.find(file => file.relativePath === 'velocity/forwarding.secret').content,
    `${FIXED_SECRET}\n`
  );
  assert.equal(
    setup.files.find(file => file.relativePath === 'limbo/forwarding.secret').content,
    `${FIXED_SECRET}\n`
  );
  assert.throws(() => createSeamlessRestartSetup({
    paths: { velocitySecret: '../forwarding.secret' }, forwardingSecret: FIXED_SECRET
  }), /cannot leave/i);
  assert.throws(() => createSeamlessRestartSetup({
    paths: { velocitySecret: 'other/forwarding.secret' }, forwardingSecret: FIXED_SECRET
  }), /share a working directory/i);

  assert.equal(isVelocityReadyLog('[INFO] Listening on /0.0.0.0:25565'), true);
  assert.equal(isVelocityReadyLog('[INFO] Loading plugins...'), false);
  assert.equal(isNanoLimboReadyLog('[INFO] Server started on /127.0.0.1:25567'), true);
  assert.equal(isNanoLimboReadyLog('[INFO] Starting server...'), false);
  assert.equal(isBackendReadyLog('[Server thread/INFO]: Done (4.217s)! For help, type "help"'), true);
  assert.equal(isBackendReadyLog('[Server thread/INFO]: Preparing spawn area: 99%'), false);
  assert.equal(isFabricProxyLiteReadyLog('\u001b[32m - fabricproxy-lite 2.12.0\u001b[0m'), true);
  assert.equal(isFabricProxyLiteReadyLog('- fabric-api 0.140.2'), false);
  assert.equal(matchesReadinessLog('limbo', '[INFO] Server started on localhost:25567'), true);
  assert.throws(() => matchesReadinessLog('unknown', 'ready'), /Unknown seamless-restart component/);
  assert.deepEqual(readinessFromLogs({
    velocity: ['booting', '[INFO] Listening on /127.0.0.1:25565'],
    limbo: '[INFO] Server started on /127.0.0.1:25567',
    minecraft: '[Server thread/INFO]: Done (1.0s)! For help, type "help"',
    fabricProxyLite: '- fabricproxy-lite 2.12.0'
  }), { velocity: true, nanoLimbo: true, backend: true, fabricProxyLite: true });

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'click-interval-setup-manifest-'));
  try {
    const target = path.join(tempRoot, 'nested', 'setup-manifest.json');
    const written = await writeSetupManifestAtomic(target, setup.manifest, { nonce: 'fixed' });
    assert.equal(written.path, path.resolve(target));
    assert.match(written.sha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), setup.manifest);
    const leftovers = await fs.readdir(path.dirname(target));
    assert.deepEqual(leftovers, ['setup-manifest.json']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const events = [];
  await assert.rejects(() => writeSetupManifestAtomic('C:\\test\\setup-manifest.json', setup.manifest, {
    nonce: 'cleanup',
    mkdir: async () => events.push('mkdir'),
    writeFile: async () => events.push('write'),
    rename: async () => {
      events.push('rename');
      throw Object.assign(new Error('rename failed'), { code: 'EIO' });
    },
    unlink: async () => events.push('unlink')
  }), /rename failed/);
  assert.deepEqual(events, ['mkdir', 'write', 'rename', 'unlink'],
    'a failed atomic commit must clean up its inert temporary file');

  console.log('PASS seamless restart setup rendering, pins, manifest, and readiness tests');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
