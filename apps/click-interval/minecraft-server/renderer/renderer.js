const fields = [
  'bindIp',
  'port',
  'customHostname',
  'publicAddress',
  'directHostingEnabled',
  'serverType',
  'levelName',
  'seed',
  'motd',
  'maxPlayers',
  'memoryMb',
  'javaPath',
  'difficulty',
  'gamemode',
  'onlineMode',
  'pvp',
  'playerLocatorBar',
  'acceptEula',
  'allowFlight',
  'allowCheats',
  'whiteList',
  'hardcore',
  'forceGamemode',
  'allowNether',
  'lockNether',
  'lockEnd',
  'generateStructures',
  'spawnAnimals',
  'spawnMonsters',
  'spawnNpcs',
  'spawnProtection',
  'doInsomnia',
  'mobGriefing',
  'doFireTick',
  'keepInventory',
  'doImmediateRespawn',
  'showDeathMessages',
  'announceAdvancements',
  'doTraderSpawning',
  'doPatrolSpawning',
  'playersSleepingPercentage',
  'spawnRadius',
  'randomTickSpeed',
  'viewDistance',
  'simulationDistance'
];

const appShell = document.querySelector('.app-shell');
const stateEl = document.getElementById('serverState');
const toastEl = document.getElementById('toast');
const notificationsMenu = document.getElementById('notificationsMenu');
const notificationsList = document.getElementById('notificationsList');
let currentConfig = null;
let currentState = 'stopped';
let currentNetwork = { lanIps: [] };
let currentProfiles = null;
let currentStatus = null;
let dimensionLockManualDirty = false;
let standaloneDimensionLockDraft = null;
let worldResetBusy = false;
let pendingWorldResetProfile = '';
let statusRequestPending = null;
let fullRefreshPending = null;
let currentPlayit = { installed: false, running: false };
let currentDirectHosting = { mapped: false, publicAddress: '', message: '' };
let currentBans = [];
let currentHistory = [];
let sessionsView = 'online';
let addonsView = 'installed';
let installedKind = 'mods';
let installedSearchQuery = '';
let installedFiles = { mods: [], plugins: [] };
let addonsKind = 'mods';
let addonsSource = 'modrinth';
let addonsSearchTimer = null;
let addonsResults = [];
let addonsOffset = 0;
let addonsTotal = 0;
let addonsLoading = false;
let addonsHasMore = true;
let addonsLastQuery = '';
const MAX_ADDON_RESULTS = 240;
let uptimeStartedAt = null;
let uptimeTimer = null;
let autoSaveTimer = null;
let worldModalResolve = null;
let creatingWorld = false;
let banPlayerTarget = '';
const notifications = [];
const copyIcon = '<svg viewBox="0 0 24 24"><path d="M8 8h11v11H8z" /><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" /></svg>';
const checkIcon = '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7" /></svg>';
const xIcon = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>';
const playIcon = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>';
const stopIcon = '<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7z" /></svg>';
const moreIcon = '<svg viewBox="0 0 24 24"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>';
const tempBanTimers = new Map();
const tempBanEnds = new Map();
const bannedPlayers = new Map();
const recentOnlinePlayers = new Map();
let tempBanPlayer = '';
const analyticsSamples = [];
const pressureSamples = [];

function byId(id) {
  return document.getElementById(id);
}

function on(id, eventName, handler) {
  const target = byId(id);
  if (target) target.addEventListener(eventName, handler);
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  addNotification(message);
}

function buildServerAddress(config) {
  if (config?.localOnly) return `127.0.0.1:${Number(config.port) || 25565} (local only)`;
  return config.customHostname?.trim() || config.publicAddress?.trim() || 'Set public address';
}

function buildLanAddress(config) {
  const port = Number(config?.port) || 25565;
  if (config?.localOnly) return `127.0.0.1:${port}`;
  const lanIp = currentNetwork?.lanIps?.[0];
  return lanIp ? `${lanIp}:${port}` : 'LAN unavailable';
}

function updateJoinAddressHint(config) {
  const hint = document.getElementById('addressHint');
  if (!hint) return;
  hint.textContent = config?.localOnly ? 'Remote status and joins are disabled in local-only mode.' : '';
}

function addNotification(message) {
  notifications.unshift(message);
  if (notifications.length > 8) notifications.pop();
  renderNotifications();
}

function renderNotifications() {
  notificationsList.innerHTML = '';
  if (!notifications.length) {
    const empty = document.createElement('div');
    empty.className = 'notification-item';
    empty.textContent = 'No notifications yet.';
    notificationsList.append(empty);
    return;
  }
  for (const message of notifications) {
    const item = document.createElement('div');
    item.className = 'notification-item';
    item.textContent = message;
    notificationsList.append(item);
  }
}

function setState(state) {
  currentState = state;
  updateWorldResetControls();
  stateEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  stateEl.className = `state ${state}`;
  const toggle = document.getElementById('toggleServerBtn');
  if (toggle) {
    const isActive = state === 'running' || state === 'starting';
    toggle.innerHTML = isActive ? stopIcon : playIcon;
    toggle.dataset.tooltip = isActive ? 'Stop server' : 'Start server';
    toggle.setAttribute('aria-label', isActive ? 'Stop server' : 'Start server');
  }
  updateRuntime();
  updateAnalytics();
}

function updateDashboard(config) {
  updateJoinAddressHint(config);
  document.getElementById('serverAddress').value = buildServerAddress(config);
  const lanAddress = document.getElementById('lanAddress');
  if (lanAddress) lanAddress.value = buildLanAddress(config);
  document.getElementById('worldName').textContent = config.levelName || 'world';
  document.getElementById('seedSummary').textContent = config.seed ? String(config.seed) : 'Generating seed...';
  document.getElementById('memorySummary').textContent = `0 / ${Number(config.memoryMb) || 2048} MB`;
  const memoryMetric = document.getElementById('memoryMetric');
  if (memoryMetric) memoryMetric.style.setProperty('--memory-percent', '0%');
  document.getElementById('versionSummary').textContent = config.serverVersion || 'custom';
  updateWorldPreview(currentStatus?.worldIconDataUrl || '');
  const versionSelect = document.getElementById('serverVersionSelect');
  if (versionSelect && config.serverVersion) versionSelect.value = config.serverVersion;
  updatePlayers(currentStatus?.players || { online: 0, max: config.maxPlayers, sample: [] });
  updateRuntime();
  updateAnalytics();
}

function updateWorldPreview(iconDataUrl) {
  const banner = document.querySelector('.world-banner');
  if (!banner) return;
  if (iconDataUrl) {
    banner.style.backgroundImage = `url("${iconDataUrl}")`;
    banner.classList.add('has-world-icon');
    banner.classList.remove('default-world-icon');
  } else {
    banner.style.backgroundImage = 'url("assets/minecraft-default-world.png")';
    banner.classList.add('has-world-icon', 'default-world-icon');
  }
}

function updatePlayers(players) {
  if (sessionsView === 'banned') {
    renderBannedPlayers();
    return;
  }
  if (sessionsView === 'history') {
    renderPlayerHistory();
    return;
  }
  const count = document.getElementById('playerCountSummary');
  const heads = document.getElementById('playerHeads');
  if (!count || !heads) return;
  const online = Number(players?.online) || 0;
  const max = Number(players?.max) || Number(currentConfig?.maxPlayers) || 0;
  if (online === 0 && currentState !== 'running') recentOnlinePlayers.clear();
  count.textContent = `${online} / ${max}`;
  const sessionsCount = document.getElementById('sessionsCount');
  if (sessionsCount) sessionsCount.textContent = `${online} / ${max}`;
  heads.innerHTML = '';
  const sampledPlayers = Array.isArray(players?.sample) ? players.sample : [];
  const merged = new Map();
  for (const player of sampledPlayers) {
    const name = player?.name || '';
    const key = name.toLowerCase();
    if (name && !bannedPlayers.has(key)) merged.set(key, { name });
  }
  for (const [key, player] of recentOnlinePlayers) {
    if (!bannedPlayers.has(key) && (online > 0 || sampledPlayers.length)) merged.set(key, player);
  }
  if (online === 0 && !sampledPlayers.length) recentOnlinePlayers.clear();
  const query = document.getElementById('sessionsSearch')?.value?.trim().toLowerCase() || '';
  const sample = [...merged.values()]
    .filter((player) => !query || String(player.name || '').toLowerCase().includes(query));
  if (!sample.length) {
    const empty = document.createElement('div');
    empty.className = 'players-empty';
    empty.textContent = query ? 'No online players match.' : online ? `${online} online` : 'No players online';
    heads.append(empty);
  } else {
    for (const player of sample.slice(0, 16)) {
      const item = document.createElement('div');
      item.className = 'player-head';
      item.title = player.name || 'Player';
      const img = document.createElement('img');
      img.alt = player.name || 'Player';
      img.src = `https://minotar.net/avatar/${encodeURIComponent(player.name || 'Steve')}/48`;
      const name = document.createElement('span');
      name.textContent = player.name || 'Player';
      const menu = document.createElement('button');
      menu.type = 'button';
      menu.className = 'player-menu-btn';
      menu.setAttribute('aria-label', `Actions for ${player.name || 'Player'}`);
      menu.innerHTML = moreIcon;
      menu.addEventListener('click', (event) => {
        event.stopPropagation();
        openPlayerActionMenu(player.name || 'Player', menu);
      });
      item.append(img, name, menu);
      heads.append(item);
    }
  }
}

function setSessionsView(view) {
  sessionsView = ['banned', 'history'].includes(view) ? view : 'online';
  document.getElementById('onlinePlayersTab')?.classList.toggle('active', sessionsView === 'online');
  document.getElementById('bannedPlayersTab')?.classList.toggle('active', sessionsView === 'banned');
  document.getElementById('historyPlayersTab')?.classList.toggle('active', sessionsView === 'history');
  const search = document.getElementById('sessionsSearch');
  if (search) {
    search.placeholder = sessionsView === 'banned'
      ? 'Search banned players'
      : sessionsView === 'history'
        ? 'Search player history'
        : 'Search online players';
  }
  if (sessionsView === 'banned') {
    renderBannedPlayers();
  } else if (sessionsView === 'history') {
    renderPlayerHistory();
  } else {
    updatePlayers(currentStatus?.players || { online: 0, max: currentConfig?.maxPlayers, sample: [] });
  }
}

function formatHistoryTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderPlayerHistory() {
  const heads = document.getElementById('playerHeads');
  const count = document.getElementById('sessionsCount');
  if (!heads) return;
  const query = document.getElementById('sessionsSearch')?.value?.trim().toLowerCase() || '';
  const rows = currentHistory
    .filter((player) => !query || `${player.name} ${player.lastEvent || ''}`.toLowerCase().includes(query))
    .sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
  if (count) count.textContent = String(rows.length);
  heads.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'players-empty';
    empty.textContent = query ? 'No player history matches.' : 'No player history yet';
    heads.append(empty);
    return;
  }
  for (const player of rows) {
    const row = document.createElement('div');
    row.className = 'player-head history-player';
    const img = document.createElement('img');
    img.alt = player.name;
    img.src = `https://minotar.net/avatar/${encodeURIComponent(player.name)}/48`;
    const meta = document.createElement('span');
    const small = document.createElement('small');
    small.textContent = `Last active ${formatHistoryTime(player.lastActive)} - ${player.lastEvent || 'seen'}`;
    meta.textContent = player.name;
    meta.append(small);
    row.append(img, meta);
    heads.append(row);
  }
}

function formatDurationLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function renderBannedPlayers() {
  const heads = document.getElementById('playerHeads');
  const count = document.getElementById('sessionsCount');
  if (!heads) return;
  const query = document.getElementById('sessionsSearch')?.value?.trim().toLowerCase() || '';
  heads.innerHTML = '';
  const now = Date.now();
  const merged = new Map();
  for (const ban of currentBans) {
    if (ban?.name) merged.set(ban.name.toLowerCase(), ban);
  }
  for (const [key, banned] of bannedPlayers) {
    if (!merged.has(key)) {
      const endAt = tempBanEnds.get(key) || 0;
      merged.set(key, {
        name: banned.name,
        temporary: Boolean(endAt),
        permanent: !endAt,
        endAt,
        remainingMs: endAt ? Math.max(0, endAt - now) : null,
        reason: ''
      });
    }
  }
  const rows = [...merged.values()]
    .filter((ban) => !query || `${ban.name} ${ban.reason || ''}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (count) count.textContent = `${rows.length} banned`;
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'players-empty';
    empty.textContent = query ? 'No banned players match.' : 'No banned players';
    heads.append(empty);
    return;
  }
  for (const banned of rows) {
    const endAt = Number(banned.endAt) || 0;
    const row = document.createElement('div');
    row.className = 'player-head banned-player';
    const img = document.createElement('img');
    img.alt = banned.name;
    img.src = `https://minotar.net/avatar/${encodeURIComponent(banned.name)}/48`;
    const meta = document.createElement('span');
    const small = document.createElement('small');
    small.textContent = endAt
      ? `Unbans in ${formatDurationLeft(endAt - now)}`
      : 'Banned permanently';
    meta.textContent = banned.name;
    meta.append(small);
    const actions = document.createElement('div');
    actions.className = 'ban-actions';
    const shorten = document.createElement('button');
    shorten.type = 'button';
    shorten.textContent = endAt ? 'Edit' : 'Temp';
    shorten.addEventListener('click', () => openTempBanModal(banned.name));
    const unban = document.createElement('button');
    unban.type = 'button';
    unban.textContent = 'Unban';
    unban.addEventListener('click', async () => {
      currentBans = await run(() => window.assembly.pardonPlayer(banned.name), `${banned.name} unbanned.`);
      bannedPlayers.delete(banned.name.toLowerCase());
      tempBanEnds.delete(banned.name.toLowerCase());
      renderBannedPlayers();
    });
    actions.append(shorten, unban);
    row.append(img, meta, actions);
    heads.append(row);
  }
}

function quotePlayerName(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) throw new Error('Invalid player name.');
  return clean;
}

