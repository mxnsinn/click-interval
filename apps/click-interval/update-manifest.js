'use strict';

const crypto = require('crypto');

const MAX_SIGNED_UPDATE_PAYLOAD_BYTES = 256 * 1024;

function verifySignedUpdateManifest(envelope, publicKeyBase64) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('The update service returned an invalid signed envelope.');
  }
  const payload = String(envelope.payload || '');
  const signatureText = String(envelope.signature || '');
  if (!payload || payload.length > Math.ceil(MAX_SIGNED_UPDATE_PAYLOAD_BYTES * 4 / 3) + 8 ||
      !/^[A-Za-z0-9_-]+$/.test(payload)) {
    throw new Error('The signed update payload is invalid or too large.');
  }
  if (!signatureText || signatureText.length > 256 || !/^[A-Za-z0-9_-]+$/.test(signatureText)) {
    throw new Error('The update manifest signature is invalid.');
  }
  let publicKey;
  let signature;
  let payloadBytes;
  try {
    publicKey = crypto.createPublicKey({
      key: Buffer.from(String(publicKeyBase64 || ''), 'base64'),
      format: 'der',
      type: 'spki'
    });
    signature = Buffer.from(signatureText, 'base64url');
    payloadBytes = Buffer.from(payload, 'base64url');
  } catch {
    throw new Error('The update signing configuration is invalid.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519' || signature.length !== 64 ||
      payloadBytes.length <= 1 || payloadBytes.length > MAX_SIGNED_UPDATE_PAYLOAD_BYTES) {
    throw new Error('The signed update envelope is invalid.');
  }
  // The service signs the literal base64url payload string. This prevents
  // alternative textual encodings from being accepted for the same JSON.
  if (!crypto.verify(null, Buffer.from(payload, 'utf8'), publicKey, signature)) {
    throw new Error('The update manifest signature could not be verified.');
  }
  let manifest;
  try { manifest = JSON.parse(payloadBytes.toString('utf8')); }
  catch { throw new Error('The signed update payload is not valid JSON.'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('The signed update payload is not a manifest.');
  }
  return manifest;
}

module.exports = { MAX_SIGNED_UPDATE_PAYLOAD_BYTES, verifySignedUpdateManifest };
