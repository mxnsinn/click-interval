'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { flushFileHandle } = require('./update-recovery');

const CONTROL_SCHEMA = 1;
const MAX_CONTROL_BYTES = 64 * 1024;
// Constructed from non-display compatibility fragments so existing 1.5.143
// clients retain their last verified offline state during the storage rename.
const LEGACY_APPLICATION_DIRECTORY = ['Click Interval', 'Friend'].join(' ');

function verifyReleaseControlEnvelope(envelope, publicKeyBase64, expectedChannel = 'stable') {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('The signed beta control record is invalid.');
  const payloadText = String(envelope.payload || '');
  const signatureText = String(envelope.signature || '');
  if (!payloadText || payloadText.length > Math.ceil(MAX_CONTROL_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9_-]+$/.test(payloadText) ||
      !signatureText || signatureText.length > 256 || !/^[A-Za-z0-9_-]+$/.test(signatureText)) {
    throw new Error('The signed beta control record is malformed.');
  }
  let key;
  let signature;
  let payloadBytes;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(String(publicKeyBase64 || ''), 'base64'), format: 'der', type: 'spki' });
    signature = Buffer.from(signatureText, 'base64url');
    payloadBytes = Buffer.from(payloadText, 'base64url');
  } catch (_) { throw new Error('The beta control signing key is invalid.'); }
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 || !payloadBytes.length || payloadBytes.length > MAX_CONTROL_BYTES ||
      !crypto.verify(null, Buffer.from(payloadText, 'utf8'), key, signature)) {
    throw new Error('The beta control signature could not be verified.');
  }
  let control;
  try { control = JSON.parse(payloadBytes.toString('utf8')); }
  catch (_) { throw new Error('The signed beta control payload is invalid JSON.'); }
  if (!control || control.schema !== CONTROL_SCHEMA || control.edition !== 'click-interval-friend' || control.channel !== expectedChannel) {
    throw new Error('The beta control record belongs to a different or unsupported application channel.');
  }
  const revision = Number(control.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The beta control revision is invalid.');
  if (!['active', 'disabled'].includes(control.state)) throw new Error('The beta control state is invalid.');
  const updatedAt = String(control.updatedAt || '');
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) throw new Error('The beta control timestamp is invalid.');
  return {
    schema: CONTROL_SCHEMA,
    edition: 'click-interval-friend',
    channel: expectedChannel,
    revision,
    state: control.state,
    message: typeof control.message === 'string' ? control.message.slice(0, 1000) : '',
    allowUninstall: control.allowUninstall !== false,
    updatedAt
  };
}

function cachePathForDocuments(documentsPath) {
  return path.join(path.resolve(documentsPath), 'Click Interval Auto Macro', 'Settings', 'signed-release-control.json');
}

function legacyCachePath(cachePath) {
  const settingsDirectory = path.dirname(path.resolve(cachePath));
  const applicationDirectory = path.dirname(settingsDirectory);
  if (path.basename(settingsDirectory).toLowerCase() !== 'settings' || path.basename(applicationDirectory).toLowerCase() !== 'click interval auto macro') return '';
  return path.join(path.dirname(applicationDirectory), LEGACY_APPLICATION_DIRECTORY, 'Settings', 'signed-beta-control.json');
}

function readableCachePath(cachePath) {
  const resolved = path.resolve(cachePath);
  if (fs.existsSync(resolved)) return resolved;
  const legacy = legacyCachePath(resolved);
  return legacy && fs.existsSync(legacy) ? legacy : resolved;
}

function ensureSafeCacheParent(cachePath) {
  const settingsDirectory = path.dirname(path.resolve(cachePath));
  const applicationDirectory = path.dirname(settingsDirectory);
  const documentsDirectory = path.dirname(applicationDirectory);
  for (const directory of [applicationDirectory, settingsDirectory]) {
    if (fs.existsSync(directory)) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The Click Interval control storage path is unsafe.');
    } else {
      const parent = path.dirname(directory);
      if (parent !== documentsDirectory) {
        const parentStat = fs.lstatSync(parent);
        if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('The Click Interval control storage path is unsafe.');
      }
      fs.mkdirSync(directory);
    }
  }
  return settingsDirectory;
}

function readCachedControl(cachePath, config) {
  const readablePath = readableCachePath(cachePath);
  if (!fs.existsSync(readablePath)) return null;
  const stat = fs.lstatSync(readablePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_CONTROL_BYTES * 2) {
    throw new Error('The saved signed beta control record is damaged.');
  }
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(readablePath, 'utf8')); }
  catch (_) { throw new Error('The saved signed beta control record is damaged.'); }
  return { envelope, control: verifyReleaseControlEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable') };
}

function writeCachedControl(cachePath, envelope, config) {
  const incoming = verifyReleaseControlEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable');
  const current = readCachedControl(cachePath, config);
  if (current && incoming.revision < current.control.revision) return current.control;
  if (current && incoming.revision === current.control.revision) {
    if (current.envelope.payload !== envelope.payload || current.envelope.signature !== envelope.signature) {
      throw new Error('The beta control service returned conflicting data for an existing revision.');
    }
    return current.control;
  }
  ensureSafeCacheParent(cachePath);
  const temporaryPath = `${cachePath}.next-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  let handle;
  try {
    handle = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(envelope)}\n`, 'utf8');
    flushFileHandle(handle);
    fs.closeSync(handle);
    handle = null;
    try { fs.renameSync(temporaryPath, cachePath); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.rmSync(cachePath, { force: true });
      fs.renameSync(temporaryPath, cachePath);
    }
  } catch (error) {
    try { if (handle != null) fs.closeSync(handle); } catch (_) {}
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
    throw error;
  }
  return incoming;
}

async function refreshCachedControl(cachePath, config, options = {}) {
  let parsed;
  try { parsed = new URL(String(config?.controlUrl || '')); }
  catch (_) { throw new Error('The beta control URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('The beta control URL must use HTTPS.');
  const { fetchUpdateEnvelope } = require('./update-download');
  const separator = parsed.href.includes('?') ? '&' : '?';
  const envelope = await fetchUpdateEnvelope(`${parsed.href}${separator}check=${Date.now()}`, options);
  verifyReleaseControlEnvelope(envelope, config.manifestPublicKey, config.channel || 'stable');
  return writeCachedControl(cachePath, envelope, config);
}

module.exports = {
  CONTROL_SCHEMA,
  MAX_CONTROL_BYTES,
  cachePathForDocuments,
  ensureSafeCacheParent,
  legacyCachePath,
  readCachedControl,
  refreshCachedControl,
  verifyReleaseControlEnvelope,
  writeCachedControl
};
