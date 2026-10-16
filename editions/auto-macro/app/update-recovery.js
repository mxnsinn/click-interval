'use strict';

const fs = require('fs');
const path = require('path');
const { assertNoLinkedSegments, resolveInsideNoLinks } = require('./update-path-safety');

const JOURNAL_FILE = '.friend-update-transaction.json';
const COMMIT_FILE = '.friend-update-commit.json';
const TRANSACTION_ID_PATTERN = /^[0-9]+-[a-f0-9]{10}$/i;
const WINDOWS_UNSUPPORTED_FLUSH_ERRORS = new Set(['EPERM', 'EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

function flushFileHandle(handle, fileSystem = fs, platform = process.platform) {
  try {
    fileSystem.fsyncSync(handle);
    return true;
  } catch (error) {
    // Some Windows filesystems, sync providers, and security filters allow the
    // write but reject FlushFileBuffers through Node with EPERM. The updater
    // still verifies every staged and installed byte against its signed SHA-256
    // manifest, so an unsupported durability hint must not strand the update.
    if (platform === 'win32' && WINDOWS_UNSUPPORTED_FLUSH_ERRORS.has(error?.code)) return false;
    throw error;
  }
}

function durableAtomicCreate(filePath, bytes, suffix = `${process.pid}`) {
  if (fs.existsSync(filePath)) throw new Error(`The update transaction marker already exists: ${path.basename(filePath)}`);
  const temporary = `${filePath}.recovery-${suffix}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, bytes);
    flushFileHandle(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temporary, filePath);
    const finalHandle = fs.openSync(filePath, 'r+');
    try { flushFileHandle(finalHandle); } finally { fs.closeSync(finalHandle); }
  } catch (error) {
    try { if (handle != null) fs.closeSync(handle); } catch (_) {}
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function durableCopyReplace(filePath, sourcePath, suffix = `${process.pid}`) {
  const temporary = `${filePath}.recovery-${suffix}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    const handle = fs.openSync(temporary, 'r+');
    try { flushFileHandle(handle); } finally { fs.closeSync(handle); }
    try { fs.renameSync(temporary, filePath); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporary, filePath);
    }
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function validateTransactionId(value) {
  const transactionId = String(value || '');
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) throw new Error('The Click Interval update transaction ID is invalid.');
  return transactionId;
}

function validateOperation(entry, kind) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`The Click Interval update ${kind} entry is invalid.`);
  const relativePath = String(entry.path || '');
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`The Click Interval update ${kind} path is invalid.`);
  }
  if (kind === 'changed' && typeof entry.existed !== 'boolean') throw new Error('The Click Interval update changed entry is incomplete.');
  return kind === 'changed' ? { path: relativePath, existed: entry.existed } : { path: relativePath };
}

function writeTransactionJournal(applicationRoot, journal) {
  const resolvedRoot = assertNoLinkedSegments(path.resolve(applicationRoot), { allowMissing: false });
  const transaction = {
    ...journal,
    schema: 1,
    edition: 'click-interval-friend',
    transactionId: validateTransactionId(journal?.transactionId),
    changed: (journal?.changed || []).map(entry => validateOperation(entry, 'changed')),
    removed: (journal?.removed || []).map(entry => validateOperation(entry, 'removed')),
    createdDirectories: (journal?.createdDirectories || []).map(value => validateOperation({ path: value }, 'directory').path)
  };
  delete transaction.phase;
  const journalPath = resolveInsideNoLinks(resolvedRoot, JOURNAL_FILE, { allowMissing: true });
  durableAtomicCreate(journalPath, Buffer.from(`${JSON.stringify(transaction, null, 2)}\n`, 'utf8'), transaction.transactionId);
  return journalPath;
}

function writeTransactionCommit(applicationRoot, transactionId, targetVersion) {
  const resolvedRoot = assertNoLinkedSegments(path.resolve(applicationRoot), { allowMissing: false });
  const marker = {
    schema: 1,
    edition: 'click-interval-friend',
    transactionId: validateTransactionId(transactionId),
    targetVersion: String(targetVersion || ''),
    committedAt: new Date().toISOString()
  };
  if (!marker.targetVersion) throw new Error('The Click Interval update commit marker is incomplete.');
  const commitPath = resolveInsideNoLinks(resolvedRoot, COMMIT_FILE, { allowMissing: true });
  durableAtomicCreate(commitPath, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, 'utf8'), marker.transactionId);
  return commitPath;
}

