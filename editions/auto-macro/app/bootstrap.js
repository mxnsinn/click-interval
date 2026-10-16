'use strict';

const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { COMMIT_FILE, JOURNAL_FILE, recoverIncompleteUpdate } = require('./update-recovery');
const { enableWineElectronCompatibility } = require('./wine-compat');

// This must run before Electron becomes ready. It changes rendering only when
// the Windows build is actually running inside Wine/CrossOver/Whisky.
enableWineElectronCompatibility(app);

// This hidden marker name is retained for in-place recovery compatibility with
// already installed 1.5.143 clients. It is never presented as product branding.
const lockPath = path.join(__dirname, '.friend-update.lock');

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForUpdateBoundary() {
  const deadline = Date.now() + 45_000;
  while (fs.existsSync(lockPath)) {
    let lock = null;
    let age = Number.POSITIVE_INFINITY;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      age = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch (_) {}
    if ((!lock || !processExists(Number(lock.pid))) && age > 2000) {
      recoverIncompleteUpdate(__dirname);
      fs.rmSync(lockPath, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new Error('Click Interval is still finishing an update. Try opening it again in a moment.');
    wait(100);
  }
}

function recoverBeforeLaunch() {
  if (fs.existsSync(path.join(__dirname, JOURNAL_FILE)) || fs.existsSync(path.join(__dirname, COMMIT_FILE))) {
    recoverIncompleteUpdate(__dirname);
  }
}

function blockStartup(error, title = 'Click Interval blocked') {
  app.setName('Click Interval');
  app.whenReady().then(() => dialog.showMessageBox({
    type: 'error',
    title,
    message: title,
    detail: String(error?.message || error || 'The application could not be verified.'),
    buttons: ['Close'],
    defaultId: 0,
    noLink: true
  })).finally(() => app.quit());
}

function verifyBeforeLaunch() {
  const { verifyInstalledApplication } = require('./app-integrity');
  return verifyInstalledApplication(__dirname);
}

function cachedBetaControl() {
  const { cachePathForDocuments, readCachedControl } = require('./release-control');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8'));
  const cached = readCachedControl(cachePathForDocuments(app.getPath('documents')), config);
  return cached?.control || null;
}

async function refreshDisabledControl(currentControl) {
  try {
    const { cachePathForDocuments, refreshCachedControl } = require('./release-control');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8'));
    return await refreshCachedControl(cachePathForDocuments(app.getPath('documents')), config, { timeoutMs: 12_000 });
  } catch (_) {
    return currentControl;
  }
}

function continueVerifiedLaunch() {
  if (process.argv.includes('--friend-update-payload')) require('./updater-main');
  else require('./main');
}

function enforceCachedRevocation(control) {
  const { showRevocationAndExit } = require('./beta-uninstall');
  app.setName('Click Interval');
  app.whenReady().then(() => showRevocationAndExit({
    app,
    dialog,
    control,
    applicationPath: __dirname
  })).catch(error => blockStartup(error, 'Click Interval beta disabled'));
}

try {
  waitForUpdateBoundary();
  recoverBeforeLaunch();
  verifyBeforeLaunch();
  const control = cachedBetaControl();
  if (control?.state === 'disabled') {
    refreshDisabledControl(control).then(latest => {
      if (latest?.state === 'disabled') enforceCachedRevocation(latest);
      else continueVerifiedLaunch();
    }).catch(() => enforceCachedRevocation(control));
  } else continueVerifiedLaunch();
} catch (error) {
  blockStartup(error);
}

module.exports = { blockStartup, cachedBetaControl, processExists, recoverBeforeLaunch, refreshDisabledControl, verifyBeforeLaunch, waitForUpdateBoundary };