function openPlayerActionMenu(playerName, anchor) {
  const menu = document.getElementById('playerActionMenu');
  if (!menu) return;
  const name = quotePlayerName(playerName);
  menu.innerHTML = '';
  const actions = [
    { label: 'Kick', run: () => moderatePlayer('kick', name) },
    { label: 'Ban', run: () => openBanModal(name) },
    { label: 'Temporary Ban', run: () => openTempBanModal(name) }
  ];
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      closePlayerActionMenu();
      await action.run();
    });
    menu.append(button);
  }
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(window.innerWidth - 168, Math.max(8, rect.right - 156))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 132, rect.bottom + 8)}px`;
  menu.classList.remove('hidden');
}

function closePlayerActionMenu() {
  document.getElementById('playerActionMenu')?.classList.add('hidden');
}

function openBanModal(playerName) {
  banPlayerTarget = quotePlayerName(playerName);
  document.getElementById('banPlayerName').textContent = banPlayerTarget;
  document.getElementById('banMessage').value = '';
  document.getElementById('banModal').classList.remove('hidden');
  document.getElementById('banMessage').focus();
}

function closeBanModal() {
  document.getElementById('banModal').classList.add('hidden');
  banPlayerTarget = '';
}

async function confirmBan() {
  const name = quotePlayerName(banPlayerTarget);
  const message = document.getElementById('banMessage')?.value?.trim() || '';
  currentBans = await run(() => window.assembly.banPlayer(name, message), `${name} banned.`);
  const key = name.toLowerCase();
  recentOnlinePlayers.delete(key);
  tempBanEnds.delete(key);
  bannedPlayers.set(key, { name, permanent: true });
  closeBanModal();
  setSessionsView('banned');
}

async function moderatePlayer(kind, playerName) {
  const name = quotePlayerName(playerName);
  if (kind === 'kick') {
    await run(() => window.assembly.sendCommand(`kick ${name} Kicked by server staff.`), `${name} kicked.`);
    return;
  }
  openBanModal(name);
}

function openTempBanModal(playerName) {
  tempBanPlayer = quotePlayerName(playerName);
  document.getElementById('tempBanPlayerName').textContent = tempBanPlayer;
  document.getElementById('tempBanDays').value = '0';
  document.getElementById('tempBanHours').value = '0';
  document.getElementById('tempBanMinutes').value = '30';
  document.getElementById('tempBanMessage').value = '';
  document.getElementById('tempBanModal').classList.remove('hidden');
  document.getElementById('tempBanMinutes').focus();
}

function closeTempBanModal() {
  document.getElementById('tempBanModal').classList.add('hidden');
  tempBanPlayer = '';
}

async function confirmTempBan() {
  const name = quotePlayerName(tempBanPlayer);
  const days = Math.max(0, Number(document.getElementById('tempBanDays').value) || 0);
  const hours = Math.max(0, Number(document.getElementById('tempBanHours').value) || 0);
  const minutes = Math.max(0, Number(document.getElementById('tempBanMinutes').value) || 0);
  const message = document.getElementById('tempBanMessage')?.value?.trim() || '';
  const durationMs = ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
  if (!durationMs) {
    showToast('Set a temp-ban duration first.');
    return;
  }
  currentBans = await run(() => window.assembly.tempBanPlayer(name, durationMs, message), `${name} banned for ${formatDurationLeft(durationMs)}.`);
  const key = name.toLowerCase();
  recentOnlinePlayers.delete(key);
  bannedPlayers.set(key, { name, permanent: false });
  tempBanEnds.set(key, Date.now() + durationMs);
  clearTimeout(tempBanTimers.get(name));
  const refreshAtExpiry = () => {
    const remaining = (tempBanEnds.get(key) || 0) - Date.now();
    if (remaining > 0) {
      const timer = setTimeout(refreshAtExpiry, Math.min(2_147_000_000, remaining));
      tempBanTimers.set(name, timer);
      return;
    }
    tempBanTimers.delete(name);
    tempBanEnds.delete(key);
    bannedPlayers.delete(key);
    showToast(`${name} temporary ban expired.`);
    window.assembly.listBans().then((bans) => {
      currentBans = bans;
      updatePlayers(currentStatus?.players || { online: 0, max: currentConfig?.maxPlayers, sample: [] });
    }).catch(() => {});
  };
  const timer = setTimeout(refreshAtExpiry, Math.min(2_147_000_000, durationMs));
  tempBanTimers.set(name, timer);
  closeTempBanModal();
  if (sessionsView === 'banned') {
    renderBannedPlayers();
  } else {
    updatePlayers(currentStatus?.players || { online: 0, max: currentConfig?.maxPlayers, sample: [] });
  }
}

function getStablePlayerLimit(memoryMb) {
  return Math.max(4, Math.floor((Number(memoryMb) || 2048) / 256));
}

function updatePlayerLimitControls() {
  const memory = Number(document.getElementById('memoryMb')?.value) || Number(currentConfig?.memoryMb) || 2048;
  const limit = getStablePlayerLimit(memory);
  const maxPlayers = document.getElementById('maxPlayers');
  const note = document.getElementById('playerLimitNote');
  if (maxPlayers) {
    maxPlayers.title = `Stable player limit: ${limit} players based on ${memory} MB allocated.`;
    maxPlayers.dataset.tooltip = maxPlayers.title;
  }
  if (note) note.textContent = `Stable limit: ${limit} players based on ${memory} MB.`;
}

function updatePlayitControls(status = currentPlayit) {
  currentPlayit = status || { installed: false, running: false };
  const download = document.getElementById('downloadPlayitBtn');
  const start = document.getElementById('startPlayitBtn');
  const stop = document.getElementById('stopPlayitBtn');
  if (!download || !start || !stop) return;
  download.textContent = currentPlayit.installed ? 'Downloaded' : 'Download Agent';
  start.disabled = !currentPlayit.installed || currentPlayit.running;
  stop.disabled = !currentPlayit.running;
}

function updateDirectHostingControls(status = currentDirectHosting) {
  currentDirectHosting = status || { mapped: false, publicAddress: '', message: '' };
  const label = document.getElementById('directHostingStatus');
  const enable = document.getElementById('enableDirectHostingBtn');
  const disable = document.getElementById('disableDirectHostingBtn');
  if (label) label.textContent = currentDirectHosting.message || (currentDirectHosting.mapped ? 'Mapped.' : 'Not mapped.');
  if (enable) enable.disabled = Boolean(currentDirectHosting.mapped);
  if (disable) disable.disabled = !currentDirectHosting.mapped;
  syncPublicAddressField();
  updateAnalytics();
}

function syncPublicAddressField() {
  const input = document.getElementById('publicAddress');
  if (!input || document.activeElement === input) return;
  const saved = String(currentConfig?.publicAddress || '').trim();
  const detected = String(currentDirectHosting?.publicAddress || '').trim();
  input.value = saved || detected || '';
  input.classList.toggle('detected-value', !saved && Boolean(detected));
}

function formatRuntime(ms) {
  if (!ms || ms < 0) return 'Not running';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function updateRuntime() {
  const target = document.getElementById('runtimeSummary');
  const runtime = currentState === 'running' && uptimeStartedAt ? formatRuntime(Date.now() - uptimeStartedAt) : 'Not running';
  if (target) target.textContent = runtime;
  const analyticsRuntime = document.getElementById('analyticsRuntime');
  if (analyticsRuntime) analyticsRuntime.textContent = runtime;
}

function restartUptimeTimer() {
  clearInterval(uptimeTimer);
  uptimeTimer = setInterval(() => {
    updateRuntime();
    if (bannedPlayers.size) updatePlayers(currentStatus?.players || { online: 0, max: currentConfig?.maxPlayers, sample: [] });
  }, 1000);
  updateRuntime();
}

function restartStatusTimer() {
  clearInterval(restartStatusTimer.timer);
  restartStatusTimer.timer = setInterval(async () => {
    if (document.hidden || currentState !== 'running') return;
    try {
      const status = await requestStatus();
      currentStatus = status;
      updateJoinAddressHint(status.config || currentConfig);
      uptimeStartedAt = status.uptimeStartedAt || uptimeStartedAt;
      updateRuntime();
      updateAnalytics(status);
    } catch {}
  }, 6000);
}

function requestStatus() {
  if (statusRequestPending) return statusRequestPending;
  const pending = window.assembly.getStatus();
  statusRequestPending = pending;
  Promise.resolve(pending).finally(() => {
    if (statusRequestPending === pending) statusRequestPending = null;
  }).catch(() => {});
  return pending;
}

function rememberOnlinePlayer(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) return;
  recentOnlinePlayers.set(clean.toLowerCase(), { name: clean });
}

function handleServerLogLine(chunk) {
  const lines = String(chunk || '').split(/\r?\n/);
  let changed = false;
  for (const line of lines) {
    const joined = line.match(/\]:\s*([A-Za-z0-9_]{1,16}) joined the game/i);
    if (joined) {
      rememberOnlinePlayer(joined[1]);
      changed = true;
    }
    const left = line.match(/\]:\s*([A-Za-z0-9_]{1,16}) left the game/i);
    if (left) {
      recentOnlinePlayers.delete(left[1].toLowerCase());
      changed = true;
    }
    const list = line.match(/There are \d+ of a max of \d+ players online: ?(.*)$/i);
    if (list) {
      recentOnlinePlayers.clear();
      list[1].split(',').map((name) => name.trim()).filter(Boolean).forEach(rememberOnlinePlayer);
      changed = true;
    }
  }
  if (changed) updatePlayers(currentStatus?.players || { online: recentOnlinePlayers.size, max: currentConfig?.maxPlayers, sample: [] });
}

function collectConfig(includeDimensionLocks = false) {
  const next = { ...currentConfig };
  for (const id of fields) {
    const input = document.getElementById(id);
    if (!input) continue;
    if (input.type === 'checkbox') {
      next[id] = input.dataset.invert === 'true' ? !input.checked : input.checked;
    } else if (input.type === 'number' || input.type === 'range') {
      next[id] = Number(input.value);
    } else {
      next[id] = input.value;
    }
  }
  if (includeDimensionLocks && standaloneDimensionLockDraft) {
    const request = window.DimensionLockControls.collect(standaloneDimensionLockDraft, id => document.getElementById(id));
    if (request) next._dimensionLockChanges = request;
  }
  return next;
}

function isEditingSettingsInput(input) {
  if (!input || input !== document.activeElement) return false;
  return Boolean(input.closest('#settings'));
}

function hydrateConfig(config, options = {}) {
  const preserveActive = Boolean(options.preserveActive);
  currentConfig = config;
  const details = currentStatus?.dimensionLocks;
  if (!dimensionLockManualDirty) {
    standaloneDimensionLockDraft = window.DimensionLockControls.createDraft(details, currentProfiles?.activeProfileId);
    window.DimensionLockControls.hydrate(standaloneDimensionLockDraft, id => document.getElementById(id));
  }
  for (const id of fields) {
    const input = document.getElementById(id);
    if (!input) continue;
    if (id === 'lockNether' || id === 'lockEnd') {
      continue;
    }
    if (preserveActive && isEditingSettingsInput(input)) continue;
    if (input.type === 'checkbox') {
      input.checked = input.dataset.invert === 'true' ? !Boolean(config[id]) : Boolean(config[id]);
    } else {
      input.value = config[id] ?? '';
    }
  }
  window.DimensionLockControls.sync(details, id => document.getElementById(id));
  const memoryInput = document.getElementById('memoryMb');
  if (memoryInput?.max && Number(memoryInput.value) > Number(memoryInput.max)) {
    memoryInput.value = memoryInput.max;
  }
  const memoryText = document.getElementById('memoryMbText');
  if (memoryText && preserveActive && isEditingSettingsInput(memoryText)) {
    updatePlayerLimitControls();
    updateDashboard(config);
    updateAnalytics();
    return;
  }
  updateMemoryLabel();
  updatePlayerLimitControls();
  updateAddonKindAvailability();
  syncPublicAddressField();
  updateDashboard(config);
  updateAnalytics();
}

function setAnalyticsText(id, value) {
  const target = document.getElementById(id);
  if (target) target.textContent = value;
}

function setAnalyticsHealth(value) {
  const target = document.getElementById('analyticsHealth');
  if (!target) return;
  target.textContent = value;
  target.className = `health-value ${String(value || '').toLowerCase()}`;
}

function updateAnalytics(status = currentStatus) {
  const config = status?.config || currentConfig;
  if (!config) return;
  const players = status?.players || { online: 0, max: config.maxPlayers };
  const perf = status?.performance || {};
  const ready = Boolean(status?.java?.available && status?.jarExists && config.acceptEula && config.serverVersion && config.levelName && Number(config.port));
  const memoryUsed = Number(perf.memoryUsedMb) || 0;
  const memoryAllocated = Number(perf.memoryAllocatedMb) || Number(config.memoryMb) || 2048;
  const memoryPercent = Math.max(0, Math.min(100, Number(perf.memoryUsagePercent) || 0));
  const playerLoad = Number(perf.playerLoadPercent) || 0;
  const cpuPercent = Math.max(0, Math.min(100, Number(perf.cpuPercent) || 0));
  const hasLivePerformance = currentState === 'running' && Boolean(perf.pid);
  const performanceScore = hasLivePerformance
    ? Math.max(0, Math.min(100, Math.round(100 - ((cpuPercent * 0.34) + (memoryPercent * 0.34) + (playerLoad * 0.2) + (perf.pingOk === false ? 12 : 0)))))
    : 0;
  setAnalyticsHealth(perf.health || (currentState === 'running' ? 'Starting' : 'Offline'));
  setAnalyticsText('analyticsStatus', currentState.charAt(0).toUpperCase() + currentState.slice(1));
  setAnalyticsText('analyticsHealthDetail', perf.healthDetail || (currentState === 'running' ? 'Waiting for server response.' : 'Server is stopped.'));
  setAnalyticsText('analyticsCpu', `${cpuPercent}%`);
  setAnalyticsText('analyticsRuntime', currentState === 'running' && uptimeStartedAt ? formatRuntime(Date.now() - uptimeStartedAt) : 'Not running');
  setAnalyticsText('analyticsPlayers', `${Number(players.online) || 0} / ${Number(players.max) || Number(config.maxPlayers) || 0}`);
  setAnalyticsText('analyticsMemory', `${memoryUsed} / ${memoryAllocated} MB`);
  setAnalyticsText('memorySummary', `${memoryUsed} / ${memoryAllocated} MB`);
  const memoryMetric = document.getElementById('memoryMetric');
  if (memoryMetric) memoryMetric.style.setProperty('--memory-percent', `${memoryPercent}%`);
  setAnalyticsText('analyticsMemoryDetail', `${memoryUsed} MB used of ${memoryAllocated} MB (${memoryPercent}%)`);
  setAnalyticsText('analyticsPlayerLoad', `${playerLoad}%`);
  setAnalyticsText('analyticsSystemMemory', `${Number(perf.systemFreeMemoryMb) || 0} MB free of ${Number(perf.systemTotalMemoryMb) || currentNetwork.totalMemoryMb || 0} MB`);
  setAnalyticsText('analyticsSystemRamFooter', `${Number(perf.systemFreeMemoryMb) || 0} MB free`);
  setAnalyticsText('analyticsDisk', formatBytes(Number(perf.diskBytes) || 0));
  setAnalyticsText('storageUsed', formatBytes(Number(perf.diskBytes) || 0));
  setAnalyticsText('analyticsIncomingBandwidth', `${formatRate(Number(perf.incomingBytesPerSec) || 0)}`);
  setAnalyticsText('analyticsOutgoingBandwidth', `${formatRate(Number(perf.outgoingBytesPerSec) || 0)}`);
  const totalNetworkRate = (Number(perf.incomingBytesPerSec) || 0) + (Number(perf.outgoingBytesPerSec) || 0);
  setAnalyticsText('analyticsPressureCpu', `${cpuPercent}%`);
  setAnalyticsText('analyticsPressureMemory', `${memoryPercent}%`);
  setAnalyticsText('analyticsPressureNetwork', formatRate(totalNetworkRate));
  setBar('analyticsCpuBar', cpuPercent);
  setBar('analyticsMemoryBar', memoryPercent);
  setBar('analyticsStorageBar', Math.min(100, Math.round((Number(perf.diskBytes) || 0) / (1024 * 1024 * 20))));
  const pingLabel = currentState !== 'running'
    ? 'Offline'
    : perf.pingOk
      ? 'Responding'
      : perf.responding === false
        ? 'Process stalled'
        : 'Process online';
  setAnalyticsText('analyticsPing', pingLabel);
  setAnalyticsText('analyticsJoinAddress', buildServerAddress(config));
  setAnalyticsText('analyticsPort', String(Number(config.port) || 25565));
  setAnalyticsText('analyticsDirectHosting', currentDirectHosting.mapped ? currentDirectHosting.publicAddress || 'Mapped' : 'Not mapped');
  setAnalyticsText('analyticsWorld', config.levelName || 'world');
  setAnalyticsText('analyticsVersion', config.serverVersion || 'custom');
  setAnalyticsText('analyticsDifficulty', config.difficulty || 'normal');
  setAnalyticsText('analyticsReady', ready ? 'Yes' : 'No');
  renderAnalyticsChart(performanceScore);
  renderPressureBars({ cpu: cpuPercent, memory: memoryPercent, networkRate: totalNetworkRate });
}

function setBar(id, value) {
  const target = document.getElementById(id);
  if (target) target.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
}

function renderAnalyticsChart(score) {
  const chart = document.getElementById('analyticsChart');
  if (!chart) return;
  analyticsSamples.push(Number(score) || 0);
  while (analyticsSamples.length > 24) analyticsSamples.shift();
  const samples = analyticsSamples.length > 1 ? analyticsSamples : [analyticsSamples[0], analyticsSamples[0]];
  const width = 640;
  const height = 260;
  const top = 12;
  const bottom = height - 1;
  const graphHeight = bottom - top;
  const points = samples.map((value, index) => {
    const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * width;
    const y = bottom - (Math.max(0, Math.min(100, value)) / 100) * graphHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  const grid = [20, 40, 60, 80].map((line) => {
    const y = bottom - (line / 100) * graphHeight;
    return `<path d="M0 ${y.toFixed(1)}H${width}" class="chart-grid" />`;
  }).join('');
  chart.innerHTML = `
    <defs>
      <linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(74,222,128,.28)" />
        <stop offset="100%" stop-color="rgba(74,222,128,0)" />
      </linearGradient>
    </defs>
    ${grid}
    <path d="M0 ${bottom}H640" class="chart-axis" />
    <path d="M24 0V260" class="chart-axis" />
    <polygon points="${area}" fill="url(#analyticsFill)" />
    <polyline points="${points}" class="chart-line score" />
  `;
}

function renderPressureBars({ cpu, memory, networkRate }) {
  const target = document.getElementById('analyticsPressureBars');
  if (!target) return;
  const networkPressure = Math.min(100, Math.round((Number(networkRate) || 0) / (1024 * 1024)));
  const pressure = Math.max(Number(cpu) || 0, Number(memory) || 0, networkPressure);
  pressureSamples.push(pressure);
  while (pressureSamples.length > 14) pressureSamples.shift();
  const samples = pressureSamples.length ? pressureSamples : [0];
  const label = document.getElementById('analyticsPressureLabel');
  if (label) {
    label.textContent = pressure >= 85 ? 'High' : pressure >= 55 ? 'Moderate' : pressure > 0 ? 'Low' : 'Idle';
  }
  target.innerHTML = '';
  for (let index = 0; index < 14; index += 1) {
    const value = samples[index] ?? 0;
    const bar = document.createElement('i');
    bar.style.height = value > 0 ? `${Math.max(2, value)}%` : '0';
    if (index === samples.length - 1) bar.className = 'active';
    target.append(bar);
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatCount(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getAddonSourceLogo(source) {
  return source === 'curseforge' ? 'assets/source-curseforge.svg' : 'assets/source-modrinth.svg';
}

function getServerTypeAddonSupport(serverType = currentConfig?.serverType) {
  const type = String(serverType || 'vanilla').toLowerCase();
  if (type === 'vanilla') return { type, mods: false, plugins: false };
  if (['paper', 'purpur', 'spigot'].includes(type)) return { type, mods: false, plugins: true };
  return { type, mods: true, plugins: false };
}

function setInstalledKind(kind) {
  const support = getServerTypeAddonSupport();
  if (kind === 'plugins' && !support.plugins) return;
  if (kind !== 'plugins' && !support.mods) return;
  installedKind = kind === 'plugins' ? 'plugins' : 'mods';
  renderInstalledAddons();
}

function updateInstalledKindAvailability() {
  const support = getServerTypeAddonSupport();
  const modsButton = document.getElementById('installedKindMods');
  const pluginsButton = document.getElementById('installedKindPlugins');
  modsButton?.toggleAttribute('disabled', !support.mods);
  pluginsButton?.toggleAttribute('disabled', !support.plugins);
  if (installedKind === 'mods' && !support.mods && support.plugins) installedKind = 'plugins';
  if (installedKind === 'plugins' && !support.plugins && support.mods) installedKind = 'mods';
  if (!support.mods && !support.plugins) installedKind = 'mods';
  modsButton?.classList.toggle('active', installedKind === 'mods');
  pluginsButton?.classList.toggle('active', installedKind === 'plugins');
}

function renderInstalledAddons() {
  const container = document.getElementById('installedResults');
  if (!container) return;
  updateInstalledKindAvailability();
  const support = getServerTypeAddonSupport();
  const isSupported = installedKind === 'plugins' ? support.plugins : support.mods;
  const singular = installedKind === 'plugins' ? 'plugin' : 'mod';
  const allFiles = Array.isArray(installedFiles[installedKind]) ? installedFiles[installedKind] : [];
  const query = installedSearchQuery.trim().toLowerCase();
  const files = query ? allFiles.filter((file) => String(file.name || '').toLowerCase().includes(query)) : allFiles;
  container.innerHTML = '';
  if (!isSupported) {
    const empty = document.createElement('div');
    empty.className = 'addon-empty installed-empty';
    empty.innerHTML = `<strong>${installedKind === 'plugins' ? 'Plugins' : 'Mods'} unavailable</strong><span></span>`;
    empty.querySelector('span').textContent = `${support.type.toUpperCase()} servers do not load ${installedKind}.`;
    container.append(empty);
    return;
  }
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'addon-empty installed-empty';
    empty.innerHTML = `<strong>${query ? 'No matching addons' : `No installed ${installedKind}`}</strong><span></span>`;
    empty.querySelector('span').textContent = query ? 'Clear the search or try another name.' : `Import a ${singular} jar or install one from Browse.`;
    container.append(empty);
    return;
  }
  for (const file of files) {
    const card = document.createElement('article');
    card.className = 'addon-card installed-addon-card';
    card.innerHTML = `
      <div class="installed-addon-icon" aria-hidden="true"></div>
      <div class="addon-card-main">
        <div class="addon-card-head"><strong></strong><small>Installed</small></div>
        <p></p>
        <div class="addon-tags"><span>${escapeHtml(singular)}</span><span>jar</span></div>
      </div>
      <div class="addon-card-side"><div class="addon-stats"><span>${formatBytes(file.size)}</span><span>${escapeHtml(support.type)}</span></div><button class="installed-addon-delete danger" type="button">Delete</button></div>
    `;
    card.querySelector('.installed-addon-icon').textContent = singular[0].toUpperCase();
    card.querySelector('strong').textContent = file.name;
    card.querySelector('p').textContent = `${file.name} is managed in the active world ${installedKind} folder.`;
    card.querySelector('.installed-addon-delete').addEventListener('click', async () => {
      if (!confirm(`Delete ${file.name}?`)) return;
      await run(() => window.assembly.deleteJar(installedKind, file.name), 'File deleted.');
      await refresh();
    });
    container.append(card);
  }
}

function setAddonsView(view) {
  addonsView = view === 'browse' || view === 'detail' ? view : 'installed';
  document.getElementById('addonsInstalledView')?.classList.toggle('hidden', addonsView !== 'installed');
  document.getElementById('addonsBrowseView')?.classList.toggle('hidden', addonsView !== 'browse');
  document.getElementById('addonDetailView')?.classList.toggle('hidden', addonsView !== 'detail');
  document.getElementById('addonsInstalledBtn')?.classList.toggle('active', addonsView === 'installed');
  document.getElementById('addonsBrowseBtn')?.classList.toggle('active', addonsView === 'browse' || addonsView === 'detail');
  if (addonsView === 'browse' && !addonsResults.length) searchAddons();
}

function setAddonsKind(kind) {
  const support = getServerTypeAddonSupport();
  if (kind === 'plugins' && !support.plugins) return;
  if (kind !== 'plugins' && !support.mods) return;
  addonsKind = kind === 'plugins' ? 'plugins' : 'mods';
  document.getElementById('addonsKindMods')?.classList.toggle('active', addonsKind === 'mods');
  document.getElementById('addonsKindPlugins')?.classList.toggle('active', addonsKind === 'plugins');
  searchAddons({ reset: true });
}

function setAddonsSource(source) {
  addonsSource = source === 'curseforge' ? 'curseforge' : 'modrinth';
  document.getElementById('addonsSourceModrinth')?.classList.toggle('active', addonsSource === 'modrinth');
  document.getElementById('addonsSourceCurseForge')?.classList.toggle('active', addonsSource === 'curseforge');
  searchAddons({ reset: true });
}

function renderAddonResults(payload = {}) {
  const container = document.getElementById('addonsResults');
  if (!container) return;
  container.innerHTML = '';
  if (payload.needsKey) {
    const empty = document.createElement('div');
    empty.className = 'addon-empty';
    empty.innerHTML = '<strong>CurseForge API key needed</strong><span></span>';
    empty.querySelector('span').textContent = payload.message || 'Set CURSEFORGE_API_KEY and restart the server manager.';
    container.append(empty);
    return;
  }
  if (!addonsResults.length) {
    const empty = document.createElement('div');
    empty.className = 'addon-empty';
    empty.innerHTML = '<strong>No addons found</strong><span>Try a different search or source.</span>';
    if (payload.message) empty.querySelector('span').textContent = payload.message;
    container.append(empty);
    return;
  }
  for (const addon of addonsResults) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'addon-card';
    const tags = (addon.categories || []).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const sourceLabel = addon.source === 'curseforge' ? 'CurseForge' : 'Modrinth';
    card.innerHTML = `
      <img class="addon-icon" alt="" />
      <div class="addon-card-main">
        <div class="addon-card-head"><strong></strong><small></small></div>
        <p></p>
        <div class="addon-tags">${tags}</div>
      </div>
      <div class="addon-card-side"><div class="addon-stats"><span>${formatCount(addon.downloads)} downloads</span><span class="addon-source-badge"><img alt="" /> <span>${escapeHtml(sourceLabel)}</span></span></div><span class="addon-card-install">Install</span></div>
    `;
    card.querySelector('.addon-icon').src = addon.iconUrl || 'assets/minecraft-default-world.png';
    card.querySelector('.addon-source-badge img').src = getAddonSourceLogo(addon.source);
    card.querySelector('strong').textContent = addon.title || 'Untitled addon';
    card.querySelector('small').textContent = addon.author || addon.source;
    card.querySelector('p').textContent = addon.description || 'No summary provided.';
    card.addEventListener('click', () => openAddonDetail(addon));
    card.querySelector('.addon-card-install').addEventListener('click', async (event) => {
      event.stopPropagation();
      await run(() => window.assembly.installAddon({ ...addon, kind: addonsKind, serverType: currentConfig?.serverType }), 'Addon installed.');
      await refresh();
    });
    container.append(card);
  }
  if (addonsHasMore) {
    const more = document.createElement('div');
    more.className = 'addon-more';
    more.textContent = addonsLoading ? 'Loading more addons...' : 'Scroll for more';
    container.append(more);
  }
}

function resetAddonPagination(query = '') {
  addonsOffset = 0;
  addonsTotal = 0;
  addonsHasMore = true;
  addonsResults = [];
  addonsLastQuery = query;
}

async function searchAddons({ reset = false, append = false } = {}) {
  if (addonsLoading) return;
  const input = document.getElementById('addonsSearchInput');
  const query = input?.value || '';
  if (reset || query !== addonsLastQuery) resetAddonPagination(query);
  if (append && !addonsHasMore) return;
  const container = document.getElementById('addonsResults');
  if (container && !append) container.innerHTML = '<div class="addon-empty"><strong>Loading addons...</strong><span>Searching the selected source.</span></div>';
  addonsLoading = true;
  try {
    const payload = await window.assembly.searchAddons({
      kind: addonsKind,
      source: addonsSource,
      query,
      serverType: currentConfig?.serverType || 'vanilla',
      limit: 24,
      offset: addonsOffset
    });
    const incoming = payload.results || [];
    const seen = new Set(addonsResults.map((addon) => `${addon.source}:${addon.id || addon.slug}`));
    const merged = append ? addonsResults.slice() : [];
    for (const addon of incoming) {
      const key = `${addon.source}:${addon.id || addon.slug}`;
      if (!seen.has(key)) {
        merged.push(addon);
        seen.add(key);
      }
    }
    addonsResults = merged.length > MAX_ADDON_RESULTS ? merged.slice(-MAX_ADDON_RESULTS) : merged;
    const reportedTotal = Number(payload.total);
    addonsTotal = Number.isFinite(reportedTotal) && reportedTotal >= 0 ? reportedTotal : addonsResults.length;
    addonsOffset = (Number(payload.offset) || addonsOffset) + incoming.length;
    addonsHasMore = incoming.length > 0 && (
      Number.isFinite(reportedTotal) && reportedTotal >= 0
        ? addonsOffset < reportedTotal
        : incoming.length >= 24
    );
    addonsLoading = false;
    renderAddonResults(payload);
  } catch (error) {
    if (container) {
      container.innerHTML = '<div class="addon-empty"><strong>Could not load addons</strong><span></span></div>';
      container.querySelector('span').textContent = formatAssemblyError(error);
    }
  } finally {
    addonsLoading = false;
  }
}

function updateAddonKindAvailability() {
  const support = getServerTypeAddonSupport();
  const modsButton = document.getElementById('addonsKindMods');
  const pluginsButton = document.getElementById('addonsKindPlugins');
  modsButton?.toggleAttribute('disabled', !support.mods);
  pluginsButton?.toggleAttribute('disabled', !support.plugins);
  if (addonsKind === 'mods' && !support.mods && support.plugins) addonsKind = 'plugins';
  if (addonsKind === 'plugins' && !support.plugins && support.mods) addonsKind = 'mods';
  document.getElementById('addonsKindMods')?.classList.toggle('active', addonsKind === 'mods');
  document.getElementById('addonsKindPlugins')?.classList.toggle('active', addonsKind === 'plugins');
  updateInstalledKindAvailability();
}

function scheduleAddonSearch() {
  clearTimeout(addonsSearchTimer);
  addonsSearchTimer = setTimeout(() => searchAddons({ reset: true }), 250);
}

function loadMoreAddonsIfNeeded() {
  if (addonsView !== 'browse' || addonsLoading || !addonsHasMore) return;
  const workspace = document.querySelector('.workspace');
  if (!workspace) return;
  const distanceToBottom = workspace.scrollHeight - workspace.scrollTop - workspace.clientHeight;
  if (distanceToBottom < 520) searchAddons({ append: true });
}

async function openAddonDetail(addon) {
  const container = document.getElementById('addonDetailView');
  if (!container) return;
  setAddonsView('detail');
  container.innerHTML = '<div class="addon-empty"><strong>Loading profile...</strong><span>Fetching addon details.</span></div>';
  try {
    const detail = await window.assembly.getAddonDetails(addon);
    const tags = [...new Set([...(detail.loaders || []), ...(detail.categories || [])])].slice(0, 12).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    container.innerHTML = `
      <div class="addon-detail-hero">
        <button id="addonBackBtn" class="config-soft-btn">Back</button>
        <img class="addon-detail-icon" alt="" />
        <div class="addon-detail-title"><p></p><h1></h1><div class="addon-tags">${tags}</div></div>
        <button id="addonInstallBtn" class="primary">Install</button>
      </div>
      <div class="addon-detail-grid">
        <article class="addon-readme"></article>
        <aside class="addon-sidebar">
          <div><span>Source</span><strong>${escapeHtml(detail.source)}</strong></div>
          <div><span>Downloads</span><strong>${formatCount(detail.downloads)}</strong></div>
          <div><span>Followers</span><strong>${formatCount(detail.follows)}</strong></div>
          <div><span>Server side</span><strong>${escapeHtml(detail.serverSide || 'unknown')}</strong></div>
        </aside>
      </div>
    `;
    container.querySelector('.addon-detail-icon').src = detail.iconUrl || 'assets/minecraft-default-world.png';
    container.querySelector('.addon-detail-title p').textContent = detail.author || detail.source;
    container.querySelector('.addon-detail-title h1').textContent = detail.title || addon.title || 'Addon';
    container.querySelector('.addon-readme').textContent = detail.body || detail.description || 'No project description provided.';
    document.getElementById('addonBackBtn')?.addEventListener('click', () => setAddonsView('browse'));
    document.getElementById('addonInstallBtn')?.addEventListener('click', async () => {
      await run(() => window.assembly.installAddon({ ...detail, kind: addonsKind, serverType: currentConfig?.serverType }), 'Addon installed.');
      await refresh();
      setAddonsView('installed');
    });
  } catch (error) {
    container.innerHTML = '<div class="addon-empty"><strong>Could not open addon</strong><span></span><button id="addonBackBtn" class="config-soft-btn">Back</button></div>';
    container.querySelector('span').textContent = formatAssemblyError(error);
    document.getElementById('addonBackBtn')?.addEventListener('click', () => setAddonsView('browse'));
  }
}

async function run(action, successMessage) {
  try {
    const result = await action();
    if (successMessage) showToast(successMessage);
    return result;
  } catch (error) {
    showToast(formatAssemblyError(error));
    throw error;
  }
}

function formatAssemblyError(error) {
  const message = String(error?.message || error || '')
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .replace(/Stop the Minecraft server and wait for startup to finish before changing custom mods\.?/gi, 'Stop the server before changing custom mods.')
    .replace(/Stop the Minecraft server and wait for startup to finish before changing custom plugins\.?/gi, 'Stop the server before changing custom plugins.');
  if (message.includes('ASM-WORLD-022')) {
    const worldVersion = message.match(/World version:\s*([^\n]+)/)?.[1]?.trim();
    const selectedVersion = message.match(/Selected server version:\s*([^\n]+)/)?.[1]?.trim();
    return `This world is ${worldVersion || 'newer'}, so the server manager will use a separate world for ${selectedVersion || 'the selected version'}.`;
  }
  if (message.includes('ASM-WORLD-012')) return 'This world needs a matching Minecraft server version before it can start.';
  return message || 'Something went wrong.';
}

function refresh() {
  if (fullRefreshPending) return fullRefreshPending;
  const pending = (async () => {
    const status = await requestStatus();
    currentStatus = status;
    currentNetwork = status.network || { lanIps: [] };
    currentBans = Array.isArray(status.bans) ? status.bans : [];
    currentHistory = Array.isArray(status.playerHistory) ? status.playerHistory : [];
    updatePlayitControls(status.playit);
    updateDirectHostingControls(status.directHosting);
    if (currentProfiles?.activeProfileId !== status.profiles?.activeProfileId) dimensionLockManualDirty = false;
    currentProfiles = status.profiles || null;
    configureMemorySlider(currentNetwork.totalMemoryMb);
    uptimeStartedAt = status.uptimeStartedAt || null;
    hydrateConfig(status.config, { preserveActive: true });
    setSessionsView(sessionsView);
    setState(status.state);
    installedFiles = {
      mods: Array.isArray(status.mods) ? status.mods : [],
      plugins: Array.isArray(status.plugins) ? status.plugins : []
    };
    renderInstalledAddons();
    renderProfiles();
    renderReadiness(status);
    updateAnalytics(status);
  })();
  fullRefreshPending = pending;
  pending.finally(() => {
    if (fullRefreshPending === pending) fullRefreshPending = null;
  }).catch(() => {});
  return pending;
}

function renderReadiness(status) {
  const list = document.getElementById('readinessList');
  if (!list) return;
  const config = status.config;
  const rows = [
    { ok: status.java?.available, label: 'Java 25+', detail: status.java?.available ? status.java.version : 'Install Java 25 or set Java Path.' },
    { ok: status.jarExists, label: 'Server Jar', detail: status.jarExists ? 'Downloaded.' : 'Download a vanilla jar or choose a custom jar.' },
    { ok: Boolean(config.acceptEula), label: 'Minecraft EULA', detail: config.acceptEula ? 'Accepted.' : 'Accept it in Settings > Gameplay.' },
    { ok: Boolean(config.serverVersion && config.serverVersion !== 'latest'), label: 'Minecraft Version', detail: config.serverVersion || 'Select a version in Config.' },
    { ok: Boolean(config.levelName), label: 'World Name', detail: config.levelName || 'Set a world name.' },
    config.localOnly
      ? { ok: true, label: 'Local-only endpoint', detail: buildServerAddress(config) }
      : { ok: Boolean(config.publicAddress || config.customHostname), label: 'Join Address', detail: buildServerAddress(config) },
    { ok: Number(config.port) > 0, label: 'Port', detail: String(config.port || 25565) }
  ];
  list.innerHTML = '';
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = `readiness-row ${row.ok ? 'ok' : 'bad'}`;
    item.innerHTML = `<span>${row.ok ? 'OK' : '!'}</span><div><strong></strong><small></small></div>`;
    item.querySelector('strong').textContent = row.label;
    item.querySelector('small').textContent = row.detail;
    list.append(item);
  }
}

function renderProfiles() {
  const label = document.getElementById('profileDropdownLabel');
  const activeIcon = document.getElementById('profileDropdownIcon');
  const list = document.getElementById('profileOptions');
  if (!label || !list || !currentProfiles) return;
  list.innerHTML = '';
  const active = currentProfiles.profiles.find((profile) => profile.id === currentProfiles.activeProfileId);
  label.textContent = active?.name || 'Default Server';
  if (activeIcon) activeIcon.src = active?.iconDataUrl || 'assets/minecraft-default-world.png';
  const query = document.getElementById('profileSearch')?.value?.trim().toLowerCase() || '';
  const rows = currentProfiles.profiles.filter((profile) => !query || `${profile.name} ${profile.levelName || ''}`.toLowerCase().includes(query));
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'profile-empty';
    empty.textContent = 'No worlds match.';
    list.append(empty);
    return;
  }
  for (const profile of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `profile-option ${profile.id === currentProfiles.activeProfileId ? 'active' : ''}`;
    const icon = document.createElement('img');
    icon.src = profile.iconDataUrl || 'assets/minecraft-default-world.png';
    icon.alt = '';
    const name = document.createElement('span');
    name.textContent = profile.name;
    item.append(icon, name);
    item.addEventListener('click', async () => {
      document.getElementById('profileDropdown').classList.remove('open');
      if (profile.id === currentProfiles.activeProfileId) return;
      const stopRunning = await confirmProfileSwitchIfRunning();
      if (stopRunning === null) return;
      await run(() => window.assembly.switchProfile(profile.id, stopRunning), 'World switched.');
      await refresh();
    });
    const row = document.createElement('div');
    row.className = 'profile-option-row';
    row.append(item);
    if (profile.id !== 'default') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-delete-btn';
      remove.textContent = 'X';
      remove.setAttribute('aria-label', `Delete ${profile.name}`);
      remove.dataset.tooltip = `Delete ${profile.name}`;
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        const stopRunning = profile.id === currentProfiles.activeProfileId
          ? await confirmProfileSwitchIfRunning()
          : false;
        if (stopRunning === null) return;
        if (!confirm(`Delete world "${profile.name}" and its stored files?`)) return;
        document.getElementById('profileDropdown').classList.remove('open');
        await run(() => window.assembly.deleteProfile(profile.id, stopRunning), 'World deleted.');
        await refresh();
      });
      row.append(remove);
    }
    list.append(row);
  }
}

async function confirmProfileSwitchIfRunning() {
  if (currentState !== 'running' && currentState !== 'starting') return false;
  return confirm('A server is running. Switching worlds will stop it first. Are you sure?') ? true : null;
}

async function createWorldProfile() {
  if (creatingWorld) return;
  const stopRunning = await confirmProfileSwitchIfRunning();
  if (stopRunning === null) return;
  const name = await askWorldName();
  if (!name?.trim()) return;
  creatingWorld = true;
  const addButton = document.getElementById('profileAddBtn');
  addButton?.toggleAttribute('disabled', true);
  try {
    await run(() => window.assembly.createProfile(name.trim(), stopRunning), 'World created.');
    await refresh();
  } finally {
    creatingWorld = false;
    addButton?.toggleAttribute('disabled', false);
  }
}

function askWorldName() {
  const modal = document.getElementById('worldModal');
  const input = document.getElementById('worldNameInput');
  modal.classList.remove('hidden');
  input.value = '';
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return new Promise((resolve) => {
    worldModalResolve = resolve;
  });
}

function closeWorldModal(value = '') {
  const modal = document.getElementById('worldModal');
  const trimmed = String(value || '').trim();
  if (trimmed) {
    modal.classList.add('hidden');
    if (worldModalResolve) worldModalResolve(trimmed);
    worldModalResolve = null;
    return;
  }
  modal.classList.add('hidden');
  if (worldModalResolve) worldModalResolve('');
  worldModalResolve = null;
}

function configureMemorySlider(totalMemoryMb) {
  const input = document.getElementById('memoryMb');
  if (!input) return;
  const max = Math.max(1024, Math.floor((Number(totalMemoryMb) || 4096) * 0.75 / 256) * 256);
  input.max = String(max);
  if (!input.value) input.value = String(Math.min(2048, max));
  document.getElementById('memoryMinLabel').textContent = `${input.min} MB`;
  document.getElementById('memoryMaxLabel').textContent = `${input.max} MB`;
  updateMemoryLabel();
}

function updateMemoryLabel() {
  const input = document.getElementById('memoryMb');
  const label = document.getElementById('memoryRangeLabel');
  const text = document.getElementById('memoryMbText');
  const bubble = document.getElementById('memoryBubble');
  if (!input || !label) return;
  const value = Number(input.value || 0);
  label.textContent = `${value} MB selected`;
  if (text && document.activeElement !== text) text.value = String(value);
  if (bubble) {
    bubble.textContent = `${value} MB`;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 1;
    const percent = Math.max(0, Math.min(1, (value - min) / (max - min)));
    bubble.style.left = `${percent * 100}%`;
  }
}

function setMemoryValue(value) {
  const input = document.getElementById('memoryMb');
  if (!input) return;
  const min = Number(input.min) || 512;
  const max = Number(input.max) || 4096;
  const step = Number(input.step) || 256;
  const numeric = Number(String(value).replace(/[^\d]/g, ''));
  const clamped = Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : min));
  input.value = String(Math.round(clamped / step) * step);
  updateMemoryLabel();
  updatePlayerLimitControls();
}

function enhanceNumberInputs() {
  document.querySelectorAll('.setting-row input[type="number"]').forEach((input) => {
    if (input.closest('.number-control')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'number-control';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);
    const controls = document.createElement('div');
    controls.className = 'number-buttons';
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '+';
    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '-';
    controls.append(up, down);
    wrapper.append(controls);
    const step = (direction) => {
      const amount = Number(input.step) || 1;
      const min = input.min === '' ? -Infinity : Number(input.min);
      const max = input.max === '' ? Infinity : Number(input.max);
      const current = Number(input.value || 0);
      input.value = String(Math.min(max, Math.max(min, current + amount * direction)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    up.addEventListener('click', () => step(1));
    down.addEventListener('click', () => step(-1));
  });
}

function closeCustomSelects(except = null) {
  document.querySelectorAll('.custom-select.open').forEach((select) => {
    if (select !== except) select.classList.remove('open');
  });
}

function syncCustomSelect(nativeSelect) {
  const wrapper = nativeSelect?.nextElementSibling?.classList?.contains('custom-select') ? nativeSelect.nextElementSibling : null;
  if (!wrapper) return;
  const value = wrapper.querySelector('.custom-select-value');
  const menu = wrapper.querySelector('.custom-select-menu');
  const selected = nativeSelect.selectedOptions[0] || nativeSelect.options[0];
  value.textContent = selected?.textContent || 'Select';
  menu.innerHTML = '';
  Array.from(nativeSelect.options).forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select-option';
    item.textContent = option.textContent;
    item.dataset.value = option.value;
    item.classList.toggle('active', option.value === nativeSelect.value);
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      nativeSelect.value = option.value;
      nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      closeCustomSelects();
      syncCustomSelect(nativeSelect);
    });
    menu.append(item);
  });
}

function enhanceSelects() {
  document.querySelectorAll('select').forEach((nativeSelect) => {
    // Timer units must retain native disabled state and reflect draft hydration.
    if (nativeSelect.id === 'netherDurationUnit' || nativeSelect.id === 'endDurationUnit') return;
    if (nativeSelect.dataset.customEnhanced === 'true') {
      syncCustomSelect(nativeSelect);
      return;
    }
    nativeSelect.dataset.customEnhanced = 'true';
    nativeSelect.classList.add('native-select-hidden');
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    wrapper.innerHTML = `
      <button type="button" class="custom-select-trigger"><span class="custom-select-value"></span><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg></button>
      <div class="custom-select-menu"></div>
    `;
    nativeSelect.insertAdjacentElement('afterend', wrapper);
    wrapper.querySelector('.custom-select-trigger').addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !wrapper.classList.contains('open');
      closeCustomSelects(wrapper);
      wrapper.classList.toggle('open', willOpen);
    });
    nativeSelect.addEventListener('change', () => syncCustomSelect(nativeSelect));
    new MutationObserver(() => syncCustomSelect(nativeSelect)).observe(nativeSelect, { childList: true, attributes: true, subtree: true });
    syncCustomSelect(nativeSelect);
  });
}

async function loadVersions() {
  const select = document.getElementById('serverVersionSelect');
  try {
    const manifest = await window.assembly.listVersions();
    select.innerHTML = '';
    const currentVersion = currentConfig?.serverVersion;
    if (currentVersion && !manifest.versions.some((version) => version.id === currentVersion)) {
      const currentOption = document.createElement('option');
      currentOption.value = currentVersion;
      currentOption.textContent = `${currentVersion} (installed)`;
      select.append(currentOption);
    }
    for (const version of manifest.versions) {
      const option = document.createElement('option');
      option.value = version.id;
      option.textContent = version.id;
      select.append(option);
    }
    select.value = currentVersion || manifest.latest.release || 'latest';
    syncCustomSelect(select);
  } catch (error) {
    select.innerHTML = '<option value="latest">latest</option>';
    syncCustomSelect(select);
    showToast(error.message || 'Could not load Minecraft versions.');
  }
}

async function saveSettings() {
  const previousConfig = currentConfig ? { ...currentConfig } : null;
  let requestedConfig;
  try { requestedConfig = collectConfig(true); } catch (error) { showToast(error.message); return; }
  currentConfig = await run(() => window.assembly.saveConfig(requestedConfig), 'Settings saved.');
  dimensionLockManualDirty = false;
  if (requestedConfig._dimensionLockChanges) await refresh();
  const pvpChanged = previousConfig && Boolean(previousConfig.pvp) !== Boolean(requestedConfig.pvp);
  if (pvpChanged) {
    showToast(currentState === 'running' ? 'PvP saved. Restarting server to apply it.' : 'PvP saved. It applies on next start.');
  } else if (currentState === 'running') {
    showToast('Live gamerules applied. Restart for server-property settings.');
  }
  updateDashboard(currentConfig);
  hydrateConfig(currentConfig, { preserveActive: true });
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (!currentConfig) return;
    try {
      const previousConfig = { ...currentConfig };
      const requestedConfig = collectConfig();
      currentConfig = await window.assembly.saveConfig(requestedConfig);
      hydrateConfig(currentConfig, { preserveActive: true });
      if (Boolean(previousConfig.pvp) !== Boolean(requestedConfig.pvp)) {
        addNotification(currentState === 'running' ? 'PvP saved. Restarting server to apply it.' : 'PvP saved. It applies on next start.');
        showToast(currentState === 'running' ? 'PvP saved. Restarting server to apply it.' : 'PvP saved. It applies on next start.');
      } else if (currentState === 'running') {
        addNotification('Live gamerules applied. Restart for server-property settings.');
      }
    } catch (error) {
      showToast(error.message || 'Could not save settings.');
    }
  }, 650);
}

async function toggleServer() {
  if (currentState === 'stopped') {
    const missing = getMissingStartSettings();
    if (missing.length) {
      showToast(`Missing required settings: ${missing.join(', ')}`);
      return;
    }
  }
  await run(() => window.assembly.saveConfig(collectConfig()));
  if (currentState === 'running' || currentState === 'starting') {
    await run(() => window.assembly.stopServer(), 'Stop command sent.');
    uptimeStartedAt = null;
  } else {
    await run(() => window.assembly.startServer(), 'Server starting.');
    uptimeStartedAt = Date.now();
  }
  updateRuntime();
}

function getMissingStartSettings() {
  const config = collectConfig();
  const missing = [];
  if (!String(config.levelName || '').trim()) missing.push('World Name');
  if (!Number(config.port)) missing.push('Port');
  if (!Number(config.memoryMb)) missing.push('Memory');
  if (!String(config.javaPath || '').trim()) missing.push('Java Path');
  if (!String(config.serverVersion || '').trim()) missing.push('Minecraft Version');
  if (!config.acceptEula) missing.push('EULA');
  if (!currentStatus?.jarExists) missing.push('Server Jar');
  return missing;
}

async function wipeData() {
  const profileId = currentProfiles?.activeProfileId;
  if (!profileId || currentState !== 'stopped' || worldResetBusy || pendingWorldResetProfile) return;
  const dialog = document.getElementById('resetDataDialog');
  const profile = currentProfiles.profiles.find(item => item.id === profileId);
  document.getElementById('resetDataDescription').textContent = `Reset the entire world for “${profile?.name || 'this server'}”? This resets all dimensions and player progress, clears joined-player history, and unbans everyone. Lootr is also removed. Operators and the whitelist are kept. A backup is created first. Settings are kept unless selected below.`;
  document.getElementById('resetDataSettings').checked = false;
  const resetFieldNames = ['serverIcon', 'serverType', 'serverVersion', 'levelName', 'motd', 'publicAddress', 'simulationDistance'];
  for (const field of resetFieldNames) document.getElementById(`resetDataField-${field}`).checked = false;
  dialog.returnValue = '';
  pendingWorldResetProfile = profileId;
  dialog.showModal();
  await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
  const valid = pendingWorldResetProfile === profileId && currentProfiles?.activeProfileId === profileId && currentState === 'stopped' && !worldResetBusy;
  pendingWorldResetProfile = '';
  if (dialog.returnValue !== 'reset' || !valid) return;
  worldResetBusy = true;
  updateWorldResetControls();
  clearTimeout(autoSaveTimer);
  try {
    const resetFields = resetFieldNames.filter(field => document.getElementById(`resetDataField-${field}`).checked === true);
    const result = await run(() => window.assembly.wipeData({ profileId, resetSettings: document.getElementById('resetDataSettings').checked === true, resetFields }));
    if (result?.reset && result.profileId === currentProfiles?.activeProfileId) {
      currentBans = []; currentHistory = []; recentOnlinePlayers.clear(); bannedPlayers.clear();
      for (const timer of tempBanTimers.values()) clearTimeout(timer);
      tempBanTimers.clear(); tempBanEnds.clear();
    }
    if (result?.config && result.profileId === currentProfiles?.activeProfileId) hydrateConfig(result.config);
    await refresh();
    showToast(result?.resetSettings || result?.resetFields?.length ? 'World, player history and bans reset. Selected settings reset; other settings kept. Backup saved.' : 'World, player history and bans reset. Settings kept. Backup saved.');
  } catch (_) {
    // run() already displays the backend error; never retry a destructive request.
  } finally {
    worldResetBusy = false;
    updateWorldResetControls();
  }
}

function updateWorldResetControls() {
  const unavailable = !currentProfiles?.activeProfileId || currentState !== 'stopped' || worldResetBusy;
  for (const id of ['wipeDataBtn', 'wipeDataStorageBtn', 'wipeDataSettingsBtn']) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = unavailable;
    button.title = currentState !== 'stopped' ? 'Stop the server before resetting its world.' : 'Reset the entire world. Settings are kept by default.';
  }
  const hint = document.getElementById('settingsResetDataHint');
  if (hint) hint.textContent = currentState !== 'stopped' ? 'Stop the server to enable Reset Data.' : 'Reset Data creates a backup first. Settings are kept unless you choose to reset them.';
  if (pendingWorldResetProfile && (pendingWorldResetProfile !== currentProfiles?.activeProfileId || currentState !== 'stopped')) {
    pendingWorldResetProfile = '';
    document.getElementById('resetDataDialog')?.close();
  }
}

document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(button.dataset.panel).classList.add('active');
  });
});

on('sidebarCloseBtn', 'click', () => appShell.classList.add('sidebar-collapsed'));
on('sidebarOpenBtn', 'click', () => appShell.classList.remove('sidebar-collapsed'));
on('sidebarFloatingOpenBtn', 'click', () => appShell.classList.remove('sidebar-collapsed'));

on('minimizeBtn', 'click', () => window.assembly.minimizeWindow());
on('maximizeBtn', 'click', () => window.assembly.maximizeWindow());
on('closeBtn', 'click', () => window.assembly.closeWindow());
on('consoleWindowBtn', 'click', () => window.assembly.openConsole());
on('notificationsBtn', 'click', (event) => {
  event.stopPropagation();
  notificationsMenu.classList.toggle('open');
});

document.addEventListener('click', (event) => {
  if (!notificationsMenu.contains(event.target)) notificationsMenu.classList.remove('open');
  if (!document.getElementById('playerActionMenu')?.contains(event.target)) closePlayerActionMenu();
  if (!document.getElementById('profileDropdown')?.contains(event.target)) {
    document.getElementById('profileDropdown')?.classList.remove('open');
  }
});

async function copyAddressFrom(inputId, buttonId, emptyMessage, successMessage) {
  const button = document.getElementById(buttonId);
  try {
    const value = document.getElementById(inputId)?.value?.trim();
    if (!value || /unavailable|set public/i.test(value)) throw new Error(emptyMessage);
    await window.assembly.copyText(value);
    button.innerHTML = checkIcon;
    button.classList.remove('copy-failed');
    button.classList.add('copy-ok');
    showToast(successMessage);
  } catch (error) {
    button.innerHTML = xIcon;
    button.classList.remove('copy-ok');
    button.classList.add('copy-failed');
    showToast(error.message || 'Could not copy address.');
  }
  clearTimeout(button.resetTimer);
  button.resetTimer = setTimeout(() => {
    button.innerHTML = copyIcon;
    button.classList.remove('copy-ok', 'copy-failed');
  }, 1400);
}

on('copyIpBtn', 'click', async () => {
  await copyAddressFrom(
    'serverAddress',
    'copyIpBtn',
    'Map direct hosting or set a custom public join address first.',
    'Public address copied.'
  );
});

on('copyLanBtn', 'click', async () => {
  await copyAddressFrom(
    'lanAddress',
    'copyLanBtn',
    'No LAN address is available on this network.',
    'LAN address copied.'
  );
});

on('saveBtn', 'click', saveSettings);
fields.forEach((id) => {
  const input = document.getElementById(id);
  if (!input) return;
  if (id === 'lockNether' || id === 'lockEnd') {
    return;
  }
  input.addEventListener('change', scheduleAutoSave);
  if (input.type !== 'range') input.addEventListener('blur', scheduleAutoSave);
});
window.DimensionLockControls.bind(id => document.getElementById(id), () => currentStatus?.dimensionLocks, () => { dimensionLockManualDirty = true; });
on('toggleServerBtn', 'click', toggleServer);
on('refreshAnalyticsBtn', 'click', async () => {
  await refresh();
  showToast('Analytics refreshed.');
});
on('restartServerBtn', 'click', async () => {
  const missing = getMissingStartSettings();
  if (missing.length) {
    showToast(`Missing required settings: ${missing.join(', ')}`);
    return;
  }
  await run(() => window.assembly.saveConfig(collectConfig()));
  await run(() => window.assembly.restartServer(), 'Server restarting.');
  uptimeStartedAt = Date.now();
  updateRuntime();
});

on('downloadBtn', 'click', async () => {
  await run(async () => {
    const selected = document.getElementById('serverVersionSelect').value || 'latest';
    const result = await window.assembly.downloadVersion(selected);
    return result;
  }, 'Selected vanilla server downloaded.');
  await refresh();
});
on('quickDownloadJarBtn', 'click', async () => {
  await run(async () => {
    const selected = document.getElementById('serverVersionSelect').value || currentConfig?.serverVersion || 'latest';
    return window.assembly.downloadVersion(selected);
  }, 'Server jar downloaded.');
  await refresh();
});
on('javaDownloadBtn', 'click', () => window.assembly.openJavaDownload());
on('enableDirectHostingBtn', 'click', async () => {
  const status = await run(() => window.assembly.enableDirectHosting(), 'Direct hosting enabled.');
  updateDirectHostingControls(status);
  document.getElementById('directHostingEnabled').checked = true;
  if (status.publicAddress) {
    document.getElementById('publicAddress').value = status.publicAddress;
  }
  await refresh();
});
on('disableDirectHostingBtn', 'click', async () => {
  const status = await run(() => window.assembly.disableDirectHosting(), 'Direct hosting disabled.');
  updateDirectHostingControls(status);
  document.getElementById('directHostingEnabled').checked = false;
  await refresh();
});
on('openPlayitSetupBtn', 'click', () => window.assembly.openPlayitSetup());
on('downloadPlayitBtn', 'click', async () => {
  const status = await run(() => window.assembly.downloadPlayit(), 'playit agent downloaded.');
  updatePlayitControls(status);
});
on('startPlayitBtn', 'click', async () => {
  const status = await run(() => window.assembly.startPlayit(), 'playit tunnel starting. Open the console for setup output.');
  updatePlayitControls(status);
  await window.assembly.openConsole();
});
on('stopPlayitBtn', 'click', async () => {
  const status = await run(() => window.assembly.stopPlayit(), 'playit tunnel stopped.');
  updatePlayitControls(status);
});

on('selectJarBtn', 'click', async () => {
  const config = await run(() => window.assembly.selectServerJar(), 'Server jar selected.');
  if (config) hydrateConfig(config);
  await refresh();
});

on('addModsBtn', 'click', async () => {
  await run(() => window.assembly.importJars('mods'), 'Mods added.');
  await refresh();
});

on('addPluginsBtn', 'click', async () => {
  await run(() => window.assembly.importJars('plugins'), 'Plugins added.');
  await refresh();
});
on('addonsInstalledBtn', 'click', () => setAddonsView('installed'));
on('addonsBrowseBtn', 'click', () => setAddonsView('browse'));
on('installedKindMods', 'click', () => setInstalledKind('mods'));
on('installedKindPlugins', 'click', () => setInstalledKind('plugins'));
on('installedSearchInput', 'input', (event) => {
  installedSearchQuery = event.target.value || '';
  renderInstalledAddons();
});
on('addonsKindMods', 'click', () => setAddonsKind('mods'));
on('addonsKindPlugins', 'click', () => setAddonsKind('plugins'));
on('addonsSourceModrinth', 'click', () => setAddonsSource('modrinth'));
on('addonsSourceCurseForge', 'click', () => setAddonsSource('curseforge'));
on('addonsSearchInput', 'input', scheduleAddonSearch);
document.querySelector('.workspace')?.addEventListener('scroll', loadMoreAddonsIfNeeded, { passive: true });
on('serverType', 'change', async () => {
  currentConfig = await run(() => window.assembly.saveConfig(collectConfig()), 'Server type saved.');
  hydrateConfig(currentConfig, { preserveActive: true });
  updateAddonKindAvailability();
  if (addonsView === 'browse') searchAddons({ reset: true });
});
on('addModsStorageBtn', 'click', async () => {
  await run(() => window.assembly.importJars('mods'), 'Mods added.');
  await refresh();
});
on('addPluginsStorageBtn', 'click', async () => {
  await run(() => window.assembly.importJars('plugins'), 'Plugins added.');
  await refresh();
});

on('clearLogsBtn', 'click', () => run(() => window.assembly.clearLogs(), 'Logs cleared.'));
on('clearLogsStorageBtn', 'click', () => run(() => window.assembly.clearLogs(), 'Logs cleared.'));
on('wipeDataBtn', 'click', wipeData);
on('wipeDataStorageBtn', 'click', wipeData);
on('wipeDataSettingsBtn', 'click', wipeData);
on('cancelResetData', 'click', () => document.getElementById('resetDataDialog').close());
on('confirmResetData', 'click', () => document.getElementById('resetDataDialog').close('reset'));
on('openFolderBtn', 'click', () => window.assembly.openServerFolder());
on('repairConnectionBtn', 'click', async () => {
  await run(() => window.assembly.repairConnection(), 'Connection repair check completed.');
  await window.assembly.openConsole();
  await refresh();
});
on('openFolderConfigBtn', 'click', () => window.assembly.openServerFolder());
on('openFolderStorageBtn', 'click', () => window.assembly.openServerFolder());
on('openFolderStorageRowBtn', 'click', () => window.assembly.openServerFolder());
on('serverVersionSelect', 'change', async (event) => {
  const selected = event.target.value || 'latest';
  try {
    await run(() => window.assembly.downloadVersion(selected), `Minecraft ${selected} selected.`);
  } finally {
    await refresh();
  }
});
on('memoryMb', 'input', () => {
  updateMemoryLabel();
  updatePlayerLimitControls();
});
on('maxPlayers', 'input', updatePlayerLimitControls);
on('memoryMbText', 'change', (event) => setMemoryValue(event.target.value));
on('memoryMbText', 'keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    setMemoryValue(event.target.value);
    event.target.blur();
  }
});

on('worldForm', 'submit', (event) => {
  event.preventDefault();
  closeWorldModal(document.getElementById('worldNameInput').value);
});
on('cancelWorldBtn', 'click', () => closeWorldModal(''));
on('worldModal', 'mousedown', (event) => {
  if (event.target === event.currentTarget) closeWorldModal('');
});
on('cancelBanBtn', 'click', closeBanModal);
on('confirmBanBtn', 'click', confirmBan);
on('cancelTempBanBtn', 'click', closeTempBanModal);
on('confirmTempBanBtn', 'click', confirmTempBan);
on('onlinePlayersTab', 'click', () => setSessionsView('online'));
on('bannedPlayersTab', 'click', async () => {
  currentBans = await window.assembly.listBans().catch(() => currentBans);
  setSessionsView('banned');
});
on('historyPlayersTab', 'click', async () => {
  currentHistory = await window.assembly.getPlayerHistory().catch(() => currentHistory);
  setSessionsView('history');
});
on('sessionsSearch', 'input', () => {
  if (sessionsView === 'banned') {
    renderBannedPlayers();
  } else if (sessionsView === 'history') {
    renderPlayerHistory();
  } else {
    updatePlayers(currentStatus?.players || { online: 0, max: currentConfig?.maxPlayers, sample: [] });
  }
});
on('banMessage', 'keydown', (event) => {
  if (event.key === 'Enter') confirmBan();
  if (event.key === 'Escape') closeBanModal();
});
on('worldNameInput', 'keydown', (event) => {
  if (event.key === 'Enter') closeWorldModal(event.target.value);
  if (event.key === 'Escape') closeWorldModal('');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeCustomSelects();
    closePlayerActionMenu();
    closeBanModal();
    closeTempBanModal();
  }
});
document.addEventListener('click', () => closeCustomSelects());
on('profileDropdownBtn', 'click', (event) => {
  event.stopPropagation();
  const dropdown = document.getElementById('profileDropdown');
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) {
    setTimeout(() => document.getElementById('profileSearch')?.focus(), 40);
  }
});
on('profileSearch', 'input', renderProfiles);
on('profileSearch', 'click', (event) => event.stopPropagation());
on('profileAddBtn', 'click', async (event) => {
  event.stopPropagation();
  document.getElementById('profileDropdown').classList.remove('open');
  await createWorldProfile();
});

on('settingsSearch', 'input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  document.querySelectorAll('.settings-category').forEach((category) => {
    const rows = Array.from(category.querySelectorAll('.setting-row'));
    const categoryText = `${category.dataset.search || ''} ${category.querySelector('h2')?.textContent || ''}`.toLowerCase();
    let visibleRows = 0;
    for (const row of rows) {
      const haystack = `${categoryText} ${row.textContent || ''}`.toLowerCase();
      const match = !terms.length || terms.every((term) => haystack.includes(term));
      row.classList.toggle('hidden', !match);
      if (match) visibleRows += 1;
    }
    const categoryMatch = !terms.length || terms.every((term) => categoryText.includes(term));
    category.classList.toggle('hidden', terms.length > 0 && !categoryMatch && visibleRows === 0);
  });
});

let hostnameCheckTimer = null;

function setHostnameStatus(result) {
  const status = document.getElementById('hostnameStatus');
  const tooltip = document.getElementById('hostnameTooltip');
  if (!status || !tooltip) return;
  status.classList.toggle('hidden', result.available);
  tooltip.textContent = result.message || 'This IP is already in use.';
}

async function validateCustomHostname() {
  const input = document.getElementById('customHostname');
  if (!input) return { available: true };
  const result = await window.assembly.checkHostname(input.value);
  setHostnameStatus(result);
  return result;
}

on('customHostname', 'input', () => {
  clearTimeout(hostnameCheckTimer);
  hostnameCheckTimer = setTimeout(async () => {
    try {
      await validateCustomHostname();
      updateDashboard(collectConfig());
    } catch (error) {
      setHostnameStatus({ available: false, message: error.message || 'Could not check this address right now.' });
    }
  }, 450);
});

window.assembly.onState((state) => {
  if (state === 'running' && !uptimeStartedAt) uptimeStartedAt = Date.now();
  if (state === 'stopped') {
    uptimeStartedAt = null;
    recentOnlinePlayers.clear();
  }
  setState(state);
});
window.assembly.onPlayers((players) => {
  if (currentStatus) currentStatus.players = players;
  updatePlayers(players);
  updateAnalytics({ ...(currentStatus || {}), players });
});
window.assembly.onBans((bans) => {
  currentBans = Array.isArray(bans) ? bans : [];
  if (sessionsView === 'banned') renderBannedPlayers();
});
window.assembly.onHistory((history) => {
  currentHistory = Array.isArray(history) ? history : [];
  if (sessionsView === 'history') renderPlayerHistory();
});
window.assembly.onLog(handleServerLogLine);
window.assembly.onDownloadProgress(({ received, total }) => {
  if (!total) return;
  showToast(`Downloading server jar: ${Math.round((received / total) * 100)}%`);
});

async function init() {
  renderNotifications();
  initTooltips();
  enhanceNumberInputs();
  enhanceSelects();
  await refresh();
  window.assembly.getConsoleLog().then(handleServerLogLine).catch(() => {});
  await loadVersions();
  enhanceSelects();
  restartUptimeTimer();
  restartStatusTimer();
}

init();

function initTooltips() {
  const tooltip = document.getElementById('uiTooltip');
  if (!tooltip) return;
  let active = null;
  const show = (target) => {
    const label = target?.dataset?.tooltip;
    if (!label) return;
    active = target;
    tooltip.textContent = label;
    const rect = target.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 8}px`;
    tooltip.classList.add('visible');
    const tooltipRect = tooltip.getBoundingClientRect();
    const edgePadding = 10;
    const centeredLeft = rect.left + rect.width / 2;
    const minLeft = edgePadding + tooltipRect.width / 2;
    const maxLeft = window.innerWidth - edgePadding - tooltipRect.width / 2;
    tooltip.style.left = `${Math.min(maxLeft, Math.max(minLeft, centeredLeft))}px`;
  };
  const hide = () => {
    active = null;
    tooltip.classList.remove('visible');
  };
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tooltip]');
    if (target) show(target);
  });
  document.addEventListener('mouseout', (event) => {
    if (active && event.target.closest('[data-tooltip]') === active) hide();
  });
  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tooltip]');
    if (target) show(target);
  });
  document.addEventListener('focusout', hide);
}
