'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeReleasePath } = require('./update-manifest');

const INTEGRITY_FILE = '.friend-integrity.json';
const INTEGRITY_SCHEMA = 1;
const MAX_INTEGRITY_BYTES = 512 * 1024;
// This is the public half of the owner-held update key. Keeping an independent
// pin here prevents a replaced update-config + self-signed integrity pair from
// being accepted. The private half never ships.
const PINNED_FRIEND_PUBLIC_KEY = 'MCowBQYDK2VwAyEAnBmRzk0/L6fzp2qjXt0ZJTOfVxE/kiY+cbxTvm0hKXE=';
const TRANSIENT_ROOT_NAMES = new Set([
  '.friend-update.lock',
  '.friend-update-transaction.json',
  '.friend-update-commit.json',
  '.click-interval-update.lock',
  '.click-interval-update-transaction.json',
  '.click-interval-update-commit.json'
]);

function isUnprotectedRuntimePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const first = normalized.split('/')[0].toLowerCase();
  return normalized.toLowerCase() === INTEGRITY_FILE ||
    TRANSIENT_ROOT_NAMES.has(normalized.toLowerCase()) ||
    first === '.friend-update-backup' ||
    first === '.click-interval-update-backup';
}

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function walkProtectedFiles(applicationRoot) {
  const root = path.resolve(applicationRoot);
  const files = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isUnprotectedRuntimePath(relativePath)) continue;
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Application integrity failed: ${relativePath} is a link.`);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile()) files.push({ path: relativePath.replace(/\\/g, '/'), absolutePath, size: stat.size });
      else throw new Error(`Application integrity failed: ${relativePath} is not a regular file.`);
    }
  };
  visit(root);
  return files;
}

function createIntegrityPayload(applicationRoot) {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'));
  if (packageDocument.name !== 'click-interval-friend') throw new Error('Refusing to sign a different Click Interval edition.');
  return {
    schema: INTEGRITY_SCHEMA,
    edition: 'click-interval-friend',
    version: String(packageDocument.version || ''),
    files: walkProtectedFiles(applicationRoot).map(file => ({
      path: file.path,
      size: file.size,
      sha256: sha256FileSync(file.absolutePath)
    }))
  };
}

function verifyIntegrityEnvelope(envelope, publicKeyBase64) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('The application integrity record is invalid.');
  const payloadText = String(envelope.payload || '');
  const signatureText = String(envelope.signature || '');
  if (!payloadText || payloadText.length > Math.ceil(MAX_INTEGRITY_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9_-]+$/.test(payloadText)) {
    throw new Error('The application integrity payload is invalid or too large.');
  }
  if (!signatureText || signatureText.length > 256 || !/^[A-Za-z0-9_-]+$/.test(signatureText)) throw new Error('The application integrity signature is invalid.');
  let key;
  let payloadBytes;
  let signature;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(String(publicKeyBase64 || ''), 'base64'), format: 'der', type: 'spki' });
    payloadBytes = Buffer.from(payloadText, 'base64url');
    signature = Buffer.from(signatureText, 'base64url');
  } catch (_) {
    throw new Error('The application integrity signing key is invalid.');
  }
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !payloadBytes.length || payloadBytes.length > MAX_INTEGRITY_BYTES ||
      !crypto.verify(null, Buffer.from(payloadText, 'utf8'), key, signature)) {
    throw new Error('The application integrity signature could not be verified.');
  }
  let payload;
  try { payload = JSON.parse(payloadBytes.toString('utf8')); }
  catch (_) { throw new Error('The signed application integrity payload is invalid JSON.'); }
  if (!payload || payload.schema !== INTEGRITY_SCHEMA || payload.edition !== 'click-interval-friend' || !String(payload.version || '')) {
    throw new Error('The signed application integrity record belongs to a different or unsupported application.');
  }
  if (!Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 4096) throw new Error('The signed application file list is invalid.');
  const seen = new Set();
  const files = payload.files.map(entry => {
    const filePath = normalizeReleasePath(entry?.path);
    const keyPath = filePath.toLowerCase();
    if (isUnprotectedRuntimePath(filePath) || seen.has(keyPath)) throw new Error(`The signed application file list contains an invalid path: ${filePath}.`);
    seen.add(keyPath);
    const size = Number(entry?.size);
    const sha256 = String(entry?.sha256 || '').toLowerCase();
    if (!Number.isSafeInteger(size) || size < 0 || size > 256 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`The signed application record for ${filePath} is invalid.`);
    }
    return { path: filePath, size, sha256 };
  });
  for (const required of ['bootstrap.js', 'app-integrity.js', 'friend-control.js', 'release-control.js', 'update-config.json', 'package.json', 'main.js', 'backend.py']) {
    if (!seen.has(required)) throw new Error(`The signed application record is missing ${required}.`);
  }
  return { ...payload, files };
}

function verifyInstalledApplication(applicationRoot, options = {}) {
  const root = path.resolve(applicationRoot);
  const configPath = path.join(root, 'update-config.json');
  const integrityPath = path.join(root, INTEGRITY_FILE);
  let config;
  let envelope;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const stat = fs.lstatSync(integrityPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INTEGRITY_BYTES * 2) throw new Error('unsafe integrity file');
    envelope = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
  } catch (_) {
    throw new Error('Click Interval cannot start because its signed integrity record is missing or damaged. Reinstall or restore the original files.');
  }
  const trustedPublicKey = String(options.trustedPublicKey || PINNED_FRIEND_PUBLIC_KEY);
  if (String(config.manifestPublicKey || '') !== trustedPublicKey) {
    throw new Error('Click Interval cannot start because its update trust key was edited. Reinstall or restore the original files.');
  }
  const payload = verifyIntegrityEnvelope(envelope, trustedPublicKey);
  const packageDocument = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packageDocument.name !== 'click-interval-friend' || String(packageDocument.version || '') !== payload.version) {
    throw new Error('Click Interval cannot start because its installed version does not match its signed integrity record. Reinstall or restore the original files.');
  }
  const allowedExtras = new Set((options.allowedExtraPaths || []).map(value => String(value).replace(/\\/g, '/').toLowerCase()));
  const actual = walkProtectedFiles(root).filter(file => !allowedExtras.has(file.path.toLowerCase()));
  const expected = new Map(payload.files.map(file => [file.path.toLowerCase(), file]));
  if (actual.length !== expected.size) {
    const extra = actual.find(file => !expected.has(file.path.toLowerCase()));
    const missing = payload.files.find(file => !actual.some(candidate => candidate.path.toLowerCase() === file.path.toLowerCase()));
    const detail = extra?.path || missing?.path || 'application files';
    throw new Error(`Click Interval cannot start because ${detail} was added, removed, or edited. Reinstall or restore the original files.`);
  }
  for (const file of actual) {
    const signed = expected.get(file.path.toLowerCase());
    if (!signed || signed.size !== file.size || sha256FileSync(file.absolutePath) !== signed.sha256) {
      throw new Error(`Click Interval cannot start because ${file.path} was added, removed, or edited. Reinstall or restore the original files.`);
    }
  }
  return payload;
}

module.exports = {
  INTEGRITY_FILE,
  INTEGRITY_SCHEMA,
  PINNED_FRIEND_PUBLIC_KEY,
  createIntegrityPayload,
  isUnprotectedRuntimePath,
  sha256FileSync,
  verifyInstalledApplication,
  verifyIntegrityEnvelope,
  walkProtectedFiles
};
