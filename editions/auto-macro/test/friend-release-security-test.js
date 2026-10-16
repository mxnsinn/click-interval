'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EDITION_ID = 'click-interval-friend';
const sourceRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(sourceRoot, '..');
const isolatedRoot = path.resolve(process.env.CLICK_INTERVAL_FRIEND_ROOT || 'D:\\Codex-Projects\\ClickIntervalFriend');

function argument(name, fallback) {
  const marker = process.argv.indexOf(name);
  return marker >= 0 && process.argv[marker + 1] ? path.resolve(process.argv[marker + 1]) : fallback;
}

const appRoot = argument('--app', path.join(isolatedRoot, 'app'));
const mainConfigPath = path.join(projectRoot, 'update-config.json');

function walk(root) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const stat = fs.lstatSync(fullPath);
      assert(!stat.isSymbolicLink(), `Release contains a symbolic link: ${path.relative(root, fullPath)}`);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
      else assert.fail(`Release contains a non-regular entry: ${path.relative(root, fullPath)}`);
    }
  };
  visit(root);
  return files;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRelative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function isTextFile(filePath) {
  return new Set([
    '.css', '.html', '.js', '.json', '.md', '.ps1', '.py', '.txt', '.xml', '.yml', '.yaml'
  ]).has(path.extname(filePath).toLowerCase());
}

function assertEd25519PublicKey(value) {
  const key = crypto.createPublicKey({
    key: Buffer.from(String(value || ''), 'base64'),
    format: 'der',
    type: 'spki'
  });
  assert.equal(key.asymmetricKeyType, 'ed25519', 'Friend update key must be Ed25519.');
}

