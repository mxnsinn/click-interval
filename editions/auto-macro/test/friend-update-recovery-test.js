'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  COMMIT_FILE,
  flushFileHandle,
  recoverIncompleteUpdate,
  writeTransactionCommit,
  writeTransactionJournal
} = require('../app/update-recovery');

const deniedFlush = {
  fsyncSync() {
    const error = new Error('operation not permitted, fsync');
    error.code = 'EPERM';
    throw error;
  }
};
assert.equal(flushFileHandle(123, deniedFlush, 'win32'), false, 'Windows EPERM fsync was not treated as an unsupported durability hint.');
assert.throws(() => flushFileHandle(123, deniedFlush, 'linux'), /operation not permitted/, 'Non-Windows fsync failures must remain fatal.');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-update-recovery-'));
try {
  const transactionId = '1770000000000-aabbccddee';
  const backupRoot = path.join(root, '.friend-update-backup', transactionId);
  fs.mkdirSync(backupRoot, { recursive: true });
  const originalPackage = JSON.stringify({ name: 'click-interval-friend', version: '1.0.0' });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'click-interval-friend', version: '1.0.1' }));
  fs.writeFileSync(path.join(backupRoot, 'package.json'), originalPackage);
  fs.writeFileSync(path.join(root, 'changed.js'), 'new');
  fs.writeFileSync(path.join(backupRoot, 'changed.js'), 'old');
  fs.writeFileSync(path.join(root, 'created.js'), 'created');
  fs.mkdirSync(path.join(backupRoot, 'retired'), { recursive: true });
  fs.writeFileSync(path.join(backupRoot, 'retired', 'feature.js'), 'restored');
  writeTransactionJournal(root, {
    schema: 1,
    edition: 'click-interval-friend',
    transactionId,
    previousVersion: '1.0.0',
    targetVersion: '1.0.1',
    changed: [
      { path: 'package.json', existed: true },
      { path: 'changed.js', existed: true },
      { path: 'created.js', existed: false }
    ],
    removed: [{ path: 'retired/feature.js' }]
  });
  assert.throws(() => writeTransactionJournal(root, {
    transactionId,
    previousVersion: '1.0.0',
    targetVersion: '1.0.1',
    changed: [],
    removed: []
  }), /already exists/i);

  const result = recoverIncompleteUpdate(root);
  assert.equal(result.recovered, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.0.0');
  assert.equal(fs.readFileSync(path.join(root, 'changed.js'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(root, 'created.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'retired', 'feature.js'), 'utf8'), 'restored');
  assert.equal(fs.existsSync(path.join(root, '.friend-update-transaction.json')), false);

  const committedId = '1770000000001-1122334455';
  fs.mkdirSync(path.join(root, '.friend-update-backup', committedId), { recursive: true });
  writeTransactionJournal(root, {
    schema: 1,
    edition: 'click-interval-friend',
    transactionId: committedId,
    previousVersion: '1.0.0',
    targetVersion: '1.0.1',
    changed: [],
    removed: []
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'click-interval-friend', version: '1.0.1' }));
  writeTransactionCommit(root, committedId, '1.0.1');
  assert.equal(recoverIncompleteUpdate(root).recovered, false);
  assert.equal(fs.existsSync(path.join(root, '.friend-update-transaction.json')), false);
  assert.equal(fs.existsSync(path.join(root, COMMIT_FILE)), false);

  const bootstrap = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'bootstrap.js'), 'utf8');
  assert.match(bootstrap, /recoverIncompleteUpdate\(__dirname\)/);
  assert.match(bootstrap, /--friend-update-payload/);
  const updater = fs.readFileSync(path.resolve(__dirname, '..', 'app', 'updater-main.js'), 'utf8');
  assert.equal((updater.match(/writeTransactionJournal\(applicationRoot, journal\)/g) || []).length, 1);
  assert.match(updater, /writeTransactionCommit\(applicationRoot, transactionId, manifest\.version\)/);
  assert.match(updater, /if \(updateRunning\) event\.preventDefault\(\)/);

  console.log(JSON.stringify({ passed: true, assertions: 17 }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
