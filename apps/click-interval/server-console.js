const api = window.bridge.minecraftServer;
const output = document.getElementById('consoleOutput');
const toolbar = document.getElementById('consoleToolbar');
const commandForm = document.getElementById('consoleCommand');
const input = document.getElementById('consoleInput');
const ghost = document.getElementById('consoleGhost');
const ghostPrefix = document.getElementById('consoleGhostPrefix');
const ghostTail = document.getElementById('consoleGhostTail');
const completeHint = document.getElementById('consoleCompleteHint');
const stateLabel = document.getElementById('consoleState');
const stateWrap = document.getElementById('consoleStateWrap');
const sessionName = document.getElementById('consoleSessionName');

const MAX_LINES = 2200;
const MAX_CHARACTERS = 280000;
const MAX_HISTORY = 60;

const LOCAL_HELPERS = new Set([
  'status', 'worlds', 'settings', 'get', 'set', 'diagnose', 'repair', 'selfplay', 'local-only', 'direct', 'tunnel', 'open', 'send',
  'stop', 'shutdown', 'silent', 'silent-restart', 'seamless-restart', 'setup', 'addons', 'anticheat'
]);

const MINECRAFT_COMMAND_COMPLETIONS = [
  '/list', '/say ', '/me ', '/msg ', '/tell ', '/w ', '/tellraw ',
  '/kick ', '/ban ', '/ban-ip ', '/pardon ', '/pardon-ip ', '/banlist',
  '/whitelist list', '/whitelist on', '/whitelist off', '/whitelist add ', '/whitelist remove ', '/whitelist reload',
  '/op ', '/deop ',
  '/give ', '/clear ', '/item replace entity ', '/loot give ', '/enchant ', '/effect give ', '/effect clear ',
  '/experience add ', '/xp add ', '/attribute ',
  '/tp ', '/teleport ', '/spawnpoint ', '/setworldspawn', '/spreadplayers ', '/forceload query', '/worldborder get',
  '/gamemode survival ', '/gamemode creative ', '/gamemode adventure ', '/gamemode spectator ',
  '/defaultgamemode survival', '/difficulty peaceful', '/difficulty easy', '/difficulty normal', '/difficulty hard',
  '/time set day', '/time set night', '/weather clear', '/weather rain', '/weather thunder',
  '/gamerule ', '/execute as ', '/kill ', '/summon ', '/damage ', '/data get entity ',
  '/setblock ', '/fill ', '/clone ', '/fillbiome ', '/locate structure ', '/place structure ',
  '/scoreboard objectives list', '/team list', '/tag ', '/bossbar list',
  '/title ', '/playsound ', '/stopsound ', '/particle ',
  '/function ', '/schedule function ', '/datapack list', '/reload',
  '/save-all', '/save-on', '/save-off', '/seed', '/setidletimeout ', '/tick query', '/jfr start'
];

const COMPLETIONS = [
  '/help', '/clear', '/chat-history', '/start', '/stop', '/restart', '/status', '/worlds', '/settings ', '/get ', '/set ',
  '/diagnose', '/repair', '/selfplay', '/direct enable', '/direct disable', '/tunnel download', '/tunnel start',
  '/tunnel status', '/tunnel stop', '/local-only enable', '/local-only disable', '/local-only status',
  '/open folder', '/send give ', '/stop 30 ', '/shutdown 30 ', '/shutdown cancel', '/shutdown status',
  '/silent-restart', '/silent-restart status', '/silent-restart setup', '/silent-restart resume', '/silent-restart disable',
  '/silent restart setup', '/silent-restart delete', '/silent-restart now ',
  '/setup list', '/setup delete ', '/addons list', '/addons delete mods ', '/addons delete plugins ',
  '/anticheat list', '/anticheat enable ', '/anticheat disable ', '/anticheat delete ',
  ...MINECRAFT_COMMAND_COMPLETIONS
];

