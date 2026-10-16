const { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, screen, session, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { packMacroActions, unpackMacroActions } = require('./macro-codec');
const { downloadUpdatePackage, fetchBoundedUpdateManifest } = require('./update-download');
const { verifySignedUpdateManifest } = require('./update-manifest');
const minecraftServer = require('./minecraft-server/main');
// A managed map-only app update must not take focus from the user's game.
const backgroundMapUpdateStartup = process.argv.includes('--background-map-update');

let window;
let backend;
let backendReady = false;
let backendRestartTimer = null;
let backendRestartDelayMs = 180;
let pendingBackendCommands = [];
let lastBackendConfiguration = null;
let splashWindow;
let splashShownAt = 0;
let revealScheduled = false;
let hotkeyWindow;
let messageWindow;
let settingsWindow;
let settingsUnsavedWindow;
let settingsDraft = null;
let settingsDirty = false;
let settingsCloseApproved = false;
let activeIndicatorWindow;
let cpsIndicatorWindow;
let currentGeneratedCps = 0;
let currentGeneratedButton = 'Left';
let physicalClickTimes = [];
let macroClickTimes = [];
let macroPlaybackRunning = false;
let cpsIndicatorRefreshTimer = null;
let inputDisplayWindow = null;
let inputDisplayLoadPromise = null;
let inputDisplayConfigSignature = '';
const pendingInputDisplayEvents = new Map();
let inputDisplayDispatchTimer = null;
let pendingCpsIndicatorUpdate = null;
let cpsIndicatorDispatchTimer = null;
let macroNameWindow;
let macroDeleteWindow;
let motdEditorWindow;
let motdEditorState = { value: '', serverName: 'Minecraft Server', iconDataUrl: '' };
let playerInspectorWindow;
let playerInspectorName = '';
let playerRoleEditorWindow;
let macroUnsavedWindow;
let macroUnsavedResolve;
let dropdownWindow;
let dropdownOwnerId = null;
let dropdownSelectId = null;
let dropdownOwnerBlurHandler = null;
let hoverHintWindow;
let hoverHintLoadPromise = null;
let hoverHintRequest = null;
let hoverHintToken = 0;
let hoverHintOwnerId = null;
let hoverHintDismissTimer = null;
let hoverHintRaiseCounter = 0;
let macroNameDialog = { entity: 'macro', mode: 'create', id: null, name: '' };
let macroDeleteDialog = { entity: 'macro', id: null, name: '' };
let macroDeleteOwner = null;
let macroDeleteConfirmed = false;
let hotkeySelectionCommitted = false;
let hotkeyWindowMode = 'start-stop';
let shuttingDown = false;
let availableUpdate = null;
let updateCheckTimer = null;
let updateCheckPromise = null;
let updateCheckManualRequested = false;
let autoUpdateLaunching = false;
let clickerRunning = false;
let detachedToolWindow = null;
let detachedTool = null;
let activeMainTool = 'auto-clicker';
let lockedTool = null;
let smartActivationConfig = null;
let smartActivationTimer = null;
let smartActivationScanning = false;
let smartActivationSignature = '';
let smartActivationStates = new Map();
let smartAreaPickerWindows = [];
let smartAreaPickerResolve = null;
let screenPointPickerWindows = [];
let screenPointPickerResolve = null;
let crosshairOverlayWindow = null;
let crosshairPreviewWindow = null;
let crosshairConfig = null;
let crosshairAccelerator = 'CommandOrControl+Shift+F9';
let pendingMainProcessError = null;
let cachedAppSettings = null;
const failedBackendProcesses = new WeakSet();
const expectedBackendStops = new WeakSet();
const indicatorFadeStates = new WeakMap();
const indicatorFadeDurationMs = 160;

// BACKEND_PIPE_SAFETY_START
// These limits keep a broken or hostile child process from turning one pipe into
// an unbounded main-process allocation. Normal backend messages are far smaller;
// the larger line allowance is reserved for a completed macro recording.
const BACKEND_STDOUT_MAX_CHUNK_BYTES = 256 * 1024;
const BACKEND_STDOUT_MAX_LINE_BYTES = 2 * 1024 * 1024;
const BACKEND_STDOUT_QUEUE_MAX_LINES = 512;
const BACKEND_STDOUT_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
const BACKEND_STDOUT_PAUSE_LINES = 384;
const BACKEND_STDOUT_RESUME_LINES = 96;
const BACKEND_STDOUT_PARSE_LINES_PER_TICK = 24;
const BACKEND_STDOUT_PARSE_BYTES_PER_TICK = 256 * 1024;
const BACKEND_STDOUT_PARSE_INTERVAL_MS = 50;
const BACKEND_STDERR_MAX_PENDING_BYTES = 32 * 1024;
const BACKEND_DIAGNOSTIC_MAX_BYTES = 8 * 1024;
const BACKEND_DIAGNOSTIC_FLUSH_MS = 250;
const BACKEND_TELEMETRY_FLUSH_MS = 50;
const BACKEND_RENDERER_EVENTS_PER_SECOND = 120;
const BACKEND_RENDERER_BACKGROUND_EVENTS_PER_SECOND = 80;
const BACKEND_CLICK_HISTORY_LIMIT = 512;
const BACKEND_PENDING_COMMAND_LIMIT = 128;
const INPUT_DISPLAY_FRAME_MS = 33;
const INPUT_DISPLAY_PENDING_LIMIT = 24;
const CPS_INDICATOR_FRAME_MS = 50;
const BACKEND_COALESCED_EVENT_TYPES = new Set(['cps', 'physical_click', 'input_event', 'macro_playback_loop']);
const BACKEND_PRIORITY_EVENT_TYPES = new Set([
  'ready', 'configured', 'started', 'stopped', 'emergency_stop', 'error', 'macro_error',
  'macro_recording_started', 'macro_recording_stopped', 'macro_playback_started',
  'macro_playback_stopped', 'cursor_pick_started', 'cursor_picked', 'mouse_hook_ready',
  'emergency_hotkey_ready', 'macro_actions_set', 'macro_crosshair_profile'
]);

function utf8Prefix(value, maxBytes) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  if (source.length <= maxBytes) return source.toString('utf8');
  let result = source.subarray(0, Math.max(0, maxBytes)).toString('utf8');
  if (result.endsWith('\uFFFD')) result = result.slice(0, -1);
  return result;
}

function createBoundedLineAccumulator({
  onLine,
  onOverflow,
  maxChunkBytes = BACKEND_STDOUT_MAX_CHUNK_BYTES,
  maxLineBytes = BACKEND_STDOUT_MAX_LINE_BYTES
}) {
  let decoder = new StringDecoder('utf8');
  let buffered = '';
  let bufferedBytes = 0;
  let discardingLine = false;

  const clearPartialLine = (discard = false) => {
    buffered = '';
    bufferedBytes = 0;
    discardingLine = discard;
  };

  const resetDecoder = (discard = false) => {
    clearPartialLine(discard);
    decoder = new StringDecoder('utf8');
  };

  const append = segment => {
    if (!segment || discardingLine) return;
    const segmentBytes = Buffer.byteLength(segment, 'utf8');
    if (bufferedBytes + segmentBytes > maxLineBytes) {
      const droppedBytes = bufferedBytes + segmentBytes;
      clearPartialLine(true);
      onOverflow?.({ kind: 'line', droppedBytes });
      return;
    }
    buffered += segment;
    bufferedBytes += segmentBytes;
  };

  const consume = bytes => {
    if (!bytes.length) return;
    const text = decoder.write(bytes);
    let start = 0;
    for (let newline = text.indexOf('\n'); newline >= 0; newline = text.indexOf('\n', start)) {
      const segment = text.slice(start, newline);
      if (discardingLine) {
        clearPartialLine(false);
      } else {
        append(segment);
        if (!discardingLine) {
          const line = buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered;
          const lineBytes = bufferedBytes - (buffered.endsWith('\r') ? 1 : 0);
          buffered = '';
          bufferedBytes = 0;
          onLine(line, Math.max(0, lineBytes));
        } else {
          clearPartialLine(false);
        }
      }
      start = newline + 1;
    }
    append(text.slice(start));
  };

  return {
    push(value) {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
      if (bytes.length <= maxChunkBytes) {
        consume(bytes);
        return;
      }

      consume(bytes.subarray(0, maxChunkBytes));
      onOverflow?.({ kind: 'chunk', droppedBytes: bytes.length - maxChunkBytes });

      // A skipped middle section makes the current frame invalid. Recover only
      // after the final newline in this chunk, keeping at most one bounded tail.
      resetDecoder(true);
      const finalNewline = bytes.lastIndexOf(0x0a);
      if (finalNewline >= maxChunkBytes) {
        resetDecoder(false);
        const tail = bytes.subarray(finalNewline + 1);
        if (tail.length <= maxLineBytes) consume(tail);
        else {
          resetDecoder(true);
          onOverflow?.({ kind: 'line', droppedBytes: tail.length });
        }
      }
    },
    clear() { resetDecoder(false); },
    bufferedBytes() { return bufferedBytes; },
    isDiscarding() { return discardingLine; }
  };
}
// BACKEND_PIPE_SAFETY_END
const crosshairGameProcesses = {
  cs2: ['cs2.exe'],
  valorant: ['valorant-win64-shipping.exe'],
  warzone: ['cod.exe', 'blackops7.exe'],
  apex: ['r5apex.exe']
};

const releaseChannelPath = path.join(__dirname, 'release-channel.json');
let releaseChannel = 'stable';
try {
  releaseChannel = JSON.parse(fs.readFileSync(releaseChannelPath, 'utf8')).channel === 'beta' ? 'beta' : 'stable';
} catch (_) {}
const isBetaChannel = releaseChannel === 'beta';
const productName = isBetaChannel ? 'Click Interval Beta' : 'Click Interval';
const availableTools = isBetaChannel
  ? ['auto-clicker', 'macro', 'minecraft-server']
  : ['auto-clicker', 'macro', 'crosshair', 'voice', 'minecraft-server'];

let betaAccessTimer = null;
let betaAccessExpiresAt = 0;
function loadBetaAccessConfig() {
  const defaults = {
    endpoint: 'https://click-interval.netlify.app/api/beta/access',
    publicKey: 'MCowBQYDK2VwAyEAS4TY6SpsL3R52iwfixsP1g2fz5QI793nDhnPCQsa7RY=',
  };
  try {
    const external = JSON.parse(fs.readFileSync(path.join(__dirname, 'beta-access.json'), 'utf8'));
    return { ...defaults, ...external };
  } catch (_) { return defaults; }
}

function betaDeviceIdentity() {
  const identityPath = path.join(app.getPath('userData'), 'beta-device.json');
  try {
    const stored = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    if (/^[a-zA-Z0-9-]{20,80}$/.test(stored.deviceId)) return stored;
  } catch (_) {}
  const identity = { deviceId: crypto.randomUUID(), computerName: os.hostname() };
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  fs.writeFileSync(identityPath, JSON.stringify(identity), { encoding: 'utf8', mode: 0o600 });
  return identity;
}

