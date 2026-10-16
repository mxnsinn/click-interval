const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { downloadUpdatePackage } = require('./update-download');
const { acquireUpdateLock, processExists, releaseUpdateLock } = require('./update-lock');

nativeTheme.themeSource = 'dark';
app.setName('Click Interval Updater');

let cancelRequested = false;
let updateRunning = false;
let downloadAbortController = null;

class UpdateCanceledError extends Error {
  constructor() {
    super('The update was canceled.');
    this.name = 'UpdateCanceledError';
  }
}

function decodePayload() {
  const marker = process.argv.indexOf('--update-payload');
  if (marker < 0 || !process.argv[marker + 1]) throw new Error('The update information is missing.');
  return JSON.parse(Buffer.from(process.argv[marker + 1], 'base64url').toString('utf8'));
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function normalizePayload(value) {
  const payload = value && typeof value === 'object' ? { ...value } : {};
  let config = {};
  try { config = JSON.parse(fs.readFileSync(path.join(__dirname, 'update-config.json'), 'utf8')); } catch (_) {}
  if (!payload.stagedUpdatePath && typeof config.stagedUpdatePath === 'string') payload.stagedUpdatePath = config.stagedUpdatePath;
  const installedCandidate = path.join(__dirname, 'work', 'installed', 'current');
  const suppliedApplicationPath = payload.applicationPath ? path.resolve(payload.applicationPath) : '';
  if (!suppliedApplicationPath || (suppliedApplicationPath === path.resolve(__dirname) && fs.existsSync(installedCandidate))) {
    payload.applicationPath = fs.existsSync(installedCandidate) ? installedCandidate : __dirname;
  }
  if (!payload.userDataPath) payload.userDataPath = path.join(os.homedir(), 'Documents', 'Click Interval', 'Settings');
  return payload;
}

function ensureNotCanceled() {
  if (cancelRequested) throw new UpdateCanceledError();
}

function applyHeadlessCancelCheckpoint(copiedCount) {
  const marker = process.argv.indexOf('--cancel-after-files');
  if (marker < 0) return;
  const limit = Number(process.argv[marker + 1]);
  if (Number.isInteger(limit) && limit > 0 && copiedCount >= limit) cancelRequested = true;
}

async function applyHeadlessLockDelay() {
  if (!process.argv.includes('--headless-test')) return;
  const marker = process.argv.indexOf('--hold-update-lock-ms');
  if (marker < 0) return;
  const milliseconds = Number(process.argv[marker + 1]);
  if (Number.isInteger(milliseconds) && milliseconds > 0) await delay(Math.min(milliseconds, 5000));
}

async function waitForParent(pid) {
  const deadline = Date.now() + 15000;
  while (processExists(pid) && Date.now() < deadline) {
    ensureNotCanceled();
    await delay(100);
  }
  if (processExists(pid)) {
    throw new Error('Click Interval is still running. Close it completely, then try the update again.');
  }
}

function refreshWindowsIconCache() {
  if (process.platform !== 'win32') return;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const refresher = path.join(systemRoot, 'System32', 'ie4uinit.exe');
  if (!fs.existsSync(refresher)) return;
  for (const argument of ['-ClearIconCache', '-show']) {
    try {
      const child = spawn(refresher, [argument], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.unref();
    } catch (_) {}
  }
}

function send(window, progress, status, cancelable = true) {
  if (!window.isDestroyed()) window.webContents.send('updater-progress', { progress, status, cancelable });
}

function requestCancel(window) {
  if (cancelRequested) return;
  cancelRequested = true;
  if (downloadAbortController) downloadAbortController.abort();
  send(window, 0, 'Canceling update and restoring the previous version...', false);
  if (!updateRunning) app.quit();
}

async function applyDevelopmentUpdate(window, payload) {
  const stageRoot = path.resolve(payload.stagedUpdatePath || '');
  const applicationRoot = path.resolve(payload.applicationPath || '');
  if (!stageRoot || !applicationRoot || stageRoot === applicationRoot) throw new Error('The staged update location is invalid.');
  const releaseManifestRelativePath = 'release-manifest.json';
  const releaseManifestSource = path.join(stageRoot, releaseManifestRelativePath);
  const releaseManifestBytes = fs.readFileSync(releaseManifestSource);
  const release = JSON.parse(releaseManifestBytes.toString('utf8'));
  if (String(release.version) !== String(payload.targetVersion) || !Array.isArray(release.files) || !release.files.length) {
    throw new Error('The staged release does not match the advertised version.');
  }
  const resolveInside = (root, relativePath) => {
    const resolved = path.resolve(root, relativePath);
    const prefix = `${root}${path.sep}`.toLowerCase();
    if (!resolved.toLowerCase().startsWith(prefix)) throw new Error('The update contains an unsafe file path.');
    return resolved;
  };
  const isReleaseManifestPath = value => String(value || '').replace(/\\/g, '/').toLowerCase() === releaseManifestRelativePath;
  if (release.files.some(file => isReleaseManifestPath(file?.path)) ||
      (Array.isArray(release.removeFiles) && release.removeFiles.some(isReleaseManifestPath))) {
    throw new Error('The release manifest must be installed as updater metadata.');
  }
  const updateLock = acquireUpdateLock(applicationRoot);
  try {
    send(
      window,
      12,
      payload.preserveMinecraftServer
        ? 'Updating Click Interval while Minecraft keeps running...'
        : 'Closing Click Interval and Minecraft Server...'
    );
    await applyHeadlessLockDelay();
    await waitForParent(Number(payload.parentPid));
    ensureNotCanceled();
    const backupContainer = path.join(applicationRoot, '.update-backup');
    const backupRoot = path.join(backupContainer, updateLock.transactionId);
    const copied = [];
    const removed = [];
    const cleanupTransactionBackup = () => {
      fs.rmSync(backupRoot, { recursive: true, force: true });
      if (fs.existsSync(backupContainer) && fs.readdirSync(backupContainer).length === 0) fs.rmdirSync(backupContainer);
    };
    const installBytes = (relativePath, bytes) => {
      const destination = resolveInside(applicationRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const backup = resolveInside(backupRoot, relativePath);
      const hadBackup = fs.existsSync(destination);
      if (hadBackup) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(destination, backup);
      }
      const temporary = `${destination}.update-temp-${updateLock.transactionId}`;
      copied.push({ path: relativePath, hadBackup, temporary });
      fs.writeFileSync(temporary, bytes);
      fs.copyFileSync(temporary, destination);
      fs.unlinkSync(temporary);
      return destination;
    };
    // The bootstrap guard depends on update-lock.js. Install the dependency first so an
    // attempted launch can never observe a new bootstrap beside an old file set.
    const bootstrapPriority = value => {
      const normalized = String(value || '').replace(/\\/g, '/').toLowerCase();
      if (normalized === 'update-lock.js') return 0;
      if (normalized === 'bootstrap.js') return 1;
      return 2;
    };
    const installFiles = release.files
      .map((file, index) => ({ file, index }))
      .sort((left, right) => bootstrapPriority(left.file?.path) - bootstrapPriority(right.file?.path) || left.index - right.index)
      .map(entry => entry.file);
    const totalBytes = installFiles.reduce((total, file) => total + Math.max(0, Number(file.size) || 0), 0) + releaseManifestBytes.length || installFiles.length;
    let copiedBytes = 0;
    let simulatedBackupLoss = false;
    const simulateBackupLossMarker = process.argv.includes('--headless-test')
      ? process.argv.indexOf('--simulate-backup-loss-after-files')
      : -1;
    const simulateBackupLossAfter = simulateBackupLossMarker >= 0 ? Number(process.argv[simulateBackupLossMarker + 1]) : 0;
    const applyHeadlessBackupLossCheckpoint = () => {
      if (simulatedBackupLoss || !Number.isInteger(simulateBackupLossAfter) || simulateBackupLossAfter <= 0 || copied.length < simulateBackupLossAfter) return;
      simulatedBackupLoss = true;
      fs.rmSync(backupRoot, { recursive: true, force: true });
      cancelRequested = true;
    };
    send(window, 18, 'Verifying the staged release...');
    try {
      for (const file of installFiles) {
        ensureNotCanceled();
        if (!file || typeof file.path !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256 || '')) throw new Error('The release manifest is invalid.');
        const source = resolveInside(stageRoot, file.path);
        const bytes = fs.readFileSync(source);
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (digest.toLowerCase() !== file.sha256.toLowerCase() || bytes.length !== Number(file.size)) {
          throw new Error(`The staged file ${file.path} failed verification.`);
        }
        installBytes(file.path, bytes);
        copiedBytes += bytes.length || 1;
        send(window, 20 + Math.floor((copiedBytes / totalBytes) * 70), `Installing ${file.path}...`);
        await delay(0);
        applyHeadlessCancelCheckpoint(copied.length);
        applyHeadlessBackupLossCheckpoint();
        ensureNotCanceled();
      }
      for (const relativePath of Array.isArray(release.removeFiles) ? release.removeFiles : []) {
        ensureNotCanceled();
        if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('The removal manifest is invalid.');
        const destination = resolveInside(applicationRoot, relativePath);
        if (!fs.existsSync(destination)) continue;
        const backup = resolveInside(backupRoot, relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(destination, backup);
        fs.unlinkSync(destination);
        removed.push(relativePath);
      }
      const installedPackage = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'));
      if (String(installedPackage.version) !== String(payload.targetVersion)) {
        throw new Error('The installed files did not reach the target version.');
      }
      const installedManifestPath = installBytes(releaseManifestRelativePath, releaseManifestBytes);
      copiedBytes += releaseManifestBytes.length || 1;
      send(window, 90, `Installing ${releaseManifestRelativePath}...`);
      applyHeadlessCancelCheckpoint(copied.length);
      applyHeadlessBackupLossCheckpoint();
      ensureNotCanceled();
      const installedRelease = JSON.parse(fs.readFileSync(installedManifestPath, 'utf8'));
      if (String(installedRelease.version) !== String(payload.targetVersion)) {
        throw new Error('The installed release manifest did not reach the target version.');
      }
      for (const file of release.files) {
        const destination = resolveInside(applicationRoot, file.path);
        const bytes = fs.readFileSync(destination);
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== Number(file.size) || digest.toLowerCase() !== file.sha256.toLowerCase()) {
          throw new Error(`The installed file ${file.path} failed verification.`);
        }
      }
    } catch (error) {
      const rollbackProblems = [];
      for (const relativePath of removed.reverse()) {
        const backup = resolveInside(backupRoot, relativePath);
        const destination = resolveInside(applicationRoot, relativePath);
        try {
          if (fs.existsSync(backup)) fs.copyFileSync(backup, destination);
          else rollbackProblems.push(relativePath);
        } catch (_) { rollbackProblems.push(relativePath); }
      }
      for (const copiedFile of copied.reverse()) {
        const backup = resolveInside(backupRoot, copiedFile.path);
        const destination = resolveInside(applicationRoot, copiedFile.path);
        try {
          if (copiedFile.temporary && fs.existsSync(copiedFile.temporary)) fs.unlinkSync(copiedFile.temporary);
          if (copiedFile.hadBackup) {
            if (fs.existsSync(backup)) fs.copyFileSync(backup, destination);
            else rollbackProblems.push(copiedFile.path);
          } else if (fs.existsSync(destination)) {
            fs.unlinkSync(destination);
          }
        } catch (_) { rollbackProblems.push(copiedFile.path); }
      }
      if (rollbackProblems.length) {
        error.message = `${error.message} Rollback preserved installed files whose backups were unavailable: ${[...new Set(rollbackProblems)].join(', ')}.`;
      } else {
        try { cleanupTransactionBackup(); } catch (_) {}
      }
      throw error;
    }
    ensureNotCanceled();
    send(window, 94, 'Saving the update state...');
    const updateState = path.join(payload.userDataPath, 'update-applied.json');
    fs.mkdirSync(path.dirname(updateState), { recursive: true });
    const temporaryState = `${updateState}.tmp`;
    fs.writeFileSync(temporaryState, JSON.stringify({
      version: payload.targetVersion,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
    try {
      fs.renameSync(temporaryState, updateState);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      fs.copyFileSync(temporaryState, updateState);
      fs.unlinkSync(temporaryState);
    }
    try { cleanupTransactionBackup(); } catch (_) {}
    await delay(250);
  } finally {
    releaseUpdateLock(updateLock);
  }
}

async function downloadInstaller(window, payload) {
  send(window, 5, 'Downloading the update...');
  const installerPath = path.join(os.tmpdir(), `Click-Interval-${payload.targetVersion}-Setup.exe`);
  const controller = new AbortController();
  downloadAbortController = controller;
  try {
    await downloadUpdatePackage({
      url: payload.installerUrl,
      destinationPath: installerPath,
      expectedSha256: payload.sha256,
      signal: controller.signal,
      onProgress: ({ received, total }) => {
        ensureNotCanceled();
        const progress = total
          ? Math.min(73, 5 + Math.floor((received / total) * 68))
          : Math.min(73, 5 + Math.floor(received / 1048576));
        send(window, progress, 'Downloading the update...');
      }
    });
  } finally {
    if (downloadAbortController === controller) downloadAbortController = null;
  }
  ensureNotCanceled();
  send(window, 78, 'Installing the update...', false);
  await waitForParent(Number(payload.parentPid));
  await new Promise((resolve, reject) => {
    const installer = spawn(installerPath, payload.installArgs || [], { windowsHide: false, stdio: 'ignore' });
    installer.once('error', reject);
    installer.once('exit', code => code === 0 ? resolve() : reject(new Error(`The installer stopped with code ${code}.`)));
  });
}

async function runUpdate(window, payload) {
  updateRunning = true;
  try {
    if (payload.developmentUpdate) await applyDevelopmentUpdate(window, payload);
    else await downloadInstaller(window, payload);
    refreshWindowsIconCache();
    send(window, 100, payload.reopenAfterUpdate ? 'Update complete. Opening Click Interval...' : 'Update complete. You can reopen Click Interval.');
    await delay(700);
    if (payload.reopenAfterUpdate && payload.launchExecutable && payload.applicationPath) {
      const launched = spawn(payload.launchExecutable, [payload.applicationPath, '--click-interval-launch'], {
        cwd: payload.applicationPath,
        detached: true,
        windowsHide: false,
        stdio: 'ignore'
      });
      launched.unref();
    }
    updateRunning = false;
    app.quit();
  } catch (error) {
    updateRunning = false;
    if (error instanceof UpdateCanceledError || cancelRequested || error.name === 'AbortError') {
      if (!window.isDestroyed()) window.destroy();
      app.quit();
      return;
    }
    try {
      fs.mkdirSync(payload.userDataPath, { recursive: true });
      fs.writeFileSync(path.join(payload.userDataPath, 'last-update-error.json'), JSON.stringify({
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
        currentVersion: payload.currentVersion,
        targetVersion: payload.targetVersion,
        failedAt: new Date().toISOString()
      }, null, 2), 'utf8');
    } catch (_) {}
    const errorWindow = await createErrorWindow(error.message || 'The update could not be completed.', payload);
    if (!window.isDestroyed()) window.destroy();
    errorWindow.show();
  }
}

async function createErrorWindow(message, payload) {
  const errorWindow = new BrowserWindow({
    width: 420,
    height: 310,
    frame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    show: false,
    center: true,
    backgroundColor: '#101010',
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'updater-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  errorWindow.removeMenu();
  errorWindow.webContents.once('did-finish-load', () => {
    errorWindow.webContents.send('updater-error-details', {
      message,
      currentVersion: payload.currentVersion,
      targetVersion: payload.targetVersion,
      theme: payload.theme || 'obsidian'
    });
  });
  await errorWindow.loadFile('updater-error.html');
  return errorWindow;
}

ipcMain.on('updater-window-control', (event, action) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return;
  if (action === 'minimize') target.minimize();
  if (action === 'close') {
    if (updateRunning) requestCancel(target);
    else target.close();
  }
});

ipcMain.on('updater-cancel', event => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) requestCancel(target);
});

app.whenReady().then(async () => {
  let payload;
  try { payload = normalizePayload(decodePayload()); }
  catch (error) { payload = { currentVersion: '?', targetVersion: '?', error: error.message }; }
  if (process.argv.includes('--headless-test')) {
    const testWindow = { isDestroyed: () => false, webContents: { send: () => {} } };
    try {
      if (payload.error) throw new Error(payload.error);
      await applyDevelopmentUpdate(testWindow, payload);
      process.stdout.write(JSON.stringify({ passed: true, version: payload.targetVersion }));
      // Give Electron's utility process time to attach before the headless parent exits;
      // an immediate app.exit() on Windows can otherwise strand its network service.
      await delay(250);
      app.exit(0);
    } catch (error) {
      process.stderr.write(error.stack || error.message);
      await delay(250);
      app.exit(1);
    }
    return;
  }
  const window = new BrowserWindow({
    width: 420,
    height: 340,
    frame: false,
    resizable: false,
    minimizable: true,
    maximizable: false,
    center: true,
    backgroundColor: '#101010',
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'updater-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.removeMenu();
  window.on('close', event => {
    if (!updateRunning) return;
    event.preventDefault();
    requestCancel(window);
  });
  ipcMain.once('updater-ready', event => {
    event.sender.send('updater-details', payload);
    if (payload.error) {
      createErrorWindow(payload.error, payload).then(errorWindow => {
        if (!window.isDestroyed()) window.destroy();
        errorWindow.show();
      });
    } else runUpdate(window, payload);
  });
  await window.loadFile('updater.html');
});

app.on('window-all-closed', () => app.quit());
