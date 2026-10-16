'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPDATE_LOCK_FILE = '.update-lock.json';
const CORRUPT_LOCK_GRACE_MS = 30_000;

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Windows can deny signaling a live process owned by another integrity level.
    return error?.code === 'EPERM';
  }
}

function updateLockPath(applicationRoot) {
  return path.join(path.resolve(applicationRoot), UPDATE_LOCK_FILE);
}

function inspectUpdateLock(applicationRoot, options = {}) {
  const lockPath = updateLockPath(applicationRoot);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const processExistsFn = typeof options.processExists === 'function' ? options.processExists : processExists;
  const corruptGraceMs = Number.isFinite(options.corruptGraceMs)
    ? Math.max(0, Number(options.corruptGraceMs))
    : CORRUPT_LOCK_GRACE_MS;
  let stat;
  let raw;
  try {
    stat = fs.statSync(lockPath);
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, active: false, stale: false, lockPath };
    return { exists: true, active: true, stale: false, lockPath, reason: 'unreadable' };
  }

  let owner = null;
  try { owner = JSON.parse(raw); } catch (_) {}
  const pid = Number(owner?.pid);
  const transactionId = typeof owner?.transactionId === 'string' ? owner.transactionId : '';
  if (Number.isInteger(pid) && pid > 0 && transactionId) {
    if (processExistsFn(pid)) {
      return { exists: true, active: true, stale: false, lockPath, raw, owner, stat, reason: 'owned' };
    }
    return { exists: true, active: false, stale: true, lockPath, raw, owner, stat, reason: 'dead-owner' };
  }

  const ageMs = Math.max(0, Number(now()) - Number(stat.mtimeMs || 0));
  if (ageMs < corruptGraceMs) {
    return { exists: true, active: true, stale: false, lockPath, raw, owner, stat, reason: 'initializing' };
  }
  return { exists: true, active: false, stale: true, lockPath, raw, owner, stat, reason: 'corrupt' };
}

function removeStaleUpdateLock(snapshot, options = {}) {
  if (!snapshot?.exists || !snapshot.stale || !snapshot.lockPath) return false;
  const current = inspectUpdateLock(path.dirname(snapshot.lockPath), options);
  if (!current.exists) return true;
  if (!current.stale || current.raw !== snapshot.raw) return false;
  try {
    fs.unlinkSync(snapshot.lockPath);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function isUpdateLockActive(applicationRoot, options = {}) {
  const snapshot = inspectUpdateLock(applicationRoot, options);
  if (!snapshot.exists) return false;
  if (snapshot.active) return true;
  return !removeStaleUpdateLock(snapshot, options);
}

function acquireUpdateLock(applicationRoot) {
  const resolvedRoot = path.resolve(applicationRoot);
  fs.mkdirSync(resolvedRoot, { recursive: true });
  const lockPath = updateLockPath(resolvedRoot);
  const transactionId = `${Date.now()}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(descriptor, JSON.stringify({
          pid: process.pid,
          transactionId,
          startedAt: new Date().toISOString()
        }, null, 2), 'utf8');
        fs.fsyncSync(descriptor);
      } catch (error) {
        try { fs.closeSync(descriptor); } catch (_) {}
        descriptor = undefined;
        try { fs.unlinkSync(lockPath); } catch (_) {}
        throw error;
      }
      return { lockPath, transactionId };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (isUpdateLockActive(resolvedRoot)) throw new Error('Another update is already in progress.');
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
    }
  }
  throw new Error('Another update is already in progress.');
}

function releaseUpdateLock(lock) {
  if (!lock?.lockPath || !lock?.transactionId) return;
  try {
    const owner = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'));
    if (owner?.transactionId === lock.transactionId) fs.unlinkSync(lock.lockPath);
  } catch (_) {}
}

module.exports = {
  CORRUPT_LOCK_GRACE_MS,
  acquireUpdateLock,
  inspectUpdateLock,
  isUpdateLockActive,
  processExists,
  releaseUpdateLock,
  removeStaleUpdateLock,
  updateLockPath
};