function readJsonMarker(applicationRoot, relativePath) {
  const markerPath = resolveInsideNoLinks(applicationRoot, relativePath, { allowMissing: true });
  if (!fs.existsSync(markerPath)) return null;
  const stat = fs.lstatSync(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The Click Interval update marker ${relativePath} is unsafe.`);
  try { return JSON.parse(fs.readFileSync(markerPath, 'utf8')); }
  catch (_) { throw new Error(`The Click Interval update marker ${relativePath} is invalid.`); }
}

function loadTransactionJournal(applicationRoot) {
  const journal = readJsonMarker(applicationRoot, JOURNAL_FILE);
  if (!journal) return null;
  if (journal.schema !== 1 || journal.edition !== 'click-interval-friend' || Object.prototype.hasOwnProperty.call(journal, 'phase')) {
    throw new Error('The Click Interval update recovery journal is invalid.');
  }
  journal.transactionId = validateTransactionId(journal.transactionId);
  if (!String(journal.previousVersion || '') || !String(journal.targetVersion || '')) throw new Error('The Click Interval update recovery journal is incomplete.');
  if (!Array.isArray(journal.changed) || !Array.isArray(journal.removed)) throw new Error('The Click Interval update recovery journal is incomplete.');
  journal.changed = journal.changed.map(entry => validateOperation(entry, 'changed'));
  journal.removed = journal.removed.map(entry => validateOperation(entry, 'removed'));
  if (journal.createdDirectories != null && !Array.isArray(journal.createdDirectories)) throw new Error('The Click Interval update recovery directory list is invalid.');
  journal.createdDirectories = (journal.createdDirectories || []).map(value => validateOperation({ path: value }, 'directory').path);
  const seen = new Set();
  for (const entry of [...journal.changed, ...journal.removed]) {
    const key = process.platform === 'win32' ? entry.path.toLowerCase() : entry.path;
    if (seen.has(key)) throw new Error('The Click Interval update recovery journal contains duplicate paths.');
    seen.add(key);
  }
  return journal;
}

function loadCommitMarker(applicationRoot) {
  const marker = readJsonMarker(applicationRoot, COMMIT_FILE);
  if (!marker) return null;
  if (marker.schema !== 1 || marker.edition !== 'click-interval-friend' || !String(marker.targetVersion || '')) {
    throw new Error('The Click Interval update commit marker is invalid.');
  }
  marker.transactionId = validateTransactionId(marker.transactionId);
  return marker;
}

function copyBackup(applicationRoot, backupRoot, entry) {
  const destination = resolveInsideNoLinks(applicationRoot, entry.path, { allowMissing: true });
  const backup = resolveInsideNoLinks(backupRoot, entry.path, { allowMissing: false });
  const backupStat = fs.lstatSync(backup);
  if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error(`The backup for ${entry.path} is unavailable.`);
  resolveInsideNoLinks(applicationRoot, entry.path, { allowMissing: true });
  durableCopyReplace(destination, backup, `rollback-${process.pid}`);
}

function removeTransactionBackup(applicationRoot, transactionId) {
  const backupContainer = resolveInsideNoLinks(applicationRoot, '.friend-update-backup', { allowMissing: true });
  if (!fs.existsSync(backupContainer)) return;
  const containerStat = fs.lstatSync(backupContainer);
  if (!containerStat.isDirectory() || containerStat.isSymbolicLink()) throw new Error('The Click Interval update backup container is unsafe.');
  const backupRoot = resolveInsideNoLinks(backupContainer, validateTransactionId(transactionId), { allowMissing: true });
  if (fs.existsSync(backupRoot)) {
    const stat = fs.lstatSync(backupRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The Click Interval update backup is unsafe.');
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
  try { if (fs.readdirSync(backupContainer).length === 0) fs.rmdirSync(backupContainer); } catch (_) {}
}

function removeMarker(applicationRoot, markerName) {
  const markerPath = resolveInsideNoLinks(applicationRoot, markerName, { allowMissing: true });
  if (fs.existsSync(markerPath)) {
    const stat = fs.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The Click Interval update marker ${markerName} is unsafe.`);
    fs.rmSync(markerPath, { force: true });
  }
}

