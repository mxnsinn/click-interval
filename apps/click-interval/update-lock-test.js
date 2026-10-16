'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  acquireUpdateLock,
  inspectUpdateLock,
  isUpdateLockActive,
  releaseUpdateLock,
  updateLockPath
} = require('./update-lock');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-update-lock-'));
const lockPath = updateLockPath(temporaryRoot);

try {
  const ownedLock = acquireUpdateLock(temporaryRoot);
  assert.equal(isUpdateLockActive(temporaryRoot), true, 'the live owner must keep the lock active');
  assert.throws(
    () => acquireUpdateLock(temporaryRoot),
    /Another update is already in progress/i,
    'a second updater must not enter the transaction'
  );
  releaseUpdateLock(ownedLock);
  assert.equal(fs.existsSync(lockPath), false, 'the owner must release its lock');

  fs.writeFileSync(lockPath, '{', 'utf8');
  const freshCorrupt = inspectUpdateLock(temporaryRoot);
  assert.equal(freshCorrupt.active, true, 'a fresh partial lock write must be treated as active');
  assert.equal(isUpdateLockActive(temporaryRoot), true);
  assert.equal(fs.existsSync(lockPath), true, 'a fresh partial lock must not be stolen');

  const oldTimestamp = new Date('2000-01-01T00:00:00.000Z');
  fs.utimesSync(lockPath, oldTimestamp, oldTimestamp);
  assert.equal(isUpdateLockActive(temporaryRoot), false, 'an abandoned corrupt lock must be recoverable');
  assert.equal(fs.existsSync(lockPath), false, 'recovery must remove the abandoned corrupt lock');

  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 2147483647,
    transactionId: 'dead-owner-test',
    startedAt: new Date().toISOString()
  }), 'utf8');
  assert.equal(
    isUpdateLockActive(temporaryRoot, { processExists: () => false }),
    false,
    'a lock whose owner exited must be recoverable immediately'
  );
  assert.equal(fs.existsSync(lockPath), false);

  console.log(JSON.stringify({
    passed: true,
    liveOwnerRejected: true,
    partialWriteProtected: true,
    corruptLockRecovered: true,
    deadOwnerRecovered: true
  }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
