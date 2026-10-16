(function () {
  if (window.assembly) return;

  const defaultIcon = 'assets/minecraft-default-world.png';
  const callbacks = {
    state: [],
    players: [],
    bans: [],
    history: [],
    log: [],
    clearLog: [],
    downloadProgress: []
  };

  const config = {
    uiMode: 'revamped',
    jarPath: 'mock-server.jar',
    serverVersion: '1.21.11',
    serverType: 'vanilla',
    javaPath: 'C:\\Program Files\\Java\\jdk-25\\bin\\java.exe',
    memoryMb: 4096,
    port: 25565,
    bindIp: '',
    customHostname: '',
    publicAddress: '5.107.125.182:25565',
    directHostingEnabled: true,
    levelName: 'Survival World',
    seed: '8675309',
    motd: 'Private Minecraft Server',
    maxPlayers: 20,
    onlineMode: true,
    pvp: true,
    playerLocatorBar: false,
    difficulty: 'normal',
    gamemode: 'survival',
    acceptEula: true,
    allowFlight: false,
    allowCheats: false,
    whiteList: false,
    hardcore: false,
    forceGamemode: false,
    allowNether: true,
    generateStructures: true,
    spawnAnimals: true,
    spawnMonsters: true,
    spawnNpcs: true,
    spawnProtection: 16,
    doInsomnia: true,
    mobGriefing: true,
    doFireTick: false,
    keepInventory: false,
    doImmediateRespawn: false,
    showDeathMessages: true,
    announceAdvancements: true,
    doTraderSpawning: true,
    doPatrolSpawning: true,
    playersSleepingPercentage: 50,
    spawnRadius: 8,
    randomTickSpeed: 3,
    viewDistance: 10,
    simulationDistance: 10
  };

  let state = 'running';
  let activeProfileId = 'default';
  let consoleLog = '[Server Manager Preview] Mock UI loaded. Backend actions are simulated.\n';
  const profiles = [
    { id: 'default', name: 'Survival World', levelName: 'Survival World', iconDataUrl: '' },
    { id: 'creative', name: 'Creative Build', levelName: 'Creative Build', iconDataUrl: '' },
    { id: 'smp', name: 'SMP Night', levelName: 'SMP Night', iconDataUrl: '' },
    { id: 'redstone', name: 'Redstone Lab', levelName: 'Redstone Lab', iconDataUrl: '' }
  ];
  const mods = [
    { name: 'lithium-preview.jar', size: 842132, modifiedAt: Date.now() - 86400000 },
    { name: 'voice-chat-preview.jar', size: 1642132, modifiedAt: Date.now() - 3600000 }
  ];
  const plugins = [
    { name: 'luckperms-preview.jar', size: 2984412, modifiedAt: Date.now() - 172800000 }
  ];
  const bans = [
    { name: 'GrieferKid', reason: '', permanent: true }
  ];
  const history = [
    { name: 'ExamplePlayer', lastActive: new Date().toISOString(), lastEvent: 'joined' },
    { name: 'BuilderOne', lastActive: new Date(Date.now() - 7200000).toISOString(), lastEvent: 'left' }
  ];
  function mapModrinthHit(hit) {
    return {
      source: 'modrinth',
      id: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      author: hit.author,
      description: hit.description,
      iconUrl: hit.icon_url || defaultIcon,
      downloads: hit.downloads || 0,
      follows: hit.follows || 0,
      categories: hit.categories || [],
      loaders: hit.display_categories || [],
      versions: hit.versions || [],
      serverSide: hit.server_side || '',
      clientSide: hit.client_side || '',
      updatedAt: hit.date_modified || ''
    };
  }

  function normalizeServerType(serverType) {
    const value = String(serverType || 'vanilla').toLowerCase();
    return ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur', 'spigot'].includes(value) ? value : 'vanilla';
  }

  function getServerTypeAddonSupport(serverType) {
    const type = normalizeServerType(serverType);
    if (type === 'vanilla') return { type, mods: [], plugins: [] };
    if (['paper', 'purpur', 'spigot'].includes(type)) return { type, mods: [], plugins: [type, 'bukkit'] };
    return { type, mods: [type], plugins: [] };
  }

  function mapCurseForgeHit(mod) {
    return {
      source: 'curseforge',
      id: String(mod.id),
      slug: mod.slug || String(mod.id),
      title: mod.name,
      author: mod.authors?.map((author) => author.name).join(', ') || 'CurseForge',
      description: mod.summary || '',
      iconUrl: mod.logo?.thumbnailUrl || mod.logo?.url || defaultIcon,
      downloads: mod.downloadCount || 0,
      follows: 0,
      categories: mod.categories?.map((category) => category.name).filter(Boolean) || [],
      loaders: mod.latestFilesIndexes?.map((file) => file.modLoader).filter(Boolean).slice(0, 8) || [],
      versions: mod.latestFilesIndexes?.map((file) => file.gameVersion).filter(Boolean).slice(0, 12) || [],
      serverSide: '',
      clientSide: '',
      updatedAt: mod.dateModified || ''
    };
  }

  async function fetchModrinthSearch({ kind = 'mods', query = '', limit = 24, offset = 0, serverType = 'vanilla' } = {}) {
    const support = getServerTypeAddonSupport(serverType);
    const loaders = kind === 'plugins' ? support.plugins : support.mods;
    const facets = [[`project_type:${kind === 'plugins' ? 'plugin' : 'mod'}`]];
    if (!loaders.length) {
      return {
        offset,
        total: 0,
        message: support.type === 'vanilla'
          ? 'Vanilla servers do not load mods or plugins. Pick a loader in Config.'
          : `No ${kind} are compatible with ${support.type}.`,
        results: []
      };
    }
    facets.push(loaders.map((loader) => `categories:${loader}`));
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      offset: String(offset),
      index: 'relevance',
      facets: JSON.stringify(facets)
    });
    const response = await fetch(`https://api.modrinth.com/v2/search?${params}`);
    if (!response.ok) throw new Error(`Modrinth search failed with HTTP ${response.status}`);
    const data = await response.json();
    return {
      offset: data.offset || offset,
      total: data.total_hits || 0,
      results: (data.hits || []).map(mapModrinthHit)
    };
  }

  async function fetchModrinthDetails(addon) {
    const id = addon.id || addon.slug;
    const response = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Modrinth project failed with HTTP ${response.status}`);
    const project = await response.json();
    return {
      source: 'modrinth',
      id: project.id,
      slug: project.slug,
      title: project.title,
      author: addon.author || 'Modrinth',
      description: project.description,
      body: project.body || project.description || '',
      iconUrl: project.icon_url || defaultIcon,
      downloads: project.downloads || 0,
      follows: project.followers || 0,
      categories: project.categories || [],
      loaders: project.loaders || [],
      versions: project.game_versions || [],
      serverSide: project.server_side || '',
      clientSide: project.client_side || '',
      updatedAt: project.updated || ''
    };
  }

  async function readJsonResponse(response, label) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `${label} failed with HTTP ${response.status}` };
    }
    if (!response.ok) throw new Error(data.error || data.message || `${label} failed with HTTP ${response.status}`);
    return data;
  }

  async function fetchCurseForgeSearch({ kind = 'mods', query = '', limit = 24, offset = 0, serverType = 'vanilla' } = {}) {
    const support = getServerTypeAddonSupport(serverType);
    const loaders = kind === 'plugins' ? support.plugins : support.mods;
    if (!loaders.length) {
      return {
        offset,
        total: 0,
        message: support.type === 'vanilla'
          ? 'Vanilla servers do not load mods or plugins. Pick a loader in Config.'
          : `No ${kind} are compatible with ${support.type}.`,
        results: []
      };
    }
    const params = new URLSearchParams({
      gameId: '432',
      pageSize: String(limit),
      index: String(offset),
      sortField: '2',
      sortOrder: 'desc',
      classId: kind === 'plugins' ? '5' : '6'
    });
    if (query) params.set('searchFilter', query);
    const response = await fetch(`/api/curseforge/mods/search?${params}`);
    const data = await readJsonResponse(response, 'CurseForge search');
    return {
      offset,
      total: data.pagination?.totalCount || 0,
      results: (data.data || []).map(mapCurseForgeHit)
    };
  }

  async function fetchCurseForgeDetails(addon) {
    const response = await fetch(`/api/curseforge/mods/${encodeURIComponent(addon.id)}`);
    const data = await readJsonResponse(response, 'CurseForge project');
    const mapped = mapCurseForgeHit(data.data || {});
    return {
      ...mapped,
      body: mapped.description || 'No project description provided.'
    };
  }

  function emit(name, value) {
    for (const callback of callbacks[name] || []) callback(value);
  }

  function status() {
    return {
      state,
      paths: { root: 'D:\\Minecraft Servers\\browser-preview' },
      profiles: {
        activeProfileId,
        profiles: profiles.map((profile) => ({
          ...profile,
          iconDataUrl: profile.iconDataUrl || defaultIcon
        }))
      },
      config,
      jarExists: true,
      java: { available: true, version: 'openjdk version "25"', major: 25, path: config.javaPath },
      uptimeStartedAt: Date.now() - 1000 * 60 * 43,
      network: {
        lanIps: ['100.94.143.137'],
        totalMemoryMb: 16384,
        stablePlayerLimit: 16
      },
      players: {
        online: 3,
        max: config.maxPlayers,
        sample: [
          { name: 'ExamplePlayer' },
          { name: 'BuilderOne' },
          { name: 'Steve' }
        ]
      },
      joinDiagnostics: {
        ok: true,
        loopbackLikelyBlocked: true,
        code: 'ASM-NET-203'
      },
      worldIconDataUrl: defaultIcon,
      performance: {
        pid: 4242,
        cpuPercent: 18,
        memoryUsedMb: 1830,
        memoryAllocatedMb: config.memoryMb,
        systemFreeMemoryMb: 9216,
        systemTotalMemoryMb: 16384,
        diskBytes: 1024 * 1024 * 876,
        incomingBytesPerSec: 9234,
        outgoingBytesPerSec: 14832,
        pingOk: true,
        responding: true,
        health: 'Stable'
      },
      recentEvents: [],
      bans,
      playerHistory: history,
      playit: { installed: true, running: false, address: '', setupUrl: '', lastMessage: 'Idle' },
      directHosting: { mapped: true, publicAddress: config.publicAddress, message: 'Mapped.' },
      mods,
      plugins
    };
  }

  async function fakeAction(message, result) {
    consoleLog += `[Server Manager Preview] ${message}\n`;
    emit('log', `[Server Manager Preview] ${message}\n`);
    return result;
  }

  window.assembly = {
    getStatus: async () => status(),
    saveConfig: async (next) => {
      Object.assign(config, next || {});
      return fakeAction('Saved mock settings.', config);
    },
    setUiMode: async () => 'revamped',
    downloadVanilla: async () => fakeAction('Pretended to download vanilla server.', { version: config.serverVersion }),
    downloadVersion: async (versionId) => {
      config.serverVersion = versionId || 'latest';
      return fakeAction(`Selected Minecraft ${config.serverVersion}.`, { version: config.serverVersion });
    },
    listVersions: async () => ({
      latest: { release: '1.21.11', snapshot: '26.1.2' },
      versions: [
        { id: '1.21.11', type: 'release' },
        { id: '1.21.10', type: 'release' },
        { id: '26.1.2', type: 'snapshot' }
      ]
    }),
    checkHostname: async (hostname) => ({ available: Boolean(hostname), message: hostname ? 'Looks ready in preview.' : 'Enter a hostname.' }),
    selectServerJar: async () => fakeAction('Pretended to select a custom jar.', config),
    startServer: async () => {
      state = 'running';
      emit('state', state);
      return fakeAction('Server start simulated.', true);
    },
    stopServer: async () => {
      state = 'stopped';
      emit('state', state);
      return fakeAction('Server stop simulated.', true);
    },
    restartServer: async () => fakeAction('Server restart simulated.', true),
    sendCommand: async (command) => fakeAction(`Command sent: ${command}`, true),
    banPlayer: async (name, reason) => {
      bans.push({ name, reason, permanent: true });
      emit('bans', bans);
      return fakeAction(`${name} banned.`, bans);
    },
    tempBanPlayer: async (name) => fakeAction(`${name} temp-ban simulated.`, bans),
    pardonPlayer: async (name) => {
      const index = bans.findIndex((ban) => ban.name === name);
      if (index >= 0) bans.splice(index, 1);
      emit('bans', bans);
      return fakeAction(`${name} unbanned.`, bans);
    },
    shortenBan: async () => bans,
    listBans: async () => bans,
    getPlayerHistory: async () => history,
    runAssemblyCommand: async (command) => fakeAction(`Server command: ${command}`, `[Preview] ${command}`),
    importJars: async (kind) => fakeAction(`Import ${kind} simulated.`, kind === 'mods' ? mods : plugins),
    deleteJar: async () => fakeAction('Delete jar simulated.', true),
    searchAddons: async ({ kind = 'mods', source = 'modrinth', query = '', limit = 24, offset = 0, serverType = config.serverType } = {}) => {
      if (source === 'curseforge') {
        const page = await fetchCurseForgeSearch({ kind, query, limit, offset, serverType });
        return { source, kind, needsKey: false, limit, ...page };
      }
      const page = await fetchModrinthSearch({ kind, source, query, limit, offset, serverType });
      return { source, kind, needsKey: false, limit, ...page };
    },
    getAddonDetails: async (addon) => addon.source === 'curseforge' ? fetchCurseForgeDetails(addon) : fetchModrinthDetails(addon),
    installAddon: async (addon) => {
      const target = addon.kind === 'plugins' ? plugins : mods;
      target.push({ name: `${addon.slug || addon.id || 'addon'}-preview.jar`, size: 1024 * 512, modifiedAt: Date.now() });
      return fakeAction(`Installed ${addon.title || addon.id} preview addon.`, { installed: addon.title, files: target });
    },
    clearLogs: async () => {
      consoleLog = '';
      emit('clearLog');
      return true;
    },
    wipeData: async () => fakeAction('Wipe data simulated.', true),
    openServerFolder: async () => fakeAction('Open folder simulated.', true),
    openJavaDownload: async () => fakeAction('Open Java download simulated.', true),
    openPlayitSetup: async () => fakeAction('Open playit setup simulated.', true),
    openPlayitDownload: async () => fakeAction('Open playit download simulated.', true),
    downloadPlayit: async () => fakeAction('Download playit simulated.', status().playit),
    startPlayit: async () => fakeAction('Start playit simulated.', { ...status().playit, running: true }),
    stopPlayit: async () => fakeAction('Stop playit simulated.', { ...status().playit, running: false }),
    enableDirectHosting: async () => fakeAction('Direct hosting enabled in preview.', status().directHosting),
    disableDirectHosting: async () => fakeAction('Direct hosting disabled in preview.', { mapped: false, publicAddress: '', message: 'Not mapped.' }),
    getDirectHostingStatus: async () => status().directHosting,
    repairConnection: async () => fakeAction('Connection repair simulated.', true),
    createProfile: async (name) => {
      const id = String(name || `world-${profiles.length + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      profiles.push({ id, name, levelName: name, iconDataUrl: '' });
      activeProfileId = id;
      config.levelName = name;
      return fakeAction(`Created mock world ${name}.`, status());
    },
    switchProfile: async (profileId) => {
      activeProfileId = profileId;
      const profile = profiles.find((item) => item.id === profileId);
      if (profile) config.levelName = profile.levelName || profile.name;
      return fakeAction(`Switched to ${profile?.name || profileId}.`, status());
    },
    deleteProfile: async (profileId) => {
      const index = profiles.findIndex((item) => item.id === profileId);
      if (index > 0) profiles.splice(index, 1);
      if (activeProfileId === profileId) activeProfileId = profiles[0].id;
      return fakeAction('Deleted mock world.', status());
    },
    openConsole: async () => fakeAction('Console open simulated.', true),
    getConsoleLog: async () => consoleLog,
    copyText: async (text) => navigator.clipboard?.writeText?.(String(text || '')).catch(() => {}),
    minimizeWindow: () => fakeAction('Minimize ignored in browser.', true),
    maximizeWindow: () => fakeAction('Maximize ignored in browser.', true),
    closeWindow: () => fakeAction('Close ignored in browser.', true),
    onLog: (callback) => callbacks.log.push(callback),
    onPlayers: (callback) => callbacks.players.push(callback),
    onBans: (callback) => callbacks.bans.push(callback),
    onHistory: (callback) => callbacks.history.push(callback),
    onState: (callback) => callbacks.state.push(callback),
    onClearLog: (callback) => callbacks.clearLog.push(callback),
    onDownloadProgress: (callback) => callbacks.downloadProgress.push(callback)
  };
})();
