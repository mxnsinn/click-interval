'use strict';

const crypto = require('crypto');

const FRIEND_EDITION_ID = 'click-interval-friend';
const FRIEND_UPDATE_SCHEMA = 1;
const MAX_ENVELOPE_PAYLOAD_BYTES = 256 * 1024;
const MAX_RELEASE_FILES = 2048;
const MAX_RELEASE_BYTES = 256 * 1024 * 1024;
const INTEGRITY_REQUIRED_FROM_VERSION = '1.5.143';
const RELEASE_CONTROL_REQUIRED_FROM_VERSION = '1.5.144';
const LEGACY_REQUIRED_UPDATE_FILES = Object.freeze([
  'package.json',
  'bootstrap.js',
  'main.js',
  'update-config.json',
  'update-client.js',
  'update-download.js',
  'update-manifest.js',
  'update-path-safety.js',
  'update-recovery.js',
  'updater-main.js',
  'updater-preload.js',
  'updater-renderer.js',
  'updater.html',
  'updater.css'
]);
const INTEGRITY_REQUIRED_UPDATE_FILES = Object.freeze([
  'package.json',
  'bootstrap.js',
  '.friend-integrity.json',
  'app-integrity.js',
  'beta-uninstall.js',
  'friend-control.js',
  'main.js',
  'process-environment.js',
  'update-config.json',
  'update-client.js',
  'update-download.js',
  'update-manifest.js',
  'update-path-safety.js',
  'update-recovery.js',
  'updater-main.js',
  'updater-preload.js',
  'updater-renderer.js',
  'updater.html',
  'updater.css'
]);
// beta-uninstall.js, friend-control.js, and release-control.js are inert
// compatibility paths. Older installed clients require these filenames in the
// first migration update, but current code never uses them for remote control.
const REQUIRED_UPDATE_FILES = Object.freeze([
  ...INTEGRITY_REQUIRED_UPDATE_FILES,
  'release-control.js'
]);

function compareVersions(leftValue, rightValue) {
  const parse = value => {
    const match = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
    if (!match) throw new Error(`Invalid version: ${String(value || '')}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''];
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  if (left[3] === right[3]) return 0;
  if (!left[3]) return 1;
  if (!right[3]) return -1;
  return left[3].localeCompare(right[3], 'en', { numeric: true, sensitivity: 'case' });
}

function normalizeReleasePath(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 240 || candidate.includes('\\') || candidate.startsWith('/') || candidate.endsWith('/')) {
    throw new Error('The update contains an invalid file path.');
  }
  const parts = candidate.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\0-\x1f<>:"|?*]/.test(part))) {
    throw new Error('The update contains an unsafe file path.');
  }
  return parts.join('/');
}

function secureHttpsUrl(value, label = 'update URL') {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch (_) { throw new Error(`The ${label} is invalid.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`The ${label} must use HTTPS without credentials or fragments.`);
  }
  return parsed;
}

