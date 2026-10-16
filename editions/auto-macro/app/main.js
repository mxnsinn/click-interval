const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, nativeTheme, screen } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { packMacroActions, unpackMacroActions } = require('./macro-codec');
const { showRevocationAndExit } = require('./beta-uninstall');
const { createFriendUpdateController } = require('./update-client');
const { minimalChildEnvironment } = require('./process-environment');
const { isWineEnvironment } = require('./wine-compat');

const WINE_COMPATIBILITY = isWineEnvironment();

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
let macroNameWindow;
let macroDeleteWindow;
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
let macroNameDialog = { mode: 'create', id: null, name: '' };
let macroDeleteDialog = { id: null, name: '' };
let hotkeySelectionCommitted = false;
let hotkeyWindowMode = 'start-stop';
let shuttingDown = false;
let updateCheckTimer = null;
let updateController = null;
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
let pendingMainProcessError = null;
const failedBackendProcesses = new WeakSet();
const expectedBackendStops = new WeakSet();
const hardenedRendererSessions = new WeakSet();
const MAX_IMPORTED_MACRO_BYTES = 4 * 1024 * 1024;

// BACKEND_PIPE_SAFETY_START
// Keep a broken or hostile child process from growing the Electron main
// process without bounds. The larger line allowance is for macro recordings.
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
const BACKEND_PENDING_COMMAND_LIMIT = 128;
const BACKEND_COALESCED_EVENT_TYPES = new Set(['cps', 'physical_click', 'input_event', 'macro_playback_loop']);
const BACKEND_PRIORITY_EVENT_TYPES = new Set([
  'ready', 'configured', 'started', 'stopped', 'emergency_stop', 'error', 'macro_error',
  'macro_recording_started', 'macro_recording_stopped', 'macro_playback_started',
  'macro_playback_stopped', 'cursor_pick_started', 'cursor_picked', 'mouse_hook_ready',
  'emergency_hotkey_ready', 'macro_actions_set'
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

nativeTheme.themeSource = 'dark';
app.setName('Click Interval');
process.title = 'Click Interval';
app.setAppUserModelId('ClickInterval.AutoMacro');

function hardenRendererSession(targetSession) {
  if (!targetSession || hardenedRendererSessions.has(targetSession)) return;
  hardenedRendererSessions.add(targetSession);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.on('will-download', event => event.preventDefault());
  targetSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  );
}

app.on('web-contents-created', (_event, contents) => {
  hardenRendererSession(contents.session);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
});

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

// Keep this edition's runtime profile separate from the full Click Interval
// application even though both products intentionally use the same display
// name. Never fall back to the full app's `click-interval` profile.
const userDataPath = path.join(app.getPath('appData'), 'click-interval-auto-macro');
app.setPath('userData', userDataPath);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

function durableDataDirectory() {
  return path.join(app.getPath('documents'), 'Click Interval Auto Macro');
}

function settingsDirectory() {
  return path.join(durableDataDirectory(), 'Settings');
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

function backendDiagnosticsPath() {
  const directory = path.join(userDataPath, 'Diagnostics');
  ensurePlainDirectory(directory, 'Click Interval diagnostics folder');
  return resolvePrivateFile(directory, path.join(directory, 'live-backend-state.json'), { label: 'Click Interval diagnostics' });
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isStrictChildPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function ensurePlainDirectory(directory, label) {
  fs.mkdirSync(directory, { recursive: true });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a safe local directory.`);
  return path.resolve(directory);
}

function resolvePrivateFile(rootDirectory, filePath, options = {}) {
  const requestedRoot = path.resolve(rootDirectory);
  if (pathIdentity(requestedRoot) === pathIdentity(userDataPath) || isStrictChildPath(userDataPath, requestedRoot)) {
    ensurePlainDirectory(userDataPath, 'Click Interval AppData folder');
  } else if (pathIdentity(requestedRoot) === pathIdentity(durableDataDirectory()) || isStrictChildPath(durableDataDirectory(), requestedRoot)) {
    ensurePlainDirectory(durableDataDirectory(), 'Click Interval Documents folder');
  } else {
    throw new Error(`${options.label || 'Click Interval data folder'} is outside this edition's private storage.`);
  }
  const root = ensurePlainDirectory(requestedRoot, options.label || 'Click Interval data folder');
  const target = path.resolve(String(filePath || ''));
  if (!isStrictChildPath(root, target)) throw new Error(`${options.label || 'Click Interval data file'} is outside its private folder.`);
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${options.label || 'Click Interval data path'} contains a link.`);
    if (pathIdentity(current) !== pathIdentity(target) && !stat.isDirectory()) {
      throw new Error(`${options.label || 'Click Interval data path'} has an invalid parent.`);
    }
  }
  if (options.mustExist) {
    if (!fs.existsSync(target)) throw new Error(`${options.label || 'Click Interval data file'} does not exist.`);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${options.label || 'Click Interval data file'} is not a regular file.`);
  }
  return target;
}

