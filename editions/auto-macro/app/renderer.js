const $ = id => document.getElementById(id);
window.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (['+', '=', '-', '_', '0'].includes(event.key)) event.preventDefault();
}, true);
const popupBlocker = document.createElement('div');
popupBlocker.className = 'popup-blocker';
popupBlocker.hidden = true;
popupBlocker.setAttribute('aria-hidden', 'true');
document.body.appendChild(popupBlocker);
window.bridge.onPopupModalState(state => {
  popupBlocker.hidden = !state?.open;
  document.body.classList.toggle('popup-modal-open', Boolean(state?.open));
  if (state?.open) {
    closeCustomDropdowns();
    window.bridge.hideHoverHint();
  }
});
const initialWindowContext = window.bridge.getWindowContext() || { role: 'main', tool: 'auto-clicker', detachedTool: null, lockedTool: null };
const appVersionLabel = $('appVersionLabel');
if (appVersionLabel) appVersionLabel.textContent = `Click Interval V ${initialWindowContext.appVersion || '1.0.0'}`;
let toolLayout = initialWindowContext;
function ownsTool(tool) {
  if (initialWindowContext.role === 'detached') return initialWindowContext.tool === tool;
  return toolLayout.detachedTool !== tool;
}

const controls = {
  hours: $('hours'), minutes: $('minutes'), seconds: $('seconds'), milliseconds: $('milliseconds'),
  randomEnabled: $('randomEnabled'), randomMilliseconds: $('randomMilliseconds'),
  mouseClick: $('mouseClick'), clickType: $('clickType'),
  cpsCap: $('cpsCap'),
  currentLocation: $('currentLocation'), pickedLocation: $('pickedLocation'), cursorX: $('cursorX'), cursorY: $('cursorY')
};

$('minimizeWindow').addEventListener('click', () => window.bridge.windowControl('minimize'));
$('closeWindow').addEventListener('click', () => window.bridge.windowControl('close'));

let backendReady = false;
let hotkey = { name: 'Q', shortName: 'Q', vk: 0x51 };
let hotkeyArmed = true;
let mouseArmTimer = null;
let pendingHotkey = hotkey;
let capturingEmergencyHotkey = false;

const defaultEmergencyHotkey = { vk: 0x7B, modifiers: 0x06, keys: [0x11, 0x10, 0x7B], keyName: 'F12', label: 'Ctrl + Shift + F12' };
const defaultMacroTrigger = { vk: 0x77, modifiers: 0, keys: [0x77], keyName: 'F8', label: 'F8' };
const defaultMacroRecordHotkey = { vk: 0x79, modifiers: 0x02, keys: [0x11, 0x79], keyName: 'F10', label: 'Ctrl + F10' };
const defaultMacroPlayHotkey = { vk: 0x7A, modifiers: 0x02, keys: [0x11, 0x7A], keyName: 'F11', label: 'Ctrl + F11' };
const loadedPreferences = window.bridge.loadPreferences() || {};
const loadedMacroLibrary = window.bridge.loadMacroLibrary() || { version: 1, selectedId: null, macros: [] };
let emergencyHotkey = loadedPreferences.emergencyHotkey && Number.isInteger(loadedPreferences.emergencyHotkey.vk)
  ? loadedPreferences.emergencyHotkey
  : defaultEmergencyHotkey;
let macroTrigger = loadedPreferences.macroTrigger && Array.isArray(loadedPreferences.macroTrigger.keys)
  ? loadedPreferences.macroTrigger
  : defaultMacroTrigger;
let macroTriggerCaptureActive = false;
let macroControlCaptureActive = false;
let macroRecordHotkey = loadedPreferences.macroRecordHotkey && Array.isArray(loadedPreferences.macroRecordHotkey.keys)
  ? loadedPreferences.macroRecordHotkey : defaultMacroRecordHotkey;
let macroPlayHotkey = loadedPreferences.macroPlayHotkey && Array.isArray(loadedPreferences.macroPlayHotkey.keys)
  ? loadedPreferences.macroPlayHotkey : defaultMacroPlayHotkey;
let macroLibrary = {
  version: 1,
  selectedId: loadedMacroLibrary.selectedId || null,
  macros: Array.isArray(loadedMacroLibrary.macros) ? loadedMacroLibrary.macros : []
};
if (!macroLibrary.macros.some(item => item.id === macroLibrary.selectedId)) macroLibrary.selectedId = macroLibrary.macros[0]?.id || null;
let macroActions = macroLibrary.macros.find(item => item.id === macroLibrary.selectedId)?.actions || [];
let macroFilePath = '';
let macroIsRecording = false;
let macroIsPlaying = false;
let macroDirty = false;
let macroSavedSnapshot = null;
let activeMacroPanel = 'home';
function createTriggerDraft(kind = 'visual') {
  return {
  kind,
  displayKind: '',
  condition: 'above',
  color: '#ff0000',
  colorTolerance: 25,
  colorCoverage: 5,
  changeThreshold: 10,
  barColor: '#ffffff',
  targetColor: '#ff0000',
  relationBoundaryColor: '#ffffff',
  relationTargetColor: '#ff0000',
  relationTolerance: 35,
  relationEdgeMargin: 3,
  holdMoves: 'right',
  mouseButton: 'Left',
  deadZone: 6,
  lostTimeout: 120,
  prediction: 35,
  scanInterval: 33,
  cooldown: 0,
  areaMode: 'full',
  area: { x: 0, y: 0, width: 800, height: 600 }
  };
}
let smartActivation = createTriggerDraft();
let editingActionIndex = -1;

function restoreNumberPreference(control, key, allowNegative = false) {
  const value = Number(loadedPreferences[key]);
  if (loadedPreferences[key] !== undefined && Number.isFinite(value) && (allowNegative || value >= 0)) {
    control.value = String(value);
  }
}

function restoreSelectPreference(control, key) {
  const value = loadedPreferences[key];
  if ([...control.options].some(option => option.value === value)) control.value = value;
}

restoreNumberPreference(controls.hours, 'hours');
restoreNumberPreference(controls.minutes, 'minutes');
restoreNumberPreference(controls.seconds, 'seconds');
restoreNumberPreference(controls.milliseconds, 'milliseconds');
restoreNumberPreference(controls.randomMilliseconds, 'randomMilliseconds');
restoreNumberPreference(controls.cursorX, 'cursorX', true);
restoreNumberPreference(controls.cursorY, 'cursorY', true);
controls.cpsCap.value = String(Math.max(1, Number(loadedPreferences.cpsCap) || 100));
controls.randomEnabled.checked = Boolean(loadedPreferences.randomEnabled);
restoreSelectPreference(controls.mouseClick, 'mouseClick');
restoreSelectPreference(controls.clickType, 'clickType');
if (loadedPreferences.cursorMode === 'picked') controls.pickedLocation.checked = true;
else controls.currentLocation.checked = true;
$('macroTriggerMode').value = ['Pressed', 'Hold', 'Toggle'].includes(loadedPreferences.macroTriggerMode)
  ? loadedPreferences.macroTriggerMode : 'Pressed';
$('macroEnabled').checked = Boolean(loadedPreferences.macroEnabled);
$('captureMovement').checked = loadedPreferences.captureMovement !== false;
$('captureButtons').checked = loadedPreferences.captureButtons !== false;
$('captureKeyboard').checked = loadedPreferences.captureKeyboard !== false;
$('captureDelays').checked = loadedPreferences.captureDelays !== false;
const useConstantRepeat = loadedPreferences.macroRepeatMode === 'constant' ||
  (loadedPreferences.macroRepeat === true && Number(loadedPreferences.macroRepeatCount) === 0);
$('macroConstantRepeat').checked = useConstantRepeat;
$('macroRepeatCountMode').checked = !useConstantRepeat;
$('macroRepeatCount').value = String(Math.max(1, Number(loadedPreferences.macroRepeatCount) || 3));
$('macroRepeatCount').disabled = useConstantRepeat;
const savedPlaybackSpeed = String(Number(loadedPreferences.macroPlaybackSpeed) || 1);
if ([...$('macroPlaybackSpeed').options].some(option => option.value === savedPlaybackSpeed)) $('macroPlaybackSpeed').value = savedPlaybackSpeed;
$('macroMinimizeOnPlay').checked = loadedPreferences.macroMinimizeOnPlay !== false;
$('macroRestoreCursor').checked = Boolean(loadedPreferences.macroRestoreCursor);
$('macroStopOnInput').checked = Boolean(loadedPreferences.macroStopOnInput);
const savedRecordingQuality = ['compact', 'balanced', 'smooth', 'ultra'].includes(loadedPreferences.macroRecordingQuality)
  ? loadedPreferences.macroRecordingQuality : 'balanced';
$('macroRecordingQuality').value = savedRecordingQuality;
const savedTimingVariance = String(Math.max(0, Number(loadedPreferences.macroTimingVariance) || 0));
if ([...$('macroTimingVariance').options].some(option => option.value === savedTimingVariance)) $('macroTimingVariance').value = savedTimingVariance;
const savedStartDelay = String(Math.max(0, Number(loadedPreferences.macroStartDelay) || 0));
if ([...$('macroStartDelay').options].some(option => option.value === savedStartDelay)) $('macroStartDelay').value = savedStartDelay;
$('macroLoopDelay').value = String(Math.max(0, Number(loadedPreferences.macroLoopDelay) || 0));
if (loadedPreferences.macroPositionMode === 'relative') $('macroRelative').checked = true;
else $('macroAbsolute').checked = true;
$('macroTriggerKey').textContent = macroTrigger.label;
$('macroRecordHotkey').textContent = `Record / Stop: ${macroRecordHotkey.label}`;
$('macroPlayHotkey').textContent = `Play / Stop: ${macroPlayHotkey.label}`;

function emergencyKeys(value) {
  if (Array.isArray(value.keys) && value.keys.length) return value.keys;
  const keys = [];
  if (value.modifiers & 0x02) keys.push(0x11);
  if (value.modifiers & 0x04) keys.push(0x10);
  if (value.modifiers & 0x01) keys.push(0x12);
  if (value.modifiers & 0x08) keys.push(0x5B);
  keys.push(value.vk);
  return [...new Set(keys)];
}
emergencyHotkey.keys = emergencyKeys(emergencyHotkey);

const keyboardHotkeys = {
  Space: { name: 'Space', shortName: 'Space', vk: 0x20 },
  Tab: { name: 'Tab', shortName: 'Tab', vk: 0x09 },
  Enter: { name: 'Enter', shortName: 'Enter', vk: 0x0D },
  Escape: { name: 'Escape', shortName: 'Esc', vk: 0x1B },
  CapsLock: { name: 'Caps Lock', shortName: 'Caps', vk: 0x14 },
  ShiftLeft: { name: 'Shift', shortName: 'Shift', vk: 0x10 },
  ShiftRight: { name: 'Shift', shortName: 'Shift', vk: 0x10 },
  ControlLeft: { name: 'Control', shortName: 'Ctrl', vk: 0x11 },
  ControlRight: { name: 'Control', shortName: 'Ctrl', vk: 0x11 },
  AltLeft: { name: 'Alt', shortName: 'Alt', vk: 0x12 },
  AltRight: { name: 'Alt', shortName: 'Alt', vk: 0x12 },
  ArrowLeft: { name: 'Left Arrow', shortName: 'Left', vk: 0x25 },
  ArrowUp: { name: 'Up Arrow', shortName: 'Up', vk: 0x26 },
  ArrowRight: { name: 'Right Arrow', shortName: 'Right', vk: 0x27 },
  ArrowDown: { name: 'Down Arrow', shortName: 'Down', vk: 0x28 },
  Insert: { name: 'Insert', shortName: 'Ins', vk: 0x2D },
  Delete: { name: 'Delete', shortName: 'Del', vk: 0x2E },
  Home: { name: 'Home', shortName: 'Home', vk: 0x24 },
  End: { name: 'End', shortName: 'End', vk: 0x23 },
  PageUp: { name: 'Page Up', shortName: 'PgUp', vk: 0x21 },
  PageDown: { name: 'Page Down', shortName: 'PgDn', vk: 0x22 },
  Pause: { name: 'Pause', shortName: 'Pause', vk: 0x13 }
};

function storedHotkey() {
  try {
    const saved = window.bridge.loadHotkey();
    if (saved && Number.isInteger(saved.vk) && typeof saved.name === 'string' && typeof saved.shortName === 'string') {
      return saved;
    }
  } catch (_) {}
  return null;
}

hotkey = storedHotkey() || hotkey;
pendingHotkey = hotkey;
if ([0x04, 0x05, 0x06].includes(hotkey.vk)) hotkeyArmed = false;
window.bridge.saveHotkey(hotkey);

function hotkeyFromKeyboard(event) {
  if (/^Key[A-Z]$/.test(event.code)) {
    const name = event.code.slice(3);
    return { name, shortName: name, vk: name.charCodeAt(0) };
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    const name = event.code.slice(5);
    return { name, shortName: name, vk: name.charCodeAt(0) };
  }
  const functionMatch = /^F([1-9]|1[0-2])$/.exec(event.code);
  if (functionMatch) {
    const number = Number(functionMatch[1]);
    return { name: `F${number}`, shortName: `F${number}`, vk: 0x6F + number };
  }
  return keyboardHotkeys[event.code] || null;
}

function saveHotkeySelection() {
  hotkey = pendingHotkey;
  const isMouseHotkey = [0x04, 0x05, 0x06].includes(hotkey.vk);
  hotkeyArmed = !isMouseHotkey;
  window.bridge.saveHotkey(hotkey);
  refreshButtonLabels();
  sendConfiguration();
  clearTimeout(mouseArmTimer);
  if (isMouseHotkey) {
    mouseArmTimer = setTimeout(() => {
      hotkeyArmed = true;
      sendConfiguration();
    }, 1000);
  }
}

