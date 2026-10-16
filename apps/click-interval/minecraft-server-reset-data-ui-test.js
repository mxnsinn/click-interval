'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const ui = read('minecraft-server-ui.js');
const main = read('main.js');
const plain = value => JSON.parse(JSON.stringify(value));
const protectedFields = ['serverIcon', 'serverType', 'serverVersion', 'levelName', 'motd', 'publicAddress', 'simulationDistance'];
function slice(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Missing runtime slice: ${from}`);
  return source.slice(start, end);
}

function uiSandbox() {
  const calls = { dialogs: [], wipes: [], toasts: [], hydrated: 0, refreshes: 0, clearedStreams: [] };
  const elements = { msWipeData: {}, msResetDataSettings: {}, msResetDataHint: {}, msLoadingOverlay: { hidden: true }, msLoadingText: {} };
  const sandbox = {
    Date, calls, elements,
    status: { state: 'stopped', profiles: { activeProfileId: 'one' }, config: { motd: 'Saved' } },
    pendingDataReset: null, serverDataResetBusy: false, dataResetSequence: 0, settingsDirty: true,
    playerSnapshotRequestGeneration: 0, playerSnapshotPending: null, playerStreams: {},
    rememberPlayerStream: (_streams, kind) => calls.clearedStreams.push(kind), writePlayerStreamValue() {},
    $: id => elements[id],
    activeProfile: () => ({ id: sandbox.status.profiles.activeProfileId, name: 'Test world' }),
    window: { bridge: { openMacroDeleteWindow: value => calls.dialogs.push(value) } },
    toast: (...args) => calls.toasts.push(args),
    api: { wipeData: async value => { calls.wipes.push(value); return { reset: true, profileId: value.profileId, resetSettings: value.resetSettings, resetFields: value.resetFields, config: { motd: 'Result' } }; } },
    run: action => action(), hydrateSettings: () => { calls.hydrated++; },
    refresh: async () => { calls.refreshes++; }
  };
  vm.runInNewContext(slice(ui, '  function setLoading(', '\n  async function run(') +
    slice(ui, '  function canResetServerData(', '\n  function clampProtectionNumber('), sandbox);
  return sandbox;
}

function popupSandbox(dialog) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, checked: false, disabled: false, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, focus() {} });
    return elements.get(id);
  }
  const confirms = [];
  const sandbox = {
    document: { title: '', body: { classList: { toggle() {} } }, querySelector: element, getElementById: element, addEventListener() {} },
    window: { bridge: { loadMacroDeleteDialog: () => dialog, confirmMacroDelete: options => confirms.push(options), closeCurrentWindow() {} } }
  };
  vm.runInNewContext(read('macro-delete-window.js'), sandbox);
  return { element, confirms };
}

function ipcSandbox() {
  const handlers = {}, broadcasts = [], targeted = [], deletions = [];
  const owner = { webContents: { isDestroyed: () => false, send: (channel, payload) => targeted.push({ channel, payload }) } };
  class FakeWindow {
    constructor(options) { this.options = options; this.webContents = {}; this.events = {}; this.destroyed = false; }
    isDestroyed() { return this.destroyed; }
    on(name, callback) { this.events[name] = callback; }
    close() { this.destroyed = true; this.events.closed?.(); }
    removeMenu() {}
    loadFile() { return Promise.resolve(); }
    focus() {}
  }
  const sandbox = {
    macroDeleteWindow: null, macroDeleteDialog: {}, macroDeleteOwner: null, macroDeleteConfirmed: false,
    window: owner, BrowserWindow: FakeWindow, path, __dirname,
    activeThemeColors: () => ({ background: '#000', symbols: '#fff' }), loadAppSettings: () => ({ language: 'en' }),
    publishPopupState() {}, lockWindowZoom() {}, keepAboveFullscreenApps() {},
    ipcMain: { on: (name, handler) => { handlers[name] = handler; } },
    sendToRenderer: (channel, payload) => broadcasts.push({ channel, payload }),
    pathInsideMacrosDirectory: () => true,
    fs: { existsSync: () => true, unlinkSync: file => deletions.push(file) }
  };
  vm.runInNewContext(slice(main, 'async function createMacroDeleteWindow(', '\nfunction normalizeMotdEditorState(') +
    slice(main, "ipcMain.on('load-macro-delete-dialog'", "ipcMain.on('close-current-window'"), sandbox);
  return { sandbox, handlers, broadcasts, targeted, deletions };
}

function standaloneSandbox() {
  const elements = new Map(), calls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      handlers: {}, checked: false, disabled: false, open: false, returnValue: '',
      addEventListener(name, fn) { this.handlers[name] = fn; }, showModal() { this.open = true; },
      close(value = '') { this.open = false; this.returnValue = value; this.handlers.close?.(); }
    });
    return elements.get(id);
  }
  const sandbox = {
    currentProfiles: { activeProfileId: 'one', profiles: [{ id: 'one', name: 'Example' }] },
    currentState: 'stopped', worldResetBusy: false, pendingWorldResetProfile: '', autoSaveTimer: null,
    currentBans: [], currentHistory: [], recentOnlinePlayers: new Map(), bannedPlayers: new Map(), tempBanTimers: new Map(), tempBanEnds: new Map(),
    document: { getElementById: element }, clearTimeout,
    window: { assembly: { wipeData: async value => { calls.push(value); return { reset: true, ...value }; } } },
    run: action => action(), hydrateConfig() {}, refresh: async () => {}, showToast() {}
  };
  vm.runInNewContext(slice(read('minecraft-server/renderer/renderer.js'), 'async function wipeData()', "\ndocument.querySelectorAll('.nav-item')"), sandbox);
  return { sandbox, calls, element };
}

(async () => {
  for (const resetSettings of [false, true, 'true', undefined]) {
    const s = uiSandbox();
    s.requestServerDataReset();
    assert.equal(s.calls.wipes.length, 0, 'opening confirmation must not reset');
    const payload = { ...s.calls.dialogs[0], resetSettings };
    await s.confirmServerDataReset(payload);
    assert.deepEqual(plain(s.calls.wipes), [{ profileId: 'one', resetSettings: resetSettings === true, resetFields: [] }]);
    assert.equal(s.settingsDirty, resetSettings !== true, 'preserve existing settings drafts for world-only reset');
    assert.equal(s.calls.hydrated, resetSettings === true ? 1 : 0);
    assert.deepEqual(s.calls.clearedStreams, ['players', 'bans', 'history', 'historyEvents']);
    assert.equal(s.playerSnapshotRequestGeneration, 1, 'reset must invalidate stale player snapshots');
    assert.equal(s.serverDataResetBusy, false);
    assert.equal(s.elements.msLoadingOverlay.hidden, true);
    await s.confirmServerDataReset(payload);
    assert.equal(s.calls.wipes.length, 1, 'duplicate confirmation must not reset twice');
  }
  for (const field of protectedFields) {
    for (const resetSettings of [false, true]) {
      const s = uiSandbox(); s.requestServerDataReset();
      await s.confirmServerDataReset({ ...s.calls.dialogs[0], resetSettings, resetFields: [field] });
      assert.deepEqual(plain(s.calls.wipes), [{ profileId: 'one', resetSettings, resetFields: [field] }]);
      assert.equal(s.calls.hydrated, 1, 'individual reset refreshes saved settings even with general reset unchecked');
      assert.equal(s.settingsDirty, false);
      assert.match(s.calls.toasts.at(-1)[0], /Selected settings reset; other settings kept/);
    }
  }
  for (const state of [null, 'running', 'starting', 'stopping', 'restarting', 'unknown']) {
    const s = uiSandbox(); s.status.state = state; s.updateDataResetControls(); s.requestServerDataReset();
    assert.equal(s.elements.msWipeData.disabled, true);
    assert.equal(s.elements.msResetDataSettings.disabled, true);
    assert.match(s.elements.msResetDataHint.textContent, /Stop the server/);
    assert.equal(s.calls.dialogs.length, 0, `must not offer reset while ${state}`);
  }
  {
    const s = uiSandbox(); s.requestServerDataReset(); const payload = s.calls.dialogs[0];
    s.status.profiles.activeProfileId = 'two'; s.updateDataResetControls();
    s.status.profiles.activeProfileId = 'one';
    await s.confirmServerDataReset(payload);
    assert.equal(s.calls.wipes.length, 0, 'switching away and back invalidates the old popup');
  }
  {
    const s = uiSandbox(); s.requestServerDataReset(); const payload = s.calls.dialogs[0];
    s.status.state = 'starting'; s.updateDataResetControls(); s.status.state = 'stopped';
    await s.confirmServerDataReset(payload);
    assert.equal(s.calls.wipes.length, 0, 'a lifecycle transition invalidates confirmation');
  }
  {
    const s = uiSandbox(); s.requestServerDataReset();
    await s.confirmServerDataReset({ ...s.calls.dialogs[0], requestId: 'unrelated-popup' });
    assert.equal(s.calls.wipes.length, 0);
    s.setLoading(true); s.requestServerDataReset(); assert.equal(s.calls.dialogs.length, 1);
    await s.confirmServerDataReset(s.calls.dialogs[0]); assert.equal(s.calls.wipes.length, 0);
  }
  {
    const s = uiSandbox(); let finish;
    s.api.wipeData = value => { s.calls.wipes.push(value); return new Promise(resolve => { finish = resolve; }); };
    s.requestServerDataReset(); const payload = s.calls.dialogs[0]; const work = s.confirmServerDataReset(payload);
    assert.equal(s.elements.msWipeData.disabled, true);
    s.requestServerDataReset(); await s.confirmServerDataReset(payload);
    assert.equal(s.calls.wipes.length, 1, 'in-flight reset blocks repeated commands');
    finish({ reset: true, profileId: 'one', resetSettings: false }); await work;
    assert.equal(s.elements.msWipeData.disabled, false);
    assert.equal(s.elements.msResetDataSettings.disabled, false);
  }
  {
    const s = uiSandbox(); s.api.wipeData = async () => { throw Error('Backup failed'); };
    s.requestServerDataReset(); await s.confirmServerDataReset(s.calls.dialogs[0]);
    assert.equal(s.serverDataResetBusy, false); assert.equal(s.settingsDirty, true);
    assert.equal(s.calls.hydrated, 0); assert.equal(s.calls.refreshes, 0);
  }
  for (const entity of ['macro', 'server']) {
    const popup = popupSandbox({ entity, action: 'delete', name: 'Example' });
    assert.equal(popup.element('resetServerSettingsOption').hidden, true);
    popup.element('resetServerSettings').checked = true;
    for (const field of protectedFields) popup.element(`resetServerField-${field}`).checked = true;
    popup.element('confirmDelete').handlers.click();
    assert.equal(popup.confirms[0].resetSettings, false, 'checkbox cannot extend another dialog action');
    assert.deepEqual(plain(popup.confirms[0].resetFields), [], 'field reset options cannot extend another dialog action');
    assert.equal(popup.element('resetServerFields').hidden, true);
  }
  {
    const popup = popupSandbox({ entity: 'server', action: 'wipe' });
    assert.equal(popup.element('resetServerSettingsOption').hidden, false);
    assert.equal(popup.element('resetServerSettings').checked, false, 'reset settings must default off');
    assert.equal(popup.element('resetServerFields').hidden, false);
    for (const field of protectedFields) assert.equal(popup.element(`resetServerField-${field}`).checked, false, `${field} must default off`);
    popup.element('resetServerSettings').checked = true; popup.element('confirmDelete').handlers.click();
    assert.equal(popup.confirms[0].resetSettings, true);
    assert.deepEqual(plain(popup.confirms[0].resetFields), [], 'general reset does not select protected fields');
  }
  for (const field of protectedFields) {
    const popup = popupSandbox({ entity: 'server', action: 'wipe' });
    popup.element(`resetServerField-${field}`).checked = true; popup.element('confirmDelete').handlers.click();
    assert.deepEqual(plain(popup.confirms[0]), { resetSettings: false, resetFields: [field] });
  }
  {
    const { sandbox: s, handlers, broadcasts, targeted } = ipcSandbox();
    await s.createMacroDeleteWindow({ entity: 'server', action: 'wipe', id: 'one', requestId: 'request-one', resetSettings: true });
    const sender = s.macroDeleteWindow.webContents;
    const spoof = { sender: {} }; handlers['load-macro-delete-dialog'](spoof); assert.equal(spoof.returnValue, null);
    const valid = { sender }; handlers['load-macro-delete-dialog'](valid); assert.equal(valid.returnValue.requestId, 'request-one');
    handlers['confirm-macro-delete'](spoof, { resetSettings: true }); assert.equal(targeted.length, 0);
    handlers['confirm-macro-delete'](valid, { resetSettings: true, resetFields: ['motd', 'serverIcon', 'unknown', '../world', 'motd'], id: 'two', entity: 'macro' });
    assert.equal(targeted.length, 1); assert.equal(broadcasts.length, 0);
    assert.equal(targeted[0].payload.id, 'one'); assert.equal(targeted[0].payload.resetSettings, true);
    assert.deepEqual(plain(targeted[0].payload.resetFields), ['serverIcon', 'motd'], 'confirmation passes exact allowlisted selections without duplicates');
    handlers['confirm-macro-delete'](valid, { resetSettings: true }); assert.equal(targeted.length, 1);
  }
  for (const action of ['delete', 'remove-player-access', 'delete-access-role']) {
    const { sandbox: s, handlers, broadcasts, targeted } = ipcSandbox();
    await s.createMacroDeleteWindow({ entity: 'server', action, id: 'one' });
    handlers['confirm-macro-delete']({ sender: s.macroDeleteWindow.webContents }, { resetSettings: true, resetFields: protectedFields });
    assert.equal(broadcasts.length, 1); assert.equal(targeted.length, 0);
    assert.equal('resetSettings' in broadcasts[0].payload, false);
    assert.equal('resetFields' in broadcasts[0].payload, false);
  }
  {
    const { sandbox: s, handlers, deletions, broadcasts } = ipcSandbox();
    await s.createMacroDeleteWindow({ entity: 'macro', id: 'macro-one', filePath: 'managed-macro.json' });
    handlers['confirm-macro-delete']({ sender: s.macroDeleteWindow.webContents });
    assert.deepEqual(deletions, ['managed-macro.json']); assert.equal(broadcasts[0].payload.deleted, true);
  }
  for (const preload of ['preload.js', 'minecraft-server/preload.js']) {
    const exposed = {}, invocations = [];
    vm.runInNewContext(read(preload), { require: name => {
      assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } }, ipcRenderer: { invoke: (...args) => { invocations.push(args); } } };
    } });
    (exposed.bridge?.minecraftServer || exposed.assembly).wipeData({ profileId: 'one', resetSettings: true, resetFields: ['serverIcon'] });
    assert.deepEqual(plain(invocations), [['files:wipeData', { profileId: 'one', resetSettings: true, resetFields: ['serverIcon'] }]]);
  }
  for (const resetSettings of [false, true]) {
    const { sandbox: s, element, calls } = standaloneSandbox();
    const pending = s.wipeData();
    assert.equal(element('resetDataSettings').checked, false);
    for (const field of protectedFields) assert.equal(element(`resetDataField-${field}`).checked, false);
    element('resetDataSettings').checked = resetSettings;
    element('resetDataDialog').close('reset'); await pending;
    assert.deepEqual(plain(calls), [{ profileId: 'one', resetSettings, resetFields: [] }]);
  }
  for (const field of protectedFields) {
    const { sandbox: s, element, calls } = standaloneSandbox();
    const pending = s.wipeData();
    element(`resetDataField-${field}`).checked = true;
    element('resetDataDialog').close('reset'); await pending;
    assert.deepEqual(plain(calls), [{ profileId: 'one', resetSettings: false, resetFields: [field] }]);
    const nextPending = s.wipeData();
    for (const protectedField of protectedFields) assert.equal(element(`resetDataField-${protectedField}`).checked, false, 'reopening does not retain destructive selections');
    element('resetDataDialog').close(); await nextPending;
  }
  for (const cancel of ['cancel', 'switch', 'running']) {
    const { sandbox: s, element, calls } = standaloneSandbox();
    const pending = s.wipeData();
    if (cancel === 'switch') s.currentProfiles.activeProfileId = 'two';
    if (cancel === 'running') s.currentState = 'running';
    s.updateWorldResetControls();
    if (cancel === 'running') assert.equal(element('wipeDataSettingsBtn').disabled, true);
    element('resetDataDialog').close(cancel === 'cancel' ? '' : 'reset'); await pending;
    assert.equal(calls.length, 0, `standalone ${cancel} must not reset`);
  }
  console.log('Reset Data UI and confirmation IPC regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