const HELP_TEXT = [
  '[Server Console] Commands',
  '  /help                         Show this command list',
  '  /clear                        Clear the console and stored logs',
  '  /chat-history                 Open searchable public/private chat history',
  '  /start | /restart              Control the active server',
  '  /silent-restart [now message]  Restart the backend and return parked players',
  '  /silent-restart setup|status|resume|delete',
  '  /silent restart setup         Same saved setup; survives restarts',
  '  /setup list | /setup delete <name>',
  '  /addons list [mods|plugins]    List installed files with their exact names',
  '  /addons delete <mods|plugins> <filename.jar>',
  '  /anticheat list                List built-in check IDs and custom add-ons',
  '  /anticheat enable|disable <check-id>',
  '  /anticheat delete <custom-id>   Remove one custom anti-cheat',
  '  /stop [seconds] [message]      Stop now or announce a capped countdown',
  '  /shutdown [seconds] [message]  Announce and shut down (/shutdown cancel)',
  '  /status                       Show server, Java, and network status',
  '  /worlds                       List configured servers',
  '  /settings [search]            List server settings',
  '  /get <setting>                Read one setting',
  '  /set <setting> <value>        Change one setting',
  '  /diagnose | /repair           Check and repair connectivity',
  '  /local-only enable|disable|status',
  '  /direct enable|disable        Control direct hosting',
  '  /tunnel download|start|status|stop',
  '  /open folder                  Open the active server folder',
  '',
  '[Minecraft commands]',
  '  Players: /give, /clear <player>, /item, /loot, /effect, /enchant, /experience',
  '  Movement: /tp, /teleport, /spawnpoint, /setworldspawn, /worldborder, /forceload',
  '  World: /execute, /summon, /kill, /data, /setblock, /fill, /clone, /locate',
  '  Access: /kick, /ban, /pardon, /whitelist, /op, /deop, /gamemode, /difficulty',
  '  Other: /gamerule, /scoreboard, /team, /tag, /function, /reload, /save-all',
  '  Minecraft commands run as the dedicated-server console and are not limited by player roles.',
  '  Use /send <command> to forward a command name that overlaps a Console command.',
  '  Any other /command is forwarded to the active Minecraft server.',
  '  Tab or Right Arrow accepts the faint inline suggestion.'
].join('\n');

let renderedCharacters = 0;
let renderedLines = 0;
let pendingChunks = [];
let pendingCharacters = 0;
let pendingFrame = 0;
let hydrating = true;
let hydrationChunks = [];
let hydrationCharacters = 0;
let hydrationCleared = false;
let currentState = 'stopped';
let stateEventVersion = 0;
let prediction = '';
let commandHistory = [];
let historyIndex = 0;

function lineType(text) {
  if (/^\[Server Console\]/i.test(text)) return 'helper';
  if (/\b(error|exception|failed|fatal|crash|denied|refused)\b/i.test(text)) return 'error';
  if (/\b(warn|warning|deprecated|blocked)\b/i.test(text)) return 'warning';
  if (/\b(done|started|loaded|saved|online|success|mapped|downloaded)\b/i.test(text)) return 'success';
  if (/\b(joined|left|logged in|lost connection|player)\b/i.test(text)) return 'player';
  if (/\b(click interval|assembly|ASM-|playit|tunnel|diagnostic|repair)\b/i.test(text)) return 'system';
  if (/^[>›]/.test(text)) return 'command';
  return '';
}

function trimOutput() {
  while ((renderedLines > MAX_LINES || renderedCharacters > MAX_CHARACTERS) && output.firstElementChild) {
    const first = output.firstElementChild;
    renderedCharacters -= first.textContent.length;
    renderedLines -= 1;
    first.remove();
  }
}

