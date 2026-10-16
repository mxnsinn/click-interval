'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const projectRoot = __dirname;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-bootstrap-lock-'));
const mainMarker = path.join(temporaryRoot, 'main-loaded.txt');
const updaterMarker = path.join(temporaryRoot, 'updater-loaded.txt');
const lockPath = path.join(temporaryRoot, '.update-lock.json');

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('bootstrap child did not exit after the update lock cleared'));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
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
    fs.copyFileSync(path.join(projectRoot, 'bootstrap.js'), path.join(temporaryRoot, 'bootstrap.js'));
    fs.copyFileSync(path.join(projectRoot, 'update-lock.js'), path.join(temporaryRoot, 'update-lock.js'));
    fs.writeFileSync(
      path.join(temporaryRoot, 'main.js'),
      `require('fs').writeFileSync(${JSON.stringify(mainMarker)}, 'loaded');\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(temporaryRoot, 'updater-main.js'),
      `require('fs').writeFileSync(${JSON.stringify(updaterMarker)}, 'loaded');\n`,
      'utf8'
    );
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      transactionId: 'bootstrap-live-owner',
      startedAt: new Date().toISOString()
    }), 'utf8');

    const bypass = spawnSync(process.execPath, [path.join(temporaryRoot, 'bootstrap.js'), '--update-payload', 'fixture'], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });
    assert.equal(bypass.status, 0, bypass.stderr || bypass.stdout);
    assert.equal(fs.existsSync(updaterMarker), true, 'updater invocation must bypass the ordinary launch guard');

    const ordinary = spawn(process.execPath, [path.join(temporaryRoot, 'bootstrap.js')], {
      cwd: temporaryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const ordinaryExit = waitForExit(ordinary);
    let stderr = '';
    ordinary.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(fs.existsSync(mainMarker), false, 'ordinary launch must not load main while an update owns the lock');

    fs.unlinkSync(lockPath);
    await waitForFile(mainMarker);
    if (ordinary.exitCode === null && ordinary.signalCode === null) ordinary.kill();
    await ordinaryExit;
    assert.equal(stderr, '');
    assert.equal(fs.existsSync(mainMarker), true, 'ordinary launch must continue after the update lock clears');

    console.log(JSON.stringify({ passed: true, updaterBypassedGuard: true, mainWaitedForUnlock: true }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