function recoverIncompleteUpdate(applicationRoot) {
  const resolvedRoot = path.resolve(applicationRoot);
  assertNoLinkedSegments(resolvedRoot, { allowMissing: false });
  const journal = loadTransactionJournal(resolvedRoot);
  const commit = loadCommitMarker(resolvedRoot);
  if (!journal) {
    if (commit) {
      const installedPackage = JSON.parse(fs.readFileSync(resolveInsideNoLinks(resolvedRoot, 'package.json', { allowMissing: false }), 'utf8'));
      if (installedPackage.name !== 'click-interval-friend' || String(installedPackage.version) !== String(commit.targetVersion)) {
        throw new Error('The committed Click Interval update does not match its installed package identity.');
      }
      removeTransactionBackup(resolvedRoot, commit.transactionId);
      removeMarker(resolvedRoot, COMMIT_FILE);
    }
    return { recovered: false };
  }
  if (commit && (commit.transactionId !== journal.transactionId || String(commit.targetVersion) !== String(journal.targetVersion))) {
    throw new Error('The Click Interval update commit marker does not match its transaction journal.');
  }
  if (commit) {
    const installedPackage = JSON.parse(fs.readFileSync(resolveInsideNoLinks(resolvedRoot, 'package.json', { allowMissing: false }), 'utf8'));
    if (installedPackage.name !== 'click-interval-friend' || String(installedPackage.version) !== String(commit.targetVersion)) {
      throw new Error('The committed Click Interval update does not match its installed package identity.');
    }
  }

  if (!commit) {
    const backupContainer = resolveInsideNoLinks(resolvedRoot, '.friend-update-backup', { allowMissing: false });
    const backupRoot = resolveInsideNoLinks(backupContainer, journal.transactionId, { allowMissing: false });
    if (!fs.lstatSync(backupRoot).isDirectory()) throw new Error('The Click Interval update recovery backup is invalid.');
    for (const entry of [...journal.removed].reverse()) copyBackup(resolvedRoot, backupRoot, entry);
    for (const entry of [...journal.changed].reverse()) {
      const destination = resolveInsideNoLinks(resolvedRoot, entry.path, { allowMissing: true });
      if (entry.existed) copyBackup(resolvedRoot, backupRoot, entry);
      else if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`The rollback path ${entry.path} is unsafe.`);
        fs.rmSync(destination, { force: true });
      }
    }
    for (const relativeDirectory of [...journal.createdDirectories].sort((left, right) => right.split('/').length - left.split('/').length)) {
      const directory = resolveInsideNoLinks(resolvedRoot, relativeDirectory, { allowMissing: true });
      if (!fs.existsSync(directory)) continue;
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`The rollback directory ${relativeDirectory} is unsafe.`);
      if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    }
    const restoredPackage = JSON.parse(fs.readFileSync(resolveInsideNoLinks(resolvedRoot, 'package.json', { allowMissing: false }), 'utf8'));
    if (restoredPackage.name !== 'click-interval-friend' || String(restoredPackage.version) !== String(journal.previousVersion)) {
      throw new Error('The previous Click Interval version could not be restored safely.');
    }
  }

  // Once restoration (or commit verification) is complete, remove the journal
  // first. A crash after this point can only leave an inert backup behind; it
  // can never leave a live rollback instruction whose backup is gone.
  removeMarker(resolvedRoot, JOURNAL_FILE);
  removeTransactionBackup(resolvedRoot, journal.transactionId);
  if (commit) removeMarker(resolvedRoot, COMMIT_FILE);
  return { recovered: !commit, previousVersion: journal.previousVersion };
}

module.exports = {
  COMMIT_FILE,
  JOURNAL_FILE,
  flushFileHandle,
  loadCommitMarker,
  loadTransactionJournal,
  recoverIncompleteUpdate,
  removeTransactionBackup,
  writeTransactionCommit,
  writeTransactionJournal
};