function appendNow(chunk) {
  let text = String(chunk || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\[(?:Assembly|Click Interval) Console\]/g, '[Server Console]')
    .replace(/\[(?:Assembly|Click Interval) (ASM-[^\]]+)\]/g, '[Server $1]');
  if (!text) return;
  if (text.length > MAX_CHARACTERS) text = text.slice(-MAX_CHARACTERS);

  const shouldFollow = output.scrollHeight - output.scrollTop - output.clientHeight < 28;
  const fragment = document.createDocumentFragment();
  let lines = text.split('\n');
  if (lines.length > MAX_LINES + 1) lines = lines.slice(-(MAX_LINES + 1));

  const lineLimit = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  for (let index = 0; index < lineLimit; index += 1) {
    const value = lines[index];
    if (/^> assembly\s/i.test(value)) continue;
    const line = document.createElement('div');
    const type = lineType(value);
    line.className = type ? `console-line ${type}` : 'console-line';
    line.textContent = value;
    fragment.append(line);
    renderedCharacters += value.length;
    renderedLines += 1;
  }

  output.append(fragment);
  trimOutput();
  if (shouldFollow) output.scrollTop = output.scrollHeight;
}

function flushPending() {
  pendingFrame = 0;
  if (!pendingChunks.length) return;
  const chunks = pendingChunks;
  pendingChunks = [];
  pendingCharacters = 0;
  appendNow(chunks.join(''));
}

function pushBounded(queue, chunk, characterCount) {
  let text = String(chunk);
  if (text.length >= MAX_CHARACTERS) {
    queue.splice(0, queue.length, text.slice(-MAX_CHARACTERS));
    return MAX_CHARACTERS;
  }

  queue.push(text);
  let nextCount = characterCount + text.length;
  let overflow = nextCount - MAX_CHARACTERS;
  while (overflow > 0 && queue.length) {
    const first = queue[0];
    if (first.length <= overflow) {
      queue.shift();
      nextCount -= first.length;
      overflow -= first.length;
    } else {
      queue[0] = first.slice(overflow);
      nextCount -= overflow;
      overflow = 0;
    }
  }
  return nextCount;
}

function append(chunk) {
  if (chunk === undefined || chunk === null || chunk === '') return;
  pendingCharacters = pushBounded(pendingChunks, chunk, pendingCharacters);
  if (!pendingFrame) pendingFrame = requestAnimationFrame(flushPending);
}

function receiveLog(chunk) {
  if (chunk === undefined || chunk === null || chunk === '') return;
  if (!hydrating) {
    append(chunk);
    return;
  }
  hydrationCharacters = pushBounded(hydrationChunks, chunk, hydrationCharacters);
}

function replace(log) {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  pendingChunks = [];
  pendingCharacters = 0;
  output.replaceChildren();
  renderedCharacters = 0;
  renderedLines = 0;
  appendNow(log);
}

function readableError(error) {
  return String(error?.message || error || 'Unknown error')
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .replace(/Stop the Minecraft server and wait for startup to finish before changing custom mods\.?/gi, 'Stop the server before changing custom mods.')
    .replace(/Stop the Minecraft server and wait for startup to finish before changing custom plugins\.?/gi, 'Stop the server before changing custom plugins.');
}

function showError(error) {
  append(`[error] ${readableError(error)}\n`);
}

function setState(value) {
  const normalized = String(value || 'stopped').trim().toLowerCase();
  currentState = normalized;
  if (stateLabel) stateLabel.textContent = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  if (stateWrap) stateWrap.dataset.state = normalized;

  const running = normalized === 'running';
  const starting = normalized === 'starting';
  const stopping = normalized === 'stopping';
  toolbar.querySelector('[data-action="start"]').disabled = running || starting || stopping;
  toolbar.querySelector('[data-action="stop"]').disabled = (!running && !starting) || stopping;
  toolbar.querySelector('[data-action="restart"]').disabled = !running;
}

function updateSession(status) {
  const profiles = status?.profiles?.profiles || [];
  const active = profiles.find(profile => profile.id === status?.profiles?.activeProfileId);
  const label = String(active?.name || status?.config?.levelName || 'minecraft-server').trim() || 'minecraft-server';
  sessionName.textContent = `$ ${label}`;
  document.title = `${label} — Server Console`;
}

function completionFor(value) {
  if (!value || value.trimStart() !== value || input.selectionStart !== value.length || input.selectionEnd !== value.length) return '';
  const lower = value.toLowerCase();
  const recent = [...commandHistory].reverse();
  const options = recent.concat(COMPLETIONS);
  return options.find((candidate, index) => candidate.length > value.length
    && candidate.toLowerCase().startsWith(lower)
    && options.findIndex(item => item.toLowerCase() === candidate.toLowerCase()) === index) || '';
}