function assertNoFeatureLeaks(files, auditedRoot = appRoot) {
  const forbiddenPathPatterns = [
    /(^|\/)minecraft(?:-server)?(\/|$)/i,
    /(^|\/)assembly(\/|$)/i,
    /(^|\/)voice(?:-changer|-processor)?(?:\.|\/|$)/i,
    /(^|\/)crosshair(?:[-.]|\/|$)/i,
    /(^|\/)world-map(?:[-.]|\/|$)/i,
    /(^|\/)server-console(?:[-.]|\/|$)/i,
    /(^|\/)player-inspector(?:[-.]|\/|$)/i,
    /(^|\/)entity-viewer(?:[-.]|\/|$)/i,
    /(^|\/)motd-editor(?:[-.]|\/|$)/i
  ];
  const forbiddenTextPatterns = [
    { label: 'Minecraft', pattern: /\bminecraft\b/i },
    { label: 'Assembly', pattern: /\bassembly\b/i },
    { label: 'voice changer', pattern: /\bvoice[ -]?changer\b/i },
    { label: 'proximity voice', pattern: /\bproximity[ -]?voice\b/i },
    { label: 'crosshair', pattern: /\bcrosshair\b/i },
    { label: 'world map', pattern: /\bworld[ -]?map\b/i },
    { label: 'server protection', pattern: /\bserver[ -]?protection\b/i }
  ];
  const secretExtensions = new Set(['.key', '.pem', '.p12', '.pfx']);

  for (const filePath of files) {
    const relative = normalizeRelative(auditedRoot, filePath);
    for (const pattern of forbiddenPathPatterns) {
      assert(!pattern.test(relative), `Forbidden feature path leaked into friend release: ${relative}`);
    }
    assert(!secretExtensions.has(path.extname(filePath).toLowerCase()), `Private-key file leaked into friend release: ${relative}`);
    assert(!/(^|\/)(?:owner-private|owner-tools|signing-private)(\/|$)/i.test(relative), `Owner-only update tooling leaked into friend release: ${relative}`);
    if (!isTextFile(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    assert(!/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(text), `Private signing key leaked into ${relative}`);
    for (const { label, pattern } of forbiddenTextPatterns) {
      assert(!pattern.test(text), `${label} reference leaked into friend release: ${relative}`);
    }
  }
}

function assertOnlyTwoTools() {
  const indexPath = path.join(appRoot, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const declaredTools = new Set();
  for (const match of index.matchAll(/data-(?:tool|page|view)=["']([^"']+)["']/gi)) {
    const value = match[1].toLowerCase();
    if (value.includes('auto-clicker')) declaredTools.add('auto-clicker');
    if (value === 'macro' || value.startsWith('macro-')) declaredTools.add('macro');
  }
  if (/id=["']showAutoClicker["']/i.test(index)) declaredTools.add('auto-clicker');
  if (/id=["']showMacro["']/i.test(index)) declaredTools.add('macro');
  assert(index.toLowerCase().includes('auto clicker'), 'Friend UI is missing Auto Clicker.');
  assert(index.toLowerCase().includes('macro'), 'Friend UI is missing Macro.');
  assert.deepEqual([...declaredTools].sort(), ['auto-clicker', 'macro'], 'Friend UI must expose only Auto Clicker and Macro.');
  const toolTabs = [...index.matchAll(/<button\b[^>]*\bclass=["'][^"']*\btool-tab\b[^"']*["'][^>]*>/gi)];
  assert.equal(toolTabs.length, 2, 'Friend UI must contain exactly two tool tabs.');

  const packageJson = readJson(path.join(appRoot, 'package.json'));
  assert.equal(packageJson.name, 'click-interval-friend', 'Friend package must have an isolated application identity.');
  assert.equal(packageJson.productName, 'Click Interval', 'The public product name must be Click Interval.');
  assert.equal(packageJson.main, 'bootstrap.js', 'Friend app must start through the update recovery boundary.');
  assert.match(String(packageJson.version || ''), /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, 'Friend version must be semver-like.');
  assert(!Object.prototype.hasOwnProperty.call(packageJson.dependencies || {}, 'nat-api'), 'Friend package must not ship the server-only NAT dependency.');

  const appMain = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
  assert(/app\.setName\(['"]Click Interval['"]\)/.test(appMain), 'The public process name must be Click Interval.');
  assert(/app\.setAppUserModelId\(['"]ClickInterval\.AutoMacro['"]\)/.test(appMain), 'The Auto/Macro Windows application ID must be isolated.');
  assert(/click-interval-auto-macro/i.test(appMain), 'The Auto/Macro user-data directory must have a distinct identity.');
  assert(/Click Interval Auto Macro/.test(appMain), 'The Auto/Macro durable settings and macro storage must have a distinct directory.');
  assert(!/Click Interval Friend/i.test(appMain), 'The old Friend label remains in public application code.');
  assert(!/['"]Documents['"]\s*,\s*['"]Click Interval['"]\s*,\s*['"]Settings['"]/.test(appMain), 'Friend app must not reuse the main app settings directory.');
}

function assertLocalReferencesResolve(files, auditedRoot = appRoot) {
  for (const filePath of files.filter(value => path.extname(value).toLowerCase() === '.html')) {
    const html = fs.readFileSync(filePath, 'utf8');
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
      const reference = match[1].trim();
      if (!reference || reference.startsWith('#') || /^(?:https?:|data:|blob:|mailto:)/i.test(reference)) continue;
      const cleanReference = reference.split(/[?#]/, 1)[0];
      const resolved = path.resolve(path.dirname(filePath), cleanReference);
      const appPrefix = `${path.resolve(auditedRoot)}${path.sep}`.toLowerCase();
      assert(resolved.toLowerCase().startsWith(appPrefix), `HTML reference escapes friend app: ${reference}`);
      assert(fs.existsSync(resolved), `Missing local asset referenced by ${normalizeRelative(auditedRoot, filePath)}: ${reference}`);
    }
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findByteOffsets(filePath, needle, maximumMatches = 16) {
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let carry = Buffer.alloc(0);
  let fileOffset = 0;
  const offsets = [];
  try {
    for (;;) {
      const count = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!count) break;
      const block = Buffer.concat([carry, buffer.subarray(0, count)]);
      const blockOffset = fileOffset - carry.length;
      let searchAt = 0;
      for (;;) {
        const found = block.indexOf(needle, searchAt);
        if (found < 0) break;
        offsets.push(blockOffset + found);
        if (offsets.length >= maximumMatches) return offsets;
        searchAt = found + 1;
      }
      carry = block.subarray(Math.max(0, block.length - needle.length + 1));
      fileOffset += count;
    }
  } finally {
    fs.closeSync(handle);
  }
  return offsets;
}

function readAt(filePath, offset, length) {
  const handle = fs.openSync(filePath, 'r');
  const bytes = Buffer.alloc(length);
  try {
    const count = fs.readSync(handle, bytes, 0, length, offset);
    assert.equal(count, length, `Could not read installer data at offset ${offset}.`);
    return bytes;
  } finally {
    fs.closeSync(handle);
  }
}

function readCabinetDirectory(filePath, cabinetOffset) {
  const header = readAt(filePath, cabinetOffset, 36);
  assert.equal(header.subarray(0, 4).toString('ascii'), 'MSCF', 'Installer payload is not a cabinet.');
  const cabinetSize = header.readUInt32LE(8);
  const fileTableOffset = header.readUInt32LE(16);
  const fileCount = header.readUInt16LE(28);
  assert(cabinetSize >= 44 && cabinetOffset + cabinetSize <= fs.statSync(filePath).size, 'Installer cabinet bounds are invalid.');
  assert(fileCount > 0 && fileCount <= 16, 'Installer cabinet contains an unexpected number of payloads.');
  let cursor = cabinetOffset + fileTableOffset;
  const entries = [];
  for (let index = 0; index < fileCount; index += 1) {
    const entry = readAt(filePath, cursor, 16 + 512);
    const terminator = entry.indexOf(0, 16);
    assert(terminator > 16, 'Installer cabinet contains an invalid payload name.');
    entries.push({
      name: entry.subarray(16, terminator).toString('utf8'),
      size: entry.readUInt32LE(0)
    });
    cursor += terminator + 1;
  }
  return entries;
}

function assertPortableReleaseMatchesApp() {
  const portableRoot = path.join(isolatedRoot, 'release', 'Click-Interval-win-x64');
  assert(fs.existsSync(portableRoot), `Portable friend release is missing: ${portableRoot}`);
  assert(fs.existsSync(path.join(portableRoot, 'Click Interval.exe')), 'Portable Click Interval executable is missing.');
  const portableApp = path.join(portableRoot, 'resources', 'app');
  assert(fs.existsSync(portableApp), 'Portable release does not contain its isolated app payload.');
  const sourceFiles = walk(appRoot);
  const portableFiles = walk(portableApp);
  assertNoFeatureLeaks(portableFiles, portableApp);
  assertLocalReferencesResolve(portableFiles, portableApp);
  const sourceMap = new Map(sourceFiles.map(filePath => [normalizeRelative(appRoot, filePath), sha256(filePath)]));
  const portableMap = new Map(portableFiles.map(filePath => [normalizeRelative(portableApp, filePath), sha256(filePath)]));
  assert.deepEqual([...portableMap.keys()].sort(), [...sourceMap.keys()].sort(), 'Portable app payload differs from the audited isolated app tree.');
  for (const [relative, digest] of sourceMap) {
    assert.equal(portableMap.get(relative), digest, `Portable app file differs from audited source: ${relative}`);
  }
}

function assertOwnerKeyAndPublishedFeedContinuity() {
  const ownerRoot = path.join(isolatedRoot, 'owner-private');
  const ownerConfigPath = path.join(ownerRoot, 'channel.json');
  assert(fs.existsSync(ownerConfigPath), 'Owner-controlled friend update channel is not initialized.');
  const ownerConfig = readJson(ownerConfigPath);
  const privateKeyPath = path.resolve(String(ownerConfig.privateKeyPath || path.join(ownerRoot, 'friend-update-private-key.pem')));
  const ownerPrefix = `${path.resolve(ownerRoot)}${path.sep}`.toLowerCase();
  assert(privateKeyPath.toLowerCase().startsWith(ownerPrefix), 'Friend signing key is outside owner-private.');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath));
  assert.equal(privateKey.asymmetricKeyType, 'ed25519', 'Owner friend update key must be Ed25519.');
  const publicKeyBase64 = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const appConfig = readJson(path.join(appRoot, 'update-config.json'));
  assert.equal(appConfig.manifestPublicKey, publicKeyBase64, 'Packaged friend trust key no longer matches the persistent owner key.');
  assert.equal(appConfig.manifestUrl, ownerConfig.manifestUrl, 'Packaged friend manifest URL no longer matches the owner channel.');
  assert.equal(appConfig.channel, ownerConfig.channel, 'Packaged friend channel no longer matches the owner channel.');

  const publishRoot = path.join(isolatedRoot, 'updates-publish');
  assert(fs.existsSync(publishRoot), 'Public friend update output is missing.');
  const publicFiles = walk(publishRoot);
  for (const filePath of publicFiles) {
    const relative = normalizeRelative(publishRoot, filePath);
    assert(!/\.(?:key|pem|p12|pfx)$/i.test(relative), `Private-key file entered public update output: ${relative}`);
    const bytes = fs.readFileSync(filePath);
    assert(!bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')), `Private key material entered public update output: ${relative}`);
  }
  const localEnvelopePath = path.join(publishRoot, ownerConfig.channelToken, 'manifest.json');
  assert(fs.existsSync(localEnvelopePath), 'Signed public friend update signal is missing.');
  const manifestModule = require(path.join(appRoot, 'update-manifest.js'));
  const manifest = manifestModule.verifyFriendUpdateEnvelope(readJson(localEnvelopePath), appConfig.manifestPublicKey, appConfig.channel);
  assert.equal(manifest.edition, EDITION_ID);
  assert.equal(manifest.version, readJson(path.join(appRoot, 'package.json')).version, 'Published signal does not match the friend app version.');
  assert.equal(new URL(manifest.baseUrl).origin, new URL(appConfig.manifestUrl).origin, 'Signed release files are advertised from a different update origin.');
  const publishedFileRoot = path.join(publishRoot, ownerConfig.channelToken, 'releases', manifest.version, 'files');
  for (const file of manifest.files) {
    const filePath = path.join(publishedFileRoot, ...file.path.split('/'));
    assert(fs.existsSync(filePath), `Published friend update file is missing: ${file.path}`);
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.length, file.size, `Published size mismatch: ${file.path}`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, `Published checksum mismatch: ${file.path}`);
  }
}

function assertChannelIsolation() {
  const friendConfigPath = path.join(appRoot, 'update-config.json');
  const friendConfig = readJson(friendConfigPath);
  const mainConfig = readJson(mainConfigPath);
  assert.equal(friendConfig.edition, EDITION_ID, 'Friend updater must be bound to the friend edition ID.');
  const manifestUrl = new URL(friendConfig.manifestUrl);
  assert.equal(manifestUrl.protocol, 'https:', 'Friend update manifest URL must use HTTPS.');
  assert(manifestUrl.hostname.endsWith('.netlify.app'), 'Friend app must use its deployed Netlify HTTPS update host.');
  assert.equal(friendConfig.channel, 'stable', 'Friend app must use its explicit stable release channel.');
  assert.notEqual(friendConfig.manifestUrl, mainConfig.manifestUrl, 'Friend edition must not share the main app update feed.');
  assert.notEqual(friendConfig.manifestPublicKey, mainConfig.manifestPublicKey, 'Friend edition must not trust the main app signing key.');
  assertEd25519PublicKey(friendConfig.manifestPublicKey);
  assert(!friendConfig.stagedUpdatePath, 'Friend release must not contain a local staged-update path from the owner PC.');

  const manifestModulePath = path.join(appRoot, 'update-manifest.js');
  delete require.cache[require.resolve(manifestModulePath)];
  const manifestModule = require(manifestModulePath);
  assert.equal(typeof manifestModule.verifyFriendUpdateEnvelope, 'function', 'Friend signed-manifest verifier is missing.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const makeEnvelope = manifest => {
    const payload = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64url');
    return {
      payload,
      signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url')
    };
  };
  const requiredFiles = (manifestModule.REQUIRED_UPDATE_FILES || ['package.json']).map(filePath => ({
    path: filePath,
    size: 2,
    sha256: 'a'.repeat(64)
  }));
  const valid = {
    schema: 1,
    edition: EDITION_ID,
    channel: 'stable',
    version: '9.9.9',
    publishedAt: '2026-10-15T00:00:00.000Z',
    baseUrl: 'https://updates.example/friend/9.9.9/',
    files: requiredFiles
  };
  const verified = manifestModule.verifyFriendUpdateEnvelope(makeEnvelope(valid), publicKeyBase64, 'stable');
  assert.equal(verified.edition, EDITION_ID, 'Verifier did not return the bound friend manifest.');
  assert.throws(
    () => manifestModule.verifyFriendUpdateEnvelope(makeEnvelope({ ...valid, edition: 'click-interval' }), publicKeyBase64, 'stable'),
    /edition|channel|product/i,
    'A correctly signed cross-edition manifest must still be rejected.'
  );
  const tampered = makeEnvelope(valid);
  tampered.payload = Buffer.from(JSON.stringify({ ...valid, version: '99.0.0' }), 'utf8').toString('base64url');
  assert.throws(
    () => manifestModule.verifyFriendUpdateEnvelope(tampered, publicKeyBase64, 'stable'),
    /verif|signature|invalid/i,
    'Tampered signed update payload must be rejected.'
  );

  const updateClient = fs.readFileSync(path.join(appRoot, 'update-client.js'), 'utf8');
  const appMain = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(appRoot, 'bootstrap.js'), 'utf8');
  const updaterMain = fs.readFileSync(path.join(appRoot, 'updater-main.js'), 'utf8');
  const updateRecovery = fs.readFileSync(path.join(appRoot, 'update-recovery.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(appRoot, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(appRoot, 'preload.js'), 'utf8');
  const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  assert(updateClient.includes('verifyFriendUpdateEnvelope'), 'Update client must use signed-manifest verification.');
  assert(updateClient.includes(EDITION_ID), 'Update client must enforce the friend edition binding.');
  assert(/isNewerVersion|compareVersions|compareVersion/.test(updateClient), 'Update client must reject rollback and same-version signals.');
  assert(/sha256/i.test(updateClient), 'Update client must require a package checksum.');
  assert(!appMain.includes('CLICK_INTERVAL_UPDATE_MANIFEST'), 'Packaged friend app must not allow an unsigned environment-variable manifest bypass.');
  assert(!/response\.json\(\)/.test(appMain), 'Main process must not retain the legacy unsigned manifest parser.');
  assert(!/response\.arrayBuffer\(\)/.test(appMain), 'Main process must not buffer an unbounded installer in memory.');
  assert(/require\(['"]\.\/update-client['"]\)/.test(appMain), 'Main process must delegate update checks to the hardened friend update client.');
  assert(bootstrap.includes('recoverIncompleteUpdate') && bootstrap.includes('waitForUpdateBoundary'), 'Friend startup must recover an interrupted update before loading the app.');
  assert(updaterMain.includes('writeTransactionJournal') && updaterMain.includes('recoverIncompleteUpdate'), 'Friend updater must persist and recover its transaction.');
  assert.equal((updaterMain.match(/writeTransactionJournal\(applicationRoot, journal\)/g) || []).length, 1, 'Updater must create one immutable precomputed transaction journal.');
  assert(/writeTransactionCommit\(applicationRoot,\s*transactionId,\s*manifest\.version\)/.test(updaterMain), 'Updater must use a separate durable commit marker.');
  assert(updateRecovery.includes('COMMIT_FILE') && updateRecovery.includes('durableAtomicCreate'), 'Recovery must use create-only journal and commit markers.');
  assert(updaterMain.includes('assertStagedTrustContinuity') && ['edition', 'channel', 'manifestUrl', 'manifestPublicKey'].every(anchor => updaterMain.includes(`'${anchor}'`)), 'Updater must preserve its embedded key, edition, channel, and manifest URL.');
  assert(updaterMain.includes('fs.createReadStream') && !/return\s*\{\s*\.\.\.file,\s*bytes\s*\}/.test(updaterMain), 'Updater must not retain every release payload in memory.');
  assert(/\.on\(['"]close['"][\s\S]{0,180}preventDefault/.test(updaterMain) && updaterMain.includes('updateRunning'), 'Updater window must block close while files are being replaced.');
  assert(/app\.on\(['"]before-quit['"][\s\S]{0,180}preventDefault/.test(updaterMain), 'OS/app quit must be blocked while files are being replaced.');
  assert(preload.includes('checkForUpdates') && preload.includes('installUpdate'), 'Friend renderer bridge must expose both manual checking and installation.');
  assert(renderer.includes('checkForUpdates') && renderer.includes('installUpdate'), 'Friend update control must switch between checking and installation.');
  assert(/check-mode|Check for updates/i.test(renderer), 'Friend update control must remain available in manual check mode.');
  const updateButtonMarkup = index.match(/<button\b[^>]*\bid=["']updateWindow["'][^>]*>/i)?.[0] || '';
  assert(updateButtonMarkup && !/\shidden(?:\s|=|>)/i.test(updateButtonMarkup), 'Friend manual update/check button must be visible by default.');
}

function assertArchiveListingIsClean() {
  const candidates = [];
  const searchRoots = [path.join(isolatedRoot, 'release'), isolatedRoot];
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    for (const filePath of walk(root)) {
      if (/Click-Interval-.*-win-x64\.zip$/i.test(path.basename(filePath))) candidates.push(filePath);
    }
  }
  if (!candidates.length) return;
  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const archive = candidates[0];
  assert(fs.statSync(archive).size > 0, 'Friend release archive is empty.');
  const archiveName = path.basename(archive);
  assert(!/owner|private|signing/i.test(archiveName), 'Friend archive name exposes owner-only material.');
  const listing = spawnSync('tar.exe', ['-tf', archive], { encoding: 'utf8', windowsHide: true });
  assert.equal(listing.status, 0, `Could not inspect friend archive: ${listing.stderr || listing.stdout}`);
  const entries = String(listing.stdout || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  assert(entries.length > 0, 'Friend archive contains no files.');
  const archivedAppFiles = [];
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    assert(!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized), `Archive contains an absolute path: ${entry}`);
    assert(!normalized.split('/').includes('..'), `Archive contains a traversal path: ${entry}`);
    assert(!/(^|\/)(?:minecraft(?:-server)?|assembly|owner-private|owner-tools)(\/|$)/i.test(normalized), `Forbidden path leaked into archive: ${entry}`);
    assert(!/(?:voice|crosshair|world-map|server-console|player-inspector|entity-viewer|motd-editor)/i.test(normalized), `Forbidden feature file leaked into archive: ${entry}`);
    assert(!/\.(?:key|pem|p12|pfx)$/i.test(normalized), `Private-key file leaked into archive: ${entry}`);
    const appMarker = '/resources/app/';
    const markerIndex = normalized.toLowerCase().indexOf(appMarker);
    if (markerIndex >= 0 && !normalized.endsWith('/')) archivedAppFiles.push(normalized.slice(markerIndex + appMarker.length));
  }
  const expectedAppFiles = walk(appRoot).map(filePath => normalizeRelative(appRoot, filePath)).sort();
  assert.deepEqual(archivedAppFiles.sort(), expectedAppFiles, 'Archive app payload differs from the audited isolated app tree.');

  const packageJson = readJson(path.join(appRoot, 'package.json'));
  const installer = path.join(isolatedRoot, 'release', `Click-Interval-${packageJson.version}-Setup.exe`);
  assert(fs.existsSync(installer), 'Friend setup executable is missing.');
  assert(fs.statSync(installer).size > 1024, 'Friend setup executable is unexpectedly empty.');
  assert.equal(findByteOffsets(installer, Buffer.from('-----BEGIN PRIVATE KEY-----'), 1).length, 0, 'Private signing key leaked into the friend setup executable.');
  const cabinetOffsets = findByteOffsets(installer, Buffer.from('MSCF'));
  assert.equal(cabinetOffsets.length, 1, 'Friend setup executable has an unexpected embedded-cabinet layout.');
  const cabinetEntries = readCabinetDirectory(installer, cabinetOffsets[0]);
  const installerCommand = path.join(sourceRoot, 'installer', 'install-click-interval.cmd');
  assert.deepEqual(cabinetEntries, [
    { name: path.basename(archive), size: fs.statSync(archive).size },
    { name: 'install-click-interval.cmd', size: fs.statSync(installerCommand).size }
  ], 'Friend installer contains payloads other than the audited archive and installer command.');
}

function run() {
  assert(fs.existsSync(appRoot), `Friend app output does not exist: ${appRoot}`);
  const files = walk(appRoot);
  assert(files.length > 0, 'Friend app output is empty.');
  assertNoFeatureLeaks(files);
  assertOnlyTwoTools();
  assertLocalReferencesResolve(files);
  assertChannelIsolation();
  assertPortableReleaseMatchesApp();
  assertArchiveListingIsClean();
  assertOwnerKeyAndPublishedFeedContinuity();
  console.log(JSON.stringify({
    passed: true,
    edition: EDITION_ID,
    appRoot,
    filesAudited: files.length
  }));
}

run();
