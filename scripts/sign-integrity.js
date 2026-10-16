'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--app-root') values.appRoot = path.resolve(String(argv[++index] || ''));
    else if (argv[index] === '--owner-root') values.ownerRoot = path.resolve(String(argv[++index] || ''));
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!values.appRoot || !values.ownerRoot) throw new Error('Both --app-root and --owner-root are required.');
  return values;
}

function atomicWrite(filePath, bytes) {
  const temporary = `${filePath}.next-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    try { fs.renameSync(temporary, filePath); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporary, filePath);
    }
  } catch (error) {
    try { if (handle != null) fs.closeSync(handle); } catch (_) {}
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function signFriendIntegrity(appRoot, ownerRoot) {
  const resolvedApp = path.resolve(appRoot);
  const resolvedOwner = path.resolve(ownerRoot);
  if (resolvedApp === resolvedOwner || resolvedApp === path.parse(resolvedApp).root || resolvedOwner === path.parse(resolvedOwner).root) {
    throw new Error('The integrity signing paths are unsafe.');
  }
  const integrity = require(path.join(resolvedApp, 'app-integrity.js'));
  const config = JSON.parse(fs.readFileSync(path.join(resolvedApp, 'update-config.json'), 'utf8'));
  const ownerConfig = JSON.parse(fs.readFileSync(path.join(resolvedOwner, 'channel.json'), 'utf8'));
  const privateKeyPath = path.resolve(String(ownerConfig.privateKeyPath || path.join(resolvedOwner, 'friend-update-private-key.pem')));
  if (!privateKeyPath.toLowerCase().startsWith(`${resolvedOwner}${path.sep}`.toLowerCase())) throw new Error('The private signing key must stay in owner-private.');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The friend integrity key is not Ed25519.');
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  if (config.edition !== 'click-interval-friend' || config.channel !== ownerConfig.channel || config.manifestPublicKey !== publicKey || config.manifestUrl !== ownerConfig.manifestUrl) {
    throw new Error('The app integrity trust anchor does not match the owner-controlled update channel.');
  }
  if (integrity.PINNED_FRIEND_PUBLIC_KEY !== publicKey) throw new Error('The compiled friend integrity public-key pin does not match the owner signing identity.');
  const payloadDocument = integrity.createIntegrityPayload(resolvedApp);
  const payload = Buffer.from(JSON.stringify(payloadDocument), 'utf8').toString('base64url');
  const envelope = { payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url') };
  integrity.verifyIntegrityEnvelope(envelope, publicKey);
  const output = path.join(resolvedApp, integrity.INTEGRITY_FILE);
  atomicWrite(output, Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8'));
  integrity.verifyInstalledApplication(resolvedApp);
  return { output, version: payloadDocument.version, files: payloadDocument.files.length };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(signFriendIntegrity(options.appRoot, options.ownerRoot), null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; }
}

module.exports = { atomicWrite, parseArguments, signFriendIntegrity };