function numberValue(element, fallback = 0) {
  const value = Number(element.value);
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function currentPreferences() {
  const preferences = {};
  if (ownsTool('auto-clicker')) Object.assign(preferences, {
    hours: numberValue(controls.hours), minutes: numberValue(controls.minutes),
    seconds: numberValue(controls.seconds), milliseconds: numberValue(controls.milliseconds),
    randomEnabled: controls.randomEnabled.checked,
    randomMilliseconds: numberValue(controls.randomMilliseconds, 40),
    mouseClick: controls.mouseClick.value, clickType: controls.clickType.value,
    cpsCap: Math.max(1, numberValue(controls.cpsCap, 100)),
    cursorMode: controls.currentLocation.checked ? 'current' : 'picked',
    cursorX: Number(controls.cursorX.value) || 0, cursorY: Number(controls.cursorY.value) || 0,
    emergencyHotkey
  });
  if (ownsTool('macro')) Object.assign(preferences, {
    macroTrigger, macroTriggerMode: $('macroTriggerMode').value,
    macroEnabled: $('macroEnabled').checked, macroRecordHotkey, macroPlayHotkey,
    captureMovement: $('captureMovement').checked, captureButtons: $('captureButtons').checked,
    captureKeyboard: $('captureKeyboard').checked, captureDelays: $('captureDelays').checked,
    macroPositionMode: $('macroRelative').checked ? 'relative' : 'absolute',
    macroRepeatMode: $('macroConstantRepeat').checked ? 'constant' : 'count',
    macroRepeatCount: Math.max(1, Math.floor(numberValue($('macroRepeatCount'), 3))),
    macroPlaybackSpeed: Number($('macroPlaybackSpeed').value) || 1,
    macroMinimizeOnPlay: $('macroMinimizeOnPlay').checked,
    macroRestoreCursor: $('macroRestoreCursor').checked,
    macroStopOnInput: $('macroStopOnInput').checked,
    macroRecordingQuality: $('macroRecordingQuality').value,
    macroTimingVariance: Math.max(0, numberValue($('macroTimingVariance'))),
    macroStartDelay: Math.max(0, numberValue($('macroStartDelay'))),
    macroLoopDelay: Math.max(0, numberValue($('macroLoopDelay')))
  });
  return preferences;
}

const PREFERENCE_SAVE_DEBOUNCE_MS = 180;
let preferenceSaveTimer = null;
let lastPreferenceSignature = '';

function persistPreferences() {
  const preferences = currentPreferences();
  if (!Object.keys(preferences).length) return;
  const signature = JSON.stringify(preferences);
  if (signature === lastPreferenceSignature) return;
  lastPreferenceSignature = signature;
  window.bridge.savePreferences(preferences);
}

function savePreferences() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = null;
  persistPreferences();
}

function schedulePreferenceSave() {
  clearTimeout(preferenceSaveTimer);
  preferenceSaveTimer = setTimeout(() => {
    preferenceSaveTimer = null;
    persistPreferences();
  }, PREFERENCE_SAVE_DEBOUNCE_MS);
}

window.addEventListener('beforeunload', () => {
  if (preferenceSaveTimer !== null) savePreferences();
});

function intervalMilliseconds() {
  return numberValue(controls.hours) * 3600000 + numberValue(controls.minutes) * 60000 +
    numberValue(controls.seconds) * 1000 + numberValue(controls.milliseconds);
}

function currentConfiguration() {
  return {
    action: 'configure',
    enabled: hotkeyArmed,
    hotkey_vk: hotkey.vk,
    hotkey_name: hotkey.name,
    interval_ms: intervalMilliseconds(),
    random_enabled: controls.randomEnabled.checked,
    random_ms: numberValue(controls.randomMilliseconds, 40),
    mouse_button: controls.mouseClick.value,
    click_type: controls.clickType.value,
    cps_cap: Math.max(1, numberValue(controls.cpsCap, 100)),
    emergency_vk: emergencyHotkey.vk,
    emergency_modifiers: emergencyHotkey.modifiers,
    emergency_keys: emergencyHotkey.keys,
    emergency_capture_active: capturingEmergencyHotkey,
    cursor_mode: controls.currentLocation.checked ? 'current' : 'picked',
    cursor_x: Number(controls.cursorX.value) || 0,
    cursor_y: Number(controls.cursorY.value) || 0,
    macro_enabled: $('macroEnabled').checked,
    macro_trigger_keys: macroTrigger.keys,
    macro_trigger_mode: $('macroTriggerMode').value,
    macro_trigger_capture_active: macroTriggerCaptureActive,
    macro_playback_speed: Number($('macroPlaybackSpeed').value) || 1,
    macro_start_delay_ms: Math.max(0, numberValue($('macroStartDelay'))),
    macro_loop_delay_ms: Math.max(0, numberValue($('macroLoopDelay'))),
    macro_restore_cursor: $('macroRestoreCursor').checked,
    macro_stop_on_input: $('macroStopOnInput').checked,
    macro_timing_variance: Math.max(0, numberValue($('macroTimingVariance'))),
    macro_control_capture_active: macroControlCaptureActive,
    macro_record_hotkey_keys: macroRecordHotkey.keys,
    macro_play_hotkey_keys: macroPlayHotkey.keys,
    macro_record_settings: macroCaptureSettings(),
    macro_repeat_mode: $('macroConstantRepeat').checked ? 'constant' : 'count',
    macro_repeat_count: Math.max(1, Math.floor(numberValue($('macroRepeatCount'), 3)))
  };
}

const CONFIGURATION_THROTTLE_MS = 16;
let configurationTimer = null;
let lastConfigurationSignature = '';

function dispatchConfiguration(force = false) {
  if (!backendReady) return;
  const configuration = currentConfiguration();
  const signature = JSON.stringify(configuration);
  if (!force && signature === lastConfigurationSignature) return;
  lastConfigurationSignature = signature;
  window.bridge.configure(configuration);
}

function sendConfiguration(force = false) {
  clearTimeout(configurationTimer);
  configurationTimer = null;
  dispatchConfiguration(force);
}

function scheduleConfiguration() {
  if (!backendReady || configurationTimer !== null) return;
  configurationTimer = setTimeout(() => {
    configurationTimer = null;
    dispatchConfiguration();
  }, CONFIGURATION_THROTTLE_MS);
}

function setRunning(value) {
  $('startButton').disabled = value;
  $('stopButton').disabled = !value;
}

function refreshButtonLabels() {
  $('startButton').textContent = `Start (${hotkey.shortName})`;
  $('stopButton').textContent = `Stop (${hotkey.shortName})`;
}

document.querySelectorAll('input').forEach(element => {
  element.addEventListener('input', () => { schedulePreferenceSave(); scheduleConfiguration(); });
  element.addEventListener('change', () => { savePreferences(); sendConfiguration(); });
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const visibleView = document.querySelector('.tool-view:not([hidden])');
    if (visibleView) visibleView.focus({ preventScroll: true });
  });
});
document.querySelectorAll('select').forEach(element => element.addEventListener('change', () => {
  savePreferences();
  sendConfiguration();
}));
controls.cpsCap.addEventListener('change', () => {
  controls.cpsCap.value = String(Math.max(1, numberValue(controls.cpsCap, 100)));
  savePreferences();
  sendConfiguration();
});

function stepCpsCap(amount) {
  const current = Math.max(1, numberValue(controls.cpsCap, 100));
  controls.cpsCap.value = String(Math.max(1, current + amount));
  savePreferences();
  updateCpsWarning();
  sendConfiguration();
}
$('cpsIncrease').addEventListener('click', () => stepCpsCap(1));
$('cpsDecrease').addEventListener('click', () => stepCpsCap(-1));

function updateCpsWarning() {
  const selected = Math.max(1, numberValue(controls.cpsCap, 100));
  const warningThreshold = 250;
  const tooHigh = selected > warningThreshold;
  $('cpsWarning').classList.toggle('high', tooHigh);
  $('cpsHint').textContent = tooHigh
    ? `A ${selected} CPS cap allows up to ${selected} real clicks each second. Click Interval will not silently lower it, but slower target apps may lag while processing those events.`
    : `The selected cap is the maximum rate; the click interval can make the actual rate lower. Rates above 250 CPS may overload slower target apps.`;
  $('cpsWarning').dataset.hint = $('cpsHint').textContent;
}
controls.cpsCap.addEventListener('input', updateCpsWarning);
controls.cpsCap.addEventListener('change', updateCpsWarning);
updateCpsWarning();
$('startButton').addEventListener('click', () => { sendConfiguration(); window.bridge.configure({ action: 'start' }); });
$('stopButton').addEventListener('click', () => window.bridge.configure({ action: 'stop' }));
$('hotkeyButton').addEventListener('click', () => {
  clearTimeout(mouseArmTimer);
  hotkeyArmed = false;
  sendConfiguration();
  window.bridge.openHotkeyWindow('start-stop');
});

window.bridge.onHotkeySelected(value => {
  if (!ownsTool('auto-clicker')) return;
  pendingHotkey = value;
  saveHotkeySelection();
});
window.bridge.onHotkeyWindowCancelled(payload => {
  if (payload.mode === 'start-stop' && !ownsTool('auto-clicker')) return;
  if (payload.mode?.startsWith('macro-') && !ownsTool('macro')) return;
  if (payload.mode === 'macro-trigger') {
    macroTriggerCaptureActive = false;
    sendConfiguration();
    return;
  }
  if (payload.mode === 'macro-record' || payload.mode === 'macro-play') {
    macroControlCaptureActive = false;
    sendConfiguration();
    return;
  }
  if (payload.mode === 'emergency') capturingEmergencyHotkey = false;
  hotkeyArmed = true;
  sendConfiguration();
});

$('emergencyHotkey').textContent = emergencyHotkey.label;
$('recordButton').textContent = `Emergency Stop (${emergencyHotkey.label})`;
$('emergencyHotkey').addEventListener('click', () => {
  capturingEmergencyHotkey = true;
  hotkeyArmed = false;
  sendConfiguration();
  window.bridge.openHotkeyWindow('emergency');
});

window.bridge.onEmergencyHotkeySelected(value => {
  emergencyHotkey = value;
  capturingEmergencyHotkey = false;
  hotkeyArmed = true;
  $('emergencyHotkey').textContent = emergencyHotkey.label;
  $('recordButton').textContent = `Emergency Stop (${emergencyHotkey.label})`;
  savePreferences();
  sendConfiguration();
});

function showTool(name) {
  if (initialWindowContext.role === 'detached' && name !== initialWindowContext.tool) return;
  if (initialWindowContext.role === 'main') {
    if (toolLayout.detachedTool === name) return;
    if (toolLayout.lockedTool && toolLayout.lockedTool !== name) return;
    window.bridge.setActiveTool(name);
  }
  const showMacro = name === 'macro';
  $('appMain').hidden = showMacro;
  $('macroView').hidden = !showMacro;
  $('showAutoClicker').classList.toggle('active', !showMacro);
  $('showMacro').classList.toggle('active', showMacro);
  $('showAutoClicker').setAttribute('aria-pressed', String(!showMacro));
  $('showMacro').setAttribute('aria-pressed', String(showMacro));
}

function visibleTool() {
  return $('macroView').hidden ? 'auto-clicker' : 'macro';
}

$('showAutoClicker').addEventListener('click', async () => {
  if (visibleTool() === 'auto-clicker') return;
  if (activeMacroPanel !== 'home' && hasUnsavedMacroChanges() && !await confirmMacroExit()) return;
  showTool('auto-clicker');
});
$('showMacro').addEventListener('click', async () => {
  if (visibleTool() === 'macro') return;
  showTool('macro');
  if (activeMacroPanel === 'home') refreshMacroLibraryFromDisk();
});
for (const [id, tool] of [['showAutoClicker', 'auto-clicker'], ['showMacro', 'macro']]) {
  $(id).addEventListener('contextmenu', event => {
    event.preventDefault();
    if (initialWindowContext.role !== 'main') return;
    const isLocked = toolLayout.lockedTool === tool;
    window.bridge.openCustomDropdown({
      id: `toolContext:${tool}`,
      x: event.clientX,
      y: event.clientY,
      height: 0,
      anchorWidth: 0,
      width: 178,
      value: '',
      options: [
        {
          value: isLocked ? 'unlock' : 'lock',
          label: isLocked ? 'Unlock tab' : 'Lock tab',
          icon: isLocked ? 'unlock' : 'lock',
          disabled: toolLayout.activeMainTool !== tool
        },
        { separator: true },
        {
          value: 'detach',
          label: 'Open in new window',
          icon: 'external',
          disabled: toolLayout.detachedTool !== null
        }
      ]
    });
  });
}

function applyToolLayout(state) {
  toolLayout = { ...toolLayout, ...state };
  if (initialWindowContext.role === 'detached') {
    document.body.classList.add('detached-tool-window');
    $('showAutoClicker').hidden = true;
    $('showMacro').hidden = true;
    document.querySelector('.tool-switcher').hidden = true;
    showTool(initialWindowContext.tool);
    return;
  }
  $('showAutoClicker').hidden = toolLayout.detachedTool === 'auto-clicker';
  $('showMacro').hidden = toolLayout.detachedTool === 'macro';
  const visibleTool = toolLayout.detachedTool === toolLayout.activeMainTool
    ? (toolLayout.activeMainTool === 'macro' ? 'auto-clicker' : 'macro')
    : toolLayout.activeMainTool;
  showTool(visibleTool);
  $('showAutoClicker').classList.toggle('locked', toolLayout.lockedTool === 'auto-clicker');
  $('showMacro').classList.toggle('locked', toolLayout.lockedTool === 'macro');
  $('showAutoClicker').removeAttribute('title');
  $('showMacro').removeAttribute('title');
  $('showAutoClicker').dataset.hint = toolLayout.lockedTool === 'auto-clicker' ? 'Locked — right-click to unlock' : 'Right-click for tab options';
  $('showMacro').dataset.hint = toolLayout.lockedTool === 'macro' ? 'Locked — right-click to unlock' : 'Right-click for tab options';
  sendConfiguration();
}
window.bridge.onToolLayoutState(applyToolLayout);

