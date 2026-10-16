'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '..');
const integrityModule = require(path.join(sourceRoot, 'app', 'app-integrity.js'));
const controlModule = require(path.join(sourceRoot, 'app', 'release-control.js'));
const publisher = require(path.join(sourceRoot, 'owner-tools', 'publish-friend-update.js'));
const { minimalChildEnvironment } = require(path.join(sourceRoot, 'app', 'process-environment.js'));

function signDocument(document, privateKey) {
  const payload = Buffer.from(JSON.stringify(document), 'utf8').toString('base64url');
  return { payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url') };
}

function write(filePath, bytes = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function signApplication(appRoot, privateKey, publicKeyBase64) {
  const document = integrityModule.createIntegrityPayload(appRoot);
  const envelope = signDocument(document, privateKey);
  integrityModule.verifyIntegrityEnvelope(envelope, publicKeyBase64);
  write(path.join(appRoot, integrityModule.INTEGRITY_FILE), `${JSON.stringify(envelope)}\n`);
  return envelope;
}

function controlDocument(revision, state, message = '') {
  return {
    schema: 1,
    edition: 'click-interval-friend',
    channel: 'stable',
    revision,
    state,
    message,
    allowUninstall: true,
    updatedAt: new Date(1_800_000_000_000 + revision * 1000).toISOString()
  };
}

function run() {
  let assertions = 0;
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-integrity-control-'));
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const appRoot = path.join(temporaryRoot, 'app');
    fs.mkdirSync(appRoot);
    write(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'click-interval-friend', version: '9.8.7' }));
    write(path.join(appRoot, 'update-config.json'), JSON.stringify({
      edition: 'click-interval-friend', channel: 'stable', manifestPublicKey: publicKeyBase64,
      manifestUrl: 'https://updates.example/channel/manifest.json', controlUrl: 'https://updates.example/channel/control.json'
    }));
    for (const fileName of ['bootstrap.js', 'app-integrity.js', 'friend-control.js', 'release-control.js', 'main.js', 'backend.py']) write(path.join(appRoot, fileName));
    write(path.join(appRoot, 'runtime', 'engine.bin'), 'runtime');
    signApplication(appRoot, privateKey, publicKeyBase64);

    const integrityOptions = { trustedPublicKey: publicKeyBase64 };
    assert.equal(integrityModule.verifyInstalledApplication(appRoot, integrityOptions).version, '9.8.7'); assertions += 1;
    assert.throws(() => integrityModule.verifyInstalledApplication(appRoot), /trust key|edited/i); assertions += 1;
    write(path.join(appRoot, '.friend-update.lock'), '{}');
    write(path.join(appRoot, '.friend-update-backup', 'ignored', 'old.bin'), 'old');
    assert.doesNotThrow(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions)); assertions += 1;
    fs.rmSync(path.join(appRoot, '.friend-update.lock'));
    fs.rmSync(path.join(appRoot, '.friend-update-backup'), { recursive: true });

    const mainPath = path.join(appRoot, 'main.js');
    write(mainPath, 'edited');
    assert.throws(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions), /edited|integrity|restore/i); assertions += 1;
    write(mainPath, 'test');
    assert.doesNotThrow(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions)); assertions += 1;
    fs.rmSync(mainPath);
    assert.throws(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions), /removed|integrity|restore/i); assertions += 1;
    write(mainPath, 'test');
    write(path.join(appRoot, 'injected.js'), 'malicious');
    assert.throws(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions), /added|integrity|restore/i); assertions += 1;
    fs.rmSync(path.join(appRoot, 'injected.js'));
    const envelopePath = path.join(appRoot, integrityModule.INTEGRITY_FILE);
    const damaged = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    damaged.signature = `${damaged.signature.startsWith('A') ? 'B' : 'A'}${damaged.signature.slice(1)}`;
    write(envelopePath, JSON.stringify(damaged));
    assert.throws(() => integrityModule.verifyInstalledApplication(appRoot, integrityOptions), /signature|integrity/i); assertions += 1;
    signApplication(appRoot, privateKey, publicKeyBase64);

    const cachePath = controlModule.cachePathForDocuments(path.join(temporaryRoot, 'Documents'));
    fs.mkdirSync(path.join(temporaryRoot, 'Documents'));
    const config = { manifestPublicKey: publicKeyBase64, channel: 'stable' };
    const active0 = signDocument(controlDocument(0, 'active'), privateKey);
    const disabled2 = signDocument(controlDocument(2, 'disabled', 'Testing finished.'), privateKey);
    const replayedActive1 = signDocument(controlDocument(1, 'active'), privateKey);
    const legacyCache = controlModule.legacyCachePath(cachePath);
    write(legacyCache, JSON.stringify(active0));
    assert.equal(controlModule.readCachedControl(cachePath, config).control.revision, 0); assertions += 1;
    fs.rmSync(legacyCache, { force: true });
    assert.equal(controlModule.writeCachedControl(cachePath, active0, config).revision, 0); assertions += 1;
    assert.equal(controlModule.writeCachedControl(cachePath, disabled2, config).state, 'disabled'); assertions += 1;
    assert.equal(controlModule.writeCachedControl(cachePath, replayedActive1, config).state, 'disabled'); assertions += 1;
    assert.equal(controlModule.readCachedControl(cachePath, config).control.revision, 2); assertions += 1;
    const conflicting2 = signDocument(controlDocument(2, 'active'), privateKey);
    assert.throws(() => controlModule.writeCachedControl(cachePath, conflicting2, config), /conflicting/i); assertions += 1;
    const forged = { ...disabled2, signature: active0.signature };
    assert.throws(() => controlModule.verifyReleaseControlEnvelope(forged, publicKeyBase64), /signature/i); assertions += 1;

    const controlPath = path.join(temporaryRoot, 'publish', 'control.json');
    const context = { privateKey, publicKey: publicKeyBase64, ownerConfig: { channel: 'stable' }, controlPath, localControl: null };
    const initial = publisher.publishControl({ controlState: '', controlMessage: '', controlAllowUninstall: true }, { context, remoteControl: null });
    assert.equal(initial.control.state, 'active'); assertions += 1;
    assert.equal(initial.control.revision, 0); assertions += 1;
    context.localControl = { envelope: initial.envelope, control: initial.control };
    const disabled = publisher.publishControl({ controlState: 'disabled', controlMessage: 'Beta closed.', controlAllowUninstall: true }, { context, remoteControl: null });
    assert.equal(disabled.control.state, 'disabled'); assertions += 1;
    assert.equal(disabled.control.revision, 1); assertions += 1;
    context.localControl = { envelope: disabled.envelope, control: disabled.control };
    const active = publisher.publishControl({ controlState: 'active', controlMessage: '', controlAllowUninstall: true }, { context, remoteControl: null });
    assert.equal(active.control.state, 'active'); assertions += 1;
    assert.equal(active.control.revision, 2); assertions += 1;
    assert.throws(() => publisher.publishControl({ controlState: 'disabled', controlMessage: '', controlAllowUninstall: true }, {
      context: { ...context, localControl: null, controlPath: path.join(temporaryRoot, 'other-control.json') }, remoteControl: null
    }), /initial.*active/i); assertions += 1;

    const safeEnvironment = minimalChildEnvironment({
      SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', OPENAI_API_KEY: 'secret', USERPROFILE: 'C:\\Users\\person', Path: 'secret-path'
    });
    assert.equal(safeEnvironment.SystemRoot, 'C:\\Windows'); assertions += 1;
    assert(!Object.prototype.hasOwnProperty.call(safeEnvironment, 'OPENAI_API_KEY')); assertions += 1;
    assert(!Object.prototype.hasOwnProperty.call(safeEnvironment, 'USERPROFILE')); assertions += 1;
    assert(!Object.prototype.hasOwnProperty.call(safeEnvironment, 'Path')); assertions += 1;

    const bootstrap = fs.readFileSync(path.join(sourceRoot, 'app', 'bootstrap.js'), 'utf8');
    assert(bootstrap.indexOf('verifyBeforeLaunch()') < bootstrap.indexOf("require('./main')"), 'Main loads before integrity verification.'); assertions += 1;
    assert(bootstrap.includes('refreshDisabledControl'), 'A cached revocation cannot check a newer signed reactivation before blocking startup.'); assertions += 1;
    const updater = fs.readFileSync(path.join(sourceRoot, 'app', 'updater-main.js'), 'utf8');
    assert(updater.includes("verifyInstalledApplication(stageRoot, { allowedExtraPaths: ['manifest.json'] })")); assertions += 1;
    assert(updater.includes('verifyInstalledApplication(applicationRoot)')); assertions += 1;
    assert(updater.includes("'controlUrl'"), 'Updater does not pin the separate control URL.'); assertions += 1;
    const updateClient = fs.readFileSync(path.join(sourceRoot, 'app', 'update-client.js'), 'utf8');
    assert(updateClient.includes('writeCachedControl') && updateClient.includes('checkControl')); assertions += 1;
    assert(updateClient.includes('minimalChildEnvironment()')); assertions += 1;
    assert(updateClient.includes('verifyInstalledApplication(applicationPath)') && updateClient.includes('onIntegrityFailure'), 'Running app does not recheck integrity on its update interval.'); assertions += 1;
    const productionConfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'app', 'update-config.json'), 'utf8'));
    assert.equal(integrityModule.PINNED_FRIEND_PUBLIC_KEY, productionConfig.manifestPublicKey); assertions += 1;
    const ownerCommand = path.join(sourceRoot, 'owner-tools', 'Set-ClickIntervalBetaState.ps1');
    assert(fs.existsSync(ownerCommand)); assertions += 1;

    console.log(JSON.stringify({ passed: true, assertions }));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run();