async function checkBetaAccess() {
  if (!isBetaChannel) return { allowed: true };
  const config = loadBetaAccessConfig();
  if (!config?.endpoint || !config?.publicKey) return { allowed: false, message: 'This beta build is missing its access configuration.' };
  try {
    const identity = betaDeviceIdentity();
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...identity, version: app.getVersion() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Access service returned ${response.status}.`);
    const envelope = await response.json();
    const publicKey = crypto.createPublicKey({ key: Buffer.from(config.publicKey, 'base64'), format: 'der', type: 'spki' });
    const valid = crypto.verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64url'));
    if (!valid) throw new Error('The access response signature is invalid.');
    const access = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    if (access.deviceId !== identity.deviceId || Date.parse(access.expiresAt) <= Date.now()) throw new Error('The access lease is invalid or expired.');
    betaAccessExpiresAt = Date.parse(access.expiresAt);
    return access;
  } catch (error) {
    if (Date.now() < betaAccessExpiresAt) return { allowed: true, temporaryOffline: true };
    return { allowed: false, message: `Click Interval Beta could not verify access. ${error.message}` };
  }
}

async function enforceBetaAccess() {
  const access = await checkBetaAccess();
  if (access.allowed) return true;
  await dialog.showMessageBox({ type: 'error', title: 'Click Interval Beta', message: access.message || 'You have been locked out of Click Interval, as the beta is done. Please uninstall this version and install the newest version, or ask the owner for the direct installer.' });
  quitCleanly(true);
  return false;
}

nativeTheme.themeSource = 'dark';
app.setName(productName);
process.title = productName;
app.setAppUserModelId(isBetaChannel ? 'ClickInterval.Beta' : 'ClickInterval.1.5');

function showMainProcessError(error) {
  const message = String(error?.message || error || 'An unexpected error occurred.');
  if (!app.isReady() || !window || window.isDestroyed()) {
    pendingMainProcessError = message;
    return;
  }
  createMessageWindow({ title: 'Click Interval error', message, icon: 'alert' }, window).catch(() => {});
}

process.on('uncaughtException', error => showMainProcessError(error));
process.on('unhandledRejection', error => showMainProcessError(error));

const testUserDataPath = process.env.OP_MOUSE_TEST === '1' && process.env.CLICK_INTERVAL_TEST_USER_DATA
  ? path.resolve(process.env.CLICK_INTERVAL_TEST_USER_DATA)
  : '';
const userDataPath = testUserDataPath || path.join(app.getPath('appData'), isBetaChannel ? 'click-interval-beta' : 'click-interval');
app.setPath('userData', userDataPath);
const hasSingleInstanceLock = process.env.OP_MOUSE_TEST === '1' || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function durableDataDirectory() {
  return path.join(app.getPath('documents'), isBetaChannel ? 'Click Interval Beta' : 'Click Interval');
}

function settingsDirectory() {
  return path.join(durableDataDirectory(), 'Settings');
}

function refreshToolboxIconCacheOnce() {
  if (process.platform !== 'win32') return;
  const marker = path.join(settingsDirectory(), '.toolbox-icon-cache-v1');
  try {
    if (fs.existsSync(marker)) return;
    const refresher = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'ie4uinit.exe');
    if (!fs.existsSync(refresher)) return;
    for (const argument of ['-ClearIconCache', '-show']) {
      const child = spawn(refresher, [argument], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.unref();
    }
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, `${app.getVersion()}\n`, 'utf8');
  } catch (_) {}
}

function hotkeySettingsPath() {
  return path.join(settingsDirectory(), 'hotkey-settings.json');
}

function preferenceSettingsPath() {
  return path.join(settingsDirectory(), 'preferences.json');
}

function macroStatePath() {
  return path.join(settingsDirectory(), 'last-macro.json');
}

function macroLibraryPath() {
  return path.join(settingsDirectory(), 'macro-library.json');
}

function macrosDirectory() {
  return path.join(durableDataDirectory(), 'Macros');
}

function migrateLegacyData() {
  const legacyFiles = ['hotkey-settings.json', 'preferences.json', 'last-macro.json', 'macro-library.json'];
  fs.mkdirSync(settingsDirectory(), { recursive: true });
  fs.mkdirSync(macrosDirectory(), { recursive: true });
  for (const fileName of legacyFiles) {
    const source = path.join(userDataPath, fileName);
    const destination = path.join(settingsDirectory(), fileName);
    try {
      if (!fs.existsSync(destination) && fs.existsSync(source)) fs.copyFileSync(source, destination);
    } catch (_) {}
  }
  const sourceDirectory = path.join(userDataPath, 'Macros');
  try {
    if (!fs.existsSync(sourceDirectory)) return;
    fs.mkdirSync(macrosDirectory(), { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() === '.cimacro') {
        const jsonReplacement = path.join(macrosDirectory(), `${path.basename(entry.name, path.extname(entry.name))}.json`);
        if (fs.existsSync(jsonReplacement)) continue;
      }
      const destination = path.join(macrosDirectory(), entry.name);
      if (!fs.existsSync(destination)) fs.copyFileSync(path.join(sourceDirectory, entry.name), destination);
    }
  } catch (_) {}
}

function stopSmartActivationMonitor() {
  if (smartActivationTimer) clearTimeout(smartActivationTimer);
  smartActivationTimer = null;
  smartActivationScanning = false;
}

function parseTriggerColor(value) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value || ''));
  if (!match) return [0, 0, 255];
  return [Number.parseInt(match[3], 16), Number.parseInt(match[2], 16), Number.parseInt(match[1], 16)];
}

function findColorMatch(image, color, tolerance, requiredCoverage) {
  const size = image.getSize();
  const scale = Math.min(1, 320 / Math.max(1, size.width));
  const sample = scale < 1 ? image.resize({ width: Math.max(1, Math.round(size.width * scale)) }) : image;
  const sampleSize = sample.getSize();
  const bitmap = sample.toBitmap();
  const target = parseTriggerColor(color);
  const allowed = Math.max(1, Number(tolerance) || 30);
  let matches = 0;
  let samples = 0;
  for (let offset = 0; offset < bitmap.length; offset += 16) {
    const difference = (Math.abs(bitmap[offset] - target[0]) + Math.abs(bitmap[offset + 1] - target[1]) + Math.abs(bitmap[offset + 2] - target[2])) / 3;
    if (difference <= allowed) matches += 1;
    samples += 1;
  }
  const coverage = samples ? matches / samples : 0;
  return { matched: coverage * 100 >= Math.max(0.1, Number(requiredCoverage) || 5), confidence: Math.min(100, Math.round(coverage * 1000) / 10) };
}

function findScreenChange(image, previousImage, threshold) {
  const current = image.resize({ width: Math.min(160, image.getSize().width) });
  if (!previousImage || previousImage.isEmpty()) return { matched: false, confidence: 0, frame: current };
  const previous = previousImage.resize({ width: current.getSize().width, height: current.getSize().height });
  const currentBitmap = current.toBitmap();
  const previousBitmap = previous.toBitmap();
  let difference = 0;
  let samples = 0;
  for (let offset = 0; offset < Math.min(currentBitmap.length, previousBitmap.length); offset += 16) {
    difference += Math.abs(currentBitmap[offset] - previousBitmap[offset]);
    difference += Math.abs(currentBitmap[offset + 1] - previousBitmap[offset + 1]);
    difference += Math.abs(currentBitmap[offset + 2] - previousBitmap[offset + 2]);
    samples += 3;
  }
  const percent = samples ? difference / samples / 255 * 100 : 0;
  return { matched: percent >= Math.max(1, Number(threshold) || 10), confidence: Math.min(100, Math.round(percent)), frame: current };
}

function cropSmartSearchArea(image, config, display) {
  const size = image.getSize();
  let bounds = { x: 0, y: 0, width: size.width, height: size.height };
  if (config.areaMode === 'center') {
    bounds = { x: Math.round(size.width * 0.25), y: Math.round(size.height * 0.25), width: Math.round(size.width * 0.5), height: Math.round(size.height * 0.5) };
  } else if (config.areaMode === 'custom') {
    const scaleX = size.width / Math.max(1, display.size.width);
    const scaleY = size.height / Math.max(1, display.size.height);
    bounds = {
      x: Math.round(Math.max(0, Number(config.area?.x) || 0) * scaleX),
      y: Math.round(Math.max(0, Number(config.area?.y) || 0) * scaleY),
      width: Math.round(Math.max(1, Number(config.area?.width) || 1) * scaleX),
      height: Math.round(Math.max(1, Number(config.area?.height) || 1) * scaleY)
    };
    bounds.x = Math.min(bounds.x, size.width - 1);
    bounds.y = Math.min(bounds.y, size.height - 1);
    bounds.width = Math.max(1, Math.min(bounds.width, size.width - bounds.x));
    bounds.height = Math.max(1, Math.min(bounds.height, size.height - bounds.y));
  }
  return image.crop(bounds);
}

async function scanSmartActivation() {
  if (smartActivationScanning || !smartActivationConfig) return;
  const monitor = smartActivationConfig;
  const triggers = Array.isArray(monitor.triggers) ? monitor.triggers : [];
  if (!monitor.active || !triggers.length) return;
  smartActivationScanning = true;
  try {
    const now = Date.now();
    const due = triggers.filter(config => {
      const kind = ['visual', 'screen'].includes(config.kind) ? config.kind : 'visual';
      if (!config.enabled) return false;
      const state = smartActivationStates.get(config.id);
      return !state || now >= state.nextScanAt;
    });
    if (!due.length) return;
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width, height: display.size.height },
      fetchWindowIcons: false
    });
    const source = sources.find(item => String(item.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('The screen could not be captured.');
    for (const config of due) {
      const kind = ['visual', 'screen'].includes(config.kind) ? config.kind : 'visual';
      const state = smartActivationStates.get(config.id) || {
        fingerprint: JSON.stringify(config), lastMatched: null, seen: false, lastTriggerAt: 0, previousFrame: null, nextScanAt: 0
      };
      state.nextScanAt = now + Math.max(100, Number(config.scanInterval) || 250);
      try {
        const searchImage = cropSmartSearchArea(source.thumbnail, config, display);
        let result;
        if (kind === 'visual') {
          result = findColorMatch(searchImage, config.color, config.colorTolerance, config.colorCoverage);
        } else if (kind === 'screen') {
          result = findScreenChange(searchImage, state.previousFrame, config.changeThreshold);
          state.previousFrame = result.frame;
        }
        if (result.matched) state.seen = true;
        const changed = state.lastMatched === null || result.matched !== state.lastMatched;
        const negativeCondition = ['below', 'still'].includes(config.condition);
        const shouldTrigger = negativeCondition
          ? state.seen && state.lastMatched === true && !result.matched
          : result.matched && state.lastMatched !== true;
        const cooledDown = now - state.lastTriggerAt >= Math.max(0, Number(config.cooldown) || 0);
        if (shouldTrigger && cooledDown) state.lastTriggerAt = now;
        if (changed || (shouldTrigger && cooledDown)) {
          sendToRenderer('smart-activation-status', {
            macroId: monitor.macroId,
            triggerId: config.id,
            matched: result.matched,
            confidence: result.confidence,
            triggered: Boolean(shouldTrigger && cooledDown)
          });
        }
        state.lastMatched = result.matched;
        smartActivationStates.set(config.id, state);
      } catch (error) {
        sendToRenderer('smart-activation-status', { macroId: monitor.macroId, triggerId: config.id, matched: false, triggered: false, error: error.message });
      }
    }
  } catch (error) {
    sendToRenderer('smart-activation-status', { macroId: monitor.macroId, matched: false, triggered: false, error: error.message });
  } finally {
    smartActivationScanning = false;
    if (smartActivationConfig === monitor && monitor.active && monitor.triggers?.length) {
      smartActivationTimer = setTimeout(scanSmartActivation, 100);
    }
  }
}

function configureSmartActivation(config = {}) {
  const normalized = {
    active: Boolean(config.active),
    macroId: config.macroId || null,
    triggers: Array.isArray(config.triggers) ? config.triggers.map((trigger, index) => ({
      ...trigger,
      id: String(trigger.id || `trigger-${index}`),
      enabled: trigger.enabled !== false
    })) : []
  };
  const signature = JSON.stringify(normalized);
  if (signature === smartActivationSignature) return;
  const nextStates = new Map();
  for (const trigger of normalized.triggers) {
    const existing = smartActivationStates.get(trigger.id);
    const fingerprint = JSON.stringify(trigger);
    if (existing?.fingerprint === fingerprint) nextStates.set(trigger.id, existing);
    else nextStates.set(trigger.id, { fingerprint, lastMatched: null, seen: false, lastTriggerAt: 0, previousFrame: null, nextScanAt: 0 });
  }
  smartActivationSignature = signature;
  smartActivationConfig = normalized;
  smartActivationStates = nextStates;
  stopSmartActivationMonitor();
  if (normalized.active && normalized.triggers.length) scanSmartActivation();
}

function safeMacroFileName(name) {
  const cleaned = String(name || 'My Macro').slice(0, 40).replace(/[<>:"/\\|?*]/g, '_').trim();
  return `${cleaned || 'My Macro'}.json`;
}

function pathInsideMacrosDirectory(filePath) {
  if (!filePath) return false;
  const root = `${path.resolve(macrosDirectory())}${path.sep}`.toLowerCase();
  return path.resolve(filePath).toLowerCase().startsWith(root);
}

function uniqueManagedMacroPath(name, currentPath = '') {
  fs.mkdirSync(macrosDirectory(), { recursive: true });
  const preferred = path.join(macrosDirectory(), safeMacroFileName(name));
  if (currentPath && pathInsideMacrosDirectory(currentPath)) return path.resolve(currentPath);
  if (!fs.existsSync(preferred)) return preferred;
  const extension = path.extname(preferred);
  const stem = preferred.slice(0, -extension.length);
  let suffix = 2;
  while (fs.existsSync(`${stem} (${suffix})${extension}`)) suffix += 1;
  return `${stem} (${suffix})${extension}`;
}

function writeManagedMacro(payload, currentPath = '') {
  const filePath = uniqueManagedMacroPath(payload.name, currentPath);
  const document = {
    format: 'click-interval-macro',
    version: 1,
    id: payload.id || crypto.randomUUID(),
    name: String(payload.name || 'My Macro').slice(0, 40),
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
  };
  const storageDocument = { ...document, version: 2, actions: packMacroActions(document.actions) };
  const serialized = JSON.stringify(storageDocument);
  fs.writeFileSync(filePath, serialized, 'utf8');
  return { filePath, document, fileSize: Buffer.byteLength(serialized, 'utf8') };
}

function scanManagedMacros() {
  fs.mkdirSync(macrosDirectory(), { recursive: true });
  const macros = [];
  for (const entry of fs.readdirSync(macrosDirectory(), { withFileTypes: true })) {
    if (!entry.isFile() || !['.json', '.cimacro'].includes(path.extname(entry.name).toLowerCase())) continue;
    const filePath = path.join(macrosDirectory(), entry.name);
    try {
      const storedDocument = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!storedDocument || !Array.isArray(storedDocument.actions)) continue;
      const document = { ...storedDocument, actions: unpackMacroActions(storedDocument.actions) };
      let stat = fs.statSync(filePath);
      if (Number(storedDocument.version) < 2) {
        const compactDocument = { ...storedDocument, version: 2, actions: packMacroActions(document.actions) };
        const compactJson = JSON.stringify(compactDocument);
        if (Buffer.byteLength(compactJson, 'utf8') < stat.size) {
          fs.writeFileSync(filePath, compactJson, 'utf8');
          stat = fs.statSync(filePath);
        }
      }
      macros.push({
        id: typeof document.id === 'string' && document.id ? document.id : crypto.createHash('sha1').update(filePath.toLowerCase()).digest('hex'),
        name: String(document.name || path.basename(entry.name, path.extname(entry.name))).slice(0, 40),
        actions: document.actions,
        settings: document.settings && typeof document.settings === 'object' ? document.settings : {},
        filePath,
        fileSize: stat.size,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
      });
    } catch (_) {}
  }
  return macros.sort((left, right) => left.name.localeCompare(right.name));
}

function updateConfigPath() {
  return path.join(__dirname, 'update-config.json');
}

function loadUpdateConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(updateConfigPath(), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

function loadPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(preferenceSettingsPath(), 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

const defaultAppSettings = {
  alwaysOnTop: true,
  autoUpdate: false,
  reopenAfterUpdate: true,
  keepMinecraftServerRunningDuringUpdate: true,
  backgroundTools: [],
  showActiveIndicator: false,
  activeIndicatorPosition: 'bottom-right',
  activeIndicatorPoint: null,
  showCpsIndicator: false,
  cpsIndicatorPosition: 'bottom-right',
  cpsIndicatorPoint: null,
  cpsIncludePhysicalClicks: true,
  showCpsAlways: false,
  cpsDisplayMode: 'total',
  showInputDisplay: false,
  inputDisplayPosition: 'bottom-right',
  inputDisplayPoint: null,
  inputDisplayScale: 100,
  inputDisplayLingerMs: 900,
  inputDisplayMouse: true,
  inputDisplayKeyboard: true,
  inputDisplayPhysical: true,
  inputDisplayGenerated: true,
  inputDisplayAccent: '#42a5f5',
  inputDisplayBackground: '#11151a',
  inputDisplayText: '#ffffff',
  inputDisplayOpacity: 88,
  theme: 'obsidian',
  customTheme: {
    accent: '#1683c7',
    main: '#101010',
    shadow: '#000000',
    text: '#ffffff',
    highlight: '#42a5f5',
    scrollbarTrack: '#191919',
    scrollbarThumb: '#575757',
    scrollbarThumbHover: '#777777'
  },
  language: 'en'
};

function loadAppSettings() {
  if (cachedAppSettings) return cachedAppSettings;
  const stored = loadPreferences().appSettings;
  cachedAppSettings = normalizeAppSettings({ ...defaultAppSettings, ...(stored && typeof stored === 'object' ? stored : {}) });
  return cachedAppSettings;
}

function normalizeAppSettings(value) {
  const positions = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'];
  const themes = ['obsidian', 'light', 'crimson', 'ocean', 'rose', 'custom'];
  const languages = ['en', 'ar', 'fr', 'ru'];
  const normalizeColor = (candidate, fallback) => /^#[0-9a-f]{6}$/i.test(String(candidate || '')) ? String(candidate).toLowerCase() : fallback;
  const storedCustomTheme = value?.customTheme || {};
  const legacyCustomDefault = String(storedCustomTheme.accent).toLowerCase() === '#7c5cff'
    && String(storedCustomTheme.main).toLowerCase() === '#17141f'
    && String(storedCustomTheme.shadow).toLowerCase() === '#08060f'
    && String(storedCustomTheme.text).toLowerCase() === '#ffffff'
    && !storedCustomTheme.highlight;
  const customThemeSource = legacyCustomDefault ? defaultAppSettings.customTheme : storedCustomTheme;
  const customTheme = {
    accent: normalizeColor(customThemeSource.accent, defaultAppSettings.customTheme.accent),
    main: normalizeColor(customThemeSource.main, defaultAppSettings.customTheme.main),
    shadow: normalizeColor(customThemeSource.shadow, defaultAppSettings.customTheme.shadow),
    text: normalizeColor(customThemeSource.text, defaultAppSettings.customTheme.text),
    highlight: normalizeColor(customThemeSource.highlight, defaultAppSettings.customTheme.highlight),
    scrollbarTrack: normalizeColor(customThemeSource.scrollbarTrack, defaultAppSettings.customTheme.scrollbarTrack),
    scrollbarThumb: normalizeColor(customThemeSource.scrollbarThumb, defaultAppSettings.customTheme.scrollbarThumb),
    scrollbarThumbHover: normalizeColor(customThemeSource.scrollbarThumbHover, defaultAppSettings.customTheme.scrollbarThumbHover)
  };
  const backgroundTools = availableTools.filter(tool => Array.isArray(value?.backgroundTools) && value.backgroundTools.includes(tool));
  const normalizePoint = point => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    ? { x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) }
    : null;
  return {
    alwaysOnTop: value?.alwaysOnTop !== false,
    autoUpdate: Boolean(value?.autoUpdate),
    reopenAfterUpdate: Boolean(value?.reopenAfterUpdate),
    keepMinecraftServerRunningDuringUpdate: value?.keepMinecraftServerRunningDuringUpdate !== false,
    backgroundTools,
    showActiveIndicator: Boolean(value?.showActiveIndicator),
    activeIndicatorPosition: positions.includes(value?.activeIndicatorPosition) ? value.activeIndicatorPosition : 'bottom-right',
    activeIndicatorPoint: normalizePoint(value?.activeIndicatorPoint),
    showCpsIndicator: Boolean(value?.showCpsIndicator),
    cpsIndicatorPosition: positions.includes(value?.cpsIndicatorPosition) ? value.cpsIndicatorPosition : 'bottom-right',
    cpsIndicatorPoint: normalizePoint(value?.cpsIndicatorPoint),
    cpsIncludePhysicalClicks: value?.cpsIncludePhysicalClicks !== false,
    showCpsAlways: Boolean(value?.showCpsAlways),
    cpsDisplayMode: value?.cpsDisplayMode === 'left-right' ? 'left-right' : 'total',
    showInputDisplay: Boolean(value?.showInputDisplay),
    inputDisplayPosition: defaultAppSettings.inputDisplayPosition,
    inputDisplayPoint: defaultAppSettings.inputDisplayPoint,
    inputDisplayScale: defaultAppSettings.inputDisplayScale,
    inputDisplayLingerMs: defaultAppSettings.inputDisplayLingerMs,
    inputDisplayMouse: defaultAppSettings.inputDisplayMouse,
    inputDisplayKeyboard: defaultAppSettings.inputDisplayKeyboard,
    inputDisplayPhysical: defaultAppSettings.inputDisplayPhysical,
    inputDisplayGenerated: defaultAppSettings.inputDisplayGenerated,
    inputDisplayAccent: defaultAppSettings.inputDisplayAccent,
    inputDisplayBackground: defaultAppSettings.inputDisplayBackground,
    inputDisplayText: defaultAppSettings.inputDisplayText,
    inputDisplayOpacity: defaultAppSettings.inputDisplayOpacity,
    theme: themes.includes(value?.theme) ? value.theme : 'obsidian',
    customTheme,
    language: languages.includes(value?.language) ? value.language : 'en'
  };
}

const themeColors = {
  obsidian: { background: '#101010', symbols: '#ffffff' },
  light: { background: '#dedede', symbols: '#111111' },
  crimson: { background: '#b90824', symbols: '#ffffff' },
  ocean: { background: '#0769d5', symbols: '#ffffff' },
  rose: { background: '#d51f7c', symbols: '#ffffff' }
};

function activeThemeColors(settings = loadAppSettings()) {
  if (settings.theme === 'custom') return { background: settings.customTheme.main, symbols: settings.customTheme.text };
  return themeColors[settings.theme] || themeColors.obsidian;
}

function applyNativeTheme(targetWindow, settings = loadAppSettings()) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const colors = activeThemeColors(settings);
  targetWindow.setBackgroundColor(colors.background);
  if (typeof targetWindow.setBackgroundMaterial === 'function') {
    try { targetWindow.setBackgroundMaterial(colors.material || 'none'); } catch (_) {}
  }
}

function savePreferences(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    fs.mkdirSync(path.dirname(preferenceSettingsPath()), { recursive: true });
    const current = loadPreferences();
    fs.writeFileSync(preferenceSettingsPath(), JSON.stringify({ ...current, ...value }, null, 2), 'utf8');
    if (Object.prototype.hasOwnProperty.call(value, 'appSettings')) {
      cachedAppSettings = null;
      cachedAppSettings = normalizeAppSettings({
        ...defaultAppSettings,
        ...(value.appSettings && typeof value.appSettings === 'object' ? value.appSettings : {})
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function loadMacroState() {
  try {
    const value = JSON.parse(fs.readFileSync(macroStatePath(), 'utf8'));
    return value && Array.isArray(value.actions) ? value : { name: 'My Macro', actions: [] };
  } catch (_) {
    return { name: 'My Macro', actions: [] };
  }
}

function saveMacroState(value) {
  if (!value || !Array.isArray(value.actions)) return false;
  try {
    fs.mkdirSync(path.dirname(macroStatePath()), { recursive: true });
    fs.writeFileSync(macroStatePath(), JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeMacroLibrary(value) {
  const macros = value && Array.isArray(value.macros)
    ? value.macros.filter(item => item && typeof item.name === 'string' && Array.isArray(item.actions))
    : [];
  return {
    version: Number(value?.version) || 1,
    selectedId: macros.some(item => item.id === value?.selectedId) ? value.selectedId : (macros[0]?.id || null),
    macros
  };
}

function loadMacroLibrary() {
  let stored;
  let needsMigration = false;
  try {
    const raw = JSON.parse(fs.readFileSync(macroLibraryPath(), 'utf8'));
    stored = normalizeMacroLibrary(raw);
    needsMigration = stored.version < 2;
  } catch (_) {
    const legacy = loadMacroState();
    const now = new Date().toISOString();
    stored = legacy.actions.length ? {
      version: 1,
      selectedId: crypto.randomUUID(),
      macros: [{ id: '', name: legacy.name || 'My Macro', actions: legacy.actions, settings: {}, createdAt: now, updatedAt: now }]
    } : { version: 1, selectedId: null, macros: [] };
    if (stored.macros.length) stored.macros[0].id = stored.selectedId;
    needsMigration = true;
  }
  const managed = scanManagedMacros();
  const storedMetadata = new Map(stored.macros.map(macro => [macro.id, macro]));
  for (const macro of managed) {
    const metadata = storedMetadata.get(macro.id);
    macro.pinned = Boolean(metadata?.pinned);
    macro.pinnedAt = metadata?.pinnedAt || '';
    macro.lastUsedAt = metadata?.lastUsedAt || metadata?.updatedAt || macro.updatedAt;
  }
  const managedIds = new Set(managed.map(item => item.id));
  if (needsMigration) {
    for (const macro of stored.macros) {
      if (managedIds.has(macro.id)) continue;
      const saved = writeManagedMacro(macro, pathInsideMacrosDirectory(macro.filePath) ? macro.filePath : '');
      managed.push({ ...macro, id: saved.document.id, filePath: saved.filePath, fileSize: saved.fileSize });
      managedIds.add(saved.document.id);
    }
  }
  const library = normalizeMacroLibrary({ version: 2, selectedId: stored.selectedId, macros: managed });
  saveMacroLibrary(library);
  return library;
}

function saveMacroLibrary(value) {
  const normalized = normalizeMacroLibrary(value);
  try {
    fs.mkdirSync(path.dirname(macroLibraryPath()), { recursive: true });
    const index = {
      version: Math.max(2, normalized.version),
      selectedId: normalized.selectedId,
      macros: normalized.macros.map(macro => ({
        id: macro.id,
        name: macro.name,
        actions: [],
        filePath: macro.filePath || '',
        pinned: Boolean(macro.pinned),
        pinnedAt: macro.pinnedAt || '',
        lastUsedAt: macro.lastUsedAt || '',
        createdAt: macro.createdAt || '',
        updatedAt: macro.updatedAt || ''
      }))
    };
    fs.writeFileSync(macroLibraryPath(), JSON.stringify(index), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function validHotkey(value) {
  return value && Number.isInteger(value.vk) && typeof value.name === 'string' &&
    typeof value.shortName === 'string';
}

function loadHotkey() {
  try {
    const value = JSON.parse(fs.readFileSync(hotkeySettingsPath(), 'utf8'));
    return validHotkey(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function saveHotkey(value) {
  if (!validHotkey(value)) return false;
  try {
    fs.mkdirSync(path.dirname(hotkeySettingsPath()), { recursive: true });
    fs.writeFileSync(hotkeySettingsPath(), JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function keepAboveFullscreenApps(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.isMinimized()) return;
  targetWindow.setAlwaysOnTop(true, 'screen-saver');
  targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (hoverHintRequest && hoverHintOwnerId === targetWindow.webContents.id) {
    setImmediate(() => raiseHoverHintAboveOwner());
  }
}

function applyAppWindowLevel(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.isMinimized()) return;
  if (loadAppSettings().alwaysOnTop) {
    keepAboveFullscreenApps(targetWindow);
    return;
  }
  targetWindow.setAlwaysOnTop(false);
  targetWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });
}

function exactOverlayBounds(point, width, height) {
  if (!point) return null;
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(area.x + area.width - width, Math.round(point.x - width / 2))),
    y: Math.max(area.y, Math.min(area.y + area.height - height, Math.round(point.y - height / 2)))
  };
}

function activeIndicatorBounds(position, settings = loadAppSettings()) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 42;
  const height = 52;
  const exact = exactOverlayBounds(settings.activeIndicatorPoint, width, height);
  if (exact) return exact;
  const margin = 18;
  const locations = {
    'top-left': { x: workArea.x + margin, y: workArea.y + margin },
    'top-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin },
    center: { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2) },
    'bottom-left': { x: workArea.x + margin, y: workArea.y + workArea.height - height - margin },
    'bottom-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + workArea.height - height - margin }
  };
  return { width, height, ...(locations[position] || locations['bottom-right']) };
}

function cpsIndicatorBounds(position, settings = loadAppSettings()) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 112;
  const height = 42;
  const exact = exactOverlayBounds(settings.cpsIndicatorPoint, width, height);
  if (exact) return exact;
  const margin = 18;
  const locations = {
    'top-left': { x: workArea.x + margin, y: workArea.y + margin },
    'top-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin },
    center: { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2) },
    'bottom-left': { x: workArea.x + margin, y: workArea.y + workArea.height - height - margin },
    'bottom-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + workArea.height - height - margin }
  };
  const result = { ...(locations[position] || locations['bottom-right']) };
  if (settings.showActiveIndicator && settings.activeIndicatorPosition === position) {
    if (position.endsWith('left')) result.x += 50;
    else if (position.endsWith('right')) result.x -= width + 8;
    else result.x += 31;
  }
  return { width, height, ...result };
}

function inputDisplayBounds(position, settings = loadAppSettings()) {
  const { workArea } = screen.getPrimaryDisplay();
  const scale = settings.inputDisplayScale / 100;
  const baseWidth = settings.inputDisplayMouse && settings.inputDisplayKeyboard ? 300 : settings.inputDisplayMouse ? 94 : 215;
  const width = Math.round(baseWidth * scale);
  const height = Math.round(112 * scale);
  const exact = exactOverlayBounds(settings.inputDisplayPoint, width, height);
  if (exact) return exact;
  const margin = 18;
  const locations = {
    'top-left': { x: workArea.x + margin, y: workArea.y + margin },
    'top-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + margin },
    center: { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + Math.round((workArea.height - height) / 2) },
    'bottom-left': { x: workArea.x + margin, y: workArea.y + workArea.height - height - margin },
    'bottom-right': { x: workArea.x + workArea.width - width - margin, y: workArea.y + workArea.height - height - margin }
  };
  return { width, height, ...(locations[position] || locations['bottom-right']) };
}

function indicatorFadeState(targetWindow) {
  let state = indicatorFadeStates.get(targetWindow);
  if (!state) {
    state = { generation: 0, timer: null };
    indicatorFadeStates.set(targetWindow, state);
  }
  return state;
}

function cancelIndicatorFade(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return null;
  const state = indicatorFadeState(targetWindow);
  state.generation += 1;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  return state;
}

function hideIndicatorWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  cancelIndicatorFade(targetWindow);
  // Reset opacity before hiding so DWM never reuses a fully opaque stale frame
  // when this transparent layered window is shown again.
  targetWindow.setOpacity(0);
  targetWindow.hide();
}

async function showIndicatorWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.isVisible()) return;
  const state = cancelIndicatorFade(targetWindow);
  const generation = state.generation;
  targetWindow.setOpacity(0);
  targetWindow.showInactive();

  // Let Chromium commit the indicator's current DOM for two frames while the
  // native window is still transparent. This prevents the one-frame flash of
  // old/blank content that layered Electron windows can otherwise display.
  try {
    await targetWindow.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true
    );
  } catch (_) {}
  if (targetWindow.isDestroyed() || !targetWindow.isVisible() || state.generation !== generation) return;

  const startedAt = Date.now();
  const step = () => {
    if (targetWindow.isDestroyed() || !targetWindow.isVisible() || state.generation !== generation) return;
    const progress = Math.min(1, (Date.now() - startedAt) / indicatorFadeDurationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    targetWindow.setOpacity(eased);
    if (progress < 1) state.timer = setTimeout(step, 16);
    else state.timer = null;
  };
  step();
}

async function updateActiveIndicator(running = clickerRunning) {
  clickerRunning = Boolean(running);
  const settings = loadAppSettings();
  if (!clickerRunning || !settings.showActiveIndicator) {
    hideIndicatorWindow(activeIndicatorWindow);
    return;
  }
  if (!activeIndicatorWindow || activeIndicatorWindow.isDestroyed()) {
    activeIndicatorWindow = new BrowserWindow({
      ...activeIndicatorBounds(settings.activeIndicatorPosition, settings), frame: false, transparent: true,
      backgroundColor: '#00000000', show: false, opacity: 0, focusable: false, resizable: false,
      movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      alwaysOnTop: true, hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    activeIndicatorWindow.setIgnoreMouseEvents(true, { forward: true });
    activeIndicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    activeIndicatorWindow.on('closed', () => { activeIndicatorWindow = null; });
    await activeIndicatorWindow.loadFile('active-indicator.html');
  }
  const latestSettings = loadAppSettings();
  if (!clickerRunning || !latestSettings.showActiveIndicator) {
    hideIndicatorWindow(activeIndicatorWindow);
    return;
  }
  activeIndicatorWindow.setBounds(activeIndicatorBounds(latestSettings.activeIndicatorPosition, latestSettings));
  activeIndicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  await showIndicatorWindow(activeIndicatorWindow);
}

async function updateCpsIndicator(cps = currentGeneratedCps, running = clickerRunning, button = currentGeneratedButton) {
  currentGeneratedCps = clickerRunning || running ? Math.max(0, Number(cps) || 0) : 0;
  if (button === 'Left' || button === 'Right' || button === 'Middle') currentGeneratedButton = button;
  const settings = loadAppSettings();
  const now = Date.now();
  physicalClickTimes = physicalClickTimes.filter(click => (typeof click === 'number' ? click : click.time) > now - 1000);
  macroClickTimes = macroClickTimes.filter(click => click.time > now - 1000);
  const activityRunning = clickerRunning || macroPlaybackRunning || macroClickTimes.length > 0
    || (settings.cpsIncludePhysicalClicks && physicalClickTimes.length > 0);
  if (!settings.showCpsIndicator || (!activityRunning && !settings.showCpsAlways)) {
    hideIndicatorWindow(cpsIndicatorWindow);
    return;
  }
  if (!cpsIndicatorWindow || cpsIndicatorWindow.isDestroyed()) {
    cpsIndicatorWindow = new BrowserWindow({
      ...cpsIndicatorBounds(settings.cpsIndicatorPosition, settings), frame: false, transparent: true,
      backgroundColor: '#00000000', show: false, opacity: 0, focusable: false, resizable: false,
      movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      alwaysOnTop: true, hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'cps-indicator-preload.js'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    cpsIndicatorWindow.setIgnoreMouseEvents(true, { forward: true });
    cpsIndicatorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    cpsIndicatorWindow.on('closed', () => { cpsIndicatorWindow = null; });
    await cpsIndicatorWindow.loadFile('cps-indicator.html');
  }
  const latest = loadAppSettings();
  if (!latest.showCpsIndicator || (!activityRunning && !latest.showCpsAlways)) {
    hideIndicatorWindow(cpsIndicatorWindow);
    return;
  }
  cpsIndicatorWindow.setBounds(cpsIndicatorBounds(latest.cpsIndicatorPosition, latest));
  cpsIndicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  const physicalLeft = latest.cpsIncludePhysicalClicks
    ? physicalClickTimes.filter(click => typeof click !== 'number' && click.button === 'Left').length
    : 0;
  const physicalRight = latest.cpsIncludePhysicalClicks
    ? physicalClickTimes.filter(click => typeof click !== 'number' && click.button === 'Right').length
    : 0;
  const legacyPhysical = latest.cpsIncludePhysicalClicks
    ? physicalClickTimes.filter(click => typeof click === 'number').length
    : 0;
  const generatedLeft = currentGeneratedButton === 'Left' ? currentGeneratedCps : 0;
  const generatedRight = currentGeneratedButton === 'Right' ? currentGeneratedCps : 0;
  const macroLeft = macroClickTimes.filter(click => click.button === 'Left').length;
  const macroRight = macroClickTimes.filter(click => click.button === 'Right').length;
  const total = currentGeneratedCps + macroClickTimes.length + (latest.cpsIncludePhysicalClicks ? physicalClickTimes.length : 0);
  cpsIndicatorWindow.webContents.send('cps-indicator-value', {
    mode: latest.cpsDisplayMode,
    total,
    left: generatedLeft + macroLeft + physicalLeft + legacyPhysical,
    right: generatedRight + macroRight + physicalRight
  });
  await showIndicatorWindow(cpsIndicatorWindow);
}

async function ensureInputDisplayWindow(settings = loadAppSettings()) {
  if (inputDisplayWindow && !inputDisplayWindow.isDestroyed()) return inputDisplayWindow;
  if (inputDisplayLoadPromise) return inputDisplayLoadPromise;
  inputDisplayLoadPromise = (async () => {
    const target = new BrowserWindow({
      ...inputDisplayBounds(settings.inputDisplayPosition, settings), frame: false, transparent: true,
      backgroundColor: '#00000000', show: false, opacity: 0, focusable: false, resizable: false,
      movable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      alwaysOnTop: true, hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'input-display-preload.js'),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    inputDisplayWindow = target;
    target.setIgnoreMouseEvents(true, { forward: true });
    target.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    target.on('closed', () => {
      if (inputDisplayWindow === target) inputDisplayWindow = null;
      inputDisplayConfigSignature = '';
    });
    await target.loadFile('input-display.html');
    return target;
  })();
  try { return await inputDisplayLoadPromise; }
  finally { inputDisplayLoadPromise = null; }
}

async function updateInputDisplay(inputEvent = null) {
  const settings = loadAppSettings();
  if (!settings.showInputDisplay) {
    hideIndicatorWindow(inputDisplayWindow);
    return;
  }
  if (inputEvent) {
    if (inputEvent.source === 'physical' && !settings.inputDisplayPhysical) return;
    if (inputEvent.source !== 'physical' && !settings.inputDisplayGenerated) return;
    if (inputEvent.device === 'mouse' && !settings.inputDisplayMouse) return;
    if (inputEvent.device === 'keyboard' && !settings.inputDisplayKeyboard) return;
  }
  const target = await ensureInputDisplayWindow(settings);
  if (!target || target.isDestroyed()) return;
  const latest = loadAppSettings();
  if (!latest.showInputDisplay) { hideIndicatorWindow(target); return; }
  const configSignature = JSON.stringify({
    position: latest.inputDisplayPosition,
    point: latest.inputDisplayPoint,
    scale: latest.inputDisplayScale,
    linger: latest.inputDisplayLingerMs,
    mouse: latest.inputDisplayMouse,
    keyboard: latest.inputDisplayKeyboard,
    physical: latest.inputDisplayPhysical,
    generated: latest.inputDisplayGenerated,
    accent: latest.inputDisplayAccent,
    background: latest.inputDisplayBackground,
    text: latest.inputDisplayText,
    opacity: latest.inputDisplayOpacity
  });
  if (configSignature !== inputDisplayConfigSignature) {
    inputDisplayConfigSignature = configSignature;
    target.setBounds(inputDisplayBounds(latest.inputDisplayPosition, latest));
    target.setAlwaysOnTop(true, 'screen-saver');
    target.webContents.send('input-display-config', latest);
  }
  if (inputEvent) target.webContents.send('input-display-event', inputEvent);
  await showIndicatorWindow(target);
}

function queueInputDisplayUpdate(inputEvent) {
  const settings = loadAppSettings();
  if (!settings.showInputDisplay) return;
  if (inputEvent?.source === 'physical' && !settings.inputDisplayPhysical) return;
  if (inputEvent?.source !== 'physical' && !settings.inputDisplayGenerated) return;
  if (inputEvent?.device === 'mouse' && !settings.inputDisplayMouse) return;
  if (inputEvent?.device === 'keyboard' && !settings.inputDisplayKeyboard) return;
  const eventKey = `${String(inputEvent?.device || '')}:${String(inputEvent?.control || '')}`;
  if (pendingInputDisplayEvents.has(eventKey)) pendingInputDisplayEvents.delete(eventKey);
  pendingInputDisplayEvents.set(eventKey, inputEvent);
  while (pendingInputDisplayEvents.size > INPUT_DISPLAY_PENDING_LIMIT) {
    pendingInputDisplayEvents.delete(pendingInputDisplayEvents.keys().next().value);
  }
  if (inputDisplayDispatchTimer) return;
  inputDisplayDispatchTimer = setTimeout(() => {
    inputDisplayDispatchTimer = null;
    const pending = Array.from(pendingInputDisplayEvents.values());
    pendingInputDisplayEvents.clear();
    for (const event of pending) updateInputDisplay(event).catch(() => {});
  }, INPUT_DISPLAY_FRAME_MS);
}

function queueCpsIndicatorUpdate(cps = currentGeneratedCps, running = clickerRunning, button = currentGeneratedButton) {
  pendingCpsIndicatorUpdate = { cps, running, button };
  if (cpsIndicatorDispatchTimer) return;
  cpsIndicatorDispatchTimer = setTimeout(() => {
    cpsIndicatorDispatchTimer = null;
    const pending = pendingCpsIndicatorUpdate;
    pendingCpsIndicatorUpdate = null;
    if (pending) updateCpsIndicator(pending.cps, pending.running, pending.button).catch(() => {});
  }, CPS_INDICATOR_FRAME_MS);
}

function lockWindowZoom(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const reset = () => {
    if (!targetWindow.isDestroyed()) targetWindow.webContents.setZoomFactor(1);
  };
  targetWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  targetWindow.webContents.on('zoom-changed', event => {
    event.preventDefault();
    reset();
  });
  targetWindow.webContents.on('did-finish-load', reset);
}

function toolWindowSize(tool, detached = false) {
  const localized = loadAppSettings().language !== 'en';
  return { width: localized ? 520 : 437, height: detached ? 391 : 423 };
}

function resizeToolWindow(target, tool, detached = false) {
  if (!target || target.isDestroyed()) return;
  const size = toolWindowSize(tool, detached);
  target.setSize(size.width, size.height, true);
}

function registerCrosshairShortcut(accelerator = crosshairAccelerator) {
  if (accelerator === crosshairAccelerator && globalShortcut.isRegistered(accelerator)) return;
  try { globalShortcut.unregister(crosshairAccelerator); } catch (_) {}
  crosshairAccelerator = accelerator || 'CommandOrControl+Shift+F9';
  try {
    globalShortcut.register(crosshairAccelerator, () => {
      if (!crosshairConfig) return;
      crosshairConfig.enabled = !crosshairConfig.enabled;
      updateCrosshairOverlay(crosshairConfig);
      sendToRenderer('crosshair-toggle-state', { enabled: crosshairConfig.enabled });
    });
  } catch (_) {}
}

function crosshairAcceleratorFromHotkey(value) {
  if (!value || typeof value.label !== 'string') return 'CommandOrControl+Shift+F9';
  return value.label.split('+').map(part => part.trim()).filter(Boolean).map(part => {
    if (part === 'Ctrl' || part === 'Control') return 'CommandOrControl';
    if (part === 'Win' || part === 'Windows') return 'Super';
    if (part === 'Esc') return 'Escape';
    return part.replace(/\s+/g, '');
  }).join('+');
}

async function ensureCrosshairOverlay(displayId) {
  const displays = screen.getAllDisplays();
  const display = displays.find(item => String(item.id) === String(displayId)) || screen.getPrimaryDisplay();
  if (!crosshairOverlayWindow || crosshairOverlayWindow.isDestroyed()) {
    crosshairOverlayWindow = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'crosshair-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    crosshairOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
    crosshairOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    await crosshairOverlayWindow.loadFile('crosshair-overlay.html');
  }
  const currentBounds = crosshairOverlayWindow.getBounds();
  if (currentBounds.x !== display.bounds.x || currentBounds.y !== display.bounds.y || currentBounds.width !== display.bounds.width || currentBounds.height !== display.bounds.height) {
    crosshairOverlayWindow.setBounds(display.bounds);
  }
  if (!crosshairOverlayWindow.isAlwaysOnTop()) crosshairOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  return crosshairOverlayWindow;
}

function configureCrosshairBackend(config = crosshairConfig || {}) {
  const customExecutable = path.win32.basename(String(config.customGameExecutable || '').trim()).toLowerCase();
  const configuredProcesses = config.effectGame === 'custom'
    ? (customExecutable ? [customExecutable] : [])
    : (crosshairGameProcesses[config.effectGame] || []);
  writeBackend({
    action: 'configure',
    crosshair_process_names: configuredProcesses,
    crosshair_only_when_active: config.onlyWhenGameActive !== false,
    crosshair_effect_active: Boolean(config.enabled && toolIsOperational('crosshair'))
  });
}

function effectiveCrosshairConfig(config = crosshairConfig || {}) {
  return { ...config, enabled: Boolean(config.enabled && toolIsOperational('crosshair')) };
}

async function updateCrosshairOverlay(config = {}) {
  crosshairConfig = { ...(crosshairConfig || {}), ...config };
  configureCrosshairBackend(crosshairConfig);
  registerCrosshairShortcut(crosshairAcceleratorFromHotkey(crosshairConfig.hotkey));
  if (crosshairPreviewWindow && !crosshairPreviewWindow.isDestroyed()) crosshairPreviewWindow.webContents.send('crosshair-config', crosshairConfig);
  const overlay = await ensureCrosshairOverlay(crosshairConfig.displayId);
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('crosshair-config', effectiveCrosshairConfig(crosshairConfig));
  // Keep one transparent, click-through surface alive. Hiding and showing this
  // layered window made Windows briefly composite two overlay frames and flicker.
  if (!overlay.isVisible()) overlay.showInactive();
}

async function createCrosshairPreviewWindow(parentWindow = window) {
  if (crosshairPreviewWindow && !crosshairPreviewWindow.isDestroyed()) {
    crosshairPreviewWindow.show();
    crosshairPreviewWindow.focus();
    return;
  }
  crosshairPreviewWindow = new BrowserWindow({
    width: 340, height: 380, frame: false, resizable: false, maximizable: false,
    parent: parentWindow, modal: false, alwaysOnTop: false, backgroundColor: '#101010',
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'crosshair-preview-preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  lockWindowZoom(crosshairPreviewWindow);
  crosshairPreviewWindow.on('closed', () => { crosshairPreviewWindow = null; });
  await crosshairPreviewWindow.loadFile('crosshair-preview.html');
  if (crosshairConfig) crosshairPreviewWindow.webContents.send('crosshair-config', crosshairConfig);
  crosshairPreviewWindow.show();
}

function sendToRenderer(channel, payload) {
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && !target.webContents.isDestroyed()) target.webContents.send(channel, payload);
  }
}

function handleBackendPipeFailure(processHandle, error) {
  if (!processHandle || failedBackendProcesses.has(processHandle)) return;
  failedBackendProcesses.add(processHandle);
  if (processHandle !== backend || shuttingDown) return;
  backend = null;
  backendReady = false;
  try { processHandle.stdin.destroy(); } catch (_) {}
  try { processHandle.kill(); } catch (_) {}
  scheduleBackendRestart(`The click engine disconnected and is being restarted. ${String(error?.message || '').trim()}`.trim());
}

function sendBackendCommand(processHandle, command) {
  try {
    processHandle.stdin.write(`${JSON.stringify(command)}\n`, error => {
      if (error) handleBackendPipeFailure(processHandle, error);
    });
    return true;
  } catch (error) {
    handleBackendPipeFailure(processHandle, error);
    return false;
  }
}

function queuePendingBackendCommand(command) {
  const action = String(command?.action || '');
  if (action === 'macro_set_actions') {
    const existingIndex = pendingBackendCommands.findIndex(item => item?.action === action);
    if (existingIndex >= 0) pendingBackendCommands.splice(existingIndex, 1);
  }
  if (pendingBackendCommands.length >= BACKEND_PENDING_COMMAND_LIMIT) pendingBackendCommands.shift();
  pendingBackendCommands.push(command);
}

function pushBoundedClickHistory(history, entry) {
  history.push(entry);
  if (history.length > BACKEND_CLICK_HISTORY_LIMIT) history.splice(0, history.length - BACKEND_CLICK_HISTORY_LIMIT);
}

function scheduleBackendRestart(message = 'The click engine stopped and is being restarted.') {
  if (shuttingDown || backendRestartTimer) return;
  updateActiveIndicator(false);
  updateCpsIndicator(0, false);
  sendToRenderer('backend-event', { type: 'error', message });
  const delay = backendRestartDelayMs;
  backendRestartDelayMs = Math.min(2000, Math.round(backendRestartDelayMs * 1.8));
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = null;
    if (!shuttingDown) startBackend();
  }, delay);
}

function writeBackend(command) {
  if (!command || typeof command !== 'object') return false;
  if ((command.action || 'configure') === 'configure') {
    lastBackendConfiguration = { ...(lastBackendConfiguration || { action: 'configure' }), ...command, action: 'configure' };
  }
  const processHandle = backend;
  const usable = processHandle && processHandle.exitCode === null && !processHandle.killed &&
    processHandle.stdin && !processHandle.stdin.destroyed && processHandle.stdin.writable;
  if (!usable || !backendReady) {
    if ((command.action || 'configure') !== 'configure') queuePendingBackendCommand(command);
    if (!usable && !shuttingDown && !backendRestartTimer) startBackend();
    return true;
  }
  return sendBackendCommand(processHandle, command);
}

function publishPopupState(open) {
  sendToRenderer('popup-modal-state', { open: Boolean(open) });
}

function closeDropdownWindow() {
  const owner = dropdownOwnerId ? BrowserWindow.getAllWindows().find(target => target.webContents.id === dropdownOwnerId) : null;
  if (owner && dropdownOwnerBlurHandler) owner.removeListener('blur', dropdownOwnerBlurHandler);
  dropdownOwnerBlurHandler = null;
  if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send('custom-dropdown-closed', dropdownSelectId);
  dropdownOwnerId = null;
  dropdownSelectId = null;
  if (dropdownWindow && !dropdownWindow.isDestroyed()) dropdownWindow.destroy();
  dropdownWindow = null;
  if (owner && !owner.isDestroyed()) setImmediate(() => keepAboveFullscreenApps(owner));
}

async function openDropdownWindow(event, payload = {}) {
  const requestedId = String(payload.id || '');
  if (dropdownWindow && !dropdownWindow.isDestroyed() && dropdownOwnerId === event.sender.id && dropdownSelectId === requestedId) {
    closeDropdownWindow();
    return;
  }
  closeDropdownWindow();
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent || parent.isDestroyed() || !Array.isArray(payload.options) || !payload.options.length) return;
  const nonActivating = /^(toolContext|macroContext):/.test(String(payload.id || ''));
  const parentBounds = parent.getBounds();
  const anchorX = parentBounds.x + Math.round(Number(payload.x) || 0);
  const anchorTop = parentBounds.y + Math.round(Number(payload.y) || 0);
  const anchorBottom = anchorTop + Math.round(Number(payload.height) || 22);
  const width = Math.max(82, Math.min(180, Math.round(Number(payload.width) || 82)));
  const desiredHeight = payload.options.reduce((height, option) => height + (option.separator ? 7 : 23), 8);
  const display = screen.getDisplayMatching({ x: anchorX, y: anchorTop, width, height: 22 });
  const work = display.workArea;
  const below = work.y + work.height - anchorBottom - 3;
  const above = anchorTop - work.y - 3;
  const openBelow = desiredHeight <= below || below >= above;
  const available = Math.max(54, openBelow ? below : above);
  const height = Math.min(desiredHeight, available);
  const x = Math.max(work.x, Math.min(anchorX + Math.round(Number(payload.anchorWidth) || width) - width, work.x + work.width - width));
  const y = openBelow ? anchorBottom + 1 : anchorTop - height - 1;
  dropdownOwnerId = event.sender.id;
  dropdownSelectId = String(payload.id || '');
  dropdownWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: false,
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    focusable: !nonActivating,
    backgroundColor: '#181818',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    parent,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lockWindowZoom(dropdownWindow);
  keepAboveFullscreenApps(dropdownWindow);
  keepAboveFullscreenApps(parent);
  dropdownWindow.removeMenu();
  dropdownWindow.on('closed', () => {
    const owner = dropdownOwnerId ? BrowserWindow.getAllWindows().find(target => target.webContents.id === dropdownOwnerId) : null;
    if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send('custom-dropdown-closed', dropdownSelectId);
    dropdownWindow = null;
    dropdownOwnerId = null;
    dropdownSelectId = null;
  });
  if (!nonActivating) dropdownWindow.on('blur', () => closeDropdownWindow());
  await dropdownWindow.loadFile('dropdown.html');
  dropdownWindow.webContents.send('custom-dropdown-data', {
    id: dropdownSelectId,
    options: payload.options,
    value: payload.value,
    scrollable: height < desiredHeight
  });
  if (nonActivating) {
    dropdownOwnerBlurHandler = () => closeDropdownWindow();
    parent.once('blur', dropdownOwnerBlurHandler);
    dropdownWindow.showInactive();
  } else dropdownWindow.show();
}

async function showHoverHint(payload = {}, owner = null) {
  const text = String(payload.text || '').trim();
  if (!text || !owner || owner.isDestroyed()) return;
  if (hoverHintWindow && !hoverHintWindow.isDestroyed() && hoverHintOwnerId !== owner.webContents.id) hoverHintWindow.destroy();
  const token = ++hoverHintToken;
  hoverHintRequest = {
    token,
    text,
    pointerX: Math.round(Number(payload.x) || 0),
    pointerY: Math.round(Number(payload.y) || 0),
    width: Math.max(28, Math.ceil(Number(payload.width) || 28)),
    height: Math.max(26, Math.ceil(Number(payload.height) || 26)),
    sourceRect: {
      x: Math.round(Number(payload.sourceRect?.x) || 0),
      y: Math.round(Number(payload.sourceRect?.y) || 0),
      width: Math.max(1, Math.round(Number(payload.sourceRect?.width) || 1)),
      height: Math.max(1, Math.round(Number(payload.sourceRect?.height) || 1))
    }
  };
  if (!hoverHintWindow || hoverHintWindow.isDestroyed()) {
    hoverHintWindow = new BrowserWindow({
      x: hoverHintRequest.pointerX,
      y: hoverHintRequest.pointerY,
      width: hoverHintRequest.width,
      height: hoverHintRequest.height,
      frame: false,
      resizable: false,
      transparent: false,
      backgroundColor: '#111111',
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      roundedCorners: false,
      show: false,
      parent: owner,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    lockWindowZoom(hoverHintWindow);
    keepAboveFullscreenApps(hoverHintWindow);
    hoverHintWindow.setIgnoreMouseEvents(true);
    hoverHintWindow.removeMenu();
    hoverHintWindow.on('closed', () => {
      hoverHintWindow = null;
      hoverHintLoadPromise = null;
      hoverHintRequest = null;
      hoverHintOwnerId = null;
      hoverHintToken += 1;
      clearInterval(hoverHintDismissTimer);
      hoverHintDismissTimer = null;
    });
    hoverHintOwnerId = owner.webContents.id;
    hoverHintLoadPromise = hoverHintWindow.loadFile('hover-hint.html');
  }
  await hoverHintLoadPromise;
  if (!hoverHintRequest || hoverHintRequest.token !== token || !hoverHintWindow || hoverHintWindow.isDestroyed()) return;
  hoverHintWindow.setParentWindow(owner);
  hoverHintWindow.webContents.send('hover-hint-content', { token, text });
}

function raiseHoverHintAboveOwner() {
  if (!hoverHintWindow || hoverHintWindow.isDestroyed()) return;
  const owner = BrowserWindow.getAllWindows().find(target => !target.isDestroyed() && target.webContents.id === hoverHintOwnerId);
  keepAboveFullscreenApps(hoverHintWindow);
  hoverHintWindow.moveTop();
  if (!owner || owner.isDestroyed()) return;
  try { hoverHintWindow.moveAbove(owner.getMediaSourceId()); } catch (_) {}
}

function positionHoverHint(request) {
  if (!hoverHintWindow || hoverHintWindow.isDestroyed() || !request) return;
  const display = screen.getDisplayNearestPoint({ x: request.pointerX, y: request.pointerY });
  const work = display.workArea;
  const width = Math.min(request.width, work.width - 12);
  const height = Math.min(request.height, work.height - 12);
  const rightX = request.pointerX + 8;
  const belowY = request.pointerY + 8;
  const x = rightX + width <= work.x + work.width - 6 ? rightX : Math.max(work.x + 6, request.pointerX - width - 8);
  const y = belowY + height <= work.y + work.height - 6 ? belowY : Math.max(work.y + 6, request.sourceRect.y - height - 8);
  hoverHintWindow.setBounds({ x, y, width, height });
  hoverHintWindow.showInactive();
  raiseHoverHintAboveOwner();
  setImmediate(() => { if (hoverHintRequest?.token === request.token) raiseHoverHintAboveOwner(); });
  setTimeout(() => { if (hoverHintRequest?.token === request.token) raiseHoverHintAboveOwner(); }, 60);
  clearInterval(hoverHintDismissTimer);
  hoverHintRaiseCounter = 0;
  hoverHintDismissTimer = setInterval(() => {
    if (!hoverHintRequest) return;
    const point = screen.getCursorScreenPoint();
    const bounds = hoverHintRequest.sourceRect;
    const inside = point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
    if (!inside) hideHoverHintWindow();
    else if (++hoverHintRaiseCounter % 8 === 0) raiseHoverHintAboveOwner();
  }, 32);
}

function hideHoverHintWindow() {
  const owner = BrowserWindow.getAllWindows().find(target => !target.isDestroyed() && target.webContents.id === hoverHintOwnerId);
  hoverHintToken += 1;
  hoverHintRequest = null;
  clearInterval(hoverHintDismissTimer);
  hoverHintDismissTimer = null;
  hoverHintRaiseCounter = 0;
  if (hoverHintWindow && !hoverHintWindow.isDestroyed()) hoverHintWindow.hide();
  if (owner && !owner.webContents.isDestroyed()) owner.webContents.send('hover-hint-hidden');
}

function toolLayoutState() {
  return { activeMainTool, detachedTool, lockedTool, availableTools, operationalTools: availableTools.filter(toolIsOperational) };
}

function toolIsOperational(tool) {
  return activeMainTool === tool || detachedTool === tool || loadAppSettings().backgroundTools.includes(tool);
}

function publishToolLayout() {
  sendToRenderer('tool-layout-state', toolLayoutState());
  writeBackend({
    action: 'configure',
    auto_tool_active: toolIsOperational('auto-clicker'),
    macro_tool_active: toolIsOperational('macro')
  });
  if (!toolIsOperational('auto-clicker')) stopTool('auto-clicker');
  if (!toolIsOperational('macro')) stopTool('macro');
  configureCrosshairBackend();
  if (crosshairOverlayWindow && !crosshairOverlayWindow.isDestroyed() && crosshairConfig) {
    crosshairOverlayWindow.webContents.send('crosshair-config', effectiveCrosshairConfig());
  }
}

function stopTool(tool) {
  if (tool === 'auto-clicker') writeBackend({ action: 'stop' });
  if (tool === 'macro') {
    writeBackend({ action: 'macro_record_stop' });
    writeBackend({ action: 'macro_stop' });
  }
}

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0);
}

function safeUpdateVersionToken(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 96) return '';
  return /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(candidate)
    ? candidate
    : '';
}

function isNewerVersion(candidate, current) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function validWebUrl(value) {
  try { return new URL(value).protocol === 'https:'; }
  catch (_) { return false; }
}

async function readUpdateManifest(config) {
  if (typeof config.stagedUpdatePath === 'string' && config.stagedUpdatePath.trim()) {
    try {
      const release = JSON.parse(fs.readFileSync(path.join(path.resolve(config.stagedUpdatePath), 'release-manifest.json'), 'utf8'));
      if (release?.version) {
        return {
          version: String(release.version),
          notes: typeof release.notes === 'string' ? release.notes : 'A staged Click Interval update is ready.',
          developmentUpdate: true,
          manualOnly: release.manualOnly !== false
        };
      }
    } catch (_) {}
  }
  let remoteError = null;
  let remoteManifest = null;
  if (validWebUrl(config.manifestUrl)) {
    try {
      const separator = config.manifestUrl.includes('?') ? '&' : '?';
      const signedEnvelope = await fetchBoundedUpdateManifest({
        url: `${config.manifestUrl}${separator}check=${Date.now()}`
      });
      remoteManifest = verifySignedUpdateManifest(signedEnvelope, config.manifestPublicKey);
    } catch (error) { remoteError = error; }
  }
  if (remoteManifest) return remoteManifest;
  if (process.env.CLICK_INTERVAL_UPDATE_MANIFEST) {
    const localPath = path.resolve(process.env.CLICK_INTERVAL_UPDATE_MANIFEST);
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  if (remoteError) throw remoteError;
  return null;
}

function publishUpdateStatus(status, details = {}) {
  sendToRenderer('update-status', { status, ...details });
}

async function performUpdateCheck() {
  const config = loadUpdateConfig();
  try {
    let manifest = await readUpdateManifest(config);
    if (!manifest) {
      availableUpdate = null;
      if (updateCheckManualRequested) publishUpdateStatus('not-configured');
      return;
    }
    const safeVersion = safeUpdateVersionToken(manifest.version);
    if (!safeVersion) throw new Error('The update signal contains an invalid version.');
    manifest = { ...manifest, version: safeVersion };
    if (!isNewerVersion(manifest.version, app.getVersion())) {
      availableUpdate = null;
      publishUpdateStatus('current', { currentVersion: app.getVersion() });
      return;
    }
    const hasInstaller = validWebUrl(manifest.installerUrl) && /^[a-f0-9]{64}$/i.test(manifest.sha256 || '');
    const hasPage = validWebUrl(manifest.pageUrl);
    let hasDevelopmentUpdate = false;
    if (manifest.developmentUpdate === true && typeof config.stagedUpdatePath === 'string' && config.stagedUpdatePath.trim()) {
      try {
        const stagedRelease = JSON.parse(fs.readFileSync(path.join(path.resolve(config.stagedUpdatePath), 'release-manifest.json'), 'utf8'));
        hasDevelopmentUpdate = String(stagedRelease?.version || '') === String(manifest.version) && Array.isArray(stagedRelease?.files) && stagedRelease.files.length > 0;
      } catch (_) {}
    }
    if (!hasInstaller && !hasPage && !hasDevelopmentUpdate) throw new Error('The update signal has no trusted installer or download page.');
    availableUpdate = { ...manifest, hasInstaller, hasPage, hasDevelopmentUpdate };
    publishUpdateStatus('available', {
      version: manifest.version,
      notes: typeof manifest.notes === 'string' ? manifest.notes : '',
      canInstall: hasInstaller || hasDevelopmentUpdate
    });
    if (!manifest.manualOnly && loadAppSettings().autoUpdate && (hasInstaller || hasDevelopmentUpdate) && !autoUpdateLaunching) {
      autoUpdateLaunching = true;
      setTimeout(() => {
        if (!shuttingDown && availableUpdate) {
          if (!launchUpdater()) autoUpdateLaunching = false;
        }
      }, 700);
    }
  } catch (error) {
    if (updateCheckManualRequested) publishUpdateStatus('error', { message: error.message });
  }
}

function checkForUpdates({ manual = false } = {}) {
  if (manual) updateCheckManualRequested = true;
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = performUpdateCheck().finally(() => {
    updateCheckPromise = null;
    updateCheckManualRequested = false;
  });
  return updateCheckPromise;
}

async function installAvailableUpdate() {
  if (!availableUpdate) {
    await checkForUpdates({ manual: true });
    return;
  }
  if (!availableUpdate.hasInstaller) {
    if (availableUpdate.hasPage) await shell.openExternal(availableUpdate.pageUrl);
    return;
  }
  try {
    const updateVersion = safeUpdateVersionToken(availableUpdate.version);
    if (!updateVersion) throw new Error('The update version is invalid.');
    publishUpdateStatus('downloading', { version: updateVersion });
    const installerPath = path.join(os.tmpdir(), `Click-Interval-${updateVersion}-Setup.exe`);
    await downloadUpdatePackage({
      url: availableUpdate.installerUrl,
      destinationPath: installerPath,
      expectedSha256: availableUpdate.sha256
    });
    publishUpdateStatus('installing', { version: updateVersion });
    const installer = spawn(installerPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    installer.unref();
    const updateSettings = loadAppSettings();
    quitCleanly({
      forUpdate: true,
      preserveMinecraftServer: updateSettings.keepMinecraftServerRunningDuringUpdate
    });
  } catch (error) {
    publishUpdateStatus('error', { message: error.message });
  }
}

function launchUpdater() {
  if (!availableUpdate) return false;
  const updateVersion = safeUpdateVersionToken(availableUpdate.version);
  if (!updateVersion) return false;
  const updateConfig = loadUpdateConfig();
  const appSettings = loadAppSettings();
  const payload = {
    currentVersion: app.getVersion(),
    targetVersion: updateVersion,
    notes: typeof availableUpdate.notes === 'string' ? availableUpdate.notes : '',
    installerUrl: availableUpdate.hasInstaller ? availableUpdate.installerUrl : '',
    sha256: availableUpdate.hasInstaller ? availableUpdate.sha256 : '',
    installArgs: Array.isArray(availableUpdate.installArgs) ? availableUpdate.installArgs : [],
    developmentUpdate: availableUpdate.developmentUpdate === true,
    parentPid: process.pid,
    userDataPath: settingsDirectory(),
    applicationPath: __dirname,
    stagedUpdatePath: typeof updateConfig.stagedUpdatePath === 'string' ? path.resolve(updateConfig.stagedUpdatePath) : '',
    reopenAfterUpdate: loadAppSettings().reopenAfterUpdate,
    preserveMinecraftServer: appSettings.keepMinecraftServerRunningDuringUpdate,
    launchExecutable: process.execPath,
    theme: appSettings.theme
  };
  if (!payload.installerUrl && !(payload.developmentUpdate && payload.stagedUpdatePath)) return false;
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const updater = spawn(process.execPath, [path.join(__dirname, 'updater-main.js'), '--update-payload', encoded], {
    cwd: __dirname,
    detached: true,
    windowsHide: false,
    stdio: 'ignore'
  });
  updater.unref();
  quitCleanly({
    forUpdate: true,
    preserveMinecraftServer: appSettings.keepMinecraftServerRunningDuringUpdate
  });
  return true;
}

function startBackend() {
  if (backend && backend.exitCode === null) return;
  if (backendRestartTimer) {
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
  }
  const python = path.join(__dirname, 'runtime', 'python.exe');
  const script = path.join(__dirname, 'backend.py');
  backendReady = false;
  try {
    backend = spawn(python, ['-u', script], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (error) {
    backend = null;
    scheduleBackendRestart(`The click engine could not start and will retry. ${error.message}`);
    return;
  }
  const backendProcess = backend;
  backendProcess.stdin.on('error', error => handleBackendPipeFailure(backendProcess, error));
  backendProcess.on('error', error => handleBackendPipeFailure(backendProcess, error));
  configureCrosshairBackend();

  const stdoutQueue = [];
  let stdoutQueueBytes = 0;
  let stdoutDrainTimer = null;
  let stdoutNextDrainAt = 0;
  let stdoutPaused = false;
  let stderrPending = '';
  let stderrPendingBytes = 0;
  let stderrDroppedBytes = 0;
  let stderrFlushTimer = null;
  let diagnosticPending = null;
  let diagnosticSuppressed = 0;
  let diagnosticFlushTimer = null;
  let telemetryFlushTimer = null;
  let rendererRateWindowStartedAt = Date.now();
  let rendererEventsInWindow = 0;
  let rendererBackgroundEventsInWindow = 0;
  let readyReceived = false;
  const telemetryPending = new Map();
  const reportedProtocolProblems = new Set();

  const sendBackendEventIpc = event => {
    if (backendProcess !== backend) return false;
    const now = Date.now();
    if (now - rendererRateWindowStartedAt >= 1000) {
      rendererRateWindowStartedAt = now;
      rendererEventsInWindow = 0;
      rendererBackgroundEventsInWindow = 0;
    }
    const priority = BACKEND_PRIORITY_EVENT_TYPES.has(event?.type);
    if (rendererEventsInWindow >= BACKEND_RENDERER_EVENTS_PER_SECOND) return false;
    if (!priority && rendererBackgroundEventsInWindow >= BACKEND_RENDERER_BACKGROUND_EVENTS_PER_SECOND) return false;
    rendererEventsInWindow += 1;
    if (!priority) rendererBackgroundEventsInWindow += 1;
    sendToRenderer('backend-event', event);
    return true;
  };

  const normalizedTelemetryEvent = event => {
    const bounded = (value, limit = 64) => String(value ?? '').slice(0, limit);
    if (event.type === 'input_event') {
      return {
        type: 'input_event',
        device: bounded(event.device, 16),
        control: typeof event.control === 'number' ? event.control : bounded(event.control),
        action: bounded(event.action, 16),
        source: bounded(event.source, 16),
        count: Number.isFinite(Number(event.count)) ? Number(event.count) : undefined
      };
    }
    if (event.type === 'cps') {
      return { type: 'cps', value: Math.max(0, Number(event.value) || 0), button: bounded(event.button, 16) };
    }
    if (event.type === 'physical_click') return { type: 'physical_click', button: bounded(event.button, 16) };
    if (event.type === 'macro_playback_loop') {
      return {
        type: 'macro_playback_loop',
        completed: Math.max(0, Math.floor(Number(event.completed) || 0)),
        total: Math.max(0, Math.floor(Number(event.total) || 0))
      };
    }
    return event;
  };

  const flushBackendDiagnostics = (force = false) => {
    if (diagnosticFlushTimer) clearTimeout(diagnosticFlushTimer);
    diagnosticFlushTimer = null;
    if (!diagnosticPending || backendProcess !== backend) {
      diagnosticPending = null;
      diagnosticSuppressed = 0;
      return;
    }
    const event = { ...diagnosticPending };
    if (diagnosticSuppressed > 0) {
      event.message = `${event.message} (${diagnosticSuppressed} additional backend messages were suppressed.)`;
    }
    diagnosticPending = null;
    diagnosticSuppressed = 0;
    sendBackendEventIpc(event);
    if (!force) diagnosticFlushTimer = setTimeout(flushBackendDiagnostics, BACKEND_DIAGNOSTIC_FLUSH_MS);
  };

  const publishBackendEvent = event => {
    if (!event || typeof event !== 'object' || backendProcess !== backend) return;
    if (BACKEND_COALESCED_EVENT_TYPES.has(event.type)) {
      telemetryPending.set(event.type, normalizedTelemetryEvent(event));
      if (!telemetryFlushTimer) {
        telemetryFlushTimer = setTimeout(() => {
          telemetryFlushTimer = null;
          if (backendProcess !== backend) { telemetryPending.clear(); return; }
          const events = Array.from(telemetryPending.values());
          telemetryPending.clear();
          for (const pending of events) sendBackendEventIpc(pending);
        }, BACKEND_TELEMETRY_FLUSH_MS);
      }
      return;
    }
    if (event.type === 'error' || event.type === 'macro_error') {
      const safeEvent = {
        type: event.type,
        message: utf8Prefix(String(event.message || 'The click engine reported an error.'), BACKEND_DIAGNOSTIC_MAX_BYTES)
      };
      if (!diagnosticFlushTimer && !diagnosticPending) {
        sendBackendEventIpc(safeEvent);
        diagnosticFlushTimer = setTimeout(flushBackendDiagnostics, BACKEND_DIAGNOSTIC_FLUSH_MS);
      } else if (!diagnosticPending) diagnosticPending = safeEvent;
      else diagnosticSuppressed += 1;
      return;
    }
    sendBackendEventIpc(event);
  };

  const reportProtocolProblemOnce = (kind, message) => {
    if (reportedProtocolProblems.has(kind)) return;
    reportedProtocolProblems.add(kind);
    publishBackendEvent({ type: 'error', message });
  };

  const flushBackendStderr = () => {
    if (stderrFlushTimer) clearTimeout(stderrFlushTimer);
    stderrFlushTimer = null;
    if (backendProcess !== backend) {
      stderrPending = '';
      stderrPendingBytes = 0;
      stderrDroppedBytes = 0;
      return;
    }
    const trimmed = stderrPending.trim();
    const omitted = Math.max(0, stderrPendingBytes - Buffer.byteLength(trimmed, 'utf8')) + stderrDroppedBytes;
    stderrPending = '';
    stderrPendingBytes = 0;
    stderrDroppedBytes = 0;
    if (!trimmed && !omitted) return;
    const suffix = omitted > 0 ? ` (${omitted} stderr bytes omitted.)` : '';
    publishBackendEvent({
      type: 'error',
      message: `${utf8Prefix(trimmed || 'The click engine wrote oversized diagnostic output.', BACKEND_DIAGNOSTIC_MAX_BYTES)}${suffix}`
    });
  };

  const processBackendEvent = event => {
    if (backendProcess !== backend || !event || typeof event !== 'object' || Array.isArray(event)) return;
    if (typeof event.type !== 'string' || !event.type || event.type.length > 80) {
      reportProtocolProblemOnce('invalid-event', 'The click engine emitted an invalid event, which was discarded.');
      return;
    }
    if (event.type === 'ready') {
      if (readyReceived) return;
      readyReceived = true;
      backendReady = true;
      backendRestartDelayMs = 180;
      if (lastBackendConfiguration) sendBackendCommand(backendProcess, lastBackendConfiguration);
      const commands = pendingBackendCommands;
      pendingBackendCommands = [];
      for (const pendingCommand of commands) sendBackendCommand(backendProcess, pendingCommand);
    }
    if (event.type === 'started' && !clickerRunning) {
      currentGeneratedCps = 0;
      updateActiveIndicator(true).catch(() => {});
      queueCpsIndicatorUpdate(0, true);
    }
    if (event.type === 'cps' && clickerRunning) {
      const cpsEvent = normalizedTelemetryEvent(event);
      queueCpsIndicatorUpdate(cpsEvent.value, true, cpsEvent.button);
    }
    if (event.type === 'physical_click') {
      const clickEvent = normalizedTelemetryEvent(event);
      pushBoundedClickHistory(physicalClickTimes, { time: Date.now(), button: clickEvent.button });
    }
    if (event.type === 'input_event') {
      const inputEvent = normalizedTelemetryEvent(event);
      if (inputEvent.source === 'macro' && inputEvent.device === 'mouse' && inputEvent.action === 'down') {
        pushBoundedClickHistory(macroClickTimes, { time: Date.now(), button: inputEvent.control || 'Left' });
      }
      queueInputDisplayUpdate(inputEvent);
    }
    if (event.type === 'macro_playback_started' && !macroPlaybackRunning) {
      macroPlaybackRunning = true;
      queueCpsIndicatorUpdate(currentGeneratedCps, true);
    }
    if (event.type === 'macro_playback_stopped' && macroPlaybackRunning) {
      macroPlaybackRunning = false;
      queueCpsIndicatorUpdate(currentGeneratedCps, clickerRunning);
    }
    if (event.type === 'stopped' || event.type === 'emergency_stop' || event.type === 'error') {
      const hadActivity = clickerRunning || macroPlaybackRunning || currentGeneratedCps > 0;
      currentGeneratedCps = 0;
      if (event.type !== 'error') macroPlaybackRunning = false;
      if (hadActivity) updateActiveIndicator(false).catch(() => {});
      queueCpsIndicatorUpdate(0, false);
    }
    if (event.type === 'crosshair_fire') {
      if (crosshairOverlayWindow && !crosshairOverlayWindow.isDestroyed()) crosshairOverlayWindow.webContents.send('crosshair-pulse', event);
      if (crosshairPreviewWindow && !crosshairPreviewWindow.isDestroyed()) crosshairPreviewWindow.webContents.send('crosshair-pulse', event);
    }
    if (event.type === 'crosshair_ads' && crosshairOverlayWindow && !crosshairOverlayWindow.isDestroyed()) {
      crosshairOverlayWindow.webContents.send('crosshair-ads', Boolean(event.active));
    }
    if (event.type === 'macro_crosshair_profile') {
      const preferences = loadPreferences();
      const studio = preferences.crosshairStudio && typeof preferences.crosshairStudio === 'object' ? preferences.crosshairStudio : {};
      const profiles = Array.isArray(studio.profiles) ? studio.profiles : [];
      const profile = profiles.find(item => item.id === event.profileId);
      const operation = ['activate', 'switch', 'hide', 'toggle'].includes(event.operation) ? event.operation : 'activate';
      if (profile && (operation === 'activate' || operation === 'switch')) studio.selectedId = profile.id;
      if (operation === 'activate') studio.enabled = true;
      if (operation === 'hide') studio.enabled = false;
      if (operation === 'toggle') studio.enabled = !Boolean(crosshairConfig?.enabled ?? studio.enabled);
      savePreferences({ crosshairStudio: studio });
      updateCrosshairOverlay({ ...(profile || {}), enabled: Boolean(studio.enabled), displayId: studio.displayId, hotkey: studio.hotkey });
      sendToRenderer('crosshair-profile-state', { selectedId: studio.selectedId, enabled: Boolean(studio.enabled) });
    }
    publishBackendEvent(event);
  };

  const drainStdoutQueue = () => {
    stdoutDrainTimer = null;
    if (backendProcess !== backend) {
      stdoutQueue.length = 0;
      stdoutQueueBytes = 0;
      return;
    }
    stdoutNextDrainAt = Date.now() + BACKEND_STDOUT_PARSE_INTERVAL_MS;
    let processedLines = 0;
    let processedBytes = 0;
    while (stdoutQueue.length && processedLines < BACKEND_STDOUT_PARSE_LINES_PER_TICK) {
      const next = stdoutQueue[0];
      if (processedLines > 0 && processedBytes + next.bytes > BACKEND_STDOUT_PARSE_BYTES_PER_TICK) break;
      stdoutQueue.shift();
      stdoutQueueBytes -= next.bytes;
      processedLines += 1;
      processedBytes += next.bytes;
      try {
        processBackendEvent(JSON.parse(next.line));
      } catch (_) {
        reportProtocolProblemOnce('malformed-json', 'The click engine emitted malformed output, which was discarded.');
      }
    }
    if (stdoutPaused && stdoutQueue.length <= BACKEND_STDOUT_RESUME_LINES && stdoutQueueBytes <= BACKEND_STDOUT_QUEUE_MAX_BYTES / 4) {
      stdoutPaused = false;
      try { backendProcess.stdout.resume(); } catch (_) {}
    }
    if (stdoutQueue.length) scheduleStdoutDrain();
  };

  function scheduleStdoutDrain() {
    if (stdoutDrainTimer || backendProcess !== backend) return;
    const delay = Math.max(0, stdoutNextDrainAt - Date.now());
    stdoutDrainTimer = setTimeout(drainStdoutQueue, delay);
  }

  const stdoutAccumulator = createBoundedLineAccumulator({
    onLine: (line, bytes) => {
      if (!line.trim() || backendProcess !== backend) return;
      const typeMatch = line.slice(0, 256).match(/"type"\s*:\s*"([^"\\]{1,80})"/);
      const priority = Boolean(typeMatch && BACKEND_PRIORITY_EVENT_TYPES.has(typeMatch[1]));
      while (priority && (stdoutQueue.length >= BACKEND_STDOUT_QUEUE_MAX_LINES || stdoutQueueBytes + bytes > BACKEND_STDOUT_QUEUE_MAX_BYTES)) {
        let backgroundIndex = -1;
        for (let index = stdoutQueue.length - 1; index >= 0; index -= 1) {
          if (!stdoutQueue[index].priority) { backgroundIndex = index; break; }
        }
        if (backgroundIndex < 0) break;
        const [removed] = stdoutQueue.splice(backgroundIndex, 1);
        stdoutQueueBytes -= removed.bytes;
      }
      if (stdoutQueue.length >= BACKEND_STDOUT_QUEUE_MAX_LINES || stdoutQueueBytes + bytes > BACKEND_STDOUT_QUEUE_MAX_BYTES) {
        if (!stdoutPaused) {
          stdoutPaused = true;
          try { backendProcess.stdout.pause(); } catch (_) {}
        }
        reportProtocolProblemOnce('stdout-overload', 'The click engine produced output too quickly. Excess events were throttled.');
        return;
      }
      const queuedLine = { line, bytes, priority };
      if (priority) {
        const firstBackgroundIndex = stdoutQueue.findIndex(item => !item.priority);
        if (firstBackgroundIndex >= 0) stdoutQueue.splice(firstBackgroundIndex, 0, queuedLine);
        else stdoutQueue.push(queuedLine);
      } else {
        stdoutQueue.push(queuedLine);
      }
      stdoutQueueBytes += bytes;
      if (!stdoutPaused && (stdoutQueue.length >= BACKEND_STDOUT_PAUSE_LINES || stdoutQueueBytes >= BACKEND_STDOUT_QUEUE_MAX_BYTES * 0.75)) {
        stdoutPaused = true;
        try { backendProcess.stdout.pause(); } catch (_) {}
      }
      scheduleStdoutDrain();
    },
    onOverflow: info => {
      reportProtocolProblemOnce(
        info.kind === 'chunk' ? 'oversized-chunk' : 'oversized-line',
        info.kind === 'chunk'
          ? 'The click engine emitted an oversized output chunk, which was truncated.'
          : 'The click engine emitted an oversized output line, which was discarded.'
      );
    }
  });

  backendProcess.stdout.on('data', chunk => stdoutAccumulator.push(chunk));

  backendProcess.stderr.on('data', chunk => {
    if (backendProcess !== backend) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
    const available = Math.max(0, BACKEND_STDERR_MAX_PENDING_BYTES - stderrPendingBytes);
    const accepted = utf8Prefix(bytes, available);
    const acceptedBytes = Buffer.byteLength(accepted, 'utf8');
    if (acceptedBytes) {
      stderrPending += accepted;
      stderrPendingBytes += acceptedBytes;
    }
    stderrDroppedBytes += Math.max(0, bytes.length - acceptedBytes);
    if (!stderrFlushTimer) stderrFlushTimer = setTimeout(flushBackendStderr, BACKEND_DIAGNOSTIC_FLUSH_MS);
  });

  backendProcess.on('exit', code => {
    const expected = expectedBackendStops.has(backendProcess);
    if (!expected) {
      flushBackendStderr();
      flushBackendDiagnostics(true);
    }
    for (const timer of [stdoutDrainTimer, stderrFlushTimer, diagnosticFlushTimer, telemetryFlushTimer]) clearTimeout(timer);
    stdoutAccumulator.clear();
    stdoutQueue.length = 0;
    telemetryPending.clear();
    backendReady = false;
    macroPlaybackRunning = false;
    macroClickTimes = [];
    pendingInputDisplayEvents.clear();
    pendingCpsIndicatorUpdate = null;
    updateActiveIndicator(false).catch(() => {});
    if (backend === backendProcess) backend = null;
    if (!shuttingDown && !expected) scheduleBackendRestart(`The click engine stopped (code ${code ?? 'unknown'}) and is being restarted.`);
  });
}

function stopBackend() {
  if (backendRestartTimer) {
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
  }
  backendReady = false;
  pendingBackendCommands = [];
  clearTimeout(inputDisplayDispatchTimer);
  clearTimeout(cpsIndicatorDispatchTimer);
  inputDisplayDispatchTimer = null;
  cpsIndicatorDispatchTimer = null;
  pendingInputDisplayEvents.clear();
  pendingCpsIndicatorUpdate = null;
  updateActiveIndicator(false).catch(() => {});
  const processToStop = backend;
  backend = null;
  if (!processToStop || processToStop.exitCode !== null) return;
  expectedBackendStops.add(processToStop);
  try {
    if (processToStop.stdin.writable) {
      processToStop.stdin.write(`${JSON.stringify({ action: 'stop' })}\n`);
      processToStop.stdin.end();
    }
  } catch (_) {}
  try { processToStop.kill(); } catch (_) {}
}

function quitCleanly(options = {}) {
  if (shuttingDown) return;
  if (options && typeof options === 'object' && options.forUpdate === true) {
    minecraftServer.prepareForAppUpdate({ preserveServer: options.preserveMinecraftServer !== false });
  }
  shuttingDown = true;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (cpsIndicatorRefreshTimer) clearInterval(cpsIndicatorRefreshTimer);
  cpsIndicatorRefreshTimer = null;
  if (smartAreaPickerResolve) smartAreaPickerResolve({ canceled: true });
  smartAreaPickerResolve = null;
  for (const picker of smartAreaPickerWindows) if (!picker.isDestroyed()) picker.destroy();
  smartAreaPickerWindows = [];
  if (screenPointPickerResolve) screenPointPickerResolve({ canceled: true });
  screenPointPickerResolve = null;
  for (const picker of screenPointPickerWindows) if (!picker.isDestroyed()) picker.destroy();
  screenPointPickerWindows = [];
  globalShortcut.unregisterAll();
  if (crosshairOverlayWindow && !crosshairOverlayWindow.isDestroyed()) crosshairOverlayWindow.destroy();
  crosshairOverlayWindow = null;
  if (crosshairPreviewWindow && !crosshairPreviewWindow.isDestroyed()) crosshairPreviewWindow.destroy();
  crosshairPreviewWindow = null;
  if (activeIndicatorWindow && !activeIndicatorWindow.isDestroyed()) activeIndicatorWindow.destroy();
  activeIndicatorWindow = null;
  if (cpsIndicatorWindow && !cpsIndicatorWindow.isDestroyed()) cpsIndicatorWindow.destroy();
  cpsIndicatorWindow = null;
  if (inputDisplayWindow && !inputDisplayWindow.isDestroyed()) inputDisplayWindow.destroy();
  inputDisplayWindow = null;
  stopBackend();
  app.quit();
}

async function createSplashWindow() {
  if (process.env.OP_MOUSE_TEST === '1' || backgroundMapUpdateStartup) return;
  splashWindow = new BrowserWindow({
    width: 150,
    height: 150,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await splashWindow.loadFile('splash.html');
  splashWindow.center();
  keepAboveFullscreenApps(splashWindow);
  splashShownAt = Date.now();
  splashWindow.showInactive();
}

function revealMainWindow() {
  if (process.env.OP_MOUSE_TEST === '1' || !window || window.isDestroyed()) return;
  const minimumSplashMs = 650;
  const remaining = minimumSplashMs - (Date.now() - splashShownAt);
  if (splashWindow && remaining > 0) {
    if (!revealScheduled) {
      revealScheduled = true;
      setTimeout(() => {
        revealScheduled = false;
        revealMainWindow();
      }, remaining);
    }
    return;
  }
  if (backgroundMapUpdateStartup) window.showInactive();
  else window.show();
  applyAppWindowLevel(window);
  if (!backgroundMapUpdateStartup) window.focus();
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

async function createWindow() {
  const colors = activeThemeColors();
  window = new BrowserWindow({
    ...toolWindowSize('auto-clicker'),
    frame: false,
    transparent: false,
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: loadAppSettings().alwaysOnTop,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    title: 'Click Interval V 1.5',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  minecraftServer.attachHostWindow(window);
  lockWindowZoom(window);
  window.once('ready-to-show', revealMainWindow);
  setTimeout(revealMainWindow, 1500);
  await window.loadFile('index.html');
  applyAppWindowLevel(window);
  window.on('show', () => applyAppWindowLevel(window));
  window.on('restore', () => applyAppWindowLevel(window));
  window.on('blur', () => setImmediate(() => applyAppWindowLevel(window)));
}

async function createDetachedToolWindow(tool) {
  if (detachedToolWindow && !detachedToolWindow.isDestroyed()) {
    detachedToolWindow.focus();
    return;
  }
  detachedTool = availableTools.includes(tool) ? tool : 'auto-clicker';
  activeMainTool = availableTools.find(item => item !== detachedTool) || 'auto-clicker';
  if (lockedTool === detachedTool) lockedTool = null;
  const colors = activeThemeColors();
  detachedToolWindow = new BrowserWindow({
    ...toolWindowSize(detachedTool, true),
    frame: false,
    transparent: false,
    roundedCorners: true,
    hasShadow: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: loadAppSettings().alwaysOnTop,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    title: `Click Interval — ${{ 'auto-clicker': 'Auto Clicker', macro: 'Macro', crosshair: 'Crosshair Studio', voice: 'Voice Changer', 'minecraft-server': 'Minecraft Server' }[detachedTool] || 'Tool'}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lockWindowZoom(detachedToolWindow);
  await detachedToolWindow.loadFile('index.html', { query: { detached: detachedTool } });
  applyAppWindowLevel(detachedToolWindow);
  detachedToolWindow.on('show', () => applyAppWindowLevel(detachedToolWindow));
  detachedToolWindow.on('closed', () => {
    detachedToolWindow = null;
    detachedTool = null;
    publishToolLayout();
  });
  detachedToolWindow.show();
  publishToolLayout();
}

async function promoteDetachedWindow() {
  if (!detachedToolWindow || detachedToolWindow.isDestroyed()) return false;
  const oldMain = window;
  const promotedTool = detachedTool;
  window = detachedToolWindow;
  detachedToolWindow = null;
  detachedTool = null;
  activeMainTool = promotedTool || 'auto-clicker';
  lockedTool = null;
  resizeToolWindow(window, activeMainTool);
  await window.loadFile('index.html');
  applyAppWindowLevel(window);
  if (oldMain && !oldMain.isDestroyed()) oldMain.destroy();
  publishToolLayout();
  return true;
}

async function createHotkeyWindow(mode = 'start-stop', parentWindow = window) {
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) {
    hotkeyWindow.focus();
    return;
  }
  hotkeyWindowMode = ['emergency', 'macro-trigger', 'macro-record', 'macro-play', 'crosshair-toggle'].includes(mode) ? mode : 'start-stop';
  hotkeySelectionCommitted = false;
  const colors = activeThemeColors();
  const localized = loadAppSettings().language !== 'en';
  hotkeyWindow = new BrowserWindow({
    width: localized ? 320 : 230,
    height: 144,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: hotkeyWindowMode === 'emergency' ? 'Emergency Stop Setting' :
      hotkeyWindowMode === 'macro-trigger' ? 'Macro Trigger Setting' :
      hotkeyWindowMode === 'macro-record' ? 'Record Shortcut Setting' :
      hotkeyWindowMode === 'macro-play' ? 'Playback Shortcut Setting' :
      hotkeyWindowMode === 'crosshair-toggle' ? 'Crosshair Shortcut Setting' : 'Hotkey Setting',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(hotkeyWindow);
  keepAboveFullscreenApps(hotkeyWindow);
  hotkeyWindow.removeMenu();
  hotkeyWindow.on('closed', () => {
    hotkeyWindow = null;
    if (!hotkeySelectionCommitted) sendToRenderer('hotkey-window-cancelled', { mode: hotkeyWindowMode });
    hotkeySelectionCommitted = false;
    publishPopupState(false);
  });
  await hotkeyWindow.loadFile('hotkey.html');
}

async function createMessageWindow(payload, parentWindow = window) {
  if (messageWindow && !messageWindow.isDestroyed()) messageWindow.close();
  const colors = activeThemeColors();
  const localized = loadAppSettings().language !== 'en';
  messageWindow = new BrowserWindow({
    width: localized ? 440 : 390,
    height: 182,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: payload.title || 'Information',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(messageWindow);
  keepAboveFullscreenApps(messageWindow);
  messageWindow.removeMenu();
  messageWindow.on('closed', () => { messageWindow = null; publishPopupState(false); });
  messageWindow.webContents.once('did-finish-load', () => {
    if (messageWindow && !messageWindow.isDestroyed()) messageWindow.webContents.send('message-data', payload);
  });
  await messageWindow.loadFile('message.html');
}

async function createSettingsWindow(parentWindow = window) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  const colors = activeThemeColors();
  settingsDraft = loadAppSettings();
  settingsDirty = false;
  settingsCloseApproved = false;
  const localized = loadAppSettings().language !== 'en';
  settingsWindow = new BrowserWindow({
    width: localized ? 470 : 390,
    height: localized ? 460 : 400,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: 'Click Interval Settings',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  publishPopupState(true);
  lockWindowZoom(settingsWindow);
  keepAboveFullscreenApps(settingsWindow);
  settingsWindow.removeMenu();
  settingsWindow.on('close', event => {
    if (!settingsDirty || settingsCloseApproved) return;
    event.preventDefault();
    createSettingsUnsavedWindow();
  });
  settingsWindow.on('closed', () => {
    if (settingsUnsavedWindow && !settingsUnsavedWindow.isDestroyed()) settingsUnsavedWindow.destroy();
    settingsUnsavedWindow = null;
    settingsWindow = null;
    settingsDraft = null;
    settingsDirty = false;
    settingsCloseApproved = false;
    publishPopupState(false);
  });
  await settingsWindow.loadFile('settings.html');
}

async function createSettingsUnsavedWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  if (settingsUnsavedWindow && !settingsUnsavedWindow.isDestroyed()) {
    settingsUnsavedWindow.focus();
    return;
  }
  const colors = activeThemeColors();
  const localized = loadAppSettings().language !== 'en';
  settingsUnsavedWindow = new BrowserWindow({
    width: localized ? 440 : 360, height: 188, useContentSize: true, parent: settingsWindow, modal: true,
    frame: true, transparent: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: 'Unsaved Settings', resizable: false, maximizable: false, minimizable: false,
    roundedCorners: true, alwaysOnTop: true, icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true, backgroundColor: colors.background, backgroundMaterial: 'none',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  lockWindowZoom(settingsUnsavedWindow);
  keepAboveFullscreenApps(settingsUnsavedWindow);
  settingsUnsavedWindow.removeMenu();
  settingsUnsavedWindow.on('closed', () => { settingsUnsavedWindow = null; });
  await settingsUnsavedWindow.loadFile('settings-unsaved.html');
}

function applySavedAppSettings(value) {
  const previousLanguage = loadAppSettings().language;
  const settings = normalizeAppSettings(value);
  savePreferences({ appSettings: settings });
  const colors = activeThemeColors(settings);
  for (const target of [window, detachedToolWindow, settingsWindow, motdEditorWindow, playerInspectorWindow, playerRoleEditorWindow]) {
    if (!target || target.isDestroyed()) continue;
    applyNativeTheme(target, settings);
    if (target === settingsWindow || target === motdEditorWindow || target === playerInspectorWindow || target === playerRoleEditorWindow) target.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbols, height: 32 });
  }
  sendToRenderer('app-theme-changed', settings);
  applyAppWindowLevel(window);
  applyAppWindowLevel(detachedToolWindow);
  updateActiveIndicator(clickerRunning);
  updateCpsIndicator(currentGeneratedCps, clickerRunning);
  updateInputDisplay();
  writeBackend({
    action: 'configure',
    emit_generated_input_events: Boolean(settings.showInputDisplay && settings.inputDisplayGenerated)
  });
  publishToolLayout();
  if (settings.language !== previousLanguage) {
    resizeToolWindow(window, activeMainTool);
    resizeToolWindow(detachedToolWindow, detachedTool, true);
    setTimeout(() => {
      for (const target of [window, detachedToolWindow]) {
        if (target && !target.isDestroyed()) target.reload();
      }
    }, 100);
  }
  if (settings.autoUpdate && availableUpdate && !availableUpdate.manualOnly && !autoUpdateLaunching) {
    autoUpdateLaunching = true;
    setTimeout(() => {
      if (!launchUpdater()) autoUpdateLaunching = false;
    }, 500);
  }
  return settings;
}

async function createMacroNameWindow(payload = {}, parentWindow = window) {
  if (macroNameWindow && !macroNameWindow.isDestroyed()) {
    macroNameWindow.focus();
    return;
  }
  macroNameDialog = {
    entity: ['crosshair', 'server'].includes(payload.entity) ? payload.entity : 'macro',
    mode: payload.mode === 'rename' ? 'rename' : 'create',
    id: typeof payload.id === 'string' ? payload.id : null,
    name: typeof payload.defaultValue === 'string' ? payload.defaultValue : (typeof payload.name === 'string' ? payload.name : ''),
    action: typeof payload.action === 'string' ? payload.action : '',
    target: typeof payload.target === 'string' ? payload.target : '',
    title: typeof payload.title === 'string' ? payload.title : '',
    label: typeof payload.label === 'string' ? payload.label : '',
    placeholder: typeof payload.placeholder === 'string' ? payload.placeholder : '',
    confirmText: typeof payload.confirmText === 'string' ? payload.confirmText : '',
    maxLength: Math.max(1, Math.min(1024, Math.round(Number(payload.maxLength) || (payload.secret ? 256 : 40)))),
    inputType: payload.inputType === 'datetime-local' ? 'datetime-local' : 'text',
    inputMin: typeof payload.inputMin === 'string' ? payload.inputMin.slice(0, 32) : '',
    inputMax: typeof payload.inputMax === 'string' ? payload.inputMax.slice(0, 32) : '',
    options: Array.isArray(payload.options) ? payload.options.slice(0, 64).map(option => ({
      value: String(option?.value || '').slice(0, 40),
      label: String(option?.label || option?.value || '').slice(0, 80)
    })).filter(option => option.value && option.label) : [],
    secret: payload.secret === true
  };
  const colors = activeThemeColors();
  const localized = loadAppSettings().language !== 'en';
  macroNameWindow = new BrowserWindow({
    width: localized ? 380 : 310,
    height: 166,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: payload.title || (payload.entity === 'crosshair' ? 'New Crosshair' : payload.entity === 'server' ? 'New Server' : 'New Macro'),
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(macroNameWindow);
  keepAboveFullscreenApps(macroNameWindow);
  macroNameWindow.removeMenu();
  macroNameWindow.on('closed', () => { macroNameWindow = null; publishPopupState(false); });
  await macroNameWindow.loadFile('macro-name.html');
}

async function createMacroDeleteWindow(payload = {}, parentWindow = window) {
  if (macroDeleteWindow && !macroDeleteWindow.isDestroyed()) {
    macroDeleteWindow.focus();
    return;
  }
  macroDeleteDialog = {
    entity: payload.entity === 'server' ? 'server' : 'macro',
    id: typeof payload.id === 'string' ? payload.id : null,
    name: typeof payload.name === 'string' ? payload.name : 'this macro',
    filePath: typeof payload.filePath === 'string' ? payload.filePath : '',
    action: typeof payload.action === 'string' ? payload.action : '',
    requestId: typeof payload.requestId === 'string' ? payload.requestId.slice(0, 128) : '',
    title: typeof payload.title === 'string' ? payload.title : '',
    question: typeof payload.question === 'string' ? payload.question : '',
    confirmText: typeof payload.confirmText === 'string' ? payload.confirmText : ''
  };
  macroDeleteOwner = parentWindow?.webContents || null;
  macroDeleteConfirmed = false;
  const resetDataDialog = macroDeleteDialog.entity === 'server' && macroDeleteDialog.action === 'wipe';
  const colors = activeThemeColors();
  const localized = loadAppSettings().language !== 'en';
  macroDeleteWindow = new BrowserWindow({
    width: resetDataDialog ? (localized ? 600 : 540) : localized ? 400 : 330,
    height: resetDataDialog ? (localized ? 540 : 500) : 158,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: payload.title || (payload.entity === 'server' ? 'Delete Server' : 'Delete Macro'),
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(macroDeleteWindow);
  keepAboveFullscreenApps(macroDeleteWindow);
  macroDeleteWindow.removeMenu();
  macroDeleteWindow.on('closed', () => { macroDeleteWindow = null; macroDeleteOwner = null; publishPopupState(false); });
  await macroDeleteWindow.loadFile('macro-delete.html');
}

function normalizeMotdEditorState(payload) {
  const source = payload && typeof payload === 'object' ? payload : { value: payload };
  const icon = String(source.iconDataUrl || '').trim();
  const iconDataUrl = /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(icon) && icon.length <= 1024 * 1024
    ? icon
    : 'minecraft-server/renderer/assets/minecraft-default-world.png';
  return {
    value: String(source.value || '').slice(0, 1024),
    serverName: String(source.serverName || 'Minecraft Server').replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) || 'Minecraft Server',
    iconDataUrl
  };
}

async function createMotdEditorWindow(payload = '', parentWindow = window) {
  motdEditorState = normalizeMotdEditorState(payload);
  if (motdEditorWindow && !motdEditorWindow.isDestroyed()) {
    motdEditorWindow.webContents.send('motd-editor-value', motdEditorState);
    motdEditorWindow.focus();
    return;
  }
  const colors = activeThemeColors();
  motdEditorWindow = new BrowserWindow({
    width: 700,
    height: 510,
    minWidth: 590,
    minHeight: 450,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: 'MOTD Editor',
    resizable: true,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(motdEditorWindow);
  keepAboveFullscreenApps(motdEditorWindow);
  motdEditorWindow.removeMenu();
  motdEditorWindow.on('closed', () => {
    motdEditorWindow = null;
    publishPopupState(false);
  });
  await motdEditorWindow.loadFile('motd-editor.html');
}

async function createPlayerInspectorWindow(name = '', parentWindow = window) {
  const requestedPlayer = String(name || '').trim().slice(0, 16);
  if (!/^[A-Za-z0-9_]{1,16}$/.test(requestedPlayer)) return;
  playerInspectorName = requestedPlayer;
  if (playerInspectorWindow && !playerInspectorWindow.isDestroyed()) {
    playerInspectorWindow.webContents.send('player-inspector-name', playerInspectorName);
    playerInspectorWindow.setTitle(`View ${playerInspectorName}`);
    playerInspectorWindow.focus();
    return;
  }
  const colors = activeThemeColors();
  playerInspectorWindow = new BrowserWindow({
    width: 800,
    height: 510,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: `View ${playerInspectorName}`,
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(playerInspectorWindow);
  keepAboveFullscreenApps(playerInspectorWindow);
  playerInspectorWindow.removeMenu();
  playerInspectorWindow.on('closed', () => {
    playerInspectorWindow = null;
    publishPopupState(false);
  });
  const inspectorWebContents = playerInspectorWindow.webContents;
  inspectorWebContents.once('did-finish-load', () => {
    const currentPlayer = String(playerInspectorName || '').trim();
    if (!inspectorWebContents.isDestroyed() && /^[A-Za-z0-9_]{1,16}$/.test(currentPlayer)) {
      inspectorWebContents.send('player-inspector-name', currentPlayer);
    }
  });
  await playerInspectorWindow.loadFile('player-inspector.html', { query: { player: requestedPlayer } });
}

async function createPlayerRoleEditorWindow(roleId = '', parentWindow = window) {
  const cleanRoleId = String(roleId || '').trim().toLowerCase().slice(0, 40);
  if (cleanRoleId && !/^[a-z0-9][a-z0-9._-]*$/.test(cleanRoleId)) return;
  if (playerRoleEditorWindow && !playerRoleEditorWindow.isDestroyed()) {
    playerRoleEditorWindow.webContents.send('player-role-editor-role', cleanRoleId);
    playerRoleEditorWindow.focus();
    return;
  }
  const colors = activeThemeColors();
  playerRoleEditorWindow = new BrowserWindow({
    width: 620,
    height: 560,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    transparent: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
    title: cleanRoleId ? 'Edit Player Role' : 'New Player Role',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: colors.background,
    backgroundMaterial: 'none',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(playerRoleEditorWindow);
  keepAboveFullscreenApps(playerRoleEditorWindow);
  playerRoleEditorWindow.removeMenu();
  playerRoleEditorWindow.on('closed', () => {
    playerRoleEditorWindow = null;
    publishPopupState(false);
  });
  await playerRoleEditorWindow.loadFile('player-role-editor.html', { query: { role: cleanRoleId } });
}

async function askToSaveUnsavedMacro(parentWindow = window) {
  if (macroUnsavedWindow && !macroUnsavedWindow.isDestroyed()) {
    macroUnsavedWindow.focus();
    return false;
  }
  return new Promise(resolve => {
    const colors = activeThemeColors();
    const localized = loadAppSettings().language !== 'en';
    macroUnsavedResolve = resolve;
    macroUnsavedWindow = new BrowserWindow({
      width: localized ? 410 : 350,
      height: 166,
      useContentSize: true,
      parent: parentWindow,
      modal: true,
      frame: true,
      transparent: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 32 },
      title: 'Unsaved Changes',
      resizable: false,
      maximizable: false,
      minimizable: false,
      roundedCorners: true,
      alwaysOnTop: true,
      icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
      autoHideMenuBar: true,
      backgroundColor: colors.background,
      backgroundMaterial: 'none',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    publishPopupState(true);
    lockWindowZoom(macroUnsavedWindow);
    keepAboveFullscreenApps(macroUnsavedWindow);
    macroUnsavedWindow.removeMenu();
    macroUnsavedWindow.on('closed', () => {
      macroUnsavedWindow = null;
      if (macroUnsavedResolve) macroUnsavedResolve(false);
      macroUnsavedResolve = null;
      publishPopupState(false);
    });
    macroUnsavedWindow.loadFile('macro-unsaved.html');
  });
}

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    revealMainWindow();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    migrateLegacyData();
    refreshToolboxIconCacheOnce();
    if (!(await enforceBetaAccess())) return;
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => ['media', 'display-capture', 'speaker-selection'].includes(permission));
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
      const requestingAudio = permission === 'media' && (mediaTypes.length === 0 || mediaTypes.includes('audio'));
      callback(requestingAudio || permission === 'display-capture' || permission === 'speaker-selection');
    });
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!request.audioRequested) { callback({}); return; }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
        callback({ video: sources[0], audio: 'loopback' });
      } catch (_) {
        callback({});
      }
    });
    await createWindow();
    startBackend();
    if (pendingMainProcessError) {
      const message = pendingMainProcessError;
      pendingMainProcessError = null;
      showMainProcessError(message);
    }
    checkForUpdates();
    updateInputDisplay();
    cpsIndicatorRefreshTimer = setInterval(() => updateCpsIndicator(currentGeneratedCps, clickerRunning), 100);
    const updateMinutes = Math.max(5, Number(loadUpdateConfig().checkIntervalMinutes) || 30);
    updateCheckTimer = setInterval(() => checkForUpdates(), updateMinutes * 60 * 1000);
    if (isBetaChannel) betaAccessTimer = setInterval(() => enforceBetaAccess(), 60 * 1000);
  });
}

ipcMain.on('configure', (_event, config) => {
  const settings = loadAppSettings();
  writeBackend({
    ...config,
    auto_tool_active: toolIsOperational('auto-clicker'),
    macro_tool_active: toolIsOperational('macro'),
    emit_generated_input_events: Boolean(settings.showInputDisplay && settings.inputDisplayGenerated)
  });
});

ipcMain.on('restart-backend', () => {
  stopBackend();
  setTimeout(startBackend, 120);
});

ipcMain.on('open-custom-dropdown', (event, payload) => openDropdownWindow(event, payload));
ipcMain.on('close-custom-dropdown', () => closeDropdownWindow());
ipcMain.on('custom-dropdown-select', (_event, payload) => {
  const owner = dropdownOwnerId ? BrowserWindow.getAllWindows().find(target => target.webContents.id === dropdownOwnerId) : null;
  if (owner && !owner.isDestroyed() && !owner.webContents.isDestroyed()) {
    owner.webContents.send('custom-dropdown-selected', { id: dropdownSelectId, value: payload?.value });
  }
  closeDropdownWindow();
});
ipcMain.on('show-hover-hint', (event, payload) => showHoverHint(payload, BrowserWindow.fromWebContents(event.sender)));
ipcMain.on('hide-hover-hint', () => hideHoverHintWindow());
ipcMain.on('hover-hint-painted', (event, payload = {}) => {
  if (!hoverHintWindow || hoverHintWindow.isDestroyed() || event.sender !== hoverHintWindow.webContents) return;
  if (!hoverHintRequest || Number(payload.token) !== hoverHintRequest.token) return;
  positionHoverHint(hoverHintRequest);
});
ipcMain.on('get-window-context', event => {
  const target = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = {
    role: target === detachedToolWindow ? 'detached' : 'main',
    tool: target === detachedToolWindow ? detachedTool : activeMainTool,
    appVersion: app.getVersion(),
    ...toolLayoutState()
  };
});

ipcMain.on('open-settings-window', event => createSettingsWindow(BrowserWindow.fromWebContents(event.sender) || window));
ipcMain.on('load-app-settings', event => { event.returnValue = loadAppSettings(); });
ipcMain.on('settings-draft-changed', (_event, value) => {
  settingsDraft = normalizeAppSettings(value);
  settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(loadAppSettings());
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    const colors = activeThemeColors(settingsDraft);
    applyNativeTheme(settingsWindow, settingsDraft);
    settingsWindow.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbols, height: 32 });
  }
});
ipcMain.on('save-app-settings', (_event, value) => {
  applySavedAppSettings(value);
  settingsDirty = false;
  settingsCloseApproved = true;
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});
ipcMain.on('resolve-unsaved-settings', (_event, choice) => {
  if (choice === 'cancel') {
    if (settingsUnsavedWindow && !settingsUnsavedWindow.isDestroyed()) settingsUnsavedWindow.close();
    return;
  }
  if (choice === 'save') applySavedAppSettings(settingsDraft || loadAppSettings());
  settingsDirty = false;
  settingsCloseApproved = true;
  if (settingsUnsavedWindow && !settingsUnsavedWindow.isDestroyed()) settingsUnsavedWindow.destroy();
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

ipcMain.on('set-active-tool', (_event, tool) => {
  if (!availableTools.includes(tool) || tool === detachedTool) return;
  if (lockedTool && lockedTool !== tool) return;
  if (activeMainTool === tool) return;
  activeMainTool = tool;
  resizeToolWindow(window, activeMainTool);
  publishToolLayout();
});

ipcMain.on('tool-menu-action', (_event, payload = {}) => {
  const tool = payload.tool;
  if (!availableTools.includes(tool) || tool === detachedTool) return;
  if (payload.action === 'lock' && activeMainTool === tool) lockedTool = tool;
  else if (payload.action === 'unlock' && lockedTool === tool) lockedTool = null;
  else if (payload.action === 'detach' && detachedTool === null) {
    createDetachedToolWindow(tool);
    return;
  } else return;
  publishToolLayout();
});

ipcMain.on('load-hotkey', event => {
  event.returnValue = loadHotkey();
});

ipcMain.on('save-hotkey', (_event, value) => {
  saveHotkey(value);
});

ipcMain.on('load-preferences', event => {
  event.returnValue = loadPreferences();
});

ipcMain.on('load-voice-processor-source', event => {
  if (!availableTools.includes('voice')) { event.returnValue = ''; return; }
  try { event.returnValue = fs.readFileSync(path.join(__dirname, 'voice-processor.js'), 'utf8'); }
  catch (_) { event.returnValue = ''; }
});

ipcMain.on('save-preferences', (_event, value) => {
  savePreferences(value);
});

ipcMain.handle('get-crosshair-displays', () => screen.getAllDisplays().map((display, index) => ({
  id: String(display.id),
  label: display.label || `Display ${index + 1}`,
  primary: display.id === screen.getPrimaryDisplay().id,
  width: display.size.width,
  height: display.size.height
})));

ipcMain.on('update-crosshair-overlay', (_event, value) => {
  if (availableTools.includes('crosshair')) updateCrosshairOverlay(value || {});
});
ipcMain.on('open-crosshair-preview', (event) => createCrosshairPreviewWindow(BrowserWindow.fromWebContents(event.sender) || window));
ipcMain.on('crosshair-preview-control', (_event, action) => {
  if (!crosshairPreviewWindow || crosshairPreviewWindow.isDestroyed()) return;
  if (action === 'minimize') crosshairPreviewWindow.minimize();
  if (action === 'close') crosshairPreviewWindow.close();
});

ipcMain.handle('choose-crosshair-image', async event => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || window, {
    title: 'Choose Crosshair Image',
    properties: ['openFile'],
    filters: [{ name: 'Crosshair images', extensions: ['png', 'svg', 'webp', 'jpg', 'jpeg'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Crosshair images must be smaller than 4 MB.');
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mime = extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
  return { name: path.basename(filePath), data: `data:${mime};base64,${bytes.toString('base64')}` };
});

ipcMain.handle('export-crosshair-profile', async (event, profile) => {
  const safeName = String(profile?.name || 'Crosshair').replace(/[<>:"/\\|?*]/g, '').trim() || 'Crosshair';
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || window, {
    title: 'Export Crosshair',
    defaultPath: `${safeName}.cicrosshair`,
    filters: [{ name: 'Click Interval Crosshair', extensions: ['cicrosshair', 'json'] }]
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, JSON.stringify({ format: 'click-interval-crosshair', version: 1, profile }, null, 2), 'utf8');
  return true;
});

ipcMain.handle('export-crosshair-png', async (event, payload = {}) => {
  const safeName = String(payload.name || 'Crosshair').replace(/[<>:"/\\|?*]/g, '').trim() || 'Crosshair';
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || window, {
    title: 'Export Crosshair PNG', defaultPath: `${safeName}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return false;
  const match = /^data:image\/png;base64,(.+)$/i.exec(String(payload.data || ''));
  if (!match) throw new Error('The crosshair image could not be generated.');
  fs.writeFileSync(result.filePath, Buffer.from(match[1], 'base64'));
  return true;
});

ipcMain.handle('import-crosshair-profile', async event => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || window, {
    title: 'Import Crosshair',
    properties: ['openFile'],
    filters: [{ name: 'Click Interval Crosshair', extensions: ['cicrosshair', 'json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const document = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
  return document?.profile && typeof document.profile === 'object' ? document.profile : null;
});

ipcMain.on('copy-crosshair-code', (_event, value) => clipboard.writeText(String(value || '')));
ipcMain.handle('read-clipboard-text', () => clipboard.readText());

ipcMain.on('load-macro-state', event => {
  event.returnValue = loadMacroState();
});

ipcMain.on('save-macro-state', (_event, value) => {
  saveMacroState(value);
});

ipcMain.on('load-macro-library', event => {
  event.returnValue = loadMacroLibrary();
});

ipcMain.on('save-macro-library', (_event, value) => {
  saveMacroLibrary(value);
});

ipcMain.on('ui-ready', () => revealMainWindow());

ipcMain.on('open-hotkey-window', (event, mode) => createHotkeyWindow(mode, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('load-hotkey-dialog', event => {
  const preferences = loadPreferences();
  event.returnValue = {
    mode: hotkeyWindowMode,
    value: hotkeyWindowMode === 'emergency' ? preferences.emergencyHotkey :
      hotkeyWindowMode === 'macro-trigger' ? preferences.macroTrigger :
      hotkeyWindowMode === 'macro-record' ? preferences.macroRecordHotkey :
      hotkeyWindowMode === 'macro-play' ? preferences.macroPlayHotkey :
      hotkeyWindowMode === 'crosshair-toggle' ? preferences.crosshairStudio?.hotkey : loadHotkey()
  };
});

ipcMain.on('hotkey-selected', (_event, value) => {
  if (!validHotkey(value)) return;
  hotkeySelectionCommitted = true;
  saveHotkey(value);
  sendToRenderer('hotkey-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('emergency-hotkey-selected', (_event, value) => {
  if (!value || !Number.isInteger(value.vk) || !Array.isArray(value.keys) || !value.keys.length) return;
  hotkeySelectionCommitted = true;
  sendToRenderer('emergency-hotkey-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('macro-trigger-selected', (_event, value) => {
  if (!value || !Number.isInteger(value.vk) || !Array.isArray(value.keys) || !value.keys.length) return;
  hotkeySelectionCommitted = true;
  sendToRenderer('macro-trigger-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('macro-record-hotkey-selected', (_event, value) => {
  if (!value || !Number.isInteger(value.vk) || !Array.isArray(value.keys) || !value.keys.length) return;
  hotkeySelectionCommitted = true;
  sendToRenderer('macro-record-hotkey-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('macro-play-hotkey-selected', (_event, value) => {
  if (!value || !Number.isInteger(value.vk) || !Array.isArray(value.keys) || !value.keys.length) return;
  hotkeySelectionCommitted = true;
  sendToRenderer('macro-play-hotkey-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('crosshair-hotkey-selected', (_event, value) => {
  if (!value || !Number.isInteger(value.vk) || !Array.isArray(value.keys) || !value.keys.length) return;
  hotkeySelectionCommitted = true;
  sendToRenderer('crosshair-hotkey-selected', value);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.handle('save-macro-file', async (_event, payload) => {
  const saved = writeManagedMacro(payload || {}, payload?.filePath || '');
  return { canceled: false, filePath: saved.filePath, fileSize: saved.fileSize, document: saved.document };
});

ipcMain.handle('open-macro-file', async event => {
  publishPopupState(true);
  let result;
  try {
    result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || window, {
      title: 'Open Macro',
      properties: ['openFile'],
      filters: [
        { name: 'Click Interval Macro', extensions: ['cimacro', 'json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
  } finally {
    publishPopupState(false);
  }
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const storedDocument = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
  if (!storedDocument || !Array.isArray(storedDocument.actions)) throw new Error('This file does not contain a valid macro action list.');
  const document = { ...storedDocument, actions: unpackMacroActions(storedDocument.actions) };
  const imported = writeManagedMacro({ ...document, id: crypto.randomUUID() });
  return { canceled: false, filePath: imported.filePath, fileSize: imported.fileSize, document: imported.document };
});

ipcMain.handle('pick-screen-point', () => new Promise(resolve => {
  if (screenPointPickerWindows.some(picker => !picker.isDestroyed())) {
    const previousResolve = screenPointPickerResolve;
    screenPointPickerResolve = null;
    if (previousResolve) previousResolve({ canceled: true });
    for (const picker of screenPointPickerWindows) if (!picker.isDestroyed()) picker.destroy();
    screenPointPickerWindows = [];
  }
  screenPointPickerResolve = resolve;
  const pickers = screen.getAllDisplays().map(display => {
    const picker = new BrowserWindow({
      ...display.bounds,
      frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'point-picker-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    picker.setAlwaysOnTop(true, 'screen-saver');
    picker.on('closed', () => {
      screenPointPickerWindows = screenPointPickerWindows.filter(item => item !== picker);
      if (!screenPointPickerWindows.length && screenPointPickerResolve === resolve) {
        screenPointPickerResolve = null;
        resolve({ canceled: true });
      }
    });
    return picker;
  });
  screenPointPickerWindows = pickers;
  Promise.all(pickers.map(picker => picker.loadFile('point-picker.html'))).then(() => {
    for (const picker of pickers) if (!picker.isDestroyed()) picker.showInactive();
    const primary = pickers.find(picker => screen.getDisplayMatching(picker.getBounds()).id === screen.getPrimaryDisplay().id) || pickers[0];
    if (primary && !primary.isDestroyed()) primary.focus();
  }).catch(error => {
    for (const picker of pickers) if (!picker.isDestroyed()) picker.destroy();
    if (screenPointPickerResolve === resolve) {
      screenPointPickerResolve = null;
      resolve({ canceled: true, error: error.message });
    }
  });
}));

ipcMain.on('get-picker-language', event => {
  event.returnValue = loadAppSettings().language;
});

ipcMain.on('screen-point-picker-result', (event, payload = {}) => {
  if (!screenPointPickerWindows.some(picker => !picker.isDestroyed() && event.sender === picker.webContents)) return;
  const resolve = screenPointPickerResolve;
  screenPointPickerResolve = null;
  const result = payload.canceled ? { canceled: true } : {
    canceled: false,
    x: Math.round(Number(payload.x)),
    y: Math.round(Number(payload.y))
  };
  const pickers = screenPointPickerWindows;
  screenPointPickerWindows = [];
  for (const picker of pickers) if (!picker.isDestroyed()) picker.destroy();
  if (resolve) resolve(result);
});

ipcMain.handle('pick-smart-area', () => new Promise(resolve => {
  if (smartAreaPickerWindows.some(picker => !picker.isDestroyed())) {
    const previousResolve = smartAreaPickerResolve;
    smartAreaPickerResolve = null;
    if (previousResolve) previousResolve({ canceled: true });
    for (const picker of smartAreaPickerWindows) if (!picker.isDestroyed()) picker.destroy();
    smartAreaPickerWindows = [];
  }
  smartAreaPickerResolve = resolve;
  const pickers = screen.getAllDisplays().map(display => {
    const picker = new BrowserWindow({
      ...display.bounds,
      frame: false, transparent: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'area-picker-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    picker.setAlwaysOnTop(true, 'screen-saver');
    picker.on('closed', () => {
      smartAreaPickerWindows = smartAreaPickerWindows.filter(item => item !== picker);
      if (!smartAreaPickerWindows.length && smartAreaPickerResolve === resolve) {
        smartAreaPickerResolve = null;
        resolve({ canceled: true });
      }
    });
    return picker;
  });
  smartAreaPickerWindows = pickers;
  Promise.all(pickers.map(picker => picker.loadFile('area-picker.html'))).then(() => {
    for (const picker of pickers) if (!picker.isDestroyed()) picker.showInactive();
    const primary = pickers.find(picker => screen.getDisplayMatching(picker.getBounds()).id === screen.getPrimaryDisplay().id) || pickers[0];
    if (primary && !primary.isDestroyed()) primary.focus();
  }).catch(error => {
    for (const picker of pickers) if (!picker.isDestroyed()) picker.destroy();
    if (smartAreaPickerResolve === resolve) {
      smartAreaPickerResolve = null;
      resolve({ canceled: true, error: error.message });
    }
  });
}));

ipcMain.on('area-picker-result', (event, payload = {}) => {
  if (!smartAreaPickerWindows.some(picker => !picker.isDestroyed() && event.sender === picker.webContents)) return;
  const resolve = smartAreaPickerResolve;
  smartAreaPickerResolve = null;
  const result = payload.canceled ? { canceled: true } : {
    canceled: false,
    x: Math.round(Number(payload.x)),
    y: Math.round(Number(payload.y)),
    width: Math.round(Number(payload.width)),
    height: Math.round(Number(payload.height))
  };
  const pickers = smartAreaPickerWindows;
  smartAreaPickerWindows = [];
  for (const picker of pickers) if (!picker.isDestroyed()) picker.destroy();
  if (resolve) resolve(result);
});


ipcMain.handle('confirm-unsaved-macro', event => askToSaveUnsavedMacro(BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('resolve-unsaved-macro', (_event, shouldSave) => {
  const resolve = macroUnsavedResolve;
  macroUnsavedResolve = null;
  if (resolve) resolve(Boolean(shouldSave));
  if (macroUnsavedWindow && !macroUnsavedWindow.isDestroyed()) macroUnsavedWindow.close();
});

ipcMain.on('check-for-updates', (_event, manual = true) => {
  if (manual) publishUpdateStatus('checking');
  checkForUpdates({ manual: Boolean(manual) });
});
ipcMain.handle('install-update', async () => {
  await checkForUpdates({ manual: true });
  if (!availableUpdate) return { started: false, reason: 'No update is currently available.' };
  if (launchUpdater()) return { started: true, mode: 'updater' };
  await installAvailableUpdate();
  return { started: true, mode: 'installer' };
});

ipcMain.on('open-message-window', (event, payload) => createMessageWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('open-macro-name-window', (event, payload) => createMacroNameWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('load-macro-name-dialog', event => {
  event.returnValue = macroNameDialog;
});

ipcMain.on('submit-macro-name', (_event, value) => {
  const name = String(value || '').trim().slice(0, macroNameDialog.maxLength || (macroNameDialog.secret ? 256 : 80));
  if (!name) return;
  const result = { ...macroNameDialog, name };
  if (macroNameDialog.entity === 'server' && macroNameWindow && !macroNameWindow.isDestroyed()) {
    macroNameWindow.once('closed', () => sendToRenderer('macro-name-created', result));
    macroNameWindow.close();
    return;
  }
  sendToRenderer('macro-name-created', result);
  if (macroNameWindow && !macroNameWindow.isDestroyed()) macroNameWindow.close();
});

ipcMain.on('open-macro-delete-window', (event, payload) => createMacroDeleteWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('open-motd-editor', (event, value) => createMotdEditorWindow(value, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('open-player-inspector', (event, name) => createPlayerInspectorWindow(name, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('open-player-role-editor', (event, roleId) => createPlayerRoleEditorWindow(roleId, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('player-access-changed', () => {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('player-access-changed');
  }
});

ipcMain.on('load-player-inspector-name', event => {
  event.returnValue = playerInspectorName;
});

ipcMain.on('load-motd-editor-value', event => {
  event.returnValue = motdEditorState;
});

ipcMain.on('submit-motd-editor', (_event, value) => {
  const motd = String(value || '').slice(0, 1024);
  motdEditorState = { ...motdEditorState, value: motd };
  if (motdEditorWindow && !motdEditorWindow.isDestroyed()) {
    motdEditorWindow.once('closed', () => sendToRenderer('motd-editor-saved', motd));
    motdEditorWindow.close();
    return;
  }
  sendToRenderer('motd-editor-saved', motd);
});

ipcMain.on('load-macro-delete-dialog', event => {
  event.returnValue = macroDeleteWindow && !macroDeleteWindow.isDestroyed() && event.sender === macroDeleteWindow.webContents
    ? macroDeleteDialog : null;
});

ipcMain.on('confirm-macro-delete', (event, options) => {
  if (!macroDeleteWindow || macroDeleteWindow.isDestroyed() || event.sender !== macroDeleteWindow.webContents || macroDeleteConfirmed) return;
  macroDeleteConfirmed = true;
  if (macroDeleteDialog.entity === 'server') {
    const confirmed = { ...macroDeleteDialog, deleted: true, message: '' };
    if (macroDeleteDialog.action === 'wipe') {
      confirmed.resetSettings = options?.resetSettings === true;
      const resetFieldNames = ['serverIcon', 'serverType', 'serverVersion', 'levelName', 'motd', 'publicAddress', 'simulationDistance'];
      confirmed.resetFields = resetFieldNames.filter(field => Array.isArray(options?.resetFields) && options.resetFields.includes(field));
      if (macroDeleteOwner && !macroDeleteOwner.isDestroyed()) macroDeleteOwner.send('macro-delete-confirmed', confirmed);
    } else {
      sendToRenderer('macro-delete-confirmed', confirmed);
    }
    if (macroDeleteWindow && !macroDeleteWindow.isDestroyed()) macroDeleteWindow.close();
    return;
  }
  if (macroDeleteDialog.id) {
    let deleted = true;
    let message = '';
    try {
      if (macroDeleteDialog.filePath) {
        if (!pathInsideMacrosDirectory(macroDeleteDialog.filePath)) throw new Error('The macro is outside the managed Macros folder.');
        if (fs.existsSync(macroDeleteDialog.filePath)) fs.unlinkSync(macroDeleteDialog.filePath);
      }
    } catch (error) {
      deleted = false;
      message = error.message;
    }
    sendToRenderer('macro-delete-confirmed', { ...macroDeleteDialog, deleted, message });
  }
  if (macroDeleteWindow && !macroDeleteWindow.isDestroyed()) macroDeleteWindow.close();
});

ipcMain.on('close-current-window', event => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (target && !target.isDestroyed()) target.close();
});

ipcMain.on('window-control', (_event, action) => {
  const target = BrowserWindow.fromWebContents(_event.sender);
  if (!target || target.isDestroyed()) return;
  if (action === 'minimize') target.minimize();
  if (action === 'close') {
    if (target === detachedToolWindow) target.close();
    else if (detachedToolWindow && !detachedToolWindow.isDestroyed()) promoteDetachedWindow();
    else quitCleanly();
  }
});

app.on('window-all-closed', () => quitCleanly());
app.on('before-quit', () => {
  stopSmartActivationMonitor();
  stopBackend();
});