function updatePrediction() {
  prediction = completionFor(input.value);
  ghostPrefix.textContent = input.value;
  ghostTail.textContent = prediction ? prediction.slice(input.value.length) : '';
  completeHint.hidden = !prediction;
  ghost.scrollLeft = input.scrollLeft;
}

function acceptPrediction() {
  if (!prediction) return false;
  input.value = prediction;
  input.setSelectionRange(prediction.length, prediction.length);
  updatePrediction();
  return true;
}

function rememberCommand(command) {
  const duplicate = commandHistory.lastIndexOf(command);
  if (duplicate !== -1) commandHistory.splice(duplicate, 1);
  commandHistory.push(command);
  if (commandHistory.length > MAX_HISTORY) commandHistory.shift();
  historyIndex = commandHistory.length;
}

function walkHistory(direction) {
  if (!commandHistory.length) return;
  historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + direction));
  input.value = historyIndex === commandHistory.length ? '' : commandHistory[historyIndex];
  input.setSelectionRange(input.value.length, input.value.length);
  updatePrediction();
}

async function clearConsole() {
  await api.clearLogs();
  replace('');
}

async function runLifecycle(action) {
  const previousState = currentState;
  const requestedAtStateVersion = stateEventVersion;
  setState(action === 'start' ? 'starting' : 'stopping');
  try {
    const result = action === 'start'
      ? await api.startServer()
      : action === 'stop'
        ? await api.stopServer()
        : await api.restartServer();
    if (stateEventVersion === requestedAtStateVersion) {
      const status = await api.getStatus().catch(() => null);
      if (status) updateSession(status);
      setState(status?.state || result?.state || previousState);
    }
    return result;
  } catch (error) {
    if (stateEventVersion === requestedAtStateVersion) {
      const status = await api.getStatus().catch(() => null);
      if (status) updateSession(status);
      setState(status?.state || previousState);
    }
    throw error;
  }
}

async function runCommand(command) {
  const lower = command.toLowerCase();

  if (lower === '/morning-start-status') {
    const verification = await morningStart.verify();
    append(`[Morning Start] ${JSON.stringify(morningStart.status(), null, 2)}\n`);
    append(`[Morning Start] Read-only identity check: ${JSON.stringify(verification)}\n`);
    return;
  }
  if (lower === '/morning-start-cancel') {
    await morningStart.cancel();
    return;
  }
  if (lower === '/help' || lower === '/?') {
    append(`${HELP_TEXT}\n`);
    return;
  }
  if (lower === '/clear') {
    await clearConsole();
    return;
  }
  if (lower === '/chat-history' || lower === '/chathistory') {
    await api.openChatHistory();
    return;
  }
  if (lower === '/start' || lower === '/stop' || lower === '/restart') {
    await runLifecycle(lower.slice(1));
    return;
  }

  if (command.startsWith('/')) {
    const helperCommand = command.slice(1);
    const helperName = helperCommand.split(/\s+/, 1)[0].toLowerCase();
    if (LOCAL_HELPERS.has(helperName)) {
      const result = await api.runAssemblyCommand(helperCommand);
      if (result) append(`${result}\n`);
      return;
    }
    await api.sendCommand(helperCommand);
    return;
  }

  if (/^click\s+/i.test(command)) {
    const result = await api.runAssemblyCommand(command.replace(/^click\s+/i, ''));
    if (result) append(`${result}\n`);
    return;
  }

  await api.sendCommand(command);
}

document.querySelector('.console-window-actions').addEventListener('click', event => {
  const button = event.target.closest('[data-window-action]');
  if (!button) return;
  if (button.dataset.windowAction === 'minimize') window.bridge.windowControl('minimize');
  else window.bridge.closeCurrentWindow();
});

toolbar.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === 'clear') await clearConsole();
    else if (action === 'chat-history') await api.openChatHistory();
    else await runLifecycle(action);
  } catch (error) {
    showError(error);
  } finally {
    if (action === 'clear' || action === 'chat-history') button.disabled = false;
    setState(currentState);
  }
});

