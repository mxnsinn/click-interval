'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createSeamlessRestartPlan,
  deriveSeamlessRestartPorts,
  evaluateSeamlessRestartPreflight,
  isLoopbackHost,
  normalizeSeamlessRestartConfig,
  parseJavaMajor,
  planSeamlessRestartConfiguration,
  secretState,
  verifySeamlessRestartArtifacts
} = require('./seamless-restart');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function verifiedArtifacts() {
  return {
    ready: true,
    artifacts: {
      velocity: { ready: true, hashVerified: true, code: 'VERIFIED' },
      nanoLimbo: { ready: true, hashVerified: true, code: 'VERIFIED' },
      fabricProxyLite: { ready: true, hashVerified: true, code: 'VERIFIED' }
    }
  };
}

function readyObserved(overrides = {}) {
  const observed = {
    serverType: 'fabric',
    minecraftVersion: '26.2',
    javaVersion: 'openjdk version "25.0.1" 2026-10-01',
    artifactReport: verifiedArtifacts(),
    components: {
      velocity: { configured: true, running: true },
      nanoLimbo: { configured: true, ready: true },
      fabricProxyLite: { configured: true, loaded: true },
      backend: { configured: true, ready: true }
    },
    sharedSecret: {
      velocity: '0123456789abcdef0123456789abcdef',
      fabricProxyLite: '0123456789abcdef0123456789abcdef'
    },
    bindings: {
      proxy: { host: '0.0.0.0', port: 25_565 },
      backend: { host: '127.0.0.1', port: 25_566 },
      limbo: { host: '127.0.0.1', port: 25_567 }
    }
  };
  return { ...observed, ...overrides };
}

function reasonCodes(status) {
  return status.reasons.map(reason => reason.code);
}