function verifyFriendUpdateEnvelope(envelope, publicKeyBase64, expectedChannel = 'stable') {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('The update service returned an invalid signed envelope.');
  }
  const payload = String(envelope.payload || '');
  const signatureText = String(envelope.signature || '');
  if (!payload || payload.length > Math.ceil(MAX_ENVELOPE_PAYLOAD_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error('The signed update payload is invalid or too large.');
  }
  if (!signatureText || signatureText.length > 256 || !/^[A-Za-z0-9_-]+$/.test(signatureText)) {
    throw new Error('The update signature is invalid.');
  }

  let key;
  let signature;
  let payloadBytes;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(String(publicKeyBase64 || ''), 'base64'), format: 'der', type: 'spki' });
    signature = Buffer.from(signatureText, 'base64url');
    payloadBytes = Buffer.from(payload, 'base64url');
  } catch (_) {
    throw new Error('The Click Interval update signing key is invalid.');
  }
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !payloadBytes.length || payloadBytes.length > MAX_ENVELOPE_PAYLOAD_BYTES) {
    throw new Error('The signed update envelope is invalid.');
  }
  if (!crypto.verify(null, Buffer.from(payload, 'utf8'), key, signature)) {
    throw new Error('The Click Interval update signature could not be verified.');
  }

  let manifest;
  try { manifest = JSON.parse(payloadBytes.toString('utf8')); }
  catch (_) { throw new Error('The signed update payload is not valid JSON.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('The signed payload is not an update manifest.');
  if (manifest.schema !== FRIEND_UPDATE_SCHEMA) throw new Error('This update manifest format is not supported.');
  if (manifest.edition !== FRIEND_EDITION_ID) throw new Error('This update belongs to a different Click Interval edition.');
  if (manifest.channel !== expectedChannel) throw new Error('This update belongs to a different release channel.');
  compareVersions(manifest.version, manifest.version);
  const baseUrl = secureHttpsUrl(manifest.baseUrl, 'release base URL');
  if (!baseUrl.pathname.endsWith('/')) throw new Error('The release base URL must end with a slash.');
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > MAX_RELEASE_FILES) {
    throw new Error('The update file list is invalid.');
  }

  const seen = new Set();
  let totalBytes = 0;
  const files = manifest.files.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('The update file list is invalid.');
    const filePath = normalizeReleasePath(entry.path);
    const pathKey = filePath.toLowerCase();
    if (seen.has(pathKey)) throw new Error(`The update lists ${filePath} more than once.`);
    seen.add(pathKey);
    const size = Number(entry.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_RELEASE_BYTES) throw new Error(`The size for ${filePath} is invalid.`);
    const sha256 = String(entry.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`The checksum for ${filePath} is invalid.`);
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_RELEASE_BYTES) throw new Error('The update exceeds the release size limit.');
    return { path: filePath, size, sha256 };
  });
  // Releases before integrity enforcement existed remain readable so the
  // already-published 1.0.0 channel can be used as the monotonic baseline.
  // Every current and future release is required to carry the signed exact-
  // file record; this does not weaken installation of 1.5.143+ updates.
  const requiredUpdateFiles = compareVersions(manifest.version, RELEASE_CONTROL_REQUIRED_FROM_VERSION) >= 0
    ? REQUIRED_UPDATE_FILES
    : compareVersions(manifest.version, INTEGRITY_REQUIRED_FROM_VERSION) >= 0
      ? INTEGRITY_REQUIRED_UPDATE_FILES
      : LEGACY_REQUIRED_UPDATE_FILES;
  for (const requiredPath of requiredUpdateFiles) {
    if (!seen.has(requiredPath)) throw new Error(`The update is missing required Click Interval core file: ${requiredPath}.`);
  }

  const removeSeen = new Set();
  const removeFiles = (manifest.removeFiles == null ? [] : manifest.removeFiles).map(value => {
    const filePath = normalizeReleasePath(value);
    const pathKey = filePath.toLowerCase();
    if (seen.has(pathKey) || removeSeen.has(pathKey)) throw new Error(`The removal list contains a conflicting path: ${filePath}.`);
    removeSeen.add(pathKey);
    return filePath;
  });
  if (removeFiles.length > MAX_RELEASE_FILES) throw new Error('The update removal list is too large.');
  if (removeFiles.some(filePath => requiredUpdateFiles.includes(filePath.toLowerCase()))) {
    throw new Error('The update may not remove a required Click Interval core file.');
  }

  const publishedAt = String(manifest.publishedAt || '');
  if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) throw new Error('The update publication time is invalid.');
  return {
    ...manifest,
    baseUrl: baseUrl.href,
    files,
    removeFiles,
    notes: typeof manifest.notes === 'string' ? manifest.notes.slice(0, 4000) : '',
    publishedAt,
    totalBytes
  };
}

function releaseFileUrl(baseUrl, relativePath) {
  const encodedPath = normalizeReleasePath(relativePath).split('/').map(encodeURIComponent).join('/');
  return new URL(encodedPath, secureHttpsUrl(baseUrl, 'release base URL')).href;
}

module.exports = {
  FRIEND_EDITION_ID,
  FRIEND_UPDATE_SCHEMA,
  INTEGRITY_REQUIRED_UPDATE_FILES,
  INTEGRITY_REQUIRED_FROM_VERSION,
  LEGACY_REQUIRED_UPDATE_FILES,
  MAX_ENVELOPE_PAYLOAD_BYTES,
  MAX_RELEASE_BYTES,
  RELEASE_CONTROL_REQUIRED_FROM_VERSION,
  REQUIRED_UPDATE_FILES,
  compareVersions,
  normalizeReleasePath,
  releaseFileUrl,
  secureHttpsUrl,
  verifyFriendUpdateEnvelope
};