function assertEditionStorageBoundaries() {
  const appDataRoot = path.resolve(app.getPath('appData'));
  const documentsRoot = path.resolve(app.getPath('documents'));
  if (pathIdentity(userDataPath) !== pathIdentity(path.join(appDataRoot, 'click-interval-auto-macro')) ||
      pathIdentity(durableDataDirectory()) !== pathIdentity(path.join(documentsRoot, 'Click Interval Auto Macro'))) {
    throw new Error('Click Interval refused an unexpected data location.');
  }
  ensurePlainDirectory(userDataPath, 'Click Interval AppData folder');
  ensurePlainDirectory(durableDataDirectory(), 'Click Interval Documents folder');
  ensurePlainDirectory(settingsDirectory(), 'Click Interval settings folder');
  ensurePlainDirectory(macrosDirectory(), 'Click Interval macros folder');
}

function migrateLegacyData() {
  const legacyFiles = ['hotkey-settings.json', 'preferences.json', 'last-macro.json', 'macro-library.json'];
  assertEditionStorageBoundaries();
  for (const fileName of legacyFiles) {
    try {
      const sourceCandidate = path.join(userDataPath, fileName);
      const destination = resolvePrivateFile(settingsDirectory(), path.join(settingsDirectory(), fileName), { label: 'Click Interval setting' });
      if (!fs.existsSync(destination) && fs.existsSync(sourceCandidate)) {
        const source = resolvePrivateFile(userDataPath, sourceCandidate, { mustExist: true, label: 'Legacy Click Interval setting' });
        fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      }
    } catch (_) {}
  }
  const sourceDirectory = path.join(userDataPath, 'Macros');
  try {
    if (!fs.existsSync(sourceDirectory)) return;
    ensurePlainDirectory(sourceDirectory, 'Legacy Click Interval macros folder');
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() === '.cimacro') {
        const jsonReplacement = path.join(macrosDirectory(), `${path.basename(entry.name, path.extname(entry.name))}.json`);
        if (fs.existsSync(jsonReplacement)) continue;
      }
      const source = resolvePrivateFile(sourceDirectory, path.join(sourceDirectory, entry.name), { mustExist: true, label: 'Legacy Click Interval macro' });
      const destination = resolvePrivateFile(macrosDirectory(), path.join(macrosDirectory(), entry.name), { label: 'Click Interval macro' });
      if (!fs.existsSync(destination)) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
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

function assertManagedMacroPath(filePath, options = {}) {
  return resolvePrivateFile(macrosDirectory(), filePath, { ...options, label: 'Managed macro' });
}

function pathInsideMacrosDirectory(filePath) {
  try {
    assertManagedMacroPath(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function uniqueManagedMacroPath(name, currentPath = '') {
  ensurePlainDirectory(macrosDirectory(), 'Click Interval macros folder');
  const preferred = assertManagedMacroPath(path.join(macrosDirectory(), safeMacroFileName(name)));
  if (currentPath) return assertManagedMacroPath(currentPath);
  if (!fs.existsSync(preferred)) return preferred;
  const extension = path.extname(preferred);
  const stem = preferred.slice(0, -extension.length);
  let suffix = 2;
  while (fs.existsSync(assertManagedMacroPath(`${stem} (${suffix})${extension}`))) suffix += 1;
  return assertManagedMacroPath(`${stem} (${suffix})${extension}`);
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
  ensurePlainDirectory(macrosDirectory(), 'Click Interval macros folder');
  const macros = [];
  for (const entry of fs.readdirSync(macrosDirectory(), { withFileTypes: true })) {
    if (!entry.isFile() || !['.json', '.cimacro'].includes(path.extname(entry.name).toLowerCase())) continue;
    try {
      const filePath = assertManagedMacroPath(path.join(macrosDirectory(), entry.name), { mustExist: true });
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

function loadPreferences() {
  try {
    const filePath = resolvePrivateFile(settingsDirectory(), preferenceSettingsPath(), { mustExist: true, label: 'Click Interval preferences' });
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
}

function savePreferences(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    const filePath = resolvePrivateFile(settingsDirectory(), preferenceSettingsPath(), { label: 'Click Interval preferences' });
    const current = loadPreferences();
    fs.writeFileSync(filePath, JSON.stringify({ ...current, ...value }, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function loadMacroState() {
  try {
    const filePath = resolvePrivateFile(settingsDirectory(), macroStatePath(), { mustExist: true, label: 'Click Interval macro state' });
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && Array.isArray(value.actions) ? value : { name: 'My Macro', actions: [] };
  } catch (_) {
    return { name: 'My Macro', actions: [] };
  }
}

function saveMacroState(value) {
  if (!value || !Array.isArray(value.actions)) return false;
  try {
    const filePath = resolvePrivateFile(settingsDirectory(), macroStatePath(), { label: 'Click Interval macro state' });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
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
    const filePath = resolvePrivateFile(settingsDirectory(), macroLibraryPath(), { mustExist: true, label: 'Click Interval macro library' });
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    const filePath = resolvePrivateFile(settingsDirectory(), macroLibraryPath(), { label: 'Click Interval macro library' });
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
    fs.writeFileSync(filePath, JSON.stringify(index), 'utf8');
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
    const filePath = resolvePrivateFile(settingsDirectory(), hotkeySettingsPath(), { mustExist: true, label: 'Click Interval hotkey settings' });
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return validHotkey(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function saveHotkey(value) {
  if (!validHotkey(value)) return false;
  try {
    const filePath = resolvePrivateFile(settingsDirectory(), hotkeySettingsPath(), { label: 'Click Interval hotkey settings' });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

app.disableHardwareAcceleration();

function keepAboveFullscreenApps(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.isMinimized()) return;
  targetWindow.setAlwaysOnTop(true, 'screen-saver');
  targetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (hoverHintRequest && hoverHintOwnerId === targetWindow.webContents.id) {
    setImmediate(() => raiseHoverHintAboveOwner());
  }
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

function scheduleBackendRestart(message = 'The click engine stopped and is being restarted.') {
  if (shuttingDown || backendRestartTimer) return;
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
    resizable: false,
    focusable: !nonActivating,
    transparent: false,
    backgroundColor: '#181818',
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    parent,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      nodeIntegration: false
    }
  });
  lockWindowZoom(dropdownWindow);
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
        sandbox: true,
        spellcheck: false,
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
  try {
    hoverHintWindow.moveAbove(owner.getMediaSourceId());
  } catch (_) {}
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
  setImmediate(() => {
    if (hoverHintRequest?.token === request.token) raiseHoverHintAboveOwner();
  });
  setTimeout(() => {
    if (hoverHintRequest?.token === request.token) raiseHoverHintAboveOwner();
  }, 60);
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
  return { activeMainTool, detachedTool, lockedTool };
}

function publishToolLayout() {
  sendToRenderer('tool-layout-state', toolLayoutState());
  writeBackend({
    action: 'configure',
    auto_tool_active: detachedTool !== null || activeMainTool === 'auto-clicker',
    macro_tool_active: detachedTool !== null || activeMainTool === 'macro'
  });
}

function stopTool(tool) {
  if (tool === 'auto-clicker') writeBackend({ action: 'stop' });
  if (tool === 'macro') {
    writeBackend({ action: 'macro_record_stop' });
    writeBackend({ action: 'macro_stop' });
  }
}

function publishUpdateStatus(status, details = {}) {
  sendToRenderer('update-status', { status, ...details });
}

function friendUpdater() {
  if (!updateController) {
    updateController = createFriendUpdateController({
      app,
      applicationPath: __dirname,
      settingsDirectory,
      sendStatus: publishUpdateStatus,
      quitForUpdate: () => quitCleanly(true),
      onIntegrityFailure: async error => {
        if (updateCheckTimer) clearInterval(updateCheckTimer);
        updateCheckTimer = null;
        stopSmartActivationMonitor();
        stopBackend();
        if (window && !window.isDestroyed()) window.hide();
        await dialog.showMessageBox({
          type: 'error',
          title: 'Click Interval blocked',
          message: 'The installed application files were changed.',
          detail: String(error?.message || 'Reinstall or restore the original signed files before using the app.'),
          buttons: ['Close'],
          defaultId: 0,
          noLink: true
        });
        quitCleanly(true);
      },
      onRevoked: control => showRevocationAndExit({
        app,
        dialog,
        parentWindow: window,
        control,
        applicationPath: __dirname,
        beforeExit: () => {
          if (updateCheckTimer) clearInterval(updateCheckTimer);
          updateCheckTimer = null;
          stopSmartActivationMonitor();
          stopBackend();
        }
      })
    });
  }
  return updateController;
}

function checkForUpdates({ manual = false } = {}) {
  return friendUpdater().check({ manual });
}

function installAvailableUpdate() {
  return friendUpdater().install();
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
    backend = spawn(python, ['-u', script, '--diagnostic-path', backendDiagnosticsPath()], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...minimalChildEnvironment(),
        ...(WINE_COMPATIBILITY ? { CLICK_INTERVAL_WINE_COMPAT: '1' } : {})
      }
    });
  } catch (error) {
    backend = null;
    scheduleBackendRestart(`The click engine could not start and will retry. ${error.message}`);
    return;
  }

  const backendProcess = backend;
  backendProcess.stdin.on('error', error => handleBackendPipeFailure(backendProcess, error));
  backendProcess.on('error', error => handleBackendPipeFailure(backendProcess, error));

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
    if (event.type === 'cps') return { type: 'cps', value: Math.max(0, Number(event.value) || 0), button: bounded(event.button, 16) };
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

  const flushBackendDiagnostics = () => {
    if (diagnosticFlushTimer) clearTimeout(diagnosticFlushTimer);
    diagnosticFlushTimer = null;
    if (!diagnosticPending || backendProcess !== backend) {
      diagnosticPending = null;
      diagnosticSuppressed = 0;
      return;
    }
    const event = { ...diagnosticPending };
    if (diagnosticSuppressed > 0) event.message = `${event.message} (${diagnosticSuppressed} additional backend messages were suppressed.)`;
    diagnosticPending = null;
    diagnosticSuppressed = 0;
    sendBackendEventIpc(event);
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
    stdoutDrainTimer = setTimeout(drainStdoutQueue, Math.max(0, stdoutNextDrainAt - Date.now()));
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
      flushBackendDiagnostics();
    }
    for (const timer of [stdoutDrainTimer, stderrFlushTimer, diagnosticFlushTimer, telemetryFlushTimer]) clearTimeout(timer);
    stdoutAccumulator.clear();
    stdoutQueue.length = 0;
    telemetryPending.clear();
    backendReady = false;
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

function quitCleanly(exitImmediately = false) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (smartAreaPickerResolve) smartAreaPickerResolve({ canceled: true });
  smartAreaPickerResolve = null;
  for (const picker of smartAreaPickerWindows) if (!picker.isDestroyed()) picker.destroy();
  smartAreaPickerWindows = [];
  stopBackend();
  if (exitImmediately) app.exit(0);
  else app.quit();
}

async function createSplashWindow() {
  if (process.env.OP_MOUSE_TEST === '1') return;
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
      sandbox: true,
      spellcheck: false,
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
  window.show();
  keepAboveFullscreenApps(window);
  window.focus();
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

async function createWindow() {
  window = new BrowserWindow({
    width: 437,
    height: 423,
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    backgroundColor: '#101010',
    title: `Click Interval V ${app.getVersion()}`,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      nodeIntegration: false
    }
  });
  lockWindowZoom(window);
  await window.loadFile('index.html');
  keepAboveFullscreenApps(window);
  window.on('show', () => keepAboveFullscreenApps(window));
  window.on('restore', () => keepAboveFullscreenApps(window));
  window.on('blur', () => setImmediate(() => keepAboveFullscreenApps(window)));
}

async function createDetachedToolWindow(tool) {
  if (detachedToolWindow && !detachedToolWindow.isDestroyed()) {
    detachedToolWindow.focus();
    return;
  }
  detachedTool = tool === 'macro' ? 'macro' : 'auto-clicker';
  activeMainTool = detachedTool === 'macro' ? 'auto-clicker' : 'macro';
  if (lockedTool === detachedTool) lockedTool = null;
  detachedToolWindow = new BrowserWindow({
    width: 437,
    height: 391,
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    backgroundColor: '#101010',
    title: detachedTool === 'macro' ? 'Click Interval — Macro' : 'Click Interval — Auto Clicker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      nodeIntegration: false
    }
  });
  lockWindowZoom(detachedToolWindow);
  await detachedToolWindow.loadFile('index.html', { query: { detached: detachedTool } });
  keepAboveFullscreenApps(detachedToolWindow);
  detachedToolWindow.on('show', () => keepAboveFullscreenApps(detachedToolWindow));
  detachedToolWindow.on('closed', () => {
    const closedTool = detachedTool;
    detachedToolWindow = null;
    detachedTool = null;
    stopTool(closedTool);
    publishToolLayout();
  });
  detachedToolWindow.show();
  publishToolLayout();
}

async function promoteDetachedWindow() {
  if (!detachedToolWindow || detachedToolWindow.isDestroyed()) return false;
  const oldMain = window;
  const promotedTool = detachedTool;
  const closedTool = activeMainTool;
  window = detachedToolWindow;
  detachedToolWindow = null;
  detachedTool = null;
  activeMainTool = promotedTool || 'auto-clicker';
  lockedTool = null;
  window.setSize(437, 423);
  await window.loadFile('index.html');
  keepAboveFullscreenApps(window);
  if (oldMain && !oldMain.isDestroyed()) oldMain.destroy();
  stopTool(closedTool);
  publishToolLayout();
  return true;
}

async function createHotkeyWindow(mode = 'start-stop', parentWindow = window) {
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) {
    hotkeyWindow.focus();
    return;
  }
  hotkeyWindowMode = ['emergency', 'macro-trigger', 'macro-record', 'macro-play'].includes(mode) ? mode : 'start-stop';
  hotkeySelectionCommitted = false;
  hotkeyWindow = new BrowserWindow({
    width: 230,
    height: 144,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101010', symbolColor: '#ffffff', height: 32 },
    title: hotkeyWindowMode === 'emergency' ? 'Emergency Stop Setting' :
      hotkeyWindowMode === 'macro-trigger' ? 'Macro Trigger Setting' :
      hotkeyWindowMode === 'macro-record' ? 'Record Shortcut Setting' :
      hotkeyWindowMode === 'macro-play' ? 'Playback Shortcut Setting' : 'Hotkey Setting',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
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
  messageWindow = new BrowserWindow({
    width: 340,
    height: 157,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101010', symbolColor: '#ffffff', height: 32 },
    title: payload.title || 'Information',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
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

async function createMacroNameWindow(payload = {}, parentWindow = window) {
  if (macroNameWindow && !macroNameWindow.isDestroyed()) {
    macroNameWindow.focus();
    return;
  }
  macroNameDialog = {
    mode: payload.mode === 'rename' ? 'rename' : 'create',
    id: typeof payload.id === 'string' ? payload.id : null,
    name: typeof payload.name === 'string' ? payload.name : ''
  };
  macroNameWindow = new BrowserWindow({
    width: 310,
    height: 166,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101010', symbolColor: '#ffffff', height: 32 },
    title: 'New Macro',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
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
    id: typeof payload.id === 'string' ? payload.id : null,
    name: typeof payload.name === 'string' ? payload.name : 'this macro',
    filePath: typeof payload.filePath === 'string' ? payload.filePath : ''
  };
  macroDeleteWindow = new BrowserWindow({
    width: 330,
    height: 158,
    useContentSize: true,
    parent: parentWindow,
    modal: true,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101010', symbolColor: '#ffffff', height: 32 },
    title: 'Delete Macro',
    resizable: false,
    maximizable: false,
    minimizable: false,
    roundedCorners: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      nodeIntegration: false
    }
  });
  publishPopupState(true);
  lockWindowZoom(macroDeleteWindow);
  keepAboveFullscreenApps(macroDeleteWindow);
  macroDeleteWindow.removeMenu();
  macroDeleteWindow.on('closed', () => { macroDeleteWindow = null; publishPopupState(false); });
  await macroDeleteWindow.loadFile('macro-delete.html');
}

async function askToSaveUnsavedMacro(parentWindow = window) {
  if (macroUnsavedWindow && !macroUnsavedWindow.isDestroyed()) {
    macroUnsavedWindow.focus();
    return false;
  }
  return new Promise(resolve => {
    macroUnsavedResolve = resolve;
    macroUnsavedWindow = new BrowserWindow({
      width: 350,
      height: 166,
      useContentSize: true,
      parent: parentWindow,
      modal: true,
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#101010', symbolColor: '#ffffff', height: 32 },
      title: 'Unsaved Changes',
      resizable: false,
      maximizable: false,
      minimizable: false,
      roundedCorners: true,
      alwaysOnTop: true,
      icon: path.join(__dirname, 'assets', 'toolbox-icon.ico'),
      autoHideMenuBar: true,
      backgroundColor: '#101010',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
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
    await createSplashWindow();
    await createWindow();
    startBackend();
    if (pendingMainProcessError) {
      const message = pendingMainProcessError;
      pendingMainProcessError = null;
      showMainProcessError(message);
    }
    checkForUpdates();
    const updateMinutes = friendUpdater().intervalMinutes();
    updateCheckTimer = setInterval(() => checkForUpdates(), updateMinutes * 60 * 1000);
    setTimeout(revealMainWindow, 8000);
  });
}

ipcMain.on('configure', (_event, config) => {
  writeBackend({
    ...config,
    auto_tool_active: detachedTool !== null || activeMainTool === 'auto-clicker',
    macro_tool_active: detachedTool !== null || activeMainTool === 'macro'
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

ipcMain.on('set-active-tool', (_event, tool) => {
  if (!['auto-clicker', 'macro'].includes(tool) || tool === detachedTool) return;
  if (lockedTool && lockedTool !== tool) return;
  if (activeMainTool === tool) return;
  stopTool(activeMainTool);
  activeMainTool = tool;
  publishToolLayout();
});

ipcMain.on('tool-menu-action', (_event, payload = {}) => {
  const tool = payload.tool;
  if (!['auto-clicker', 'macro'].includes(tool) || tool === detachedTool) return;
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

ipcMain.on('save-preferences', (_event, value) => {
  savePreferences(value);
});

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
      hotkeyWindowMode === 'macro-play' ? preferences.macroPlayHotkey : loadHotkey()
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
  const selectedPath = path.resolve(result.filePaths[0]);
  if (!['.json', '.cimacro'].includes(path.extname(selectedPath).toLowerCase())) {
    throw new Error('Select a .json or .cimacro macro file.');
  }
  const selectedStat = fs.lstatSync(selectedPath);
  if (!selectedStat.isFile() || selectedStat.isSymbolicLink() || selectedStat.size < 2 || selectedStat.size > MAX_IMPORTED_MACRO_BYTES) {
    throw new Error('This macro file is not a safe regular file or is too large.');
  }
  const storedDocument = JSON.parse(fs.readFileSync(selectedPath, 'utf8'));
  if (!storedDocument || !Array.isArray(storedDocument.actions)) throw new Error('This file does not contain a valid macro action list.');
  const document = { ...storedDocument, actions: unpackMacroActions(storedDocument.actions) };
  const imported = writeManagedMacro({ ...document, id: crypto.randomUUID() });
  return { canceled: false, filePath: imported.filePath, fileSize: imported.fileSize, document: imported.document };
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
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'area-picker-preload.js'),
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
        nodeIntegration: false
      }
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

ipcMain.on('check-for-updates', () => checkForUpdates({ manual: true }));
ipcMain.on('install-update', () => installAvailableUpdate());

ipcMain.on('open-message-window', (event, payload) => createMessageWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('open-macro-name-window', (event, payload) => createMacroNameWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('load-macro-name-dialog', event => {
  event.returnValue = macroNameDialog;
});

ipcMain.on('submit-macro-name', (_event, value) => {
  const name = String(value || '').trim().slice(0, 80);
  if (!name) return;
  sendToRenderer('macro-name-created', { ...macroNameDialog, name });
  if (macroNameWindow && !macroNameWindow.isDestroyed()) macroNameWindow.close();
});

ipcMain.on('open-macro-delete-window', (event, payload) => createMacroDeleteWindow(payload || {}, BrowserWindow.fromWebContents(event.sender) || window));

ipcMain.on('load-macro-delete-dialog', event => {
  event.returnValue = macroDeleteDialog;
});

ipcMain.on('confirm-macro-delete', () => {
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
    sendToRenderer('macro-delete-confirmed', { id: macroDeleteDialog.id, deleted, message });
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
