'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAX_UPDATE_MANIFEST_BYTES,
  MAX_UPDATE_PACKAGE_BYTES,
  MAX_UPDATE_REDIRECTS,
  downloadUpdatePackage,
  fetchBoundedUpdateManifest,
  secureUpdateUrl
} = require('./update-download');

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: key => normalized.get(String(key).toLowerCase()) ?? null };
}

function response(status, chunks = [], headerValues = {}) {
  let canceled = false;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: headers(headerValues),
    body: {
      async cancel() { canceled = true; },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (canceled) return;
          yield chunk;
        }
      }
    }
  };
}

async function expectCode(promise, code) {
  let caught = null;
  try { await promise; } catch (error) { caught = error; }
  assert(caught, `Expected ${code} to be thrown.`);
  assert.strictEqual(caught.code, code, caught.stack || caught.message);
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-update-test-'));
  let assertions = 0;
  try {
    assert.strictEqual(MAX_UPDATE_MANIFEST_BYTES, 256 * 1024); assertions += 1;
    assert.strictEqual(MAX_UPDATE_PACKAGE_BYTES, 1024 * 1024 * 1024); assertions += 1;
    assert.strictEqual(MAX_UPDATE_REDIRECTS, 5); assertions += 1;
    assert.strictEqual(secureUpdateUrl('https://updates.example/file.exe').protocol, 'https:'); assertions += 1;
    assert.throws(() => secureUpdateUrl('http://updates.example/file.exe'), error => error.code === 'UPDATE_URL_UNSAFE'); assertions += 1;

    const payload = Buffer.concat([Buffer.alloc(8192, 0x31), Buffer.alloc(4096, 0x72)]);
    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    const destination = path.join(directory, 'good.exe');
    const calls = [];
    const progress = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response(302, [], { location: 'https://cdn.example/good.exe' });
      return response(200, [payload.subarray(0, 8192), payload.subarray(8192)], { 'content-length': payload.length });
    };
    const result = await downloadUpdatePackage({
      url: 'https://updates.example/latest.exe',
      destinationPath: destination,
      expectedSha256: digest,
      fetchImpl,
      onProgress: value => progress.push(value)
    });
    assert.deepStrictEqual(fs.readFileSync(destination), payload); assertions += 1;
    assert.strictEqual(result.bytes, payload.length); assertions += 1;
    assert.strictEqual(result.sha256, digest); assertions += 1;
    assert.strictEqual(calls.length, 2); assertions += 1;
    assert(calls.every(call => call.options.redirect === 'manual')); assertions += 1;
    assert(calls.every(call => call.options.signal instanceof AbortSignal)); assertions += 1;
    assert(progress.length >= 1 && progress.length <= 2); assertions += 1;
    assert.deepStrictEqual(progress.at(-1), { received: payload.length, total: payload.length }); assertions += 1;

    const preserved = path.join(directory, 'preserved.exe');
    fs.writeFileSync(preserved, 'known-good');
    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/oversized.exe',
      destinationPath: preserved,
      expectedSha256: digest,
      maxBytes: 5,
      fetchImpl: async () => response(200, [], { 'content-length': 6 })
    }), 'UPDATE_TOO_LARGE');
    assertions += 1;
    assert.strictEqual(fs.readFileSync(preserved, 'utf8'), 'known-good'); assertions += 1;

    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/stream-overflow.exe',
      destinationPath: preserved,
      expectedSha256: digest,
      maxBytes: 5,
      fetchImpl: async () => response(200, [Buffer.alloc(3), Buffer.alloc(3)])
    }), 'UPDATE_STREAM_TOO_LARGE');
    assertions += 1;
    assert.strictEqual(fs.readFileSync(preserved, 'utf8'), 'known-good'); assertions += 1;
    assert.strictEqual(fs.readdirSync(directory).filter(name => name.includes('.download-')).length, 0); assertions += 1;

    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/bad-checksum.exe',
      destinationPath: preserved,
      expectedSha256: digest,
      fetchImpl: async () => response(200, [Buffer.alloc(payload.length, 0xff)], { 'content-length': payload.length })
    }), 'UPDATE_CHECKSUM_MISMATCH');
    assertions += 1;
    assert.strictEqual(fs.readFileSync(preserved, 'utf8'), 'known-good'); assertions += 1;
    assert.strictEqual(fs.readdirSync(directory).filter(name => name.includes('.download-')).length, 0); assertions += 1;

    let redirects = 0;
    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/one',
      destinationPath: path.join(directory, 'redirect.exe'),
      expectedSha256: digest,
      maxRedirects: 1,
      fetchImpl: async () => response(302, [], { location: `https://updates.example/${++redirects + 1}` })
    }), 'UPDATE_TOO_MANY_REDIRECTS');
    assertions += 1;

    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/one',
      destinationPath: path.join(directory, 'downgrade.exe'),
      expectedSha256: digest,
      fetchImpl: async () => response(302, [], { location: 'http://updates.example/unsafe.exe' })
    }), 'UPDATE_URL_UNSAFE');
    assertions += 1;

    const stalledBody = {
      [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; },
      async cancel() {}
    };
    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/stalled.exe',
      destinationPath: path.join(directory, 'stalled.exe'),
      expectedSha256: digest,
      idleTimeoutMs: 15,
      totalTimeoutMs: 1000,
      fetchImpl: async () => ({ status: 200, ok: true, headers: headers(), body: stalledBody })
    }), 'UPDATE_IDLE_TIMEOUT');
    assertions += 1;

    await expectCode(downloadUpdatePackage({
      url: 'https://updates.example/no-headers.exe',
      destinationPath: path.join(directory, 'headers.exe'),
      expectedSha256: digest,
      headersTimeoutMs: 15,
      totalTimeoutMs: 1000,
      fetchImpl: (_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      })
    }), 'UPDATE_HEADERS_TIMEOUT');
    assertions += 1;

    const manifestBytes = Buffer.from(JSON.stringify({ version: '9.8.7', installerUrl: 'https://updates.example/app.exe' }));
    const manifest = await fetchBoundedUpdateManifest({
      url: 'https://updates.example/manifest.json',
      fetchImpl: async () => response(200, [manifestBytes.subarray(0, 7), manifestBytes.subarray(7)], { 'content-length': manifestBytes.length })
    });
    assert.strictEqual(manifest.version, '9.8.7'); assertions += 1;

    await expectCode(fetchBoundedUpdateManifest({
      url: 'https://updates.example/large-manifest.json',
      maxBytes: 8,
      fetchImpl: async () => response(200, [], { 'content-length': 9 })
    }), 'UPDATE_MANIFEST_TOO_LARGE');
    assertions += 1;

    await expectCode(fetchBoundedUpdateManifest({
      url: 'https://updates.example/streaming-manifest.json',
      maxBytes: 8,
      fetchImpl: async () => response(200, [Buffer.alloc(5), Buffer.alloc(4)])
    }), 'UPDATE_MANIFEST_TOO_LARGE');
    assertions += 1;

    await expectCode(fetchBoundedUpdateManifest({
      url: 'https://updates.example/stalled-manifest.json',
      timeoutMs: 15,
      fetchImpl: async () => ({ status: 200, ok: true, headers: headers(), body: stalledBody })
    }), 'UPDATE_MANIFEST_TIMEOUT');
    assertions += 1;

    const updaterMain = fs.readFileSync(path.join(__dirname, 'updater-main.js'), 'utf8');
    const appMain = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const buildScript = fs.readFileSync(path.join(__dirname, 'build-development-update.ps1'), 'utf8');
    assert(!/Buffer\.concat\(chunks\)/.test(updaterMain)); assertions += 1;
    assert(!/response\.arrayBuffer\(\)/.test(appMain.slice(appMain.indexOf('async function installAvailableUpdate'), appMain.indexOf('function launchUpdater')))); assertions += 1;
    assert(!/response\.json\(\)/.test(appMain.slice(appMain.indexOf('async function readUpdateManifest'), appMain.indexOf('function publishUpdateStatus')))); assertions += 1;
    assert(updaterMain.includes("require('./update-download')") && appMain.includes("require('./update-download')")); assertions += 1;
    assert(buildScript.includes("'update-download.js'")); assertions += 1;
    const shutdownBlock = appMain.slice(appMain.indexOf('function quitCleanly'), appMain.indexOf('async function createSplashWindow'));
    assert(shutdownBlock.includes('if (shuttingDown) return;') && shutdownBlock.includes('app.quit();') && !shutdownBlock.includes('app.exit(')); assertions += 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ passed: true, assertions }));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
