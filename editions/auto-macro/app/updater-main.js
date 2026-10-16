'use strict';

const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifyInstalledApplication } = require('./app-integrity');
const { compareVersions, verifyFriendUpdateEnvelope } = require('./update-manifest');
const { assertNoLinkedSegments, resolveInsideNoLinks, validateStageRoot } = require('./update-path-safety');
const { minimalChildEnvironment } = require('./process-environment');
const {
  COMMIT_FILE,
  JOURNAL_FILE,
  flushFileHandle,
  recoverIncompleteUpdate,
  removeTransactionBackup,
  writeTransactionCommit,
  writeTransactionJournal
} = require('./update-recovery');

nativeTheme.themeSource = 'dark';
app.setName('Click Interval Updater');

let updateRunning = false;

function decodePayload() {
  const marker = process.argv.indexOf('--friend-update-payload');
  if (marker < 0 || !process.argv[marker + 1]) throw new Error('The update information is missing.');
  const value = JSON.parse(Buffer.from(process.argv[marker + 1], 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The update information is invalid.');
  return value;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function resolveInside(root, relativePath) {
  return resolveInsideNoLinks(root, String(relativePath).split('/'), { allowMissing: true });
}

function loadTrustedManifest(applicationRoot, stageRoot, targetVersion) {
  const config = JSON.parse(fs.readFileSync(resolveInsideNoLinks(applicationRoot, 'update-config.json', { allowMissing: false }), 'utf8'));
  const envelope = JSON.parse(fs.readFileSync(resolveInsideNoLinks(stageRoot, 'manifest.json', { allowMissing: false }), 'utf8'));
  const manifest = verifyFriendUpdateEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable');
  if (String(manifest.version) !== String(targetVersion)) throw new Error('The staged release does not match the selected version.');
  return { config, envelope, manifest };
}

async function waitForParent(pid) {
  const deadline = Date.now() + 20_000;
  while (processExists(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (processExists(pid)) throw new Error('Click Interval is still open. Close it and try the update again.');
}

function acquireLock(applicationRoot, nonce) {
  const lockPath = path.join(applicationRoot, '.friend-update.lock');
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (processExists(Number(existing.pid))) throw new Error('Another Click Interval update is already running.');
    fs.rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.message === 'Another Click Interval update is already running.') throw error;
  }
  const handle = fs.openSync(lockPath, 'wx', 0o600);
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, nonce: String(nonce || ''), startedAt: new Date().toISOString() }));
  fs.closeSync(handle);
  return { lockPath, release: () => fs.rmSync(lockPath, { force: true }) };
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function readAndVerifyStage(stageRoot, manifest) {
  const verified = [];
  for (const file of manifest.files) {
    const source = resolveInside(stageRoot, file.path);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) throw new Error(`The staged file ${file.path} has changed.`);
    const digest = await sha256File(source);
    if (digest !== file.sha256) throw new Error(`The staged file ${file.path} failed verification.`);
    verified.push({ ...file, source });
  }
  return verified;
}

function atomicWriteFile(destination, bytes, transactionId) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.friend-update-${transactionId}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  try { fs.renameSync(temporary, destination); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    fs.rmSync(destination, { force: true });
    fs.renameSync(temporary, destination);
  }
}

function prepareBackupRoot(applicationRoot, transactionId) {
  const backupContainer = resolveInsideNoLinks(applicationRoot, '.friend-update-backup', { allowMissing: true });
  if (fs.existsSync(backupContainer)) {
    const stat = fs.lstatSync(backupContainer);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The Click Interval update backup container is unsafe.');
  } else {
    fs.mkdirSync(backupContainer);
  }
  assertNoLinkedSegments(backupContainer, { allowMissing: false });
  const backupRoot = resolveInsideNoLinks(backupContainer, transactionId, { allowMissing: true });
  if (fs.existsSync(backupRoot)) throw new Error('The Click Interval update backup transaction already exists.');
  fs.mkdirSync(backupRoot);
  assertNoLinkedSegments(backupRoot, { allowMissing: false });
  return backupRoot;
}