commandForm.addEventListener('submit', async event => {
  event.preventDefault();
  const command = input.value.trim();
  if (!command) return;

  rememberCommand(command);
  input.value = '';
  updatePrediction();
  append(`› ${command}\n`);

  try {
    await runCommand(command);
  } catch (error) {
    showError(error);
  }
});

input.addEventListener('input', updatePrediction);
input.addEventListener('scroll', () => { ghost.scrollLeft = input.scrollLeft; }, { passive: true });
input.addEventListener('keydown', event => {
  if ((event.key === 'Tab' || event.key === 'ArrowRight') && prediction
    && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
    event.preventDefault();
    acceptPrediction();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    walkHistory(-1);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    walkHistory(1);
  }
});

api.onLog(receiveLog);
api.onClearLog(() => {
  if (hydrating) {
    hydrationCleared = true;
    hydrationChunks = [];
    hydrationCharacters = 0;
    return;
  }
  replace('');
});
api.onState(value => {
  stateEventVersion += 1;
  setState(value);
});

const initialStateEventVersion = stateEventVersion;
Promise.all([api.getConsoleLog(), api.getStatus()])
  .then(([log, status]) => {
    const liveLog = hydrationChunks.join('');
    const initialLog = hydrationCleared ? '' : log;
    hydrating = false;
    hydrationChunks = [];
    hydrationCharacters = 0;
    replace(initialLog);
    append(liveLog);
    updateSession(status);
    if (stateEventVersion === initialStateEventVersion) setState(status?.state);
  })
  .catch(error => {
    const liveLog = hydrationChunks.join('');
    hydrating = false;
    hydrationChunks = [];
    hydrationCharacters = 0;
    replace(liveLog);
    showError(error);
  });

updatePrediction();
setState('stopped');

