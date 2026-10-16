'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electronPath = require('electron');
const projectRoot = __dirname;
const updaterMain = path.join(projectRoot, 'updater-main.js');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-update-transaction-'));
const stageRoot = path.join(temporaryRoot, 'stage');
const applicationRoot = path.join(temporaryRoot, 'application');
const userDataRoot = path.join(temporaryRoot, 'settings');
const electronDataRoot = path.join(temporaryRoot, 'electron-data');

const write = (root, relativePath, contents) => {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
};
const read = (root, relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const oldPackage = `${JSON.stringify({ name: 'update-fixture', version: '1.0.0' }, null, 2)}\n`;
const newPackage = `${JSON.stringify({ name: 'update-fixture', version: '1.0.1' }, null, 2)}\n`;
const oldManifest = `${JSON.stringify({ version: '1.0.0', files: [] }, null, 2)}\n`;
const oldBootstrap = "require('./old-main');\n";
const newBootstrap = "require('./new-main');\n";
const oldFeature = 'old feature\n';
const newFeature = 'new feature\n';
const obsoleteContents = 'restore me if the transaction rolls back\n';

function prepareStage() {
  fs.rmSync(stageRoot, { recursive: true, force: true });
  write(stageRoot, 'bootstrap.js', newBootstrap);
  write(stageRoot, 'package.json', newPackage);
  write(stageRoot, 'feature.txt', newFeature);
  const files = ['bootstrap.js', 'package.json', 'feature.txt'].map(relativePath => {
    const bytes = fs.readFileSync(path.join(stageRoot, relativePath));
    return { path: relativePath, size: bytes.length, sha256: digest(bytes) };
  });
  write(stageRoot, 'release-manifest.json', `${JSON.stringify({
    version: '1.0.1',
    manualOnly: true,
    files,
    removeFiles: ['obsolete.txt']
  }, null, 2)}\n`);
}

function resetApplication() {
  fs.rmSync(applicationRoot, { recursive: true, force: true });
  write(applicationRoot, 'bootstrap.js', oldBootstrap);
  write(applicationRoot, 'package.json', oldPackage);
  write(applicationRoot, 'feature.txt', oldFeature);
  write(applicationRoot, 'obsolete.txt', obsoleteContents);
  write(applicationRoot, 'release-manifest.json', oldManifest);
}

function runUpdater(extraArguments = []) {
  const payload = {
    currentVersion: '1.0.0',
    targetVersion: '1.0.1',
    developmentUpdate: true,
    stagedUpdatePath: stageRoot,
    applicationPath: applicationRoot,
    userDataPath: userDataRoot,
    parentPid: 0
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return spawnSync(electronPath, [
    updaterMain,
    `--user-data-dir=${electronDataRoot}`,
    '--headless-test',
    '--update-payload',
    encodedPayload,
    ...extraArguments
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true
  });
}

try {
  prepareStage();
  resetApplication();

  const success = runUpdater();
  assert.equal(success.status, 0, `successful updater run failed:\n${success.stderr || success.stdout}`);
  assert.equal(read(applicationRoot, 'bootstrap.js'), newBootstrap);
  assert.equal(read(applicationRoot, 'package.json'), newPackage);
  assert.equal(read(applicationRoot, 'feature.txt'), newFeature);
  assert.equal(
    read(applicationRoot, 'release-manifest.json'),
    read(stageRoot, 'release-manifest.json'),
    'successful update must install the staged release manifest byte-for-byte'
  );
  assert.equal(fs.existsSync(path.join(applicationRoot, 'obsolete.txt')), false);
  assert.equal(fs.existsSync(path.join(applicationRoot, '.update-backup')), false);

  resetApplication();
  fs.rmSync(userDataRoot, { recursive: true, force: true });
  const canceled = runUpdater(['--cancel-after-files', '4']);
  assert.notEqual(canceled.status, 0, 'manifest checkpoint cancellation should fail the update');
  assert.match(canceled.stderr, /UpdateCanceledError|update was canceled/i);
  assert.equal(read(applicationRoot, 'bootstrap.js'), oldBootstrap, 'bootstrap must roll back');
  assert.equal(read(applicationRoot, 'package.json'), oldPackage, 'package must roll back');
  assert.equal(read(applicationRoot, 'feature.txt'), oldFeature, 'payload file must roll back');
  assert.equal(read(applicationRoot, 'obsolete.txt'), obsoleteContents, 'removed file must be restored');
  assert.equal(read(applicationRoot, 'release-manifest.json'), oldManifest, 'release manifest must roll back');
  assert.equal(
    fs.existsSync(path.join(applicationRoot, 'release-manifest.json.update-temp')),
    false,
    'manifest temporary file must be cleaned during rollback'
  );
  assert.equal(fs.existsSync(path.join(applicationRoot, '.update-backup')), false, 'successful rollback must clean its own backup');

  resetApplication();
  fs.rmSync(userDataRoot, { recursive: true, force: true });
  const missingBackup = runUpdater(['--simulate-backup-loss-after-files', '1']);
  assert.notEqual(missingBackup.status, 0, 'simulated external backup deletion should fail the update');
  assert.match(missingBackup.stderr, /backups were unavailable/i);
  assert.equal(
    read(applicationRoot, 'bootstrap.js'),
    newBootstrap,
    'rollback must preserve the installed entrypoint when its pre-update backup vanished'
  );
  assert.equal(fs.existsSync(path.join(applicationRoot, 'bootstrap.js')), true, 'rollback must never delete a pre-existing entrypoint');

  console.log(JSON.stringify({
    passed: true,
    successInstalledManifest: true,
    cancellationRestoredManifest: true,
    missingBackupPreservedEntrypoint: true
  }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