function showMacroPanel(name) {
  activeMacroPanel = name;
  $('macroHomePanel').hidden = name !== 'home';
  $('macroRecorderPanel').hidden = name !== 'recorder';
  $('macroAdvancedPanel').hidden = name !== 'advanced';
  $('macroSmartPanel').hidden = name !== 'smart';
  $('macroActionEditorPanel').hidden = name !== 'action-editor';
  if (name === 'home') refreshMacroLibraryFromDisk();
  updateSmartActivationStatus();
}

function selectedMacro() {
  return macroLibrary.macros.find(item => item.id === macroLibrary.selectedId) || null;
}

function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (!value) return '';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function macroSettingsSnapshot() {
  return {
    trigger: macroTrigger,
    triggerMode: $('macroTriggerMode').value,
    enabled: $('macroEnabled').checked,
    capture: macroCaptureSettings(),
    playback: {
      repeatMode: $('macroConstantRepeat').checked ? 'constant' : 'count',
      repeatCount: Math.max(1, Math.floor(numberValue($('macroRepeatCount'), 3))),
      speed: Number($('macroPlaybackSpeed').value) || 1,
      minimize: $('macroMinimizeOnPlay').checked,
      startDelay: Math.max(0, numberValue($('macroStartDelay'))),
      loopDelay: Math.max(0, numberValue($('macroLoopDelay'))),
      restoreCursor: $('macroRestoreCursor').checked,
      stopOnInput: $('macroStopOnInput').checked,
      timingVariance: Math.max(0, numberValue($('macroTimingVariance')))
    },
    shortcuts: { record: macroRecordHotkey, play: macroPlayHotkey }
  };
}

function persistMacroLibrary() {
  window.bridge.saveMacroLibrary(macroLibrary);
}

function macroDocumentSnapshot(macro = selectedMacro()) {
  if (!macro) return null;
  return structuredClone({
    name: macro.name,
    actions: Array.isArray(macro.actions) ? macro.actions : [],
    settings: macro.settings || {},
    filePath: macro.filePath || ''
  });
}

function liveMacroDocumentSnapshot() {
  const macro = selectedMacro();
  if (!macro) return null;
  return structuredClone({
    name: macro.name,
    actions: macroActions,
    settings: macroSettingsSnapshot(),
    filePath: macroFilePath || ''
  });
}

function hasUnsavedMacroChanges() {
  const changed = JSON.stringify(liveMacroDocumentSnapshot()) !== JSON.stringify(macroSavedSnapshot);
  if (macroDirty !== changed) setMacroDirty(changed);
  return changed;
}

function updateMacroHeaderStatus() {
  $('macroActionCount').textContent = `${macroActions.length} action${macroActions.length === 1 ? '' : 's'}`;
  const fileName = macroFilePath ? macroFilePath.split(/[\\/]/).pop() : 'Not saved';
  const diskSize = formatFileSize(selectedMacro()?.fileSize);
  const savedStatus = diskSize ? `${fileName} • ${diskSize}` : fileName;
  $('macroFileName').textContent = macroDirty && macroFilePath ? `${savedStatus} • Unsaved changes` : savedStatus;
  $('macroSave').classList.toggle('dirty', macroDirty);
}

function setMacroDirty(value) {
  macroDirty = Boolean(value);
  updateMacroHeaderStatus();
}

function persistSelectedMacro(markDirty = true) {
  const macro = selectedMacro();
  if (!macro) return;
  macro.actions = macroActions;
  macro.settings = macroSettingsSnapshot();
  macro.filePath = macroFilePath;
  macro.updatedAt = new Date().toISOString();
  persistMacroLibrary();
  if (markDirty) setMacroDirty(true);
}

const editableMacroActionTypes = new Set([
  'screen_trigger', 'flow_trigger', 'wait', 'move', 'move_path',
  'mouse_down', 'mouse_up', 'key_down', 'key_up',
  'wait_until_relation', 'find_color_click', 'auto_clicker_control', 'label', 'goto'
]);

function normalizeActionArea(area) {
  return {
    x: Math.round(Number(area?.x) || 0),
    y: Math.round(Number(area?.y) || 0),
    width: Math.min(8192, Math.max(1, Math.round(Number(area?.width) || 500))),
    height: Math.min(4320, Math.max(1, Math.round(Number(area?.height) || 120)))
  };
}

function normalizeEditableMacroAction(action) {
  if (!action || typeof action !== 'object' || !editableMacroActionTypes.has(action.type)) return null;
  const normalized = structuredClone(action);
  if (normalized.type === 'screen_trigger') {
    normalized.config = normalized.config && typeof normalized.config === 'object' ? normalized.config : {};
    if (!['visual', 'pixel', 'zone', 'bar', 'screen'].includes(normalized.config.kind)) return null;
    normalized.config.color = /^#[0-9a-f]{6}$/i.test(normalized.config.color || '') ? normalized.config.color.toLowerCase() : '#ff0000';
    normalized.config.colorTolerance = Math.min(120, Math.max(1, Number(normalized.config.colorTolerance) || 25));
    normalized.config.colorCoverage = Math.min(100, Math.max(0, Number(normalized.config.colorCoverage) || 0.1));
    normalized.config.changeThreshold = Math.min(100, Math.max(0.1, Number(normalized.config.changeThreshold) || 10));
    normalized.config.scanInterval = Math.min(1000, Math.max(16, Number(normalized.config.scanInterval) || 33));
    normalized.config.cooldown = Math.min(600000, Math.max(0, Number(normalized.config.cooldown) || 0));
    normalized.config.areaMode = ['full', 'center', 'custom'].includes(normalized.config.areaMode) ? normalized.config.areaMode : 'custom';
    normalized.config.area = normalizeActionArea(normalized.config.area);
  } else if (normalized.type === 'flow_trigger') {
    normalized.config = normalized.config && typeof normalized.config === 'object' ? normalized.config : {};
    normalized.config.kind = 'relation';
    if (!['target_right', 'target_left', 'target_inside', 'target_right_of_center', 'target_left_of_center', 'target_centered', 'tracking_lost'].includes(normalized.config.condition)) normalized.config.condition = 'target_right';
    normalized.config.relationBoundaryColor = /^#[0-9a-f]{6}$/i.test(normalized.config.relationBoundaryColor || '') ? normalized.config.relationBoundaryColor : '#ffffff';
    normalized.config.relationTargetColor = /^#[0-9a-f]{6}$/i.test(normalized.config.relationTargetColor || '') ? normalized.config.relationTargetColor : '#ff0000';
    normalized.config.relationTolerance = Math.min(120, Math.max(1, Number(normalized.config.relationTolerance) || 35));
    normalized.config.relationEdgeMargin = Math.min(100, Math.max(0, Number(normalized.config.relationEdgeMargin) || 0));
    normalized.config.areaMode = 'custom';
    normalized.config.area = {
      x: Number(normalized.config.area?.x) || 0,
      y: Number(normalized.config.area?.y) || 0,
      width: Math.max(3, Number(normalized.config.area?.width) || 500),
      height: Math.max(3, Number(normalized.config.area?.height) || 120)
    };
  } else if (normalized.type === 'wait') {
    normalized.ms = Math.max(0, Number(normalized.ms) || 0);
  } else if (normalized.type === 'move') {
    normalized.x = Number(normalized.x) || 0;
    normalized.y = Number(normalized.y) || 0;
    normalized.relative = Boolean(normalized.relative);
  } else if (normalized.type === 'move_path') {
    normalized.points = Array.isArray(normalized.points) ? normalized.points : [];
  } else if (normalized.type === 'mouse_down' || normalized.type === 'mouse_up') {
    if (!['Left', 'Right', 'Middle', 'MB4', 'MB5'].includes(normalized.button)) normalized.button = 'Left';
  } else if (normalized.type === 'key_down' || normalized.type === 'key_up') {
    const vk = Number(normalized.vk);
    normalized.vk = Number.isInteger(vk) && vk >= 1 && vk <= 255 ? vk : 65;
  } else if (normalized.type === 'wait_until_relation') {
    normalized.config = normalized.config && typeof normalized.config === 'object' ? normalized.config : {};
    normalized.config.boundaryColor = /^#[0-9a-f]{6}$/i.test(normalized.config.boundaryColor || '') ? normalized.config.boundaryColor.toLowerCase() : '#ffffff';
    normalized.config.targetColor = /^#[0-9a-f]{6}$/i.test(normalized.config.targetColor || '') ? normalized.config.targetColor.toLowerCase() : '#00ff00';
    if (!['target_inside', 'target_right', 'target_left', 'target_centered', 'colors_visible', 'tracking_lost'].includes(normalized.config.condition)) normalized.config.condition = 'target_inside';
    normalized.config.tolerance = Math.min(120, Math.max(1, Number(normalized.config.tolerance) || 20));
    normalized.config.margin = Math.min(100, Math.max(0, Number(normalized.config.margin) || 3));
    normalized.config.pollMs = Math.min(1000, Math.max(16, Number(normalized.config.pollMs) || 33));
    normalized.config.timeoutMs = Math.min(600000, Math.max(0, Number(normalized.config.timeoutMs) || 0));
    normalized.config.area = normalizeActionArea(normalized.config.area);
  } else if (normalized.type === 'find_color_click') {
    normalized.color = /^#[0-9a-f]{6}$/i.test(normalized.color || '') ? normalized.color.toLowerCase() : '#ffffff';
    normalized.tolerance = Math.min(120, Math.max(1, Number(normalized.tolerance) || 20));
    normalized.minimumPixels = Math.min(100000, Math.max(1, Number(normalized.minimumPixels) || 20));
    normalized.pollMs = Math.min(1000, Math.max(16, Number(normalized.pollMs) || 33));
    normalized.timeoutMs = Math.min(600000, Math.max(0, Number(normalized.timeoutMs) || 0));
    normalized.button = ['Left', 'Right', 'Middle'].includes(normalized.button) ? normalized.button : 'Left';
    normalized.area = normalizeActionArea(normalized.area);
  } else if (normalized.type === 'label' || normalized.type === 'goto') {
    normalized.name = String(normalized.name || 'Phase').trim().slice(0, 40) || 'Phase';
  } else if (normalized.type === 'auto_clicker_control') {
    normalized.operation = ['start', 'stop', 'toggle'].includes(normalized.operation) ? normalized.operation : 'toggle';
  }
  return normalized;
}

function invalidActionLabel(action) {
  return action && typeof action.type === 'string' && action.type.trim() ? action.type : 'unknown action';
}

function applyMacroSettings(macro) {
  if (!macro) return;
  macroFilePath = typeof macro.filePath === 'string' ? macro.filePath : '';
  const loadedActions = Array.isArray(macro.actions) ? macro.actions : [];
  const normalizedActions = loadedActions.map(normalizeEditableMacroAction);
  const invalidActions = loadedActions.filter((action, index) => normalizedActions[index] === null);
  macroActions = normalizedActions.filter(action => action !== null);
  macro.actions = macroActions;
  const settings = macro.settings || {};
  smartActivation = createTriggerDraft();
  if (settings.smartActivation?.enabled && !macroActions.some(action => action.type === 'screen_trigger')) {
    macroActions.unshift({ type: 'screen_trigger', config: { ...structuredClone(settings.smartActivation), id: crypto.randomUUID(), enabled: true } });
  }
  macroActions.forEach(action => {
    if (['screen_trigger', 'flow_trigger'].includes(action.type) && !action.config?.id) action.config = { ...(action.config || {}), id: crypto.randomUUID(), enabled: true };
  });
  applySmartActivationControls();
  if (settings.trigger && Array.isArray(settings.trigger.keys)) macroTrigger = settings.trigger;
  $('macroTriggerKey').textContent = macroTrigger.label;
  if (['Pressed', 'Hold', 'Toggle'].includes(settings.triggerMode)) $('macroTriggerMode').value = settings.triggerMode;
  if (typeof settings.enabled === 'boolean') $('macroEnabled').checked = settings.enabled;
  const capture = settings.capture || {};
  if (settings.capture) {
    $('captureMovement').checked = capture.mouse_movement !== false;
    $('captureButtons').checked = capture.mouse_buttons !== false;
    $('captureKeyboard').checked = capture.keyboard !== false;
    $('captureDelays').checked = capture.delays !== false;
    $('macroRelative').checked = capture.position_mode === 'relative';
    $('macroAbsolute').checked = capture.position_mode !== 'relative';
    if (['compact', 'balanced', 'smooth', 'ultra'].includes(capture.quality)) $('macroRecordingQuality').value = capture.quality;
  }
  const playback = settings.playback || {};
  if (settings.playback) {
    const constant = playback.repeatMode === 'constant' || (playback.repeat === true && Number(playback.repeatCount) === 0);
    $('macroConstantRepeat').checked = constant;
    $('macroRepeatCountMode').checked = !constant;
    $('macroRepeatCount').value = String(Math.max(1, Number(playback.repeatCount) || 3));
    $('macroRepeatCount').disabled = constant;
    const speed = String(Number(playback.speed) || 1);
    if ([...$('macroPlaybackSpeed').options].some(option => option.value === speed)) $('macroPlaybackSpeed').value = speed;
    $('macroMinimizeOnPlay').checked = playback.minimize !== false;
    const startDelay = String(Math.max(0, Number(playback.startDelay) || 0));
    if ([...$('macroStartDelay').options].some(option => option.value === startDelay)) $('macroStartDelay').value = startDelay;
    $('macroLoopDelay').value = String(Math.max(0, Number(playback.loopDelay) || 0));
    $('macroRestoreCursor').checked = Boolean(playback.restoreCursor);
    $('macroStopOnInput').checked = Boolean(playback.stopOnInput);
    const timingVariance = String(Math.max(0, Number(playback.timingVariance) || 0));
    if ([...$('macroTimingVariance').options].some(option => option.value === timingVariance)) $('macroTimingVariance').value = timingVariance;
  }
  if (settings.shortcuts?.record && Array.isArray(settings.shortcuts.record.keys)) macroRecordHotkey = settings.shortcuts.record;
  if (settings.shortcuts?.play && Array.isArray(settings.shortcuts.play.keys)) macroPlayHotkey = settings.shortcuts.play;
  $('macroRecordHotkey').textContent = `Record / Stop: ${macroRecordHotkey.label}`;
  $('macroPlayHotkey').textContent = `Play / Stop: ${macroPlayHotkey.label}`;
  refreshCustomDropdowns();
  $('macroRecorderTitle').textContent = macro.name;
  renderMacroActions();
  window.bridge.configure({ action: 'macro_set_actions', actions: playbackMacroActions() });
  savePreferences();
  sendConfiguration();
  macro.settings = macroSettingsSnapshot();
  macroSavedSnapshot = liveMacroDocumentSnapshot();
  setMacroDirty(false);
  if (invalidActions.length) {
    const removedTypes = [...new Set(invalidActions.map(invalidActionLabel))].join(', ');
    if (macroFilePath) {
      window.bridge.saveMacroFile({
        id: macro.id,
        name: macro.name,
        actions: macroActions,
        settings: macro.settings || {},
        filePath: macroFilePath
      }).then(saved => {
        macro.filePath = saved.filePath;
        macro.fileSize = Number(saved.fileSize) || macro.fileSize || 0;
        macroFilePath = saved.filePath;
        persistMacroLibrary();
      }).catch(() => {});
    }
    setTimeout(() => showMessage(
      'Invalid actions removed',
      `${invalidActions.length} action${invalidActions.length === 1 ? ' was' : 's were'} removed from ${macro.name} because ${invalidActions.length === 1 ? 'it has' : 'they have'} no valid settings editor: ${removedTypes}.`,
      'alert'
    ), 0);
  }
}

