(() => {
  const api = window.bridge?.minecraftServer;
  if (!api) return;
  const $ = id => document.getElementById(id);
  let status = null;
  let refreshPending = null;
  let refreshRequestGeneration = 0;
  let serverStateEventVersion = 0;
  let latestServerState = '';
  let playersView = 'online';
  let playerAccess = { assignments: [], roles: [], commandGroups: {}, capabilityDefinitions: {}, minecraftColors: [], loaded: false };
  let playerAccessLoading = false;
  let playerAccessError = '';
  let pendingAccessDraft = null;
  let refreshTimer = null;
  let playerSnapshotTimer = null;
  let playerSnapshotPending = null;
  let playerSnapshotRequestGeneration = 0;
  const PLAYER_SNAPSHOT_TIMEOUT_MS = 4500;
  const PLAYER_SNAPSHOT_POLL_MS = 5000;
  const PLAYER_STREAM_KINDS = Object.freeze(['players', 'bans', 'history', 'historyEvents']);
  const INVALID_PLAYER_STREAM_VALUE = Symbol('invalid-player-stream-value');
  const playerStreams = createPlayerStreamState();
  let addonMode = 'installed';
  let addonResults = [];
  let addonResultTotal = 0;
  let addonNextOffset = 0;
  let addonHasMore = false;
  let addonLoading = false;
  let addonSearchToken = 0;
  let addonSearchTimer = null;
  let addonKindInitialized = false;
  let addonBrowseRenderSignature = '';
  let installedAddonRenderSignature = '';
  const installedAddonUpdates = new Map();
  const installedAddonUpdateQueue = [];
  let installedAddonUpdateActive = 0;
  let installedAddonUpdateGeneration = 0;
  const INSTALLED_ADDON_UPDATE_TTL_MS = 60_000;
  const INSTALLED_ADDON_UPDATE_CONCURRENCY = 4;
  let modPolicy = { allowedMods: [], blockedMods: [], playerExceptions: [] };
  let modPolicyLoading = false;
  let setupDisclosureInitialized = false;
  let settingsDirty = false;
  let dimensionLockDraft = null;
  let pendingDataReset = null;
  let serverDataResetBusy = false;
  let dataResetSequence = 0;
  let securityStatus = null;
  let platformStatus = null;
  let securityLoading = false;
  let securityRequestToken = 0;
  let protectionConfig = null;
  let protectionHistory = [];
  let protectionHistoryLoading = false;
  let protectionHistoryLoadedAt = 0;
  let customAntiCheats = [];
  let protectionView = 'checks';
  let protectionMessageSelection = 'check:reach';
  let protectionSaveTimer = null;
  let protectionSaveToken = 0;
  let pendingTempBan = null;
  let pendingPlayerModException = null;
  let playerSkinGeneration = 0;
  const playerSkinRequests = new Map();
  const playerBustCanvases = new Map();
  const playerSkinRetryAfter = new Map();
  const playerSkinTaskQueue = [];
  let playerSkinActiveTasks = 0;
  let playerSkinRetryTimer = null;
  const PLAYER_BUST_WIDTH = 32;
  const PLAYER_BUST_HEIGHT = 40;
  const PLAYER_BUST_PIXEL_SCALE = 2;
  const PLAYER_BUST_CACHE_LIMIT = 256;
  const PLAYER_BUST_UUID_TTL_MS = 24 * 60 * 60 * 1000;
  const PLAYER_BUST_NAME_TTL_MS = 5 * 60 * 1000;
  const PLAYER_SKIN_RETRY_MS = 65 * 1000;
  const PLAYER_SKIN_MAX_CONCURRENCY = 4;
  const PLAYER_SKIN_PENDING_LIMIT = 128;
  const playerFigureLoaders = new WeakMap();
  const playerBustObserver = typeof window.IntersectionObserver === 'function'
    ? new window.IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          playerBustObserver.unobserve(entry.target);
          const load = playerFigureLoaders.get(entry.target);
          playerFigureLoaders.delete(entry.target);
          load?.();
        }
      }, { rootMargin: '240px' })
    : null;
  const installedAddonKeys = new Set();
  const EMPTY_REASON_SENTINEL = '\u200b';
  const compatibilityCheckIds = {
    speed: 'movement.speed', flight: 'movement.flight', phase: 'movement.phase', invalidPosition: 'movement.invalidPosition', invalidRotation: 'movement.invalidRotation', groundSpoof: 'movement.groundSpoof', waterWalk: 'movement.waterWalk', step: 'movement.step', timer: 'movement.timer', noSlow: 'movement.noSlow',
    reach: 'combat.reach', wallHit: 'combat.wallHit', autoClicker: 'combat.autoClicker', multiTarget: 'combat.multiTarget',
    aimDirection: 'combat.aimDirection', killAura: 'combat.killAura', clickPattern: 'combat.clickPattern', criticals: 'combat.criticals',
    fastBreak: 'world.fastBreak', fastPlace: 'world.fastPlace', breakReach: 'world.breakReach', placeReach: 'world.placeReach', scaffold: 'world.scaffold', multiBreak: 'world.multiBreak', chatSpam: 'abuse.chatSpam',
    commandSpam: 'abuse.commandSpam', inventorySpam: 'abuse.inventorySpam'
  };
  const knownCompatibilityChecks = {
    'mouse-tweaks': ['abuse.inventorySpam'],
    mousetweaks: ['abuse.inventorySpam'],
    'quick-inventory': ['abuse.inventorySpam'],
    quickinventory: ['abuse.inventorySpam'],
    'click-interval': ['combat.autoClicker','combat.clickPattern'],
    clickinterval: ['combat.autoClicker','combat.clickPattern'],
    'click-interval-auto-clicker': ['combat.autoClicker','combat.clickPattern']
  };

  function createPlayerStreamState() {
    return Object.fromEntries(PLAYER_STREAM_KINDS.map(kind => [kind, { version: 0, hasValue: false, value: undefined }]));
  }

  function normalizePlayerStreamValue(kind, value) {
    if (kind === 'players') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID_PLAYER_STREAM_VALUE;
      return { ...value, sample: Array.isArray(value.sample) ? value.sample.slice() : [] };
    }
    if (!Array.isArray(value)) return INVALID_PLAYER_STREAM_VALUE;
    return value.slice();
  }

  function capturePlayerStreamVersions(streams = playerStreams) {
    return Object.fromEntries(PLAYER_STREAM_KINDS.map(kind => [kind, streams[kind].version]));
  }

  function rememberPlayerStream(streams, kind, value) {
    const stream = streams[kind];
    if (!stream) return false;
    const normalized = normalizePlayerStreamValue(kind, value);
    if (normalized === INVALID_PLAYER_STREAM_VALUE) return false;
    stream.version += 1;
    stream.hasValue = true;
    stream.value = normalized;
    return true;
  }

  function readPlayerStreamValue(source, kind) {
    if (!source || typeof source !== 'object') return { found: false, value: undefined };
    const keys = {
      players: ['players'],
      bans: ['bans'],
      history: ['history', 'playerHistory'],
      historyEvents: ['historyEvents', 'playerEvents', 'playerHistoryEvents']
    }[kind] || [];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return { found: true, value: source[key] };
    }
    return { found: false, value: undefined };
  }

  function writePlayerStreamValue(target, kind, value) {
    if (!target || typeof target !== 'object') return;
    if (kind === 'players') target.players = value;
    else if (kind === 'bans') target.bans = value;
    else if (kind === 'history') target.playerHistory = value;
    else if (kind === 'historyEvents') {
      target.playerEvents = value;
      target.playerHistoryEvents = value;
    }
  }

  function reconcilePlayerStreams(target, source, streams, requestVersions, preferBuffered = false) {
    for (const kind of PLAYER_STREAM_KINDS) {
      const stream = streams[kind];
      const changedSinceRequest = stream.version !== Number(requestVersions?.[kind] ?? stream.version);
      if ((preferBuffered || changedSinceRequest) && stream.hasValue) {
        writePlayerStreamValue(target, kind, stream.value);
        continue;
      }
      const incoming = readPlayerStreamValue(source, kind);
      if (!incoming.found || !rememberPlayerStream(streams, kind, incoming.value)) continue;
      writePlayerStreamValue(target, kind, stream.value);
    }
    return target;
  }

  function settleWithTimeout(value, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, Math.max(1, Number(timeoutMs) || 1));
      Promise.resolve(value).then(
        result => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        },
        error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  const protectionCheckGroups = {
    movement: ['speed','flight','phase','invalidPosition','invalidRotation','groundSpoof','waterWalk','step','timer','noSlow'],
    reach: ['reach','wallHit'],
    combat: ['autoClicker','multiTarget','aimDirection','killAura','clickPattern','criticals'],
    world: ['fastBreak','fastPlace','breakReach','placeReach','scaffold','multiBreak'],
    abuse: ['chatSpam','commandSpam','inventorySpam']
  };
  const protectionCheckKeys = Object.values(protectionCheckGroups).flat();
  const compatibilityDisabledChecks = new Set(['phase','groundSpoof','waterWalk','step','timer','noSlow','aimDirection','killAura','clickPattern','criticals','fastBreak','fastPlace','scaffold','multiBreak','inventorySpam']);
  const compatibilityChecks = Object.fromEntries(protectionCheckKeys.map(key => [key, !compatibilityDisabledChecks.has(key)]));
  const balancedDisabledChecks = new Set(['phase','noSlow','aimDirection','killAura','criticals','scaffold','multiBreak']);
  const balancedChecks = Object.fromEntries(protectionCheckKeys.map(key => [key, !balancedDisabledChecks.has(key)]));
  const strictChecks = Object.fromEntries(protectionCheckKeys.map(key => [key, true]));
  const fallbackProtectionChecksByType = Object.freeze({
    paper: Object.freeze(protectionCheckKeys),
    purpur: Object.freeze(protectionCheckKeys),
    spigot: Object.freeze(protectionCheckKeys),
    fabric: Object.freeze(protectionCheckKeys)
  });
  const protectionMessageDefaults = {
    warning: { text: '{reason}. Please stop.', color: '#ffff55' },
    alert: { text: 'Suspicious activity detected: {reason}.', color: '#ff5555' },
    kick: { text: 'Removed for suspicious activity: {reason}.', color: '#ff5555' },
    temporaryBan: { text: 'Temporarily banned for suspicious activity: {reason} ({duration_minutes}m).', color: '#aa0000' },
    permanentBan: { text: 'Banned for suspicious activity: {reason}.', color: '#aa0000' },
    loginTemporaryBan: { text: 'Temporarily banned ({remaining_minutes}m remaining).', color: '#ff5555' },
    loginPermanentBan: { text: 'You are banned from this server.', color: '#ff5555' },
    modPolicyKick: { text: 'Client mod policy: {reason}.', color: '#ff5555' }
  };
  const minecraftColorHex = {
    none: '#ffffff', black: '#000000', dark_blue: '#0000aa', dark_green: '#00aa00', dark_aqua: '#00aaaa',
    dark_red: '#aa0000', dark_purple: '#aa00aa', gold: '#ffaa00', gray: '#aaaaaa', grey: '#aaaaaa',
    dark_gray: '#555555', dark_grey: '#555555', blue: '#5555ff', green: '#55ff55', aqua: '#55ffff',
    red: '#ff5555', light_purple: '#ff55ff', yellow: '#ffff55', white: '#ffffff'
  };
  const balancedTuning = {
    minimumTps: 18,
    grace: { joinSeconds: 4, teleportSeconds: 3, velocitySeconds: 2 },
    response: { alertVl: 8, kickVl: 16, actionCooldownSeconds: 8, violationDecay: 0.12 },
    reach: { geometryAllowance: 0.05, maxPingAllowance: 0.25, pingAllowancePerMs: 0.0008, maxTickAllowance: 0.1, tickAllowancePerMissingTps: 0.05, maxTargetRewind: 0.45, baseRewindTicks: 0.5, pingRewindTicksPerMs: 0.01, maxRewindTicks: 3, immediateExcess: 0.75, consecutiveSamples: 2, evidenceWindowMillis: 1250 },
    limits: { maxGroundBlocksPerTick: 0.78, maxAirBlocksPerTick: 0.92, maxAirTicks: 80, phaseSamples: 3, groundSpoofSamples: 5, waterWalkSamples: 7, stepSamples: 2, maxUseItemBlocksPerTick: 0.20, noSlowSamples: 7, maxPacketsPerSecond: 28, timerEvidenceWindows: 3, maxReach: 3.45, maxCps: 20, wallHitSamples: 6, multiTargetCount: 4, multiTargetWindowMillis: 650, maxAimDeviationDegrees: 55, aimEvidenceSamples: 4, aimEvidenceWindowMillis: 1500, rapidSwitchMillis: 90, rapidSwitchAngleDegrees: 110, rapidSwitchSamples: 3, rapidSwitchEvidenceWindowMillis: 1200, clickPatternSamples: 16, clickPatternMaxDeviationMillis: 1.5, criticalSamples: 3, criticalWindowMillis: 2500, blockReachAllowance: 0.75, maxBreaksPerSecond: 18, maxPlacesPerSecond: 16, scaffoldAimDegrees: 80, scaffoldSamples: 4, scaffoldWindowMillis: 2000, multiBreakSamples: 6, multiBreakWindowMillis: 300, multiBreakMinSpan: 3.5, maxChatPerFiveSeconds: 6, maxCommandsPerFiveSeconds: 10, maxInventoryClicksPerSecond: 35, inventoryEvidenceSamples: 3, inventorySampleIntervalMillis: 250, inventoryEvidenceWindowMillis: 1500, maxInventoryBurstPacketsPerSecond: 120, inventoryViolationCooldownMillis: 3000 }
  };
  const strictTuning = {
    minimumTps: 18,
    grace: { joinSeconds: 3, teleportSeconds: 2, velocitySeconds: 2 },
    response: { alertVl: 5, kickVl: 11, actionCooldownSeconds: 6, violationDecay: 0.08 },
    reach: { geometryAllowance: 0.04, maxPingAllowance: 0.2, pingAllowancePerMs: 0.0007, maxTickAllowance: 0.08, tickAllowancePerMissingTps: 0.04, maxTargetRewind: 0.4, baseRewindTicks: 0.5, pingRewindTicksPerMs: 0.009, maxRewindTicks: 2.5, immediateExcess: 0.7, consecutiveSamples: 2, evidenceWindowMillis: 1100 },
    limits: { maxGroundBlocksPerTick: 0.7, maxAirBlocksPerTick: 0.82, maxAirTicks: 65, phaseSamples: 3, groundSpoofSamples: 4, waterWalkSamples: 5, stepSamples: 2, maxUseItemBlocksPerTick: 0.17, noSlowSamples: 5, maxPacketsPerSecond: 25, timerEvidenceWindows: 2, maxReach: 3.25, maxCps: 18, wallHitSamples: 6, multiTargetCount: 4, multiTargetWindowMillis: 750, maxAimDeviationDegrees: 42, aimEvidenceSamples: 3, aimEvidenceWindowMillis: 1200, rapidSwitchMillis: 130, rapidSwitchAngleDegrees: 85, rapidSwitchSamples: 2, rapidSwitchEvidenceWindowMillis: 1000, clickPatternSamples: 12, clickPatternMaxDeviationMillis: 3, criticalSamples: 2, criticalWindowMillis: 2000, blockReachAllowance: 0.5, maxBreaksPerSecond: 14, maxPlacesPerSecond: 13, scaffoldAimDegrees: 70, scaffoldSamples: 3, scaffoldWindowMillis: 1600, multiBreakSamples: 5, multiBreakWindowMillis: 250, multiBreakMinSpan: 3, maxChatPerFiveSeconds: 5, maxCommandsPerFiveSeconds: 8, maxInventoryClicksPerSecond: 28, inventoryEvidenceSamples: 3, inventorySampleIntervalMillis: 200, inventoryEvidenceWindowMillis: 1200, maxInventoryBurstPacketsPerSecond: 100, inventoryViolationCooldownMillis: 2500 }
  };
  const compatibilityTuning = {
    minimumTps: 17,
    grace: { joinSeconds: 6, teleportSeconds: 5, velocitySeconds: 3 },
    response: { alertVl: 12, kickVl: 24, actionCooldownSeconds: 12, violationDecay: 0.18 },
    reach: { geometryAllowance: 0.08, maxPingAllowance: 0.35, pingAllowancePerMs: 0.001, maxTickAllowance: 0.15, tickAllowancePerMissingTps: 0.07, maxTargetRewind: 0.6, baseRewindTicks: 0.75, pingRewindTicksPerMs: 0.012, maxRewindTicks: 4, immediateExcess: 1.1, consecutiveSamples: 3, evidenceWindowMillis: 1800 },
    limits: { maxGroundBlocksPerTick: 0.95, maxAirBlocksPerTick: 1.1, maxAirTicks: 110, phaseSamples: 5, groundSpoofSamples: 7, waterWalkSamples: 10, stepSamples: 3, maxUseItemBlocksPerTick: 0.26, noSlowSamples: 10, maxPacketsPerSecond: 34, timerEvidenceWindows: 4, maxReach: 3.65, maxCps: 24, wallHitSamples: 8, multiTargetCount: 5, multiTargetWindowMillis: 550, maxAimDeviationDegrees: 70, aimEvidenceSamples: 5, aimEvidenceWindowMillis: 1800, rapidSwitchMillis: 70, rapidSwitchAngleDegrees: 130, rapidSwitchSamples: 4, rapidSwitchEvidenceWindowMillis: 1500, clickPatternSamples: 20, clickPatternMaxDeviationMillis: 0.75, criticalSamples: 5, criticalWindowMillis: 4000, blockReachAllowance: 1, maxBreaksPerSecond: 24, maxPlacesPerSecond: 22, scaffoldAimDegrees: 100, scaffoldSamples: 6, scaffoldWindowMillis: 3000, multiBreakSamples: 8, multiBreakWindowMillis: 450, multiBreakMinSpan: 4.5, maxChatPerFiveSeconds: 8, maxCommandsPerFiveSeconds: 14, maxInventoryClicksPerSecond: 45, inventoryEvidenceSamples: 4, inventorySampleIntervalMillis: 300, inventoryEvidenceWindowMillis: 2200, maxInventoryBurstPacketsPerSecond: 160, inventoryViolationCooldownMillis: 4000 }
  };

  const settingGroups = [
    ['Server', [
      ['serverType', 'Server type', 'select', ['vanilla','fabric','quilt','forge','neoforge','paper','purpur','spigot']],
      ['serverVersion', 'Minecraft version', 'select', ['latest']], ['levelName', 'World name', 'text'], ['seed', 'Seed', 'text'],
      ['motd', 'MOTD', 'text'], ['difficulty', 'Difficulty', 'select', ['peaceful','easy','normal','hard']],
      ['gamemode', 'Game mode', 'select', ['survival','creative','adventure','spectator']], ['maxPlayers', 'Max players', 'number'],
      ['serverIcon', 'Server icon', 'serverIcon']
    ]],
    ['Network & performance', [
      ['customHostname', 'Custom hostname', 'text'], ['publicAddress', 'Public address', 'text'],
      ['voicePublicAddress', 'Voice UDP address', 'text'], ['bindIp', 'Bind IP', 'text'],
      ['port', 'Port', 'number'], ['memoryMb', 'Memory MB', 'number'], ['javaPath', 'Java path', 'text'],
      ['viewDistance', 'View distance', 'number'], ['simulationDistance', 'Simulation distance', 'number']
    ]],
    ['Server availability', [
      ['emptyServerAction', 'When nobody is online', 'select', [['never','Keep the server running'],['stop','Stop the server after a delay']]],
      ['emptyServerStopMinutes', 'Empty-server delay (minutes)', 'number'],
      ['keepSystemAwakeWhileRunning', 'Keep PC awake while server runs', 'checkbox']
    ]],
    ['Gameplay', [
      ['onlineMode','Online mode','checkbox'], ['pvp','PvP','checkbox'], ['playerLocatorBar','Player locator','checkbox'],
      ['allowFlight','Allow flight','checkbox'], ['allowCheats','Allow cheats','checkbox'], ['whiteList','Whitelist','checkbox'],
      ['hardcore','Hardcore','checkbox'], ['forceGamemode','Force game mode','checkbox'], ['allowNether','Enable Nether dimension','checkbox'],
      ['generateStructures','Generate structures','checkbox'], ['spawnAnimals','Spawn animals','checkbox'],
      ['spawnMonsters','Spawn monsters','checkbox'], ['spawnNpcs','Spawn NPCs','checkbox'], ['acceptEula','Accept Minecraft EULA','checkbox'],
      ['spawnProtection','Spawn protection','number']
    ]],
    ['Dimension access', [
      ['lockNether','Lock Nether','checkbox'], ['lockEnd','Lock End','checkbox']
    ]],
    ['SMP rules', [
      ['doInsomnia','Allow phantoms','checkbox'], ['mobGriefing','Mob griefing','checkbox'], ['doFireTick','Fire spread','checkbox'],
      ['keepInventory','Keep inventory','checkbox'],
      ['deathLootMode','Death loot','select', [['vanilla','Vanilla drops'],['timed','Timed death drops'],['chest','Death chest']]],
      ['deathDropLifetimeSeconds','Death-drop lifetime (seconds)','number'],
      ['deathChestLifetimeSeconds','Death-chest lifetime (seconds)','number'],
      ['deathChestTorches','Death-chest torches','checkbox'],
      ['doImmediateRespawn','Immediate respawn','checkbox'],
      ['showDeathMessages','Death messages','checkbox'], ['announceAdvancements','Advancements','checkbox'],
      ['doTraderSpawning','Wandering traders','checkbox'], ['doPatrolSpawning','Pillager patrols','checkbox'],
      ['playersSleepingPercentage','Sleep percentage','number'], ['spawnRadius','Spawn radius','number'], ['randomTickSpeed','Random tick speed','number']
    ]],
    ['Player records', [
      ['playerHistoryLimit', 'History entry limit', 'number']
    ]]
  ];

  const settingDescriptions = {
    serverType: 'Server software to download or match with an existing JAR. Vanilla does not load mods or plugins.',
    serverVersion: 'Minecraft version accepted by players joining this server.',
    levelName: 'Folder and display name used for this world.',
    seed: 'Seed used when a new world is generated. Blank creates a random seed.',
    motd: 'Message shown beneath the server name in the Minecraft server list.',
    difficulty: 'Controls hostile mob damage, hunger and spawning difficulty.',
    gamemode: 'Default mode assigned to new players.',
    maxPlayers: 'Maximum players allowed online at once.',
    serverIcon: 'Square image shown beside this server in Minecraft. PNG files work best.',
    customHostname: 'Optional domain displayed after DNS points to the direct or tunnel endpoint. Typing a hostname here does not configure DNS.',
    publicAddress: 'Address displayed for players to copy. Entering it does not expose the server; configure direct port mapping or a tunnel.',
    voicePublicAddress: 'Optional public UDP tunnel endpoint for Simple Voice Chat, such as voice.example.net:24454. Leave blank for automatic router mapping.',
    bindIp: 'Local network interface to bind. Leave blank to listen on all interfaces.',
    port: 'Network port used by Minecraft clients.',
    memoryMb: 'Maximum memory available to Java. Fabric Anti-Xray supports a 4 GB floor; use 6 GB for extra headroom at view distance 25 or higher.',
    javaPath: 'Java executable used to start the server. Leave as java for the system default.',
    viewDistance: 'Maximum chunk distance sent to each player.',
    simulationDistance: 'Chunk distance where entities and game logic keep running.',
    emptyServerAction: 'Keep the server online overnight, or stop it automatically only after the last player leaves.',
    emptyServerStopMinutes: 'How long the running server must stay empty before Click Interval sends a normal save-and-stop command.',
    keepSystemAwakeWhileRunning: 'Prevents Windows from suspending the server while still allowing the display to turn off.',
    onlineMode: 'Verifies player accounts with Mojang before allowing them to join.',
    pvp: 'Allows players to damage other players.',
    playerLocatorBar: 'Shows the direction of other players on the locator bar.',
    allowFlight: 'Prevents the server from kicking players for sustained flight.',
    allowCheats: 'Allows command blocks and server-side command features.',
    whiteList: 'Only permits players included in the server whitelist.',
    hardcore: 'Locks the world to hard difficulty with permanent death.',
    forceGamemode: 'Resets joining players to the configured default game mode.',
    allowNether: 'Server availability setting. Use Dimension access to lock the Nether or choose an opening timer.',
    lockNether: 'Check to close the Nether. Uncheck and Save to open it manually.',
    lockEnd: 'Check to close the End. Uncheck and Save to open it manually.',
    generateStructures: 'Generates villages, strongholds and other world structures.',
    spawnAnimals: 'Allows passive animals to spawn naturally.',
    spawnMonsters: 'Allows hostile mobs to spawn naturally.',
    spawnNpcs: 'Allows villagers and other NPCs to spawn.',
    acceptEula: 'Confirms acceptance of the Minecraft server EULA.',
    spawnProtection: 'Protected radius around world spawn. Set to 0 to disable it.',
    doInsomnia: 'Allows phantoms to spawn when players avoid sleeping.',
    mobGriefing: 'Allows mobs to alter blocks and pick up items.',
    doFireTick: 'Allows fire to spread and extinguish naturally.',
    keepInventory: 'Keeps player items and experience after death.',
    deathLootMode: 'Changes only inventory items released by a player death. Ordinary dropped items keep their normal Minecraft lifetime. Keep inventory overrides this setting.',
    deathDropLifetimeSeconds: 'How long death-only item drops remain. This also controls the safe fallback if a death chest cannot be placed.',
    deathChestLifetimeSeconds: 'How long a death chest remains before its leftover contents disappear. Set 0 to keep death chests until emptied or broken.',
    deathChestTorches: 'Places a torch on each side when both positions are safe and replaceable. Existing blocks are never overwritten.',
    doImmediateRespawn: 'Respawns players without showing the death screen.',
    showDeathMessages: 'Shows player death messages in chat.',
    announceAdvancements: 'Announces player advancements in chat.',
    doTraderSpawning: 'Allows wandering traders to spawn.',
    doPatrolSpawning: 'Allows pillager patrols to spawn.',
    playersSleepingPercentage: 'Percentage of online players required to skip the night.',
    spawnRadius: 'Radius where new players may randomly spawn around world spawn.',
    randomTickSpeed: 'Rate for crop growth, leaf decay and other random block updates.',
    playerHistoryLimit: 'Maximum join and leave events retained in History. Choose from 10 to 1,000; the oldest event is removed first.'
  };

  const numericSettingRules = {
    maxPlayers: { min: 1, max: 1000, step: 1, fallback: 20 },
    port: { min: 1, max: 65535, step: 1, fallback: 25565 },
    memoryMb: { min: 512, max: 131072, step: 256, fallback: 2048 },
    viewDistance: { min: 3, max: 32, step: 1, fallback: 10 },
    simulationDistance: { min: 3, max: 32, step: 1, fallback: 10 },
    emptyServerStopMinutes: { min: 1, max: 1440, step: 1, fallback: 30 },
    spawnProtection: { min: 0, max: 1000, step: 1, fallback: 16 },
    playersSleepingPercentage: { min: 0, max: 100, step: 1, fallback: 50 },
    spawnRadius: { min: 0, max: 128, step: 1, fallback: 8 },
    randomTickSpeed: { min: 0, max: 100, step: 1, fallback: 3 },
    playerHistoryLimit: { min: 10, max: 1000, step: 1, fallback: 100 },
    deathDropLifetimeSeconds: { min: 1, max: 86400, step: 1, fallback: 300 },
    deathChestLifetimeSeconds: { min: 0, nonZeroMin: 1, max: 604800, step: 1, fallback: 900 }
  };

  const protectionLayerTypes = Object.freeze({
    baseline: Object.freeze(['vanilla', 'paper', 'purpur', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge']),
    builtIn: Object.freeze(['paper', 'purpur', 'spigot', 'fabric']),
    antiXray: Object.freeze(['paper', 'purpur', 'fabric']),
    espMitigation: Object.freeze([]),
    custom: Object.freeze(['paper', 'purpur', 'spigot', 'fabric', 'quilt', 'forge', 'neoforge'])
  });
  const automaticPlatformTypes = Object.freeze(['paper', 'fabric']);

  function neutralServerText(value) {
    return String(value || '')
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
      .replace(/^(?:Error:\s*)+/i, '')
      .replace(/Stop the Minecraft server and wait for startup to finish before changing custom mods\.?/gi, 'Stop the server before changing custom mods.')
      .replace(/Stop the Minecraft server and wait for startup to finish before changing custom plugins\.?/gi, 'Stop the server before changing custom plugins.')
      .replace(/Click Interval protection/gi, 'Server Protection')
      .replace(/Click Interval anti-cheat/gi, 'Server Protection')
      .replace(/\bClick Interval\b/gi, 'Server Manager')
      .replace(/\bAssembly\b/gi, 'Server Manager');
  }

  function selectedServerType() {
    const pendingSelection = settingsDirty ? $('msSetting_serverType')?.value : '';
    return String(pendingSelection || status?.config?.requestedServerType || status?.config?.serverType || 'vanilla').toLowerCase();
  }

  function serverTypeLabel(type) {
    const normalized = String(type || 'vanilla').toLowerCase();
    return normalized === 'neoforge' ? 'NeoForge' : normalized[0].toUpperCase() + normalized.slice(1);
  }

  function layerSupportsType(layer, type = selectedServerType()) {
    return (protectionLayerTypes[layer] || []).includes(String(type).toLowerCase());
  }

  function addonKindForType(type = selectedServerType()) {
    const normalized = String(type).toLowerCase();
    if (['paper', 'purpur', 'spigot'].includes(normalized)) return 'plugins';
    if (['fabric', 'quilt', 'forge', 'neoforge'].includes(normalized)) return 'mods';
    return '';
  }

  function supportedTypesText(layer) {
    return (protectionLayerTypes[layer] || []).map(serverTypeLabel).join(', ');
  }

  function toast(message, error = false) {
    const el = $('msToast');
    el.textContent = message;
    el.style.borderColor = error ? 'var(--theme-danger)' : '';
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setLoading(active, text = 'Creating server…') {
    $('msLoadingText').textContent = text;
    $('msLoadingOverlay').hidden = !active;
    updateDataResetControls();
  }

  async function run(action, success) {
    try {
      const result = await action();
      if (success) toast(success);
      return result;
    } catch (error) {
      toast(neutralServerText(error?.message || String(error)), true);
      throw error;
    }
  }

  function activeProfile() {
    const state = status?.profiles;
    return state?.profiles?.find(profile => profile.id === state.activeProfileId) || state?.profiles?.[0];
  }

  function invalidateAddonState(clearInstalled = false) {
    clearTimeout(addonSearchTimer);
    addonSearchTimer = null;
    addonSearchToken += 1;
    addonLoading = false;
    addonKindInitialized = false;
    addonResults = [];
    addonResultTotal = 0;
    addonNextOffset = 0;
    addonHasMore = false;
    addonBrowseRenderSignature = '';
    installedAddonRenderSignature = '';
    installedAddonUpdateGeneration += 1;
    installedAddonUpdates.clear();
    installedAddonUpdateQueue.length = 0;
    modPolicy = { allowedMods: [], blockedMods: [], playerExceptions: [] };
    modPolicyLoading = false;
    if (clearInstalled) installedAddonKeys.clear();
  }

  function resetProfileUiState() {
    pendingDataReset = null;
    dimensionLockDraft = null;
    setupDisclosureInitialized = false;
    settingsDirty = false;
    invalidateAddonState(true);
    securityRequestToken += 1;
    securityLoading = false;
    securityStatus = null;
    platformStatus = null;
    clearTimeout(protectionSaveTimer);
    protectionSaveTimer = null;
    protectionSaveToken += 1;
    protectionConfig = null;
    protectionHistory = [];
    protectionHistoryLoading = false;
    protectionHistoryLoadedAt = 0;
    customAntiCheats = [];
    playerAccess = { assignments: [], roles: [], commandGroups: {}, capabilityDefinitions: {}, minecraftColors: [], loaded: false };
    playerAccessLoading = false;
    playerAccessError = '';
    pendingAccessDraft = null;
    playerSkinGeneration += 1;
    playerSkinRequests.clear();
    playerBustCanvases.clear();
    playerSkinRetryAfter.clear();
    for (const task of playerSkinTaskQueue.splice(0)) task.resolve(null);
    clearTimeout(playerSkinRetryTimer);
    playerSkinRetryTimer = null;
    playerBustObserver?.disconnect();
    const playerList = $('msPlayersList');
    if (playerList) delete playerList.dataset.playerRenderSignature;
    protectionView = 'checks';
    protectionMessageSelection = 'check:reach';
    showProtectionView('checks');
  }

  function showPanel(workspace) {
    $('msHomePanel').hidden = workspace;
    $('msWorkspacePanel').hidden = !workspace;
  }

  function showPage(name) {
    for (const button of document.querySelectorAll('[data-ms-page]')) button.classList.toggle('active', button.dataset.msPage === name);
    for (const page of ['overview','players','settings','addons','security','storage']) $(`ms${page[0].toUpperCase()}${page.slice(1)}Page`).hidden = page !== name;
    if (name === 'players') {
      renderPlayers();
      if (playersView === 'access') loadPlayerAccess().catch(() => {});
      refreshPlayerSnapshot().catch(() => {});
    }
    if (name === 'settings' && !settingsDirty) hydrateSettings();
    if (name === 'addons') renderAddons();
    if (name === 'security') loadSecurity().catch(() => {});
    if (name === 'storage') renderStorage();
  }

  function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes) || 0);
    const units = ['B','KB','MB','GB'];
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  }

  function formatRuntime(startedAt) {
    if (!startedAt) return 'Offline';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function formatCount(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return String(number);
  }

  function renderEmpty(container, title, detail = '') {
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'ms-empty-state';
    const heading = document.createElement('strong');
    heading.textContent = title;
    empty.append(heading);
    if (detail) {
      const description = document.createElement('span');
      description.textContent = detail;
      empty.append(description);
    }
    container.append(empty);
  }

  function renderHome() {
    const list = $('msServerList');
    list.innerHTML = '';
    const profiles = status?.profiles?.profiles || [];
    $('msServerEmpty').hidden = profiles.length > 0;
    for (const profile of profiles) {
      const row = document.createElement('div');
      row.className = 'macro-library-row ms-server-row';
      row.setAttribute('role', 'listitem');
      const img = document.createElement('img');
      img.className = 'ms-server-icon';
      img.alt = '';
      img.src = profile.iconDataUrl || 'minecraft-server/renderer/assets/minecraft-default-world.png';
      const info = document.createElement('span');
      info.className = 'ms-server-info';
      info.textContent = profile.name || profile.levelName || 'Server';
      const serverState = document.createElement('span');
      serverState.className = 'ms-server-status';
      serverState.textContent = profile.id === status.profiles.activeProfileId ? status.state : 'Saved';
      const openServer = async () => {
        if (profile.id !== status.profiles.activeProfileId) {
          status = await run(() => api.switchProfile(profile.id, status.state !== 'stopped'), 'Server selected.');
          resetProfileUiState();
        }
        showPanel(true);
        showPage('overview');
        renderAll();
      };
      const rename = document.createElement('button'); rename.className = 'macro-row-icon rename'; rename.type = 'button'; rename.title = 'Rename server'; rename.setAttribute('aria-label', `Rename ${info.textContent}`); rename.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.2-1 10.4-10.4-3.2-3.2L5 15.8z"/><path d="M13.9 6.9l3.2 3.2"/></svg>';
      rename.onclick = () => window.bridge.openMacroNameWindow({ entity: 'server', action: 'rename', mode: 'rename', id: profile.id, name: info.textContent });
      const remove = document.createElement('button'); remove.className = 'macro-row-icon delete'; remove.type = 'button'; remove.title = 'Delete server'; remove.setAttribute('aria-label', `Delete ${info.textContent}`); remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg>';
      remove.onclick = () => window.bridge.openMacroDeleteWindow({ entity: 'server', action: 'delete', id: profile.id, name: info.textContent, question: `Are you sure you want to delete “${info.textContent}” and its server files?` });
      row.append(img, info, serverState, rename, remove);
      row.addEventListener('click', event => { if (!event.target.closest('button')) openServer(); });
      list.append(row);
    }
  }

  function renderOverview() {
    const config = status?.config || {};
    const profile = activeProfile();
    const serverState = String(status?.state || 'stopped').toLowerCase();
    $('msServerTitle').textContent = profile?.name || config.levelName || 'Minecraft Server';
    $('msServerState').textContent = serverState === 'starting' ? 'Starting…' : serverState === 'stopping' ? 'Stopping…' : serverState[0].toUpperCase() + serverState.slice(1);
    $('msServerVersion').textContent = config.serverVersion || 'Not configured';
    $('msToggleServer').textContent = serverState === 'running' || serverState === 'starting' ? 'Stop' : serverState === 'stopping' ? 'Stopping…' : 'Start';
    $('msToggleServer').disabled = serverState === 'stopping';
    $('msRestartServer').disabled = serverState !== 'running';
    $('msPlayersMetric').textContent = `${status?.players?.online || 0} / ${status?.players?.max || config.maxPlayers || 0}`;
    $('msMemoryMetric').textContent = status?.performance?.memoryMb ? `${Math.round(status.performance.memoryMb)} MB` : `${config.memoryMb || 0} MB`;
    $('msRuntimeMetric').textContent = formatRuntime(status?.uptimeStartedAt);
    $('msPublicAddress').value = config.localOnly ? '' : config.customHostname || config.publicAddress || '';
    const lan = status?.network?.lanIps?.[0];
    $('msLanAddress').value = config.localOnly
      ? `127.0.0.1:${config.port || 25565}`
      : lan ? `${lan}:${config.port || 25565}` : '';
    const readiness = [
      ['Java 25+', Boolean(status?.java?.available && status.java.major >= 25)],
      ['Server jar', Boolean(status?.jarExists)],
      ['Minecraft EULA', Boolean(config.acceptEula)],
      [config.localOnly ? 'Local-only mode' : 'Direct hosting', config.localOnly
        ? Boolean(status?.directHosting && !status.directHosting.mapped && !status.directHosting.voiceMapped && !status?.playit?.running)
        : Boolean(status?.directHosting?.mapped || status?.playit?.running)]
    ];
    $('msReadiness').innerHTML = readiness.map(([label, ready]) => `<div><span>${label}</span><b class="${ready ? 'ready' : 'missing'}">${ready ? 'Ready' : 'Needed'}</b></div>`).join('');
    if (!setupDisclosureInitialized) {
      $('msSetupDisclosure').open = readiness.slice(0, 3).some(([, ready]) => !ready);
      setupDisclosureInitialized = true;
    }
  }

  function settingName(key, label, controlId = '') {
    const name = document.createElement('label');
    name.className = 'ms-setting-name';
    name.textContent = label;
    if (controlId) name.htmlFor = controlId;
    const description = settingDescriptions[key] || '';
    if (description) {
      name.title = description;
      name.tabIndex = 0;
      name.setAttribute('aria-label', `${label}. ${description}`);
    }
    return name;
  }

  function normalizeNumericSetting(control, requireComplete = false) {
    const rule = numericSettingRules[control.dataset.configKey];
    if (!rule) return;
    const numeric = Number(control.value);
    if (!Number.isFinite(numeric)) {
      if (requireComplete) control.value = String(rule.fallback);
      return;
    }
    let next = numeric;
    if (numeric < 0 || requireComplete) next = Math.max(rule.min, next);
    if (requireComplete && rule.nonZeroMin && next > 0 && next < rule.nonZeroMin) next = rule.nonZeroMin;
    next = Math.min(rule.max, next);
    if (requireComplete && rule.step > 0) next = rule.min + Math.round((next - rule.min) / rule.step) * rule.step;
    next = Math.min(rule.max, Math.max(rule.min, next));
    if (next !== numeric) control.value = String(next);
  }

  function prepareNumericSetting(control, key) {
    const rule = numericSettingRules[key];
    if (!rule) return;
    control.min = String(rule.min);
    control.max = String(rule.max);
    control.step = String(rule.step);
    control.inputMode = 'numeric';
    const allowedRange = rule.nonZeroMin
      ? `${rule.min}, or ${rule.nonZeroMin} to ${rule.max}`
      : `${rule.min} to ${rule.max}`;
    control.setAttribute('aria-description', `${settingDescriptions[key]} Allowed range: ${allowedRange}.`);
    control.addEventListener('keydown', event => {
      if (['e', 'E', '+', '-'].includes(event.key)) event.preventDefault();
    });
    control.addEventListener('input', () => normalizeNumericSetting(control, false));
    control.addEventListener('change', () => normalizeNumericSetting(control, true));
    control.addEventListener('blur', () => normalizeNumericSetting(control, true));
  }

  function buildMotdSetting(row, key, label) {
    const inputId = `msSetting_${key}`;
    row.classList.add('ms-motd-setting');
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = inputId;
    input.dataset.configKey = key;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ms-motd-edit';
    edit.title = 'Edit MOTD';
    edit.setAttribute('aria-label', 'Open MOTD editor');
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.4-1.1L19 8.3 15.7 5 5.1 15.6z"/><path d="M13.9 6.8l3.3 3.3"/></svg>';
    edit.addEventListener('click', () => window.bridge.openMotdEditor({
      value: input.value,
      serverName: activeProfile()?.name || status?.config?.levelName || 'Minecraft Server',
      iconDataUrl: currentServerIcon()
    }));
    row.append(settingName(key, label), input, edit);
  }

  function currentServerIcon() {
    return status?.serverIconDataUrl || status?.serverIcon?.dataUrl || status?.worldIconDataUrl || 'minecraft-server/renderer/assets/minecraft-default-world.png';
  }

  function updateSettingsServerIcon() {
    const preview = $('msSettingsServerIcon');
    if (preview) preview.src = currentServerIcon();
  }

  function buildServerIconSetting(row, key, label) {
    row.classList.add('ms-server-icon-setting');
    row.append(settingName(key, label));
    const controls = document.createElement('div');
    controls.className = 'ms-server-icon-controls';
    const preview = document.createElement('img');
    preview.id = 'msSettingsServerIcon';
    preview.alt = 'Current server icon';
    preview.src = currentServerIcon();
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = 'Choose';
    choose.onclick = async () => {
      if (typeof api.selectServerIcon !== 'function') { toast('Server icon support is unavailable in this build.', true); return; }
      choose.disabled = true;
      try {
        const result = await run(() => api.selectServerIcon());
        if (result?.canceled) return;
        toast('Server icon updated.');
        await refresh();
        updateSettingsServerIcon();
      }
      catch (_) {} finally { choose.disabled = false; }
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.onclick = async () => {
      if (typeof api.removeServerIcon !== 'function') { toast('Server icon support is unavailable in this build.', true); return; }
      remove.disabled = true;
      try { await run(() => api.removeServerIcon(), 'Server icon removed.'); await refresh(); updateSettingsServerIcon(); }
      catch (_) {} finally { remove.disabled = false; }
    };
    controls.append(preview, choose, remove);
    row.append(controls);
  }

  function buildSettings() {
    const root = $('msSettingsFields');
    root.innerHTML = '';
    for (const [title, fields] of settingGroups) {
      const group = document.createElement('section');
      group.className = 'ms-setting-group';
      group.innerHTML = `<h3>${title}</h3>`;
      for (const [key, label, type, options] of fields) {
        const row = document.createElement('div');
        row.className = 'ms-setting-row';
        if (key === 'motd') {
          buildMotdSetting(row, key, label);
          group.append(row);
          continue;
        }
        if (type === 'serverIcon') {
          buildServerIconSetting(row, key, label);
          group.append(row);
          continue;
        }
        let control;
        if (type === 'select') {
          control = document.createElement('select');
          for (const option of options) {
            const value = Array.isArray(option) ? option[0] : option;
            const label = Array.isArray(option) ? option[1] : value[0].toUpperCase() + value.slice(1);
            control.add(new Option(label, value));
          }
        } else {
          control = document.createElement('input');
          control.type = type;
        }
        control.id = `msSetting_${key}`;
        control.dataset.configKey = key;
        control.setAttribute('aria-description', settingDescriptions[key] || '');
        if (type === 'number') prepareNumericSetting(control, key);
        row.append(settingName(key, label, control.id), control);
        if (key === 'lockNether' || key === 'lockEnd') {
          const domain = key === 'lockNether' ? 'nether' : 'end';
          const title = domain === 'nether' ? 'Nether' : 'End';
          const hint = document.createElement('small');
          hint.id = `msSetting_${domain}LockHint`;
          hint.className = 'ms-dimension-hint';
          control.setAttribute('aria-describedby', hint.id);
          group.append(row);
          const automatic = document.createElement('label');
          automatic.className = 'ms-setting-row ms-dimension-auto';
          automatic.innerHTML = `<span>Open ${title} automatically</span><input id="msSetting_${domain}AutoOpen" type="checkbox" aria-describedby="${hint.id}">`;
          group.append(automatic);
          const timer = document.createElement('div');
          timer.className = 'ms-setting-row ms-dimension-timer';
          timer.id = `msSetting_${domain}Timer`;
          timer.hidden = true;
          timer.innerHTML = `<label for="msSetting_${domain}Duration">Open after</label><div class="ms-dimension-duration"><input id="msSetting_${domain}Duration" type="number" min="0.000001" step="any" placeholder="Choose delay" aria-label="${title} opening delay"><select id="msSetting_${domain}DurationUnit" aria-label="${title} opening delay unit"><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="seconds">Seconds</option></select></div>`;
          group.append(timer, hint);
          continue;
        }
        group.append(row);
      }
      root.append(group);
    }
    $('msSetting_deathLootMode')?.addEventListener('change', syncDeathLootSettings);
    $('msSetting_emptyServerAction')?.addEventListener('change', syncEmptyServerSettings);
    window.DimensionLockControls.bind(key => $(`msSetting_${key}`), () => status?.dimensionLocks, () => { settingsDirty = true; });
  }

  function syncDeathLootSettings() {
    const mode = $('msSetting_deathLootMode')?.value || 'vanilla';
    const setVisible = (key, visible) => {
      const control = $(`msSetting_${key}`);
      if (control?.closest('.ms-setting-row')) control.closest('.ms-setting-row').hidden = !visible;
    };
    setVisible('deathDropLifetimeSeconds', mode === 'timed');
    setVisible('deathChestLifetimeSeconds', mode === 'chest');
    setVisible('deathChestTorches', mode === 'chest');
  }

  function syncEmptyServerSettings() {
    const control = $('msSetting_emptyServerStopMinutes');
    if (control?.closest('.ms-setting-row')) {
      control.closest('.ms-setting-row').hidden = $('msSetting_emptyServerAction')?.value !== 'stop';
    }
  }

  function hydrateSettings() {
    const config = status?.config || {};
    dimensionLockDraft = window.DimensionLockControls.createDraft(status?.dimensionLocks, status?.profiles?.activeProfileId);
    for (const control of document.querySelectorAll('[data-config-key]')) {
      const key = control.dataset.configKey;
      let value = config[key];
      if ((key === 'lockNether' || key === 'lockEnd') && dimensionLockDraft) value = dimensionLockDraft[key].locked;
      if (key === 'serverType') value = config.requestedServerType || value;
      if (key === 'serverVersion') value = config.requestedServerVersion || value;
      if (key === 'motd' && ['Assembly Minecraft Server', 'Hello, this is my private server.', '§bClick Interval §8• §fMinecraft server'].includes(String(value || ''))) value = '';
      if (key === 'motd') value = String(value || '').replace(/\\n/g, '\n');
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else {
        if (control.tagName === 'SELECT' && value != null && ![...control.options].some(option => option.value === String(value))) control.add(new Option(String(value), String(value)));
        control.value = value ?? '';
      }
      if (control.type === 'number') normalizeNumericSetting(control, true);
    }
    syncDeathLootSettings();
    window.DimensionLockControls.hydrate(dimensionLockDraft, key => $(`msSetting_${key}`));
    syncDimensionLockSettings();
    syncEmptyServerSettings();
    updateSettingsServerIcon();
  }

  function syncDimensionLockSettings() {
    window.DimensionLockControls.sync(status?.dimensionLocks, key => $(`msSetting_${key}`));
  }

  async function loadVersions() {
    try {
      const manifest = await api.listVersions();
      const select = $('msSetting_serverVersion');
      if (!select) return;
      const current = status?.config?.requestedServerVersion || status?.config?.serverVersion || 'latest';
      select.innerHTML = '';
      select.add(new Option(`Latest (${manifest.latest?.release || 'release'})`, 'latest'));
      for (const version of manifest.versions || []) select.add(new Option(version.id, version.id));
      if (![...select.options].some(option => option.value === current)) select.add(new Option(current, current));
      select.value = current;
    } catch (_) {}
  }

  function collectSettings() {
    const next = { ...(status?.config || {}) };
    for (const control of document.querySelectorAll('[data-config-key]')) {
      const key = control.dataset.configKey;
      if (control.type === 'number') normalizeNumericSetting(control, true);
      next[key] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
    }
    if (dimensionLockDraft) {
      const request = window.DimensionLockControls.collect(dimensionLockDraft, key => $(`msSetting_${key}`));
      if (request) next._dimensionLockChanges = request;
    }
    return next;
  }

  function formatPlayerDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  }

  function banDetails(entry) {
    const endAt = Number(entry?.endAt) || (String(entry?.expires || '').toLowerCase() === 'forever' ? 0 : Date.parse(entry?.expires || ''));
    const temporary = Boolean(entry?.temporary || endAt > 0);
    return {
      expiry: temporary && endAt > 0 ? `Unbans ${formatPlayerDate(endAt)}` : 'Permanent ban',
      reason: String(entry?.message ?? entry?.reason ?? '').trim()
    };
  }

  function historyDetails(entry) {
    const event = String(entry?.event || entry?.eventType || entry?.type || entry?.lastEvent || 'seen').toLowerCase();
    const labels = {
      joined: 'Joined', join: 'Joined', 'logged in': 'Joined', 'logged-in': 'Joined', login: 'Joined', connected: 'Joined',
      left: 'Left', disconnected: 'Left', quit: 'Left', kick: 'Kicked', kicked: 'Kicked',
      ban: 'Banned', banned: 'Banned', 'temp-ban': 'Temporarily banned', pardoned: 'Pardoned', 'cheat-detected': 'Protection alert', seen: 'Seen'
    };
    const label = labels[event] || event.replace(/(^|-)([a-z])/g, (_all, prefix, letter) => `${prefix ? ' ' : ''}${letter.toUpperCase()}`);
    const timestamp = entry?.timestamp || entry?.occurredAt || entry?.lastActive || entry?.lastSeen || entry?.created;
    return {
      event,
      label,
      timestamp: Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : '',
      when: formatPlayerDate(timestamp),
      reason: String(entry?.reason || '').trim()
    };
  }

  function normalizedPlayerUuid(entry) {
    const uuid = String(entry?.uuid || entry?.id || '').replaceAll('-', '').trim().toLowerCase();
    return /^[0-9a-f]{32}$/.test(uuid) ? uuid : '';
  }

  function normalizedPlayerName(name) {
    const value = String(name || '').trim();
    return /^[A-Za-z0-9_]{1,16}$/.test(value) ? value : '';
  }

  function playerVisualKeys(entry, name) {
    const uuid = normalizedPlayerUuid(entry);
    const player = normalizedPlayerName(name);
    // A UUID is authoritative. Never fall back to a cached username image for
    // a UUID-backed row because names can move between accounts over time.
    if (uuid) return [`uuid:${uuid}`];
    return player ? [`name:${player.toLowerCase()}`] : [];
  }

  function playerVisualIdentifier(entry, name) {
    return playerVisualKeys(entry, name)[0] || '';
  }

  function skinBustParts(model = 'classic', legacy = false) {
    const slim = !legacy && model === 'slim';
    const armWidth = slim ? 3 : 4;
    const armInset = slim ? 1 : 0;
    const parts = [
      { name: 'right-arm', source: [44, 20, armWidth, 12], target: [armInset, 8, armWidth, 12] },
      { name: 'left-arm', source: legacy ? [44, 20, 4, 12] : [36, 52, armWidth, 12], target: [12, 8, armWidth, 12], mirror: legacy },
      { name: 'body', source: [20, 20, 8, 12], target: [4, 8, 8, 12] },
      { name: 'head', source: [8, 8, 8, 8], target: [4, 0, 8, 8] }
    ];
    if (!legacy) {
      parts.push(
        { name: 'right-sleeve', source: [44, 36, armWidth, 12], target: [armInset, 8, armWidth, 12] },
        { name: 'left-sleeve', source: [52, 52, armWidth, 12], target: [12, 8, armWidth, 12] },
        { name: 'jacket', source: [20, 36, 8, 12], target: [4, 8, 8, 12] }
      );
    }
    parts.push({ name: 'hat', source: [40, 8, 8, 8], target: [4, 0, 8, 8] });
    return parts;
  }

  function drawSkinPart(context, image, atlasScale, part) {
    const [sourceX, sourceY, sourceWidth, sourceHeight] = part.source.map(value => value * atlasScale);
    const [logicalX, logicalY, logicalWidth, logicalHeight] = part.target;
    const targetX = logicalX * PLAYER_BUST_PIXEL_SCALE;
    const targetY = logicalY * PLAYER_BUST_PIXEL_SCALE;
    const outputWidth = logicalWidth * PLAYER_BUST_PIXEL_SCALE;
    const outputHeight = logicalHeight * PLAYER_BUST_PIXEL_SCALE;
    if (!part.mirror) {
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, targetX, targetY, outputWidth, outputHeight);
      return;
    }
    context.save();
    context.translate(targetX + outputWidth, targetY);
    context.scale(-1, 1);
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    context.restore();
  }

  function renderSkinBust(image, model) {
    const width = Number(image?.naturalWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.height || 0);
    const atlasScale = width / 64;
    const legacy = height * 2 === width;
    if (width < 64 || !Number.isInteger(atlasScale) || (height !== width && !legacy)) return null;
    const canvas = document.createElement('canvas');
    canvas.width = PLAYER_BUST_WIDTH;
    canvas.height = PLAYER_BUST_HEIGHT;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    for (const part of skinBustParts(model, legacy)) drawSkinPart(context, image, atlasScale, part);
    return canvas;
  }

  function loadSkinImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', () => reject(new Error('The player skin could not be decoded.')), { once: true });
      image.src = dataUrl;
    });
  }

  function verifiedSkinDataUrl(value) {
    const dataUrl = String(value || '');
    return dataUrl.length <= 4_000_000 && /^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(dataUrl) ? dataUrl : '';
  }

  function cachedPlayerBust(keys) {
    for (const key of keys) {
      const cached = playerBustCanvases.get(key);
      if (!cached) continue;
      if (cached.expiresAt <= Date.now()) {
        playerBustCanvases.delete(key);
        continue;
      }
      playerBustCanvases.delete(key);
      playerBustCanvases.set(key, cached);
      return cached.canvas;
    }
    return null;
  }

  function cachePlayerBust(keys, canvas) {
    const now = Date.now();
    for (const key of keys) {
      playerBustCanvases.delete(key);
      playerBustCanvases.set(key, {
        canvas,
        expiresAt: now + (key.startsWith('uuid:') ? PLAYER_BUST_UUID_TTL_MS : PLAYER_BUST_NAME_TTL_MS)
      });
    }
    while (playerBustCanvases.size > PLAYER_BUST_CACHE_LIMIT) {
      playerBustCanvases.delete(playerBustCanvases.keys().next().value);
    }
  }

  function runPlayerSkinTask(work) {
    if (playerSkinTaskQueue.length >= PLAYER_SKIN_PENDING_LIMIT) return Promise.resolve(null);
    return new Promise(resolve => {
      playerSkinTaskQueue.push({ work, resolve });
      drainPlayerSkinTasks();
    });
  }

  function drainPlayerSkinTasks() {
    while (playerSkinActiveTasks < PLAYER_SKIN_MAX_CONCURRENCY && playerSkinTaskQueue.length) {
      const task = playerSkinTaskQueue.shift();
      playerSkinActiveTasks += 1;
      Promise.resolve().then(task.work).catch(() => null).then(task.resolve).finally(() => {
        playerSkinActiveTasks -= 1;
        drainPlayerSkinTasks();
      });
    }
  }

  function schedulePlayerSkinRetry(keys) {
    const retryAt = Date.now() + PLAYER_SKIN_RETRY_MS;
    for (const key of keys) playerSkinRetryAfter.set(key, retryAt);
    while (playerSkinRetryAfter.size > PLAYER_BUST_CACHE_LIMIT) {
      playerSkinRetryAfter.delete(playerSkinRetryAfter.keys().next().value);
    }
    if (playerSkinRetryTimer) return;
    playerSkinRetryTimer = setTimeout(() => {
      playerSkinRetryTimer = null;
      const now = Date.now();
      for (const [key, until] of playerSkinRetryAfter) {
        if (until <= now) playerSkinRetryAfter.delete(key);
      }
      const list = $('msPlayersList');
      if (list && !list.closest('[hidden]')) {
        delete list.dataset.playerRenderSignature;
        renderPlayers();
      }
    }, PLAYER_SKIN_RETRY_MS);
  }

  function requestPlayerBust(entry, name) {
    const initialKeys = playerVisualKeys(entry, name);
    const authoritativeUuid = normalizedPlayerUuid(entry);
    const requestGeneration = playerSkinGeneration;
    const cached = cachedPlayerBust(initialKeys);
    if (cached) return Promise.resolve(cached);
    if (initialKeys.some(key => (playerSkinRetryAfter.get(key) || 0) > Date.now())) return Promise.resolve(null);
    for (const key of initialKeys) {
      const pending = playerSkinRequests.get(key);
      if (pending) return pending;
    }
    if (!initialKeys.length || typeof api.getPlayerSkin !== 'function') return Promise.resolve(null);
    const request = runPlayerSkinTask(() => api.getPlayerSkin({
      name: normalizedPlayerName(name),
      uuid: authoritativeUuid
    })).then(async result => {
      const resultUuid = normalizedPlayerUuid({ uuid: result?.uuid, id: result?.id });
      if (!resultUuid || (authoritativeUuid && resultUuid !== authoritativeUuid)) return null;
      const dataUrl = verifiedSkinDataUrl(result?.skinDataUrl);
      if (!dataUrl) return null;
      const image = await loadSkinImage(dataUrl);
      const canvas = renderSkinBust(image, result?.model === 'slim' ? 'slim' : 'classic');
      if (!canvas || requestGeneration !== playerSkinGeneration) return null;
      const resolvedKeys = playerVisualKeys({ uuid: resultUuid }, result?.name);
      cachePlayerBust(new Set([...initialKeys, ...resolvedKeys]), canvas);
      for (const key of new Set([...initialKeys, ...resolvedKeys])) playerSkinRetryAfter.delete(key);
      return canvas;
    }).catch(() => null).then(canvas => {
      if (!canvas) schedulePlayerSkinRetry(initialKeys);
      return canvas;
    });
    for (const key of initialKeys) playerSkinRequests.set(key, request);
    request.finally(() => {
      for (const key of initialKeys) {
        if (playerSkinRequests.get(key) === request) playerSkinRequests.delete(key);
      }
    }).catch(() => {});
    return request;
  }

  function showPlayerBust(figure, source) {
    const canvas = figure.querySelector('.ms-player-bust');
    const fallback = figure.querySelector('.ms-player-figure-fallback');
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context || !source) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
    canvas.hidden = false;
    if (fallback) fallback.hidden = true;
  }

  function createPlayerFigure(entry, name, view = '') {
    const figure = document.createElement('span');
    figure.className = 'ms-player-figure';
    figure.setAttribute('aria-hidden', 'true');
    figure.innerHTML = '<svg class="ms-player-figure-fallback" viewBox="0 0 32 40" fill="none"><path d="M11 3h10v11H11zM8 18h16v14H8zM3 19h5v18H3m21-18h5v18h-5M11 32v6m10-6v6"/></svg>';
    const canvas = document.createElement('canvas');
    canvas.className = 'ms-player-bust';
    canvas.width = PLAYER_BUST_WIDTH;
    canvas.height = PLAYER_BUST_HEIGHT;
    canvas.hidden = true;
    figure.append(canvas);
    const keys = playerVisualKeys(entry, name);
    const cached = cachedPlayerBust(keys);
    if (cached) showPlayerBust(figure, cached);
    else {
      const generation = playerSkinGeneration;
      const load = () => requestPlayerBust(entry, name).then(bust => {
        if (!figure.isConnected || generation !== playerSkinGeneration) return;
        if (bust) showPlayerBust(figure, bust);
      });
      if (playerBustObserver) {
        playerFigureLoaders.set(figure, load);
        playerBustObserver.observe(figure);
      } else {
        load();
      }
    }
    return figure;
  }

  function createPlayerIdentity(entry, name, view) {
    const identity = document.createElement('div');
    identity.className = 'ms-player-identity';
    const copy = document.createElement('div');
    copy.className = 'ms-player-copy';
    const heading = document.createElement('strong');
    heading.textContent = name;
    copy.append(heading);
    if (view === 'banned') {
      const details = banDetails(entry);
      const expiry = document.createElement('span');
      expiry.className = 'ms-player-ban-expiry';
      expiry.textContent = details.expiry;
      copy.append(expiry);
      if (details.reason) {
        const reason = document.createElement('span');
        reason.className = 'ms-player-reason';
        reason.textContent = details.reason;
        copy.append(reason);
      }
    } else if (view === 'history') {
      const details = historyDetails(entry);
      const line = document.createElement('span');
      line.className = 'ms-player-event-line';
      const event = document.createElement('b');
      event.className = `ms-player-event ${details.event.replace(/[^a-z0-9-]/g, '-')}`;
      event.textContent = details.label;
      line.append(event);
      if (details.when) {
        const time = document.createElement('time');
        time.className = 'ms-player-time';
        time.dateTime = details.timestamp;
        time.textContent = details.when;
        line.append(time);
      }
      copy.append(line);
      if (details.reason) {
        const reason = document.createElement('span');
        reason.className = 'ms-player-reason';
        reason.textContent = details.reason;
        copy.append(reason);
      }
    } else {
      const state = document.createElement('span');
      state.className = 'ms-player-online';
      state.textContent = 'Online now';
      copy.append(state);
    }
    identity.append(createPlayerFigure(entry, name, view), copy);
    return identity;
  }

  const playerActionIcons = {
    view: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    ban: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 6v5c0 4.3 2.7 7.9 6.5 10 3.8-2.1 6.5-5.7 6.5-10V6z"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
    temp: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
    pardon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 5.8-1"/></svg>',
    shorten: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="11" r="6"/><path d="M10 8v3l2 1m3.5 5.5 4-4m-2.7-.7 2.7 2.7"/></svg>',
    compatible: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 6v5c0 4.3 2.7 7.9 6.5 10 3.8-2.1 6.5-5.7 6.5-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
    access: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5.5 6v5c0 4.3 2.7 7.9 6.5 10 3.8-2.1 6.5-5.7 6.5-10V6z"/><path d="M9 12h6m-3-3v6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16-.8 3.8L8 19l9.5-9.5-3-3zM13.5 7.5l3 3"/></svg>',
    remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 10v7m4-7v7"/></svg>'
  };

  function playerAction(kind, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ms-player-action ${kind}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = playerActionIcons[kind] || '';
    button.onclick = onClick;
    return button;
  }

  function openBanReason(name) {
    window.bridge.openMacroNameWindow({
      entity: 'server', action: 'ban', target: name, title: `Ban ${name}`,
      label: 'Reason (optional)', placeholder: 'No reason', defaultValue: EMPTY_REASON_SENTINEL, confirmText: 'Ban'
    });
  }

  function openTempBan(name) {
    pendingTempBan = { target: name, mode: '', durationMs: 0 };
    window.bridge.openMacroNameWindow({
      entity: 'server', action: 'temp-ban-mode', target: name, title: `Temporarily ban ${name}`,
      label: 'Ban ends after', defaultValue: 'duration', confirmText: 'Next',
      options: [
        { value: 'duration', label: 'A duration' },
        { value: 'date', label: 'An exact date and time' }
      ]
    });
  }

  function tempBanDurationMs(value) {
    const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)?$/);
    if (!match) return 0;
    const units = { m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000, h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000, d: 86400000, day: 86400000, days: 86400000, w: 604800000, week: 604800000, weeks: 604800000 };
    const duration = Number(match[1]) * (units[match[2] || 'm'] || 0);
    return Number.isFinite(duration) && duration >= 60_000 && duration <= 31_536_000_000 ? Math.round(duration) : 0;
  }

  function tempBanDateDurationMs(value, now = Date.now()) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
    if (!match) return 0;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3]) || date.getHours() !== Number(match[4]) || date.getMinutes() !== Number(match[5])) return 0;
    const duration = date.getTime() - Number(now);
    return duration >= 60_000 && duration <= 31_536_000_000 ? duration : 0;
  }

  function tempBanDateValue(timestamp) {
    const date = new Date(timestamp);
    const number = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())}T${number(date.getHours())}:${number(date.getMinutes())}`;
  }

  function defaultTempBanDate() {
    return tempBanDateValue(Date.now() + 3_600_000);
  }

  function openPlayerCompatibility(name) {
    pendingPlayerModException = null;
    window.bridge.openMacroNameWindow({
      entity: 'server', action: 'player-mod-exception', target: name, title: `Compatibility exception`,
      label: 'Declared mod ID', placeholder: 'mouse-tweaks', confirmText: 'Next'
    });
  }

  function accessAssignmentFor(player) {
    const key = String(player || '').trim().toLowerCase();
    return playerAccess.assignments.find(entry => String(entry.player || '').toLowerCase() === key) || null;
  }

  function normalizePlayerAccessSnapshot(value, fallback = playerAccess) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      assignments: Array.isArray(source.assignments) ? source.assignments : [],
      roles: Array.isArray(source.roles) ? source.roles : [],
      commandGroups: source.commandGroups && typeof source.commandGroups === 'object' ? source.commandGroups : (fallback.commandGroups || {}),
      capabilityDefinitions: source.capabilityDefinitions && typeof source.capabilityDefinitions === 'object' ? source.capabilityDefinitions : (fallback.capabilityDefinitions || {}),
      minecraftColors: Array.isArray(source.minecraftColors) ? source.minecraftColors : (fallback.minecraftColors || []),
      runtime: source.runtime && typeof source.runtime === 'object' ? source.runtime : (fallback.runtime || {}),
      loaded: true
    };
  }

  function accessRoleById(roleId) {
    const key = String(roleId || '').trim().toLowerCase();
    return playerAccess.roles.find(role => String(role?.id || '').toLowerCase() === key) || null;
  }

  function accessRoleForAssignment(assignment) {
    return accessRoleById(assignment?.roleId) || {
      id: '', name: assignment?.roleName || 'Previous access', unavailable: true,
      capabilities: assignment?.capabilities || [], commands: { mode: assignment?.commandMode || 'allowlist', groups: assignment?.groups || [], allow: assignment?.commands || [], deny: assignment?.deniedCommands || [] },
      appearance: assignment?.appearance || { enabled: false, color: 'white', prefix: '', suffix: '' }
    };
  }

  function plainMinecraftText(value) {
    return String(value || '').replace(/(?:§|&)[0-9a-fk-or]/gi, '');
  }

  function roleAccessSummary(role) {
    const commands = role?.commands || {};
    if (commands.mode === 'all') return 'All commands';
    const groups = (commands.groups || []).map(group => playerAccess.commandGroups?.[group]?.label || group);
    const allowed = commands.allow || [];
    const denied = commands.deny || [];
    const parts = [...groups, ...allowed];
    if (denied.length) parts.push(`${denied.length} blocked`);
    return parts.join(', ') || 'No admin commands';
  }

  function roleTradeDiscountSummary(role) {
    const discount = Math.max(0, Math.min(55, Math.round(Number(role?.tradeDiscountPercent) || 0)));
    return discount > 0 ? `${discount}% villager discount` : '';
  }

  async function loadPlayerAccess(force = false) {
    if (typeof api.getPlayerAccess !== 'function' || playerAccessLoading || ((playerAccess.loaded || playerAccessError) && !force)) return;
    playerAccessLoading = true;
    playerAccessError = '';
    try {
      const loaded = await api.getPlayerAccess();
      playerAccess = normalizePlayerAccessSnapshot(loaded, { commandGroups: {}, capabilityDefinitions: {}, minecraftColors: [] });
    } catch (error) {
      playerAccessError = error?.message || String(error);
    } finally {
      playerAccessLoading = false;
      if (playersView === 'access' && !$('msPlayersPage').hidden) renderPlayers();
    }
  }

  async function beginAccessEdit(player) {
    if (!playerAccess.loaded || playerAccessError) await loadPlayerAccess(true);
    if (!playerAccess.loaded || playerAccessError) {
      toast(playerAccessError || 'Player access is unavailable.', true);
      return;
    }
    const existing = accessAssignmentFor(player);
    const roles = playerAccess.roles;
    if (!roles.length) {
      toast('Create a role before assigning player access.', true);
      window.bridge.openPlayerRoleEditor('');
      return;
    }
    const existingRole = accessRoleById(existing?.roleId);
    pendingAccessDraft = {
      player: existing?.player || String(player || '').trim(),
      roleId: existingRole?.id || roles[0].id
    };
    window.bridge.openMacroNameWindow({
      entity: 'server', action: 'access-role', target: pendingAccessDraft.player, title: `Access for ${pendingAccessDraft.player}`,
      label: 'Role', defaultValue: pendingAccessDraft.roleId, confirmText: 'Save',
      options: roles.map(role => ({ value: role.id, label: `${role.name} — ${roleAccessSummary(role)}` }))
    });
  }

  async function saveAccessDraft() {
    const draft = pendingAccessDraft;
    pendingAccessDraft = null;
    if (!draft || typeof api.setPlayerAccess !== 'function') return;
    try {
      const result = await run(() => api.setPlayerAccess(draft));
      playerAccess = normalizePlayerAccessSnapshot(result);
      renderPlayers();
      if (result?.enforcementReady === false) toast('Access saved. Enable built-in protection to enforce roles.', true);
      else if (result?.restartRequired) toast('Access saved. Restart the server to apply it.');
      else toast('Player access saved.');
    } catch (_) {}
  }

  function renderPlayerAccess(list) {
    if (playerAccessError) {
      renderEmpty(list, 'Could not load access', playerAccessError);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ms-empty-action';
      retry.textContent = 'Retry';
      retry.onclick = () => loadPlayerAccess(true).catch(() => {});
      list.querySelector('.ms-empty-state')?.append(retry);
      return;
    }
    if (!playerAccess.loaded) {
      renderEmpty(list, playerAccessLoading ? 'Loading access…' : 'Access unavailable', '');
      return;
    }
    if (!playerAccess.assignments.length) {
      renderEmpty(list, 'No access assigned', 'Use + to assign a role to a player.');
      return;
    }
    for (const entry of playerAccess.assignments) {
      const role = accessRoleForAssignment(entry);
      const row = document.createElement('div'); row.className = 'ms-list-row ms-player-row';
      const identity = document.createElement('div'); identity.className = 'ms-player-identity ms-access-identity';
      const info = document.createElement('div'); info.className = 'ms-player-copy';
      info.innerHTML = '<strong></strong><span></span>';
      info.querySelector('strong').textContent = entry.player;
      const capabilities = new Set(role.capabilities || []);
      const extras = [];
      if (capabilities.has('player.spectate')) extras.push('Legacy view recovery');
      if (capabilities.has('player.coordinates')) extras.push('coordinates');
      if (capabilities.has('player.dimension')) extras.push('dimension');
      if (capabilities.has('server.stop')) extras.push('server stop');
      if (capabilities.has('server.restart')) extras.push('server restart');
      if (capabilities.has('protection.bypass')) extras.push('protection bypass');
      if (roleTradeDiscountSummary(role)) extras.push(roleTradeDiscountSummary(role));
      const summary = role.unavailable ? 'Choose one of your current roles' : roleAccessSummary(role);
      info.querySelector('span').textContent = extras.length ? `${summary} · ${extras.join(', ')}` : summary;
      const badge = document.createElement('small'); badge.className = 'ms-access-role'; badge.textContent = role.unavailable ? 'Needs role' : (role.name || role.id);
      if (role.appearance?.enabled) {
        badge.classList.add('styled');
        badge.style.color = minecraftColorHex[role.appearance.color] || '';
      }
      const actions = document.createElement('div'); actions.className = 'ms-list-actions';
      actions.append(
        playerAction('edit', `Edit ${entry.player}'s access`, () => beginAccessEdit(entry.player)),
        playerAction('remove', `Remove ${entry.player}'s access`, () => window.bridge.openMacroDeleteWindow({
          entity: 'server', action: 'remove-player-access', id: entry.player, name: entry.player,
          title: 'Remove Player Access', question: `Remove ${entry.player}'s assigned role?`, confirmText: 'Remove'
        }))
      );
      const heading = document.createElement('div'); heading.className = 'ms-player-heading';
      heading.append(info.querySelector('strong'), badge);
      info.prepend(heading);
      identity.append(createPlayerFigure(entry, entry.player), info);
      row.append(identity, actions); list.append(row);
    }
  }

  function renderAccessRoles(list) {
    if (playerAccessError) {
      renderEmpty(list, 'Could not load roles', playerAccessError);
      return;
    }
    if (!playerAccess.loaded) {
      renderEmpty(list, playerAccessLoading ? 'Loading roles…' : 'Roles unavailable', '');
      return;
    }
    if (!playerAccess.roles.length) {
      renderEmpty(list, 'No roles yet', 'Press + to create the first role.');
      return;
    }
    for (const role of playerAccess.roles) {
      const row = document.createElement('div'); row.className = 'ms-list-row ms-role-row';
      const copy = document.createElement('div'); copy.className = 'ms-role-copy';
      const heading = document.createElement('div'); heading.className = 'ms-player-heading';
      const name = document.createElement('strong'); name.textContent = role.name || role.id;
      const count = document.createElement('small'); count.className = 'ms-access-role'; count.textContent = `${Number(role.memberCount) || 0} player${Number(role.memberCount) === 1 ? '' : 's'}`;
      heading.append(name, count);
      const details = document.createElement('span');
      const capabilities = (role.capabilities || []).map(id => playerAccess.capabilityDefinitions?.[id]?.label || id);
      details.textContent = [roleAccessSummary(role), roleTradeDiscountSummary(role), ...capabilities].filter(Boolean).join(' · ');
      copy.append(heading, details);
      const preview = document.createElement('div'); preview.className = 'ms-role-tag-preview';
      const prefix = plainMinecraftText(role.appearance?.prefix);
      const suffix = plainMinecraftText(role.appearance?.suffix);
      preview.textContent = role.appearance?.enabled ? `${prefix}Player${suffix}` : 'Player';
      if (role.appearance?.enabled) preview.style.color = minecraftColorHex[role.appearance?.color] || '';
      const actions = document.createElement('div'); actions.className = 'ms-list-actions';
      actions.append(
        playerAction('edit', `Edit ${role.name || role.id}`, () => window.bridge.openPlayerRoleEditor(role.id)),
        playerAction('remove', `Delete ${role.name || role.id}`, () => window.bridge.openMacroDeleteWindow({
          entity: 'server', action: 'delete-access-role', id: role.id, name: role.name || role.id,
          title: 'Delete Role',
          question: Number(role.memberCount) > 0
            ? `Delete ${role.name || role.id} and remove it from ${role.memberCount} player${Number(role.memberCount) === 1 ? '' : 's'}?`
            : `Delete ${role.name || role.id}?`,
          confirmText: 'Delete'
        }))
      );
      row.append(copy, preview, actions);
      list.append(row);
    }
  }

  function playerRowFingerprint(entry, view) {
    if (!entry || typeof entry !== 'object') return { name: String(entry || '') };
    const fingerprint = {
      name: String(entry.name || entry.player || entry.username || ''),
      uuid: String(entry.uuid || ''),
      id: String(entry.id || '')
    };
    if (view === 'banned') Object.assign(fingerprint, {
      endAt: Number(entry.endAt) || 0,
      expires: String(entry.expires || ''),
      temporary: Boolean(entry.temporary),
      message: String(entry.message || ''),
      reason: String(entry.reason || '')
    });
    if (view === 'history') Object.assign(fingerprint, {
      event: String(entry.event || ''),
      eventType: String(entry.eventType || ''),
      type: String(entry.type || ''),
      lastEvent: String(entry.lastEvent || ''),
      timestamp: String(entry.timestamp || ''),
      occurredAt: String(entry.occurredAt || ''),
      lastActive: String(entry.lastActive || ''),
      lastSeen: String(entry.lastSeen || ''),
      created: String(entry.created || ''),
      reason: String(entry.reason || '')
    });
    if (view === 'access') Object.assign(fingerprint, {
      role: String(entry.roleId || entry.role || ''),
      groups: Array.isArray(entry.groups) ? entry.groups.map(String) : [],
      commands: Array.isArray(entry.commands) ? entry.commands.map(String) : []
    });
    if (view === 'roles') Object.assign(fingerprint, {
      role: String(entry.id || ''),
      roleName: String(entry.name || ''),
      memberCount: Number(entry.memberCount) || 0,
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map(String) : [],
      commands: entry.commands || {},
      appearance: entry.appearance || {}
    });
    return fingerprint;
  }

  function playerRenderSignature(view, entries) {
    const signature = { view, entries: entries.map(entry => playerRowFingerprint(entry, view)) };
    if (view === 'access' || view === 'roles') {
      signature.loaded = playerAccess.loaded;
      signature.loading = playerAccessLoading;
      signature.error = playerAccessError;
      signature.commandGroups = Object.fromEntries(Object.entries(playerAccess.commandGroups || {}).map(([key, group]) => [key, String(group?.label || '')]));
      signature.roles = (playerAccess.roles || []).map(role => playerRowFingerprint(role, 'roles'));
    }
    return JSON.stringify(signature);
  }

  function renderPlayers() {
    const list = $('msPlayersList');
    $('msAddPlayerAccess').hidden = !['access','roles'].includes(playersView) || Boolean(playerAccessError);
    $('msAddPlayerAccess').title = playersView === 'roles' ? 'Create role' : 'Assign player access';
    $('msAddPlayerAccess').setAttribute('aria-label', $('msAddPlayerAccess').title);
    let entries = [];
    if (playersView === 'access') entries = playerAccess.assignments;
    if (playersView === 'roles') entries = playerAccess.roles;
    if (playersView === 'online') entries = status?.players?.sample || [];
    if (playersView === 'banned') entries = status?.bans || [];
    if (playersView === 'history') entries = status?.playerEvents || status?.playerHistoryEvents || status?.playerHistory || [];
    const renderSignature = playerRenderSignature(playersView, entries);
    if (list.dataset.playerRenderSignature === renderSignature && list.childElementCount) {
      if ((playersView === 'access' || playersView === 'roles') && !playerAccess.loaded) loadPlayerAccess().catch(() => {});
      return;
    }
    list.dataset.playerRenderSignature = renderSignature;
    playerBustObserver?.disconnect();
    list.innerHTML = '';
    if (playersView === 'access') {
      renderPlayerAccess(list);
      if (!playerAccess.loaded) loadPlayerAccess().catch(() => {});
      return;
    }
    if (playersView === 'roles') {
      renderAccessRoles(list);
      if (!playerAccess.loaded) loadPlayerAccess().catch(() => {});
      return;
    }
    if (!entries.length) {
      const messages = {
        online: ['No players online', 'Connected players will appear here.'],
        banned: ['No banned players', 'Players you ban will appear here.'],
        history: ['No player history', 'Previously connected players will appear here.']
      };
      renderEmpty(list, ...messages[playersView]);
      return;
    }
    for (const entry of entries) {
      const name = entry.name || entry.player || entry.username || String(entry);
      const row = document.createElement('div'); row.className = 'ms-list-row ms-player-row';
      row.setAttribute('role', 'listitem');
      const identity = createPlayerIdentity(entry, name, playersView);
      const actions = document.createElement('div'); actions.className = 'ms-list-actions';
      if (playersView === 'banned') {
        const pardon = playerAction('pardon', `Pardon ${name}`, async () => { await run(() => api.pardonPlayer(name), 'Player pardoned.'); await refresh(); });
        const shorten = playerAction('shorten', `Change ${name}'s ban duration`, () => window.bridge.openMacroNameWindow({ entity: 'server', action: 'shorten-ban', target: name, title: 'Change Ban Duration', label: 'Duration (m, h, d or w)', placeholder: '30m', defaultValue: '30m', confirmText: 'Update' }));
        actions.append(pardon, shorten);
      } else if (playersView === 'online') {
        const view = playerAction('view', `View ${name}`, () => window.bridge.openPlayerInspector(name));
        const access = playerAction('access', `Set access for ${name}`, () => beginAccessEdit(name).catch(() => {}));
        const compatibility = playerAction('compatible', `Add a compatibility exception for ${name}`, () => openPlayerCompatibility(name));
        const temp = playerAction('temp', `Temporarily ban ${name}`, () => openTempBan(name));
        const ban = playerAction('ban', `Ban ${name}`, () => openBanReason(name));
        actions.append(view, access, compatibility, temp, ban);
      }
      row.append(identity);
      if (actions.childElementCount) row.append(actions);
      else row.classList.add('no-actions');
      list.append(row);
    }
  }

  function playerPageIsVisible() {
    return !document.hidden &&
      !$('minecraftServerView').hidden &&
      !$('msWorkspacePanel').hidden &&
      !$('msPlayersPage').hidden;
  }

  function renderPlayerStreamUpdate(kind = '') {
    if (!status) return;
    if (kind === 'players' && !$('msWorkspacePanel').hidden) renderOverview();
    if (!$('msPlayersPage').hidden && (!kind || kind === 'players' ||
      (kind === 'bans' && playersView === 'banned') ||
      ((kind === 'history' || kind === 'historyEvents') && playersView === 'history'))) {
      renderPlayers();
    }
  }

  function receivePlayerStream(kind, value) {
    if (!rememberPlayerStream(playerStreams, kind, value)) return false;
    if (status) writePlayerStreamValue(status, kind, playerStreams[kind].value);
    renderPlayerStreamUpdate(kind);
    return true;
  }

  function applyPlayerSnapshot(snapshot, requestVersions) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('The player snapshot response was invalid.');
    }
    reconcilePlayerStreams(status || {}, snapshot, playerStreams, requestVersions);
    renderPlayerStreamUpdate();
    return snapshot;
  }

  function refreshPlayerSnapshot() {
    if (typeof api.getPlayerSnapshot !== 'function') return Promise.resolve(null);
    if (playerSnapshotPending) return playerSnapshotPending;
    const generation = ++playerSnapshotRequestGeneration;
    const requestVersions = capturePlayerStreamVersions();
    const invoked = Promise.resolve().then(() => api.getPlayerSnapshot());
    const request = settleWithTimeout(invoked, PLAYER_SNAPSHOT_TIMEOUT_MS, 'The player snapshot request timed out.')
      .then(snapshot => {
        if (generation !== playerSnapshotRequestGeneration) return null;
        return applyPlayerSnapshot(snapshot, requestVersions);
      });
    const tracked = request.finally(() => {
      if (playerSnapshotPending === tracked) playerSnapshotPending = null;
    });
    playerSnapshotPending = tracked;
    return tracked;
  }

  const bundledTeleportIcon = 'minecraft-server/renderer/assets/server-teleport.svg';

  function isBundledTeleportFile(file) {
    return ['serverteleport.jar', 'serverteleport-fabric.jar']
      .includes(String(file?.name || file || '').toLowerCase());
  }

  const bundledVoiceIcon = 'minecraft-server/renderer/assets/proximity-voice.svg';

  function isBundledVoiceFile(file) {
    return ['proximityvoice-server.jar', 'proximityvoice-fabric-server.jar']
      .includes(String(file?.name || file || '').toLowerCase());
  }

  const bundledProtectionIcon = 'minecraft-server/renderer/assets/server-protection.svg';

  function isBundledProtectionFile(file) {
    return ['serverprotection.jar', 'serverprotection-fabric.jar', 'clickintervalanticheat.jar']
      .includes(String(file?.name || file || '').toLowerCase());
  }

  const bundledDeathLootIcon = 'minecraft-server/renderer/assets/server-death-loot.svg';

  function isBundledDeathLootFile(file) {
    return String(file?.name || file || '').toLowerCase() === 'serverdeathloot-fabric.jar';
  }

  const pinnedModPresentation = Object.freeze([
    { match: /^lootr-fabric-/i, title: 'Lootr', author: 'Noobanidus', iconUrl: 'https://cdn.modrinth.com/data/EltpO5cN/3dc915eb1bbcd65654c17eb3870de4aba055d0c6_96.webp' },
    { match: /^servercore-fabric-/i, title: 'ServerCore', author: 'Wesley1808', iconUrl: 'https://cdn.modrinth.com/data/4WWQxlQP/5207e4657a1d0e929506a8c07491a42fa73b0a29_96.webp' },
    { match: /^krypton-/i, title: 'Krypton', author: 'astei', iconUrl: 'https://cdn.modrinth.com/data/fQEb0iXm/3ea60899d060a9286e03b87bfa9e71d0cbe2dde7_96.webp' },
    { match: /^spark-/i, title: 'spark', author: 'lucko', iconUrl: 'https://cdn.modrinth.com/data/l6YH9Als/61a777dd08a8447ac93e8b6372e6d27d48cd1e1a_96.webp' }
  ]);

  function pinnedModDetails(file) {
    return pinnedModPresentation.find(entry => entry.match.test(String(file?.name || file || ''))) || null;
  }

  function installedAddonUpdateKey(kind, file) {
    return `${status?.profiles?.activeProfileId || ''}:${kind}:${String(file?.name || '').toLowerCase()}`;
  }

  function installedAddonUpdateFingerprint(file) {
    return [
      file?.name || '', file?.size || 0, file?.modifiedAt || '', file?.source || '', file?.projectId || '',
      file?.providerVersionId || '', file?.providerFileId || '', file?.gameVersion || '', file?.serverType || ''
    ].join('\u0001');
  }

  function pumpInstalledAddonUpdateQueue() {
    while (installedAddonUpdateActive < INSTALLED_ADDON_UPDATE_CONCURRENCY && installedAddonUpdateQueue.length) {
      const task = installedAddonUpdateQueue.shift();
      if (task.generation !== installedAddonUpdateGeneration || task.profileId !== (status?.profiles?.activeProfileId || '') ||
          installedAddonUpdates.get(task.key)?.requestId !== task.requestId) continue;
      installedAddonUpdateActive += 1;
      Promise.resolve().then(() => api.checkAddonUpdate(task.kind, task.fileName)).then(result => {
        if (task.generation !== installedAddonUpdateGeneration || task.profileId !== (status?.profiles?.activeProfileId || '') ||
            installedAddonUpdates.get(task.key)?.requestId !== task.requestId || result?.stale ||
            (result?.profileId && result.profileId !== task.profileId)) return;
        installedAddonUpdates.set(task.key, {
          ...result,
          fingerprint: task.fingerprint,
          requestId: task.requestId,
          loading: false,
          loadedAt: Date.now()
        });
        installedAddonRenderSignature = '';
        if (!$('msAddonsPage').hidden && addonMode === 'installed' && $('msInstalledAddonKind').value === task.kind) renderInstalledAddons();
      }).catch(error => {
        if (task.generation !== installedAddonUpdateGeneration || installedAddonUpdates.get(task.key)?.requestId !== task.requestId) return;
        installedAddonUpdates.set(task.key, {
          fingerprint: task.fingerprint,
          requestId: task.requestId,
          loading: false,
          loadedAt: Date.now(),
          updateAvailable: false,
          error: neutralServerText(error?.message || 'Update check unavailable.')
        });
        installedAddonRenderSignature = '';
        if (!$('msAddonsPage').hidden && addonMode === 'installed' && $('msInstalledAddonKind').value === task.kind) renderInstalledAddons();
      }).finally(() => {
        installedAddonUpdateActive = Math.max(0, installedAddonUpdateActive - 1);
        pumpInstalledAddonUpdateQueue();
      });
    }
  }

  function queueInstalledAddonUpdateChecks(kind, entries) {
    if (typeof api.checkAddonUpdate !== 'function') return;
    const profileId = status?.profiles?.activeProfileId || '';
    const generation = installedAddonUpdateGeneration;
    const now = Date.now();
    for (const file of entries) {
      const providerManaged = ['modrinth', 'curseforge'].includes(file?.source) && file?.projectId;
      if (!providerManaged && !isBundledTeleportFile(file)) continue;
      const key = installedAddonUpdateKey(kind, file);
      const fingerprint = installedAddonUpdateFingerprint(file);
      const previous = installedAddonUpdates.get(key);
      if (previous?.loading || (previous?.fingerprint === fingerprint && now - previous.loadedAt < INSTALLED_ADDON_UPDATE_TTL_MS)) continue;
      const requestId = `${generation}:${now}:${Math.random()}`;
      installedAddonUpdates.set(key, { loading: true, fingerprint, requestId, loadedAt: 0 });
      installedAddonUpdateQueue.push({ generation, profileId, kind, fileName: file.name, key, fingerprint, requestId });
    }
    pumpInstalledAddonUpdateQueue();
  }

  function createAddonIconAction(action, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ms-addon-icon-action ${action}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = action === 'remove'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/></svg>'
      : action === 'export'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 19h14"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a7 7 0 0 0-12-2L4 9m0 0V4m0 5h5M5 16a7 7 0 0 0 12 2l3-3m0 0v5m0-5h-5"/></svg>';
    return button;
  }

  function installedAddonListSignature(kind, entries) {
    let hashA = 0x811c9dc5;
    let hashB = 0x9e3779b9;
    let textLength = 0;
    const mix = value => {
      const text = String(value ?? '');
      textLength += text.length + 1;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        hashA = Math.imul(hashA ^ code, 0x01000193);
        hashB = Math.imul(hashB + code, 0x5bd1e995) ^ (hashB >>> 13);
      }
      hashA = Math.imul(hashA ^ 0, 0x01000193);
      hashB = Math.imul(hashB + 1, 0x5bd1e995) ^ (hashB >>> 13);
    };
    mix(status?.profiles?.activeProfileId || '');
    mix(status?.state || '');
    mix(kind);
    for (const file of entries) {
      mix(file.name); mix(file.size); mix(file.modifiedAt); mix(file.createdAt); mix(file.fileId);
      mix(file.title); mix(file.author); mix(file.source); mix(file.iconUrl); mix(file.projectId);
      mix(file.providerVersionId); mix(file.providerFileId); mix(file.versionName);
      const update = installedAddonUpdates.get(installedAddonUpdateKey(kind, file));
      mix(update?.loading); mix(update?.updateAvailable); mix(update?.canUpdate);
      mix(update?.latestVersion); mix(update?.error);
    }
    mix(status?.voiceNetwork?.provider?.file || '');
    mix(status?.voiceNetwork?.udpPort || 0);
    mix(status?.voiceNetwork?.network?.mapped);
    mix(status?.voiceNetwork?.firewall?.configured);
    mix(status?.voiceNetwork?.warning || '');
    return `${entries.length}:${textLength}:${hashA >>> 0}:${hashB >>> 0}`;
  }

  function renderInstalledAddons() {
    const list = $('msAddonList');
    const kind = $('msInstalledAddonKind').value;
    if ($('msClientModBundle')) $('msClientModBundle').hidden = kind !== 'mods';
    const entries = status?.[kind] || [];
    queueInstalledAddonUpdateChecks(kind, entries);
    $('msAddonInstalledCount').textContent = `${entries.length} installed`;
    $('msImportAddon').textContent = `Import custom ${kind === 'plugins' ? 'plugin' : 'mod'}`;
    const signature = installedAddonListSignature(kind, entries);
    if (installedAddonRenderSignature === signature && list.dataset.addonRenderMode === 'installed') return;
    const renderScope = `${status?.profiles?.activeProfileId || ''}:${kind}`;
    const previousScrollTop = list.dataset.addonRenderScope === renderScope ? list.scrollTop : 0;
    installedAddonRenderSignature = signature;
    list.dataset.addonRenderMode = 'installed';
    list.dataset.addonRenderScope = renderScope;
    list.innerHTML = '';
    if (!entries.length) {
      renderEmpty(list, `No ${kind} installed`, `Import a jar or find one in Browse.`);
      return;
    }
    for (const file of entries) {
      const bundledTeleport = isBundledTeleportFile(file);
      const bundledVoice = isBundledVoiceFile(file);
      const bundledProtection = isBundledProtectionFile(file);
      const bundledDeathLoot = isBundledDeathLootFile(file);
      const pinnedPresentation = pinnedModDetails(file);
      const simpleVoiceChat = String(status?.voiceNetwork?.provider?.file || '').toLowerCase() === String(file.name || '').toLowerCase();
      const update = installedAddonUpdates.get(installedAddonUpdateKey(kind, file));
      const updateAvailable = Boolean(update?.updateAvailable);
      const row = document.createElement('div'); row.className = 'ms-list-row ms-addon-row';
      const icon = document.createElement('img'); icon.className = 'ms-addon-icon'; icon.alt = ''; icon.loading = 'lazy'; icon.src = file.iconUrl || pinnedPresentation?.iconUrl || 'minecraft-server/renderer/assets/addon-generic.svg';
      if (bundledTeleport) icon.src = bundledTeleportIcon;
      if (bundledVoice) icon.src = bundledVoiceIcon;
      if (bundledProtection) icon.src = bundledProtectionIcon;
      if (bundledDeathLoot) icon.src = bundledDeathLootIcon;
      icon.onerror = () => { icon.onerror = null; icon.src = 'minecraft-server/renderer/assets/addon-generic.svg'; };
      const info = document.createElement('div'); info.className = 'ms-addon-main'; info.innerHTML = '<div class="ms-addon-title"><strong></strong><small>Installed</small></div><span class="ms-addon-description"></span>';
      info.querySelector('strong').textContent = bundledTeleport ? 'Teleport Requests'
        : bundledVoice ? 'Proximity Voice'
          : bundledProtection ? 'Server Protection'
            : bundledDeathLoot ? 'Server Death Loot'
              : simpleVoiceChat ? 'Simple Voice Chat' : pinnedPresentation?.title || file.title || file.name;
      info.querySelector('.ms-addon-title small').textContent = file.author || pinnedPresentation?.author || (file.source && file.source !== 'imported' ? file.source : 'Installed');
      if (updateAvailable) {
        const badge = document.createElement('span');
        badge.className = 'ms-addon-update-badge';
        badge.textContent = 'Update available';
        info.querySelector('.ms-addon-title').append(badge);
        row.classList.add('update-available');
      }
      info.querySelector('.ms-addon-description').textContent = simpleVoiceChat
          ? `UDP ${status.voiceNetwork.udpPort || 24454} · ${status.voiceNetwork.voiceHostSource === 'configured-udp-endpoint' ? 'UDP endpoint set' : status.voiceNetwork.network?.mapped && status.voiceNetwork.network?.publicRouteConfirmed ? 'Router mapped' : status.voiceNetwork.network?.mapped ? 'Public route unconfirmed' : 'Local port ready'} · ${status.voiceNetwork.firewall?.configured ? 'Firewall ready' : 'Firewall needs attention'}`
          : `${file.title && file.title !== file.name ? `${file.name} · ` : ''}${formatBytes(file.size)} · ${kind === 'plugins' ? 'Plugin' : 'Mod'} jar`;
      if (update?.loading) info.querySelector('.ms-addon-description').textContent += ' · Checking for updates…';
      if (update?.updateAvailable) {
        info.querySelector('.ms-addon-description').textContent += ` · ${update.latestVersion || update.latestFile || 'New version'} ready`;
      }
      if (simpleVoiceChat && status.voiceNetwork.warning) {
        const warning = neutralServerText(status.voiceNetwork.warning);
        info.querySelector('.ms-addon-description').textContent += ` · ${warning}`;
        info.querySelector('.ms-addon-description').title = warning;
        row.classList.add('warning');
      }
      const actions = document.createElement('div');
      actions.className = 'ms-addon-actions';
      if (updateAvailable) {
        const updateButton = createAddonIconAction('update', `Update ${info.querySelector('strong').textContent}`);
        const canUpdate = status?.state === 'stopped' && update?.canUpdate !== false &&
          typeof api.updateInstalledAddon === 'function';
        updateButton.disabled = !canUpdate;
        if (!canUpdate) updateButton.title = status?.state !== 'stopped'
          ? 'Stop the server to update this add-on.'
          : neutralServerText(update?.message || 'Update unavailable.');
        updateButton.onclick = async () => {
          if (updateButton.disabled) return;
          updateButton.disabled = true;
          updateButton.classList.add('busy');
          try {
            await run(() => api.updateInstalledAddon(kind, file.name), 'Add-on updated.');
            installedAddonUpdates.delete(installedAddonUpdateKey(kind, file));
            installedAddonRenderSignature = '';
            await refresh(true);
            renderInstalledAddons();
          } catch (_) {
            updateButton.disabled = false;
            updateButton.classList.remove('busy');
          }
        };
        actions.append(updateButton);
      }
      const remove = createAddonIconAction('remove', `Remove ${info.querySelector('strong').textContent}`);
      remove.disabled = status?.state !== 'stopped';
      if (remove.disabled) remove.title = 'Stop the server to remove this add-on.';
      remove.onclick = async () => {
        if (remove.disabled) return;
        remove.disabled = true;
        remove.classList.add('busy');
        try {
          await run(() => api.deleteJar(kind, file.name), 'Add-on removed.');
          installedAddonUpdates.delete(installedAddonUpdateKey(kind, file));
          installedAddonRenderSignature = '';
          await refresh(true);
          renderInstalledAddons();
        } catch (_) {
          remove.disabled = false;
          remove.classList.remove('busy');
        }
      };
      actions.append(remove);
      row.append(icon, info, actions);
      list.append(row);
    }
    list.scrollTop = Math.min(previousScrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
  }

  function normalizeAddonName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function addonInstallKey(addon, profileId = status?.profiles?.activeProfileId || '') {
    return `${profileId}:${addon.source || 'modrinth'}:${addon.id || addon.slug || addon.title}`;
  }

  function isAddonInstalled(addon, kind) {
    const key = addonInstallKey(addon);
    if (installedAddonKeys.has(key)) return true;
    const needles = [addon.slug, addon.title].map(normalizeAddonName).filter(value => value.length >= 4);
    return (status?.[kind] || []).some(file => {
      const name = normalizeAddonName(String(file.name || '').replace(/\.jar$/i, ''));
      return needles.some(needle => name.includes(needle) || needle.includes(name));
    });
  }

  function addonBrowseScope() {
    return [
      status?.profiles?.activeProfileId || '',
      $('msAddonKind').value,
      $('msAddonSource').value,
      String($('msAddonSearch').value || '').trim()
    ].join('\u0001');
  }

  function createAddonResultRow(addon, kind) {
    const row = document.createElement('div'); row.className = 'ms-list-row ms-addon-row';
    const icon = document.createElement('img'); icon.className = 'ms-addon-icon'; icon.alt = ''; icon.loading = 'lazy'; icon.src = addon.iconUrl || 'minecraft-server/renderer/assets/addon-generic.svg';
    icon.onerror = () => { icon.onerror = null; icon.src = 'minecraft-server/renderer/assets/addon-generic.svg'; };
    const info = document.createElement('div'); info.className = 'ms-addon-main'; info.innerHTML = '<div class="ms-addon-title"><strong></strong><small></small></div><span class="ms-addon-description"></span><span class="ms-addon-meta"></span>';
    info.querySelector('strong').textContent = addon.title || addon.name || addon.slug || 'Untitled add-on';
    info.querySelector('small').textContent = addon.author || addon.source || '';
    info.querySelector('.ms-addon-description').textContent = addon.description || 'No description provided.';
    const sourceLabel = addon.source === 'curseforge' ? 'CurseForge' : 'Modrinth';
    const sourceIcon = addon.source === 'curseforge' ? 'minecraft-server/renderer/assets/source-curseforge.svg' : 'minecraft-server/renderer/assets/source-modrinth.svg';
    info.querySelector('.ms-addon-meta').innerHTML = `<span class="ms-addon-status"><img class="ms-addon-source-icon" alt="" src="${sourceIcon}">${sourceLabel} · ${formatCount(addon.downloads)} downloads</span>`;
    const install = document.createElement('button'); install.className = 'ms-addon-action';
    const installed = isAddonInstalled(addon, kind);
    install.textContent = installed ? 'Installed' : 'Install';
    install.disabled = installed || status?.state !== 'stopped';
    if (!installed && status?.state !== 'stopped') install.title = 'Stop the server to install add-ons.';
    install.classList.toggle('installed', installed);
    install.onclick = async () => {
      if (install.disabled) return;
      const profileId = status?.profiles?.activeProfileId || '';
      install.disabled = true; install.classList.add('busy'); install.textContent = 'Installing…';
      try {
        await run(() => api.installAddon({ ...addon, kind, serverType: status?.config?.serverType }), 'Add-on installed.');
        installedAddonKeys.add(addonInstallKey(addon, profileId));
        await refresh(true);
        install.classList.remove('busy'); install.classList.add('installed'); install.textContent = 'Installed';
      } catch (_) {
        install.disabled = false; install.classList.remove('busy'); install.textContent = 'Install';
      }
    };
    row.append(icon, info, install);
    return row;
  }

  function addonBrowseSignature(message = '') {
    const kind = $('msAddonKind').value;
    const files = (status?.[kind] || []).map(file => `${file.name}:${file.size}:${file.modifiedAt || ''}`).join('\u0002');
    const first = addonResults[0];
    const last = addonResults.at(-1);
    return [
      addonBrowseScope(), addonResults.length,
      first ? `${first.source}:${first.id || first.slug}` : '',
      last ? `${last.source}:${last.id || last.slug}` : '',
      files, installedAddonKeys.size, message
    ].join('\u0001');
  }

  function renderAddonResults(message = '', options = {}) {
    const list = $('msAddonList');
    const scope = addonBrowseScope();
    const kind = $('msAddonKind').value;
    const appendFrom = Number.isInteger(options.appendFrom) ? options.appendFrom : -1;
    if (appendFrom >= 0 && list.dataset.addonRenderMode === 'browse' && list.dataset.addonRenderScope === scope) {
      const fragment = document.createDocumentFragment();
      for (const addon of addonResults.slice(appendFrom)) fragment.append(createAddonResultRow(addon, kind));
      list.append(fragment);
      list.dataset.addonResultCount = String(addonResults.length);
      addonBrowseRenderSignature = addonBrowseSignature(message);
      return;
    }

    const signature = addonBrowseSignature(message);
    if (addonBrowseRenderSignature === signature && list.dataset.addonRenderMode === 'browse' &&
        list.dataset.addonRenderScope === scope) return;

    const preserveScroll = list.dataset.addonRenderMode === 'browse' && list.dataset.addonRenderScope === scope;
    const previousScrollTop = preserveScroll ? list.scrollTop : 0;
    list.dataset.addonRenderMode = 'browse';
    list.dataset.addonRenderScope = scope;
    list.dataset.addonResultCount = String(addonResults.length);
    addonBrowseRenderSignature = signature;
    list.innerHTML = '';
    if (!addonResults.length) {
      const keyRequired = /api key/i.test(message);
      renderEmpty(list, keyRequired ? 'CurseForge needs an API key' : message ? 'Add-on browsing unavailable' : 'No add-ons found', message || 'Try another name, type, or source.');
      if (keyRequired && typeof api.setCurseForgeApiKey === 'function') {
        const connect = document.createElement('button');
        connect.className = 'ms-empty-action';
        connect.type = 'button';
        connect.textContent = 'Connect CurseForge';
        connect.onclick = () => window.bridge.openMacroNameWindow({ entity: 'server', action: 'curseforge-key', title: 'Connect CurseForge', label: 'CurseForge API key', placeholder: 'Paste API key', confirmText: 'Connect', secret: true });
        list.firstElementChild?.append(connect);
      }
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const addon of addonResults) fragment.append(createAddonResultRow(addon, kind));
    list.append(fragment);
    if (preserveScroll) list.scrollTop = Math.min(previousScrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
  }

  function normalizeModPolicy(value) {
    const source = value && typeof value === 'object' ? value : {};
    const clean = list => (Array.isArray(list) ? list : []).map(entry => {
      if (typeof entry === 'string') return { modId: entry };
      return { ...entry, modId: String(entry?.modId || entry?.id || entry?.slug || '').trim() };
    }).filter(entry => entry.modId);
    return {
      ...source,
      allowedMods: clean(source.allowedMods || source.allowlist || source.allowed || source.modPolicy?.allowed),
      blockedMods: clean(source.blockedMods || source.blocklist || source.blocked || source.modPolicy?.blocked),
      playerExceptions: Array.isArray(source.playerExceptions)
        ? source.playerExceptions
        : Object.entries(source.compatibility?.playerOverrides || {}).map(([player, rule]) => ({ player, ...rule }))
    };
  }

  async function loadModPolicy(force = false) {
    if (modPolicyLoading || typeof api.getModPolicy !== 'function') return;
    if (!force && modPolicy?.loaded) return;
    modPolicyLoading = true;
    if (addonMode === 'allowed' || addonMode === 'blocked') renderModPolicy();
    try {
      modPolicy = { ...normalizeModPolicy(await api.getModPolicy()), loaded: true };
    } catch (error) {
      modPolicy = { ...normalizeModPolicy(null), loaded: true, error: error?.message || String(error) };
    } finally {
      modPolicyLoading = false;
      if (addonMode === 'allowed' || addonMode === 'blocked') renderModPolicy();
    }
  }

  function policyFromMutation(result) {
    return result?.policy || result?.config || (result?.modPolicy || result?.allowedMods || result?.blockedMods ? result : null);
  }

  function renderPlayerCompatibilityExceptions(list) {
    const exceptions = (Array.isArray(modPolicy.playerExceptions) ? modPolicy.playerExceptions : [])
      .filter(entry => String(entry?.player || '').trim());
    if (!exceptions.length) return;
    const section = document.createElement('section');
    section.className = 'ms-compat-exceptions';
    const heading = document.createElement('div');
    heading.className = 'ms-compat-heading';
    heading.innerHTML = '<strong>Runtime-check exceptions</strong><span>Applies to the bundled Server Protection adapter</span>';
    section.append(heading);
    for (const entry of exceptions) {
      const player = String(entry.player || '').trim();
      const sourceChecks = Array.isArray(entry.exemptChecks) ? entry.exemptChecks : Array.isArray(entry.checks) ? entry.checks : [];
      const checks = [...new Set(sourceChecks.map(value => String(value || '').trim()).filter(Boolean))];
      const row = document.createElement('div');
      row.className = 'ms-compat-row';
      const info = document.createElement('div');
      info.innerHTML = '<strong></strong><span></span>';
      info.querySelector('strong').textContent = String(entry.name || player);
      const exactChecks = checks.join(', ');
      const checkLabel = info.querySelector('span');
      checkLabel.textContent = exactChecks;
      checkLabel.title = exactChecks;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ms-compat-remove';
      remove.title = `Remove built-in protection exception for ${player}`;
      remove.setAttribute('aria-label', `Remove built-in protection exception for ${player}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/></svg>';
      remove.onclick = async () => {
        if (typeof api.removePlayerModException !== 'function') { toast('Compatibility exception removal is unavailable in this build.', true); return; }
        remove.disabled = true;
        try {
          const result = await run(() => api.removePlayerModException({ player }), 'Compatibility exception removed.');
          modPolicy = { ...normalizeModPolicy(policyFromMutation(result) || await api.getModPolicy()), loaded: true };
          renderModPolicy();
        } catch (_) { remove.disabled = false; }
      };
      row.append(info, remove);
      section.append(row);
    }
    list.append(section);
  }

  function renderModPolicy() {
    const list = $('msAddonList');
    list.dataset.addonRenderMode = 'policy';
    list.innerHTML = '';
    const allowed = addonMode === 'allowed';
    const entries = allowed ? modPolicy.allowedMods : modPolicy.blockedMods;
    if (modPolicyLoading) { renderEmpty(list, 'Loading mod policy…'); return; }
    if (modPolicy.error) { renderEmpty(list, 'Mod policy unavailable', modPolicy.error); return; }
    const hasPlayerExceptions = allowed && Array.isArray(modPolicy.playerExceptions) && modPolicy.playerExceptions.some(entry => String(entry?.player || '').trim());
    if (!entries.length && !hasPlayerExceptions) {
      renderEmpty(
        list,
        allowed ? 'No allowed mods' : 'No blocked mods',
        allowed
          ? 'Add mod IDs that compatible clients may declare without being rejected.'
          : 'Add declared mod IDs that compatible clients must not use.'
      );
      return;
    }
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'ms-policy-empty-row';
      empty.textContent = 'No allowed mod rules';
      list.append(empty);
    }
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'ms-list-row ms-policy-row';
      const info = document.createElement('div');
      info.innerHTML = '<strong></strong><span></span>';
      info.querySelector('strong').textContent = entry.modId;
      info.querySelector('span').textContent = entry.label || (allowed ? 'Allowed when declared' : 'Blocked when declared');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ms-addon-action';
      remove.textContent = 'Remove';
      remove.onclick = async () => {
        if (typeof api.removeModPolicyRule !== 'function') { toast('Mod policy editing is unavailable in this build.', true); return; }
        remove.disabled = true;
        try {
          const result = await run(() => api.removeModPolicyRule({ list: allowed ? 'allowed' : 'blocked', modId: entry.modId }), 'Mod policy updated.');
          const supplied = policyFromMutation(result);
          modPolicy = { ...normalizeModPolicy(supplied || await api.getModPolicy()), loaded: true };
          renderModPolicy();
        } catch (_) { remove.disabled = false; }
      };
      row.append(info, remove);
      list.append(row);
    }
    if (allowed) renderPlayerCompatibilityExceptions(list);
  }

  function renderAddons() {
    const supportedKind = addonKindForType();
    if (!addonKindInitialized) {
      const preferredKind = supportedKind || 'mods';
      $('msAddonKind').value = preferredKind;
      $('msInstalledAddonKind').value = preferredKind;
      addonKindInitialized = true;
    }
    const installed = addonMode === 'installed';
    const browsing = addonMode === 'browse';
    const policy = addonMode === 'allowed' || addonMode === 'blocked';
    const tabs = { msAddonInstalledTab: 'installed', msAddonBrowseTab: 'browse', msAddonAllowedTab: 'allowed', msAddonBlockedTab: 'blocked' };
    for (const [id, mode] of Object.entries(tabs)) {
      $(id).classList.toggle('active', addonMode === mode);
      $(id).setAttribute('aria-selected', String(addonMode === mode));
    }
    $('msImportAddon').hidden = policy || !supportedKind;
    $('msImportAddon').disabled = !supportedKind;
    $('msDownloadServerAddons').hidden = false;
    $('msDownloadServerAddons').disabled = false;
    $('msAddonBrowseTab').disabled = !supportedKind;
    $('msAddonInstalledTools').hidden = !installed || !supportedKind;
    if ($('msClientModBundle')) $('msClientModBundle').hidden = !installed || $('msInstalledAddonKind').value !== 'mods';
    $('msAddonBrowseTools').hidden = !browsing || !supportedKind;
    $('msAddonPolicyTools').hidden = !policy;
    if (!supportedKind && !policy) renderEmpty($('msAddonList'), 'Vanilla has no add-on loader', 'Vanilla cannot load mods or plugins. Select a compatible server type in Settings.');
    else if (installed) renderInstalledAddons();
    else if (browsing && addonLoading) renderAddonResults('Searching add-ons…');
    else if (browsing && addonResults.length) renderAddonResults();
    else if (browsing) searchAddons();
    else {
      renderModPolicy();
      loadModPolicy().catch(() => {});
    }
  }

  function renderStorage() {
    updateDataResetControls();
    const mods = status?.mods || [], plugins = status?.plugins || [];
    const total = [...mods, ...plugins].reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    $('msStorageSummary').innerHTML = `<div><span>Mods</span><b>${mods.length}</b></div><div><span>Plugins</span><b>${plugins.length}</b></div><div><span>Managed add-ons</span><b>${formatBytes(total)}</b></div>`;
  }

  function canResetServerData(profileId = status?.profiles?.activeProfileId) {
    return Boolean(profileId && profileId === status?.profiles?.activeProfileId &&
      status?.state === 'stopped' && !serverDataResetBusy && $('msLoadingOverlay')?.hidden);
  }

  function updateDataResetControls() {
    for (const id of ['msWipeData', 'msResetDataSettings']) {
      const button = $(id);
      if (!button) continue;
      button.disabled = !canResetServerData();
      button.title = status?.state !== 'stopped' ? 'Stop the server before resetting its world.' :
        serverDataResetBusy ? 'Creating backup and resetting world…' : 'Reset the world, player progress and history, and unban everyone. Settings are kept by default.';
    }
    const hint = $('msResetDataHint');
    if (hint) hint.textContent = status?.state !== 'stopped' ? 'Stop the server to enable Reset Data.' : 'Creates a backup first. Settings are kept unless you choose to reset them.';
    if (pendingDataReset && (pendingDataReset.profileId !== status?.profiles?.activeProfileId || status?.state !== 'stopped')) pendingDataReset = null;
  }

  function requestServerDataReset() {
    if (!canResetServerData()) { toast('Stop the server and wait for current tasks to finish before resetting data.', true); return; }
    const profile = activeProfile();
    pendingDataReset = { profileId: status.profiles.activeProfileId, requestId: `world-reset-${Date.now()}-${++dataResetSequence}` };
    window.bridge.openMacroDeleteWindow({
      entity: 'server', action: 'wipe', id: pendingDataReset.profileId, requestId: pendingDataReset.requestId,
      name: profile?.name || 'this server', title: 'Reset Data', confirmText: 'Reset Data',
      question: `Reset the entire world for “${profile?.name || 'this server'}”? This resets all dimensions and player progress, clears joined-player history, and unbans everyone. Lootr is also removed. Operators and the whitelist are kept. A backup is created first. Settings are kept unless selected below.`
    });
  }

  async function confirmServerDataReset(payload) {
    const request = pendingDataReset;
    if (!request || payload?.id !== request.profileId || payload?.requestId !== request.requestId || !canResetServerData(request.profileId)) {
      toast('Reset canceled because the server or its state changed. Open Reset Data again.', true);
      return;
    }
    pendingDataReset = null;
    serverDataResetBusy = true;
    setLoading(true, 'Creating backup and resetting world…');
    try {
      const resetFields = Array.isArray(payload.resetFields) ? payload.resetFields : [];
      const result = await run(() => api.wipeData({ profileId: request.profileId, resetSettings: payload.resetSettings === true, resetFields }));
      if (result?.reset && result.profileId === status?.profiles?.activeProfileId) {
        if (result.config) status.config = result.config;
        clearResetPlayerRecords();
        if (result.resetSettings || result.resetFields?.length) { settingsDirty = false; hydrateSettings(); }
      }
      await refresh(true);
      toast(result?.resetSettings || result?.resetFields?.length ? 'World, player history and bans reset. Selected settings reset; other settings kept. Backup saved.' : 'World, player history and bans reset. Settings kept. Backup saved.');
    } catch (_) {
      // run() already displays the backend error; a rejected reset never retries.
    } finally {
      serverDataResetBusy = false;
      setLoading(false);
    }
  }

  function clearResetPlayerRecords() {
    playerSnapshotRequestGeneration += 1;
    playerSnapshotPending = null;
    for (const kind of ['players', 'bans', 'history', 'historyEvents']) {
      const value = kind === 'players' ? { online: 0, max: status?.config?.maxPlayers || 0, sample: [] } : [];
      rememberPlayerStream(playerStreams, kind, value);
      writePlayerStreamValue(status, kind, value);
    }
  }

  function clampProtectionNumber(value, fallback, min, max) {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function clampProtectionDecimal(value, fallback, min, max, digits = 2) {
    const number = Number(value);
    const selected = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    const scale = 10 ** digits;
    return Math.round(selected * scale) / scale;
  }

  function defaultProtectionTuning(preset = 'balanced') {
    const source = preset === 'strict' ? strictTuning : preset === 'compatibility' ? compatibilityTuning : balancedTuning;
    return {
      minimumTps: source.minimumTps,
      grace: { ...source.grace },
      response: { ...source.response },
      reach: { ...source.reach },
      limits: { ...source.limits }
    };
  }

  function normalizeProtectionTuning(value, preset = 'balanced') {
    const fallback = defaultProtectionTuning(preset);
    const source = value && typeof value === 'object' ? value : {};
    const grace = source.grace && typeof source.grace === 'object' ? source.grace : {};
    const response = source.response && typeof source.response === 'object' ? source.response : {};
    const reach = source.reach && typeof source.reach === 'object' ? source.reach : {};
    const limits = source.limits && typeof source.limits === 'object' ? source.limits : {};
    const alertVl = clampProtectionDecimal(response.alertVl, fallback.response.alertVl, 1, 100, 2);
    const maxInventoryClicksPerSecond = clampProtectionNumber(limits.maxInventoryClicksPerSecond, fallback.limits.maxInventoryClicksPerSecond, 1, 200);
    const inventoryEvidenceSamples = clampProtectionNumber(limits.inventoryEvidenceSamples, fallback.limits.inventoryEvidenceSamples, 2, 8);
    const inventorySampleIntervalMillis = clampProtectionNumber(limits.inventorySampleIntervalMillis, fallback.limits.inventorySampleIntervalMillis, 100, 1000);
    return {
      minimumTps: clampProtectionDecimal(source.minimumTps, fallback.minimumTps, 10, 20, 2),
      grace: {
        joinSeconds: clampProtectionDecimal(grace.joinSeconds, fallback.grace.joinSeconds, 2, 30, 1),
        teleportSeconds: clampProtectionDecimal(grace.teleportSeconds, fallback.grace.teleportSeconds, 2, 30, 1),
        velocitySeconds: clampProtectionDecimal(grace.velocitySeconds, fallback.grace.velocitySeconds, 1, 15, 1)
      },
      response: {
        alertVl,
        kickVl: clampProtectionDecimal(response.kickVl, fallback.response.kickVl, Math.max(2, alertVl + 0.1), 200, 2),
        actionCooldownSeconds: clampProtectionDecimal(response.actionCooldownSeconds, fallback.response.actionCooldownSeconds, 1, 300, 1),
        violationDecay: clampProtectionDecimal(response.violationDecay, fallback.response.violationDecay, 0, 10, 3)
      },
      reach: {
        geometryAllowance: clampProtectionDecimal(reach.geometryAllowance, fallback.reach.geometryAllowance, 0.025, 0.25, 4),
        maxPingAllowance: clampProtectionDecimal(reach.maxPingAllowance, fallback.reach.maxPingAllowance, 0.15, 0.5, 4),
        pingAllowancePerMs: clampProtectionDecimal(reach.pingAllowancePerMs, fallback.reach.pingAllowancePerMs, 0.0005, 0.002, 6),
        maxTickAllowance: clampProtectionDecimal(reach.maxTickAllowance, fallback.reach.maxTickAllowance, 0.05, 0.25, 4),
        tickAllowancePerMissingTps: clampProtectionDecimal(reach.tickAllowancePerMissingTps, fallback.reach.tickAllowancePerMissingTps, 0.025, 0.1, 4),
        maxTargetRewind: clampProtectionDecimal(reach.maxTargetRewind, fallback.reach.maxTargetRewind, 0.25, 0.75, 3),
        baseRewindTicks: clampProtectionDecimal(reach.baseRewindTicks, fallback.reach.baseRewindTicks, 0.25, 1.5, 3),
        pingRewindTicksPerMs: clampProtectionDecimal(reach.pingRewindTicksPerMs, fallback.reach.pingRewindTicksPerMs, 0.005, 0.02, 5),
        maxRewindTicks: clampProtectionDecimal(reach.maxRewindTicks, fallback.reach.maxRewindTicks, 1.5, 5, 2),
        immediateExcess: clampProtectionDecimal(reach.immediateExcess, fallback.reach.immediateExcess, 0.5, 2, 3),
        consecutiveSamples: clampProtectionNumber(reach.consecutiveSamples, fallback.reach.consecutiveSamples, 2, 6),
        evidenceWindowMillis: clampProtectionNumber(reach.evidenceWindowMillis, fallback.reach.evidenceWindowMillis, 750, 5000)
      },
      limits: {
        maxGroundBlocksPerTick: clampProtectionDecimal(limits.maxGroundBlocksPerTick, fallback.limits.maxGroundBlocksPerTick, 0.25, 5, 3),
        maxAirBlocksPerTick: clampProtectionDecimal(limits.maxAirBlocksPerTick, fallback.limits.maxAirBlocksPerTick, 0.25, 5, 3),
        maxAirTicks: clampProtectionNumber(limits.maxAirTicks, fallback.limits.maxAirTicks, 20, 600),
        phaseSamples: clampProtectionNumber(limits.phaseSamples, fallback.limits.phaseSamples, 2, 10),
        groundSpoofSamples: clampProtectionNumber(limits.groundSpoofSamples, fallback.limits.groundSpoofSamples, 3, 12),
        waterWalkSamples: clampProtectionNumber(limits.waterWalkSamples, fallback.limits.waterWalkSamples, 3, 16),
        stepSamples: clampProtectionNumber(limits.stepSamples, fallback.limits.stepSamples, 2, 8),
        maxUseItemBlocksPerTick: clampProtectionDecimal(limits.maxUseItemBlocksPerTick, fallback.limits.maxUseItemBlocksPerTick, 0.08, 0.5, 3),
        noSlowSamples: clampProtectionNumber(limits.noSlowSamples, fallback.limits.noSlowSamples, 3, 16),
        maxPacketsPerSecond: clampProtectionNumber(limits.maxPacketsPerSecond, fallback.limits.maxPacketsPerSecond, 21, 100),
        timerEvidenceWindows: clampProtectionNumber(limits.timerEvidenceWindows, fallback.limits.timerEvidenceWindows, 2, 6),
        maxReach: clampProtectionDecimal(limits.maxReach, fallback.limits.maxReach, 2.5, 8, 3),
        maxCps: clampProtectionNumber(limits.maxCps, fallback.limits.maxCps, 5, 40),
        wallHitSamples: clampProtectionNumber(limits.wallHitSamples, fallback.limits.wallHitSamples, 6, 12),
        multiTargetCount: clampProtectionNumber(limits.multiTargetCount, fallback.limits.multiTargetCount, 2, 16),
        multiTargetWindowMillis: clampProtectionNumber(limits.multiTargetWindowMillis, fallback.limits.multiTargetWindowMillis, 100, 5000),
        maxAimDeviationDegrees: clampProtectionDecimal(limits.maxAimDeviationDegrees, fallback.limits.maxAimDeviationDegrees, 20, 120, 2),
        aimEvidenceSamples: clampProtectionNumber(limits.aimEvidenceSamples, fallback.limits.aimEvidenceSamples, 2, 12),
        aimEvidenceWindowMillis: clampProtectionNumber(limits.aimEvidenceWindowMillis, fallback.limits.aimEvidenceWindowMillis, 500, 5000),
        rapidSwitchMillis: clampProtectionNumber(limits.rapidSwitchMillis, fallback.limits.rapidSwitchMillis, 40, 300),
        rapidSwitchAngleDegrees: clampProtectionDecimal(limits.rapidSwitchAngleDegrees, fallback.limits.rapidSwitchAngleDegrees, 45, 170, 2),
        rapidSwitchSamples: clampProtectionNumber(limits.rapidSwitchSamples, fallback.limits.rapidSwitchSamples, 2, 8),
        rapidSwitchEvidenceWindowMillis: clampProtectionNumber(limits.rapidSwitchEvidenceWindowMillis, fallback.limits.rapidSwitchEvidenceWindowMillis, 300, 5000),
        clickPatternSamples: clampProtectionNumber(limits.clickPatternSamples, fallback.limits.clickPatternSamples, 8, 24),
        clickPatternMaxDeviationMillis: clampProtectionDecimal(limits.clickPatternMaxDeviationMillis, fallback.limits.clickPatternMaxDeviationMillis, 0, 20, 2),
        criticalSamples: clampProtectionNumber(limits.criticalSamples, fallback.limits.criticalSamples, 2, 8),
        criticalWindowMillis: clampProtectionNumber(limits.criticalWindowMillis, fallback.limits.criticalWindowMillis, 500, 10000),
        blockReachAllowance: clampProtectionDecimal(limits.blockReachAllowance, fallback.limits.blockReachAllowance, 0.25, 3, 2),
        maxBreaksPerSecond: clampProtectionNumber(limits.maxBreaksPerSecond, fallback.limits.maxBreaksPerSecond, 1, 100),
        maxPlacesPerSecond: clampProtectionNumber(limits.maxPlacesPerSecond, fallback.limits.maxPlacesPerSecond, 1, 100),
        scaffoldAimDegrees: clampProtectionDecimal(limits.scaffoldAimDegrees, fallback.limits.scaffoldAimDegrees, 45, 140, 2),
        scaffoldSamples: clampProtectionNumber(limits.scaffoldSamples, fallback.limits.scaffoldSamples, 2, 10),
        scaffoldWindowMillis: clampProtectionNumber(limits.scaffoldWindowMillis, fallback.limits.scaffoldWindowMillis, 500, 10000),
        multiBreakSamples: clampProtectionNumber(limits.multiBreakSamples, fallback.limits.multiBreakSamples, 3, 12),
        multiBreakWindowMillis: clampProtectionNumber(limits.multiBreakWindowMillis, fallback.limits.multiBreakWindowMillis, 100, 2000),
        multiBreakMinSpan: clampProtectionDecimal(limits.multiBreakMinSpan, fallback.limits.multiBreakMinSpan, 1.5, 10, 2),
        maxChatPerFiveSeconds: clampProtectionNumber(limits.maxChatPerFiveSeconds, fallback.limits.maxChatPerFiveSeconds, 1, 100),
        maxCommandsPerFiveSeconds: clampProtectionNumber(limits.maxCommandsPerFiveSeconds, fallback.limits.maxCommandsPerFiveSeconds, 1, 200),
        maxInventoryClicksPerSecond,
        inventoryEvidenceSamples,
        inventorySampleIntervalMillis,
        inventoryEvidenceWindowMillis: clampProtectionNumber(
          limits.inventoryEvidenceWindowMillis,
          fallback.limits.inventoryEvidenceWindowMillis,
          inventorySampleIntervalMillis * (inventoryEvidenceSamples - 1),
          10000
        ),
        maxInventoryBurstPacketsPerSecond: clampProtectionNumber(
          limits.maxInventoryBurstPacketsPerSecond,
          fallback.limits.maxInventoryBurstPacketsPerSecond,
          Math.max(20, maxInventoryClicksPerSecond + 1),
          1000
        ),
        inventoryViolationCooldownMillis: clampProtectionNumber(
          limits.inventoryViolationCooldownMillis,
          fallback.limits.inventoryViolationCooldownMillis,
          500,
          30000
        )
      }
    };
  }

  function normalizeProtectionMessageEntry(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const text = String(source.text || '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 512);
    const rawColor = String(source.color || '').trim().toLowerCase();
    const color = /^#[0-9a-f]{6}$/.test(rawColor) ? rawColor : minecraftColorHex[rawColor] || fallback.color;
    return { text: text || fallback.text, color };
  }

  function normalizeProtectionMessages(value) {
    const source = value && typeof value === 'object' ? value : {};
    const output = {};
    for (const [key, fallback] of Object.entries(protectionMessageDefaults)) output[key] = normalizeProtectionMessageEntry(source[key], fallback);
    output.warningCooldownSeconds = clampProtectionNumber(source.warningCooldownSeconds, 10, 1, 300);
    output.banSource = String(source.banSource || '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || 'Server protection';
    output.checks = {};
    const checks = source.checks && typeof source.checks === 'object' ? source.checks : {};
    for (const key of protectionCheckKeys) {
      if (Object.prototype.hasOwnProperty.call(checks, key)) output.checks[key] = normalizeProtectionMessageEntry(checks[key], output.warning);
    }
    return output;
  }

  function protectionValueAt(source, path) {
    return path.split('.').reduce((value, key) => value?.[key], source);
  }

  function setProtectionValueAt(target, path, value) {
    const parts = path.split('.');
    let cursor = target;
    while (parts.length > 1) {
      const key = parts.shift();
      if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[parts[0]] = value;
  }

  function protectionStep(config, action, fallbackOffense, fallbackDuration = 0) {
    const source = Array.isArray(config?.escalation?.steps) ? config.escalation.steps.find(step => step?.action === action) : null;
    return {
      offense: clampProtectionNumber(source?.offense, fallbackOffense, 1, 100),
      action,
      durationMinutes: action === 'temp-ban' ? clampProtectionNumber(source?.durationMinutes, fallbackDuration, 1, 525600) : 0
    };
  }

  function normalizeProtectionConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const declaredPreset = ['compatibility','balanced','strict','custom'].includes(source.preset) ? source.preset : 'balanced';
    const presetChecks = declaredPreset === 'strict' ? strictChecks
      : declaredPreset === 'compatibility' ? compatibilityChecks : balancedChecks;
    const sourceChecks = source.checks && typeof source.checks === 'object' ? source.checks : presetChecks;
    const checks = Object.fromEntries(protectionCheckKeys.map(key => [
      key,
      Object.prototype.hasOwnProperty.call(sourceChecks, key) ? sourceChecks[key] !== false : presetChecks[key]
    ]));
    const layers = source.layers && typeof source.layers === 'object' ? source.layers : {};
    const kick = protectionStep(source, 'kick', 3);
    const tempBan = protectionStep(source, 'temp-ban', 5, 60);
    const ban = protectionStep(source, 'ban', 8);
    const tuning = normalizeProtectionTuning(source.tuning, declaredPreset);
    const preset = declaredPreset === 'custom' ? 'custom' : inferProtectionPreset(checks, tuning);
    return {
      ...source,
      preset,
      enabled: source.enabled !== false,
      version: 6,
      layers: {
        builtIn: layers.builtIn !== false,
        antiXray: Boolean(layers.antiXray),
        // Withholding tracked players also removes their nametags and causes PvP pop-in.
        // The managed runtime now always preserves vanilla player visibility.
        espMitigation: false
      },
      checks,
      escalation: {
        ...(source.escalation || {}),
        enabled: source.escalation?.enabled !== false,
        preThresholdAction: source.escalation?.preThresholdAction === 'log' ? 'log' : 'warn',
        decayHours: clampProtectionNumber(source.escalation?.decayHours, 24, 1, 720),
        steps: [kick, tempBan, ban]
      },
      exemptions: {
        owners: Boolean(source.exemptions?.owners),
        admins: Boolean(source.exemptions?.admins),
        players: [...new Map((Array.isArray(source.exemptions?.players) ? source.exemptions.players : [])
          .map(player => String(player || '').trim())
          .filter(player => /^[A-Za-z0-9_]{1,16}$/.test(player))
          .map(player => [player.toLowerCase(), player])).values()]
      },
      messages: normalizeProtectionMessages(source.messages),
      tuning
    };
  }

  function setProtectionSaveState(text, state = '') {
    const element = $('msProtectionSaveState');
    element.textContent = text;
    element.className = state;
  }

  function inferProtectionPreset(checks, tuning = protectionConfig?.tuning, keys = protectionCheckKeys) {
    const comparedKeys = Array.isArray(keys) && keys.length ? keys : protectionCheckKeys;
    const matches = preset => comparedKeys.every(key => Boolean(checks?.[key]) === Boolean(preset[key]));
    const tuningMatches = preset => JSON.stringify(normalizeProtectionTuning(tuning, preset)) === JSON.stringify(defaultProtectionTuning(preset));
    if (matches(strictChecks) && tuningMatches('strict')) return 'strict';
    if (matches(balancedChecks) && tuningMatches('balanced')) return 'balanced';
    if (matches(compatibilityChecks) && tuningMatches('compatibility')) return 'compatibility';
    return 'custom';
  }

  function protectionMessageForSelection(messages, selection = protectionMessageSelection) {
    if (selection.startsWith('check:')) {
      const check = selection.slice(6);
      return messages.checks?.[check] || messages.warning;
    }
    return messages[selection] || messages.warning;
  }

  function syncProtectionMessageEditorToState() {
    if (!protectionConfig?.messages) return;
    const selection = protectionMessageSelection;
    const fallback = selection.startsWith('check:') ? protectionConfig.messages.warning : protectionMessageDefaults[selection] || protectionMessageDefaults.warning;
    const entry = normalizeProtectionMessageEntry({
      text: $('msProtectionMessageText').value,
      color: $('msProtectionMessageColor').value
    }, fallback);
    if (selection.startsWith('check:')) {
      const check = selection.slice(6);
      if (protectionCheckKeys.includes(check)) protectionConfig.messages.checks[check] = entry;
    } else if (Object.prototype.hasOwnProperty.call(protectionMessageDefaults, selection)) {
      protectionConfig.messages[selection] = entry;
    }
    protectionConfig.messages.warningCooldownSeconds = clampProtectionNumber($('msWarningCooldown').value, 10, 1, 300);
    protectionConfig.messages.banSource = String($('msProtectionBanSource').value || '').trim().slice(0, 64) || 'Server protection';
  }

  function hydrateProtectionMessageEditor() {
    const messages = protectionConfig?.messages || normalizeProtectionMessages();
    const selector = $('msProtectionMessageType');
    if (![...selector.options].some(option => option.value === protectionMessageSelection)) protectionMessageSelection = 'check:reach';
    selector.value = protectionMessageSelection;
    const entry = protectionMessageForSelection(messages);
    $('msProtectionMessageText').value = entry.text;
    $('msProtectionMessageColor').value = /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : minecraftColorHex[String(entry.color || '').toLowerCase()] || '#ffffff';
    $('msWarningCooldown').value = String(messages.warningCooldownSeconds);
    $('msProtectionBanSource').value = messages.banSource;
    $('msResetProtectionMessage').disabled = protectionMessageSelection.startsWith('check:') && !messages.checks?.[protectionMessageSelection.slice(6)];
  }

  function collectProtectionTuning() {
    const source = JSON.parse(JSON.stringify(protectionConfig?.tuning || defaultProtectionTuning($('msProtectionPreset').value)));
    for (const input of document.querySelectorAll('[data-ms-tuning]')) setProtectionValueAt(source, input.dataset.msTuning, input.value);
    return normalizeProtectionTuning(source, $('msProtectionPreset').value);
  }

  function hydrateProtectionTuning() {
    const tuning = protectionConfig?.tuning || defaultProtectionTuning($('msProtectionPreset').value);
    for (const input of document.querySelectorAll('[data-ms-tuning]')) {
      const value = protectionValueAt(tuning, input.dataset.msTuning);
      input.value = Number.isFinite(Number(value)) ? String(value) : '';
    }
  }

  function collectProtectionConfig() {
    const checks = {};
    for (const input of document.querySelectorAll('[data-ms-check]')) {
      const key = input.dataset.msCheck;
      checks[key] = input.disabled ? protectionConfig?.checks?.[key] !== false : input.checked;
    }
    const kick = clampProtectionNumber($('msKickThreshold').value, 3, 1, 18);
    const tempBan = Math.min(19, Math.max(kick + 1, clampProtectionNumber($('msTempBanThreshold').value, 5, 2, 19)));
    const ban = Math.min(20, Math.max(tempBan + 1, clampProtectionNumber($('msBanThreshold').value, 8, 3, 20)));
    $('msKickThreshold').value = String(kick);
    $('msTempBanThreshold').value = String(tempBan);
    $('msBanThreshold').value = String(ban);
    return normalizeProtectionConfig({
      ...(protectionConfig || {}),
      preset: $('msProtectionPreset').value,
      enabled: $('msProtectionEnabled').checked,
      layers: {
        builtIn: $('msLayerBuiltIn').checked,
        antiXray: $('msLayerAntiXray').checked,
        espMitigation: false
      },
      checks,
      messages: protectionConfig?.messages || normalizeProtectionMessages(),
      tuning: collectProtectionTuning(),
      escalation: {
        ...(protectionConfig?.escalation || {}),
        enabled: $('msEscalationEnabled').checked,
        preThresholdAction: $('msPreThresholdAction').value,
        decayHours: clampProtectionNumber($('msOffenseDecay').value, 24, 1, 720),
        steps: [
          { offense: kick, action: 'kick', durationMinutes: 0 },
          { offense: tempBan, action: 'temp-ban', durationMinutes: clampProtectionNumber($('msTempBanDuration').value, 60, 1, 525600) },
          { offense: ban, action: 'ban', durationMinutes: 0 }
        ]
      }
    });
  }

  function protectionCheckSupport(key, capabilities = securityStatus?.capabilities || {}, builtInSupported = true) {
    const fullId = compatibilityCheckIds[key] || key;
    if (!builtInSupported) return { supported: false, reason: 'The bundled protection adapter is unavailable for this server type.' };

    const supportMap = capabilities.checkSupport || capabilities.checkCapabilities || capabilities.checks;
    if (supportMap && typeof supportMap === 'object' && !Array.isArray(supportMap)) {
      const entry = Object.prototype.hasOwnProperty.call(supportMap, key) ? supportMap[key] : supportMap[fullId];
      if (entry !== undefined) {
        if (typeof entry === 'boolean') return { supported: entry, reason: entry ? '' : 'This runtime does not enforce this check.' };
        if (entry && typeof entry === 'object') {
          const supported = entry.supported !== false && entry.available !== false;
          return { supported, reason: supported ? '' : String(entry.reason || entry.message || 'This runtime does not enforce this check.') };
        }
      }
    }

    const supportedList = [capabilities.supportedChecks, capabilities.availableChecks, capabilities.runtimeChecks]
      .find(Array.isArray);
    if (supportedList) {
      const supported = supportedList.some(value => String(value) === key || String(value) === fullId);
      return { supported, reason: supported ? '' : 'This runtime does not enforce this check.' };
    }
    if (Array.isArray(capabilities.unsupportedChecks)
      && capabilities.unsupportedChecks.some(value => String(value) === key || String(value) === fullId)) {
      return { supported: false, reason: 'This runtime does not enforce this check.' };
    }
    const fallback = fallbackProtectionChecksByType[selectedServerType()] || [];
    const supported = fallback.includes(key);
    return { supported, reason: supported ? '' : 'This runtime has not reported support for this check.' };
  }

  function applyProtectionCheckCapabilities(capabilities, builtInSupported) {
    for (const input of document.querySelectorAll('[data-ms-check]')) {
      const result = protectionCheckSupport(input.dataset.msCheck, capabilities, builtInSupported);
      const wasUnsupported = input.disabled;
      input.disabled = !result.supported;
      if (!result.supported) input.checked = false;
      else if (wasUnsupported) input.checked = protectionConfig?.checks?.[input.dataset.msCheck] !== false;
      const label = input.closest('label');
      if (!label) continue;
      if (!label.dataset.msCheckTitle) label.dataset.msCheckTitle = label.title || '';
      label.classList.toggle('unsupported', !result.supported);
      label.setAttribute('aria-disabled', String(!result.supported));
      label.title = result.supported ? label.dataset.msCheckTitle : result.reason;
    }
  }

  function renderProtectionCheckCounts() {
    for (const [group, keys] of Object.entries(protectionCheckGroups)) {
      const controls = keys.map(key => document.querySelector(`[data-ms-check="${key}"]`)).filter(Boolean);
      const supportedControls = controls.filter(control => !control.disabled);
      const enabled = supportedControls.filter(control => control.checked).length;
      const groupInput = document.querySelector(`[data-ms-check-group="${group}"]`);
      groupInput.disabled = supportedControls.length === 0;
      groupInput.checked = supportedControls.length > 0 && enabled === supportedControls.length;
      groupInput.indeterminate = enabled > 0 && enabled < supportedControls.length;
      const unavailable = controls.length - supportedControls.length;
      const count = $(`ms${group[0].toUpperCase()}${group.slice(1)}Count`);
      count.textContent = `${enabled} / ${supportedControls.length}`;
      const supportText = unavailable ? `${unavailable} check${unavailable === 1 ? '' : 's'} unavailable for this runtime.` : 'All checks in this group are supported.';
      count.title = supportText;
      groupInput.closest('label').title = supportedControls.length ? `Toggle ${supportedControls.length} supported check${supportedControls.length === 1 ? '' : 's'}. ${supportText}` : supportText;
    }
    const allCheckControls = [...document.querySelectorAll('[data-ms-check]')];
    const checks = Object.fromEntries(allCheckControls.map(input => [input.dataset.msCheck, input.checked]));
    const supportedKeys = allCheckControls.filter(input => !input.disabled).map(input => input.dataset.msCheck);
    $('msProtectionPreset').value = inferProtectionPreset(checks, protectionConfig?.tuning, supportedKeys);
  }

  function hydrateProtectionControls() {
    const config = protectionConfig || normalizeProtectionConfig(null);
    const builtInEnabled = Boolean(config.enabled && config.layers.builtIn);
    $('msProtectionEnabled').checked = builtInEnabled;
    $('msLayerBuiltIn').checked = builtInEnabled;
    $('msLayerAntiXray').checked = Boolean(config.layers.antiXray);
    $('msLayerEspMitigation').checked = Boolean(config.layers.espMitigation);
    $('msCheckEspMitigation').checked = Boolean(config.layers.espMitigation);
    for (const input of document.querySelectorAll('[data-ms-check]')) input.checked = config.checks[input.dataset.msCheck] !== false;
    const kick = protectionStep(config, 'kick', 3);
    const tempBan = protectionStep(config, 'temp-ban', 5, 60);
    const ban = protectionStep(config, 'ban', 8);
    $('msEscalationEnabled').checked = config.escalation.enabled !== false;
    $('msPreThresholdAction').value = config.escalation.preThresholdAction === 'log' ? 'log' : 'warn';
    $('msOffenseDecay').value = String(config.escalation.decayHours);
    if (!$('msOffenseDecay').value) $('msOffenseDecay').value = '24';
    $('msKickThreshold').value = String(kick.offense);
    $('msTempBanThreshold').value = String(tempBan.offense);
    $('msTempBanDuration').value = String(tempBan.durationMinutes);
    if (!$('msTempBanDuration').value) $('msTempBanDuration').value = '60';
    $('msBanThreshold').value = String(ban.offense);
    hydrateProtectionMessageEditor();
    hydrateProtectionTuning();
    renderProtectionExemptions();
    renderProtectionCheckCounts();
  }

  function renderProtectionExemptions() {
    const exemptions = protectionConfig?.exemptions || { owners: false, admins: false, players: [] };
    $('msExemptOwners').checked = Boolean(exemptions.owners);
    $('msExemptAdmins').checked = Boolean(exemptions.admins);
    const list = $('msProtectionExemptList');
    list.replaceChildren();
    if (!exemptions.players.length) {
      renderEmpty(list, 'No exempt players', 'Owners or admins can be included automatically above.');
      return;
    }
    for (const player of exemptions.players) {
      const row = document.createElement('div');
      row.className = 'ms-exemption-player';
      const name = document.createElement('strong');
      name.textContent = player;
      const remove = playerAction('remove', `Remove ${player} from anti-cheat exemptions`, () => {
        protectionConfig.exemptions.players = protectionConfig.exemptions.players.filter(value => value.toLowerCase() !== player.toLowerCase());
        renderProtectionExemptions();
        saveProtectionConfigSoon();
      });
      row.append(name, remove);
      list.append(row);
    }
  }

  function setLayerState(id, text, state = '') {
    const element = $(id);
    element.textContent = neutralServerText(text);
    element.classList.toggle('ready', state === 'ready');
    element.classList.toggle('warning', state === 'warning');
  }

  function renderCustomAntiCheats() {
    const list = $('msCustomAntiCheatList');
    list.innerHTML = '';
    if (!customAntiCheats.length) {
      const empty = document.createElement('div');
      empty.className = 'ms-custom-ac-empty';
      empty.textContent = 'No custom anti-cheat installed.';
      list.append(empty);
      return;
    }
    for (const item of customAntiCheats) {
      const row = document.createElement('div');
      row.className = 'ms-custom-ac-row';
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name || item.file || 'Custom anti-cheat';
      const meta = document.createElement('span');
      meta.textContent = `${item.active === false ? 'Inactive' : 'Active'} · ${formatBytes(item.size)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          await run(() => api.removeCustomAntiCheat(item.id), 'Custom anti-cheat removed.');
          customAntiCheats = await api.listCustomAntiCheats();
          renderCustomAntiCheats();
        } catch (_) {
          remove.disabled = false;
        }
      };
      info.append(name, meta);
      row.append(info, remove);
      list.append(row);
    }
  }

  function renderSecurity() {
    const config = protectionConfig || normalizeProtectionConfig(null);
    const protection = securityStatus || {};
    const builtIn = protection.builtIn || {};
    const antiXray = protection.antiXray || {};
    const espMitigation = protection.espMitigation || {};
    const hardening = protection.hardening || {};
    const legacyProtection = protection.legacyProtection || {};
    const builtReady = !builtIn.legacyInstallation && !builtIn.legacyConflict && !builtIn.targetCollision
      && !builtIn.dependencyConflict && builtIn.dependencyReady !== false && !builtIn.updateAvailable
      && (builtIn.ready === true || Boolean(builtIn.installed && builtIn.integrityVerified && builtIn.runtimeCompatible));
    const builtActive = builtIn.active === true;
    const builtRuntime = builtIn.runtime && typeof builtIn.runtime === 'object' ? builtIn.runtime : null;
    const antiXrayReady = Boolean(antiXray.enabled);
    const visibilityRestartRequired = Boolean(
      builtIn.visibilityRestartRequired ||
      (builtIn.updateAvailable && status?.state !== 'stopped')
    );
    const serverType = selectedServerType();
    const runtimeLabel = serverTypeLabel(serverType);
    const capabilities = protection.capabilities || {};
    const entityEspCapability = capabilities.mitigations?.entityEsp || {};
    const builtSupported = capabilities.bundledAdapterSupported ?? layerSupportsType('builtIn', serverType);
    const antiXraySupported = capabilities.nativeAntiXraySupported === true
      || capabilities.antiXrayObfuscationSupported === true
      || capabilities.antiXrayDetectionSupported === true
      || (!Object.prototype.hasOwnProperty.call(capabilities, 'nativeAntiXraySupported')
        && layerSupportsType('antiXray', serverType));
    const espMitigationSupported = capabilities.espMitigationSupported ?? entityEspCapability.supported ?? layerSupportsType('espMitigation', serverType);
    const customSupported = capabilities.customAdapterSupported ?? layerSupportsType('custom', serverType);
    const adapterKind = capabilities.customAdapterKind || addonKindForType(serverType);
    const bundledVersions = Array.isArray(capabilities.supportedMinecraftVersions)
      ? capabilities.supportedMinecraftVersions.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    const builtDesired = Boolean(builtSupported && config.enabled && config.layers.builtIn);
    const antiXrayDesired = Boolean(antiXraySupported && config.layers.antiXray);
    const espMitigationDesired = Boolean(espMitigationSupported && config.layers.espMitigation);
    const hardeningReady = Boolean(hardening.enabled || capabilities.baselineHardeningActive);

    $('msProtectionEnabled').checked = builtDesired;
    $('msLayerBuiltIn').checked = builtDesired;
    $('msLayerAntiXray').checked = antiXrayDesired;
    $('msLayerEspMitigation').checked = espMitigationDesired;
    $('msCheckEspMitigation').checked = espMitigationDesired;
    $('msProtectionEnabled').disabled = !builtSupported;
    $('msLayerBuiltIn').disabled = !builtSupported;
    $('msLayerAntiXray').disabled = !antiXraySupported;
    $('msLayerEspMitigation').disabled = !espMitigationSupported;
    $('msCheckEspMitigation').disabled = !espMitigationSupported;
    $('msProtectionPreset').disabled = !builtSupported;
    applyProtectionCheckCapabilities(capabilities, builtSupported);
    const builtState = !builtSupported
      ? serverType === 'fabric' && bundledVersions.length
        ? `Fabric adapter supports Minecraft ${bundledVersions.join(', ')} · other versions need a matching mod`
        : customSupported
          ? `Bundled adapter unavailable · import a matching ${adapterKind === 'mods' ? 'mod' : 'plugin'}`
          : 'Baseline only · Vanilla cannot load an in-process adapter'
      : !builtDesired
      ? 'Off'
      : builtActive ? 'Active'
        : builtReady ? (status?.state === 'stopped'
          ? 'Installed'
          : builtRuntime?.phase === 'starting'
            ? 'Confirming…'
            : builtRuntime?.startupFailure
              ? 'Runtime failed'
              : 'Restart required')
          : builtIn.message || 'Setup required';
    setLayerState('msBuiltInState', securityLoading ? 'Checking…' : builtState, builtActive || builtReady && status?.state === 'stopped' ? 'ready' : builtDesired ? 'warning' : '');
    setLayerState('msBuiltInLayerState', builtState, builtActive || builtReady && status?.state === 'stopped' ? 'ready' : builtDesired ? 'warning' : '');
    $('msBuiltInState').title = builtIn.message || (!builtSupported ? builtState : '');
    $('msBuiltInLayerState').title = builtIn.message || (!builtSupported ? builtState : '');
    setLayerState('msHardeningLayerState', securityLoading ? 'Checking…' : hardeningReady ? `Active on ${runtimeLabel}` : `Ready for ${runtimeLabel}`, hardeningReady ? 'ready' : 'warning');
    const antiXrayState = !antiXraySupported
      ? `Unavailable on ${runtimeLabel}`
      : !antiXrayDesired
        ? capabilities.antiXrayMode === 'detection' ? 'Off · concealed-ore detection' : 'Off · ore obfuscation'
        : antiXrayReady
          ? capabilities.antiXrayMode === 'detection'
            ? 'Active · concealed-ore detection; ores are not hidden'
            : 'Active · hidden ores obfuscated'
          : antiXray.supported
            ? capabilities.antiXrayMode === 'detection'
              ? 'Configured · install or restart runtime checks'
              : 'Ready to enable'
            : 'Selected runtime is not ready';
    setLayerState('msAntiXrayLayerState', antiXrayState, antiXrayReady ? 'ready' : antiXrayDesired ? 'warning' : '');
    const espMitigationActive = espMitigation.active === true || entityEspCapability.active === true;
    const espMitigationState = visibilityRestartRequired
      ? 'Update and restart required · running adapter may still affect player visibility'
      : !espMitigationSupported
      ? 'PvP safe · players and nametags keep vanilla visibility'
      : !espMitigationDesired
        ? 'Off · mitigation only; does not detect ESP'
        : espMitigationActive
          ? 'Active · hidden-player data restricted; pop-in is possible'
          : !builtDesired
            ? 'Enable runtime checks first · mitigation only'
            : builtActive
              ? 'Configured · mitigation only; does not detect ESP'
              : 'Configured · restart to apply; player pop-in is possible';
    setLayerState('msEspMitigationLayerState', espMitigationState, visibilityRestartRequired ? 'warning' : espMitigationActive ? 'ready' : espMitigationDesired ? 'warning' : '');
    $('msApplyHardening').textContent = hardeningReady ? 'Reapply' : 'Apply';
    $('msSetupBuiltIn').hidden = !builtSupported || !builtDesired || builtReady;
    $('msInstallBuiltIn').hidden = !builtSupported || !builtDesired || builtReady;
    $('msSetupAntiXray').hidden = !antiXraySupported || !antiXrayDesired || antiXrayReady;
    $('msSetupAntiXray').textContent = 'Enable';
    $('msLegacyProtectionRow').hidden = !legacyProtection.exists;
    if (legacyProtection.exists) {
      setLayerState('msLegacyProtectionState', legacyProtection.message || (legacyProtection.removable ? 'Safe to remove' : 'Changed file left untouched'), legacyProtection.removable ? '' : 'warning');
      $('msRemoveLegacyProtection').disabled = !legacyProtection.removable;
    }
    $('msExemptionRuntime').hidden = !builtSupported || !builtIn.updateAvailable;
    $('msImportAntiCheat').disabled = !customSupported;
    $('msCustomAntiCheatHint').textContent = customSupported
      ? `${runtimeLabel} requires a matching ${adapterKind === 'mods' ? 'mod' : 'plugin'} JAR`
      : 'Vanilla cannot load plugin or mod adapters';
    $('msResponseState').textContent = config.escalation.enabled ? 'Escalates repeat offenses' : 'Detection is logged only';
    const responseGrid = $('msProtectionResponse').querySelector('.ms-response-grid');
    responseGrid.classList.toggle('disabled', !config.escalation.enabled);
    responseGrid.querySelectorAll('input,select').forEach(control => { control.disabled = !config.escalation.enabled; });
    renderProtectionCheckCounts();
    renderCustomAntiCheats();
  }

  function showProtectionView(name) {
    protectionView = ['checks','layers','response','messages','tuning','exemptions','history'].includes(name) ? name : 'checks';
    document.querySelectorAll('[data-ms-protection-page]').forEach(button => {
      const active = button.dataset.msProtectionPage === protectionView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-ms-protection-view]').forEach(view => { view.hidden = view.dataset.msProtectionView !== protectionView; });
    if (protectionView === 'history') loadProtectionHistory().catch(() => {});
  }

  function formatProtectionTime(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return 'Unknown time';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderProtectionHistory() {
    const list = $('msProtectionHistoryList');
    list.innerHTML = '';
    $('msProtectionHistoryCount').textContent = protectionHistoryLoading ? 'Loading…' : protectionHistory.length ? `${protectionHistory.length} event${protectionHistory.length === 1 ? '' : 's'}` : 'No events';
    $('msClearProtectionHistory').disabled = protectionHistoryLoading || !protectionHistory.length;
    if (protectionHistoryLoading) {
      renderEmpty(list, 'Loading history…');
      return;
    }
    if (!protectionHistory.length) {
      renderEmpty(list, 'No enforcement history', 'Cheat warnings, kicks and bans will appear here.');
      return;
    }
    for (const event of protectionHistory) {
      const row = document.createElement('div');
      row.className = 'ms-history-row';
      const main = document.createElement('div');
      main.className = 'ms-history-main';
      const title = document.createElement('div');
      title.className = 'ms-history-title';
      const player = document.createElement('strong');
      player.textContent = event.player || 'Unknown player';
      const action = document.createElement('span');
      const actionName = String(event.action || 'log').toLowerCase();
      action.className = `ms-history-action ${actionName}`;
      action.textContent = actionName.replace('-', ' ');
      const reason = document.createElement('span');
      reason.className = 'ms-history-reason';
      reason.textContent = event.reason || event.check || 'Protection event';
      const meta = document.createElement('span');
      meta.className = 'ms-history-meta';
      const check = String(event.check || event.category || 'check').replace(/([a-z])([A-Z])/g, '$1 $2');
      const offenseCount = Math.max(0, Number(event.offenses) || 0);
      const violationScore = Math.max(0, Number(event.violations) || 0);
      const offenses = offenseCount > 0 ? ` · offense ${offenseCount}` : '';
      const violations = violationScore > 0 ? ` · ${violationScore} VL` : '';
      meta.textContent = `${check} · ${formatProtectionTime(event.timestamp)}${offenses}${violations}`;
      title.append(player, action);
      main.append(title, reason, meta);
      const actions = document.createElement('div');
      actions.className = 'ms-history-actions';
      const playerName = String(event.player || '').trim();
      if (playerName) {
        if (actionName === 'ban' || actionName === 'temp-ban') {
          const pardon = playerAction('pardon', `Pardon ${playerName}`, async () => { await run(() => api.pardonPlayer(playerName), 'Player pardoned.'); await refresh(); });
          actions.append(pardon);
        }
        if (actionName !== 'ban') {
          const tempBan = playerAction('temp', `Temporarily ban ${playerName}`, () => openTempBan(playerName));
          actions.append(tempBan);
          const ban = playerAction('ban', `Ban ${playerName}`, () => openBanReason(playerName));
          actions.append(ban);
        }
      }
      row.append(main, actions);
      list.append(row);
    }
  }

  async function loadProtectionHistory(force = false) {
    if (protectionHistoryLoading || !api.getProtectionHistory) return;
    if (!force && protectionHistoryLoadedAt && Date.now() - protectionHistoryLoadedAt < 3000) { renderProtectionHistory(); return; }
    protectionHistoryLoading = true;
    renderProtectionHistory();
    try {
      const result = await api.getProtectionHistory({ limit: 100 });
      protectionHistory = Array.isArray(result) ? result : Array.isArray(result?.history) ? result.history : [];
      protectionHistoryLoadedAt = Date.now();
    } catch (error) {
      toast(error?.message || String(error), true);
    } finally {
      protectionHistoryLoading = false;
      renderProtectionHistory();
    }
  }

  async function saveProtectionConfigNow() {
    clearTimeout(protectionSaveTimer);
    protectionSaveTimer = null;
    if (!api.saveProtectionConfig) return;
    const token = ++protectionSaveToken;
    const profileId = status?.profiles?.activeProfileId || '';
    const payload = collectProtectionConfig();
    protectionConfig = payload;
    setProtectionSaveState('Saving…', 'saving');
    try {
      const saved = await api.saveProtectionConfig(payload);
      if (token !== protectionSaveToken || profileId !== (status?.profiles?.activeProfileId || '')) return;
      protectionConfig = normalizeProtectionConfig(saved || payload);
      setProtectionSaveState('Saved', 'saved');
      hydrateProtectionMessageEditor();
      hydrateProtectionTuning();
      renderSecurity();
    } catch (error) {
      if (token !== protectionSaveToken) return;
      setProtectionSaveState('Save failed', 'error');
      toast(error?.message || String(error), true);
    }
  }

  function saveProtectionConfigSoon(delay = 180) {
    clearTimeout(protectionSaveTimer);
    setProtectionSaveState('Unsaved');
    protectionSaveTimer = setTimeout(() => saveProtectionConfigNow().catch(() => {}), delay);
  }

  async function loadSecurity() {
    if (securityLoading) return;
    const requestId = ++securityRequestToken;
    const profileId = status?.profiles?.activeProfileId || '';
    securityLoading = true;
    setProtectionSaveState('Loading…');
    renderSecurity();
    try {
      const [nextConfig, nextSecurity, nextPlatform, nextCustom] = await Promise.all([
        typeof api.getProtectionConfig === 'function' ? api.getProtectionConfig() : Promise.resolve(null),
        typeof api.getSecurityStatus === 'function' ? api.getSecurityStatus().catch(() => ({})) : Promise.resolve(null),
        typeof api.getServerPlatformStatus === 'function' ? api.getServerPlatformStatus().catch(() => ({})) : Promise.resolve(null),
        typeof api.listCustomAntiCheats === 'function' ? api.listCustomAntiCheats().catch(() => []) : Promise.resolve([])
      ]);
      if (requestId !== securityRequestToken || profileId !== (status?.profiles?.activeProfileId || '')) return;
      protectionConfig = normalizeProtectionConfig(nextConfig);
      securityStatus = nextSecurity || {};
      platformStatus = nextPlatform || {};
      customAntiCheats = Array.isArray(nextCustom) ? nextCustom : [];
      hydrateProtectionControls();
      setProtectionSaveState('Saved', 'saved');
      if (protectionView === 'history') loadProtectionHistory(true).catch(() => {});
    } catch (error) {
      if (requestId === securityRequestToken) {
        setProtectionSaveState('Load failed', 'error');
        toast(error?.message || String(error), true);
      }
    } finally {
      if (requestId === securityRequestToken) {
        securityLoading = false;
        renderSecurity();
      }
    }
  }

  async function provisionPluginCompatibleServer({ layer = 'builtIn', feature = 'Protection' } = {}) {
    const serverType = selectedServerType();
    const supportedTypes = protectionLayerTypes[layer] || [];
    if (!supportedTypes.includes(serverType)) {
      toast(`${feature} is not available on ${serverTypeLabel(serverType)}. Supported: ${supportedTypesText(layer)}.`, true);
      return false;
    }
    const platform = platformStatus || status?.platform || {};
    const installedType = String(platform.installedType || platform.type || '').toLowerCase();
    const runtimeReady = Boolean(platform.ready && (!installedType || installedType === serverType));
    if (runtimeReady) return true;
    if (status?.state !== 'stopped') {
      toast('Stop the server first.', true);
      return false;
    }
    if (!automaticPlatformTypes.includes(serverType)) {
      toast(`${feature} supports ${serverTypeLabel(serverType)}, but its matching server JAR must be selected first. Use Choose existing JAR in Overview.`, true);
      return false;
    }
    const version = status?.config?.requestedServerVersion || status?.config?.serverVersion || 'latest';
    await run(() => api.installServerPlatform({ type: serverType, version }), `${serverTypeLabel(serverType)} installed.`);
    settingsDirty = false;
    invalidateAddonState();
    hydrateSettings();
    await refresh();
    return true;
  }

  async function reloadProtectionState() {
    securityStatus = null;
    platformStatus = null;
    securityRequestToken += 1;
    securityLoading = false;
    await loadSecurity();
  }

  async function setupBuiltInProtection() {
    if (typeof api.installBundledAntiCheat !== 'function') return;
    setLoading(true, 'Setting up built-in protection…');
    try {
      if (!await provisionPluginCompatibleServer({ layer: 'builtIn', feature: 'Server Protection' })) return;
      const result = await run(() => api.installBundledAntiCheat());
      if (result?.installed || result?.ready) toast(result.restartRequired ? 'Protection installed. Restart the server to activate it.' : 'Built-in protection enabled.');
      else if (result?.message) toast(neutralServerText(result.message), true);
      await reloadProtectionState();
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }

  async function setAntiXrayEnabled(enabled) {
    if (typeof api.applyAntiXray !== 'function') return;
    setLoading(true, enabled ? 'Enabling Anti-Xray…' : 'Disabling Anti-Xray…');
    try {
      if (enabled && !await provisionPluginCompatibleServer({ layer: 'antiXray', feature: 'Anti-Xray' })) return;
      const detection = securityStatus?.capabilities?.antiXrayMode === 'detection';
      await run(() => api.applyAntiXray({ enabled, engineMode: 3, strictXray: false }), enabled
        ? detection ? 'Concealed-ore detection enabled.' : 'Ore obfuscation enabled.'
        : detection ? 'Concealed-ore detection disabled.' : 'Ore obfuscation disabled.');
      await reloadProtectionState();
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }

  async function applyBaselineHardening() {
    if (typeof api.applySecurityPreset !== 'function') return;
    setLoading(true, 'Applying baseline hardening…');
    try {
      await run(() => api.applySecurityPreset({ enableAntiXray: false }), 'Baseline hardening applied.');
      await reloadProtectionState();
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }

  async function removeLegacyProtection() {
    if (typeof api.removeLegacyProtection !== 'function') return;
    setLoading(true, 'Removing older managed protection…');
    try {
      const result = await run(() => api.removeLegacyProtection(), 'Older managed protection removed.');
      if (result?.warnings?.length) toast(neutralServerText(result.warnings[0]), true);
      await reloadProtectionState();
    } catch (_) {
    } finally {
      setLoading(false);
    }
  }

  async function searchAddons({ append = false } = {}) {
    if (addonMode !== 'browse' || $('msAddonsPage').hidden) return;
    if (append && (addonLoading || !addonHasMore)) return;
    const requestId = ++addonSearchToken;
    const profileId = status?.profiles?.activeProfileId || '';
    addonLoading = true;
    const list = $('msAddonList');
    const requestScope = addonBrowseScope();
    if (!append) {
      addonResults = [];
      addonResultTotal = 0;
      addonNextOffset = 0;
      addonHasMore = false;
      list.scrollTop = 0;
      renderAddonResults(`Loading ${$('msAddonSource').value === 'curseforge' ? 'CurseForge' : 'Modrinth'} results.`);
    }
    const previousLength = addonResults.length;
    const options = {
      kind: $('msAddonKind').value,
      source: $('msAddonSource').value,
      query: $('msAddonSearch').value,
      serverType: status?.config?.serverType,
      limit: 20,
      offset: append ? addonNextOffset : 0
    };
    try {
      const result = await run(() => api.searchAddons(options));
      if (requestId !== addonSearchToken || addonMode !== 'browse' || $('msAddonsPage').hidden ||
          profileId !== (status?.profiles?.activeProfileId || '') || requestScope !== addonBrowseScope()) return;
      const nextResults = Array.isArray(result?.results) ? result.results : [];
      if (append) {
        const seen = new Set(addonResults.map(addon => `${addon.source}:${addon.id || addon.slug}`));
        for (const addon of nextResults) {
          const key = `${addon.source}:${addon.id || addon.slug}`;
          if (seen.has(key)) continue;
          seen.add(key);
          addonResults.push(addon);
        }
      } else {
        const seen = new Set();
        addonResults = nextResults.filter(addon => {
          const key = `${addon.source}:${addon.id || addon.slug}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      addonResultTotal = Math.max(addonResults.length, Number(result?.total) || 0);
      const reportedNextOffset = Number(result?.nextOffset);
      addonNextOffset = Number.isFinite(reportedNextOffset) && reportedNextOffset >= options.offset
        ? reportedNextOffset
        : options.offset + nextResults.length;
      addonHasMore = typeof result?.hasMore === 'boolean'
        ? result.hasMore
        : nextResults.length > 0 && addonNextOffset < addonResultTotal;
      const message = neutralServerText(result?.message);
      renderAddonResults(message, append ? { appendFrom: previousLength } : {});
    } catch (_) {
      if (requestId !== addonSearchToken || addonMode !== 'browse' || $('msAddonsPage').hidden ||
          profileId !== (status?.profiles?.activeProfileId || '') || requestScope !== addonBrowseScope()) return;
      if (!append) {
        addonResults = [];
        addonResultTotal = 0;
        addonNextOffset = 0;
        addonHasMore = false;
        renderAddonResults('Check your connection and try again.');
      }
    } finally {
      if (requestId === addonSearchToken) {
        addonLoading = false;
        requestAnimationFrame(() => {
          if (addonMode !== 'browse' || $('msAddonsPage').hidden || addonLoading || !addonHasMore) return;
          if (list.scrollHeight - list.scrollTop - list.clientHeight <= 96) searchAddons({ append: true });
        });
      }
    }
  }

  function renderAll() {
    updateDataResetControls();
    syncDimensionLockSettings();
    if (!$('msHomePanel').hidden) renderHome();
    if ($('msWorkspacePanel').hidden) return;
    renderOverview();
    if (!$('msPlayersPage').hidden) renderPlayers();
    if (!$('msSettingsPage').hidden && !settingsDirty) hydrateSettings();
    if (!$('msAddonsPage').hidden && addonMode === 'installed') renderInstalledAddons();
    else if (!$('msAddonsPage').hidden && addonMode === 'browse') renderAddonResults();
    else if (!$('msAddonsPage').hidden && (addonMode === 'allowed' || addonMode === 'blocked')) renderModPolicy();
    if (!$('msSecurityPage').hidden && (securityStatus || protectionConfig)) {
      renderSecurity();
      if (protectionView === 'history' && Date.now() - protectionHistoryLoadedAt >= 5000) loadProtectionHistory().catch(() => {});
    }
    if (!$('msStoragePage').hidden) renderStorage();
  }

  function refresh(force = false) {
    if (refreshPending && !force) return refreshPending;
    const requestGeneration = ++refreshRequestGeneration;
    const pending = (async () => {
      const requestedAtStateVersion = serverStateEventVersion;
      const requestedPlayerVersions = capturePlayerStreamVersions();
      const hadStatusAtRequest = Boolean(status);
      const nextStatus = await run(() => api.getStatus());
      if (requestGeneration !== refreshRequestGeneration) return status;
      if (nextStatus && serverStateEventVersion !== requestedAtStateVersion && latestServerState) {
        nextStatus.state = latestServerState;
      } else if (nextStatus?.state) {
        latestServerState = nextStatus.state;
      }
      if (nextStatus && typeof nextStatus === 'object') {
        reconcilePlayerStreams(nextStatus, nextStatus, playerStreams, requestedPlayerVersions, !hadStatusAtRequest);
      }
      status = nextStatus;
      renderAll();
      return status;
    })();
    refreshPending = pending;
    pending.finally(() => {
      if (refreshPending === pending) refreshPending = null;
    }).catch(() => {});
    return pending;
  }

  function applyImmediateServerState(nextState) {
    if (!status) return;
    serverStateEventVersion += 1;
    latestServerState = nextState;
    status.state = nextState;
    updateDataResetControls();
    if (!$('msWorkspacePanel').hidden) {
      renderOverview();
      if (!$('msAddonsPage').hidden && addonMode === 'installed') renderInstalledAddons();
    } else {
      renderHome();
    }
  }

  buildSettings();
  $('msBackHome').onclick = () => { showPanel(false); renderHome(); };
  $('msOpenServersFolder').onclick = () => run(api.openServersFolder);
  $('msCreateServer').onclick = () => window.bridge.openMacroNameWindow({ entity: 'server', action: 'create', mode: 'create' });
  for (const button of document.querySelectorAll('[data-ms-page]')) button.onclick = () => showPage(button.dataset.msPage);
  for (const button of document.querySelectorAll('[data-ms-players]')) button.onclick = () => {
    playersView = button.dataset.msPlayers;
    document.querySelectorAll('[data-ms-players]').forEach(item => item.classList.toggle('active', item === button));
    renderPlayers();
    if (playersView === 'access' || playersView === 'roles') loadPlayerAccess().catch(() => {});
    if (playersView === 'online' || playersView === 'history') refreshPlayerSnapshot().catch(() => {});
  };
  $('msAddPlayerAccess').onclick = async () => {
    if (!playerAccess.loaded || playerAccessError) await loadPlayerAccess(true);
    if (!playerAccess.loaded || playerAccessError) { toast(playerAccessError || 'Player access is unavailable.', true); return; }
    if (playersView === 'roles') {
      window.bridge.openPlayerRoleEditor('');
      return;
    }
    window.bridge.openMacroNameWindow({
      entity: 'server', action: 'access-player', title: 'Add Player Access',
      label: 'Minecraft player', placeholder: 'Player name', confirmText: 'Next'
    });
  };
  document.querySelectorAll('[data-copy]').forEach(button => button.onclick = async () => { const value = $(button.dataset.copy).value; if (value) { await api.copyText(value); toast('Address copied.'); } });
  $('msToggleServer').onclick = async () => {
    const stopping = ['running','starting'].includes(status?.state);
    applyImmediateServerState(stopping ? 'stopping' : 'starting');
    try {
      if (stopping) {
        await run(api.stopServer, 'Server stopped.');
      } else {
        const result = await run(api.startServer);
        if (!result?.canceled) toast('Server started.');
      }
    } catch (_) {
      // run() already displayed the actionable lifecycle error.
    } finally {
      await refresh(true).catch(() => {});
    }
  };
  $('msRestartServer').onclick = async () => { await run(api.restartServer, 'Server restarting.'); await refresh(); };
  $('msRepairConnection').onclick = async () => { await run(api.repairConnection, 'Connection check complete.'); await refresh(); };
  $('msOpenConsoleWindow').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(api.openConsole).catch(() => {}); });
  $('msOpenWorldMap').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(api.openWorldMap).catch(() => {}); });
  $('msOpenEntityViewer').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(() => api.openEntityViewer('')).catch(() => {}); });
  $('msOpenFolder').addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); run(api.openServerFolder).catch(() => {}); });
  $('msDownloadServer').onclick = async () => {
    const type = $('msSetting_serverType')?.value || status?.config?.requestedServerType || status?.config?.serverType || 'vanilla';
    const version = $('msSetting_serverVersion')?.value || status?.config?.requestedServerVersion || status?.config?.serverVersion || 'latest';
    setLoading(true, `Installing ${type[0].toUpperCase() + type.slice(1)}…`);
    try {
      const result = typeof api.installServerPlatform === 'function'
        ? await run(() => api.installServerPlatform({ type, version }), `${type[0].toUpperCase() + type.slice(1)} installed.`)
        : await run(() => api.downloadVersion(version), 'Server downloaded.');
      if (result?.config && status) status.config = result.config;
      await refresh();
      securityStatus = null; platformStatus = null;
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };
  $('msChooseJar').onclick = async () => { await run(api.selectServerJar, 'Server jar selected.'); await refresh(); };
  $('msGetJava').onclick = api.openJavaDownload;
  $('msMapPort').onclick = async () => { await run(api.enableDirectHosting, 'Port mapped.'); await refresh(); };
  $('msUnmapPort').onclick = async () => { await run(api.disableDirectHosting, 'Port unmapped.'); await refresh(); };
  $('msStartTunnel').onclick = async () => { await run(api.startPlayit, 'Tunnel starting.'); await refresh(); };
  $('msStopTunnel').onclick = async () => { await run(api.stopPlayit, 'Tunnel stopped.'); await refresh(); };
  $('msSetupTunnel').onclick = api.openPlayitSetup;
  $('msSettingsForm').addEventListener('input', () => { settingsDirty = true; });
  $('msSettingsForm').addEventListener('change', () => { settingsDirty = true; });
  $('msSettingsForm').onsubmit = async event => {
    event.preventDefault();
    let nextConfig;
    try { nextConfig = collectSettings(); } catch (error) { toast(error.message, true); return; }
    const motdChanged = String(nextConfig.motd || '') !== String(status?.config?.motd || '');
    const deathLootChanged = ['deathLootMode', 'deathDropLifetimeSeconds', 'deathChestLifetimeSeconds', 'deathChestTorches']
      .some(key => nextConfig[key] !== status?.config?.[key]);
    const serverActive = status?.state !== 'stopped';
    status.config = await run(() => api.saveConfig(nextConfig));
    settingsDirty = false;
    invalidateAddonState();
    await refresh(true);
    toast(motdChanged
      ? serverActive ? 'MOTD saved. Restart the server to apply it.' : 'MOTD saved. It will apply when the server starts.'
      : deathLootChanged
        ? serverActive ? 'Death loot settings saved. Restart the server to apply them.' : 'Death loot settings saved. They will apply when the server starts.'
      : 'Settings saved.');
  };
  $('msAddonInstalledTab').onclick = () => { addonMode = 'installed'; addonSearchToken += 1; addonLoading = false; renderAddons(); };
  $('msAddonBrowseTab').onclick = () => { addonMode = 'browse'; renderAddons(); };
  $('msAddonAllowedTab').onclick = () => { addonMode = 'allowed'; addonSearchToken += 1; addonLoading = false; renderAddons(); };
  $('msAddonBlockedTab').onclick = () => { addonMode = 'blocked'; addonSearchToken += 1; addonLoading = false; renderAddons(); };
  $('msAddModPolicyRule').onclick = () => window.bridge.openMacroNameWindow({
    entity: 'server', action: 'add-mod-policy-rule', target: addonMode, title: addonMode === 'blocked' ? 'Block Declared Mod' : 'Allow Declared Mod',
    label: 'Mod ID', placeholder: 'example-mod', confirmText: 'Add'
  });
  $('msInstalledAddonKind').onchange = () => {
    installedAddonUpdateGeneration += 1;
    installedAddonUpdateQueue.length = 0;
    installedAddonUpdates.clear();
    installedAddonRenderSignature = '';
    renderInstalledAddons();
  };
  $('msAddonKind').onchange = () => { addonResults = []; addonResultTotal = 0; addonNextOffset = 0; addonHasMore = false; renderAddons(); };
  $('msAddonSource').onchange = () => { addonResults = []; addonResultTotal = 0; addonNextOffset = 0; addonHasMore = false; searchAddons(); };
  $('msSearchAddons').onclick = searchAddons;
  $('msAddonSearch').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(addonSearchTimer); searchAddons(); } };
  $('msAddonSearch').oninput = () => { clearTimeout(addonSearchTimer); addonSearchTimer = setTimeout(searchAddons, 300); };
  $('msAddonList').addEventListener('scroll', () => {
    const list = $('msAddonList');
    if (addonMode !== 'browse' || addonLoading || !addonHasMore) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight <= 96) searchAddons({ append: true });
  }, { passive: true });
  for (const button of document.querySelectorAll('[data-ms-protection-page]')) button.onclick = () => showProtectionView(button.dataset.msProtectionPage);
  for (const button of document.querySelectorAll('[data-ms-expand-checks]')) button.onclick = () => {
    const group = button.dataset.msExpandChecks;
    const willOpen = button.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('[data-ms-expand-checks]').forEach(other => {
      const open = other === button && willOpen;
      other.setAttribute('aria-expanded', String(open));
      other.closest('.ms-check-group').querySelector('.ms-check-list').hidden = !open;
    });
    if (willOpen) document.querySelector(`[data-ms-checks="${group}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  for (const input of document.querySelectorAll('[data-ms-check-group]')) input.onchange = () => {
    for (const key of protectionCheckGroups[input.dataset.msCheckGroup] || []) {
      const check = document.querySelector(`[data-ms-check="${key}"]`);
      if (check && !check.disabled) check.checked = input.checked;
    }
    $('msProtectionPreset').value = 'custom';
    renderProtectionCheckCounts();
    saveProtectionConfigSoon();
  };
  for (const input of document.querySelectorAll('[data-ms-check]')) input.onchange = () => {
    renderProtectionCheckCounts();
    saveProtectionConfigSoon();
  };
  $('msProtectionPreset').onchange = () => {
    const presetName = $('msProtectionPreset').value;
    const preset = presetName === 'strict' ? strictChecks : presetName === 'balanced' ? balancedChecks : presetName === 'compatibility' ? compatibilityChecks : null;
    if (!preset || !protectionConfig) return;
    for (const input of document.querySelectorAll('[data-ms-check]')) {
      if (!input.disabled) input.checked = preset[input.dataset.msCheck] !== false;
    }
    protectionConfig.tuning = defaultProtectionTuning(presetName);
    hydrateProtectionTuning();
    renderProtectionCheckCounts();
    saveProtectionConfigSoon();
  };
  const setBuiltInDesired = async checked => {
    const capabilities = securityStatus?.capabilities || {};
    const supported = capabilities.bundledAdapterSupported ?? layerSupportsType('builtIn');
    if (checked && !supported) {
      $('msProtectionEnabled').checked = false;
      $('msLayerBuiltIn').checked = false;
      const versions = Array.isArray(capabilities.supportedMinecraftVersions)
        ? capabilities.supportedMinecraftVersions.map(value => String(value || '').trim()).filter(Boolean)
        : [];
      const message = selectedServerType() === 'fabric' && versions.length
        ? `Bundled Server Protection supports Fabric ${versions.join(', ')}. Select that Minecraft version or import a matching protection mod.`
        : `Server Protection is not available on ${serverTypeLabel(selectedServerType())}. Supported: ${supportedTypesText('builtIn')}.`;
      toast(message, true);
      renderSecurity();
      return;
    }
    $('msProtectionEnabled').checked = checked;
    $('msLayerBuiltIn').checked = checked;
    await saveProtectionConfigNow();
    if (checked) await setupBuiltInProtection();
    else renderSecurity();
  };
  $('msProtectionEnabled').onchange = () => setBuiltInDesired($('msProtectionEnabled').checked).catch(() => {});
  $('msLayerBuiltIn').onchange = () => setBuiltInDesired($('msLayerBuiltIn').checked).catch(() => {});
  $('msLayerAntiXray').onchange = async () => {
    const enabled = $('msLayerAntiXray').checked;
    const antiXrayCapabilities = securityStatus?.capabilities || {};
    const antiXrayCapabilityDeclared = Object.prototype.hasOwnProperty.call(antiXrayCapabilities, 'nativeAntiXraySupported')
      || Object.prototype.hasOwnProperty.call(antiXrayCapabilities, 'antiXrayObfuscationSupported')
      || Object.prototype.hasOwnProperty.call(antiXrayCapabilities, 'antiXrayDetectionSupported');
    const antiXraySupported = antiXrayCapabilities.nativeAntiXraySupported === true
      || antiXrayCapabilities.antiXrayObfuscationSupported === true
      || antiXrayCapabilities.antiXrayDetectionSupported === true
      || (!antiXrayCapabilityDeclared && layerSupportsType('antiXray'));
    if (enabled && !antiXraySupported) {
      $('msLayerAntiXray').checked = false;
      toast(`Anti-Xray is not available on ${serverTypeLabel(selectedServerType())}. Supported: ${supportedTypesText('antiXray')}.`, true);
      renderSecurity();
      return;
    }
    await setAntiXrayEnabled(enabled);
  };
  $('msLayerEspMitigation').onchange = async () => {
    const enabled = $('msLayerEspMitigation').checked;
    $('msCheckEspMitigation').checked = enabled;
    const capabilities = securityStatus?.capabilities || {};
    const supported = capabilities.espMitigationSupported ?? capabilities.mitigations?.entityEsp?.supported ?? layerSupportsType('espMitigation');
    if (enabled && !supported) {
      $('msLayerEspMitigation').checked = false;
      $('msCheckEspMitigation').checked = false;
      toast(`ESP visibility mitigation is not available on ${serverTypeLabel(selectedServerType())}.`, true);
      renderSecurity();
      return;
    }
    await saveProtectionConfigNow();
    renderSecurity();
  };
  $('msCheckEspMitigation').onchange = async () => {
    $('msLayerEspMitigation').checked = $('msCheckEspMitigation').checked;
    await $('msLayerEspMitigation').onchange();
  };
  $('msSetupBuiltIn').onclick = () => setupBuiltInProtection().catch(() => {});
  $('msInstallBuiltIn').onclick = () => setupBuiltInProtection().catch(() => {});
  $('msUpdateProtectionExempt').onclick = () => setupBuiltInProtection().catch(() => {});
  $('msApplyHardening').onclick = () => applyBaselineHardening().catch(() => {});
  $('msRemoveLegacyProtection').onclick = () => removeLegacyProtection().catch(() => {});
  $('msSetupAntiXray').onclick = () => {
    setAntiXrayEnabled(true).catch(() => {});
  };
  $('msImportAntiCheat').onclick = async () => {
    if (typeof api.importCustomAntiCheat !== 'function') return;
    if (!layerSupportsType('custom')) {
      toast(`${serverTypeLabel(selectedServerType())} cannot load anti-cheat plugins or mods.`, true);
      return;
    }
    const result = await run(() => api.importCustomAntiCheat());
    if (result?.canceled) return;
    customAntiCheats = await api.listCustomAntiCheats();
    renderCustomAntiCheats();
    toast(result?.restartRequired ? 'Anti-cheat imported. Restart the server to activate it.' : 'Anti-cheat imported.');
  };
  $('msEscalationEnabled').onchange = () => {
    if (protectionConfig) protectionConfig.escalation.enabled = $('msEscalationEnabled').checked;
    renderSecurity();
    saveProtectionConfigSoon();
  };
  for (const control of $('msProtectionResponse').querySelectorAll('.ms-response-grid input,.ms-response-grid select')) control.onchange = () => saveProtectionConfigSoon();
  $('msProtectionMessageType').onchange = () => {
    syncProtectionMessageEditorToState();
    protectionMessageSelection = $('msProtectionMessageType').value;
    hydrateProtectionMessageEditor();
  };
  for (const control of [$('msProtectionMessageText'), $('msProtectionMessageColor'), $('msWarningCooldown'), $('msProtectionBanSource')]) {
    control.oninput = () => { syncProtectionMessageEditorToState(); saveProtectionConfigSoon(320); };
    control.onchange = () => { syncProtectionMessageEditorToState(); saveProtectionConfigSoon(); };
  }
  $('msResetProtectionMessage').onclick = () => {
    if (!protectionConfig?.messages) return;
    if (protectionMessageSelection.startsWith('check:')) delete protectionConfig.messages.checks[protectionMessageSelection.slice(6)];
    else if (protectionMessageDefaults[protectionMessageSelection]) protectionConfig.messages[protectionMessageSelection] = { ...protectionMessageDefaults[protectionMessageSelection] };
    hydrateProtectionMessageEditor();
    saveProtectionConfigSoon();
  };
  for (const input of document.querySelectorAll('[data-ms-tuning]')) {
    input.oninput = () => {
      if (!protectionConfig) return;
      protectionConfig.tuning = collectProtectionTuning();
      $('msProtectionPreset').value = 'custom';
      saveProtectionConfigSoon(320);
    };
    input.onchange = () => {
      if (!protectionConfig) return;
      protectionConfig.tuning = collectProtectionTuning();
      $('msProtectionPreset').value = 'custom';
      hydrateProtectionTuning();
      saveProtectionConfigSoon();
    };
  }
  $('msExemptOwners').onchange = () => {
    if (!protectionConfig) return;
    protectionConfig.exemptions.owners = $('msExemptOwners').checked;
    saveProtectionConfigSoon();
  };
  $('msExemptAdmins').onchange = () => {
    if (!protectionConfig) return;
    protectionConfig.exemptions.admins = $('msExemptAdmins').checked;
    saveProtectionConfigSoon();
  };
  $('msAddProtectionExempt').onclick = () => window.bridge.openMacroNameWindow({
    entity: 'server', action: 'add-protection-exempt', title: 'Add Anti-cheat Exemption',
    label: 'Minecraft player', placeholder: 'Player name', confirmText: 'Add'
  });
  $('msRefreshProtection').onclick = () => {
    protectionHistoryLoadedAt = 0;
    loadProtectionHistory(true).catch(() => {});
  };
  $('msClearProtectionHistory').onclick = async () => {
    if (typeof api.clearProtectionHistory !== 'function') return;
    await run(() => api.clearProtectionHistory(), 'Protection history cleared.');
    protectionHistory = [];
    protectionHistoryLoadedAt = Date.now();
    renderProtectionHistory();
  };
  $('msImportAddon').onclick = async () => {
    if (!addonKindForType()) {
      toast('Vanilla cannot load mods or plugins. Select a compatible server type in Settings.', true);
      return;
    }
    const kind = addonMode === 'installed' ? $('msInstalledAddonKind').value : $('msAddonKind').value;
    await run(() => api.importJars(kind), `${kind === 'plugins' ? 'Plugins' : 'Mods'} imported.`);
    await refresh(true);
    addonMode = 'installed';
    $('msInstalledAddonKind').value = kind;
    renderAddons();
  };
  $('msDownloadServerAddons').onclick = () => run(api.openServerAddons);
  $('msClearLogs').onclick = async () => { await run(api.clearLogs, 'Logs cleared.'); };
  $('msWipeData').onclick = requestServerDataReset;
  $('msResetDataSettings').onclick = requestServerDataReset;
  $('msDownloadPlayit').onclick = async () => { await run(api.downloadPlayit, 'Tunnel agent downloaded.'); await refresh(); };
  $('msOpenPlayitDownload').onclick = api.openPlayitDownload;
  $('msOpenFolderStorage').onclick = api.openServerFolder;
  $('msSetupPlayitStorage').onclick = api.openPlayitSetup;
  window.bridge.onMacroNameCreated(async payload => {
    if (payload?.entity !== 'server') return;
    const value = String(payload.name || '').replaceAll(EMPTY_REASON_SENTINEL, '').trim();
    const optionalValue = ['ban', 'temp-ban-reason', 'player-mod-exception-checks', 'access-groups', 'access-custom'].includes(payload.action);
    if (!value && !optionalValue) return;
    if (payload.action === 'create') {
      setLoading(true);
      try {
        status = await run(() => api.createProfile(value, status?.state !== 'stopped'), 'Server created.');
        resetProfileUiState();
        showPanel(true); showPage('settings'); renderAll();
      } catch (_) {
      } finally {
        setLoading(false);
      }
    } else if (payload.action === 'rename') {
      status = await run(() => api.renameProfile(payload.id, value), 'Server renamed.');
      renderAll();
    } else if (payload.action === 'access-player') {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(value)) { toast('Enter a valid Minecraft player name.', true); return; }
      setTimeout(() => beginAccessEdit(value).catch(() => {}), 0);
    } else if (payload.action === 'add-protection-exempt') {
      if (!/^[A-Za-z0-9_]{1,16}$/.test(value)) { toast('Enter a valid Minecraft player name.', true); return; }
      if (!protectionConfig) return;
      const players = new Map((protectionConfig.exemptions?.players || []).map(player => [player.toLowerCase(), player]));
      players.set(value.toLowerCase(), value);
      protectionConfig.exemptions.players = [...players.values()];
      renderProtectionExemptions();
      await saveProtectionConfigNow();
    } else if (payload.action === 'access-role') {
      if (!pendingAccessDraft || pendingAccessDraft.player !== payload.target) return;
      const roleId = value.toLowerCase();
      if (!accessRoleById(roleId)) { toast('Choose an existing role.', true); pendingAccessDraft = null; return; }
      pendingAccessDraft.roleId = roleId;
      await saveAccessDraft();
    } else if (payload.action === 'ban') {
      await run(() => api.banPlayer(payload.target, value), 'Player banned.'); await refresh();
    } else if (payload.action === 'temp-ban-mode') {
      if (pendingTempBan?.target !== payload.target) return;
      const mode = value.toLowerCase();
      if (!['duration', 'date'].includes(mode)) return;
      pendingTempBan.mode = mode;
      setTimeout(() => window.bridge.openMacroNameWindow(mode === 'duration' ? {
        entity: 'server', action: 'temp-ban-duration', target: payload.target, title: 'Temporary ban duration',
        label: 'Duration (m, h, d or w)', placeholder: '30m', defaultValue: '30m', confirmText: 'Next'
      } : {
        entity: 'server', action: 'temp-ban-until', target: payload.target, title: 'Temporary ban end',
        label: 'Local date and time', inputType: 'datetime-local',
        inputMin: tempBanDateValue(Date.now() + 60_000), inputMax: tempBanDateValue(Date.now() + 31_536_000_000),
        defaultValue: defaultTempBanDate(), confirmText: 'Next'
      }), 0);
    } else if (payload.action === 'temp-ban-duration' || payload.action === 'temp-ban-until') {
      if (pendingTempBan?.target !== payload.target) return;
      const durationMs = payload.action === 'temp-ban-duration' ? tempBanDurationMs(value) : tempBanDateDurationMs(value);
      if (!durationMs) {
        toast(payload.action === 'temp-ban-duration'
          ? 'Use a duration from 1 minute to 365 days, such as 45m, 2h or 7d.'
          : 'Choose a valid local date between 1 minute and 365 days from now.', true);
        return;
      }
      pendingTempBan.durationMs = durationMs;
      setTimeout(() => window.bridge.openMacroNameWindow({
        entity: 'server', action: 'temp-ban-reason', target: payload.target, title: `Temporary ban reason`,
        label: 'Reason (optional)', placeholder: 'No reason', defaultValue: EMPTY_REASON_SENTINEL, confirmText: 'Ban'
      }), 0);
    } else if (payload.action === 'temp-ban-reason') {
      const request = pendingTempBan;
      pendingTempBan = null;
      if (request?.target !== payload.target || !request.durationMs) return;
      await run(() => api.tempBanPlayer(request.target, request.durationMs, value), 'Player temporarily banned.'); await refresh();
    } else if (payload.action === 'shorten-ban') {
      const durationMs = tempBanDurationMs(value);
      if (!durationMs) { toast('Use a duration from 1 minute to 365 days, such as 45m, 2h or 7d.', true); return; }
      await run(() => api.shortenBan(payload.target, durationMs, ''), 'Ban updated.');
      await refresh();
    } else if (payload.action === 'player-mod-exception') {
      const modId = value.toLowerCase();
      const inferred = knownCompatibilityChecks[modId] || [];
      pendingPlayerModException = { player: payload.target, modId };
      setTimeout(() => window.bridge.openMacroNameWindow({
        entity: 'server', action: 'player-mod-exception-checks', target: payload.target, title: 'Compatibility Checks',
        label: 'Checks to ignore (comma separated)', placeholder: 'abuse.inventorySpam, combat.autoClicker',
        defaultValue: inferred.join(', ') || EMPTY_REASON_SENTINEL, confirmText: 'Allow'
      }), 0);
    } else if (payload.action === 'player-mod-exception-checks') {
      const request = pendingPlayerModException;
      pendingPlayerModException = null;
      if (!request || request.player !== payload.target) return;
      const byLowerName = Object.fromEntries(Object.entries(compatibilityCheckIds).flatMap(([short, full]) => [[short.toLowerCase(), full], [full.toLowerCase(), full]]));
      const checks = [...new Set(value.split(',').map(item => byLowerName[item.trim().toLowerCase()]).filter(Boolean))];
      if (typeof api.addPlayerModException !== 'function') { toast('Compatibility exceptions are unavailable in this build.', true); return; }
      const result = await run(
        () => api.addPlayerModException({ player: request.player, modId: request.modId, checks }),
        'Runtime-check compatibility saved.'
      );
      const suppliedPolicy = result?.policy || result?.config ||
        (result?.modPolicy || result?.allowedMods || result?.blockedMods || result?.playerExceptions ? result : null);
      modPolicy = { ...normalizeModPolicy(suppliedPolicy || await api.getModPolicy()), loaded: true };
      if (!$('msAddonsPage').hidden && (addonMode === 'allowed' || addonMode === 'blocked')) renderModPolicy();
    } else if (payload.action === 'add-mod-policy-rule') {
      if (typeof api.addModPolicyRule !== 'function') { toast('Mod policy editing is unavailable in this build.', true); return; }
      const list = payload.target === 'blocked' ? 'blocked' : 'allowed';
      const result = await run(() => api.addModPolicyRule({ list, modId: value.toLowerCase() }), 'Mod policy updated.');
      const suppliedPolicy = result?.policy || result?.config || (result?.modPolicy || result?.allowedMods || result?.blockedMods ? result : null);
      modPolicy = { ...normalizeModPolicy(suppliedPolicy || await api.getModPolicy()), loaded: true };
      addonMode = list;
      renderAddons();
    } else if (payload.action === 'curseforge-key') {
      try {
        const result = await run(() => api.setCurseForgeApiKey(value), 'CurseForge connected.');
        if (result?.verified === false) toast('Key saved. CurseForge could not be verified right now.');
        addonResults = []; await searchAddons();
      } catch (_) {}
    }
  });
  window.bridge.onPlayerAccessChanged?.(() => {
    playerAccess.loaded = false;
    playerAccessError = '';
    const list = $('msPlayersList');
    if (list) delete list.dataset.playerRenderSignature;
    loadPlayerAccess(true).catch(() => {});
  });
  window.bridge.onMotdEditorSaved(async value => {
    const input = $('msSetting_motd');
    if (!input) return;
    const motd = String(value || '').slice(0, 1024);
    const previousValue = input.value;
    const hadOtherDrafts = settingsDirty;
    const serverActive = status?.state !== 'stopped';
    input.value = motd;
    try {
      status.config = await run(() => api.saveConfig({ ...(status?.config || {}), motd }));
      settingsDirty = hadOtherDrafts;
      toast(serverActive ? 'MOTD saved. Restart the server to apply it.' : 'MOTD saved. It will apply when the server starts.');
    } catch (_) {
      input.value = previousValue;
      settingsDirty = hadOtherDrafts;
    }
  });
  window.bridge.onMacroDeleteConfirmed(async payload => {
    if (payload?.entity !== 'server' || !payload.deleted) return;
    if (payload.action === 'delete') {
      status = await run(() => api.deleteProfile(payload.id, status?.state !== 'stopped'), 'Server deleted.'); resetProfileUiState(); showPanel(false); renderAll();
    } else if (payload.action === 'wipe') {
      await confirmServerDataReset(payload);
    } else if (payload.action === 'remove-player-access') {
      if (typeof api.removePlayerAccess !== 'function') return;
      const result = await run(() => api.removePlayerAccess(payload.id), 'Player access removed.');
      playerAccess = normalizePlayerAccessSnapshot(result);
      renderPlayers();
    } else if (payload.action === 'delete-access-role') {
      if (typeof api.deleteAccessRole !== 'function') return;
      const result = await run(() => api.deleteAccessRole({ roleId: payload.id, removeAssignments: true }), 'Role deleted.');
      playerAccess = normalizePlayerAccessSnapshot(result);
      renderPlayers();
    }
  });
  api.onState(next => {
    serverStateEventVersion += 1;
    latestServerState = next;
    if (status) {
      status.state = next;
      updateDataResetControls();
      if (!$('msWorkspacePanel').hidden) {
        renderOverview();
        if (!$('msAddonsPage').hidden && addonMode === 'installed') renderInstalledAddons();
      }
      else renderHome();
    }
  });
  api.onPlayers(players => receivePlayerStream('players', players));
  api.onBans(bans => receivePlayerStream('bans', bans));
  api.onHistory(history => receivePlayerStream('history', history));
  if (typeof api.onHistoryEvents === 'function') api.onHistoryEvents(events => receivePlayerStream('historyEvents', events));
  api.onDownloadProgress(progress => { const percent = progress?.total ? Math.round(progress.received / progress.total * 100) : 0; toast(percent ? `Downloading ${percent}%` : 'Downloading…'); });
  refresh().then(loadVersions).catch(() => { $('msServerEmpty').textContent = 'Could not load servers.'; });
  refreshTimer = setInterval(() => { if (!document.hidden && !$('minecraftServerView').hidden) refresh().catch(() => {}); }, 10_000);
  playerSnapshotTimer = setInterval(() => {
    if (playerPageIsVisible()) refreshPlayerSnapshot().catch(() => {});
  }, PLAYER_SNAPSHOT_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (playerPageIsVisible()) refreshPlayerSnapshot().catch(() => {});
  });
  window.addEventListener('beforeunload', () => {
    clearInterval(refreshTimer);
    clearInterval(playerSnapshotTimer);
    playerSnapshotRequestGeneration += 1;
    playerSnapshotPending = null;
  });
})();
