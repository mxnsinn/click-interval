'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const html = read('index.html');
const ui = read('minecraft-server-ui.js');
const styles = read('styles.css');
const preload = read('preload.js');
const main = read('main.js');
const inspectorHtml = read('player-inspector.html');
const inspectorUi = read('player-inspector.js');
const inspectorStyles = read('player-inspector.css');
const roleEditorHtml = read('player-role-editor.html');
const roleEditorUi = read('player-role-editor.js');
const roleEditorStyles = read('player-role-editor.css');
const updateBuilder = read('build-development-update.ps1');
const playerFigureImplementation = ui.slice(ui.indexOf('function createPlayerFigure('), ui.indexOf('function createPlayerIdentity('));
const inspectorModelImplementation = inspectorUi.slice(inspectorUi.indexOf('function renderPlayerModel('), inspectorUi.indexOf('function updateModelRotation('));

assert.match(html, /id=["']msPlayersList["'][^>]*role=["']list["'][^>]*aria-live=["']polite["']/, 'player list should announce refreshes without replacing focus');
assert.match(ui, /\['playerHistoryLimit', 'History entry limit', 'number'\]/, 'settings should expose the player history limit');
assert.match(ui, /playerHistoryLimit:\s*\{\s*min:\s*10,\s*max:\s*1000,\s*step:\s*1,\s*fallback:\s*100\s*\}/, 'history limit should default to 100 with a clear safe range');
assert.match(html, /data-ms-players=["']access["'][\s\S]{0,180}data-ms-players=["']roles["']/, 'Players should expose separate Access and Roles tabs');
assert.match(ui, /function renderAccessRoles\(/, 'custom roles should render in the Players section');
assert.match(ui, /options: roles\.map\(role => \(\{ value: role\.id/, 'player assignments should select from custom roles');
assert.match(ui, /window\.bridge\.openPlayerRoleEditor\(role\.id\)/, 'role rows should open the dedicated editor');
assert.match(preload, /saveAccessRole: value => ipcRenderer\.invoke\('players:saveRole', value\)/, 'role saves should use a narrow IPC method');
assert.match(preload, /deleteAccessRole: roleId => ipcRenderer\.invoke\('players:deleteRole', roleId\)/, 'role deletion should use a narrow IPC method');
assert.match(main, /width: 620,[\s\S]*height: 560,[\s\S]*loadFile\('player-role-editor\.html'/, 'role editing should use a fixed themed child window');
for (const id of ['roleName','roleId','canSpectate','canViewCoordinates','canViewDimension','canStopServer','canRestartServer','canManageProtection','canBypassProtection','tradeDiscountPercent','commandMode','commandGroups','allowedCommands','deniedCommands','appearanceEnabled','nameColor','tagPrefix','tagSuffix','tagPreview']) {
  assert.match(roleEditorHtml, new RegExp(`id=["']${id}["']`), `role editor should expose ${id}`);
}
assert.match(roleEditorUi, /prefix: \$\('tagPrefix'\)\.value\.replace\(\/&\(\[0-9a-fk-or\]\)\/gi, '§\$1'\)/, 'role formatting should normalize safe Minecraft codes before saving');
assert.match(roleEditorUi, /capabilities\.push\('player\.spectate'\)[\s\S]*capabilities\.push\('protection\.manage'\)[\s\S]*capabilities\.push\('protection\.bypass'\)/, 'role editor should expose each supported capability');
assert.match(roleEditorUi, /capabilities\.push\('player\.coordinates'\)[\s\S]*capabilities\.push\('player\.dimension'\)[\s\S]*capabilities\.push\('server\.stop'\)[\s\S]*capabilities\.push\('server\.restart'\)/, 'role editor should expose player lookup and lifecycle capabilities');
assert.match(roleEditorUi, /tradeDiscountPercent:\s*Number\(\$\('tradeDiscountPercent'\)\.value\)/, 'role editor should save its bounded villager discount');
assert.match(ui, /function roleTradeDiscountSummary\([\s\S]*villager discount/, 'Players UI should summarize role trade discounts');
assert.match(ui, /if \(!roles\.length\)[\s\S]*Create a role before assigning player access/, 'assignment UI should never invent preset roles');
assert.match(ui, /action: 'delete-access-role'[\s\S]*removeAssignments: true/, 'role deletion should explicitly remove assigned access after confirmation');
assert.match(roleEditorStyles, /\.tag-preview\s*\{/, 'role tag preview should be visibly styled');
for (const file of ['player-role-editor.js', 'player-role-editor.html', 'player-role-editor.css']) {
  assert.match(updateBuilder, new RegExp(`['"]${file.replaceAll('.', '\\.')}['"]`), `${file} should ship in staged updates`);
}

assert.doesNotMatch(ui, /mc-heads\.net/i, 'player rows should never depend on third-party rendered heads');
assert.match(ui, /entry\?\.uuid \|\| entry\?\.id/, 'player visuals should accept UUIDs from both backend and protocol-shaped entries');
assert.match(ui, /api\.getPlayerSkin\(\{/, 'player rows should request verified raw skin data through the local bridge');
assert.match(ui, /const playerSkinRequests = new Map\(\)/, 'skin requests should be shared instead of repeated per row');
assert.match(ui, /const playerBustCanvases = new Map\(\)/, 'finished transparent busts should be cached for synchronous reuse');
assert.match(ui, /ms-player-figure-fallback/, 'player rows should include an offline fallback visual');
assert.match(styles, /\.ms-player-figure\s*\{/, 'player body visual should be compactly styled');
assert.doesNotMatch(playerFigureImplementation, /loading\s*=\s*['"]lazy['"]/, 'player skins should not wait for lazy image loading');
assert.doesNotMatch(styles, /\.ms-player-figure[^}]*transition/s, 'player figures should not cross-fade on refresh');
assert.match(styles, /\.ms-player-figure\s*\{[^}]*background:\s*transparent/s, 'player figures should not add a colored tile behind the skin');
assert.match(ui, /list\.dataset\.playerRenderSignature === renderSignature && list\.childElementCount/, 'unchanged polling should preserve existing player rows');

assert.match(ui, /event\.className = `ms-player-event/, 'history rows should render an explicit event label');
assert.match(ui, /document\.createElement\('time'\)/, 'history rows should expose each event time semantically');
assert.match(ui, /details\.expiry/, 'banned rows should show their expiry');
assert.match(ui, /details\.reason/, 'banned rows should show their reason when present');

assert.match(ui, /action: 'temp-ban-mode'/, 'temporary bans should start with an end-mode choice');
assert.match(ui, /value: 'duration', label: 'A duration'/, 'temporary bans should accept a duration');
assert.match(ui, /value: 'date', label: 'An exact date and time'/, 'temporary bans should accept an exact local date and time');
assert.match(ui, /inputType: 'datetime-local'/, 'exact-date temporary bans should use a native date/time picker');
assert.match(ui, /inputMin: tempBanDateValue\(Date\.now\(\) \+ 60_000\).*inputMax: tempBanDateValue\(Date\.now\(\) \+ 31_536_000_000\)/s, 'date picker should constrain bans to 1 minute through 365 days');
assert.match(ui, /function tempBanDurationMs\(value\)/, 'duration input should be validated');
assert.match(ui, /function tempBanDateDurationMs\(value, now = Date\.now\(\)\)/, 'date input should be validated');
assert.match(ui, /api\.tempBanPlayer\(request\.target, request\.durationMs, value\)/, 'validated duration and reason should use the existing bridge API');
assert.match(ui, /api\.shortenBan\(payload\.target, durationMs, ''\)/, 'changing a temporary ban should share the validated 365-day duration path');
assert.doesNotMatch(ui, /43,?200 minutes|Math\.min\(43200|,\s*43200\)/, 'legacy 30-day temporary-ban limits should not remain in validation');
assert.match(ui, /durationMinutes, fallbackDuration, 1, 525600/, 'automatic temporary bans should use the same 365-day ceiling');
assert.match(html, /<option value="525600">365 days<\/option>/, 'automatic response settings should offer the full 365-day range');

for (const kind of ['ban', 'temp']) {
  assert.match(ui, new RegExp(`${kind}: '<svg`), `${kind} should use an icon instead of a text action`);
}
assert.match(ui, /view: '<svg/, 'online players should have a view icon');
assert.match(ui, /window\.bridge\.openPlayerInspector\(name\)/, 'the view action should open the dedicated player window');
assert.match(main, /title: `View \$\{playerInspectorName\}`[\s\S]*loadFile\('player-inspector\.html', \{ query: \{ player: requestedPlayer \} \}\)/, 'player details should open in a separate themed window with its selected player attached');
assert.match(preload, /inspectPlayer: name => ipcRenderer\.invoke\('players:inspect', name\)/, 'player inspection should use a narrow IPC method');
assert.match(preload, /getPlayerSnapshot: \(\) => ipcRenderer\.invoke\('players:snapshot'\)/, 'the Players page should refresh through a narrow snapshot IPC method');
assert.match(preload, /getPlayerStatistics: name => ipcRenderer\.invoke\('players:statistics', name\)/, 'statistics should use a separate on-demand IPC method');
assert.doesNotMatch(preload, /startPlayerSpectating|exportPlayerViewCompanion/, 'companion-dependent starts and exports are retired');
assert.match(preload, /stopPlayerSpectating: value => ipcRenderer\.invoke\('players:stopSpectating', value\)/, 'native player POV should expose an explicit restore action');
assert.match(read('minecraft-server/main.js'), /ipcMain\.handle\('players:exportViewCompanion', exportBundledPlayerViewCompanion\)/,
  'the owner-side companion export route should be registered');
assert.match(main, /width: 800,[\s\S]*height: 510,[\s\S]*title: `View \$\{playerInspectorName\}`,[\s\S]*resizable: false/, 'player profile window should have a compact fixed Minecraft inventory layout');
assert.match(inspectorHtml, /id="playerX"[\s\S]*id="playerY"[\s\S]*id="playerZ"/, 'player inspector should show coordinates');
for (const id of ['mainInventory', 'hotbarInventory', 'armorInventory', 'offhandInventory']) {
  assert.match(inspectorHtml, new RegExp(`id="${id}"`), `player inspector should show ${id}`);
}
assert.match(inspectorHtml, /id="playerModel"[\s\S]*id="healthBar"[\s\S]*id="hungerBar"[\s\S]*id="xpProgress"/, 'player profile should show a 3D model and Minecraft-style vitals');
assert.match(inspectorHtml, /id="openStatistics"[\s\S]*id="statisticsPage"[\s\S]*id="statisticsList"/, 'player profile should expose a full statistics page');
assert.match(inspectorHtml, /id="statisticsPagination"[\s\S]*id="previousStatisticsPage"[\s\S]*id="nextStatisticsPage"/, 'large statistics sets should use bounded paging');
assert.doesNotMatch(inspectorHtml, /id="healthValue"|id="hungerValue"|class="vital-label"/, 'the vanilla HUD should not repeat health and hunger as labels or x/20 text');
for (const id of ['playerViewViewer','stopPlayerView']) {
  assert.match(inspectorHtml, new RegExp(`id="${id}"`), `player profile should expose managed ${id} UI`);
}
assert.match(inspectorHtml, /Return from active view/, 'legacy sessions retain a clear return action');
assert.doesNotMatch(inspectorHtml, /id="startPlayerView"|id="savePlayerViewCompanion"/, 'no new companion-dependent controls appear');
assert.match(inspectorUi, /function createCuboid\(/, 'player skin should be rendered as a rotatable 3D cuboid model');
assert.match(inspectorUi, /name:'hat'[\s\S]*name:'jacket'[\s\S]*name:'right-sleeve'[\s\S]*name:'left-sleeve'[\s\S]*name:'right-pants'[\s\S]*name:'left-pants'/,
  'the 3D fit should include all modern outer skin layers');
assert.match(inspectorUi, /const legacySkin = Number\(image\?\.naturalHeight \|\| image\?\.height\) === 32/,
  'legacy 64x32 skins should use their stored limb texture instead of rendering blank left limbs');
assert.match(inspectorUi, /44 \+ armPixels[\s\S]*48 \+ armPixels/,
  'slim arm side and back UVs should use the actual three-pixel arm width');
assert.match(inspectorUi, /signature === renderedModelSignature && rig\.classList\.contains\('ready'\)/, 'unchanged polling should preserve the rendered 3D model instead of flashing');
assert.match(inspectorModelImplementation, /const armorSignature =/, 'the model fingerprint should not shadow the equippedArmor renderer');
assert.doesNotMatch(inspectorModelImplementation, /const equippedArmor\s*=/, 'the equippedArmor function must remain callable after the skin image loads');
assert.match(inspectorModelImplementation, /loadArmorImages\(equippedArmor\(items\)\)/, 'the model should load equipped armor textures before building');
assert.match(inspectorUi, /item\.iconDataUrl/, 'inventory slots should render resolved item textures');
assert.match(inspectorUi, /item\.equipmentDataUrl/, 'equipped armor should use the matching local Minecraft armor texture');
assert.match(inspectorUi, /slotAssets\.helmet[\s\S]*slotAssets\.offhand/, 'empty equipment slots should use local Minecraft slot textures');
assert.match(inspectorUi, /slot\.dataset\.renderSignature === signature/, 'unchanged inventory slots should retain their image nodes between refreshes');
assert.match(inspectorUi, /generation !== playerGeneration \|\| requestedPlayer !== player/, 'late player and statistics responses must not repaint a different profile');
assert.match(inspectorUi, /statisticsPlayer = requestedPlayer;\s*if \(\$\('statisticsPage'\)\.hidden\) return;/, 'a completed statistics read must not repaint the profile page after navigating back');
assert.match(inspectorUi, /api\.getPlayerStatistics\(requestedPlayer\)/, 'statistics should load only when their page is opened');
assert.match(inspectorUi, /api\.getPlayerEvents\(\)/, 'statistics should include the player warning, kick, and ban timeline');
assert.match(inspectorUi, /inspectorData\.paginateRows\(filteredRows, statisticsPageIndex\)/, 'statistics should render in bounded pages');
assert.match(inspectorUi, /setInterval\([\s\S]*4000/, 'player details should refresh while the inspector is visible without aggressively polling');
assert.doesNotMatch(inspectorUi, /api\.(?:startPlayerSpectating|exportPlayerViewCompanion)/);
assert.match(inspectorUi, /api\.stopPlayerSpectating\(\{ viewer, target(?:: player)? \}\)/, 'player-view return should use the narrow managed IPC target');
assert.match(inspectorUi, /playerViewPanel'\)\.hidden = sessions\.length === 0/, 'return controls only appear for saved sessions');
assert.match(ui, /const PLAYER_STREAM_KINDS = Object\.freeze\(\['players', 'bans', 'history', 'historyEvents'\]\)/,
  'online, ban, and both history streams should participate in stale-response protection');
assert.match(ui, /reconcilePlayerStreams\(nextStatus, nextStatus, playerStreams, requestedPlayerVersions, !hadStatusAtRequest\)/,
  'full status refreshes should preserve newer event payloads and pre-hydration buffers');
assert.match(ui, /if \(name === 'players'\)[\s\S]*refreshPlayerSnapshot\(\)\.catch/,
  'entering Players should request a narrow snapshot immediately');
assert.match(ui, /playersView === 'online' \|\| playersView === 'history'[\s\S]*refreshPlayerSnapshot\(\)\.catch/,
  'switching to Online or History should request a narrow snapshot immediately');
assert.match(ui, /playerSnapshotTimer = setInterval\([\s\S]*playerPageIsVisible\(\)[\s\S]*PLAYER_SNAPSHOT_POLL_MS/,
  'narrow snapshot polling should run only while the Player page is visible');
assert.match(ui, /settleWithTimeout\(invoked, PLAYER_SNAPSHOT_TIMEOUT_MS[\s\S]*playerSnapshotPending === tracked[\s\S]*playerSnapshotPending = null/,
  'failed or hung snapshot calls should release their single-flight lock');
assert.match(inspectorStyles, /\.player-view-panel\s*\{/, 'managed player-view controls should fit the compact inspector');
assert.match(inspectorStyles, /\.inventory-grid/, 'player inventory should use a compact slot grid');
assert.match(html, /data-ms-protection-page="exemptions"/, 'Protection should provide an exemption settings section');
assert.match(html, /id="msExemptOwners"[\s\S]*id="msExemptAdmins"[\s\S]*id="msProtectionExemptList"/, 'owners, admins, and named players should be configurable');
assert.doesNotMatch(ui, /info\.title = `Open \$\{info\.textContent\}`/, 'obvious server rows should not have redundant open tooltips');

const modelLoads = [];
const modelSandbox = {
  modelLoads,
  builtModels: 0,
  armorReads: 0,
  rig: {
    classList: { contains: () => false, remove: () => {} },
    replaceChildren: () => {}
  },
  fallback: { textContent: '' },
  Image: class FakeImage {
    set src(_value) {
      const task = Promise.resolve().then(() => this.onload?.());
      modelLoads.push(task);
    }
  }
};
vm.runInNewContext(`
  let renderedModelSignature = '';
  let pendingModelSignature = '';
  const $ = id => id === 'modelRig' ? rig : fallback;
  function equippedArmor(items) {
    armorReads += 1;
    return { helmet: { texture: items[0]?.equipmentDataUrl || '' }, chest: {}, legs: {}, boots: {} };
  }
  async function loadArmorImages(value) { return { helmet: value.helmet.texture ? {} : null }; }
  function buildPlayerModel() { builtModels += 1; }
  ${inspectorModelImplementation}
  this.renderPlayerModel = renderPlayerModel;
`, modelSandbox);

(async () => {
  modelSandbox.renderPlayerModel(
    { uuid: '12345678-90ab-cdef-1234-567890abcdef', model: 'classic', skinDataUrl: 'data:image/png;base64,skin' },
    [{ section: 'armor', index: 0, id: 'minecraft:diamond_helmet', equipmentDataUrl: 'data:image/png;base64,armor' }]
  );
  await Promise.all(modelLoads);
  assert.equal(modelSandbox.armorReads, 1, 'skin load should call the equippedArmor helper instead of shadowing it with a fingerprint string');
  assert.equal(modelSandbox.builtModels, 1, 'a decoded skin should reach 3D model construction');
  console.log('PASS Minecraft server Players UI contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