async function main() {
  const defaults = normalizeSeamlessRestartConfig({}, {
    publicPort: 25_565,
    reservedPorts: [25_566]
  });
  assert.deepEqual(defaults, {
    schemaVersion: 1,
    enabled: false,
    localOnly: false,
    proxyHost: '0.0.0.0',
    proxyPort: 25_565,
    backendHost: '127.0.0.1',
    backendPort: 25_567,
    limboHost: '127.0.0.1',
    limboPort: 25_568
  }, 'seamless restart must default off and avoid every reserved port');

  const localPlan = planSeamlessRestartConfiguration({
    enabled: 'true',
    localOnly: true,
    proxyHost: '0.0.0.0',
    backendHost: '192.168.1.50',
    limboHost: 'example.test',
    backendPort: 25_565,
    limboPort: 25_566
  }, { publicPort: 25_565, reservedPorts: [25_566] });
  assert.equal(localPlan.config.enabled, true);
  assert.equal(localPlan.config.proxyHost, '127.0.0.1');
  assert.equal(localPlan.config.backendHost, '127.0.0.1');
  assert.equal(localPlan.config.limboHost, '127.0.0.1');
  assert.equal(localPlan.config.backendPort, 25_567);
  assert.equal(localPlan.config.limboPort, 25_568);
  assert(localPlan.changes.some(change => /restricted to loopback for local-only/i.test(change)));
  assert(localPlan.changes.some(change => /Backend port 25565 collided/i.test(change)));

  assert.deepEqual(deriveSeamlessRestartPorts(65_000, {
    rangeStart: 65_000,
    rangeEnd: 65_003,
    reservedPorts: [65_001],
    backendPort: 65_000,
    limboPort: 65_002
  }), { publicPort: 65_000, backendPort: 65_002, limboPort: 65_003 });
  assert.deepEqual(deriveSeamlessRestartPorts(65_535, {
    rangeStart: 65_532,
    rangeEnd: 65_535
  }), { publicPort: 65_535, backendPort: 65_532, limboPort: 65_533 },
  'candidate selection must wrap safely at port 65535');
  assert.throws(() => deriveSeamlessRestartPorts(30_000, {
    rangeStart: 30_000,
    rangeEnd: 30_002,
    reservedPorts: [30_001, 30_002]
  }), error => error?.code === 'NO_SEAMLESS_RESTART_PORTS');

  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.55.4.3'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('192.168.0.2'), false);
  assert.equal(parseJavaMajor('openjdk version "21.0.8" 2026-07-15'), 21);
  assert.equal(parseJavaMajor('1.8.0_442'), 8);
  assert.equal(parseJavaMajor(25), 25);
  assert.equal(parseJavaMajor('unknown'), null);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'click-interval-seamless-'));
  try {
    const contents = {
      velocity: Buffer.from('velocity artifact'),
      nanoLimbo: Buffer.from('nanolimbo artifact'),
      fabricProxyLite: Buffer.from('fabric proxy lite artifact')
    };
    const metadata = {};
    for (const [key, value] of Object.entries(contents)) {
      const filePath = path.join(tempRoot, `${key}.jar`);
      await fs.writeFile(filePath, value);
      metadata[key] = { filePath, sha256: sha256(value) };
    }
    const verified = await verifySeamlessRestartArtifacts(metadata);
    assert.equal(verified.ready, true);
    assert.equal(verified.artifacts.velocity.hashVerified, true);
    assert.equal(verified.artifacts.nanoLimbo.hashVerified, true);
    assert.equal(verified.artifacts.fabricProxyLite.hashVerified, true);

    const mismatch = await verifySeamlessRestartArtifacts({
      ...metadata,
      velocity: { ...metadata.velocity, sha256: '0'.repeat(64) }
    });
    assert.equal(mismatch.ready, false);
    assert.equal(mismatch.artifacts.velocity.code, 'VELOCITY_HASH_MISMATCH');
    assert.equal(mismatch.artifacts.nanoLimbo.ready, true);

    const incomplete = await verifySeamlessRestartArtifacts({
      velocity: metadata.velocity,
      nanoLimbo: { filePath: path.join(tempRoot, 'missing.jar'), sha256: '1'.repeat(64) }
    });
    assert.equal(incomplete.artifacts.nanoLimbo.code, 'NANO_LIMBO_MISSING');
    assert.equal(incomplete.artifacts.fabricProxyLite.code, 'FABRIC_PROXY_LITE_METADATA_MISSING');

    const created = await createSeamlessRestartPlan({ enabled: false }, readyObserved(), {
      artifactMetadata: metadata
    });
    assert.equal(created.artifactReport.ready, true);
    assert.equal(created.status.state, 'disabled');
    assert.equal(created.status.canEnable, true);
    assert(reasonCodes(created.status).includes('FEATURE_DISABLED'));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  const enabledConfig = normalizeSeamlessRestartConfig({ enabled: true }, { publicPort: 25_565 });
  const ready = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved());
  assert.equal(ready.state, 'ready');
  assert.equal(ready.available, true);
  assert.equal(ready.canSilentRestart, true);
  assert.equal(ready.setupReady, true);
  assert.equal(ready.runtimeReady, true);
  assert.deepEqual(ready.reasons, []);

  const nextVersion = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ minecraftVersion: '26.3' }));
  assert.equal(nextVersion.canSilentRestart, true, 'Fabric 26.3 is explicitly supported');

  const wrongLoader = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ serverType: 'paper' }));
  assert.equal(wrongLoader.canSilentRestart, false);
  assert(reasonCodes(wrongLoader).includes('FABRIC_REQUIRED'));

  const wrongVersion = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ minecraftVersion: '26.4' }));
  assert(reasonCodes(wrongVersion).includes('MINECRAFT_VERSION_UNSUPPORTED'));

  const oldJava = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ javaVersion: '17.0.12' }));
  assert(reasonCodes(oldJava).includes('JAVA_VERSION_UNSUPPORTED'));
  assert.equal(oldJava.server.javaMajor, 17);

  const missingJava = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ javaVersion: undefined }));
  assert(reasonCodes(missingJava).includes('JAVA_VERSION_UNVERIFIED'));

  const unavailableJava = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ javaAvailable: false }));
  assert(reasonCodes(unavailableJava).includes('JAVA_UNAVAILABLE'));

  const artifactMissing = verifiedArtifacts();
  artifactMissing.artifacts.nanoLimbo = {
    ready: false,
    hashVerified: false,
    code: 'NANO_LIMBO_MISSING',
    message: 'NanoLimbo is not installed.'
  };
  const noLimboArtifact = evaluateSeamlessRestartPreflight(enabledConfig,
    readyObserved({ artifactReport: artifactMissing }));
  assert.equal(noLimboArtifact.artifactsReady, false);
  assert(reasonCodes(noLimboArtifact).includes('NANO_LIMBO_MISSING'));

  const shortSecret = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved({
    sharedSecret: { velocity: 'same', fabricProxyLite: 'same' }
  }));
  assert(reasonCodes(shortSecret).includes('SHARED_SECRET_TOO_SHORT'));
  assert(!JSON.stringify(shortSecret).includes('same'), 'status output must never expose forwarding secrets');

  const differentSecrets = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved({
    sharedSecret: {
      velocity: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      fabricProxyLite: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }
  }));
  assert(reasonCodes(differentSecrets).includes('SHARED_SECRET_MISMATCH'));
  assert.deepEqual(secretState({
    configured: true,
    matches: true,
    strongEnough: true
  }), { configured: true, matches: true, strongEnough: true, ready: true });
  assert.equal(secretState({ velocity: 'same', fabricProxyLite: 'same' }, 1).strongEnough, false,
    'callers cannot weaken the minimum secret below the safe default');

  const waiting = readyObserved();
  waiting.components = {
    ...waiting.components,
    velocity: { configured: true, running: false }
  };
  const waitingStatus = evaluateSeamlessRestartPreflight(enabledConfig, waiting);
  assert.equal(waitingStatus.state, 'waiting');
  assert.equal(waitingStatus.setupReady, true);
  assert.equal(waitingStatus.runtimeReady, false);
  assert(reasonCodes(waitingStatus).includes('VELOCITY_NOT_RUNNING'));

  const unconfigured = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved({
    components: {
      velocity: { configured: true, running: true },
      nanoLimbo: { configured: true, ready: true },
      fabricProxyLite: { configured: false, loaded: false },
      backend: { configured: true, ready: true }
    }
  }));
  assert.equal(unconfigured.state, 'blocked');
  assert(reasonCodes(unconfigured).includes('FABRIC_PROXY_LITE_NOT_CONFIGURED'));
  assert(reasonCodes(unconfigured).includes('FABRIC_PROXY_LITE_NOT_LOADED'));

  const exposedLocalConfig = normalizeSeamlessRestartConfig({
    enabled: true,
    localOnly: true,
    proxyHost: '127.0.0.1'
  }, { publicPort: 25_565 });
  const exposedLocal = evaluateSeamlessRestartPreflight(exposedLocalConfig, readyObserved({
    localOnly: true,
    bindings: {
      proxy: { host: '0.0.0.0', port: 25_565 },
      backend: { host: '127.0.0.1', port: 25_566 },
      limbo: { host: '127.0.0.1', port: 25_567 }
    }
  }));
  assert(reasonCodes(exposedLocal).includes('LOCAL_ONLY_PROXY_EXPOSED'));
  assert(reasonCodes(exposedLocal).includes('PROXY_BIND_MISMATCH'));

  const modeMismatch = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved({ localOnly: true }));
  assert(reasonCodes(modeMismatch).includes('NETWORK_MODE_MISMATCH'));
  assert(reasonCodes(modeMismatch).includes('LOCAL_ONLY_PROXY_EXPOSED'));

  const publicBinding = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved());
  assert(!reasonCodes(publicBinding).includes('PROXY_BIND_MISMATCH'));
  const backendExposed = evaluateSeamlessRestartPreflight(enabledConfig, readyObserved({
    bindings: {
      proxy: { host: '0.0.0.0', port: 25_565 },
      backend: { host: '0.0.0.0', port: 25_566 },
      limbo: { host: '127.0.0.1', port: 25_567 }
    }
  }));
  assert(reasonCodes(backendExposed).includes('BACKEND_NOT_LOOPBACK'));

  const absentEverything = await createSeamlessRestartPlan({}, {
    serverType: 'fabric', minecraftVersion: '26.2', javaMajor: 25
  });
  assert.equal(absentEverything.status.state, 'disabled');
  assert.equal(absentEverything.status.available, false);
  assert(reasonCodes(absentEverything.status).includes('VELOCITY_METADATA_MISSING'));
  assert(reasonCodes(absentEverything.status).includes('NANO_LIMBO_NOT_CONFIGURED'));
  assert(reasonCodes(absentEverything.status).includes('NETWORK_BINDINGS_UNVERIFIED'));

  console.log('PASS seamless restart planning and preflight tests');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
