'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const ui = read('minecraft-server-ui.js');
const styles = read('styles.css');
const motdHtml = read('motd-editor.html');
const motdUi = read('motd-editor.js');
const motdCss = read('motd-editor.css');
const main = read('main.js');
const serverMain = read('minecraft-server/main.js');
const preload = read('preload.js');

const serverStart = html.indexOf('<main id="minecraftServerView"');
const serverEnd = html.indexOf('</main>', serverStart);
assert.ok(serverStart >= 0 && serverEnd > serverStart, 'Minecraft server surface should exist');
const serverHtml = html.slice(serverStart, serverEnd);
assert.doesNotMatch(serverHtml, /Assembly|Click Interval/i, 'Minecraft server UI should use neutral branding');
assert.match(serverHtml, /<strong>Baseline hardening<\/strong>/, 'the unified protection surface should expose universal baseline hardening');
assert.match(serverHtml, /<strong>Runtime checks<\/strong>/, 'the unified protection surface should distinguish runtime checks');
assert.doesNotMatch(ui, /motdPresets|msMotdPreset/, 'MOTD should not be limited to a preset dropdown');
assert.match(ui, /className = 'ms-motd-edit'/, 'settings should show a compact MOTD edit icon');
assert.match(ui, /window\.bridge\.openMotdEditor\(\{[\s\S]*?serverName: activeProfile\(\)\?\.name[\s\S]*?iconDataUrl: currentServerIcon\(\)/, 'MOTD editor should receive the active server name and icon');
assert.match(ui, /onMotdEditorSaved\(async value =>[\s\S]*api\.saveConfig\(\{ \.\.\.\(status\?\.config \|\| \{\}\), motd \}\)/, 'saving in the MOTD window should persist immediately');
assert.doesNotMatch(ui, /ms-motd-toolbar|msMotdPreview|motdColors/, 'formatting controls should not clutter the settings page');
assert.match(main, /new BrowserWindow\(\{[\s\S]*?title: 'MOTD Editor'/, 'MOTD editor should open in its own window');
assert.match(preload, /openMotdEditor: payload => ipcRenderer\.send\('open-motd-editor', payload\)/, 'MOTD editor IPC should be isolated through preload');
assert.match(motdHtml, /id="motdSource"[\s\S]*maxlength="1024"/, 'MOTD editor should support a full multiline message');
assert.match(motdHtml, /id="motdServerIcon"[\s\S]*id="motdServerName"/, 'MOTD preview should expose the active server identity');
assert.match(motdUi, /serverName\.textContent = String\(state\.serverName/, 'MOTD preview should render the active profile name');
assert.match(motdUi, /serverIcon\.src = String\(state\.iconDataUrl/, 'MOTD preview should render the active server icon');
assert.match(motdUi, /const colors = \[/, 'MOTD editor should expose Minecraft colors');
assert.match(motdHtml, /data-code="k"[\s\S]*Obfuscated moving text/, 'MOTD editor should expose obfuscated moving text');
assert.match(motdUi, /setSelectionRange/, 'MOTD formatting should apply to selected characters');
assert.match(motdUi, /§\(\[0-9a-fk-or\]\)/, 'MOTD preview should parse Minecraft formatting codes');
assert.match(motdCss, /\.motd-server-preview/, 'MOTD editor should include a Minecraft-style live preview');
assert.match(ui, /Restart the server to apply it/, 'MOTD saves should explain when a restart is required');
assert.match(ui, /function neutralServerText\(value\)/, 'backend messages should be neutralized before display');
assert.match(ui, /el\.style\.borderColor = error \? 'var\(--theme-danger\)' : ''/, 'server error toasts should follow the active theme');
assert.match(ui, /Typing a hostname here does not configure DNS/, 'custom hostname help should explain that DNS must be configured separately');

for (const wording of [
  'copying does not publish the server',
  'download the selected type or choose an existing JAR',
  'direct mapping uses your router; a tunnel avoids router setup',
  'Download selected',
  'Choose existing JAR'
]) {
  assert.ok(serverHtml.includes(wording), `overview should explain: ${wording}`);
}

const provisionStart = ui.indexOf('async function provisionPluginCompatibleServer');
const provisionEnd = ui.indexOf('async function reloadProtectionState', provisionStart);
assert.ok(provisionStart >= 0 && provisionEnd > provisionStart, 'platform compatibility gate should exist');
const provision = ui.slice(provisionStart, provisionEnd);
assert.match(provision, /const serverType = selectedServerType\(\)/, 'provisioning should use the selected server type');
assert.match(provision, /api\.installServerPlatform\(\{ type: serverType, version \}\)/, 'automatic setup should install only the selected type');
assert.doesNotMatch(provision, /saveConfig|serverType:\s*['"]paper['"]|installType/, 'provisioning must not rewrite the selected runtime');
assert.match(provision, /Choose existing JAR in Overview/, 'supported custom-jar runtimes should receive actionable setup guidance');

assert.match(ui, /baseline: Object\.freeze\(\['vanilla', 'paper', 'purpur', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge'\]\)/, 'baseline hardening should support every managed runtime');
assert.match(ui, /builtIn: Object\.freeze\(\['paper', 'purpur', 'spigot', 'fabric'\]\)/, 'built-in protection should expose the bundled Fabric adapter');
assert.match(ui, /antiXray: Object\.freeze\(\['paper', 'purpur', 'fabric'\]\)/, 'Ore-protection runtime support should match the backend');
assert.match(ui, /custom: Object\.freeze\(\['paper', 'purpur', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge'\]\)/, 'custom protection should stay available on every backend-supported runtime');
for (const field of ['baselineHardeningActive', 'bundledAdapterSupported', 'customAdapterSupported', 'nativeAntiXraySupported', 'espMitigationSupported', 'supportedChecks']) {
  assert.ok(ui.includes(`capabilities.${field}`), `renderer should consume backend capability field ${field}`);
}

assert.match(ui, /Vanilla cannot load mods or plugins/, 'Vanilla add-on view should explain that it has no loader');
assert.match(ui, /\$\('msImportAddon'\)\.disabled = !supportedKind/, 'Vanilla should not offer add-on import');
assert.match(ui, /Import custom \$\{kind === 'plugins' \? 'plugin' : 'mod'\}/, 'mod-capable servers should clearly offer custom mod import');
assert.match(ui, /\$\('msImportAntiCheat'\)\.disabled = !customSupported/, 'unsupported runtimes should not offer custom anti-cheat import');
assert.match(ui, /!builtIn\.legacyInstallation && !builtIn\.legacyConflict/, 'legacy built-in protection should expose its migration action instead of appearing ready');
assert.match(serverHtml, /id="msCustomAntiCheatHint"/, 'custom protection should expose a runtime compatibility status');
assert.match(serverHtml, /Matching plugin or mod JARs/, 'custom protection should cover both plugin and mod runtimes');
assert.doesNotMatch(`${serverHtml}\n${ui}\n${preload}`, /GrimAC|msLayerGrim|msSetupGrim|msGrimLayerState|setGrimEnabled|installRecommendedAntiCheat|removeRecommendedAntiCheat/, 'separate legacy protection controls must not remain user-visible');
assert.match(preload, /removeLegacyProtection: \(\) => ipcRenderer\.invoke\('security:removeLegacyProtection'\)/, 'preload should expose only narrowly scoped legacy cleanup');
assert.doesNotMatch(preload, /security:installAntiCheat|security:removeAntiCheat/, 'retired install and removal channels must not be exposed');
assert.doesNotMatch(serverMain, /ipcMain\.handle\('security:installAntiCheat'|ipcMain\.handle\('security:removeAntiCheat'/, 'retired backend channels must not remain registered');
assert.doesNotMatch(ui, /info\.title = `Open \$\{info\.textContent\}`/, 'obvious server rows should not have redundant open tooltips');
assert.match(styles, /\.ms-list\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/, 'shared lists should stack fixed rows instead of shrinking grid tracks');
assert.match(styles, /\.ms-fill-list\s*\{[^}]*height:\s*0;[^}]*flex:\s*1 1 0;[^}]*overflow-y:\s*auto/, 'full lists should own a bounded scrolling surface');
assert.match(styles, /\.ms-list-row\s*\{[^}]*flex:\s*0 0 auto/, 'player and add-on rows must never be compressed to fit');
assert.match(ui, /icon\.src = file\.iconUrl \|\| pinnedPresentation\?\.iconUrl \|\| 'minecraft-server\/renderer\/assets\/addon-generic\.svg'/, 'installed add-ons should retain their provider or pinned icon');
assert.doesNotMatch(ui.slice(ui.indexOf('function renderInstalledAddons'), ui.indexOf('function normalizeAddonName')), /minecraft-default-world/, 'installed add-ons should not use a Minecraft world image as their fallback');
assert.match(ui, /offset: append \? addonNextOffset : 0/, 'add-on browsing should advance by the provider cursor rather than the filtered row count');
assert.doesNotMatch(ui, /MAX_RENDERED_ADDON_RESULTS/, 'add-on browsing must not stop at an artificial rendered-row ceiling');
assert.match(ui, /renderAddonResults\(message, append \? \{ appendFrom: previousLength \} : \{\}\)/,
  'append pagination should add only new rows instead of reconstructing the scroller');
assert.match(ui, /list\.scrollHeight - list\.scrollTop - list\.clientHeight <= 96/, 'scrolling near the end should continue loading add-ons');

console.log('PASS Minecraft server platform/branding UI contract');
