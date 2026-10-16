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
  MetaLeft: { name: 'Windows', shortName: 'Win', vk: 0x5B },
  MetaRight: { name: 'Windows', shortName: 'Win', vk: 0x5C },
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

const mouseHotkeys = {
  1: { name: 'Mouse Button 3 (wheel click)', shortName: 'MB3', vk: 0x04 },
  3: { name: 'Mouse Button 4 (side / back)', shortName: 'MB4', vk: 0x05 },
  4: { name: 'Mouse Button 5 (side / forward)', shortName: 'MB5', vk: 0x06 }
};

const defaultStartStop = { name: 'Q', shortName: 'Q', vk: 0x51 };
const defaultEmergency = {
  vk: 0x7B,
  modifiers: 0x06,
  keys: [0x11, 0x10, 0x7B],
  keyName: 'F12',
  label: 'Ctrl + Shift + F12'
};
const defaultMacroTrigger = { vk: 0x77, modifiers: 0, keys: [0x77], keyName: 'F8', label: 'F8' };
const defaultRecordHotkey = { vk: 0x79, modifiers: 0x02, keys: [0x11, 0x79], keyName: 'F10', label: 'Ctrl + F10' };
const defaultPlayHotkey = { vk: 0x7A, modifiers: 0x02, keys: [0x11, 0x7A], keyName: 'F11', label: 'Ctrl + F11' };
const dialog = window.bridge.loadHotkeyDialog() || {};
const emergencyMode = dialog.mode === 'emergency';
const macroTriggerMode = dialog.mode === 'macro-trigger';
const macroRecordMode = dialog.mode === 'macro-record';
const macroPlayMode = dialog.mode === 'macro-play';
const combinationMode = emergencyMode || macroTriggerMode || macroRecordMode || macroPlayMode;
let pendingHotkey = dialog.value || (macroTriggerMode ? defaultMacroTrigger : macroRecordMode ? defaultRecordHotkey : macroPlayMode ? defaultPlayHotkey : emergencyMode ? defaultEmergency : defaultStartStop);
let capturing = false;
let activationTimer = null;
let capturedKeys = new Map();

const output = document.getElementById('hotkeyValue');
const title = emergencyMode ? 'Emergency Stop Setting' : macroTriggerMode ? 'Macro Trigger Setting' : macroRecordMode ? 'Record Shortcut Setting' : macroPlayMode ? 'Playback Shortcut Setting' : 'Hotkey Setting';
document.title = title;
document.getElementById('popupTitle').textContent = title;
document.getElementById('captureHotkey').textContent = emergencyMode ? 'Emergency Stop' : macroTriggerMode ? 'Macro Trigger' : macroRecordMode ? 'Record / Stop' : macroPlayMode ? 'Play / Stop' : 'Start / Stop';

function displayHotkey(value) {
  if (combinationMode) return value.label || value.shortName || value.name;
  return value.shortName.length === 1 ? value.shortName.toLowerCase() : value.shortName;
}
output.textContent = displayHotkey(pendingHotkey);

function keyboardHotkey(event) {
  if (/^Key[A-Z]$/.test(event.code)) {
    const name = event.code.slice(3);
    return { name, shortName: name, vk: name.charCodeAt(0) };
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    const name = event.code.slice(5);
    return { name, shortName: name, vk: name.charCodeAt(0) };
  }
  const match = /^F([1-9]|1[0-2])$/.exec(event.code);
  if (match) {
    const number = Number(match[1]);
    return { name: `F${number}`, shortName: `F${number}`, vk: 0x6F + number };
  }
  return keyboardHotkeys[event.code] || null;
}

function orderedCapturedKeys() {
  const rank = { 0x11: 0, 0x10: 1, 0x12: 2, 0x5B: 3, 0x5C: 3 };
  return [...capturedKeys.values()].sort((left, right) =>
    (rank[left.vk] ?? 10) - (rank[right.vk] ?? 10)
  );
}

function finishStartStopCapture(value) {
  pendingHotkey = value;
  capturing = false;
  output.textContent = displayHotkey(value);
}

function finishEmergencyCapture() {
  const keys = orderedCapturedKeys();
  if (!keys.length) return;
  const primary = [...keys].reverse().find(key => !key.isModifier) || keys[keys.length - 1];
  let modifiers = 0;
  for (const key of keys) {
    if (key.vk === primary.vk) continue;
    if (key.vk === 0x11) modifiers |= 0x02;
    if (key.vk === 0x10) modifiers |= 0x04;
    if (key.vk === 0x12) modifiers |= 0x01;
    if (key.vk === 0x5B || key.vk === 0x5C) modifiers |= 0x08;
  }
  pendingHotkey = {
    vk: primary.vk,
    modifiers,
    keys: keys.map(key => key.vk),
    keyName: primary.shortName,
    label: keys.map(key => key.shortName).join(' + ')
  };
  capturing = false;
  output.textContent = pendingHotkey.label;
}

document.getElementById('captureHotkey').addEventListener('click', () => {
  clearTimeout(activationTimer);
  capturedKeys = new Map();
  capturing = false;
  output.textContent = '...';
  activationTimer = setTimeout(() => { capturing = true; }, 80);
});

window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0'].includes(event.key)) event.preventDefault();
  if (!capturing) return;
  const value = keyboardHotkey(event);
  if (!value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!combinationMode) {
    finishStartStopCapture(value);
    return;
  }
  value.isModifier = [0x10, 0x11, 0x12, 0x5B, 0x5C].includes(value.vk);
  capturedKeys.set(value.vk, value);
  output.textContent = orderedCapturedKeys().map(key => key.shortName).join(' + ');
}, true);

window.addEventListener('keyup', event => {
  if (!capturing || !combinationMode || capturedKeys.size === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  finishEmergencyCapture();
}, true);

window.addEventListener('mousedown', event => {
  if (!capturing || !mouseHotkeys[event.button]) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const value = mouseHotkeys[event.button];
  if (combinationMode) {
    pendingHotkey = { vk: value.vk, modifiers: 0, keys: [value.vk], keyName: value.shortName, label: value.shortName };
    capturing = false;
    output.textContent = value.shortName;
  } else {
    finishStartStopCapture(value);
  }
}, true);

document.getElementById('okButton').addEventListener('click', () => {
  if (capturing) return;
  if (emergencyMode) window.bridge.selectEmergencyHotkey(pendingHotkey);
  else if (macroTriggerMode) window.bridge.selectMacroTrigger(pendingHotkey);
  else if (macroRecordMode) window.bridge.selectMacroRecordHotkey(pendingHotkey);
  else if (macroPlayMode) window.bridge.selectMacroPlayHotkey(pendingHotkey);
  else window.bridge.selectHotkey(pendingHotkey);
});
document.getElementById('cancelButton').addEventListener('click', () => window.bridge.closeCurrentWindow());
