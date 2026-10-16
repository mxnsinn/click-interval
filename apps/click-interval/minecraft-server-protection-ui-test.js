'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const ui = read('minecraft-server-ui.js');
const styles = read('styles.css');
const backend = read('minecraft-server/main.js');
const backendTuning = read('minecraft-server/protection-tuning.js');
const capabilitiesSource = read('minecraft-server/protection-capabilities.js');
const popupMain = read('main.js');
const popupRenderer = read('macro-name-window.js');
const roleEditorHtml = read('player-role-editor.html');

for (const id of [
  'msProtectionMessages', 'msProtectionMessageType', 'msProtectionMessageText',
  'msProtectionMessageColor', 'msWarningCooldown', 'msProtectionBanSource',
  'msProtectionTuning', 'msAddPlayerAccess', 'msLayerEspMitigation',
  'msEspMitigationLayerState', 'msReachCount'
]) {
  const count = (html.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length;
  assert.equal(count, 1, `${id} should exist exactly once`);
}
assert.match(html, /data-ms-players=["']access["']/, 'Players should expose the Access tab');
assert.match(html, /option value=["']compatibility["']>Low false positives</,
  'protection presets should include a materially safer compatibility mode');
assert.match(ui, /compatibilityDisabledChecks = new Set\(\[[^\]]*aimDirection[^\]]*killAura[^\]]*inventorySpam/,
  'compatibility mode should disable heuristic checks instead of only changing its label');
assert.match(ui, /const compatibilityTuning = \{[\s\S]{0,1800}maxReach: 3\.65[\s\S]{0,800}maxInventoryClicksPerSecond: 45/,
  'compatibility mode should have distinct conservative thresholds');

const protectionChecks = [
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak',
  'chatSpam', 'commandSpam', 'inventorySpam'
];
for (const check of protectionChecks) {
  assert.equal((html.match(new RegExp(`data-ms-check=["']${check}["']`, 'g')) || []).length, 1,
    `${check} should have one individual protection control`);
  assert.match(ui, new RegExp(`(?:^|[,{\\s])${check}: ['\"](?:movement|combat|world|abuse)\\.${check}['\"]`),
    `${check} should have a compatibility ID`);
  assert.match(html, new RegExp(`value=["']check:${check}["']`), `${check} should have a message override option`);
}
for (const unsupportedPlaceholder of ['jesus', 'velocity', 'nuker', 'crashExploit']) {
  assert.doesNotMatch(html, new RegExp(`data-ms-check=["']${unsupportedPlaceholder}["']`),
    `${unsupportedPlaceholder} must not be presented as enforced without backend support`);
}
for (const [group, label] of Object.entries({
  movement: 'Movement', reach: 'Reach', combat: 'Combat automation', world: 'Block &amp; world', abuse: 'Abuse'
})) {
  assert.match(html, new RegExp(`data-ms-checks=["']${group}["'][\\s\\S]{0,600}>${label}<`),
    `${group} should remain a separate compact protection group`);
}
assert.match(ui, /function protectionCheckSupport\(/, 'check availability should be capability-driven');
assert.match(ui, /capabilities\.supportedChecks/, 'backend supported-check lists should be honored');
assert.match(ui, /fabric:\s*Object\.freeze\(protectionCheckKeys\)/,
  'Fabric fallback support should share the complete runtime check contract');
assert.match(ui, /classList\.toggle\(['"]unsupported['"]/, 'unsupported checks should render distinctly');
assert.match(styles, /\.switch input:disabled \+ i \{[^}]*opacity:[^}]*filter: grayscale\(1\)/,
  'unsupported layer and group switches should be visibly disabled');
assert.match(ui, /espMitigation: false/, 'retired player withholding must never hydrate as enabled');
assert.match(ui, /capabilities\.espMitigationSupported/, 'ESP mitigation should be capability-gated');
assert.match(capabilitiesSource, /accessRoleExemptionsSupported: Boolean\(adapter\)/,
  'backend capabilities should expose adapter-backed role exemptions');
assert.match(capabilitiesSource, /accessCommandPermissionsSupported: Boolean\(adapter\)/,
  'backend capabilities should report command-role enforcement for both bundled Paper and Fabric adapters');
assert.match(html, /data-ms-players=["']access["'][\s\S]{0,180}data-ms-players=["']roles["']/,
  'Players should expose role assignment and role customization together');
assert.match(ui, /options: roles\.map\(role => \(\{ value: role\.id/,
  'the Access workflow should assign any configured custom role');
assert.doesNotMatch(ui, /Fabric roles control protection exemptions only/,
  'the UI should not retain the obsolete Fabric role-only limitation');
assert.match(ui, /Fabric adapter supports Minecraft \$\{bundledVersions\.join\(', '\)\}/,
  'unsupported Fabric versions should receive a precise bundled-adapter explanation');
assert.match(ui, /const supported = capabilities\.bundledAdapterSupported \?\? layerSupportsType\('builtIn'\)/,
  'the runtime-check switch should enforce the live backend capability instead of its type fallback alone');
assert.match(html, /data-ms-checks=["']visibility["'] hidden/, 'retired player withholding must not remain an interactive check');
assert.match(html, /<strong>PvP visibility<\/strong>/, 'the layers view should explain the PvP-safe visibility policy');
assert.match(html, /Players and nametags keep vanilla visibility/i, 'PvP visibility copy should state the preserved behavior');
assert.match(html, /Supported Fabric versions obfuscate hidden ores/i,
  'Fabric ore-protection copy should describe packet obfuscation instead of detection alone');
assert.match(ui, /capabilities\.antiXrayObfuscationSupported === true/,
  'Fabric packet obfuscation should participate in layer availability');
assert.match(ui, /antiXrayCapabilities\.antiXrayObfuscationSupported === true/,
  'the Anti-Xray toggle should honor the packet-obfuscation capability');
assert.match(ui, /antiXrayCapabilityDeclared[\s\S]{0,300}antiXrayObfuscationSupported/,
  'a declared packet-obfuscation capability must suppress the legacy type fallback');
assert.match(html, /data-ms-check=["']reach["'][\s\S]{0,220}>Combat reach</, 'Reach should have a distinct control');
assert.match(html, /data-ms-check=["']wallHit["'][\s\S]{0,220}>Wall hit</, 'Wall hit should have a distinct control');
assert.match(html, /data-ms-check=["']multiTarget["'][\s\S]{0,220}>Multi-target</, 'Multi-target should have a distinct control');
assert.match(html, /data-ms-check=["']invalidPosition["'][\s\S]{0,220}>Invalid position</, 'Invalid position should have a distinct control');
assert.match(ui, /checks\[key\] = input\.disabled \? protectionConfig\?\.checks\?\.\[key\] !== false : input\.checked/,
  'saving another option must preserve dormant settings for unsupported checks');
assert.match(ui, /if \(!result\.supported\) input\.checked = false/,
  'unsupported checks should render unchecked rather than falsely appearing active');
assert.match(ui, /else if \(wasUnsupported\) input\.checked = protectionConfig\?\.checks\?\.\[input\.dataset\.msCheck\] !== false/,
  'checks should restore their saved value when the selected runtime supports them again');
assert.match(ui, /for \(const input of document\.querySelectorAll\('\[data-ms-check\]'\)\) input\.onchange = \(\) => \{[\s\S]{0,180}saveProtectionConfigSoon\(\)/,
  'each individual check should persist after editing');
assert.match(ui, /PvP safe · players and nametags keep vanilla visibility/,
  'retired ESP withholding should render as the intentional PvP-safe policy');

for (const check of protectionChecks) {
  assert.match(capabilitiesSource, new RegExp(`FABRIC_CHECKS[\\s\\S]{0,900}['\"]${check}['\"]`),
    `Fabric capability contract should expose ${check}`);
}

const reachPaths = [
  'geometryAllowance', 'maxPingAllowance', 'pingAllowancePerMs', 'maxTickAllowance',
  'tickAllowancePerMissingTps', 'maxTargetRewind', 'baseRewindTicks',
  'pingRewindTicksPerMs', 'maxRewindTicks', 'immediateExcess',
  'consecutiveSamples', 'evidenceWindowMillis'
];
for (const key of reachPaths) {
  assert.match(html, new RegExp(`data-ms-tuning=["']reach\\.${key}["']`), `missing reach control ${key}`);
  assert.match(ui, new RegExp(`${key}: clampProtection`), `missing UI validation for ${key}`);
  assert.match(backend, new RegExp(`reach\\.${key}`), `missing YAML wiring for ${key}`);
}

const granularLimitRules = {
  maxAirTicks: [20, 600],
  phaseSamples: [2, 10],
  maxCps: [5, 40],
  wallHitSamples: [6, 12],
  multiTargetCount: [2, 16],
  multiTargetWindowMillis: [100, 5000]
};
for (const [key, [minimum, maximum]] of Object.entries(granularLimitRules)) {
  assert.match(html, new RegExp(`data-ms-tuning=["']limits\\.${key}["'][^>]*min=["']${minimum}["'][^>]*max=["']${maximum}["']`),
    `missing bounded tuning control for ${key}`);
  assert.match(ui, new RegExp(`${key}: clampProtectionNumber\\(limits\\.${key}, fallback\\.limits\\.${key}, ${minimum}, ${maximum}\\)`),
    `renderer should clamp ${key}`);
  assert.match(backendTuning, new RegExp(`${key}: finiteNumber\\(limits\\.${key}, fallback\\.limits\\.${key}, ${minimum}, ${maximum}\\)`),
    `renderer bounds should match backend tuning for ${key}`);
}
for (const [key, [minimum, maximum]] of Object.entries({
  inventoryEvidenceSamples: [2, 8],
  inventorySampleIntervalMillis: [100, 1000]
})) {
  assert.match(html, new RegExp(`data-ms-tuning=["']limits\\.${key}["'][^>]*min=["']${minimum}["'][^>]*max=["']${maximum}["']`),
    `missing bounded inventory evidence control for ${key}`);
  assert.ok(ui.includes(`const ${key} = clampProtectionNumber(limits.${key}, fallback.limits.${key}, ${minimum}, ${maximum})`),
    `renderer should clamp ${key} before applying its dependent bounds`);
  assert.ok(backendTuning.includes(`const ${key} = finiteNumber(`),
    `backend should clamp ${key} before applying its dependent bounds`);
}
assert.ok(html.includes('data-ms-tuning="limits.inventoryViolationCooldownMillis" type="number" min="500" max="30000"'),
  'missing bounded inventory report-cooldown control');
assert.match(ui, /inventoryViolationCooldownMillis: clampProtectionNumber\([\s\S]{0,220}500,[\s\S]{0,60}30000\s*\)/,
  'renderer should clamp the inventory report cooldown');
assert.match(backendTuning, /inventoryViolationCooldownMillis: finiteNumber\([\s\S]{0,220}500,[\s\S]{0,60}30000\s*\)/,
  'backend should clamp the inventory report cooldown');
for (const [key, [minimum, maximum]] of Object.entries({
  inventoryEvidenceWindowMillis: [100, 10000],
  maxInventoryBurstPacketsPerSecond: [20, 1000]
})) {
  assert.ok(html.includes(`data-ms-tuning="limits.${key}" type="number" min="${minimum}" max="${maximum}"`),
    `missing bounded inventory evidence control for ${key}`);
  assert.match(ui, new RegExp(`${key}: clampProtectionNumber\\([\\s\\S]{0,220}${maximum}\\s*\\)`),
    `renderer should dynamically clamp ${key}`);
  assert.match(backendTuning, new RegExp(`${key}: finiteNumber\\([\\s\\S]{0,220}${maximum}\\s*\\)`),
    `backend should dynamically clamp ${key}`);
}
for (const key of [
  'maxInventoryClicksPerSecond', 'inventoryEvidenceSamples', 'inventorySampleIntervalMillis',
  'inventoryEvidenceWindowMillis', 'maxInventoryBurstPacketsPerSecond', 'inventoryViolationCooldownMillis'
]) {
  assert.match(ui, new RegExp(`${key}:`), `renderer defaults should preserve ${key}`);
}
assert.match(html, /<div class="ms-tuning-heading">Inventory evidence<\/div>/,
  'inventory false-positive controls should be grouped together');
for (const [key, [minimum, maximum]] of Object.entries({
  maxGroundBlocksPerTick: [0.25, 5],
  maxAirBlocksPerTick: [0.25, 5]
})) {
  assert.ok(html.includes(`data-ms-tuning="limits.${key}" type="number" min="${minimum}" max="${maximum}"`),
    `movement control bounds should match Fabric runtime bounds for ${key}`);
  assert.ok(ui.includes(`${key}: clampProtectionDecimal(limits.${key}, fallback.limits.${key}, ${minimum}, ${maximum}`),
    `renderer should enforce Fabric-safe movement bounds for ${key}`);
  assert.ok(backendTuning.includes(`${key}: finiteNumber(limits.${key}, fallback.limits.${key}, ${minimum}, ${maximum}`),
    `backend should enforce Fabric-safe movement bounds for ${key}`);
}
const reachRangeRules = {
  geometryAllowance: ['Decimal', 0.025, 0.25],
  maxPingAllowance: ['Decimal', 0.15, 0.5],
  pingAllowancePerMs: ['Decimal', 0.0005, 0.002],
  maxTickAllowance: ['Decimal', 0.05, 0.25],
  tickAllowancePerMissingTps: ['Decimal', 0.025, 0.1],
  maxTargetRewind: ['Decimal', 0.25, 0.75],
  baseRewindTicks: ['Decimal', 0.25, 1.5],
  pingRewindTicksPerMs: ['Decimal', 0.005, 0.02],
  maxRewindTicks: ['Decimal', 1.5, 5],
  immediateExcess: ['Decimal', 0.5, 2],
  consecutiveSamples: ['Number', 2, 6],
  evidenceWindowMillis: ['Number', 750, 5000]
};
for (const [key, [validator, minimum, maximum]] of Object.entries(reachRangeRules)) {
  assert.ok(html.includes(`data-ms-tuning="reach.${key}" type="number" min="${minimum}" max="${maximum}"`),
    `reach control bounds should match runtime bounds for ${key}`);
  assert.ok(ui.includes(`${key}: clampProtection${validator}(reach.${key}, fallback.reach.${key}, ${minimum}, ${maximum}`),
    `renderer should enforce runtime reach bounds for ${key}`);
  assert.ok(backendTuning.includes(`${key}: finiteNumber(reach.${key}, fallback.reach.${key}, ${minimum}, ${maximum}`),
    `backend should enforce runtime reach bounds for ${key}`);
}
assert.match(ui, /phaseSamples: 3,[\s\S]*wallHitSamples: 6,[\s\S]*multiTargetCount: 4,[\s\S]*multiTargetWindowMillis: 650/,
  'balanced renderer defaults should match the backend');
assert.match(ui, /phaseSamples: 3,[\s\S]*wallHitSamples: 6,[\s\S]*multiTargetCount: 4,[\s\S]*multiTargetWindowMillis: 750/,
  'strict renderer defaults should match the backend');

const collectStart = ui.indexOf('function collectProtectionConfig()');
const collectEnd = ui.indexOf('function renderProtectionCheckCounts()', collectStart);
assert.ok(collectStart >= 0 && collectEnd > collectStart, 'protection collector should exist');
assert.doesNotMatch(ui.slice(collectStart, collectEnd), /syncProtectionMessageEditorToState\(/,
  'unrelated protection saves must not create a per-check message override');
assert.match(ui, /delete protectionConfig\.messages\.checks\[protectionMessageSelection\.slice\(6\)\]/,
  'reset should remove a per-check override');
assert.match(backend, /checks: requestedMessages\.checks && typeof requestedMessages\.checks === 'object'/,
  'backend should replace the complete check override map so reset persists');

for (const role of ['owner', 'admin', 'member']) {
  assert.doesNotMatch(ui, new RegExp(`id: '${role}'`), `role picker must not invent the removed ${role} preset`);
}
assert.match(ui, /async function beginAccessEdit\(player\)/, 'access editing must load the current role first');
assert.match(ui, /Create a role before assigning player access/,
  'an empty custom-role list should route the user to role creation');
assert.match(ui, /options: roles\.map\(role => \(\{ value: role\.id/, 'role picker should be populated from saved custom roles');
assert.match(roleEditorHtml, /id="allowedCommands" maxlength="1024"[\s\S]*id="deniedCommands" maxlength="1024"/,
  'custom role allow and deny command entry should support the documented limit');
assert.match(popupMain, /maxLength: Math\.max\(1, Math\.min\(1024/,
  'popup payload should validate custom maximum length');
assert.match(popupRenderer, /input\.maxLength = Math\.max\(1, Math\.min\(1024/,
  'popup input should honor custom maximum length');

console.log('PASS Minecraft server protection/access UI contract');
