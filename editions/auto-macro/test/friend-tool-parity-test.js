const assert = require('assert');
const fs = require('fs');
const path = require('path');

const friendRoot = path.resolve(__dirname, '..', 'app');
const mainRoot = path.resolve(friendRoot, '..', '..');
const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');

const friendPackage = JSON.parse(read(friendRoot, 'package.json'));
const mainPackage = JSON.parse(read(mainRoot, 'package.json'));
const html = read(friendRoot, 'index.html');
const renderer = read(friendRoot, 'renderer.js');
const main = read(friendRoot, 'main.js');
const backend = read(friendRoot, 'backend.py');
const splash = read(friendRoot, 'splash.html');
const metadataScript = read(path.dirname(friendRoot), 'set-friend-metadata.js');
const buildScript = read(path.dirname(friendRoot), 'build-friend-edition.ps1');
const installerPath = path.join(path.dirname(friendRoot), 'installer', 'install-click-interval.cmd');
const installerScript = fs.readFileSync(installerPath, 'utf8');

assert.equal(friendPackage.version, '1.5.147', 'The two-tool release version is incorrect.');
assert.equal(friendPackage.name, 'click-interval-friend', 'The legacy package identity required by installed update clients changed.');
assert.equal(friendPackage.productName, 'Click Interval', 'The shipped product name must remain Click Interval.');
assert(Number(friendPackage.version.split('.')[2]) >= Number(mainPackage.version.split('.')[2]), 'The two-tool build is behind the current Click Interval version.');
assert.match(main, /app\.setName\(['"]Click Interval['"]\)/, 'The application process name is not normal Click Interval.');
assert.match(main, /app\.setAppUserModelId\(['"]ClickInterval\.AutoMacro['"]\)/, 'The isolated Windows identity is missing.');
assert(!/Click Interval Friend/i.test(main), 'The main process still contains a user-visible Friend product label.');
for (const source of [JSON.stringify(friendPackage), splash, metadataScript]) {
  assert(!/Click Interval Friend/i.test(source), 'A user-visible Friend product label remains in the shipped branding.');
}
for (const artifact of [
  'Click-Interval-win-x64',
  'Click Interval.exe',
  'Click-Interval-$version-win-x64.zip',
  'Click-Interval-$version-Setup.exe',
  'FriendlyName=Click Interval Setup'
]) assert(buildScript.includes(artifact), `Missing normal Click Interval release name: ${artifact}`);
assert(!/Click-Interval-Friend|Click Interval Friend\.exe|FriendlyName=Click Interval Friend/.test(buildScript), 'Release artifact branding still exposes Friend.');
assert(!fs.existsSync(path.join(path.dirname(friendRoot), 'installer', 'install-friend.cmd')), 'The legacy Friend-named installer command is still present.');
for (const installerName of ['Click Interval', 'Click Interval.exe', 'Click Interval.lnk', 'Click-Interval-win-x64']) {
  assert(installerScript.includes(installerName), `Installer is missing normal Click Interval naming: ${installerName}`);
}
assert(!/Click Interval Friend|Click-Interval-Friend/i.test(installerScript), 'Installer still exposes Friend branding.');

const toolTabs = [...html.matchAll(/<button id="show([A-Za-z]+)" class="tool-tab/g)].map(match => match[1]);
assert.deepEqual(toolTabs, ['AutoClicker', 'Macro'], 'The two-tool build must expose exactly Auto Clicker and Macro.');

assert.match(html, /<option value="auto_clicker_control">Control auto clicker<\/option>/);
assert.match(html, /id="actionEditAutoClickerOperation"/);
assert.match(renderer, /'auto_clicker_control'/);
assert.match(renderer, /normalized\.operation = \['start', 'stop', 'toggle'\]/);
assert.match(renderer, /Edit auto clicker control/);
assert.match(renderer, /additions\.push\(\{ type, operation: 'toggle' \}\)/);
assert.match(backend, /if action\.get\("type"\) == "auto_clicker_control":/);
for (const operation of ['start', 'stop']) assert.match(backend, new RegExp(`operation == "${operation}"`));

for (const marker of [
  'BACKEND_STDOUT_MAX_LINE_BYTES',
  'BACKEND_STDOUT_QUEUE_MAX_BYTES',
  'createBoundedLineAccumulator',
  'queuePendingBackendCommand',
  'scheduleBackendRestart',
  'expectedBackendStops'
]) assert(main.includes(marker), `Missing current backend resilience feature: ${marker}`);
assert(!renderer.includes('window.bridge.restartBackend();'), 'Renderer still forces a redundant backend restart during startup.');
assert(!main.includes('app.relaunch('), 'Starting a second instance must focus the existing app, not relaunch it.');
assert(!/event\.type === 'emergency_stop'[\s\S]{0,100}quitCleanly/.test(main), 'Emergency Stop must disarm tools without quitting the app.');
assert.match(main, /screen\.getAllDisplays\(\)\.map\(display =>/);
assert(!main.includes("spawn('powershell.exe'"), 'Macro area selection still uses the legacy external PowerShell picker.');

for (const forbidden of ['switch_crosshair', 'showCrosshair', 'showVoice', 'showMinecraftServer']) {
  assert(!html.includes(forbidden), `Two-tool HTML contains forbidden tool surface: ${forbidden}`);
  assert(!renderer.includes(forbidden), `Two-tool renderer contains forbidden tool surface: ${forbidden}`);
}

assert.equal(read(friendRoot, 'macro-codec.js'), read(mainRoot, 'macro-codec.js'), 'Macro codec is behind the main app.');
for (const file of ['area-picker-preload.js', 'area-picker.js']) {
  assert.equal(read(friendRoot, file), read(mainRoot, file), `${file} is behind the main app.`);
}
assert.match(read(friendRoot, 'area-picker.html'), /<script src="area-picker\.js"><\/script>/);

console.log(JSON.stringify({
  passed: true,
  version: friendPackage.version,
  tools: ['Auto Clicker', 'Macro'],
  macroAction: 'Control auto clicker'
}, null, 2));