function durableBackup(source, backup) {
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  assertNoLinkedSegments(path.dirname(backup), { allowMissing: false });
  fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
  const handle = fs.openSync(backup, 'r');
  try { flushFileHandle(handle); } finally { fs.closeSync(handle); }
}

async function sameInstalledBytes(destination, file) {
  if (!fs.existsSync(destination)) return false;
  const stat = fs.lstatSync(destination);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The installed path ${file.path} is not a regular file.`);
  if (stat.size !== file.size) return false;
  return (await sha256File(destination)) === file.sha256;
}

function assertStagedTrustContinuity(installedConfig, stagedFiles) {
  const configFile = stagedFiles.find(file => file.path.toLowerCase() === 'update-config.json');
  if (!configFile) throw new Error('The signed release is missing its update trust configuration.');
  if (configFile.size > 64 * 1024) throw new Error('The signed release update trust configuration is too large.');
  let stagedConfig;
  try { stagedConfig = JSON.parse(fs.readFileSync(configFile.source, 'utf8')); }
  catch (_) { throw new Error('The signed release contains an invalid update trust configuration.'); }
  for (const anchor of ['edition', 'channel', 'manifestUrl', 'manifestPublicKey']) {
    if (String(stagedConfig?.[anchor] || '') !== String(installedConfig?.[anchor] || '')) {
      throw new Error(`The signed release tried to change its immutable update ${anchor}.`);
    }
  }
}

function plannedCreatedDirectories(applicationRoot, changedEntries) {
  const created = new Set();
  for (const entry of changedEntries) {
    const parts = entry.path.split('/');
    parts.pop();
    for (let length = 1; length <= parts.length; length += 1) {
      const relativeDirectory = parts.slice(0, length).join('/');
      const directory = resolveInsideNoLinks(applicationRoot, relativeDirectory, { allowMissing: true });
      if (fs.existsSync(directory)) {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`The install directory ${relativeDirectory} is unsafe.`);
      } else {
        created.add(relativeDirectory);
      }
    }
  }
  return [...created].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
}

async function atomicCopyVerifiedFile(destination, file, transactionId) {
  const sourceStat = fs.lstatSync(file.source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== file.size) throw new Error(`The staged file ${file.path} changed during installation.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  assertNoLinkedSegments(path.dirname(destination), { allowMissing: false });
  const temporary = `${destination}.friend-update-${transactionId}.tmp`;
  try {
    fs.copyFileSync(file.source, temporary, fs.constants.COPYFILE_EXCL);
    const handle = fs.openSync(temporary, 'r+');
    try { flushFileHandle(handle); } finally { fs.closeSync(handle); }
    const stat = fs.lstatSync(temporary);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || await sha256File(temporary) !== file.sha256) {
      throw new Error(`The staged file ${file.path} changed during installation.`);
    }
    try { fs.renameSync(temporary, destination); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.rmSync(destination, { force: true });
      fs.renameSync(temporary, destination);
    }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

async function applyUpdate(payload, progress = () => {}) {
  const applicationRoot = path.resolve(String(payload.applicationPath || ''));
  const stageRoot = validateStageRoot(String(payload.stagePath || ''), os.tmpdir());
  if (!applicationRoot || applicationRoot === path.parse(applicationRoot).root || !stageRoot || stageRoot === path.parse(stageRoot).root || applicationRoot === stageRoot) {
    throw new Error('The update paths are invalid.');
  }
  if ((process.platform === 'win32' ? applicationRoot.toLowerCase() : applicationRoot) !== (process.platform === 'win32' ? path.resolve(__dirname).toLowerCase() : path.resolve(__dirname))) {
    throw new Error('The updater refused to modify an application folder other than its own Click Interval installation.');
  }
  assertNoLinkedSegments(applicationRoot, { allowMissing: false });
  const currentPackage = JSON.parse(fs.readFileSync(resolveInsideNoLinks(applicationRoot, 'package.json', { allowMissing: false }), 'utf8'));
  if (currentPackage.name !== 'click-interval-friend') throw new Error('The updater refused to modify a different Click Interval edition.');
  if (compareVersions(payload.targetVersion, currentPackage.version) <= 0) throw new Error('The selected update is not newer than the installed Click Interval version.');
  const { config, manifest } = loadTrustedManifest(applicationRoot, stageRoot, payload.targetVersion);
  const updatePriority = file => file.path === 'update-recovery.js' ? 0 : file.path === 'bootstrap.js' ? 1 : file.path === '.friend-integrity.json' ? 3 : 2;
  const stagedFiles = (await readAndVerifyStage(stageRoot, manifest)).sort((left, right) => updatePriority(left) - updatePriority(right));
  assertStagedTrustContinuity(config, stagedFiles);
  verifyInstalledApplication(stageRoot, { allowedExtraPaths: ['manifest.json'] });
  const lock = acquireLock(applicationRoot, payload.nonce);
  const transactionId = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  let journalWritten = false;
  let committed = false;
  try {
    progress(8, 'Update verified. Closing the app...');
    await waitForParent(Number(payload.parentPid));

    if (fs.existsSync(resolveInsideNoLinks(applicationRoot, JOURNAL_FILE, { allowMissing: true })) ||
        fs.existsSync(resolveInsideNoLinks(applicationRoot, COMMIT_FILE, { allowMissing: true }))) {
      throw new Error('A previous Click Interval update transaction still needs recovery.');
    }
    const backupRoot = prepareBackupRoot(applicationRoot, transactionId);
    const changed = [];
    const removed = [];

    // Prepare every backup before writing the single immutable journal. Until
    // that journal is durable, no installed application byte is changed.
    for (const file of stagedFiles) {
      const destination = resolveInside(applicationRoot, file.path);
      if (await sameInstalledBytes(destination, file)) continue;
      const existed = fs.existsSync(destination);
      if (existed) {
        const backup = resolveInside(backupRoot, file.path);
        durableBackup(destination, backup);
      }
      changed.push({ path: file.path, existed });
    }
    for (const relativePath of manifest.removeFiles) {
      const destination = resolveInside(applicationRoot, relativePath);
      if (!fs.existsSync(destination)) continue;
      const stat = fs.lstatSync(destination);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The removal path ${relativePath} is not a regular file.`);
      durableBackup(destination, resolveInside(backupRoot, relativePath));
      removed.push({ path: relativePath });
    }
    const journal = {
      schema: 1,
      edition: 'click-interval-friend',
      transactionId,
      previousVersion: String(currentPackage.version),
      targetVersion: String(manifest.version),
      changed,
      removed,
      createdDirectories: plannedCreatedDirectories(applicationRoot, changed),
      preparedAt: new Date().toISOString()
    };
    writeTransactionJournal(applicationRoot, journal);
    journalWritten = true;

    const changedPaths = new Set(changed.map(entry => entry.path.toLowerCase()));
    const totalBytes = Math.max(1, stagedFiles.filter(file => changedPaths.has(file.path.toLowerCase())).reduce((sum, file) => sum + file.size, 0));
    let copiedBytes = 0;
    for (const file of stagedFiles) {
      if (!changedPaths.has(file.path.toLowerCase())) continue;
      const destination = resolveInside(applicationRoot, file.path);
      resolveInsideNoLinks(applicationRoot, file.path, { allowMissing: true });
      await atomicCopyVerifiedFile(destination, file, transactionId);
      copiedBytes += file.size;
      progress(10 + Math.floor((copiedBytes / totalBytes) * 80), `Installing ${file.path}...`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (const { path: relativePath } of removed) {
      const destination = resolveInside(applicationRoot, relativePath);
      resolveInsideNoLinks(applicationRoot, relativePath, { allowMissing: false });
      fs.rmSync(destination, { force: true });
    }
    const installedPackage = JSON.parse(fs.readFileSync(resolveInsideNoLinks(applicationRoot, 'package.json', { allowMissing: false }), 'utf8'));
    if (installedPackage.name !== 'click-interval-friend' || String(installedPackage.version) !== String(manifest.version)) {
      throw new Error('The installed package identity did not reach the signed Click Interval version.');
    }
    for (const file of manifest.files) {
      const installedPath = resolveInside(applicationRoot, file.path);
      const installedStat = fs.lstatSync(installedPath);
      if (!installedStat.isFile() || installedStat.isSymbolicLink() || installedStat.size !== file.size || await sha256File(installedPath) !== file.sha256) {
        throw new Error(`The installed file ${file.path} failed final verification.`);
      }
    }
    verifyInstalledApplication(applicationRoot);
    writeTransactionCommit(applicationRoot, transactionId, manifest.version);
    committed = true;
    progress(96, 'Cleaning up...');

    // Everything after the commit marker is best-effort bookkeeping. A crash
    // here is handled as a committed transaction on the next bootstrap.
    try {
      const stateDirectory = path.resolve(String(payload.userDataPath || ''));
      const expectedStateDirectory = path.resolve(app.getPath('documents'), 'Click Interval Auto Macro', 'Settings');
      const pathIdentity = value => process.platform === 'win32' ? value.toLowerCase() : value;
      if (!stateDirectory || stateDirectory === path.parse(stateDirectory).root || pathIdentity(stateDirectory) !== pathIdentity(expectedStateDirectory)) {
        throw new Error('The Click Interval settings path is invalid.');
      }
      fs.mkdirSync(stateDirectory, { recursive: true });
      assertNoLinkedSegments(stateDirectory, { allowMissing: false });
      atomicWriteFile(path.join(stateDirectory, 'update-applied.json'), Buffer.from(JSON.stringify({
        edition: manifest.edition,
        channel: manifest.channel,
        version: manifest.version,
        updatedAt: new Date().toISOString()
      }, null, 2)), transactionId);
    } catch (_) {}
    try { recoverIncompleteUpdate(applicationRoot); } catch (_) {}
    try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch (_) {}
    progress(100, 'Update complete.');
  } catch (error) {
    if (!committed && journalWritten) {
      try { recoverIncompleteUpdate(applicationRoot); }
      catch (recoveryError) { error.message = `${error.message} Automatic rollback could not finish: ${recoveryError.message}`; }
    } else if (!journalWritten) {
      try { removeTransactionBackup(applicationRoot, transactionId); } catch (_) {}
    }
    throw error;
  } finally {
    lock.release();
  }
}

function createUpdaterWindow() {
  const window = new BrowserWindow({
    width: 430,
    height: 250,
    frame: false,
    resizable: false,
    maximizable: false,
    closable: false,
    backgroundColor: '#101010',
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'updater-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('close', event => { if (updateRunning) event.preventDefault(); });
  window.loadFile('updater.html');
  return window;
}

ipcMain.on('click-interval-updater-close', event => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!updateRunning && target && !target.isDestroyed()) target.close();
});

app.on('before-quit', event => {
  if (updateRunning) event.preventDefault();
});

if (require.main === module || process.argv.includes('--friend-update-payload')) {
  app.whenReady().then(async () => {
    const window = createUpdaterWindow();
    const send = (value, message, failed = false) => {
      if (!window.isDestroyed()) window.webContents.send('click-interval-update-progress', { value, message, failed });
    };
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    let payload;
    try {
      updateRunning = true;
      payload = decodePayload();
      await applyUpdate(payload, send);
      await new Promise(resolve => setTimeout(resolve, 600));
      if (payload.reopenAfterUpdate !== false) {
        const child = spawn(String(payload.launchExecutable || process.execPath), [...(Array.isArray(payload.launchArgs) ? payload.launchArgs.map(String) : []), '--click-interval-update-complete'], {
          cwd: String(payload.applicationPath), detached: true, windowsHide: false, stdio: 'ignore', env: minimalChildEnvironment()
        });
        child.unref();
      }
      updateRunning = false;
      window.setClosable(true);
      app.quit();
    } catch (error) {
      updateRunning = false;
      window.setClosable(true);
      send(100, error?.message || 'The update could not be installed.', true);
      try {
        const stateDirectory = path.resolve(String(payload?.userDataPath || ''));
        if (stateDirectory && stateDirectory !== path.parse(stateDirectory).root) {
          fs.mkdirSync(stateDirectory, { recursive: true });
          fs.writeFileSync(path.join(stateDirectory, 'last-update-error.json'), JSON.stringify({ message: String(error?.message || error), failedAt: new Date().toISOString() }, null, 2));
        }
      } catch (_) {}
    }
  });
}

module.exports = { applyUpdate, loadTrustedManifest, resolveInside };
