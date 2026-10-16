'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceApp = path.resolve(__dirname, '..', 'app');
const marker = process.argv.indexOf('--app');
const appRoot = marker >= 0 && process.argv[marker + 1] ? path.resolve(process.argv[marker + 1]) : sourceApp;
const manifestModule = require(path.join(appRoot, 'update-manifest.js'));
const downloadModule = require(path.join(appRoot, 'update-download.js'));
const pathSafety = require(path.join(appRoot, 'update-path-safety.js'));
const recoveryModule = require(path.join(appRoot, 'update-recovery.js'));
const updateClientModule = require(path.join(appRoot, 'update-client.js'));

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get: key => normalized.get(String(key).toLowerCase()) ?? null };
}

function response(status, chunks, headerValues = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: headers(headerValues),
    body: {
      async cancel() {},
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      }
    }
  };
}

function sign(manifest, privateKey) {
  const payload = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url');
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url')
  };
}

function baseManifest(overrides = {}) {
  const requiredFiles = (manifestModule.REQUIRED_UPDATE_FILES || ['package.json']).map(filePath => ({
    path: filePath,
    size: 2,
    sha256: 'a'.repeat(64)
  }));
  return {
    schema: 1,
    edition: 'click-interval-friend',
    channel: 'stable',
    version: '1.0.1',
    publishedAt: '2026-10-15T00:00:00.000Z',
    baseUrl: 'https://click-interval.netlify.app/private-friend-updates/test/1.0.1/',
    notes: 'Security test',
    files: requiredFiles,
    removeFiles: [],
    ...overrides
  };
}

