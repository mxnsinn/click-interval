const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const ui = fs.readFileSync(path.join(root, 'minecraft-server-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'minecraft-server', 'main.js'), 'utf8');
const standaloneRenderer = fs.readFileSync(path.join(root, 'minecraft-server', 'renderer', 'renderer.js'), 'utf8');
const fabricManifest = JSON.parse(fs.readFileSync(path.join(root, 'minecraft-server', 'manifests', 'fabric-26.2-smp-mods.json'), 'utf8'));
const preloads = [
  fs.readFileSync(path.join(root, 'preload.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'minecraft-server', 'preload.js'), 'utf8')
];

assert.match(html, /id="msImportAddon"[\s\S]*?id="msDownloadServerAddons"[^>]*>Download server add-ons/,
  'manual import should have a nearby website download link');
assert.match(html, /<div class="ms-addon-mode"[^>]*>[\s\S]*?<\/div>\s*<div class="ms-addon-utilities"/,
  'download and import actions should have a separate row so they cannot squeeze the add-on tabs');
const addonTabs = html.slice(html.indexOf('<div class="ms-addon-mode"'), html.indexOf('<div class="ms-addon-utilities"'));
assert.doesNotMatch(addonTabs, /msImportAddon|msDownloadServerAddons/,
  'the four view tabs should be the only controls in the add-on tablist');
assert.match(ui, /\$\('msDownloadServerAddons'\)\.hidden = false;[\s\S]*?\$\('msDownloadServerAddons'\)\.disabled = false;/,
  'the server add-on download link should remain available in every add-on view');
assert.match(main, /links:openServerAddons[\s\S]*?download\.html\?extensions=minecraft-server&features=teleport-requests%2Cproximity-voice/,
  'the website link should open the server add-on downloads directly');
assert.doesNotMatch(ui, /renderBundled(?:Teleport|Voice)Result|configureBundled(?:Teleport|Voice)Action/,
  'built-in promotion cards must be absent');
assert.doesNotMatch(ui, /api\.(?:get|install|remove)Teleport\(|api\.(?:get|install|remove|export)Voice\(/,
  'no built-in Teleport Requests or Proximity Voice actions should remain visible');

assert.match(ui, /INSTALLED_ADDON_UPDATE_CONCURRENCY = 4/);
assert.match(ui, /INSTALLED_ADDON_UPDATE_TTL_MS = 60_000/);
assert.match(ui, /installedAddonUpdateActive < INSTALLED_ADDON_UPDATE_CONCURRENCY/,
  'automatic checks should use a bounded worker queue');
assert.match(ui, /previous\?\.loading \|\| \(previous\?\.fingerprint === fingerprint && now - previous\.loadedAt < INSTALLED_ADDON_UPDATE_TTL_MS\)/,
  'automatic checks should deduplicate and cache unchanged installed files');
assert.match(ui, /task\.generation !== installedAddonUpdateGeneration/,
  'stale profile generations should be ignored');
assert.match(ui, /function refresh\(force = false\)[\s\S]*?requestGeneration !== refreshRequestGeneration/,
  'forced post-mutation refreshes must not be overwritten by an older UI request');
assert.match(ui, /badge\.textContent = 'Update available'/,
  'an available update should appear without a manual refresh action');
assert.match(ui, /!providerManaged && !isBundledTeleportFile\(file\)/,
  'managed Teleport Requests rows must be checked even when legacy metadata labels them as imported');
assert.match(ui, /mix\(status\?\.state \|\| ''\)/,
  'installed add-on action state must be invalidated immediately when server state changes');
assert.match(ui, /mix\(update\?\.canUpdate\)/,
  'managed update eligibility must participate in the installed-row render signature');
assert.match(ui, /api\.onState\([\s\S]*?addonMode === 'installed'\) renderInstalledAddons\(\)/,
  'the installed add-on page must redraw as soon as the server starts or stops');

const installedRenderer = ui.slice(ui.indexOf('function renderInstalledAddons'), ui.indexOf('function normalizeAddonName'));
const updateAppend = installedRenderer.indexOf('actions.append(updateButton)');
const removeAppend = installedRenderer.indexOf('actions.append(remove)');
assert(updateAppend >= 0 && removeAppend > updateAppend,
  'Update and Remove should be rendered side by side, with Remove always retained');
assert.match(installedRenderer, /createAddonIconAction\('remove'/,
  'Remove should use an accessible icon button');
assert.match(installedRenderer, /api\.deleteJar\(kind, file\.name\)/,
  'Remove must not depend on the update operation');
assert.match(styles, /\.ms-addon-icon-action\s*\{[^}]*width:\s*27px/,
  'installed add-on actions should be compact icon buttons');
assert.match(styles, /\.ms-addon-icon-action\s*\{[^}]*border:\s*0/,
  'installed add-on update and remove controls should stay plain instead of boxed');
assert.match(ui, /server-protection\.svg[\s\S]*?server-death-loot\.svg/,
  'managed protection and death-loot rows should resolve simple local icons');
for (const icon of ['server-protection.svg', 'server-death-loot.svg']) {
  assert(fs.existsSync(path.join(root, 'minecraft-server', 'renderer', 'assets', icon)), `${icon} should exist locally`);
  assert(!fs.readFileSync(path.join(root, 'minecraft-server', 'renderer', 'assets', icon), 'utf8').includes('<rect width="64" height="64"'), `${icon} should not draw a background tile`);
}
assert.match(ui, /pinnedModPresentation[\s\S]*?EltpO5cN[\s\S]*?4WWQxlQP[\s\S]*?fQEb0iXm[\s\S]*?l6YH9Als/,
  'queued server mods should use their official project icons');
const lootrArtifact = fabricManifest.artifacts.find((entry) => entry.key === 'lootr');
assert.equal(lootrArtifact?.clientRequired, true,
  'the supported-mod manifest must identify Lootr as required on connecting clients');
assert(fabricManifest.notes.some((note) => /Lootr is required on the server and on every connecting client\./.test(note)),
  'the supported-mod manifest must state the real Lootr connection requirement');
assert(fabricManifest.notes.some((note) => /Clients using Lootr[\s\S]*need Fabric API/.test(note)),
  'the supported-mod manifest must state Lootr\'s client-side Fabric API requirement');
assert.match(ui, /Stop the server before changing custom mods\./,
  'renderer errors should replace Electron IPC noise with a concise custom-mod instruction');
assert.match(standaloneRenderer, /Stop the server before changing custom mods\./,
  'the standalone renderer should use the same concise custom-mod instruction');

for (const preload of preloads) {
  assert.match(preload, /checkAddonUpdate:[^\n]+addons:checkUpdate/);
  assert.match(preload, /updateInstalledAddon:[^\n]+addons:updateInstalled/);
  assert.match(preload, /openServerAddons:[^\n]+links:openServerAddons/);
}
for (const channel of ['addons:checkUpdate', 'addons:updateInstalled']) {
  assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel.replace(':', '\\:')}'`));
}
assert.match(main, /async function installAddonForActiveProfile[\s\S]*?captureActiveServerToolProfile\('add-on installs'\)[\s\S]*?serverToolMutationCoordinator\.run[\s\S]*?beforeCommit:/,
  'browse installs must be stopped-only and remain bound to the profile that initiated them');
assert.match(main, /ipcMain\.handle\('addons:install',[^\n]+installAddonForActiveProfile/);
assert.match(ui, /install\.disabled = installed \|\| status\?\.state !== 'stopped'/,
  'browse install must be visibly unavailable while the server is active');

const importSource = main.slice(main.indexOf('async function importJarFiles'), main.indexOf('async function deleteManagedJar'));
assert.doesNotMatch(importSource, /declares the managed (?:Teleport Requests|Proximity Voice) identity/,
  'manual import must accept official site JAR identities');
assert.match(importSource, /declares an identity managed by the Protection page/,
  'the unrelated protection ownership guard should remain intact');
const deleteSource = main.slice(main.indexOf('async function deleteManagedJar'), main.indexOf('function normalizeAddonKind'));
assert.doesNotMatch(deleteSource, /Use the built-in (?:Teleport Requests|Proximity Voice) entry to remove/,
  'normal removal must not force users back through retired cards');
assert.match(deleteSource, /const profileSnapshot = await captureActiveServerToolProfile[\s\S]*?serverToolMutationCoordinator\.run/,
  'Remove must capture its profile before waiting on the mutation queue');
assert.match(deleteSource, /if \(teleport\.managed\) return removeBundledTeleport\(profileSnapshot\)/);
assert.match(deleteSource, /if \(voice\.managed\) return removeBundledVoice\(profileSnapshot\)/);
assert.match(main, /normalizeAddonVersion\(config\.serverVersion \|\| entry\.gameVersion\)/,
  'update selection must target the active Minecraft version, not stale install metadata');
assert.match(main, /normalizeServerType\(config\.serverType \|\| entry\.serverType\)/,
  'update selection must target the active loader, not stale install metadata');
const checkUpdateSource = main.slice(main.indexOf('async function checkInstalledAddonUpdate'), main.indexOf('async function updateInstalledAddon'));
assert.match(checkUpdateSource, /isBundledTeleportAddonFile\(normalizedKind, fileName\)[\s\S]*?getBundledTeleportStatus\(paths\)/,
  'official TPA filenames must use managed tool status instead of imported-provider metadata');
const updateInstalledSource = main.slice(main.indexOf('async function updateInstalledAddon'), main.indexOf('async function installAddonForActiveProfile'));
assert.match(updateInstalledSource, /isBundledTeleportAddonFile\(normalizedKind, fileName\)[^\n]+installBundledTeleport\(\)/,
  'the installed-row update action must invoke the integrity-checked bundled TPA installer');
assert.match(main, /statusCacheGeneration[\s\S]*?generation === statusCacheGeneration \? result : getStatus\(\)/,
  'a mutation during status construction must discard and rebuild the stale snapshot');

console.log('PASS installed add-on updates, icon actions, and manual site workflow contract');
