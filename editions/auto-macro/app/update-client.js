'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { verifyInstalledApplication } = require('./app-integrity');
const { downloadVerifiedFile, fetchUpdateEnvelope } = require('./update-download');
const { cachePathForDocuments, readCachedControl, verifyReleaseControlEnvelope, writeCachedControl } = require('./release-control');
const { compareVersions, releaseFileUrl, secureHttpsUrl, verifyFriendUpdateEnvelope } = require('./update-manifest');
const { assertNoLinkedSegments, resolveInsideNoLinks, validateStageRoot } = require('./update-path-safety');
const { minimalChildEnvironment } = require('./process-environment');

function loadConfig(applicationPath) {
  const value = JSON.parse(fs.readFileSync(path.join(applicationPath, 'update-config.json'), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The Click Interval update configuration is invalid.');
  if (value.edition !== 'click-interval-friend' || value.channel !== 'stable') {
    throw new Error('The update configuration belongs to a different Click Interval edition or channel.');
  }
  secureHttpsUrl(value.manifestUrl, 'manifest URL');
  secureHttpsUrl(value.controlUrl, 'beta control URL');
  if (!value.manifestPublicKey || typeof value.manifestPublicKey !== 'string') throw new Error('The Click Interval update signing key is missing.');
  return value;
}

function cleanOldStages(stageParent) {
  assertNoLinkedSegments(stageParent, { allowMissing: false });
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  let entries = [];
  try { entries = fs.readdirSync(stageParent, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    if (!entry.name.startsWith('release-')) continue;
    const candidate = path.join(stageParent, entry.name);
    try {
      const stat = fs.lstatSync(candidate);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('The Click Interval update staging directory contains an unsafe linked release entry.');
      }
      assertNoLinkedSegments(candidate, { allowMissing: false });
      if (stat.mtimeMs < cutoff) {
        assertNoLinkedSegments(candidate, { allowMissing: false });
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function waitForUpdaterLock(applicationPath, updaterPid, nonce) {
  const lockPath = path.join(applicationPath, '.friend-update.lock');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (Number(lock.pid) === Number(updaterPid) && String(lock.nonce || '') === String(nonce)) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The update helper did not secure the application before installation.');
}

function createFriendUpdateController(options = {}) {
  const electronApp = options.app;
  if (!electronApp || typeof electronApp.getVersion !== 'function') throw new Error('The updater requires the Electron app instance.');
  const applicationPath = path.resolve(options.applicationPath || __dirname);
  const sendStatus = typeof options.sendStatus === 'function' ? options.sendStatus : () => {};
  const settingsDirectory = typeof options.settingsDirectory === 'function'
    ? options.settingsDirectory
    : () => path.join(electronApp.getPath('documents'), 'Click Interval Auto Macro', 'Settings');
  const quitForUpdate = typeof options.quitForUpdate === 'function' ? options.quitForUpdate : () => electronApp.quit();
  const onRevoked = typeof options.onRevoked === 'function' ? options.onRevoked : () => electronApp.quit();
  const onIntegrityFailure = typeof options.onIntegrityFailure === 'function' ? options.onIntegrityFailure : () => electronApp.quit();
  let available = null;
  let checkPromise = null;
  let installing = false;
  let enforcedControlRevision = -1;

  function controlCache(config) {
    return cachePathForDocuments(electronApp.getPath('documents'));
  }

  async function checkControl() {
    const config = loadConfig(applicationPath);
    const separator = config.controlUrl.includes('?') ? '&' : '?';
    const envelope = await fetchUpdateEnvelope(`${config.controlUrl}${separator}check=${Date.now()}`);
    // Verify before touching local state, then persist only the highest signed
    // revision. A replayed older "active" record cannot replace a revocation.
    verifyReleaseControlEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable');
    const control = writeCachedControl(controlCache(config), envelope, config);
    if (control.state === 'disabled' && control.revision > enforcedControlRevision) {
      enforcedControlRevision = control.revision;
      available = null;
      sendStatus('disabled', { message: control.message, revision: control.revision, allowUninstall: control.allowUninstall });
      Promise.resolve(onRevoked(control)).catch(() => electronApp.quit());
    }
    return control;
  }

  async function check({ manual = false } = {}) {
    if (checkPromise) return checkPromise;
    if (manual) sendStatus('checking');
    checkPromise = (async () => {
      try { verifyInstalledApplication(applicationPath); }
      catch (error) {
        available = null;
        sendStatus('integrity-error', { message: error?.message || 'The installed application files were edited.' });
        Promise.resolve(onIntegrityFailure(error)).catch(() => electronApp.quit());
        return null;
      }
      let control = null;
      try { control = await checkControl(); }
      catch (_) {
        // A timeout, outage, or malformed network response must never create a
        // new revocation. The last verified record remains cached and startup
        // enforcement handles a previously verified disabled state offline.
        try {
          const config = loadConfig(applicationPath);
          control = readCachedControl(controlCache(config), config)?.control || null;
        } catch (_) {}
      }
      if (control?.state === 'disabled') {
        if (control.revision > enforcedControlRevision) {
          enforcedControlRevision = control.revision;
          available = null;
          sendStatus('disabled', { message: control.message, revision: control.revision, allowUninstall: control.allowUninstall });
          Promise.resolve(onRevoked(control)).catch(() => electronApp.quit());
        }
        return null;
      }
      try {
        const config = loadConfig(applicationPath);
        const separator = config.manifestUrl.includes('?') ? '&' : '?';
        const envelope = await fetchUpdateEnvelope(`${config.manifestUrl}${separator}check=${Date.now()}`);
        const manifest = verifyFriendUpdateEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable');
        if (compareVersions(manifest.version, electronApp.getVersion()) <= 0) {
          available = null;
          sendStatus('current', { currentVersion: electronApp.getVersion() });
          return null;
        }
        available = { envelope, manifest };
        sendStatus('available', { version: manifest.version, notes: manifest.notes, canInstall: true });
        return manifest;
      } catch (error) {
        available = null;
        if (manual) sendStatus('error', { message: error?.message || 'The update check failed.' });
        return null;
      }
    })().finally(() => { checkPromise = null; });
    return checkPromise;
  }

  async function install() {
    if (installing) return { started: false, reason: 'An update is already being prepared.' };
    installing = true;
    let stagePath = '';
    try {
      const checkedManifest = await check({ manual: true });
      if (!checkedManifest || !available) return { started: false, reason: 'No newer Click Interval update is available.' };
      const { envelope, manifest } = available;
      const stageParent = path.join(os.tmpdir(), 'click-interval-friend-updates');
      fs.mkdirSync(stageParent, { recursive: true });
      assertNoLinkedSegments(stageParent, { allowMissing: false });
      cleanOldStages(stageParent);
      stagePath = fs.mkdtempSync(path.join(stageParent, 'release-'));
      validateStageRoot(stagePath, os.tmpdir());
      const envelopeBytes = Buffer.from(JSON.stringify(envelope), 'utf8');
      fs.writeFileSync(path.join(stagePath, 'manifest.json'), envelopeBytes, { mode: 0o600, flag: 'wx' });

      let completeBytes = 0;
      sendStatus('downloading', { version: manifest.version, progress: 0 });
      for (const file of manifest.files) {
        const destinationPath = resolveInsideNoLinks(stagePath, file.path, { allowMissing: true });
        await downloadVerifiedFile({
          url: releaseFileUrl(manifest.baseUrl, file.path),
          destinationPath,
          expectedSize: file.size,
          expectedSha256: file.sha256,
          onProgress: received => {
            const progress = Math.min(99, Math.floor(((completeBytes + received) / manifest.totalBytes) * 100));
            sendStatus('downloading', { version: manifest.version, progress });
          }
        });
        completeBytes += file.size;
      }

      // Re-read and verify the signed envelope immediately before handing the staged
      // tree to the separate updater process. The updater repeats this verification.
      const config = loadConfig(applicationPath);
      const stagedEnvelope = JSON.parse(fs.readFileSync(path.join(stagePath, 'manifest.json'), 'utf8'));
      const stagedManifest = verifyFriendUpdateEnvelope(stagedEnvelope, config.manifestPublicKey, config.channel || 'stable');
      if (stagedManifest.version !== manifest.version) throw new Error('The staged update identity changed unexpectedly.');

      const payload = {
        currentVersion: electronApp.getVersion(),
        targetVersion: manifest.version,
        parentPid: process.pid,
        applicationPath,
        stagePath,
        userDataPath: path.resolve(settingsDirectory()),
        launchExecutable: process.execPath,
        launchArgs: electronApp.isPackaged ? [] : [applicationPath],
        reopenAfterUpdate: options.reopenAfterUpdate !== false,
        nonce: crypto.randomBytes(16).toString('hex')
      };
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const updaterArguments = electronApp.isPackaged
        ? ['--friend-update-payload', encoded]
        : [applicationPath, '--friend-update-payload', encoded];
      const updater = spawn(process.execPath, updaterArguments, {
        cwd: applicationPath,
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        env: minimalChildEnvironment()
      });
      await new Promise((resolve, reject) => {
        updater.once('spawn', resolve);
        updater.once('error', reject);
      });
      try { await waitForUpdaterLock(applicationPath, updater.pid, payload.nonce); }
      catch (error) { try { updater.kill(); } catch (_) {} throw error; }
      updater.unref();
      sendStatus('installing', { version: manifest.version, progress: 100 });
      quitForUpdate();
      return { started: true, version: manifest.version };
    } catch (error) {
      if (stagePath) {
        try { fs.rmSync(stagePath, { recursive: true, force: true }); } catch (_) {}
      }
      sendStatus('error', { message: error?.message || 'The update could not be prepared.' });
      return { started: false, reason: error?.message || 'The update could not be prepared.' };
    } finally {
      installing = false;
    }
  }

  function intervalMinutes() {
    try { return Math.max(5, Math.min(24 * 60, Number(loadConfig(applicationPath).checkIntervalMinutes) || 5)); }
    catch (_) { return 5; }
  }

  return { check, checkControl, install, intervalMinutes, getAvailable: () => available?.manifest || null };
}

module.exports = { cleanOldStages, createFriendUpdateController, loadConfig, waitForUpdaterLock };