async function run() {
  let assertions = 0;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const verified = manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest(), privateKey), publicKeyBase64, 'stable');
  assert.equal(verified.edition, 'click-interval-friend'); assertions += 1;
  assert.equal(verified.totalBytes, (manifestModule.REQUIRED_UPDATE_FILES || ['package.json']).length * 2); assertions += 1;
  const legacyFiles = manifestModule.LEGACY_REQUIRED_UPDATE_FILES.map(filePath => ({ path: filePath, size: 2, sha256: 'a'.repeat(64) }));
  assert.equal(manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ version: '1.0.0', files: legacyFiles }), privateKey), publicKeyBase64, 'stable').version, '1.0.0'); assertions += 1;
  const integrityFiles = manifestModule.INTEGRITY_REQUIRED_UPDATE_FILES.map(filePath => ({ path: filePath, size: 2, sha256: 'a'.repeat(64) }));
  assert.equal(manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ version: '1.5.143', files: integrityFiles }), privateKey), publicKeyBase64, 'stable').version, '1.5.143'); assertions += 1;
  const modernWithoutIntegrity = (manifestModule.REQUIRED_UPDATE_FILES || []).filter(filePath => filePath !== '.friend-integrity.json')
    .map(filePath => ({ path: filePath, size: 2, sha256: 'a'.repeat(64) }));
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ version: '1.5.143', files: modernWithoutIntegrity }), privateKey), publicKeyBase64, 'stable'), /integrity|required/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ edition: 'click-interval' }), privateKey), publicKeyBase64, 'stable'), /edition/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ channel: 'nightly' }), privateKey), publicKeyBase64, 'stable'), /channel/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ baseUrl: 'http://updates.example/' }), privateKey), publicKeyBase64, 'stable'), /HTTPS/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ files: [{ path: '../escape.js', size: 1, sha256: 'a'.repeat(64) }] }), privateKey), publicKeyBase64, 'stable'), /path/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ files: [
    { path: 'package.json', size: 2, sha256: 'a'.repeat(64) },
    { path: 'PACKAGE.JSON', size: 2, sha256: 'b'.repeat(64) }
  ] }), privateKey), publicKeyBase64, 'stable'), /more than once/i); assertions += 1;
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(sign(baseManifest({ removeFiles: ['package.json'] }), privateKey), publicKeyBase64, 'stable'), /conflicting/i); assertions += 1;
  const tampered = sign(baseManifest(), privateKey);
  tampered.payload = Buffer.from(JSON.stringify(baseManifest({ version: '2.0.0' })), 'utf8').toString('base64url');
  assert.throws(() => manifestModule.verifyFriendUpdateEnvelope(tampered, publicKeyBase64, 'stable'), /signature|verified/i); assertions += 1;

  assert.equal(manifestModule.compareVersions('1.0.1', '1.0.0'), 1); assertions += 1;
  assert.equal(manifestModule.compareVersions('1.0.0', '1.0.0'), 0); assertions += 1;
  assert.equal(manifestModule.compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1); assertions += 1;
  assert.equal(manifestModule.compareVersions('1.0.0', '1.0.0-beta.10'), 1); assertions += 1;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-update-security-'));
  try {
    const trustedRoot = path.join(directory, 'trusted');
    const outsideRoot = path.join(directory, 'outside');
    fs.mkdirSync(trustedRoot);
    fs.mkdirSync(outsideRoot);
    assert.equal(pathSafety.resolveInsideNoLinks(trustedRoot, 'nested/file.txt', { allowMissing: true }), path.join(trustedRoot, 'nested', 'file.txt')); assertions += 1;
    if (process.platform === 'win32') {
      const junction = path.join(trustedRoot, 'linked');
      fs.symlinkSync(outsideRoot, junction, 'junction');
      assert.throws(() => pathSafety.resolveInsideNoLinks(trustedRoot, 'linked/escape.txt', { allowMissing: true }), /link|junction/i); assertions += 1;
      fs.rmSync(junction, { force: true });
    }
    const fakeTemp = path.join(directory, 'fake-temp');
    const stageParent = path.join(fakeTemp, 'click-interval-friend-updates');
    const safeStage = path.join(stageParent, 'release-unit-test');
    fs.mkdirSync(safeStage, { recursive: true });
    assert.equal(pathSafety.validateStageRoot(safeStage, fakeTemp), safeStage); assertions += 1;
    assert.throws(() => pathSafety.validateStageRoot(path.join(directory, 'wrong-stage'), fakeTemp), /outside|temporary/i); assertions += 1;
    if (process.platform === 'win32') {
      const outsideStage = path.join(directory, 'outside-stage');
      const linkedRelease = path.join(stageParent, 'release-linked');
      fs.mkdirSync(outsideStage);
      fs.writeFileSync(path.join(outsideStage, 'must-survive.txt'), 'outside');
      fs.symlinkSync(outsideStage, linkedRelease, 'junction');
      assert.throws(() => updateClientModule.cleanOldStages(stageParent), /link|junction|unsafe/i, 'Old-stage cleanup followed a linked release directory.'); assertions += 1;
      assert.equal(fs.readFileSync(path.join(outsideStage, 'must-survive.txt'), 'utf8'), 'outside'); assertions += 1;
      fs.rmSync(linkedRelease, { force: true });

      const linkedParent = path.join(directory, 'linked-stage-parent');
      fs.symlinkSync(outsideStage, linkedParent, 'junction');
      assert.throws(() => updateClientModule.cleanOldStages(linkedParent), /link|junction/i, 'Old-stage cleanup accepted a linked staging parent.'); assertions += 1;
      assert.equal(fs.readFileSync(path.join(outsideStage, 'must-survive.txt'), 'utf8'), 'outside'); assertions += 1;
      fs.rmSync(linkedParent, { force: true });
    }

    const recoveryRoot = path.join(directory, 'recovery-app');
    const transactionId = '1234567890-aabbccddee';
    const backupRoot = path.join(recoveryRoot, '.friend-update-backup', transactionId);
    fs.mkdirSync(backupRoot, { recursive: true });
    const write = (root, relative, value) => {
      const destination = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, value);
    };
    write(recoveryRoot, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.0' }));
    write(recoveryRoot, 'existing.txt', 'old-existing');
    write(recoveryRoot, 'nested/second.txt', 'old-second');
    write(recoveryRoot, 'removed.txt', 'old-removed');
    fs.mkdirSync(path.join(recoveryRoot, 'preserved-empty'));
    write(backupRoot, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.0' }));
    write(backupRoot, 'existing.txt', 'old-existing');
    write(backupRoot, 'nested/second.txt', 'old-second');
    write(backupRoot, 'removed.txt', 'old-removed');
    const immutableJournal = {
      schema: 1,
      edition: 'click-interval-friend',
      transactionId,
      previousVersion: '1.0.0',
      targetVersion: '1.0.1',
      changed: [
        { path: 'package.json', existed: true },
        { path: 'existing.txt', existed: true },
        { path: 'nested/second.txt', existed: true },
        { path: 'new/deep/created.txt', existed: false },
        { path: 'preserved-empty/temporary.txt', existed: false }
      ],
      removed: [{ path: 'removed.txt' }],
      createdDirectories: ['new', 'new/deep']
    };
    recoveryModule.writeTransactionJournal(recoveryRoot, immutableJournal);
    const journalPath = path.join(recoveryRoot, recoveryModule.JOURNAL_FILE);
    const journalBytes = fs.readFileSync(journalPath);
    assert.throws(() => recoveryModule.writeTransactionJournal(recoveryRoot, {
      ...immutableJournal,
      changed: []
    }), /exists|marker|transaction/i, 'An update journal must be immutable after it is prepared.'); assertions += 1;
    assert.deepEqual(fs.readFileSync(journalPath), journalBytes, 'A second journal write changed immutable recovery metadata.'); assertions += 1;
    assert(!Object.prototype.hasOwnProperty.call(recoveryModule.loadTransactionJournal(recoveryRoot), 'phase'), 'Transaction state leaked back into the immutable journal.'); assertions += 1;

    // Simulate process death after several writes, one deletion, and one newly
    // created nested file. Recovery must restore every old byte from the fully
    // prepared journal, rather than only operations reached before the crash.
    write(recoveryRoot, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.1' }));
    write(recoveryRoot, 'existing.txt', 'new-existing');
    write(recoveryRoot, 'nested/second.txt', 'new-second');
    write(recoveryRoot, 'new/deep/created.txt', 'brand-new');
    write(recoveryRoot, 'preserved-empty/temporary.txt', 'brand-new-in-old-directory');
    fs.rmSync(path.join(recoveryRoot, 'removed.txt'));
    const recovered = recoveryModule.recoverIncompleteUpdate(recoveryRoot);
    assert.equal(recovered.recovered, true); assertions += 1;
    assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot, 'package.json'), 'utf8')).version, '1.0.0'); assertions += 1;
    assert.equal(fs.readFileSync(path.join(recoveryRoot, 'existing.txt'), 'utf8'), 'old-existing'); assertions += 1;
    assert.equal(fs.readFileSync(path.join(recoveryRoot, 'nested', 'second.txt'), 'utf8'), 'old-second'); assertions += 1;
    assert.equal(fs.readFileSync(path.join(recoveryRoot, 'removed.txt'), 'utf8'), 'old-removed'); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, 'new', 'deep', 'created.txt')), 'Crash recovery did not remove a newly added file.'); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, 'new')), 'Crash recovery did not remove directories created by the interrupted update.'); assertions += 1;
    assert(fs.existsSync(path.join(recoveryRoot, 'preserved-empty')) && fs.readdirSync(path.join(recoveryRoot, 'preserved-empty')).length === 0, 'Crash recovery removed a directory that existed before the update.'); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, recoveryModule.JOURNAL_FILE)), 'Crash recovery journal was not cleared.'); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, recoveryModule.COMMIT_FILE)), 'Crash recovery left a commit marker behind.'); assertions += 1;
    assert(!fs.existsSync(backupRoot), 'Crash recovery backup was not cleaned up.'); assertions += 1;

    const committedId = '1234567891-1122334455';
    const committedBackup = path.join(recoveryRoot, '.friend-update-backup', committedId);
    fs.mkdirSync(committedBackup, { recursive: true });
    write(committedBackup, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.0' }));
    write(committedBackup, 'existing.txt', 'old-existing');
    recoveryModule.writeTransactionJournal(recoveryRoot, {
      schema: 1,
      edition: 'click-interval-friend',
      transactionId: committedId,
      previousVersion: '1.0.0',
      targetVersion: '1.0.1',
      changed: [
        { path: 'package.json', existed: true },
        { path: 'existing.txt', existed: true }
      ],
      removed: []
    });
    write(recoveryRoot, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.1' }));
    write(recoveryRoot, 'existing.txt', 'new-existing-committed');
    recoveryModule.writeTransactionCommit(recoveryRoot, committedId, '1.0.1');
    const commitPath = path.join(recoveryRoot, recoveryModule.COMMIT_FILE);
    const commitBytes = fs.readFileSync(commitPath);
    assert.throws(() => recoveryModule.writeTransactionCommit(recoveryRoot, committedId, '1.0.1'), /exists|marker|transaction/i, 'A commit marker must be create-only.'); assertions += 1;
    assert.deepEqual(fs.readFileSync(commitPath), commitBytes, 'A second commit write changed the durable marker.'); assertions += 1;
    const committed = recoveryModule.recoverIncompleteUpdate(recoveryRoot);
    assert.equal(committed.recovered, false); assertions += 1;
    assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot, 'package.json'), 'utf8')).version, '1.0.1'); assertions += 1;
    assert.equal(fs.readFileSync(path.join(recoveryRoot, 'existing.txt'), 'utf8'), 'new-existing-committed'); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, recoveryModule.JOURNAL_FILE))); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, recoveryModule.COMMIT_FILE))); assertions += 1;
    assert(!fs.existsSync(committedBackup)); assertions += 1;

    // Simulate a crash after committed recovery removed the journal but before
    // it removed the backup and commit marker. A second startup must preserve
    // the new tree and finish cleanup without needing the journal.
    const cleanupId = '1234567893-0a1b2c3d4e';
    const cleanupBackup = path.join(recoveryRoot, '.friend-update-backup', cleanupId);
    fs.mkdirSync(cleanupBackup, { recursive: true });
    write(cleanupBackup, 'unused.txt', 'old');
    recoveryModule.writeTransactionCommit(recoveryRoot, cleanupId, '1.0.1');
    const cleanupResult = recoveryModule.recoverIncompleteUpdate(recoveryRoot);
    assert.equal(cleanupResult.recovered, false); assertions += 1;
    assert.equal(JSON.parse(fs.readFileSync(path.join(recoveryRoot, 'package.json'), 'utf8')).version, '1.0.1'); assertions += 1;
    assert(!fs.existsSync(cleanupBackup)); assertions += 1;
    assert(!fs.existsSync(path.join(recoveryRoot, recoveryModule.COMMIT_FILE))); assertions += 1;

    if (process.platform === 'win32') {
      const linkedRecoveryRoot = path.join(directory, 'linked-recovery-app');
      const outsideBackupRoot = path.join(directory, 'outside-backup');
      fs.mkdirSync(linkedRecoveryRoot);
      fs.mkdirSync(outsideBackupRoot);
      write(linkedRecoveryRoot, 'package.json', JSON.stringify({ name: 'click-interval-friend', version: '1.0.1' }));
      recoveryModule.writeTransactionJournal(linkedRecoveryRoot, {
        schema: 1,
        edition: 'click-interval-friend',
        transactionId: '1234567892-a1b2c3d4e5',
        previousVersion: '1.0.0',
        targetVersion: '1.0.1',
        changed: [{ path: 'package.json', existed: true }],
        removed: []
      });
      fs.symlinkSync(outsideBackupRoot, path.join(linkedRecoveryRoot, '.friend-update-backup'), 'junction');
      assert.throws(
        () => recoveryModule.recoverIncompleteUpdate(linkedRecoveryRoot),
        /link|junction|unsafe/i,
        'Recovery followed a linked backup parent outside the application.'
      ); assertions += 1;
      fs.rmSync(path.join(linkedRecoveryRoot, '.friend-update-backup'), { force: true });
    }

    const bytes = Buffer.from('signed friend update');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(directory, 'payload.bin');
    const calls = [];
    await downloadModule.downloadVerifiedFile({
      url: 'https://updates.example/payload.bin',
      destinationPath: destination,
      expectedSize: bytes.length,
      expectedSha256: digest,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return response(200, [bytes.subarray(0, 5), bytes.subarray(5)], { 'content-length': bytes.length });
      }
    });
    assert.deepEqual(fs.readFileSync(destination), bytes); assertions += 1;
    assert.equal(calls[0].options.redirect, 'manual'); assertions += 1;

    await assert.rejects(downloadModule.downloadVerifiedFile({
      url: 'https://updates.example/bad.bin',
      destinationPath: path.join(directory, 'bad.bin'),
      expectedSize: bytes.length,
      expectedSha256: '0'.repeat(64),
      fetchImpl: async () => response(200, [bytes], { 'content-length': bytes.length })
    }), /checksum/i); assertions += 1;
    assert(!fs.existsSync(path.join(directory, 'bad.bin')), 'Checksum failure left a destination file behind.'); assertions += 1;

    await assert.rejects(downloadModule.downloadVerifiedFile({
      url: 'http://updates.example/unsafe.bin',
      destinationPath: path.join(directory, 'unsafe.bin'),
      expectedSize: bytes.length,
      expectedSha256: digest,
      fetchImpl: async () => response(200, [bytes])
    }), /HTTPS/i); assertions += 1;

    const stalled = downloadModule.fetchUpdateEnvelope('https://updates.example/stalled.json', {
      timeoutMs: 30,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: headers(),
        body: {
          async cancel() {},
          [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; }
        }
      })
    });
    await assert.rejects(Promise.race([
      stalled,
      new Promise((_, reject) => setTimeout(() => reject(new Error('TEST_STALL_TIMEOUT')), 3000))
    ]), error => {
      assert.notEqual(error?.message, 'TEST_STALL_TIMEOUT', 'Update body stall was not canceled by the downloader.');
      return /timeout|timed out|stalled|abort|progress/i.test(String(error?.message || error));
    }); assertions += 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const releaseWorkflowPath = path.resolve(__dirname, '..', '..', '..', '.github', 'workflows', 'release.yml');
  assert(fs.existsSync(releaseWorkflowPath), 'Public release workflow is missing.'); assertions += 1;
  const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  assert(/push:[\s\S]*tags:\s*\['v\*'\]/.test(releaseWorkflow), 'Release workflow is not bound to version tags.'); assertions += 1;
  assert(releaseWorkflow.includes('npm test') && releaseWorkflow.includes('build-auto-macro.ps1'), 'Release workflow does not test before building.'); assertions += 1;
  assert(releaseWorkflow.includes('SHA256SUMS.txt') && releaseWorkflow.includes('sbom-format spdx'), 'Release workflow does not publish checksums and an SPDX SBOM.'); assertions += 1;
  assert(releaseWorkflow.includes('attest-build-provenance@v3'), 'Release workflow does not attest build provenance.'); assertions += 1;
  assert(releaseWorkflow.includes('signpath/github-action-submit-signing-request@v3'), 'Release workflow does not use the official SignPath action.'); assertions += 1;

  const updaterSource = fs.readFileSync(path.join(appRoot, 'updater-main.js'), 'utf8');
  assert.equal((updaterSource.match(/writeTransactionJournal\(applicationRoot, journal\)/g) || []).length, 1, 'Updater rewrites its supposedly immutable journal.'); assertions += 1;
  assert.match(updaterSource, /writeTransactionCommit\(applicationRoot,\s*transactionId,\s*manifest\.version\)/); assertions += 1;
  assert(updaterSource.includes('assertStagedTrustContinuity') && ['edition', 'channel', 'manifestUrl', 'manifestPublicKey'].every(anchor => updaterSource.includes(`'${anchor}'`)), 'Updater does not preserve all trust anchors.'); assertions += 1;
  assert(updaterSource.includes('fs.createReadStream') && !/return\s*\{\s*\.\.\.file,\s*bytes\s*\}/.test(updaterSource), 'Updater retains the entire staged release in RAM.'); assertions += 1;
  assert(/\.on\(['"]close['"][\s\S]{0,180}preventDefault/.test(updaterSource), 'Updater window can close during file replacement.'); assertions += 1;
  assert(/app\.on\(['"]before-quit['"][\s\S]{0,180}preventDefault/.test(updaterSource), 'Updater process can quit during file replacement.'); assertions += 1;

  console.log(JSON.stringify({ passed: true, assertions, appRoot }));
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
