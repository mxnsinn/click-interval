'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const electronPath = require('electron');
const projectRoot = __dirname;
const updaterMain = path.join(projectRoot, 'updater-main.js');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-update-concurrency-'));
const stageRoot = path.join(temporaryRoot, 'stage');
const applicationRoot = path.join(temporaryRoot, 'application');
const userDataRoot = path.join(temporaryRoot, 'settings');

function write(root, relativePath, contents) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function prepareFixture() {
  const oldBootstrap = "require('./old-main');\n";
  const newBootstrap = "require('./new-main');\n";
  const oldPackage = `${JSON.stringify({ name: 'update-lock-fixture', version: '1.0.0' }, null, 2)}\n`;
  const newPackage = `${JSON.stringify({ name: 'update-lock-fixture', version: '1.0.1' }, null, 2)}\n`;
  write(applicationRoot, 'bootstrap.js', oldBootstrap);
  write(applicationRoot, 'package.json', oldPackage);
  write(applicationRoot, 'release-manifest.json', `${JSON.stringify({ version: '1.0.0', files: [] }, null, 2)}\n`);
  write(stageRoot, 'bootstrap.js', newBootstrap);
  write(stageRoot, 'package.json', newPackage);
  const files = ['bootstrap.js', 'package.json'].map(relativePath => {
    const bytes = fs.readFileSync(path.join(stageRoot, relativePath));
    return { path: relativePath, size: bytes.length, sha256: digest(bytes) };
  });
  write(stageRoot, 'release-manifest.json', `${JSON.stringify({
    version: '1.0.1',
    manualOnly: true,
    files,
    removeFiles: []
  }, null, 2)}\n`);
  return { newBootstrap };
}

function updaterArguments(profileName, extraArguments = []) {
  const payload = {
    currentVersion: '1.0.0',
    targetVersion: '1.0.1',
    developmentUpdate: true,
    stagedUpdatePath: stageRoot,
    applicationPath: applicationRoot,
    userDataPath: userDataRoot,
    parentPid: 0
  };
  return [
    updaterMain,
    `--user-data-dir=${path.join(temporaryRoot, profileName)}`,
    '--headless-test',
    '--update-payload',
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    ...extraArguments
  ];
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForFile(filePath, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(fs.existsSync(filePath), true, `timed out waiting for ${filePath}`);
}

(async () => {
  try {
    const { newBootstrap } = prepareFixture();
    const first = spawn(electronPath, updaterArguments('electron-data-first', ['--hold-update-lock-ms', '1500']), {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let firstStdout = '';
    let firstStderr = '';
    first.stdout.on('data', chunk => { firstStdout += chunk; });
    first.stderr.on('data', chunk => { firstStderr += chunk; });

    const lockPath = path.join(applicationRoot, '.update-lock.json');
    await waitForFile(lockPath);
    const second = spawnSync(electronPath, updaterArguments('electron-data-second'), {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    });
    assert.notEqual(second.status, 0, 'a concurrent updater must be rejected');
    assert.match(second.stderr, /Another update is already in progress/i);
    assert.equal(
      fs.readFileSync(path.join(applicationRoot, 'bootstrap.js'), 'utf8'),
      "require('./old-main');\n",
      'the rejected updater must not touch the installed entrypoint'
    );

    const firstResult = await waitForExit(first);
    assert.equal(firstResult.code, 0, `the lock owner failed:\n${firstStderr || firstStdout}`);
    assert.equal(fs.readFileSync(path.join(applicationRoot, 'bootstrap.js'), 'utf8'), newBootstrap);
    assert.equal(fs.existsSync(lockPath), false, 'the lock owner must release its transaction lock');
    assert.equal(fs.existsSync(path.join(applicationRoot, '.update-backup')), false, 'successful transaction backup must be cleaned');

    console.log(JSON.stringify({ passed: true, concurrentUpdaterRejected: true, lockOwnerCompleted: true }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
