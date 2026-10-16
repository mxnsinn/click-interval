'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const friendRoot = path.resolve(__dirname, '..');
const sourceApp = path.join(friendRoot, 'app');
const isolatedRoot = path.resolve(process.env.CLICK_INTERVAL_FRIEND_ROOT || path.join(friendRoot, '.external-build'));
const builtApp = path.join(isolatedRoot, 'app');
const portableApp = path.join(isolatedRoot, 'release', 'Click-Interval-win-x64', 'resources', 'app');

function walk(root) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      assert(!stat.isSymbolicLink(), `Friend payload contains a linked path: ${path.relative(root, absolutePath)}`);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
      else assert.fail(`Friend payload contains a non-regular entry: ${path.relative(root, absolutePath)}`);
    }
  };
  visit(root);
  return files;
}

function isText(filePath) {
  return new Set(['.css', '.html', '.js', '.json', '.md', '.ps1', '.py', '.svg', '.txt', '.cmd']).has(path.extname(filePath).toLowerCase());
}

function sha256(filePath) {
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

function assertNoEmbeddedOwnerData(root) {
  const forbiddenDataNames = /(?:^|[\\/])(?:macro-library|last-macro|hotkey-settings|preferences|live-backend-state|update-applied|last-update-error)\.json$/i;
  const forbiddenDirectories = /(?:^|[\\/])(?:Macros|Settings|logs|work|owner-private|updates-publish)(?:[\\/]|$)/i;
  const home = path.resolve(os.homedir());
  const username = (() => { try { return os.userInfo().username; } catch (_) { return ''; } })();
  const fingerprints = [
    home,
    home.replace(/\\/g, '/'),
    path.resolve(friendRoot, '..'),
    path.resolve(friendRoot, '..').replace(/\\/g, '/'),
    username && username.length >= 4 ? username : ''
  ].filter(value => value && value.length >= 4);

  for (const filePath of walk(root)) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    assert(!forbiddenDataNames.test(relative), `Personal state was packaged: ${relative}`);
    assert(!forbiddenDirectories.test(relative), `Private/runtime data directory was packaged: ${relative}`);
    assert(!/\.(?:cimacro|log|db|sqlite(?:3)?|bak)$/i.test(relative), `Personal/runtime data file was packaged: ${relative}`);
    const bytes = fs.readFileSync(filePath);
    assert(!bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')), `Owner private key was packaged: ${relative}`);
    for (const fingerprint of fingerprints) {
      assert(!bytes.includes(Buffer.from(fingerprint, 'utf8')), `Owner path or identity leaked into ${relative}`);
      assert(!bytes.includes(Buffer.from(fingerprint, 'utf16le')), `Owner path or identity leaked into ${relative}`);
    }
  }
}

function assertStorageAndImportBoundaries(root) {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert(/app\.setName\(['"]Click Interval['"]\)/.test(main), 'The public application name must remain Click Interval.');
  assert(/app\.setAppUserModelId\(['"]ClickInterval\.AutoMacro['"]\)/.test(main), 'The Auto/Macro AppUserModelId is not isolated.');
  assert(/path\.join\(app\.getPath\(['"]appData['"]\),\s*['"]click-interval-auto-macro['"]\)/.test(main), 'The Auto/Macro AppData path is not isolated.');
  assert(/path\.join\(app\.getPath\(['"]documents['"]\),\s*['"]Click Interval Auto Macro['"]\)/.test(main), 'The Auto/Macro durable data path is not isolated.');
  assert(!/path\.join\(app\.getPath\(['"]appData['"]\),\s*['"]click-interval['"]\s*\)/.test(main), 'The Auto/Macro app can address the full app profile.');
  assert(!/path\.join\(app\.getPath\(['"]documents['"]\),\s*['"]Click Interval['"]\s*\)/.test(main), 'The Auto/Macro app can address the full app Documents directory.');
  assert(!/app\.getPath\(['"](?:home|desktop|downloads|pictures|videos|music)['"]\)/.test(main), 'The app automatically addresses a personal known folder.');
  assert(!/(?:USERPROFILE|HOMEDRIVE|HOMEPATH|OneDrive|Click Interval[\\/]Macros)/i.test(main), 'The app contains a main-profile or main-macro fallback.');
  assert(/dialog\.showOpenDialog/.test(main), 'Explicit macro import dialog is missing.');
  assert(/properties:\s*\[['"]openFile['"]\]/.test(main), 'Macro import must be a user-selected single file.');
  assert(/function\s+assertManagedMacroPath[\s\S]{0,240}resolvePrivateFile\(macrosDirectory\(\)/.test(main), 'Managed macro writes/deletes are not protected by a strict path boundary.');
  assert(/MAX_IMPORTED_MACRO_BYTES/.test(main), 'User-selected macro imports are not size bounded.');
  assert(/minimalChildEnvironment/.test(main), 'Backend helper processes inherit the full parent environment.');
  assert(/['"]--diagnostic-path['"]\s*,\s*backendDiagnosticsPath\(\)/.test(main), 'Backend diagnostics are not explicitly routed to private AppData.');

  const backend = fs.readFileSync(path.join(root, 'backend.py'), 'utf8');
  assert(/configured_diagnostic_path\(sys\.argv\[1:\]\)/.test(backend), 'Backend diagnostics do not use the private path supplied by the host.');
  assert(!/__file__[^\n]{0,160}(?:work|live-backend-state)/i.test(backend), 'Backend diagnostics can still write into the signed application directory.');

  const environmentPolicy = fs.readFileSync(path.join(root, 'process-environment.js'), 'utf8');
  assert(!/(?:APPDATA|LOCALAPPDATA|USERPROFILE|USERNAME|USERDOMAIN|HOMEPATH|PSModulePath|OPENAI|NETLIFY|GITHUB|TOKEN|SECRET|PASSWORD)/i.test(environmentPolicy), 'Child-process environment allowlist exposes identity, profile paths, or secrets.');
  const updateClient = fs.readFileSync(path.join(root, 'update-client.js'), 'utf8');
  const betaUninstall = fs.readFileSync(path.join(root, 'beta-uninstall.js'), 'utf8');
  assert(/env:\s*minimalChildEnvironment\(\)/.test(updateClient), 'Updater helper inherits the full environment.');
  assert(/env:\s*minimalChildEnvironment\(\)/.test(betaUninstall), 'Uninstall helper inherits the full environment.');

  const storageUsers = ['main.js', 'update-client.js', 'release-control.js', 'updater-main.js']
    .filter(name => fs.existsSync(path.join(root, name)))
    .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]);
  for (const [name, text] of storageUsers) {
    assert(!/['"]Click Interval Friend['"]/.test(text), `${name} still addresses the old Friend Documents folder.`);
    assert(!/path\.(?:join|resolve)\([^\n;]{0,180}['"]Click Interval['"]\s*(?:,|\))/.test(text), `${name} can address the full app Documents folder.`);
    assert(!/path\.(?:join|resolve)\([^\n;]{0,180}['"]click-interval['"]\s*(?:,|\))/.test(text), `${name} can address the full app AppData folder.`);
  }

  const releaseControl = fs.readFileSync(path.join(root, 'release-control.js'), 'utf8');
  assert(/deprecated:\s*true/.test(releaseControl), 'The retired remote-control compatibility module is not inert.');
  assert(!/fetch|https?:|writeFile|readFile|state\s*===\s*['"]disabled/.test(releaseControl), 'The retired compatibility module still performs remote control or persistence.');
  const updaterMain = fs.readFileSync(path.join(root, 'updater-main.js'), 'utf8');
  assert(/Click Interval Auto Macro/.test(updaterMain), 'The updater does not validate the isolated Auto/Macro settings folder.');
}

function assertPublicBranding(root) {
  const packageDocument = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  // The hidden package name remains an update-compatibility anchor for builds
  // already distributed. It must never determine public or storage identity.
  assert.equal(packageDocument.name, 'click-interval-friend');
  assert.equal(packageDocument.productName, 'Click Interval');

  const htmlFiles = walk(root).filter(filePath => path.extname(filePath).toLowerCase() === '.html');
  for (const htmlPath of htmlFiles) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(!/\bFriend\b/i.test(html), `User-visible Friend branding remains in ${path.basename(htmlPath)}.`);
  }

  // Natural-language string literals are potentially surfaced by dialogs,
  // renderer status messages, or update errors. Technical compatibility tokens
  // such as click-interval-friend, .friend-update.lock, event channels and URLs
  // are deliberately not matched by this rule.
  const codeFiles = walk(root).filter(filePath => ['.js', '.py'].includes(path.extname(filePath).toLowerCase()));
  const naturalLanguageFriend = /(?:click interval\s+friend|(?:^|\s)friend\s+(?:app(?:lication)?|edition|update(?:r)?|release|build|settings?|macros?|data|process|installer|payload|channel|control|version)|(?:^|\s)friend-edition(?:\s|$))/i;
  const quotedLiteral = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const filePath of codeFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const match of text.matchAll(quotedLiteral)) {
      const isLegacyUninstallAnchor = path.basename(filePath) === 'beta-uninstall.js' &&
        (/^Click Interval Friend(?:\.exe|\.lnk)?$/.test(match[2]) || /\$(?:expectedLegacy|legacyExe|shortcuts)=/.test(match[2]));
      if (isLegacyUninstallAnchor) continue;
      assert(!naturalLanguageFriend.test(match[2]), `User-visible Friend branding remains in ${path.basename(filePath)}: ${match[2].slice(0, 100)}`);
    }
  }
}

function assertInstallIsolation() {
  const uninstall = fs.readFileSync(path.join(sourceApp, 'beta-uninstall.js'), 'utf8');
  assert(/path\.resolve\(localAppData, 'Programs', 'Click Interval Auto Macro'\)/.test(uninstall), 'Self-uninstall does not use the isolated canonical install folder.');
  assert(/Click Interval Friend/.test(uninstall) && /isLegacy/.test(uninstall), 'Self-uninstall no longer safely recognizes an in-place v1.5.143 installation.');
  assert(/\$isCurrent[\s\S]{0,300}\$isLegacy[\s\S]{0,160}Unsafe uninstall path/.test(uninstall), 'Self-uninstall does not bind both supported roots to their expected executable names.');

  const previousLocalAppData = process.env.LOCALAPPDATA;
  const fakeLocalAppData = path.join(os.tmpdir(), 'click-interval-install-boundary-test');
  process.env.LOCALAPPDATA = fakeLocalAppData;
  try {
    const uninstallModulePath = path.join(sourceApp, 'beta-uninstall.js');
    delete require.cache[require.resolve(uninstallModulePath)];
    const uninstallModule = require(uninstallModulePath);
    const currentRoot = path.join(fakeLocalAppData, 'Programs', 'Click Interval Auto Macro');
    const legacyRoot = path.join(fakeLocalAppData, 'Programs', 'Click Interval Friend');
    assert.equal(uninstallModule.canonicalInstallRoot(), path.resolve(currentRoot));
    assert(uninstallModule.isCanonicalInstalledCopy(path.join(currentRoot, 'resources', 'app'), path.join(currentRoot, 'Click Interval.exe')));
    assert(uninstallModule.isCanonicalInstalledCopy(path.join(legacyRoot, 'resources', 'app'), path.join(legacyRoot, 'Click Interval Friend.exe')));
    assert(!uninstallModule.isCanonicalInstalledCopy(path.join(currentRoot, 'resources', 'app'), path.join(legacyRoot, 'Click Interval Friend.exe')), 'Uninstall accepts a mismatched root/executable pair.');
    assert(!uninstallModule.isCanonicalInstalledCopy(path.join(fakeLocalAppData, 'Programs', 'Click Interval', 'resources', 'app'), path.join(fakeLocalAppData, 'Programs', 'Click Interval', 'Click Interval.exe')), 'Uninstall accepts the full app installation.');
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
  }
}

function assertNoOutboundPersonalDataPath(root) {
  const codeFiles = walk(root).filter(filePath => ['.js', '.py', '.ps1', '.html'].includes(path.extname(filePath).toLowerCase()));
  const networkUsers = [];
  for (const filePath of codeFiles) {
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    const text = fs.readFileSync(filePath, 'utf8');
    if (/(?:\bfetch(?:Impl)?\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|https?\.request\s*\(|\bdgram\b|\bsocket\.)/.test(text)) networkUsers.push(relative);
    if (relative !== 'update-config.json') {
      const externalUrls = [...text.matchAll(/https:\/\/[^\s'"<>]+/g)]
        .map(match => match[0])
        .filter(url => url !== 'https://*/*');
      assert.equal(externalUrls.length, 0, `Unexpected external URL in ${relative}: ${externalUrls[0] || ''}`);
    }
  }
  assert.deepEqual(networkUsers.sort(), ['update-download.js'], 'Only the signed update downloader may use outbound networking.');

  const downloader = fs.readFileSync(path.join(root, 'update-download.js'), 'utf8');
  assert(!/\bbody\s*:|\bmethod\s*:\s*['"]POST|FormData|URLSearchParams|credentials\s*:/.test(downloader), 'Update checks must not upload app state or credentials.');
  const updateClient = fs.readFileSync(path.join(root, 'update-client.js'), 'utf8');
  assert(!/(?:macro|preference|hotkey|userData|hostname|username|machineId).{0,80}(?:manifestUrl|fetchUpdateEnvelope)/is.test(updateClient), 'Update checks appear to attach local state or identity.');

  const htmlFiles = walk(root).filter(filePath => path.extname(filePath).toLowerCase() === '.html');
  for (const htmlPath of htmlFiles) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(/Content-Security-Policy/i.test(html), `Renderer has no CSP: ${path.basename(htmlPath)}`);
    assert(/connect-src 'none'/.test(html), `Renderer networking is not disabled: ${path.basename(htmlPath)}`);
    assert(/object-src 'none'/.test(html) && /frame-src 'none'/.test(html), `Renderer embedding is not disabled: ${path.basename(htmlPath)}`);
  }

  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert(/setWindowOpenHandler[\s\S]{0,160}action:\s*['"]deny['"]/.test(main), 'Renderer-created windows are not denied.');
  assert(/will-navigate[\s\S]{0,160}preventDefault/.test(main), 'Renderer navigation is not denied.');
  assert(/setPermissionRequestHandler[\s\S]{0,180}false/.test(main), 'Renderer permission requests are not denied.');
  assert(/setPermissionCheckHandler[\s\S]{0,120}false/.test(main), 'Renderer permission checks are not denied.');
  const browserWindowCount = (main.match(/new BrowserWindow\s*\(/g) || []).length;
  const sandboxCount = (main.match(/sandbox:\s*true/g) || []).length;
  assert(browserWindowCount > 0 && sandboxCount >= browserWindowCount, 'Every friend renderer must use Electron sandboxing.');
}

function assertSignedChannelSeparation(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'update-config.json'), 'utf8'));
  assert.equal(config.edition, 'click-interval-friend');
  assert.equal(config.channel, 'stable');
  const manifest = new URL(config.manifestUrl);
  assert.equal(manifest.protocol, 'https:');
  assert(!manifest.username && !manifest.password && !manifest.hash, 'Friend update URL must not contain credentials or a fragment.');
  const mainConfigPath = path.resolve(friendRoot, '..', 'update-config.json');
  if (fs.existsSync(mainConfigPath)) {
    const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
    assert.notEqual(config.manifestUrl, mainConfig.manifestUrl, 'Friend and main editions share an update signal.');
    assert.notEqual(config.manifestPublicKey, mainConfig.manifestPublicKey, 'Friend and main editions share a signing identity.');
  }
  const manifestModule = fs.readFileSync(path.join(root, 'update-manifest.js'), 'utf8');
  const updater = fs.readFileSync(path.join(root, 'updater-main.js'), 'utf8');
  assert(/FRIEND_EDITION_ID\s*=\s*['"]click-interval-friend['"]/.test(manifestModule), 'Signed manifests are not bound to the friend edition.');
  assert(/manifestPublicKey/.test(updater) && /manifestUrl/.test(updater) && /assertStagedTrustContinuity/.test(updater), 'Updater does not preserve the friend trust anchors.');
}

function assertTreesMatch(leftRoot, rightRoot) {
  const left = new Map(walk(leftRoot).map(filePath => [path.relative(leftRoot, filePath).replace(/\\/g, '/'), sha256(filePath)]));
  const right = new Map(walk(rightRoot).map(filePath => [path.relative(rightRoot, filePath).replace(/\\/g, '/'), sha256(filePath)]));
  assert.deepEqual([...right.keys()].sort(), [...left.keys()].sort(), `Packaged app tree differs from ${leftRoot}.`);
  for (const [relative, digest] of left) assert.equal(right.get(relative), digest, `Packaged app differs at ${relative}.`);
}

function audit(root) {
  assert(fs.existsSync(root), `Missing friend app tree: ${root}`);
  assertNoEmbeddedOwnerData(root);
  assertStorageAndImportBoundaries(root);
  assertPublicBranding(root);
  assertNoOutboundPersonalDataPath(root);
  assertSignedChannelSeparation(root);
}

audit(sourceApp);
assertInstallIsolation();
if (fs.existsSync(builtApp)) {
  audit(builtApp);
}
if (fs.existsSync(portableApp)) {
  audit(portableApp);
  if (fs.existsSync(builtApp)) assertTreesMatch(builtApp, portableApp);
}

console.log(JSON.stringify({
  passed: true,
  sourceApp,
  builtAppAudited: fs.existsSync(builtApp),
  portableAppAudited: fs.existsSync(portableApp)
}));
