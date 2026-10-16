'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '..');
const appRoot = path.join(sourceRoot, 'app');
const integrityModule = require(path.join(appRoot, 'app-integrity.js'));

function write(filePath, bytes = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function signDocument(document, privateKey) {
  const payload = Buffer.from(JSON.stringify(document), 'utf8').toString('base64url');
  return { payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url') };
}

function run() {
  let assertions = 0;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-integrity-policy-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const testApp = path.join(temporaryRoot, 'app');
    fs.mkdirSync(testApp);
    write(path.join(testApp, 'package.json'), JSON.stringify({ name: 'click-interval-friend', version: '9.8.7' }));
    write(path.join(testApp, 'update-config.json'), JSON.stringify({
      edition: 'click-interval-friend', channel: 'stable', manifestPublicKey: publicKeyBase64,
      manifestUrl: 'https://updates.example/channel/manifest.json'
    }));
    for (const fileName of ['bootstrap.js', 'app-integrity.js', 'friend-control.js', 'release-control.js', 'main.js', 'backend.py']) {
      write(path.join(testApp, fileName));
    }
    write(path.join(testApp, 'runtime', 'engine.bin'), 'runtime');
    const integrity = integrityModule.createIntegrityPayload(testApp);
    write(path.join(testApp, integrityModule.INTEGRITY_FILE), `${JSON.stringify(signDocument(integrity, privateKey))}\n`);
    assert.equal(integrityModule.verifyInstalledApplication(testApp, { trustedPublicKey: publicKeyBase64 }).version, '9.8.7'); assertions += 1;
    write(path.join(testApp, 'main.js'), 'edited');
    assert.throws(() => integrityModule.verifyInstalledApplication(testApp, { trustedPublicKey: publicKeyBase64 }), /edited|integrity|restore/i); assertions += 1;

    const bootstrap = fs.readFileSync(path.join(appRoot, 'bootstrap.js'), 'utf8');
    const main = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
    const updateClient = fs.readFileSync(path.join(appRoot, 'update-client.js'), 'utf8');
    const updater = fs.readFileSync(path.join(appRoot, 'updater-main.js'), 'utf8');
    const compatibilityControl = fs.readFileSync(path.join(appRoot, 'release-control.js'), 'utf8');
    const userUninstall = fs.readFileSync(path.join(appRoot, 'beta-uninstall.js'), 'utf8');

    assert(bootstrap.indexOf('verifyBeforeLaunch()') < bootstrap.indexOf("require('./main')")); assertions += 1;
    assert(!/cachedBetaControl|refreshDisabledControl|enforceCachedRevocation/.test(bootstrap)); assertions += 1;
    assert(!/onRevoked|showRevocationAndExit/.test(main)); assertions += 1;
    assert(!/checkControl|writeCachedControl|readCachedControl|sendStatus\(['"]disabled/.test(updateClient)); assertions += 1;
    assert(updateClient.includes('verifyInstalledApplication(applicationPath)') && updateClient.includes('onIntegrityFailure')); assertions += 1;
    assert(!/['"]controlUrl['"]/.test(updater)); assertions += 1;
    assert(/deprecated:\s*true/.test(compatibilityControl) && !/fetch|https?:|state\s*===\s*['"]disabled/.test(compatibilityControl)); assertions += 1;
    assert(/explicit local user action/.test(userUninstall) && !/disabled by its owner|showRevocationAndExit|control\?\./.test(userUninstall)); assertions += 1;
    assert(/env:\s*minimalChildEnvironment\(\)/.test(userUninstall)); assertions += 1;

    console.log(JSON.stringify({ passed: true, assertions }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run();
