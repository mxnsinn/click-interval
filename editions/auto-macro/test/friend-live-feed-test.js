'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isolatedRoot = path.resolve(process.env.CLICK_INTERVAL_FRIEND_ROOT || 'D:\\Codex-Projects\\ClickIntervalFriend');
const marker = process.argv.indexOf('--app');
const appRoot = marker >= 0 && process.argv[marker + 1]
  ? path.resolve(process.argv[marker + 1])
  : path.join(isolatedRoot, 'app');

const { downloadVerifiedFile, fetchUpdateEnvelope } = require(path.join(appRoot, 'update-download.js'));
const { releaseFileUrl, verifyFriendUpdateEnvelope } = require(path.join(appRoot, 'update-manifest.js'));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function run() {
  const config = readJson(path.join(appRoot, 'update-config.json'));
  const localPackage = readJson(path.join(appRoot, 'package.json'));
  assert.equal(config.edition, 'click-interval-friend');
  assert.equal(config.channel, 'stable');
  assert.equal(new URL(config.manifestUrl).protocol, 'https:');

  const separator = config.manifestUrl.includes('?') ? '&' : '?';
  const envelope = await fetchUpdateEnvelope(`${config.manifestUrl}${separator}audit=${Date.now()}`, {
    timeoutMs: 30_000,
    idleTimeoutMs: 15_000
  });
  const manifest = verifyFriendUpdateEnvelope(envelope, config.manifestPublicKey, config.channel);
  assert.equal(manifest.edition, 'click-interval-friend');
  assert.equal(manifest.version, localPackage.version, 'The live update signal is not the audited friend build.');
  assert.equal(new URL(manifest.baseUrl).origin, new URL(config.manifestUrl).origin, 'Release files moved to another host.');

  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-friend-live-audit-'));
  try {
    for (const entry of manifest.files) {
      const destination = path.join(downloadRoot, ...entry.path.split('/'));
      await downloadVerifiedFile({
        url: releaseFileUrl(manifest.baseUrl, entry.path),
        destinationPath: destination,
        expectedSize: entry.size,
        expectedSha256: entry.sha256,
        timeoutMs: 120_000,
        idleTimeoutMs: 30_000
      });
    }

    const remotePackage = readJson(path.join(downloadRoot, 'package.json'));
    const remoteConfig = readJson(path.join(downloadRoot, 'update-config.json'));
    assert.equal(remotePackage.name, 'click-interval-friend');
    assert.equal(remotePackage.version, manifest.version);
    assert.equal(remotePackage.main, 'bootstrap.js');
    for (const anchor of ['edition', 'channel', 'manifestUrl', 'manifestPublicKey']) {
      assert.equal(remoteConfig[anchor], config[anchor], `Remote update changed immutable trust anchor: ${anchor}`);
    }

    const downloaded = [];
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) downloaded.push(path.relative(downloadRoot, absolute).replace(/\\/g, '/'));
      }
    };
    visit(downloadRoot);
    assert.deepEqual(downloaded.sort(), manifest.files.map(entry => entry.path).sort(), 'The live release is incomplete.');
    const totalBytes = manifest.files.reduce((sum, entry) => sum + entry.size, 0);
    const actualBytes = downloaded.reduce((sum, relative) => sum + fs.statSync(path.join(downloadRoot, ...relative.split('/'))).size, 0);
    assert.equal(actualBytes, totalBytes);

    console.log(JSON.stringify({
      passed: true,
      edition: manifest.edition,
      version: manifest.version,
      filesDownloaded: downloaded.length,
      bytesVerified: actualBytes,
      manifestSha256: crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex')
    }));
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