async function selectMacro(id) {
  if (!macroLibrary.macros.some(item => item.id === id)) return false;
  if (id === macroLibrary.selectedId) {
    applyMacroSettings(selectedMacro());
    selectedMacro().lastUsedAt = new Date().toISOString();
    persistMacroLibrary();
    renderMacroLibrary();
    return true;
  }
  if (hasUnsavedMacroChanges()) {
    showMessage('Finish the current macro', 'Use the Back arrow to save or discard the current changes before opening another macro.', 'alert');
    return false;
  }
  if (selectedMacro()) persistSelectedMacro(false);
  macroLibrary.selectedId = id;
  applyMacroSettings(selectedMacro());
  selectedMacro().lastUsedAt = new Date().toISOString();
  persistMacroLibrary();
  renderMacroLibrary();
  return true;
}

function renderMacroLibrary() {
  const list = $('macroLibraryList');
  const advanced = $('advancedMacroSelect');
  list.replaceChildren();
  advanced.replaceChildren();
  const orderedMacros = [...macroLibrary.macros].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
    if (left.pinned && right.pinned) return String(left.pinnedAt || '').localeCompare(String(right.pinnedAt || ''));
    const recent = String(right.lastUsedAt || right.updatedAt || '').localeCompare(String(left.lastUsedAt || left.updatedAt || ''));
    return recent || left.name.localeCompare(right.name);
  });
  orderedMacros.forEach(macro => {
    const row = document.createElement('div');
    row.className = 'macro-library-row';
    row.dataset.id = macro.id;
    row.setAttribute('role', 'listitem');
    const name = document.createElement('span');
    name.className = 'macro-library-name';
    if (macro.pinned) {
      const pin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pin.setAttribute('viewBox', '0 0 16 16');
      pin.setAttribute('aria-hidden', 'true');
      pin.classList.add('macro-pin-icon');
      pin.innerHTML = '<path d="M5 2.5h6l-1.2 3 2.2 2.2v1H8.8V14L8 15l-.8-1V8.7H4v-1l2.2-2.2z"/>';
      name.append(pin);
    }
    name.append(document.createTextNode(macro.name));
    name.dataset.hint = `Open ${macro.name}`;
    const size = document.createElement('span');
    size.className = 'macro-library-size';
    size.textContent = formatFileSize(macro.fileSize);
    size.dataset.hint = size.textContent ? `${macro.name} uses ${size.textContent}` : '';
    const rename = document.createElement('button');
    rename.className = 'macro-row-icon rename';
    rename.type = 'button';
    rename.setAttribute('aria-label', `Rename ${macro.name}`);
    rename.dataset.hint = 'Rename macro';
    rename.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.2-1 10.4-10.4-3.2-3.2L5 15.8z"/><path d="M13.9 6.9l3.2 3.2"/></svg>';
    const remove = document.createElement('button');
    remove.className = 'macro-row-icon delete';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${macro.name}`);
    remove.dataset.hint = 'Delete macro';
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg>';
    row.append(name, size, rename, remove);
    row.addEventListener('click', async event => {
      if (event.target.closest('button')) return;
      if (await selectMacro(macro.id)) showMacroPanel('recorder');
    });
    row.addEventListener('contextmenu', event => {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      window.bridge.openCustomDropdown({
        id: `macroContext:${macro.id}`,
        x: event.clientX,
        y: event.clientY,
        height: 0,
        anchorWidth: 0,
        width: 128,
        value: '',
        options: [{ value: macro.pinned ? 'unpin' : 'pin', label: macro.pinned ? 'Unpin macro' : 'Pin macro', icon: macro.pinned ? 'unpin' : 'pin' }]
      });
    });
    rename.addEventListener('click', () => window.bridge.openMacroNameWindow({ mode: 'rename', id: macro.id, name: macro.name }));
    remove.addEventListener('click', () => window.bridge.openMacroDeleteWindow({ id: macro.id, name: macro.name, filePath: macro.filePath || '' }));
    list.appendChild(row);
    const advancedOption = document.createElement('option');
    advancedOption.value = macro.id;
    advancedOption.textContent = macro.name;
    advancedOption.selected = macro.id === macroLibrary.selectedId;
    advanced.appendChild(advancedOption);
  });
  $('macroEmptyState').hidden = macroLibrary.macros.length > 0;
}

function toggleMacroPin(id, action) {
  const macro = macroLibrary.macros.find(item => item.id === id);
  if (!macro) return;
  if (action === 'pin' && !macro.pinned) {
    if (macroLibrary.macros.filter(item => item.pinned).length >= 3) {
      showMessage('Pin limit reached', 'You can pin up to three macros. Unpin one before pinning another.', 'alert');
      return;
    }
    macro.pinned = true;
    macro.pinnedAt = new Date().toISOString();
  } else if (action === 'unpin') {
    macro.pinned = false;
    macro.pinnedAt = '';
  } else return;
  persistMacroLibrary();
  renderMacroLibrary();
}

function refreshMacroLibraryFromDisk() {
  if (macroDirty) return;
  const refreshed = window.bridge.loadMacroLibrary() || { version: 2, selectedId: null, macros: [] };
  macroLibrary = {
    version: Number(refreshed.version) || 2,
    selectedId: refreshed.selectedId || null,
    macros: Array.isArray(refreshed.macros) ? refreshed.macros : []
  };
  if (!macroLibrary.macros.some(item => item.id === macroLibrary.selectedId)) {
    macroLibrary.selectedId = macroLibrary.macros[0]?.id || null;
  }
  renderMacroLibrary();
  if (selectedMacro()) applyMacroSettings(selectedMacro());
  else {
    macroActions = [];
    macroFilePath = '';
    renderMacroActions();
  }
}

function macroCaptureSettings() {
  return {
    mouse_movement: $('captureMovement').checked,
    mouse_buttons: $('captureButtons').checked,
    keyboard: $('captureKeyboard').checked,
    delays: $('captureDelays').checked,
    position_mode: $('macroRelative').checked ? 'relative' : 'absolute',
    quality: $('macroRecordingQuality').value
  };
}

function actionDescription(action, index) {
  const prefix = `${index + 1}. `;
  if (action.type === 'screen_trigger' || action.type === 'flow_trigger') {
    const names = { relation: 'Color Relation', visual: 'Color Presence', pixel: 'Pixel Color', zone: 'Color Zone', bar: 'Bar Fill', screen: 'Screen Change' };
    const conditions = {
      above: 'color rises above limit', below: 'color falls below limit',
      changes: 'region changes', still: 'region becomes still'
    };
    const condition = conditions[action.config?.condition] || String(action.config?.condition || '').replaceAll('_', ' ');
    const shownKind = action.config?.displayKind || action.config?.kind;
    const shownCondition = shownKind === 'pixel'
      ? (action.config?.condition === 'below' ? 'pixel stops matching' : 'pixel matches color')
      : shownKind === 'zone'
        ? (action.config?.condition === 'below' ? 'color is absent' : 'color is present')
        : shownKind === 'bar'
          ? (action.config?.condition === 'below' ? 'fill is below level' : 'fill is at or above level')
          : condition;
    if (shownKind === 'relation') {
      const relationNames = { target_right: 'target is right', target_left: 'target is left', target_inside: 'target is inside', target_right_of_center: 'target is right of center', target_left_of_center: 'target is left of center', target_centered: 'target is centered', tracking_lost: 'colors are missing' };
      return `${prefix}Trigger next action when ${relationNames[action.config?.condition] || 'colors match relation'}`;
    }
    return `${prefix}Trigger: ${names[shownKind] || 'Screen Trigger'}${shownCondition ? ` — ${shownCondition}` : ''}`;
  }
  if (action.type === 'wait') return `${prefix}Wait ${action.ms} ms`;
  if (action.type === 'wait_until_relation') return `${prefix}Wait until ${String(action.config?.condition || 'color relation').replaceAll('_', ' ')}`;
  if (action.type === 'find_color_click') return `${prefix}Find ${action.color || '#ffffff'} and click`;
  if (action.type === 'auto_clicker_control') return `${prefix}${action.operation === 'start' ? 'Start' : action.operation === 'stop' ? 'Stop' : 'Toggle'} auto clicker`;
  if (action.type === 'label') return `${prefix}Label: ${action.name}`;
  if (action.type === 'goto') return `${prefix}Go to: ${action.name}`;
  if (action.type === 'move') return `${prefix}Move ${action.relative ? 'by' : 'to'} ${action.x}, ${action.y}`;
  if (action.type === 'move_path') return `${prefix}Mouse path (${Array.isArray(action.points) ? action.points.length : 0} points)`;
  if (action.type === 'mouse_down') return `${prefix}${action.button} mouse down`;
  if (action.type === 'mouse_up') return `${prefix}${action.button} mouse up`;
  if (action.type === 'key_down') return `${prefix}Key ${action.vk} down`;
  if (action.type === 'key_up') return `${prefix}Key ${action.vk} up`;
  return `${prefix}${action.type || 'Unknown action'}`;
}

function renderMacroActions(selectedIndex = -1) {
  const list = $('macroActionList');
  list.replaceChildren();
  macroActions.forEach((action, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = actionDescription(action, index);
    option.classList.toggle('trigger-action', ['screen_trigger', 'flow_trigger'].includes(action.type));
    list.appendChild(option);
  });
  if (selectedIndex >= 0 && selectedIndex < macroActions.length) list.value = String(selectedIndex);
  updateMacroHeaderStatus();
  updateActionToolbarState();
}

function syncMacroActions(selectedIndex = -1) {
  renderMacroActions(selectedIndex);
  persistSelectedMacro();
  renderMacroLibrary();
  window.bridge.configure({ action: 'macro_set_actions', actions: playbackMacroActions() });
}

function playbackMacroActions() {
  return macroActions;
}

function addConfiguredTriggerAction() {
  syncSmartActivationFromControls();
  const config = structuredClone(smartActivation);
  if (['pixel', 'zone', 'bar'].includes(config.kind)) {
    config.displayKind = config.kind;
    config.kind = 'visual';
  }
  if (config.displayKind === 'pixel') {
    config.areaMode = 'custom';
    config.area.width = 1;
    config.area.height = 1;
    config.colorCoverage = 0.1;
  }
  const actionType = config.kind === 'relation' ? 'flow_trigger' : 'screen_trigger';
  const action = {
    type: actionType,
    config: {
      ...config,
      id: macroActions[editingActionIndex]?.config?.id || crypto.randomUUID(),
      enabled: true
    }
  };
  if (editingActionIndex >= 0 && macroActions[editingActionIndex]?.type === actionType) {
    macroActions[editingActionIndex] = action;
    syncMacroActions(editingActionIndex);
  } else {
    macroActions.push(action);
    syncMacroActions(macroActions.length - 1);
  }
  editingActionIndex = -1;
  showMacroPanel('advanced');
}

function setMacroStatus() {}

function setRecordButton(recording) {
  macroIsRecording = recording;
  $('macroRecord').innerHTML = recording
    ? '<span class="stop-square"></span><span>Stop recording</span>'
    : '<span class="record-dot"></span><span>Record</span>';
  $('macroRecord').classList.toggle('recording', recording);
}

function setPlayButton(playing) {
  macroIsPlaying = playing;
  $('macroPlay').innerHTML = playing
    ? '<span class="stop-square"></span><span>Stop playback</span>'
    : '<span class="play-triangle"></span><span>Play</span>';
  $('macroPlay').classList.toggle('playing', playing);
}

$('macroRecord').addEventListener('click', () => {
  if (macroIsRecording) {
    window.bridge.configure({ action: 'macro_record_stop' });
    return;
  }
  savePreferences();
  persistSelectedMacro(false);
  window.bridge.configure({ action: 'macro_record_start', settings: macroCaptureSettings() });
  setMacroStatus('Starting...', 'recording');
});

function playCurrentMacro() {
  if (macroIsPlaying) {
    window.bridge.configure({ action: 'macro_stop' });
    return;
  }
  const actionsToPlay = playbackMacroActions();
  if (!actionsToPlay.length) {
    showMessage('Nothing to play', 'Record, import, or add at least one action first.', 'alert');
    return;
  }
  const macro = selectedMacro();
  if (macro) {
    macro.lastUsedAt = new Date().toISOString();
    persistMacroLibrary();
  }
  const constantRepeat = $('macroConstantRepeat').checked;
  const repeatCount = constantRepeat ? 0 : Math.max(1, Math.floor(numberValue($('macroRepeatCount'), 3)));
  const minimizeBeforePlayback = $('macroMinimizeOnPlay').checked;
  const selectedStartDelay = Math.max(0, numberValue($('macroStartDelay')));
  window.bridge.configure({ action: 'macro_set_actions', actions: actionsToPlay });
  window.bridge.configure({
    action: 'macro_play',
    repeat: constantRepeat || repeatCount > 1,
    repeat_count: repeatCount,
    speed: Number($('macroPlaybackSpeed').value) || 1,
    start_delay_ms: Math.max(selectedStartDelay, minimizeBeforePlayback ? 600 : 0),
    loop_delay_ms: Math.max(0, numberValue($('macroLoopDelay'))),
    restore_cursor: $('macroRestoreCursor').checked,
    stop_on_input: $('macroStopOnInput').checked,
    timing_variance: Math.max(0, numberValue($('macroTimingVariance')))
  });
}
$('macroPlay').addEventListener('click', playCurrentMacro);

function smartActivationFromControls() {
  const threshold = Number($('smartThreshold').value);
  const color = /^#[0-9a-f]{6}$/i.test($('triggerColor').value.trim()) ? $('triggerColor').value.trim().toLowerCase() : '#ff0000';
  const colorKinds = ['visual', 'pixel', 'zone', 'bar'];
  return {
    ...smartActivation,
    condition: $('smartCondition').value,
    color,
    colorTolerance: colorKinds.includes(smartActivation.kind) ? Math.max(1, threshold || 30) : smartActivation.colorTolerance,
    colorCoverage: colorKinds.includes(smartActivation.kind) ? Math.max(0.1, Number($('triggerCoverage').value) || 5) : smartActivation.colorCoverage,
    changeThreshold: smartActivation.kind === 'screen' ? Math.max(1, threshold || 10) : smartActivation.changeThreshold,
    relationBoundaryColor: /^#[0-9a-f]{6}$/i.test($('relationBoundaryColor').value.trim()) ? $('relationBoundaryColor').value.trim().toLowerCase() : '#ffffff',
    relationTargetColor: /^#[0-9a-f]{6}$/i.test($('relationTargetColor').value.trim()) ? $('relationTargetColor').value.trim().toLowerCase() : '#ff0000',
    relationTolerance: Math.min(120, Math.max(1, Math.round(numberValue($('relationTolerance'), 35)))),
    relationEdgeMargin: Math.min(100, Math.max(0, Math.round(numberValue($('relationEdgeMargin'), 3)))),
    scanInterval: smartActivation.kind === 'relation' ? 16 : Math.max(16, Number($('smartScanInterval').value) || 33),
    cooldown: smartActivation.kind === 'relation' ? 0 : Math.max(0, Math.floor(numberValue($('smartCooldown'), 1500))),
    areaMode: ['full', 'center', 'custom'].includes($('smartAreaMode').value) ? $('smartAreaMode').value : 'full',
    area: {
      x: Math.floor(numberValue($('smartAreaX'))),
      y: Math.floor(numberValue($('smartAreaY'))),
      width: Math.max(1, Math.floor(numberValue($('smartAreaWidth'), 800))),
      height: Math.max(1, Math.floor(numberValue($('smartAreaHeight'), 600)))
    }
  };
}

function syncSmartActivationFromControls() {
  smartActivation = smartActivationFromControls();
  $('smartCustomArea').hidden = smartActivation.areaMode !== 'custom';
  $('triggerColorPreview').style.background = smartActivation.color;
  updateSmartActivationStatus();
}

function replaceSelectOptions(select, options, selectedValue) {
  select.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  select.value = String(selectedValue);
  if (!select.value && select.options.length) select.selectedIndex = 0;
}

function configureTriggerEditor(kind) {
  const colorKinds = ['visual', 'pixel', 'zone', 'bar'];
  smartActivation.kind = [...colorKinds, 'relation', 'screen'].includes(kind) ? kind : 'visual';
  const names = { relation: 'Color Relation', visual: 'Color Presence', pixel: 'Pixel Color', zone: 'Color Zone', bar: 'Bar Fill', screen: 'Screen Change' };
  $('triggerEditorTitle').textContent = names[smartActivation.kind];
  $('triggerSourceLegend').textContent = smartActivation.kind === 'relation' ? 'Colors to compare' : colorKinds.includes(smartActivation.kind) ? 'Target color' : 'Screen region';
  $('visualTriggerSource').hidden = !colorKinds.includes(smartActivation.kind);
  $('screenTriggerSource').hidden = smartActivation.kind !== 'screen';
  $('relationTriggerSource').hidden = smartActivation.kind !== 'relation';
  $('smartScanLabel').textContent = 'Scan every';
  $('smartCooldownLabel').textContent = 'Minimum interval';
  $('smartAddLegend').textContent = 'Add trigger';
  $('addTriggerAction').textContent = editingActionIndex >= 0 ? 'Save trigger' : 'Add trigger to actions';
  if (smartActivation.kind === 'relation') {
    replaceSelectOptions($('smartCondition'), [['target_right', 'Target is right of boundary'], ['target_left', 'Target is left of boundary'], ['target_inside', 'Target is inside boundary'], ['target_right_of_center', 'Target is right of center'], ['target_left_of_center', 'Target is left of center'], ['target_centered', 'Target is centered'], ['tracking_lost', 'Either color is missing']], smartActivation.condition);
    $('triggerThresholdLabel').textContent = 'Trigger behavior';
    replaceSelectOptions($('smartThreshold'), [['1', 'Gate next action']], 1);
    replaceSelectOptions($('smartScanInterval'), [['16', 'Every playback loop']], 16);
    $('smartCooldownLabel').textContent = 'No cooldown';
    smartActivation.areaMode = 'custom';
  } else if (colorKinds.includes(smartActivation.kind)) {
    const conditionOptions = smartActivation.kind === 'pixel'
      ? [['above', 'Pixel matches'], ['below', 'Pixel stops matching']]
      : smartActivation.kind === 'zone'
        ? [['above', 'Color is present'], ['below', 'Color is absent']]
        : smartActivation.kind === 'bar'
          ? [['above', 'Fill is at or above'], ['below', 'Fill is below']]
          : [['above', 'Amount rises above'], ['below', 'Amount falls below']];
    replaceSelectOptions($('smartCondition'), conditionOptions, smartActivation.condition);
    $('triggerThresholdLabel').textContent = 'Tolerance';
    replaceSelectOptions($('smartThreshold'), [['10', 'Strict'], ['25', 'Normal'], ['45', 'Loose'], ['70', 'Very loose']], smartActivation.colorTolerance);
    replaceSelectOptions($('smartScanInterval'), [['16', '16 ms'], ['33', '33 ms'], ['50', '50 ms'], ['100', '100 ms'], ['250', '250 ms']], smartActivation.scanInterval);
    const copy = {
      visual: ['Measure color coverage', 'Runs the next action while the selected color covers the chosen percentage of the search area.'],
      pixel: ['Watch one exact point', 'Runs the next action when the selected screen pixel matches, or stops matching, the chosen color.'],
      zone: ['Watch a color zone', 'Runs the next action while the selected color is present, or absent, in the search area.'],
      bar: ['Measure a colored bar', 'Finds the largest connected color run and compares its length with the selected fill percentage.']
    }[smartActivation.kind];
    $('triggerColorTitle').textContent = copy[0];
    $('triggerColorDescription').textContent = copy[1];
    $('triggerColorDescription').dataset.hint = copy[1];
    const coverageOptions = smartActivation.kind === 'pixel'
      ? [['0.1', 'Exact point']]
      : smartActivation.kind === 'zone'
        ? [['0.1', 'Any amount'], ['0.5', '0.5% area'], ['1', '1% area'], ['5', '5% area']]
        : smartActivation.kind === 'bar'
          ? [['10', '10% filled'], ['25', '25% filled'], ['50', '50% filled'], ['75', '75% filled'], ['90', '90% filled'], ['100', '100% filled']]
          : [['0.5', '0.5% area'], ['1', '1% area'], ['5', '5% area'], ['10', '10% area'], ['25', '25% area'], ['50', '50% area']];
    replaceSelectOptions($('triggerCoverage'), coverageOptions, smartActivation.colorCoverage);
    if (smartActivation.kind === 'pixel') {
      smartActivation.areaMode = 'custom';
      smartActivation.area.width = 1;
      smartActivation.area.height = 1;
    }
  } else {
    replaceSelectOptions($('smartCondition'), [['changes', 'Region changes'], ['still', 'Region becomes still']], smartActivation.condition);
    $('triggerThresholdLabel').textContent = 'Change level';
    replaceSelectOptions($('smartThreshold'), [['3', 'Slight'], ['8', 'Medium'], ['15', 'Large'], ['30', 'Major']], smartActivation.changeThreshold);
    replaceSelectOptions($('smartScanInterval'), [['16', '16 ms'], ['33', '33 ms'], ['50', '50 ms'], ['100', '100 ms'], ['250', '250 ms']], smartActivation.scanInterval);
  }
  smartActivation.condition = $('smartCondition').value;
  $('triggerColor').value = smartActivation.color || '#ff0000';
  $('triggerColorPreview').style.background = smartActivation.color || '#ff0000';
  $('relationBoundaryColor').value = smartActivation.relationBoundaryColor || '#ffffff';
  $('relationTargetColor').value = smartActivation.relationTargetColor || '#ff0000';
  $('relationTolerance').value = String(Math.max(1, Number(smartActivation.relationTolerance) || 35));
  $('relationEdgeMargin').value = String(Math.max(0, Number(smartActivation.relationEdgeMargin) || 3));
}

function updateSmartActivationStatus(status = null) {
  $('smartActivationState').textContent = editingActionIndex >= 0 ? 'Editing action' : 'New trigger';
  $('smartActivationState').classList.remove('watching', 'matched');
  if (smartActivation.kind === 'relation') $('smartMatchDetails').textContent = 'When the relation matches, the next action runs. Otherwise, the next action is skipped.';
  else $('smartMatchDetails').textContent = 'This trigger controls only the action immediately below it. Larger areas are automatically scanned more slowly to protect performance.';
}

function applySmartActivationControls() {
  configureTriggerEditor(smartActivation.kind);
  $('smartScanInterval').value = smartActivation.kind === 'relation' ? '16' : String(smartActivation.scanInterval || 33);
  if (!$('smartScanInterval').value && smartActivation.kind !== 'relation') $('smartScanInterval').value = '33';
  $('smartCooldown').value = String(Math.max(0, Number(smartActivation.cooldown) || 0));
  $('smartAreaMode').value = ['full', 'center', 'custom'].includes(smartActivation.areaMode) ? smartActivation.areaMode : 'full';
  $('smartAreaX').value = String(Number(smartActivation.area?.x) || 0);
  $('smartAreaY').value = String(Number(smartActivation.area?.y) || 0);
  $('smartAreaWidth').value = String(Math.max(1, Number(smartActivation.area?.width) || 800));
  $('smartAreaHeight').value = String(Math.max(1, Number(smartActivation.area?.height) || 600));
  $('smartCustomArea').hidden = $('smartAreaMode').value !== 'custom';
  updateSmartActivationStatus();
}

for (const id of ['smartCondition', 'smartThreshold', 'smartScanInterval', 'smartAreaMode', 'smartAreaX', 'smartAreaY', 'smartAreaWidth', 'smartAreaHeight', 'triggerColor', 'triggerCoverage', 'relationBoundaryColor', 'relationTargetColor', 'relationTolerance', 'relationEdgeMargin']) {
  $(id).addEventListener('change', () => {
    syncSmartActivationFromControls();
  });
}
$('smartCooldown').addEventListener('change', () => {
  $('smartCooldown').value = String(Math.max(0, Math.floor(numberValue($('smartCooldown'), 1500))));
  syncSmartActivationFromControls();
});

$('smartAreaMode').addEventListener('change', () => {
  $('smartCustomArea').hidden = $('smartAreaMode').value !== 'custom';
});

$('smartPickArea').hidden = !initialWindowContext.appVersion;
$('smartPickArea').addEventListener('click', async () => {
  let result;
  try {
    result = await window.bridge.pickSmartArea();
  } catch (_) {
    $('smartPickArea').dataset.hint = 'The selector will become available after the next full application update.';
    return;
  }
  if (!result || result.canceled) return;
  $('smartAreaMode').value = 'custom';
  $('smartAreaX').value = String(result.x);
  $('smartAreaY').value = String(result.y);
  $('smartAreaWidth').value = String(result.width);
  $('smartAreaHeight').value = String(result.height);
  $('smartCustomArea').hidden = false;
  syncSmartActivationFromControls();
});

$('triggerColor').addEventListener('input', () => {
  const value = $('triggerColor').value.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) $('triggerColorPreview').style.background = value;
});

$('addTriggerAction').addEventListener('click', addConfiguredTriggerAction);

$('createMacroButton').addEventListener('click', () => window.bridge.openMacroNameWindow({ mode: 'create' }));
window.bridge.onMacroNameCreated(async payload => {
  if (!ownsTool('macro')) return;
  const baseName = payload.name.trim().slice(0, 40) || 'My Macro';
  let uniqueName = baseName;
  let suffix = baseName === 'My Macro' ? 1 : 2;
  while (macroLibrary.macros.some(item => item.id !== payload.id && item.name.toLowerCase() === uniqueName.toLowerCase())) {
    const suffixText = baseName === 'My Macro' ? ` ${suffix++}` : ` (${suffix++})`;
    uniqueName = `${baseName.slice(0, 40 - suffixText.length)}${suffixText}`;
  }
  if (payload.mode === 'rename') {
    const macro = macroLibrary.macros.find(item => item.id === payload.id);
    if (!macro) return;
    macro.name = uniqueName;
    macro.updatedAt = new Date().toISOString();
    if (macro.id === macroLibrary.selectedId) $('macroRecorderTitle').textContent = uniqueName;
    try {
      const saved = await window.bridge.saveMacroFile({
        id: macro.id,
        name: macro.name,
        actions: macro.actions,
        settings: macro.settings,
        filePath: macro.filePath || ''
      });
      macro.filePath = saved.filePath;
      macro.fileSize = Number(saved.fileSize) || macro.fileSize || 0;
      if (macro.id === macroLibrary.selectedId) {
        macroFilePath = saved.filePath;
        macroSavedSnapshot = macroDocumentSnapshot(macro);
        setMacroDirty(false);
      }
    } catch (error) {
      showMessage('Rename failed', error.message || 'The renamed macro could not be saved.', 'alert');
      return;
    }
    persistMacroLibrary();
    renderMacroLibrary();
    return;
  }
  const now = new Date().toISOString();
  const macro = { id: crypto.randomUUID(), name: uniqueName, actions: [], settings: {}, createdAt: now, updatedAt: now, lastUsedAt: now, pinned: false, pinnedAt: '', filePath: '' };
  macroLibrary.macros.push(macro);
  macroLibrary.selectedId = macro.id;
  macroActions = [];
  macroFilePath = '';
  persistMacroLibrary();
  applyMacroSettings(macro);
  macroSavedSnapshot = null;
  setMacroDirty(true);
  showMacroPanel('recorder');
});

window.bridge.onMacroDeleteConfirmed(result => {
  if (!ownsTool('macro')) return;
  const id = result?.id;
  if (!result?.deleted) {
    showMessage('Delete failed', result?.message || 'The macro file could not be permanently deleted.', 'alert');
    return;
  }
  const index = macroLibrary.macros.findIndex(item => item.id === id);
  if (index < 0) return;
  macroLibrary.macros.splice(index, 1);
  macroLibrary.selectedId = macroLibrary.macros[Math.min(index, macroLibrary.macros.length - 1)]?.id || null;
  if (selectedMacro()) applyMacroSettings(selectedMacro());
  else {
    macroActions = [];
    macroFilePath = '';
    macroSavedSnapshot = null;
    setMacroDirty(false);
    window.bridge.configure({ action: 'macro_set_actions', actions: [] });
  }
  persistMacroLibrary();
  renderMacroLibrary();
});

function discardCurrentMacroChanges() {
  const macro = selectedMacro();
  if (!macro) return;
  if (!macroSavedSnapshot || !macroSavedSnapshot.filePath) {
    const index = macroLibrary.macros.findIndex(item => item.id === macro.id);
    macroLibrary.macros.splice(index, 1);
    macroLibrary.selectedId = macroLibrary.macros[Math.min(index, macroLibrary.macros.length - 1)]?.id || null;
    macroActions = selectedMacro()?.actions || [];
    macroFilePath = selectedMacro()?.filePath || '';
    macroSavedSnapshot = null;
    setMacroDirty(false);
    persistMacroLibrary();
    renderMacroLibrary();
    return;
  }
  Object.assign(macro, structuredClone(macroSavedSnapshot));
  applyMacroSettings(macro);
  persistMacroLibrary();
}

async function saveCurrentMacro() {
  const macro = selectedMacro();
  if (!macro) return false;
  try {
    const result = await window.bridge.saveMacroFile({
      id: macro.id,
      name: macro.name || 'My Macro',
      actions: macroActions,
      settings: macroSettingsSnapshot(),
      filePath: macroFilePath
    });
    macroFilePath = result.filePath;
    macro.fileSize = Number(result.fileSize) || macro.fileSize || 0;
    macro.id = result.document?.id || macro.id;
    persistSelectedMacro(false);
    macroSavedSnapshot = macroDocumentSnapshot(macro);
    setMacroDirty(false);
    renderMacroLibrary();
    return true;
  } catch (error) {
    showMessage('Save failed', error.message || 'The macro could not be saved.', 'alert');
    return false;
  }
}

async function confirmMacroExit() {
  if (!hasUnsavedMacroChanges()) return true;
  const shouldSave = await window.bridge.confirmUnsavedMacro();
  if (shouldSave) return saveCurrentMacro();
  discardCurrentMacroChanges();
  return true;
}

$('macroRecorderBack').addEventListener('click', async () => {
  if (!await confirmMacroExit()) return;
  showMacroPanel('home');
});
$('openAdvancedMacro').addEventListener('click', () => {
  renderMacroLibrary();
  showMacroPanel('advanced');
});
$('openTriggerMenu').addEventListener('click', event => {
  event.stopPropagation();
  const rect = $('openTriggerMenu').getBoundingClientRect();
  window.bridge.openCustomDropdown({
    id: 'triggerTypeMenu',
    x: rect.left,
    y: rect.top,
    height: rect.height,
    anchorWidth: rect.width,
    width: 132,
    value: '',
    options: [
      { value: 'relation', label: 'Color Relation' },
      { value: 'visual', label: 'Color Presence' },
      { value: 'pixel', label: 'Pixel Color' },
      { value: 'zone', label: 'Color Zone' },
      { value: 'bar', label: 'Bar Fill' },
      { value: 'screen', label: 'Screen Change' }
    ]
  });
});
$('triggerTypeMenu').addEventListener('change', () => {
  const nextKind = $('triggerTypeMenu').value;
  editingActionIndex = -1;
  smartActivation = createTriggerDraft(nextKind);
  applySmartActivationControls();
  showMacroPanel('smart');
});
$('macroSmartBack').addEventListener('click', () => {
  editingActionIndex = -1;
  smartActivation = createTriggerDraft();
  applySmartActivationControls();
  showMacroPanel('advanced');
});
$('macroAdvancedBack').addEventListener('click', () => {
  showMacroPanel('recorder');
});
$('advancedMacroSelect').addEventListener('change', async event => {
  const previousId = macroLibrary.selectedId;
  if (!await selectMacro(event.target.value)) event.target.value = previousId;
});

$('macroSave').addEventListener('click', saveCurrentMacro);

async function openMacroFile(createNew = false) {
  try {
    const result = await window.bridge.openMacroFile();
    if (result.canceled) return;
    if (createNew || !selectedMacro()) {
      const now = new Date().toISOString();
      const macro = {
        id: result.document.id || crypto.randomUUID(),
        name: result.document.name || 'Imported Macro',
        actions: result.document.actions,
        settings: result.document.settings || {},
        filePath: result.filePath,
        fileSize: Number(result.fileSize) || 0,
        createdAt: now,
        updatedAt: now
      };
      macroLibrary.macros.push(macro);
      macroLibrary.selectedId = macro.id;
      applyMacroSettings(macro);
      macroSavedSnapshot = macroDocumentSnapshot(macro);
      setMacroDirty(false);
      persistMacroLibrary();
      showMacroPanel('recorder');
      setMacroStatus('Loaded');
      return;
    }
    macroActions = result.document.actions;
    selectedMacro().name = result.document.name || selectedMacro().name;
    selectedMacro().settings = result.document.settings || {};
    macroFilePath = result.filePath;
    selectedMacro().actions = macroActions;
    selectedMacro().filePath = macroFilePath;
    selectedMacro().fileSize = Number(result.fileSize) || 0;
    applyMacroSettings(selectedMacro());
    persistSelectedMacro();
    setMacroStatus('Loaded');
  } catch (error) {
    showMessage('Open failed', error.message || 'The macro file could not be opened.', 'alert');
  }
}
$('macroOpen').addEventListener('click', () => openMacroFile(true));
$('importMacro').addEventListener('click', () => openMacroFile(true));

$('macroTriggerKey').addEventListener('click', () => {
  macroTriggerCaptureActive = true;
  sendConfiguration();
  window.bridge.openHotkeyWindow('macro-trigger');
});

function shortcutSignature(value) {
  const keys = Array.isArray(value.keys) && value.keys.length ? value.keys : [value.vk];
  return [...keys].sort((left, right) => left - right).join(',');
}

function shortcutIsUnavailable(value, currentType) {
  const reserved = {
    'start-stop': { keys: [hotkey.vk], vk: hotkey.vk },
    emergency: emergencyHotkey,
    trigger: macroTrigger,
    record: macroRecordHotkey,
    play: macroPlayHotkey
  };
  const selected = shortcutSignature(value);
  return Object.entries(reserved).some(([type, shortcut]) => type !== currentType && selected === shortcutSignature(shortcut));
}

function rejectShortcut(message) {
  macroTriggerCaptureActive = false;
  macroControlCaptureActive = false;
  sendConfiguration();
  showMessage('Shortcut unavailable', message, 'alert');
}

window.bridge.onMacroTriggerSelected(value => {
  if (!ownsTool('macro')) return;
  if (shortcutIsUnavailable(value, 'trigger')) {
    rejectShortcut('That shortcut is already assigned to another app or macro control. Choose a different trigger.');
    return;
  }
  macroTrigger = value;
  macroTriggerCaptureActive = false;
  $('macroTriggerKey').textContent = value.label;
  savePreferences();
  persistSelectedMacro();
  sendConfiguration();
});

$('macroRecordHotkey').addEventListener('click', () => {
  macroControlCaptureActive = true;
  sendConfiguration();
  window.bridge.openHotkeyWindow('macro-record');
});
$('macroPlayHotkey').addEventListener('click', () => {
  macroControlCaptureActive = true;
  sendConfiguration();
  window.bridge.openHotkeyWindow('macro-play');
});
window.bridge.onMacroRecordHotkeySelected(value => {
  if (!ownsTool('macro')) return;
  if (shortcutIsUnavailable(value, 'record')) {
    rejectShortcut('That shortcut is already assigned to another app or macro control. Choose a different Record / Stop shortcut.');
    return;
  }
  macroRecordHotkey = value;
  macroControlCaptureActive = false;
  $('macroRecordHotkey').textContent = `Record / Stop: ${value.label}`;
  savePreferences();
  persistSelectedMacro();
  sendConfiguration();
});
window.bridge.onMacroPlayHotkeySelected(value => {
  if (!ownsTool('macro')) return;
  if (shortcutIsUnavailable(value, 'play')) {
    rejectShortcut('That shortcut is already assigned to another app or macro control. Choose a different Play / Stop shortcut.');
    return;
  }
  macroPlayHotkey = value;
  macroControlCaptureActive = false;
  $('macroPlayHotkey').textContent = `Play / Stop: ${value.label}`;
  savePreferences();
  persistSelectedMacro();
  sendConfiguration();
});

function selectedActionIndex() {
  const value = $('macroActionList').value;
  return /^\d+$/.test(value) ? Number(value) : -1;
}

function updateActionToolbarState() {
  const index = selectedActionIndex();
  const selected = index >= 0 && index < macroActions.length;
  $('actionEdit').disabled = !selected;
  $('actionUp').disabled = !selected || index === 0;
  $('actionDown').disabled = !selected || index === macroActions.length - 1;
  $('actionDuplicate').disabled = !selected;
  $('actionDelete').disabled = !selected;
  $('actionClear').disabled = macroActions.length === 0;
}

function editScreenTrigger(index) {
  const action = macroActions[index];
  if (!action || !['screen_trigger', 'flow_trigger'].includes(action.type)) return;
  const config = structuredClone(action.config || {});
  const kind = config.displayKind || config.kind || 'visual';
  editingActionIndex = index;
  smartActivation = {
    ...createTriggerDraft(kind),
    ...config,
    kind,
    area: { ...createTriggerDraft(kind).area, ...(config.area || {}) }
  };
  applySmartActivationControls();
  showMacroPanel('smart');
}

function actionEditorTitle(action) {
  if (action.type === 'wait') return 'Edit wait';
  if (action.type === 'move') return 'Edit mouse movement';
  if (action.type === 'move_path') return 'Edit recorded mouse path';
  if (action.type === 'mouse_down' || action.type === 'mouse_up') return 'Edit mouse button';
  if (action.type === 'key_down' || action.type === 'key_up') return 'Edit keyboard action';
  if (action.type === 'wait_until_relation') return 'Edit wait until';
  if (action.type === 'find_color_click') return 'Edit find and click';
  if (action.type === 'label') return 'Edit label';
  if (action.type === 'goto') return 'Edit go to';
  if (action.type === 'auto_clicker_control') return 'Edit auto clicker control';
  return 'Edit action';
}

function macroKeyName(vk) {
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk >= 112 && vk <= 135) return `F${vk - 111}`;
  const names = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt', 27: 'Escape', 32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 45: 'Insert', 46: 'Delete' };
  return names[vk] || `Key ${vk}`;
}

function openActionEditor(index = selectedActionIndex()) {
  const action = macroActions[index];
  if (!action) return;
  if (action.type === 'screen_trigger' || action.type === 'flow_trigger') {
    editScreenTrigger(index);
    return;
  }
  editingActionIndex = index;
  for (const id of ['actionEditWaitFields', 'actionEditMoveFields', 'actionEditPathFields', 'actionEditMouseFields', 'actionEditKeyFields', 'actionEditWaitUntilFields', 'actionEditFindClickFields', 'actionEditControlFields', 'actionEditAutoClickerFields']) $(id).hidden = true;
  $('macroActionEditorTitle').textContent = actionEditorTitle(action);
  if (action.type === 'wait') {
    $('actionEditWaitFields').hidden = false;
    $('actionEditWaitMs').value = String(Math.max(0, Number(action.ms) || 0));
  } else if (action.type === 'move') {
    $('actionEditMoveFields').hidden = false;
    $('actionEditMoveX').value = String(Number(action.x) || 0);
    $('actionEditMoveY').value = String(Number(action.y) || 0);
    $('actionEditMoveMode').value = action.relative ? 'relative' : 'absolute';
  } else if (action.type === 'move_path') {
    $('actionEditPathFields').hidden = false;
    $('actionEditPathMode').value = action.relative ? 'relative' : 'absolute';
    $('actionEditPathHz').value = String(Math.min(240, Math.max(30, Number(action.playback_hz) || 90)));
    $('actionEditPathPoints').value = (Array.isArray(action.points) ? action.points : [])
      .filter(point => Array.isArray(point) && point.length >= 3)
      .map(point => `${Number(point[0]) || 0}, ${Number(point[1]) || 0}, ${Number(point[2]) || 0}`)
      .join('\n');
  } else if (action.type === 'mouse_down' || action.type === 'mouse_up') {
    $('actionEditMouseFields').hidden = false;
    $('actionEditMouseEvent').value = action.type;
    $('actionEditMouseButton').value = ['Left', 'Right', 'Middle', 'MB4', 'MB5'].includes(action.button) ? action.button : 'Left';
  } else if (action.type === 'key_down' || action.type === 'key_up') {
    $('actionEditKeyFields').hidden = false;
    $('actionEditKeyEvent').value = action.type;
    $('actionEditKeyVk').dataset.vk = String(Number(action.vk) || 0);
    $('actionEditKeyVk').value = `${macroKeyName(Number(action.vk) || 0)} — click and press to change`;
  } else if (action.type === 'wait_until_relation') {
    const config = action.config || {};
    $('actionEditWaitUntilFields').hidden = false;
    $('actionEditWaitBoundary').value = config.boundaryColor || '#ffffff';
    $('actionEditWaitTarget').value = config.targetColor || '#00ff00';
    $('actionEditWaitDetection').value = `${Math.max(1, Number(config.tolerance) || 20)},${Math.max(0, Number(config.margin) || 3)}`;
    $('actionEditWaitCondition').value = config.condition || 'target_inside';
    $('actionEditWaitAreaXY').value = `${Number(config.area?.x) || 0},${Number(config.area?.y) || 0}`;
    $('actionEditWaitAreaWH').value = `${Math.max(3, Number(config.area?.width) || 500)},${Math.max(3, Number(config.area?.height) || 120)}`;
    $('actionEditWaitPoll').value = String(Math.max(16, Number(config.pollMs) || 33));
    $('actionEditWaitTimeout').value = String(Math.max(0, Number(config.timeoutMs) || 0));
  } else if (action.type === 'find_color_click') {
    $('actionEditFindClickFields').hidden = false;
    $('actionEditFindColor').value = action.color || '#ffffff';
    $('actionEditFindTolerance').value = String(Math.max(1, Number(action.tolerance) || 20));
    $('actionEditFindPixels').value = String(Math.max(1, Number(action.minimumPixels) || 20));
    $('actionEditFindAreaXY').value = `${Number(action.area?.x) || 0},${Number(action.area?.y) || 0}`;
    $('actionEditFindAreaWH').value = `${Math.max(3, Number(action.area?.width) || 1920)},${Math.max(3, Number(action.area?.height) || 1080)}`;
    $('actionEditFindButton').value = action.button || 'Left';
    $('actionEditFindPoll').value = String(Math.max(16, Number(action.pollMs) || 33));
    $('actionEditFindTimeout').value = String(Math.max(0, Number(action.timeoutMs) || 0));
  } else if (action.type === 'label' || action.type === 'goto') {
    $('actionEditControlFields').hidden = false;
    $('actionEditControlLabel').firstChild.textContent = action.type === 'label' ? 'Label name ' : 'Destination ';
    $('actionEditControlName').value = action.name || 'Phase';
  } else if (action.type === 'auto_clicker_control') {
    $('actionEditAutoClickerFields').hidden = false;
    $('actionEditAutoClickerOperation').value = action.operation || 'toggle';
  } else {
    const removedType = invalidActionLabel(action);
    macroActions.splice(index, 1);
    editingActionIndex = -1;
    syncMacroActions(Math.min(index, macroActions.length - 1));
    showMessage('Invalid action removed', `${removedType} was removed because it has no valid settings editor.`, 'alert');
    return;
  }
  showMacroPanel('action-editor');
}

function closeActionEditor() {
  editingActionIndex = -1;
  showMacroPanel('advanced');
}

function saveEditedAction() {
  const index = editingActionIndex;
  const original = macroActions[index];
  if (!original) return closeActionEditor();
  let action;
  if (original.type === 'wait') {
    action = { ...original, ms: Math.max(0, Math.round(numberValue($('actionEditWaitMs')))) };
  } else if (original.type === 'move') {
    action = {
      ...original,
      x: Math.round(Number($('actionEditMoveX').value) || 0),
      y: Math.round(Number($('actionEditMoveY').value) || 0),
      relative: $('actionEditMoveMode').value === 'relative'
    };
  } else if (original.type === 'move_path') {
    const points = $('actionEditPathPoints').value.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const values = line.split(',').map(value => Number(value.trim()));
      return values.length === 3 && values.every(Number.isFinite)
        ? [Math.max(0, values[0]), Math.round(values[1]), Math.round(values[2])]
        : null;
    });
    if (points.some(point => !point)) {
      showMessage('Invalid path point', 'Use one point per line in this format: delay, x, y', 'alert');
      return;
    }
    action = {
      ...original,
      relative: $('actionEditPathMode').value === 'relative',
      playback_hz: Math.min(240, Math.max(30, Math.round(numberValue($('actionEditPathHz'), 90)))),
      points
    };
  } else if (original.type === 'mouse_down' || original.type === 'mouse_up') {
    action = { ...original, type: $('actionEditMouseEvent').value, button: $('actionEditMouseButton').value };
  } else if (original.type === 'key_down' || original.type === 'key_up') {
    const vk = Math.round(Number($('actionEditKeyVk').dataset.vk));
    if (!Number.isInteger(vk) || vk < 1 || vk > 255) {
      showMessage('Invalid key', 'Click the key field and press a keyboard key.', 'alert');
      return;
    }
    action = { ...original, type: $('actionEditKeyEvent').value, vk };
  } else if (original.type === 'wait_until_relation') {
    const xy = parseCoordinates($('actionEditWaitAreaXY').value);
    const wh = parseCoordinates($('actionEditWaitAreaWH').value);
    const detection = parseCoordinates($('actionEditWaitDetection').value);
    if (!xy || !wh || !detection || wh.some(value => value < 3)) return showMessage('Invalid wait settings', 'Enter valid coordinates and Tolerance,Margin values.', 'alert');
    action = normalizeEditableMacroAction({ type: 'wait_until_relation', config: {
      ...original.config,
      boundaryColor: $('actionEditWaitBoundary').value.trim(), targetColor: $('actionEditWaitTarget').value.trim(),
      condition: $('actionEditWaitCondition').value, tolerance: detection[0], margin: detection[1], area: { x: xy[0], y: xy[1], width: wh[0], height: wh[1] },
      pollMs: numberValue($('actionEditWaitPoll'), 33), timeoutMs: numberValue($('actionEditWaitTimeout'), 0)
    }});
    if (!action) return showMessage('Invalid wait settings', 'Check the colors and search area.', 'alert');
  } else if (original.type === 'find_color_click') {
    const xy = parseCoordinates($('actionEditFindAreaXY').value);
    const wh = parseCoordinates($('actionEditFindAreaWH').value);
    if (!xy || !wh || wh.some(value => value < 3)) return showMessage('Invalid search area', 'Enter X,Y and Width,Height values.', 'alert');
    action = normalizeEditableMacroAction({ ...original, color: $('actionEditFindColor').value.trim(), tolerance: numberValue($('actionEditFindTolerance'), 20), minimumPixels: numberValue($('actionEditFindPixels'), 20), area: { x: xy[0], y: xy[1], width: wh[0], height: wh[1] }, button: $('actionEditFindButton').value, pollMs: numberValue($('actionEditFindPoll'), 33), timeoutMs: numberValue($('actionEditFindTimeout'), 0) });
    if (!action) return showMessage('Invalid target settings', 'Check the target color and search area.', 'alert');
  } else if (original.type === 'label' || original.type === 'goto') {
    action = { ...original, name: $('actionEditControlName').value.trim().slice(0, 40) || 'Phase' };
  } else if (original.type === 'auto_clicker_control') {
    action = { ...original, operation: $('actionEditAutoClickerOperation').value };
  } else {
    const removedType = invalidActionLabel(original);
    macroActions.splice(index, 1);
    editingActionIndex = -1;
    syncMacroActions(Math.min(index, macroActions.length - 1));
    showMessage('Invalid action removed', `${removedType} was removed because it has no valid settings editor.`, 'alert');
    return;
  }
  macroActions[index] = action;
  editingActionIndex = -1;
  syncMacroActions(index);
  showMacroPanel('advanced');
}

$('macroActionList').addEventListener('change', updateActionToolbarState);
$('macroActionList').addEventListener('dblclick', () => openActionEditor());
$('actionEdit').addEventListener('click', () => openActionEditor());
$('macroActionEditorBack').addEventListener('click', closeActionEditor);
$('actionEditCancel').addEventListener('click', closeActionEditor);
$('actionEditSave').addEventListener('click', saveEditedAction);
$('actionEditKeyVk').addEventListener('keydown', event => {
  event.preventDefault();
  event.stopPropagation();
  const vk = Number(event.keyCode || event.which);
  if (!Number.isInteger(vk) || vk < 1 || vk > 255) return;
  $('actionEditKeyVk').dataset.vk = String(vk);
  $('actionEditKeyVk').value = `${macroKeyName(vk)} — selected`;
});

async function pickActionEditorArea(xyId, whId) {
  try {
    const result = await window.bridge.pickSmartArea();
    if (!result || result.canceled) return;
    $(xyId).value = `${result.x},${result.y}`;
    $(whId).value = `${result.width},${result.height}`;
  } catch (_) {
    showMessage('Area selector unavailable', 'The screen area selector could not be opened.', 'alert');
  }
}

$('actionEditWaitPickArea').addEventListener('click', () => pickActionEditorArea('actionEditWaitAreaXY', 'actionEditWaitAreaWH'));
$('actionEditFindPickArea').addEventListener('click', () => pickActionEditorArea('actionEditFindAreaXY', 'actionEditFindAreaWH'));

$('actionUp').addEventListener('click', () => {
  const index = selectedActionIndex();
  if (index <= 0) return;
  [macroActions[index - 1], macroActions[index]] = [macroActions[index], macroActions[index - 1]];
  syncMacroActions(index - 1);
});
$('actionDown').addEventListener('click', () => {
  const index = selectedActionIndex();
  if (index < 0 || index >= macroActions.length - 1) return;
  [macroActions[index + 1], macroActions[index]] = [macroActions[index], macroActions[index + 1]];
  syncMacroActions(index + 1);
});
$('actionDuplicate').addEventListener('click', () => {
  const index = selectedActionIndex();
  if (index < 0) return;
  const duplicate = structuredClone(macroActions[index]);
  if (['screen_trigger', 'flow_trigger'].includes(duplicate.type)) duplicate.config = { ...(duplicate.config || {}), id: crypto.randomUUID() };
  macroActions.splice(index + 1, 0, duplicate);
  syncMacroActions(index + 1);
});
$('actionDelete').addEventListener('click', () => {
  const index = selectedActionIndex();
  if (index < 0) return;
  macroActions.splice(index, 1);
  syncMacroActions(Math.min(index, macroActions.length - 1));
});
$('actionClear').addEventListener('click', () => {
  macroActions = [];
  syncMacroActions();
});

function parseCoordinates(value) {
  const parts = value.split(',').map(part => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : null;
}

function syncNewActionInputs() {
  const type = $('newActionType').value;
  const usesMouseButton = ['mouse_click', 'mouse_down', 'mouse_up'].includes(type);
  const examples = { wait: '100', wait_until_relation: '', find_color_click: '#ffffff', auto_clicker_control: '', label: 'Phase', goto: 'Phase', key_press: '65', move_absolute: '500,300', move_relative: '0,10' };
  $('newActionValue').hidden = usesMouseButton;
  $('newActionButton').hidden = !usesMouseButton;
  if (!usesMouseButton) $('newActionValue').value = examples[type] || '';
  const labels = {
    wait: 'Delay in milliseconds', key_press: 'Key or virtual-key number',
    wait_until_relation: 'Configure after adding', find_color_click: 'Target color', auto_clicker_control: 'Configure after adding', label: 'Label name', goto: 'Destination label',
    move_absolute: 'Absolute coordinates, x,y', move_relative: 'Relative coordinates, x,y'
  };
  $('newActionValue').setAttribute('aria-label', labels[type] || 'Action value');
}
$('newActionType').addEventListener('change', syncNewActionInputs);
$('actionAdd').addEventListener('click', () => {
  const type = $('newActionType').value;
  const value = $('newActionValue').value.trim();
  const additions = [];
  if (type === 'wait') {
    const milliseconds = Math.max(0, Number(value));
    if (!Number.isFinite(milliseconds)) return;
    additions.push({ type: 'wait', ms: milliseconds });
  } else if (type === 'wait_until_relation') {
    additions.push(normalizeEditableMacroAction({ type, config: { boundaryColor: '#ffffff', targetColor: '#00ff00', condition: 'target_inside', area: { x: 0, y: 0, width: 500, height: 120 }, pollMs: 33, timeoutMs: 0 } }));
  } else if (type === 'find_color_click') {
    additions.push(normalizeEditableMacroAction({ type, color: /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff', tolerance: 20, minimumPixels: 20, area: { x: 0, y: 0, width: 1920, height: 1000 }, button: 'Left', pollMs: 33, timeoutMs: 0 }));
  } else if (type === 'auto_clicker_control') {
    additions.push({ type, operation: 'toggle' });
  } else if (type === 'label' || type === 'goto') {
    additions.push({ type, name: value.slice(0, 40) || 'Phase' });
  } else if (type === 'mouse_click') {
    const button = $('newActionButton').value;
    additions.push({ type: 'mouse_down', button }, { type: 'mouse_up', button });
  } else if (type === 'mouse_down' || type === 'mouse_up') {
    additions.push({ type, button: $('newActionButton').value });
  } else if (type === 'key_press') {
    const vk = value.length === 1 ? value.toUpperCase().charCodeAt(0) : Number(value);
    if (!Number.isInteger(vk) || vk < 1 || vk > 255) return;
    additions.push({ type: 'key_down', vk }, { type: 'key_up', vk });
  } else {
    const coordinates = parseCoordinates(value);
    if (!coordinates) return;
    additions.push({ type: 'move', x: coordinates[0], y: coordinates[1], relative: type === 'move_relative' });
  }
  macroActions.push(...additions);
  syncMacroActions(macroActions.length - additions.length);
});
syncNewActionInputs();

for (const id of ['macroTriggerMode', 'macroEnabled', 'captureMovement', 'captureButtons', 'captureKeyboard', 'captureDelays', 'macroAbsolute', 'macroRelative', 'macroRepeatCountMode', 'macroConstantRepeat', 'macroPlaybackSpeed', 'macroMinimizeOnPlay', 'macroStartDelay', 'macroLoopDelay', 'macroRestoreCursor', 'macroStopOnInput', 'macroTimingVariance', 'macroRecordingQuality']) {
  $(id).addEventListener('change', () => { savePreferences(); persistSelectedMacro(); sendConfiguration(); });
}
$('macroRepeatCountMode').addEventListener('change', () => { $('macroRepeatCount').disabled = false; });
$('macroConstantRepeat').addEventListener('change', () => { $('macroRepeatCount').disabled = true; });
$('macroRepeatCount').addEventListener('change', () => {
  $('macroRepeatCount').value = String(Math.max(1, Math.floor(numberValue($('macroRepeatCount'), 3))));
  savePreferences();
  persistSelectedMacro();
});
$('macroLoopDelay').addEventListener('change', () => {
  $('macroLoopDelay').value = String(Math.min(60000, Math.floor(numberValue($('macroLoopDelay')))));
  savePreferences();
  persistSelectedMacro();
  sendConfiguration();
});

function closeCustomDropdowns(except = null) {
  document.querySelectorAll('.custom-select.open').forEach(wrapper => {
    if (wrapper === except) return;
    wrapper.classList.remove('open');
    wrapper.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
  });
  if (!except) window.bridge.closeCustomDropdown();
}

function refreshCustomDropdowns() {
  document.querySelectorAll('#macroRecorderPanel .custom-select').forEach(wrapper => {
    const select = wrapper.previousElementSibling;
    const selected = select?.selectedOptions?.[0];
    if (!selected) return;
    wrapper.querySelector('.custom-select-value').textContent = selected.textContent;
  });
}

function initializeCustomDropdowns() {
  document.querySelectorAll('#macroRecorderPanel select').forEach(select => {
    if (select.nextElementSibling?.classList.contains('custom-select')) return;
    select.classList.add('custom-select-native');
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="custom-select-value"></span><span class="custom-select-chevron" aria-hidden="true"></span>';
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const opening = !wrapper.classList.contains('open');
      closeCustomDropdowns(wrapper);
      wrapper.classList.toggle('open', opening);
      trigger.setAttribute('aria-expanded', String(opening));
      if (!opening) {
        window.bridge.closeCustomDropdown();
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const options = [...select.options].map(option => ({ value: option.value, label: option.textContent }));
      const optionWidth = Math.max(...options.map(option => option.label.length * 7 + 24));
      window.bridge.openCustomDropdown({
        id: select.id,
        x: rect.left,
        y: rect.top,
        height: rect.height,
        anchorWidth: rect.width,
        width: Math.max(rect.width, optionWidth),
        value: select.value,
        options
      });
    });
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeCustomDropdowns();
        return;
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const options = [...select.options];
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = (select.selectedIndex + direction + options.length) % options.length;
      select.selectedIndex = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refreshCustomDropdowns();
    });
    wrapper.append(trigger);
    select.insertAdjacentElement('afterend', wrapper);
  });
  refreshCustomDropdowns();
}

document.addEventListener('click', () => closeCustomDropdowns());
window.bridge.onCustomDropdownSelected(payload => {
  if (String(payload.id).startsWith('toolContext:')) {
    const tool = String(payload.id).slice('toolContext:'.length);
    window.bridge.selectToolMenuAction({ tool, action: String(payload.value) });
    return;
  }
  if (String(payload.id).startsWith('macroContext:')) {
    toggleMacroPin(String(payload.id).slice('macroContext:'.length), String(payload.value));
    return;
  }
  const select = $(payload.id);
  if (!select) return;
  select.value = String(payload.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  refreshCustomDropdowns();
});
window.bridge.onCustomDropdownClosed(id => {
  const select = $(id);
  const wrapper = select?.nextElementSibling;
  wrapper?.classList.remove('open');
  wrapper?.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
});

initializeCustomDropdowns();
renderMacroLibrary();
if (selectedMacro()) applyMacroSettings(selectedMacro());
else renderMacroActions();
window.bridge.configure({ action: 'macro_set_actions', actions: playbackMacroActions() });

let latestUpdateStatus = null;
let updateTargetVersion = '';
$('updateWindow').addEventListener('click', () => {
  if (latestUpdateStatus?.status === 'available') window.bridge.installUpdate();
  else window.bridge.checkForUpdates();
});
window.bridge.onUpdateStatus(status => {
  latestUpdateStatus = status;
  if (status.version) updateTargetVersion = String(status.version);
  const updateButton = $('updateWindow');
  if (status.status === 'available') {
    updateButton.disabled = false;
    updateButton.classList.remove('working');
    updateButton.classList.add('has-update');
    updateButton.setAttribute('aria-label', `Install update ${updateTargetVersion}`);
    updateButton.dataset.hint = `Update from v${initialWindowContext.appVersion} to v${updateTargetVersion}`;
  } else if (status.status === 'checking' || status.status === 'downloading' || status.status === 'installing') {
    updateButton.disabled = true;
    updateButton.classList.add('working');
    updateButton.setAttribute('aria-label', status.status === 'checking' ? 'Checking for updates' : 'Installing update');
    updateButton.dataset.hint = status.status === 'checking' ? 'Checking for updates' : `Installing v${updateTargetVersion}`;
  } else {
    updateButton.disabled = false;
    updateButton.classList.remove('working', 'has-update');
    updateButton.setAttribute('aria-label', 'Check for updates');
    updateButton.dataset.hint = status.status === 'error'
      ? `Update check failed: ${String(status.message || 'try again')}`
      : 'Check for updates';
  }
});
window.bridge.checkForUpdates();

$('pickLocation').addEventListener('click', () => {
  controls.pickedLocation.checked = true;
  window.bridge.configure({ action: 'pick_cursor' });
});

const hintSizer = document.createElement('div');
Object.assign(hintSizer.style, {
  position: 'fixed', left: '-10000px', top: '-10000px', width: 'max-content', maxWidth: '476px',
  padding: '5px 8px', border: '1px solid transparent', font: '12px/15px "Segoe UI",sans-serif',
  whiteSpace: 'normal', overflowWrap: 'anywhere', visibility: 'hidden', pointerEvents: 'none'
});
document.body.appendChild(hintSizer);
function hintSize(text) {
  hintSizer.textContent = text;
  const bounds = hintSizer.getBoundingClientRect();
  return { width: Math.ceil(bounds.width) + 2, height: Math.ceil(bounds.height) + 2 };
}
function showHoverHint(control) {
  const text = control.dataset.hint;
  const size = hintSize(text);
  const bounds = control.getBoundingClientRect();
  const sourceRect = {
    x: Math.round(window.screenX + bounds.left),
    y: Math.round(window.screenY + bounds.top),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
  window.bridge.showHoverHint({
    text,
    width: size.width,
    height: size.height,
    x: sourceRect.x + Math.round(sourceRect.width / 2),
    y: sourceRect.y + sourceRect.height,
    sourceRect
  });
}
let hoveredHintControl = null;
function hintControlAt(target) {
  const control = target instanceof Element ? target.closest('[data-hint]') : null;
  if (!control || !control.dataset.hint) return null;
  if (control.dataset.hintOverflow === 'true' && control.scrollWidth <= control.clientWidth) return null;
  return control;
}
document.addEventListener('mousemove', event => {
  const control = hintControlAt(event.target);
  if (!control) {
    hoveredHintControl = null;
    return;
  }
  if (control === hoveredHintControl) return;
  hoveredHintControl = control;
  showHoverHint(control);
});
document.addEventListener('click', () => {
  hoveredHintControl = null;
  window.bridge.hideHoverHint();
});
window.bridge.onHoverHintHidden(() => {
  hoveredHintControl = null;
});
$('help').dataset.hint = $('helpHint').textContent;

$('recordButton').addEventListener('click', () => {
  window.bridge.configure({ action: 'emergency_stop' });
  setRunning(false);
});

function showMessage(title, message, icon) {
  window.bridge.openMessageWindow({ title, message, icon });
}

window.bridge.onBackendEvent(event => {
  if (event.type.startsWith('macro_') && !ownsTool('macro')) return;
  if (['started', 'stopped', 'cursor_picked', 'cursor_pick_started'].includes(event.type) && !ownsTool('auto-clicker')) return;
  if (event.type === 'ready') {
    backendReady = true;
    sendConfiguration(true);
    window.bridge.configure({ action: 'macro_set_actions', actions: playbackMacroActions() });
  } else if (event.type === 'mouse_hook_ready') {
    if ([0x04, 0x05, 0x06].includes(hotkey.vk)) {
      clearTimeout(mouseArmTimer);
      mouseArmTimer = setTimeout(() => {
        hotkeyArmed = true;
        sendConfiguration();
      }, 500);
    }
    window.bridge.uiReady();
  } else if (event.type === 'started') {
    setRunning(true);
  } else if (event.type === 'stopped') {
    setRunning(false);
  } else if (event.type === 'cursor_picked') {
    controls.cursorX.value = event.x;
    controls.cursorY.value = event.y;
    controls.pickedLocation.checked = true;
    $('pickLocation').textContent = 'Pick location';
    $('pickLocation').disabled = false;
    savePreferences();
    sendConfiguration();
  } else if (event.type === 'cursor_pick_started') {
    $('pickLocation').textContent = 'Click a location...';
    $('pickLocation').disabled = true;
  } else if (event.type === 'macro_recording_started') {
    setRecordButton(true);
    $('macroPlay').disabled = true;
    setMacroStatus(`Recording — ${macroRecordHotkey.label} to stop`, 'recording');
  } else if (event.type === 'macro_recording_stopped') {
    const configuredTriggers = macroActions.filter(action => ['screen_trigger', 'flow_trigger'].includes(action.type));
    macroActions = Array.isArray(event.actions) ? event.actions : [];
    if (configuredTriggers.length) macroActions.unshift(...configuredTriggers);
    syncMacroActions();
    setRecordButton(false);
    $('macroPlay').disabled = false;
    setMacroStatus('Recorded');
  } else if (event.type === 'macro_playback_started') {
    $('macroRecord').disabled = true;
    setPlayButton(true);
    if ($('macroMinimizeOnPlay').checked) window.bridge.windowControl('minimize');
    setMacroStatus('Playing', 'playing');
  } else if (event.type === 'macro_playback_stopped') {
    $('macroRecord').disabled = false;
    setPlayButton(false);
    setMacroStatus('Ready');
  } else if (event.type === 'macro_playback_loop') {
    const total = Number(event.total) || 0;
    setMacroStatus(total ? `Loop ${event.completed}/${total}` : `Loop ${event.completed}`, 'playing');
  } else if (event.type === 'macro_error') {
    $('macroRecord').disabled = false;
    $('macroPlay').disabled = false;
    setRecordButton(false);
    setPlayButton(false);
    showMessage('Macro error', event.message || 'The macro could not be played.', 'alert');
  } else if (event.type === 'emergency_stop') {
    setRunning(false);
    hotkeyArmed = false;
    showMessage('Emergency stop activated', 'Clicking is stopped and the hotkey is disarmed. Open Hotkey setting, click Start / Stop, choose a key or mouse button, and press Ok.', 'alert');
  } else if (event.type === 'error') {
    setRunning(false);
    showMessage('Python error', event.message || 'Unknown backend error.', 'alert');
  }
});

applyToolLayout(initialWindowContext);
refreshButtonLabels();