// BEGIN SMP MORNING START: one user-requested start, not a recurring schedule.
function createSmpMorningStartScheduler({ api, storage, locks, now, setTimer, clearTimer, report }) {
  const plan = Object.freeze({
    id: 'smp-2026-10-08-0800-dubai',
    target: Date.parse('2026-10-08T08:00:00+04:00'),
    expires: Date.parse('2026-10-08T08:15:00+04:00'),
    profileId: 'SMP',
    root: 'c:/users/example/appdata/roaming/click-interval-beta/minecraft-servers/smp'
  });
  const key = `click-interval:one-shot-start:${plan.id}`;
  const terminal = new Set(['complete', 'failed', 'canceled', 'expired']);
  const phases = new Set(['armed', 'starting', ...terminal]);
  let timer = null;
  let busy = false;
  let halted = false;

  function read() {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value.id !== plan.id || !phases.has(value.phase) || !Array.isArray(value.events)) {
      throw new Error('Invalid persisted morning-start state; refusing to start.');
    }
    return value;
  }

  function save(phase, reason) {
    const previous = read();
    const event = { at: new Date(now()).toISOString(), phase, reason };
    const value = { id: plan.id, target: new Date(plan.target).toISOString(),
      expires: new Date(plan.expires).toISOString(), profileId: plan.profileId,
      root: plan.root, phase, events: [...(previous?.events || []), event].slice(-24) };
    // Persist the claim BEFORE calling IPC. A crash/reload must not repeat a start.
    storage.setItem(key, JSON.stringify(value));
    report(`[Morning Start] ${reason}`);
    return value;
  }

  function failClosed(error) {
    halted = true;
    report(`[Morning Start] Disabled: ${String(error?.message || error).slice(0, 240)}`);
  }

  function matches(status) {
    const root = String(status?.paths?.root || '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    const profiles = status?.profiles?.profiles;
    return status?.profiles?.activeProfileId === plan.profileId && root === plan.root
      && Array.isArray(profiles) && profiles.length === 1
      && profiles[0].id === plan.profileId && profiles[0].name === 'SMP';
  }

  async function check() {
    let state = read();
    if (state === null) {
      if (now() >= plan.target) { save('expired', 'Not armed before 08:00; no late automatic start.'); return; }
      state = save('armed', 'SMP scheduled once for 08:00 today (Dubai); keep Click Interval and this console open. Check /morning-start-status.');
    }
    if (terminal.has(state.phase) || now() < plan.target) return;
    if (now() > plan.expires) { save('expired', '08:15 cutoff reached; no automatic start.'); return; }
    const status = await api.getStatus();
    // Status loading can take time; recheck the clock, persistent claim and profile.
    state = read();
    if (!state || terminal.has(state.phase) || now() < plan.target) return;
    if (now() > plan.expires) { save('expired', '08:15 cutoff reached while checking status.'); return; }
    if (!matches(status)) { save('canceled', 'Active server identity changed; nothing was started.'); return; }
    if (status.state === 'running') { save('complete', 'SMP is running; one-time schedule completed.'); return; }
    if (state.phase === 'starting') {
      if (status.state === 'stopped' || status.state === 'error') {
        save('failed', 'The previous start did not remain running; no automatic retry.');
      }
      return;
    }
    if (status.state === 'starting') {
      save('starting', 'SMP is already starting; observing without issuing another start.');
      return;
    }
    if (status.state !== 'stopped') return;
    save('starting', '08:00 reached; requesting the normal managed SMP start once.');
    try {
      const result = await api.startServer();
      // Canceled/stopped structured responses are failures, not successful boots.
      if (result?.canceled || result?.ready === false || result?.state === 'stopped' || result?.state === 'error') {
        save('failed', 'The managed start was canceled or failed; no automatic retry.');
      } else if (result?.state === 'running') {
        save('complete', 'SMP managed start completed successfully.');
      }
    } catch (error) {
      save('failed', `Managed start failed: ${String(error?.message || error).slice(0, 180)}`);
    }
  }

  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (halted) return;
    try {
      if (terminal.has(read()?.phase)) return;
      // Absolute time checked at most once/minute; no expensive status polling overnight.
      // Hidden Chromium windows can throttle to one minute, so never rely on tick counts.
      const delay = now() < plan.target ? Math.max(1000, Math.min(60000, plan.target - now())) : 5000;
      timer = setTimer(() => { timer = null; void tick(); }, delay);
    } catch (error) { failClosed(error); }
  }

  async function tick() {
    if (halted || busy) return;
    busy = true;
    try {
      if (!locks || typeof locks.request !== 'function') throw new Error('Exclusive browser lock is unavailable.');
      // A second renderer/reload cannot race the status check or persisted start claim.
      await locks.request(key, { mode: 'exclusive' }, check);
    } catch (error) { failClosed(error); }
    finally { busy = false; schedule(); }
  }

  return Object.freeze({
    plan, key, tick,
    status: () => read(),
    verify: async () => {
      // Never tick or claim here, even after the scheduled time; this is diagnostic only.
      const status = await api.getStatus();
      return {
        identityMatch: matches(status),
        state: ['running', 'starting', 'stopped', 'stopping', 'error'].includes(status?.state) ? status.state : 'unknown',
        profileCount: Array.isArray(status?.profiles?.profiles) ? status.profiles.profiles.length : 0
      };
    },
    cancel: async () => {
      await locks.request(key, { mode: 'exclusive' }, () => {
        if (read()?.phase === 'starting') throw new Error('Start already requested; use normal server controls.');
        if (!terminal.has(read()?.phase)) save('canceled', 'One-time morning start canceled.');
      });
      schedule();
    },
    dispose: () => { halted = true; if (timer !== null) clearTimer(timer); timer = null; }
  });
}
// END SMP MORNING START

const morningStart = createSmpMorningStartScheduler({
  api, storage: window.localStorage, locks: navigator.locks, now: Date.now,
  setTimer: setTimeout, clearTimer: clearTimeout, report: message => receiveLog(`${message}\n`)
});
window.clickIntervalMorningStart = morningStart;
void morningStart.tick();
window.addEventListener('focus', () => void morningStart.tick());
document.addEventListener('visibilitychange', () => void morningStart.tick());
