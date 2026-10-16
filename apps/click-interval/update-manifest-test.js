'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifySignedUpdateManifest } = require('./update-manifest');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const manifest = { version: '1.5.95', installerUrl: 'https://example.test/setup.exe', sha256: 'a'.repeat(64) };
const payload = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url');
const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');

assert.deepEqual(verifySignedUpdateManifest({ payload, signature }, publicKeyBase64), manifest);
assert.throws(() => verifySignedUpdateManifest({ payload: `${payload}A`, signature }, publicKeyBase64), /verified|JSON|invalid/i);
assert.throws(() => verifySignedUpdateManifest({ payload, signature: 'not-a-signature' }, publicKeyBase64), /invalid/i);
assert.throws(() => verifySignedUpdateManifest(manifest, publicKeyBase64), /envelope|payload/i);

console.log('PASS signed update manifest verification');
