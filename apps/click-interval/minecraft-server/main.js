const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, safeStorage, nativeImage, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const https = require('https');
const { execFile, spawn } = require('child_process');
const os = require('os');
const dns = require('dns/promises');
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const zlib = require('zlib');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const NatAPI = require('./vendor/node_modules/nat-api');
const {
  COMPATIBILITY_PRESETS,
  normalizeCheckId,
  normalizeModId,
  normalizePlayerKey,
  normalizeModPolicyConfig,
  mergeModPolicyConfig,
  renderModPolicyYaml
} = require('./mod-policy');
const {
  normalizeAccessConfig,
  setAssignment: setAccessAssignment,
  removeAssignment: removeAccessAssignment,
  setRole: setAccessRole,
  removeRole: removeAccessRole,
  assignmentHasCapability: accessAssignmentHasCapability,
  assignmentCompatibilityRole,
  accessConfigForUi,
  buildAccessTeamCommandPlan,
  renderAccessYaml
} = require('./access-policy');
const {
  normalizeProtectionMessages,
  renderProtectionMessagesYaml
} = require('./protection-messages');
const {
  defaultProtectionTuning,
  normalizeProtectionTuning
} = require('./protection-tuning');
const {
  getProtectionCapabilities,
  getProtectionCapabilityState,
  resolveProtectionAdapter,
  FABRIC_PROTECTION_MINECRAFT_VERSIONS,
  FABRIC_PROTECTION_MINECRAFT_VERSION
} = require('./protection-capabilities');
const { resolveLocalMinecraftAssets } = require('./player-assets');
const {
  createTerrainReader,
  createRosterReader,
  normalizeTerrainCells,
  normalizeGeneratedRegions
} = require('./world-map-data');
const { readWorldMapSeedMetadata, readNbtFile, getSlimeChunks, SeedPreviewEngine } = require('./seed-preview');
const {
  assertPlainPath: assertWorldResetPlainPath,
  assertNoPendingReset: assertNoPendingWorldReset,
  normalizeResetFields,
  settingsConfig: buildResetServerSettings,
  buildPlan: buildWorldResetPlan,
  resetWorldTransaction
} = require('./world-reset');
const { planLootrRemovalWithWorldReset, retireLootrBeforeStart } = require('./lootr-retirement');
const dimensionLockSettings = require('./dimension-lock-settings');
const teamsRuntime = require('./teams-runtime');
const { runSetupConsoleCommand } = require('./setup-console');
const { runAddonConsoleCommand, runAntiCheatConsoleCommand } = require('./addon-console');
const { createAntiCheatConsoleBindings, archivePinnedProtection } = require('./anticheat-console-bindings');
const {
  createDirectHostingState,
  getNatLease,
  getOwnedNatLease,
  claimNatLease,
  clearOwnedNatLease,
  getNatLeaseOwners,
  scopeDirectHostingState
} = require('./nat-lease-ownership');
const {
  BoundedChunkQueue,
  BoundedTextBuffer,
  mapWithConcurrency,
  measureDirectoryBounded,
  planMinecraftStartupResources,
  readFileEdges,
  readFileTailUtf8,
  safeJavaMemoryMb
} = require('./performance-safety');
const { createPluginDescriptorIndex, enumerateJarFilesBounded } = require('./addon-descriptor-index');
const {
  applyPendingModQueue,
  friendlyPendingModError,
  getPendingModQueueStatus,
  recoverPendingModTransaction
} = require('./pending-mod-queue');
const {
  detectSimpleVoiceChatIdentity,
  formatExternalHostPort,
  getJavaProperty,
  isKnownPlayitTcpEndpoint,
  normalizeOptionalUdpPort,
  parseExternalHostPort,
  selectAvailableUdpPort,
  upsertJavaProperties
} = require('./simple-voice-network');
const {
  cleanupProfileFirewallRules,
  ensureInboundUdpRule
} = require('./windows-udp-firewall');
const {
  DEFAULT_RELOAD_TIMEOUT_MS: PROTECTION_RELOAD_TIMEOUT_MS,
  createProtectionRuntimeHandshake,
  beginProtectionRuntimeLifecycle,
  observeProtectionRuntimeLine,
  requestProtectionRuntimeReload,
  expireProtectionRuntimeReload,
  endProtectionRuntimeLifecycle,
  getProtectionRuntimeStatus
} = require('./protection-runtime-handshake');
const {
  TradeAssistantControlError,
  createTradeAssistantControl
} = require('./entity-control');
const {
  LOOPBACK_HOST: SEAMLESS_RESTART_LOOPBACK_HOST,
  deriveSeamlessRestartPorts,
  evaluateSeamlessRestartPreflight,
  normalizeSeamlessRestartConfig,
  verifySeamlessRestartArtifacts
} = require('./seamless-restart');
const {
  PINNED_ARTIFACTS: SEAMLESS_RESTART_PINNED_ARTIFACTS,
  createSeamlessRestartSetup,
  isFabricProxyLiteConfigSemanticallyValid,
  isFabricProxyLiteReadyLog,
  parseFabricProxyLiteConfig
} = require('./seamless-restart-setup');
const {
  assertSeamlessRestartBackendExited,
  assertSeamlessRestartTarget,
  buildMaintenanceCommand,
  evaluateSeamlessRestartPreparationMemory,
  isMaintenanceArmedAcknowledgement,
  isMaintenanceReadyAcknowledgement,
  isSeamlessRestartReadinessSource,
  normalizeSeamlessRestartMessage,
  parseSeamlessProxyProtocolLine,
  seamlessSidecarMemoryReserveMb
} = require('./seamless-restart-runtime');
const {
  inspectHoldingLobby,
  startupPredicates: holdingLobbyStartupPredicates
} = require('./holding-lobby-runtime');
const { prepareHoldingLobbyVoiceNetwork, suspendHoldingLobbyVoiceNetwork } = require('./holding-lobby-network');
const {
  attachPersistentProcess,
  disconnectPersistentProcess,
  inspectPersistentProcessBacklog,
  launchPersistentProcess,
  processExists
} = require('./persistent-process-client');

const SERVER_PROPERTIES = 'server.properties';
const LOCAL_ONLY_BIND_IP = '127.0.0.1';
const PROFILES_FILE = 'assembly-profiles.json';
const MIN_JAVA_MAJOR = 25;
const APP_USER_MODEL_ID = 'com.assembly.app';
const APP_ICON = path.join(__dirname, '..', 'assets', 'toolbox-icon.svg');
const HTTP_USER_AGENT = 'Server-Manager/1.5.125';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_ADDON_BYTES = 512 * 1024 * 1024;
const MAX_CUSTOM_ADDON_IMPORT_FILES = 64;
const MAX_CUSTOM_ADDON_IMPORT_BYTES = 512 * 1024 * 1024;
const ADDON_IMPORT_DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const MAX_ADDON_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SERVER_JAR_BYTES = 768 * 1024 * 1024;
const MAX_PLAYIT_AGENT_BYTES = 64 * 1024 * 1024;
const MAX_SEAMLESS_RESTART_ARTIFACT_BYTES = 64 * 1024 * 1024;
const SEAMLESS_RESTART_START_TIMEOUT_MS = 45_000;
// The coordinator may spend up to 30 seconds returning parked players after a
// five-second backend probe. Keep the Node-side deadline comfortably longer so
// a valid terminal ACK/NACK is not mistaken for a hung proxy.
const SEAMLESS_RESTART_CONTROL_TIMEOUT_MS = 45_000;
const SEAMLESS_RESTART_STOP_TIMEOUT_MS = 8_000;
const SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION = '26.2';
const SEAMLESS_RESTART_COORDINATOR_SOURCE = path.join(
  __dirname,
  'click-interval-restart-proxy',
  'dist',
  'ClickIntervalRestartProxy-1.0.1.jar'
);
const MAX_PLAYER_SKIN_BYTES = 512 * 1024;
const MAX_PLAYER_SKIN_CACHE_BYTES = 768 * 1024;
const PLAYER_SKIN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PLAYER_SKIN_MEMORY_TTL_MS = 60 * 1000;
const PLATFORM_FILE = 'assembly-platform.json';
const SECURITY_FILE = 'assembly-security.json';
const PROTECTION_CONFIG_FILE = 'click-interval-protection.json';
const PROTECTION_HISTORY_FILE = 'click-interval-protection-history.json';
const CUSTOM_ANTICHEATS_FILE = 'click-interval-custom-anticheats.json';
const ACCESS_CONTROL_FILE = 'click-interval-access.json';
const ACCESS_TEAMS_FILE = 'click-interval-access-teams.json';
const ADDON_METADATA_FILE = 'installed-addons.json';
const SERVER_TOOLS_FILE = 'server-tools.json';
const WORLD_MAP_METADATA_FILE = 'world-map-tool.json';
const WORLD_MAP_PROVIDER_ID = 'PFb7ZqK6';
const WORLD_MAP_PROVIDER_SLUG = 'squaremap';
const WORLD_MAP_MINECRAFT_VERSION = '26.2';
const WORLD_MAP_DEFAULT_PORT = 8080;
const WORLD_MAP_PORT_SCAN_LIMIT = 128;
const MAX_WORLD_MAP_CONFIG_BYTES = 512 * 1024;
const MAX_WORLD_MAP_PLAYERS_BYTES = 512 * 1024;
const NATIVE_WORLD_MAP_JAR = 'ClickIntervalMap-Fabric.jar';
const NATIVE_WORLD_MAP_ARTIFACT = 'ClickIntervalMap-Fabric-1.1.4+mc26.2.jar';
const NATIVE_WORLD_MAP_PROJECT_DIRECTORY = 'click-interval-map-fabric';
const MAX_NATIVE_WORLD_MAP_BYTES = 32 * 1024 * 1024;
const MAX_NATIVE_WORLD_MAP_TERRAIN_BYTES = 96 * 1024 * 1024;
const NATIVE_WORLD_MAP_FRESH_MS = 15_000;
let nativeWorldMapSnapshotCache = { file: '', mtimeMs: -1, size: -1, value: null };
const nativeWorldMapTerrainReader = createTerrainReader();
let nativeWorldMapRosterReader = createRosterReader({ readNbtFile });
let worldResetReadSnapshot = null;
let nativeWorldMapSeedEngine = null;
let nativeWorldMapSeedEngineScope = '';
let nativeWorldMapSeedEngineEpoch = 0;
let nativeWorldMapSeedEngineClosing = Promise.resolve();
const PENDING_SMP_MOD_MANIFEST = path.join(__dirname, 'manifests', 'fabric-26.2-smp-mods.json');
const RETIRED_LAVA_SOURCE_MOD_ID = 'mr_lava_source';
const RETIRED_LAVA_SOURCE_VERSION = '1.6.1';
const RETIRED_LAVA_SOURCE_SHA256 = 'b67d58db796253f10102ce5b99b82f5bdabaad35b8a68016126e0f482eb5e2dc';
const RETIRED_LAVA_SOURCE_SIZE = 176_913;
const RETIRED_LAVA_SOURCE_FILE = 'lava-source-1.6.1.jar';
const RETIRED_LAVA_SOURCE_DIRECTORY = 'retired-lava-source';
const RETIRED_LAVA_SOURCE_HOTFIX_DATAPACK = 'click_interval_disable_lava_source';
const BUNDLED_TRADE_ASSISTANT_NAME = 'Server Trade Assistant';
const BUNDLED_TRADE_ASSISTANT_JAR = 'ServerTradeAssistant-Fabric.jar';
const BUNDLED_TRADE_ASSISTANT_ARTIFACT = 'ServerTradeAssistant-Fabric-1.0.0+mc26.2.jar';
const BUNDLED_TRADE_ASSISTANT_PROJECT_DIRECTORY = 'server-trade-assistant-fabric';
const BUNDLED_TRADE_ASSISTANT_MOD_ID = 'servertradeassistant';
const BUNDLED_TRADE_ASSISTANT_ENTRYPOINT = 'dev.servertradeassistant.fabric.ServerTradeAssistantFabric';
const BUNDLED_TRADE_ASSISTANT_IDENTITY = 'dev/servertradeassistant/fabric/ServerTradeAssistantFabric.class';
const BUNDLED_TRADE_ASSISTANT_MINECRAFT = '26.2';
const BUNDLED_TRADE_ASSISTANT_VERSION = '1.0.0+mc26.2';
const BUNDLED_TRADE_ASSISTANT_SHA256 = 'b15313ddc2952262a10b84104ba46fd3efa6e386c2dfd1fe01828cda2cfeb560';
const BUNDLED_TRADE_ASSISTANT_SIZE = 221_386;
const BUNDLED_PROTECTION_NAME = 'ServerProtection';
const BUNDLED_PROTECTION_JAR = `${BUNDLED_PROTECTION_NAME}.jar`;
const BUNDLED_PROTECTION_SHA256 = 'e55e8f274a9a3453d77d55a8678690542a7cfd2fafe94195ff52bb5390948ca8';
const BUNDLED_PROTECTION_SIZE = 161_613;
const BUNDLED_PROTECTION_FABRIC_JAR = 'ServerProtection-Fabric.jar';
const BUNDLED_PROTECTION_FABRIC_26_2_ARTIFACT = 'ServerProtection-Fabric-1.4.7+mc26.2.jar';
const BUNDLED_PROTECTION_FABRIC_26_2_API_ARTIFACT = 'fabric-api-0.161.0+26.2.jar';
const BUNDLED_PROTECTION_FABRIC_26_2_SHA256 = 'f7cfd6643a1f4a8d14b798e76e54949d946687469e4a444aaacc8aad0259b3c9';
const BUNDLED_PROTECTION_FABRIC_26_2_SIZE = 548_356;
const BUNDLED_PROTECTION_FABRIC_26_2_API_SHA256 = 'e5b858ceb13290c274e31cb888ff5a1a40cb91067e7ffab0b5b775aec51e216a';
const BUNDLED_PROTECTION_FABRIC_26_2_API_SIZE = 2_566_123;
const BUNDLED_PROTECTION_FABRIC_26_2_API_JAR = 'fabric-api-0.161.0+26.2.jar';
const BUNDLED_PROTECTION_FABRIC_ARTIFACT = 'ServerProtection-Fabric-1.3.0+mc26.3.jar';
const BUNDLED_PROTECTION_FABRIC_API_ARTIFACT = 'fabric-api-0.161.0+26.3.jar';
const BUNDLED_PROTECTION_FABRIC_SHA256 = '3da96a957f7939810be210ad9fa440d8d6e027d6dc3b6ec543c880ed103ef151';
const BUNDLED_PROTECTION_FABRIC_SIZE = 533_365;
const BUNDLED_PROTECTION_FABRIC_API_SHA256 = '86f16178a3cecc887a85a4cfe9a79d92fa7341d8f39b5951a4d6ad800ab657a6';
const BUNDLED_PROTECTION_FABRIC_API_SIZE = 2_620_967;
const BUNDLED_PROTECTION_FABRIC_MOD_ID = 'serverprotection_fabric';
const BUNDLED_PROTECTION_FABRIC_ENTRYPOINT = 'dev.serverprotection.fabric.ServerProtectionFabric';
const BUNDLED_PROTECTION_FABRIC_IDENTITY = 'dev/serverprotection/fabric/ServerProtectionFabric.class';
const BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID = 'meowantixray';
const BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MAX_HEIGHT = 320;
const BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_DIMENSIONS = Object.freeze([
  'minecraft:overworld',
  'minecraft:the_nether',
  'minecraft:the_end'
]);
const BUNDLED_PROTECTION_FABRIC_API_JAR = 'fabric-api-0.161.0+26.3.jar';
const BUNDLED_PROTECTION_FABRIC_RELEASES = Object.freeze({
  '26.2': Object.freeze({
    adapterId: 'fabric-26.2',
    metadataKey: 'fabric_26_2',
    projectDirectory: 'server-protection-fabric-26.2',
    artifactFile: BUNDLED_PROTECTION_FABRIC_26_2_ARTIFACT,
    sha256: BUNDLED_PROTECTION_FABRIC_26_2_SHA256,
    size: BUNDLED_PROTECTION_FABRIC_26_2_SIZE,
    fabricApiFile: BUNDLED_PROTECTION_FABRIC_26_2_API_JAR,
    fabricApiArtifactFile: BUNDLED_PROTECTION_FABRIC_26_2_API_ARTIFACT,
    fabricApiVersion: '0.161.0+26.2',
    fabricApiSha256: BUNDLED_PROTECTION_FABRIC_26_2_API_SHA256,
    fabricApiSize: BUNDLED_PROTECTION_FABRIC_26_2_API_SIZE,
    antiXrayProviderId: BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID,
    antiXrayProviderVersion: '1.6.3',
    antiXrayNestedFile: 'meowantixray-fabric-1.6.3.jar'
  }),
  '26.3': Object.freeze({
    adapterId: 'fabric-26.3',
    metadataKey: 'fabric_26_3',
    projectDirectory: 'server-protection-fabric',
    artifactFile: BUNDLED_PROTECTION_FABRIC_ARTIFACT,
    sha256: BUNDLED_PROTECTION_FABRIC_SHA256,
    size: BUNDLED_PROTECTION_FABRIC_SIZE,
    fabricApiFile: BUNDLED_PROTECTION_FABRIC_API_JAR,
    fabricApiArtifactFile: BUNDLED_PROTECTION_FABRIC_API_ARTIFACT,
    fabricApiVersion: '0.161.0+26.3',
    fabricApiSha256: BUNDLED_PROTECTION_FABRIC_API_SHA256,
    fabricApiSize: BUNDLED_PROTECTION_FABRIC_API_SIZE,
    antiXrayProviderId: BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID,
    antiXrayProviderVersion: '1.7.0',
    antiXrayNestedFile: 'meowantixray-fabric-1.7.0.jar'
  })
});
const BUNDLED_PROTECTION_FABRIC_API_JARS = Object.freeze(
  [...new Set(Object.values(BUNDLED_PROTECTION_FABRIC_RELEASES).map((release) => release.fabricApiFile))]
);
const BUNDLED_PLAYER_VIEW_COMPANION_MOD_ID = 'serverprotection_companion';
const BUNDLED_PLAYER_VIEW_COMPANION_VERSION = '1.5.3';
const BUNDLED_PLAYER_VIEW_COMPANION_RELEASES = Object.freeze({
  '26.2': Object.freeze({
    minecraftVersion: '26.2',
    version: BUNDLED_PLAYER_VIEW_COMPANION_VERSION,
    projectDirectory: 'server-protection-client-fabric-26.2',
    artifactFile: 'MXN-SI-NN-Mod-Companion-1.5.3+mc26.2.jar',
    sha256: 'bd1f1a2c4e1997be68f8e60b996c443182be3c61197f0bc53e8a11945bd7c765',
    size: 70_730
  }),
  '26.3': Object.freeze({
    minecraftVersion: '26.3',
    version: BUNDLED_PLAYER_VIEW_COMPANION_VERSION,
    projectDirectory: 'server-protection-client-fabric',
    artifactFile: 'ServerProtection-Companion-Fabric-1.5.3+mc26.3.jar',
    sha256: 'b1ac9e8f6b7d9325fefbdf8107079b9b5ce2e7ba1e929ffbc9b66c2ab76c961b',
    size: 70_721
  })
});
const LEGACY_BUNDLED_PROTECTION_NAME = 'ClickIntervalAntiCheat';
const LEGACY_BUNDLED_PROTECTION_JAR = `${LEGACY_BUNDLED_PROTECTION_NAME}.jar`;
const BUNDLED_TELEPORT_NAME = 'ServerTeleport';
const BUNDLED_TELEPORT_JAR = `${BUNDLED_TELEPORT_NAME}.jar`;
const BUNDLED_TELEPORT_IDENTITY = 'com/servermanager/teleport/ServerTeleportPlugin.class';
const BUNDLED_TELEPORT_SHA256 = '4c5d0c0577711521df56a62e639ed8db7d39318d15c6756a317dfe8cbcf5a28f';
const BUNDLED_TELEPORT_SIZE = 49_163;
const BUNDLED_TELEPORT_FABRIC_JAR = 'ServerTeleport-Fabric.jar';
const BUNDLED_TELEPORT_FABRIC_ARTIFACT = 'ServerTeleport-Fabric-1.8.2+mc26.2.jar';
const BUNDLED_TELEPORT_FABRIC_MOD_ID = 'serverteleport_fabric';
const BUNDLED_TELEPORT_FABRIC_ENTRYPOINT = 'dev.serverteleport.fabric.ServerTeleportFabric';
const BUNDLED_TELEPORT_FABRIC_IDENTITY = 'dev/serverteleport/fabric/ServerTeleportFabric.class';
const BUNDLED_TELEPORT_FABRIC_MINECRAFT = '26.2';
const BUNDLED_TELEPORT_FABRIC_SHA256 = '750acef6e2d2919d9734085804c17612adb86a7609f4eac5f1b8cfdb28166e50';
const BUNDLED_TELEPORT_FABRIC_SIZE = 167_895;
const BUNDLED_TELEPORT_FABRIC_API_ARTIFACT = 'fabric-api-0.161.0+26.2.jar';
const BUNDLED_TELEPORT_FABRIC_API_JAR = 'fabric-api-0.161.0+26.2.jar';
const BUNDLED_TELEPORT_FABRIC_API_VERSION = '0.161.0+26.2';
const BUNDLED_TELEPORT_FABRIC_API_SHA256 = 'e5b858ceb13290c274e31cb888ff5a1a40cb91067e7ffab0b5b775aec51e216a';
const BUNDLED_TELEPORT_FABRIC_API_SIZE = 2_566_123;
const TELEPORT_COMMAND_NAMES = Object.freeze(['tpa', 'tpaccept', 'tpdeny', 'tpacancel']);
const BUNDLED_DEATH_LOOT_NAME = 'Server Death Loot';
const BUNDLED_DEATH_LOOT_FABRIC_JAR = 'ServerDeathLoot-Fabric.jar';
const BUNDLED_DEATH_LOOT_FABRIC_ARTIFACT = 'ServerDeathLoot-Fabric-1.0.0+mc26.2.jar';
const BUNDLED_DEATH_LOOT_FABRIC_MOD_ID = 'serverdeathloot_fabric';
const BUNDLED_DEATH_LOOT_FABRIC_ENTRYPOINT = 'dev.serverdeathloot.fabric.ServerDeathLootFabric';
const BUNDLED_DEATH_LOOT_FABRIC_IDENTITY = 'dev/serverdeathloot/fabric/ServerDeathLootFabric.class';
const BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT = '26.2';
// Filled from the reproducible Fabric build and enforced again after every managed copy.
const BUNDLED_DEATH_LOOT_FABRIC_SHA256 = '5d062b2593fe307d8763cdf0e7d78970a24df5888350e9e8f70665e4307fe066';
const BUNDLED_DEATH_LOOT_FABRIC_SIZE = 42_619;
const BUNDLED_VOICE_NAME = 'ProximityVoice';
const BUNDLED_VOICE_SERVER_JAR = 'ProximityVoice-Server.jar';
const BUNDLED_VOICE_SERVER_IDENTITY = 'dev/proximityvoice/plugin/ProximityVoicePlugin.class';
const BUNDLED_VOICE_SERVER_SHA256 = 'e1fba2808e98a5b923eff05a0b33142be3800971963e879ffa11f4349a083ab7';
const BUNDLED_VOICE_SERVER_SIZE = 59_211;
const BUNDLED_VOICE_FABRIC_SERVER_JAR = 'ProximityVoice-Fabric-Server.jar';
const BUNDLED_VOICE_FABRIC_SERVER_ARTIFACT = 'ProximityVoice-Fabric-Server-1.0.1+mc26.2.jar';
const BUNDLED_VOICE_FABRIC_SERVER_MOD_ID = 'proximityvoice_fabric_server';
const BUNDLED_VOICE_FABRIC_SERVER_ENTRYPOINT = 'dev.proximityvoice.fabric.ProximityVoiceFabricServer';
const BUNDLED_VOICE_FABRIC_SERVER_IDENTITY = 'dev/proximityvoice/fabric/ProximityVoiceFabricServer.class';
const BUNDLED_VOICE_FABRIC_SERVER_SHA256 = '2571e188608ca0f4f35647c0ed3178be2fa3c7aec53a9155f4dcee54e4efce53';
const BUNDLED_VOICE_FABRIC_SERVER_SIZE = 71_495;
const BUNDLED_VOICE_CLIENT_FILE = 'ProximityVoice-Fabric-Client-1.0.0.jar';
const BUNDLED_VOICE_CLIENT_SHA256 = '5d5a270367992068fd1470df4b2cfa2d344b51c06508f9c96c116d979b85a26f';
const BUNDLED_VOICE_CLIENT_SIZE = 497_852;
const BUNDLED_VOICE_CLIENT_MINECRAFT = '26.2';
const DEFAULT_VOICE_UDP_PORT = 24_454;
const MAX_VOICE_PORT_SCAN = 512;
const MAX_VOICE_CONFIG_BYTES = 256 * 1024;
const VOICE_NETWORK_FILE = 'voice-network.json';
const MAX_VOICE_STATUS_BYTES = 256 * 1024;
const MAX_ANTICHEAT_JAR_BYTES = MAX_ADDON_BYTES;
const MAX_PROTECTION_CONFIG_BYTES = 1024 * 1024;
const MAX_TEMP_BAN_DURATION_MS = 525_600 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const MAX_PROTECTION_HISTORY = 5000;
const PROTECTION_BATCH_DELAY_MS = 400;
const PROTECTION_BATCH_MAX = 100;
const MAX_PROTECTION_PENDING = 1000;
const MAX_TIMED_CACHE_ENTRIES = 128;
const MAX_PROFILE_COUNT = 64;
const MAX_ADDON_FILE_ENTRIES = 2048;
const MAX_PLUGIN_DESCRIPTOR_INSPECTIONS = 128;
const MAX_PLUGIN_DESCRIPTOR_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_PLUGIN_DESCRIPTOR_PARSED_ENTRIES = 50_000;
const MAX_PLUGIN_DESCRIPTOR_SCAN_MS = 2_000;
const PLUGIN_DESCRIPTOR_INDEX_VERSION = 'plugin-conflicts-v2';
const MAX_PLAYER_STATUS_SAMPLE = 512;
const MAX_MINECRAFT_STATUS_BYTES = 256 * 1024;
const MAX_WORLD_ICON_BYTES = 256 * 1024;
const MAX_SERVER_LOG_CHARS = 500_000;
const MAX_RECENT_LOG_CHARS = 32_000;
const MAX_PENDING_LOG_IPC_CHARS = 128_000;
const SERVER_LOG_IPC_DELAY_MS = 50;
const MAX_SERVER_OUTPUT_CHUNK_CHARS = 64 * 1024;
const MAX_SERVER_OUTPUT_PENDING_CHARS = 256 * 1024;
const MAX_SERVER_OUTPUT_PENDING_CHUNKS = 256;
const SERVER_OUTPUT_PAUSE_CHARS = 192 * 1024;
const SERVER_OUTPUT_RESUME_CHARS = 64 * 1024;
const SERVER_OUTPUT_PROCESS_BUDGET_CHARS = 32 * 1024;
const SERVER_OUTPUT_FINAL_BUDGET_CHARS = 64 * 1024;
const SERVER_OUTPUT_PROCESS_DELAY_MS = 8;
const SERVER_START_TIMEOUT_MS = 10 * 60_000;
const SERVER_STOP_GRACE_TIMEOUT_MS = 15_000;
const SERVER_STOP_FORCE_TIMEOUT_MS = 5_000;
const SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS = 10 * 60;
const SERVER_ANNOUNCED_SHUTDOWN_MESSAGE_MAX_LENGTH = 240;
const SERVER_ANNOUNCED_SHUTDOWN_DELIVERY_DELAY_MS = 250;
const SERVER_ANNOUNCED_SHUTDOWN_MILESTONES = Object.freeze([300, 120, 60, 30, 10, 5, 4, 3, 2, 1]);
const MAX_PLAYIT_OUTPUT_CHUNK_CHARS = 16 * 1024;
const MAX_PLAYIT_OUTPUT_PENDING_CHARS = 64 * 1024;
const MAX_PLAYIT_OUTPUT_PENDING_CHUNKS = 64;
const PLAYIT_OUTPUT_PAUSE_CHARS = 48 * 1024;
const PLAYIT_OUTPUT_RESUME_CHARS = 16 * 1024;
const PLAYIT_OUTPUT_PROCESS_BUDGET_CHARS = 8 * 1024;
const PLAYIT_OUTPUT_FINAL_BUDGET_CHARS = 16 * 1024;
const PLAYIT_OUTPUT_PROCESS_DELAY_MS = 25;
const STATUS_RUNNING_TTL_MS = 4_000;
const STATUS_STOPPED_TTL_MS = 8_000;
const HISTORY_LOG_FILE_LIMIT = 8;
const HISTORY_LOG_TAIL_BYTES = 512 * 1024;
const MAX_LEVEL_DAT_BYTES = 16 * 1024 * 1024;
const MAX_LEVEL_DAT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PROPERTIES_BYTES = 1024 * 1024;
const MAX_PLAYIT_METADATA_BYTES = 256 * 1024;
const MAX_PAPER_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_PLAYER_INSPECTION_REQUESTS = 16;
const MAX_PLAYER_VIEW_RECOVERY_SESSIONS = 256;
const MAX_PLAYER_VIEW_RECOVERY_BYTES = 256 * 1024;
const PLAYER_VIEW_RECOVERY_FILE = 'player-view-recovery.json';
const MAX_TEMP_BAN_TIMERS = 4096;
const PLAYER_HISTORY_BATCH_MAX = 100;
const PLAYER_HISTORY_PENDING_MAX = 1000;
const PLAYER_HISTORY_BATCH_DELAY_MS = 250;
const PLAYER_HISTORY_RETRY_DELAY_MS = 2_000;
const PLAYER_ROSTER_SYNC_INTERVAL_MS = 10_000;
const MAX_PLAYER_STAT_ENTRIES = 10_000;
const PLAYIT_LOG_HYDRATION_ENTRY_LIMIT = 512;
const PLAYIT_LOG_HYDRATION_FILE_LIMIT = 8;
const PLAYIT_LOG_HYDRATION_FILE_BYTES = 64 * 1024;
const PLAYIT_LOG_HYDRATION_TOTAL_BYTES = 256 * 1024;

const PROTECTION_CHECKS = Object.freeze({
  speed: 'movement',
  flight: 'movement',
  phase: 'movement',
  invalidPosition: 'movement',
  invalidRotation: 'movement',
  groundSpoof: 'movement',
  waterWalk: 'movement',
  step: 'movement',
  timer: 'movement',
  noSlow: 'movement',
  reach: 'combat',
  wallHit: 'combat',
  autoClicker: 'combat',
  multiTarget: 'combat',
  aimDirection: 'combat',
  killAura: 'combat',
  clickPattern: 'combat',
  criticals: 'combat',
  fastBreak: 'world',
  fastPlace: 'world',
  breakReach: 'world',
  placeReach: 'world',
  scaffold: 'world',
  multiBreak: 'world',
  chatSpam: 'abuse',
  commandSpam: 'abuse',
  inventorySpam: 'abuse'
});

// Runtime-only incidents still belong in history even when they are controlled by a
// protection layer or client-policy setting rather than an individual check switch.
const PROTECTION_EVENT_CHECKS = Object.freeze({
  ...PROTECTION_CHECKS,
  hiddenOre: 'world',
  modPolicy: 'compatibility'
});

const COMPATIBILITY_DISABLED_PROTECTION_CHECKS = new Set([
  'phase', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'scaffold', 'multiBreak', 'inventorySpam'
]);
const BALANCED_DISABLED_PROTECTION_CHECKS = new Set([
  'phase', 'noSlow', 'aimDirection', 'killAura', 'criticals', 'scaffold', 'multiBreak'
]);

function presetProtectionCheckValue(preset, id) {
  if (preset === 'strict') return true;
  if (preset === 'compatibility') return !COMPATIBILITY_DISABLED_PROTECTION_CHECKS.has(id);
  return !BALANCED_DISABLED_PROTECTION_CHECKS.has(id);
}

const DEFAULT_PROTECTION_CONFIG = Object.freeze({
  version: 6,
  preset: 'balanced',
  enabled: true,
  layers: Object.freeze({ builtIn: true, antiXray: false, espMitigation: false }),
  checks: Object.freeze({
    ...Object.fromEntries(Object.keys(PROTECTION_CHECKS).map((id) => [id, presetProtectionCheckValue('balanced', id)]))
  }),
  escalation: Object.freeze({
    enabled: true,
    preThresholdAction: 'warn',
    decayHours: 168,
    steps: Object.freeze([
      Object.freeze({ offense: 1, action: 'kick', durationMinutes: 0 }),
      Object.freeze({ offense: 3, action: 'temp-ban', durationMinutes: 60 }),
      Object.freeze({ offense: 7, action: 'ban', durationMinutes: 0 })
    ])
  }),
  messages: Object.freeze(normalizeProtectionMessages()),
  tuning: Object.freeze(defaultProtectionTuning('balanced'))
});

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    const stat = fss.statSync(envPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return;
    const body = fss.readFileSync(envPath, 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  } catch {}
}

loadLocalEnv();

const DEFAULT_CONFIG = {
  uiMode: 'revamped',
  jarPath: '',
  serverVersion: 'latest',
  serverType: 'vanilla',
  javaPath: 'java',
  memoryMb: 2048,
  port: 25565,
  voiceUdpPort: 0,
  voicePublicAddress: '',
  bindIp: '',
  customHostname: '',
  publicAddress: '',
  directHostingEnabled: false,
  localOnly: false,
  localOnlyPreviousBindIp: '',
  seamlessRestart: Object.freeze({ enabled: false }),
  levelName: 'world',
  seed: '',
  motd: '',
  maxPlayers: 20,
  playerHistoryLimit: 100,
  emptyServerAction: 'never',
  emptyServerStopMinutes: 30,
  keepSystemAwakeWhileRunning: true,
  onlineMode: true,
  pvp: true,
  playerLocatorBar: true,
  difficulty: 'easy',
  gamemode: 'survival',
  acceptEula: false,
  allowFlight: false,
  allowCheats: false,
  whiteList: false,
  hardcore: false,
  forceGamemode: false,
  allowNether: true,
  lockNether: false,
  lockEnd: false,
  generateStructures: true,
  spawnAnimals: true,
  spawnMonsters: true,
  spawnNpcs: true,
  spawnProtection: 16,
  doInsomnia: true,
  mobGriefing: true,
  doFireTick: false,
  keepInventory: false,
  deathLootMode: 'vanilla',
  deathDropLifetimeSeconds: 300,
  deathChestLifetimeSeconds: 900,
  deathChestTorches: true,
  doImmediateRespawn: false,
  showDeathMessages: true,
  announceAdvancements: true,
  doTraderSpawning: true,
  doPatrolSpawning: true,
  playersSleepingPercentage: 50,
  spawnRadius: 8,
  randomTickSpeed: 3,
  viewDistance: 10,
  simulationDistance: 10,
  securityPreset: 'off',
  enforceSecureProfile: true,
  enableRcon: false,
  enableQuery: false,
  enableJmxMonitoring: false,
  broadcastRconToOps: true,
  hideOnlinePlayers: false,
  logIps: true,
  functionPermissionLevel: 2,
  opPermissionLevel: 4
};

const GAME_RULES = {
  playerLocatorBar: 'locator_bar',
  doInsomnia: 'spawn_phantoms',
  mobGriefing: 'mob_griefing',
  doFireTick: 'fire_spread_radius_around_player',
  keepInventory: 'keep_inventory',
  doImmediateRespawn: 'immediate_respawn',
  showDeathMessages: 'show_death_messages',
  announceAdvancements: 'show_advancement_messages',
  doTraderSpawning: 'spawn_wandering_traders',
  doPatrolSpawning: 'spawn_patrols',
  playersSleepingPercentage: 'players_sleeping_percentage',
  spawnRadius: 'respawn_radius',
  randomTickSpeed: 'random_tick_speed'
};

const LEGACY_GAME_RULES = {
  playerLocatorBar: 'locatorBar',
  doInsomnia: 'doInsomnia',
  mobGriefing: 'mobGriefing',
  doFireTick: 'doFireTick',
  keepInventory: 'keepInventory',
  doImmediateRespawn: 'doImmediateRespawn',
  showDeathMessages: 'showDeathMessages',
  announceAdvancements: 'announceAdvancements',
  doTraderSpawning: 'doTraderSpawning',
  doPatrolSpawning: 'doPatrolSpawning',
  playersSleepingPercentage: 'playersSleepingPercentage',
  spawnRadius: 'spawnRadius',
  randomTickSpeed: 'randomTickSpeed'
};

const GAME_RULE_LABELS = {
  playerLocatorBar: 'Player locator bar',
  doInsomnia: 'Phantom spawning',
  mobGriefing: 'Mob griefing',
  doFireTick: 'Fire spread',
  keepInventory: 'Keep inventory',
  doImmediateRespawn: 'Immediate respawn',
  showDeathMessages: 'Death messages',
  announceAdvancements: 'Advancement announcements',
  doTraderSpawning: 'Wandering traders',
  doPatrolSpawning: 'Pillager patrols',
  playersSleepingPercentage: 'Sleep percentage',
  spawnRadius: 'Spawn radius',
  randomTickSpeed: 'Random tick speed'
};

const PVP_TEAM_NAME = 'asm_pve';
let mainWindow;
const embeddedWebContentsSubscribers = new Set();
let consoleWindow;
let worldMapWindow;
let entityViewerWindow;
const mainWindows = new Set();
let serverProcess = null;
let serverState = 'stopped';
let cachedStatus = null;
let cachedStatusAt = 0;
let statusCacheGeneration = 0;
const serverLogBuffer = new BoundedTextBuffer(MAX_SERVER_LOG_CHARS);
const recentServerLogBuffer = new BoundedTextBuffer(MAX_RECENT_LOG_CHARS);
const chatHistory = [];
let chatLogRemainder = '';
let chatHistoryHydrated = false;
let chatHistoryWriteQueue = Promise.resolve();

function parseChatLogLine(rawLine) {
  const raw = String(rawLine || '').trim();
  if (!raw) return null;
  const payload = raw.replace(/^(?:\[[^\]]+\]\s*)+/, '').replace(/^:\s*/, '').replace(/^\[Not Secure\]\s*/i, '');
  let match = payload.match(/^<([A-Za-z0-9_]{1,16})>\s+(.+)$/);
  if (match) return { timestamp: new Date().toISOString(), kind: 'chat', sender: match[1], recipient: '', message: match[2], raw };
  match = payload.match(/^([A-Za-z0-9_]{1,16})\s+whispers\s+to\s+([A-Za-z0-9_]{1,16}|you):\s*(.+)$/i);
  if (match) return { timestamp: new Date().toISOString(), kind: 'private', sender: match[1], recipient: match[2], message: match[3], raw };
  match = payload.match(/^\[([A-Za-z0-9_]{1,16})\s*->\s*([A-Za-z0-9_]{1,16}|Console)\]\s*(.+)$/i);
  if (match) return { timestamp: new Date().toISOString(), kind: 'private', sender: match[1], recipient: match[2], message: match[3], raw };
  return null;
}

function recordChatEntry(entry, persist = true) {
  if (!entry) return;
  chatHistory.push(entry);
  if (chatHistory.length > 5000) chatHistory.splice(0, chatHistory.length - 5000);
  emitAll('server:chat', entry);
  if (!persist) return;
  const pathsPromise = getPaths();
  chatHistoryWriteQueue = Promise.all([chatHistoryWriteQueue, pathsPromise]).then(async ([, paths]) => {
    await fs.appendFile(path.join(paths.root, 'chat-history.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
  }).catch(() => {});
}

function processChatLogChunk(chunk) {
  const combined = chatLogRemainder + String(chunk || '').replace(/\r\n?/g, '\n');
  const lines = combined.split('\n');
  chatLogRemainder = lines.pop() || '';
  for (const line of lines) recordChatEntry(parseChatLogLine(line));
}

async function hydrateChatHistory() {
  if (chatHistoryHydrated) return;
  chatHistoryHydrated = true;
  try {
    const paths = await getPaths();
    const stored = await fs.readFile(path.join(paths.root, 'chat-history.jsonl'), 'utf8').catch(() => '');
    const entries = stored.split(/\r?\n/).filter(Boolean).slice(-5000).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(entry => entry && ['chat', 'private'].includes(entry.kind) && entry.message);
    if (entries.length) {
      const merged = [...entries, ...chatHistory];
      const unique = new Map(merged.map(entry => [`${entry.timestamp}|${entry.kind}|${entry.sender}|${entry.recipient}|${entry.message}`, entry]));
      chatHistory.splice(0, chatHistory.length, ...[...unique.values()].slice(-5000));
    }
    else {
      const latest = await fs.readFile(path.join(paths.logs, 'latest.log'), 'utf8').catch(() => '');
      for (const line of latest.split(/\r?\n/).slice(-20_000)) {
        const entry = parseChatLogLine(line);
        if (entry) recordChatEntry(entry, false);
      }
    }
  } catch {}
}
const pendingServerLogIpc = new BoundedTextBuffer(MAX_PENDING_LOG_IPC_CHARS);
let pendingServerLogDropped = 0;
let serverLogIpcTimer = null;
let serverStartedAt = null;
let profilesState = null;
let playitProcess = null;
let seamlessVelocityProcess = null;
let seamlessLimboProcess = null;
let seamlessRuntimeProfileId = '';
let seamlessMaintenanceArmed = false;
let seamlessRestartPromise = null;
let seamlessRestartOwner = null;
let seamlessResumePromise = null;
let seamlessSidecarStartPromise = null;
let seamlessSidecarStopPromise = null;
let seamlessSetupPromise = null;
let seamlessVelocityLogRemainder = '';
let seamlessFabricProxyLiteLoaded = false;
let seamlessVelocityProtocolSequence = 0;
const seamlessVelocityProtocolEvents = [];
const seamlessVelocityProtocolWaiters = new Set();
let playitMutationQueue = Promise.resolve();
const livePlayers = new Map();
let playerStateRevision = 0;
let playerRosterRevision = 0;
let lastPlayerRosterProbeAt = 0;
let lastPlayerRosterAuthoritativeAt = 0;
const playerSpectateSessions = new Map();
const playerSpectateMutations = new Map();
let playerSpectateRecoveryPath = '';
let playerSpectateSessionsLoaded = false;
const PLAYER_SPECTATE_RESTORE_TAGS = Object.freeze({
  survival: 'server_pov_restore_survival',
  creative: 'server_pov_restore_creative',
  adventure: 'server_pov_restore_adventure',
  spectator: 'server_pov_restore_spectator'
});
const PLAYER_SPECTATE_ACTIVE_TAG = 'server_pov_active';
const assemblyBans = new Map();
let assemblyBansPath = '';
const tempBanTimers = new Map();
const playerBanMutations = new Map();
let playitState = {
  address: '',
  setupUrl: '',
  lastMessage: '',
  sessionNotSetup: false,
  spamSuppressed: 0
};
let natClient = null;
let natMappingMutationQueue = Promise.resolve();
let natShutdownStarted = false;
let lastServerPerfSample = null;
let lastNetworkSample = null;
let serverEffectiveMemoryMb = null;
let lastJoinDiagnosticSignature = '';
let lastGameRuleDiagnosticSignature = '';
let lastPvpProtectionSignature = '';
let runtimeGameRulesUnsupported = false;
let pendingRuntimeGameRuleBatch = null;
const playerInspectionRequests = new Map();
let playerInspectionLogRemainder = '';
const playerPoseRequests = new Map();
let playerPoseLogRemainder = '';
let pendingPlayerHistoryEvents = [];
let playerHistoryEventTimer = null;
let playerHistoryEventFlush = null;
const playerSkinPrewarmQueue = [];
const playerSkinPrewarmKeys = new Set();
let playerSkinPrewarmActive = 0;
let deferredRuntimeSettings = null;
let playerLogRemainder = '';
let serverStartupPromise = null;
let serverStopPromise = null;
let pendingServerStart = null;
let pendingServerRestart = null;
let pendingAnnouncedServerShutdown = null;
let pendingSafeModeRetry = null;
let serverLifecycleGeneration = 0;
let serverReadyGeneration = 0;
let stopRequestedGeneration = 0;
let emptyServerStopTimer = null;
let emptyServerStopDueAt = 0;
let emptyServerStopProfileId = '';
let emptyServerStopMinutes = 0;
let serverPowerSaveBlockerId = null;
const serverProcessFinalizers = new WeakMap();
let lastServerError = '';
let pvpTeamProvisioned = false;
const provisionedAccessTeams = new Set();
let runtimeAccessTeamMutationQueue = Promise.resolve();
let runtimeScoreboardOwnership = null;
let platformInstallState = null;
let directHostingState = createDirectHostingState();
const timedCache = new Map();
const inFlightWork = new Map();
const protectionIncidentQueues = new Map();
const serializedFileWrites = new Map();
const protectionConfigMutations = new Map();
const protectionStateTransactions = new Map();
const pluginDescriptorIndexStore = createPluginDescriptorIndex({
  inspectDescriptor: (file, budget) => inspectJarDescriptor(file, budget),
  maxEntries: MAX_ADDON_FILE_ENTRIES,
  maxProfiles: MAX_PROFILE_COUNT,
  maxJarInspections: MAX_PLUGIN_DESCRIPTOR_INSPECTIONS,
  maxScanBytes: MAX_PLUGIN_DESCRIPTOR_SCAN_BYTES,
  maxParsedEntries: MAX_PLUGIN_DESCRIPTOR_PARSED_ENTRIES,
  maxDurationMs: MAX_PLUGIN_DESCRIPTOR_SCAN_MS,
  implementationVersion: PLUGIN_DESCRIPTOR_INDEX_VERSION
});
const modDescriptorIndexStore = createPluginDescriptorIndex({
  inspectDescriptor: (file, budget) => inspectJarDescriptor(file, budget),
  maxEntries: MAX_ADDON_FILE_ENTRIES,
  maxProfiles: MAX_PROFILE_COUNT,
  maxJarInspections: MAX_PLUGIN_DESCRIPTOR_INSPECTIONS,
  maxScanBytes: MAX_PLUGIN_DESCRIPTOR_SCAN_BYTES,
  maxParsedEntries: MAX_PLUGIN_DESCRIPTOR_PARSED_ENTRIES,
  maxDurationMs: MAX_PLUGIN_DESCRIPTOR_SCAN_MS,
  implementationVersion: `${PLUGIN_DESCRIPTOR_INDEX_VERSION}-mods`
});
let protectionLogRemainder = '';
let protectionRuntimeHandshake = createProtectionRuntimeHandshake();
const protectionRuntimeReloadWaiters = new Map();
let pendingProtectionIncidents = [];
let protectionIncidentIngressPromise = null;
let protectionQuitFlushStarted = false;
let applicationQuitCleanupFinished = false;
let applicationQuitting = false;
let preserveOwnedProcessesForUpdate = false;
let persistentRuntimeAttachPromise = null;
let configSaveMutationSequence = 0;

function createSingleFlightCoordinator(conflictMessage = '') {
  let active = null;
  return {
    run(key, work) {
      const requestKey = String(key ?? '');
      if (active) {
        if (conflictMessage && active.key !== requestKey) {
          return Promise.reject(new Error(conflictMessage));
        }
        return active.promise;
      }
      let tracked;
      tracked = Promise.resolve()
        .then(work)
        .finally(() => {
          if (active?.promise === tracked) active = null;
        });
      active = { key: requestKey, promise: tracked };
      return tracked;
    },
    getActiveKey() {
      return active?.key || '';
    }
  };
}

const platformInstallCoordinator = createSingleFlightCoordinator(
  'A different server platform installation is already running. Wait for it to finish before starting another one.'
);
const serverStartCoordinator = createSingleFlightCoordinator();
const protectionRuntimeReloadCoordinator = createSingleFlightCoordinator();
const serverToolMutationCoordinator = createSingleFlightCoordinator(
  'Another server profile or built-in tool change is already running. Wait for it to finish.'
);
const serverTeleportMutationCoordinator = Object.freeze({
  run: (key, work) => serverToolMutationCoordinator.run(`teleport:${key}`, work),
  getActiveKey: () => serverToolMutationCoordinator.getActiveKey()
});
const serverVoiceMutationCoordinator = Object.freeze({
  run: (key, work) => serverToolMutationCoordinator.run(`voice:${key}`, work),
  getActiveKey: () => serverToolMutationCoordinator.getActiveKey()
});

function assertApplicationAllowsOwnedChildStart(childName = 'process') {
  if (applicationQuitting) {
    throw new Error(`Cannot start ${childName} while the app is quitting.`);
  }
}

async function stopUnadoptedPersistentProcess(processRef, command = '') {
  if (!processRef) return;
  if (command) tryWriteServerInput(processRef, command);
  let exited = await waitForChildExit(processRef, 1500);
  if (!exited) {
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, 700);
  }
  disconnectPersistentProcess(processRef);
  return exited;
}

function assertServerStartAllowed() {
  assertApplicationAllowsOwnedChildStart('the Minecraft server');
  if (serverToolMutationCoordinator.getActiveKey()) {
    throw new Error('Wait for the built-in server tool change to finish before starting the server.');
  }
}

function createServerStartCanceledError() {
  const error = new Error('Server startup was canceled.');
  error.code = 'SERVER_START_CANCELED';
  return error;
}

function assertServerStartContinues(request) {
  assertServerStartAllowed();
  if (request?.canceled) throw createServerStartCanceledError();
}

function cancelPendingServerRestart() {
  if (pendingServerRestart) pendingServerRestart.canceled = true;
}

function cancelPendingSafeModeRetry() {
  const retry = pendingSafeModeRetry;
  if (!retry) return false;
  retry.canceled = true;
  if (retry.timer) clearTimeout(retry.timer);
  if (pendingSafeModeRetry === retry) pendingSafeModeRetry = null;
  return true;
}

function isCurrentServerLifecycleContext(context) {
  return Boolean(
    context?.processRef &&
    serverProcess === context.processRef &&
    serverLifecycleGeneration === context.generation &&
    serverReadyGeneration === context.generation &&
    serverState === 'running' &&
    !applicationQuitting
  );
}

async function revalidateServerLifecycleContext(context) {
  if (!isCurrentServerLifecycleContext(context)) return false;
  const profile = await getActiveProfile().catch(() => null);
  return isCurrentServerLifecycleContext(context) && Boolean(profile?.id) && profile.id === context.profileId;
}

function scheduleSafeModeRetry(context) {
  cancelPendingSafeModeRetry();
  const retry = {
    canceled: false,
    generation: context.generation,
    profileId: context.profileId,
    timer: null
  };
  pendingSafeModeRetry = retry;
  retry.timer = setTimeout(async () => {
    retry.timer = null;
    try {
      if (
        retry.canceled || pendingSafeModeRetry !== retry || applicationQuitting ||
        serverProcess || pendingServerStart || serverStopPromise ||
        serverState !== 'stopped' || serverLifecycleGeneration !== retry.generation
      ) return;
      const profile = await getActiveProfile().catch(() => null);
      if (
        retry.canceled || pendingSafeModeRetry !== retry || applicationQuitting ||
        serverProcess || pendingServerStart || serverStopPromise ||
        serverState !== 'stopped' || serverLifecycleGeneration !== retry.generation ||
        profile?.id !== retry.profileId
      ) return;
      const operation = startServer({ safeMode: true, safeModeRetryRequest: retry });
      if (pendingSafeModeRetry === retry) pendingSafeModeRetry = null;
      await operation;
    } catch (error) {
      appendServerLog(`[Server Manager SRV-WORLD-500] Safe-mode startup failed: ${error.message || String(error)}\n`);
    } finally {
      if (pendingSafeModeRetry === retry) pendingSafeModeRetry = null;
    }
  }, 1000);
  retry.timer.unref?.();
  return retry;
}

function invalidateCachedWork(prefix = '') {
  for (const key of timedCache.keys()) {
    if (!prefix || key.startsWith(prefix)) timedCache.delete(key);
  }
}

function getTimedCachePrefixLimit(key) {
  if (key.startsWith('player-skin:')) return { prefix: 'player-skin:', limit: 32 };
  if (key.startsWith('player-assets:')) return { prefix: 'player-assets:', limit: 8 };
  if (key.startsWith('addon-')) return { prefix: 'addon-', limit: 48 };
  if (key.startsWith('world-icon:')) return { prefix: 'world-icon:', limit: MAX_PROFILE_COUNT };
  return null;
}

function pruneTimedCache(now = Date.now(), incomingKey = '') {
  for (const [key, entry] of timedCache) {
    if (!entry || entry.expiresAt <= now) timedCache.delete(key);
  }
  const prefixLimit = getTimedCachePrefixLimit(incomingKey);
  if (prefixLimit) {
    const matching = [...timedCache.keys()].filter((key) => key.startsWith(prefixLimit.prefix));
    while (matching.length >= prefixLimit.limit) timedCache.delete(matching.shift());
  }
  while (timedCache.size >= MAX_TIMED_CACHE_ENTRIES) {
    timedCache.delete(timedCache.keys().next().value);
  }
}

function getCachedWork(key, ttlMs, work) {
  const now = Date.now();
  const cached = timedCache.get(key);
  if (cached && cached.expiresAt > now) {
    timedCache.delete(key);
    timedCache.set(key, cached);
    return Promise.resolve(cached.value);
  }
  if (cached) timedCache.delete(key);
  if (inFlightWork.has(key)) return inFlightWork.get(key);
  const pending = Promise.resolve()
    .then(work)
    .then((value) => {
      pruneTimedCache(Date.now(), key);
      timedCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inFlightWork.delete(key));
  inFlightWork.set(key, pending);
  return pending;
}

function runNatMappingMutation(work) {
  const operation = natMappingMutationQueue.then(work, work);
  natMappingMutationQueue = operation.catch(() => {});
  return operation;
}

function runPlayitMutation(work) {
  const operation = playitMutationQueue.then(work, work);
  playitMutationQueue = operation.catch(() => {});
  return operation;
}

function generateSeed() {
  return String(crypto.randomBytes(8).readBigInt64BE());
}

function stablePlayerLimit(memoryMb) {
  return Math.max(4, Math.floor((Number(memoryMb) || DEFAULT_CONFIG.memoryMb) / 256));
}

function parseJavaMajor(versionLine = '') {
  const match = String(versionLine).match(/version "(\d+)/);
  return match ? Number(match[1]) : 0;
}

function checkJava(javaPath = 'java') {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(javaPath || 'java', ['-version'], { windowsHide: true });
    } catch {
      resolve({ available: false, version: '', message: 'Java was not found.' });
      return;
    }
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ available: false, version: '', message: 'Java check timed out.' });
    }, 5000);
    timer.unref();
    const collect = (data) => {
      if (settled) return;
      output += data.toString();
      if (output.length > 64 * 1024) {
        try { proc.kill(); } catch {}
        finish({ available: false, version: '', message: 'Java check returned too much output.' });
      }
    };
    proc.stderr.on('data', collect);
    proc.stdout.on('data', collect);
    proc.on('error', () => {
      finish({ available: false, version: '', message: 'Java was not found.' });
    });
    proc.on('exit', (code) => {
      const firstLine = output.split(/\r?\n/).find(Boolean) || '';
      finish({
        available: code === 0,
        version: firstLine,
        major: parseJavaMajor(firstLine),
        message: code === 0 ? '' : 'Java was not found.'
      });
    });
  });
}

async function findInstalledJavaExecutable() {
  const candidates = [
    path.join('C:', 'Program Files', 'Eclipse Adoptium'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Eclipse Adoptium')
  ];
  const found = [];
  for (const root of candidates) {
    try {
      const versions = await fs.readdir(root, { withFileTypes: true });
      for (const entry of versions) {
        if (!entry.isDirectory()) continue;
        const javaExe = path.join(root, entry.name, 'bin', 'java.exe');
        try {
          await fs.access(javaExe);
          const major = Number((entry.name.match(/jdk-(\d+)/) || [])[1]) || 0;
          found.push({ javaExe, major });
        } catch {}
      }
    } catch {}
  }
  found.sort((a, b) => b.major - a.major);
  return found[0]?.javaExe || '';
}

async function resolveJava(config) {
  const configuredPath = String(config.javaPath || 'java');
  const configured = await getCachedWork(`java-check:${configuredPath}`, 60_000, () => checkJava(configuredPath));
  if (configured.available && configured.major >= MIN_JAVA_MAJOR) return { ...configured, path: configuredPath };
  const discoveredPath = await getCachedWork('java-discovery', 5 * 60_000, findInstalledJavaExecutable);
  if (!discoveredPath) return { ...configured, path: config.javaPath };
  const discovered = await getCachedWork(`java-check:${discoveredPath}`, 60_000, () => checkJava(discoveredPath));
  if (!discovered.available || discovered.major < MIN_JAVA_MAJOR) return { ...configured, path: config.javaPath };
  return { ...discovered, path: discoveredPath };
}

function slugifyProfileName(name) {
  const slug = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 36);
  return slug || 'Server';
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS_RESERVED_PATH_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function isSafeProfileId(value) {
  return typeof value === 'string' && value !== 'default' && PROFILE_ID_PATTERN.test(value) && !WINDOWS_RESERVED_PATH_NAME.test(value);
}

function isSafeWorldName(value) {
  if (typeof value !== 'string' || !value || value.length > 80 || value !== value.trim()) return false;
  if (value === '.' || value === '..' || path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) return false;
  if (/[<>:"/\\|?*\x00-\x1F]/.test(value) || /[. ]$/.test(value)) return false;
  return !WINDOWS_RESERVED_PATH_NAME.test(value);
}

function validateWorldName(value) {
  if (!isSafeWorldName(value)) {
    throw new Error('World name must be a single safe folder name without path separators, reserved names, or trailing spaces and periods.');
  }
  return value;
}

function makeSafeWorldName(value, fallback = 'world') {
  const clean = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  if (isSafeWorldName(clean)) return clean;
  const slug = slugifyProfileName(clean || fallback).slice(0, 64);
  if (isSafeWorldName(slug)) return slug;
  return 'world';
}

function resolveContainedPath(parent, target, options = {}) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedParent, resolvedTarget);
  const escapesParent = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (escapesParent || (!options.allowRoot && !relative)) {
    throw new Error('Refusing a filesystem operation outside the managed server directory.');
  }
  return resolvedTarget;
}

function normalizeProfilesState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seen = new Set();
  const profiles = [];
  for (const candidate of Array.isArray(source.profiles) ? source.profiles : []) {
    if (profiles.length >= MAX_PROFILE_COUNT) break;
    if (!candidate || typeof candidate !== 'object' || !isSafeProfileId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const name = String(candidate.name || candidate.id).trim().slice(0, 48) || candidate.id;
    profiles.push({ id: candidate.id, name });
  }
  const activeProfileId = profiles.some((profile) => profile.id === source.activeProfileId)
    ? source.activeProfileId
    : (profiles[0]?.id || null);
  return { activeProfileId, profiles };
}

async function readProfilesState() {
  if (profilesState) return profilesState;
  const file = path.join(app.getPath('userData'), PROFILES_FILE);
  let stored;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('Profiles file exceeds its safety limit.');
    stored = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    stored = { activeProfileId: null, profiles: [] };
  }
  profilesState = normalizeProfilesState(stored);
  if (JSON.stringify(stored) !== JSON.stringify(profilesState)) {
    await fs.writeFile(file, JSON.stringify(profilesState, null, 2));
  }
  return profilesState;
}

async function writeProfilesState(nextState) {
  const normalized = normalizeProfilesState(nextState);
  if ((nextState?.profiles || []).length !== normalized.profiles.length) {
    throw new Error('Refusing to save an unsafe or duplicate server profile id.');
  }
  profilesState = normalized;
  await fs.writeFile(path.join(app.getPath('userData'), PROFILES_FILE), JSON.stringify(normalized, null, 2));
  return profilesState;
}

async function getActiveProfile() {
  const state = await readProfilesState();
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}

function getPathsForProfile(profile) {
  if (!profile || !isSafeProfileId(profile.id)) throw new Error('Server profile has an unsafe id.');
  const profilesRoot = path.join(app.getPath('userData'), 'minecraft-servers');
  const root = resolveContainedPath(profilesRoot, path.join(profilesRoot, profile.id));
  return {
    root,
    persistentRuntimeRoot: path.join(root, '.click-interval-runtime'),
    persistentServerState: path.join(root, '.click-interval-runtime', 'minecraft-server.json'),
    persistentPlayitState: path.join(root, '.click-interval-runtime', 'playit-agent.json'),
    persistentVelocityState: path.join(root, '.click-interval-runtime', 'restart-proxy.json'),
    persistentLimboState: path.join(root, '.click-interval-runtime', 'restart-lobby.json'),
    config: path.join(root, 'assembly-config.json'),
    mods: path.join(root, 'mods'),
    plugins: path.join(root, 'plugins'),
    logs: path.join(root, 'logs'),
    serverProperties: path.join(root, SERVER_PROPERTIES),
    eula: path.join(root, 'eula.txt'),
    vanillaJar: path.join(root, 'minecraft-server.jar'),
    platform: path.join(root, PLATFORM_FILE),
    security: path.join(root, SECURITY_FILE),
    protectionConfig: path.join(root, PROTECTION_CONFIG_FILE),
    protectionHistory: path.join(root, PROTECTION_HISTORY_FILE),
    customAntiCheats: path.join(root, CUSTOM_ANTICHEATS_FILE),
    accessControl: path.join(root, ACCESS_CONTROL_FILE),
    accessTeams: path.join(root, ACCESS_TEAMS_FILE),
    addonMetadata: path.join(root, ADDON_METADATA_FILE),
    serverTools: path.join(root, SERVER_TOOLS_FILE),
    worldMapMetadata: path.join(root, WORLD_MAP_METADATA_FILE),
    worldMapConfig: path.join(root, 'squaremap', 'config.yml'),
    worldMapWeb: path.join(root, 'squaremap', 'web'),
    worldMapPlayers: path.join(root, 'squaremap', 'web', 'tiles', 'players.json'),
    nativeWorldMapSnapshot: path.join(root, 'click-interval-map', 'snapshot.json'),
    nativeWorldMapTerrain: path.join(root, 'click-interval-map', 'terrain.json'),
    seamlessRestartRoot: path.join(root, '.click-interval-seamless-restart'),
    seamlessRestartVelocityRoot: path.join(root, '.click-interval-seamless-restart', 'velocity'),
    seamlessRestartVelocityJar: path.join(root, '.click-interval-seamless-restart', 'velocity', 'velocity.jar'),
    seamlessRestartVelocityConfig: path.join(root, '.click-interval-seamless-restart', 'velocity', 'velocity.toml'),
    seamlessRestartVelocitySecret: path.join(root, '.click-interval-seamless-restart', 'velocity', 'forwarding.secret'),
    seamlessRestartVelocityPlugins: path.join(root, '.click-interval-seamless-restart', 'velocity', 'plugins'),
    seamlessRestartCoordinatorJar: path.join(root, '.click-interval-seamless-restart', 'velocity', 'plugins', 'ClickIntervalRestartProxy.jar'),
    seamlessRestartCoordinatorConfig: path.join(root, '.click-interval-seamless-restart', 'velocity', 'plugins', 'clickinterval-restart-proxy', 'config.properties'),
    seamlessRestartLimboRoot: path.join(root, '.click-interval-seamless-restart', 'limbo'),
    seamlessRestartLimboJar: path.join(root, '.click-interval-seamless-restart', 'limbo', 'NanoLimbo.jar'),
    seamlessRestartLimboConfig: path.join(root, '.click-interval-seamless-restart', 'limbo', 'settings.yml'),
    seamlessRestartLimboSecret: path.join(root, '.click-interval-seamless-restart', 'limbo', 'forwarding.secret'),
    seamlessRestartHoldingManifest: path.join(root, '.click-interval-seamless-restart', 'holding-lobby.json'),
    seamlessRestartMetadata: path.join(root, '.click-interval-seamless-restart', 'metadata.json'),
    seamlessRestartNotices: path.join(root, '.click-interval-seamless-restart', 'THIRD-PARTY-NOTICES.txt'),
    seamlessRestartRollback: path.join(root, '.click-interval-seamless-restart', 'rollback'),
    seamlessRestartFabricProxyBackupJar: path.join(root, '.click-interval-seamless-restart', 'rollback', 'FabricProxy-Lite.jar.previous'),
    seamlessRestartFabricProxyBackupConfig: path.join(root, '.click-interval-seamless-restart', 'rollback', 'FabricProxy-Lite.toml.previous'),
    seamlessRestartFabricProxyJar: path.join(root, 'mods', 'FabricProxy-Lite.jar'),
    seamlessRestartFabricProxyConfig: path.join(root, 'config', 'FabricProxy-Lite.toml'),
    tradeAssistantMetadata: path.join(root, 'trade-assistant-tool.json'),
    tradeAssistantDirectory: path.join(root, 'config', 'servertradeassistant'),
    tradeAssistantToken: path.join(root, 'config', 'servertradeassistant', 'control-token.txt'),
    tradeAssistantRequests: path.join(root, 'config', 'servertradeassistant', 'requests'),
    tradeAssistantResponses: path.join(root, 'config', 'servertradeassistant', 'responses'),
    tradeAssistantMapSnapshot: path.join(root, 'config', 'servertradeassistant', 'map-snapshot.json'),
    voiceStatus: path.join(root, 'plugins', BUNDLED_VOICE_NAME, 'status.json'),
    voiceConfig: path.join(root, 'plugins', BUNDLED_VOICE_NAME, 'config.yml'),
    fabricVoiceStatus: path.join(root, 'config', 'proximity-voice-server', 'status.json'),
    fabricVoiceConfig: path.join(root, 'config', 'proximity-voice-server', 'config.properties'),
    deathLootConfig: path.join(root, 'config', 'server-death-loot', 'config.properties'),
    deathLootMetadata: path.join(root, 'death-loot-tool.json'),
    simpleVoiceModConfig: path.join(root, 'config', 'voicechat', 'voicechat-server.properties'),
    simpleVoicePluginConfig: path.join(root, 'plugins', 'voicechat', 'voicechat-server.properties'),
    voiceNetwork: path.join(root, VOICE_NETWORK_FILE),
    secrets: path.join(root, 'assembly-secrets.json'),
    assemblyBans: path.join(root, 'assembly-bans.json'),
    playerHistory: path.join(root, 'assembly-player-history.json'),
    playerViewRecovery: path.join(root, PLAYER_VIEW_RECOVERY_FILE),
    nativePlayerBans: path.join(root, 'banned-players.json'),
    playerCache: path.join(root, 'usercache.json'),
    protectionOffenses: path.join(root, 'plugins', BUNDLED_PROTECTION_NAME, 'offenses.properties'),
    legacyProtectionOffenses: path.join(root, 'plugins', LEGACY_BUNDLED_PROTECTION_NAME, 'offenses.properties'),
    fabricProtectionDir: path.join(root, 'config', 'server-protection'),
    fabricProtectionConfig: path.join(root, 'config', 'server-protection', 'config.yml'),
    fabricProtectionAccess: path.join(root, 'config', 'server-protection', 'access.yml'),
    fabricProtectionEvents: path.join(root, 'config', 'server-protection', 'events.jsonl'),
    fabricProtectionOffenses: path.join(root, 'config', 'server-protection', 'offenses.properties'),
    fabricProtectionStatus: path.join(root, 'config', 'server-protection', 'status.json'),
    fabricAntiXrayConfig: path.join(root, 'config', 'meowantixray.yml')
  };
}

async function getPaths() {
  return getPathsForProfile(await getActiveProfile());
}

async function getProfilesWithIcons(profileState) {
  const profiles = await mapWithConcurrency(profileState.profiles.slice(0, MAX_PROFILE_COUNT), 4, async (profile) => {
    const paths = getPathsForProfile(profile);
    const config = await readJson(paths.config, DEFAULT_CONFIG);
    return {
      ...profile,
      levelName: config.levelName || profile.name,
      iconDataUrl: await getWorldIconDataUrl(paths, config).catch(() => '')
    };
  });
  return { ...profileState, profiles };
}

function getToolPaths() {
  const tools = path.join(app.getPath('userData'), 'tools');
  return {
    tools,
    playitExe: path.join(tools, 'playit.exe'),
    playitMetadata: path.join(tools, 'playit-agent.json')
  };
}

async function ensureServerDirs() {
  const paths = await getPaths();
  const tools = getToolPaths();
  await fs.mkdir(paths.root, { recursive: true });
  await fs.mkdir(paths.mods, { recursive: true });
  await fs.mkdir(paths.plugins, { recursive: true });
  await fs.mkdir(paths.logs, { recursive: true });
  await fs.mkdir(tools.tools, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return { ...fallback };
    return { ...fallback, ...JSON.parse(await fs.readFile(file, 'utf8')) };
  } catch {
    return { ...fallback };
  }
}

function clampInteger(value, minimum, maximum, fallback) {
  const text = typeof value === 'string' ? value.trim() : value;
  const parsed = text === '' || text === null || text === undefined ? Number.NaN : Number(text);
  const resolved = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(maximum, Math.max(minimum, resolved));
}

function normalizeServerConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const localOnly = source.localOnly === true;
  const port = clampInteger(source.port, 1, 65535, DEFAULT_CONFIG.port);
  const voiceUdpPort = clampInteger(source.voiceUdpPort, 0, 65535, 0);
  const bindIp = localOnly ? LOCAL_ONLY_BIND_IP : String(source.bindIp || '').trim().slice(0, 253);
  const seamlessRestart = normalizeSeamlessRestartConfig({
    ...(source.seamlessRestart && typeof source.seamlessRestart === 'object' ? source.seamlessRestart : {}),
    proxyPort: port,
    proxyHost: bindIp || (localOnly ? LOCAL_ONLY_BIND_IP : '0.0.0.0'),
    localOnly
  }, {
    localOnly,
    publicPort: port,
    publicHost: bindIp || (localOnly ? LOCAL_ONLY_BIND_IP : '0.0.0.0'),
    reservedPorts: [voiceUdpPort]
  });
  const requestedDeathLootMode = String(source.deathLootMode || DEFAULT_CONFIG.deathLootMode).trim().toLowerCase();
  const deathChestLifetimeInput = source.deathChestLifetimeSeconds;
  const parsedDeathChestLifetime = deathChestLifetimeInput === '' || deathChestLifetimeInput === null || deathChestLifetimeInput === undefined
    ? DEFAULT_CONFIG.deathChestLifetimeSeconds
    : Math.round(Number(deathChestLifetimeInput));
  return {
    ...DEFAULT_CONFIG,
    ...source,
    lockNether: source.lockNether === true,
    lockEnd: source.lockEnd === true,
    motd: String(source.motd ?? DEFAULT_CONFIG.motd).replace(/\r\n?/g, '\n').replace(/\n/g, '\\n').slice(0, 1024),
    memoryMb: clampInteger(source.memoryMb, 512, 131072, DEFAULT_CONFIG.memoryMb),
    port,
    voiceUdpPort,
    voicePublicAddress: String(source.voicePublicAddress || '').trim().slice(0, 512),
    bindIp,
    publicAddress: localOnly ? '' : String(source.publicAddress || '').trim().slice(0, 512),
    directHostingEnabled: !localOnly && source.directHostingEnabled === true,
    localOnly,
    localOnlyPreviousBindIp: String(source.localOnlyPreviousBindIp || '').trim().slice(0, 253),
    seamlessRestart,
    maxPlayers: clampInteger(source.maxPlayers, 1, 10000, DEFAULT_CONFIG.maxPlayers),
    playerHistoryLimit: clampInteger(source.playerHistoryLimit, 10, 1000, DEFAULT_CONFIG.playerHistoryLimit),
    emptyServerAction: String(source.emptyServerAction || DEFAULT_CONFIG.emptyServerAction).trim().toLowerCase() === 'stop'
      ? 'stop'
      : 'never',
    emptyServerStopMinutes: clampInteger(source.emptyServerStopMinutes, 1, 1440, DEFAULT_CONFIG.emptyServerStopMinutes),
    keepSystemAwakeWhileRunning: source.keepSystemAwakeWhileRunning !== false,
    deathLootMode: ['timed', 'chest'].includes(requestedDeathLootMode) ? requestedDeathLootMode : 'vanilla',
    deathDropLifetimeSeconds: clampInteger(
      source.deathDropLifetimeSeconds,
      1,
      86_400,
      DEFAULT_CONFIG.deathDropLifetimeSeconds
    ),
    deathChestLifetimeSeconds: Number.isFinite(parsedDeathChestLifetime) && parsedDeathChestLifetime === 0
      ? 0
      : Math.min(604_800, Math.max(1, Number.isFinite(parsedDeathChestLifetime)
        ? parsedDeathChestLifetime
        : DEFAULT_CONFIG.deathChestLifetimeSeconds)),
    deathChestTorches: source.deathChestTorches !== false,
    spawnProtection: clampInteger(source.spawnProtection, 0, 29999984, DEFAULT_CONFIG.spawnProtection),
    playersSleepingPercentage: clampInteger(source.playersSleepingPercentage, 0, 100, DEFAULT_CONFIG.playersSleepingPercentage),
    spawnRadius: clampInteger(source.spawnRadius, 0, 128, DEFAULT_CONFIG.spawnRadius),
    randomTickSpeed: clampInteger(source.randomTickSpeed, 0, 100, DEFAULT_CONFIG.randomTickSpeed),
    viewDistance: clampInteger(source.viewDistance, 2, 32, DEFAULT_CONFIG.viewDistance),
    simulationDistance: clampInteger(source.simulationDistance, 2, 32, DEFAULT_CONFIG.simulationDistance),
    functionPermissionLevel: clampInteger(source.functionPermissionLevel, 1, 4, DEFAULT_CONFIG.functionPermissionLevel),
    opPermissionLevel: clampInteger(source.opPermissionLevel, 1, 4, DEFAULT_CONFIG.opPermissionLevel),
    uiMode: 'revamped'
  };
}

function configForLocalOnlyMode(config, enabled) {
  const current = normalizeServerConfig(config);
  if (enabled) {
    return normalizeServerConfig({
      ...current,
      localOnly: true,
      localOnlyPreviousBindIp: current.localOnly
        ? current.localOnlyPreviousBindIp
        : current.bindIp,
      bindIp: LOCAL_ONLY_BIND_IP,
      publicAddress: '',
      directHostingEnabled: false
    });
  }
  if (!current.localOnly) return current;
  return normalizeServerConfig({
    ...current,
    localOnly: false,
    bindIp: current.localOnlyPreviousBindIp || '',
    localOnlyPreviousBindIp: '',
    publicAddress: '',
    directHostingEnabled: false
  });
}

async function getRecordedPlatformIdentity(paths, config) {
  const metadata = await readJson(paths.platform, {});
  if (!Object.keys(metadata).length) return null;
  const type = normalizeServerType(metadata?.type);
  const trusted = metadata?.verified === true && (
    (type === 'vanilla' && metadata.source === 'mojang') ||
    (type === 'paper' && metadata.source === 'papermc') ||
    (type === 'fabric' && metadata.source === 'fabricmc')
  );
  if (!trusted) return null;
  const jarPath = config.jarPath || paths.vanillaJar;
  if (path.resolve(jarPath) !== path.resolve(paths.vanillaJar)) return null;
  try {
    const stat = await fs.stat(jarPath);
    if (!stat.isFile() || (Number(metadata.size) > 0 && stat.size !== Number(metadata.size))) return null;
  } catch {
    return null;
  }
  return {
    type,
    version: String(metadata.minecraftVersion || config.serverVersion || 'latest'),
    jarPath: paths.vanillaJar
  };
}

async function reconcileConfigWithInstalledPlatform(config, paths) {
  const identity = await getRecordedPlatformIdentity(paths, config);
  if (!identity) return { config, changed: false, identity: null };
  const selectedType = normalizeServerType(config.serverType);
  const selectedVersion = String(config.serverVersion || 'latest');
  const changed = selectedType !== identity.type || selectedVersion !== identity.version || path.resolve(config.jarPath || paths.vanillaJar) !== path.resolve(identity.jarPath);
  if (!changed) return { config, changed: false, identity };
  return {
    config: {
      ...config,
      requestedServerType: selectedType,
      requestedServerVersion: selectedVersion,
      serverType: identity.type,
      serverVersion: identity.version,
      jarPath: identity.jarPath
    },
    changed: true,
    identity
  };
}

async function readConfig(pathsOverride = null) {
  if (worldResetReadSnapshot) {
    const requestedPaths = pathsOverride || await getPaths();
    if (path.resolve(requestedPaths.root) === worldResetReadSnapshot.root) {
      return { ...worldResetReadSnapshot.config };
    }
  }
  if (!pathsOverride) await ensureServerDirs();
  const paths = pathsOverride || await getPaths();
  await assertNoPendingWorldReset(paths.root);
  let config = normalizeServerConfig(await readJson(paths.config, DEFAULT_CONFIG));
  let migrated = false;
  if (!isSafeWorldName(config.levelName)) {
    config.levelName = makeSafeWorldName(config.levelName, 'world');
    migrated = true;
  }
  if (config.allowCheats === undefined && config.enableCommandBlock !== undefined) {
    config.allowCheats = Boolean(config.enableCommandBlock);
  }
  if (!String(config.seed || '').trim()) {
    config.seed = generateSeed();
    migrated = true;
  }
  const reconciled = await reconcileConfigWithInstalledPlatform(config, paths);
  config = reconciled.config;
  migrated = migrated || reconciled.changed;
  if (migrated) {
    await writeConfig(config, paths);
  }
  // World-local state owns these values, including schedules set through the
  // physical server console. Reading Settings never changes or starts a timer.
  try {
    const locks = await dimensionLockSettings.readState(paths.root, config.levelName);
    if (locks.exists) {
      config.lockNether = locks.state.nether.locked;
      config.lockEnd = locks.state.end.locked;
    }
  } catch (_) {
    // getDimensionLockSettingsStatus exposes the error and disables the controls.
  }
  return {
    ...config,
    jarPath: config.jarPath || paths.vanillaJar
  };
}

async function writeConfig(config, pathsOverride = null, options = {}) {
  const paths = pathsOverride || await getPaths();
  return serializeFileWrite(paths.config, async () => {
    if (worldResetReadSnapshot?.root === path.resolve(paths.root)) {
      throw new Error('Wait for Reset Data to finish before saving server Settings.');
    }
    let source = { ...config };
    delete source._dimensionLockChanges;
    if (options.allowSeamlessRestartMutation !== true) {
      const current = await readJson(paths.config, {});
      if (current?.seamlessRestart && typeof current.seamlessRestart === 'object' &&
          !Array.isArray(current.seamlessRestart)) {
        // Seamless enablement/provenance is transaction-owned. Ordinary and
        // stale config writers may update other settings but cannot undo a
        // setup/disable commit that won the serialized file lock.
        source.seamlessRestart = current.seamlessRestart;
      } else {
        source.seamlessRestart = DEFAULT_CONFIG.seamlessRestart;
      }
    }
    const normalized = normalizeServerConfig({
      ...source,
      levelName: validateWorldName(source.levelName)
    });
    const reconciled = await reconcileConfigWithInstalledPlatform(normalized, paths);
    const next = reconciled.config;
    const configTemporary = `${paths.config}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(configTemporary, JSON.stringify(next, null, 2));
    await replaceFileAtomically(configTemporary, paths.config);
    await writeServerProperties(next, paths);
    await writeDeathLootRuntimeConfig(paths, next);
    const eulaTemporary = `${paths.eula}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(eulaTemporary, `eula=${next.acceptEula ? 'true' : 'false'}\n`);
    await replaceFileAtomically(eulaTemporary, paths.eula);
    await prunePlayerHistoryForPaths(paths, next.playerHistoryLimit);
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    return next;
  });
}

function serializeDeathLootRuntimeConfig(config) {
  const normalized = normalizeServerConfig(config);
  return [
    '# Server Death Loot - managed by the server settings page',
    `mode=${normalized.deathLootMode}`,
    `death-drop-lifetime-seconds=${normalized.deathDropLifetimeSeconds}`,
    `death-chest-lifetime-seconds=${normalized.deathChestLifetimeSeconds}`,
    `place-torches=${normalized.deathChestTorches ? 'true' : 'false'}`,
    ''
  ].join('\n');
}

async function writeDeathLootRuntimeConfig(paths, config) {
  if (!paths?.deathLootConfig) throw new Error('The death-loot config path is unavailable.');
  const contents = serializeDeathLootRuntimeConfig(config);
  return serializeFileWrite(paths.deathLootConfig, async () => {
    await fs.mkdir(path.dirname(paths.deathLootConfig), { recursive: true });
    const temporary = `${paths.deathLootConfig}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.writeFile(temporary, contents, 'utf8');
      await replaceFileAtomically(temporary, paths.deathLootConfig);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    return paths.deathLootConfig;
  });
}

function getBundledDeathLootAdapter(serverType, minecraftVersion = '') {
  if (normalizeServerType(serverType) !== 'fabric' ||
      normalizeAddonVersion(minecraftVersion) !== BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT) return null;
  return Object.freeze({
    id: `fabric-${BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT}`,
    kind: 'mods',
    minecraftVersion: BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT,
    managedFile: BUNDLED_DEATH_LOOT_FABRIC_JAR,
    projectDirectory: 'death-loot-fabric',
    artifactFile: BUNDLED_DEATH_LOOT_FABRIC_ARTIFACT,
    sha256: BUNDLED_DEATH_LOOT_FABRIC_SHA256,
    size: BUNDLED_DEATH_LOOT_FABRIC_SIZE,
    dependencyFile: BUNDLED_TELEPORT_FABRIC_API_JAR,
    dependencyArtifactFile: BUNDLED_TELEPORT_FABRIC_API_ARTIFACT,
    dependencySha256: BUNDLED_TELEPORT_FABRIC_API_SHA256,
    dependencySize: BUNDLED_TELEPORT_FABRIC_API_SIZE
  });
}

function normalizeDeathLootMetadata(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const adapter = getBundledDeathLootAdapter('fabric', source.minecraftVersion);
  const sha256 = String(source.sha256 || '').trim().toLowerCase();
  const size = Number(source.size) || 0;
  const dependencyFile = String(source.dependencyFile || '').trim();
  if (!adapter || source.adapterId !== adapter.id || source.file !== adapter.managedFile ||
      !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size <= 0) {
    return { version: 1, managed: null };
  }
  return {
    version: 1,
    managed: {
      adapterId: adapter.id,
      kind: adapter.kind,
      minecraftVersion: adapter.minecraftVersion,
      file: adapter.managedFile,
      sha256,
      size,
      installedAt: String(source.installedAt || '').trim().slice(0, 40),
      dependencyFile: dependencyFile && dependencyFile === path.basename(dependencyFile) && /\.jar$/i.test(dependencyFile)
        ? dependencyFile : '',
      dependencyProvisioned: Boolean(source.dependencyProvisioned)
    }
  };
}

async function readDeathLootMetadata(paths) {
  try {
    const stat = await fs.stat(paths.deathLootMetadata);
    if (!stat.isFile() || stat.size > 256 * 1024) return normalizeDeathLootMetadata();
    return normalizeDeathLootMetadata(JSON.parse(await fs.readFile(paths.deathLootMetadata, 'utf8')));
  } catch {
    return normalizeDeathLootMetadata();
  }
}

async function writeDeathLootMetadata(paths, record) {
  const normalized = normalizeDeathLootMetadata(record);
  if (!normalized.managed) throw new Error('The managed death-loot metadata failed validation.');
  await writeJsonAtomically(paths.deathLootMetadata, normalized.managed);
  return normalized.managed;
}

function inspectionMatchesBundledDeathLoot(inspection, adapter) {
  return Boolean(inspection && adapter && inspection.kind === 'mods' &&
    inspection.descriptor === 'fabric.mod.json' &&
    inspection.fabricModId === BUNDLED_DEATH_LOOT_FABRIC_MOD_ID &&
    inspection.fabricEnvironment === 'server' &&
    inspection.fabricMainEntrypoints.includes(BUNDLED_DEATH_LOOT_FABRIC_ENTRYPOINT) &&
    fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, adapter.minecraftVersion) &&
    inspection.bundledFabricDeathLootIdentity === true);
}

function classifyBundledDeathLootInstall({ artifact = null, installed = null, record = null, adapter = null } = {}) {
  const normalizedRecord = normalizeDeathLootMetadata(record || {}).managed;
  const identity = Boolean(installed && inspectionMatchesBundledDeathLoot(installed, adapter) &&
    /^[a-f0-9]{64}$/i.test(String(installed.sha256 || '')));
  const matchesArtifact = Boolean(identity && artifact && installed.sha256 === artifact.sha256 &&
    installed.size === artifact.size);
  const matchesRecord = Boolean(identity && normalizedRecord && normalizedRecord.adapterId === adapter?.id &&
    normalizedRecord.sha256 === installed.sha256 && normalizedRecord.size === installed.size);
  return {
    installed: Boolean(installed),
    identity,
    matchesArtifact,
    matchesRecord,
    managed: Boolean(matchesArtifact || matchesRecord),
    conflict: Boolean(installed && !(matchesArtifact || matchesRecord)),
    updateAvailable: Boolean((matchesArtifact || matchesRecord) && artifact && !matchesArtifact)
  };
}

async function inspectInstalledBundledDeathLoot(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    const inspection = await getCachedWork(
      `installed-death-loot:${file}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(file)
    );
    return { file, stat, ...inspection };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return {
      file,
      kind: '',
      fabricModId: '',
      bundledFabricDeathLootIdentity: false,
      sha256: '',
      size: 0,
      inspectionError: String(error?.message || error || 'The death-loot mod could not be inspected.')
    };
  }
}

async function findBundledDeathLootArtifact(adapter) {
  if (!adapter || !/^[a-f0-9]{64}$/i.test(adapter.sha256) || adapter.size <= 0) return null;
  const candidate = path.join(__dirname, adapter.projectDirectory, 'dist', adapter.artifactFile);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size !== adapter.size) return null;
    const inspection = await getCachedWork(
      `bundled-death-loot:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (inspection.sha256 !== adapter.sha256 || !inspectionMatchesBundledDeathLoot(inspection, adapter)) return null;
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function findBundledDeathLootDependencyArtifact(adapter) {
  if (!adapter) return null;
  const candidates = [
    path.join(__dirname, 'server-protection-fabric-26.2', 'dist', adapter.dependencyArtifactFile),
    path.join(__dirname, adapter.projectDirectory, 'dist', adapter.dependencyArtifactFile)
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size !== adapter.dependencySize) continue;
      const inspection = await getCachedWork(
        `bundled-death-loot-dependency:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      if (inspection.sha256 === adapter.dependencySha256 && inspectionIsFabricApi(inspection) &&
          isCompatibleFabricApiVersion(inspection.fabricVersion, adapter.minecraftVersion)) {
        return { path: candidate, stat, ...inspection };
      }
    } catch {}
  }
  return null;
}

async function inspectDeathLootModFolder(paths, adapter) {
  const index = await getModDescriptorIndex(paths);
  const duplicateMods = index.files.filter((entry) =>
    entry.descriptor?.fabricModId === BUNDLED_DEATH_LOOT_FABRIC_MOD_ID &&
    entry.name.toLowerCase() !== adapter.managedFile.toLowerCase());
  const fabricApis = index.files.filter((entry) => entry.descriptor?.fabricModId === 'fabric-api');
  const compatibleFabricApis = fabricApis.filter((entry) =>
    isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, adapter.minecraftVersion));
  const dependencyConflict = fabricApis.length > 1 ||
    (fabricApis.length === 1 && compatibleFabricApis.length !== 1);
  return {
    partial: Boolean(index.partial),
    warning: String(index.warning || ''),
    duplicateMods,
    fabricApis,
    compatibleFabricApis,
    dependencyConflict,
    dependencyReady: !dependencyConflict && compatibleFabricApis.length === 1,
    dependencyFile: compatibleFabricApis[0]?.name || ''
  };
}

async function removeManagedDeathLootBeforeStart({ profileSnapshot, paths, revalidate }) {
  const adapter = getBundledDeathLootAdapter('fabric', BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT);
  const metadata = await readDeathLootMetadata(paths);
  const record = metadata.managed;
  const destination = path.join(paths.mods, adapter.managedFile);
  const installed = await inspectInstalledBundledDeathLoot(destination);
  if (!installed) {
    if (record) {
      await revalidate();
      await serializeFileWrite(paths.deathLootMetadata, () => fs.rm(paths.deathLootMetadata, { force: true }))
        .catch((error) => appendServerLog(
          `[Death Loot] The stale ownership record could not be removed: ${error?.message || error}\n`
        ));
      await removeInstalledAddonMetadata(paths, 'mods', adapter.managedFile).catch(() => {});
    }
    return { checked: Boolean(record), removed: false, reason: record ? 'stale-metadata' : 'not-installed' };
  }
  const recordedInstall = Boolean(record && record.adapterId === adapter.id &&
    inspectionMatchesBundledDeathLoot(installed, adapter) &&
    installed.sha256 === record.sha256 && installed.size === record.size);
  if (!recordedInstall) {
    appendServerLog(
      `[Death Loot] ${adapter.managedFile} is not a verified manager-owned copy, so vanilla mode left it untouched.\n`
    );
    return { checked: true, removed: false, reason: 'unmanaged' };
  }

  await revalidate();
  const current = await inspectInstalledBundledDeathLoot(destination);
  if (!current || current.sha256 !== installed.sha256 || current.size !== installed.size ||
      !inspectionMatchesBundledDeathLoot(current, adapter)) {
    throw new Error(`${adapter.managedFile} changed while vanilla death loot was being prepared. It was left untouched.`);
  }
  const quarantine = `${destination}.disabled-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  await fs.rename(destination, quarantine);
  try {
    const moved = await inspectInstalledBundledDeathLoot(quarantine);
    if (!moved || moved.sha256 !== record.sha256 || moved.size !== record.size ||
        !inspectionMatchesBundledDeathLoot(moved, adapter)) {
      throw new Error('the quarantined JAR did not match its verified managed record');
    }
    await fs.rm(quarantine);
  } catch (error) {
    await fs.rename(quarantine, destination).catch(() => {});
    throw new Error(`Server Death Loot could not be disabled safely: ${error?.message || error}`);
  }
  await serializeFileWrite(paths.deathLootMetadata, () => fs.rm(paths.deathLootMetadata, { force: true }))
    .catch((error) => appendServerLog(
      `[Death Loot] Disabled successfully, but its ownership record could not be removed: ${error?.message || error}\n`
    ));
  await removeInstalledAddonMetadata(paths, 'mods', adapter.managedFile).catch((error) => appendServerLog(
    `[Death Loot] Disabled successfully, but add-on list metadata could not be refreshed: ${error?.message || error}\n`
  ));
  invalidateStatusCache();
  invalidateCachedWork(`disk-size:${paths.root}`);
  appendServerLog('[Death Loot] Disabled the verified managed death-loot mod for vanilla death drops.\n');
  return { checked: true, removed: true, reason: 'vanilla' };
}

async function refreshManagedDeathLootBeforeStartUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot;
  const paths = context.paths || profileSnapshot?.paths;
  const serverConfig = normalizeServerConfig(context.serverConfig || {});
  const platform = context.platform;
  const revalidate = context.revalidate;
  if (!profileSnapshot?.profileId || !paths || !platform || typeof revalidate !== 'function') {
    throw new Error('Death loot did not receive a verified startup context.');
  }
  await writeDeathLootRuntimeConfig(paths, serverConfig);
  if (serverConfig.deathLootMode === 'vanilla') {
    const removal = await removeManagedDeathLootBeforeStart({ profileSnapshot, paths, revalidate });
    return { ...removal, installed: false, updated: false };
  }

  const adapter = getBundledDeathLootAdapter(
    serverConfig.serverType,
    platform.minecraftVersion || serverConfig.serverVersion
  );
  if (!adapter || !platform.jarExists || !platform.compatible || platform.supportsMods === false) {
    throw new Error(
      `Death-only loot modes require the verified Fabric ${BUNDLED_DEATH_LOOT_FABRIC_MINECRAFT} server runtime.`
    );
  }
  const [artifact, dependencyArtifact, metadata, folderState] = await Promise.all([
    findBundledDeathLootArtifact(adapter),
    findBundledDeathLootDependencyArtifact(adapter),
    readDeathLootMetadata(paths),
    inspectDeathLootModFolder(paths, adapter)
  ]);
  if (!artifact) throw new Error('The pinned Server Death Loot Fabric mod is missing or failed integrity inspection.');
  if (folderState.partial) {
    throw new Error(folderState.warning || 'The mods folder could not be inspected completely before enabling death loot.');
  }
  if (folderState.duplicateMods.length) {
    throw new Error(`Another ${BUNDLED_DEATH_LOOT_FABRIC_MOD_ID} mod is already installed as ${folderState.duplicateMods[0].name}.`);
  }
  if (folderState.dependencyConflict) {
    throw new Error('Fabric API is duplicated or does not match Minecraft 26.2. Death loot was left unchanged.');
  }
  if (!folderState.dependencyReady && !dependencyArtifact) {
    throw new Error('The pinned Fabric API dependency for death loot is missing or failed integrity inspection.');
  }

  const destination = path.join(paths.mods, adapter.managedFile);
  const installed = await inspectInstalledBundledDeathLoot(destination);
  const classification = classifyBundledDeathLootInstall({
    artifact,
    installed,
    record: metadata.managed,
    adapter
  });
  if (classification.conflict) {
    throw new Error(
      `${adapter.managedFile} exists but is not a verified managed copy. It was left untouched.`
    );
  }

  const dependencyDestination = path.join(paths.mods, adapter.dependencyFile);
  const stageToken = `${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  const mainTemporary = `${destination}.install-${stageToken}`;
  const mainRollback = `${destination}.rollback-${stageToken}`;
  const dependencyTemporary = `${dependencyDestination}.install-${stageToken}`;
  const needsMainPublish = !classification.matchesArtifact;
  const needsDependencyPublish = !folderState.dependencyReady;
  let mainPublished = false;
  let mainReplaced = false;
  let dependencyPublished = false;
  let finalDependencyFile = folderState.dependencyFile;
  let commitComplete = false;
  let retainRollback = false;
  try {
    await revalidate();
    await fs.mkdir(paths.mods, { recursive: true });
    if (needsMainPublish) {
      await fs.copyFile(artifact.path, mainTemporary, fss.constants.COPYFILE_EXCL);
      const staged = await inspectAntiCheatJar(mainTemporary);
      if (staged.sha256 !== adapter.sha256 || staged.size !== adapter.size ||
          !inspectionMatchesBundledDeathLoot(staged, adapter)) {
        throw new Error('The staged Server Death Loot mod failed its integrity check.');
      }
    }
    if (needsDependencyPublish) {
      await fs.copyFile(dependencyArtifact.path, dependencyTemporary, fss.constants.COPYFILE_EXCL);
      const stagedDependency = await inspectAntiCheatJar(dependencyTemporary);
      if (stagedDependency.sha256 !== adapter.dependencySha256 ||
          stagedDependency.size !== adapter.dependencySize || !inspectionIsFabricApi(stagedDependency) ||
          !isCompatibleFabricApiVersion(stagedDependency.fabricVersion, adapter.minecraftVersion)) {
        throw new Error('The staged Fabric API dependency failed its integrity check.');
      }
    }

    await revalidate();
    const currentInstalled = await inspectInstalledBundledDeathLoot(destination);
    if (installed) {
      if (!currentInstalled || currentInstalled.sha256 !== installed.sha256 || currentInstalled.size !== installed.size) {
        throw new Error(`${adapter.managedFile} changed during startup preparation and was left untouched.`);
      }
    } else if (currentInstalled) {
      throw new Error(`${adapter.managedFile} appeared during startup preparation and was left untouched.`);
    }
    const currentFolderState = await inspectDeathLootModFolder(paths, adapter);
    if (currentFolderState.partial || currentFolderState.duplicateMods.length || currentFolderState.dependencyConflict ||
        (!needsDependencyPublish && !currentFolderState.dependencyReady)) {
      throw new Error('The mods folder changed during death-loot preparation. No managed mod was replaced.');
    }
    finalDependencyFile = currentFolderState.dependencyFile;

    if (needsDependencyPublish && !currentFolderState.dependencyReady) {
      try {
        await fs.link(dependencyTemporary, dependencyDestination);
      } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${adapter.dependencyFile} appeared during installation.`);
        throw error;
      }
      dependencyPublished = true;
      finalDependencyFile = adapter.dependencyFile;
      await fs.rm(dependencyTemporary, { force: true });
    }
    const dependencyNow = await inspectInstalledBundledDeathLoot(path.join(paths.mods, finalDependencyFile));
    if (!dependencyNow || !inspectionIsFabricApi(dependencyNow) ||
        !isCompatibleFabricApiVersion(dependencyNow.fabricVersion, adapter.minecraftVersion)) {
      throw new Error('Fabric API changed during death-loot preparation. No unmanaged file was replaced.');
    }

    if (needsMainPublish && installed) {
      await fs.copyFile(destination, mainRollback, fss.constants.COPYFILE_EXCL);
      await replaceFileAtomically(mainTemporary, destination);
      mainPublished = true;
      mainReplaced = true;
    } else if (needsMainPublish) {
      try {
        await fs.link(mainTemporary, destination);
      } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${adapter.managedFile} appeared during installation.`);
        throw error;
      }
      mainPublished = true;
      await fs.rm(mainTemporary, { force: true });
    }

    const finalInstall = await inspectInstalledBundledDeathLoot(destination);
    if (!finalInstall || finalInstall.sha256 !== adapter.sha256 || finalInstall.size !== adapter.size ||
        !inspectionMatchesBundledDeathLoot(finalInstall, adapter)) {
      throw new Error('The installed Server Death Loot mod failed final verification.');
    }
    const installedAt = metadata.managed?.installedAt || new Date().toISOString();
    await writeDeathLootMetadata(paths, {
      adapterId: adapter.id,
      minecraftVersion: adapter.minecraftVersion,
      file: adapter.managedFile,
      sha256: adapter.sha256,
      size: adapter.size,
      installedAt,
      dependencyFile: finalDependencyFile,
      dependencyProvisioned: Boolean(metadata.managed?.dependencyProvisioned || dependencyPublished)
    });
    commitComplete = true;
    await upsertInstalledAddonMetadata(paths, {
      kind: 'mods',
      file: adapter.managedFile,
      source: 'imported',
      title: BUNDLED_DEATH_LOOT_NAME,
      author: 'Built in',
      versionName: '1.0.0',
      gameVersion: adapter.minecraftVersion,
      serverType: 'fabric',
      installedAt
    }).catch((error) => appendServerLog(
      `[Death Loot] The mod is installed, but its add-on list metadata could not be refreshed: ${error?.message || error}\n`
    ));
    await fs.rm(mainRollback, { force: true }).catch((error) => appendServerLog(
      `[Death Loot] Install committed, but its temporary rollback copy could not be removed: ${error?.message || error}\n`
    ));
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    appendServerLog(
      `[Death Loot] ${mainPublished ? (mainReplaced ? 'Updated' : 'Installed') : 'Verified'} ` +
      `${adapter.managedFile}; mode=${serverConfig.deathLootMode}, ordinary item drops unchanged.\n`
    );
    return {
      checked: true,
      installed: true,
      updated: Boolean(mainReplaced),
      changed: Boolean(mainPublished || dependencyPublished),
      reason: mainPublished ? 'published' : 'current'
    };
  } catch (error) {
    let mainStateRestored = !mainPublished;
    if (!commitComplete && mainPublished) {
      const current = await inspectInstalledBundledDeathLoot(destination);
      if (current?.sha256 === adapter.sha256 && current?.size === adapter.size) {
        if (mainReplaced && await isRegularFile(mainRollback)) {
          try {
            await replaceFileAtomically(mainRollback, destination);
            mainStateRestored = true;
          } catch (rollbackError) {
            retainRollback = true;
            error.message = `${error.message} Automatic rollback also failed; the verified prior JAR remains at ${mainRollback}: ${rollbackError?.message || rollbackError}`;
          }
        } else if (!mainReplaced) {
          try {
            await fs.rm(destination, { force: true });
            mainStateRestored = !await isRegularFile(destination);
          } catch {}
        }
      }
    }
    if (!commitComplete && dependencyPublished && mainStateRestored) {
      const dependencyNow = await inspectInstalledBundledDeathLoot(dependencyDestination);
      if (dependencyNow?.sha256 === adapter.dependencySha256 && dependencyNow?.size === adapter.dependencySize) {
        await fs.rm(dependencyDestination, { force: true }).catch(() => {});
      }
    }
    throw error;
  } finally {
    await fs.rm(mainTemporary, { force: true }).catch(() => {});
    if (!retainRollback) await fs.rm(mainRollback, { force: true }).catch(() => {});
    await fs.rm(dependencyTemporary, { force: true }).catch(() => {});
  }
}

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

async function checkHostnameAvailability(value) {
  const hostname = normalizeHostname(value);
  if (!hostname) return { hostname: '', available: true, reason: '' };
  if (!/^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(hostname)) {
    return { hostname, available: false, reason: 'INVALID_HOSTNAME', message: 'Enter a domain like example.net.' };
  }
  try {
    await dns.lookup(hostname);
    return {
      hostname,
      available: true,
      reason: '',
      message: 'This domain resolves. Make sure its DNS points to this server before sharing it.'
    };
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        hostname,
        available: false,
        reason: 'HOSTNAME_UNKNOWN',
        message: 'Unknown host. Register this domain or point its DNS to your server first.'
      };
    }
    return { hostname, available: false, reason: 'CHECK_FAILED', message: 'Could not check this address right now.' };
  }
}

function getHostFromAddress(address) {
  const value = String(address || '').trim();
  if (!value) return '';
  if (value.startsWith('[')) return (value.match(/^\[([^\]]+)\]/) || [])[1] || '';
  return value.replace(/:\d+$/, '');
}

function parseServerAddress(address, fallbackPort = 25565) {
  const value = String(address || '').trim();
  if (!value) return { host: '', port: fallbackPort };
  if (value.startsWith('[')) {
    const match = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
    return { host: match?.[1] || '', port: Number(match?.[2]) || fallbackPort };
  }
  const parts = value.split(':');
  if (parts.length > 1 && /^\d+$/.test(parts.at(-1))) {
    return { host: parts.slice(0, -1).join(':'), port: Number(parts.at(-1)) || fallbackPort };
  }
  return { host: value, port: fallbackPort };
}

function testTcpConnect(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve(false);
      return;
    }
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve(true);
    });
    const done = () => {
      socket.destroy();
      resolve(false);
    };
    socket.on('error', done);
    socket.on('timeout', done);
  });
}

function assertTcpEndpointAvailable(host, requestedPort, label = 'Port', timeoutMs = 1500) {
  const port = Math.max(1, Math.min(65_535, Math.round(Number(requestedPort) || 25_565)));
  const bindHost = String(host || '').trim() || '0.0.0.0';
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAllListeners();
      try { probe.close(); } catch {}
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(
      `Could not safely verify ${bindHost}:${port} before startup. Minecraft was not started.`
    )), Math.max(250, Math.min(5000, Number(timeoutMs) || 1500)));
    timer.unref?.();
    probe.unref?.();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE' || error?.code === 'EACCES') {
        finish(new Error(
          `${label} ${port} on ${bindHost} is already in use by another server or service. ` +
          'Minecraft was not started; stop that service or choose another port.'
        ));
        return;
      }
      finish(new Error(`Cannot use ${bindHost}:${port}: ${error?.message || String(error)}`));
    });
    probe.listen({ host: bindHost, port, exclusive: true }, () => {
      probe.close((error) => finish(error || null));
    });
  });
}

function assertConfiguredServerPortAvailable(config, timeoutMs = 1500) {
  return assertTcpEndpointAvailable(
    String(config?.bindIp || '').trim() || '0.0.0.0',
    config?.port,
    'Port',
    timeoutMs
  );
}

async function validateCustomHostnameForConfig(config) {
  if (config?.localOnly === true) return;
  const hostname = normalizeHostname(config.customHostname);
  if (!hostname) return;
  const publicHost = getHostFromAddress(config.publicAddress);
  if (!publicHost) {
    throw new Error('Map direct hosting first, then set a custom public join address.');
  }
  let addresses = [];
  try {
    // Validate published DNS, not this PC's hosts-file override. A host may
    // deliberately map its public name to loopback to bypass NAT hairpinning.
    const results = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname)
    ]);
    addresses = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (!addresses.length) throw new Error('No public address records.');
  } catch {
    throw new Error('Unknown host. Register this domain or point its DNS to your server first.');
  }
  if (!addresses.includes(publicHost)) {
    throw new Error(`This custom address points to ${addresses.join(', ') || 'nothing'}, not your server IP ${publicHost}.`);
  }
}

function validateVoicePublicAddressForConfig(config) {
  const value = String(config?.voicePublicAddress || '').trim();
  if (!value) return;
  const endpoint = parseExternalHostPort(
    value,
    normalizeOptionalUdpPort(config?.voiceUdpPort) || DEFAULT_VOICE_UDP_PORT
  );
  if (!endpoint || /^\d+$/.test(String(endpoint.host || ''))) {
    throw new Error('Voice UDP address must be a hostname or IP with an optional UDP port.');
  }
}

function escapePropertyValue(value, options = {}) {
  const source = String(value ?? '').replace(/\r?\n/g, ' ');
  let escaped = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const code = source.charCodeAt(index);
    if (character === '\\' && options.preserveNewlineEscape && source[index + 1] === 'n') {
      escaped += '\\n';
      index += 1;
    } else if (character === '\\') escaped += '\\\\';
    else if (character === '\t') escaped += '\\t';
    else if (character === '\f') escaped += '\\f';
    else if (character === ' ' && index === 0) escaped += '\\ ';
    else if ('=:#!'.includes(character)) escaped += `\\${character}`;
    else if (code < 0x20 || code > 0x7e) escaped += `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
    else escaped += character;
  }
  return escaped;
}

async function writeServerProperties(config, pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const seamless = normalizeSeamlessRestartConfig(config?.seamlessRestart, {
    localOnly: config?.localOnly === true,
    publicPort: config?.port,
    publicHost: String(config?.bindIp || '').trim() || (config?.localOnly ? LOCAL_ONLY_BIND_IP : '0.0.0.0'),
    reservedPorts: [config?.voiceUdpPort]
  });
  const backendBehindProxy = seamless.enabled === true;
  const managed = new Map(Object.entries({
    'server-ip': backendBehindProxy ? seamless.backendHost : config.bindIp,
    'server-port': backendBehindProxy ? seamless.backendPort : config.port,
    'level-name': config.levelName || 'world',
    'level-seed': config.seed,
    motd: config.motd,
    'max-players': config.maxPlayers,
    // FabricProxy-Lite's hackOnlineMode keeps the backend secure while Velocity performs
    // Mojang authentication and forwards the original UUID/skin over the shared secret.
    'online-mode': backendBehindProxy ? true : Boolean(config.onlineMode),
    pvp: Boolean(config.pvp),
    difficulty: config.difficulty || 'easy',
    gamemode: config.gamemode || 'survival',
    'enable-command-block': Boolean(config.allowCheats),
    hardcore: Boolean(config.hardcore),
    'force-gamemode': Boolean(config.forceGamemode),
    'allow-nether': Boolean(config.allowNether),
    'generate-structures': Boolean(config.generateStructures),
    'spawn-animals': Boolean(config.spawnAnimals),
    'spawn-monsters': Boolean(config.spawnMonsters),
    'spawn-npcs': Boolean(config.spawnNpcs),
    'spawn-protection': config.spawnProtection,
    'view-distance': config.viewDistance,
    'simulation-distance': config.simulationDistance,
    'allow-flight': Boolean(config.allowFlight),
    'white-list': Boolean(config.whiteList),
    'enforce-secure-profile': Boolean(config.enforceSecureProfile),
    'enable-rcon': config.localOnly ? false : Boolean(config.enableRcon),
    // Public query belongs to the front proxy. Never expose the loopback backend's query port.
    'enable-query': backendBehindProxy || config.localOnly ? false : Boolean(config.enableQuery),
    'enable-jmx-monitoring': config.localOnly ? false : Boolean(config.enableJmxMonitoring),
    'broadcast-rcon-to-ops': Boolean(config.broadcastRconToOps),
    'hide-online-players': Boolean(config.hideOnlinePlayers),
    'log-ips': Boolean(config.logIps),
    'function-permission-level': config.functionPermissionLevel,
    'op-permission-level': config.opPermissionLevel
  }).map(([key, value]) => [key, escapePropertyValue(value, { preserveNewlineEscape: key === 'motd' })]));
  let lines = [];
  try {
    const stat = await fs.stat(paths.serverProperties);
    if (!stat.isFile() || stat.size > MAX_PROPERTIES_BYTES) throw new Error('server.properties is too large.');
    lines = (await fs.readFile(paths.serverProperties, 'utf8')).split(/\r?\n/);
  } catch {}
  const seen = new Set();
  lines = lines.map((line) => {
    const match = line.match(/^\s*([^#!=\s]+)\s*=/);
    if (!match || !managed.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${managed.get(match[1])}`;
  });
  for (const [key, value] of managed) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  while (lines.length && !lines.at(-1)) lines.pop();
  const temporary = `${paths.serverProperties}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${lines.join('\n')}\n`);
  await fs.rename(temporary, paths.serverProperties).catch(async () => {
    await fs.copyFile(temporary, paths.serverProperties);
    await fs.rm(temporary, { force: true });
  });
}

function getSeamlessRestartConfig(config) {
  return normalizeSeamlessRestartConfig(config?.seamlessRestart, {
    localOnly: config?.localOnly === true,
    publicPort: config?.port,
    publicHost: String(config?.bindIp || '').trim() || (config?.localOnly ? LOCAL_ONLY_BIND_IP : '0.0.0.0'),
    reservedPorts: [config?.voiceUdpPort]
  });
}

function seamlessRestartArtifactMetadata(paths) {
  return {
    velocity: {
      filePath: paths.seamlessRestartVelocityJar,
      sha256: SEAMLESS_RESTART_PINNED_ARTIFACTS.velocity.sha256
    },
    nanoLimbo: {
      filePath: paths.seamlessRestartLimboJar,
      sha256: SEAMLESS_RESTART_PINNED_ARTIFACTS.nanoLimbo.sha256
    },
    fabricProxyLite: {
      filePath: paths.seamlessRestartFabricProxyJar,
      sha256: SEAMLESS_RESTART_PINNED_ARTIFACTS.fabricProxyLite.sha256
    }
  };
}

function seamlessRestartSetupFileMap(paths) {
  return new Map([
    ['velocity/velocity.toml', paths.seamlessRestartVelocityConfig],
    ['velocity/forwarding.secret', paths.seamlessRestartVelocitySecret],
    ['limbo/settings.yml', paths.seamlessRestartLimboConfig],
    ['limbo/forwarding.secret', paths.seamlessRestartLimboSecret],
    ['backend/config/FabricProxy-Lite.toml', paths.seamlessRestartFabricProxyConfig],
    ['velocity/plugins/clickinterval-restart-proxy/config.properties', paths.seamlessRestartCoordinatorConfig],
    ['THIRD-PARTY-NOTICES.txt', paths.seamlessRestartNotices]
  ]);
}

async function copyFileAtomically(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.copy-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  try {
    await fs.copyFile(source, temporary);
    await replaceFileAtomically(temporary, destination, false);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readSmallTextFile(file, maximumBytes = 1024 * 1024) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > maximumBytes) throw new Error(`${path.basename(file)} is not a valid managed text file.`);
  return fs.readFile(file, 'utf8');
}

async function hashMatches(file, expectedHash) {
  try {
    return String(await calculateFileHash(file, 'sha256')).toLowerCase() === String(expectedHash || '').toLowerCase();
  } catch {
    return false;
  }
}

async function ensurePinnedSeamlessRestartArtifact(key, destination) {
  const artifact = SEAMLESS_RESTART_PINNED_ARTIFACTS[key];
  if (!artifact) throw new Error(`Unknown seamless-restart artifact: ${key}`);
  try {
    const stat = await fs.stat(destination);
    if (stat.isFile() && stat.size === artifact.size && await hashMatches(destination, artifact.sha256)) {
      return { path: destination, size: stat.size, reused: true };
    }
  } catch {}
  const allowedHosts = key === 'velocity'
    ? ['fill-data.papermc.io']
    : key === 'nanoLimbo'
      ? ['github.com', 'githubusercontent.com']
      : ['cdn.modrinth.com'];
  appendServerLog(`[Seamless Restart] Downloading verified ${artifact.name} ${artifact.version}...\n`);
  return download(artifact.url, destination, {
    allowedHosts,
    expectedHashes: { sha256: artifact.sha256 },
    expectedSize: artifact.size,
    maxBytes: MAX_SEAMLESS_RESTART_ARTIFACT_BYTES,
    requireJar: true,
    timeoutMs: 30_000
  });
}

function parseFabricProxyLiteSecret(text) {
  return parseFabricProxyLiteConfig(text).secret;
}

async function inspectFabricProxyLiteConfigSemantics(paths, expectedSecret = '') {
  try {
    const text = await readSmallTextFile(paths.seamlessRestartFabricProxyConfig, 64 * 1024);
    const parsed = parseFabricProxyLiteConfig(text);
    const ready = isFabricProxyLiteConfigSemanticallyValid(text, expectedSecret);
    return { ready, parsed };
  } catch {
    return { ready: false, parsed: null };
  }
}

function seamlessRestartSourceSettings(config) {
  return {
    motd: String(config?.motd || '').replaceAll('\\n', ' ') || 'Click Interval Server',
    maxPlayers: Number(config?.maxPlayers) || DEFAULT_CONFIG.maxPlayers
  };
}

async function inspectSeamlessRestartManagedFiles(paths, metadata) {
  const mapped = seamlessRestartSetupFileMap(paths);
  const entries = Array.isArray(metadata?.files) ? metadata.files : [];
  const results = [];
  for (const entry of entries) {
    const destination = mapped.get(String(entry?.path || '').replaceAll('\\', '/'));
    if (!destination || !/^[a-f0-9]{64}$/i.test(String(entry?.sha256 || ''))) continue;
    const mutableBackendConfig = destination === paths.seamlessRestartFabricProxyConfig;
    results.push({
      path: destination,
      // FabricProxy-Lite rewrites its TOML formatting after reading it. Its
      // security-sensitive values are checked semantically below.
      ready: mutableBackendConfig
        ? await isRegularFile(destination)
        : await hashMatches(destination, entry.sha256),
      sensitive: entry.sensitive === true,
      mutable: mutableBackendConfig
    });
  }
  const requiredDestinations = [...mapped.values()];
  const allRepresented = requiredDestinations.every(destination => results.some(result => result.path === destination));
  return {
    ready: allRepresented && results.length === requiredDestinations.length && results.every(result => result.ready),
    files: results
  };
}

async function getSeamlessRestartInspection(config, paths, platform = null, java = null, options = {}) {
  const seamless = getSeamlessRestartConfig(config);
  const metadata = options.metadataOverride || await readJson(paths.seamlessRestartMetadata, {});
  const artifactReport = await verifySeamlessRestartArtifacts(seamlessRestartArtifactMetadata(paths));
  const managedFiles = await inspectSeamlessRestartManagedFiles(paths, metadata);
  const coordinatorHash = await calculateFileHash(paths.seamlessRestartCoordinatorJar, 'sha256').catch(() => '');
  const bundledCoordinatorHash = await calculateFileHash(SEAMLESS_RESTART_COORDINATOR_SOURCE, 'sha256').catch(() => '');
  const expectedCoordinatorConfig = renderSeamlessRestartCoordinatorConfig(
    'The server is updating. You will reconnect automatically.'
  );
  const expectedCoordinatorConfigHash = crypto.createHash('sha256').update(expectedCoordinatorConfig, 'utf8').digest('hex');
  const coordinatorConfigReady = await hashMatches(
    paths.seamlessRestartCoordinatorConfig,
    expectedCoordinatorConfigHash
  );
  const coordinatorReady = Boolean(
    coordinatorHash &&
    bundledCoordinatorHash &&
    coordinatorHash.toLowerCase() === bundledCoordinatorHash.toLowerCase() &&
    coordinatorHash.toLowerCase() === String(metadata?.bundledCoordinator?.sha256 || '').toLowerCase()
  );
  let velocitySecret = '';
  let backendSecret = '';
  try { velocitySecret = (await readSmallTextFile(paths.seamlessRestartVelocitySecret, 16 * 1024)).trim(); } catch {}
  try {
    backendSecret = parseFabricProxyLiteSecret(
      await readSmallTextFile(paths.seamlessRestartFabricProxyConfig, 64 * 1024)
    );
  } catch {}
  const fabricProxyLiteConfig = await inspectFabricProxyLiteConfigSemantics(paths, velocitySecret);
  const holding = await inspectHoldingLobby({
    seamlessRoot: paths.seamlessRestartRoot, expectedPort: seamless.limboPort, expectedHost: seamless.limboHost,
    mainVoicePort: config.voiceUdpPort, forwardingSecret: velocitySecret
  });
  const metadataReady = metadata?.schemaVersion === 1 &&
    metadata?.feature === 'seamless-restart' &&
    metadata?.commitMarker === 'complete' &&
    metadata?.state === 'installed' &&
    metadata?.minecraftVersion === SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION &&
    metadata?.profileId === path.basename(paths.root);
  const topologyReady = metadata?.topology?.public?.host === seamless.proxyHost &&
    Number(metadata?.topology?.public?.port) === seamless.proxyPort &&
    metadata?.topology?.backend?.host === seamless.backendHost &&
    Number(metadata?.topology?.backend?.port) === seamless.backendPort &&
    metadata?.topology?.limbo?.host === seamless.limboHost &&
    Number(metadata?.topology?.limbo?.port) === seamless.limboPort;
  const sourceSettingsReady = JSON.stringify(metadata?.sourceSettings || null) ===
    JSON.stringify(seamlessRestartSourceSettings(config));
  const configReady = metadataReady && topologyReady && managedFiles.ready &&
    coordinatorReady && coordinatorConfigReady && fabricProxyLiteConfig.ready && holding.ready;
  // MOTD and the advertised player count are presentation settings, not
  // provisioning. Changing them must not revoke an installed restart stack.
  const velocityRunning = Boolean(seamlessVelocityProcess && !hasChildExited(seamlessVelocityProcess));
  const limboRunning = await isVerifiedHoldingLobbyProcess(seamlessLimboProcess, holding, paths);
  const backendReady = isServerRuntimeReady();
  let status = evaluateSeamlessRestartPreflight(seamless, {
    localOnly: config.localOnly === true,
    publicPort: config.port,
    publicHost: seamless.proxyHost,
    serverType: platform?.type || config.serverType,
    minecraftVersion: platform?.minecraftVersion || config.serverVersion,
    javaAvailable: java?.available !== false,
    javaMajor: java?.major,
    artifactReport,
    components: {
      velocity: { configured: configReady, running: velocityRunning },
      nanoLimbo: { configured: configReady, ready: limboRunning },
      fabricProxyLite: { configured: configReady, loaded: backendReady && seamlessFabricProxyLiteLoaded },
      backend: { configured: configReady, ready: backendReady }
    },
    sharedSecret: { velocity: velocitySecret, fabricProxyLite: backendSecret },
    bindings: {
      proxy: { host: seamless.proxyHost, port: seamless.proxyPort },
      backend: { host: seamless.backendHost, port: seamless.backendPort },
      limbo: { host: seamless.limboHost, port: seamless.limboPort }
    }
  }, { supportedFabricVersions: [SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION] });
  if (holding.enabled && !holding.ready) {
    status = Object.freeze({ ...status, reasons: Object.freeze([
      { code: 'HOLDING_LOBBY_UNVERIFIED', message: holding.error,
        component: 'holdingLobby', phase: 'setup' }, ...status.reasons
    ]) });
  }
  return {
    config: seamless,
    status,
    metadata,
    artifactReport,
    managedFiles,
    coordinatorReady,
    coordinatorConfigReady,
    fabricProxyLiteConfigReady: fabricProxyLiteConfig.ready,
    holding,
    sourceSettingsReady,
    topologyReady,
    runtime: {
      velocityRunning,
      limboRunning,
      backendReady,
      profileId: seamlessRuntimeProfileId,
      maintenanceArmed: seamlessMaintenanceArmed
    }
  };
}

function assertOriginalSeamlessRestartBackendFileProvenance(original) {
  if (!original || typeof original !== 'object' || Array.isArray(original) ||
      typeof original.jarExisted !== 'boolean' || typeof original.configExisted !== 'boolean') {
    throw new Error('The original FabricProxy-Lite file provenance is missing or malformed. No backend file was changed.');
  }
  const validHash = value => /^[a-f0-9]{64}$/iu.test(String(value || ''));
  if (original.jarExisted ? !validHash(original.jarBackupSha256) : original.jarBackupSha256 !== '') {
    throw new Error('The original FabricProxy-Lite JAR provenance is invalid. No backend file was changed.');
  }
  if (original.configExisted ? !validHash(original.configBackupSha256) : original.configBackupSha256 !== '') {
    throw new Error('The original FabricProxy-Lite config provenance is invalid. No backend file was changed.');
  }
  return original;
}

function isInstalledSeamlessRestartMetadata(metadata, profileId) {
  return Boolean(
    metadata && !Array.isArray(metadata) &&
    metadata.schemaVersion === 1 &&
    metadata.feature === 'seamless-restart' &&
    metadata.state === 'installed' &&
    metadata.commitMarker === 'complete' &&
    metadata.profileId === profileId
  );
}

async function assertOriginalSeamlessRestartBackups(paths, original) {
  assertOriginalSeamlessRestartBackendFileProvenance(original);
  if (original.jarExisted && (!await isRegularFile(paths.seamlessRestartFabricProxyBackupJar) ||
      !await hashMatches(paths.seamlessRestartFabricProxyBackupJar, original.jarBackupSha256))) {
    throw new Error('The recorded original FabricProxy-Lite backup is missing or failed its integrity check; no backend file was changed.');
  }
  if (original.configExisted && (!await isRegularFile(paths.seamlessRestartFabricProxyBackupConfig) ||
      !await hashMatches(paths.seamlessRestartFabricProxyBackupConfig, original.configBackupSha256))) {
    throw new Error('The recorded original FabricProxy-Lite config backup is missing or failed its integrity check; no backend file was changed.');
  }
  return original;
}

async function backupOriginalSeamlessRestartBackendFiles(paths, previousMetadata = {}, options = {}) {
  const previous = previousMetadata?.originalBackendFiles;
  if (options.reuseExisting === true) {
    return assertOriginalSeamlessRestartBackups(paths, previous);
  }
  await fs.mkdir(paths.seamlessRestartRollback, { recursive: true });
  const jarExisted = await isRegularFile(paths.seamlessRestartFabricProxyJar);
  const configExisted = await isRegularFile(paths.seamlessRestartFabricProxyConfig);
  if (jarExisted) await copyFileAtomically(paths.seamlessRestartFabricProxyJar, paths.seamlessRestartFabricProxyBackupJar);
  else await fs.rm(paths.seamlessRestartFabricProxyBackupJar, { force: true });
  if (configExisted) await copyFileAtomically(paths.seamlessRestartFabricProxyConfig, paths.seamlessRestartFabricProxyBackupConfig);
  else await fs.rm(paths.seamlessRestartFabricProxyBackupConfig, { force: true });
  return {
    jarExisted,
    configExisted,
    jarBackupSha256: jarExisted
      ? await calculateFileHash(paths.seamlessRestartFabricProxyBackupJar, 'sha256')
      : '',
    configBackupSha256: configExisted
      ? await calculateFileHash(paths.seamlessRestartFabricProxyBackupConfig, 'sha256')
      : ''
  };
}

async function restoreOriginalSeamlessRestartBackendFiles(paths, original) {
  await assertOriginalSeamlessRestartBackups(paths, original);
  if (original.jarExisted) {
    await copyFileAtomically(paths.seamlessRestartFabricProxyBackupJar, paths.seamlessRestartFabricProxyJar);
  } else {
    await fs.rm(paths.seamlessRestartFabricProxyJar, { force: true });
  }
  if (original.configExisted) {
    await copyFileAtomically(paths.seamlessRestartFabricProxyBackupConfig, paths.seamlessRestartFabricProxyConfig);
  } else {
    await fs.rm(paths.seamlessRestartFabricProxyConfig, { force: true });
  }
}

async function assertNoConflictingFabricProxyLiteMods(paths) {
  const index = await getModDescriptorIndex(paths);
  if (index.partial) {
    throw new Error(index.warning || 'The mods folder could not be checked safely for duplicate FabricProxy-Lite installations.');
  }
  const managedName = path.basename(paths.seamlessRestartFabricProxyJar).toLowerCase();
  const conflicts = index.files.filter(file =>
    String(file?.descriptor?.fabricModId || '').toLowerCase() === 'fabricproxy-lite' &&
    String(file?.name || '').toLowerCase() !== managedName
  );
  if (conflicts.length) {
    throw new Error(
      `Remove the extra FabricProxy-Lite mod${conflicts.length === 1 ? '' : 's'} before setup: ` +
      conflicts.map(file => file.name).join(', ') +
      '. Click Interval will not install a second JAR with the same Fabric mod ID.'
    );
  }
}

async function recoverInterruptedSeamlessRestartTransaction(paths, config, profileId) {
  const metadata = await readJson(paths.seamlessRestartMetadata, {});
  const installedWithoutEnablement = metadata?.state === 'installed' &&
    metadata?.feature === 'seamless-restart' &&
    getSeamlessRestartConfig(config).enabled !== true;
  if (installedWithoutEnablement) {
    if (!isInstalledSeamlessRestartMetadata(metadata, profileId)) {
      throw new Error('Saved seamless-restart provenance is incomplete. It was retained; no backend file was changed.');
    }
    const candidate = normalizeServerConfig({
      ...config, seamlessRestart: { ...getSeamlessRestartConfig(config), enabled: true }
    });
    const [platform, java] = await Promise.all([getServerPlatformStatus(candidate, paths), resolveJava(candidate)]);
    const inspection = await getSeamlessRestartInspection(candidate, paths, platform, java);
    if (!inspection.status.setupReady || !inspection.artifactReport.ready) {
      throw new Error('Saved seamless-restart setup needs attention before Minecraft can start. It was retained; run /silent-restart status for details.');
    }
    const restoredConfig = await writeConfig(candidate, paths, { allowSeamlessRestartMutation: true });
    appendServerLog('[Seamless Restart] Restored enablement from the verified saved setup. Only an explicit delete removes setup.\n');
    return { config: restoredConfig, recovered: true, metadata };
  }
  const interrupted = ['preparing', 'disabling'].includes(metadata?.state);
  if (!interrupted) return { config, recovered: false, metadata };
  if (metadata?.feature !== 'seamless-restart' || metadata?.profileId !== profileId ||
      !metadata?.originalBackendFiles) {
    throw new Error('An interrupted seamless-restart transaction has incomplete recovery metadata. The server was not started.');
  }
  await restoreOriginalSeamlessRestartBackendFiles(paths, metadata.originalBackendFiles);
  const disabledConfig = await writeConfig({
    ...config,
    seamlessRestart: { ...getSeamlessRestartConfig(config), enabled: false }
  }, paths, { allowSeamlessRestartMutation: true });
  const recoveredMetadata = {
    ...metadata,
    state: 'disabled',
    commitMarker: 'complete',
    recoveredAt: new Date().toISOString()
  };
  await writeJsonAtomically(paths.seamlessRestartMetadata, recoveredMetadata);
  appendServerLog('[Seamless Restart] Recovered an interrupted setup/disable transaction and restored the original backend files.\n');
  return { config: disabledConfig, recovered: true, metadata: recoveredMetadata };
}

function renderSeamlessRestartCoordinatorConfig(message) {
  const cleanMessage = normalizeSeamlessRestartMessage(message || 'The server is updating. You will reconnect automatically.');
  return [
    '# Generated by Click Interval.',
    'main-server=main',
    'maintenance-server=maintenance',
    `default-message=${cleanMessage.replace(/[=\\]/gu, character => `\\${character}`)}`,
    'drain-timeout-seconds=15',
    'restore-timeout-seconds=30',
    ''
  ].join('\n');
}

async function assertSeamlessRestartMutationStillSafe(profileId) {
  if (serverProcess || pendingServerStart || serverStopPromise || serverState !== 'stopped') {
    throw new Error('Seamless restart files can only change while Minecraft is fully stopped. The running server was not touched.');
  }
  if (seamlessVelocityProcess || seamlessLimboProcess) {
    throw new Error('Stop the seamless-restart sidecars before changing their setup.');
  }
  const active = await getActiveProfile();
  if (!active?.id || active.id !== profileId) {
    throw new Error('The active server changed while seamless-restart setup was running. No backend file was changed.');
  }
}

async function getSeamlessRestartSetupForwardingSecret(paths, config, seamless) {
  let forwardingSecret = '';
  try { forwardingSecret = (await readSmallTextFile(paths.seamlessRestartVelocitySecret, 16 * 1024)).trim(); } catch {}
  const inspectionOptions = {
    seamlessRoot: paths.seamlessRestartRoot,
    expectedPort: seamless.limboPort,
    expectedHost: seamless.limboHost,
    mainVoicePort: config.voiceUdpPort
  };
  let holding = await inspectHoldingLobby({ ...inspectionOptions, forwardingSecret });
  if (!holding.enabled) return forwardingSecret;
  if (holding.ready) return forwardingSecret;

  // An earlier setup may have rotated only the proxy/backend credential before
  // rolling back. The protected lobby is independently verified and survives
  // that rollback; reuse its credential instead of rewriting the lobby/world.
  let holdingSecret = '';
  try {
    holdingSecret = parseFabricProxyLiteSecret(await readSmallTextFile(path.join(
      paths.seamlessRestartRoot, 'holding-fabric', 'config', 'FabricProxy-Lite.toml'
    ), 64 * 1024));
  } catch {}
  holding = await inspectHoldingLobby({ ...inspectionOptions, forwardingSecret: holdingSecret });
  if (!holding.ready || !holdingSecret) {
    throw new Error(holding.error || 'The saved holding lobby could not be verified. No restart setup file was changed.');
  }
  return holdingSecret;
}

async function setupSeamlessRestart() {
  if (seamlessSetupPromise) return seamlessSetupPromise;
  let operation;
  operation = serverToolMutationCoordinator.run('seamless-restart:setup', async () => {
    const profile = await getActiveProfile();
    if (!profile) throw new Error('Create or select a server first.');
    const paths = getPathsForProfile(profile);
    let config = await readConfig(paths);
    const savedMetadata = await readJson(paths.seamlessRestartMetadata, {});
    if (isInstalledSeamlessRestartMetadata(savedMetadata, profile.id)) {
      const candidate = normalizeServerConfig({
        ...config, seamlessRestart: { ...getSeamlessRestartConfig(config), enabled: true }
      });
      const [platform, java] = await Promise.all([getServerPlatformStatus(candidate, paths), resolveJava(candidate)]);
      const inspection = await getSeamlessRestartInspection(candidate, paths, platform, java);
      if (!inspection.status.setupReady || !inspection.artifactReport.ready) {
        throw new Error('Your saved seamless-restart setup was retained, but did not pass verification. Run /silent-restart status for details. To replace it, stop Minecraft and explicitly delete the old setup first.');
      }
      if (!getSeamlessRestartConfig(config).enabled) {
        await assertSeamlessRestartMutationStillSafe(profile.id);
        config = await writeConfig(candidate, paths, { allowSeamlessRestartMutation: true });
      }
      appendServerLog('[Seamless Restart] Existing setup is verified and retained. Setup persists across restarts until explicitly deleted.\n');
      return { enabled: true, unchanged: true, config: candidate.seamlessRestart, status: inspection.status };
    }
    if (serverProcess || pendingServerStart || serverStopPromise || serverState !== 'stopped') {
      throw new Error('Seamless restart setup can only run while Minecraft is fully stopped. The running server was not touched.');
    }
    if (seamlessVelocityProcess || seamlessLimboProcess) {
      throw new Error('Stop the seamless-restart sidecars before changing their setup.');
    }
    ({ config } = await recoverInterruptedSeamlessRestartTransaction(paths, config, profile.id));
    const metadataAtStart = await readJson(paths.seamlessRestartMetadata, {});
    if (getSeamlessRestartConfig(config).enabled &&
        !isInstalledSeamlessRestartMetadata(metadataAtStart, profile.id)) {
      throw new Error('Seamless restart is enabled but its installed provenance is missing or incomplete. Setup stopped without replacing backend files.');
    }
    const platform = await getServerPlatformStatus(config, paths);
    const java = await resolveJava(config);
    if (normalizeServerType(platform?.type || config.serverType) !== 'fabric' ||
        String(platform?.minecraftVersion || config.serverVersion) !== SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION) {
      throw new Error(`Seamless restart currently requires Fabric ${SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION}.`);
    }
    if (!java.available || Number(java.major) < MIN_JAVA_MAJOR) {
      throw new Error(`Java ${MIN_JAVA_MAJOR}+ is required for the seamless-restart proxy stack.`);
    }
    if (!config.onlineMode) {
      throw new Error('Enable Online mode before seamless-restart setup so Velocity can authenticate players securely.');
    }
    const rconPort = await readConfiguredRconPort(paths, config);
    const seamless = normalizeSeamlessRestartConfig({ ...config.seamlessRestart, enabled: true }, {
      localOnly: config.localOnly === true,
      publicPort: config.port,
      publicHost: String(config.bindIp || '').trim() || (config.localOnly ? LOCAL_ONLY_BIND_IP : '0.0.0.0'),
      reservedPorts: [config.voiceUdpPort, rconPort]
    });
    if (rconPort && rconPort === seamless.proxyPort) {
      throw new Error(`RCON port ${rconPort} cannot also be the public Minecraft proxy port. Change the RCON port or disable RCON before setup.`);
    }
    const forwardingSecret = await getSeamlessRestartSetupForwardingSecret(paths, config, seamless);
    await Promise.all([
      assertTcpEndpointAvailable(seamless.proxyHost, seamless.proxyPort, 'Public proxy port'),
      assertTcpEndpointAvailable(seamless.backendHost, seamless.backendPort, 'Backend port'),
      assertTcpEndpointAvailable(seamless.limboHost, seamless.limboPort, 'Maintenance port')
    ]);
    if (!await isRegularFile(SEAMLESS_RESTART_COORDINATOR_SOURCE)) {
      throw new Error('The bundled seamless-restart coordinator is missing from this Click Interval update.');
    }

    appendServerLog('[Seamless Restart] Preparing the verified proxy and maintenance stack. Minecraft remains stopped.\n');
    await Promise.all([
      ensurePinnedSeamlessRestartArtifact('velocity', paths.seamlessRestartVelocityJar),
      ensurePinnedSeamlessRestartArtifact('nanoLimbo', paths.seamlessRestartLimboJar)
    ]);
    const fabricCache = path.join(paths.seamlessRestartRoot, 'downloads', SEAMLESS_RESTART_PINNED_ARTIFACTS.fabricProxyLite.fileName);
    await ensurePinnedSeamlessRestartArtifact('fabricProxyLite', fabricCache);

    await assertSeamlessRestartMutationStillSafe(profile.id);
    const previousMetadata = await readJson(paths.seamlessRestartMetadata, {});
    if (getSeamlessRestartConfig(config).enabled &&
        !isInstalledSeamlessRestartMetadata(previousMetadata, profile.id)) {
      throw new Error('Seamless-restart provenance changed during setup. No backend file was replaced.');
    }
    await assertNoConflictingFabricProxyLiteMods(paths);
    const reuseOriginalBackups = isInstalledSeamlessRestartMetadata(previousMetadata, profile.id);
    const originalBackendFiles = await backupOriginalSeamlessRestartBackendFiles(
      paths,
      previousMetadata,
      { reuseExisting: reuseOriginalBackups }
    );
    const setup = createSeamlessRestartSetup({
      forwardingSecret,
      minecraftVersion: SEAMLESS_RESTART_SUPPORTED_MINECRAFT_VERSION,
      publicHost: seamless.proxyHost,
      publicPort: seamless.proxyPort,
      backendHost: seamless.backendHost,
      backendPort: seamless.backendPort,
      limboHost: seamless.limboHost,
      limboPort: seamless.limboPort,
      maxPlayers: config.maxPlayers,
      motd: String(config.motd || '').replaceAll('\\n', ' ') || 'Click Interval Server',
      restartMessage: '<yellow>The server is updating. You will reconnect automatically.',
      disconnectMessage: 'Connect through the Click Interval server address.',
      paths: { manifest: 'metadata.json' }
    });
    const fileMap = seamlessRestartSetupFileMap(paths);
    const coordinatorConfigContent = renderSeamlessRestartCoordinatorConfig(
      'The server is updating. You will reconnect automatically.'
    );
    const transactionMetadata = {
      ...setup.manifest,
      state: 'preparing',
      commitMarker: 'transaction',
      transactionStartedAt: new Date().toISOString(),
      profileId: profile.id,
      sourceSettings: seamlessRestartSourceSettings(config),
      originalBackendFiles
    };
    await writeJsonAtomically(paths.seamlessRestartMetadata, transactionMetadata);
    try {
      for (const file of setup.files) {
        if (file.commitFile) continue;
        const destination = fileMap.get(file.relativePath);
        if (!destination) throw new Error(`Setup produced an unexpected file path: ${file.relativePath}`);
        await writeTextAtomically(destination, file.content);
      }
      await copyFileAtomically(fabricCache, paths.seamlessRestartFabricProxyJar);
      await copyFileAtomically(SEAMLESS_RESTART_COORDINATOR_SOURCE, paths.seamlessRestartCoordinatorJar);
      await writeTextAtomically(
        paths.seamlessRestartCoordinatorConfig,
        coordinatorConfigContent
      );
      const bundledCoordinator = {
        file: path.basename(paths.seamlessRestartCoordinatorJar),
        sha256: await calculateFileHash(paths.seamlessRestartCoordinatorJar, 'sha256'),
        size: (await fs.stat(paths.seamlessRestartCoordinatorJar)).size
      };
      const metadata = {
        ...setup.manifest,
        files: [
          ...setup.manifest.files,
          {
            path: 'velocity/plugins/clickinterval-restart-proxy/config.properties',
            sha256: crypto.createHash('sha256').update(coordinatorConfigContent, 'utf8').digest('hex'),
            size: Buffer.byteLength(coordinatorConfigContent, 'utf8'),
            sensitive: false
          }
        ],
        state: 'installed',
        commitMarker: 'complete',
        installedAt: new Date().toISOString(),
        profileId: profile.id,
        sourceSettings: seamlessRestartSourceSettings(config),
        bundledCoordinator,
        originalBackendFiles
      };
      const candidate = normalizeServerConfig({ ...config, seamlessRestart: seamless });
      const inspection = await getSeamlessRestartInspection(candidate, paths, platform, java, {
        metadataOverride: metadata
      });
      if (!inspection.status.setupReady || !inspection.artifactReport.ready) {
        const reason = inspection.status.reasons.find(item => !['FEATURE_DISABLED', 'VELOCITY_NOT_RUNNING', 'NANO_LIMBO_NOT_READY', 'FABRIC_PROXY_LITE_NOT_LOADED', 'BACKEND_NOT_READY'].includes(item.code));
        throw new Error(reason?.message || 'Seamless-restart setup did not pass its integrity preflight.');
      }
      config = await writeConfig(candidate, paths, { allowSeamlessRestartMutation: true });
      await assertSeamlessRestartMutationStillSafe(profile.id);
      // Publish installed provenance last. A crash before this atomic commit
      // leaves the durable preparing journal, so startup restores originals.
      await writeJsonAtomically(paths.seamlessRestartMetadata, metadata);
      appendServerLog('[Seamless Restart] Setup verified. Future /silent-restart commands can keep players connected.\n');
      invalidateStatusCache();
      return { enabled: true, config: config.seamlessRestart, status: inspection.status };
    } catch (error) {
      const rollbackErrors = [];
      await restoreOriginalSeamlessRestartBackendFiles(paths, originalBackendFiles).catch(restoreError => {
        rollbackErrors.push(restoreError);
      });
      await writeConfig(
        { ...config, seamlessRestart: { ...seamless, enabled: false } },
        paths,
        { allowSeamlessRestartMutation: true }
      ).catch(configError => {
        rollbackErrors.push(configError);
      });
      if (!rollbackErrors.length) {
        await writeJsonAtomically(paths.seamlessRestartMetadata, {
          ...transactionMetadata,
          state: 'disabled',
          commitMarker: 'complete',
          rollbackAt: new Date().toISOString(),
          rollbackReason: String(error?.message || error).slice(0, 512)
        }).catch(metadataError => {
          rollbackErrors.push(metadataError);
        });
      }
      if (rollbackErrors.length) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `${error.message || String(error)} Rollback was incomplete; startup will retry recovery before Minecraft can run.`
        );
      }
      throw error;
    }
  }).finally(() => {
    if (seamlessSetupPromise === operation) seamlessSetupPromise = null;
  });
  seamlessSetupPromise = operation;
  return operation;
}

async function disableSeamlessRestart() {
  return serverToolMutationCoordinator.run('seamless-restart:disable', async () => {
    if (serverProcess || pendingServerStart || serverStopPromise || serverState !== 'stopped') {
      throw new Error('Seamless restart can only be disabled while Minecraft is fully stopped.');
    }
    if (seamlessVelocityProcess || seamlessLimboProcess) throw new Error('Stop the restart sidecars before disabling seamless restart.');
    const profile = await getActiveProfile();
    if (!profile) throw new Error('Create or select a server first.');
    const paths = getPathsForProfile(profile);
    let config = await readConfig(paths);
    let metadata = await readJson(paths.seamlessRestartMetadata, {});
    // Explicit removal must not need a working Java runtime just to restore the
    // original files. Complete installed provenance can be removed directly.
    if (!isInstalledSeamlessRestartMetadata(metadata, profile.id)) {
      ({ config } = await recoverInterruptedSeamlessRestartTransaction(paths, config, profile.id));
      metadata = await readJson(paths.seamlessRestartMetadata, {});
    }
    const seamless = getSeamlessRestartConfig(config);
    if (!seamless.enabled && metadata?.feature === 'seamless-restart' &&
        metadata?.commitMarker === 'complete' && metadata?.state === 'disabled') {
      return { enabled: false, config: seamless, unchanged: true };
    }
    if (!isInstalledSeamlessRestartMetadata(metadata, profile.id)) {
      if (!seamless.enabled && metadata?.feature !== 'seamless-restart') {
        return { enabled: false, config: seamless, unchanged: true };
      }
      throw new Error('Complete same-profile seamless-restart provenance is required before backend files can be restored. No file was changed.');
    }
    await assertOriginalSeamlessRestartBackups(paths, metadata.originalBackendFiles);
    if (await isRegularFile(paths.seamlessRestartFabricProxyJar) &&
        !await hashMatches(paths.seamlessRestartFabricProxyJar, SEAMLESS_RESTART_PINNED_ARTIFACTS.fabricProxyLite.sha256)) {
      throw new Error('FabricProxy-Lite.jar was changed after setup. It was not removed; restore it manually or run setup again.');
    }
    let velocitySecret = '';
    try { velocitySecret = (await readSmallTextFile(paths.seamlessRestartVelocitySecret, 16 * 1024)).trim(); } catch {}
    const managedConfig = await inspectFabricProxyLiteConfigSemantics(paths, velocitySecret);
    if (!managedConfig.ready) {
      throw new Error('FabricProxy-Lite.toml no longer has the verified forwarding settings. It was not overwritten.');
    }
    await assertSeamlessRestartMutationStillSafe(profile.id);
    const disablingMetadata = {
      ...metadata,
      state: 'disabling',
      commitMarker: 'transaction',
      disablingAt: new Date().toISOString()
    };
    await writeJsonAtomically(paths.seamlessRestartMetadata, disablingMetadata);
    await restoreOriginalSeamlessRestartBackendFiles(paths, metadata.originalBackendFiles);
    const next = await writeConfig({
      ...config,
      seamlessRestart: { ...seamless, enabled: false }
    }, paths, { allowSeamlessRestartMutation: true });
    await writeJsonAtomically(paths.seamlessRestartMetadata, {
      ...disablingMetadata,
      state: 'disabled',
      commitMarker: 'complete',
      disabledAt: new Date().toISOString()
    });
    invalidateStatusCache();
    return { enabled: false, config: next.seamlessRestart };
  });
}

async function readWorldSavedVersion(worldPath) {
  try {
    const file = path.join(worldPath, 'level.dat');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_LEVEL_DAT_BYTES) return '';
    const raw = await fs.readFile(file);
    const inflated = zlib.gunzipSync(raw, { maxOutputLength: MAX_LEVEL_DAT_OUTPUT_BYTES });
    const text = inflated.toString('latin1').replace(/[^\x20-\x7e]+/g, ' ');
    const match = text.match(/\bName\s+([0-9][0-9A-Za-z._-]*)\s+LevelName\b/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function readBundledJarVersion(jarPath) {
  try {
    const raw = await readFileEdges(jarPath, 8 * 1024 * 1024, MAX_SERVER_JAR_BYTES);
    const text = raw.toString('latin1');
    const match = text.match(/META-INF\/versions\/([^/]+)\/server-\1\.jar/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function readJarManifestValue(buffer, key) {
  const text = buffer.toString('latin1');
  const manifestMatch = text.match(/META-INF\/MANIFEST\.MF([\s\S]*?)(?:PK\x03\x04|$)/);
  const manifestText = manifestMatch?.[1] || text;
  const match = manifestText.match(new RegExp(`(?:^|\\r?\\n)${key}:\\s*([^\\r\\n]+)`, 'i'));
  return match?.[1]?.trim() || '';
}

function compareVersionIds(a, b) {
  const parse = (value) => String(value || '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

async function readServerJarVersion(jarPath) {
  try {
    const raw = await readFileEdges(jarPath, 8 * 1024 * 1024, MAX_SERVER_JAR_BYTES);
    const text = raw.toString('latin1');
    const bundled = text.match(/META-INF\/versions\/([^/]+)\/server-\1\.jar/);
    if (bundled?.[1]) return bundled[1];
    return readJarManifestValue(raw, 'Implementation-Version') ||
      readJarManifestValue(raw, 'Specification-Version') ||
      path.basename(jarPath).match(/^server-([0-9][0-9A-Za-z._-]*)\.jar$/i)?.[1] ||
      '';
  } catch {
    return '';
  }
}

async function getLevelNameForVersion(paths, preferredName, version) {
  const base = slugifyProfileName(preferredName || `world-${version}`);
  const suffix = slugifyProfileName(version);
  let candidate = `${base}-${suffix}`;
  for (let index = 2; index < 100; index += 1) {
    const candidatePath = path.join(paths.root, candidate);
    const savedVersion = await readWorldSavedVersion(candidatePath);
    if (!savedVersion || savedVersion === version) return candidate;
    candidate = `${base}-${suffix}-${index}`;
  }
  return `${base}-${suffix}-${Date.now()}`;
}

async function alignJarToWorldVersion(config, paths, worldPath) {
  const worldVersion = await readWorldSavedVersion(worldPath);
  if (!worldVersion) return config;

  const configuredJar = path.resolve(String(config.jarPath || ''));
  const vanillaJar = path.resolve(paths.vanillaJar);
  const configuredJarVersion = await readServerJarVersion(configuredJar);
  if (configuredJarVersion && configuredJarVersion !== worldVersion) {
    if (compareVersionIds(configuredJarVersion, worldVersion) < 0) {
      const levelName = await getLevelNameForVersion(paths, config.levelName || 'world', configuredJarVersion);
      const nextConfig = {
        ...config,
        serverVersion: configuredJarVersion,
        jarPath: config.jarPath,
        levelName,
        seed: generateSeed()
      };
      await writeConfig(nextConfig);
      appendServerLog(
        `[Server Manager SRV-WORLD-023] Starting separate world for selected version\n` +
        `  Existing world version: ${worldVersion}\n` +
        `  Selected server version: ${configuredJarVersion}\n` +
        `  New world folder: ${levelName}\n` +
        `  Meaning: Server Manager will not downgrade the old world. It will start a separate world for the selected version instead.\n`
      );
      return nextConfig;
    }
    if (config.serverVersion === configuredJarVersion) return config;
    const nextConfig = { ...config, serverVersion: configuredJarVersion, jarPath: config.jarPath };
    await writeConfig(nextConfig);
    appendServerLog(
      `[Server Manager SRV-WORLD-021] Keeping selected server version\n` +
      `  World version: ${worldVersion}\n` +
      `  Selected server version: ${configuredJarVersion}\n` +
      `  Using jar: ${config.jarPath}\n` +
      `  Meaning: Server Manager will not force the server back to the old world version. Minecraft may upgrade the world if this version supports it.\n`
    );
    return nextConfig;
  }
  const configuredBundledVersion = await readBundledJarVersion(configuredJar);
  if (configuredBundledVersion === worldVersion) {
    if (config.serverVersion === worldVersion && configuredJar === path.resolve(config.jarPath)) return config;
    const nextConfig = { ...config, serverVersion: worldVersion, jarPath: config.jarPath };
    await writeConfig(nextConfig);
    return nextConfig;
  }

  const vanillaBundledVersion = await readBundledJarVersion(vanillaJar);
  if (vanillaBundledVersion === worldVersion) {
    if (configuredJar === vanillaJar && config.serverVersion === worldVersion) return config;
    const nextConfig = { ...config, serverVersion: worldVersion, jarPath: paths.vanillaJar };
    await writeConfig(nextConfig);
    appendServerLog(
      `[Server Manager SRV-WORLD-011] Matched server jar to active world\n` +
      `  World version: ${worldVersion}\n` +
      `  Previous server version: ${config.serverVersion || 'unknown'}\n` +
      `  Using jar: ${paths.vanillaJar}\n` +
      `  Meaning: Server Manager selected the runnable bundled jar for this world.\n`
    );
    return nextConfig;
  }

  const matchingJar = path.join(paths.root, 'versions', worldVersion, `server-${worldVersion}.jar`);

  try {
    await fs.access(matchingJar);
  } catch {
    const message = [
      `[Server Manager SRV-WORLD-012] World/server version mismatch`,
      `  World version: ${worldVersion}`,
      `  Configured server version: ${config.serverVersion || 'unknown'}`,
      `  Missing jar: ${matchingJar}`,
      `  Meaning: This world was saved by a different Minecraft server version.`,
      `  Next step: install/select Minecraft ${worldVersion}, then start again.`
    ].join('\n');
    appendServerLog(`${message}\n`);
    throw new Error(message);
  }

  if (configuredJar === path.resolve(matchingJar) && config.serverVersion === worldVersion) return config;

  const nextConfig = { ...config, serverVersion: worldVersion, jarPath: matchingJar };
  await writeConfig(nextConfig);
  appendServerLog(
    `[Server Manager SRV-WORLD-011] Matched server jar to active world\n` +
    `  World version: ${worldVersion}\n` +
    `  Previous server version: ${config.serverVersion || 'unknown'}\n` +
    `  Using jar: ${matchingJar}\n` +
    `  Meaning: Server Manager found the matching installed server jar for this world and selected it automatically.\n`
  );
  return nextConfig;
}

async function listJarPathsRecursive(dir) {
  const jars = [];
  const directories = [dir];
  let cursor = 0;
  let entriesVisited = 0;
  while (cursor < directories.length && cursor < 5000 && entriesVisited < 25_000) {
    const current = directories[cursor++];
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++entriesVisited > 25_000) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (directories.length < 5000) directories.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
        if (jars.length >= 20_000) break;
        jars.push(fullPath);
      }
    }
  }
  return jars.sort((a, b) => a.localeCompare(b));
}

async function buildServerJavaArgs(config, paths, safeMode = false) {
  const jarPath = String(config.jarPath || paths.vanillaJar);
  const relativeVersionJar = path.relative(path.join(paths.root, 'versions'), path.resolve(jarPath));
  const versionJarParts = relativeVersionJar.split(path.sep);
  const isExtractedServerJar = !relativeVersionJar.startsWith('..') &&
    !path.isAbsolute(relativeVersionJar) &&
    versionJarParts.length === 2 &&
    /^server-.+\.jar$/i.test(versionJarParts[1]);
  const requestedMemoryMb = Number(config.memoryMb) || DEFAULT_CONFIG.memoryMb;
  const totalMemoryMb = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMemoryMb = Math.floor(os.freemem() / 1024 / 1024);
  const effectiveMemoryMb = safeJavaMemoryMb(
    requestedMemoryMb,
    totalMemoryMb,
    freeMemoryMb
  );
  if (effectiveMemoryMb < 512) {
    serverEffectiveMemoryMb = null;
    throw new Error(
      `Minecraft was not started because Windows has only ${Math.max(0, freeMemoryMb)} MB of free memory. ` +
      'Close memory-heavy apps and try again; the server needs at least 512 MB plus memory reserved for Windows.'
    );
  }
  serverEffectiveMemoryMb = effectiveMemoryMb;
  if (effectiveMemoryMb < requestedMemoryMb) {
    appendServerLog(
      `[Server Manager] Memory safety limit: using ${effectiveMemoryMb} MB instead of ${requestedMemoryMb} MB so Windows keeps enough memory to stay responsive.\n`
    );
  }
  const memoryArgs = [
    `-Xmx${effectiveMemoryMb}M`,
    `-Xms${Math.min(effectiveMemoryMb, 1024)}M`,
    '--enable-native-access=ALL-UNNAMED',
    '--sun-misc-unsafe-memory-access=allow'
  ];
  const serverArgs = [
    ...(safeMode ? ['--safeMode'] : []),
    'nogui'
  ];
  if (!isExtractedServerJar) {
    return [
      ...memoryArgs,
      '-jar',
      jarPath,
      ...serverArgs
    ];
  }
  const libraryJars = await listJarPathsRecursive(path.join(paths.root, 'libraries'));
  const classPath = [jarPath, ...libraryJars].join(path.delimiter);
  return [
    ...memoryArgs,
    '-cp',
    classPath,
    'net.minecraft.server.Main',
    ...serverArgs
  ];
}

function isUsableWebContents(contents) {
  if (!contents || typeof contents.send !== 'function') return false;
  try {
    return typeof contents.isDestroyed !== 'function' || !contents.isDestroyed();
  } catch {
    return false;
  }
}

function rememberEmbeddedSubscriber(contents) {
  if (!isUsableWebContents(contents) || embeddedWebContentsSubscribers.has(contents)) return false;
  embeddedWebContentsSubscribers.add(contents);
  if (typeof contents.once === 'function') {
    contents.once('destroyed', () => embeddedWebContentsSubscribers.delete(contents));
  }
  return true;
}

function collectEventRecipients(includeAuxiliaryWindows = false) {
  const recipients = new Set();
  for (const contents of embeddedWebContentsSubscribers) {
    if (isUsableWebContents(contents)) recipients.add(contents);
    else embeddedWebContentsSubscribers.delete(contents);
  }
  if (includeAuxiliaryWindows) {
    for (const win of [consoleWindow, worldMapWindow]) {
      try {
        if (win && !win.isDestroyed() && isUsableWebContents(win.webContents)) recipients.add(win.webContents);
      } catch {}
    }
  }
  return recipients;
}

function sendEventToRecipients(channel, payload, includeAuxiliaryWindows = false) {
  for (const contents of collectEventRecipients(includeAuxiliaryWindows)) {
    try {
      contents.send(channel, payload);
    } catch {
      embeddedWebContentsSubscribers.delete(contents);
    }
  }
}

function emit(channel, payload) {
  sendEventToRecipients(channel, payload, false);
}

function emitAll(channel, payload) {
  sendEventToRecipients(channel, payload, true);
}

async function emitLivePlayers() {
  const rosterRevision = playerRosterRevision;
  const config = await readConfig().catch(() => DEFAULT_CONFIG);
  const sample = [...livePlayers.values()].slice(0, MAX_PLAYER_STATUS_SAMPLE);
  const enrichedSample = await enrichPlayerSamples(sample).catch(() => sample.map((name) => ({ name, uuid: '' })));
  if (rosterRevision !== playerRosterRevision) return false;
  emitAll('server:players', {
    online: livePlayers.size,
    max: Number(config.maxPlayers) || 0,
    sample: enrichedSample,
    live: true,
    revision: playerStateRevision,
    rosterRevision
  });
  if (livePlayers.size > 0) cancelEmptyServerAutoStop();
  else syncEmptyServerAutoStop('player list changed', config).catch(() => {});
  return true;
}

function advancePlayerStateRevision() {
  playerStateRevision = playerStateRevision >= Number.MAX_SAFE_INTEGER ? 1 : playerStateRevision + 1;
  invalidateStatusCache();
  return playerStateRevision;
}

function advancePlayerRosterRevision() {
  playerRosterRevision = playerRosterRevision >= Number.MAX_SAFE_INTEGER ? 1 : playerRosterRevision + 1;
  invalidateCachedWork('minecraft-ping:');
  return advancePlayerStateRevision();
}

function rememberLivePlayer(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) return false;
  const key = clean.toLowerCase();
  if (livePlayers.get(key) === clean) return false;
  livePlayers.set(key, clean);
  return true;
}

function normalizeLivePlayerNames(values) {
  const players = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const clean = String(value?.name || value || '').trim();
    if (/^[A-Za-z0-9_]{1,16}$/.test(clean)) players.set(clean.toLowerCase(), clean);
  }
  return players;
}

function replaceLivePlayers(values, options = {}) {
  const next = normalizeLivePlayerNames(values);
  const joined = [...next].filter(([key]) => !livePlayers.has(key)).map(([, name]) => name);
  const left = [...livePlayers].filter(([key]) => !next.has(key)).map(([, name]) => name);
  const renamed = [...next].some(([key, name]) => livePlayers.has(key) && livePlayers.get(key) !== name);
  const changed = Boolean(joined.length || left.length || renamed);
  if (options.authoritative) lastPlayerRosterAuthoritativeAt = Number(options.now) || Date.now();
  if (!changed) return { changed: false, joined, left, revision: playerStateRevision };
  livePlayers.clear();
  for (const [key, name] of next) livePlayers.set(key, name);
  const revision = advancePlayerRosterRevision();
  if (options.recordHistory) {
    for (const name of joined) queuePlayerHistoryEvent(name, 'joined');
    for (const name of left) queuePlayerHistoryEvent(name, 'left');
  }
  if (options.emit !== false) emitLivePlayers().catch(() => {});
  return { changed: true, joined, left, revision };
}

function requestPlayerRosterSync(force = false, now = Date.now()) {
  if (!isServerRuntimeReady()) return false;
  const requestedAt = Number(now) || Date.now();
  if (!force && requestedAt - lastPlayerRosterProbeAt < PLAYER_ROSTER_SYNC_INTERVAL_MS) return false;
  if (!sendServerCommand('list')) return false;
  lastPlayerRosterProbeAt = requestedAt;
  return true;
}

function getAssemblyBanCachePath(paths) {
  return path.resolve(paths.assemblyBans);
}

function replaceAssemblyBanCache(paths, rows) {
  assemblyBans.clear();
  for (const [key, value] of Object.entries(rows || {})) {
    if (value?.name) assemblyBans.set(key, value);
  }
  assemblyBansPath = getAssemblyBanCachePath(paths);
}

async function serverPathsAreActive(paths) {
  if (worldResetReadSnapshot?.root === path.resolve(paths.root)) return false;
  const profile = await getActiveProfile().catch(() => null);
  return Boolean(profile?.id) && getAssemblyBanCachePath(getPathsForProfile(profile)) === getAssemblyBanCachePath(paths);
}

async function assertServerPathsAreActive(paths, operation = 'player moderation') {
  if (!await serverPathsAreActive(paths)) {
    throw new Error(`The active server changed while ${operation} was being applied. The new server was not modified.`);
  }
}

async function readAssemblyBans(pathsOverride = null, isCurrent = null) {
  const paths = pathsOverride || await getPaths();
  const rows = await readJson(paths.assemblyBans, {});
  if (isCurrent ? !await isCurrent() : !await serverPathsAreActive(paths)) return false;
  replaceAssemblyBanCache(paths, rows);
  return true;
}

async function writeAssemblyBans(pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const targetCachePath = getAssemblyBanCachePath(paths);
  if (assemblyBansPath && assemblyBansPath !== targetCachePath) {
    throw new Error('Managed ban data changed server profiles before it could be saved.');
  }
  const snapshot = Object.fromEntries(assemblyBans);
  await serializeFileWrite(paths.assemblyBans, () => writeJsonAtomically(paths.assemblyBans, snapshot));
}

async function readPlayerHistoryForPaths(paths) {
  const rows = await readJson(paths.playerHistory, {});
  return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {};
}

async function readPlayerHistory() {
  return readPlayerHistoryForPaths(await getPaths());
}

async function writePlayerHistoryForPaths(paths, history) {
  await writeJsonAtomically(paths.playerHistory, history);
}

async function writePlayerHistory(history) {
  const paths = await getPaths();
  await serializeFileWrite(paths.playerHistory, () => writePlayerHistoryForPaths(paths, history));
}

function normalizePlayerHistoryLimit(value) {
  return clampInteger(value, 10, 1000, DEFAULT_CONFIG.playerHistoryLimit);
}

async function readPlayerHistoryLimitForPaths(paths) {
  const stored = await readJson(paths.config, {});
  return normalizePlayerHistoryLimit(stored.playerHistoryLimit);
}

function prunePlayerHistory(history, maximum = DEFAULT_CONFIG.playerHistoryLimit) {
  const limit = normalizePlayerHistoryLimit(maximum);
  const source = history && typeof history === 'object' && !Array.isArray(history) ? history : {};
  const eventRefs = [];
  for (const [key, entry] of Object.entries(source)) {
    const events = Array.isArray(entry?.events) ? entry.events : [];
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object' || !event.timestamp) return;
      eventRefs.push({ key, index, timestamp: String(event.timestamp) });
    });
  }
  eventRefs.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.index - a.index);
  const retained = new Set(eventRefs.slice(0, limit).map((entry) => `${entry.key}\0${entry.index}`));
  let changed = eventRefs.length > limit;
  const pruned = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (!Array.isArray(entry.events)) {
      pruned[key] = { ...entry };
      continue;
    }
    const events = entry.events.filter((event, index) => retained.has(`${key}\0${index}`));
    if (events.length !== entry.events.length) changed = true;
    pruned[key] = { ...entry, events };
  }
  return { history: pruned, changed, limit };
}

async function prunePlayerHistoryForPaths(paths, maximum) {
  return serializeFileWrite(paths.playerHistory, async () => {
    const history = await readPlayerHistoryForPaths(paths);
    const pruned = prunePlayerHistory(history, maximum);
    if (pruned.changed) await writePlayerHistoryForPaths(paths, pruned.history);
    return pruned.history;
  });
}

function appendPlayerHistoryEvent(events, event, maximum = DEFAULT_CONFIG.playerHistoryLimit) {
  const source = Array.isArray(events) ? events.filter((entry) => entry && typeof entry === 'object') : [];
  const normalized = {
    type: String(event?.type || 'seen').slice(0, 40),
    timestamp: new Date(event?.timestamp || Date.now()).toISOString(),
    ...(event?.reason ? { reason: String(event.reason).slice(0, 240) } : {}),
    ...(event?.expiresAt ? { expiresAt: String(event.expiresAt) } : {})
  };
  const latest = source.at(-1);
  if (latest?.type === normalized.type && latest?.timestamp === normalized.timestamp && latest?.reason === normalized.reason) {
    return source.slice(-normalizePlayerHistoryLimit(maximum));
  }
  return [...source, normalized].slice(-normalizePlayerHistoryLimit(maximum));
}

async function rememberPlayerHistory(name, eventType = 'seen', details = {}, pathsOverride = null) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) return;
  const key = clean.toLowerCase();
  const paths = pathsOverride || await getPaths();
  const identity = await resolvePlayerIdentity(paths, clean).catch(() => ({ name: clean, uuid: '' }));
  const historyLimit = await readPlayerHistoryLimitForPaths(paths);
  await serializeFileWrite(paths.playerHistory, async () => {
    const history = await readPlayerHistoryForPaths(paths);
    const now = new Date().toISOString();
    const existing = history[key] || {};
    history[key] = {
      ...existing,
      name: clean,
      uuid: normalizePlayerUuid(identity.uuid || existing.uuid),
      firstSeen: existing.firstSeen || now,
      lastSeen: now,
      lastActive: now,
      lastEvent: eventType,
      events: appendPlayerHistoryEvent(existing.events, { type: eventType, timestamp: now, ...details }, historyLimit)
    };
    await writePlayerHistoryForPaths(paths, prunePlayerHistory(history, historyLimit).history);
  });
  const activePaths = await getPaths();
  if (path.resolve(activePaths.root) !== path.resolve(paths.root)) return;
  advancePlayerStateRevision();
  const snapshot = await getPlayerHistory();
  emitAll('server:history', snapshot);
  emitAll('server:historyEvents', flattenPlayerHistoryEvents(snapshot));
}

function queuePlayerHistoryEvent(name, eventType = 'seen', details = {}) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) return;
  const activeProfile = profilesState?.profiles?.find((profile) => profile.id === profilesState.activeProfileId);
  const paths = activeProfile ? getPathsForProfile(activeProfile) : null;
  pendingPlayerHistoryEvents.push({
    name: clean,
    eventType: String(eventType || 'seen').slice(0, 40),
    details,
    timestamp: new Date().toISOString(),
    paths
  });
  if (pendingPlayerHistoryEvents.length > PLAYER_HISTORY_PENDING_MAX) {
    pendingPlayerHistoryEvents = pendingPlayerHistoryEvents.slice(0, PLAYER_HISTORY_PENDING_MAX);
  }
  if (pendingPlayerHistoryEvents.length >= PLAYER_HISTORY_BATCH_MAX) {
    flushPlayerHistoryEventQueue().catch(() => {});
  } else if (!playerHistoryEventTimer && !playerHistoryEventFlush) {
    playerHistoryEventTimer = setTimeout(() => flushPlayerHistoryEventQueue().catch(() => {}), PLAYER_HISTORY_BATCH_DELAY_MS);
    playerHistoryEventTimer.unref?.();
  }
}

function restoreFailedPlayerHistoryBatch(batch, pending) {
  const failed = Array.isArray(batch) ? batch : [];
  for (const event of failed) event.writeAttempts = Math.max(0, Number(event.writeAttempts) || 0) + 1;
  return [...failed, ...(Array.isArray(pending) ? pending : [])].slice(0, PLAYER_HISTORY_PENDING_MAX);
}

async function flushPlayerHistoryEventQueue(pathsOverride = null) {
  if (playerHistoryEventFlush) return playerHistoryEventFlush;
  clearTimeout(playerHistoryEventTimer);
  playerHistoryEventTimer = null;
  if (!pendingPlayerHistoryEvents.length) return [];
  const first = pendingPlayerHistoryEvents[0];
  const targetPaths = pathsOverride || first.paths || await getPaths();
  const targetRoot = path.resolve(targetPaths.root);
  const batch = [];
  const retained = [];
  for (const event of pendingPlayerHistoryEvents) {
    const eventRoot = event.paths ? path.resolve(event.paths.root) : targetRoot;
    if (eventRoot === targetRoot && batch.length < PLAYER_HISTORY_BATCH_MAX) batch.push(event);
    else retained.push(event);
  }
  pendingPlayerHistoryEvents = retained;
  let failed = false;
  playerHistoryEventFlush = (async () => {
    const historyLimit = await readPlayerHistoryLimitForPaths(targetPaths);
    const uniquePlayers = [...new Map(batch.map((event) => [event.name.toLowerCase(), event.name])).values()];
    const identityRows = await mapWithConcurrency(uniquePlayers, 4, async (player) =>
      resolvePlayerIdentity(targetPaths, player).catch(() => ({ name: player, uuid: '' }))
    );
    const identities = new Map(identityRows.map((identity) => [String(identity.name || '').toLowerCase(), identity]));
    await serializeFileWrite(targetPaths.playerHistory, async () => {
      const history = await readPlayerHistoryForPaths(targetPaths);
      for (const event of batch) {
        const key = event.name.toLowerCase();
        const identity = identities.get(key) || { name: event.name, uuid: '' };
        const existing = history[key] || {};
        history[key] = {
          ...existing,
          name: event.name,
          uuid: normalizePlayerUuid(identity.uuid || existing.uuid),
          firstSeen: existing.firstSeen || event.timestamp,
          lastSeen: event.timestamp,
          lastActive: event.timestamp,
          lastEvent: event.eventType,
          events: appendPlayerHistoryEvent(existing.events, {
            type: event.eventType,
            timestamp: event.timestamp,
            ...(event.details || {})
          }, historyLimit)
        };
      }
      await writePlayerHistoryForPaths(targetPaths, prunePlayerHistory(history, historyLimit).history);
    });
    const activePaths = await getPaths();
    if (path.resolve(activePaths.root) === targetRoot) {
      advancePlayerStateRevision();
      const snapshot = await getPlayerHistory();
      emitAll('server:history', snapshot);
      emitAll('server:historyEvents', flattenPlayerHistoryEvents(snapshot));
    }
    return batch;
  })().catch((error) => {
    failed = true;
    pendingPlayerHistoryEvents = restoreFailedPlayerHistoryBatch(batch, pendingPlayerHistoryEvents);
    appendServerLog(
      `[Server Manager SRV-HISTORY-500] Player history could not be saved; ${batch.length} event${batch.length === 1 ? '' : 's'} will be retried. ` +
      `${error?.message || String(error)}\n`
    );
    throw error;
  }).finally(() => {
    playerHistoryEventFlush = null;
    if (pendingPlayerHistoryEvents.length) {
      playerHistoryEventTimer = setTimeout(
        () => flushPlayerHistoryEventQueue().catch(() => {}),
        failed ? PLAYER_HISTORY_RETRY_DELAY_MS : PLAYER_HISTORY_BATCH_DELAY_MS
      );
      playerHistoryEventTimer.unref?.();
    }
  });
  return playerHistoryEventFlush;
}

function stripMinecraftLogControlSequences(value) {
  return String(value || '')
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/\u0000/g, '');
}

function extractMinecraftLogMessage(line) {
  const clean = stripMinecraftLogControlSequences(line).trim();
  const prefixed = clean.match(/^(?:\[[^\]\r\n]*\]\s*)+(?:\([^\)\r\n]*\)\s*)?:?\s*(.*)$/);
  return String(prefixed?.[1] ?? clean).trim();
}

function parsePlayerLogLine(line) {
  const message = extractMinecraftLogMessage(line);
  let match = message.match(/^([A-Za-z0-9_]{1,16}) joined the game[.!]?$/i);
  if (match) return { type: 'joined', name: match[1] };
  match = message.match(/^([A-Za-z0-9_]{1,16}) left the game[.!]?$/i);
  if (match) return { type: 'left', name: match[1] };
  match = message.match(/^([A-Za-z0-9_]{1,16})\[[^\r\n]*\]\s+logged in(?:\s+with entity id\b.*)?$/i);
  if (match) return { type: 'logged-in', name: match[1] };
  match = message.match(/^([A-Za-z0-9_]{1,16}) lost connection:\s*(.*)$/i);
  if (match) return { type: 'disconnected', name: match[1], reason: match[2].trim() };
  match = message.match(/^There are\s+(\d+)\s+of a max of\s+(\d+)\s+players online:\s*(.*)$/i);
  if (match) {
    return {
      type: 'roster',
      online: Math.max(0, Number(match[1]) || 0),
      max: Math.max(0, Number(match[2]) || 0),
      players: [...normalizeLivePlayerNames(match[3].split(',').map((name) => name.trim())).values()]
    };
  }
  return null;
}

async function getPlayerHistory() {
  const paths = await getPaths();
  if (worldResetReadSnapshot?.root === path.resolve(paths.root)) return [];
  const historyLimit = await readPlayerHistoryLimitForPaths(paths);
  let history = await readPlayerHistory();
  if (!Object.keys(history).length) {
    history = await getCachedWork(`player-history-log-import:${paths.root}`, 10 * 60_000, async () => {
      const imported = {};
      let logFiles = [];
      try {
        const names = (await fs.readdir(paths.logs, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && /\.log$/i.test(entry.name))
          .slice(0, 256);
        const withTimes = await mapWithConcurrency(names, 4, async (entry) => {
          const file = path.join(paths.logs, entry.name);
          try {
            const stat = await fs.stat(file);
            return { file, modifiedAt: stat.mtimeMs };
          } catch {
            return null;
          }
        });
        logFiles = withTimes.filter(Boolean)
          .sort((a, b) => b.modifiedAt - a.modifiedAt)
          .slice(0, HISTORY_LOG_FILE_LIMIT)
          .reverse()
          .map((entry) => entry.file);
      } catch {}
      for (const file of logFiles) {
        const text = await readFileTailUtf8(file, HISTORY_LOG_TAIL_BYTES);
        for (const line of text.split(/\r?\n/)) {
          const parsed = parsePlayerLogLine(line);
          if (!parsed || !['joined', 'logged-in', 'left'].includes(parsed.type)) continue;
          const name = parsed.name;
          const key = name.toLowerCase();
          const dateMatch = line.match(/^\[(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
          const seen = dateMatch ? new Date(`${dateMatch[1]}T${dateMatch[2]}`).toISOString() : new Date().toISOString();
          const eventType = parsed.type === 'left' ? 'left' : 'joined';
          const existing = imported[key] || {};
          imported[key] = {
            name,
            firstSeen: existing.firstSeen || seen,
            lastSeen: seen,
            lastActive: seen,
            lastEvent: eventType,
            events: appendPlayerHistoryEvent(existing.events, { type: eventType, timestamp: seen }, historyLimit)
          };
        }
      }
      return imported;
    });
    if (worldResetReadSnapshot?.root === path.resolve(paths.root)) return [];
    if (Object.keys(history).length) {
      history = prunePlayerHistory(history, historyLimit).history;
      await writePlayerHistory(history);
    }
  } else {
    if (worldResetReadSnapshot?.root === path.resolve(paths.root)) return [];
    history = await prunePlayerHistoryForPaths(paths, historyLimit);
  }
  return Object.values(history)
    .filter((entry) => entry?.name)
    .sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || '')));
}

function flattenPlayerHistoryEvents(history, maximum = 1000) {
  const rows = Array.isArray(history) ? history : Object.values(history || {});
  const events = [];
  for (const row of rows) {
    if (!row?.name) continue;
    const timeline = Array.isArray(row.events)
      ? row.events
      : row.lastEvent && row.lastActive ? [{ type: row.lastEvent, timestamp: row.lastActive }] : [];
    for (const event of timeline) {
      if (!event?.timestamp) continue;
      const uuid = normalizePlayerUuid(row.uuid);
      events.push({
        name: row.name,
        ...(uuid ? { uuid } : {}),
        type: String(event.type || 'seen'),
        event: String(event.type || 'seen'),
        timestamp: String(event.timestamp),
        reason: String(event.reason || ''),
        expiresAt: String(event.expiresAt || '')
      });
    }
  }
  return events
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, normalizePlayerHistoryLimit(maximum));
}

function consumePlayerLogChunk(remainder, chunk) {
  const combined = `${String(remainder || '')}${String(chunk || '')}`;
  const lines = combined.split(/\r?\n/);
  let nextRemainder = lines.pop() || '';
  if (nextRemainder.length > 65_536) nextRemainder = nextRemainder.slice(-65_536);
  return { lines, remainder: nextRemainder };
}

function processPlayerLogEvents(chunk) {
  const consumed = consumePlayerLogChunk(playerLogRemainder, chunk);
  playerLogRemainder = consumed.remainder;
  const lines = consumed.lines;
  let changed = false;
  let directRosterMutation = false;
  for (const line of lines) {
    const event = parsePlayerLogLine(line);
    if (!event) continue;
    if (event.type === 'joined' || event.type === 'logged-in') {
      const wasOnline = livePlayers.has(event.name.toLowerCase());
      const playerChanged = rememberLivePlayer(event.name);
      changed = playerChanged || changed;
      directRosterMutation = playerChanged || directRosterMutation;
      if (!wasOnline) {
        queuePlayerHistoryEvent(event.name, 'joined');
        restoreReconnectedPlayerSpectateSession(event.name)
          .catch((error) => appendPlayerViewRecoveryError(event.type === 'logged-in' ? 'after login' : 'after reconnect', error));
      }
      prewarmAuthenticatedPlayerSkin(event.name);
    }

    if (event.type === 'disconnected') {
      const reason = event.reason;
      if (/(?:kick|ban|cheat|flying|packet rate|spam|illegal|not allowed)/i.test(reason)) {
        queuePlayerHistoryEvent(event.name, 'kicked', { reason });
      }
    }

    if (event.type === 'left') {
      restoreSessionsWatchingPlayer(event.name).catch((error) => appendPlayerViewRecoveryError('for a departed target', error));
      const playerChanged = livePlayers.delete(event.name.toLowerCase());
      changed = playerChanged || changed;
      directRosterMutation = playerChanged || directRosterMutation;
      queuePlayerHistoryEvent(event.name, 'left');
    }

    if (event.type === 'roster' && event.online === event.players.length) {
      const replacement = replaceLivePlayers(event.players, {
        authoritative: true,
        recordHistory: true,
        emit: false
      });
      changed = replacement.changed || changed;
    }
  }
  if (directRosterMutation) advancePlayerRosterRevision();
  if (changed) {
    emitLivePlayers().catch(() => {});
    readConfig()
      .then((config) => applyRuntimePvpProtection(config, 'player-sync'))
      .catch(() => {});
  }
}

function normalizeProtectionIncidentEvent(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const player = String(source.player || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(player)) return null;
  const check = String(source.check || '').trim();
  const [category, shortCheck] = check.split('.', 2);
  if (!shortCheck || PROTECTION_EVENT_CHECKS[shortCheck] !== category) return null;
  const actionMap = {
    detect: 'log',
    alert: 'warn',
    kick: 'kick',
    temp_ban: 'temp-ban',
    'temp-ban': 'temp-ban',
    permanent_ban: 'ban',
    'permanent-ban': 'ban',
    ban: 'ban'
  };
  const action = actionMap[String(source.action || '').toLowerCase()];
  if (!action) return null;
  const parsedTimestamp = Date.parse(String(source.timestamp || ''));
  const now = Date.now();
  const timestamp = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0 && parsedTimestamp < now + 86_400_000
    ? new Date(parsedTimestamp).toISOString()
    : new Date(now).toISOString();
  const reason = String(source.reason || `${check} violation`)
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  const violations = Math.max(0, Math.min(1_000_000, Number(source.violations) || 0));
  const offenses = Math.max(0, Math.min(10_000, Math.round(Number(source.offenseCount) || Number(source.offenses) || 0)));
  const durationMs = Math.max(0, Math.min(366 * 24 * 60 * 60 * 1000,
    (Number(source.durationSeconds) || 0) * 1000 || Number(source.durationMs) || 0));
  const suppliedId = String(source.id || '').trim();
  const dedupeSource = [timestamp, player.toLowerCase(), check, action, reason, violations, offenses, durationMs].join('|');
  const id = /^[A-Za-z0-9_-]{8,100}$/.test(suppliedId)
    ? suppliedId
    : crypto.createHash('sha256').update(dedupeSource).digest('hex').slice(0, 32);
  return {
    id,
    player,
    uuid: /^[a-f0-9-]{32,36}$/i.test(String(source.uuid || '')) ? String(source.uuid).toLowerCase() : '',
    check,
    category,
    action,
    reason,
    violations,
    offenses,
    timestamp,
    durationMs,
    source: 'server-protection'
  };
}

function parseProtectionIncidentLine(line) {
  const text = String(line || '');
  const markers = ['[ServerProtection] EVENT ', '[ClickIntervalAC] EVENT '];
  const marker = markers.find((candidate) => text.includes(candidate));
  if (!marker) return null;
  const markerIndex = text.indexOf(marker);
  const payload = text.slice(markerIndex + marker.length).trim();
  if (!payload.startsWith('{') || payload.length > 16_384) return null;
  try {
    return normalizeProtectionIncidentEvent(JSON.parse(payload));
  } catch {
    return null;
  }
}

function consumeProtectionLogChunk(remainder, chunk) {
  const combined = `${String(remainder || '')}${String(chunk || '')}`;
  const lines = combined.split(/\r?\n/);
  let nextRemainder = lines.pop() || '';
  if (nextRemainder.length > 65_536) nextRemainder = nextRemainder.slice(-65_536);
  const incidents = [];
  for (const line of lines) {
    const incident = parseProtectionIncidentLine(line);
    if (incident) incidents.push(incident);
  }
  return {
    remainder: nextRemainder,
    lines,
    incidents
  };
}

function settleProtectionRuntimeReloadWaiter(status = getProtectionRuntimeStatus(protectionRuntimeHandshake)) {
  const requestId = String(status?.reload?.requestId || '');
  if (!requestId || status.reload.status === 'pending') return false;
  const waiter = protectionRuntimeReloadWaiters.get(requestId);
  if (!waiter) return false;
  protectionRuntimeReloadWaiters.delete(requestId);
  clearTimeout(waiter.timer);
  waiter.resolve({
    appliedLive: status.reload.status === 'succeeded',
    runtime: status
  });
  return true;
}

function observeProtectionRuntimeOutputLine(line, context = {}) {
  const text = String(line || '');
  if (text.length > 4_096 || ![
    'Server Protection', 'ServerProtection', 'Protection reloaded',
    'Reload rejected', 'Player access config', 'Could not load offense state'
  ].some((marker) => text.includes(marker))) return false;
  const next = observeProtectionRuntimeLine(protectionRuntimeHandshake, {
    generation: context.generation,
    adapterId: context.adapterId,
    line: text,
    now: Date.now()
  });
  if (next === protectionRuntimeHandshake) return false;
  protectionRuntimeHandshake = next;
  cachedStatus = null;
  settleProtectionRuntimeReloadWaiter(next);
  return true;
}

function getCurrentProtectionRuntimeStatus(adapter = null) {
  const status = getProtectionRuntimeStatus(protectionRuntimeHandshake);
  if (!adapter || !serverProcess || status.generation !== serverLifecycleGeneration ||
      status.expectedAdapterId !== adapter.id) return null;
  return status;
}

function reloadBundledProtectionRuntime(adapter) {
  if (!adapter) return Promise.resolve({ appliedLive: false, runtime: null });
  return protectionRuntimeReloadCoordinator.run(adapter.id, async () => {
    const current = getCurrentProtectionRuntimeStatus(adapter);
    if (!isServerRuntimeReady() || !current?.active) {
      return { appliedLive: false, runtime: current };
    }
    const requestId = crypto.randomUUID();
    const requestedAt = Date.now();
    const requested = requestProtectionRuntimeReload(protectionRuntimeHandshake, {
      generation: serverLifecycleGeneration,
      adapterId: adapter.id,
      requestId,
      now: requestedAt,
      timeoutMs: PROTECTION_RELOAD_TIMEOUT_MS
    });
    if (requested === protectionRuntimeHandshake || requested.reload.requestId !== requestId) {
      return { appliedLive: false, runtime: getCurrentProtectionRuntimeStatus(adapter) };
    }
    protectionRuntimeHandshake = requested;
    cachedStatus = null;
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => {
        const deadlineAt = Number(protectionRuntimeHandshake?.reload?.deadlineAt) || Date.now();
        protectionRuntimeHandshake = expireProtectionRuntimeReload(protectionRuntimeHandshake, {
          generation: serverLifecycleGeneration,
          adapterId: adapter.id,
          now: Math.max(Date.now(), deadlineAt)
        });
        cachedStatus = null;
        settleProtectionRuntimeReloadWaiter(protectionRuntimeHandshake);
      }, PROTECTION_RELOAD_TIMEOUT_MS + 25);
      timer.unref?.();
      protectionRuntimeReloadWaiters.set(requestId, { resolve, timer });
    });
    if (!sendServerCommand(adapter.reloadCommand || 'serverprotection reload')) {
      protectionRuntimeHandshake = expireProtectionRuntimeReload(protectionRuntimeHandshake, {
        generation: serverLifecycleGeneration,
        adapterId: adapter.id,
        now: requested.reload.deadlineAt
      });
      cachedStatus = null;
      settleProtectionRuntimeReloadWaiter(protectionRuntimeHandshake);
    }
    return result;
  });
}

function mergeProtectionIncidentHistory(existing, incoming, maximum = MAX_PROTECTION_HISTORY) {
  const seen = new Set();
  const acceptedExisting = [];
  for (const entry of Array.isArray(existing) ? existing : []) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    acceptedExisting.push(entry);
  }
  const added = [];
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    added.push(entry);
  }
  const incidents = [...added, ...acceptedExisting]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, Math.max(1, Number(maximum) || MAX_PROTECTION_HISTORY));
  return { added, incidents };
}

async function readProtectionHistoryForPaths(paths) {
  try {
    if ((await fs.stat(paths.protectionHistory)).size > 16 * 1024 * 1024) return [];
    const parsed = JSON.parse(await fs.readFile(paths.protectionHistory, 'utf8'));
    const incidents = Array.isArray(parsed) ? parsed : parsed?.incidents;
    return Array.isArray(incidents) ? incidents.filter((entry) => entry && typeof entry.id === 'string') : [];
  } catch {
    return [];
  }
}

async function getProtectionHistory(options = {}) {
  const paths = await getPaths();
  const limit = Math.max(1, Math.min(MAX_PROTECTION_HISTORY, Math.round(Number(options?.limit) || 500)));
  const player = String(options?.player || '').trim().toLowerCase();
  const action = String(options?.action || '').trim().toLowerCase();
  const check = String(options?.check || '').trim();
  return (await readProtectionHistoryForPaths(paths))
    .filter((entry) => !player || String(entry.player || '').toLowerCase() === player)
    .filter((entry) => !action || entry.action === action)
    .filter((entry) => !check || entry.check === check)
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, limit);
}

async function clearProtectionHistory() {
  const paths = await getPaths();
  const queue = protectionIncidentQueues.get(paths.protectionHistory);
  if (queue) {
    clearTimeout(queue.timer);
    queue.timer = null;
    queue.incidents.length = 0;
    queue.pendingIds?.clear();
    if (queue.flushing) await queue.flushing.catch(() => []);
  }
  await serializeFileWrite(paths.protectionHistory, () => writeJsonAtomically(paths.protectionHistory, {
    version: 1,
    incidents: [],
    updatedAt: new Date().toISOString()
  }));
  await serializeFileWrite(paths.playerHistory, async () => {
    const history = await readPlayerHistoryForPaths(paths);
    for (const entry of Object.values(history)) {
      if (!entry || !entry.lastProtectionEvent) continue;
      const protectionAction = entry.lastProtectionEvent.action;
      if (entry.lastEvent === 'cheat-detected' || entry.lastEvent === protectionAction) entry.lastEvent = 'seen';
      delete entry.protectionIncidents;
      delete entry.protectionOffenses;
      delete entry.lastProtectionEvent;
    }
    await writePlayerHistoryForPaths(paths, history);
  });
  emitAll('server:protectionHistory', []);
  advancePlayerStateRevision();
  const snapshot = await getPlayerHistory();
  emitAll('server:history', snapshot);
  emitAll('server:historyEvents', flattenPlayerHistoryEvents(snapshot));
  return [];
}

async function integrateProtectionIncidentsIntoPlayerHistory(paths, incidents) {
  if (!incidents.length) return;
  const historyLimit = await readPlayerHistoryLimitForPaths(paths);
  await serializeFileWrite(paths.playerHistory, async () => {
    const history = await readPlayerHistoryForPaths(paths);
    for (const incident of incidents) {
      const key = incident.player.toLowerCase();
      const existing = history[key] || {};
      const expiresAt = incident.action === 'temp-ban' && incident.durationMs
        ? new Date(Date.parse(incident.timestamp) + incident.durationMs).toISOString()
        : '';
      history[key] = {
        ...existing,
        name: incident.player,
        firstSeen: existing.firstSeen || incident.timestamp,
        lastSeen: existing.lastSeen || incident.timestamp,
        lastActive: incident.timestamp,
        lastEvent: incident.action === 'log' || incident.action === 'warn' ? 'cheat-detected' : incident.action,
        protectionIncidents: Math.max(0, Number(existing.protectionIncidents) || 0) + 1,
        protectionOffenses: Math.max(Number(existing.protectionOffenses) || 0, incident.offenses),
        events: appendPlayerHistoryEvent(existing.events, {
          type: incident.action === 'log' || incident.action === 'warn' ? 'cheat-detected' : incident.action,
          timestamp: incident.timestamp,
          reason: incident.reason,
          expiresAt
        }, historyLimit),
        lastProtectionEvent: {
          id: incident.id,
          check: incident.check,
          action: incident.action,
          reason: incident.reason,
          violations: incident.violations,
          offenses: incident.offenses,
          timestamp: incident.timestamp,
          durationMs: incident.durationMs
        }
      };
    }
    await writePlayerHistoryForPaths(paths, prunePlayerHistory(history, historyLimit).history);
  });
  advancePlayerStateRevision();
  const snapshot = await getPlayerHistory();
  emitAll('server:history', snapshot);
  emitAll('server:historyEvents', flattenPlayerHistoryEvents(snapshot));
}

async function integrateProtectionBans(paths, incidents) {
  const punishments = incidents.filter((incident) => incident.action === 'temp-ban' || incident.action === 'ban');
  if (!punishments.length) return;
  await serializeFileWrite(paths.assemblyBans, async () => {
    const stored = await readJson(paths.assemblyBans, {});
    for (const incident of punishments) {
      const key = incident.player.toLowerCase();
      const eventTime = Number.isFinite(Date.parse(incident.timestamp)) ? Date.parse(incident.timestamp) : Date.now();
      const endAt = incident.action === 'temp-ban' ? eventTime + Math.max(1000, incident.durationMs) : 0;
      stored[key] = {
        name: incident.player,
        endAt,
        createdAt: eventTime,
        source: 'Server Protection',
        reason: incident.reason || '',
        message: incident.reason || '',
        managed: true,
        protectionIncidentId: incident.id
      };
    }
    await writeJsonAtomically(paths.assemblyBans, stored);
  });
  const activePaths = await getPaths();
  if (path.resolve(activePaths.root) === path.resolve(paths.root)) {
    await readAssemblyBans();
    await getBannedPlayers();
  }
}

async function flushProtectionIncidentQueue(key) {
  const queue = protectionIncidentQueues.get(key);
  if (!queue || queue.flushing) return queue?.flushing || [];
  clearTimeout(queue.timer);
  queue.timer = null;
  const batch = queue.incidents.splice(0, PROTECTION_BATCH_MAX);
  for (const incident of batch) queue.pendingIds.delete(incident.id);
  if (!batch.length) return [];
  queue.flushing = (async () => {
    let added = [];
    await serializeFileWrite(queue.paths.protectionHistory, async () => {
      const existing = await readProtectionHistoryForPaths(queue.paths);
      const merged = mergeProtectionIncidentHistory(existing, batch);
      added = merged.added;
      if (!added.length) return;
      await writeJsonAtomically(queue.paths.protectionHistory, {
        version: 1,
        incidents: merged.incidents,
        updatedAt: new Date().toISOString()
      });
    });
    if (added.length) {
      await integrateProtectionIncidentsIntoPlayerHistory(queue.paths, added);
      await integrateProtectionBans(queue.paths, added);
      emitAll('server:protectionHistory', (await readProtectionHistoryForPaths(queue.paths))
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, 500));
      cachedStatus = null;
    }
    return added;
  })().finally(() => {
    queue.flushing = null;
    if (queue.incidents.length) {
      queue.timer = setTimeout(() => flushProtectionIncidentQueue(key).catch(() => {}), PROTECTION_BATCH_DELAY_MS);
      queue.timer.unref?.();
    } else {
      protectionIncidentQueues.delete(key);
    }
  });
  return queue.flushing;
}

async function queueProtectionIncident(incident) {
  return queueProtectionIncidents(incident ? [incident] : []);
}

async function queueProtectionIncidents(incidents) {
  if (!incidents.length) return;
  const paths = await getPaths();
  const key = paths.protectionHistory;
  let queue = protectionIncidentQueues.get(key);
  if (!queue) {
    queue = { paths, incidents: [], pendingIds: new Set(), timer: null, flushing: null, dropped: 0 };
    protectionIncidentQueues.set(key, queue);
  }
  for (const incident of incidents) {
    if (!incident || queue.pendingIds.has(incident.id)) continue;
    while (queue.incidents.length >= MAX_PROTECTION_PENDING) {
      const dropped = queue.incidents.shift();
      if (dropped) queue.pendingIds.delete(dropped.id);
      queue.dropped += 1;
    }
    queue.pendingIds.add(incident.id);
    queue.incidents.push(incident);
  }
  if (queue.incidents.length >= PROTECTION_BATCH_MAX) {
    await flushProtectionIncidentQueue(key);
    return;
  }
  if (!queue.timer && !queue.flushing) {
    queue.timer = setTimeout(() => flushProtectionIncidentQueue(key).catch(() => {}), PROTECTION_BATCH_DELAY_MS);
    queue.timer.unref?.();
  }
}

function scheduleProtectionIncidentIngress() {
  if (protectionIncidentIngressPromise) return protectionIncidentIngressPromise;
  protectionIncidentIngressPromise = Promise.resolve().then(async () => {
    while (pendingProtectionIncidents.length) {
      const batch = pendingProtectionIncidents.splice(0, PROTECTION_BATCH_MAX);
      await queueProtectionIncidents(batch);
    }
  }).catch(() => {}).finally(() => {
    protectionIncidentIngressPromise = null;
    if (pendingProtectionIncidents.length) scheduleProtectionIncidentIngress();
  });
  return protectionIncidentIngressPromise;
}

function processProtectionLogEvents(chunk, runtimeContext = {}) {
  const consumed = consumeProtectionLogChunk(protectionLogRemainder, chunk);
  protectionLogRemainder = consumed.remainder;
  if (runtimeContext.adapterId) {
    for (const line of consumed.lines) observeProtectionRuntimeOutputLine(line, runtimeContext);
  }
  if (!consumed.incidents.length) return;
  pendingProtectionIncidents.push(...consumed.incidents);
  if (pendingProtectionIncidents.length > MAX_PROTECTION_PENDING) {
    pendingProtectionIncidents = pendingProtectionIncidents.slice(-MAX_PROTECTION_PENDING);
  }
  scheduleProtectionIncidentIngress();
}

function flushServerLogIpc() {
  serverLogIpcTimer = null;
  let payload = pendingServerLogIpc.drain();
  if (pendingServerLogDropped) {
    payload = `[Server Manager] ${pendingServerLogDropped.toLocaleString('en-US')} log characters were skipped to keep the app responsive.\n${payload}`;
    pendingServerLogDropped = 0;
  }
  if (payload) emitAll('server:log', payload);
}

function appendServerLog(line) {
  const text = String(line ?? '');
  if (!text) return;
  serverLogBuffer.append(text);
  recentServerLogBuffer.append(text);
  processChatLogChunk(text);
  pendingServerLogDropped += pendingServerLogIpc.append(text);
  if (!serverLogIpcTimer) {
    serverLogIpcTimer = setTimeout(flushServerLogIpc, SERVER_LOG_IPC_DELAY_MS);
    serverLogIpcTimer.unref?.();
  }
}

function execPowershell(command) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 4000, maxBuffer: 128 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout)
    );
  });
}

function parseSha256Digest(value) {
  const match = String(value || '').match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : '';
}

function validatePlayitAssetMetadata(asset) {
  const sha256 = parseSha256Digest(asset?.digest);
  const size = Number(asset?.size);
  if (!asset?.browser_download_url || !sha256 || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PLAYIT_AGENT_BYTES) {
    throw new Error('The Playit release is missing valid signed asset integrity metadata. Nothing was downloaded.');
  }
  return { sha256, size };
}

function parseAuthenticodeResult(value) {
  let result;
  try {
    result = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('Windows could not return a valid Authenticode verification result.');
  }
  const normalized = {
    status: String(result?.Status || result?.status || ''),
    statusMessage: String(result?.StatusMessage || result?.statusMessage || ''),
    subject: String(result?.Subject || result?.subject || ''),
    thumbprint: String(result?.Thumbprint || result?.thumbprint || '').replace(/\s+/g, '').toUpperCase()
  };
  if (normalized.status !== 'Valid' || !normalized.subject || !/^[A-F0-9]{40,128}$/.test(normalized.thumbprint)) {
    const detail = normalized.statusMessage || normalized.status || 'unknown signature status';
    throw new Error(`The Playit executable failed Windows Authenticode verification (${detail}).`);
  }
  return normalized;
}

function verifyWindowsAuthenticode(file) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('The bundled Playit agent is supported only on Windows.'));
  }
  const escaped = String(file || '').replace(/'/g, "''");
  const command = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    `$certificate = $signature.SignerCertificate`,
    `[pscustomobject]@{Status=[string]($signature.Status);StatusMessage=[string]($signature.StatusMessage);Subject=[string]($certificate.Subject);Thumbprint=[string]($certificate.Thumbprint)} | ConvertTo-Json -Compress`
  ].join('; ');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 15_000, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Windows could not verify the Playit executable signature${stderr ? `: ${String(stderr).trim()}` : '.'}`));
          return;
        }
        try {
          resolve(parseAuthenticodeResult(stdout));
        } catch (verificationError) {
          reject(verificationError);
        }
      }
    );
  });
}

async function getDirectorySize(root) {
  return (await measureDirectoryBounded(root)).bytes;
}

async function getSystemPerformanceProbe(pid) {
  const script = `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; $rx=Get-NetAdapterStatistics | Measure-Object -Property ReceivedBytes -Sum; $tx=Get-NetAdapterStatistics | Measure-Object -Property SentBytes -Sum; [pscustomobject]@{CPU=$p.CPU;WorkingSet64=$p.WorkingSet64;PrivateMemorySize64=$p.PrivateMemorySize64;Responding=$p.Responding;ProcessFound=[bool]$p;Received=$rx.Sum;Sent=$tx.Sum}|ConvertTo-Json -Compress`;
  const output = await execPowershell(script);
  let parsed = null;
  let receivedBytes = 0;
  let sentBytes = 0;
  try {
    parsed = output ? JSON.parse(output) : null;
    receivedBytes = Number(parsed?.Received) || 0;
    sentBytes = Number(parsed?.Sent) || 0;
  } catch {}
  const now = Date.now();
  if (!parsed) {
    return {
      sampledAt: now,
      processInfo: null,
      networkThroughput: { incomingBytesPerSec: 0, outgoingBytesPerSec: 0 }
    };
  }
  let incomingBytesPerSec = 0;
  let outgoingBytesPerSec = 0;
  if (lastNetworkSample) {
    const seconds = Math.max(1, (now - lastNetworkSample.at) / 1000);
    incomingBytesPerSec = Math.max(0, Math.round((receivedBytes - lastNetworkSample.receivedBytes) / seconds));
    outgoingBytesPerSec = Math.max(0, Math.round((sentBytes - lastNetworkSample.sentBytes) / seconds));
  }
  lastNetworkSample = { receivedBytes, sentBytes, at: now };
  return {
    sampledAt: now,
    processInfo: parsed?.ProcessFound ? parsed : null,
    networkThroughput: { incomingBytesPerSec, outgoingBytesPerSec }
  };
}

function getRecentLogEvents() {
  const lines = recentServerLogBuffer.toString().split(/\r?\n/).filter(Boolean).slice(-80);
  return lines.slice(-5).reverse().map((line) => {
    const match = line.match(/^\[?(\d{2}:\d{2}:\d{2})\]?\s*(?:\[[^\]]+\]\s*)?(.*)$/);
    const message = (match?.[2] || line).replace(/^\[[^\]]+\]\s*/, '').slice(0, 120);
    let type = 'Server';
    let status = 'Info';
    if (/warn|failed|error|critical|exception/i.test(message)) {
      type = /warn/i.test(message) ? 'Warning' : 'Error';
      status = /warn/i.test(message) ? 'Warning' : 'Alert';
    } else if (/joined|left|login|connected/i.test(message)) {
      type = 'Player';
    } else if (/backup|saved|done|completed/i.test(message)) {
      type = 'System';
      status = 'Success';
    }
    return {
      timestamp: match?.[1] || new Date().toLocaleTimeString('en-GB', { hour12: false }),
      type,
      message,
      status
    };
  });
}

async function getServerPerformance(config, paths, players) {
  const totalMemoryMb = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMemoryMb = Math.floor(os.freemem() / 1024 / 1024);
  const requestedMemoryMb = Number(config.memoryMb) || DEFAULT_CONFIG.memoryMb;
  const allocatedMemoryMb = serverProcess && serverEffectiveMemoryMb
    ? serverEffectiveMemoryMb
    : safeJavaMemoryMb(requestedMemoryMb, totalMemoryMb, freeMemoryMb);
  const processId = serverProcess?.pid || 0;
  const [diskBytes, performanceProbe] = await Promise.all([
    getCachedWork(`disk-size:${paths.root}`, 5 * 60_000, () => getDirectorySize(paths.root)),
    processId
      ? getCachedWork(`system-performance:${processId}`, 10_000, () => getSystemPerformanceProbe(processId))
      : Promise.resolve(null)
  ]);
  const networkThroughput = performanceProbe?.networkThroughput || { incomingBytesPerSec: 0, outgoingBytesPerSec: 0 };
  const base = {
    pid: processId || null,
    cpuPercent: 0,
    memoryUsedMb: 0,
    memoryAllocatedMb: allocatedMemoryMb,
    memoryRequestedMb: requestedMemoryMb,
    memoryUsagePercent: 0,
    systemFreeMemoryMb: freeMemoryMb,
    systemTotalMemoryMb: totalMemoryMb,
    diskBytes,
    ...networkThroughput,
    playerLoadPercent: Math.round(((Number(players?.online) || 0) / Math.max(1, Number(players?.max) || Number(config.maxPlayers) || 1)) * 100),
    pingOk: serverState === 'running' ? Boolean(players?.reachable) : false,
    health: serverState === 'running' ? 'Starting' : 'Offline',
    healthDetail: serverState === 'running' ? 'Waiting for server response.' : 'Server is stopped.'
  };
  if (!processId || serverProcess?.pid !== processId) {
    lastServerPerfSample = null;
    return base;
  }

  const processSample = performanceProbe;
  const processInfo = processSample?.processInfo || null;
  if (!processInfo) {
    return {
      ...base,
      health: 'Critical',
      healthDetail: 'The Java process could not be read.'
    };
  }

  const now = processSample.sampledAt;
  const cpuSeconds = Number(processInfo.CPU) || 0;
  let cpuPercent = lastServerPerfSample?.pid === processId ? lastServerPerfSample.cpuPercent : 0;
  if (lastServerPerfSample?.pid === processId && now > lastServerPerfSample.at) {
    const cpuDelta = Math.max(0, cpuSeconds - lastServerPerfSample.cpuSeconds);
    const wallDelta = Math.max(1, (now - lastServerPerfSample.at) / 1000);
    cpuPercent = Math.min(100, Math.round((cpuDelta / wallDelta / Math.max(1, os.cpus().length)) * 100));
  }
  if (lastServerPerfSample?.pid !== processId || now > lastServerPerfSample.at) {
    lastServerPerfSample = { pid: processId, cpuSeconds, cpuPercent, at: now };
  }

  const memoryUsedMb = Math.round((Number(processInfo.PrivateMemorySize64) || Number(processInfo.WorkingSet64) || 0) / 1024 / 1024);
  const memoryUsagePercent = Math.min(100, Math.round((memoryUsedMb / Math.max(1, allocatedMemoryMb)) * 100));
  const responding = processInfo.Responding !== false;
  const pingOk = serverState === 'running' && Boolean(players?.reachable);
  let health = 'Healthy';
  let healthDetail = 'Server is running normally.';
  if (!responding || !pingOk) {
    health = 'Warning';
    healthDetail = 'Server is running, but status ping is not responding yet.';
  } else if (memoryUsagePercent >= 90 || cpuPercent >= 90 || base.playerLoadPercent >= 90) {
    health = 'Warning';
    healthDetail = 'Server is close to its current limits.';
  }
  return {
    ...base,
    cpuPercent,
    memoryUsedMb,
    memoryUsagePercent,
    pingOk,
    responding,
    health,
    healthDetail
  };
}

function cancelEmptyServerAutoStop() {
  const hadSchedule = Boolean(emptyServerStopTimer || emptyServerStopDueAt || emptyServerStopProfileId);
  if (emptyServerStopTimer) clearTimeout(emptyServerStopTimer);
  emptyServerStopTimer = null;
  emptyServerStopDueAt = 0;
  emptyServerStopProfileId = '';
  emptyServerStopMinutes = 0;
  if (hadSchedule) invalidateStatusCache();
}

function stopServerPowerSaveBlocker() {
  if (serverPowerSaveBlockerId === null) return;
  try {
    if (typeof powerSaveBlocker?.isStarted !== 'function' || powerSaveBlocker.isStarted(serverPowerSaveBlockerId)) {
      powerSaveBlocker?.stop?.(serverPowerSaveBlockerId);
    }
  } catch {}
  serverPowerSaveBlockerId = null;
}

async function syncServerPowerSaveBlocker(nextState = serverState, configOverride = null) {
  const config = configOverride || await readConfig().catch(() => DEFAULT_CONFIG);
  const shouldPreventSuspension = config.keepSystemAwakeWhileRunning !== false &&
    ['starting', 'running', 'stopping'].includes(String(nextState || '').toLowerCase()) &&
    !applicationQuitting;
  if (!shouldPreventSuspension) {
    stopServerPowerSaveBlocker();
    return false;
  }
  if (serverPowerSaveBlockerId !== null) {
    try {
      if (powerSaveBlocker?.isStarted?.(serverPowerSaveBlockerId)) return true;
    } catch {}
    serverPowerSaveBlockerId = null;
  }
  if (typeof powerSaveBlocker?.start !== 'function') return false;
  serverPowerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  return true;
}

function getEmptyServerAutoStopStatus(config = null) {
  const enabled = String(config?.emptyServerAction || '').toLowerCase() === 'stop';
  return {
    enabled,
    minutes: enabled ? Number(config?.emptyServerStopMinutes) || DEFAULT_CONFIG.emptyServerStopMinutes : 0,
    scheduled: Boolean(enabled && emptyServerStopTimer && emptyServerStopDueAt > Date.now()),
    dueAt: enabled && emptyServerStopDueAt > Date.now() ? new Date(emptyServerStopDueAt).toISOString() : '',
    remainingMs: enabled && emptyServerStopDueAt > Date.now() ? Math.max(0, emptyServerStopDueAt - Date.now()) : 0
  };
}

async function syncEmptyServerAutoStop(reason = 'state', configOverride = null) {
  const processRef = serverProcess;
  const generation = serverLifecycleGeneration;
  const runtimeReady = isServerRuntimeReady(processRef, serverState, serverReadyGeneration, generation);
  const config = configOverride || await readConfig().catch(() => DEFAULT_CONFIG);
  const enabled = config.emptyServerAction === 'stop';
  if (!runtimeReady || !enabled || livePlayers.size > 0 || applicationQuitting) {
    cancelEmptyServerAutoStop();
    return getEmptyServerAutoStopStatus(config);
  }

  const profile = await getActiveProfile().catch(() => null);
  if (!profile?.id || processRef !== serverProcess || generation !== serverLifecycleGeneration || livePlayers.size > 0) {
    cancelEmptyServerAutoStop();
    return getEmptyServerAutoStopStatus(config);
  }
  const minutes = clampInteger(config.emptyServerStopMinutes, 1, 1440, DEFAULT_CONFIG.emptyServerStopMinutes);
  if (emptyServerStopTimer && emptyServerStopProfileId === profile.id && emptyServerStopMinutes === minutes) {
    return getEmptyServerAutoStopStatus(config);
  }

  cancelEmptyServerAutoStop();
  emptyServerStopProfileId = profile.id;
  emptyServerStopMinutes = minutes;
  emptyServerStopDueAt = Date.now() + minutes * 60_000;
  emptyServerStopTimer = setTimeout(async () => {
    const expectedProfileId = emptyServerStopProfileId;
    emptyServerStopTimer = null;
    emptyServerStopDueAt = 0;
    emptyServerStopProfileId = '';
    emptyServerStopMinutes = 0;
    invalidateStatusCache();
    try {
      const [latestProfile, latestConfig] = await Promise.all([getActiveProfile(), readConfig()]);
      if (latestProfile?.id !== expectedProfileId || processRef !== serverProcess ||
          generation !== serverLifecycleGeneration || !isServerRuntimeReady() || livePlayers.size > 0 ||
          latestConfig.emptyServerAction !== 'stop') return;
      appendServerLog(
        `[Server Manager SRV-IDLE-200] No players joined for ${minutes} minute${minutes === 1 ? '' : 's'}; stopping the server as configured.\n`
      );
      await stopServer({ automaticEmptyStop: true });
    } catch (error) {
      appendServerLog(`[Server Manager SRV-IDLE-500] Empty-server stop failed: ${error?.message || String(error)}\n`);
    }
  }, minutes * 60_000);
  emptyServerStopTimer.unref?.();
  appendServerLog(
    `[Server Manager SRV-IDLE-100] Empty-server stop scheduled in ${minutes} minute${minutes === 1 ? '' : 's'} (${reason}).\n`
  );
  invalidateStatusCache();
  return getEmptyServerAutoStopStatus(config);
}

function setState(nextState) {
  serverState = nextState;
  invalidateStatusCache();
  syncServerPowerSaveBlocker(nextState).catch(() => {});
  if (nextState === 'stopped') {
    cancelEmptyServerAutoStop();
    const rosterChanged = livePlayers.size > 0;
    livePlayers.clear();
    lastPlayerRosterProbeAt = 0;
    lastPlayerRosterAuthoritativeAt = 0;
    if (rosterChanged) advancePlayerRosterRevision();
    emitLivePlayers().catch(() => {});
  } else if (nextState === 'running') {
    syncEmptyServerAutoStop('server ready').catch(() => {});
  }
  emitAll('server:state', nextState);
}

function assertSafeHttpsUrl(value, allowedHosts = []) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('The download service returned an invalid URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Only credential-free HTTPS downloads are allowed.');
  }
  if (allowedHosts.length) {
    const hostname = parsed.hostname.toLowerCase();
    const accepted = allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    if (!accepted) throw new Error(`Refusing a download from an unexpected host (${hostname}).`);
  }
  return parsed;
}

function openHttpsResponse(url, options = {}, redirectCount = 0) {
  const parsed = assertSafeHttpsUrl(url, options.allowedHosts || []);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: { 'User-Agent': HTTP_USER_AGENT, Accept: options.accept || '*/*', ...(options.headers || {}) }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectCount >= (options.maxRedirects ?? 5)) {
          reject(new Error('Download redirected too many times.'));
          return;
        }
        const redirected = new URL(location, parsed).toString();
        const nextOptions = { ...options };
        if (new URL(redirected).origin !== parsed.origin && nextOptions.headers) {
          nextOptions.headers = { ...nextOptions.headers };
          delete nextOptions.headers.Authorization;
          delete nextOptions.headers['x-api-key'];
        }
        openHttpsResponse(redirected, nextOptions, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        const error = new Error(`Request failed with HTTP ${response.statusCode}.`);
        error.statusCode = response.statusCode;
        reject(error);
        return;
      }
      resolve({ response, finalUrl: parsed.toString() });
    });
    request.setTimeout(options.timeoutMs || 15_000, () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
  });
}

async function replaceFileAtomically(temporary, destination, backupExisting = false) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (backupExisting) {
    try {
      await fs.copyFile(destination, `${destination}.previous`);
    } catch {}
  }
  try {
    await fs.rename(temporary, destination);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    const recovery = `${destination}.replace-backup-${process.pid}-${Date.now()}`;
    let movedExisting = false;
    try {
      await fs.rename(destination, recovery);
      movedExisting = true;
    } catch (moveError) {
      if (moveError.code !== 'ENOENT') throw moveError;
    }
    try {
      await fs.rename(temporary, destination);
      if (movedExisting) await fs.rm(recovery, { force: true });
    } catch (replaceError) {
      if (movedExisting) await fs.rename(recovery, destination).catch(() => {});
      throw replaceError;
    }
  }
}

async function download(url, destination, options = {}) {
  const maximumBytes = Math.max(1, Number(options.maxBytes) || MAX_SERVER_JAR_BYTES);
  const temporary = `${destination}.download-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const hashes = Object.fromEntries(
    Object.keys(options.expectedHashes || {}).map((algorithm) => [algorithm, crypto.createHash(algorithm)])
  );
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const { response } = await openHttpsResponse(url, options);
    const declaredSize = Number(response.headers['content-length']) || 0;
    if (declaredSize > maximumBytes) {
      response.destroy();
      throw new Error(`Download is larger than the ${Math.floor(maximumBytes / 1024 / 1024)} MB safety limit.`);
    }
    let received = 0;
    let lastProgressAt = 0;
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > maximumBytes) {
          callback(new Error(`Download exceeded the ${Math.floor(maximumBytes / 1024 / 1024)} MB safety limit.`));
          return;
        }
        for (const hash of Object.values(hashes)) hash.update(chunk);
        const now = Date.now();
        if (now - lastProgressAt >= 125 || (declaredSize && received === declaredSize)) {
          lastProgressAt = now;
          emit('download:progress', { received, total: declaredSize });
        }
        callback(null, chunk);
      }
    });
    await pipeline(response, meter, fss.createWriteStream(temporary, { flags: 'wx' }));
    if (declaredSize && received !== declaredSize) throw new Error('The download ended before all bytes arrived.');
    if (options.expectedSize && received !== Number(options.expectedSize)) {
      throw new Error('The downloaded file size did not match the provider metadata.');
    }
    for (const [algorithm, expected] of Object.entries(options.expectedHashes || {})) {
      const actual = hashes[algorithm].digest('hex');
      if (!expected || actual.toLowerCase() !== String(expected).toLowerCase()) {
        throw new Error(`The downloaded file failed its ${algorithm.toUpperCase()} integrity check.`);
      }
    }
    if (options.requireJar) {
      const handle = await fs.open(temporary, 'r');
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, 4, 0);
      await handle.close();
      if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('The provider did not return a valid JAR file.');
    }
    if (typeof options.beforeCommit === 'function') await options.beforeCommit();
    await replaceFileAtomically(temporary, destination, Boolean(options.backupExisting));
    return { path: destination, size: received };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function getText(url, options = {}) {
  const maximumBytes = Math.max(1, Number(options.maxBytes) || 1024 * 1024);
  const { response } = await openHttpsResponse(url, { ...options, accept: options.accept || 'text/plain' });
  const chunks = [];
  let received = 0;
  for await (const chunk of response) {
    received += chunk.length;
    if (received > maximumBytes) {
      response.destroy();
      throw new Error('Response was larger than the safety limit.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function getBuffer(url, options = {}) {
  const maximumBytes = Math.max(1, Number(options.maxBytes) || 1024 * 1024);
  const { response } = await openHttpsResponse(url, options);
  const declaredSize = Number(response.headers['content-length']) || 0;
  if (declaredSize > maximumBytes) {
    response.destroy();
    throw new Error('Response was larger than the safety limit.');
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of response) {
    received += chunk.length;
    if (received > maximumBytes) {
      response.destroy();
      throw new Error('Response was larger than the safety limit.');
    }
    chunks.push(chunk);
  }
  if (declaredSize && received !== declaredSize) throw new Error('The response ended before all bytes arrived.');
  return Buffer.concat(chunks);
}

async function getJson(url, headers = {}, options = {}) {
  let text;
  try {
    text = await getText(url, {
      ...options,
      headers,
      maxBytes: options.maxBytes || MAX_JSON_BYTES,
      timeoutMs: options.timeoutMs || 12_000,
      accept: 'application/json'
    });
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The provider returned an invalid JSON response.');
    throw error;
  }
}

function natMap(client, opts, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Router mapping timed out.')), timeoutMs);
    timer.unref?.();
    try { client.map(opts, finish); }
    catch (error) { finish(error); }
  });
}

function natUnmap(client, opts, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('Router unmapping timed out.')), timeoutMs);
    timer.unref?.();
    try { client.unmap(opts, finish); }
    catch (error) { finish(error); }
  });
}

function natExternalIp(client, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, ip) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(ip);
    };
    const timer = setTimeout(() => finish(new Error('Public IP discovery timed out.')), timeoutMs);
    timer.unref?.();
    try { client.externalIp(finish); }
    catch (error) { finish(error); }
  });
}

function writeVarInt(value) {
  const bytes = [];
  let next = Number(value) >>> 0;
  do {
    let byte = next & 0x7f;
    next >>>= 7;
    if (next) byte |= 0x80;
    bytes.push(byte);
  } while (next);
  return Buffer.from(bytes);
}

function writeMcString(value) {
  const body = Buffer.from(String(value), 'utf8');
  return Buffer.concat([writeVarInt(body.length), body]);
}

function writeMcPacket(id, payload = Buffer.alloc(0)) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarInt(buffer, offset = 0) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length) {
    const byte = buffer[pos++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value, pos];
    shift += 7;
  }
  throw new Error('Incomplete VarInt.');
}

function queryMinecraftStatus(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 2500 }, () => {
      const handshake = Buffer.concat([
        writeVarInt(775),
        writeMcString(host),
        Buffer.from([(port >> 8) & 255, port & 255]),
        writeVarInt(1)
      ]);
      socket.write(writeMcPacket(0, handshake));
      socket.write(writeMcPacket(0));
    });
    const chunks = [];
    let receivedBytes = 0;
    let expectedPacketBytes = 0;
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };
    socket.on('data', (chunk) => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_MINECRAFT_STATUS_BYTES) {
        done(null);
        return;
      }
      chunks.push(chunk);
      if (!expectedPacketBytes) {
        try {
          const header = Buffer.concat(chunks, Math.min(receivedBytes, 5));
          const [packetLength, packetStart] = readVarInt(header, 0);
          expectedPacketBytes = packetStart + packetLength;
          if (packetLength < 1 || expectedPacketBytes > MAX_MINECRAFT_STATUS_BYTES) {
            done(null);
            return;
          }
        } catch {
          return;
        }
      }
      if (receivedBytes < expectedPacketBytes) return;
      const buffer = Buffer.concat(chunks, expectedPacketBytes);
      try {
        const [, packetStart] = readVarInt(buffer, 0);
        const [, payloadStart] = readVarInt(buffer, packetStart);
        const [jsonLength, jsonStart] = readVarInt(buffer, payloadStart);
        if (jsonLength < 0 || jsonStart + jsonLength > expectedPacketBytes || buffer.length < jsonStart + jsonLength) {
          done(null);
          return;
        }
        done(JSON.parse(buffer.slice(jsonStart, jsonStart + jsonLength).toString('utf8')));
      } catch {
        done(null);
      }
    });
    socket.on('error', () => done(null));
    socket.on('timeout', () => done(null));
  });
}

function analyzeMinecraftStatusRoster(status) {
  const statusSample = Array.isArray(status?.players?.sample)
    ? status.players.sample.slice(0, MAX_PLAYER_STATUS_SAMPLE)
    : [];
  const statusPlayersByName = new Map(statusSample
    .filter((entry) => /^[A-Za-z0-9_]{1,16}$/.test(String(entry?.name || '')))
    .map((entry) => [String(entry.name).toLowerCase(), {
      name: String(entry.name),
      uuid: normalizePlayerUuid(entry.uuid || entry.id)
    }]));
  const reportedOnlineValue = Number(status?.players?.online);
  const hasReportedOnline = Number.isInteger(reportedOnlineValue) && reportedOnlineValue >= 0;
  const reportedOnline = hasReportedOnline ? reportedOnlineValue : null;
  const completeStatusSample = hasReportedOnline && reportedOnline === statusPlayersByName.size;
  return {
    statusSample,
    statusPlayersByName,
    hasReportedOnline,
    reportedOnline,
    completeNames: completeStatusSample ? [...statusPlayersByName.values()].map((entry) => entry.name) : null
  };
}

function reconcileLivePlayersFromMinecraftStatus(status, options = {}) {
  const analysis = analyzeMinecraftStatusRoster(status);
  if (!analysis.completeNames) return { analysis, replacement: null };
  return {
    analysis,
    replacement: replaceLivePlayers(analysis.completeNames, {
      authoritative: true,
      recordHistory: options.recordHistory !== false,
      emit: options.emit !== false
    })
  };
}

async function getPlayerStatus(options = {}) {
  const config = await readConfig();
  if (serverState !== 'running') {
    return {
      online: 0,
      max: Number(config.maxPlayers) || 0,
      sample: [],
      reachable: false,
      revision: playerStateRevision,
      rosterRevision: playerRosterRevision
    };
  }
  const port = Number(config.port) || 25565;
  const bindHost = String(config.bindIp || '').trim();
  const hosts = [
    bindHost && !['0.0.0.0', '::', '*'].includes(bindHost) ? bindHost : '',
    '127.0.0.1',
    'localhost'
  ].filter(Boolean);
  const status = await getCachedWork(`minecraft-ping:${hosts.join(',')}:${port}:${serverState}`, 4_000, async () => {
    for (const host of [...new Set(hosts)]) {
      const result = await queryMinecraftStatus(host, port);
      if (result) return result;
    }
    return null;
  });
  const { analysis: rosterStatus } = reconcileLivePlayersFromMinecraftStatus(status);
  const {
    statusSample,
    statusPlayersByName,
    hasReportedOnline
  } = rosterStatus;
  const reportedOnline = hasReportedOnline ? rosterStatus.reportedOnline : livePlayers.size;
  if (options.requestRosterSync !== false &&
      (Date.now() - lastPlayerRosterAuthoritativeAt >= PLAYER_ROSTER_SYNC_INTERVAL_MS ||
       (hasReportedOnline && reportedOnline !== livePlayers.size))) {
    requestPlayerRosterSync(false);
  }
  const rosterMatchesStatus = !hasReportedOnline || livePlayers.size === reportedOnline;
  const liveSample = [...livePlayers.values()].slice(0, MAX_PLAYER_STATUS_SAMPLE).map((name) => ({
    name,
    uuid: statusPlayersByName.get(name.toLowerCase())?.uuid || ''
  }));
  const rawSample = reportedOnline === 0
    ? []
    : rosterMatchesStatus && liveSample.length
      ? liveSample
      : statusSample;
  return {
    online: reportedOnline,
    max: Number(status?.players?.max) || Number(config.maxPlayers) || 0,
    sample: await enrichPlayerSamples(rawSample).catch(() => rawSample.slice(0, MAX_PLAYER_STATUS_SAMPLE).map((entry) => ({
      ...entry,
      uuid: normalizePlayerUuid(entry?.uuid || entry?.id)
    }))),
    reachable: Boolean(status),
    revision: playerStateRevision,
    rosterRevision: playerRosterRevision
  };
}

async function getPlayerSnapshot(options = {}) {
  if (options.flushPending !== false) await flushPlayerHistoryEventQueue();
  let latest = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const revisionBefore = playerStateRevision;
    const players = await getPlayerStatus({ requestRosterSync: options.requestRosterSync !== false });
    if (options.flushPending !== false) await flushPlayerHistoryEventQueue();
    const history = await getPlayerHistory();
    const revisionAfter = playerStateRevision;
    const historyEvents = flattenPlayerHistoryEvents(history);
    latest = {
      revision: revisionAfter,
      players: { ...players, revision: revisionAfter },
      history,
      historyEvents,
      playerEvents: historyEvents,
      generatedAt: new Date().toISOString()
    };
    if (revisionBefore === revisionAfter) return latest;
  }
  return latest;
}

async function getJoinDiagnostics(config, players) {
  const address = buildPublicJoinAddress(config);
  const parsed = parseServerAddress(address, Number(config.port) || 25565);
  const serverInactive = !serverProcess || serverState === 'stopped' || serverState === 'stopping';
  const publicSelfReachable = !serverInactive && parsed.host
    ? await getCachedWork(`public-connect:${parsed.host}:${parsed.port}:${serverState}`, 15_000, () => testTcpConnect(parsed.host, parsed.port))
    : false;
  let code = 'SRV-NET-000';
  let title = 'Join path reachable';
  let message = 'Public join address is reachable from this machine.';
  let action = 'No action needed.';
  const startupGraceActive = Boolean(serverProcess && serverStartedAt && Date.now() - serverStartedAt < 15000);
  if (config.localOnly) {
    code = 'SRV-NET-LOCAL';
    title = 'Local-only mode enabled';
    message = 'Public status and join probes are intentionally disabled; Minecraft only listens on loopback.';
    action = `Use ${LOCAL_ONLY_BIND_IP}:${Number(config.port) || DEFAULT_CONFIG.port} on this PC, or disable local-only mode while the server is stopped.`;
  } else if (serverInactive) {
    code = 'SRV-NET-011';
    title = 'Minecraft server is not running';
    message = 'Join diagnostics are paused until the server process is active.';
    action = 'Start the server before testing the public join address.';
  } else if (!parsed.host) {
    code = 'SRV-NET-202';
    title = 'No public join address configured';
    message = 'No public join address is configured to test.';
    action = 'Map direct hosting or set a real public hostname.';
  } else if (!players?.reachable && startupGraceActive) {
    code = 'SRV-NET-010';
    title = 'Minecraft status ping pending';
    message = 'Minecraft is still starting, so the status ping is not treated as a connection failure yet.';
    action = 'Wait for the server to finish startup.';
  } else if (!players?.reachable) {
    code = 'SRV-NET-101';
    title = 'Local Minecraft status ping failed';
    message = 'The Java process may be running, but Minecraft status did not answer on the configured port.';
    action = 'Wait for startup to finish, then check port, server-ip binding, firewall, and server version.';
  } else if (!publicSelfReachable) {
    code = 'SRV-NET-201';
    title = 'Public address cannot be tested from this Wi-Fi';
    message = 'The local server is reachable, but this network refused the public-address self-test. This usually means router NAT loopback/hairpin is blocked, not that Minecraft is down.';
    action = 'Use localhost or the LAN IP from this PC. Test the public address from mobile data/outside Wi-Fi, or use the playit tunnel fallback.';
  }
  const diagnostic = {
    address,
    publicSelfReachable,
    localServerReachable: Boolean(players?.reachable),
    localOnly: config.localOnly === true,
    loopbackLikelyBlocked: Boolean(parsed.host && players?.reachable && !publicSelfReachable),
    code,
    title,
    message,
    action
  };
  appendJoinDiagnosticLog(diagnostic);
  return diagnostic;
}

function buildPublicJoinAddress(config) {
  if (config?.localOnly === true) return '';
  return String(config.customHostname || config.publicAddress || '').trim();
}

function appendJoinDiagnosticLog(diagnostic) {
  if (diagnostic.code === 'SRV-NET-010' || diagnostic.code === 'SRV-NET-011') return;
  const signature = `${diagnostic.code}|${diagnostic.address}|${diagnostic.localServerReachable}|${diagnostic.publicSelfReachable}`;
  if (signature === lastJoinDiagnosticSignature) return;
  lastJoinDiagnosticSignature = signature;
  if (diagnostic.code === 'SRV-NET-000') {
    appendServerLog(`[Server Manager ${diagnostic.code}] ${diagnostic.title}: ${diagnostic.address || 'no address'}.\n`);
    return;
  }
  appendServerLog(
    `[Server Manager ${diagnostic.code}] ${diagnostic.title}\n` +
    `  Address: ${diagnostic.address || 'not set'}\n` +
    `  Local Minecraft status: ${diagnostic.localServerReachable ? 'reachable' : 'not reachable'}\n` +
    `  Public self-test from this PC: ${diagnostic.publicSelfReachable ? 'reachable' : 'refused or timed out'}\n` +
    `  Meaning: ${diagnostic.message}\n` +
    `  Next step: ${diagnostic.action}\n`
  );
}

async function getPublicIp() {
  return getCachedWork('public-ip', 10 * 60_000, async () => {
    try {
      // Router UPnP/NAT-PMP mappings are IPv4 mappings. Keep the comparison in
      // the same address family so a public IPv6 result cannot be mistaken for
      // an upstream NAT/CGNAT mismatch.
      return await getText('https://api4.ipify.org?format=text', { allowedHosts: ['api4.ipify.org'], timeoutMs: 4_500 });
    } catch {
      return '';
    }
  });
}

function getSimpleVoiceChatKind(serverType) {
  const type = normalizeServerType(serverType);
  if (['paper', 'purpur', 'spigot'].includes(type)) return 'plugins';
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(type)) return 'mods';
  return '';
}

function getSimpleVoiceChatConfigPath(paths, kind) {
  if (kind === 'mods') return paths.simpleVoiceModConfig;
  if (kind === 'plugins') return paths.simpleVoicePluginConfig;
  return '';
}

function resolveSimpleVoiceBindAddress(value, localOnly = false) {
  const requested = String(value || '').trim();
  if (localOnly) {
    return {
      bindAddress: LOCAL_ONLY_BIND_IP,
      warning: requested && requested !== LOCAL_ONLY_BIND_IP
        ? `Simple Voice Chat bind_address=${requested} was replaced with loopback binding for local-only mode.`
        : ''
    };
  }
  return {
    bindAddress: '*',
    warning: requested && requested !== '*'
      ? `Simple Voice Chat bind_address=${requested} was replaced with wildcard binding so external UDP remains reachable across the server host's network interfaces.`
      : ''
  };
}

function isGloballyRoutableIpv4(value) {
  const address = String(value || '').trim();
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function resolveMappedUdpPublicRoute(gatewayValue, internetValue) {
  const gatewayPublicIp = String(gatewayValue || '').trim();
  const internetPublicIp = String(internetValue || '').trim();
  const gatewayIsPublic = isGloballyRoutableIpv4(gatewayPublicIp);
  const internetIpIsPublic = isGloballyRoutableIpv4(internetPublicIp);
  const upstreamNatLikely = Boolean(
    (gatewayPublicIp && !gatewayIsPublic) ||
    (gatewayIsPublic && internetIpIsPublic && gatewayPublicIp !== internetPublicIp)
  );
  const publicRouteConfirmed = Boolean(
    gatewayIsPublic && (!internetIpIsPublic || gatewayPublicIp === internetPublicIp)
  );
  return {
    gatewayPublicIp,
    internetPublicIp,
    publicIp: publicRouteConfirmed ? gatewayPublicIp : internetIpIsPublic ? internetPublicIp : '',
    upstreamNatLikely,
    publicRouteConfirmed
  };
}

function normalizeVoiceNetworkMetadata(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const provider = source.provider && typeof source.provider === 'object' && !Array.isArray(source.provider)
    ? source.provider : {};
  const network = source.network && typeof source.network === 'object' && !Array.isArray(source.network)
    ? source.network : {};
  const firewall = source.firewall && typeof source.firewall === 'object' && !Array.isArray(source.firewall)
    ? source.firewall : {};
  return {
    version: 1,
    provider: {
      type: provider.type === 'simple-voice-chat' ? 'simple-voice-chat' : '',
      kind: ['mods', 'plugins'].includes(provider.kind) ? provider.kind : '',
      file: path.basename(String(provider.file || '')).slice(0, 260),
      identitySource: String(provider.identitySource || '').slice(0, 64)
    },
    udpPort: normalizeOptionalUdpPort(source.udpPort) || 0,
    configFile: String(source.configFile || '').slice(0, 512),
    bindAddress: String(source.bindAddress || '').slice(0, 256),
    managedVoiceHost: String(source.managedVoiceHost || '').slice(0, 512),
    voiceHostSource: String(source.voiceHostSource || '').slice(0, 64),
    voiceHostManaged: source.voiceHostManaged === true,
    advertisedEndpoint: String(source.advertisedEndpoint || '').slice(0, 512),
    network: {
      attempted: network.attempted === true,
      mapped: network.mapped === true,
      publicRouteConfirmed: network.publicRouteConfirmed === true,
      port: normalizeOptionalUdpPort(network.port) || 0,
      publicIp: String(network.publicIp || '').slice(0, 128),
      gatewayPublicIp: String(network.gatewayPublicIp || '').slice(0, 128),
      upstreamNatLikely: network.upstreamNatLikely === true,
      error: String(network.error || '').slice(0, 512)
    },
    firewall: {
      attempted: firewall.attempted === true,
      configured: firewall.configured === true,
      ruleName: String(firewall.ruleName || '').slice(0, 256),
      error: String(firewall.error || '').slice(0, 512)
    },
    warning: String(source.warning || '').slice(0, 512),
    updatedAt: String(source.updatedAt || '').slice(0, 40)
  };
}

async function readVoiceNetworkMetadata(paths) {
  return normalizeVoiceNetworkMetadata(await readJson(paths.voiceNetwork, {}));
}

async function writeVoiceNetworkMetadata(paths, value) {
  const metadata = normalizeVoiceNetworkMetadata(value);
  await serializeFileWrite(paths.voiceNetwork, () => writeJsonAtomically(paths.voiceNetwork, metadata));
  cachedStatus = null;
  return metadata;
}

async function getVoiceNetworkStatus(paths, config) {
  const metadata = await readVoiceNetworkMetadata(paths);
  let installed = false;
  if (metadata.provider.file && metadata.provider.kind) {
    const directory = metadata.provider.kind === 'mods' ? paths.mods : paths.plugins;
    try {
      const providerPath = resolveContainedPath(directory, path.join(directory, metadata.provider.file));
      installed = await isRegularFile(providerPath);
    } catch {}
  }
  const profile = await getActiveProfile();
  const lease = getOwnedNatLease(directHostingState, 'voice', String(profile?.id || ''));
  return {
    ...metadata,
    installed,
    active: Boolean(installed && metadata.udpPort),
    udpPort: metadata.udpPort || normalizeOptionalUdpPort(config.voiceUdpPort) || 0,
    network: {
      ...metadata.network,
      mapped: Boolean(lease && lease.port === (metadata.udpPort || normalizeOptionalUdpPort(config.voiceUdpPort))),
      publicRouteConfirmed: Boolean(
        lease && lease.port === (metadata.udpPort || normalizeOptionalUdpPort(config.voiceUdpPort)) &&
        metadata.network.publicRouteConfirmed
      ),
      port: lease?.port || metadata.network.port || metadata.udpPort || 0
    }
  };
}

async function readSimpleVoiceChatProperties(file) {
  if (!file) return '';
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Simple Voice Chat config must be a regular file inside the managed server directory.');
  }
  if (stat.size > MAX_VOICE_CONFIG_BYTES) {
    throw new Error('Simple Voice Chat config exceeds its 256 KiB safety limit.');
  }
  return fs.readFile(file, 'utf8');
}

async function writeSimpleVoiceChatProperties(file, original, updates) {
  if (!file) throw new Error('Simple Voice Chat has no compatible config path for this server type.');
  const text = upsertJavaProperties(original, updates);
  await serializeFileWrite(file, async () => {
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const current = await fs.lstat(file).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
      if (current && (current.isSymbolicLink() || !current.isFile())) {
        throw new Error('Simple Voice Chat config must be a regular file inside the managed server directory.');
      }
      await fs.writeFile(temporary, text, 'utf8');
      await replaceFileAtomically(temporary, file, Boolean(current));
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  });
  return text;
}

function readTopLevelYamlScalar(text, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`^${escaped}\\s*:\\s*(.*)$`);
  let value;
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(expression);
    if (!match) continue;
    value = String(match[1] || '').replace(/\s+#.*$/, '').trim();
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
  }
  return value;
}

function getBundledVoiceConfigScalar(original, format, key) {
  return format === 'properties'
    ? getJavaProperty(String(original || ''), key)
    : readTopLevelYamlScalar(String(original || ''), key);
}

function renderBundledVoiceNetworkConfig(original, format = 'yaml', bindAddress = '', publicHost = '') {
  const source = String(original || '');
  const getValue = key => getBundledVoiceConfigScalar(source, format, key);
  const enabledValue = String(getValue('enabled') ?? 'true').trim().toLowerCase();
  const enabled = enabledValue === 'false' ? false : true;
  const rawPort = Number(getValue('port'));
  const port = Number.isSafeInteger(rawPort) && rawPort >= 1 && rawPort <= 65_535
    ? rawPort : DEFAULT_VOICE_UDP_PORT;
  const rawDistance = Number(getValue('voiceDistance'));
  const voiceDistance = Number.isFinite(rawDistance) && rawDistance >= 1 && rawDistance <= 512
    ? rawDistance : 48;
  const rawTimeout = Number(getValue('sessionTimeoutSeconds'));
  const sessionTimeoutSeconds = Number.isSafeInteger(rawTimeout) && rawTimeout >= 15 && rawTimeout <= 300
    ? rawTimeout : 45;
  if (format === 'properties') {
    const base = [
      '# Proximity Voice Fabric server settings',
      `enabled=${enabled}`,
      `port=${port}`,
      `voiceDistance=${voiceDistance}`,
      `sessionTimeoutSeconds=${sessionTimeoutSeconds}`,
      ''
    ].join('\n');
    return upsertJavaProperties(base, { bindAddress, publicHost });
  }
  return [
    '# Proximity Voice server settings',
    `enabled: ${enabled}`,
    `bindAddress: ${JSON.stringify(String(bindAddress || ''))}`,
    `publicHost: ${JSON.stringify(String(publicHost || ''))}`,
    `port: ${port}`,
    `voiceDistance: ${voiceDistance}`,
    `sessionTimeoutSeconds: ${sessionTimeoutSeconds}`,
    ''
  ].join('\n');
}

function renderLocalOnlyBundledVoiceConfig(original, format = 'yaml') {
  return renderBundledVoiceNetworkConfig(original, format, LOCAL_ONLY_BIND_IP, '');
}

async function readBundledVoiceConfigForLocalOnly(file) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Proximity Voice config must be a regular file inside the managed server directory.');
  }
  if (stat.size > MAX_VOICE_CONFIG_BYTES) {
    throw new Error('Proximity Voice config exceeds its 256 KiB safety limit.');
  }
  return fs.readFile(file, 'utf8');
}

async function writeBundledVoiceConfigForLocalOnly(file, text) {
  await serializeFileWrite(file, async () => {
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const current = await fs.lstat(file).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
      if (current && (current.isSymbolicLink() || !current.isFile())) {
        throw new Error('Proximity Voice config must be a regular file inside the managed server directory.');
      }
      await fs.writeFile(temporary, text, 'utf8');
      await replaceFileAtomically(temporary, file, Boolean(current));
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  });
}

async function prepareBundledVoiceNetworkForStartup({ paths, config, platform }) {
  const metadata = await readServerToolsMetadata(paths);
  const candidates = [
    getBundledVoiceAdapterById(metadata.voice?.adapterId || ''),
    getBundledVoiceAdapter(config.serverType, getBundledVoiceMinecraftVersion(config, platform))
  ].filter((adapter, index, all) => adapter && all.findIndex(candidate => candidate?.id === adapter.id) === index);
  for (const adapter of candidates) {
    const destination = getBundledVoiceServerJarPath(paths, adapter);
    const [artifact, installed] = await Promise.all([
      findBundledVoiceServerArtifact(adapter),
      inspectInstalledBundledVoice(destination)
    ]);
    if (!installed) continue;
    const classification = classifyBundledVoiceInstall({ artifact, installed, record: metadata.voice, adapter });
    if (!classification.managed) {
      if (config?.localOnly !== true && metadata.voice?.localOnlyOverrideActive !== true) continue;
      throw new Error(
        `Local-only mode cannot verify ${adapter.managedFile}, so its UDP listener cannot be safely rebound. ` +
        'Remove the conflicting file or reinstall the managed Proximity Voice component before starting.'
      );
    }
    const runtimePaths = getBundledVoiceRuntimePaths(paths, adapter);
    const original = await readBundledVoiceConfigForLocalOnly(runtimePaths.config);
    const overrideActive = metadata.voice?.localOnlyOverrideActive === true;
    if (config?.localOnly !== true && !overrideActive) return { active: false };
    const previousBindAddress = overrideActive
      ? metadata.voice.previousBindAddress
      : String(getBundledVoiceConfigScalar(original, runtimePaths.configFormat, 'bindAddress') || '');
    const previousPublicHost = overrideActive
      ? metadata.voice.previousPublicHost
      : String(getBundledVoiceConfigScalar(original, runtimePaths.configFormat, 'publicHost') || '');
    const rendered = config?.localOnly === true
      ? renderBundledVoiceNetworkConfig(original, runtimePaths.configFormat, LOCAL_ONLY_BIND_IP, '')
      : renderBundledVoiceNetworkConfig(
          original,
          runtimePaths.configFormat,
          previousBindAddress,
          previousPublicHost
        );
    await writeBundledVoiceConfigForLocalOnly(runtimePaths.config, rendered);
    const voiceRecord = metadata.voice || {
      name: BUNDLED_VOICE_NAME,
      adapterId: adapter.id,
      kind: adapter.kind,
      minecraftVersion: adapter.minecraftVersion,
      file: adapter.managedFile,
      sha256: installed.sha256,
      size: installed.size,
      installedAt: '',
      dependencyFile: '',
      dependencyProvisioned: false
    };
    await writeServerToolsMetadata(paths, {
      ...metadata,
      voice: {
        ...voiceRecord,
        localOnlyOverrideActive: config?.localOnly === true,
        previousBindAddress: config?.localOnly === true ? previousBindAddress : '',
        previousPublicHost: config?.localOnly === true ? previousPublicHost : ''
      }
    });
    if (config?.localOnly !== true) {
      appendServerLog('[Server Manager SRV-VOICE-LOCAL-000] Proximity Voice network settings restored after local-only mode.\n');
      return { active: false, restored: true, adapterId: adapter.id, configFile: runtimePaths.config };
    }
    appendServerLog(
      '[Server Manager SRV-VOICE-LOCAL-200] Proximity Voice prepared for local-only mode.\n' +
      `  Voice UDP bind on next start: ${LOCAL_ONLY_BIND_IP}:${await readBundledVoiceUdpPort(paths, null, adapter)}\n` +
      '  Public voice host: disabled\n'
    );
    return { active: true, adapterId: adapter.id, configFile: runtimePaths.config };
  }
  return { active: false };
}

async function findSimpleVoiceChatProviders(paths, config) {
  const kind = getSimpleVoiceChatKind(config.serverType);
  if (!kind) return { kind: '', configFile: '', providers: [], provider: null, complete: true, warning: '' };
  const directory = kind === 'mods' ? paths.mods : paths.plugins;
  const [index, listing] = await Promise.all([
    kind === 'mods' ? getModDescriptorIndex(paths) : getPluginDescriptorIndex(paths),
    enumerateJarFilesBounded(directory, MAX_ADDON_FILE_ENTRIES)
  ]);
  const indexedByName = new Map(index.files.map((file) => [String(file.name || '').toLowerCase(), file]));
  const providers = [];
  for (const file of listing.files) {
    const indexed = indexedByName.get(String(file.name || '').toLowerCase());
    let descriptor = indexed?.descriptor || null;
    let identity = detectSimpleVoiceChatIdentity(descriptor, file.name);
    // Descriptor indexing is deliberately budgeted. If a normal SVC filename
    // fell outside that budget, inspect that one JAR directly before deciding;
    // do not trust a filename when a parsed descriptor says it is something else.
    if (!descriptor && identity.matches) {
      try {
        descriptor = await inspectJarDescriptor(file.path);
        identity = detectSimpleVoiceChatIdentity(descriptor, file.name);
      } catch {
        identity = { matches: false, source: '', identity: '', fileName: file.name };
      }
    }
    if (!identity.matches) continue;
    providers.push({
      kind,
      file: file.name,
      path: file.path,
      identitySource: identity.source,
      descriptor
    });
  }
  const uniqueProviders = [...new Map(providers.map(provider => [provider.file.toLowerCase(), provider])).values()];
  if (uniqueProviders.length > 1) {
    throw new Error(`Multiple Simple Voice Chat ${kind === 'mods' ? 'mods' : 'plugins'} are installed (${uniqueProviders.map(provider => provider.file).join(', ')}). Keep only one copy before starting the server.`);
  }

  if (uniqueProviders.length) {
    const adapter = getBundledVoiceAdapter(config.serverType, config.serverVersion);
    if (adapter) {
      const bundledPath = getBundledVoiceServerJarPath(paths, adapter);
      const bundled = await inspectInstalledBundledVoice(bundledPath);
      if (bundled && inspectionMatchesBundledVoiceAdapter(bundled, adapter)) {
        throw new Error('Simple Voice Chat and the built-in Proximity Voice server are both installed. Remove one voice provider before starting the server.');
      }
    }
  }

  const complete = !index.partial && !listing.partial && !listing.directoryError;
  const scanWarning = [
    index.warning,
    listing.directoryError,
    listing.partial ? `Add-on directory scan was incomplete${listing.partialReasons?.length ? ` (${listing.partialReasons.join('; ')})` : ''}.` : ''
  ].filter(Boolean).join(' ').slice(0, 512);
  return {
    kind,
    configFile: getSimpleVoiceChatConfigPath(paths, kind),
    providers: uniqueProviders,
    provider: uniqueProviders[0] || null,
    complete,
    warning: scanWarning
  };
}

async function probeUdpAddress(port, address, optionalFamily = false) {
  const socketType = net.isIP(address) === 6 ? 'udp6' : 'udp4';
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: socketType, reuseAddr: false });
    let settled = false;
    const finish = (available, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(available);
    };
    const timer = setTimeout(() => finish(false), 1_500);
    timer.unref?.();
    socket.once('error', (error) => {
      if (optionalFamily && ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPROTONOSUPPORT', 'ENODEV'].includes(error?.code)) finish(true);
      else if (['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'].includes(error?.code)) finish(false);
      else finish(false, error);
    });
    socket.once('listening', () => finish(true));
    try {
      socket.bind({ address, port, exclusive: true });
    } catch (error) {
      finish(false, error);
    }
  });
}

async function isUdpPortAvailable(port, bindAddress = '') {
  const requested = String(bindAddress || '').trim();
  if (requested === '*' || !net.isIP(requested)) {
    if (!await probeUdpAddress(port, '0.0.0.0')) return false;
    return probeUdpAddress(port, '::', true);
  }
  return probeUdpAddress(port, requested);
}

async function readLegacyVoicePortForProfile(profile, config) {
  const explicit = normalizeOptionalUdpPort(config.voiceUdpPort);
  if (explicit) return explicit;
  const paths = getPathsForProfile(profile);
  for (const file of [paths.simpleVoiceModConfig, paths.simpleVoicePluginConfig]) {
    try {
      const value = normalizeOptionalUdpPort(getJavaProperty(await readSimpleVoiceChatProperties(file), 'port'));
      if (value) return value;
    } catch {}
  }
  return 0;
}

async function readConfiguredQueryPort(paths, config) {
  if (!config.enableQuery) return 0;
  try {
    const stat = await fs.lstat(paths.serverProperties);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROPERTIES_BYTES) {
      return Number(config.port) || DEFAULT_CONFIG.port;
    }
    const properties = await fs.readFile(paths.serverProperties, 'utf8');
    return normalizeOptionalUdpPort(getJavaProperty(properties, 'query.port')) ||
      Number(config.port) || DEFAULT_CONFIG.port;
  } catch {
    return Number(config.port) || DEFAULT_CONFIG.port;
  }
}

async function readConfiguredRconPort(paths, config) {
  if (config.localOnly || !config.enableRcon) return 0;
  try {
    const stat = await fs.lstat(paths.serverProperties);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROPERTIES_BYTES) return 25_575;
    const properties = await fs.readFile(paths.serverProperties, 'utf8');
    return normalizeOptionalUdpPort(getJavaProperty(properties, 'rcon.port')) || 25_575;
  } catch {
    return 25_575;
  }
}

async function getVoicePortReservations(activeProfileId) {
  const state = await readProfilesState();
  const reservedVoicePorts = new Set();
  const forbiddenPorts = new Set();
  let activeQueryPort = 0;
  for (const profile of state.profiles) {
    const paths = getPathsForProfile(profile);
    const config = normalizeServerConfig(await readJson(paths.config, DEFAULT_CONFIG));
    if (profile.id !== activeProfileId) {
      const voicePort = await readLegacyVoicePortForProfile(profile, config);
      if (voicePort) reservedVoicePorts.add(voicePort);
    }
    if (profile.id === activeProfileId) forbiddenPorts.add(Number(config.port) || DEFAULT_CONFIG.port);
    const queryPort = await readConfiguredQueryPort(paths, config);
    if (queryPort) forbiddenPorts.add(queryPort);
    if (profile.id === activeProfileId) activeQueryPort = queryPort;
  }
  return { reservedVoicePorts, forbiddenPorts, activeQueryPort };
}

async function allocateSimpleVoiceUdpPort(profile, config, existingPort = 0, bindAddress = '*') {
  const reservations = await getVoicePortReservations(profile.id);
  const preferredPort = normalizeOptionalUdpPort(config.voiceUdpPort) ||
    normalizeOptionalUdpPort(existingPort) || DEFAULT_VOICE_UDP_PORT;
  const rangeStart = DEFAULT_VOICE_UDP_PORT;
  const rangeEnd = Math.min(65_535, DEFAULT_VOICE_UDP_PORT + MAX_VOICE_PORT_SCAN - 1);
  const excluded = new Set([
    ...reservations.reservedVoicePorts,
    ...reservations.forbiddenPorts,
    Number(config.port) || DEFAULT_CONFIG.port,
    config.enableQuery ? Number(config.port) || DEFAULT_CONFIG.port : 0
  ].filter(Boolean));
  // Existing/manual SVC ports are valid across the full UDP port range. Keep
  // one when it is still safe instead of silently migrating a working custom
  // forward just because it sits outside our automatic allocation window.
  if ((preferredPort < rangeStart || preferredPort > rangeEnd) &&
      !excluded.has(preferredPort) && await isUdpPortAvailable(preferredPort, bindAddress)) {
    return preferredPort;
  }
  return selectAvailableUdpPort({
    preferredPort,
    rangeStart,
    rangeEnd,
    reservedPorts: reservations.reservedVoicePorts,
    forbiddenPorts: reservations.forbiddenPorts,
    minecraftPort: config.port,
    queryPort: reservations.activeQueryPort || null,
    // Probe the same interface scope that Simple Voice Chat will actually use.
    // A specific Minecraft TCP bind address must not hide a UDP collision on
    // another interface when voice chat is configured for wildcard binding.
    isAvailable: port => isUdpPortAvailable(port, bindAddress)
  });
}

function resolveManagedSimpleVoiceHost({ config, existingVoiceHost, existingPort = 0, metadata, udpPort, network }) {
  if (config?.localOnly === true) {
    return {
      voiceHost: String(udpPort),
      source: 'local-only',
      managed: true,
      warning: ''
    };
  }
  const previousManaged = metadata.voiceHostManaged === true &&
    String(existingVoiceHost || '') === String(metadata.managedVoiceHost || '');
  const existing = String(existingVoiceHost || '').trim();
  const legacyPortOnly = Boolean(
    normalizeOptionalUdpPort(existing) &&
    normalizeOptionalUdpPort(existing) === normalizeOptionalUdpPort(existingPort)
  );
  const minecraftEndpoint = buildPublicJoinAddress(config);
  const managedPlayitEndpoint = playitProcess && !playitProcess.killed ? playitState.address : '';
  const normalizeEndpointForComparison = (value) => {
    const endpoint = parseExternalHostPort(value);
    return endpoint ? formatExternalHostPort(endpoint).toLowerCase() : String(value || '').trim().toLowerCase();
  };
  const existingEndpoint = normalizeEndpointForComparison(existing);
  const unsafeExistingPlayitTcp = Boolean(existing && isKnownPlayitTcpEndpoint(existing) &&
    [minecraftEndpoint, managedPlayitEndpoint].some(candidate =>
      candidate && normalizeEndpointForComparison(candidate) === existingEndpoint
    ));
  if (existing && !previousManaged && !legacyPortOnly && !unsafeExistingPlayitTcp && !String(config.voicePublicAddress || '').trim()) {
    return { voiceHost: existing, source: 'existing-user-override', managed: false, warning: '' };
  }

  const explicit = String(config.voicePublicAddress || '').trim();
  if (explicit) {
    const endpoint = parseExternalHostPort(explicit, udpPort);
    if (!endpoint) {
      throw new Error('The configured Simple Voice Chat public UDP address is invalid. Use a hostname or IP with an optional UDP port.');
    }
    return { voiceHost: formatExternalHostPort(endpoint), source: 'configured-udp-endpoint', managed: true, warning: '' };
  }

  const tcpUsesPlayit = unsafeExistingPlayitTcp || isKnownPlayitTcpEndpoint(minecraftEndpoint) ||
    isKnownPlayitTcpEndpoint(managedPlayitEndpoint);
  if (tcpUsesPlayit) {
    if (network.mapped && network.publicRouteConfirmed && network.publicIp && !network.upstreamNatLikely) {
      return {
        voiceHost: formatExternalHostPort(network.publicIp, udpPort),
        source: 'direct-udp-beside-playit-tcp',
        managed: true,
        warning: ''
      };
    }
    return {
      voiceHost: '',
      source: 'playit-tcp-without-udp-route',
      managed: true,
      warning: network.upstreamNatLikely
        ? 'The router accepted the voice UDP mapping, but an upstream NAT or CGNAT address mismatch means that route is not externally reachable. A separate UDP tunnel endpoint is required.'
        : network.mapped && !network.publicRouteConfirmed
          ? 'The router accepted the voice UDP mapping, but its public route could not be confirmed. The Minecraft Playit address is TCP-only, so a separate UDP tunnel endpoint is required.'
          : 'The Minecraft Playit address is TCP-only and cannot carry voice UDP. Automatic router mapping did not produce a reachable UDP endpoint.'
    };
  }

  return {
    voiceHost: String(udpPort),
    source: 'minecraft-connection-host',
    managed: true,
    warning: network.publicRouteConfirmed
      ? ''
      : minecraftEndpoint
        ? 'Voice chat is using the Minecraft join host, but no public UDP route was confirmed. TCP-only tunnels and reverse proxies need a separate Voice UDP address.'
        : 'The voice port is configured locally, but no public UDP route was confirmed.'
  };
}

async function prepareSimpleVoiceNetworkForStartup({ profile, paths, config }) {
  const previousMetadata = await readVoiceNetworkMetadata(paths);
  let discovery = await findSimpleVoiceChatProviders(paths, config);
  if (!discovery.provider && !discovery.complete && previousMetadata.provider.type === 'simple-voice-chat' &&
      previousMetadata.provider.kind === discovery.kind && previousMetadata.provider.file) {
    const providerDirectory = discovery.kind === 'mods' ? paths.mods : paths.plugins;
    try {
      const providerPath = resolveContainedPath(providerDirectory, path.join(providerDirectory, previousMetadata.provider.file));
      if (await isRegularFile(providerPath)) {
        const descriptor = await inspectJarDescriptor(providerPath);
        const identity = detectSimpleVoiceChatIdentity(descriptor, previousMetadata.provider.file);
        if (identity.matches) {
          const provider = {
            kind: discovery.kind,
            file: previousMetadata.provider.file,
            path: providerPath,
            identitySource: identity.source,
            descriptor
          };
          discovery = { ...discovery, providers: [provider], provider };
        }
      }
    } catch {}
  }
  if (config.localOnly && !discovery.complete) {
    throw new Error(
      'Local-only mode could not completely inspect the voice add-on directory, so a wildcard UDP listener cannot be ruled out. ' +
      `${discovery.warning || 'Check the add-on directory and try again.'}`
    );
  }
  if (!discovery.provider) {
    if (previousMetadata.provider.type !== 'simple-voice-chat') {
      return { config, active: false, metadata: previousMetadata };
    }
    if (!discovery.complete) {
      appendServerLog(
        '[Server Manager SRV-VOICE-305] Simple Voice Chat discovery was incomplete; existing UDP access was preserved.\n' +
        `  Warning: ${discovery.warning || 'The add-on directory could not be scanned completely.'}\n`
      );
      return { config, active: false, metadata: previousMetadata };
    }
    const cleanupErrors = [];
    try {
      await unmapManagedVoiceUdp(previousMetadata.udpPort || config.voiceUdpPort, profile.id);
    } catch (error) {
      cleanupErrors.push(`router mapping: ${error.message || String(error)}`);
    }
    const firewall = await cleanupProfileFirewallRules({ profileId: profile.id, profileName: profile.name });
    if (firewall.supported && !firewall.ok) {
      cleanupErrors.push(`Windows Firewall: ${firewall.message || firewall.code}`);
    }
    const nextConfig = cleanupErrors.length || !config.voiceUdpPort
      ? config
      : await writeConfig({ ...config, voiceUdpPort: 0 }, paths);
    const metadata = await writeVoiceNetworkMetadata(paths, cleanupErrors.length
      ? {
          ...previousMetadata,
          warning: `Managed voice-network cleanup is pending: ${cleanupErrors.join(' · ')}`.slice(0, 512),
          updatedAt: new Date().toISOString()
        }
      : { updatedAt: new Date().toISOString() });
    appendServerLog(
      `[Server Manager ${cleanupErrors.length ? 'SRV-VOICE-304' : 'SRV-VOICE-204'}] ` +
      `Simple Voice Chat is no longer installed; managed UDP access was ${cleanupErrors.length ? 'partially cleaned' : 'cleaned'}.` +
      (cleanupErrors.length ? ` ${cleanupErrors.join(' · ')}` : '') + '\n'
    );
    return { config: nextConfig, active: false, metadata };
  }

  const original = await readSimpleVoiceChatProperties(discovery.configFile);
  const existingPort = normalizeOptionalUdpPort(getJavaProperty(original, 'port')) || 0;
  const configuredBindAddress = String(getJavaProperty(original, 'bind_address') ?? '').trim();
  const resolvedBind = resolveSimpleVoiceBindAddress(configuredBindAddress, config.localOnly === true);
  const bindAddress = resolvedBind.bindAddress;
  const udpPort = await allocateSimpleVoiceUdpPort(profile, config, existingPort, bindAddress);
  const nextConfig = config.voiceUdpPort === udpPort ? config : await writeConfig({ ...config, voiceUdpPort: udpPort }, paths);

  const initial = await writeSimpleVoiceChatProperties(discovery.configFile, original, {
    port: udpPort,
    bind_address: bindAddress,
    voice_host: String(getJavaProperty(original, 'voice_host') ?? '')
  });

  let mapping = { attempted: false, mapped: false, port: udpPort, error: '' };
  if (nextConfig.localOnly) {
    try {
      await unmapManagedVoiceUdp(udpPort, profile.id);
    } catch (error) {
      appendServerLog(`[Server Manager SRV-VOICE-303] Local-only voice UDP mapping cleanup failed: ${error.message || String(error)}\n`);
    }
  } else if (String(nextConfig.voicePublicAddress || '').trim()) {
    try {
      await unmapManagedVoiceUdp(udpPort, profile.id);
    } catch (error) {
      appendServerLog(`[Server Manager SRV-VOICE-303] Old automatic voice UDP mapping cleanup failed: ${error.message || String(error)}\n`);
    }
  } else {
    try {
      mapping = await mapManagedVoiceUdpForDirectHosting(udpPort, { forceVoiceOnly: true, profileOverride: profile });
    } catch (error) {
      mapping = { attempted: true, mapped: false, port: udpPort, error: String(error?.message || error || 'Automatic UDP mapping failed.') };
    }
  }
  const publicIp = mapping.mapped || mapping.requestedMapped
    ? String(mapping.publicIp || directHostingState.publicIp || await getPublicIp() || '')
    : '';
  const network = {
    attempted: Boolean(mapping.attempted),
    mapped: Boolean(mapping.requestedMapped || mapping.mapped),
    publicRouteConfirmed: mapping.publicRouteConfirmed === true,
    port: udpPort,
    publicIp,
    gatewayPublicIp: String(mapping.gatewayPublicIp || ''),
    upstreamNatLikely: mapping.upstreamNatLikely === true,
    error: String(mapping.error || '')
  };

  const firewallResult = nextConfig.localOnly
    ? await cleanupProfileFirewallRules({ profileId: profile.id, profileName: profile.name })
    : await ensureInboundUdpRule({
        profileId: profile.id,
        profileName: profile.name,
        port: udpPort
      });
  const firewall = {
    attempted: firewallResult.supported === true,
    configured: firewallResult.ok === true || firewallResult.supported === false,
    ruleName: nextConfig.localOnly ? '' : firewallResult.ruleName || '',
    error: firewallResult.ok || firewallResult.supported === false ? '' : firewallResult.message || firewallResult.code || 'Windows Firewall rule failed.'
  };

  const existingVoiceHost = String(getJavaProperty(initial, 'voice_host') ?? '').trim();
  const voice = resolveManagedSimpleVoiceHost({
    config: nextConfig,
    existingVoiceHost,
    existingPort,
    metadata: previousMetadata,
    udpPort,
    network
  });
  await writeSimpleVoiceChatProperties(discovery.configFile, initial, {
    port: udpPort,
    bind_address: bindAddress,
    voice_host: voice.voiceHost
  });

  const relativeConfig = path.relative(paths.root, discovery.configFile);
  const upstreamNatWarning = network.upstreamNatLikely
    ? 'The router UDP mapping stops at an upstream NAT/CGNAT boundary and is not a confirmed internet route.'
    : '';
  const unconfirmedRouteWarning = network.mapped && !network.publicRouteConfirmed && !network.upstreamNatLikely
    ? 'The local router accepted the UDP mapping, but its external address could not be verified, so internet reachability is unconfirmed.'
    : '';
  const warning = [voice.warning, resolvedBind.warning, upstreamNatWarning, unconfirmedRouteWarning, discovery.warning, network.error, firewall.error].filter(Boolean).join(' ').slice(0, 512);
  const metadata = await writeVoiceNetworkMetadata(paths, {
    provider: {
      type: 'simple-voice-chat',
      kind: discovery.provider.kind,
      file: discovery.provider.file,
      identitySource: discovery.provider.identitySource
    },
    udpPort,
    configFile: relativeConfig,
    bindAddress,
    managedVoiceHost: voice.managed ? voice.voiceHost : '',
    voiceHostSource: voice.source,
    voiceHostManaged: voice.managed,
    advertisedEndpoint: voice.voiceHost,
    network,
    firewall,
    warning,
    updatedAt: new Date().toISOString()
  });

  appendServerLog(
    '[Server Manager SRV-VOICE-200] Simple Voice Chat network prepared.\n' +
    `  Minecraft TCP: ${nextConfig.bindIp || '0.0.0.0'}:${Number(nextConfig.port) || DEFAULT_CONFIG.port}\n` +
    `  Voice UDP: ${bindAddress || nextConfig.bindIp || '0.0.0.0'}:${udpPort}\n` +
    `  Voice config: ${relativeConfig}\n` +
    `  Client endpoint: ${voice.voiceHost || 'Minecraft join host (no separate public UDP endpoint confirmed)'}\n` +
    `  Router UDP mapping: ${network.mapped ? network.upstreamNatLikely ? 'gateway mapped, but upstream NAT/CGNAT blocks a confirmed public route' : network.publicRouteConfirmed ? 'mapped and public route confirmed' : 'gateway mapped, public route unconfirmed' : network.attempted ? `failed (${network.error || 'router rejected the mapping'})` : 'not attempted'}\n` +
    `  Windows firewall: ${firewall.configured ? 'ready' : firewall.attempted ? `not changed (${firewall.error || 'permission denied'})` : 'not applicable'}\n` +
    (warning ? `  Warning: ${warning}\n` : '')
  );
  return { config: nextConfig, active: true, metadata };
}

async function verifySimpleVoiceUdpListenerAfterStartup({ paths, metadata, generation, processRef }) {
  const udpPort = normalizeOptionalUdpPort(metadata?.udpPort);
  if (!udpPort) return;
  const bindAddress = String(metadata?.bindAddress || '*');
  const lifecycleIsCurrent = () =>
    serverProcess === processRef && serverLifecycleGeneration === generation && serverState === 'running';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      timer.unref?.();
    });
    if (!lifecycleIsCurrent()) return;
    const portAvailable = await isUdpPortAvailable(udpPort, bindAddress);
    if (!lifecycleIsCurrent()) return;
    if (!portAvailable) {
      appendServerLog(
        '[Server Manager SRV-VOICE-201] Simple Voice Chat UDP listener detected.\n' +
        `  Voice UDP: ${bindAddress}:${udpPort}\n`
      );
      return;
    }
  }
  const listenerWarning = `Simple Voice Chat did not bind UDP ${udpPort} after Minecraft became ready. Check the server console for a mod/plugin compatibility or startup error.`;
  const latest = await readVoiceNetworkMetadata(paths);
  if (!lifecycleIsCurrent()) return;
  const warning = [latest.warning, listenerWarning]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(' ')
    .slice(0, 512);
  await writeVoiceNetworkMetadata(paths, { ...latest, warning, updatedAt: new Date().toISOString() });
  if (!lifecycleIsCurrent()) return;
  appendServerLog(
    '[Server Manager SRV-VOICE-401] Simple Voice Chat UDP listener was not detected.\n' +
    `  Expected UDP: ${bindAddress}:${udpPort}\n` +
    `  Meaning: ${listenerWarning}\n`
  );
}

async function getManagedVoiceUdpPortForMapping(profileOverride = null) {
  try {
    const profile = profileOverride || await getActiveProfile();
    const paths = getPathsForProfile(profile);
    const [config, metadata] = await Promise.all([readConfig(paths), readServerToolsMetadata(paths)]);
    const simpleVoice = await findSimpleVoiceChatProviders(paths, config);
    if (simpleVoice.provider) {
      const properties = await readSimpleVoiceChatProperties(simpleVoice.configFile);
      return normalizeOptionalUdpPort(config.voiceUdpPort) ||
        normalizeOptionalUdpPort(getJavaProperty(properties, 'port')) ||
        DEFAULT_VOICE_UDP_PORT;
    }
    const platform = await getServerPlatformStatus(config, paths);
    const adapter = getBundledVoiceAdapterById(metadata.voice?.adapterId || '') ||
      getBundledVoiceAdapter(config.serverType, getBundledVoiceMinecraftVersion(config, platform));
    if (!adapter) return 0;
    const [artifact, installed, runtime] = await Promise.all([
      findBundledVoiceServerArtifact(adapter),
      inspectInstalledBundledVoice(getBundledVoiceServerJarPath(paths, adapter)),
      readBundledVoiceRuntimeStatus(paths, adapter)
    ]);
    const classification = classifyBundledVoiceInstall({ artifact, installed, record: metadata.voice, adapter });
    if (!classification.managed) return 0;
    return readBundledVoiceUdpPort(paths, runtime, adapter);
  } catch {
    return 0;
  }
}

function ensureNatClient() {
  if (natShutdownStarted) throw new Error('Router mapping is shutting down.');
  if (!natClient) natClient = new NatAPI({ ttl: 3600, autoUpdate: true, enablePMP: true });
  return natClient;
}

async function releaseOwnedNatLeaseUnlocked(kind, profileId) {
  const lease = getOwnedNatLease(directHostingState, kind, profileId);
  if (!lease) return { attempted: false, released: false, kind, profileId, port: 0, error: '' };
  const client = natClient;
  if (!client) {
    clearOwnedNatLease(directHostingState, kind, profileId);
    if (kind === 'voice') directHostingState.voiceMappingError = '';
    return { attempted: false, released: true, kind, profileId, port: lease.port, error: '' };
  }
  const protocol = kind === 'voice' ? 'UDP' : 'TCP';
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await natUnmap(client, { publicPort: lease.port, privatePort: lease.port, protocol });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (lastError) {
    const message = String(lastError?.message || lastError || 'Router unmapping failed.');
    if (kind === 'voice' && directHostingState.profileId === profileId) directHostingState.voiceMappingError = message;
    const label = kind === 'voice' ? `Minecraft voice UDP ${lease.port}` : `Minecraft TCP ${lease.port}`;
    throw new Error(`Could not remove ${label} mapping: ${message}`);
  }
  clearOwnedNatLease(directHostingState, kind, profileId);
  if (kind === 'voice') directHostingState.voiceMappingError = '';
  return { attempted: true, released: true, kind, profileId, port: lease.port, error: '' };
}

async function cleanupOwnedNatMappingsForProfileUnlocked(profileId) {
  const owner = String(profileId || '');
  if (!owner) return { profileId: '', failures: [] };
  const failures = [];
  for (const kind of ['voice', 'tcp']) {
    try {
      await releaseOwnedNatLeaseUnlocked(kind, owner);
    } catch (error) {
      failures.push(String(error?.message || error || `${kind} mapping cleanup failed.`));
    }
  }
  return { profileId: owner, failures };
}

async function transitionNatMappingsToProfile(profileId, deletedProfileId = '') {
  const targetProfileId = String(profileId || '');
  return runNatMappingMutation(async () => {
    const failures = [];
    const owners = new Set(getNatLeaseOwners(directHostingState));
    if (deletedProfileId) owners.add(String(deletedProfileId));
    for (const owner of owners) {
      if (!owner || owner === targetProfileId) continue;
      const result = await cleanupOwnedNatMappingsForProfileUnlocked(owner);
      failures.push(...result.failures);
    }
    if (deletedProfileId && deletedProfileId === targetProfileId) {
      const result = await cleanupOwnedNatMappingsForProfileUnlocked(deletedProfileId);
      failures.push(...result.failures);
    }
    if (!failures.length) directHostingState = scopeDirectHostingState(directHostingState, targetProfileId);
    for (const failure of failures) appendServerLog(`[Server Manager] ${failure}\n`);
    return { profileId: targetProfileId, failures };
  });
}

async function unmapManagedVoiceUdpUnlocked(port, profileId) {
  const requestedPort = Number(port) || 0;
  const lease = getOwnedNatLease(directHostingState, 'voice', profileId);
  if (!lease) {
    return {
      attempted: false,
      mapped: false,
      port: requestedPort,
      error: '',
      ignoredForeignLease: Boolean(getNatLease(directHostingState, 'voice'))
    };
  }
  const result = await releaseOwnedNatLeaseUnlocked('voice', profileId);
  return { attempted: result.attempted, mapped: false, port: result.port, error: '' };
}

async function reconcileManagedVoiceUdpMapping(port, profileId) {
  const udpPort = Number(port) || DEFAULT_VOICE_UDP_PORT;
  const previous = getNatLease(directHostingState, 'voice');
  if (previous && (previous.profileId !== profileId || previous.port !== udpPort)) {
    try {
      await releaseOwnedNatLeaseUnlocked('voice', previous.profileId);
    } catch (error) {
      const message = String(error?.message || error || 'The previous UDP mapping could not be removed.');
      return {
        attempted: true,
        mapped: false,
        port: previous.port,
        requestedPort: udpPort,
        requestedMapped: false,
        error: message
      };
    }
  }
  try {
    await natMap(ensureNatClient(), {
      publicPort: udpPort,
      privatePort: udpPort,
      protocol: 'UDP',
      ttl: 3600,
      description: 'Minecraft Voice Chat'
    });
    // Reissue the mapping even when our in-memory lease already matches. A
    // router reboot or network change can drop its lease while the app stays
    // open; refreshing it here repairs that state on every server start.
    claimNatLease(directHostingState, 'voice', profileId, udpPort);
    directHostingState.voiceMappingError = '';
    return { attempted: true, mapped: true, port: udpPort, requestedPort: udpPort, requestedMapped: true, error: '' };
  } catch (error) {
    const message = String(error?.message || error || 'UDP mapping failed.');
    if (directHostingState.profileId === profileId) directHostingState.voiceMappingError = message;
    return { attempted: true, mapped: false, port: udpPort, requestedPort: udpPort, requestedMapped: false, error: message };
  }
}

async function mapManagedVoiceUdpForDirectHosting(port, options = {}) {
  const profile = options.profileOverride || await getActiveProfile();
  const profileId = String(profile?.id || '');
  return runNatMappingMutation(async () => {
    const config = normalizeServerConfig(await readJson(getPathsForProfile(profile).config, DEFAULT_CONFIG));
    const udpPort = Number(port) || DEFAULT_VOICE_UDP_PORT;
    if (config.localOnly) {
      const failures = [];
      for (const owner of getNatLeaseOwners(directHostingState)) {
        const cleanup = await cleanupOwnedNatMappingsForProfileUnlocked(owner);
        failures.push(...cleanup.failures);
      }
      if (!failures.length) directHostingState = scopeDirectHostingState(directHostingState, profileId);
      return {
        attempted: false,
        mapped: getNatLeaseOwners(directHostingState).length > 0,
        port: udpPort,
        requestedPort: udpPort,
        requestedMapped: false,
        publicIp: '',
        error: failures.join(' · ')
      };
    }
    if (!config.directHostingEnabled && options.forceVoiceOnly !== true) {
      return { attempted: false, mapped: false, port: udpPort, requestedPort: udpPort, requestedMapped: false, publicIp: '', error: '' };
    }
    const transitionFailures = [];
    for (const owner of getNatLeaseOwners(directHostingState)) {
      if (owner === profileId) continue;
      const cleanup = await cleanupOwnedNatMappingsForProfileUnlocked(owner);
      transitionFailures.push(...cleanup.failures);
    }
    if (transitionFailures.length) {
      throw new Error(`Old voice/router mappings could not be removed safely: ${transitionFailures.join(' · ')}`);
    }
    directHostingState = scopeDirectHostingState(directHostingState, profileId);
    const result = await reconcileManagedVoiceUdpMapping(udpPort, profileId);
    let publicIp = '';
    let gatewayPublicIp = '';
    let upstreamNatLikely = false;
    let publicRouteConfirmed = false;
    if (result.requestedMapped || result.mapped) {
      gatewayPublicIp = String(await natExternalIp(ensureNatClient()).catch(() => '') || '').trim();
      const internetPublicIp = String(await getPublicIp().catch(() => '') || '').trim();
      const route = resolveMappedUdpPublicRoute(gatewayPublicIp, internetPublicIp);
      publicIp = route.publicIp;
      upstreamNatLikely = route.upstreamNatLikely;
      publicRouteConfirmed = route.publicRouteConfirmed;
      directHostingState = { ...directHostingState, profileId, publicIp };
    }
    return { ...result, publicIp, gatewayPublicIp, upstreamNatLikely, publicRouteConfirmed };
  });
}

async function unmapManagedVoiceUdp(port, profileIdOverride = '') {
  const profileId = String(profileIdOverride || (await getActiveProfile())?.id || '');
  return runNatMappingMutation(() => unmapManagedVoiceUdpUnlocked(port, profileId));
}

function enableDirectHosting() {
  return serverToolMutationCoordinator.run('direct-hosting:enable', () => runNatMappingMutation(enableDirectHostingUnlocked));
}

function refreshDirectHostingForLifecycle(context) {
  if (!isCurrentServerLifecycleContext(context)) return Promise.resolve({ canceled: true });
  return runNatMappingMutation(async () => {
    if (!await revalidateServerLifecycleContext(context)) return { canceled: true };
    return enableDirectHostingUnlocked();
  });
}

async function enableDirectHostingUnlocked() {
  const profile = await getActiveProfile();
  const profileId = String(profile?.id || '');
  const config = await readConfig();
  if (config.localOnly) {
    throw new Error('Direct hosting is disabled in local-only mode. Disable local-only mode while the server is stopped first.');
  }
  const transitionFailures = [];
  for (const owner of getNatLeaseOwners(directHostingState)) {
    if (owner === profileId) continue;
    const cleanup = await cleanupOwnedNatMappingsForProfileUnlocked(owner);
    transitionFailures.push(...cleanup.failures);
  }
  if (transitionFailures.length) {
    throw new Error(`Old router mappings could not be removed safely: ${transitionFailures.join(' · ')}`);
  }
  directHostingState = scopeDirectHostingState(directHostingState, profileId);
  const port = Number(config.port) || 25565;
  const existingTcp = getOwnedNatLease(directHostingState, 'tcp', profileId);
  if (existingTcp && existingTcp.port !== port) {
    await releaseOwnedNatLeaseUnlocked('tcp', profileId);
  }
  try {
    await natMap(ensureNatClient(), {
      publicPort: port,
      privatePort: port,
      protocol: 'TCP',
      ttl: 3600,
      description: 'Minecraft Server'
    });
    claimNatLease(directHostingState, 'tcp', profileId, port);
    const voicePort = await getManagedVoiceUdpPortForMapping(profile);
    let voiceResult = { mapped: false, port: 0, requestedMapped: false, error: '' };
    if (voicePort) {
      voiceResult = await reconcileManagedVoiceUdpMapping(voicePort, profileId);
    } else if (getOwnedNatLease(directHostingState, 'voice', profileId)) {
      try {
        await unmapManagedVoiceUdpUnlocked(0, profileId);
      } catch (error) {
        voiceResult = {
          mapped: false,
          port: 0,
          requestedMapped: false,
          error: String(error?.message || error || 'UDP unmapping failed.')
        };
      }
    }
    const publicIp = (await natExternalIp(ensureNatClient()).catch(() => getPublicIp())) || (await getPublicIp());
    const publicAddress = publicIp ? `${publicIp}:${port}` : '';
    if (publicAddress) {
      await writeConfig({ ...config, publicAddress, directHostingEnabled: true });
    } else {
      await writeConfig({ ...config, directHostingEnabled: true });
    }
    directHostingState = {
      ...directHostingState,
      profileId,
      publicIp,
      publicAddress,
      voiceMappingError: String(voiceResult.error || ''),
      message: (publicAddress
        ? `Router port ${port} is mapped. Use ${publicAddress}.`
        : `Router port ${port} is mapped, but public IP could not be detected.`) +
        (voicePort
          ? voiceResult.requestedMapped
            ? ` Voice chat UDP ${voicePort} is mapped too.`
            : ` Voice chat still needs UDP ${voicePort} reachability; ${voiceResult.error || 'automatic UDP mapping failed.'}`
          : '')
    };
    appendServerLog(`[Server Manager] ${directHostingState.message}\n`);
    return directHostingState;
  } catch (error) {
    directHostingState = {
      ...scopeDirectHostingState(directHostingState, profileId),
      profileId,
      publicIp: await getPublicIp(),
      publicAddress: '',
      message: `Automatic router port mapping failed: ${error.message || String(error)}`
    };
    appendServerLog(`[Server Manager] ${directHostingState.message}\n`);
    throw new Error(`${directHostingState.message}. Enable UPnP on your router or forward TCP ${port} to this PC manually.`);
  }
}

function disableDirectHosting() {
  return serverToolMutationCoordinator.run('direct-hosting:disable', () => runNatMappingMutation(disableDirectHostingUnlocked));
}

async function disableDirectHostingUnlocked() {
  const profile = await getActiveProfile();
  const profileId = String(profile?.id || '');
  directHostingState = scopeDirectHostingState(directHostingState, profileId);
  const config = await readConfig();
  await writeConfig({ ...config, directHostingEnabled: false });
  const failures = [];
  const tcpLease = getOwnedNatLease(directHostingState, 'tcp', profileId);
  const voiceLease = getOwnedNatLease(directHostingState, 'voice', profileId);
  try {
    await releaseOwnedNatLeaseUnlocked('tcp', profileId);
  } catch (error) {
    failures.push(error?.message || String(error));
  }
  directHostingState = {
    ...scopeDirectHostingState(directHostingState, profileId),
    profileId,
    publicIp: await getPublicIp(),
    publicAddress: '',
    message: failures.length
      ? `Direct hosting was disabled, but some router mappings could not be removed: ${failures.join(' · ')}`
      : tcpLease
        ? `Minecraft TCP ${tcpLease.port} mapping removed.${voiceLease ? ` Voice chat UDP ${voiceLease.port} remains active for Simple Voice Chat.` : ''}`
        : 'Direct hosting disabled. No owned router mappings were active.'
  };
  appendServerLog(`[Server Manager] ${directHostingState.message}\n`);
  if (failures.length) throw new Error(directHostingState.message);
  return directHostingState;
}

async function getDirectHostingStatus() {
  const profile = await getActiveProfile();
  const profileId = String(profile?.id || '');
  const config = normalizeServerConfig(await readJson(getPathsForProfile(profile).config, DEFAULT_CONFIG));
  const port = Number(config.port) || 25565;
  const scopedState = scopeDirectHostingState(directHostingState, profileId);
  const tcpLease = getOwnedNatLease(scopedState, 'tcp', profileId);
  const voiceLease = getOwnedNatLease(scopedState, 'voice', profileId);
  const configuredAddress = String(config.publicAddress || '');
  const configuredIp = configuredAddress.includes(':') ? configuredAddress.split(':')[0] : '';
  const publicIp = scopedState.publicIp || configuredIp;
  const enabled = Boolean(config.directHostingEnabled);
  const publicAddress = scopedState.publicAddress || configuredAddress || (publicIp ? `${publicIp}:${port}` : '');
  return {
    ...scopedState,
    profileId,
    mapped: Boolean(tcpLease),
    publicIp,
    publicAddress,
    port,
    tcpPort: tcpLease?.port || 0,
    voicePort: voiceLease?.port || 0,
    voiceMapped: Boolean(voiceLease),
    voiceMappingError: String(scopedState.voiceMappingError || ''),
    message: scopedState.message || (tcpLease
      ? `Direct hosting enabled. Use ${publicAddress || `public IP:${tcpLease.port}`}.`
      : enabled
        ? 'Direct hosting is enabled, but a router mapping is not currently confirmed.'
      : 'Not mapped.')
  };
}

function stopNatClientRenewals(client) {
  for (const field of ['_upnpIntervals', '_pmpIntervals']) {
    const intervals = client?.[field];
    if (!intervals || typeof intervals !== 'object') continue;
    for (const key of Object.keys(intervals)) {
      clearInterval(intervals[key]);
      delete intervals[key];
    }
  }
}

function destroyNatClientBestEffort(timeoutMs = 750) {
  natShutdownStarted = true;
  const client = natClient;
  natClient = null;
  directHostingState = createDirectHostingState();
  if (!client) return Promise.resolve();
  stopNatClientRenewals(client);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(50, Number(timeoutMs) || 750));
    try {
      client.destroy(finish);
    } catch {
      finish();
    }
  });
}

async function checkExternalMinecraftStatus(address) {
  const parsed = parseServerAddress(address, DEFAULT_CONFIG.port);
  if (!parsed.host) return { checked: false, online: false, message: 'No public address configured.' };
  try {
    const result = await getJson(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(parsed.host)}:${parsed.port}`);
    return {
      checked: true,
      online: Boolean(result.online),
      host: parsed.host,
      port: parsed.port,
      players: result.players || null,
      version: result.version?.name_clean || result.version?.name_raw || '',
      motd: result.motd?.clean || ''
    };
  } catch (error) {
    return { checked: false, online: false, host: parsed.host, port: parsed.port, message: error.message || String(error) };
  }
}

async function repairConnection() {
  const config = await readConfig();
  if (config.localOnly) {
    const players = await getPlayerStatus();
    const diagnostics = await getJoinDiagnostics(config, players);
    return {
      fixed: true,
      code: 'SRV-NET-LOCAL',
      diagnostics,
      external: { checked: false, online: false, message: 'Public status checks are disabled in local-only mode.' }
    };
  }
  const address = buildPublicJoinAddress(config);
  if (!address && !config.directHostingEnabled) {
    appendServerLog('[Server Manager SRV-NET-300] No public join address configured. Trying direct hosting mapping.\n');
    await enableDirectHosting();
  } else if (config.directHostingEnabled) {
    appendServerLog('[Server Manager SRV-NET-300] Refreshing direct hosting mapping before connection test.\n');
    await enableDirectHosting().catch((error) => {
      appendServerLog(`[Server Manager SRV-NET-301] Direct hosting refresh failed: ${error.message || String(error)}\n`);
    });
  }

  const nextConfig = await readConfig();
  const players = await getPlayerStatus();
  const diagnostics = await getJoinDiagnostics(nextConfig, players);
  const external = await checkExternalMinecraftStatus(buildPublicJoinAddress(nextConfig));

  if (diagnostics.loopbackLikelyBlocked && external.online) {
    appendServerLog(
      '[Server Manager SRV-NET-000] Repair result: public join address works externally.\n' +
      `  Address: ${diagnostics.address}\n` +
      '  External reachability: online\n' +
      '  Local self-test: blocked by router NAT loopback/hairpin\n' +
      '  What to use on this PC: localhost or the LAN IP\n' +
      '  What outside players use: the public join address above\n'
    );
    return { fixed: true, code: 'SRV-NET-000', diagnostics, external };
  }

  if (external.online) {
    appendServerLog(
      '[Server Manager SRV-NET-000] Repair result: public join address is reachable from the internet.\n' +
      `  Address: ${buildPublicJoinAddress(nextConfig)}\n` +
      `  Version: ${external.version || 'unknown'}\n` +
      `  Players: ${Number(external.players?.online) || 0} / ${Number(external.players?.max) || Number(nextConfig.maxPlayers) || 0}\n`
    );
    return { fixed: true, code: 'SRV-NET-000', diagnostics, external };
  }

  appendServerLog(
    '[Server Manager SRV-NET-302] Repair result: public join address is not reachable externally.\n' +
    `  Address: ${buildPublicJoinAddress(nextConfig) || 'not set'}\n` +
    `  Local Minecraft status: ${players.reachable ? 'reachable' : 'not reachable'}\n` +
    `  External test: ${external.checked ? 'offline' : `not checked (${external.message || 'unknown error'})`}\n` +
    '  Next step: enable UPnP/manual TCP port forward 25565 to this PC, or use playit tunnel fallback.\n'
  );
  return { fixed: false, code: 'SRV-NET-302', diagnostics, external };
}

function parsePlayitSignal(text) {
  const value = String(text || '');
  const setupUrl = value.match(/https?:\/\/[^\s"'<>]*playit\.gg[^\s"'<>]*/i)?.[0] || '';
  const addressMatches = [...value.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*(?:\.playit\.(?:gg|cloud)|\.joinmc\.link|\.ply\.gg)(?::\d{2,5})?)\b/gi)]
    .map((match) => match[1])
    .filter((address) => !/setup|download|api|www/i.test(address));
  const address = addressMatches.at(-1) || '';
  return { setupUrl, address };
}

function shouldSuppressPlayitLine(line) {
  return /udp channel requires auth|udp session details received|send KeepAlive|agent registered details=AgentRegistered|got initial pong|authenticate control last_pong|trying to establish tunnel connection/i.test(line);
}

function notePlayitOutput(text) {
  const output = String(text || '').replace(/\r\n/g, '\n');
  const signal = parsePlayitSignal(output);
  if (signal.setupUrl && signal.setupUrl !== playitState.setupUrl) {
    playitState.setupUrl = signal.setupUrl;
    appendServerLog(
      '[Server Manager SRV-TUN-201] playit setup/claim required.\n' +
      `  Setup link: ${signal.setupUrl}\n` +
      '  Next step: open the link, claim the agent, create a Minecraft TCP tunnel to 127.0.0.1:25565, then run tunnel status.\n'
    );
  }
  if (signal.address && signal.address !== playitState.address) {
    playitState.address = signal.address;
    appendServerLog(
      '[Server Manager SRV-TUN-300] playit tunnel address detected.\n' +
      `  Address: ${signal.address}\n` +
      '  Next step: use this as the public join address if your router blocks same-Wi-Fi public-IP joins.\n'
    );
  }

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    playitState.lastMessage = line;
    if (/SessionNotSetup/i.test(line)) {
      if (!playitState.sessionNotSetup) {
        playitState.sessionNotSetup = true;
        appendServerLog(
          '[Server Manager SRV-TUN-101] playit agent is running, but no tunnel is set up yet.\n' +
          '  Meaning: the download is fine; Playit still needs a claimed agent and a Minecraft tunnel/service.\n' +
          '  Next step: open https://playit.gg/account/agents and create a Minecraft TCP tunnel to 127.0.0.1:25565.\n'
        );
      }
      continue;
    }
    if (shouldSuppressPlayitLine(line)) {
      playitState.spamSuppressed += 1;
      continue;
    }
    appendServerLog(`[playit] ${line}\n`);
  }
}

function boundedPlayitOutputText(data) {
  const marker = '\n[Server Manager] Oversized playit output was trimmed before parsing.\n';
  if (Buffer.isBuffer(data)) {
    if (data.length <= MAX_PLAYIT_OUTPUT_CHUNK_CHARS) return { text: data.toString(), dropped: 0 };
    const headLength = 4 * 1024;
    const tailLength = Math.max(1, MAX_PLAYIT_OUTPUT_CHUNK_CHARS - headLength - marker.length);
    return {
      text: `${data.subarray(0, headLength).toString()}${marker}${data.subarray(-tailLength).toString()}`,
      dropped: Math.max(0, data.length - headLength - tailLength)
    };
  }
  const value = String(data ?? '');
  if (value.length <= MAX_PLAYIT_OUTPUT_CHUNK_CHARS) return { text: value, dropped: 0 };
  const headLength = 4 * 1024;
  const tailLength = Math.max(1, MAX_PLAYIT_OUTPUT_CHUNK_CHARS - headLength - marker.length);
  return {
    text: `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`,
    dropped: Math.max(0, value.length - headLength - tailLength)
  };
}

function attachBoundedPlayitOutput(processRef) {
  const ingress = new BoundedChunkQueue(MAX_PLAYIT_OUTPUT_PENDING_CHARS, MAX_PLAYIT_OUTPUT_PENDING_CHUNKS);
  const streams = [processRef?.stdout, processRef?.stderr].filter(Boolean);
  let timer = null;
  let paused = false;
  let dropped = 0;
  let closed = false;

  const setPaused = (nextPaused) => {
    if (paused === nextPaused) return;
    paused = nextPaused;
    for (const stream of streams) {
      try {
        if (paused) stream.pause?.();
        else stream.resume?.();
      } catch {}
    }
  };
  const schedule = () => {
    if (closed || timer || !ingress.length) return;
    timer = setTimeout(() => drain(false), PLAYIT_OUTPUT_PROCESS_DELAY_MS);
    timer.unref?.();
  };
  const drain = (finalDrain) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (finalDrain) dropped += ingress.retainLatest(PLAYIT_OUTPUT_FINAL_BUDGET_CHARS);
    if (dropped) {
      appendServerLog(
        `[Server Manager] ${dropped.toLocaleString('en-US')} playit-output characters were skipped to keep the app responsive. The newest output was retained.\n`
      );
      dropped = 0;
    }
    const budget = finalDrain ? PLAYIT_OUTPUT_FINAL_BUDGET_CHARS : PLAYIT_OUTPUT_PROCESS_BUDGET_CHARS;
    for (const chunk of ingress.drain(budget)) notePlayitOutput(chunk.text);
    if (ingress.length <= PLAYIT_OUTPUT_RESUME_CHARS) setPaused(false);
    if (finalDrain) {
      ingress.clear();
      return;
    }
    schedule();
  };
  const enqueue = (data) => {
    if (closed || playitProcess !== processRef) return;
    const bounded = boundedPlayitOutputText(data);
    if (!bounded.text) return;
    dropped += bounded.dropped;
    dropped += ingress.append(bounded.text);
    if (ingress.length >= PLAYIT_OUTPUT_PAUSE_CHARS) setPaused(true);
    schedule();
  };
  for (const stream of streams) stream.on?.('data', enqueue);

  return Object.freeze({
    finish() {
      if (closed) return;
      closed = true;
      for (const stream of streams) stream.removeListener?.('data', enqueue);
      drain(true);
    }
  });
}

async function isPlayitProcessRunning(exePath) {
  const escaped = String(exePath || '').replace(/'/g, "''");
  const output = await execPowershell(
    `(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' } | Select-Object -First 1 -ExpandProperty ProcessId) 2>$null`
  );
  return Boolean(String(output || '').trim());
}

async function hydratePlayitStateFromLogs() {
  const tools = getToolPaths();
  const candidates = [];
  let directoryHandle;
  try {
    directoryHandle = await fs.opendir(tools.tools, { bufferSize: 32 });
    for (let visited = 0; visited < PLAYIT_LOG_HYDRATION_ENTRY_LIMIT; visited += 1) {
      const entry = await directoryHandle.read();
      if (!entry) break;
      if (!entry.isFile() || !/^playit.*\.log$/i.test(entry.name)) continue;
      const file = path.join(tools.tools, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile() || stat.size <= 0) continue;
      candidates.push({ file, mtimeMs: stat.mtimeMs });
      candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
      if (candidates.length > PLAYIT_LOG_HYDRATION_FILE_LIMIT) candidates.pop();
    }
  } catch {
    return;
  } finally {
    await directoryHandle?.close().catch(() => {});
  }
  let remainingBytes = PLAYIT_LOG_HYDRATION_TOTAL_BYTES;
  let hydratedLastMessage = '';
  for (const candidate of candidates) {
    if (remainingBytes <= 0) break;
    const maximumBytes = Math.min(PLAYIT_LOG_HYDRATION_FILE_BYTES, remainingBytes);
    const text = await readFileTailUtf8(candidate.file, maximumBytes);
    remainingBytes -= Math.min(maximumBytes, Buffer.byteLength(text));
    if (!text) continue;
    const signal = parsePlayitSignal(text);
    if (!playitState.setupUrl && signal.setupUrl) playitState.setupUrl = signal.setupUrl;
    if (!playitState.address && signal.address) playitState.address = signal.address;
    if (/SessionNotSetup/i.test(text)) playitState.sessionNotSetup = true;
    if (!hydratedLastMessage) {
      const usefulLines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !shouldSuppressPlayitLine(line));
      hydratedLastMessage = usefulLines.at(-1) || '';
    }
  }
  if (!playitState.lastMessage && hydratedLastMessage) playitState.lastMessage = hydratedLastMessage;
}

async function readPlayitMetadata(tools = getToolPaths()) {
  try {
    const stat = await fs.stat(tools.playitMetadata);
    if (!stat.isFile() || stat.size > MAX_PLAYIT_METADATA_BYTES) return null;
    const metadata = JSON.parse(await fs.readFile(tools.playitMetadata, 'utf8'));
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

async function writePlayitMetadata(tools, metadata) {
  const temporary = `${tools.playitMetadata}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, JSON.stringify(metadata, null, 2));
  await replaceFileAtomically(temporary, tools.playitMetadata);
}

async function verifyPlayitAgentInstallation(tools = getToolPaths()) {
  const metadata = await readPlayitMetadata(tools);
  const sha256 = parseSha256Digest(metadata?.digest || (metadata?.sha256 ? `sha256:${metadata.sha256}` : ''));
  const expectedSize = Number(metadata?.size);
  if (!metadata || !sha256 || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_PLAYIT_AGENT_BYTES) {
    throw new Error('The Playit agent has no trusted install record. Download it again before starting it.');
  }
  let stat;
  try {
    stat = await fs.stat(tools.playitExe);
  } catch {
    throw new Error('The verified Playit executable is missing. Download it again.');
  }
  if (!stat.isFile() || stat.size !== expectedSize) {
    throw new Error('The Playit executable size changed after download. Download it again before starting it.');
  }
  if (!await fileMatchesExpectedHash(tools.playitExe, { sha256 })) {
    throw new Error('The Playit executable hash changed after download. Download it again before starting it.');
  }
  const authenticode = await verifyWindowsAuthenticode(tools.playitExe);
  const recordedThumbprint = String(metadata.authenticode?.thumbprint || '').replace(/\s+/g, '').toUpperCase();
  if (!recordedThumbprint || authenticode.thumbprint !== recordedThumbprint) {
    throw new Error('The Playit executable signer no longer matches its verified install record. Download it again.');
  }
  return { verified: true, sha256, size: expectedSize, authenticode, metadata };
}

async function getPlayitStatus() {
  const tools = getToolPaths();
  let installed = false;
  let executableStat = null;
  let metadataStat = null;
  try {
    executableStat = await fs.stat(tools.playitExe);
    installed = executableStat.isFile();
  } catch {}
  try {
    metadataStat = await fs.stat(tools.playitMetadata);
  } catch {}
  let verification = null;
  let verificationMessage = '';
  if (installed) {
    const cacheKey = `playit-verification:${tools.playitExe}:${executableStat.size}:${executableStat.mtimeMs}:${metadataStat?.mtimeMs || 0}`;
    try {
      verification = await getCachedWork(cacheKey, 5 * 60_000, () => verifyPlayitAgentInstallation(tools));
    } catch (error) {
      verificationMessage = error.message || String(error);
    }
  }
  if (installed && (!playitState.address || !playitState.lastMessage)) await hydratePlayitStateFromLogs();
  const externalRunning = installed
    ? await getCachedWork(`playit-process:${tools.playitExe}`, 15_000, () => isPlayitProcessRunning(tools.playitExe))
    : false;
  return {
    installed,
    verified: Boolean(verification?.verified),
    verificationMessage,
    signer: verification?.authenticode?.subject || '',
    running: Boolean(playitProcess) || externalRunning,
    managed: Boolean(playitProcess),
    path: tools.playitExe,
    address: playitState.address,
    setupUrl: playitState.setupUrl,
    lastMessage: playitState.lastMessage,
    sessionNotSetup: playitState.sessionNotSetup,
    spamSuppressed: playitState.spamSuppressed
  };
}

async function getWorldIconDataUrl(paths, config) {
  const worldName = validateWorldName(config.levelName || 'world');
  const worldRoot = resolveContainedPath(paths.root, path.join(paths.root, worldName));
  return getCachedWork(`world-icon:${paths.root}:${worldName}`, 60_000, async () => {
    const candidates = [
      path.join(paths.root, 'server-icon.png'),
      path.join(worldRoot, 'icon.png'),
      path.join(paths.root, 'icon.png')
    ];
    for (const file of candidates) {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_WORLD_ICON_BYTES) continue;
        const icon = await fs.readFile(file);
        return `data:image/png;base64,${icon.toString('base64')}`;
      } catch {}
    }
    return '';
  });
}

async function selectServerIcon() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a server icon',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const source = result.filePaths[0];
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) {
    throw new Error('Choose a PNG or JPEG image smaller than 20 MB.');
  }
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error('That image could not be read. Choose a PNG or JPEG file.');
  const size = image.getSize();
  const side = Math.min(size.width, size.height);
  if (!Number.isFinite(side) || side < 1) throw new Error('That image has invalid dimensions.');
  const square = image.crop({
    x: Math.max(0, Math.floor((size.width - side) / 2)),
    y: Math.max(0, Math.floor((size.height - side) / 2)),
    width: side,
    height: side
  });
  const png = square.resize({ width: 64, height: 64, quality: 'best' }).toPNG();
  if (!png.length || png.length > 1024 * 1024) throw new Error('The server icon could not be converted to a 64×64 PNG.');
  const paths = await getPaths();
  const destination = path.join(paths.root, 'server-icon.png');
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.writeFile(temporary, png);
    await replaceFileAtomically(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  invalidateCachedWork(`world-icon:${paths.root}:`);
  cachedStatus = null;
  return { canceled: false, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
}

async function removeServerIcon() {
  const paths = await getPaths();
  await fs.rm(path.join(paths.root, 'server-icon.png'), { force: true });
  invalidateCachedWork(`world-icon:${paths.root}:`);
  cachedStatus = null;
  return { removed: true };
}

async function downloadPlayitAgent() {
  const tools = getToolPaths();
  await fs.mkdir(tools.tools, { recursive: true });
  const release = await getJson(
    'https://api.github.com/repos/playit-cloud/playit-agent/releases/latest',
    {},
    { allowedHosts: ['api.github.com'] }
  );
  const asset = release.assets?.find((item) => /windows.*x86_64.*signed.*\.exe$/i.test(item.name));
  if (!asset?.browser_download_url) throw new Error('Could not find the latest signed Windows playit agent.');
  const integrity = validatePlayitAssetMetadata(asset);
  const staging = `${tools.playitExe}.verified-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let authenticode;
  try {
    await download(asset.browser_download_url, staging, {
      allowedHosts: ['github.com', 'githubusercontent.com'],
      maxBytes: MAX_PLAYIT_AGENT_BYTES,
      expectedSize: integrity.size,
      expectedHashes: { sha256: integrity.sha256 }
    });
    authenticode = await verifyWindowsAuthenticode(staging);
    await replaceFileAtomically(staging, tools.playitExe);
    await writePlayitMetadata(tools, {
      digest: `sha256:${integrity.sha256}`,
      sha256: integrity.sha256,
      size: integrity.size,
      releaseTag: String(release.tag_name || ''),
      assetName: String(asset.name || ''),
      source: 'github:playit-cloud/playit-agent',
      authenticode: {
        subject: authenticode.subject,
        thumbprint: authenticode.thumbprint
      },
      installedAt: new Date().toISOString()
    });
  } finally {
    await fs.rm(staging, { force: true }).catch(() => {});
  }
  invalidateCachedWork('playit-verification:');
  appendServerLog(`[Server Manager] Downloaded playit agent ${release.tag_name || ''}.\n`);
  return getPlayitStatus();
}

function startPlayitAgent() {
  try {
    assertApplicationAllowsOwnedChildStart('the playit agent');
  } catch (error) {
    return Promise.reject(error);
  }
  return runPlayitMutation(startPlayitAgentUnlocked);
}

async function startPlayitAgentUnlocked() {
  assertApplicationAllowsOwnedChildStart('the playit agent');
  const config = await readConfig();
  if (config.localOnly) {
    throw new Error('Public tunnels are disabled in local-only mode. Disable local-only mode while the server is stopped first.');
  }
  const status = await getPlayitStatus();
  assertApplicationAllowsOwnedChildStart('the playit agent');
  if (!status.installed) throw new Error('Download the playit agent first.');
  if (status.running) return status;
  const tools = getToolPaths();
  const paths = await getPaths();
  const verification = await verifyPlayitAgentInstallation(tools);
  assertApplicationAllowsOwnedChildStart('the playit agent');
  appendServerLog(
    '[Server Manager SRV-TUN-000] Starting playit tunnel agent.\n' +
    `  Verified signer: ${verification.authenticode.subject}\n` +
    '  Target: Minecraft TCP tunnel to 127.0.0.1:25565\n' +
    '  If no address appears, run tunnel status or claim the agent in Playit.\n'
  );
  assertApplicationAllowsOwnedChildStart('the playit agent');
  const processRef = await launchPersistentProcess({
    role: 'playit-agent',
    executable: tools.playitExe,
    args: [],
    cwd: tools.tools,
    statePath: paths.persistentPlayitState,
    metadata: { profileId: path.basename(paths.root) }
  });
  try {
    assertApplicationAllowsOwnedChildStart('the playit agent');
  } catch (error) {
    await stopUnadoptedPersistentProcess(processRef);
    throw error;
  }
  playitProcess = processRef;
  const outputIngress = attachBoundedPlayitOutput(processRef);
  processRef.once('error', (error) => {
    outputIngress.finish();
    appendServerLog(`[Server Manager SRV-TUN-500] playit agent failed: ${error.message}\n`);
    if (playitProcess === processRef) playitProcess = null;
  });
  processRef.once('exit', (code) => {
    outputIngress.finish();
    appendServerLog(`[Server Manager SRV-TUN-001] playit agent stopped${code === null ? '' : ` with code ${code}`}.\n`);
    if (playitProcess === processRef) playitProcess = null;
  });
  return getPlayitStatus();
}

function stopPlayitAgent() {
  return runPlayitMutation(async () => {
    const processRef = playitProcess;
    if (!processRef) return getPlayitStatus();
    try { processRef.kill(); } catch {}
    let exited = await waitForChildExit(processRef, 2500);
    if (!exited) {
      try { processRef.kill('SIGKILL'); } catch {}
      exited = await waitForChildExit(processRef, 700);
    }
    if (exited && playitProcess === processRef) playitProcess = null;
    if (!exited) throw new Error('The managed playit agent did not stop. Close it before starting another tunnel.');
    invalidateCachedWork('playit-process:');
    return getPlayitStatus();
  });
}

async function getLocalOnlyModeStatus() {
  const config = await readConfig();
  const [playit, directHosting] = await Promise.all([
    getPlayitStatus(),
    getDirectHostingStatus()
  ]);
  const knownNatMappings = ['tcp', 'voice']
    .map(kind => getNatLease(directHostingState, kind))
    .filter(Boolean);
  const managedExposureStopped = !playit.running && knownNatMappings.length === 0;
  return {
    enabled: config.localOnly === true,
    bindIp: config.bindIp,
    localAddress: `${LOCAL_ONLY_BIND_IP}:${Number(config.port) || DEFAULT_CONFIG.port}`,
    publicStatus: config.localOnly ? 'offline' : 'enabled',
    managedExposureStopped,
    knownNatMappings,
    playit,
    directHosting
  };
}

async function cleanupManagedExposureForLocalOnly(profile) {
  const warnings = [];
  let tunnel = await getPlayitStatus();
  if (tunnel.running && tunnel.managed) {
    try {
      await stopPlayitAgent();
    } catch (error) {
      warnings.push(`managed tunnel: ${error.message || String(error)}`);
    }
  }
  invalidateCachedWork('playit-process:');
  tunnel = await getPlayitStatus();
  if (tunnel.running) {
    warnings.push('a Playit process outside this app session is still running; Minecraft startup will stay blocked until it is closed');
  }

  const natCleanup = await runNatMappingMutation(async () => {
    const failures = [];
    for (const owner of getNatLeaseOwners(directHostingState)) {
      const result = await cleanupOwnedNatMappingsForProfileUnlocked(owner);
      failures.push(...result.failures);
    }
    if (!failures.length) directHostingState = scopeDirectHostingState(directHostingState, profile.id);
    return { failures };
  });
  warnings.push(...natCleanup.failures);

  const firewall = await cleanupProfileFirewallRules({ profileId: profile.id, profileName: profile.name });
  if (firewall.supported && !firewall.ok) {
    warnings.push(`managed voice firewall rule: ${firewall.message || firewall.code || 'cleanup failed'}`);
  }
  return warnings;
}

function setLocalOnlyMode(enabled) {
  const requested = enabled === true;
  return serverToolMutationCoordinator.run(`local-only:${requested ? 'enable' : 'disable'}`, async () => {
    assertServerStoppedForServerToolChanges('local-only mode');
    const profile = await getActiveProfile();
    if (!profile?.id) throw new Error('Create or select a server before changing local-only mode.');
    const paths = getPathsForProfile(profile);
    const current = await readConfig(paths);
    if (!requested && !current.localOnly) {
      return { ...(await getLocalOnlyModeStatus()), unchanged: true };
    }
    const next = await writeConfig(configForLocalOnlyMode(current, requested), paths);
    if (!requested) {
      appendServerLog(
        '[Server Manager SRV-NET-LOCAL-000] Local-only mode disabled.\n' +
        `  Minecraft bind on next start: ${next.bindIp || 'all interfaces'}:${next.port}\n` +
        '  Public mapping and tunnel access remain disabled until explicitly enabled.\n'
      );
      return { ...(await getLocalOnlyModeStatus()), unchanged: false };
    }

    const warnings = await cleanupManagedExposureForLocalOnly(profile);

    invalidateStatusCache();
    appendServerLog(
      '[Server Manager SRV-NET-LOCAL-200] Local-only mode enabled.\n' +
      `  Minecraft bind on next start: ${LOCAL_ONLY_BIND_IP}:${next.port}\n` +
      '  Public address/status: offline\n' +
      `  Known tunnel/router exposure: ${warnings.length ? 'cleanup needs attention' : 'stopped'}\n` +
      (warnings.length ? `  Warning: ${warnings.join(' · ')}\n` : '')
    );
    const status = await getLocalOnlyModeStatus();
    return {
      ...status,
      managedExposureStopped: status.managedExposureStopped && warnings.length === 0,
      warnings
    };
  });
}

async function assertLocalOnlyExposureStopped(config) {
  if (config?.localOnly !== true) return;
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Local-only mode needs an active server profile.');
  const warnings = await cleanupManagedExposureForLocalOnly(profile);
  if (warnings.length) {
    throw new Error(`Local-only exposure cleanup is incomplete: ${warnings.join(' · ')}`);
  }
  invalidateStatusCache();
}

async function getVersionManifest() {
  const manifest = await getCachedWork('mojang-version-manifest', 5 * 60_000, () => getJson(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    {},
    { allowedHosts: ['piston-meta.mojang.com'] }
  ));
  return {
    latest: manifest.latest,
    versions: manifest.versions
      .filter((entry) => entry.type === 'release')
      .slice(0, 500)
      .map((entry) => ({ id: entry.id, type: entry.type, url: entry.url }))
  };
}

async function writePlatformMetadata(paths, metadata) {
  const temporary = `${paths.platform}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, JSON.stringify(metadata, null, 2));
  await replaceFileAtomically(temporary, paths.platform);
  cachedStatus = null;
  return metadata;
}

async function readPlatformMetadata(paths = null) {
  const resolvedPaths = paths || await getPaths();
  const metadata = await readJson(resolvedPaths.platform, {});
  return Object.keys(metadata).length ? metadata : null;
}

function platformSupportsAddons(type, kind) {
  return getPreferredAddonLoaders(kind, type).length > 0;
}

async function getServerPlatformStatus(configOverride = null, pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const config = configOverride || await readConfig();
  const desiredType = normalizeServerType(config.serverType);
  const metadata = await readPlatformMetadata(paths);
  let jarExists = false;
  let jarStat = null;
  const jarPath = config.jarPath || paths.vanillaJar;
  try {
    jarStat = await fs.stat(jarPath);
    jarExists = jarStat.isFile();
  } catch {}
  const installedType = metadata?.type || 'unknown';
  const declaredType = normalizeServerType(metadata?.declaredType || installedType);
  const expectedHashes = normalizeExpectedHashes({ sha256: metadata?.sha256, sha1: metadata?.sha1 });
  const locallyPinnedCustom = Boolean(
    installedType === 'custom' && metadata?.source === 'local-file' &&
    metadata?.userApprovedPlatform === true && metadata?.verified === true &&
    ['fabric', 'quilt', 'forge', 'neoforge', 'paper', 'purpur', 'spigot'].includes(declaredType)
  );
  const trustedSource = (installedType === 'vanilla' && metadata?.source === 'mojang') ||
    (installedType === 'paper' && metadata?.source === 'papermc') ||
    (installedType === 'fabric' && metadata?.source === 'fabricmc') ||
    locallyPinnedCustom;
  const expectedSize = Number(metadata?.size) || 0;
  const sizeMatches = !expectedSize || jarStat?.size === expectedSize;
  let integrityMatches = false;
  if (jarExists && trustedSource && metadata?.verified === true && sizeMatches && Object.keys(expectedHashes).length) {
    const cacheKey = `platform-integrity:${jarPath}:${jarStat.size}:${jarStat.mtimeMs}:${JSON.stringify(expectedHashes)}`;
    integrityMatches = await getCachedWork(cacheKey, 5 * 60_000, () => fileMatchesExpectedHash(jarPath, expectedHashes));
  }
  const verified = Boolean(jarExists && trustedSource && metadata?.verified === true && sizeMatches && integrityMatches);
  const desiredVersion = normalizeAddonVersion(config.serverVersion);
  const versionMatches = !desiredVersion || !metadata?.minecraftVersion || metadata.minecraftVersion === desiredVersion || installedType === 'custom';
  const typeMatches = installedType === desiredType || (installedType === 'custom' && declaredType === desiredType);
  const compatible = Boolean(jarExists && versionMatches && typeMatches);
  let message = '';
  if (!jarExists) message = 'Install a server platform before adding mods or plugins.';
  else if (installedType === 'unknown') {
    message = 'This server jar has no trusted platform record. Reinstall the selected platform or explicitly choose it as a custom jar.';
  } else if (!typeMatches) {
    message = `Settings select ${desiredType}, but the installed server jar is ${installedType}. Install ${desiredType} before adding content.`;
  } else if (!versionMatches) {
    message = `Settings select Minecraft ${desiredVersion}, but the installed ${installedType} jar is for ${metadata.minecraftVersion}. Install the matching version first.`;
  } else if (!verified) {
    message = installedType === 'custom'
      ? 'This custom server jar is not integrity-pinned. Select it again before enabling server-side protection.'
      : 'The installed server jar no longer matches its verified download record. Reinstall the selected platform before enabling security protections.';
  }
  return {
    desiredType,
    installedType,
    declaredType,
    jarExists,
    compatible,
    verified,
    locallyPinnedCustom,
    ready: compatible && verified,
    integrityMatches,
    minecraftVersion: metadata?.minecraftVersion || desiredVersion,
    build: metadata?.build || '',
    source: metadata?.source || '',
    installedAt: metadata?.installedAt || '',
    supportsMods: platformSupportsAddons(desiredType, 'mods'),
    supportsPlugins: platformSupportsAddons(desiredType, 'plugins'),
    message
  };
}

async function downloadMojangServer(versionId, context = {}) {
  const paths = context.paths || await getPaths();
  const revalidate = typeof context.revalidate === 'function' ? context.revalidate : async () => {};
  await revalidate();
  const manifest = await getVersionManifest();
  const targetId = versionId === 'latest' || !versionId ? manifest.latest.release : versionId;
  const version = manifest.versions.find((entry) => entry.id === targetId);
  if (!version) throw new Error(`Could not find Minecraft ${targetId} in Mojang manifest.`);
  const details = await getJson(version.url, {}, { allowedHosts: ['piston-meta.mojang.com', 'launchermeta.mojang.com'] });
  const server = details.downloads?.server;
  if (!server?.url) throw new Error(`Minecraft ${targetId} does not expose a server download.`);
  if (!/^[a-f0-9]{40}$/i.test(String(server.sha1 || '')) || !Number.isSafeInteger(Number(server.size)) || Number(server.size) <= 0) {
    throw new Error(`Minecraft ${targetId} did not provide valid server integrity metadata.`);
  }
  const downloaded = await download(server.url, paths.vanillaJar, {
    allowedHosts: ['piston-data.mojang.com', 'launcher.mojang.com'],
    maxBytes: MAX_SERVER_JAR_BYTES,
    expectedSize: server.size,
    expectedHashes: server.sha1 ? { sha1: server.sha1 } : {},
    requireJar: true,
    backupExisting: true,
    beforeCommit: revalidate
  });
  await revalidate();
  const config = await readConfig(paths);
  await revalidate();
  const platform = await writePlatformMetadata(paths, {
    type: 'vanilla', minecraftVersion: targetId, source: 'mojang', sha1: server.sha1,
    size: downloaded.size, verified: true, installedAt: new Date().toISOString()
  });
  await writeConfig({
    ...config,
    requestedServerType: '',
    requestedServerVersion: '',
    serverType: 'vanilla',
    jarPath: paths.vanillaJar,
    serverVersion: targetId
  }, paths);
  return { type: 'vanilla', version: targetId, jarPath: paths.vanillaJar, platform };
}

async function downloadPaperServer(versionId, context = {}) {
  const paths = context.paths || await getPaths();
  const revalidate = typeof context.revalidate === 'function' ? context.revalidate : async () => {};
  await revalidate();
  const manifest = await getVersionManifest();
  const targetId = versionId === 'latest' || !versionId ? manifest.latest.release : versionId;
  const builds = await getJson(
    `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(targetId)}/builds`,
    {},
    { allowedHosts: ['fill.papermc.io'] }
  );
  const stable = (Array.isArray(builds) ? builds : [])
    .filter((build) => build.channel === 'STABLE' && build.downloads?.['server:default']?.url)
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!stable) throw new Error(`Paper does not have a stable server build for Minecraft ${targetId}.`);
  const asset = stable.downloads['server:default'];
  if (!/^[a-f0-9]{64}$/i.test(String(asset.checksums?.sha256 || '')) || !Number.isSafeInteger(Number(asset.size)) || Number(asset.size) <= 0) {
    throw new Error(`Paper ${targetId} did not provide valid server integrity metadata.`);
  }
  const downloaded = await download(asset.url, paths.vanillaJar, {
    allowedHosts: ['fill-data.papermc.io'],
    maxBytes: MAX_SERVER_JAR_BYTES,
    expectedSize: asset.size,
    expectedHashes: asset.checksums?.sha256 ? { sha256: asset.checksums.sha256 } : {},
    requireJar: true,
    backupExisting: true,
    beforeCommit: revalidate
  });
  await revalidate();
  const config = await readConfig(paths);
  await revalidate();
  const platform = await writePlatformMetadata(paths, {
    type: 'paper', minecraftVersion: targetId, build: String(stable.id), source: 'papermc',
    sha256: asset.checksums.sha256, size: downloaded.size, verified: true, installedAt: new Date().toISOString()
  });
  await writeConfig({
    ...config,
    requestedServerType: '',
    requestedServerVersion: '',
    serverType: 'paper',
    jarPath: paths.vanillaJar,
    serverVersion: targetId
  }, paths);
  return { type: 'paper', version: targetId, build: stable.id, jarPath: paths.vanillaJar, platform };
}

async function downloadFabricServer(versionId, context = {}) {
  const paths = context.paths || await getPaths();
  const revalidate = typeof context.revalidate === 'function' ? context.revalidate : async () => {};
  await revalidate();
  const manifest = await getVersionManifest();
  const targetId = versionId === 'latest' || !versionId ? manifest.latest.release : versionId;
  const [loaders, installers] = await Promise.all([
    getJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(targetId)}`, {}, { allowedHosts: ['meta.fabricmc.net'] }),
    getJson('https://meta.fabricmc.net/v2/versions/installer', {}, { allowedHosts: ['meta.fabricmc.net'] })
  ]);
  const loaderEntry = (Array.isArray(loaders) ? loaders : []).find((entry) => entry.loader?.stable) || loaders?.[0];
  const installerEntry = (Array.isArray(installers) ? installers : []).find((entry) => entry.stable) || installers?.[0];
  const loaderVersion = loaderEntry?.loader?.version;
  const installerVersion = installerEntry?.version;
  if (!loaderVersion || !installerVersion) throw new Error(`Fabric does not provide a server launcher for Minecraft ${targetId}.`);
  const serverUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(targetId)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
  const downloaded = await download(serverUrl, paths.vanillaJar, {
    allowedHosts: ['meta.fabricmc.net'], maxBytes: MAX_SERVER_JAR_BYTES, requireJar: true, backupExisting: true,
    beforeCommit: revalidate
  });
  await revalidate();
  const sha256 = await calculateFileHash(paths.vanillaJar, 'sha256');
  await revalidate();
  const config = await readConfig(paths);
  await revalidate();
  const platform = await writePlatformMetadata(paths, {
    type: 'fabric', minecraftVersion: targetId, build: loaderVersion, installerVersion,
    source: 'fabricmc', sha256, size: downloaded.size, verified: true, installedAt: new Date().toISOString()
  });
  await writeConfig({
    ...config,
    requestedServerType: '',
    requestedServerVersion: '',
    serverType: 'fabric',
    jarPath: paths.vanillaJar,
    serverVersion: targetId
  }, paths);
  return { type: 'fabric', version: targetId, build: loaderVersion, jarPath: paths.vanillaJar, platform };
}

function getPlatformInstallRequestKey(options = {}) {
  const rawType = String(options?.type || '').trim();
  const rawVersion = String(options?.version || '').trim();
  return JSON.stringify([
    rawType ? normalizeServerType(rawType) : null,
    rawVersion || null
  ]);
}

function resolvePlatformInstallTarget(options = {}, config = {}) {
  return {
    type: normalizeServerType(options.type || config.requestedServerType || config.serverType),
    version: String(options.version || config.requestedServerVersion || config.serverVersion || 'latest')
  };
}

function installServerPlatform(options = {}) {
  if (!isServerStoppedForServerToolChanges()) {
    return Promise.reject(new Error('Stop the server and wait for startup to finish before replacing its server platform.'));
  }
  const requestKey = getPlatformInstallRequestKey(options);
  return platformInstallCoordinator.run(requestKey, () => serverToolMutationCoordinator.run(`platform:install:${requestKey}`, async () => {
    const profileSnapshot = await captureActiveServerToolProfile('the server platform');
    const paths = profileSnapshot.paths;
    const revalidate = () => revalidateServerToolProfile(profileSnapshot, 'the server platform');
    const config = await readConfig(paths);
    await revalidate();
    const { type, version } = resolvePlatformInstallTarget(options, config);
    const installId = crypto.randomUUID();
    platformInstallState = {
      id: installId,
      type,
      version,
      state: 'installing',
      completed: false,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      error: ''
    };
    emitAll('server:platformInstall', platformInstallState);
    try {
      let result;
      const installContext = { paths, revalidate };
      if (type === 'vanilla') result = await downloadMojangServer(version, installContext);
      else if (type === 'paper') result = await downloadPaperServer(version, installContext);
      else if (type === 'fabric') result = await downloadFabricServer(version, installContext);
      else throw new Error(`${type} requires a verified custom server jar. Automatic installs currently support Vanilla, Paper, and Fabric.`);

      await revalidate();
      const nextConfig = await readConfig(paths);
      const platform = await getServerPlatformStatus(nextConfig, paths);
      if (!platform.ready || platform.installedType !== type) {
        throw new Error(`The ${type} download finished, but its integrity check did not pass. Try the installation again.`);
      }
      platformInstallState = {
        ...platformInstallState,
        state: 'completed',
        completed: true,
        finishedAt: new Date().toISOString()
      };
      emitAll('server:platformInstall', platformInstallState);
      return {
        ...result,
        completed: true,
        installId,
        config: nextConfig,
        platform,
        install: platformInstallState
      };
    } catch (error) {
      const message = String(error?.message || error || 'Platform installation failed.').trim();
      platformInstallState = {
        ...platformInstallState,
        state: 'failed',
        completed: true,
        finishedAt: new Date().toISOString(),
        error: message
      };
      emitAll('server:platformInstall', platformInstallState);
      throw new Error(message);
    } finally {
      cachedStatus = null;
    }
  }));
}

async function downloadVanillaVersion(versionId) {
  return installServerPlatform({ version: versionId });
}

async function downloadLatestVanilla() {
  return installServerPlatform({ version: 'latest' });
}

async function listJarFiles(dir, options = {}) {
  if (options.ensure !== false) await fs.mkdir(dir, { recursive: true });
  const listing = await enumerateJarFilesBounded(dir, MAX_ADDON_FILE_ENTRIES);
  // An unreadable file is omitted from the regular installed list. Conflict
  // discovery uses the richer descriptor index and reports inspection failures
  // without making the rest of the add-on page fail.
  return listing.files.filter(file => !file.statError);
}

function installedAddonKey(kind, file) {
  return `${normalizeAddonKind(kind)}:${String(file || '').trim().toLowerCase()}`;
}

function normalizeAddonIconUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2048) return '';
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function normalizeInstalledAddonEntry(value = {}) {
  const kind = normalizeAddonKind(value.kind);
  const file = path.basename(String(value.file || '').trim());
  if (!file.toLowerCase().endsWith('.jar') || file !== String(value.file || '').trim()) return null;
  return {
    kind,
    file,
    source: value.source === 'curseforge' ? 'curseforge' : value.source === 'modrinth' ? 'modrinth' : 'imported',
    projectId: String(value.projectId || '').trim().slice(0, 160),
    providerVersionId: String(value.providerVersionId || value.versionId || '').trim().slice(0, 160),
    providerFileId: String(value.providerFileId || value.fileId || '').trim().slice(0, 160),
    providerFileName: cleanAddonFileName(value.providerFileName || value.file || ''),
    versionName: String(value.versionName || '').trim().slice(0, 180),
    gameVersion: normalizeAddonVersion(value.gameVersion),
    serverType: value.serverType ? normalizeServerType(value.serverType) : '',
    expectedHashes: normalizeExpectedHashes(value.expectedHashes),
    title: String(value.title || file.replace(/\.jar$/i, '')).trim().slice(0, 180),
    author: String(value.author || '').trim().slice(0, 180),
    iconUrl: normalizeAddonIconUrl(value.iconUrl),
    installedAt: String(value.installedAt || '').trim().slice(0, 40)
  };
}

function normalizeInstalledAddonMetadata(value = {}) {
  const addons = [];
  const seen = new Set();
  for (const raw of Array.isArray(value.addons) ? value.addons : []) {
    if (addons.length >= MAX_ADDON_FILE_ENTRIES) break;
    const entry = normalizeInstalledAddonEntry(raw);
    if (!entry) continue;
    const key = installedAddonKey(entry.kind, entry.file);
    if (seen.has(key)) continue;
    seen.add(key);
    addons.push(entry);
  }
  return { version: 2, addons };
}

async function readInstalledAddonMetadata(paths) {
  return normalizeInstalledAddonMetadata(await readJson(paths.addonMetadata, { version: 2, addons: [] }));
}

async function upsertInstalledAddonMetadata(paths, value) {
  const entry = normalizeInstalledAddonEntry(value);
  if (!entry) return;
  await serializeFileWrite(paths.addonMetadata, async () => {
    const metadata = await readInstalledAddonMetadata(paths);
    const key = installedAddonKey(entry.kind, entry.file);
    metadata.addons = metadata.addons.filter((item) => installedAddonKey(item.kind, item.file) !== key);
    metadata.addons.push(entry);
    await writeJsonAtomically(paths.addonMetadata, metadata);
  });
}

async function removeInstalledAddonMetadata(paths, kind, file) {
  await serializeFileWrite(paths.addonMetadata, async () => {
    const metadata = await readInstalledAddonMetadata(paths);
    const key = installedAddonKey(kind, file);
    const addons = metadata.addons.filter((item) => installedAddonKey(item.kind, item.file) !== key);
    if (addons.length !== metadata.addons.length) await writeJsonAtomically(paths.addonMetadata, { version: 2, addons });
  });
}

async function listManagedAddonFiles(paths, kind) {
  const normalizedKind = normalizeAddonKind(kind);
  const [files, metadata] = await Promise.all([
    listJarFiles(getAddonTargetDir(paths, normalizedKind)),
    readInstalledAddonMetadata(paths)
  ]);
  const byKey = new Map(metadata.addons.map((item) => [installedAddonKey(item.kind, item.file), item]));
  return files.map((file) => ({ ...file, ...(byKey.get(installedAddonKey(normalizedKind, file.name)) || {}) }));
}

function invalidateStatusCache() {
  statusCacheGeneration += 1;
  cachedStatus = null;
  cachedStatusAt = 0;
}

function publishStatusCache(result, generation) {
  if (generation === statusCacheGeneration) {
    cachedStatus = result;
    cachedStatusAt = Date.now();
  }
  return result;
}

async function buildStatus(generation = statusCacheGeneration) {
  const profileState = await getProfilesWithIcons(await readProfilesState());
  if (!profileState.profiles.length) {
    const result = {
      state: 'stopped', profiles: profileState, config: null, jarExists: false,
      java: { available: false, version: '', message: '' }, uptimeStartedAt: null,
      network: { lanIps: getLanIps(), totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024), stablePlayerLimit: 0 },
      players: { online: 0, max: 0, sample: [] }, bans: [], playerHistory: [], playerEvents: [], playerHistoryEvents: [], mods: [], plugins: [],
      playit: { installed: false, running: false }, directHosting: { mapped: false }, platform: null, platformInstall: platformInstallState,
      voiceNetwork: null, security: null, recentEvents: [], lastServerError: '', serverIconDataUrl: '',
      emptyServerStop: getEmptyServerAutoStopStatus(null)
    };
    return publishStatusCache(result, generation);
  }
  const paths = await getPaths();
  const config = await readConfig();
  let jarExists = false;
  try {
    jarExists = (await fs.stat(config.jarPath)).isFile();
  } catch {}
  const java = await resolveJava(config);
  if (java.available && java.path && config.javaPath !== java.path) {
    config.javaPath = java.path;
    await writeConfig(config);
  }
  const players = await getPlayerStatus();
  const joinDiagnostics = await getJoinDiagnostics(config, players);
  const [platform, worldIconDataUrl, performance, bans, playerHistory, playit, directHosting, voiceNetwork, mods, plugins] = await Promise.all([
    getServerPlatformStatus(config),
    getWorldIconDataUrl(paths, config),
    getServerPerformance(config, paths, players),
    getBannedPlayers(),
    getPlayerHistory(),
    getPlayitStatus(),
    getDirectHostingStatus(),
    getVoiceNetworkStatus(paths, config),
    listManagedAddonFiles(paths, 'mods'),
    listManagedAddonFiles(paths, 'plugins')
  ]);
  const playerEvents = flattenPlayerHistoryEvents(playerHistory);
  const dimensionLocks = await getDimensionLockSettingsStatus(config, paths, platform);
  const result = {
    state: serverState,
    paths,
    profiles: profileState,
    config,
    jarExists,
    java,
    uptimeStartedAt: serverStartedAt,
    network: {
      lanIps: getLanIps(),
      totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
      stablePlayerLimit: stablePlayerLimit(performance.memoryAllocatedMb)
    },
    players,
    joinDiagnostics,
    platform,
    platformInstall: platformInstallState,
    dimensionLocks,
    lastServerError,
    worldIconDataUrl,
    serverIconDataUrl: worldIconDataUrl,
    performance,
    recentEvents: getRecentLogEvents(),
    bans,
    playerHistory,
    playerEvents,
    playerHistoryEvents: playerEvents,
    playit,
    directHosting,
    voiceNetwork,
    emptyServerStop: getEmptyServerAutoStopStatus(config),
    mods,
    plugins
  };
  return publishStatusCache(result, generation);
}

async function getDimensionLockSettingsStatus(config, paths, platform = null) {
  const result = { supported: false, canEdit: false, worldName: config.levelName, revision: '', message: '' };
  try {
    const state = await dimensionLockSettings.readState(paths.root, config.levelName);
    Object.assign(result, { revision: state.revision, exists: state.exists,
      end: dimensionLockSettings.describeLock(state.state.end), nether: dimensionLockSettings.describeLock(state.state.nether) });
    const runtime = platform || await getServerPlatformStatus(config, paths);
    result.supported = dimensionLockSettings.isSupported(config, runtime) && runtime.verified === true;
    if (!result.supported) {
      result.canUnlock = !serverProcess && serverState === 'stopped' && (state.state.end.locked || state.state.nether.locked);
      result.message = result.canUnlock
        ? 'This server software cannot enforce dimension locks. Turn off saved locks here while stopped, or select verified Fabric 26.2.'
        : 'Dimension locks require verified Fabric 26.2 with Loader 0.19.5 or later. No client mod is needed.';
      return result;
    }
    const index = await getModDescriptorIndex(paths);
    const installed = index.files.filter(entry => entry.descriptor?.fabricModId === dimensionLockSettings.MOD_ID);
    if (!state.exists && installed.length === 1 && dimensionLockSettings.isLockMod(installed[0].descriptor)) {
      result.end.locked = true;
      config.lockEnd = true;
    }
    result.installed = !index.partial && installed.length === 1 && dimensionLockSettings.isLockMod(installed[0].descriptor) && installed[0].descriptor.fabricVersion === '1.2.0';
    if (serverProcess && (!isServerRuntimeReady() || !result.installed)) {
      result.message = 'Stop the server to prepare dimension locks, then start it again. No client mod is needed.';
      return result;
    }
    result.canEdit = !index.partial && installed.length <= 1 && (!serverProcess || serverState === 'running');
    result.message = result.canEdit
      ? result.installed ? 'Locked dimensions stay closed until opened manually. Automatic opening runs only when enabled; its timer starts on Save, or on the next start if the server is stopped.'
        : 'The server-only dimension-lock mod will be prepared at the next server start.'
      : 'Resolve duplicate or unreadable dimension-lock mods before changing these settings.';
  } catch (error) { result.message = `Dimension locks are unavailable: ${error.message}`; }
  return result;
}

async function applyDimensionLockSettingsRequest(input, previous, paths) {
  const request = dimensionLockSettings.requestedChanges(input?._dimensionLockChanges);
  if (!request || !Object.keys(request.changes).length) return null;
  if (request.worldName !== previous.levelName || input.levelName !== previous.levelName ||
      ![previous.serverType, previous.requestedServerType].includes(input.serverType) ||
      ![previous.serverVersion, previous.requestedServerVersion].includes(input.serverVersion)) {
    throw new Error('Save world or server software changes separately, then reopen Settings before changing dimension locks.');
  }
  const processRef = serverProcess, generation = serverLifecycleGeneration;
  const profile = await getActiveProfile();
  if (request.profileId !== profile.id || path.resolve(getPathsForProfile(profile).root) !== path.resolve(paths.root)) {
    throw new Error('The selected server changed. Reopen Settings before changing dimension locks.');
  }
  const revalidate = async () => {
    const current = await getActiveProfile();
    if (current.id !== profile.id || serverProcess !== processRef || serverLifecycleGeneration !== generation ||
      (processRef ? !isServerRuntimeReady() : serverState !== 'stopped')) throw new Error('The server changed while saving dimension locks. Reload Settings and try again.');
  };
  await revalidate();
  const available = await getDimensionLockSettingsStatus(previous, paths);
  const unlockOnly = available.canUnlock && Object.entries(dimensionLockSettings.normalizeChanges(request.changes))
    .every(([key, desired]) => !desired.locked && !desired.autoOpen && available[dimensionLockSettings.KEYS[key]]?.locked);
  if (!available.canEdit && !unlockOnly) throw new Error(available.message);
  if (processRef) return dimensionLockSettings.applyRunningChanges({
    root: paths.root, worldName: previous.levelName, request, revalidate, sendCommand: sendServerCommand
  });
  return dimensionLockSettings.writeChanges(paths.root, previous.levelName, request.changes, request.revision, revalidate);
}

async function prepareDimensionLocksBeforeStart({ paths, serverConfig, platform, revalidate }) {
  if (!dimensionLockSettings.isSupported(serverConfig, platform) || !platform.verified) {
    if (serverConfig.lockNether || serverConfig.lockEnd) throw new Error('Enabled dimension locks require verified Fabric 26.2 with Loader 0.19.5 or later.');
    return { installed: false };
  }
  const state = await dimensionLockSettings.readState(paths.root, serverConfig.levelName);
  const dependency = await findBundledDeathLootDependencyArtifact(getBundledDeathLootAdapter('fabric', '26.2'));
  const prepared = await dimensionLockSettings.prepareRuntime({
    root: paths.root, mods: paths.mods,
    artifact: path.join(__dirname, 'server-end-lock-fabric', 'dist', dimensionLockSettings.ARTIFACT),
    dependency, inspectJar: inspectAntiCheatJar, getIndex: () => {
      modDescriptorIndexStore.invalidate(`${path.resolve(paths.root)}${path.sep}mods-index`, paths.mods);
      return getModDescriptorIndex(paths);
    }, revalidate
  });
  modDescriptorIndexStore.invalidate(`${path.resolve(paths.root)}${path.sep}mods-index`, paths.mods);
  if (!state.exists) {
    // Legacy installed releases default End to locked. A new managed profile
    // defaults both switches off. Existing state is never rewritten on upgrade.
    await dimensionLockSettings.writeChanges(paths.root, serverConfig.levelName, {
      lockNether: serverConfig.lockNether === true,
      lockEnd: prepared.previouslyInstalled ? true : serverConfig.lockEnd === true
    }, 'missing', revalidate);
  }
  if (prepared.updated) appendServerLog('[Server Manager] Prepared server-only Nether and End lock controls. No client mod is required.\n');
  return prepared;
}

async function prepareTeamsBeforeStart({ paths, serverConfig, platform, revalidate }) {
  if (!teamsRuntime.isSupported(serverConfig, platform)) return { installed: false };
  const prepared = await teamsRuntime.prepareRuntime({
    root: paths.root, mods: paths.mods,
    artifact: path.join(__dirname, 'server-teams-fabric', 'dist', teamsRuntime.ARTIFACT),
    dependency: await findBundledDeathLootDependencyArtifact(getBundledDeathLootAdapter('fabric', '26.2')),
    inspectJar: inspectAntiCheatJar,
    getIndex: () => {
      modDescriptorIndexStore.invalidate(`${path.resolve(paths.root)}${path.sep}mods-index`, paths.mods);
      return getModDescriptorIndex(paths);
    },
    revalidate
  });
  modDescriptorIndexStore.invalidate(`${path.resolve(paths.root)}${path.sep}mods-index`, paths.mods);
  if (prepared.updated) appendServerLog('[Server Manager] Prepared Teams commands. Use /teams help; no client mod is required.\n');
  return prepared;
}

function getStatus() {
  const ttlMs = serverState === 'running' || serverState === 'starting'
    ? STATUS_RUNNING_TTL_MS
    : STATUS_STOPPED_TTL_MS;
  if (cachedStatus && Date.now() - cachedStatusAt < ttlMs) return Promise.resolve(cachedStatus);
  const generation = statusCacheGeneration;
  const key = `status-build:${generation}`;
  if (inFlightWork.has(key)) return inFlightWork.get(key);
  const pending = buildStatus(generation)
    .then((result) => generation === statusCacheGeneration ? result : getStatus())
    .finally(() => inFlightWork.delete(key));
  inFlightWork.set(key, pending);
  return pending;
}

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

async function selectServerJar() {
  const profileSnapshot = await captureActiveServerToolProfile('a custom server JAR');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a Minecraft server jar',
    properties: ['openFile'],
    filters: [{ name: 'Java archives', extensions: ['jar'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = path.resolve(result.filePaths[0]);
  return serverToolMutationCoordinator.run(`platform:select-custom:${profileSnapshot.profileId}`, async () => {
    const paths = await revalidateServerToolProfile(profileSnapshot, 'a custom server JAR');
    const stat = await fs.stat(selected);
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_SERVER_JAR_BYTES) {
      throw new Error(`The selected server JAR must be a regular file smaller than ${Math.floor(MAX_SERVER_JAR_BYTES / 1024 / 1024)} MiB.`);
    }
    const handle = await fs.open(selected, 'r');
    const signature = Buffer.alloc(4);
    try { await handle.read(signature, 0, signature.length, 0); }
    finally { await handle.close(); }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('The selected file is not a valid JAR archive.');
    const [sha256, minecraftVersion] = await Promise.all([
      calculateFileHash(selected, 'sha256'),
      readServerJarVersion(selected)
    ]);
    await revalidateServerToolProfile(profileSnapshot, 'a custom server JAR');
    const config = await readConfig(paths);
    const declaredType = normalizeServerType(config.serverType);
    const next = await writeConfig({ ...config, jarPath: selected, serverVersion: minecraftVersion || 'custom' }, paths);
    await writePlatformMetadata(paths, {
      type: 'custom',
      declaredType,
      minecraftVersion: minecraftVersion || '',
      jarPath: selected,
      source: 'local-file',
      sha256,
      size: stat.size,
      verified: true,
      userApprovedPlatform: true,
      installedAt: new Date().toISOString()
    });
    return next;
  });
}

async function importJarFiles(kind) {
  const normalizedKind = normalizeAddonKind(kind);
  const profileSnapshot = await captureActiveServerToolProfile(`custom ${normalizedKind}`);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Add ${normalizedKind}`,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Java archives', extensions: ['jar'] }]
  });
  if (result.canceled) return [];
  if (!result.filePaths.length) return [];
  if (result.filePaths.length > MAX_CUSTOM_ADDON_IMPORT_FILES) {
    throw new Error(`Import at most ${MAX_CUSTOM_ADDON_IMPORT_FILES} add-ons at once.`);
  }
  return serverToolMutationCoordinator.run(`addons:import:${profileSnapshot.profileId}`, async () => {
    const paths = await revalidateServerToolProfile(profileSnapshot, `custom ${normalizedKind}`);
    const targetDir = getAddonTargetDir(paths, normalizedKind);
    await fs.mkdir(targetDir, { recursive: true });
    const selectedFiles = result.filePaths.map((selected) => ({
      selected: path.resolve(selected),
      file: cleanAddonFileName(path.basename(selected))
    }));
    const duplicateNames = new Set();
    for (const entry of selectedFiles) {
      if (!entry.file.toLowerCase().endsWith('.jar')) throw new Error(`${entry.file} is not a JAR file.`);
      const key = process.platform === 'win32' ? entry.file.toLowerCase() : entry.file;
      if (duplicateNames.has(key)) throw new Error(`More than one selected add-on would be named ${entry.file}.`);
      duplicateNames.add(key);
    }
    if (normalizedKind === 'plugins' && selectedFiles.some(({ file }) =>
      [BUNDLED_PROTECTION_JAR, LEGACY_BUNDLED_PROTECTION_JAR].some(reserved => file.toLowerCase() === reserved.toLowerCase()))) {
      throw new Error('Use the Protection page to manage the bundled Server Protection plugin.');
    }
    if (normalizedKind === 'mods' && selectedFiles.some(({ file }) =>
      [BUNDLED_PROTECTION_FABRIC_JAR, ...BUNDLED_PROTECTION_FABRIC_API_JARS]
        .some(reserved => file.toLowerCase() === reserved.toLowerCase()))) {
      throw new Error('Use the Protection page to manage the bundled Fabric protection files.');
    }
    const inspected = await mapWithConcurrency(selectedFiles, 4, async (entry) => {
      const stat = await fs.stat(entry.selected);
      if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ADDON_BYTES) {
        throw new Error(`${entry.file} must be a regular JAR smaller than ${Math.floor(MAX_ADDON_BYTES / 1024 / 1024)} MiB.`);
      }
      const handle = await fs.open(entry.selected, 'r');
      const signature = Buffer.alloc(4);
      try { await handle.read(signature, 0, signature.length, 0); }
      finally { await handle.close(); }
      if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error(`${entry.file} is not a valid JAR archive.`);
      const descriptor = await inspectJarDescriptor(entry.selected);
      if (isRetiredLavaSourceInspection(descriptor)) {
        throw new Error(`${entry.file} is Lava Source ${RETIRED_LAVA_SOURCE_VERSION}, which is blocked because its every-tick scanner can freeze the server.`);
      }
      if (descriptor.pluginName === BUNDLED_PROTECTION_NAME ||
          descriptor.fabricModId === BUNDLED_PROTECTION_FABRIC_MOD_ID ||
          (normalizedKind === 'mods' && descriptor.fabricModId === 'fabric-api')) {
        throw new Error(`${entry.file} declares an identity managed by the Protection page.`);
      }
      return { ...entry, stat, descriptor };
    });
    const totalBytes = inspected.reduce((sum, entry) => sum + entry.stat.size, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CUSTOM_ADDON_IMPORT_BYTES) {
      throw new Error(`The selected add-ons exceed the ${Math.floor(MAX_CUSTOM_ADDON_IMPORT_BYTES / 1024 / 1024)} MiB import limit.`);
    }
    try {
      const disk = await fs.statfs(targetDir);
      const availableBytes = Number(disk.bavail) * Number(disk.bsize);
      if (Number.isFinite(availableBytes) && availableBytes < totalBytes + ADDON_IMPORT_DISK_RESERVE_BYTES) {
        throw new Error('There is not enough free disk space to import these add-ons safely.');
      }
    } catch (error) {
      if (/not enough free disk space/i.test(String(error?.message || ''))) throw error;
    }

    const prepared = [];
    try {
      for (const entry of inspected) {
        const destination = resolveContainedPath(targetDir, path.join(targetDir, entry.file));
        if (path.resolve(entry.selected) === path.resolve(destination)) {
          prepared.push({ ...entry, destination, temporary: '', alreadyPresent: true });
          continue;
        }
        const temporary = `${destination}.import-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
        const preparedEntry = { ...entry, destination, temporary, alreadyPresent: false };
        prepared.push(preparedEntry);
        await fs.copyFile(entry.selected, temporary, fss.constants.COPYFILE_EXCL);
        const [copied, sourceAfter] = await Promise.all([fs.stat(temporary), fs.stat(entry.selected)]);
        if (!copied.isFile() || copied.size !== entry.stat.size || sourceAfter.size !== entry.stat.size ||
            sourceAfter.mtimeMs !== entry.stat.mtimeMs || sourceAfter.ctimeMs !== entry.stat.ctimeMs) {
          throw new Error(`${entry.file} changed or was truncated during import.`);
        }
      }
      await revalidateServerToolProfile(profileSnapshot, `custom ${normalizedKind}`);
      for (const entry of prepared) {
        if (!entry.alreadyPresent) {
          await replaceFileAtomically(entry.temporary, entry.destination);
          entry.temporary = '';
        }
        await upsertInstalledAddonMetadata(paths, {
          kind: normalizedKind,
          file: entry.file,
          source: 'imported',
          title: entry.file.replace(/\.jar$/i, ''),
          installedAt: new Date().toISOString()
        });
      }
    } finally {
      await Promise.all(prepared.map(entry => entry.temporary ? fs.rm(entry.temporary, { force: true }).catch(() => {}) : null));
    }
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    return listManagedAddonFiles(paths, normalizedKind);
  });
}

async function deleteManagedJar(kind, name, profileSnapshotOverride = null) {
  const normalizedKind = normalizeAddonKind(kind);
  const fileName = String(name || '');
  if (!fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) {
    throw new Error('Refusing to delete an invalid add-on path.');
  }
  if (normalizedKind === 'plugins' && [BUNDLED_PROTECTION_JAR, LEGACY_BUNDLED_PROTECTION_JAR]
    .some(reserved => fileName.toLowerCase() === reserved.toLowerCase())) {
    throw new Error('Use the Protection page to remove the bundled Server Protection plugin safely.');
  }
  if (normalizedKind === 'mods' && [BUNDLED_PROTECTION_FABRIC_JAR, ...BUNDLED_PROTECTION_FABRIC_API_JARS]
    .some(reserved => fileName.toLowerCase() === reserved.toLowerCase())) {
    throw new Error('Use the Protection page to remove the bundled Fabric protection files safely.');
  }
  const profileSnapshot = profileSnapshotOverride || await captureActiveServerToolProfile(`custom ${normalizedKind}`);
  await revalidateServerToolProfile(profileSnapshot, `custom ${normalizedKind}`);
  const teleportFile = normalizedKind === 'plugins'
    ? fileName.toLowerCase() === BUNDLED_TELEPORT_JAR.toLowerCase()
    : fileName.toLowerCase() === BUNDLED_TELEPORT_FABRIC_JAR.toLowerCase();
  if (teleportFile) {
    const teleport = await getBundledTeleportStatus(profileSnapshot.paths);
    if (teleport.managed) return removeBundledTeleport(profileSnapshot);
  }
  const voiceFile = normalizedKind === 'plugins'
    ? fileName.toLowerCase() === BUNDLED_VOICE_SERVER_JAR.toLowerCase()
    : fileName.toLowerCase() === BUNDLED_VOICE_FABRIC_SERVER_JAR.toLowerCase();
  if (voiceFile) {
    const voice = await getBundledVoiceStatus(profileSnapshot.paths);
    if (voice.managed) return removeBundledVoice(profileSnapshot);
  }
  return serverToolMutationCoordinator.run(`addons:delete:${normalizedKind}:${fileName}`, async () => {
    const paths = await revalidateServerToolProfile(profileSnapshot, `custom ${normalizedKind}`);
    const targetDir = getAddonTargetDir(paths, normalizedKind);
    const fullPath = resolveContainedPath(targetDir, path.join(targetDir, fileName));
    let removedSimpleVoiceChat = false;
    let removedDescriptor = null;
    try {
      removedDescriptor = await inspectJarDescriptor(fullPath);
      removedSimpleVoiceChat = detectSimpleVoiceChatIdentity(removedDescriptor, fileName).matches;
    } catch {
      removedSimpleVoiceChat = detectSimpleVoiceChatIdentity({}, fileName).matches;
    }
    await revalidateServerToolProfile(profileSnapshot, `custom ${normalizedKind}`);
    const quarantine = `${fullPath}.removing-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.rename(fullPath, quarantine);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rm(quarantine, { force: true });
    } catch (error) {
      await fs.rename(quarantine, fullPath).catch(() => {});
      throw error;
    }
    await removeInstalledAddonMetadata(paths, normalizedKind, fileName);
    const removedTeleportIdentity = teleportFile || removedDescriptor?.pluginName === BUNDLED_TELEPORT_NAME ||
      removedDescriptor?.fabricModId === BUNDLED_TELEPORT_FABRIC_MOD_ID;
    const removedVoiceIdentity = voiceFile || removedDescriptor?.pluginName === BUNDLED_VOICE_NAME ||
      removedDescriptor?.fabricModId === BUNDLED_VOICE_FABRIC_SERVER_MOD_ID;
    if (removedTeleportIdentity || removedVoiceIdentity) {
      const tools = await readServerToolsMetadata(paths);
      await writeServerToolsMetadata(paths, {
        ...tools,
        version: 2,
        ...(removedTeleportIdentity ? { teleport: null } : {}),
        ...(removedVoiceIdentity ? { voice: null } : {})
      });
    }
    if (removedSimpleVoiceChat) {
      const config = await readConfig(paths);
      const remaining = await findSimpleVoiceChatProviders(paths, config).catch((error) => ({
        provider: null,
        complete: false,
        warning: String(error?.message || error || 'Voice add-on scan failed.')
      }));
      if (!remaining.provider && (!remaining.complete || serverProcess)) {
        appendServerLog(
          `[Server Manager SRV-VOICE-306] Voice network cleanup deferred: ${serverProcess
            ? 'the running server may still be using Simple Voice Chat until restart.'
            : remaining.warning || 'the remaining add-on scan was incomplete.'}\n`
        );
      } else if (!remaining.provider) {
        const metadata = await readVoiceNetworkMetadata(paths);
        const cleanupErrors = [];
        await unmapManagedVoiceUdp(metadata.udpPort || config.voiceUdpPort, profileSnapshot.profileId).catch((error) => {
          cleanupErrors.push(`router mapping: ${error.message || String(error)}`);
        });
        const firewall = await cleanupProfileFirewallRules({
          profileId: profileSnapshot.profileId,
          profileName: profileSnapshot.profileId
        });
        if (firewall.supported && !firewall.ok) {
          cleanupErrors.push(`Windows Firewall: ${firewall.message || firewall.code}`);
        }
        if (!cleanupErrors.length && config.voiceUdpPort) {
          await writeConfig({ ...config, voiceUdpPort: 0 }, paths);
        }
        await writeVoiceNetworkMetadata(paths, cleanupErrors.length
          ? {
              ...metadata,
              warning: `Managed voice-network cleanup is pending: ${cleanupErrors.join(' · ')}`.slice(0, 512),
              updatedAt: new Date().toISOString()
            }
          : { updatedAt: new Date().toISOString() });
        if (cleanupErrors.length) {
          appendServerLog(`[Server Manager SRV-VOICE-307] Voice network cleanup will retry: ${cleanupErrors.join(' · ')}\n`);
        }
      }
    }
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    return listManagedAddonFiles(paths, normalizedKind);
  });
}

function normalizeAddonKind(kind) {
  return kind === 'plugins' ? 'plugins' : 'mods';
}

function getAddonTargetDir(paths, kind) {
  return normalizeAddonKind(kind) === 'plugins' ? paths.plugins : paths.mods;
}

function cleanAddonFileName(name) {
  return String(name || 'addon.jar')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'addon.jar';
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

function getPreferredAddonLoaders(kind, serverType = 'vanilla') {
  const support = getServerTypeAddonSupport(serverType);
  return normalizeAddonKind(kind) === 'plugins' ? support.plugins : support.mods;
}

const CURSEFORGE_LOADER_TYPES = Object.freeze({ forge: 1, fabric: 4, quilt: 5, neoforge: 6 });

function getCurseForgeLoaderType(kind, serverType) {
  if (normalizeAddonKind(kind) === 'plugins') return null;
  return CURSEFORGE_LOADER_TYPES[normalizeServerType(serverType)] ?? null;
}

function normalizeAddonVersion(version) {
  const value = String(version || '').trim();
  if (!value || value === 'latest' || value === 'custom') return '';
  return value;
}

function mapModrinthHit(hit) {
  return {
    source: 'modrinth',
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    iconUrl: hit.icon_url || '',
    author: hit.author,
    downloads: hit.downloads || 0,
    follows: hit.follows || 0,
    categories: hit.categories || [],
    versions: hit.versions || [],
    loaders: hit.display_categories || [],
    updatedAt: hit.date_modified || '',
    clientSide: hit.client_side || '',
    serverSide: hit.server_side || hit.environment || '',
    environment: hit.environment || '',
    url: `https://modrinth.com/${hit.project_type}/${hit.slug}`
  };
}

function mapCurseForgeHit(mod) {
  const logo = mod.logo?.thumbnailUrl || mod.logo?.url || '';
  return {
    source: 'curseforge',
    id: String(mod.id),
    slug: mod.slug || String(mod.id),
    title: mod.name,
    description: mod.summary || '',
    iconUrl: logo,
    author: (Array.isArray(mod.authors) ? mod.authors : []).slice(0, 20).map((author) => author.name).join(', ') || 'CurseForge',
    downloads: mod.downloadCount || 0,
    follows: 0,
    categories: (Array.isArray(mod.categories) ? mod.categories : []).slice(0, 32).map((category) => category.name).filter(Boolean),
    versions: (Array.isArray(mod.latestFilesIndexes) ? mod.latestFilesIndexes : []).slice(0, 100).map((file) => file.gameVersion).filter(Boolean).slice(0, 12),
    loaders: (Array.isArray(mod.latestFilesIndexes) ? mod.latestFilesIndexes : []).slice(0, 100).map((file) => file.modLoader).filter(Boolean).slice(0, 8),
    updatedAt: mod.dateModified || '',
    clientSide: '',
    serverSide: '',
    url: mod.links?.websiteUrl || ''
  };
}

async function getCurseForgeApiKey() {
  const environmentKey = String(process.env.CURSEFORGE_API_KEY || process.env.CF_API_KEY || '').trim();
  if (environmentKey) return environmentKey;
  const paths = await getPaths();
  return getCachedWork(`curseforge-key:${paths.root}`, 30_000, async () => {
    if (!safeStorage?.isEncryptionAvailable?.()) return '';
    try {
      const secrets = await readJson(paths.secrets, {});
      if (!secrets.curseForgeApiKey) return '';
      return safeStorage.decryptString(Buffer.from(secrets.curseForgeApiKey, 'base64')).trim();
    } catch {
      return '';
    }
  });
}

function getCurseForgeHeaders(apiKey) {
  const key = String(apiKey || '').trim();
  return { 'x-api-key': key };
}

async function getCurseForgeKeyStatus() {
  const environmentKey = String(process.env.CURSEFORGE_API_KEY || process.env.CF_API_KEY || '').trim();
  const storedKey = environmentKey ? '' : await getCurseForgeApiKey();
  const encryptionAvailable = Boolean(safeStorage?.isEncryptionAvailable?.());
  return {
    configured: Boolean(environmentKey || storedKey),
    source: environmentKey ? 'environment' : storedKey ? 'profile' : 'none',
    encrypted: environmentKey ? null : encryptionAvailable,
    canStore: encryptionAvailable,
    message: environmentKey
      ? 'CurseForge is connected using the environment configuration.'
      : storedKey
        ? 'CurseForge is connected for this server profile.'
        : encryptionAvailable
          ? 'Add a CurseForge API key to browse CurseForge in this profile.'
          : 'Secure OS key storage is unavailable. Use CURSEFORGE_API_KEY instead.'
  };
}

async function setCurseForgeApiKey(value) {
  const key = String(value || '').trim();
  if (/\r|\n/.test(key) || key.length > 512) throw new Error('Invalid CurseForge API key.');
  if (key && key.length < 16) throw new Error('The CurseForge API key is too short.');
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error('Secure OS key storage is unavailable. Set CURSEFORGE_API_KEY in the environment instead.');
  }
  let verified = false;
  let verificationMessage = '';
  if (key) {
    try {
      await getJson('https://api.curseforge.com/v1/games/432', getCurseForgeHeaders(key));
      verified = true;
    } catch (error) {
      if ([401, 403].includes(error.statusCode)) throw new Error('CurseForge rejected that API key.');
      verificationMessage = 'The key was saved, but CurseForge could not be reached to verify it.';
    }
  }
  const paths = await getPaths();
  const secrets = await readJson(paths.secrets, {});
  if (key) secrets.curseForgeApiKey = safeStorage.encryptString(key).toString('base64');
  else delete secrets.curseForgeApiKey;
  const temporary = `${paths.secrets}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  await replaceFileAtomically(temporary, paths.secrets);
  invalidateCachedWork(`curseforge-key:${paths.root}`);
  return { ...await getCurseForgeKeyStatus(), verified: key ? verified : false, message: verificationMessage || (key ? 'CurseForge API key saved securely for this server profile.' : 'CurseForge API key removed from this server profile.') };
}

async function searchAddons(options = {}) {
  const kind = normalizeAddonKind(options.kind);
  const source = options.source === 'curseforge' ? 'curseforge' : 'modrinth';
  const query = String(options.query || '').trim().slice(0, 200);
  const limit = Math.min(40, Math.max(6, Number(options.limit) || 20));
  const requestedOffset = Number(options.offset);
  const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const config = await readConfig();
  const serverType = normalizeServerType(options.serverType || config.serverType);
  const gameVersion = normalizeAddonVersion(options.gameVersion || config.serverVersion);
  const loaders = getPreferredAddonLoaders(kind, serverType);
  const platform = await getServerPlatformStatus(config);
  if (!loaders.length) {
    return {
      source,
      kind,
      needsKey: false,
      offset,
      limit,
      nextOffset: offset,
      hasMore: false,
      total: 0,
      message: serverType === 'vanilla'
        ? 'Vanilla servers do not load mods or plugins. Pick Fabric, Forge, NeoForge, Paper, Purpur, or Spigot in Config.'
        : `No ${kind} are compatible with ${serverType}.`,
      compatibility: { serverType, gameVersion, loaders, platform },
      results: []
    };
  }
  if (source === 'curseforge') {
    const apiKey = await getCurseForgeApiKey();
    if (!apiKey) {
      return {
        source,
        kind,
        needsKey: true,
        offset,
        limit,
        nextOffset: offset,
        hasMore: false,
        total: 0,
        message: 'CurseForge is optional and needs a CurseForge API key. Modrinth works without a key.',
        compatibility: { serverType, gameVersion, loaders, platform },
        results: []
      };
    }
    const params = new URLSearchParams({
      gameId: '432',
      pageSize: String(limit),
      index: String(offset),
      sortField: '2',
      sortOrder: 'desc'
    });
    if (query) params.set('searchFilter', query);
    params.set('classId', kind === 'plugins' ? '5' : '6');
    if (gameVersion) params.set('gameVersion', gameVersion);
    const modLoaderType = getCurseForgeLoaderType(kind, serverType);
    if (gameVersion && modLoaderType !== null) params.set('modLoaderType', String(modLoaderType));
    const data = await getCachedWork(`addon-search:curseforge:${params}`, 15_000, () =>
      getJson(`https://api.curseforge.com/v1/mods/search?${params}`, getCurseForgeHeaders(apiKey), { maxBytes: MAX_ADDON_JSON_BYTES })
    );
    const rawResults = Array.isArray(data.data) ? data.data : [];
    const total = Number(data.pagination?.totalCount) || 0;
    const nextOffset = offset + rawResults.length;
    return {
      source,
      kind,
      needsKey: false,
      offset,
      limit,
      nextOffset,
      hasMore: rawResults.length > 0 && nextOffset < total,
      total,
      compatibility: { serverType, gameVersion, loaders, platform },
      results: rawResults.slice(0, limit).map(mapCurseForgeHit)
    };
  }
  const facets = [[`project_type:${kind === 'plugins' ? 'plugin' : 'mod'}`]];
  facets.push(loaders.map((loader) => `categories:${loader}`));
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    offset: String(offset),
    index: 'relevance',
    facets: JSON.stringify(facets)
  });
  const data = await getCachedWork(`addon-search:modrinth:${params}`, 15_000, () =>
    getJson(`https://api.modrinth.com/v2/search?${params}`, {}, { maxBytes: MAX_ADDON_JSON_BYTES })
  );
  const rawHits = Array.isArray(data.hits) ? data.hits : [];
  const resultOffset = Math.max(0, Number(data.offset) || offset);
  const total = Math.max(0, Number(data.total_hits) || 0);
  const nextOffset = resultOffset + rawHits.length;
  return {
    source,
    kind,
    needsKey: false,
    offset: resultOffset,
    limit,
    nextOffset,
    hasMore: rawHits.length > 0 && nextOffset < total,
    total,
    compatibility: { serverType, gameVersion, loaders, platform },
    results: rawHits
      .slice(0, limit)
      .filter((hit) => String(hit.server_side || '').toLowerCase() !== 'unsupported')
      .map(mapModrinthHit)
  };
}

async function getAddonDetails(options = {}) {
  const source = options.source === 'curseforge' ? 'curseforge' : 'modrinth';
  const id = String(options.id || options.slug || '').trim();
  if (!id) throw new Error('Missing addon id.');
  const config = await readConfig();
  const kind = normalizeAddonKind(options.kind);
  const serverType = normalizeServerType(options.serverType || config.serverType);
  const gameVersion = normalizeAddonVersion(options.gameVersion || config.serverVersion);
  if (source === 'curseforge') {
    const apiKey = await getCurseForgeApiKey();
    if (!apiKey) throw new Error('CurseForge needs an API key. Select Modrinth or configure CURSEFORGE_API_KEY.');
    const fileParams = new URLSearchParams({ pageSize: '50', index: '0' });
    if (gameVersion) fileParams.set('gameVersion', gameVersion);
    const modLoaderType = getCurseForgeLoaderType(kind, serverType);
    if (gameVersion && modLoaderType !== null) fileParams.set('modLoaderType', String(modLoaderType));
    const [mod, files] = await Promise.all([
      getCachedWork(`addon-detail:curseforge:${id}`, 30_000, () =>
        getJson(`https://api.curseforge.com/v1/mods/${encodeURIComponent(id)}`, getCurseForgeHeaders(apiKey), { maxBytes: MAX_ADDON_JSON_BYTES })
      ),
      getCachedWork(`addon-files:curseforge:${id}:${fileParams}`, 30_000, () =>
        getJson(`https://api.curseforge.com/v1/mods/${encodeURIComponent(id)}/files?${fileParams}`, getCurseForgeHeaders(apiKey), { maxBytes: MAX_ADDON_JSON_BYTES })
      )
    ]);
    return {
      ...mapCurseForgeHit(mod.data || {}), body: mod.data?.summary || '', files: (Array.isArray(files.data) ? files.data : []).slice(0, 200),
      compatibility: { kind, serverType, gameVersion, loaders: getPreferredAddonLoaders(kind, serverType) }
    };
  }
  const project = await getCachedWork(`addon-detail:modrinth:${id}`, 30_000, () =>
    getJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`, {}, { maxBytes: MAX_ADDON_JSON_BYTES })
  );
  let versions;
  if (options.versionId) {
    versions = [await getCachedWork(`addon-version:modrinth:${options.versionId}`, 30_000, () =>
      getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(options.versionId)}`, {}, { maxBytes: MAX_ADDON_JSON_BYTES })
    )];
  } else {
    const params = new URLSearchParams({ include_changelog: 'false' });
    const loaders = getPreferredAddonLoaders(kind, serverType);
    if (loaders.length) params.set('loaders', JSON.stringify(loaders));
    if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
    versions = await getCachedWork(`addon-files:modrinth:${project.id || id}:${params}`, 30_000, () =>
      getJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(project.id || id)}/version?${params}`, {}, { maxBytes: MAX_ADDON_JSON_BYTES })
    );
  }
  return {
    source,
    id: project.id,
    slug: project.slug,
    title: project.title,
    description: project.description,
    body: project.body || '',
    iconUrl: project.icon_url || '',
    downloads: project.downloads || 0,
    follows: project.followers || 0,
    categories: (Array.isArray(project.categories) ? project.categories : []).slice(0, 32),
    versions: (Array.isArray(project.game_versions) ? project.game_versions : []).slice(0, 100),
    loaders: (Array.isArray(project.loaders) ? project.loaders : []).slice(0, 32),
    updatedAt: project.updated || '',
    clientSide: project.client_side || '',
    serverSide: project.server_side || '',
    url: `https://modrinth.com/${project.project_type}/${project.slug}`,
    files: (Array.isArray(versions) ? versions : []).slice(0, 200),
    compatibility: { kind, serverType, gameVersion, loaders: getPreferredAddonLoaders(kind, serverType) }
  };
}

function isServerCompatibleEnvironment(value) {
  return !['client_only', 'singleplayer_only'].includes(String(value || '').toLowerCase());
}

function isInstallableModrinthJar(file) {
  return /\.jar$/i.test(String(file?.filename || '')) &&
    !['sources-jar', 'dev-jar', 'javadoc-jar', 'signature'].includes(String(file?.file_type || ''));
}

function chooseModrinthFile(files, kind, gameVersion, serverType = 'vanilla', versionId = '') {
  const preferredLoaders = getPreferredAddonLoaders(kind, serverType);
  const candidates = (files || []).filter((version) => {
    const hasJar = version.files?.some(isInstallableModrinthJar);
    const matchesVersion = !gameVersion || version.game_versions?.includes(gameVersion);
    const matchesLoader = version.loaders?.some((loader) => preferredLoaders.includes(loader));
    const matchesId = !versionId || version.id === versionId;
    return hasJar && matchesVersion && matchesLoader && matchesId && isServerCompatibleEnvironment(version.environment);
  }).sort((a, b) => {
    const releaseRank = { release: 0, beta: 1, alpha: 2 };
    return (releaseRank[a.version_type] ?? 3) - (releaseRank[b.version_type] ?? 3) ||
      String(b.date_published || '').localeCompare(String(a.date_published || ''));
  });
  const version = candidates[0];
  if (!version) return null;
  const file = version.files.find((entry) => entry.primary && isInstallableModrinthJar(entry))
    || version.files.find(isInstallableModrinthJar);
  return file ? { version, file } : null;
}

function chooseCurseForgeFile(files, kind, gameVersion, serverType, fileId = '') {
  const knownLoaderTags = ['forge', 'fabric', 'quilt', 'neoforge', 'bukkit', 'spigot', 'paper', 'purpur'];
  const supportedLoaders = new Set(getPreferredAddonLoaders(kind, serverType));
  return (files || []).filter((file) => {
    const name = file.fileName || file.filename || '';
    const matchesVersion = !gameVersion || file.gameVersions?.includes(gameVersion);
    const tags = (file.gameVersions || []).map((entry) => String(entry).toLowerCase());
    const declaredLoaders = tags.filter((entry) => knownLoaderTags.includes(entry));
    const matchesLoader = !declaredLoaders.length || declaredLoaders.some((entry) => supportedLoaders.has(entry));
    const matchesId = !fileId || String(file.id) === String(fileId);
    return /\.jar$/i.test(String(name)) && matchesVersion && matchesLoader && matchesId && file.isAvailable !== false;
  }).sort((a, b) => (Number(a.releaseType) || 4) - (Number(b.releaseType) || 4) ||
    String(b.fileDate || '').localeCompare(String(a.fileDate || '')))[0] || null;
}

function describeAddonProviderSelection(source, selected) {
  if (!selected) return null;
  const version = source === 'curseforge' ? null : selected.version;
  const file = source === 'curseforge' ? selected : selected.file;
  if (!file) return null;
  const expectedHashes = source === 'curseforge'
    ? getCurseForgeHashes(file)
    : file.hashes?.sha512
      ? { sha512: file.hashes.sha512 }
      : file.hashes?.sha1
        ? { sha1: file.hashes.sha1 }
        : {};
  return {
    file,
    version,
    providerVersionId: String(source === 'curseforge' ? file.id || '' : version?.id || '').trim(),
    providerFileId: String(source === 'curseforge' ? file.id || '' : '').trim(),
    providerFileName: cleanAddonFileName(file.filename || file.fileName),
    versionName: String(source === 'curseforge'
      ? file.displayName || file.fileName || ''
      : version?.version_number || version?.name || '').trim().slice(0, 180),
    expectedHashes: normalizeExpectedHashes(expectedHashes),
    size: Number(file.size || file.fileLength) || 0,
    publishedAt: String(source === 'curseforge' ? file.fileDate || '' : version?.date_published || '').trim()
  };
}

function installedAddonMatchesProviderSelection(entry, selection, hashMatches = null) {
  if (!entry || !selection) return false;
  if (typeof hashMatches === 'boolean' && Object.keys(selection.expectedHashes || {}).length) return hashMatches;
  if (entry.providerVersionId && selection.providerVersionId) {
    return entry.providerVersionId === selection.providerVersionId;
  }
  if (entry.providerFileId && selection.providerFileId) {
    return entry.providerFileId === selection.providerFileId;
  }
  const installedProviderFile = String(entry.providerFileName || entry.file || '').toLowerCase();
  return Boolean(installedProviderFile && installedProviderFile === String(selection.providerFileName || '').toLowerCase());
}

function getCurseForgeHashes(file) {
  const hashes = {};
  for (const entry of file.hashes || []) {
    if (entry.algo === 1 && entry.value) hashes.sha1 = entry.value;
    if (entry.algo === 2 && entry.value) hashes.md5 = entry.value;
  }
  return hashes;
}

function normalizeExpectedHashes(value) {
  const lengths = { md5: 32, sha1: 40, sha256: 64, sha512: 128 };
  const result = {};
  for (const [algorithm, expectedLength] of Object.entries(lengths)) {
    const digest = String(value?.[algorithm] || '').toLowerCase();
    if (new RegExp(`^[a-f0-9]{${expectedLength}}$`).test(digest)) result[algorithm] = digest;
  }
  return result;
}

async function calculateFileHash(file, algorithm = 'sha256') {
  if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algorithm)) throw new Error('Unsupported file hash algorithm.');
  const hash = crypto.createHash(algorithm);
  await pipeline(fss.createReadStream(file), new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      callback();
    }
  }));
  return hash.digest('hex').toLowerCase();
}

async function fileMatchesExpectedHash(file, expectedHashes) {
  const entries = Object.entries(normalizeExpectedHashes(expectedHashes));
  if (!entries.length) return false;
  try {
    const algorithms = Object.fromEntries(entries.map(([algorithm]) => [algorithm, crypto.createHash(algorithm)]));
    await pipeline(fss.createReadStream(file), new Transform({
      transform(chunk, encoding, callback) {
        for (const hash of Object.values(algorithms)) hash.update(chunk);
        callback();
      }
    }));
    return entries.every(([algorithm, expected]) => algorithms[algorithm].digest('hex').toLowerCase() === String(expected).toLowerCase());
  } catch {
    return false;
  }
}

function isBundledTeleportAddonFile(kind, name) {
  const normalizedKind = normalizeAddonKind(kind);
  const fileName = String(name || '').toLowerCase();
  return normalizedKind === 'plugins'
    ? fileName === BUNDLED_TELEPORT_JAR.toLowerCase()
    : fileName === BUNDLED_TELEPORT_FABRIC_JAR.toLowerCase();
}

function isRetiredLavaSourceInspection(inspection) {
  if (!inspection || inspection.fabricModId !== RETIRED_LAVA_SOURCE_MOD_ID) return false;
  const version = String(inspection.fabricVersion || '').trim();
  const sha256 = String(inspection.sha256 || '').trim().toLowerCase();
  return version === RETIRED_LAVA_SOURCE_VERSION || sha256 === RETIRED_LAVA_SOURCE_SHA256;
}

function isRetiredLavaSourceProviderSelection(kind, requestedId, detail, providerSelection, fileName) {
  if (normalizeAddonKind(kind) !== 'mods') return false;
  const version = String(providerSelection?.versionName || '').trim();
  const normalizedFile = String(fileName || '').trim().toLowerCase();
  const identities = [requestedId, detail?.id, detail?.slug, detail?.title]
    .map(value => String(value || '').trim().toLowerCase().replace(/[\s_]+/gu, '-'));
  const identityMatches = identities.includes('lava-source') ||
    identities.includes(RETIRED_LAVA_SOURCE_MOD_ID.replace(/_/gu, '-')) ||
    normalizedFile === RETIRED_LAVA_SOURCE_FILE;
  const versionMatches = version
    ? version === RETIRED_LAVA_SOURCE_VERSION
    : normalizedFile === RETIRED_LAVA_SOURCE_FILE ||
      new RegExp(`^lava-source-${RETIRED_LAVA_SOURCE_VERSION.replace(/\./gu, '\\.')}(?:[+._-].*)?\\.jar$`, 'u').test(normalizedFile);
  return identityMatches && versionMatches;
}

async function checkInstalledAddonUpdate(kind, name) {
  const normalizedKind = normalizeAddonKind(kind);
  const fileName = String(name || '');
  if (!fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) {
    throw new Error('Refusing to inspect an invalid add-on path.');
  }
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Create or select a server before checking add-on updates.');
  const profileId = profile.id;
  const paths = getPathsForProfile(profile);
  const metadata = await readInstalledAddonMetadata(paths);
  const entry = metadata.addons.find(item => installedAddonKey(item.kind, item.file) === installedAddonKey(normalizedKind, fileName));
  const base = {
    profileId,
    kind: normalizedKind,
    file: fileName,
    source: entry?.source || 'imported',
    projectId: entry?.projectId || '',
    checkedAt: new Date().toISOString(),
    updateAvailable: false,
    canUpdate: false
  };
  if (isBundledTeleportAddonFile(normalizedKind, fileName)) {
    const teleport = await getBundledTeleportStatus(paths);
    const active = await getActiveProfile();
    if (active?.id !== profileId) {
      return { ...base, stale: true, message: 'The active server changed while updates were checked.' };
    }
    const managed = Boolean(teleport.installed && teleport.managed &&
      teleport.installedKind === normalizedKind &&
      String(teleport.file || '').toLowerCase() === fileName.toLowerCase());
    return {
      ...base,
      source: managed ? 'built-in' : base.source,
      managed,
      updateAvailable: Boolean(managed && teleport.updateAvailable),
      canUpdate: Boolean(managed && teleport.canInstall),
      installedVersion: managed ? teleport.installedVersion || '' : '',
      latestVersion: managed && teleport.updateAvailable ? teleport.latestVersion || '' : '',
      latestFile: managed && teleport.updateAvailable ? teleport.file : '',
      message: managed ? teleport.message : 'Manually imported add-ons are updated by importing a newer JAR.'
    };
  }
  if (!entry || !['modrinth', 'curseforge'].includes(entry.source) || !entry.projectId) {
    return { ...base, managed: false, message: 'Manually imported add-ons are updated by importing a newer JAR.' };
  }

  const config = await readConfig(paths);
  const gameVersion = normalizeAddonVersion(config.serverVersion || entry.gameVersion);
  const serverType = normalizeServerType(config.serverType || entry.serverType);
  const detail = await getAddonDetails({
    source: entry.source,
    id: entry.projectId,
    kind: normalizedKind,
    gameVersion,
    serverType
  });
  const selected = entry.source === 'curseforge'
    ? chooseCurseForgeFile(detail.files, normalizedKind, gameVersion, serverType)
    : chooseModrinthFile(detail.files, normalizedKind, gameVersion, serverType);
  const selection = describeAddonProviderSelection(entry.source, selected);
  if (!selection) {
    return {
      ...base,
      managed: true,
      message: `No compatible update is available for Minecraft ${gameVersion || 'this version'} and ${serverType}.`
    };
  }
  const expectedHashes = selection.expectedHashes || {};
  const hashMatches = Object.keys(expectedHashes).length
    ? await fileMatchesExpectedHash(resolveContainedPath(getAddonTargetDir(paths, normalizedKind), path.join(getAddonTargetDir(paths, normalizedKind), fileName)), expectedHashes)
    : null;
  const updateAvailable = !installedAddonMatchesProviderSelection(entry, selection, hashMatches);
  const active = await getActiveProfile();
  if (active?.id !== profileId) {
    return { ...base, stale: true, message: 'The active server changed while updates were checked.' };
  }
  return {
    ...base,
    managed: true,
    updateAvailable,
    canUpdate: Boolean(updateAvailable && isServerStoppedForServerToolChanges()),
    installedVersion: entry.versionName || '',
    latestVersion: selection.versionName,
    latestFile: selection.providerFileName,
    publishedAt: selection.publishedAt,
    message: updateAvailable
      ? `${selection.versionName || selection.providerFileName} is ready.`
      : 'Up to date.'
  };
}

async function updateInstalledAddon(kind, name) {
  const normalizedKind = normalizeAddonKind(kind);
  const fileName = String(name || '');
  if (!fileName || path.basename(fileName) !== fileName || !fileName.toLowerCase().endsWith('.jar')) {
    throw new Error('Refusing to update an invalid add-on path.');
  }
  if (isBundledTeleportAddonFile(normalizedKind, fileName)) return installBundledTeleport();
  const profileSnapshot = await captureActiveServerToolProfile(`${normalizedKind === 'mods' ? 'mod' : 'plugin'} updates`);
  return serverToolMutationCoordinator.run(`addons:update:${normalizedKind}:${fileName}`, async () => {
    const paths = await revalidateServerToolProfile(profileSnapshot, `${normalizedKind === 'mods' ? 'mod' : 'plugin'} updates`);
    const metadata = await readInstalledAddonMetadata(paths);
    const entry = metadata.addons.find(item => installedAddonKey(item.kind, item.file) === installedAddonKey(normalizedKind, fileName));
    if (!entry || !['modrinth', 'curseforge'].includes(entry.source) || !entry.projectId) {
      throw new Error('This add-on was imported manually. Import its newer JAR to update it.');
    }
    const config = await readConfig(paths);
    const result = await installAddon({
      source: entry.source,
      id: entry.projectId,
      kind: normalizedKind,
      gameVersion: normalizeAddonVersion(config.serverVersion || entry.gameVersion),
      serverType: normalizeServerType(config.serverType || entry.serverType),
      title: entry.title,
      author: entry.author,
      iconUrl: entry.iconUrl
    }, null, {
      paths,
      destinationFile: fileName,
      beforeCommit: () => revalidateServerToolProfile(profileSnapshot, `${normalizedKind === 'mods' ? 'mod' : 'plugin'} updates`)
    });
    await revalidateServerToolProfile(profileSnapshot, `${normalizedKind === 'mods' ? 'mod' : 'plugin'} updates`);
    return { ...result, profileId: profileSnapshot.profileId, updated: fileName };
  });
}

async function installAddonForActiveProfile(options = {}) {
  const profileSnapshot = await captureActiveServerToolProfile('add-on installs');
  return serverToolMutationCoordinator.run(`addons:install:${profileSnapshot.profileId}`, async () => {
    const paths = await revalidateServerToolProfile(profileSnapshot, 'add-on installs');
    return installAddon(options, null, {
      paths,
      beforeCommit: () => revalidateServerToolProfile(profileSnapshot, 'add-on installs')
    });
  });
}

async function resolveCurseForgeDownloadUrl(projectId, file, apiKey) {
  if (file.downloadUrl) return file.downloadUrl;
  if (!file.id) throw new Error('CurseForge did not provide a downloadable file id.');
  let result;
  try {
    result = await getJson(
      `https://api.curseforge.com/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}/download-url`,
      getCurseForgeHeaders(apiKey)
    );
  } catch (error) {
    if ([403, 404].includes(error.statusCode)) {
      throw new Error('This author does not allow third-party downloads for the selected CurseForge file.');
    }
    throw error;
  }
  if (!result.data) throw new Error('This author does not allow third-party downloads for the selected CurseForge file.');
  return result.data;
}

async function installAddon(options = {}, installContext = null, operationContext = null) {
  const kind = normalizeAddonKind(options.kind);
  const source = options.source === 'curseforge' ? 'curseforge' : 'modrinth';
  const paths = installContext?.paths || operationContext?.paths || await getPaths();
  const config = await readConfig(paths);
  const gameVersion = normalizeAddonVersion(options.gameVersion || config.serverVersion);
  const serverType = normalizeServerType(options.serverType || config.serverType);
  if (!gameVersion) throw new Error('Select a specific Minecraft version before installing add-ons so compatibility can be verified.');
  const supportedLoaders = getPreferredAddonLoaders(kind, serverType);
  if (!supportedLoaders.length) throw new Error(`${serverType} does not load ${kind}. Choose a compatible server platform first.`);
  const platform = await getServerPlatformStatus(config, paths);
  if (!platform.jarExists) throw new Error('Install the selected server platform before installing add-ons.');
  if (!platform.compatible) throw new Error(platform.message || 'The installed server jar does not match the selected platform.');
  const context = installContext || {
    visited: new Set(), installed: [], warnings: [], count: 0, paths,
    beforeCommit: operationContext?.beforeCommit || null
  };
  if (context.count >= 50) throw new Error('Stopped after 50 add-ons while resolving dependencies.');
  const requestedId = String(options.id || options.slug || '').trim();
  const visitKey = `${source}:${requestedId}:${options.versionId || options.fileId || ''}:${kind}`;
  if (context.visited.has(visitKey)) {
    return installContext ? null : { installed: '', installedFiles: context.installed, warnings: context.warnings };
  }
  context.visited.add(visitKey);
  context.count += 1;
  const targetDir = getAddonTargetDir(paths, kind);
  await fs.mkdir(targetDir, { recursive: true });
  const detail = await getAddonDetails({ ...options, kind, gameVersion, serverType });
  let selectedFile;
  let providerSelection;
  let dependencies = [];
  let expectedHashes = {};
  let downloadUrl = '';
  if (source === 'curseforge') {
    selectedFile = chooseCurseForgeFile(detail.files, kind, gameVersion, serverType, options.fileId);
    if (!selectedFile) throw new Error(`No CurseForge JAR exactly matches Minecraft ${gameVersion || 'this version'} and ${serverType}.`);
    providerSelection = describeAddonProviderSelection(source, selectedFile);
    dependencies = (selectedFile.dependencies || []).filter((entry) => entry.relationType === 3 && entry.modId);
    expectedHashes = getCurseForgeHashes(selectedFile);
    downloadUrl = await resolveCurseForgeDownloadUrl(detail.id || requestedId, selectedFile, await getCurseForgeApiKey());
  } else {
    const selected = chooseModrinthFile(detail.files, kind, gameVersion, serverType, options.versionId);
    if (!selected) throw new Error(`No Modrinth JAR exactly matches Minecraft ${gameVersion || 'this version'} and ${serverType}.`);
    selectedFile = selected.file;
    providerSelection = describeAddonProviderSelection(source, selected);
    dependencies = (selected.version.dependencies || []).filter((entry) => entry.dependency_type === 'required');
    expectedHashes = selectedFile.hashes?.sha512 ? { sha512: selectedFile.hashes.sha512 }
      : selectedFile.hashes?.sha1 ? { sha1: selectedFile.hashes.sha1 } : {};
    downloadUrl = selectedFile.url;
  }
  if (operationContext?.skipDependencies === true) dependencies = [];

  const fileName = operationContext?.destinationFile
    ? cleanAddonFileName(operationContext.destinationFile)
    : cleanAddonFileName(selectedFile.filename || selectedFile.fileName);
  if (isRetiredLavaSourceProviderSelection(kind, requestedId, detail, providerSelection, fileName)) {
    throw new Error(`Lava Source ${RETIRED_LAVA_SOURCE_VERSION} is blocked because its every-tick scanner can freeze the server.`);
  }

  for (const dependency of dependencies) {
    if (source === 'curseforge') {
      await installAddon({ source, id: String(dependency.modId), kind, gameVersion, serverType }, context);
      continue;
    }
    let projectId = dependency.project_id;
    let versionId = dependency.version_id || '';
    if (!projectId && versionId) {
      const version = await getJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
      projectId = version.project_id;
    }
    if (projectId) await installAddon({ source, id: projectId, versionId, kind, gameVersion, serverType }, context);
  }

  if (kind === 'plugins' && fileName.toLowerCase() === BUNDLED_TELEPORT_JAR.toLowerCase()) {
    throw new Error(`The provider file name ${BUNDLED_TELEPORT_JAR} is reserved for the built-in Teleport Requests plugin.`);
  }
  if (kind === 'mods' && fileName.toLowerCase() === BUNDLED_TELEPORT_FABRIC_JAR.toLowerCase()) {
    throw new Error(`The provider file name ${BUNDLED_TELEPORT_FABRIC_JAR} is reserved for the built-in Teleport Requests mod.`);
  }
  if (kind === 'plugins' && fileName.toLowerCase() === BUNDLED_VOICE_SERVER_JAR.toLowerCase()) {
    throw new Error(`The provider file name ${BUNDLED_VOICE_SERVER_JAR} is reserved for the built-in Proximity Voice plugin.`);
  }
  const destination = path.join(targetDir, fileName);
  const alreadyInstalled = await fileMatchesExpectedHash(destination, expectedHashes);
  if (!alreadyInstalled) {
    await download(downloadUrl, destination, {
      allowedHosts: source === 'modrinth' ? ['cdn.modrinth.com'] : ['forgecdn.net', 'cursecdn.com'],
      maxBytes: MAX_ADDON_BYTES,
      expectedSize: selectedFile.size || selectedFile.fileLength || 0,
      expectedHashes,
      requireJar: true,
      beforeCommit: context.beforeCommit || undefined,
      backupExisting: Boolean(operationContext?.destinationFile)
    });
  }
  if (context.beforeCommit) await context.beforeCommit();
  context.installed.push({
    source,
    projectId: detail.id || requestedId,
    title: detail.title || requestedId,
    author: detail.author || options.author || '',
    iconUrl: detail.iconUrl || options.iconUrl || '',
    file: fileName,
    kind,
    gameVersion,
    serverType,
    providerVersionId: providerSelection?.providerVersionId || '',
    providerFileId: providerSelection?.providerFileId || '',
    providerFileName: providerSelection?.providerFileName || fileName,
    versionName: providerSelection?.versionName || '',
    size: Number(selectedFile.size || selectedFile.fileLength) || 0,
    expectedHashes: normalizeExpectedHashes(expectedHashes),
    alreadyInstalled
  });
  await upsertInstalledAddonMetadata(paths, {
    kind,
    file: fileName,
    source,
    projectId: detail.id || requestedId,
    providerVersionId: providerSelection?.providerVersionId || '',
    providerFileId: providerSelection?.providerFileId || '',
    providerFileName: providerSelection?.providerFileName || fileName,
    versionName: providerSelection?.versionName || '',
    gameVersion,
    serverType,
    expectedHashes,
    title: detail.title || requestedId,
    author: detail.author || options.author || '',
    iconUrl: detail.iconUrl || options.iconUrl || '',
    installedAt: new Date().toISOString()
  });
  if (!platform.verified && platform.message && !context.warnings.includes(platform.message)) context.warnings.push(platform.message);
  invalidateStatusCache();
  invalidateCachedWork(`disk-size:${paths.root}`);
  appendServerLog(`[Server Manager] ${alreadyInstalled ? 'Verified' : 'Installed'} ${detail.title || requestedId} from ${source} in ${kind}.\n`);
  if (installContext) return { file: fileName, alreadyInstalled };
  return {
    installed: fileName,
    installedFiles: context.installed,
    warnings: context.warnings,
    platform,
    files: await listManagedAddonFiles(paths, kind)
  };
}

function normalizeWorldMapMetadata(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pendingAction = ['install', 'remove'].includes(source.pendingAction) ? source.pendingAction : '';
  const port = Number(source.port);
  const installedFile = String(source.installedFile || '').trim();
  return {
    version: 1,
    pendingAction,
    port: Number.isSafeInteger(port) && port >= 1024 && port <= 65_535 ? port : WORLD_MAP_DEFAULT_PORT,
    installedFile: installedFile && path.basename(installedFile) === installedFile && /\.jar$/i.test(installedFile)
      ? installedFile
      : '',
    updatedAt: String(source.updatedAt || '').trim().slice(0, 40)
  };
}

async function readWorldMapMetadata(paths) {
  return normalizeWorldMapMetadata(await readJson(paths.worldMapMetadata, {}));
}

async function writeWorldMapMetadata(paths, value) {
  const normalized = normalizeWorldMapMetadata(value);
  await serializeFileWrite(paths.worldMapMetadata, () => writeJsonAtomically(paths.worldMapMetadata, normalized));
  return normalized;
}

function isWorldMapRuntimeSupported(config = {}) {
  return normalizeServerType(config.serverType) === 'fabric' &&
    normalizeAddonVersion(config.serverVersion) === WORLD_MAP_MINECRAFT_VERSION;
}

async function findInstalledWorldMapFiles(paths) {
  const [files, metadata] = await Promise.all([
    listJarFiles(paths.mods),
    readInstalledAddonMetadata(paths)
  ]);
  const managedNames = new Set(metadata.addons
    .filter(entry => entry.kind === 'mods' && (
      entry.projectId.toLowerCase() === WORLD_MAP_PROVIDER_ID.toLowerCase() ||
      entry.projectId.toLowerCase() === WORLD_MAP_PROVIDER_SLUG ||
      entry.title.trim().toLowerCase() === WORLD_MAP_PROVIDER_SLUG
    ))
    .map(entry => entry.file.toLowerCase()));
  return files.filter(file => managedNames.has(file.name.toLowerCase()) || /^squaremap(?:[-_.].*)?\.jar$/i.test(file.name));
}

function canBindLoopbackPort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      probe.removeAllListeners();
      try { probe.close(); } catch {}
      resolve(available);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    probe.unref?.();
    probe.once('error', () => finish(false));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => finish(true));
  });
}

async function chooseWorldMapPort(preferred = WORLD_MAP_DEFAULT_PORT) {
  const first = Math.max(1024, Math.min(65_535, Math.round(Number(preferred) || WORLD_MAP_DEFAULT_PORT)));
  for (let offset = 0; offset < WORLD_MAP_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = first + offset <= 65_535 ? first + offset : 1024 + offset;
    if (await canBindLoopbackPort(candidate)) return candidate;
  }
  throw new Error('No local port is available for the live map.');
}

function squaremapConfigTemplate(port) {
  return [
    'config-version: 2',
    'settings:',
    '    language-file: lang-en.yml',
    '    debug-mode: false',
    '    update-checker: false',
    `    web-address: http://127.0.0.1:${port}`,
    '    web-directory:',
    '        path: web',
    '        auto-update: true',
    '    image-quality:',
    '        compress-images:',
    '            enabled: false',
    '            value: 0.0',
    '    internal-webserver:',
    '        enabled: true',
    '        bind: 127.0.0.1',
    `        port: ${port}`,
    '        flush-json-immediately: false',
    '    ui:',
    '        coordinates:',
    '            enabled: true',
    '        link:',
    '            enabled: false',
    '        sidebar:',
    '            pinned: unpinned',
    '    commands:',
    '        main-command-label: squaremap',
    '        main-command-aliases:',
    '        - map',
    '    render-progress-logging:',
    '        enabled: false',
    '        interval-seconds: 15',
    'world-settings:',
    '    default:',
    '        map:',
    '            enabled: true',
    "            display-name: '{world}'",
    '            max-render-threads: 1',
    '            background-render:',
    '                enabled: true',
    '                max-chunks-per-interval: 64',
    '                interval-seconds: 15',
    '                max-render-threads: 1',
    '        player-tracker:',
    '            enabled: true',
    '            update-interval-seconds: 1',
    '            show-controls: true',
    '            default-hidden: false',
    '            nameplate:',
    '                enabled: true',
    '                show-head: true',
    '                show-armor: true',
    '                show-health: true',
    ''
  ].join('\n');
}

function yamlIndent(line) {
  return (String(line || '').match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
}

function yamlKeyIndex(lines, key, start = 0, end = lines.length, exactIndent = null) {
  const expression = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  for (let index = start; index < end; index += 1) {
    if (exactIndent !== null && yamlIndent(lines[index]) !== exactIndent) continue;
    if (expression.test(lines[index])) return index;
  }
  return -1;
}

function yamlBlockEnd(lines, start) {
  const indent = yamlIndent(lines[start]);
  for (let index = start + 1; index < lines.length; index += 1) {
    const value = lines[index];
    if (!value.trim() || /^\s*#/.test(value)) continue;
    if (yamlIndent(value) <= indent) return index;
  }
  return lines.length;
}

function yamlChildIndent(lines, parentIndex, fallbackWidth = 2) {
  const parentIndent = yamlIndent(lines[parentIndex]);
  const end = yamlBlockEnd(lines, parentIndex);
  for (let index = parentIndex + 1; index < end; index += 1) {
    const value = lines[index];
    if (!value.trim() || /^\s*#/.test(value)) continue;
    const indent = yamlIndent(value);
    if (indent > parentIndent) return indent;
  }
  return parentIndent + fallbackWidth;
}

function upsertYamlChild(lines, parentIndex, key, value) {
  const childIndent = yamlChildIndent(lines, parentIndex);
  const end = yamlBlockEnd(lines, parentIndex);
  const existing = yamlKeyIndex(lines, key, parentIndex + 1, end, childIndent);
  const line = `${' '.repeat(childIndent)}${key}: ${value}`;
  if (existing >= 0) {
    lines[existing] = line;
    return existing;
  }
  lines.splice(end, 0, line);
  return end;
}

async function readWorldMapNetworkConfig(paths, metadata = null) {
  const fallbackPort = normalizeWorldMapMetadata(metadata || {}).port;
  try {
    const stat = await fs.stat(paths.worldMapConfig);
    if (!stat.isFile() || stat.size > MAX_WORLD_MAP_CONFIG_BYTES) throw new Error('The squaremap config is invalid or too large.');
    const text = await fs.readFile(paths.worldMapConfig, 'utf8');
    const lines = text.split(/\r?\n/);
    const settings = yamlKeyIndex(lines, 'settings', 0, lines.length, 0);
    const settingsEnd = settings >= 0 ? yamlBlockEnd(lines, settings) : lines.length;
    const settingsChildIndent = settings >= 0 ? yamlChildIndent(lines, settings) : -1;
    const internal = settings >= 0 ? yamlKeyIndex(lines, 'internal-webserver', settings + 1, settingsEnd, settingsChildIndent) : -1;
    const internalEnd = internal >= 0 ? yamlBlockEnd(lines, internal) : -1;
    const internalChildIndent = internal >= 0 ? yamlChildIndent(lines, internal) : -1;
    const bindIndex = internal >= 0 ? yamlKeyIndex(lines, 'bind', internal + 1, internalEnd, internalChildIndent) : -1;
    const portIndex = internal >= 0 ? yamlKeyIndex(lines, 'port', internal + 1, internalEnd, internalChildIndent) : -1;
    const bind = bindIndex >= 0 ? String(lines[bindIndex].split(':').slice(1).join(':')).trim().replace(/^['"]|['"]$/g, '') : '';
    const rawPort = portIndex >= 0 ? Number(String(lines[portIndex]).split(':').at(-1).trim()) : fallbackPort;
    return {
      bind,
      port: Number.isSafeInteger(rawPort) && rawPort >= 1024 && rawPort <= 65_535 ? rawPort : fallbackPort,
      localOnly: ['127.0.0.1', 'localhost', '::1'].includes(bind.toLowerCase())
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { bind: '', port: fallbackPort, localOnly: false };
  }
}

async function ensureWorldMapLocalConfig(paths, metadata, revalidate = async () => {}) {
  let existing = '';
  try {
    const stat = await fs.stat(paths.worldMapConfig);
    if (!stat.isFile() || stat.size > MAX_WORLD_MAP_CONFIG_BYTES) throw new Error('The squaremap config is invalid or too large.');
    existing = await fs.readFile(paths.worldMapConfig, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const currentNetwork = existing
    ? await readWorldMapNetworkConfig(paths, metadata)
    : { port: normalizeWorldMapMetadata(metadata).port };
  const port = await chooseWorldMapPort(currentNetwork.port);
  let next = squaremapConfigTemplate(port);
  if (existing) {
    const lines = existing.split(/\r?\n/);
    const settings = yamlKeyIndex(lines, 'settings', 0, lines.length, 0);
    if (settings >= 0) {
      upsertYamlChild(lines, settings, 'web-address', `http://127.0.0.1:${port}`);
      const settingsEnd = yamlBlockEnd(lines, settings);
      const settingsChildIndent = yamlChildIndent(lines, settings);
      let internal = yamlKeyIndex(lines, 'internal-webserver', settings + 1, settingsEnd, settingsChildIndent);
      if (internal < 0) {
        internal = settingsEnd;
        lines.splice(internal, 0, `${' '.repeat(settingsChildIndent)}internal-webserver:`);
      }
      upsertYamlChild(lines, internal, 'enabled', 'true');
      upsertYamlChild(lines, internal, 'bind', '127.0.0.1');
      upsertYamlChild(lines, internal, 'port', String(port));
      next = `${lines.join('\n').replace(/\s+$/, '')}\n`;
    }
  }
  await revalidate();
  await fs.mkdir(path.dirname(paths.worldMapConfig), { recursive: true });
  const temporary = `${paths.worldMapConfig}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(temporary, next, 'utf8');
  await revalidate();
  await replaceFileAtomically(temporary, paths.worldMapConfig);
  const saved = await writeWorldMapMetadata(paths, {
    ...metadata,
    port,
    updatedAt: new Date().toISOString()
  });
  return saved;
}

function friendlyTradeAssistantMessage(error) {
  const code = String(error?.code || '');
  if (code === 'TRADE_ASSISTANT_TIMEOUT') return 'The entity bridge did not respond. Wait for the server to finish starting, then try again.';
  if (code === 'TRADE_ASSISTANT_FILE_MISSING') return 'The entity bridge is not ready yet. Restart the server after installing this update.';
  if (code === 'TRADE_ASSISTANT_INVALID_TOKEN') return 'The entity bridge security token is invalid. Restart the server to repair it.';
  if (code === 'TRADE_ASSISTANT_REJECTED') return String(error?.message || 'The server rejected that entity change.').slice(0, 300);
  if (error instanceof TradeAssistantControlError) return 'The entity bridge could not complete that request safely.';
  return String(error?.message || error || 'The entity bridge is unavailable.').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

async function getTradeAssistantRuntimeState(paths) {
  const [tokenReady, snapshotReady] = await Promise.all([
    isRegularFile(paths.tradeAssistantToken),
    isRegularFile(paths.tradeAssistantMapSnapshot)
  ]);
  return { installed: tokenReady, verified: tokenReady, tokenReady, snapshotReady };
}

async function captureTradeAssistantBridge(requireRunning = true) {
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Create or select a server before opening Entity Viewer.');
  if (requireRunning && !isServerRuntimeReady()) throw new Error('Start the server before using Entity Viewer.');
  const paths = getPathsForProfile(profile);
  const runtime = await getTradeAssistantRuntimeState(paths);
  if (!runtime.verified) throw new Error('Entity controls are not ready yet. Restart the server after installing this update.');
  const active = await getActiveProfile();
  if (active?.id !== profile.id) throw new Error('The active server changed. Open Entity Viewer again.');
  return {
    profileId: profile.id,
    paths,
    runtime,
    bridge: createTradeAssistantControl(paths.root, { timeoutMs: 4_000, pollIntervalMs: 40 })
  };
}

async function assertTradeAssistantProfile(snapshot) {
  const active = await getActiveProfile();
  if (!snapshot?.profileId || active?.id !== snapshot.profileId) {
    throw new Error('The active server changed while the entity request was running.');
  }
}

async function listEntityViewerEntities() {
  let snapshot;
  try {
    snapshot = await captureTradeAssistantBridge(true);
    let mapSnapshot = await snapshot.bridge.readMapSnapshot();
    if (!mapSnapshot || Date.now() - mapSnapshot.generatedAt > 5_000) {
      const response = await snapshot.bridge.request('listLoadedEntities', { limit: 512 });
      mapSnapshot = {
        generatedAt: Date.now(),
        truncated: Number(response?.count) >= Number(response?.limit || 512),
        entities: Array.isArray(response?.entities)
          ? response.entities.filter((entry) => entry?.player !== true).slice(0, 512) : []
      };
    }
    await assertTradeAssistantProfile(snapshot);
    return {
      available: true,
      bridgeAvailable: true,
      serverState,
      generatedAt: Number(mapSnapshot.generatedAt) || Date.now(),
      truncated: Boolean(mapSnapshot.truncated),
      entities: Array.isArray(mapSnapshot.entities) ? mapSnapshot.entities.slice(0, 512) : [],
      message: ''
    };
  } catch (error) {
    return {
      available: false,
      bridgeAvailable: false,
      serverState,
      generatedAt: 0,
      truncated: false,
      entities: [],
      message: friendlyTradeAssistantMessage(error)
    };
  }
}

async function inspectEntityForViewer(entityUuid) {
  const snapshot = await captureTradeAssistantBridge(true);
  try {
    const detail = await snapshot.bridge.request('inspectEntity', { entityUuid });
    await assertTradeAssistantProfile(snapshot);
    return detail;
  } catch (error) {
    throw new Error(friendlyTradeAssistantMessage(error));
  }
}

function normalizeEntityViewerStack(value, label, optional = false) {
  if (optional && (value === null || value === undefined)) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const id = String(value.id || value.item || '').trim().toLowerCase();
  const count = Number(value.count);
  if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) || id.includes('..') || id.includes('//')) {
    throw new Error(`${label} item ID is invalid.`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 64) throw new Error(`${label} count must be from 1 to 64.`);
  return { id, count };
}

async function updateEntityViewerOffer(entityUuid, offerIndex, value = {}) {
  const offer = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const buy = normalizeEntityViewerStack(offer.buy || offer.costA, 'First cost');
  const buyB = normalizeEntityViewerStack(offer.buyB ?? offer.costB, 'Second cost', true);
  const sell = normalizeEntityViewerStack(offer.sell || offer.result, 'Result');
  const payload = {
    entityUuid,
    offerIndex: Number(offerIndex),
    costAItem: buy.id,
    costACount: buy.count,
    costBCount: buyB ? buyB.count : 0,
    resultItem: sell.id,
    resultCount: sell.count,
    maxUses: Number(offer.maxUses),
    xp: Number(offer.xp),
    priceMultiplier: Number(offer.priceMultiplier)
  };
  if (buyB) payload.costBItem = buyB.id;
  const snapshot = await captureTradeAssistantBridge(true);
  try {
    const detail = await snapshot.bridge.request('setVillagerOffer', payload);
    await assertTradeAssistantProfile(snapshot);
    return detail;
  } catch (error) {
    throw new Error(friendlyTradeAssistantMessage(error));
  }
}

async function setEntityViewerAge(entityUuid, value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const baby = source.baby === true;
  const remainingTicks = Number(source.remainingTicks ?? source.ticks ?? 0);
  if (!Number.isSafeInteger(remainingTicks) || remainingTicks < 0 || remainingTicks > 1_200_000) {
    throw new Error('Growth time must be from 0 to 1,200,000 ticks.');
  }
  const snapshot = await captureTradeAssistantBridge(true);
  try {
    const detail = await snapshot.bridge.request('setVillagerBabyAge', {
      entityUuid,
      babyAgeTicks: baby ? -Math.max(1, remainingTicks) : 0
    });
    await assertTradeAssistantProfile(snapshot);
    return detail;
  } catch (error) {
    throw new Error(friendlyTradeAssistantMessage(error));
  }
}

async function setEntityViewerCooldown(entityUuid, value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const ticks = Number(source.ticks ?? source.cooldownTicks);
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 1_200_000) {
    throw new Error('Breeding cooldown must be from 0 to 1,200,000 ticks.');
  }
  const snapshot = await captureTradeAssistantBridge(true);
  try {
    const inspected = await snapshot.bridge.request('inspectEntity', { entityUuid });
    const operation = String(inspected?.entityType || '').toLowerCase() === 'minecraft:villager'
      ? 'setVillagerBreedingCooldown' : 'setAnimalBreedingCooldown';
    const detail = await snapshot.bridge.request(operation, { entityUuid, cooldownTicks: ticks });
    await assertTradeAssistantProfile(snapshot);
    return detail;
  } catch (error) {
    throw new Error(friendlyTradeAssistantMessage(error));
  }
}

async function getWorldMapStatus(pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const [config, metadata, snapshotFile, terrainFile] = await Promise.all([
    readConfig(paths),
    readWorldMapMetadata(paths),
    fs.stat(paths.nativeWorldMapSnapshot).catch(() => null),
    fs.stat(paths.nativeWorldMapTerrain).catch(() => null)
  ]);
  const supported = isWorldMapRuntimeSupported(config);
  const installed = await isRegularFile(path.join(paths.mods, NATIVE_WORLD_MAP_JAR));
  const snapshotReady = Boolean(snapshotFile?.isFile() && snapshotFile.size > 0 && snapshotFile.size <= MAX_NATIVE_WORLD_MAP_BYTES);
  const terrainReady = Boolean(
    (terrainFile?.isFile() && terrainFile.size > 0 && terrainFile.size <= MAX_NATIVE_WORLD_MAP_TERRAIN_BYTES)
    || (snapshotReady && snapshotFile.size > 512 * 1024)
  );
  return {
    provider: 'click-interval-map',
    supported,
    supportedPlatform: 'Fabric 26.2',
    installed,
    installedFiles: installed ? [NATIVE_WORLD_MAP_JAR] : [],
    queuedAction: metadata.pendingAction,
    snapshotReady,
    terrainReady,
    reachable: Boolean(installed && snapshotReady && serverState === 'running'),
    busy: serverToolMutationCoordinator.getActiveKey().startsWith('world-map:'),
    capabilities: {
      renderedChunks: installed,
      players: installed,
      playerCoordinates: installed,
      mobs: false,
      structures: false,
      coordinateReadout: installed,
      clickCoordinates: installed
    },
    message: !supported
      ? 'Live World Map requires Fabric 26.2.'
      : metadata.pendingAction === 'install'
        ? 'Live World Map will be enabled on the next server start.'
        : metadata.pendingAction === 'remove'
          ? 'Live World Map will be disabled on the next server start.'
          : installed && serverState === 'running' && !terrainReady
            ? 'Click Interval is indexing saved terrain.'
            : installed ? 'Native live terrain is ready.' : 'Live World Map is disabled for this server.'
  };
}

function normalizeWorldMapTerrainCells(entries, limit) {
  return normalizeTerrainCells(entries, limit);
}

function normalizeWorldMapGeneratedRegions(entries) {
  return normalizeGeneratedRegions(entries);
}

function normalizeLegacyWorldMapTerrainCells(entries, limit) {
  if (!Array.isArray(entries)) return [];
  const source = entries.slice(0, limit);
  const cells = normalizeWorldMapTerrainCells(source, limit).map(cell => (
    cell.dimension === 'minecraft:overworld' && cell.block === 'minecraft:dirt'
      ? { ...cell, color: '#67a84f' }
      : cell
  ));
  const chunks = new Map();
  for (const cell of cells) {
    const chunkX = Math.floor(cell.x / 16);
    const chunkZ = Math.floor(cell.z / 16);
    const key = `${cell.dimension}|${chunkX}|${chunkZ}`;
    const chunk = chunks.get(key);
    if (chunk) chunk.push(cell);
    else chunks.set(key, [cell]);
  }
  const representativeFor = chunk => {
    const counts = new Map();
    for (const cell of chunk) {
      if (cell.block === 'minecraft:air' || cell.block === 'minecraft:cave_air') continue;
      const key = `${cell.color}|${cell.block}`;
      const current = counts.get(key);
      if (current) current.count++;
      else counts.set(key, { count: 1, cell });
    }
    return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.cell || null;
  };
  const representatives = new Map();
  for (const [key, chunk] of chunks) {
    const representative = representativeFor(chunk);
    if (representative) representatives.set(key, representative);
  }
  const nearbyRepresentative = (dimension, chunkX, chunkZ) => {
    for (let radius = 1; radius <= 2; radius++) {
      const nearby = [];
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const representative = representatives.get(`${dimension}|${chunkX + dx}|${chunkZ + dz}`);
          if (representative) nearby.push(representative);
        }
      }
      if (nearby.length) return representativeFor(nearby);
    }
    return null;
  };
  const underlays = [];
  const details = [];
  for (const [chunkKey, chunk] of chunks) {
    const first = chunk[0];
    const chunkX = Math.floor(first.x / 16);
    const chunkZ = Math.floor(first.z / 16);
    const representative = representatives.get(chunkKey) || (
      first.dimension === 'minecraft:overworld'
        ? nearbyRepresentative(first.dimension, chunkX, chunkZ)
        : null
    );
    if (chunk.length === 1) {
      const localX = ((Math.floor(first.x) % 16) + 16) % 16;
      const localZ = ((Math.floor(first.z) % 16) + 16) % 16;
      if (localX === 8 && localZ === 8 && representative) {
        underlays.push({
          ...representative,
          x: chunkX * 16,
          z: chunkZ * 16,
          size: 16,
          color: first.dimension === 'minecraft:the_nether' && representative.block === 'minecraft:bedrock'
            ? '#67383a'
            : representative.color
        });
      } else if (first.block !== 'minecraft:air' && first.block !== 'minecraft:cave_air') {
        details.push(first);
      }
      continue;
    }
    if (representative) underlays.push({ ...representative, x: chunkX * 16, z: chunkZ * 16, size: 16 });
    details.push(...chunk.filter(cell => cell.block !== 'minecraft:air' && cell.block !== 'minecraft:cave_air'));
  }
  return [...underlays, ...details];
}

function normalizeWorldMapMarkers(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 20_000).map(marker => ({
    kind: marker?.kind === 'spawn' ? 'spawn' : 'structure',
    id: String(marker?.id || '').slice(0, 128),
    dimension: String(marker?.dimension || '').slice(0, 128),
    x: Number(marker?.x),
    z: Number(marker?.z)
  })).filter(marker => marker.id && marker.dimension && Number.isFinite(marker.x) && Number.isFinite(marker.z));
}

function normalizeWorldMapTerrainIndex(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const integer = input => Math.max(0, Math.min(10_000_000, Math.floor(Number(input) || 0)));
  const total = integer(source.total);
  const indexed = Math.min(total || 10_000_000, integer(source.indexed));
  const failed = Math.min(indexed, integer(source.failed));
  const omitted = integer(source.omitted);
  const remaining = integer(source.remaining);
  return {
    total,
    indexed,
    failed,
    omitted,
    remaining,
    discovering: source.discovering === true,
    complete: !source.discovering && remaining === 0 && total > 0 && indexed >= total
  };
}

async function readNativeWorldMapTerrain(paths) {
  return nativeWorldMapTerrainReader.read(paths.nativeWorldMapTerrain);
}

async function readNativeWorldMapSnapshot(paths) {
  const terrainPromise = readNativeWorldMapTerrain(paths);
  let status = null;
  try {
    const stat = await fs.stat(paths.nativeWorldMapSnapshot);
    if (stat.isFile() && stat.size > 0 && stat.size <= MAX_NATIVE_WORLD_MAP_BYTES) {
      status = nativeWorldMapSnapshotCache.value;
      const statusCacheHit = status && nativeWorldMapSnapshotCache.file === paths.nativeWorldMapSnapshot
        && nativeWorldMapSnapshotCache.mtimeMs === stat.mtimeMs && nativeWorldMapSnapshotCache.size === stat.size;
      if (!statusCacheHit) {
        const parsed = JSON.parse(await fs.readFile(paths.nativeWorldMapSnapshot, 'utf8'));
        const generatedAt = Number(parsed?.generatedAt) || 0;
        status = {
          players: normalizeWorldMapPlayers(parsed?.players),
          markers: normalizeWorldMapMarkers(parsed?.markers),
          terrainIndex: normalizeWorldMapTerrainIndex(parsed?.terrainIndex),
          generatedAt,
          statusTerrainRevision: Number(parsed?.terrainRevision) || generatedAt,
          legacyTerrain: normalizeLegacyWorldMapTerrainCells(parsed?.terrain, 250_000)
        };
        nativeWorldMapSnapshotCache = {
          file: paths.nativeWorldMapSnapshot,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          value: status
        };
      }
    }
  } catch {
    status = null;
  }
  const terrainFile = await terrainPromise;
  const terrain = terrainFile.terrain.length ? terrainFile.terrain : (status?.legacyTerrain || []);
  const hasPublishedTerrain = terrainFile.terrain.length || terrainFile.generatedRegions.length;
  const terrainRevision = hasPublishedTerrain
    ? terrainFile.terrainRevision
    : (status?.statusTerrainRevision || 0);
  const generatedAt = status?.generatedAt || terrainFile.generatedAt || 0;
  const fresh = Boolean(status && serverState === 'running'
    && Date.now() - status.generatedAt >= -5_000
    && Date.now() - status.generatedAt <= NATIVE_WORLD_MAP_FRESH_MS);
  return {
    players: fresh ? status.players : [],
    terrain,
    generatedRegions: terrainFile.generatedRegions || [],
    markers: status?.markers || [],
    terrainIndex: status?.terrainIndex || normalizeWorldMapTerrainIndex(null),
    generatedAt,
    terrainRevision
  };
}

function normalizeWorldMapPlayers(parsed) {
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.players) ? parsed.players : [];
    return entries.slice(0, MAX_PLAYER_STATUS_SAMPLE).map(entry => {
      const name = String(entry?.name || '').trim();
      if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
      const position = entry.position && typeof entry.position === 'object' ? entry.position : entry;
      const number = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value))
        ? Number(value)
        : null;
      const rawDimension = String(entry.world || entry.dimension || '').slice(0, 128);
      const dimension = /^minecraft_(?:overworld|the_nether|the_end)$/.test(rawDimension)
        ? rawDimension.replace(/^minecraft_/, 'minecraft:')
        : rawDimension;
      return {
        name,
        uuid: normalizePlayerUuid(entry.uuid || entry.id),
        x: number(position.x),
        y: number(position.y),
        z: number(position.z),
        dimension
      };
    }).filter(Boolean);
}

async function getWorldMapSnapshot(knownTerrainToken = '') {
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Create or select a server before opening the live map.');
  if (nativeWorldMapSeedEngineScope && !nativeWorldMapSeedEngineScope.startsWith(`${profile.id}|`)) closeWorldMapSeedEngine();
  const paths = getPathsForProfile(profile);
  const [map, config, nativeSnapshot] = await Promise.all([
    getWorldMapStatus(paths),
    readConfig(paths),
    readNativeWorldMapSnapshot(paths)
  ]);
  const worldRoot = resolveContainedPath(paths.root, path.resolve(paths.root, config.levelName || 'world'));
  const seedMetadata = await readWorldMapSeedMetadataSafely(worldRoot, config.serverVersion);
  const playerRoster = await nativeWorldMapRosterReader.read({
    paths,
    worldRoot,
    worldToken: seedMetadata.worldToken,
    players: nativeSnapshot.players,
    generatedAt: nativeSnapshot.generatedAt,
    serverRunning: serverState === 'running',
    authoritativeNames: [...livePlayers.values()],
    authoritativeAt: lastPlayerRosterAuthoritativeAt
  });
  if ((await getActiveProfile())?.id !== profile.id) throw new Error('The selected server changed while loading the map.');
  const terrainRevision = nativeSnapshot.terrainRevision || nativeSnapshot.generatedAt || 0;
  const terrainToken = `${profile.id}:${seedMetadata.worldToken || config.levelName}:${terrainRevision}`;
  const terrainUnchanged = Boolean(knownTerrainToken)
    && String(knownTerrainToken) === terrainToken;
  return {
    serverState,
    serverName: profile.name || config.levelName || 'Minecraft Server',
    players: playerRoster.filter(player => player.online),
    playerRoster,
    worldToken: seedMetadata.worldToken || '',
    seedPreviewAvailable: seedMetadata.previewAvailable === true,
    slimeChunksAvailable: seedMetadata.seedAvailable === true,
    terrain: terrainUnchanged ? [] : nativeSnapshot.terrain,
    generatedRegions: terrainUnchanged ? [] : nativeSnapshot.generatedRegions,
    markers: nativeSnapshot.markers || [],
    terrainIndex: nativeSnapshot.terrainIndex || normalizeWorldMapTerrainIndex(null),
    terrainUnchanged,
    terrainRevision,
    terrainToken,
    generatedAt: nativeSnapshot.generatedAt,
    entities: [],
    map: {
      ...map,
      capabilities: {
        ...map.capabilities,
        structures: (nativeSnapshot.markers || []).some(marker => marker.kind === 'structure'),
        slimeChunks: seedMetadata.seedAvailable === true,
        seedPreview: seedMetadata.previewAvailable === true,
        mobs: false,
        entityViewer: false
      }
    }
  };
}

async function readWorldMapSeedMetadataSafely(worldRoot, minecraftVersion) {
  try {
    return await readWorldMapSeedMetadata({ worldRoot, minecraftVersion });
  } catch {
    // The live terrain and player roster remain usable during an atomic save or on an
    // unsupported/corrupt generation file. Never substitute the configured seed for it.
    return {
      seedAvailable: false,
      previewAvailable: false,
      worldToken: `unavailable:${crypto.createHash('sha256').update(path.resolve(worldRoot)).digest('hex').slice(0, 24)}`
    };
  }
}

async function getWorldMapSeedContext() {
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Select a server before opening the map.');
  const paths = getPathsForProfile(profile);
  const config = await readConfig(paths);
  const worldRoot = resolveContainedPath(paths.root, path.resolve(paths.root, config.levelName || 'world'));
  const metadata = await readWorldMapSeedMetadataSafely(worldRoot, config.serverVersion);
  if ((await getActiveProfile())?.id !== profile.id) throw new Error('The selected server changed while loading the map.');
  return { profile, paths, config, metadata };
}

async function getWorldMapSlimeChunks(request) {
  const { profile, metadata } = await getWorldMapSeedContext();
  const result = getSlimeChunks(metadata, request);
  if ((await getActiveProfile())?.id !== profile.id) throw new Error('The selected server changed while loading the map.');
  return result;
}

function closeWorldMapSeedEngine() {
  const previous = nativeWorldMapSeedEngine;
  nativeWorldMapSeedEngine = null;
  nativeWorldMapSeedEngineScope = '';
  nativeWorldMapSeedEngineEpoch++;
  nativeWorldMapSeedEngineClosing = Promise.all([nativeWorldMapSeedEngineClosing, previous?.close()])
    .then(() => undefined, () => undefined);
  return nativeWorldMapSeedEngineClosing;
}

async function getWorldMapSeedPreview(request = {}) {
  const { profile, paths, config, metadata } = await getWorldMapSeedContext();
  if (!metadata.previewAvailable || request?.worldToken !== metadata.worldToken) {
    return { available: false, worldToken: metadata.worldToken || '', cells: [] };
  }
  const scope = `${profile.id}|${paths.root}|${metadata.worldToken}|${config.javaPath}`;
  if (nativeWorldMapSeedEngineScope !== scope) {
    const closed = closeWorldMapSeedEngine();
    const epoch = nativeWorldMapSeedEngineEpoch;
    await closed;
    if (epoch !== nativeWorldMapSeedEngineEpoch) return { available: false, cancelled: true, worldToken: '', cells: [] };
    nativeWorldMapSeedEngineScope = scope;
    nativeWorldMapSeedEngine = new SeedPreviewEngine({
      javaPath: config.javaPath,
      serverRoot: paths.root,
      workingRoot: path.join(app.getPath('userData'), 'world-map-preview-cache')
    });
  }
  try {
    const result = await nativeWorldMapSeedEngine.preview(metadata, request);
    if ((await getActiveProfile())?.id !== profile.id || nativeWorldMapSeedEngineScope !== scope) {
      return { available: false, cancelled: true, worldToken: '', cells: [] };
    }
    return result;
  } catch {
    // Preview failure must never change the live world, issue a server command, or start a server.
    return { available: false, worldToken: metadata.worldToken || '', cells: [] };
  }
}

async function getWorldMapPlayerDetails(name) {
  const requested = validatePlayerName(name);
  const key = requested.toLowerCase();
  const snapshot = await getWorldMapSnapshot();
  const player = snapshot.playerRoster.find(entry => entry.name.toLowerCase() === key);
  if (!player) throw new Error('This player has not been seen on the selected server.');
  return {
    name: player.name,
    online: player.online,
    x: player.x,
    y: player.y,
    z: player.z,
    dimension: player.dimension,
    lastPositionAt: player.lastPositionAt
  };
}

async function getWorldMapFabricApiState(paths) {
  const index = await getModDescriptorIndex(paths);
  const apis = index.files.filter(entry => entry.descriptor?.fabricModId === 'fabric-api');
  const compatible = apis.filter(entry =>
    isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, WORLD_MAP_MINECRAFT_VERSION));
  const incompatible = apis.filter(entry =>
    !isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, WORLD_MAP_MINECRAFT_VERSION));
  if (index.partial) throw new Error(index.warning || 'The mods folder could not be checked safely for Fabric API.');
  if (incompatible.length || compatible.length > 1) {
    throw new Error('Fabric API must have exactly one compatible Minecraft 26.2 installation before adding Live World Map.');
  }
  return { installed: compatible.length === 1, file: compatible[0]?.name || '' };
}

async function ensureWorldMapFabricApiBeforeStart(paths, revalidate) {
  const state = await getWorldMapFabricApiState(paths);
  if (state.installed) return state.file;
  const adapter = getBundledProtectionAdapterById('fabric-26.2');
  const artifact = await findBundledFabricApiArtifact(adapter);
  if (!artifact) throw new Error('The bundled Fabric API 26.2 dependency for Live World Map is missing.');
  const destination = path.join(paths.mods, adapter.fabricApiFile);
  if (await fs.stat(destination).catch(() => null)) {
    throw new Error(`${path.basename(destination)} already exists but is not a compatible Fabric API 26.2 mod. It was left untouched.`);
  }
  const temporary = `${destination}.map-install-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await revalidate();
    await fs.mkdir(paths.mods, { recursive: true });
    await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
    const copied = await inspectAntiCheatJar(temporary);
    if (copied.sha256 !== artifact.sha256 || copied.size !== artifact.size ||
        !inspectionIsFabricApi(copied) ||
        !isCompatibleFabricApiVersion(copied.fabricVersion, WORLD_MAP_MINECRAFT_VERSION)) {
      throw new Error('The bundled Fabric API dependency for Live World Map failed its integrity check.');
    }
    await revalidate();
    await publishStagedFileIfAbsent(temporary, destination);
    await revalidate();
    appendServerLog(`[Server Manager] Installed ${path.basename(destination)} for Live World Map.\n`);
    return path.basename(destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function installWorldMapForPaths(paths, revalidate) {
  await revalidate();
  const fabricApi = await getWorldMapFabricApiState(paths);
  await revalidate();
  const result = await installAddon({
    source: 'modrinth',
    id: WORLD_MAP_PROVIDER_ID,
    kind: 'mods',
    gameVersion: WORLD_MAP_MINECRAFT_VERSION,
    serverType: 'fabric',
    title: 'squaremap'
  }, null, { paths, beforeCommit: revalidate, skipDependencies: fabricApi.installed });
  await revalidate();
  const installed = result.installedFiles.find(entry =>
    String(entry.projectId).toLowerCase() === WORLD_MAP_PROVIDER_ID.toLowerCase() ||
    String(entry.title).toLowerCase() === WORLD_MAP_PROVIDER_SLUG
  );
  let metadata = await readWorldMapMetadata(paths);
  metadata = await ensureWorldMapLocalConfig(paths, {
    ...metadata,
    pendingAction: '',
    installedFile: installed?.file || result.installed || metadata.installedFile,
    updatedAt: new Date().toISOString()
  }, revalidate);
  await revalidate();
  await writeWorldMapMetadata(paths, { ...metadata, pendingAction: '', updatedAt: new Date().toISOString() });
  invalidateStatusCache();
  appendServerLog(`[Server Manager] Live World Map installed on localhost:${metadata.port}.\n`);
  return { ...result, metadata };
}

async function removeWorldMapForPaths(paths, revalidate) {
  const files = await findInstalledWorldMapFiles(paths);
  for (const file of files) {
    await revalidate();
    const source = resolveContainedPath(paths.mods, path.join(paths.mods, file.name));
    const quarantine = `${source}.removing-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.rename(source, quarantine);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      continue;
    }
    try {
      await fs.rm(quarantine, { force: true });
    } catch (error) {
      await fs.rename(quarantine, source).catch(() => {});
      throw error;
    }
    await removeInstalledAddonMetadata(paths, 'mods', file.name);
  }
  const metadata = await readWorldMapMetadata(paths);
  await writeWorldMapMetadata(paths, {
    ...metadata,
    pendingAction: '',
    installedFile: '',
    updatedAt: new Date().toISOString()
  });
  invalidateStatusCache();
  appendServerLog('[Server Manager] Live World Map removed. Rendered map data was kept.\n');
  return { removed: files.map(file => file.name) };
}

async function queueWorldMapAction(action) {
  if (!['install', 'remove'].includes(action)) throw new Error('That Live World Map action is invalid.');
  if (applicationQuitting) throw new Error('Cannot change Live World Map while the app is quitting.');
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error('Create or select a server before changing Live World Map.');
  const profileId = profile.id;
  const paths = getPathsForProfile(profile);
  return serverToolMutationCoordinator.run(`world-map:${profileId}:${action}`, async () => {
    if (serverStartCoordinator.getActiveKey()) {
      throw new Error('Wait for server startup to finish before changing Live World Map.');
    }
    const activeBefore = await getActiveProfile();
    if (activeBefore?.id !== profileId) {
      throw new Error('The active server changed before the map change could be queued.');
    }
    if (action === 'install' && !isWorldMapRuntimeSupported(await readConfig(paths))) {
      throw new Error('Live World Map requires Fabric 26.2.');
    }
    const metadata = await readWorldMapMetadata(paths);
    const activeAtCommit = await getActiveProfile();
    if (activeAtCommit?.id !== profileId) {
      throw new Error('The active server changed while the map change was being prepared.');
    }
    const next = await writeWorldMapMetadata(paths, {
      ...metadata,
      pendingAction: action,
      updatedAt: new Date().toISOString()
    });
    const status = await getWorldMapStatus(paths);
    if (worldMapWindow && !worldMapWindow.isDestroyed()) worldMapWindow.webContents.send('world-map:status', status);
    return {
      queued: true,
      action,
      metadata: next,
      status,
      message: `${action === 'install' ? 'Install' : 'Removal'} queued for the next server start.`
    };
  });
}

async function installWorldMap() {
  return queueWorldMapAction('install');
}

async function removeWorldMap() {
  return queueWorldMapAction('remove');
}

async function applyQueuedWorldMapChangeBeforeStart(paths, revalidate) {
  const metadata = await readWorldMapMetadata(paths);
  const destination = path.join(paths.mods, NATIVE_WORLD_MAP_JAR);
  if (metadata.pendingAction === 'remove') {
    await revalidate();
    if (await isRegularFile(destination)) {
      const disabledDirectory = path.join(paths.root, 'disabled-world-map');
      await fs.mkdir(disabledDirectory, { recursive: true });
      const preferred = path.join(disabledDirectory, NATIVE_WORLD_MAP_JAR);
      const disabled = await isRegularFile(preferred)
        ? path.join(disabledDirectory, `ClickIntervalMap-Fabric-${Date.now()}.jar`)
        : preferred;
      await fs.rename(destination, disabled);
    }
    await writeWorldMapMetadata(paths, {
      ...metadata,
      pendingAction: '',
      installedFile: '',
      updatedAt: new Date().toISOString()
    });
    appendServerLog('[Server Manager] Live World Map disabled before Java startup.\n');
    return;
  }
  const alreadyInstalled = await isRegularFile(destination);
  if (metadata.pendingAction !== 'install' && !alreadyInstalled) return;
  const config = await readConfig(paths);
  await revalidate();
  if (!isWorldMapRuntimeSupported(config)) {
    if (alreadyInstalled) {
      const disabledDirectory = path.join(paths.root, 'disabled-world-map');
      await fs.mkdir(disabledDirectory, { recursive: true });
      const preferred = path.join(disabledDirectory, NATIVE_WORLD_MAP_JAR);
      const disabled = await isRegularFile(preferred)
        ? path.join(disabledDirectory, `ClickIntervalMap-Fabric-${Date.now()}.jar`)
        : preferred;
      await fs.rename(destination, disabled);
      await writeWorldMapMetadata(paths, {
        ...metadata,
        installedFile: '',
        updatedAt: new Date().toISOString()
      });
      appendServerLog('[Server Manager] Live World Map was disabled because this server is not running Fabric 26.2.\n');
    }
    return;
  }
  const artifact = path.join(__dirname, NATIVE_WORLD_MAP_PROJECT_DIRECTORY, 'dist', NATIVE_WORLD_MAP_ARTIFACT);
  if (!await isRegularFile(artifact)) throw new Error('The bundled Click Interval map module is missing.');
  await ensureWorldMapFabricApiBeforeStart(paths, revalidate);
  await revalidate();
  await fs.mkdir(paths.mods, { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.copyFile(artifact, temporary);
  await revalidate();
  await replaceFileAtomically(temporary, destination);

  const retiredDirectory = path.join(paths.root, 'retired-squaremap');
  const entries = await fs.readdir(paths.mods, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !/^squaremap.*\.jar$/i.test(entry.name)) continue;
    await fs.mkdir(retiredDirectory, { recursive: true });
    const source = path.join(paths.mods, entry.name);
    const preferredRetired = path.join(retiredDirectory, entry.name);
    const retired = await isRegularFile(preferredRetired)
      ? path.join(retiredDirectory, `${path.basename(entry.name, '.jar')}-${Date.now()}.jar`)
      : preferredRetired;
    await fs.rename(source, retired);
    appendServerLog(`[Server Manager] Retired ${entry.name}; the native Click Interval map engine replaces it.\n`);
  }
  await writeWorldMapMetadata(paths, {
    pendingAction: '',
    port: WORLD_MAP_DEFAULT_PORT,
    installedFile: NATIVE_WORLD_MAP_JAR,
    updatedAt: new Date().toISOString()
  });
  appendServerLog('[Server Manager] Verified the native Click Interval terrain map module.\n');
}

async function exportWorldMapMod(event) {
  const paths = await getPaths();
  const installed = await findInstalledWorldMapFiles(paths);
  let source = installed[0] ? path.join(paths.mods, installed[0].name) : '';
  let selection = null;
  let suggestedName = installed[0]?.name || 'squaremap-fabric-26.2.jar';
  if (!source) {
    const detail = await getAddonDetails({
      source: 'modrinth', id: WORLD_MAP_PROVIDER_ID, kind: 'mods',
      gameVersion: WORLD_MAP_MINECRAFT_VERSION, serverType: 'fabric'
    });
    selection = chooseModrinthFile(detail.files, 'mods', WORLD_MAP_MINECRAFT_VERSION, 'fabric');
    if (!selection) throw new Error('No squaremap build is available for Fabric 26.2 right now.');
    suggestedName = cleanAddonFileName(selection.file.filename || suggestedName);
  }
  const owner = BrowserWindow.fromWebContents(event?.sender) || worldMapWindow || mainWindow;
  const target = await dialog.showSaveDialog(owner, {
    title: 'Export Live World Map mod',
    defaultPath: path.join(app.getPath('downloads'), suggestedName),
    filters: [{ name: 'Java archives', extensions: ['jar'] }]
  });
  if (target.canceled || !target.filePath) return { canceled: true };
  const destination = path.resolve(target.filePath);
  if (source) {
    if (path.resolve(source) === destination) return { canceled: false, path: destination, message: 'The map mod is already at that location.' };
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ADDON_BYTES) throw new Error('The installed map mod is invalid.');
    const sourceHandle = await fs.open(source, 'r');
    const signature = Buffer.alloc(4);
    try { await sourceHandle.read(signature, 0, signature.length, 0); }
    finally { await sourceHandle.close(); }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('The installed map mod is not a valid JAR.');
    const temporary = `${destination}.export-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.copyFile(source, temporary, fss.constants.COPYFILE_EXCL);
      const copied = await fs.stat(temporary);
      if (copied.size !== stat.size) throw new Error('The exported map mod was incomplete.');
      await replaceFileAtomically(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  } else {
    const expectedHashes = selection.file.hashes?.sha512 ? { sha512: selection.file.hashes.sha512 }
      : selection.file.hashes?.sha1 ? { sha1: selection.file.hashes.sha1 } : {};
    await download(selection.file.url, destination, {
      allowedHosts: ['cdn.modrinth.com'],
      maxBytes: MAX_ADDON_BYTES,
      expectedSize: selection.file.size || 0,
      expectedHashes,
      requireJar: true
    });
  }
  return { canceled: false, path: destination, message: 'Live World Map mod exported.' };
}

function kickWorldMapPlayer(name, reason = '') {
  const player = validatePlayerName(name);
  if (!livePlayers.has(player.toLowerCase())) throw new Error(`${player} is no longer online.`);
  const message = normalizeBanMessage(reason);
  if (!sendServerCommand(`kick ${player}${message ? ` ${message}` : ''}`)) {
    throw new Error('The server console is unavailable.');
  }
  return { kicked: true, player };
}

async function readSecurityMetadata(paths = null) {
  const resolvedPaths = paths || await getPaths();
  return readJson(resolvedPaths.security, {});
}

async function writeSecurityMetadata(paths, metadata) {
  const temporary = `${paths.security}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, JSON.stringify(metadata, null, 2));
  await replaceFileAtomically(temporary, paths.security);
  return metadata;
}

function serializeFileWrite(file, work) {
  const previous = serializedFileWrites.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  serializedFileWrites.set(file, current);
  current.finally(() => {
    if (serializedFileWrites.get(file) === current) serializedFileWrites.delete(file);
  }).catch(() => {});
  return current;
}

function serializeProtectionStateTransaction(profileRoot, work) {
  const resolvedKey = path.resolve(String(profileRoot || ''));
  const key = process.platform === 'win32' ? resolvedKey.toLowerCase() : resolvedKey;
  const previous = protectionStateTransactions.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  protectionStateTransactions.set(key, current);
  current.finally(() => {
    if (protectionStateTransactions.get(key) === current) protectionStateTransactions.delete(key);
  }).catch(() => {});
  return current;
}

async function writeJsonAtomically(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2));
    await replaceFileAtomically(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return value;
}

function getBundledProtectionDataPath(paths) {
  return path.join(paths.plugins, BUNDLED_PROTECTION_NAME);
}

function getLegacyBundledProtectionDataPath(paths) {
  return path.join(paths.plugins, LEGACY_BUNDLED_PROTECTION_NAME);
}

function getBundledProtectionAdapter(serverType, minecraftVersion = '') {
  const resolved = resolveProtectionAdapter(serverType, minecraftVersion);
  if (!resolved) return null;
  if (resolved.id.startsWith('fabric-')) {
    const version = normalizeAddonVersion(minecraftVersion);
    const release = BUNDLED_PROTECTION_FABRIC_RELEASES[version];
    if (!release || release.adapterId !== resolved.id) return null;
    return Object.freeze({
      id: resolved.id,
      metadataKey: release.metadataKey,
      kind: 'mods',
      serverTypes: Object.freeze(['fabric']),
      minecraftVersion: version,
      managedFile: BUNDLED_PROTECTION_FABRIC_JAR,
      artifactFile: release.artifactFile,
      projectDirectory: release.projectDirectory,
      sha256: release.sha256,
      size: release.size,
      fabricApiFile: release.fabricApiFile,
      fabricApiArtifactFile: release.fabricApiArtifactFile,
      fabricApiVersion: release.fabricApiVersion,
      fabricApiSha256: release.fabricApiSha256,
      fabricApiSize: release.fabricApiSize,
      antiXrayProviderId: release.antiXrayProviderId,
      antiXrayProviderVersion: release.antiXrayProviderVersion,
      antiXrayNestedFile: release.antiXrayNestedFile,
      reloadCommand: 'serverprotection reload'
    });
  }
  return Object.freeze({
    id: 'bukkit',
    metadataKey: 'bukkit',
    kind: 'plugins',
    serverTypes: Object.freeze(['paper', 'purpur', 'spigot']),
    minecraftVersion: '',
    managedFile: BUNDLED_PROTECTION_JAR,
    artifactFile: BUNDLED_PROTECTION_JAR,
    fabricApiFile: '',
    fabricApiArtifactFile: '',
    reloadCommand: 'serverprotection reload'
  });
}

function getBundledProtectionAdapterById(adapterId) {
  const fabricRelease = Object.values(BUNDLED_PROTECTION_FABRIC_RELEASES)
    .find((release) => release.adapterId === adapterId);
  if (fabricRelease) {
    const version = Object.keys(BUNDLED_PROTECTION_FABRIC_RELEASES)
      .find((candidate) => BUNDLED_PROTECTION_FABRIC_RELEASES[candidate] === fabricRelease);
    return getBundledProtectionAdapter('fabric', version);
  }
  if (adapterId === 'bukkit') return getBundledProtectionAdapter('paper', '');
  return null;
}

function isBundledFabricProtectionAdapter(adapter) {
  return Boolean(adapter?.kind === 'mods' && adapter?.id?.startsWith('fabric-') &&
    BUNDLED_PROTECTION_FABRIC_RELEASES[adapter.minecraftVersion]?.adapterId === adapter.id);
}

function getProtectionRuntimePaths(paths, adapter) {
  if (isBundledFabricProtectionAdapter(adapter)) {
    return {
      directory: paths.fabricProtectionDir,
      config: paths.fabricProtectionConfig,
      access: paths.fabricProtectionAccess,
      offenses: paths.fabricProtectionOffenses,
      events: paths.fabricProtectionEvents,
      status: paths.fabricProtectionStatus
    };
  }
  return {
    directory: getBundledProtectionDataPath(paths),
    config: path.join(getBundledProtectionDataPath(paths), 'config.yml'),
    access: path.join(getBundledProtectionDataPath(paths), 'access.yml'),
    offenses: paths.protectionOffenses,
    events: path.join(getBundledProtectionDataPath(paths), 'events.jsonl'),
    status: path.join(getBundledProtectionDataPath(paths), 'status.json')
  };
}

function readBundledProtectionMetadataRecord(metadata, adapter) {
  const current = metadata?.builtInProtection?.adapters?.[adapter?.metadataKey];
  if (current && typeof current === 'object' && !Array.isArray(current)) return current;
  if (adapter?.id === 'bukkit' && metadata?.builtInAntiCheat && typeof metadata.builtInAntiCheat === 'object') {
    return metadata.builtInAntiCheat;
  }
  return {};
}

function withBundledProtectionMetadataRecord(metadata, adapter, record) {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const protection = source.builtInProtection && typeof source.builtInProtection === 'object'
    ? source.builtInProtection : {};
  const adapters = protection.adapters && typeof protection.adapters === 'object'
    ? protection.adapters : {};
  return {
    ...source,
    builtInProtection: {
      schema: 1,
      ...protection,
      adapters: { ...adapters, [adapter.metadataKey]: record }
    }
  };
}

function getBundledAccessConfigPath(paths, adapter = getBundledProtectionAdapterById('bukkit')) {
  return getProtectionRuntimePaths(paths, adapter).access;
}

function getLegacyBundledAccessConfigPath(paths) {
  return path.join(getLegacyBundledProtectionDataPath(paths), 'access.yml');
}

async function isRegularFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function writeTextAtomically(destination, text) {
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.writeFile(temporary, text, 'utf8');
    await replaceFileAtomically(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return destination;
}

async function captureSmallFileSnapshot(file, maximumBytes = MAX_PROTECTION_CONFIG_BYTES) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file.`);
    if (stat.size > maximumBytes) throw new Error(`${path.basename(file)} is too large to snapshot safely.`);
    return Object.freeze({ file, existed: true, data: await fs.readFile(file) });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ file, existed: false, data: null });
    throw error;
  }
}

async function restoreSmallFileSnapshot(snapshot) {
  if (!snapshot?.file) return;
  if (!snapshot.existed) {
    await fs.rm(snapshot.file, { force: true });
    return;
  }
  const temporary = `${snapshot.file}.restore-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.dirname(snapshot.file), { recursive: true });
  try {
    await fs.writeFile(temporary, snapshot.data);
    await replaceFileAtomically(temporary, snapshot.file);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function shouldWriteLegacyBundledProtectionConfig(paths) {
  const { current } = getBundledProtectionJarPaths(paths);
  return !await isRegularFile(current) && await isDirectory(getLegacyBundledProtectionDataPath(paths));
}

async function readPlayerAccess(paths = null) {
  const resolvedPaths = paths || await getPaths();
  try {
    const stat = await fs.stat(resolvedPaths.accessControl);
    if (stat.size > MAX_PROTECTION_CONFIG_BYTES) throw new Error('Player access config is too large.');
    return normalizeAccessConfig(JSON.parse(await fs.readFile(resolvedPaths.accessControl, 'utf8')), { strict: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeAccessConfig();
    throw new Error(`Could not read player access settings: ${error?.message || String(error)}`);
  }
}

async function writeBundledAccessConfig(paths, config, adapter = getBundledProtectionAdapterById('bukkit')) {
  const destination = getBundledAccessConfigPath(paths, adapter);
  const rendered = renderAccessYaml(config);
  await writeTextAtomically(destination, rendered);
  if (adapter.id === 'bukkit' && await shouldWriteLegacyBundledProtectionConfig(paths)) {
    await writeTextAtomically(getLegacyBundledAccessConfigPath(paths), rendered);
  }
  return destination;
}

async function persistPlayerAccess(paths, config) {
  const normalized = normalizeAccessConfig(config);
  if (Buffer.byteLength(JSON.stringify(normalized, null, 2), 'utf8') > MAX_PROTECTION_CONFIG_BYTES) {
    throw new Error('Player access config is too large.');
  }
  await writeJsonAtomically(paths.accessControl, normalized);
  await writeBundledAccessConfig(paths, normalized);
  return normalized;
}

async function getPlayerAccess() {
  return accessConfigForUi(await readPlayerAccess());
}

async function completePlayerAccessMutation(paths, saved) {
  const config = saved.config;
  const protection = await getProtectionConfig(paths);
  const builtIn = await getBundledAntiCheatStatus(paths, protection);
  const adapter = getBundledProtectionAdapterById(builtIn.adapterId);
  const enforcementReady = Boolean(builtIn.installed && builtIn.integrityVerified && builtIn.runtimeCompatible);
  if (builtIn.installed && adapter) {
    await writeBundledProtectionConfig(paths, protection, adapter);
    await writeBundledAccessConfig(paths, config, adapter);
  }
  let appliedLive = false;
  if (enforcementReady && builtIn.active && isServerRuntimeReady() && adapter) {
    appliedLive = Boolean((await reloadBundledProtectionRuntime(adapter)).appliedLive);
  }
  const playerViewRecovery = await restoreRevokedPlayerSpectateSessions(config, paths);
  const serverConfig = await readConfig(paths);
  await applyRuntimePvpProtection(serverConfig, 'access-save', {
    paths,
    access: config,
    previousAccess: saved.previousAccess
  });
  cachedStatus = null;
  return {
    ...accessConfigForUi(config),
    ...saved.result,
    playerViewRecovery,
    enforcementReady,
    appliedLive,
    restartRequired: Boolean(enforcementReady && serverProcess && !appliedLive)
  };
}

async function mutatePlayerAccess(update) {
  const paths = await getPaths();
  return serializeProtectionStateTransaction(paths.root, async () => {
    const saved = await serializeFileWrite(paths.accessControl, async () => {
      const current = await readPlayerAccess(paths);
      const requested = await update(current);
      const config = requested?.config || requested;
      return {
        config: await persistPlayerAccess(paths, config),
        previousAccess: current,
        result: requested?.config
          ? Object.fromEntries(Object.entries(requested).filter(([key]) => key !== 'config'))
          : {}
      };
    });
    return completePlayerAccessMutation(paths, saved);
  });
}

async function savePlayerAccess(value = {}) {
  return mutatePlayerAccess((current) => setAccessAssignment(current, value));
}

async function deletePlayerAccess(player) {
  return mutatePlayerAccess((current) => removeAccessAssignment(current, player));
}

async function savePlayerAccessRole(value = {}) {
  return mutatePlayerAccess((current) => setAccessRole(current, value));
}

async function deletePlayerAccessRole(value) {
  return mutatePlayerAccess((current) => removeAccessRole(current, value));
}

function normalizeProtectionConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceLayers = source.layers && typeof source.layers === 'object' ? source.layers : {};
  const sourceChecks = source.checks && typeof source.checks === 'object' ? source.checks : {};
  const sourceEscalation = source.escalation && typeof source.escalation === 'object' ? source.escalation : {};
  const sourceExemptions = source.exemptions && typeof source.exemptions === 'object' ? source.exemptions : {};
  const preset = ['compatibility', 'balanced', 'strict', 'custom'].includes(source.preset) ? source.preset : 'balanced';
  const checks = {};
  for (const id of Object.keys(PROTECTION_CHECKS)) {
    checks[id] = Object.prototype.hasOwnProperty.call(sourceChecks, id)
      ? Boolean(sourceChecks[id])
      : presetProtectionCheckValue(preset, id);
  }
  const byOffense = new Map();
  const presetSteps = preset === 'strict'
    ? [
        { offense: 1, action: 'kick', durationMinutes: 0 },
        { offense: 2, action: 'temp-ban', durationMinutes: 60 },
        { offense: 4, action: 'ban', durationMinutes: 0 }
      ]
    : preset === 'compatibility'
      ? [
          { offense: 2, action: 'kick', durationMinutes: 0 },
          { offense: 5, action: 'temp-ban', durationMinutes: 30 },
          { offense: 10, action: 'ban', durationMinutes: 0 }
        ]
      : DEFAULT_PROTECTION_CONFIG.escalation.steps;
  for (const candidate of Array.isArray(sourceEscalation.steps) ? sourceEscalation.steps : presetSteps) {
    const offense = Math.max(1, Math.min(100, Math.round(Number(candidate?.offense) || 0)));
    const action = ['kick', 'temp-ban', 'ban'].includes(candidate?.action) ? candidate.action : '';
    if (!offense || !action) continue;
    const durationMinutes = action === 'temp-ban'
      ? Math.max(1, Math.min(525_600, Math.round(Number(candidate?.durationMinutes) || 30)))
      : 0;
    byOffense.set(offense, { offense, action, durationMinutes });
  }
  const parsedSteps = [...byOffense.values()].sort((a, b) => a.offense - b.offense);
  const fallbackByAction = Object.fromEntries(presetSteps.map((step) => [step.action, step]));
  const kickSource = parsedSteps.find((step) => step.action === 'kick') || fallbackByAction.kick;
  const tempBanSource = parsedSteps.find((step) => step.action === 'temp-ban') || fallbackByAction['temp-ban'];
  const banSource = parsedSteps.find((step) => step.action === 'ban') || fallbackByAction.ban;
  const kickOffense = Math.max(1, Math.min(98, Number(kickSource?.offense) || 1));
  const tempBanOffense = Math.max(kickOffense + 1, Math.min(99, Number(tempBanSource?.offense) || kickOffense + 1));
  const banOffense = Math.max(tempBanOffense + 1, Math.min(100, Number(banSource?.offense) || tempBanOffense + 1));
  const steps = [
    { offense: kickOffense, action: 'kick', durationMinutes: 0 },
    {
      offense: tempBanOffense,
      action: 'temp-ban',
      durationMinutes: Math.max(1, Math.min(525_600, Number(tempBanSource?.durationMinutes) || 60))
    },
    { offense: banOffense, action: 'ban', durationMinutes: 0 }
  ];
  const policy = normalizeModPolicyConfig(source);
  const messages = normalizeProtectionMessages(source.messages);
  const tuning = normalizeProtectionTuning(source.tuning, preset);
  return {
    version: 6,
    preset,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    layers: {
      builtIn: sourceLayers.builtIn === undefined ? true : Boolean(sourceLayers.builtIn),
      antiXray: Boolean(sourceLayers.antiXray),
      // Entity withholding removes the player entity and its nametag from the client. That makes
      // legitimate PvP targets pop in/out around walls, so managed servers preserve vanilla
      // visibility even when an older saved profile requested the retired mitigation.
      espMitigation: false
    },
    checks,
    escalation: {
      enabled: sourceEscalation.enabled === undefined ? true : Boolean(sourceEscalation.enabled),
      preThresholdAction: ['log', 'warn'].includes(sourceEscalation.preThresholdAction)
        ? sourceEscalation.preThresholdAction
        : 'warn',
      decayHours: Math.max(1, Math.min(8760, Math.round(Number(sourceEscalation.decayHours) || 168))),
      steps
    },
    exemptions: {
      owners: Boolean(sourceExemptions.owners),
      admins: Boolean(sourceExemptions.admins),
      players: [...new Map((Array.isArray(sourceExemptions.players) ? sourceExemptions.players : [])
        .map((player) => String(player || '').trim())
        .filter((player) => /^[A-Za-z0-9_]{1,16}$/.test(player))
        .slice(0, 256)
        .map((player) => [player.toLowerCase(), player])).values()]
    },
    messages,
    tuning,
    compatibility: policy.compatibility,
    modPolicy: policy.modPolicy,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : ''
  };
}

async function getProtectionConfig(paths = null) {
  const resolvedPaths = paths || await getPaths();
  let stored = {};
  try {
    if ((await fs.stat(resolvedPaths.protectionConfig)).size > MAX_PROTECTION_CONFIG_BYTES) throw new Error('Protection config is too large.');
    stored = JSON.parse(await fs.readFile(resolvedPaths.protectionConfig, 'utf8'));
  } catch {}
  try {
    return normalizeProtectionConfig(stored);
  } catch (error) {
    appendServerLog(`[Server Manager] Ignored an invalid protection compatibility policy: ${error.message || String(error)}\n`);
    return normalizeProtectionConfig({
      ...stored,
      compatibility: undefined,
      modPolicy: undefined
    });
  }
}

function getPluginResponseConfig(config) {
  const kick = config.escalation.steps.find((step) => step.action === 'kick');
  const tempBan = config.escalation.steps.find((step) => step.action === 'temp-ban');
  const permanentBan = config.escalation.steps.find((step) => step.action === 'ban');
  const tuning = normalizeProtectionTuning(config.tuning, config.preset);
  return {
    alertVl: tuning.response.alertVl,
    kickVl: tuning.response.kickVl,
    kickOffenses: kick?.offense || 1,
    tempBanOffenses: tempBan?.offense || 2,
    tempBanMinutes: tempBan?.durationMinutes || 30,
    permanentBanOffenses: permanentBan?.offense || 4
  };
}

function renderBundledProtectionConfig(config, exemptPlayers = config.exemptions?.players || []) {
  const enabled = Boolean(config.enabled && config.layers.builtIn);
  const response = getPluginResponseConfig(config);
  const tuning = normalizeProtectionTuning(config.tuning, config.preset);
  const grouped = {};
  for (const [id, category] of Object.entries(PROTECTION_CHECKS)) {
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push([id, enabled && Boolean(config.checks[id])]);
  }
  return [
    '# Managed by Server Manager. Change protection settings in the app.',
    `preset: ${config.preset}`,
    `enabled: ${enabled}`,
    'checks:',
    ...Object.entries(grouped).flatMap(([category, checks]) => [
      `  ${category}:`,
      ...checks.map(([id, active]) => `    ${id}: ${active}`)
    ]),
    'response:',
    `  enabled: ${Boolean(enabled && config.escalation.enabled)}`,
    `  preThresholdAction: ${config.escalation.preThresholdAction}`,
    `  alertVl: ${response.alertVl}`,
    `  kickVl: ${response.kickVl}`,
    `  kickOffenses: ${response.kickOffenses}`,
    `  tempBanOffenses: ${response.tempBanOffenses}`,
    `  tempBanMinutes: ${response.tempBanMinutes}`,
    `  permanentBanOffenses: ${response.permanentBanOffenses}`,
    `  offenseDecayHours: ${config.escalation.decayHours}`,
    `  actionCooldownSeconds: ${tuning.response.actionCooldownSeconds}`,
    ...renderProtectionMessagesYaml(config.messages).trimEnd().split('\n'),
    `violation-decay: ${tuning.response.violationDecay}`,
    `minimum-tps: ${tuning.minimumTps}`,
    'reach:',
    `  geometryAllowance: ${tuning.reach.geometryAllowance}`,
    `  maxPingAllowance: ${tuning.reach.maxPingAllowance}`,
    `  pingAllowancePerMs: ${tuning.reach.pingAllowancePerMs}`,
    `  maxTickAllowance: ${tuning.reach.maxTickAllowance}`,
    `  tickAllowancePerMissingTps: ${tuning.reach.tickAllowancePerMissingTps}`,
    `  maxTargetRewind: ${tuning.reach.maxTargetRewind}`,
    `  baseRewindTicks: ${tuning.reach.baseRewindTicks}`,
    `  pingRewindTicksPerMs: ${tuning.reach.pingRewindTicksPerMs}`,
    `  maxRewindTicks: ${tuning.reach.maxRewindTicks}`,
    `  immediateExcess: ${tuning.reach.immediateExcess}`,
    `  consecutiveSamples: ${tuning.reach.consecutiveSamples}`,
    `  evidenceWindowMillis: ${tuning.reach.evidenceWindowMillis}`,
    'mitigations:',
    '  entityEsp:',
    `    enabled: ${Boolean(enabled && config.layers.espMitigation)}`,
    `    minimumTps: ${tuning.minimumTps}`,
    '    nearRevealRadius: 10',
    '    maximumVisibleDistance: 96',
    '    scanIntervalTicks: 4',
    '    maxPairsPerTick: 96',
    '    hideAfterSamples: 3',
    '    revealAfterSamples: 2',
    '    maxTrackedPairs: 4096',
    '    maxOnlinePlayers: 64',
    'bypass-permission: serverprotection.bypass',
    'exempt-worlds: []',
    ...(exemptPlayers.length
      ? ['exempt-players:', ...exemptPlayers.map((player) => `  - ${JSON.stringify(player)}`)]
      : ['exempt-players: []']),
    ...renderModPolicyYaml(config).trimEnd().split('\n'),
    'grace:',
    `  joinSeconds: ${tuning.grace.joinSeconds}`,
    `  teleportSeconds: ${tuning.grace.teleportSeconds}`,
    `  velocitySeconds: ${tuning.grace.velocitySeconds}`,
    'limits:',
    '  movement:',
    `    maxGroundBlocksPerTick: ${tuning.limits.maxGroundBlocksPerTick}`,
    `    maxAirBlocksPerTick: ${tuning.limits.maxAirBlocksPerTick}`,
    `    maxAirTicks: ${tuning.limits.maxAirTicks}`,
    `    phaseSamples: ${tuning.limits.phaseSamples}`,
    `    groundSpoofSamples: ${tuning.limits.groundSpoofSamples}`,
    `    waterWalkSamples: ${tuning.limits.waterWalkSamples}`,
    `    stepSamples: ${tuning.limits.stepSamples}`,
    `    maxUseItemBlocksPerTick: ${tuning.limits.maxUseItemBlocksPerTick}`,
    `    noSlowSamples: ${tuning.limits.noSlowSamples}`,
    `    maxPacketsPerSecond: ${tuning.limits.maxPacketsPerSecond}`,
    `    timerEvidenceWindows: ${tuning.limits.timerEvidenceWindows}`,
    '  combat:',
    `    maxReach: ${tuning.limits.maxReach}`,
    `    maxCps: ${tuning.limits.maxCps}`,
    `    wallHitSamples: ${tuning.limits.wallHitSamples}`,
    `    multiTargetCount: ${tuning.limits.multiTargetCount}`,
    `    multiTargetWindowMillis: ${tuning.limits.multiTargetWindowMillis}`,
    `    maxAimDeviationDegrees: ${tuning.limits.maxAimDeviationDegrees}`,
    `    aimEvidenceSamples: ${tuning.limits.aimEvidenceSamples}`,
    `    aimEvidenceWindowMillis: ${tuning.limits.aimEvidenceWindowMillis}`,
    `    rapidSwitchMillis: ${tuning.limits.rapidSwitchMillis}`,
    `    rapidSwitchAngleDegrees: ${tuning.limits.rapidSwitchAngleDegrees}`,
    `    rapidSwitchSamples: ${tuning.limits.rapidSwitchSamples}`,
    `    rapidSwitchEvidenceWindowMillis: ${tuning.limits.rapidSwitchEvidenceWindowMillis}`,
    `    clickPatternSamples: ${tuning.limits.clickPatternSamples}`,
    `    clickPatternMaxDeviationMillis: ${tuning.limits.clickPatternMaxDeviationMillis}`,
    `    criticalSamples: ${tuning.limits.criticalSamples}`,
    `    criticalWindowMillis: ${tuning.limits.criticalWindowMillis}`,
    '  world:',
    `    maxBreaksPerSecond: ${tuning.limits.maxBreaksPerSecond}`,
    `    maxPlacesPerSecond: ${tuning.limits.maxPlacesPerSecond}`,
    `    blockReachAllowance: ${tuning.limits.blockReachAllowance}`,
    `    scaffoldAimDegrees: ${tuning.limits.scaffoldAimDegrees}`,
    `    scaffoldSamples: ${tuning.limits.scaffoldSamples}`,
    `    scaffoldWindowMillis: ${tuning.limits.scaffoldWindowMillis}`,
    `    multiBreakSamples: ${tuning.limits.multiBreakSamples}`,
    `    multiBreakWindowMillis: ${tuning.limits.multiBreakWindowMillis}`,
    `    multiBreakMinSpan: ${tuning.limits.multiBreakMinSpan}`,
    '  abuse:',
    `    maxChatPerFiveSeconds: ${tuning.limits.maxChatPerFiveSeconds}`,
    `    maxCommandsPerFiveSeconds: ${tuning.limits.maxCommandsPerFiveSeconds}`,
    `    maxInventoryClicksPerSecond: ${tuning.limits.maxInventoryClicksPerSecond}`,
    ''
  ].join('\n');
}

function renderFabricProtectionConfig(config, exemptPlayers = []) {
  const enabled = Boolean(config.enabled && config.layers.builtIn);
  const response = getPluginResponseConfig(config);
  const tuning = normalizeProtectionTuning(config.tuning, config.preset);
  const check = (id) => Boolean(enabled && config.checks[id]);
  const compatibilityRules = config.compatibility?.playerOverrides || {};
  const scopedPlayers = (id) => {
    const fullId = `${PROTECTION_CHECKS[id]}.${id}`;
    return Object.entries(compatibilityRules)
      .filter(([, rule]) => Array.isArray(rule?.exemptChecks) && rule.exemptChecks.includes(fullId))
      .map(([player]) => player)
      .sort((left, right) => left.localeCompare(right));
  };
  const inlinePlayers = (id) => `[${scopedPlayers(id).map(player => JSON.stringify(player)).join(', ')}]`;
  return [
    '# Managed by Server Manager. This file contains only settings supported by the Fabric adapter.',
    `preset: ${config.preset}`,
    `enabled: ${enabled}`,
    'checks:',
    '  movement:',
    `    speed: ${check('speed')}`,
    `    flight: ${check('flight')}`,
    `    phase: ${check('phase')}`,
    `    invalidPosition: ${check('invalidPosition')}`,
    `    invalidRotation: ${check('invalidRotation')}`,
    `    groundSpoof: ${check('groundSpoof')}`,
    `    waterWalk: ${check('waterWalk')}`,
    `    step: ${check('step')}`,
    `    timer: ${check('timer')}`,
    `    noSlow: ${check('noSlow')}`,
    '  combat:',
    `    reach: ${check('reach')}`,
    `    wallHit: ${check('wallHit')}`,
    `    autoClicker: ${check('autoClicker')}`,
    `    multiTarget: ${check('multiTarget')}`,
    `    aimDirection: ${check('aimDirection')}`,
    `    killAura: ${check('killAura')}`,
    `    clickPattern: ${check('clickPattern')}`,
    `    criticals: ${check('criticals')}`,
    '  world:',
    `    fastBreak: ${check('fastBreak')}`,
    `    fastPlace: ${check('fastPlace')}`,
    `    breakReach: ${check('breakReach')}`,
    `    placeReach: ${check('placeReach')}`,
    `    scaffold: ${check('scaffold')}`,
    `    multiBreak: ${check('multiBreak')}`,
    '  abuse:',
    `    chatSpam: ${check('chatSpam')}`,
    `    commandSpam: ${check('commandSpam')}`,
    `    inventorySpam: ${check('inventorySpam')}`,
    '# Explicit compatibility rules are player/UUID and check scoped; client declarations are not trusted.',
    'check-exemptions:',
    '  movement:',
    `    speed: ${inlinePlayers('speed')}`,
    `    flight: ${inlinePlayers('flight')}`,
    `    phase: ${inlinePlayers('phase')}`,
    `    invalidPosition: ${inlinePlayers('invalidPosition')}`,
    `    invalidRotation: ${inlinePlayers('invalidRotation')}`,
    `    groundSpoof: ${inlinePlayers('groundSpoof')}`,
    `    waterWalk: ${inlinePlayers('waterWalk')}`,
    `    step: ${inlinePlayers('step')}`,
    `    timer: ${inlinePlayers('timer')}`,
    `    noSlow: ${inlinePlayers('noSlow')}`,
    '  combat:',
    `    reach: ${inlinePlayers('reach')}`,
    `    wallHit: ${inlinePlayers('wallHit')}`,
    `    autoClicker: ${inlinePlayers('autoClicker')}`,
    `    multiTarget: ${inlinePlayers('multiTarget')}`,
    `    aimDirection: ${inlinePlayers('aimDirection')}`,
    `    killAura: ${inlinePlayers('killAura')}`,
    `    clickPattern: ${inlinePlayers('clickPattern')}`,
    `    criticals: ${inlinePlayers('criticals')}`,
    '  world:',
    `    fastBreak: ${inlinePlayers('fastBreak')}`,
    `    fastPlace: ${inlinePlayers('fastPlace')}`,
    `    breakReach: ${inlinePlayers('breakReach')}`,
    `    placeReach: ${inlinePlayers('placeReach')}`,
    `    scaffold: ${inlinePlayers('scaffold')}`,
    `    multiBreak: ${inlinePlayers('multiBreak')}`,
    '  abuse:',
    `    chatSpam: ${inlinePlayers('chatSpam')}`,
    `    commandSpam: ${inlinePlayers('commandSpam')}`,
    `    inventorySpam: ${inlinePlayers('inventorySpam')}`,
    ...renderModPolicyYaml(config).trimEnd().split('\n'),
    'detection:',
    '  antiXray:',
    `    enabled: ${Boolean(enabled && config.layers.antiXray)}`,
    '    requiredConcealedSamples: 3',
    '    windowSeconds: 300',
    'response:',
    `  enabled: ${Boolean(enabled && config.escalation.enabled)}`,
    `  preThresholdAction: ${config.escalation.preThresholdAction}`,
    `  alertVl: ${response.alertVl}`,
    `  kickVl: ${response.kickVl}`,
    `  kickOffenses: ${response.kickOffenses}`,
    `  tempBanOffenses: ${response.tempBanOffenses}`,
    `  tempBanMinutes: ${response.tempBanMinutes}`,
    `  permanentBanOffenses: ${response.permanentBanOffenses}`,
    `  offenseDecayHours: ${config.escalation.decayHours}`,
    `  actionCooldownSeconds: ${tuning.response.actionCooldownSeconds}`,
    ...renderProtectionMessagesYaml(config.messages).trimEnd().split('\n'),
    `violation-decay: ${tuning.response.violationDecay}`,
    `minimum-tps: ${tuning.minimumTps}`,
    'reach:',
    `  geometryAllowance: ${tuning.reach.geometryAllowance}`,
    `  maxPingAllowance: ${tuning.reach.maxPingAllowance}`,
    `  pingAllowancePerMs: ${tuning.reach.pingAllowancePerMs}`,
    `  maxTickAllowance: ${tuning.reach.maxTickAllowance}`,
    `  tickAllowancePerMissingTps: ${tuning.reach.tickAllowancePerMissingTps}`,
    `  maxTargetRewind: ${tuning.reach.maxTargetRewind}`,
    `  baseRewindTicks: ${tuning.reach.baseRewindTicks}`,
    `  pingRewindTicksPerMs: ${tuning.reach.pingRewindTicksPerMs}`,
    `  maxRewindTicks: ${tuning.reach.maxRewindTicks}`,
    `  immediateExcess: ${tuning.reach.immediateExcess}`,
    `  consecutiveSamples: ${tuning.reach.consecutiveSamples}`,
    `  evidenceWindowMillis: ${tuning.reach.evidenceWindowMillis}`,
    'mitigations:',
    '  entityEsp:',
    `    enabled: ${Boolean(enabled && config.layers.espMitigation)}`,
    `    minimumTps: ${tuning.minimumTps}`,
    '    nearRevealRadius: 10',
    '    maximumVisibleDistance: 96',
    '    scanIntervalTicks: 4',
    '    maxPairsPerTick: 96',
    '    hideAfterSamples: 3',
    '    revealAfterSamples: 2',
    '    maxTrackedPairs: 4096',
    '    maxOnlinePlayers: 64',
    'exemptions:',
    `  owners: ${Boolean(config.exemptions.owners)}`,
    `  admins: ${Boolean(config.exemptions.admins)}`,
    ...(exemptPlayers.length
      ? ['  players:', ...exemptPlayers.map((player) => `    - ${JSON.stringify(player)}`)]
      : ['  players: []']),
    'grace:',
    `  joinSeconds: ${tuning.grace.joinSeconds}`,
    `  teleportSeconds: ${tuning.grace.teleportSeconds}`,
    `  velocitySeconds: ${tuning.grace.velocitySeconds}`,
    'limits:',
    '  movement:',
    `    maxGroundBlocksPerTick: ${tuning.limits.maxGroundBlocksPerTick}`,
    `    maxAirBlocksPerTick: ${tuning.limits.maxAirBlocksPerTick}`,
    `    maxAirTicks: ${tuning.limits.maxAirTicks}`,
    `    phaseSamples: ${tuning.limits.phaseSamples}`,
    `    groundSpoofSamples: ${tuning.limits.groundSpoofSamples}`,
    `    waterWalkSamples: ${tuning.limits.waterWalkSamples}`,
    `    stepSamples: ${tuning.limits.stepSamples}`,
    `    maxUseItemBlocksPerTick: ${tuning.limits.maxUseItemBlocksPerTick}`,
    `    noSlowSamples: ${tuning.limits.noSlowSamples}`,
    `    maxPacketsPerSecond: ${tuning.limits.maxPacketsPerSecond}`,
    `    timerEvidenceWindows: ${tuning.limits.timerEvidenceWindows}`,
    '  combat:',
    `    maxReach: ${tuning.limits.maxReach}`,
    `    maxCps: ${tuning.limits.maxCps}`,
    `    wallHitSamples: ${tuning.limits.wallHitSamples}`,
    `    multiTargetCount: ${tuning.limits.multiTargetCount}`,
    `    multiTargetWindowMillis: ${tuning.limits.multiTargetWindowMillis}`,
    `    maxAimDeviationDegrees: ${tuning.limits.maxAimDeviationDegrees}`,
    `    aimEvidenceSamples: ${tuning.limits.aimEvidenceSamples}`,
    `    aimEvidenceWindowMillis: ${tuning.limits.aimEvidenceWindowMillis}`,
    `    rapidSwitchMillis: ${tuning.limits.rapidSwitchMillis}`,
    `    rapidSwitchAngleDegrees: ${tuning.limits.rapidSwitchAngleDegrees}`,
    `    rapidSwitchSamples: ${tuning.limits.rapidSwitchSamples}`,
    `    rapidSwitchEvidenceWindowMillis: ${tuning.limits.rapidSwitchEvidenceWindowMillis}`,
    `    clickPatternSamples: ${tuning.limits.clickPatternSamples}`,
    `    clickPatternMaxDeviationMillis: ${tuning.limits.clickPatternMaxDeviationMillis}`,
    `    criticalSamples: ${tuning.limits.criticalSamples}`,
    `    criticalWindowMillis: ${tuning.limits.criticalWindowMillis}`,
    '  world:',
    `    maxBreaksPerSecond: ${tuning.limits.maxBreaksPerSecond}`,
    `    maxPlacesPerSecond: ${tuning.limits.maxPlacesPerSecond}`,
    `    blockReachAllowance: ${tuning.limits.blockReachAllowance}`,
    `    scaffoldAimDegrees: ${tuning.limits.scaffoldAimDegrees}`,
    `    scaffoldSamples: ${tuning.limits.scaffoldSamples}`,
    `    scaffoldWindowMillis: ${tuning.limits.scaffoldWindowMillis}`,
    `    multiBreakSamples: ${tuning.limits.multiBreakSamples}`,
    `    multiBreakWindowMillis: ${tuning.limits.multiBreakWindowMillis}`,
    `    multiBreakMinSpan: ${tuning.limits.multiBreakMinSpan}`,
    '  abuse:',
    `    maxChatPerFiveSeconds: ${tuning.limits.maxChatPerFiveSeconds}`,
    `    maxCommandsPerFiveSeconds: ${tuning.limits.maxCommandsPerFiveSeconds}`,
    `    maxInventoryClicksPerSecond: ${tuning.limits.maxInventoryClicksPerSecond}`,
    `    inventoryEvidenceSamples: ${tuning.limits.inventoryEvidenceSamples}`,
    `    inventorySampleIntervalMillis: ${tuning.limits.inventorySampleIntervalMillis}`,
    `    inventoryEvidenceWindowMillis: ${tuning.limits.inventoryEvidenceWindowMillis}`,
    `    maxInventoryBurstPacketsPerSecond: ${tuning.limits.maxInventoryBurstPacketsPerSecond}`,
    `    inventoryViolationCooldownMillis: ${tuning.limits.inventoryViolationCooldownMillis}`,
    ''
  ].join('\n');
}

function findYamlBlockEnd(lines, start, parentIndent) {
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!lines[index].trim() || lines[index].trimStart().startsWith('#')) continue;
    const indent = lines[index].match(/^ */)?.[0].length || 0;
    if (indent <= parentIndent) return index;
  }
  return lines.length;
}

function upsertYamlScalar(lines, start, end, indent, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^ {${indent}}${escapedKey}\\s*:\\s*[^#]*?(\\s*#.*)?$`);
  let found = false;
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(matcher);
    if (!match) continue;
    lines[index] = `${' '.repeat(indent)}${key}: ${value}${match[1] || ''}`;
    found = true;
  }
  if (!found) lines.splice(start + 1, 0, `${' '.repeat(indent)}${key}: ${value}`);
}

function normalizeFabricAntiXrayDimension(value) {
  const key = String(value || '').trim().replace(/^(["'])(.*)\1$/, '$2').toLowerCase();
  if (['overworld', 'minecraft:overworld'].includes(key)) return 'minecraft:overworld';
  if (['nether', 'the_nether', 'minecraft:the_nether'].includes(key)) return 'minecraft:the_nether';
  if (['end', 'the_end', 'minecraft:the_end'].includes(key)) return 'minecraft:the_end';
  return key;
}

function getFabricAntiXrayDimensionBlocks(lines, sectionStart, sectionEnd) {
  const blocks = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    if (!/^ {4}\S/.test(lines[index])) continue;
    const content = lines[index].replace(/\s+#.*$/, '').trim();
    if (!content.endsWith(':')) continue;
    blocks.push({ start: index, name: normalizeFabricAntiXrayDimension(content.slice(0, -1)) });
  }
  return blocks.map((block, index) => ({
    ...block,
    end: blocks[index + 1]?.start || sectionEnd
  }));
}

const FABRIC_ANTI_XRAY_SAFE_GLOBAL_SCALARS = Object.freeze([
  ['engine-mode', 1],
  ['enforce-engine-mode-2', false],
  ['max-block-height', BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MAX_HEIGHT],
  ['only-obfuscate-hidden-blocks', false],
  ['mode2-obfuscate-replacement-blocks', false],
  ['guarantee-hide-all-hidden-blocks', true],
  ['async-chunk-rewrite', true],
  ['async-worker-threads', 3],
  ['async-queue-size', 128],
  ['update-radius', 2],
  ['update-interval-ticks', 10],
  ['max-blocks-per-chunk', 4096]
]);

const FABRIC_ANTI_XRAY_SAFE_DIMENSION_SCALARS = Object.freeze([
  ['engine-mode', 1],
  ['max-block-height', BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MAX_HEIGHT],
  ['only-obfuscate-hidden-blocks', false],
  ['mode2-obfuscate-replacement-blocks', false],
  ['guarantee-hide-all-hidden-blocks', true]
]);

const FABRIC_ANTI_XRAY_SAFE_GLOBAL_HIDDEN_BLOCKS = Object.freeze([
  'minecraft:diamond_ore',
  'minecraft:deepslate_diamond_ore',
  'minecraft:emerald_ore',
  'minecraft:deepslate_emerald_ore',
  'minecraft:gold_ore',
  'minecraft:deepslate_gold_ore',
  'minecraft:iron_ore',
  'minecraft:deepslate_iron_ore',
  'minecraft:redstone_ore',
  'minecraft:deepslate_redstone_ore',
  'minecraft:lapis_ore',
  'minecraft:deepslate_lapis_ore',
  'minecraft:mossy_cobblestone',
  'minecraft:obsidian',
  'minecraft:coal_ore',
  'minecraft:deepslate_coal_ore',
  'minecraft:copper_ore',
  'minecraft:deepslate_copper_ore',
  'minecraft:raw_copper_block',
  'minecraft:raw_iron_block',
  'minecraft:clay',
  'minecraft:ancient_debris',
  'minecraft:nether_quartz_ore',
  'minecraft:nether_gold_ore'
]);

const FABRIC_ANTI_XRAY_SAFE_DIMENSION_HIDDEN_BLOCKS = Object.freeze({
  'minecraft:overworld': FABRIC_ANTI_XRAY_SAFE_GLOBAL_HIDDEN_BLOCKS,
  'minecraft:the_nether': Object.freeze([
    'minecraft:ancient_debris',
    'minecraft:nether_quartz_ore',
    'minecraft:nether_gold_ore'
  ]),
  'minecraft:the_end': Object.freeze([
    'minecraft:diamond_ore',
    'minecraft:deepslate_diamond_ore',
    'minecraft:emerald_ore',
    'minecraft:deepslate_emerald_ore'
  ])
});

const FABRIC_ANTI_XRAY_UNSAFE_HIDDEN_BLOCKS = new Set([
  'minecraft:chest',
  'minecraft:trapped_chest',
  'minecraft:ender_chest',
  'minecraft:barrel',
  'minecraft:hopper',
  'minecraft:dispenser',
  'minecraft:dropper',
  'minecraft:furnace',
  'minecraft:blast_furnace',
  'minecraft:smoker',
  'minecraft:brewing_stand',
  'minecraft:crafter',
  'minecraft:chiseled_bookshelf',
  'minecraft:decorated_pot',
  'minecraft:shulker_box'
]);

function normalizeFabricAntiXrayBlockId(value) {
  return String(value || '')
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2')
    .toLowerCase();
}

function isUnsafeFabricAntiXrayHiddenBlock(value) {
  const blockId = normalizeFabricAntiXrayBlockId(value);
  return FABRIC_ANTI_XRAY_UNSAFE_HIDDEN_BLOCKS.has(blockId) ||
    /(?:^|:)\w+_shulker_box$/.test(blockId);
}

function sanitizeFabricAntiXrayHiddenBlocks(values, fallback) {
  const seen = new Set();
  const sanitized = [];
  for (const value of values || []) {
    const blockId = normalizeFabricAntiXrayBlockId(value);
    if (!blockId || isUnsafeFabricAntiXrayHiddenBlock(blockId) || seen.has(blockId)) continue;
    seen.add(blockId);
    sanitized.push(blockId);
  }
  return sanitized.length ? sanitized : [...fallback];
}

function parseInlineYamlList(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('[') || !source.endsWith(']')) return [];
  return source.slice(1, -1).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function upsertFabricAntiXrayHiddenBlockList(lines, start, end, indent, fallback) {
  const matcher = new RegExp(`^ {${indent}}hidden-blocks\\s*:\\s*([^#]*?)(\\s*#.*)?$`);
  let listStart = -1;
  let inlineValue = '';
  let inlineComment = '';
  for (let index = start + 1; index < end; index += 1) {
    const match = lines[index].match(matcher);
    if (!match) continue;
    listStart = index;
    inlineValue = match[1].trim();
    inlineComment = match[2] || '';
    break;
  }

  if (listStart < 0) {
    const rendered = [
      `${' '.repeat(indent)}hidden-blocks:`,
      ...fallback.map((blockId) => `${' '.repeat(indent + 2)}- ${blockId}`)
    ];
    lines.splice(start + 1, 0, ...rendered);
    return;
  }

  let listEnd = listStart + 1;
  const values = parseInlineYamlList(inlineValue);
  if (!inlineValue || inlineValue === '[]') {
    for (; listEnd < end; listEnd += 1) {
      const line = lines[listEnd];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const lineIndent = line.match(/^\s*/)?.[0].length || 0;
      if (lineIndent <= indent) break;
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (!item) break;
      values.push(item[1]);
    }
  }

  const sanitized = sanitizeFabricAntiXrayHiddenBlocks(values, fallback);
  const rendered = [
    `${' '.repeat(indent)}hidden-blocks:${inlineComment}`,
    ...sanitized.map((blockId) => `${' '.repeat(indent + 2)}- ${blockId}`)
  ];
  lines.splice(listStart, listEnd - listStart, ...rendered);
}

function renderFabricAntiXrayDimensionLines(dimension) {
  const hiddenBlocks = FABRIC_ANTI_XRAY_SAFE_DIMENSION_HIDDEN_BLOCKS[dimension] ||
    FABRIC_ANTI_XRAY_SAFE_GLOBAL_HIDDEN_BLOCKS;
  return [
    `    ${dimension}:`,
    ...FABRIC_ANTI_XRAY_SAFE_DIMENSION_SCALARS.map(([key, value]) => `      ${key}: ${value}`),
    '      hidden-blocks:',
    ...hiddenBlocks.map((blockId) => `        - ${blockId}`)
  ];
}

function renderFabricPacketAntiXrayConfig(source, enabled) {
  const lines = String(source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  let sectionStart = lines.findIndex((line) => /^anti-xray:\s*(?:#.*)?$/.test(line));
  if (sectionStart < 0) {
    if (lines.length) lines.push('');
    sectionStart = lines.length;
    lines.push('anti-xray:');
  }

  let sectionEnd = findYamlBlockEnd(lines, sectionStart, 0);
  upsertYamlScalar(lines, sectionStart, sectionEnd, 2, 'enabled', Boolean(enabled));
  for (const [key, value] of FABRIC_ANTI_XRAY_SAFE_GLOBAL_SCALARS) {
    sectionEnd = findYamlBlockEnd(lines, sectionStart, 0);
    upsertYamlScalar(lines, sectionStart, sectionEnd, 2, key, value);
  }
  sectionEnd = findYamlBlockEnd(lines, sectionStart, 0);
  upsertFabricAntiXrayHiddenBlockList(
    lines,
    sectionStart,
    sectionEnd,
    2,
    FABRIC_ANTI_XRAY_SAFE_GLOBAL_HIDDEN_BLOCKS
  );

  sectionEnd = findYamlBlockEnd(lines, sectionStart, 0);
  const dimensionsStart = lines.findIndex((line, index) =>
    index > sectionStart && index < sectionEnd && /^ {2}dimension-settings\s*:\s*(?:#.*)?$/.test(line));
  if (dimensionsStart < 0) {
    lines.splice(sectionEnd, 0,
      '  dimension-settings:',
      ...BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_DIMENSIONS.flatMap(renderFabricAntiXrayDimensionLines));
  } else {
    const dimensionsEnd = findYamlBlockEnd(lines, dimensionsStart, 2);
    const blocks = getFabricAntiXrayDimensionBlocks(lines, dimensionsStart, dimensionsEnd);
    const knownDimensions = new Set(blocks.map((block) => block.name));
    const missingDimensions = BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_DIMENSIONS
      .filter((dimension) => !knownDimensions.has(dimension));
    if (missingDimensions.length) {
      lines.splice(dimensionsEnd, 0, ...missingDimensions.flatMap(renderFabricAntiXrayDimensionLines));
    }
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      for (const [key, value] of FABRIC_ANTI_XRAY_SAFE_DIMENSION_SCALARS) {
        upsertYamlScalar(lines, block.start, findYamlBlockEnd(lines, block.start, 4), 6, key, value);
      }
      upsertFabricAntiXrayHiddenBlockList(
        lines,
        block.start,
        findYamlBlockEnd(lines, block.start, 4),
        6,
        FABRIC_ANTI_XRAY_SAFE_DIMENSION_HIDDEN_BLOCKS[block.name] ||
          FABRIC_ANTI_XRAY_SAFE_GLOBAL_HIDDEN_BLOCKS
      );
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

async function writeFabricPacketAntiXrayConfig(paths, enabled) {
  let source = '';
  try {
    const stat = await fs.stat(paths.fabricAntiXrayConfig);
    if (!stat.isFile()) throw new Error('Fabric Anti-Xray config is not a regular file.');
    if (stat.size > MAX_PROTECTION_CONFIG_BYTES) throw new Error('Fabric Anti-Xray config is too large to edit safely.');
    source = await fs.readFile(paths.fabricAntiXrayConfig, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const rendered = renderFabricPacketAntiXrayConfig(source, enabled);
  if (Buffer.byteLength(rendered, 'utf8') > MAX_PROTECTION_CONFIG_BYTES) {
    throw new Error('Rendered Fabric Anti-Xray config exceeded its safety limit.');
  }
  await writeTextAtomically(paths.fabricAntiXrayConfig, rendered);
  return paths.fabricAntiXrayConfig;
}

function isFabricPacketAntiXrayConfigured(adapter, config) {
  return Boolean(
    isBundledFabricProtectionAdapter(adapter) && config?.enabled &&
    config.layers?.builtIn && config.layers?.antiXray
  );
}

function packetAntiXrayTransitionNeedsFreshChunks(adapter, previous, next, serverRunning = false) {
  return Boolean(
    serverRunning &&
    !isFabricPacketAntiXrayConfigured(adapter, previous) &&
    isFabricPacketAntiXrayConfigured(adapter, next)
  );
}

function getBundledProtectionConfigPath(paths, adapter = getBundledProtectionAdapterById('bukkit')) {
  return getProtectionRuntimePaths(paths, adapter).config;
}

function getLegacyBundledProtectionConfigPath(paths) {
  return path.join(getLegacyBundledProtectionDataPath(paths), 'config.yml');
}

async function writeBundledProtectionConfig(paths, config, adapter = getBundledProtectionAdapterById('bukkit')) {
  const destination = getBundledProtectionConfigPath(paths, adapter);
  const players = new Map((config.exemptions?.players || []).map((player) => [String(player).toLowerCase(), String(player)]));
  const access = await readPlayerAccess(paths);
  for (const assignment of access.assignments) {
    if (accessAssignmentHasCapability(access, assignment, 'protection.bypass')) {
      players.set(assignment.player.toLowerCase(), assignment.player);
    }
  }
  const directExemptPlayers = [...players.values()];
  if (config.exemptions?.owners || config.exemptions?.admins) {
    for (const assignment of access.assignments) {
      const compatibilityRole = assignmentCompatibilityRole(access, assignment);
      if ((config.exemptions.owners && compatibilityRole === 'owner') ||
          (config.exemptions.admins && compatibilityRole === 'admin')) {
        players.set(assignment.player.toLowerCase(), assignment.player);
      }
    }
  }
  const rendered = isBundledFabricProtectionAdapter(adapter)
    ? renderFabricProtectionConfig(config, directExemptPlayers)
    : renderBundledProtectionConfig(config, [...players.values()]);
  if (Buffer.byteLength(rendered, 'utf8') > MAX_PROTECTION_CONFIG_BYTES) {
    throw new Error('Rendered Server Protection config exceeded its safety limit.');
  }
  await writeTextAtomically(destination, rendered);
  if (isBundledFabricProtectionAdapter(adapter)) {
    await writeFabricPacketAntiXrayConfig(
      paths,
      Boolean(config.enabled && config.layers.builtIn && config.layers.antiXray)
    );
  }
  if (adapter.id === 'bukkit' && await shouldWriteLegacyBundledProtectionConfig(paths)) {
    await writeTextAtomically(getLegacyBundledProtectionConfigPath(paths), rendered);
  }
  return destination;
}

async function persistProtectionConfig(paths, previous, value = {}) {
  const requested = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const requestedPolicy = {};
  if (Object.prototype.hasOwnProperty.call(requested, 'compatibility')) {
    requestedPolicy.compatibility = requested.compatibility;
  }
  if (Object.prototype.hasOwnProperty.call(requested, 'modPolicy')) {
    requestedPolicy.modPolicy = requested.modPolicy;
  }
  const mergedPolicy = Object.keys(requestedPolicy).length
    ? mergeModPolicyConfig(previous, requestedPolicy)
    : normalizeModPolicyConfig(previous);
  const presetChanged = ['balanced', 'strict'].includes(requested.preset) && requested.preset !== previous.preset;
  const requestedEscalation = requested.escalation && typeof requested.escalation === 'object'
    ? requested.escalation
    : null;
  const requestedMessages = requested.messages && typeof requested.messages === 'object'
    ? requested.messages
    : null;
  const requestedTuning = requested.tuning && typeof requested.tuning === 'object'
    ? requested.tuning
    : null;
  const config = normalizeProtectionConfig({
    ...previous,
    ...requested,
    layers: { ...previous.layers, ...(requested.layers || {}) },
    checks: requested.checks ? { ...previous.checks, ...requested.checks } : presetChanged ? undefined : previous.checks,
    escalation: {
      ...previous.escalation,
      ...(requestedEscalation || {}),
      steps: requestedEscalation?.steps ?? (presetChanged ? undefined : previous.escalation.steps)
    },
    messages: requestedMessages ? {
      ...previous.messages,
      ...requestedMessages,
      // The renderer sends the complete override map. Replacing it is intentional:
      // removing a key is how a check returns to the global warning template.
      checks: requestedMessages.checks && typeof requestedMessages.checks === 'object'
        ? requestedMessages.checks
        : previous.messages?.checks
    } : previous.messages,
    tuning: requestedTuning ? {
      ...previous.tuning,
      ...requestedTuning,
      grace: { ...(previous.tuning?.grace || {}), ...(requestedTuning.grace || {}) },
      response: { ...(previous.tuning?.response || {}), ...(requestedTuning.response || {}) },
      reach: { ...(previous.tuning?.reach || {}), ...(requestedTuning.reach || {}) },
      limits: { ...(previous.tuning?.limits || {}), ...(requestedTuning.limits || {}) }
    } : presetChanged ? undefined : previous.tuning,
    compatibility: mergedPolicy.compatibility,
    modPolicy: mergedPolicy.modPolicy,
    updatedAt: new Date().toISOString()
  });
  if (Buffer.byteLength(JSON.stringify(config, null, 2), 'utf8') > MAX_PROTECTION_CONFIG_BYTES) {
    throw new Error('Protection config is too large. Remove unused compatibility rules and try again.');
  }
  await writeJsonAtomically(paths.protectionConfig, config);
  const builtIn = await getBundledAntiCheatStatus(paths, config);
  const adapter = getBundledProtectionAdapterById(builtIn.adapterId);
  const packetAntiXrayNeedsFreshChunks = packetAntiXrayTransitionNeedsFreshChunks(
    adapter,
    previous,
    config,
    Boolean(serverProcess)
  );
  let appliedLive = false;
  if (builtIn.installed && adapter) {
    await writeBundledProtectionConfig(paths, config, adapter);
    if (isServerRuntimeReady() && builtIn.integrityVerified && builtIn.runtimeCompatible && builtIn.active) {
      appliedLive = Boolean((await reloadBundledProtectionRuntime(adapter)).appliedLive);
    }
  }
  const fullyAppliedLive = Boolean(appliedLive && !packetAntiXrayNeedsFreshChunks);
  cachedStatus = null;
  return {
    ...config,
    appliedLive: fullyAppliedLive,
    restartRequired: Boolean(
      builtIn.installed && builtIn.runtimeCompatible && serverProcess &&
      !fullyAppliedLive
    )
  };
}

function serializeProtectionConfigMutation(file, work) {
  const previous = protectionConfigMutations.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  protectionConfigMutations.set(file, current);
  current.finally(() => {
    if (protectionConfigMutations.get(file) === current) protectionConfigMutations.delete(file);
  }).catch(() => {});
  return current;
}

async function mutateProtectionConfigForPaths(paths, update) {
  return serializeProtectionStateTransaction(paths.root, () => {
    return mutateProtectionConfigForPathsUnlocked(paths, update);
  });
}

async function mutateProtectionConfigForPathsUnlocked(paths, update) {
  return serializeProtectionConfigMutation(paths.protectionConfig, async () => {
    const previous = await getProtectionConfig(paths);
    const requested = typeof update === 'function' ? await update(previous) : update;
    return persistProtectionConfig(paths, previous, requested);
  });
}

async function saveProtectionConfig(value = {}) {
  const paths = await getPaths();
  return mutateProtectionConfigForPaths(paths, value);
}

async function getProtectionExemptions() {
  const config = await getProtectionConfig();
  return { ...config.exemptions, players: [...config.exemptions.players] };
}

async function saveProtectionExemptions(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const players = (Array.isArray(source.players) ? source.players : []).map((player) => validatePlayerName(player));
  const paths = await getPaths();
  const saved = await mutateProtectionConfigForPaths(paths, {
    exemptions: {
      owners: Boolean(source.owners),
      admins: Boolean(source.admins),
      players
    }
  });
  return {
    ...saved.exemptions,
    players: [...saved.exemptions.players],
    appliedLive: Boolean(saved.appliedLive),
    restartRequired: Boolean(saved.restartRequired)
  };
}

async function saveProtectionConfigFromRenderer(value = {}) {
  const requested = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  delete requested.compatibility;
  delete requested.modPolicy;
  return saveProtectionConfig(requested);
}

function protectionPolicyForUi(config) {
  const policy = normalizeModPolicyConfig(config);
  return {
    compatibility: policy.compatibility,
    modPolicy: policy.modPolicy,
    allowedMods: policy.modPolicy.allowed.map((modId) => ({ modId })),
    blockedMods: policy.modPolicy.blocked.map((modId) => ({ modId })),
    playerExceptions: Object.entries(policy.compatibility.playerOverrides).map(([player, rule]) => ({
      player,
      ...rule
    }))
  };
}

async function getModPolicy() {
  return protectionPolicyForUi(await getProtectionConfig());
}

function validateModPolicyList(value) {
  const list = String(value || '').trim().toLowerCase();
  if (list !== 'allowed' && list !== 'blocked') throw new Error('Choose the allowed or blocked mod list.');
  return list;
}

async function addModPolicyRule(value = {}) {
  const list = validateModPolicyList(value.list);
  const modId = normalizeModId(value.modId);
  const paths = await getPaths();
  const saved = await mutateProtectionConfigForPaths(paths, (current) => {
    const target = new Set(current.modPolicy[list]);
    const oppositeList = list === 'allowed' ? 'blocked' : 'allowed';
    const opposite = new Set(current.modPolicy[oppositeList]);
    target.add(modId);
    opposite.delete(modId);
    const nextLists = {
      [list]: [...target],
      [oppositeList]: [...opposite]
    };
    return {
      modPolicy: {
        ...nextLists,
        enabled: true,
        enforcement: 'kick',
        enforceAllowlist: nextLists.allowed.length > 0
      }
    };
  });
  return { policy: protectionPolicyForUi(saved) };
}

async function removeModPolicyRule(value = {}) {
  const list = validateModPolicyList(value.list);
  const modId = normalizeModId(value.modId);
  const paths = await getPaths();
  const saved = await mutateProtectionConfigForPaths(paths, (current) => {
    const target = new Set(current.modPolicy[list]);
    target.delete(modId);
    const allowed = list === 'allowed' ? [...target] : [...current.modPolicy.allowed];
    const blocked = list === 'blocked' ? [...target] : [...current.modPolicy.blocked];
    return {
      modPolicy: {
        allowed,
        blocked,
        enabled: allowed.length > 0 || blocked.length > 0,
        enforceAllowlist: allowed.length > 0
      }
    };
  });
  return { policy: protectionPolicyForUi(saved) };
}

function normalizeCompatibilityCheck(value) {
  const raw = String(value || '').trim();
  if (Object.prototype.hasOwnProperty.call(PROTECTION_CHECKS, raw)) {
    return normalizeCheckId(`${PROTECTION_CHECKS[raw]}.${raw}`);
  }
  return normalizeCheckId(raw);
}

async function addPlayerModException(value = {}) {
  const playerInput = String(value.player || '').trim();
  const player = normalizePlayerKey(playerInput);
  const rawModId = String(value.modId || '').trim().toLowerCase();
  const presetAliases = {
    mousetweaks: 'mouse-tweaks',
    'mouse-tweaks': 'mouse-tweaks',
    quickinventory: 'quick-inventory',
    'quick-inventory': 'quick-inventory',
    clickinterval: 'click-interval-auto-clicker',
    'click-interval': 'click-interval-auto-clicker',
    'click-interval-auto-clicker': 'click-interval-auto-clicker'
  };
  const presetId = presetAliases[rawModId] || '';
  const modId = normalizeModId(presetId || rawModId);
  const requestedChecks = Array.isArray(value.checks) ? value.checks.map(normalizeCompatibilityCheck) : [];
  const presetChecks = presetId ? [...COMPATIBILITY_PRESETS[presetId].exemptChecks] : [];
  const paths = await getPaths();
  const saved = await mutateProtectionConfigForPaths(paths, (current) => {
    const existing = current.compatibility.playerOverrides[player] || { exemptChecks: [] };
    const exemptChecks = [...new Set([...(existing.exemptChecks || []), ...requestedChecks, ...presetChecks])];
    if (!exemptChecks.length) {
      throw new Error('Choose at least one exact protection check for this player.');
    }
    const presets = new Set(existing.presets || []);
    if (presetId) presets.add(presetId);
    return {
      compatibility: {
        playerOverrides: {
          [player]: {
            ...existing,
            name: playerInput,
            reason: `Compatibility for ${modId}`,
            exemptChecks,
            presets: [...presets]
          }
        }
      }
    };
  });
  return { policy: protectionPolicyForUi(saved) };
}

async function removePlayerModException(value = {}) {
  const player = normalizePlayerKey(value.player);
  const paths = await getPaths();
  const saved = await mutateProtectionConfigForPaths(paths, {
    compatibility: {
      playerOverrides: {
        [player]: null
      }
    }
  });
  return { policy: protectionPolicyForUi(saved) };
}

function findZipEndRecord(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function validateZipEntryName(value) {
  const name = String(value || '');
  if (!name || name.length > 512 || name.includes('\\') || name.includes('\0') || /^\/?[A-Za-z]:/.test(name) || name.startsWith('/')) {
    throw new Error('The JAR contains an unsafe archive path.');
  }
  if (name.split('/').some((part) => part === '..')) throw new Error('The JAR contains a path traversal entry.');
  return name;
}

async function readFileHandleExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new Error('The selected JAR ended unexpectedly.');
    offset += result.bytesRead;
  }
  return buffer;
}

function createDescriptorBudgetError(message, budgetReason, scanBytes = 0, parsedEntries = 0) {
  const error = new Error(message);
  error.code = 'PLUGIN_DESCRIPTOR_SCAN_BUDGET';
  error.budgetReason = budgetReason;
  error.scanBytes = scanBytes;
  error.parsedEntries = parsedEntries;
  return error;
}

async function readSmallZipEntry(handle, statSize, entry, deadlineAt = Number.POSITIVE_INFINITY) {
  const maximumDescriptorBytes = 256 * 1024;
  if (!entry) throw new Error('The selected JAR descriptor entry is missing.');
  if (entry.encrypted) throw new Error('Encrypted plugin descriptors are not supported.');
  if (entry.compressedSize > maximumDescriptorBytes || entry.uncompressedSize > maximumDescriptorBytes) {
    throw new Error('The selected JAR descriptor exceeds the 256 KB safety limit.');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error('The selected JAR uses an unsupported descriptor compression method.');
  }
  if (Date.now() >= deadlineAt) {
    throw createDescriptorBudgetError('Plugin descriptor scan exceeded its wall-time budget.', 'wall-time budget exceeded');
  }
  const localHeader = await readFileHandleExactly(handle, 30, entry.localOffset);
  if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error('The selected JAR has a damaged local entry.');
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > statSize) throw new Error('The selected JAR has a truncated descriptor.');
  const compressed = await readFileHandleExactly(handle, entry.compressedSize, dataOffset);
  if (Date.now() >= deadlineAt) {
    throw createDescriptorBudgetError('Plugin descriptor scan exceeded its wall-time budget.', 'wall-time budget exceeded');
  }
  if (entry.compressionMethod === 0) return compressed.toString('utf8');
  return zlib.inflateRawSync(compressed, { maxOutputLength: maximumDescriptorBytes }).toString('utf8');
}

function parsePluginCommandNames(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let commandsIndent = -1;
  let commandEntryIndent = -1;
  const commands = [];
  for (const line of lines) {
    const content = line.trim();
    if (!content || content.startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (commandsIndent < 0) {
      if (/^commands\s*:\s*(?:#.*)?$/i.test(content)) commandsIndent = indent;
      continue;
    }
    if (indent <= commandsIndent) break;
    const match = line.match(/^\s+(?:"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'|([A-Za-z0-9_-]+))\s*:\s*(?:#.*)?$/);
    if (!match) continue;
    if (commandEntryIndent < 0) commandEntryIndent = indent;
    if (indent !== commandEntryIndent) continue;
    const command = String(match[1] || match[2] || match[3] || '').toLowerCase();
    if (command && !commands.includes(command)) commands.push(command);
  }
  return commands;
}

async function inspectJarDescriptor(file, budget = {}) {
  let scanBytes = 0;
  let parsedEntries = 0;
  const deadlineAt = Number.isFinite(Number(budget.deadlineAt))
    ? Number(budget.deadlineAt)
    : Number.POSITIVE_INFINITY;
  const maxScanBytes = Number.isFinite(Number(budget.maxScanBytes))
    ? Math.max(0, Math.floor(Number(budget.maxScanBytes)))
    : Number.POSITIVE_INFINITY;
  const maxParsedEntries = Number.isFinite(Number(budget.maxParsedEntries))
    ? Math.max(0, Math.floor(Number(budget.maxParsedEntries)))
    : Number.POSITIVE_INFINITY;
  const assertWithinDeadline = () => {
    if (Date.now() >= deadlineAt) {
      throw createDescriptorBudgetError(
        'Plugin descriptor scan exceeded its wall-time budget.',
        'wall-time budget exceeded',
        scanBytes,
        parsedEntries
      );
    }
  };
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ANTICHEAT_JAR_BYTES) {
    throw new Error(`Anti-cheat JAR must be a file no larger than ${Math.floor(MAX_ANTICHEAT_JAR_BYTES / 1024 / 1024)} MiB.`);
  }
  const handle = await fs.open(file, 'r');
  try {
    assertWithinDeadline();
    const signature = await readFileHandleExactly(handle, 4, 0);
    if (signature.readUInt32LE(0) !== 0x04034b50) throw new Error('The selected file is not a valid JAR archive.');
    const tailLength = Math.min(stat.size, 65_557);
    const tail = await readFileHandleExactly(handle, tailLength, stat.size - tailLength);
    assertWithinDeadline();
    const endOffset = findZipEndRecord(tail);
    if (endOffset < 0) throw new Error('The selected JAR has no valid ZIP directory.');
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const directorySize = tail.readUInt32LE(endOffset + 12);
    const directoryOffset = tail.readUInt32LE(endOffset + 16);
    if (!entryCount || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
        entryCount > 20_000 || directorySize > 16 * 1024 * 1024 || directoryOffset + directorySize > stat.size) {
      throw new Error('The selected JAR has an unsupported or unsafe ZIP directory.');
    }
    if (entryCount > maxParsedEntries) {
      throw createDescriptorBudgetError(
        'Plugin descriptor scan exceeded its ZIP-entry parsing budget.',
        'ZIP-entry parsing budget exceeded',
        scanBytes,
        parsedEntries
      );
    }
    if (directorySize > maxScanBytes) {
      throw createDescriptorBudgetError(
        'Plugin descriptor scan exceeded its central-directory/descriptor byte budget.',
        'central-directory/descriptor byte budget exceeded',
        scanBytes,
        parsedEntries
      );
    }
    scanBytes += directorySize;
    const directory = await readFileHandleExactly(handle, directorySize, directoryOffset);
    assertWithinDeadline();
    const entries = [];
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if ((index & 255) === 0) assertWithinDeadline();
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('The selected JAR has a damaged ZIP directory.');
      }
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (!nameLength || nextOffset > directory.length) throw new Error('The selected JAR has a damaged archive entry.');
      entries.push({
        name: validateZipEntryName(directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')),
        encrypted: Boolean(directory.readUInt16LE(offset + 8) & 1),
        compressionMethod: directory.readUInt16LE(offset + 10),
        compressedSize: directory.readUInt32LE(offset + 20),
        uncompressedSize: directory.readUInt32LE(offset + 24),
        localOffset: directory.readUInt32LE(offset + 42)
      });
      parsedEntries += 1;
      offset = nextOffset;
    }
    assertWithinDeadline();
    const lowerEntries = new Set(entries.map((entry) => entry.name.toLowerCase()));
    let descriptor = '';
    let kind = '';
    if (lowerEntries.has('plugin.yml')) {
      descriptor = 'plugin.yml';
      kind = 'plugins';
    } else if (lowerEntries.has('paper-plugin.yml')) {
      descriptor = 'paper-plugin.yml';
      kind = 'plugins';
    } else if (lowerEntries.has('fabric.mod.json')) {
      descriptor = 'fabric.mod.json';
      kind = 'mods';
    } else if (lowerEntries.has('quilt.mod.json')) {
      descriptor = 'quilt.mod.json';
      kind = 'mods';
    } else if (lowerEntries.has('meta-inf/mods.toml') || lowerEntries.has('meta-inf/neoforge.mods.toml')) {
      descriptor = lowerEntries.has('meta-inf/mods.toml') ? 'META-INF/mods.toml' : 'META-INF/neoforge.mods.toml';
      kind = 'mods';
    } else {
      throw new Error('This JAR has no supported Paper/Spigot, Fabric/Quilt, or Forge descriptor.');
    }
    const descriptorEntry = entries.find((entry) => entry.name.toLowerCase() === descriptor.toLowerCase());
    if (!descriptorEntry) throw new Error('The selected JAR descriptor entry is missing.');
    const descriptorCost = descriptorEntry.compressedSize + descriptorEntry.uncompressedSize;
    if (scanBytes + descriptorCost > maxScanBytes) {
      throw createDescriptorBudgetError(
        'Plugin descriptor scan exceeded its central-directory/descriptor byte budget.',
        'central-directory/descriptor byte budget exceeded',
        scanBytes,
        parsedEntries
      );
    }
    scanBytes += descriptorCost;
    const descriptorText = await readSmallZipEntry(handle, stat.size, descriptorEntry, deadlineAt);
    assertWithinDeadline();
    const pluginNameMatch = kind === 'plugins'
      ? descriptorText.match(/^\s*name\s*:\s*(?:['"]([^'"]+)['"]|([^#\r\n]+))/mi)
      : null;
    const pluginName = String(pluginNameMatch?.[1] || pluginNameMatch?.[2] || '').trim();
    const pluginMainMatch = kind === 'plugins'
      ? descriptorText.match(/^\s*main\s*:\s*(?:['"]([^'"]+)['"]|([^#\r\n]+))/mi)
      : null;
    const pluginMain = String(pluginMainMatch?.[1] || pluginMainMatch?.[2] || '').trim().slice(0, 256);
    let fabricModId = '';
    let fabricEnvironment = '';
    let fabricVersion = '';
    let fabricMainEntrypoints = [];
    let fabricMinecraftDependency = '';
    let quiltModId = '';
    let quiltVersion = '';
    let forgeModIds = [];
    if (descriptor === 'fabric.mod.json') {
      let fabricDescriptor;
      try {
        fabricDescriptor = JSON.parse(descriptorText);
      } catch {
        throw new Error('The Fabric mod descriptor is not valid JSON.');
      }
      fabricModId = String(fabricDescriptor?.id || '').trim().toLowerCase().slice(0, 128);
      fabricEnvironment = String(fabricDescriptor?.environment || '').trim().toLowerCase().slice(0, 32);
      fabricVersion = String(fabricDescriptor?.version || '').trim().slice(0, 128);
      const rawEntrypoints = fabricDescriptor?.entrypoints?.main;
      fabricMainEntrypoints = (Array.isArray(rawEntrypoints) ? rawEntrypoints : rawEntrypoints ? [rawEntrypoints] : [])
        .map((entry) => typeof entry === 'string' ? entry : entry?.value)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .slice(0, 32);
      const minecraftDependency = fabricDescriptor?.depends?.minecraft;
      fabricMinecraftDependency = String(Array.isArray(minecraftDependency)
        ? minecraftDependency[0] || '' : minecraftDependency || '').trim().slice(0, 128);
    } else if (descriptor === 'quilt.mod.json') {
      let quiltDescriptor;
      try {
        quiltDescriptor = JSON.parse(descriptorText);
      } catch {
        throw new Error('The Quilt mod descriptor is not valid JSON.');
      }
      quiltModId = String(quiltDescriptor?.quilt_loader?.id || '').trim().toLowerCase().slice(0, 128);
      quiltVersion = String(quiltDescriptor?.quilt_loader?.version || '').trim().slice(0, 128);
    } else if (descriptor.toLowerCase().endsWith('mods.toml')) {
      forgeModIds = [...descriptorText.matchAll(/^\s*modId\s*=\s*["']([A-Za-z0-9_.-]{1,128})["']/gmi)]
        .map((match) => String(match[1] || '').trim().toLowerCase())
        .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
        .slice(0, 64);
    }
    return {
      size: stat.size,
      entryCount,
      descriptor,
      kind,
      pluginName,
      pluginMain,
      fabricModId,
      fabricEnvironment,
      fabricVersion,
      fabricMainEntrypoints,
      fabricMinecraftDependency,
      quiltModId,
      quiltVersion,
      forgeModIds,
      declaredCommands: kind === 'plugins' ? parsePluginCommandNames(descriptorText) : [],
      bundledProtectionIdentity: lowerEntries.has('com/clickinterval/anticheat/clickintervalanticheat.class'),
      bundledFabricProtectionIdentity: lowerEntries.has(BUNDLED_PROTECTION_FABRIC_IDENTITY.toLowerCase()),
      bundledTeleportIdentity: lowerEntries.has(BUNDLED_TELEPORT_IDENTITY.toLowerCase()),
      bundledFabricTeleportIdentity: lowerEntries.has(BUNDLED_TELEPORT_FABRIC_IDENTITY.toLowerCase()),
      bundledFabricDeathLootIdentity: lowerEntries.has(BUNDLED_DEATH_LOOT_FABRIC_IDENTITY.toLowerCase()),
      bundledFabricTradeAssistantIdentity: lowerEntries.has(BUNDLED_TRADE_ASSISTANT_IDENTITY.toLowerCase()),
      bundledVoiceIdentity: lowerEntries.has(BUNDLED_VOICE_SERVER_IDENTITY.toLowerCase()),
      bundledFabricVoiceIdentity: lowerEntries.has(BUNDLED_VOICE_FABRIC_SERVER_IDENTITY.toLowerCase()),
      scanBytes,
      parsedEntries
    };
  } catch (error) {
    error.scanBytes = Math.max(scanBytes, Math.max(0, Math.floor(Number(error.scanBytes) || 0)));
    error.parsedEntries = Math.max(parsedEntries, Math.max(0, Math.floor(Number(error.parsedEntries) || 0)));
    throw error;
  } finally {
    await handle.close();
  }
}

async function inspectAntiCheatJar(file) {
  const descriptor = await inspectJarDescriptor(file);
  return { ...descriptor, sha256: await calculateFileHash(file, 'sha256') };
}

function fabricDependencyMatchesExact(value, minecraftVersion) {
  const normalized = String(value || '').trim().replace(/\s+/g, '');
  return normalized === minecraftVersion || normalized === `=${minecraftVersion}`;
}

function inspectionMatchesBundledProtectionAdapter(inspection, adapter) {
  if (!inspection || !adapter) return false;
  if (isBundledFabricProtectionAdapter(adapter)) {
    return inspection.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
      inspection.fabricModId === BUNDLED_PROTECTION_FABRIC_MOD_ID &&
      inspection.fabricEnvironment === 'server' &&
      inspection.fabricMainEntrypoints.includes(BUNDLED_PROTECTION_FABRIC_ENTRYPOINT) &&
      fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, adapter.minecraftVersion) &&
      inspection.bundledFabricProtectionIdentity === true;
  }
  return inspection.kind === 'plugins' && inspection.bundledProtectionIdentity === true &&
    inspection.pluginName === BUNDLED_PROTECTION_NAME;
}

function inspectionIsFabricApi(inspection) {
  return Boolean(inspection?.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
    inspection.fabricModId === 'fabric-api');
}

function inspectionMatchesBundledTradeAssistant(inspection) {
  return Boolean(inspection?.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
    inspection.fabricModId === BUNDLED_TRADE_ASSISTANT_MOD_ID &&
    inspection.fabricEnvironment === '*' &&
    inspection.fabricMainEntrypoints.includes(BUNDLED_TRADE_ASSISTANT_ENTRYPOINT) &&
    fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, BUNDLED_TRADE_ASSISTANT_MINECRAFT) &&
    inspection.bundledFabricTradeAssistantIdentity === true);
}

function getBundledPlayerViewCompanionRelease(minecraftVersion) {
  return BUNDLED_PLAYER_VIEW_COMPANION_RELEASES[normalizeAddonVersion(minecraftVersion)] || null;
}

function inspectionMatchesBundledPlayerViewCompanion(inspection, release) {
  return Boolean(inspection && release && release.sha256 && release.size > 0 &&
    inspection.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
    inspection.fabricModId === BUNDLED_PLAYER_VIEW_COMPANION_MOD_ID &&
    inspection.fabricEnvironment === 'client' &&
    inspection.fabricVersion === release.version &&
    fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, release.minecraftVersion) &&
    inspection.sha256 === release.sha256 && inspection.size === release.size);
}

async function findBundledPlayerViewCompanionArtifact(release) {
  if (!release?.projectDirectory || !release?.artifactFile || !release.sha256 || !(release.size > 0)) return null;
  const candidate = path.join(__dirname, release.projectDirectory, 'dist', release.artifactFile);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size !== release.size) return null;
    const inspection = await getCachedWork(
      `bundled-player-view-companion:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (!inspectionMatchesBundledPlayerViewCompanion(inspection, release)) return null;
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function getPlayerViewCompanionStatus(pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const [config, metadata] = await Promise.all([
    readJson(paths.config, DEFAULT_CONFIG).then(normalizeServerConfig),
    readPlatformMetadata(paths)
  ]);
  const minecraftVersion = normalizeAddonVersion(metadata?.minecraftVersion || config.serverVersion);
  const release = getBundledPlayerViewCompanionRelease(minecraftVersion);
  if (!release) {
    return {
      supported: false,
      available: false,
      loader: 'Fabric',
      minecraftVersion,
      version: BUNDLED_PLAYER_VIEW_COMPANION_VERSION,
      file: '',
      message: minecraftVersion
        ? `Private first-person view has no owner-side companion for Minecraft ${minecraftVersion}.`
        : 'Select an exact Minecraft version before saving the owner-side POV Companion.'
    };
  }
  const artifact = await findBundledPlayerViewCompanionArtifact(release);
  return {
    supported: true,
    available: Boolean(artifact),
    loader: 'Fabric',
    minecraftVersion: release.minecraftVersion,
    version: release.version,
    file: release.artifactFile,
    sha256: artifact?.sha256 || '',
    size: Number(artifact?.size) || 0,
    message: artifact
      ? `Install ${release.artifactFile} in the authorized viewer's Fabric mods folder and restart that Minecraft client.`
      : `The verified POV Companion ${release.version} artifact for Minecraft ${release.minecraftVersion} is unavailable or failed integrity verification.`
  };
}

async function exportBundledPlayerViewCompanion(event) {
  const paths = await getPaths();
  const status = await getPlayerViewCompanionStatus(paths);
  if (!status.supported) throw new Error(status.message);
  const release = getBundledPlayerViewCompanionRelease(status.minecraftVersion);
  const artifact = await findBundledPlayerViewCompanionArtifact(release);
  if (!artifact) throw new Error(status.message);
  const owner = BrowserWindow.fromWebContents(event?.sender) || mainWindow;
  const options = {
    title: 'Save POV Companion for the authorized viewer',
    defaultPath: release.artifactFile,
    filters: [{ name: 'Fabric client mod', extensions: ['jar'] }]
  };
  const result = owner && !owner.isDestroyed()
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { cancelled: true };
  const destination = path.resolve(result.filePath);
  const temporary = `${destination}.export-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  const backup = `${destination}.previous-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  let movedExisting = false;
  let published = false;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
    const staged = await inspectAntiCheatJar(temporary);
    if (!inspectionMatchesBundledPlayerViewCompanion(staged, release)) {
      throw new Error('The copied POV Companion failed integrity verification.');
    }
    try {
      await fs.rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.rename(temporary, destination);
    published = true;
    const saved = await inspectAntiCheatJar(destination);
    if (!inspectionMatchesBundledPlayerViewCompanion(saved, release)) {
      throw new Error('The saved POV Companion failed final integrity verification.');
    }
    if (movedExisting) await fs.rm(backup, { force: true });
    return {
      cancelled: false,
      name: path.basename(destination),
      size: saved.size,
      sha256: saved.sha256,
      minecraftVersion: release.minecraftVersion,
      version: release.version,
      loader: 'Fabric'
    };
  } catch (error) {
    if (published) await fs.rm(destination, { force: true }).catch(() => {});
    if (movedExisting) await fs.rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (!movedExisting) await fs.rm(backup, { force: true }).catch(() => {});
  }
}

async function inspectInstalledTradeAssistant(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size < 22 || stat.size > MAX_ANTICHEAT_JAR_BYTES) return null;
    return { ...(await inspectAntiCheatJar(file)), file, stat };
  } catch {
    return null;
  }
}

async function findBundledTradeAssistantArtifact() {
  const candidate = path.join(
    __dirname,
    BUNDLED_TRADE_ASSISTANT_PROJECT_DIRECTORY,
    'dist',
    BUNDLED_TRADE_ASSISTANT_ARTIFACT
  );
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size !== BUNDLED_TRADE_ASSISTANT_SIZE) return null;
    const inspection = await getCachedWork(
      `bundled-trade-assistant:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (inspection.sha256 !== BUNDLED_TRADE_ASSISTANT_SHA256 ||
        !inspectionMatchesBundledTradeAssistant(inspection)) return null;
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function exportBundledTradeAssistantClient(event) {
  const artifact = await findBundledTradeAssistantArtifact();
  if (!artifact) throw new Error('The bundled Trade Assistant client mod is missing or failed integrity inspection.');
  const owner = BrowserWindow.fromWebContents(event?.sender) || mainWindow;
  const options = {
    title: 'Save Trade Assistant client mod',
    defaultPath: BUNDLED_TRADE_ASSISTANT_ARTIFACT,
    filters: [{ name: 'Fabric client mod', extensions: ['jar'] }]
  };
  const result = owner && !owner.isDestroyed()
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { cancelled: true };
  const destination = path.resolve(result.filePath);
  const temporary = `${destination}.export-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  const backup = `${destination}.previous-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  let movedExisting = false;
  let published = false;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
    const staged = await inspectAntiCheatJar(temporary);
    if (staged.sha256 !== BUNDLED_TRADE_ASSISTANT_SHA256 || staged.size !== BUNDLED_TRADE_ASSISTANT_SIZE ||
        !inspectionMatchesBundledTradeAssistant(staged)) {
      throw new Error('The copied Trade Assistant client mod failed its integrity check.');
    }
    try {
      await fs.rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fs.rename(temporary, destination);
    published = true;
    const saved = await inspectAntiCheatJar(destination);
    if (saved.sha256 !== BUNDLED_TRADE_ASSISTANT_SHA256 || saved.size !== BUNDLED_TRADE_ASSISTANT_SIZE ||
        !inspectionMatchesBundledTradeAssistant(saved)) {
      throw new Error('The saved Trade Assistant client mod failed final verification.');
    }
    if (movedExisting) await fs.rm(backup, { force: true });
    return {
      cancelled: false,
      name: path.basename(destination),
      size: saved.size,
      sha256: saved.sha256,
      minecraftVersion: BUNDLED_TRADE_ASSISTANT_MINECRAFT,
      loader: 'Fabric'
    };
  } catch (error) {
    if (published) await fs.rm(destination, { force: true }).catch(() => {});
    if (movedExisting) await fs.rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (!movedExisting) await fs.rm(backup, { force: true }).catch(() => {});
  }
}

async function findBundledTradeAssistantFabricApiArtifact() {
  const candidates = [
    path.join(__dirname, 'server-protection-fabric-26.2', 'dist', BUNDLED_PROTECTION_FABRIC_26_2_API_ARTIFACT),
    path.join(__dirname, BUNDLED_TRADE_ASSISTANT_PROJECT_DIRECTORY, 'dist', BUNDLED_PROTECTION_FABRIC_26_2_API_ARTIFACT)
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size !== BUNDLED_PROTECTION_FABRIC_26_2_API_SIZE) continue;
      const inspection = await getCachedWork(
        `bundled-trade-assistant-api:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      if (inspection.sha256 === BUNDLED_PROTECTION_FABRIC_26_2_API_SHA256 &&
          inspectionIsFabricApi(inspection) &&
          isCompatibleFabricApiVersion(inspection.fabricVersion, BUNDLED_TRADE_ASSISTANT_MINECRAFT)) {
        return { path: candidate, stat, ...inspection };
      }
    } catch {}
  }
  return null;
}

function normalizeTradeAssistantMetadata(value = {}) {
  const managed = value?.managed && typeof value.managed === 'object' ? value.managed : null;
  const sha256 = String(managed?.sha256 || '').trim().toLowerCase();
  return {
    schema: 1,
    managed: managed && /^[a-f0-9]{64}$/.test(sha256) ? {
      file: String(managed.file || '').trim(),
      version: String(managed.version || '').trim().slice(0, 80),
      sha256,
      size: Math.max(0, Math.floor(Number(managed.size) || 0)),
      installedAt: String(managed.installedAt || '').trim().slice(0, 40)
    } : null
  };
}

async function readTradeAssistantMetadata(paths) {
  return normalizeTradeAssistantMetadata(await readJson(paths.tradeAssistantMetadata, { schema: 1, managed: null }));
}

async function inspectTradeAssistantModFolder(paths) {
  const index = await getModDescriptorIndex(paths);
  const entries = index.files || [];
  const duplicateMods = entries.filter((entry) =>
    entry.descriptor?.fabricModId === BUNDLED_TRADE_ASSISTANT_MOD_ID &&
    entry.name.toLowerCase() !== BUNDLED_TRADE_ASSISTANT_JAR.toLowerCase());
  const fabricApis = entries.filter((entry) => entry.descriptor?.fabricModId === 'fabric-api');
  const compatibleFabricApis = fabricApis.filter((entry) =>
    isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, BUNDLED_TRADE_ASSISTANT_MINECRAFT));
  return {
    partial: Boolean(index.partial),
    warning: String(index.warning || ''),
    duplicateMods,
    compatibleFabricApis,
    dependencyConflict: fabricApis.length > 1 || (fabricApis.length === 1 && compatibleFabricApis.length !== 1),
    dependencyReady: fabricApis.length === 1 && compatibleFabricApis.length === 1,
    dependencyFile: compatibleFabricApis[0]?.name || ''
  };
}

async function refreshManagedTradeAssistantBeforeStartUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot;
  const paths = context.paths || profileSnapshot?.paths;
  const serverConfig = normalizeServerConfig(context.serverConfig || {});
  const platform = context.platform;
  const revalidate = context.revalidate;
  if (!profileSnapshot?.profileId || !paths || !platform || typeof revalidate !== 'function') {
    throw new Error('Trade Assistant did not receive a verified startup context.');
  }
  const serverType = normalizeServerType(serverConfig.serverType || platform.type);
  const minecraftVersion = normalizeAddonVersion(platform.minecraftVersion || serverConfig.serverVersion);
  if (serverType !== 'fabric' || minecraftVersion !== BUNDLED_TRADE_ASSISTANT_MINECRAFT ||
      !platform.jarExists || !platform.compatible || platform.supportsMods === false) {
    return { checked: false, installed: false, reason: 'unsupported-profile' };
  }

  const [artifact, dependencyArtifact, metadata, folderState] = await Promise.all([
    findBundledTradeAssistantArtifact(),
    findBundledTradeAssistantFabricApiArtifact(),
    readTradeAssistantMetadata(paths),
    inspectTradeAssistantModFolder(paths)
  ]);
  if (!artifact) throw new Error('The pinned Server Trade Assistant Fabric mod is missing or failed integrity inspection.');
  if (folderState.partial) throw new Error(folderState.warning || 'The mods folder could not be inspected safely for Trade Assistant.');
  if (folderState.duplicateMods.length) {
    throw new Error(`Another ${BUNDLED_TRADE_ASSISTANT_MOD_ID} mod is installed as ${folderState.duplicateMods[0].name}.`);
  }
  if (folderState.dependencyConflict) {
    throw new Error('Fabric API is duplicated or does not match Minecraft 26.2. Trade Assistant was left unchanged.');
  }
  if (!folderState.dependencyReady && !dependencyArtifact) {
    throw new Error('The pinned Fabric API dependency for Trade Assistant is missing or failed integrity inspection.');
  }

  const destination = path.join(paths.mods, BUNDLED_TRADE_ASSISTANT_JAR);
  const installed = await inspectInstalledTradeAssistant(destination);
  const exactInstall = Boolean(installed && installed.size === BUNDLED_TRADE_ASSISTANT_SIZE &&
    installed.sha256 === BUNDLED_TRADE_ASSISTANT_SHA256 && inspectionMatchesBundledTradeAssistant(installed));
  const recordedInstall = Boolean(installed && metadata.managed &&
    metadata.managed.file === BUNDLED_TRADE_ASSISTANT_JAR &&
    metadata.managed.sha256 === installed.sha256 && metadata.managed.size === installed.size &&
    inspectionMatchesBundledTradeAssistant(installed));
  if (installed && !exactInstall && !recordedInstall) {
    throw new Error(`${BUNDLED_TRADE_ASSISTANT_JAR} exists but is not a verified manager-owned copy. It was left untouched.`);
  }

  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const mainTemporary = `${destination}.install-${token}`;
  const mainRollback = `${destination}.rollback-${token}`;
  const dependencyDestination = path.join(paths.mods, BUNDLED_PROTECTION_FABRIC_26_2_API_JAR);
  const dependencyTemporary = `${dependencyDestination}.install-${token}`;
  const needsMainPublish = !exactInstall;
  const needsDependencyPublish = !folderState.dependencyReady;
  let mainPublished = false;
  let mainReplaced = false;
  let dependencyPublished = false;
  let committed = false;
  try {
    await revalidate();
    await fs.mkdir(paths.mods, { recursive: true });
    if (needsMainPublish) {
      await fs.copyFile(artifact.path, mainTemporary, fss.constants.COPYFILE_EXCL);
      const staged = await inspectAntiCheatJar(mainTemporary);
      if (staged.sha256 !== BUNDLED_TRADE_ASSISTANT_SHA256 ||
          staged.size !== BUNDLED_TRADE_ASSISTANT_SIZE || !inspectionMatchesBundledTradeAssistant(staged)) {
        throw new Error('The staged Server Trade Assistant mod failed its integrity check.');
      }
    }
    if (needsDependencyPublish) {
      await fs.copyFile(dependencyArtifact.path, dependencyTemporary, fss.constants.COPYFILE_EXCL);
      const stagedDependency = await inspectAntiCheatJar(dependencyTemporary);
      if (stagedDependency.sha256 !== BUNDLED_PROTECTION_FABRIC_26_2_API_SHA256 ||
          stagedDependency.size !== BUNDLED_PROTECTION_FABRIC_26_2_API_SIZE ||
          !inspectionIsFabricApi(stagedDependency) ||
          !isCompatibleFabricApiVersion(stagedDependency.fabricVersion, BUNDLED_TRADE_ASSISTANT_MINECRAFT)) {
        throw new Error('The staged Fabric API dependency failed its integrity check.');
      }
    }

    await revalidate();
    const current = await inspectInstalledTradeAssistant(destination);
    if (installed) {
      if (!current || current.sha256 !== installed.sha256 || current.size !== installed.size) {
        throw new Error(`${BUNDLED_TRADE_ASSISTANT_JAR} changed during startup preparation and was left untouched.`);
      }
    } else if (current) {
      throw new Error(`${BUNDLED_TRADE_ASSISTANT_JAR} appeared during startup preparation and was left untouched.`);
    }
    const currentFolder = await inspectTradeAssistantModFolder(paths);
    if (currentFolder.partial || currentFolder.duplicateMods.length || currentFolder.dependencyConflict ||
        (!needsDependencyPublish && !currentFolder.dependencyReady)) {
      throw new Error('The mods folder changed during Trade Assistant preparation. No unmanaged file was replaced.');
    }

    if (needsDependencyPublish && !currentFolder.dependencyReady) {
      try {
        await fs.link(dependencyTemporary, dependencyDestination);
      } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${BUNDLED_PROTECTION_FABRIC_26_2_API_JAR} appeared during installation.`);
        throw error;
      }
      dependencyPublished = true;
      await fs.rm(dependencyTemporary, { force: true });
    }

    if (needsMainPublish && installed) {
      await fs.copyFile(destination, mainRollback, fss.constants.COPYFILE_EXCL);
      await replaceFileAtomically(mainTemporary, destination);
      mainPublished = true;
      mainReplaced = true;
    } else if (needsMainPublish) {
      try {
        await fs.link(mainTemporary, destination);
      } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`${BUNDLED_TRADE_ASSISTANT_JAR} appeared during installation.`);
        throw error;
      }
      mainPublished = true;
      await fs.rm(mainTemporary, { force: true });
    }

    const finalInstall = await inspectInstalledTradeAssistant(destination);
    if (!finalInstall || finalInstall.sha256 !== BUNDLED_TRADE_ASSISTANT_SHA256 ||
        finalInstall.size !== BUNDLED_TRADE_ASSISTANT_SIZE ||
        !inspectionMatchesBundledTradeAssistant(finalInstall)) {
      throw new Error('The installed Server Trade Assistant mod failed final verification.');
    }
    const installedAt = metadata.managed?.installedAt || new Date().toISOString();
    await revalidate();
    await upsertInstalledAddonMetadata(paths, {
      kind: 'mods',
      file: BUNDLED_TRADE_ASSISTANT_JAR,
      source: 'imported',
      projectId: 'click-interval-server-trade-assistant',
      versionName: BUNDLED_TRADE_ASSISTANT_VERSION,
      gameVersion: BUNDLED_TRADE_ASSISTANT_MINECRAFT,
      serverType: 'fabric',
      expectedHashes: { sha256: BUNDLED_TRADE_ASSISTANT_SHA256 },
      title: BUNDLED_TRADE_ASSISTANT_NAME,
      author: 'Server Manager',
      installedAt
    });
    await writeJsonAtomically(paths.tradeAssistantMetadata, {
      schema: 1,
      managed: {
        file: BUNDLED_TRADE_ASSISTANT_JAR,
        version: BUNDLED_TRADE_ASSISTANT_VERSION,
        sha256: BUNDLED_TRADE_ASSISTANT_SHA256,
        size: BUNDLED_TRADE_ASSISTANT_SIZE,
        installedAt
      }
    });
    committed = true;
    await fs.rm(mainRollback, { force: true }).catch(() => {});
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    appendServerLog(
      `[Trade Assistant] ${needsMainPublish ? 'Installed' : 'Verified'} ${BUNDLED_TRADE_ASSISTANT_VERSION}; ` +
      `Fabric API ${needsDependencyPublish ? 'installed' : 'verified'}.\n`
    );
    return { checked: true, installed: true, updated: Boolean(installed && needsMainPublish), reason: needsMainPublish ? 'installed' : 'verified' };
  } finally {
    if (!committed && mainPublished) {
      if (mainReplaced && await isRegularFile(mainRollback)) {
        const failed = `${destination}.failed-${token}`;
        await fs.rename(destination, failed).catch(() => {});
        await fs.rename(mainRollback, destination).catch(() => {});
        await fs.rm(failed, { force: true }).catch(() => {});
      } else if (!installed) {
        await fs.rm(destination, { force: true }).catch(() => {});
      }
    }
    if (!committed && dependencyPublished) await fs.rm(dependencyDestination, { force: true }).catch(() => {});
    await Promise.allSettled([
      fs.rm(mainTemporary, { force: true }),
      fs.rm(dependencyTemporary, { force: true })
    ]);
  }
}

function getBundledProtectionReleasePin(adapter) {
  return isBundledFabricProtectionAdapter(adapter)
    ? { sha256: adapter.sha256, size: adapter.size }
    : { sha256: BUNDLED_PROTECTION_SHA256, size: BUNDLED_PROTECTION_SIZE };
}

function getExpectedAntiCheatKind(serverType) {
  const type = normalizeServerType(serverType);
  if (['paper', 'purpur', 'spigot'].includes(type)) return 'plugins';
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(type)) return 'mods';
  return '';
}

function isAntiCheatDescriptorCompatible(descriptor, serverType) {
  const type = normalizeServerType(serverType);
  if (['plugin.yml', 'paper-plugin.yml'].includes(descriptor)) return ['paper', 'purpur', 'spigot'].includes(type);
  if (descriptor === 'fabric.mod.json') return ['fabric', 'quilt'].includes(type);
  if (descriptor === 'quilt.mod.json') return type === 'quilt';
  if (descriptor === 'META-INF/mods.toml') return type === 'forge';
  if (descriptor === 'META-INF/neoforge.mods.toml') return type === 'neoforge';
  return false;
}

async function readCustomAntiCheatMetadata(paths = null) {
  const resolvedPaths = paths || await getPaths();
  try {
    if ((await fs.stat(resolvedPaths.customAntiCheats)).size > 1024 * 1024) return [];
    const parsed = JSON.parse(await fs.readFile(resolvedPaths.customAntiCheats, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCustomAntiCheatMetadata(paths, rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    row && typeof row.id === 'string' && /^[a-f0-9-]{8,64}$/i.test(row.id) &&
    ['plugins', 'mods'].includes(row.kind) && path.basename(String(row.file || '')) === row.file && /\.jar$/i.test(row.file)
  ).slice(0, 100);
  return serializeFileWrite(paths.customAntiCheats, () => writeJsonAtomically(paths.customAntiCheats, safeRows));
}

async function listCustomAntiCheats(pathsOverride = null) {
  const paths = pathsOverride || await getPaths();
  const rows = await readCustomAntiCheatMetadata(paths);
  const result = [];
  for (const row of rows) {
    const targetDir = row.kind === 'plugins' ? paths.plugins : paths.mods;
    let file;
    try {
      file = resolveContainedPath(targetDir, path.join(targetDir, row.file));
    } catch {
      continue;
    }
    let stat = null;
    try {
      stat = await fs.stat(file);
    } catch {}
    const active = Boolean(stat?.isFile());
    let integrityVerified = false;
    if (active && /^[a-f0-9]{64}$/i.test(row.sha256 || '')) {
      integrityVerified = await getCachedWork(
        `custom-ac:${file}:${stat.size}:${stat.mtimeMs}:${row.sha256}`,
        5 * 60_000,
        () => fileMatchesExpectedHash(file, { sha256: row.sha256 })
      );
    }
    result.push({
      id: row.id,
      name: String(row.name || row.file).slice(0, 180),
      file: row.file,
      kind: row.kind,
      descriptor: row.descriptor || '',
      size: Number(row.size) || Number(stat?.size) || 0,
      sha256: row.sha256 || '',
      importedAt: row.importedAt || '',
      active,
      integrityVerified
    });
  }
  return result.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));
}

async function importCustomAntiCheat() {
  const paths = await getPaths();
  const config = await readConfig();
  const expectedKind = getExpectedAntiCheatKind(config.serverType);
  if (!expectedKind) {
    throw new Error('The selected server type cannot load anti-cheat plugins or mods. Choose Paper, Fabric, Forge, or another compatible runtime first.');
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import an anti-cheat JAR',
    properties: ['openFile'],
    filters: [{ name: 'Java archives', extensions: ['jar'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selected = path.resolve(result.filePaths[0]);
  const inspection = await inspectAntiCheatJar(selected);
  if (inspection.pluginName === BUNDLED_PROTECTION_NAME ||
      inspection.fabricModId === BUNDLED_PROTECTION_FABRIC_MOD_ID) {
    throw new Error('This JAR declares the managed Server Protection identity. Install it with the built-in protection installer instead.');
  }
  if (inspection.kind !== expectedKind || !isAntiCheatDescriptorCompatible(inspection.descriptor, config.serverType)) {
    throw new Error(`This ${inspection.descriptor} JAR cannot run on ${normalizeServerType(config.serverType)}. Choose a matching anti-cheat.`);
  }
  return serializeProtectionStateTransaction(paths.root, async () => {
  const id = crypto.randomUUID();
  const safeOriginal = (cleanAddonFileName(path.basename(selected)).replace(/\.jar$/i, '') || 'anti-cheat').slice(0, 160);
  const fileName = `server-protection-custom-${inspection.sha256.slice(0, 12)}-${safeOriginal}.jar`;
  const targetDir = inspection.kind === 'plugins' ? paths.plugins : paths.mods;
  const destination = resolveContainedPath(targetDir, path.join(targetDir, fileName));
  const temporary = `${destination}.import-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.copyFile(selected, temporary, fss.constants.COPYFILE_EXCL);
    const copied = await inspectAntiCheatJar(temporary);
    if (copied.sha256 !== inspection.sha256 || copied.size !== inspection.size || copied.descriptor !== inspection.descriptor) {
      throw new Error('The anti-cheat JAR changed while it was being imported. Nothing was installed.');
    }
    await replaceFileAtomically(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  const row = {
    id,
    name: safeOriginal.slice(0, 180),
    file: fileName,
    kind: inspection.kind,
    descriptor: inspection.descriptor,
    size: inspection.size,
    sha256: inspection.sha256,
    importedAt: new Date().toISOString()
  };
  const rows = await readCustomAntiCheatMetadata(paths);
  await writeCustomAntiCheatMetadata(paths, [...rows.filter((entry) => entry.id !== id), row]);
  cachedStatus = null;
  invalidateCachedWork(`disk-size:${paths.root}`);
  return { canceled: false, installed: { ...row, active: true, integrityVerified: true }, restartRequired: Boolean(serverProcess) };
  });
}

async function removeCustomAntiCheat(id, pathsOverride = null, revalidate = async () => {}) {
  const cleanId = String(id || '');
  if (!/^[a-f0-9-]{8,64}$/i.test(cleanId)) throw new Error('Invalid managed anti-cheat id.');
  const paths = pathsOverride || await getPaths();
  if (!pathsOverride) {
    return serializeProtectionStateTransaction(paths.root, () => removeCustomAntiCheat(cleanId, paths, revalidate));
  }
  const rows = await readCustomAntiCheatMetadata(paths);
  const row = rows.find((candidate) => candidate.id === cleanId);
  if (!row) throw new Error('That managed anti-cheat was not found.');
  const targetDir = row.kind === 'plugins' ? paths.plugins : paths.mods;
  if (path.basename(row.file) !== row.file || !/\.jar$/i.test(row.file)) throw new Error('Refusing to remove an unsafe managed anti-cheat path.');
  const file = resolveContainedPath(targetDir, path.join(targetDir, row.file));
  await assertWorldResetPlainPath(paths.root, file);
  let stat = null;
  try {
    stat = await fs.stat(file);
  } catch {}
  if (stat?.isFile() && !await fileMatchesExpectedHash(file, { sha256: row.sha256 })) {
    throw new Error('This anti-cheat JAR changed after import. It was not removed so a user-replaced file is not deleted accidentally.');
  }
  await revalidate();
  await assertWorldResetPlainPath(paths.root, file);
  await fs.rm(file, { force: true });
  await writeCustomAntiCheatMetadata(paths, rows.filter((candidate) => candidate.id !== cleanId));
  cachedStatus = null;
  invalidateCachedWork(`disk-size:${paths.root}`);
  return { removed: true, id: cleanId, restartRequired: Boolean(serverProcess) };
}

async function findBundledAntiCheatArtifact(adapter = getBundledProtectionAdapterById('bukkit')) {
  const exactCandidates = isBundledFabricProtectionAdapter(adapter)
    ? [
        path.join(__dirname, adapter.projectDirectory, 'dist', adapter.artifactFile),
        path.join(__dirname, 'assets', adapter.artifactFile),
        path.join(__dirname, adapter.artifactFile)
      ]
    : [
        path.join(__dirname, 'click-interval-anticheat', 'dist', BUNDLED_PROTECTION_JAR),
        path.join(__dirname, 'assets', BUNDLED_PROTECTION_JAR),
        path.join(__dirname, BUNDLED_PROTECTION_JAR)
      ];
  for (const candidate of exactCandidates) {
    try {
      const stat = await fs.stat(candidate);
      const inspection = await getCachedWork(
        `bundled-ac:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      const pin = getBundledProtectionReleasePin(adapter);
      if (inspectionMatchesBundledProtectionAdapter(inspection, adapter) &&
          inspection.size === pin.size && inspection.sha256 === pin.sha256) {
        return { path: candidate, ...inspection };
      }
    } catch {}
  }
  return null;
}

async function findBundledFabricApiArtifact(adapter) {
  if (!isBundledFabricProtectionAdapter(adapter)) return null;
  const candidates = [
    path.join(__dirname, adapter.projectDirectory, 'dist', adapter.fabricApiArtifactFile),
    path.join(__dirname, 'assets', adapter.fabricApiArtifactFile),
    path.join(__dirname, adapter.fabricApiArtifactFile)
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      const inspection = await getCachedWork(
        `bundled-fabric-api:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      if (inspectionIsFabricApi(inspection) && inspection.size === adapter.fabricApiSize &&
          inspection.sha256 === adapter.fabricApiSha256 &&
          isCompatibleFabricApiVersion(inspection.fabricVersion, adapter.minecraftVersion)) {
        return { path: candidate, ...inspection };
      }
    } catch {}
  }
  return null;
}

function getBundledProtectionJarPaths(paths, adapter = getBundledProtectionAdapterById('bukkit')) {
  if (isBundledFabricProtectionAdapter(adapter)) {
    return {
      current: path.join(paths.mods, BUNDLED_PROTECTION_FABRIC_JAR),
      legacy: '',
      fabricApi: path.join(paths.mods, adapter.fabricApiFile)
    };
  }
  return {
    current: path.join(paths.plugins, BUNDLED_PROTECTION_JAR),
    legacy: path.join(paths.plugins, LEGACY_BUNDLED_PROTECTION_JAR),
    fabricApi: ''
  };
}

function getBundledTeleportAdapter(serverType = 'paper', minecraftVersion = '') {
  const type = normalizeServerType(serverType);
  if (['paper', 'purpur', 'spigot'].includes(type)) {
    return Object.freeze({
      id: 'bukkit',
      kind: 'plugins',
      serverTypes: Object.freeze(['paper', 'purpur', 'spigot']),
      minecraftVersion: '',
      managedFile: BUNDLED_TELEPORT_JAR,
      projectDirectory: 'server-teleport',
      artifactFile: BUNDLED_TELEPORT_JAR,
      sha256: BUNDLED_TELEPORT_SHA256,
      size: BUNDLED_TELEPORT_SIZE,
      dependencyFile: '',
      dependencyArtifactFile: ''
    });
  }
  if (type === 'fabric' && normalizeAddonVersion(minecraftVersion) === BUNDLED_TELEPORT_FABRIC_MINECRAFT) {
    return Object.freeze({
      id: `fabric-${BUNDLED_TELEPORT_FABRIC_MINECRAFT}`,
      kind: 'mods',
      serverTypes: Object.freeze(['fabric']),
      minecraftVersion: BUNDLED_TELEPORT_FABRIC_MINECRAFT,
      managedFile: BUNDLED_TELEPORT_FABRIC_JAR,
      projectDirectory: 'server-teleport-fabric',
      artifactFile: BUNDLED_TELEPORT_FABRIC_ARTIFACT,
      sha256: BUNDLED_TELEPORT_FABRIC_SHA256,
      size: BUNDLED_TELEPORT_FABRIC_SIZE,
      dependencyFile: BUNDLED_TELEPORT_FABRIC_API_JAR,
      dependencyArtifactFile: BUNDLED_TELEPORT_FABRIC_API_ARTIFACT,
      dependencyVersion: BUNDLED_TELEPORT_FABRIC_API_VERSION,
      dependencySha256: BUNDLED_TELEPORT_FABRIC_API_SHA256,
      dependencySize: BUNDLED_TELEPORT_FABRIC_API_SIZE
    });
  }
  return null;
}

function getBundledTeleportAdapterById(adapterId) {
  if (adapterId === 'bukkit') return getBundledTeleportAdapter('paper', '');
  if (adapterId === `fabric-${BUNDLED_TELEPORT_FABRIC_MINECRAFT}`) {
    return getBundledTeleportAdapter('fabric', BUNDLED_TELEPORT_FABRIC_MINECRAFT);
  }
  return null;
}

function isBundledFabricTeleportAdapter(adapter) {
  return Boolean(adapter?.id === `fabric-${BUNDLED_TELEPORT_FABRIC_MINECRAFT}` &&
    adapter.kind === 'mods' && adapter.minecraftVersion === BUNDLED_TELEPORT_FABRIC_MINECRAFT);
}

function getBundledTeleportJarPath(paths, adapter = getBundledTeleportAdapterById('bukkit')) {
  return path.join(adapter?.kind === 'mods' ? paths.mods : paths.plugins, adapter?.managedFile || BUNDLED_TELEPORT_JAR);
}

function getBundledTeleportDependencyPath(paths, adapter) {
  return isBundledFabricTeleportAdapter(adapter) ? path.join(paths.mods, adapter.dependencyFile) : '';
}

function getBundledVoiceAdapter(serverType, minecraftVersion = '') {
  const type = normalizeServerType(serverType);
  if (['paper', 'purpur', 'spigot'].includes(type)) {
    return Object.freeze({
      id: 'bukkit',
      kind: 'plugins',
      serverTypes: Object.freeze(['paper', 'purpur', 'spigot']),
      minecraftVersion: '',
      managedFile: BUNDLED_VOICE_SERVER_JAR,
      projectDirectory: 'proximity-voice',
      artifactFile: BUNDLED_VOICE_SERVER_JAR,
      sha256: BUNDLED_VOICE_SERVER_SHA256,
      size: BUNDLED_VOICE_SERVER_SIZE
    });
  }
  if (type === 'fabric' && normalizeAddonVersion(minecraftVersion) === BUNDLED_VOICE_CLIENT_MINECRAFT) {
    return Object.freeze({
      id: `fabric-${BUNDLED_VOICE_CLIENT_MINECRAFT}`,
      kind: 'mods',
      serverTypes: Object.freeze(['fabric']),
      minecraftVersion: BUNDLED_VOICE_CLIENT_MINECRAFT,
      managedFile: BUNDLED_VOICE_FABRIC_SERVER_JAR,
      projectDirectory: path.join('proximity-voice', 'fabric-server'),
      artifactFile: BUNDLED_VOICE_FABRIC_SERVER_ARTIFACT,
      sha256: BUNDLED_VOICE_FABRIC_SERVER_SHA256,
      size: BUNDLED_VOICE_FABRIC_SERVER_SIZE,
      dependencyFile: BUNDLED_TELEPORT_FABRIC_API_JAR,
      dependencyArtifactFile: BUNDLED_TELEPORT_FABRIC_API_ARTIFACT,
      dependencyVersion: BUNDLED_TELEPORT_FABRIC_API_VERSION,
      dependencySha256: BUNDLED_TELEPORT_FABRIC_API_SHA256,
      dependencySize: BUNDLED_TELEPORT_FABRIC_API_SIZE
    });
  }
  return null;
}

function getBundledVoiceAdapterById(adapterId) {
  if (adapterId === 'bukkit') return getBundledVoiceAdapter('paper', '');
  if (adapterId === `fabric-${BUNDLED_VOICE_CLIENT_MINECRAFT}`) {
    return getBundledVoiceAdapter('fabric', BUNDLED_VOICE_CLIENT_MINECRAFT);
  }
  return null;
}

function isBundledFabricVoiceAdapter(adapter) {
  return Boolean(adapter?.id === `fabric-${BUNDLED_VOICE_CLIENT_MINECRAFT}` &&
    adapter.kind === 'mods' && adapter.minecraftVersion === BUNDLED_VOICE_CLIENT_MINECRAFT);
}

function normalizeServerToolsMetadata(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const raw = source.teleport && typeof source.teleport === 'object' ? source.teleport : null;
  let teleport = null;
  if (raw) {
    const sha256 = String(raw.sha256 || '').trim().toLowerCase();
    const size = Number(raw.size) || 0;
    const adapterId = String(raw.adapterId || (raw.file === BUNDLED_TELEPORT_JAR ? 'bukkit' : '')).trim();
    const adapter = getBundledTeleportAdapterById(adapterId);
    const kind = String(raw.kind || adapter?.kind || '').trim();
    const dependencyFile = String(raw.dependencyFile || '').trim();
    const safeDependencyFile = dependencyFile && path.basename(dependencyFile) === dependencyFile && /\.jar$/i.test(dependencyFile)
      ? dependencyFile : '';
    if (adapter && raw.file === adapter.managedFile && kind === adapter.kind &&
        /^[a-f0-9]{64}$/.test(sha256) && Number.isSafeInteger(size) && size > 0) {
      teleport = {
        name: BUNDLED_TELEPORT_NAME,
        adapterId: adapter.id,
        kind: adapter.kind,
        minecraftVersion: adapter.minecraftVersion,
        file: adapter.managedFile,
        sha256,
        size,
        installedAt: String(raw.installedAt || '').trim().slice(0, 40),
        dependencyFile: safeDependencyFile,
        dependencyProvisioned: Boolean(raw.dependencyProvisioned)
      };
    }
  }
  const rawVoice = source.voice && typeof source.voice === 'object' ? source.voice : null;
  let voice = null;
  if (rawVoice) {
    const sha256 = String(rawVoice.sha256 || '').trim().toLowerCase();
    const size = Number(rawVoice.size) || 0;
    const adapterId = String(rawVoice.adapterId || (rawVoice.file === BUNDLED_VOICE_SERVER_JAR ? 'bukkit' : '')).trim();
    const adapter = getBundledVoiceAdapterById(adapterId);
    const kind = String(rawVoice.kind || adapter?.kind || '').trim();
    const dependencyFile = String(rawVoice.dependencyFile || '').trim();
    const safeDependencyFile = dependencyFile && path.basename(dependencyFile) === dependencyFile && /\.jar$/i.test(dependencyFile)
      ? dependencyFile : '';
    if (adapter && rawVoice.file === adapter.managedFile && kind === adapter.kind && /^[a-f0-9]{64}$/.test(sha256) &&
        Number.isSafeInteger(size) && size > 0) {
      voice = {
        name: BUNDLED_VOICE_NAME,
        adapterId: adapter.id,
        kind: adapter.kind,
        minecraftVersion: adapter.minecraftVersion,
        file: adapter.managedFile,
        sha256,
        size,
        installedAt: String(rawVoice.installedAt || '').trim().slice(0, 40),
        dependencyFile: safeDependencyFile,
        dependencyProvisioned: Boolean(rawVoice.dependencyProvisioned),
        localOnlyOverrideActive: rawVoice.localOnlyOverrideActive === true,
        previousBindAddress: String(rawVoice.previousBindAddress || '')
          .replace(/[\x00-\x20\x7f-\xff]/g, '').slice(0, 253),
        previousPublicHost: String(rawVoice.previousPublicHost || '')
          .replace(/[\x00-\x20\x7f-\xff]/g, '').slice(0, 253)
      };
    }
  }
  return { version: 2, teleport, voice };
}

async function readServerToolsMetadata(paths) {
  try {
    const stat = await fs.stat(paths.serverTools);
    if (!stat.isFile() || stat.size > 1024 * 1024) return normalizeServerToolsMetadata();
    return normalizeServerToolsMetadata(JSON.parse(await fs.readFile(paths.serverTools, 'utf8')));
  } catch {
    return normalizeServerToolsMetadata();
  }
}

async function writeServerToolsMetadata(paths, value) {
  const normalized = normalizeServerToolsMetadata(value);
  return serializeFileWrite(paths.serverTools, async () => {
    await writeJsonAtomically(paths.serverTools, normalized);
    return normalized;
  });
}

function inspectionMatchesBundledTeleportAdapter(inspection, adapter) {
  if (!inspection || !adapter) return false;
  if (isBundledFabricTeleportAdapter(adapter)) {
    return inspection.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
      inspection.fabricModId === BUNDLED_TELEPORT_FABRIC_MOD_ID &&
      inspection.fabricEnvironment === 'server' &&
      inspection.fabricMainEntrypoints.includes(BUNDLED_TELEPORT_FABRIC_ENTRYPOINT) &&
      fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, adapter.minecraftVersion) &&
      inspection.bundledFabricTeleportIdentity === true;
  }
  return inspection.kind === 'plugins' && inspection.pluginName === BUNDLED_TELEPORT_NAME &&
    inspection.bundledTeleportIdentity === true;
}

function classifyBundledTeleportInstall({ artifact = null, installed = null, record = null, adapter = null } = {}) {
  const normalizedRecord = normalizeServerToolsMetadata({ teleport: record }).teleport;
  const resolvedAdapter = adapter || getBundledTeleportAdapterById(normalizedRecord?.adapterId || 'bukkit');
  const installedIdentity = Boolean(
    installed && inspectionMatchesBundledTeleportAdapter(installed, resolvedAdapter) &&
    /^[a-f0-9]{64}$/i.test(String(installed.sha256 || ''))
  );
  const matchesArtifact = Boolean(
    installedIdentity && artifact && /^[a-f0-9]{64}$/i.test(String(artifact.sha256 || '')) &&
    installed.sha256 === artifact.sha256
  );
  const matchesRecord = Boolean(
    installedIdentity && normalizedRecord && normalizedRecord.sha256 === installed.sha256
  );
  const managed = Boolean(matchesArtifact || matchesRecord);
  return {
    installed: Boolean(installed),
    installedIdentity,
    matchesArtifact,
    matchesRecord,
    managed,
    integrityVerified: managed,
    conflict: Boolean(installed && !managed),
    updateAvailable: Boolean(managed && artifact && installed.sha256 !== artifact.sha256)
  };
}

function isBundledTeleportRuntimeCompatible(serverType, platform, adapter = null) {
  const type = normalizeServerType(serverType);
  const resolvedAdapter = adapter || getBundledTeleportAdapter(type, platform?.minecraftVersion || '');
  if (!resolvedAdapter || !resolvedAdapter.serverTypes.includes(type) || !platform?.jarExists || !platform.compatible) return false;
  if (isBundledFabricTeleportAdapter(resolvedAdapter)) {
    return platform.supportsMods !== false && normalizeAddonVersion(platform.minecraftVersion) === resolvedAdapter.minecraftVersion;
  }
  return platform.supportsPlugins !== false;
}

async function findBundledTeleportArtifact(adapter = getBundledTeleportAdapterById('bukkit')) {
  if (!adapter) return null;
  const candidate = path.join(__dirname, adapter.projectDirectory, 'dist', adapter.artifactFile);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return null;
    const inspection = await getCachedWork(
      `bundled-teleport:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (!inspectionMatchesBundledTeleportAdapter(inspection, adapter) ||
        inspection.sha256 !== adapter.sha256 || inspection.size !== adapter.size) {
      return null;
    }
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function findBundledTeleportDependencyArtifact(adapter) {
  if (!isBundledFabricTeleportAdapter(adapter)) return null;
  const candidates = [
    path.join(__dirname, 'server-protection-fabric-26.2', 'dist', adapter.dependencyArtifactFile),
    path.join(__dirname, adapter.projectDirectory, 'dist', adapter.dependencyArtifactFile)
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const inspection = await getCachedWork(
        `bundled-teleport-dependency:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      if (inspection.sha256 === adapter.dependencySha256 && inspection.size === adapter.dependencySize &&
          inspectionIsFabricApi(inspection) &&
          isCompatibleFabricApiVersion(inspection.fabricVersion, adapter.minecraftVersion)) {
        return { path: candidate, stat, ...inspection };
      }
    } catch {}
  }
  return null;
}

async function inspectInstalledBundledTeleport(file) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    const inspection = await getCachedWork(
      `installed-teleport:${file}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(file)
    );
    return { file, stat, ...inspection };
  } catch (error) {
    return {
      file,
      stat,
      kind: '',
      pluginName: '',
      declaredCommands: [],
      bundledTeleportIdentity: false,
      bundledFabricTeleportIdentity: false,
      sha256: '',
      inspectionError: String(error?.message || error || 'The JAR could not be inspected.')
    };
  }
}

function getPluginDescriptorIndex(paths) {
  const directory = path.resolve(paths.plugins);
  const profileKey = path.resolve(paths.root || path.dirname(directory));
  return pluginDescriptorIndexStore.get(profileKey, directory);
}

function getModDescriptorIndex(paths) {
  const directory = path.resolve(paths.mods);
  const profileKey = `${path.resolve(paths.root || path.dirname(directory))}${path.sep}mods-index`;
  return modDescriptorIndexStore.get(profileKey, directory);
}

async function findManagedFabricIdentityConflicts(paths, allowedFiles = [], minecraftVersion = '') {
  const allowed = new Set(allowedFiles.map((file) => String(file || '').toLowerCase()));
  const index = await getModDescriptorIndex(paths);
  const identities = index.files.filter((file) => {
    if (allowed.has(file.name.toLowerCase())) return false;
    const id = file.descriptor?.fabricModId;
    return id === BUNDLED_PROTECTION_FABRIC_MOD_ID ||
      id === BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID || id === 'fabric-api';
  }).map((file) => ({
    file: file.name,
    modId: file.descriptor?.fabricModId || '',
    version: file.descriptor?.fabricVersion || '',
    descriptor: file.descriptor
  }));
  const compatibleFabricApis = identities.filter((entry) => entry.modId === 'fabric-api' &&
    isCompatibleFabricApiVersion(entry.version, minecraftVersion));
  const conflicts = identities.filter((entry) => entry.modId === BUNDLED_PROTECTION_FABRIC_MOD_ID ||
    entry.modId === BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID ||
    (entry.modId === 'fabric-api' && !isCompatibleFabricApiVersion(entry.version, minecraftVersion)));
  return { conflicts, compatibleFabricApis, partial: index.partial, warning: index.warning || '' };
}

function isCompatibleFabricApiVersion(value, minecraftVersion) {
  const [semanticVersion, targetVersion, extra] = String(value || '').trim().split('+');
  if (extra !== undefined || targetVersion !== String(minecraftVersion || '').trim()) return false;
  const match = semanticVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return parts[0] > 0 || parts[1] > 161 || (parts[1] === 161 && parts[2] >= 0);
}

async function findBundledTeleportCommandConflicts(paths, descriptorIndex = null, adapter = getBundledTeleportAdapterById('bukkit')) {
  const resolvedAdapter = adapter || getBundledTeleportAdapterById('bukkit');
  const reserved = resolvedAdapter.managedFile.toLowerCase();
  const index = descriptorIndex || await (resolvedAdapter.kind === 'mods'
    ? getModDescriptorIndex(paths) : getPluginDescriptorIndex(paths));
  const conflicts = index.files
    .filter(file => file.name.toLowerCase() !== reserved)
    .map(file => {
      const inspection = file.descriptor;
      if (resolvedAdapter.kind === 'mods') {
        const modId = String(inspection?.fabricModId || '').toLowerCase();
        if (modId === BUNDLED_TELEPORT_FABRIC_MOD_ID ||
            /(?:^|[_-])(?:just|simple)?tpa(?:[_-]|$)|teleport/i.test(modId)) {
          const name = modId || file.name.replace(/\.jar$/i, '');
          return {
            file: file.name,
            name: String(name).slice(0, 180),
            commands: [],
            message: `${name} may also register teleport request commands. Remove or disable its TPA commands before enabling Teleport Requests.`
          };
        }
        if (!inspection && /(?:tpa|teleport|essentials|cmi|homes?)/i.test(file.name)) {
          return {
            file: file.name,
            name: file.name.replace(/\.jar$/i, ''),
            commands: [],
            message: `${file.name} could not be inspected and may provide teleport commands. Check it before enabling Teleport Requests.`
          };
        }
        return null;
      }
      if (inspection) {
        const commands = (inspection.declaredCommands || []).filter(command => TELEPORT_COMMAND_NAMES.includes(command));
        if (!commands.length) return null;
        const name = inspection.pluginName || file.name.replace(/\.jar$/i, '');
        return {
          file: file.name,
          name: String(name).slice(0, 180),
          commands,
          message: `${name} also declares ${commands.map(command => `/${command}`).join(', ')}. Disable its teleport commands to avoid conflicts.`
        };
      }
      if (!/(?:tpa|teleport|essentials|cmi|homes?)/i.test(file.name)) return null;
      return {
        file: file.name,
        name: file.name.replace(/\.jar$/i, ''),
        commands: [],
        message: `${file.name} may provide teleport commands. Check it for command conflicts before enabling Teleport Requests.`
      };
    });
  return conflicts.filter(Boolean);
}

async function getBundledTeleportFabricDependencyState(paths, adapter, descriptorIndex = null) {
  if (!isBundledFabricTeleportAdapter(adapter)) {
    return {
      ready: true, managed: false, file: '', conflict: false, compatibleExternal: null,
      targetInstall: null, descriptorIndex: descriptorIndex || null, warnings: []
    };
  }
  const index = descriptorIndex || await getModDescriptorIndex(paths);
  const dependencyPath = getBundledTeleportDependencyPath(paths, adapter);
  const targetInstall = await inspectInstalledBundledTeleport(dependencyPath);
  const targetCompatible = Boolean(targetInstall && inspectionIsFabricApi(targetInstall) &&
    isCompatibleFabricApiVersion(targetInstall.fabricVersion, adapter.minecraftVersion));
  const targetManaged = Boolean(targetCompatible && targetInstall.sha256 === adapter.dependencySha256 &&
    targetInstall.size === adapter.dependencySize);
  const externalApis = index.files.filter((entry) =>
    entry.name.toLowerCase() !== adapter.dependencyFile.toLowerCase() &&
    entry.descriptor?.fabricModId === 'fabric-api'
  );
  const compatibleExternal = externalApis.filter((entry) =>
    isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, adapter.minecraftVersion));
  const incompatibleExternal = externalApis.filter((entry) =>
    !isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, adapter.minecraftVersion));
  const conflict = Boolean((targetInstall && !targetCompatible) || incompatibleExternal.length ||
    compatibleExternal.length > 1 || (targetCompatible && compatibleExternal.length));
  const warnings = [];
  if (conflict) {
    warnings.push(`Fabric API must have exactly one compatible Minecraft ${adapter.minecraftVersion} installation.`);
  }
  if (index.warning) warnings.push(index.warning);
  return {
    ready: Boolean(!conflict && !index.partial && (targetCompatible || compatibleExternal.length === 1)),
    managed: targetManaged,
    file: targetCompatible ? adapter.dependencyFile : (compatibleExternal[0]?.name || ''),
    conflict,
    compatibleExternal: compatibleExternal[0] || null,
    targetInstall,
    descriptorIndex: index,
    warnings
  };
}

function isServerStoppedForServerToolChanges() {
  return !serverProcess && serverState === 'stopped' && !serverStartCoordinator.getActiveKey();
}

function assertServerStoppedForServerToolChanges(toolName = 'Teleport Requests') {
  if (!isServerStoppedForServerToolChanges()) {
    throw new Error(`Stop the Minecraft server and wait for startup to finish before changing ${toolName}.`);
  }
}

async function captureActiveServerToolProfile(toolName) {
  if (applicationQuitting) throw new Error(`Cannot change ${toolName} while the app is quitting.`);
  assertServerStoppedForServerToolChanges(toolName);
  const profile = await getActiveProfile();
  if (!profile?.id) throw new Error(`Create or select a server before changing ${toolName}.`);
  const snapshot = Object.freeze({
    profileId: profile.id,
    paths: getPathsForProfile(profile)
  });
  await revalidateServerToolProfile(snapshot, toolName);
  return snapshot;
}

async function revalidateServerToolProfile(snapshot, toolName) {
  if (applicationQuitting) throw new Error(`Cannot change ${toolName} while the app is quitting.`);
  assertServerStoppedForServerToolChanges(toolName);
  const profile = await getActiveProfile();
  if (!profile?.id || profile.id !== snapshot?.profileId) {
    throw new Error(`The active server changed while ${toolName} was being prepared. No server files were changed.`);
  }
  return snapshot.paths;
}

async function revalidateServerStartProfile(snapshot) {
  assertApplicationAllowsOwnedChildStart('the Minecraft server');
  if (serverStartCoordinator.getActiveKey() !== 'start' || serverProcess || serverState !== 'starting') {
    throw new Error('Server startup state changed before protection files were committed.');
  }
  if (serverToolMutationCoordinator.getActiveKey()) {
    throw new Error('A server tool change began during startup. Try starting the server again.');
  }
  const profile = await getActiveProfile();
  if (!profile?.id || profile.id !== snapshot?.profileId) {
    throw new Error('The active server changed during startup. No protection files were changed.');
  }
  return snapshot.paths;
}

async function requireBundledTeleportRuntime(paths = null) {
  const config = await readConfig(paths);
  const serverType = normalizeServerType(config.serverType);
  const platform = await getServerPlatformStatus(config, paths);
  const adapter = getBundledTeleportAdapter(serverType, platform.minecraftVersion || config.serverVersion);
  if (!adapter) {
    if (serverType === 'fabric') {
      throw new Error(`Teleport Requests for Fabric requires Minecraft ${BUNDLED_TELEPORT_FABRIC_MINECRAFT} exactly.`);
    }
    throw new Error('Teleport Requests requires Paper, Purpur, Spigot, or Fabric 26.2.');
  }
  if (!isBundledTeleportRuntimeCompatible(serverType, platform, adapter)) {
    throw new Error(platform.message || 'Install the matching server platform before changing Teleport Requests.');
  }
  return { config, serverType, platform, adapter };
}

async function getBundledTeleportStatus(pathsOverride = null) {
  const profileAtStart = await getActiveProfile();
  const profileId = profileAtStart?.id || '';
  const paths = pathsOverride || getPathsForProfile(profileAtStart);
  const [config, metadata] = await Promise.all([
    readJson(paths.config, DEFAULT_CONFIG).then(normalizeServerConfig),
    readServerToolsMetadata(paths)
  ]);
  const serverType = normalizeServerType(config.serverType);
  const platform = await getServerPlatformStatus(config, paths);
  const runtimeAdapter = getBundledTeleportAdapter(serverType, platform.minecraftVersion || config.serverVersion);
  const recordAdapter = getBundledTeleportAdapterById(metadata.teleport?.adapterId || '');
  const installedAdapter = recordAdapter || runtimeAdapter;
  const scanAdapter = runtimeAdapter || installedAdapter || getBundledTeleportAdapterById('bukkit');
  const expectedKind = ['fabric', 'quilt', 'forge', 'neoforge'].includes(serverType) ? 'mods' : 'plugins';
  const descriptorIndex = await (scanAdapter.kind === 'mods' ? getModDescriptorIndex(paths) : getPluginDescriptorIndex(paths));
  const [runtimeArtifact, installedArtifact, commandConflicts] = await Promise.all([
    runtimeAdapter ? findBundledTeleportArtifact(runtimeAdapter) : null,
    installedAdapter ? findBundledTeleportArtifact(installedAdapter) : null,
    findBundledTeleportCommandConflicts(paths, descriptorIndex, scanAdapter)
  ]);
  const destination = installedAdapter ? getBundledTeleportJarPath(paths, installedAdapter) : '';
  const installed = destination ? await inspectInstalledBundledTeleport(destination) : null;
  const classification = classifyBundledTeleportInstall({
    artifact: installedArtifact,
    installed,
    record: metadata.teleport,
    adapter: installedAdapter
  });
  const runtimeCompatible = Boolean(runtimeAdapter &&
    isBundledTeleportRuntimeCompatible(serverType, platform, runtimeAdapter) &&
    (!classification.managed || installedAdapter?.id === runtimeAdapter.id));
  const serverStopped = isServerStoppedForServerToolChanges();
  const warnings = commandConflicts.map((entry) => entry.message);
  const dependencyState = runtimeAdapter
    ? await getBundledTeleportFabricDependencyState(paths, runtimeAdapter, descriptorIndex)
    : { ready: true, managed: false, file: '', conflict: false, descriptorIndex, warnings: [] };
  const dependencyArtifact = runtimeAdapter && isBundledFabricTeleportAdapter(runtimeAdapter) && !dependencyState.ready
    ? await findBundledTeleportDependencyArtifact(runtimeAdapter) : null;
  warnings.push(...(dependencyState.warnings || []));
  if (classification.conflict) {
    warnings.unshift(
      `${path.basename(destination || scanAdapter.managedFile)} exists but is not a verified managed copy. It will not be replaced or removed.`
    );
  }
  if (runtimeCompatible && runtimeAdapter?.kind === 'plugins' && !platform.verified) {
    warnings.push('This custom server JAR is not a verified download. Confirm that it is really Paper, Purpur, or Spigot.');
  }
  if (descriptorIndex.warning && !warnings.includes(descriptorIndex.warning)) warnings.push(descriptorIndex.warning);

  const dependencyCanProvision = Boolean(!isBundledFabricTeleportAdapter(runtimeAdapter) ||
    dependencyState.ready || dependencyArtifact);
  const dependencyRepair = Boolean(classification.managed && isBundledFabricTeleportAdapter(runtimeAdapter) &&
    installedAdapter?.id === runtimeAdapter.id && !dependencyState.ready && !dependencyState.conflict);
  const updateAvailable = Boolean(classification.updateAvailable || dependencyRepair);
  const sameRuntimeInstall = Boolean(!classification.managed || installedAdapter?.id === runtimeAdapter?.id);

  let message = 'Teleport Requests is ready to install.';
  if (serverType === 'fabric' && !runtimeAdapter) {
    message = `Teleport Requests for Fabric requires Minecraft ${BUNDLED_TELEPORT_FABRIC_MINECRAFT} exactly.`;
  } else if (!runtimeAdapter) {
    message = 'Teleport Requests requires Paper, Purpur, Spigot, or Fabric 26.2.';
  } else if (classification.managed && installedAdapter?.id !== runtimeAdapter.id) {
    message = `A managed ${installedAdapter?.kind === 'mods' ? 'Fabric mod' : 'Bukkit plugin'} copy is installed. Remove it before installing the ${runtimeAdapter.kind === 'mods' ? 'Fabric mod' : 'Bukkit plugin'}.`;
  } else if (!runtimeCompatible) {
    message = platform.message || 'Install the matching server platform first.';
  } else if (dependencyState.conflict) {
    message = `Resolve the duplicate or incompatible Fabric API installation before enabling Teleport Requests.`;
  } else if (!runtimeArtifact || !dependencyCanProvision) {
    message = `The bundled Teleport Requests ${runtimeAdapter.kind === 'mods' ? 'mod or its Fabric API dependency is' : 'plugin is'} missing or failed integrity inspection.`;
  } else if (classification.conflict) {
    message = `${path.basename(destination)} is occupied by an unmanaged JAR.`;
  } else if (classification.managed) {
    message = commandConflicts.length
      ? 'Teleport Requests is installed, but another add-on may own the same commands.'
      : dependencyRepair
        ? 'Teleport Requests is installed, but Fabric API is missing. Repair is ready.'
        : classification.updateAvailable
          ? 'A Teleport Requests update is ready.'
        : 'Teleport Requests is installed.';
  } else if (commandConflicts.length) {
    message = 'Another installed add-on may own teleport request commands.';
  } else if (!serverStopped) {
    message = 'Stop the server to install Teleport Requests.';
  }

  return {
    id: 'server-teleport',
    name: 'Teleport Requests',
    file: classification.installed ? installedAdapter?.managedFile || '' : '',
    kind: expectedKind,
    installedKind: classification.installed ? installedAdapter?.kind || '' : '',
    adapterId: runtimeAdapter?.id || installedAdapter?.id || '',
    minecraftVersion: platform.minecraftVersion || normalizeAddonVersion(config.serverVersion),
    supportedMinecraftVersions: serverType === 'fabric' ? [BUNDLED_TELEPORT_FABRIC_MINECRAFT] : [],
    profileId,
    serverType,
    platform,
    runtimeCompatible,
    artifactAvailable: Boolean(runtimeArtifact && dependencyCanProvision),
    artifactSha256: runtimeArtifact?.sha256 || '',
    artifactSize: Number(runtimeArtifact?.size) || 0,
    installed: classification.installed,
    managed: classification.managed,
    integrityVerified: classification.integrityVerified,
    updateAvailable,
    dependencyReady: dependencyState.ready,
    dependencyManaged: dependencyState.managed,
    dependencyFile: dependencyState.file,
    dependencyConflict: dependencyState.conflict,
    conflict: classification.conflict,
    conflictScanPartial: descriptorIndex.partial,
    conflictScanWarning: descriptorIndex.warning,
    serverStopped,
    canInstall: Boolean(serverStopped && runtimeCompatible && runtimeArtifact && dependencyCanProvision &&
      !dependencyState.conflict && !descriptorIndex.partial && !classification.conflict &&
      !commandConflicts.length && sameRuntimeInstall && (!classification.managed || updateAvailable)),
    canRemove: Boolean(serverStopped && classification.managed),
    installedAt: metadata.teleport?.installedAt || '',
    installedVersion: installed?.fabricVersion || '',
    latestVersion: runtimeArtifact?.fabricVersion || '',
    sha256: installed?.sha256 || '',
    commandConflicts,
    warnings,
    message
  };
}

function assessManagedBundledTeleportRefresh({ adapter, record, installed, artifact } = {}) {
  if (!isBundledFabricTeleportAdapter(adapter)) {
    return { eligible: false, reason: 'unsupported-adapter' };
  }
  if (!installed) return { eligible: false, reason: 'not-installed' };
  if (!artifact) return { eligible: false, reason: 'artifact-unavailable' };
  if (!inspectionMatchesBundledTeleportAdapter(installed, adapter)) {
    return { eligible: false, reason: 'identity-mismatch' };
  }
  if (installed.sha256 === artifact.sha256 && installed.size === artifact.size) {
    return { eligible: false, reason: 'current' };
  }

  const normalizedRecord = normalizeServerToolsMetadata({ teleport: record }).teleport;
  const recordMatchesAdapter = Boolean(normalizedRecord &&
    normalizedRecord.adapterId === adapter.id &&
    normalizedRecord.kind === adapter.kind &&
    normalizedRecord.minecraftVersion === adapter.minecraftVersion &&
    normalizedRecord.file === adapter.managedFile);
  if (!recordMatchesAdapter) return { eligible: false, reason: 'unmanaged' };
  if (installed.sha256 !== normalizedRecord.sha256 || installed.size !== normalizedRecord.size) {
    return { eligible: false, reason: 'modified' };
  }
  return { eligible: true, reason: 'managed-update' };
}

/**
 * Refreshes only an already-managed Fabric Teleport Requests JAR while startup still owns a
 * stopped server. An absent, modified, or unrecorded file is never adopted or overwritten.
 */
async function refreshManagedBundledTeleportBeforeStartUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot;
  const paths = context.paths || profileSnapshot?.paths;
  const serverConfig = context.serverConfig;
  const platform = context.platform;
  const revalidate = context.revalidate;
  if (!profileSnapshot?.profileId || !paths || !serverConfig || !platform || typeof revalidate !== 'function') {
    throw new Error('Teleport Requests update did not receive a verified startup context.');
  }

  const serverType = normalizeServerType(serverConfig.serverType);
  if (serverType !== 'fabric') return { checked: false, updated: false, reason: 'not-fabric' };
  const adapter = getBundledTeleportAdapter(
    serverType,
    platform.minecraftVersion || serverConfig.serverVersion
  );
  if (!adapter || !isBundledTeleportRuntimeCompatible(serverType, platform, adapter)) {
    return { checked: true, updated: false, reason: 'unsupported-runtime' };
  }

  const destination = getBundledTeleportJarPath(paths, adapter);
  const [installed, artifact, metadata, descriptorIndex] = await Promise.all([
    inspectInstalledBundledTeleport(destination),
    findBundledTeleportArtifact(adapter),
    readServerToolsMetadata(paths),
    getModDescriptorIndex(paths)
  ]);
  const assessment = assessManagedBundledTeleportRefresh({
    adapter,
    record: metadata.teleport,
    installed,
    artifact
  });
  if (!assessment.eligible) {
    if (['identity-mismatch', 'unmanaged', 'modified'].includes(assessment.reason)) {
      appendServerLog(
        `[Teleport Requests] Automatic managed update skipped (${assessment.reason}). ` +
        'The existing mod was left untouched.\n'
      );
    }
    return { checked: true, updated: false, reason: assessment.reason };
  }
  if (descriptorIndex.partial) {
    appendServerLog(
      `[Teleport Requests] Automatic managed update skipped because the mods folder could not be inspected completely. ` +
      'The existing mod was left untouched.\n'
    );
    return { checked: true, updated: false, reason: 'descriptor-scan-partial' };
  }
  const commandConflicts = await findBundledTeleportCommandConflicts(paths, descriptorIndex, adapter);
  if (commandConflicts.length) {
    appendServerLog(
      `[Teleport Requests] Automatic managed update skipped because ${commandConflicts[0].file || 'another add-on'} ` +
      'may own the same commands. The existing mod was left untouched.\n'
    );
    return { checked: true, updated: false, reason: 'command-conflict' };
  }
  const dependencyState = await getBundledTeleportFabricDependencyState(paths, adapter, descriptorIndex);
  if (dependencyState.conflict || !dependencyState.ready) {
    appendServerLog(
      '[Teleport Requests] Automatic managed update skipped because Fabric API is missing, duplicated, or incompatible. ' +
      'The existing mod was left untouched.\n'
    );
    return { checked: true, updated: false, reason: 'dependency-unavailable' };
  }

  await revalidate();
  const stageToken = `${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  const temporary = `${destination}.install-${stageToken}`;
  const rollback = `${destination}.rollback-${stageToken}`;
  let movedExisting = false;
  let published = false;
  let commitComplete = false;
  let retainRollback = false;
  try {
    await fs.mkdir(paths.mods, { recursive: true });
    await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
    const staged = await inspectAntiCheatJar(temporary);
    if (staged.sha256 !== artifact.sha256 || staged.size !== artifact.size ||
        !inspectionMatchesBundledTeleportAdapter(staged, adapter)) {
      throw new Error('The staged Teleport Requests mod failed its integrity check.');
    }

    await revalidate();
    const freshIndex = await getModDescriptorIndex(paths);
    if (freshIndex.partial) {
      throw new Error('The mods folder changed or could not be inspected completely. No managed mod was replaced.');
    }
    const freshConflicts = await findBundledTeleportCommandConflicts(paths, freshIndex, adapter);
    if (freshConflicts.length) {
      throw new Error(`${freshConflicts[0].message} No managed mod was replaced.`);
    }
    const freshDependencyState = await getBundledTeleportFabricDependencyState(paths, adapter, freshIndex);
    if (freshDependencyState.conflict || !freshDependencyState.ready) {
      throw new Error('Fabric API changed during Teleport Requests preparation. No managed mod was replaced.');
    }
    const current = await inspectInstalledBundledTeleport(destination);
    if (!current || current.sha256 !== installed.sha256 || current.size !== installed.size ||
        !inspectionMatchesBundledTeleportAdapter(current, adapter)) {
      throw new Error(`${adapter.managedFile} changed during startup preparation and was left untouched.`);
    }

    await revalidate();
    await fs.rename(destination, rollback);
    movedExisting = true;
    const moved = await inspectInstalledBundledTeleport(rollback);
    if (!moved || moved.sha256 !== installed.sha256 || moved.size !== installed.size ||
        !inspectionMatchesBundledTeleportAdapter(moved, adapter)) {
      throw new Error('The quarantined managed Teleport Requests JAR failed verification.');
    }
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`${adapter.managedFile} appeared during the managed update and was not overwritten.`);
      }
      throw new Error(`Could not publish Teleport Requests atomically: ${error?.message || String(error)}`);
    }
    published = true;
    await fs.rm(temporary, { force: true });

    const finalInstall = await inspectInstalledBundledTeleport(destination);
    if (!finalInstall || finalInstall.sha256 !== artifact.sha256 || finalInstall.size !== artifact.size ||
        !inspectionMatchesBundledTeleportAdapter(finalInstall, adapter)) {
      throw new Error('The installed Teleport Requests mod failed final verification.');
    }
    const installedAt = metadata.teleport?.installedAt || new Date().toISOString();
    await writeServerToolsMetadata(paths, {
      ...metadata,
      version: 2,
      teleport: {
        name: BUNDLED_TELEPORT_NAME,
        adapterId: adapter.id,
        kind: adapter.kind,
        minecraftVersion: adapter.minecraftVersion,
        file: adapter.managedFile,
        sha256: artifact.sha256,
        size: artifact.size,
        installedAt,
        dependencyFile: freshDependencyState.file,
        dependencyProvisioned: Boolean(metadata.teleport?.dependencyProvisioned)
      }
    });
    commitComplete = true;
    await upsertInstalledAddonMetadata(paths, {
      kind: adapter.kind,
      file: adapter.managedFile,
      source: 'imported',
      title: 'Teleport Requests',
      author: 'Built in',
      versionName: artifact.fabricVersion || '',
      gameVersion: adapter.minecraftVersion,
      installedAt
    }).catch((error) => appendServerLog(
      `[Teleport Requests] Updated successfully, but add-on list metadata could not be refreshed: ${error?.message || error}\n`
    ));
    await fs.rm(rollback, { force: true }).catch((error) => appendServerLog(
      `[Teleport Requests] Updated successfully, but its temporary rollback copy could not be removed: ${error?.message || error}\n`
    ));
    movedExisting = false;
    cachedStatus = null;
    invalidateCachedWork(`disk-size:${paths.root}`);
    appendServerLog(
      `[Teleport Requests] Updated the verified managed Fabric mod to ${artifact.fabricVersion || 'the bundled release'} before startup.\n`
    );
    return { checked: true, updated: true, reason: 'updated', version: artifact.fabricVersion || '' };
  } catch (error) {
    if (!commitComplete && movedExisting) {
      let destinationClear = !await isRegularFile(destination);
      if (published && !destinationClear) {
        const current = await inspectInstalledBundledTeleport(destination);
        if (current?.sha256 === artifact.sha256 && current?.size === artifact.size) {
          await fs.rm(destination, { force: true });
          destinationClear = !await isRegularFile(destination);
        } else {
          retainRollback = true;
          error.message = `${error.message} The destination changed after publication; the verified prior JAR remains at ${rollback}.`;
        }
      }
      if (!published && !destinationClear) {
        retainRollback = true;
        error.message = `${error.message} A different destination file is present; the verified prior JAR remains at ${rollback}.`;
      }
      if (destinationClear) {
        try {
          await fs.rename(rollback, destination);
          movedExisting = false;
        } catch (rollbackError) {
          retainRollback = true;
          error.message = `${error.message} Automatic rollback failed; the verified prior JAR remains at ${rollback}: ${rollbackError?.message || rollbackError}`;
        }
      }
    }
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (!retainRollback && movedExisting) await fs.rm(rollback, { force: true }).catch(() => {});
  }
}

function installBundledTeleport() {
  return serverTeleportMutationCoordinator.run('install', async () => {
    const profileSnapshot = await captureActiveServerToolProfile('Teleport Requests');
    const paths = profileSnapshot.paths;
    const { adapter } = await requireBundledTeleportRuntime(paths);
    const [artifact, descriptorIndex, metadata] = await Promise.all([
      findBundledTeleportArtifact(adapter),
      adapter.kind === 'mods' ? getModDescriptorIndex(paths) : getPluginDescriptorIndex(paths),
      readServerToolsMetadata(paths)
    ]);
    if (!artifact) throw new Error(`The bundled Teleport Requests ${adapter.kind === 'mods' ? 'mod' : 'plugin'} is missing or failed integrity inspection.`);
    if (descriptorIndex.partial) throw new Error(`${descriptorIndex.warning} No files were changed.`);
    const commandConflicts = await findBundledTeleportCommandConflicts(paths, descriptorIndex, adapter);
    if (commandConflicts.length) {
      throw new Error(`${commandConflicts[0].message} No files were changed.`);
    }
    const recordedAdapter = getBundledTeleportAdapterById(metadata.teleport?.adapterId || '');
    if (recordedAdapter && recordedAdapter.id !== adapter.id) {
      const recordedDestination = getBundledTeleportJarPath(paths, recordedAdapter);
      const [recordedArtifact, recordedInstall] = await Promise.all([
        findBundledTeleportArtifact(recordedAdapter),
        inspectInstalledBundledTeleport(recordedDestination)
      ]);
      const recordedClassification = classifyBundledTeleportInstall({
        artifact: recordedArtifact,
        installed: recordedInstall,
        record: metadata.teleport,
        adapter: recordedAdapter
      });
      if (recordedClassification.managed) {
        throw new Error('Remove the existing managed Teleport Requests copy before changing server runtimes. No files were changed.');
      }
    }
    const destination = getBundledTeleportJarPath(paths, adapter);
    const installed = await inspectInstalledBundledTeleport(destination);
    const currentRecord = recordedAdapter?.id === adapter.id ? metadata.teleport : null;
    const classification = classifyBundledTeleportInstall({ artifact, installed, record: currentRecord, adapter });
    if (classification.conflict) {
      throw new Error(
        `${adapter.managedFile} already exists but is not a verified managed copy. ` +
        'It was left untouched. Rename or remove it yourself before installing Teleport Requests.'
      );
    }
    const dependencyState = await getBundledTeleportFabricDependencyState(paths, adapter, descriptorIndex);
    if (dependencyState.conflict) throw new Error(`${dependencyState.warnings[0]} No files were changed.`);
    const dependencyArtifact = isBundledFabricTeleportAdapter(adapter) && !dependencyState.ready
      ? await findBundledTeleportDependencyArtifact(adapter) : null;
    if (isBundledFabricTeleportAdapter(adapter) && !dependencyState.ready && !dependencyArtifact) {
      throw new Error('The pinned Fabric API dependency is missing or failed integrity inspection. No files were changed.');
    }
    if (classification.managed && !classification.updateAvailable && dependencyState.ready) {
      return { ...(await getBundledTeleportStatus(paths)), changed: false };
    }

    await revalidateServerToolProfile(profileSnapshot, 'Teleport Requests');
    await fs.mkdir(adapter.kind === 'mods' ? paths.mods : paths.plugins, { recursive: true });
    const temporary = `${destination}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const rollback = `${destination}.rollback-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const dependencyDestination = getBundledTeleportDependencyPath(paths, adapter);
    const dependencyTemporary = dependencyArtifact
      ? `${dependencyDestination}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}` : '';
    let dependencyPublished = false;
    let mainPublished = false;
    let mainReplaced = false;
    let commitComplete = false;
    let retainRollback = false;
    let finalDependencyState = dependencyState;
    try {
      const needsMainPublish = !classification.matchesArtifact;
      if (needsMainPublish) {
        await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
        const copied = await inspectAntiCheatJar(temporary);
        if (copied.sha256 !== artifact.sha256 || copied.size !== artifact.size ||
            !inspectionMatchesBundledTeleportAdapter(copied, adapter)) {
          throw new Error(`The bundled Teleport Requests ${adapter.kind === 'mods' ? 'mod' : 'plugin'} failed its post-copy integrity check.`);
        }
      }
      if (dependencyArtifact) {
        await fs.copyFile(dependencyArtifact.path, dependencyTemporary, fss.constants.COPYFILE_EXCL);
        const copiedDependency = await inspectAntiCheatJar(dependencyTemporary);
        if (copiedDependency.sha256 !== adapter.dependencySha256 ||
            copiedDependency.size !== adapter.dependencySize || !inspectionIsFabricApi(copiedDependency) ||
            !isCompatibleFabricApiVersion(copiedDependency.fabricVersion, adapter.minecraftVersion)) {
          throw new Error('The bundled Fabric API dependency failed its post-copy integrity check.');
        }
      }
      await revalidateServerToolProfile(profileSnapshot, 'Teleport Requests');
      const freshDescriptorIndex = adapter.kind === 'mods'
        ? await getModDescriptorIndex(paths) : await getPluginDescriptorIndex(paths);
      if (freshDescriptorIndex.partial) {
        throw new Error(`${freshDescriptorIndex.warning || 'The add-ons folder changed during inspection.'} No files were changed.`);
      }
      const freshCommandConflicts = await findBundledTeleportCommandConflicts(paths, freshDescriptorIndex, adapter);
      if (freshCommandConflicts.length) {
        throw new Error(`${freshCommandConflicts[0].message} No managed files were replaced.`);
      }
      finalDependencyState = await getBundledTeleportFabricDependencyState(paths, adapter, freshDescriptorIndex);
      if (finalDependencyState.conflict) {
        throw new Error(`${finalDependencyState.warnings[0]} No managed files were replaced.`);
      }
      if (isBundledFabricTeleportAdapter(adapter) && !finalDependencyState.ready && !dependencyArtifact) {
        throw new Error('Fabric API changed during Teleport Requests preparation. No managed files were replaced.');
      }
      if (dependencyArtifact && !finalDependencyState.ready) {
        try {
          await fs.link(dependencyTemporary, dependencyDestination);
        } catch (error) {
          if (error?.code === 'EEXIST') throw new Error(`${adapter.dependencyFile} appeared during installation. No managed files were replaced.`);
          throw new Error(`Could not publish the Fabric API dependency atomically: ${error?.message || String(error)}`);
        }
        dependencyPublished = true;
        await fs.rm(dependencyTemporary, { force: true });
        await revalidateServerToolProfile(profileSnapshot, 'Teleport Requests');
      }
      if (isBundledFabricTeleportAdapter(adapter)) {
        const postPublishIndex = await getModDescriptorIndex(paths);
        finalDependencyState = await getBundledTeleportFabricDependencyState(paths, adapter, postPublishIndex);
        if (postPublishIndex.partial || finalDependencyState.conflict || !finalDependencyState.ready) {
          throw new Error('Fabric API changed during Teleport Requests installation. The managed update was not committed.');
        }
        const finalDependency = await inspectInstalledBundledTeleport(
          path.join(paths.mods, finalDependencyState.file)
        );
        if (!finalDependency || !inspectionIsFabricApi(finalDependency) ||
            !isCompatibleFabricApiVersion(finalDependency.fabricVersion, adapter.minecraftVersion)) {
          throw new Error('The final Fabric API dependency could not be verified. The managed update was not committed.');
        }
      }
      if (needsMainPublish && installed) {
        const current = await inspectInstalledBundledTeleport(destination);
        if (!current || current.sha256 !== installed.sha256 ||
            !inspectionMatchesBundledTeleportAdapter(current, adapter)) {
          throw new Error(`${adapter.managedFile} changed during installation and was left untouched.`);
        }
        await fs.copyFile(destination, rollback, fss.constants.COPYFILE_EXCL);
        await replaceFileAtomically(temporary, destination);
        mainPublished = true;
        mainReplaced = true;
      } else if (needsMainPublish) {
        try {
          await fs.link(temporary, destination);
        } catch (error) {
          if (error?.code === 'EEXIST') throw new Error(`${adapter.managedFile} appeared during installation and was left untouched.`);
          throw new Error(`Could not publish Teleport Requests atomically: ${error?.message || String(error)}`);
        }
        mainPublished = true;
        await fs.rm(temporary, { force: true });
      }
      const installedAt = new Date().toISOString();
      await writeServerToolsMetadata(paths, {
        ...metadata,
        version: 2,
        teleport: {
          name: BUNDLED_TELEPORT_NAME,
          adapterId: adapter.id,
          kind: adapter.kind,
          minecraftVersion: adapter.minecraftVersion,
          file: adapter.managedFile,
          sha256: artifact.sha256,
          size: artifact.size,
          installedAt,
          dependencyFile: finalDependencyState.file || (dependencyPublished ? adapter.dependencyFile : ''),
          dependencyProvisioned: Boolean(metadata.teleport?.dependencyProvisioned || dependencyPublished)
        }
      });
      commitComplete = true;
      await upsertInstalledAddonMetadata(paths, {
        kind: adapter.kind,
        file: adapter.managedFile,
        source: 'imported',
        title: 'Teleport Requests',
        author: 'Built in',
        installedAt
      }).catch((error) => appendServerLog(
        `[Teleport Requests] Installed successfully, but add-on list metadata could not be refreshed: ${error?.message || error}\n`
      ));
      await fs.rm(rollback, { force: true }).catch((error) => appendServerLog(
        `[Teleport Requests] Update committed, but its temporary rollback copy could not be removed: ${error?.message || error}\n`
      ));
      cachedStatus = null;
      invalidateCachedWork(`disk-size:${paths.root}`);
      return { ...(await getBundledTeleportStatus(paths)), changed: Boolean(mainPublished || dependencyPublished || !classification.matchesRecord) };
    } catch (error) {
      let mainStateRestored = !mainPublished;
      if (!commitComplete && mainPublished) {
        const current = await inspectInstalledBundledTeleport(destination);
        if (current?.sha256 === artifact.sha256 && current?.size === artifact.size) {
          if (mainReplaced && await isRegularFile(rollback)) {
            try {
              await replaceFileAtomically(rollback, destination);
              mainStateRestored = true;
            } catch (rollbackError) {
              retainRollback = true;
              error.message = `${error.message} Automatic rollback also failed; the verified prior JAR remains at ${rollback}: ${rollbackError?.message || rollbackError}`;
            }
          } else if (!mainReplaced) {
            try {
              await fs.rm(destination, { force: true });
              mainStateRestored = !await isRegularFile(destination);
            } catch {}
          }
        }
      }
      if (!commitComplete && dependencyPublished && mainStateRestored) {
        const dependencyNow = await inspectInstalledBundledTeleport(dependencyDestination);
        if (dependencyNow?.sha256 === adapter.dependencySha256 && dependencyNow?.size === adapter.dependencySize) {
          await fs.rm(dependencyDestination, { force: true }).catch(() => {});
        }
      }
      throw error;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
      if (!retainRollback) await fs.rm(rollback, { force: true }).catch(() => {});
      if (dependencyTemporary) await fs.rm(dependencyTemporary, { force: true }).catch(() => {});
    }
  });
}

async function removeBundledTeleport(profileSnapshotOverride = null) {
  const capturedProfile = profileSnapshotOverride || await captureActiveServerToolProfile('Teleport Requests');
  return serverTeleportMutationCoordinator.run('remove', async () => {
    const profileSnapshot = capturedProfile;
    const paths = await revalidateServerToolProfile(profileSnapshot, 'Teleport Requests');
    const metadata = await readServerToolsMetadata(paths);
    const config = await readConfig(paths);
    const platform = await getServerPlatformStatus(config, paths);
    const adapter = getBundledTeleportAdapterById(metadata.teleport?.adapterId || '') ||
      getBundledTeleportAdapter(config.serverType, platform.minecraftVersion || config.serverVersion);
    if (!adapter) return { ...(await getBundledTeleportStatus(paths)), changed: false };
    const destination = getBundledTeleportJarPath(paths, adapter);
    const [artifact, installed] = await Promise.all([
      findBundledTeleportArtifact(adapter),
      inspectInstalledBundledTeleport(destination)
    ]);
    if (!installed) {
      if (metadata.teleport) {
        await writeServerToolsMetadata(paths, { ...metadata, version: 2, teleport: null });
        await removeInstalledAddonMetadata(paths, adapter.kind, adapter.managedFile);
        return { ...(await getBundledTeleportStatus(paths)), changed: true };
      }
      return { ...(await getBundledTeleportStatus(paths)), changed: false };
    }
    const classification = classifyBundledTeleportInstall({ artifact, installed, record: metadata.teleport, adapter });
    if (!classification.managed) {
      throw new Error(
        `${adapter.managedFile} is not a verified managed copy. It was left untouched.`
      );
    }

    const current = await inspectInstalledBundledTeleport(destination);
    if (!current || current.sha256 !== installed.sha256 || !inspectionMatchesBundledTeleportAdapter(current, adapter)) {
      throw new Error(`${adapter.managedFile} changed before removal and was left untouched.`);
    }
    await revalidateServerToolProfile(profileSnapshot, 'Teleport Requests');
    const quarantine = `${destination}.removing-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.rename(destination, quarantine);
    try {
      const moved = await inspectInstalledBundledTeleport(quarantine);
      if (!moved || moved.sha256 !== installed.sha256 || !inspectionMatchesBundledTeleportAdapter(moved, adapter)) {
        throw new Error(`The ${adapter.kind === 'mods' ? 'mod' : 'plugin'} changed during removal.`);
      }
      await fs.rm(quarantine);
    } catch (error) {
      await fs.rename(quarantine, destination).catch(() => {});
      throw new Error(`Teleport Requests was not removed safely: ${error?.message || String(error)}`);
    }

    await writeServerToolsMetadata(paths, { ...metadata, version: 2, teleport: null });
    await removeInstalledAddonMetadata(paths, adapter.kind, adapter.managedFile);
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    return {
      ...(await getBundledTeleportStatus(paths)),
      changed: true,
      dependencyRetained: Boolean(isBundledFabricTeleportAdapter(adapter) && metadata.teleport?.dependencyFile)
    };
  });
}

function getBundledVoiceServerJarPath(paths, adapter = getBundledVoiceAdapterById('bukkit')) {
  return path.join(adapter?.kind === 'mods' ? paths.mods : paths.plugins, adapter?.managedFile || BUNDLED_VOICE_SERVER_JAR);
}

function getBundledVoiceDependencyPath(paths, adapter) {
  return isBundledFabricVoiceAdapter(adapter) ? path.join(paths.mods, adapter.dependencyFile) : '';
}

function getBundledVoiceRuntimePaths(paths, adapter) {
  return isBundledFabricVoiceAdapter(adapter)
    ? { status: paths.fabricVoiceStatus, config: paths.fabricVoiceConfig, configFormat: 'properties' }
    : { status: paths.voiceStatus, config: paths.voiceConfig, configFormat: 'yaml' };
}

function inspectionMatchesBundledVoiceAdapter(inspection, adapter) {
  if (!inspection || !adapter) return false;
  if (isBundledFabricVoiceAdapter(adapter)) {
    return inspection.kind === 'mods' && inspection.descriptor === 'fabric.mod.json' &&
      inspection.fabricModId === BUNDLED_VOICE_FABRIC_SERVER_MOD_ID &&
      inspection.fabricEnvironment === 'server' &&
      inspection.fabricMainEntrypoints.includes(BUNDLED_VOICE_FABRIC_SERVER_ENTRYPOINT) &&
      fabricDependencyMatchesExact(inspection.fabricMinecraftDependency, adapter.minecraftVersion) &&
      inspection.bundledFabricVoiceIdentity === true;
  }
  return inspection.kind === 'plugins' && inspection.pluginName === BUNDLED_VOICE_NAME &&
    inspection.bundledVoiceIdentity === true;
}

function classifyBundledVoiceInstall({ artifact = null, installed = null, record = null, adapter = null } = {}) {
  const normalizedRecord = normalizeServerToolsMetadata({ voice: record }).voice;
  const resolvedAdapter = adapter || getBundledVoiceAdapterById(normalizedRecord?.adapterId || 'bukkit');
  const installedIdentity = Boolean(
    installed && inspectionMatchesBundledVoiceAdapter(installed, resolvedAdapter) &&
    /^[a-f0-9]{64}$/i.test(String(installed.sha256 || ''))
  );
  const matchesArtifact = Boolean(
    installedIdentity && artifact && /^[a-f0-9]{64}$/i.test(String(artifact.sha256 || '')) &&
    installed.sha256 === artifact.sha256
  );
  const matchesRecord = Boolean(
    installedIdentity && normalizedRecord && normalizedRecord.sha256 === installed.sha256
  );
  const managed = Boolean(matchesArtifact || matchesRecord);
  return {
    installed: Boolean(installed),
    installedIdentity,
    matchesArtifact,
    matchesRecord,
    managed,
    integrityVerified: managed,
    conflict: Boolean(installed && !managed),
    updateAvailable: Boolean(managed && artifact && installed.sha256 !== artifact.sha256)
  };
}

function isBundledVoiceRuntimeCompatible(serverType, platform, adapter = null) {
  const type = normalizeServerType(serverType);
  const resolvedAdapter = adapter || getBundledVoiceAdapter(type, platform?.minecraftVersion || '');
  if (!resolvedAdapter || !resolvedAdapter.serverTypes.includes(type) || !platform?.jarExists || !platform.compatible) return false;
  if (isBundledFabricVoiceAdapter(resolvedAdapter)) {
    return platform.supportsMods !== false && normalizeAddonVersion(platform.minecraftVersion) === resolvedAdapter.minecraftVersion;
  }
  return platform.supportsPlugins !== false;
}

function getBundledVoiceMinecraftVersion(config = {}, platform = {}) {
  return normalizeAddonVersion(platform?.minecraftVersion) || normalizeAddonVersion(config?.serverVersion);
}

function isBundledVoiceClientCompatible(minecraftVersion) {
  return normalizeAddonVersion(minecraftVersion) === BUNDLED_VOICE_CLIENT_MINECRAFT;
}

function describeBundledVoiceRuntime(runtime, runtimeFresh, currentServerState) {
  const state = String(currentServerState || 'stopped').toLowerCase();
  if (state === 'running') {
    if (!runtimeFresh || !runtime) {
      return 'Proximity Voice is installed, but its relay is not reporting current status.';
    }
    const detail = runtime.lastError ? `: ${runtime.lastError}` : '.';
    if (runtime.state === 'running') {
      return `${runtime.associatedClients} voice client${runtime.associatedClients === 1 ? '' : 's'} connected.`;
    }
    if (runtime.state === 'disabled') return `Proximity Voice relay is disabled${detail}`;
    if (runtime.state === 'error') return `Proximity Voice relay error${detail}`;
    if (runtime.state === 'stopped') return `Proximity Voice relay stopped unexpectedly${detail}`;
    return `Proximity Voice relay reported an unknown state${detail}`;
  }
  if (state === 'starting') return 'Proximity Voice is installed. Waiting for the server relay to start.';
  if (state === 'stopping') return 'Proximity Voice is installed. The server relay is stopping.';
  return 'Proximity Voice is installed. Start the server to run its relay.';
}

async function findBundledVoiceServerArtifact(adapter = getBundledVoiceAdapterById('bukkit')) {
  if (!adapter) return null;
  const candidate = path.join(__dirname, adapter.projectDirectory, 'dist', adapter.artifactFile);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return null;
    const inspection = await getCachedWork(
      `bundled-voice-server:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (!inspectionMatchesBundledVoiceAdapter(inspection, adapter) ||
        inspection.sha256 !== adapter.sha256 || inspection.size !== adapter.size) {
      return null;
    }
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function findBundledVoiceDependencyArtifact(adapter) {
  if (!isBundledFabricVoiceAdapter(adapter)) return null;
  const candidates = [
    path.join(__dirname, 'server-protection-fabric-26.2', 'dist', adapter.dependencyArtifactFile),
    path.join(__dirname, 'server-teleport-fabric', 'dist', adapter.dependencyArtifactFile)
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const inspection = await getCachedWork(
        `bundled-voice-dependency:${candidate}:${stat.size}:${stat.mtimeMs}`,
        5 * 60_000,
        () => inspectAntiCheatJar(candidate)
      );
      if (inspection.sha256 === adapter.dependencySha256 && inspection.size === adapter.dependencySize &&
          inspectionIsFabricApi(inspection) &&
          isCompatibleFabricApiVersion(inspection.fabricVersion, adapter.minecraftVersion)) {
        return { path: candidate, stat, ...inspection };
      }
    } catch {}
  }
  return null;
}

async function getBundledVoiceFabricDependencyState(paths, adapter, descriptorIndex = null) {
  if (!isBundledFabricVoiceAdapter(adapter)) {
    return { ready: true, managed: false, file: '', conflict: false, targetInstall: null, warnings: [] };
  }
  const index = descriptorIndex || await getModDescriptorIndex(paths);
  const dependencyPath = getBundledVoiceDependencyPath(paths, adapter);
  const targetInstall = await inspectInstalledBundledVoice(dependencyPath);
  const targetCompatible = Boolean(targetInstall && inspectionIsFabricApi(targetInstall) &&
    isCompatibleFabricApiVersion(targetInstall.fabricVersion, adapter.minecraftVersion));
  const targetManaged = Boolean(targetCompatible && targetInstall.sha256 === adapter.dependencySha256 &&
    targetInstall.size === adapter.dependencySize);
  const externalApis = index.files.filter((entry) =>
    entry.name.toLowerCase() !== adapter.dependencyFile.toLowerCase() &&
    entry.descriptor?.fabricModId === 'fabric-api'
  );
  const compatibleExternal = externalApis.filter((entry) =>
    isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, adapter.minecraftVersion));
  const incompatibleExternal = externalApis.filter((entry) =>
    !isCompatibleFabricApiVersion(entry.descriptor?.fabricVersion, adapter.minecraftVersion));
  const conflict = Boolean((targetInstall && !targetCompatible) || incompatibleExternal.length ||
    compatibleExternal.length > 1 || (targetCompatible && compatibleExternal.length));
  const warnings = [];
  if (conflict) warnings.push(`Fabric API must have exactly one compatible Minecraft ${adapter.minecraftVersion} installation.`);
  if (index.warning) warnings.push(index.warning);
  return {
    ready: Boolean(!conflict && !index.partial && (targetCompatible || compatibleExternal.length === 1)),
    managed: targetManaged,
    file: targetCompatible ? adapter.dependencyFile : (compatibleExternal[0]?.name || ''),
    conflict,
    compatibleExternal: compatibleExternal[0] || null,
    targetInstall,
    descriptorIndex: index,
    warnings
  };
}

async function findBundledVoiceClientArtifact() {
  const candidate = path.join(__dirname, 'proximity-voice', 'fabric-client', 'dist', BUNDLED_VOICE_CLIENT_FILE);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || stat.size !== BUNDLED_VOICE_CLIENT_SIZE) return null;
    const inspection = await getCachedWork(
      `bundled-voice-client:${candidate}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(candidate)
    );
    if (inspection.kind !== 'mods' || inspection.descriptor !== 'fabric.mod.json' ||
        inspection.sha256 !== BUNDLED_VOICE_CLIENT_SHA256 || inspection.size !== BUNDLED_VOICE_CLIENT_SIZE) {
      return null;
    }
    return { path: candidate, stat, ...inspection };
  } catch {
    return null;
  }
}

async function exportBundledVoiceClient(event) {
  const artifact = await findBundledVoiceClientArtifact();
  if (!artifact) throw new Error('The bundled Proximity Voice client mod is missing or failed integrity inspection.');
  const owner = BrowserWindow.fromWebContents(event?.sender) || mainWindow;
  const options = {
    title: 'Save Proximity Voice client mod',
    defaultPath: BUNDLED_VOICE_CLIENT_FILE,
    filters: [{ name: 'Fabric client mod', extensions: ['jar'] }]
  };
  const result = owner && !owner.isDestroyed()
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { cancelled: true };

  const destination = path.resolve(result.filePath);
  const temporary = `${destination}.export-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const backup = `${destination}.previous-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let movedExisting = false;
  let published = false;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
    const temporaryStat = await fs.stat(temporary);
    const temporaryHash = await calculateFileHash(temporary, 'sha256');
    if (temporaryStat.size !== BUNDLED_VOICE_CLIENT_SIZE || temporaryHash !== BUNDLED_VOICE_CLIENT_SHA256) {
      throw new Error('The copied client mod failed its integrity check.');
    }
    try {
      await fs.rename(destination, backup);
      movedExisting = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.rename(temporary, destination);
    published = true;
    const destinationStat = await fs.stat(destination);
    const destinationHash = await calculateFileHash(destination, 'sha256');
    if (destinationStat.size !== BUNDLED_VOICE_CLIENT_SIZE || destinationHash !== BUNDLED_VOICE_CLIENT_SHA256) {
      throw new Error('The saved client mod failed its final integrity check.');
    }
    if (movedExisting) await fs.rm(backup, { force: true });
    return {
      cancelled: false,
      name: path.basename(destination),
      size: destinationStat.size,
      sha256: destinationHash,
      minecraftVersion: BUNDLED_VOICE_CLIENT_MINECRAFT,
      loader: 'Fabric'
    };
  } catch (error) {
    if (published) await fs.rm(destination, { force: true }).catch(() => {});
    if (movedExisting) await fs.rename(backup, destination).catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (!movedExisting) await fs.rm(backup, { force: true }).catch(() => {});
  }
}

async function inspectInstalledBundledVoice(file) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    const inspection = await getCachedWork(
      `installed-voice:${file}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(file)
    );
    return { file, stat, ...inspection };
  } catch (error) {
    return {
      file,
      stat,
      kind: '',
      pluginName: '',
      bundledVoiceIdentity: false,
      bundledFabricVoiceIdentity: false,
      sha256: '',
      inspectionError: String(error?.message || error || 'The JAR could not be inspected.')
    };
  }
}

async function findVoicePluginConflicts(paths, descriptorIndex = null) {
  const reserved = BUNDLED_VOICE_SERVER_JAR.toLowerCase();
  const index = descriptorIndex || await getPluginDescriptorIndex(paths);
  const matches = index.files
    .filter(file => file.name.toLowerCase() !== reserved)
    .map(file => {
    const pluginName = file.descriptor?.pluginName || '';
    const identity = `${file.name} ${pluginName}`;
    if (!/(?:simple[\s._-]*voice[\s._-]*chat|voice[\s._-]*chat|voicechat|plasmo[\s._-]*voice|plasmovoice|open[\s._-]*voice)/i.test(identity)) {
      return null;
    }
    return {
      file: file.name,
      name: String(pluginName || file.name.replace(/\.jar$/i, '')).slice(0, 180),
      message: `${pluginName || file.name} appears to provide voice chat. It was left untouched; remove or disable it before enabling Proximity Voice.`
    };
  });
  return matches.filter(Boolean);
}

async function findVoiceModConflicts(paths, descriptorIndex = null) {
  const reserved = BUNDLED_VOICE_FABRIC_SERVER_JAR.toLowerCase();
  const index = descriptorIndex || await getModDescriptorIndex(paths);
  return index.files
    .filter(file => file.name.toLowerCase() !== reserved)
    .map(file => {
      const modId = String(file.descriptor?.fabricModId || '').toLowerCase();
      const identity = `${file.name} ${modId}`;
      if (!/(?:simple[_-]?voice[_-]?chat|voice[_-]?chat|voicechat|plasmo[_-]?voice|plasmovoice|open[_-]?voice)/i.test(identity)) {
        return null;
      }
      const name = modId || file.name.replace(/\.jar$/i, '');
      return {
        file: file.name,
        name: String(name).slice(0, 180),
        message: `${name} appears to provide voice chat. It was left untouched; remove or disable it before enabling Proximity Voice.`
      };
    })
    .filter(Boolean);
}

async function readBundledVoiceRuntimeStatus(paths, adapter = getBundledVoiceAdapterById('bukkit')) {
  const runtimePaths = getBundledVoiceRuntimePaths(paths, adapter);
  try {
    const stat = await fs.stat(runtimePaths.status);
    if (!stat.isFile() || stat.size < 2 || stat.size > MAX_VOICE_STATUS_BYTES) return null;
    const raw = JSON.parse(await fs.readFile(runtimePaths.status, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const state = ['running', 'stopped', 'disabled', 'error'].includes(raw.state) ? raw.state : 'unknown';
    const port = Math.min(65535, Math.max(1, Math.round(Number(raw.port) || DEFAULT_VOICE_UDP_PORT)));
    return {
      state,
      protocolVersion: Math.max(0, Math.round(Number(raw.protocolVersion) || 0)),
      transport: raw.transport === 'udp' ? 'udp' : 'udp',
      udpReachability: raw.udpReachability === 'not-verified' ? 'not-verified' : 'not-verified',
      port,
      voiceRadius: Math.max(0, Number(raw.voiceRadius) || 0),
      sessions: Math.max(0, Math.round(Number(raw.sessions) || 0)),
      associatedClients: Math.max(0, Math.round(Number(raw.associatedClients) || 0)),
      lastError: String(raw.lastError || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 512),
      updatedAt: String(raw.updatedAt || '').trim().slice(0, 48)
    };
  } catch {
    return null;
  }
}

async function readBundledVoiceUdpPort(paths, runtime = null, adapter = getBundledVoiceAdapterById('bukkit')) {
  const runtimeUpdatedAt = Date.parse(runtime?.updatedAt || '');
  const runtimeFresh = Boolean(
    serverState === 'running' && runtime?.state === 'running' && runtime?.port >= 1 && runtime.port <= 65535 &&
    Number.isFinite(runtimeUpdatedAt) && Date.now() - runtimeUpdatedAt >= 0 && Date.now() - runtimeUpdatedAt <= 20_000
  );
  if (runtimeFresh) return runtime.port;
  const runtimePaths = getBundledVoiceRuntimePaths(paths, adapter);
  try {
    const stat = await fs.stat(runtimePaths.config);
    if (!stat.isFile() || stat.size > 64 * 1024) return DEFAULT_VOICE_UDP_PORT;
    const text = await fs.readFile(runtimePaths.config, 'utf8');
    const match = runtimePaths.configFormat === 'properties'
      ? text.match(/^\s*port\s*=\s*(\d{1,5})\s*(?:#.*)?$/mi)
      : text.match(/^\s*port\s*:\s*(\d{1,5})\s*(?:#.*)?$/mi);
    const port = Number(match?.[1]);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_VOICE_UDP_PORT;
  } catch {
    return DEFAULT_VOICE_UDP_PORT;
  }
}

function describeBundledVoiceNetwork({
  installed = false,
  directHostingEnabled = false,
  udpMapped = false,
  udpPort = DEFAULT_VOICE_UDP_PORT,
  mappingError = ''
} = {}) {
  const port = Number.isInteger(Number(udpPort)) && Number(udpPort) >= 1 && Number(udpPort) <= 65535
    ? Number(udpPort)
    : DEFAULT_VOICE_UDP_PORT;
  if (!installed) return { state: 'inactive', notice: '', warning: '' };
  if (udpMapped) {
    return {
      state: 'upnp-mapped',
      notice: `UPnP mapped UDP ${port}; external reachability is not verified.`,
      warning: ''
    };
  }
  const cleanError = String(mappingError || '').replace(/[\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (directHostingEnabled && cleanError) {
    return {
      state: 'upnp-failed',
      notice: `UPnP could not map UDP ${port}; forward it manually for remote voice.`,
      warning: `Automatic UDP ${port} mapping failed: ${cleanError}`
    };
  }
  if (directHostingEnabled) {
    return {
      state: 'upnp-pending',
      notice: `UPnP has not mapped UDP ${port} yet; remote voice may need manual forwarding.`,
      warning: ''
    };
  }
  return {
    state: 'manual',
    notice: `Voice uses UDP ${port}; remote players need separate UDP forwarding. A Minecraft/playit TCP address does not carry voice.`,
    warning: ''
  };
}

function assertServerStoppedForVoiceChanges() {
  if (!isServerStoppedForServerToolChanges()) {
    throw new Error('Stop the Minecraft server before installing or removing Proximity Voice.');
  }
}

async function requireBundledVoiceRuntime() {
  const config = await readConfig();
  const serverType = normalizeServerType(config.serverType);
  const platform = await getServerPlatformStatus(config);
  const minecraftVersion = getBundledVoiceMinecraftVersion(config, platform);
  const adapter = getBundledVoiceAdapter(serverType, minecraftVersion);
  if (!adapter) {
    throw new Error(`Proximity Voice supports Paper, Purpur, Spigot, and Fabric ${BUNDLED_VOICE_CLIENT_MINECRAFT}.`);
  }
  if (!isBundledVoiceRuntimeCompatible(serverType, platform, adapter)) {
    throw new Error(platform.message || `Install a compatible ${serverType} server platform before changing Proximity Voice.`);
  }
  if (!isBundledVoiceClientCompatible(minecraftVersion)) {
    throw new Error(`The bundled Proximity Voice client supports Minecraft ${BUNDLED_VOICE_CLIENT_MINECRAFT} exactly. Install that server version before enabling the full voice bundle.`);
  }
  return { config, serverType, platform, minecraftVersion, adapter };
}

async function getBundledVoiceStatus(pathsOverride = null) {
  const profileAtStart = await getActiveProfile();
  const profileId = profileAtStart?.id || '';
  const paths = pathsOverride || getPathsForProfile(profileAtStart);
  const [config, clientArtifact, metadata] = await Promise.all([
    readJson(paths.config, DEFAULT_CONFIG).then(normalizeServerConfig),
    findBundledVoiceClientArtifact(),
    readServerToolsMetadata(paths)
  ]);
  const serverType = normalizeServerType(config.serverType);
  const platform = await getServerPlatformStatus(config, paths);
  const minecraftVersion = getBundledVoiceMinecraftVersion(config, platform);
  const exactAdapter = getBundledVoiceAdapter(serverType, minecraftVersion);
  const adapter = exactAdapter || (serverType === 'fabric'
    ? getBundledVoiceAdapterById(`fabric-${BUNDLED_VOICE_CLIENT_MINECRAFT}`)
    : ['paper', 'purpur', 'spigot'].includes(serverType) ? getBundledVoiceAdapterById('bukkit') : null);
  const descriptorIndex = adapter?.kind === 'mods'
    ? await getModDescriptorIndex(paths) : await getPluginDescriptorIndex(paths);
  const [artifact, runtime, addonConflicts, dependencyArtifact] = await Promise.all([
    adapter ? findBundledVoiceServerArtifact(adapter) : null,
    adapter ? readBundledVoiceRuntimeStatus(paths, adapter) : null,
    adapter?.kind === 'mods' ? findVoiceModConflicts(paths, descriptorIndex) : findVoicePluginConflicts(paths, descriptorIndex),
    isBundledFabricVoiceAdapter(adapter) ? findBundledVoiceDependencyArtifact(adapter) : null
  ]);
  const dependencyState = adapter
    ? await getBundledVoiceFabricDependencyState(paths, adapter, descriptorIndex)
    : { ready: true, managed: false, file: '', conflict: false, warnings: [] };
  const destination = adapter ? getBundledVoiceServerJarPath(paths, adapter) : '';
  const installed = destination ? await inspectInstalledBundledVoice(destination) : null;
  const classification = classifyBundledVoiceInstall({ artifact, installed, record: metadata.voice, adapter });
  const relayCompatible = isBundledVoiceRuntimeCompatible(serverType, platform, exactAdapter);
  const clientCompatible = isBundledVoiceClientCompatible(minecraftVersion);
  const runtimeCompatible = relayCompatible && clientCompatible;
  const serverStopped = isServerStoppedForServerToolChanges();
  const runtimeUpdatedAt = Date.parse(runtime?.updatedAt || '');
  const runtimeFresh = Boolean(runtime && serverState === 'running' && Number.isFinite(runtimeUpdatedAt) &&
    Date.now() - runtimeUpdatedAt >= 0 && Date.now() - runtimeUpdatedAt <= 20_000);
  const udpPort = await readBundledVoiceUdpPort(paths, runtime, adapter);
  const ownedVoiceLease = getOwnedNatLease(directHostingState, 'voice', profileId);
  const udpMapped = Boolean(
    config.directHostingEnabled && ownedVoiceLease && ownedVoiceLease.port === udpPort
  );
  const voiceMappingError = directHostingState.profileId === profileId
    ? String(directHostingState.voiceMappingError || '')
    : '';
  const voiceNetwork = describeBundledVoiceNetwork({
    installed: classification.managed,
    directHostingEnabled: Boolean(config.directHostingEnabled),
    udpMapped,
    udpPort,
    mappingError: voiceMappingError
  });
  const warnings = addonConflicts.map((entry) => entry.message);
  warnings.push(...dependencyState.warnings);
  if (classification.conflict) {
    warnings.unshift(
      `${adapter?.managedFile || 'The Proximity Voice server JAR'} already exists but is not a verified managed copy. It will not be replaced or removed.`
    );
  }
  if (voiceNetwork.warning) warnings.push(voiceNetwork.warning);
  if (relayCompatible && !platform.verified) {
    warnings.push(`This custom server JAR is not a verified download. Confirm that it is really ${serverType}.`);
  }
  if (relayCompatible && !clientCompatible) {
    warnings.push(`The bundled voice client supports Minecraft ${BUNDLED_VOICE_CLIENT_MINECRAFT} exactly; this server is ${minecraftVersion || 'not pinned to an exact version'}.`);
  }
  if (descriptorIndex.warning) warnings.push(descriptorIndex.warning);

  let message = 'Proximity Voice is ready to install.';
  if (!adapter) {
    message = `Proximity Voice supports Paper, Purpur, Spigot, and Fabric ${BUNDLED_VOICE_CLIENT_MINECRAFT}.`;
  } else if (serverType === 'fabric' && minecraftVersion !== BUNDLED_VOICE_CLIENT_MINECRAFT) {
    message = `Select and install Fabric ${BUNDLED_VOICE_CLIENT_MINECRAFT} to use Proximity Voice.`;
  } else if (!relayCompatible) {
    message = platform.message || `Install a compatible ${serverType} server platform first.`;
  } else if (classification.managed && serverState === 'running') {
    message = describeBundledVoiceRuntime(runtime, runtimeFresh, serverState);
  } else if (!clientCompatible && !classification.managed) {
    message = `Select and install Minecraft ${BUNDLED_VOICE_CLIENT_MINECRAFT} to use the bundled Proximity Voice client.`;
  } else if (!artifact) {
    message = `The bundled Proximity Voice server ${adapter.kind === 'mods' ? 'mod' : 'plugin'} is missing or failed integrity inspection.`;
  } else if (!clientArtifact) {
    message = 'The bundled Proximity Voice client mod is missing or failed integrity inspection.';
  } else if (classification.conflict) {
    message = `${adapter.managedFile} is occupied by an unmanaged JAR.`;
  } else if (addonConflicts.length) {
    message = `Another voice ${adapter.kind === 'mods' ? 'mod' : 'plugin'} is installed. It was left untouched; resolve the conflict before enabling Proximity Voice.`;
  } else if (dependencyState.conflict) {
    message = `Resolve the Fabric API conflict before enabling Proximity Voice.`;
  } else if (isBundledFabricVoiceAdapter(adapter) && !dependencyState.ready && !dependencyArtifact) {
    message = `A compatible Fabric API ${adapter.dependencyVersion} dependency is required.`;
  } else if (classification.updateAvailable && runtimeCompatible) {
    message = 'A Proximity Voice server update is ready.';
  } else if (classification.managed) {
    message = !clientCompatible
      ? `Proximity Voice is installed, but its bundled client supports Minecraft ${BUNDLED_VOICE_CLIENT_MINECRAFT} exactly.`
      : describeBundledVoiceRuntime(runtime, runtimeFresh, serverState);
  } else if (!serverStopped) {
    message = 'Stop the server to install Proximity Voice.';
  }

  return {
    id: 'proximity-voice',
    name: 'Proximity Voice',
    file: classification.installed ? adapter?.managedFile || '' : '',
    profileId,
    adapterId: adapter?.id || '',
    kind: adapter?.kind || (serverType === 'fabric' ? 'mods' : 'plugins'),
    serverType,
    platform,
    minecraftVersion,
    supportedMinecraftVersion: BUNDLED_VOICE_CLIENT_MINECRAFT,
    relayCompatible,
    clientCompatible,
    runtimeCompatible,
    artifactAvailable: Boolean(artifact),
    artifactSha256: artifact?.sha256 || '',
    artifactSize: Number(artifact?.size) || 0,
    clientArtifactAvailable: Boolean(clientArtifact),
    clientFile: clientArtifact ? BUNDLED_VOICE_CLIENT_FILE : '',
    clientSha256: clientArtifact?.sha256 || '',
    clientSize: Number(clientArtifact?.size) || 0,
    clientLoader: 'Fabric',
    clientRequirements: `Minecraft ${BUNDLED_VOICE_CLIENT_MINECRAFT} · Fabric Loader + Fabric API`,
    installed: classification.installed,
    managed: classification.managed,
    integrityVerified: classification.integrityVerified,
    updateAvailable: classification.updateAvailable,
    conflict: classification.conflict,
    conflictScanPartial: descriptorIndex.partial,
    conflictScanWarning: descriptorIndex.warning,
    dependencyReady: dependencyState.ready,
    dependencyManaged: dependencyState.managed,
    dependencyFile: dependencyState.file,
    dependencyConflict: dependencyState.conflict,
    dependencyArtifactAvailable: Boolean(dependencyArtifact),
    serverStopped,
    canInstall: Boolean(serverStopped && runtimeCompatible && artifact && clientArtifact && !descriptorIndex.partial &&
      !classification.conflict && !addonConflicts.length && !dependencyState.conflict &&
      (dependencyState.ready || dependencyArtifact) && (!classification.managed || classification.updateAvailable)),
    canRemove: Boolean(serverStopped && classification.managed),
    installedAt: metadata.voice?.installedAt || '',
    sha256: installed?.sha256 || '',
    pluginConflicts: adapter?.kind === 'plugins' ? addonConflicts : [],
    modConflicts: adapter?.kind === 'mods' ? addonConflicts : [],
    runtime: runtime ? { ...runtime, fresh: runtimeFresh } : null,
    udpPort,
    udpMapped,
    udpMappingState: voiceNetwork.state,
    udpReachability: 'not-verified',
    networkNotice: voiceNetwork.notice,
    warnings,
    message
  };
}

function installBundledVoice() {
  return serverVoiceMutationCoordinator.run('install', async () => {
    assertServerStoppedForVoiceChanges();
    const runtime = await requireBundledVoiceRuntime();
    const adapter = runtime.adapter;
    const profileSnapshot = await captureActiveServerToolProfile('Proximity Voice');
    const paths = profileSnapshot.paths;
    const descriptorIndex = adapter.kind === 'mods'
      ? await getModDescriptorIndex(paths) : await getPluginDescriptorIndex(paths);
    const [artifact, clientArtifact, dependencyArtifact] = await Promise.all([
      findBundledVoiceServerArtifact(adapter),
      findBundledVoiceClientArtifact(),
      findBundledVoiceDependencyArtifact(adapter)
    ]);
    if (!artifact) throw new Error(`The bundled Proximity Voice server ${adapter.kind === 'mods' ? 'mod' : 'plugin'} is missing or failed integrity inspection.`);
    if (!clientArtifact) throw new Error('The bundled Proximity Voice client mod is missing or failed integrity inspection.');
    if (descriptorIndex.partial) throw new Error(`${descriptorIndex.warning} No files were changed.`);
    const conflicts = adapter.kind === 'mods'
      ? await findVoiceModConflicts(paths, descriptorIndex)
      : await findVoicePluginConflicts(paths, descriptorIndex);
    if (conflicts.length) {
      throw new Error(`${conflicts[0].message} No files were changed.`);
    }
    const dependencyState = await getBundledVoiceFabricDependencyState(paths, adapter, descriptorIndex);
    if (dependencyState.conflict) throw new Error(`${dependencyState.warnings[0]} No files were changed.`);
    if (!dependencyState.ready && isBundledFabricVoiceAdapter(adapter) && !dependencyArtifact) {
      throw new Error(`The bundled Fabric API ${adapter.dependencyVersion} dependency is missing or failed integrity inspection.`);
    }
    const destination = getBundledVoiceServerJarPath(paths, adapter);
    const dependencyDestination = getBundledVoiceDependencyPath(paths, adapter);
    const metadata = await readServerToolsMetadata(paths);
    const installed = await inspectInstalledBundledVoice(destination);
    const classification = classifyBundledVoiceInstall({ artifact, installed, record: metadata.voice, adapter });
    if (classification.conflict) {
      throw new Error(
        `${adapter.managedFile} already exists but is not a verified managed copy. ` +
        'It was left untouched. Rename or remove it yourself before installing Proximity Voice.'
      );
    }
    if (classification.managed && !classification.updateAvailable && dependencyState.ready) {
      return { ...(await getBundledVoiceStatus(paths)), changed: false };
    }

    await fs.mkdir(adapter.kind === 'mods' ? paths.mods : paths.plugins, { recursive: true });
    const temporary = `${destination}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const dependencyTemporary = dependencyArtifact && !dependencyState.ready
      ? `${dependencyDestination}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}` : '';
    let dependencyPublished = false;
    let mainPublished = false;
    try {
      const needsMainPublish = !classification.matchesArtifact;
      if (needsMainPublish) {
        await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
        const copied = await inspectAntiCheatJar(temporary);
        if (copied.sha256 !== artifact.sha256 || copied.size !== artifact.size ||
            !inspectionMatchesBundledVoiceAdapter(copied, adapter)) {
          throw new Error(`The bundled Proximity Voice server ${adapter.kind === 'mods' ? 'mod' : 'plugin'} failed its post-copy integrity check.`);
        }
      }
      if (dependencyTemporary) {
        await fs.copyFile(dependencyArtifact.path, dependencyTemporary, fss.constants.COPYFILE_EXCL);
        const copiedDependency = await inspectAntiCheatJar(dependencyTemporary);
        if (copiedDependency.sha256 !== adapter.dependencySha256 ||
            copiedDependency.size !== adapter.dependencySize || !inspectionIsFabricApi(copiedDependency) ||
            !isCompatibleFabricApiVersion(copiedDependency.fabricVersion, adapter.minecraftVersion)) {
          throw new Error('The bundled Fabric API dependency failed its post-copy integrity check.');
        }
      }
      await revalidateServerToolProfile(profileSnapshot, 'Proximity Voice');
      if (dependencyTemporary) {
        try {
          await fs.link(dependencyTemporary, dependencyDestination);
        } catch (error) {
          if (error?.code === 'EEXIST') throw new Error(`${adapter.dependencyFile} appeared during installation. No managed files were replaced.`);
          throw new Error(`Could not publish the Fabric API dependency atomically: ${error?.message || String(error)}`);
        }
        dependencyPublished = true;
        await fs.rm(dependencyTemporary, { force: true });
      }
      await revalidateServerToolProfile(profileSnapshot, 'Proximity Voice');
      if (needsMainPublish && installed) {
        const current = await inspectInstalledBundledVoice(destination);
        if (!current || current.sha256 !== installed.sha256 || !inspectionMatchesBundledVoiceAdapter(current, adapter)) {
          throw new Error(`${adapter.managedFile} changed during installation and was left untouched.`);
        }
        await replaceFileAtomically(temporary, destination, true);
        mainPublished = true;
      } else if (needsMainPublish) {
        try {
          await fs.link(temporary, destination);
        } catch (error) {
          if (error?.code === 'EEXIST') {
            throw new Error(`${adapter.managedFile} appeared during installation and was left untouched.`);
          }
          throw new Error(`Could not publish Proximity Voice atomically: ${error?.message || String(error)}`);
        }
        mainPublished = true;
        await fs.rm(temporary, { force: true });
      }
      const installedAt = new Date().toISOString();
      await writeServerToolsMetadata(paths, {
        ...metadata,
        version: 2,
        voice: {
          ...metadata.voice,
          name: BUNDLED_VOICE_NAME,
          adapterId: adapter.id,
          kind: adapter.kind,
          minecraftVersion: adapter.minecraftVersion,
          file: adapter.managedFile,
          sha256: artifact.sha256,
          size: artifact.size,
          installedAt,
          dependencyFile: dependencyState.file || (dependencyPublished ? adapter.dependencyFile : ''),
          dependencyProvisioned: Boolean(metadata.voice?.dependencyProvisioned || dependencyPublished)
        }
      });
      await upsertInstalledAddonMetadata(paths, {
        kind: adapter.kind,
        file: adapter.managedFile,
        source: 'imported',
        title: 'Proximity Voice',
        author: 'Built in',
        installedAt
      });
      await mapManagedVoiceUdpForDirectHosting(await readBundledVoiceUdpPort(paths, null, adapter));
      cachedStatus = null;
      invalidateCachedWork(`disk-size:${paths.root}`);
      return { ...(await getBundledVoiceStatus(paths)), changed: Boolean(mainPublished || dependencyPublished || !classification.matchesRecord) };
    } catch (error) {
      if (dependencyPublished && !mainPublished) {
        const dependencyNow = await inspectInstalledBundledVoice(dependencyDestination);
        if (dependencyNow?.sha256 === adapter.dependencySha256 && dependencyNow?.size === adapter.dependencySize) {
          await fs.rm(dependencyDestination, { force: true }).catch(() => {});
        }
      }
      throw error;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
      if (dependencyTemporary) await fs.rm(dependencyTemporary, { force: true }).catch(() => {});
    }
  });
}

async function removeBundledVoice(profileSnapshotOverride = null) {
  const capturedProfile = profileSnapshotOverride || await captureActiveServerToolProfile('Proximity Voice');
  return serverVoiceMutationCoordinator.run('remove', async () => {
    const profileSnapshot = capturedProfile;
    const paths = await revalidateServerToolProfile(profileSnapshot, 'Proximity Voice');
    const metadata = await readServerToolsMetadata(paths);
    const config = await readConfig(paths);
    const platform = await getServerPlatformStatus(config, paths);
    const adapter = getBundledVoiceAdapterById(metadata.voice?.adapterId || '') ||
      getBundledVoiceAdapter(config.serverType, getBundledVoiceMinecraftVersion(config, platform));
    if (!adapter) return { ...(await getBundledVoiceStatus(paths)), changed: false };
    const destination = getBundledVoiceServerJarPath(paths, adapter);
    const [artifact, installed] = await Promise.all([
      findBundledVoiceServerArtifact(adapter),
      inspectInstalledBundledVoice(destination)
    ]);
    if (!installed) return { ...(await getBundledVoiceStatus(paths)), changed: false };
    const classification = classifyBundledVoiceInstall({ artifact, installed, record: metadata.voice, adapter });
    if (!classification.managed) {
      throw new Error(`${adapter.managedFile} is not a verified managed copy. It was left untouched.`);
    }

    const current = await inspectInstalledBundledVoice(destination);
    if (!current || current.sha256 !== installed.sha256 || !inspectionMatchesBundledVoiceAdapter(current, adapter)) {
      throw new Error(`${adapter.managedFile} changed before removal and was left untouched.`);
    }
    await revalidateServerToolProfile(profileSnapshot, 'Proximity Voice');
    const voiceUdpPort = await readBundledVoiceUdpPort(paths, await readBundledVoiceRuntimeStatus(paths, adapter), adapter);
    const quarantine = `${destination}.removing-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.rename(destination, quarantine);
    try {
      const moved = await inspectInstalledBundledVoice(quarantine);
      if (!moved || moved.sha256 !== installed.sha256 || !inspectionMatchesBundledVoiceAdapter(moved, adapter)) {
        throw new Error(`The ${adapter.kind === 'mods' ? 'mod' : 'plugin'} changed during removal.`);
      }
      await fs.rm(quarantine);
    } catch (error) {
      await fs.rename(quarantine, destination).catch(() => {});
      throw new Error(`Proximity Voice was not removed safely: ${error?.message || String(error)}`);
    }

    await writeServerToolsMetadata(paths, { ...metadata, version: 2, voice: null });
    await removeInstalledAddonMetadata(paths, adapter.kind, adapter.managedFile);
    let networkCleanupError = '';
    try {
      await unmapManagedVoiceUdp(voiceUdpPort);
    } catch (error) {
      networkCleanupError = String(error?.message || error || 'The UDP mapping could not be removed.').slice(0, 512);
    }
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    const status = await getBundledVoiceStatus(paths);
    if (networkCleanupError) {
      status.message = `Proximity Voice was removed. ${networkCleanupError}`;
      status.networkCleanupError = networkCleanupError;
      status.warnings = [networkCleanupError, ...(status.warnings || [])];
    }
    return {
      ...status,
      changed: true,
      dependencyRetained: Boolean(isBundledFabricVoiceAdapter(adapter) && metadata.voice?.dependencyFile)
    };
  });
}

async function inspectInstalledBundledProtection(file) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    const inspection = await getCachedWork(
      `installed-bundled-ac:${file}:${stat.size}:${stat.mtimeMs}`,
      5 * 60_000,
      () => inspectAntiCheatJar(file)
    );
    return { file, stat, ...inspection };
  } catch {
    return { file, stat, bundledProtectionIdentity: false };
  }
}

async function migrateLegacyBundledProtectionData(paths, options = {}) {
  const legacyDirectory = getLegacyBundledProtectionDataPath(paths);
  if (!await isDirectory(legacyDirectory)) return { migrated: false, files: [] };
  const destinationDirectory = getBundledProtectionDataPath(paths);
  await fs.mkdir(destinationDirectory, { recursive: true });
  const migratedFiles = [];
  const refreshMutable = Boolean(options.refreshMutable);
  const mutableFiles = new Set(['offenses.properties', 'events.jsonl']);
  for (const fileName of ['config.yml', 'access.yml', 'offenses.properties', 'events.jsonl']) {
    const source = path.join(legacyDirectory, fileName);
    const destination = path.join(destinationDirectory, fileName);
    let sourceStat;
    try {
      sourceStat = await fs.stat(source);
    } catch {
      continue;
    }
    if (!sourceStat.isFile()) continue;
    let destinationStat = null;
    try {
      destinationStat = await fs.stat(destination);
    } catch {}
    const replaceExisting = Boolean(
      destinationStat?.isFile() && refreshMutable && mutableFiles.has(fileName) && sourceStat.mtimeMs > destinationStat.mtimeMs
    );
    if (destinationStat?.isFile() && !replaceExisting) continue;
    const temporary = `${destination}.migrate-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      await fs.copyFile(source, temporary, fss.constants.COPYFILE_EXCL);
      if (replaceExisting) {
        await replaceFileAtomically(temporary, destination);
        migratedFiles.push(fileName);
      } else {
        try {
        await fs.copyFile(temporary, destination, fss.constants.COPYFILE_EXCL);
        migratedFiles.push(fileName);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
      }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
  return { migrated: Boolean(migratedFiles.length), files: migratedFiles };
}

async function movePluginJarToDisabledBackup(file) {
  const backup = `${file}.disabled-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.rename(file, backup);
  return backup;
}

async function publishStagedFileIfAbsent(temporary, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    // Both names are in the destination directory, so a hard link publishes the
    // already-verified bytes atomically without ever replacing a raced-in file.
    await fs.link(temporary, destination);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`${path.basename(destination)} changed while installation was committing. It was left untouched.`);
    }
    throw error;
  }
  await fs.rm(temporary, { force: true }).catch(() => {});
}

async function restoreDisabledPluginJar(backup, destination) {
  if (!backup || await isRegularFile(destination)) return false;
  try {
    await fs.rename(backup, destination);
    return true;
  } catch {
    return false;
  }
}

async function disableLegacyBundledProtectionJar(paths, metadata = {}) {
  const { legacy } = getBundledProtectionJarPaths(paths);
  const installed = await inspectInstalledBundledProtection(legacy);
  if (!installed) return { disabled: false, backup: '' };
  const record = readBundledProtectionMetadataRecord(metadata, getBundledProtectionAdapterById('bukkit'));
  const expectedHash = normalizeExpectedHashes({ sha256: record.sha256 }).sha256 || '';
  const recordedLegacy = path.basename(String(record.file || '')) === LEGACY_BUNDLED_PROTECTION_JAR;
  const recordedHashMatches = Boolean(recordedLegacy && expectedHash && installed.sha256 === expectedHash);
  if (!installed.bundledProtectionIdentity && !recordedHashMatches) {
    throw new Error(
      `A file named ${LEGACY_BUNDLED_PROTECTION_JAR} is present, but it is not a verified managed protection plugin. ` +
      'It was left untouched. Rename or remove it before installing Server Protection.'
    );
  }
  return { disabled: true, backup: await movePluginJarToDisabledBackup(legacy) };
}

async function assertCurrentBundledProtectionJarIsReplaceable(paths, metadata = {}) {
  const { current } = getBundledProtectionJarPaths(paths);
  const installed = await inspectInstalledBundledProtection(current);
  if (!installed) return null;
  const record = readBundledProtectionMetadataRecord(metadata, getBundledProtectionAdapterById('bukkit'));
  const expectedHash = normalizeExpectedHashes({ sha256: record.sha256 }).sha256 || '';
  const recordedCurrent = path.basename(String(record.file || '')) === BUNDLED_PROTECTION_JAR;
  const recordedHashMatches = Boolean(recordedCurrent && expectedHash && installed.sha256 === expectedHash);
  if (!installed.bundledProtectionIdentity && !recordedHashMatches) {
    throw new Error(
      `A file named ${BUNDLED_PROTECTION_JAR} is already present, but it is not a verified managed protection plugin. ` +
      'It was left untouched. Rename it before installing Server Protection.'
    );
  }
  return installed;
}

async function assertBundledProtectionTargetIsReplaceable(file, adapter, record = {}) {
  const installed = await inspectInstalledBundledProtection(file);
  if (!installed) return null;
  const expectedHash = normalizeExpectedHashes({ sha256: record.sha256 }).sha256 || '';
  const recorded = path.basename(String(record.file || '')) === path.basename(file);
  const recordedHashMatches = Boolean(recorded && expectedHash && installed.sha256 === expectedHash);
  if (!inspectionMatchesBundledProtectionAdapter(installed, adapter) && !recordedHashMatches) {
    throw new Error(
      `${path.basename(file)} already exists but is not a verified managed ${adapter.kind === 'mods' ? 'mod' : 'plugin'}. ` +
      'It was left untouched. Rename or remove it before installing Server Protection.'
    );
  }
  return installed;
}

function isBundledProtectionRuntimeCompatible(serverType, platform, adapter = null) {
  if (!adapter || !isProtectionRuntimeReady(platform)) return false;
  const type = normalizeServerType(serverType);
  if (!adapter.serverTypes.includes(type)) return false;
  if (isBundledFabricProtectionAdapter(adapter)) {
    return normalizeAddonVersion(platform?.minecraftVersion) === adapter.minecraftVersion;
  }
  return true;
}

async function getBundledAntiCheatStatus(paths = null, protectionConfig = null) {
  const resolvedPaths = paths || await getPaths();
  const config = protectionConfig || await getProtectionConfig(resolvedPaths);
  const serverConfig = await readJson(resolvedPaths.config, DEFAULT_CONFIG);
  const serverType = normalizeServerType(serverConfig.serverType);
  const platform = await getServerPlatformStatus(serverConfig, resolvedPaths);
  const exactAdapter = getBundledProtectionAdapter(serverType, platform.minecraftVersion || serverConfig.serverVersion);
  const adapter = exactAdapter || (serverType === 'fabric'
    ? getBundledProtectionAdapterById(`fabric-${FABRIC_PROTECTION_MINECRAFT_VERSION}`) : null);
  const runtimeCompatible = isBundledProtectionRuntimeCompatible(serverType, platform, exactAdapter);
  const metadata = await readSecurityMetadata(resolvedPaths);
  const record = adapter ? readBundledProtectionMetadataRecord(metadata, adapter) : {};
  const targets = adapter ? getBundledProtectionJarPaths(resolvedPaths, adapter) : { current: '', legacy: '', fabricApi: '' };
  const [currentInstall, legacyInstall] = await Promise.all([
    targets.current ? inspectInstalledBundledProtection(targets.current) : null,
    targets.legacy ? inspectInstalledBundledProtection(targets.legacy) : null
  ]);
  const recognizedCurrent = Boolean(currentInstall && inspectionMatchesBundledProtectionAdapter(currentInstall, adapter));
  const recognizedLegacy = Boolean(adapter?.id === 'bukkit' && legacyInstall?.bundledProtectionIdentity);
  const selectedInstall = recognizedCurrent ? currentInstall : (recognizedLegacy ? legacyInstall : null);
  const installed = Boolean(selectedInstall);
  const targetCollision = Boolean(currentInstall && !recognizedCurrent);
  const legacyConflict = Boolean(recognizedCurrent && legacyInstall);
  const unverifiedLegacyPresent = Boolean(legacyInstall && !recognizedLegacy);
  const pin = adapter ? getBundledProtectionReleasePin(adapter) : { sha256: '', size: 0 };
  const expectedHash = pin.sha256;
  const integrityVerified = Boolean(installed && selectedInstall.sha256 === pin.sha256 && selectedInstall.size === pin.size);
  const artifact = adapter ? await findBundledAntiCheatArtifact(adapter) : null;
  const updateAvailable = Boolean(installed && artifact?.sha256 && selectedInstall.sha256 !== artifact.sha256);
  const installedTimestamp = Date.parse(record.installedAt || '') || selectedInstall?.stat?.mtimeMs || Infinity;
  const loadedBeforeStart = Boolean(serverStartedAt && installedTimestamp <= serverStartedAt);
  const legacyInstallation = Boolean(installed && targets.legacy && selectedInstall.file === targets.legacy);
  let dependencyReady = !isBundledFabricProtectionAdapter(adapter);
  let dependencyManaged = false;
  let dependencyFile = '';
  let dependencyConflict = false;
  let descriptorScanPartial = false;
  let descriptorScanWarning = '';
  if (isBundledFabricProtectionAdapter(adapter)) {
    const [apiInstall, identities] = await Promise.all([
      inspectInstalledBundledProtection(targets.fabricApi),
      findManagedFabricIdentityConflicts(
        resolvedPaths, [adapter.managedFile, adapter.fabricApiFile], adapter.minecraftVersion)
    ]);
    const targetApiCompatible = Boolean(apiInstall && inspectionIsFabricApi(apiInstall) &&
      isCompatibleFabricApiVersion(apiInstall.fabricVersion, adapter.minecraftVersion));
    const targetApiManaged = Boolean(targetApiCompatible && apiInstall.sha256 === adapter.fabricApiSha256 &&
      apiInstall.size === adapter.fabricApiSize);
    const externalApis = identities.compatibleFabricApis || [];
    dependencyConflict = Boolean((apiInstall && !targetApiCompatible) || identities.conflicts.length || externalApis.length > 1 ||
      (targetApiCompatible && externalApis.length));
    descriptorScanPartial = Boolean(identities.partial);
    descriptorScanWarning = identities.warning || '';
    dependencyReady = Boolean(!dependencyConflict && !descriptorScanPartial &&
      (targetApiCompatible || externalApis.length === 1));
    dependencyManaged = targetApiManaged;
    dependencyFile = targetApiCompatible ? path.basename(targets.fabricApi) : (externalApis[0]?.file || '');
  }
  const operational = Boolean(installed && integrityVerified && dependencyReady && runtimeCompatible &&
    config.enabled && config.layers.builtIn);
  const ready = Boolean(operational && !legacyInstallation && !legacyConflict && !targetCollision && !updateAvailable);
  let message;
  if (!adapter) {
    message = 'This server runtime has baseline hardening only. Choose a supported Paper-family or Fabric runtime for bundled event checks.';
  } else if (serverType === 'fabric' && !exactAdapter) {
    message = `Bundled Fabric protection currently supports Minecraft ${FABRIC_PROTECTION_MINECRAFT_VERSIONS.join(' or ')} exactly. Select a supported version or import a matching adapter.`;
  } else if (targetCollision) {
    message = `${path.basename(targets.current)} exists but does not match the managed Server Protection identity. It was left untouched.`;
  } else if (dependencyConflict) {
    message = 'Fabric has a conflicting Server Protection or Fabric API mod identity, or a standalone Anti-Xray provider. Remove the duplicate or incompatible mod before installing protection.';
  } else if (descriptorScanPartial) {
    message = descriptorScanWarning || 'The mods folder could not be checked completely for duplicate protection dependencies.';
  } else if (isBundledFabricProtectionAdapter(adapter) && installed && !dependencyReady) {
    message = `Server Protection is present, but a compatible Fabric API for Minecraft ${adapter.minecraftVersion} is missing.`;
  } else if (legacyConflict) {
    message = `Both ${BUNDLED_PROTECTION_JAR} and the legacy protection JAR are present. Reinstall protection to disable the legacy copy safely.`;
  } else if (installed && selectedInstall.file === targets.legacy) {
    message = integrityVerified
      ? 'A legacy protection install is active. Reinstall Server Protection to migrate it safely.'
      : 'A legacy protection install was found but could not be integrity-verified.';
  } else if (updateAvailable) {
    message = 'A Server Protection update is ready. Install it to use the newest protection settings.';
  } else if (installed) {
    message = !runtimeCompatible
      ? `The installed Server Protection ${adapter.kind === 'mods' ? 'mod' : 'plugin'} does not match the selected verified runtime.`
      : integrityVerified
        ? 'Server Protection is installed.'
        : 'The installed Server Protection file could not be integrity-verified.';
  } else if (unverifiedLegacyPresent) {
    message = `A legacy-named protection JAR is present but could not be verified. It was left untouched.`;
  } else {
    message = artifact ? 'Server Protection is ready to install.' : 'The matching bundled Server Protection artifact is not included in this build.';
  }
  const runtime = getCurrentProtectionRuntimeStatus(adapter);
  const runtimeActive = Boolean(operational && loadedBeforeStart && isServerRuntimeReady() && runtime?.active);
  const visibilityRestartRequired = Boolean(
    serverProcess && installed && (updateAvailable || !loadedBeforeStart)
  );
  if (visibilityRestartRequired) {
    message = 'Update and restart required. The running Server Protection adapter may still use the retired player-hiding behavior until the verified update is installed and the server is restarted.';
  } else if (operational && serverProcess) {
    if (!loadedBeforeStart) {
      message = 'Server Protection changed after this server started. Restart the server to load the verified adapter.';
    } else if (!runtime) {
      message = 'The running server has not been matched to the selected Server Protection adapter.';
    } else if (runtime.startupFailure) {
      message = runtime.startupFailure.message;
    } else if (runtime.phase === 'starting') {
      message = 'Waiting for Server Protection to confirm that its runtime checks loaded.';
    } else if (runtime.active && runtime.startupWarning) {
      message = `Server Protection is active with a warning: ${runtime.startupWarning.message}`;
    } else if (runtime.active) {
      message = runtime.observedCheckCount === null
        ? 'Server Protection confirmed that its runtime checks are active.'
        : `Server Protection confirmed ${runtime.observedCheckCount} active runtime checks.`;
    }
  }
  return {
    adapterId: adapter?.id || '',
    kind: adapter?.kind || '',
    minecraftVersion: platform.minecraftVersion || normalizeAddonVersion(serverConfig.serverVersion),
    versionSupported: Boolean(exactAdapter),
    supportedMinecraftVersions: serverType === 'fabric' ? [...FABRIC_PROTECTION_MINECRAFT_VERSIONS] : [],
    installed,
    ready,
    active: runtimeActive,
    enabled: Boolean(config.enabled && config.layers.builtIn),
    runtimeCompatible,
    serverType,
    integrityVerified,
    artifactAvailable: Boolean(artifact),
    updateAvailable,
    visibilityRestartRequired,
    file: installed ? path.basename(selectedInstall.file) : '',
    legacyInstallation,
    legacyConflict,
    unverifiedLegacyPresent,
    targetCollision,
    dependencyReady,
    dependencyManaged,
    dependencyFile,
    dependencyConflict,
    antiXrayProviderId: isBundledFabricProtectionAdapter(adapter) ? adapter.antiXrayProviderId : '',
    antiXrayProviderVersion: isBundledFabricProtectionAdapter(adapter) ? adapter.antiXrayProviderVersion : '',
    antiXrayNestedFile: isBundledFabricProtectionAdapter(adapter) ? adapter.antiXrayNestedFile : '',
    descriptorScanPartial,
    installedAt: record.installedAt || '',
    sha256: expectedHash,
    runtime,
    message
  };
}

function assessManagedBundledProtectionRefresh({ adapter, record, installed, artifact } = {}) {
  if (!isBundledFabricProtectionAdapter(adapter)) {
    return { eligible: false, reason: 'unsupported-adapter' };
  }
  if (!installed) return { eligible: false, reason: 'not-installed' };
  if (!artifact) return { eligible: false, reason: 'artifact-unavailable' };
  if (!inspectionMatchesBundledProtectionAdapter(installed, adapter)) {
    return { eligible: false, reason: 'identity-mismatch' };
  }
  if (installed.sha256 === artifact.sha256 && installed.size === artifact.size) {
    return { eligible: false, reason: 'current' };
  }

  const expectedHash = normalizeExpectedHashes({ sha256: record?.sha256 }).sha256 || '';
  const recordedFile = String(record?.file || '');
  const recordedSize = Number(record?.size) || 0;
  const recordMatchesAdapter = record?.adapterId === adapter.id &&
    record?.kind === adapter.kind &&
    normalizeServerType(record?.serverType) === 'fabric' &&
    normalizeAddonVersion(record?.minecraftVersion) === adapter.minecraftVersion &&
    recordedFile === path.basename(recordedFile) &&
    recordedFile === adapter.managedFile;
  if (!recordMatchesAdapter || !expectedHash) {
    return { eligible: false, reason: 'unmanaged' };
  }
  if (installed.sha256 !== expectedHash || (recordedSize > 0 && installed.size !== recordedSize)) {
    return { eligible: false, reason: 'modified' };
  }
  return { eligible: true, reason: 'managed-update' };
}

async function refreshManagedBundledProtectionBeforeStartUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot;
  const paths = context.paths || profileSnapshot?.paths;
  const serverConfig = context.serverConfig;
  const platform = context.platform;
  const revalidate = context.revalidate;
  if (!profileSnapshot?.profileId || !paths || !serverConfig || !platform || typeof revalidate !== 'function') {
    throw new Error('Server Protection update did not receive a verified startup context.');
  }
  const serverType = normalizeServerType(serverConfig.serverType);
  if (['paper', 'purpur'].includes(serverType)) {
    await revalidate();
    const adapter = getBundledProtectionAdapter(
      serverType,
      platform.minecraftVersion || serverConfig.serverVersion
    );
    let managedProtectionConfigRefreshed = false;
    if (adapter?.id === 'bukkit') {
      const targets = getBundledProtectionJarPaths(paths, adapter);
      if (await isRegularFile(targets.current) || await isRegularFile(targets.legacy)) {
        // Normalize the manager-owned config before Bukkit loads it. In particular, older
        // profiles may still contain entityEsp.enabled=true; the retired visibility layer must
        // never hide PvP players or nametags on the next start.
        const protectionConfig = await getProtectionConfig(paths);
        await writeBundledProtectionConfig(paths, protectionConfig, adapter);
        managedProtectionConfigRefreshed = true;
      }
    }
    await revalidate();
    const migration = await migrateManagedPaperAntiXrayConfigsBeforeStart(paths, serverConfig);
    await revalidate();
    if (migration.migratedConfigs.length) {
      appendServerLog(
        `[Server Protection] Raised managed Paper Anti-Xray coverage to Y=${PAPER_ANTI_XRAY_MAX_BLOCK_HEIGHT} ` +
        `in ${migration.migratedConfigs.length} config file${migration.migratedConfigs.length === 1 ? '' : 's'} before startup.\n`
      );
    }
    if (migration.skippedConfigs.length) {
      appendServerLog(
        `[Server Protection] Skipped ${migration.skippedConfigs.length} unsafe or unreadable Paper Anti-Xray ` +
        `config file${migration.skippedConfigs.length === 1 ? '' : 's'} during the managed height migration.\n`
      );
    }
    return {
      checked: migration.checked,
      updated: false,
      configMigrated: migration.migratedConfigs.length > 0,
      managedProtectionConfigRefreshed,
      migratedConfigs: migration.migratedConfigs,
      skippedConfigs: migration.skippedConfigs,
      reason: migration.reason
    };
  }
  if (serverType !== 'fabric') return { checked: false, updated: false, reason: 'not-fabric' };

  const adapter = getBundledProtectionAdapter(
    serverType,
    platform.minecraftVersion || serverConfig.serverVersion
  );
  if (!adapter || !isBundledProtectionRuntimeCompatible(serverType, platform, adapter)) {
    return { checked: true, updated: false, reason: 'unsupported-runtime' };
  }

  const targets = getBundledProtectionJarPaths(paths, adapter);
  const [installed, artifact, metadata] = await Promise.all([
    inspectInstalledBundledProtection(targets.current),
    findBundledAntiCheatArtifact(adapter),
    readSecurityMetadata(paths)
  ]);
  const record = readBundledProtectionMetadataRecord(metadata, adapter);
  const assessment = assessManagedBundledProtectionRefresh({ adapter, record, installed, artifact });
  if (!assessment.eligible) {
    if (assessment.reason === 'current') {
      await revalidate();
      const protectionConfig = await getProtectionConfig(paths);
      await writeFabricPacketAntiXrayConfig(
        paths,
        Boolean(protectionConfig.enabled && protectionConfig.layers.builtIn && protectionConfig.layers.antiXray)
      );
      await revalidate();
      return { checked: true, updated: false, configMigrated: true, reason: assessment.reason };
    }
    if (['identity-mismatch', 'unmanaged', 'modified'].includes(assessment.reason)) {
      appendServerLog(
        `[Server Protection] Automatic Fabric protection update skipped (${assessment.reason}). ` +
        'The existing mod was left untouched; use the Protection page to review it.\n'
      );
    }
    return { checked: true, updated: false, reason: assessment.reason };
  }

  await revalidate();
  appendServerLog(
    `[Server Protection] Updating the verified managed Fabric ${adapter.minecraftVersion} protection mod before startup.\n`
  );
  const result = await installBundledAntiCheatUnlocked({
    profileSnapshot,
    paths,
    serverConfig,
    platform,
    revalidate,
    expectedInstalled: Object.freeze({ sha256: installed.sha256, size: installed.size })
  });
  if (!result?.installed) {
    throw new Error(result?.message || 'The managed Fabric protection update could not be installed.');
  }
  appendServerLog(
    `[Server Protection] Updated the managed Fabric protection mod with packet Anti-Xray ${adapter.antiXrayProviderVersion}.\n`
  );
  return { checked: true, updated: true, reason: 'updated', result };
}

function installBundledAntiCheat() {
  return serverToolMutationCoordinator.run('protection:install', installBundledAntiCheatUnlocked);
}

async function installBundledAntiCheatUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot || await captureActiveServerToolProfile('Server Protection');
  const paths = context.paths || profileSnapshot.paths;
  return serializeProtectionStateTransaction(paths.root, () => installBundledAntiCheatTransactionUnlocked({
    ...context,
    profileSnapshot,
    paths
  }));
}

async function installBundledAntiCheatTransactionUnlocked(context = {}) {
  const profileSnapshot = context.profileSnapshot;
  const paths = context.paths;
  const revalidate = typeof context.revalidate === 'function'
    ? context.revalidate
    : () => revalidateServerToolProfile(profileSnapshot, 'Server Protection');
  const serverConfig = context.serverConfig || await readConfig(paths);
  await revalidate();
  const serverType = normalizeServerType(serverConfig.serverType);
  const platform = context.platform || await getServerPlatformStatus(serverConfig, paths);
  const adapter = getBundledProtectionAdapter(serverType, platform.minecraftVersion || serverConfig.serverVersion);
  if (!adapter) {
    return {
      installed: false, ready: false, reason: 'runtime', restartRequired: false,
      message: serverType === 'fabric'
        ? `Bundled Fabric protection supports Minecraft ${FABRIC_PROTECTION_MINECRAFT_VERSIONS.join(' or ')} exactly. Install a supported Fabric version first.`
        : 'Server Protection needs Paper, Purpur, Spigot, or the supported Fabric runtime.'
    };
  }
  if (!isBundledProtectionRuntimeCompatible(serverType, platform, adapter)) {
    return {
      installed: false, ready: false, reason: 'runtime', restartRequired: false,
      message: platform.message || 'Install a verified server runtime matching this protection adapter first.'
    };
  }
  const artifact = await findBundledAntiCheatArtifact(adapter);
  if (!artifact) {
    return {
      installed: false, ready: false, reason: 'artifact', restartRequired: false,
      message: 'The matching pinned Server Protection artifact is not included in this build.'
    };
  }
  const fabricApiArtifact = isBundledFabricProtectionAdapter(adapter)
    ? await findBundledFabricApiArtifact(adapter) : null;
  if (isBundledFabricProtectionAdapter(adapter) && !fabricApiArtifact) {
    return {
      installed: false, ready: false, reason: 'artifact', restartRequired: false,
      message: 'The pinned Fabric API dependency is not included in this build.'
    };
  }
  const protectionConfig = await getProtectionConfig(paths);
  const before = await getBundledAntiCheatStatus(paths, protectionConfig);
  const targets = getBundledProtectionJarPaths(paths, adapter);
  const destination = targets.current;
  const legacyDestination = targets.legacy;
  const temporary = `${destination}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const apiTemporary = targets.fabricApi
    ? `${targets.fabricApi}.install-${process.pid}-${crypto.randomBytes(4).toString('hex')}` : '';
  try {
    await revalidate();
    await fs.mkdir(adapter.kind === 'mods' ? paths.mods : paths.plugins, { recursive: true });
    const destinationMatches = await fileMatchesExpectedHash(destination, { sha256: artifact.sha256 });
    if (!destinationMatches) {
      await fs.copyFile(artifact.path, temporary, fss.constants.COPYFILE_EXCL);
      const inspection = await inspectAntiCheatJar(temporary);
      if (inspection.sha256 !== artifact.sha256 || inspection.size !== artifact.size ||
          !inspectionMatchesBundledProtectionAdapter(inspection, adapter)) {
        throw new Error('The bundled Server Protection artifact failed its post-copy integrity check.');
      }
    }
    const metadata = await readSecurityMetadata(paths);
    const record = readBundledProtectionMetadataRecord(metadata, adapter);
    const expectedDestination = !destinationMatches
      ? await assertBundledProtectionTargetIsReplaceable(destination, adapter, record)
      : null;
    let installFabricApi = false;
    let fabricApiFile = '';
    if (isBundledFabricProtectionAdapter(adapter)) {
      const identities = await findManagedFabricIdentityConflicts(
        paths, [adapter.managedFile, adapter.fabricApiFile], adapter.minecraftVersion);
      if (identities.partial) throw new Error(identities.warning || 'The mods folder could not be checked completely for duplicate identities.');
      if (identities.conflicts.length || identities.compatibleFabricApis.length > 1) {
        throw new Error('A conflicting Server Protection or Fabric API identity, or a standalone Anti-Xray provider, is already present in the mods folder.');
      }
      const installedApi = await inspectInstalledBundledProtection(targets.fabricApi);
      if (installedApi) {
        if (!inspectionIsFabricApi(installedApi) ||
            !isCompatibleFabricApiVersion(installedApi.fabricVersion, adapter.minecraftVersion)) {
          throw new Error(`${path.basename(targets.fabricApi)} exists but is not a compatible Fabric API ${adapter.minecraftVersion} mod. It was left untouched.`);
        }
        fabricApiFile = path.basename(targets.fabricApi);
      } else if (identities.compatibleFabricApis.length === 1) {
        fabricApiFile = identities.compatibleFabricApis[0].file;
      } else {
        installFabricApi = true;
        await fs.copyFile(fabricApiArtifact.path, apiTemporary, fss.constants.COPYFILE_EXCL);
        const copiedApi = await inspectAntiCheatJar(apiTemporary);
        if (copiedApi.sha256 !== fabricApiArtifact.sha256 || copiedApi.size !== fabricApiArtifact.size ||
            !inspectionIsFabricApi(copiedApi) ||
            !isCompatibleFabricApiVersion(copiedApi.fabricVersion, adapter.minecraftVersion)) {
          throw new Error('The bundled Fabric API dependency failed its post-copy integrity check.');
        }
        fabricApiFile = path.basename(targets.fabricApi);
      }
    }
    await revalidate();
    if (context.expectedInstalled) {
      const latestInstalled = await inspectInstalledBundledProtection(destination);
      const expectedInstalledHash = normalizeExpectedHashes({ sha256: context.expectedInstalled.sha256 }).sha256 || '';
      if (!latestInstalled || !expectedInstalledHash ||
          latestInstalled.sha256 !== expectedInstalledHash ||
          latestInstalled.size !== Number(context.expectedInstalled.size) ||
          !inspectionMatchesBundledProtectionAdapter(latestInstalled, adapter)) {
        throw new Error('The managed Server Protection file changed while its update was being prepared. It was left untouched.');
      }
    }
    if (adapter.id === 'bukkit') await migrateLegacyBundledProtectionData(paths);
    const playerAccess = await readPlayerAccess(paths);
    const runtimeFiles = new Set([
      getBundledProtectionConfigPath(paths, adapter),
      getBundledAccessConfigPath(paths, adapter),
      paths.security
    ]);
    if (isBundledFabricProtectionAdapter(adapter)) runtimeFiles.add(paths.fabricAntiXrayConfig);
    if (adapter.id === 'bukkit') {
      runtimeFiles.add(getLegacyBundledProtectionConfigPath(paths));
      runtimeFiles.add(getLegacyBundledAccessConfigPath(paths));
    }
    const runtimeFileSnapshots = await Promise.all(
      [...runtimeFiles].map((file) => captureSmallFileSnapshot(file))
    );
    let destinationBackup = '';
    let legacyBackup = '';
    let copied = false;
    let apiCopied = false;
    let committed = false;
    await revalidate();
    try {
      const destinationExists = !destinationMatches && await isRegularFile(destination);
      if (context.expectedInstalled && !destinationExists) {
        throw new Error('The managed Server Protection file disappeared while its update was committing. Nothing was replaced.');
      }
      await revalidate();
      if (destinationExists) {
        destinationBackup = await movePluginJarToDisabledBackup(destination);
        const claimedDestination = await inspectInstalledBundledProtection(destinationBackup);
        if (!claimedDestination || !expectedDestination ||
            claimedDestination.sha256 !== expectedDestination.sha256 ||
            claimedDestination.size !== expectedDestination.size ||
            (context.expectedInstalled && !inspectionMatchesBundledProtectionAdapter(claimedDestination, adapter))) {
          throw new Error('The Server Protection file changed before it could be claimed for update. The previous file will be restored.');
        }
        await revalidate();
      }
      if (adapter.id === 'bukkit') {
        const disabledLegacy = await disableLegacyBundledProtectionJar(paths, metadata);
        legacyBackup = disabledLegacy.backup;
      }
      await revalidate();
      if (installFabricApi) {
        await publishStagedFileIfAbsent(apiTemporary, targets.fabricApi);
        apiCopied = true;
        await revalidate();
      }
      if (!destinationMatches) {
        await publishStagedFileIfAbsent(temporary, destination);
        copied = true;
      }
      await revalidate();
      invalidateCachedWork('bundled-ac:');
      invalidateCachedWork('installed-bundled-ac:');
      const published = await inspectInstalledBundledProtection(destination);
      if (!published || published.sha256 !== artifact.sha256 || published.size !== artifact.size ||
          !inspectionMatchesBundledProtectionAdapter(published, adapter)) {
        throw new Error('The published Server Protection artifact failed its final integrity check.');
      }
      await writeBundledProtectionConfig(paths, protectionConfig, adapter);
      await writeBundledAccessConfig(paths, playerAccess, adapter);
      const installationChanged = Boolean(copied || apiCopied || legacyBackup || before.file !== path.basename(destination));
      const installedAt = installationChanged ? new Date().toISOString() : (record.installedAt || new Date().toISOString());
      await writeSecurityMetadata(paths, withBundledProtectionMetadataRecord(metadata, adapter, {
        ...record,
        schema: 1,
        name: 'Server Protection',
        adapterId: adapter.id,
        serverType,
        minecraftVersion: adapter.minecraftVersion,
        kind: adapter.kind,
        file: path.basename(destination),
        sha256: artifact.sha256,
        size: artifact.size,
        installedAt,
        fabricApiFile: fabricApiFile || record.fabricApiFile || undefined,
        fabricApiSha256: apiCopied ? fabricApiArtifact.sha256 : record.fabricApiSha256,
        fabricApiSize: apiCopied ? fabricApiArtifact.size : record.fabricApiSize,
        migratedLegacyJar: legacyBackup ? path.basename(legacyBackup) : record.migratedLegacyJar,
        replacedJar: destinationBackup ? path.basename(destinationBackup) : record.replacedJar
      }));
      committed = true;
    } catch (error) {
      const rollbackErrors = [];
      if (copied) {
        try {
          const current = await inspectInstalledBundledProtection(destination);
          if (!current || current.sha256 !== artifact.sha256 || current.size !== artifact.size) {
            throw new Error('published protection JAR changed before rollback');
          }
          await fs.rm(destination, { force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (apiCopied) {
        try {
          const currentApi = await inspectInstalledBundledProtection(targets.fabricApi);
          if (!currentApi || currentApi.sha256 !== fabricApiArtifact.sha256 || currentApi.size !== fabricApiArtifact.size) {
            throw new Error('published Fabric API JAR changed before rollback');
          }
          await fs.rm(targets.fabricApi, { force: true });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      try {
        if (destinationBackup && !await restoreDisabledPluginJar(destinationBackup, destination)) {
          throw new Error('could not restore the previous protection JAR');
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      try {
        if (legacyDestination && legacyBackup && !await restoreDisabledPluginJar(legacyBackup, legacyDestination)) {
          throw new Error('could not restore the previous legacy protection JAR');
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
      for (const snapshot of [...runtimeFileSnapshots].reverse()) {
        try {
          await restoreSmallFileSnapshot(snapshot);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      invalidateCachedWork('bundled-ac:');
      invalidateCachedWork('installed-bundled-ac:');
      if (rollbackErrors.length) {
        throw new Error(
          `${error?.message || String(error)} Rollback was incomplete: ` +
          rollbackErrors.map((entry) => entry?.message || String(entry)).join('; ')
        );
      }
      throw error;
    }
    if (!committed) throw new Error('Server Protection installation did not commit.');
    cachedStatus = null;
    invalidateCachedWork('bundled-ac:');
    invalidateCachedWork('installed-bundled-ac:');
    invalidateCachedWork(`disk-size:${paths.root}`);
    const status = await getBundledAntiCheatStatus(paths, protectionConfig);
    return {
      installed: status.installed,
      ready: status.ready,
      restartRequired: false,
      appliedLive: false,
      file: status.file,
      message: status.message
    };
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    if (apiTemporary) await fs.rm(apiTemporary, { force: true }).catch(() => {});
  }
}

function removeLegacyProtection() {
  return serverToolMutationCoordinator.run('protection:remove-legacy', removeLegacyProtectionUnlocked);
}

async function removeLegacyProtectionUnlocked() {
  const profileSnapshot = await captureActiveServerToolProfile('legacy Server Protection files');
  const paths = profileSnapshot.paths;
  return serializeProtectionStateTransaction(paths.root, () => {
    return removeLegacyProtectionTransactionUnlocked(profileSnapshot, paths);
  });
}

async function removeLegacyProtectionTransactionUnlocked(profileSnapshot, paths) {
  const metadata = await readSecurityMetadata(paths);
  const allRecords = Array.isArray(metadata.antiCheat?.installedFiles) ? metadata.antiCheat.installedFiles : [];
  const records = allRecords.filter(isRecordedLegacyProtectionInstall);
  const remaining = allRecords.filter((record) => !isRecordedLegacyProtectionInstall(record));
  const removed = [];
  const warnings = [];
  await revalidateServerToolProfile(profileSnapshot, 'legacy Server Protection files');
  for (const record of records) {
    const targetDir = record.kind === 'plugins' ? paths.plugins : paths.mods;
    if (path.basename(String(record.file || '')) !== record.file || !/\.jar$/i.test(record.file)) {
      remaining.push(record);
      warnings.push('A recorded legacy protection path was unsafe and was left untouched.');
      continue;
    }
    let file;
    try {
      file = resolveContainedPath(targetDir, path.join(targetDir, record.file));
    } catch {
      remaining.push(record);
      warnings.push(`${record.file} was outside the managed server folder and was left untouched.`);
      continue;
    }
    let exists = false;
    try {
      exists = (await fs.stat(file)).isFile();
    } catch {}
    if (!exists) continue;
    const expectedHashes = normalizeExpectedHashes(record.expectedHashes);
    if (!Object.keys(expectedHashes).length || !await fileMatchesExpectedHash(file, expectedHashes)) {
      remaining.push(record);
      warnings.push(`${record.file} changed after installation and was left in place.`);
      continue;
    }
    await revalidateServerToolProfile(profileSnapshot, 'legacy Server Protection files');
    await fs.rm(file, { force: true });
    removed.push(record.file);
  }
  await writeSecurityMetadata(paths, {
    ...metadata,
    antiCheat: {
      ...(metadata.antiCheat || {}),
      enabled: false,
      installedFiles: remaining,
      ...(removed.length ? { removedAt: new Date().toISOString() } : {})
    }
  });
  cachedStatus = null;
  invalidateCachedWork(`disk-size:${paths.root}`);
  return { removed, warnings, restartRequired: false };
}

const PAPER_ANTI_XRAY_MAX_BLOCK_HEIGHT = 320;
const MAX_PAPER_WORLD_CONFIG_DISCOVERY_DIRECTORIES = 512;

function migratePaperAntiXrayMaxBlockHeight(source) {
  const original = String(source || '');
  const lines = [];
  const endings = [];
  let cursor = 0;
  const lineBreak = /\r\n|\n|\r/g;
  for (let match = lineBreak.exec(original); match; match = lineBreak.exec(original)) {
    lines.push(original.slice(cursor, match.index));
    endings.push(match[0]);
    cursor = match.index + match[0].length;
  }
  lines.push(original.slice(cursor));
  endings.push('');

  const anticheatIndex = lines.findIndex((line) => /^anticheat[ \t]*:[ \t]*(?:#.*)?$/.test(line));
  if (anticheatIndex < 0) return original;
  const anticheatEnd = findYamlBlockEnd(lines, anticheatIndex, 0);
  const antiXrayIndex = lines.findIndex((line, index) =>
    index > anticheatIndex && index < anticheatEnd && /^ {2}anti-xray[ \t]*:[ \t]*(?:#.*)?$/.test(line));
  if (antiXrayIndex < 0) return original;
  const antiXrayEnd = findYamlBlockEnd(lines, antiXrayIndex, 2);
  const heightPattern = /^( {4}max-block-height[ \t]*:[ \t]*)(?:(["'])(-?\d+)\2|(-?\d+))([ \t]*(?:#.*)?)$/;
  let changed = false;
  for (let index = antiXrayIndex + 1; index < antiXrayEnd; index += 1) {
    const match = lines[index].match(heightPattern);
    if (!match) continue;
    const currentHeight = Number(match[3] ?? match[4]);
    if (!Number.isSafeInteger(currentHeight) || currentHeight >= PAPER_ANTI_XRAY_MAX_BLOCK_HEIGHT) continue;
    const quote = match[2] || '';
    lines[index] = `${match[1]}${quote}${PAPER_ANTI_XRAY_MAX_BLOCK_HEIGHT}${quote}${match[5]}`;
    changed = true;
  }
  if (!changed) return original;
  return lines.map((line, index) => `${line}${endings[index]}`).join('');
}

function isManagedPaperAntiXrayRecord(metadata) {
  const record = metadata?.antiXray;
  return Boolean(
    record && typeof record === 'object' && !Array.isArray(record) &&
    typeof record.enabled === 'boolean' && [1, 2, 3].includes(Number(record.engineMode))
  );
}

async function readPaperConfigDirectory(directory, serverRootRealPath) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    if (serverRootRealPath) {
      const directoryRealPath = await fs.realpath(directory);
      resolveContainedPath(serverRootRealPath, directoryRealPath, { allowRoot: true });
    }
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function discoverPaperAntiXrayConfigPaths(paths, serverConfig = {}) {
  const serverRoot = path.resolve(paths.root);
  const serverRootRealPath = await fs.realpath(serverRoot);
  const discovered = [];
  const seen = new Set();
  const add = (candidate) => {
    const safe = resolveContainedPath(serverRoot, candidate);
    const key = process.platform === 'win32' ? safe.toLowerCase() : safe;
    if (!seen.has(key)) {
      seen.add(key);
      discovered.push(safe);
    }
  };
  add(path.join(serverRoot, 'config', 'paper-world-defaults.yml'));

  const configuredWorld = isSafeWorldName(serverConfig.levelName) ? serverConfig.levelName : 'world';
  const preferredWorlds = new Set([
    configuredWorld.toLowerCase(),
    `${configuredWorld}_nether`.toLowerCase(),
    `${configuredWorld}_the_end`.toLowerCase()
  ]);
  const rootEntries = (await readPaperConfigDirectory(serverRoot, serverRootRealPath))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => {
      const preferredDifference = Number(preferredWorlds.has(right.name.toLowerCase())) -
        Number(preferredWorlds.has(left.name.toLowerCase()));
      return preferredDifference || left.name.localeCompare(right.name);
    });
  let visitedDirectories = 0;
  for (const entry of rootEntries) {
    if (visitedDirectories >= MAX_PAPER_WORLD_CONFIG_DISCOVERY_DIRECTORIES) break;
    const worldRoot = resolveContainedPath(serverRoot, path.join(serverRoot, entry.name));
    visitedDirectories += 1;
    if (!await isRegularFile(path.join(worldRoot, 'level.dat'))) continue;
    add(path.join(worldRoot, 'paper-world.yml'));

    const dimensionsRoot = resolveContainedPath(worldRoot, path.join(worldRoot, 'dimensions'));
    const queue = [{ directory: dimensionsRoot, depth: 0 }];
    while (queue.length && visitedDirectories < MAX_PAPER_WORLD_CONFIG_DISCOVERY_DIRECTORIES) {
      const current = queue.shift();
      const entries = await readPaperConfigDirectory(current.directory, serverRootRealPath);
      visitedDirectories += 1;
      for (const child of entries) {
        const candidate = resolveContainedPath(worldRoot, path.join(current.directory, child.name));
        if (child.isFile() && child.name.toLowerCase() === 'paper-world.yml') {
          add(candidate);
        } else if (child.isDirectory() && !child.isSymbolicLink() && current.depth < 8) {
          queue.push({ directory: candidate, depth: current.depth + 1 });
        }
      }
    }
  }
  return discovered;
}

async function migrateManagedPaperAntiXrayConfigsBeforeStart(paths, serverConfig = {}) {
  const metadata = await readSecurityMetadata(paths);
  if (!isManagedPaperAntiXrayRecord(metadata)) {
    return { checked: false, migratedConfigs: [], skippedConfigs: [], reason: 'paper-antixray-unmanaged' };
  }
  const configPaths = await discoverPaperAntiXrayConfigPaths(paths, serverConfig);
  const serverRootRealPath = await fs.realpath(paths.root);
  const migratedConfigs = [];
  const skippedConfigs = [];
  for (const configPath of configPaths) {
    let stat;
    try {
      const parentRealPath = await fs.realpath(path.dirname(configPath));
      resolveContainedPath(serverRootRealPath, parentRealPath, { allowRoot: true });
      stat = await fs.lstat(configPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      skippedConfigs.push(path.relative(paths.root, configPath).replace(/\\/g, '/'));
      continue;
    }
    const relativePath = path.relative(paths.root, configPath).replace(/\\/g, '/');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PAPER_CONFIG_BYTES) {
      skippedConfigs.push(relativePath);
      continue;
    }
    let source;
    try {
      source = await fs.readFile(configPath, 'utf8');
    } catch {
      skippedConfigs.push(relativePath);
      continue;
    }
    const updated = migratePaperAntiXrayMaxBlockHeight(source);
    if (updated === source) continue;
    if (Buffer.byteLength(updated, 'utf8') > MAX_PAPER_CONFIG_BYTES) {
      skippedConfigs.push(relativePath);
      continue;
    }
    let currentStat;
    try {
      currentStat = await fs.lstat(configPath);
    } catch {
      skippedConfigs.push(relativePath);
      continue;
    }
    if (!currentStat.isFile() || currentStat.isSymbolicLink() || currentStat.size !== stat.size ||
        currentStat.mtimeMs !== stat.mtimeMs) {
      skippedConfigs.push(relativePath);
      continue;
    }
    await writeTextAtomically(configPath, updated);
    migratedConfigs.push(relativePath);
  }
  return {
    checked: true,
    migratedConfigs,
    skippedConfigs,
    reason: migratedConfigs.length ? 'paper-config-migrated' : 'paper-config-current'
  };
}

function renderPaperAntiXrayBlock(engineMode = 3, includeAir = false, enabled = true) {
  const mode = [1, 2, 3].includes(Number(engineMode)) ? Number(engineMode) : 3;
  const hidden = [
    ...(includeAir && mode !== 1 ? ['air'] : []),
    'ancient_debris', 'copper_ore', 'deepslate_copper_ore', 'raw_copper_block',
    'diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore',
    'gold_ore', 'deepslate_gold_ore', 'iron_ore', 'deepslate_iron_ore', 'raw_iron_block',
    'lapis_ore', 'deepslate_lapis_ore', 'redstone_ore', 'deepslate_redstone_ore',
    'nether_gold_ore', 'nether_quartz_ore'
  ];
  const replacement = mode === 1 ? [] : [
    'amethyst_block', 'andesite', 'basalt', 'blackstone', 'budding_amethyst', 'calcite',
    'chest', 'coal_ore', 'deepslate_coal_ore', 'deepslate', 'diorite', 'dirt', 'granite',
    'gravel', 'netherrack', 'oak_planks', 'smooth_basalt', 'soul_sand', 'soul_soil', 'stone', 'tuff'
  ];
  return [
    '  anti-xray:',
    `    enabled: ${Boolean(enabled)}`,
    `    engine-mode: ${mode}`,
    '    hidden-blocks:',
    ...hidden.map((block) => `    - ${block}`),
    '    lava-obscures: false',
    `    max-block-height: ${PAPER_ANTI_XRAY_MAX_BLOCK_HEIGHT}`,
    ...(replacement.length ? ['    replacement-blocks:', ...replacement.map((block) => `    - ${block}`)] : ['    replacement-blocks: []']),
    '    update-radius: 2',
    '    use-permission: false'
  ];
}

function replacePaperAntiXrayBlock(source, blockLines) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const anticheatIndex = lines.findIndex((line) => /^anticheat:\s*(?:#.*)?$/.test(line));
  if (anticheatIndex < 0) {
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    if (lines.length) lines.push('');
    lines.push('anticheat:', ...blockLines);
    return `${lines.join('\n')}\n`;
  }
  let antiXrayIndex = -1;
  let anticheatEnd = lines.length;
  for (let index = anticheatIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0) {
      anticheatEnd = index;
      break;
    }
    if (/^  anti-xray:\s*(?:#.*)?$/.test(line)) {
      antiXrayIndex = index;
      break;
    }
  }
  if (antiXrayIndex < 0) {
    lines.splice(anticheatIndex + 1, 0, ...blockLines);
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }
  let antiXrayEnd = anticheatEnd;
  for (let index = antiXrayIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= 2) {
      antiXrayEnd = index;
      break;
    }
  }
  lines.splice(antiXrayIndex, antiXrayEnd - antiXrayIndex, ...blockLines);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function inspectPaperAntiXrayBlock(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^  anti-xray:\s*(?:#.*)?$/.test(line));
  if (start < 0) return { enabled: false, engineMode: 0 };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    const indent = lines[index].match(/^\s*/)[0].length;
    if (indent <= 2) {
      end = index;
      break;
    }
  }
  const block = lines.slice(start, end).join('\n');
  return {
    enabled: /^\s{4}enabled:\s*true\s*(?:#.*)?$/mi.test(block),
    engineMode: Number(block.match(/^\s{4}engine-mode:\s*([123])\s*(?:#.*)?$/mi)?.[1]) || 0
  };
}

function isProtectionRuntimeReady(platform) {
  return Boolean(platform?.jarExists && platform.compatible && platform.verified && platform.ready);
}

function isRecordedLegacyProtectionInstall(record) {
  const projectId = String(record?.projectId || '').toLowerCase();
  return String(record?.source || '').toLowerCase() === 'modrinth' &&
    ['grimac', 'ljngwsvh'].includes(projectId) &&
    ['mods', 'plugins'].includes(record?.kind);
}

async function inspectRecordedLegacyProtectionInstallation(paths, antiCheatMetadata) {
  const records = (Array.isArray(antiCheatMetadata?.installedFiles) ? antiCheatMetadata.installedFiles : [])
    .filter(isRecordedLegacyProtectionInstall);
  let existingWithoutHash = null;
  for (const record of records) {
    const fileName = String(record.file || '');
    if (!fileName || path.basename(fileName) !== fileName || !/\.jar$/i.test(fileName)) continue;
    const targetDir = record.kind === 'plugins' ? paths.plugins : paths.mods;
    let file;
    try {
      file = resolveContainedPath(targetDir, path.join(targetDir, fileName));
    } catch {
      continue;
    }
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const expectedHashes = normalizeExpectedHashes(record.expectedHashes);
    const hasExpectedHash = Object.keys(expectedHashes).length > 0;
    const sizeMatches = !Number(record.size) || Number(record.size) === stat.size;
    const hashCacheKey = `addon-integrity:${file}:${stat.size}:${stat.mtimeMs}:${JSON.stringify(expectedHashes)}`;
    const hashMatches = hasExpectedHash && sizeMatches && await getCachedWork(
      hashCacheKey,
      5 * 60_000,
      () => fileMatchesExpectedHash(file, expectedHashes)
    );
    const result = {
      recorded: true,
      exists: true,
      file: fileName,
      kind: record.kind,
      gameVersion: normalizeAddonVersion(record.gameVersion),
      serverType: normalizeServerType(record.serverType),
      sizeMatches,
      hasExpectedHash,
      integrityVerified: hashMatches
    };
    if (hashMatches) return result;
    if (!existingWithoutHash) existingWithoutHash = result;
  }
  return existingWithoutHash || {
    recorded: records.length > 0,
    exists: false,
    file: '',
    kind: '',
    gameVersion: '',
    serverType: '',
    sizeMatches: false,
    hasExpectedHash: false,
    integrityVerified: false
  };
}

async function applyAntiXray(options = {}) {
  const paths = await getPaths();
  return serializeProtectionStateTransaction(paths.root, () => applyAntiXrayTransactionUnlocked(options, paths));
}

async function applyAntiXrayTransactionUnlocked(options, paths) {
  const config = await readConfig(paths);
  const serverType = normalizeServerType(config.serverType);
  const enabled = options.enabled !== false;
  const platform = await getServerPlatformStatus(config, paths);
  const capabilities = getProtectionCapabilities(
    serverType,
    platform.minecraftVersion || config.serverVersion
  );
  if (capabilities.antiXrayObfuscationSupported || capabilities.antiXrayDetectionSupported) {
    const protectionConfig = await mutateProtectionConfigForPathsUnlocked(paths, (current) => ({
      layers: { ...current.layers, antiXray: enabled }
    }));
    const builtIn = await getBundledAntiCheatStatus(paths, protectionConfig);
    const appliedLive = Boolean(protectionConfig.appliedLive);
    const metadata = await readSecurityMetadata(paths);
    await writeSecurityMetadata(paths, {
      ...metadata,
      antiXray: {
        enabled,
        mode: 'fabric-packet-obfuscation',
        secondaryDetection: true,
        appliedAt: new Date().toISOString()
      }
    });
    cachedStatus = null;
    appendServerLog(`[Server Protection] Fabric packet Anti-Xray ${enabled ? 'enabled' : 'disabled'}. Hidden ore data is rewritten before chunk packets reach players; concealed-ore detection remains enabled as a secondary signal.\n`);
    return {
      enabled,
      supported: true,
      mode: 'obfuscation',
      appliedLive,
      restartRequired: Boolean(protectionConfig.restartRequired),
      requiresProtectionInstall: Boolean(enabled && !builtIn.installed)
    };
  }
  if (!['paper', 'purpur'].includes(serverType)) {
    if (!enabled) {
      await mutateProtectionConfigForPathsUnlocked(paths, (protectionConfig) => ({
        layers: { ...protectionConfig.layers, antiXray: false }
      }));
      cachedStatus = null;
      return { enabled: false, supported: false, restartRequired: false };
    }
    throw new Error('Ore protection requires Paper/Purpur obfuscation or the bundled Fabric 26.2/26.3 packet obfuscator.');
  }
  if (enabled && !isProtectionRuntimeReady(platform)) {
    throw new Error(platform.message || 'Install a verified matching Paper server runtime before enabling Anti-Xray.');
  }
  const configPath = path.join(paths.root, 'config', 'paper-world-defaults.yml');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let original = '';
  try {
    const stat = await fs.stat(configPath);
    if (!stat.isFile()) throw new Error('Paper Anti-Xray config is not a regular file.');
    if (stat.size > MAX_PAPER_CONFIG_BYTES) {
      throw new Error('Paper Anti-Xray config is too large to edit safely.');
    }
    original = await fs.readFile(configPath, 'utf8');
    const backup = `${configPath}.server-manager-backup`;
    try {
      await fs.access(backup);
    } catch {
      await fs.writeFile(backup, original);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const engineMode = [1, 2, 3].includes(Number(options.engineMode)) ? Number(options.engineMode) : 3;
  const includeAir = Boolean(options.includeAir ?? options.strictXray);
  const updated = replacePaperAntiXrayBlock(original, renderPaperAntiXrayBlock(engineMode, includeAir, enabled));
  const temporary = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, updated);
  await replaceFileAtomically(temporary, configPath);
  const metadata = await readSecurityMetadata(paths);
  await writeSecurityMetadata(paths, {
    ...metadata,
    antiXray: { enabled, engineMode, includeAir, path: configPath, appliedAt: new Date().toISOString() }
  });
  await mutateProtectionConfigForPathsUnlocked(paths, (protectionConfig) => ({
    layers: { ...protectionConfig.layers, antiXray: enabled }
  }));
  cachedStatus = null;
  appendServerLog(`[Server Protection] Paper Anti-Xray ${enabled ? `enabled with engine mode ${engineMode}${includeAir ? ' and strict air obfuscation' : ''}` : 'disabled'}. Restart required.\n`);
  return { enabled, engineMode, includeAir, path: configPath, restartRequired: true };
}

async function getSecurityStatus() {
  const paths = await getPaths();
  const config = await readConfig();
  const serverType = normalizeServerType(config.serverType);
  const metadata = await readSecurityMetadata(paths);
  const protectionConfig = await getProtectionConfig(paths);
  const platform = await getServerPlatformStatus(config);
  const paperConfigPath = path.join(paths.root, 'config', 'paper-world-defaults.yml');
  let paperConfig = '';
  try {
    const stat = await fs.stat(paperConfigPath);
    if (stat.isFile() && stat.size <= MAX_PAPER_CONFIG_BYTES) {
      paperConfig = await fs.readFile(paperConfigPath, 'utf8');
    }
  } catch {}
  const legacyProtection = await inspectRecordedLegacyProtectionInstallation(paths, metadata.antiCheat);
  const [builtIn, customAntiCheats] = await Promise.all([
    getBundledAntiCheatStatus(paths, protectionConfig),
    listCustomAntiCheats()
  ]);
  const antiXray = inspectPaperAntiXrayBlock(paperConfig);
  const capabilities = getProtectionCapabilityState(serverType, platform, config.serverVersion);
  const antiXrayDetection = Boolean(capabilities.antiXrayDetectionSupported);
  const antiXrayObfuscation = Boolean(capabilities.antiXrayObfuscationSupported);
  const antiXraySupported = Boolean(capabilities.nativeAntiXraySupported || antiXrayObfuscation || antiXrayDetection);
  const antiXrayConfigured = capabilities.nativeAntiXraySupported
    ? antiXray.enabled
    : (antiXrayObfuscation || antiXrayDetection) && protectionConfig.layers.antiXray;
  const antiXrayActive = Boolean(capabilities.nativeAntiXraySupported
    ? antiXray.enabled && capabilities.runtimeReady
    : antiXrayObfuscation
      ? protectionConfig.layers.antiXray && builtIn.active && builtIn.runtime?.packetAntiXrayActive === true
      : antiXrayDetection && protectionConfig.layers.antiXray && builtIn.active);
  const matchingCustomAdapters = customAntiCheats.filter((entry) =>
    entry.active && entry.integrityVerified && entry.kind === capabilities.customAdapterKind &&
    isAntiCheatDescriptorCompatible(entry.descriptor, serverType)
  );
  const hardeningEnabled = Boolean(
    config.onlineMode && config.enforceSecureProfile && !config.enableRcon && !config.enableQuery &&
    !config.enableJmxMonitoring && !config.allowCheats
  );
  const bundledProtectionRecords = Object.values(metadata.builtInProtection?.adapters || {})
    .filter((entry) => entry && typeof entry === 'object');
  const lastSecurityChange = Math.max(
    Date.parse(metadata.appliedAt || '') || 0,
    Date.parse(metadata.antiXray?.appliedAt || '') || 0,
    Date.parse(metadata.antiCheat?.installedAt || '') || 0,
    Date.parse(metadata.builtInAntiCheat?.installedAt || '') || 0,
    ...bundledProtectionRecords.map((entry) => Date.parse(entry.installedAt || '') || 0),
    Date.parse(protectionConfig.updatedAt || '') || 0,
    ...customAntiCheats.map((entry) => Date.parse(entry.importedAt || '') || 0)
  );
  return {
    preset: config.securityPreset || 'off',
    protectionConfig,
    platform,
    hardening: {
      enabled: hardeningEnabled,
      onlineMode: Boolean(config.onlineMode),
      secureProfiles: Boolean(config.enforceSecureProfile),
      rconDisabled: !config.enableRcon,
      queryDisabled: !config.enableQuery,
      jmxDisabled: !config.enableJmxMonitoring,
      commandBlocksDisabled: !config.allowCheats
    },
    antiXray: {
      supported: antiXraySupported,
      configured: Boolean(antiXrayConfigured),
      enabled: antiXrayActive,
      active: antiXrayActive,
      mode: capabilities.antiXrayMode || '',
      engineMode: antiXray.engineMode || Number(metadata.antiXray?.engineMode) || 0,
      path: capabilities.nativeAntiXraySupported
        ? paperConfigPath
        : antiXrayObfuscation ? paths.fabricAntiXrayConfig : paths.fabricProtectionConfig,
      provider: antiXrayObfuscation ? builtIn.antiXrayProviderId || BUNDLED_PROTECTION_FABRIC_ANTI_XRAY_MOD_ID : '',
      providerVersion: antiXrayObfuscation ? builtIn.antiXrayProviderVersion || '' : '',
      secondaryDetection: Boolean(antiXrayObfuscation && antiXrayDetection),
      note: capabilities.nativeAntiXraySupported
        ? 'Paper Anti-Xray obfuscates hidden ore packets but cannot prevent every seed or range-extension bypass.'
        : antiXrayObfuscation
          ? 'Fabric rewrites bounded copies of outgoing chunk data so concealed ores are hidden before players receive them. The existing concealed-ore detector remains a secondary signal.'
        : antiXrayDetection
          ? 'Fabric uses a lightweight evidence detector for repeated valuable-ore breaks with no exposed face. It does not obfuscate ore packets or scan chunks.'
          : 'This runtime has no bundled ore obfuscation or concealed-ore detector.'
    },
    espMitigation: {
      supported: Boolean(capabilities.espMitigationSupported),
      configured: Boolean(protectionConfig.layers.espMitigation),
      enabled: Boolean(capabilities.espMitigationSupported && protectionConfig.layers.espMitigation),
      active: Boolean(capabilities.espMitigationSupported && protectionConfig.layers.espMitigation && builtIn.active),
      restartRequired: Boolean(builtIn.visibilityRestartRequired),
      note: builtIn.visibilityRestartRequired
        ? 'Update and restart required. The running protection adapter may still affect player and nametag visibility.'
        : capabilities.espMitigationSupported
        ? 'Entity ESP mitigation withholds occluded player visibility after bounded line-of-sight checks. It is not ESP detection and may cause player pop-in.'
        : 'PvP-safe visibility preserves vanilla player and nametag tracking at distance and through blocks. Wall-hit protection still rejects confirmed attacks through blocks.'
    },
    capabilities: {
      ...capabilities,
      baselineHardeningActive: hardeningEnabled,
      bundledAdapterInstalled: Boolean(builtIn.installed && builtIn.integrityVerified),
      bundledAdapterActive: Boolean(builtIn.active),
      matchingCustomAdapterCount: matchingCustomAdapters.length,
      eventAdapterAvailable: Boolean(capabilities.bundledAdapterSupported || capabilities.customAdapterSupported),
      eventAdapterReady: Boolean(capabilities.runtimeReady && (builtIn.active || matchingCustomAdapters.length))
    },
    legacyProtection: {
      recorded: legacyProtection.recorded,
      exists: legacyProtection.exists,
      file: legacyProtection.file,
      integrityVerified: legacyProtection.integrityVerified,
      removable: Boolean(legacyProtection.exists && legacyProtection.integrityVerified),
      message: !legacyProtection.exists
        ? ''
        : legacyProtection.integrityVerified
          ? 'An older managed protection add-on can be removed safely.'
          : 'An older protection add-on changed after installation and was left untouched.'
    },
    builtIn,
    customAntiCheats: {
      installed: customAntiCheats.filter((entry) => entry.active).length,
      verified: customAntiCheats.filter((entry) => entry.active && entry.integrityVerified).length,
      entries: customAntiCheats
    },
    desiredLayers: { ...protectionConfig.layers },
    restartRequired: Boolean(serverProcess && serverStartedAt && lastSecurityChange > serverStartedAt)
  };
}

function applySecurityPreset(options = {}) {
  return serverToolMutationCoordinator.run(
    `config:security-preset:${++configSaveMutationSequence}`,
    () => applySecurityPresetUnlocked(options)
  );
}

async function applySecurityPresetUnlocked(options = {}) {
  const config = await readConfig();
  const next = await writeConfig({
    ...config,
    securityPreset: 'strong',
    onlineMode: true,
    allowCheats: false,
    enforceSecureProfile: true,
    enableRcon: false,
    enableQuery: false,
    enableJmxMonitoring: false,
    broadcastRconToOps: false,
    hideOnlinePlayers: true,
    logIps: false,
    functionPermissionLevel: 2,
    opPermissionLevel: 3
  });
  const results = { baselineHardening: true, nativeAntiXray: null, warnings: [] };
  const serverType = normalizeServerType(next.serverType);
  const capabilities = getProtectionCapabilities(serverType, next.serverVersion);
  if (options.enableAntiXray === true) {
    if (capabilities.nativeAntiXraySupported || capabilities.antiXrayObfuscationSupported || capabilities.antiXrayDetectionSupported) {
      try {
        results.nativeAntiXray = await applyAntiXray({
          engineMode: options.engineMode || 3,
          includeAir: Boolean(options.strictXray)
        });
      } catch (error) {
        results.warnings.push(`Anti-Xray was not applied: ${error.message || String(error)}`);
      }
    } else {
      results.warnings.push('Ore protection is unavailable for this server runtime and version.');
    }
  }
  const paths = await getPaths();
  await serializeProtectionStateTransaction(paths.root, async () => {
    const metadata = await readSecurityMetadata(paths);
    await writeSecurityMetadata(paths, { ...metadata, preset: 'strong', appliedAt: new Date().toISOString() });
  });
  appendServerLog(`[Server Protection] Applied baseline hardening for ${capabilities.serverType}. ${serverProcess ? 'Restart required.' : 'Changes are ready for the next start.'}\n`);
  return { ...results, capabilities, restartRequired: Boolean(serverProcess), status: await getSecurityStatus() };
}

function isServerReadyOutput(value) {
  return /(?:^|\n).*\bDone\s*\([^)]+\)!/i.test(String(value || ''));
}

function summarizeServerStartupFailure(output, error, code, signal, config = {}) {
  const text = String(output || '');
  const errorText = String(error?.message || error || '');
  if (/FAILED TO BIND TO PORT|Address already in use|Perhaps a server is already running/i.test(`${text}\n${errorText}`)) {
    return `Port ${Number(config.port) || 25565} is already in use. Stop the other server or choose another port.`;
  }
  if (/You need to agree to the EULA|eula\.txt/i.test(`${text}\n${errorText}`)) {
    return 'Minecraft EULA acceptance is required before this server can start.';
  }
  if (/OutOfMemoryError|Java heap space/i.test(`${text}\n${errorText}`)) {
    const memoryMb = Number(config.memoryMb) || DEFAULT_CONFIG.memoryMb;
    if (/meowantixray|FakeOreService/i.test(`${text}\n${errorText}`)) {
      return `Fabric Anti-Xray exhausted the ${memoryMb} MB Java heap while preparing chunks. ` +
        'Increase server memory and install the latest Click Interval protection update before starting again.';
    }
    return `Minecraft exhausted its ${memoryMb} MB Java heap. Increase the server memory setting before starting again.`;
  }
  if (/Could not reserve enough space|Invalid maximum heap size/i.test(`${text}\n${errorText}`)) {
    return 'Java could not reserve the configured server memory. Lower the memory setting or close memory-heavy apps.';
  }
  if (/UnsupportedClassVersionError|has been compiled by a more recent version/i.test(`${text}\n${errorText}`)) {
    return `The selected server requires a newer Java version (Java ${MIN_JAVA_MAJOR}+ is recommended).`;
  }
  if (/Failed to load datapacks|No key dimensions|No key seed|reset to vanilla with --safeMode/i.test(text)) {
    return 'Minecraft could not load this world or one of its datapacks.';
  }
  if (errorText) return errorText.replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
  const usefulLine = text.split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\](?:\s+\[[^\]]+\])?:?\s*/, '').trim())
    .filter((line) => /(?:fatal|exception|error|failed|could not)/i.test(line))
    .at(-1);
  if (usefulLine) return usefulLine.slice(0, 240);
  const exitDetail = signal ? ` (${signal})` : Number.isInteger(code) ? ` (exit code ${code})` : '';
  return `Minecraft stopped before it finished starting${exitDetail}. Open Console for the full log.`;
}

function hasChildExited(processRef) {
  return !processRef ||
    (processRef.exitCode !== null && processRef.exitCode !== undefined) ||
    (typeof processRef.signalCode === 'string' && processRef.signalCode.length > 0);
}

function waitForChildExit(processRef, timeoutMs) {
  if (hasChildExited(processRef)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      processRef.removeListener?.('exit', onExit);
      processRef.removeListener?.('close', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    processRef.once('exit', onExit);
    processRef.once('close', onExit);
    // The child can exit between the initial state check and listener attachment.
    // Rechecking after both listeners are installed closes that otherwise 20-second stop race.
    if (hasChildExited(processRef)) finish(true);
    if (settled) return;
    timer = setTimeout(() => finish(hasChildExited(processRef)), Math.max(1, Number(timeoutMs) || 1));
    timer.unref?.();
    if (hasChildExited(processRef)) finish(true);
  });
}

function rejectSeamlessVelocityProtocolWaiters(error) {
  for (const waiter of [...seamlessVelocityProtocolWaiters]) {
    seamlessVelocityProtocolWaiters.delete(waiter);
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}

function observeSeamlessVelocityProtocolChunk(chunk) {
  const combined = `${seamlessVelocityLogRemainder}${String(chunk || '').replace(/\r\n?/gu, '\n')}`;
  const lines = combined.split('\n');
  seamlessVelocityLogRemainder = lines.pop() || '';
  for (const line of lines) {
    const event = parseSeamlessProxyProtocolLine(line);
    if (!event) continue;
    const recorded = Object.freeze({ ...event, sequence: ++seamlessVelocityProtocolSequence });
    seamlessVelocityProtocolEvents.push(recorded);
    if (seamlessVelocityProtocolEvents.length > 64) seamlessVelocityProtocolEvents.shift();
    for (const waiter of [...seamlessVelocityProtocolWaiters]) {
      if (recorded.sequence <= waiter.afterSequence) continue;
      const rejected = !recorded.acknowledged && waiter.rejectOperations.has(recorded.operation);
      let accepted = false;
      try { accepted = waiter.accept(recorded); } catch (error) {
        seamlessVelocityProtocolWaiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
        continue;
      }
      if (!rejected && !accepted) continue;
      seamlessVelocityProtocolWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      if (rejected) {
        const error = new Error(`Restart proxy rejected ${recorded.operation}: ${recorded.result || 'unknown error'}.`);
        error.code = 'SEAMLESS_RESTART_PROXY_REJECTED';
        error.event = recorded;
        waiter.reject(error);
      } else {
        waiter.resolve(recorded);
      }
    }
  }
}

function waitForSeamlessVelocityProtocol(afterSequence, accept, rejectOperations = [], timeoutMs = SEAMLESS_RESTART_CONTROL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const waiter = {
      afterSequence,
      accept,
      rejectOperations: new Set([rejectOperations].flat().map(value => String(value || '').toLowerCase()).filter(Boolean)),
      resolve,
      reject,
      timer: null
    };
    waiter.timer = setTimeout(() => {
      if (!seamlessVelocityProtocolWaiters.delete(waiter)) return;
      const error = new Error('The restart proxy did not acknowledge the control command in time. Minecraft was not stopped.');
      error.code = 'SEAMLESS_RESTART_PROXY_TIMEOUT';
      reject(error);
    }, Math.max(1000, Number(timeoutMs) || SEAMLESS_RESTART_CONTROL_TIMEOUT_MS));
    waiter.timer.unref?.();
    seamlessVelocityProtocolWaiters.add(waiter);
  });
}

function appendSeamlessSidecarLog(label, chunk) {
  const text = String(chunk || '').replace(/\r\n?/gu, '\n');
  if (!text) return;
  const prefixed = text.split('\n').map((line, index, values) =>
    !line && index === values.length - 1 ? '' : `[${label}] ${line}`
  ).join('\n');
  appendServerLog(prefixed.endsWith('\n') ? prefixed : `${prefixed}\n`);
}

function tryWriteSidecarInput(processRef, command, label) {
  const input = processRef?.stdin;
  if (!input?.writable || input.destroyed || input.writableEnded || hasChildExited(processRef)) return false;
  try {
    input.write(`${command}\n`, () => {});
    return true;
  } catch (error) {
    appendServerLog(`[${label}] Console write failed: ${error.message || String(error)}\n`);
    return false;
  }
}

function sendSeamlessVelocityControl(command, accept, rejectOperations, timeoutMs) {
  const processRef = seamlessVelocityProcess;
  if (!processRef || hasChildExited(processRef)) {
    return Promise.reject(new Error('The restart proxy is not running. Minecraft was not stopped.'));
  }
  const afterSequence = seamlessVelocityProtocolSequence;
  const response = waitForSeamlessVelocityProtocol(afterSequence, accept, rejectOperations, timeoutMs);
  if (!tryWriteSidecarInput(processRef, command, 'Restart Proxy')) {
    rejectSeamlessVelocityProtocolWaiters(new Error('The restart proxy console is unavailable. Minecraft was not stopped.'));
  }
  return response;
}

async function waitForSeamlessSidecarReady(processRef, host, port, label, timeoutMs = SEAMLESS_RESTART_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasChildExited(processRef)) throw new Error(`${label} exited before it became ready.`);
    if (await testTcpConnect(host, port, 500)) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not become ready on ${host}:${port} within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

async function isVerifiedHoldingLobbyProcess(processRef, holding, paths) {
  if (!processRef || hasChildExited(processRef)) return false;
  if (!holding.enabled) return true;
  if (!holding.ready || processRef.metadata?.holdingType !== 'fabric' ||
      processRef.metadata?.holdingWorld !== 'HoldingLobby') return false;
  if (processRef.holdingLobbyReadinessVerified === true) return true;
  try {
    const evidence = await inspectPersistentProcessBacklog(paths.persistentLimboState, {
      expectedState: processRef.state,
      predicates: holdingLobbyStartupPredicates(holding.manifest.voicePort)
    });
    processRef.holdingLobbyReadinessVerified = evidence.complete && Object.values(evidence.matches).every(Boolean);
  } catch { return false; }
  return processRef.holdingLobbyReadinessVerified === true;
}

async function waitForFabricHoldingLobbyReady(processRef, holding, paths, seamless) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (hasChildExited(processRef)) throw new Error('The protected holding lobby exited during startup.');
    if (await isVerifiedHoldingLobbyProcess(processRef, holding, paths) &&
        await testTcpConnect(seamless.limboHost, seamless.limboPort, 500)) return true;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error('The protected holding lobby did not confirm world, protection, forwarding and voice readiness.');
}

async function prepareProtectedHoldingVoice(profile, config, holding, javaPath) {
  if (!holding.enabled || !holding.ready || applicationQuitting) return;
  try {
    const result = await prepareHoldingLobbyVoiceNetwork({ profileId: profile.id, profileName: profile.name,
      port: holding.manifest.voicePort, localOnly: config.localOnly === true, javaPath });
    appendServerLog(`[Restart Lobby] Voice UDP ${holding.manifest.voicePort}: router=${result.mappingReady ? 'mapped' : 'not confirmed'}, ` +
      `firewall=${result.firewallReady ? 'ready' : 'not confirmed'}. Public voice connectivity still requires an external test.\n`);
  } catch (error) {
    appendServerLog(`[Restart Lobby] Voice network preparation failed: ${error.message || String(error)}. The main voice route was not changed.\n`);
  }
}

function connectHostForSeamlessBind(host) {
  const value = String(host || '').trim().replace(/^\[|\]$/gu, '');
  if (!value || value === '0.0.0.0' || value === '*') return SEAMLESS_RESTART_LOOPBACK_HOST;
  if (value === '::' || value === '0:0:0:0:0:0:0:0') return '::1';
  return value;
}

function attachSeamlessSidecarProcess(processRef, kind) {
  const isVelocity = kind === 'velocity';
  const label = isVelocity ? 'Restart Proxy' : 'Restart Lobby';
  processRef.stdin?.on?.('error', error => {
    appendServerLog(`[${label}] Console error: ${error.message || String(error)}\n`);
  });
  processRef.stdout?.on?.('data', chunk => {
    appendSeamlessSidecarLog(label, chunk);
    if (isVelocity) observeSeamlessVelocityProtocolChunk(chunk);
  });
  processRef.stderr?.on?.('data', chunk => {
    appendSeamlessSidecarLog(label, chunk);
    if (isVelocity) observeSeamlessVelocityProtocolChunk(chunk);
  });
  processRef.on('error', error => {
    appendServerLog(`[${label}] Process error: ${error.message || String(error)}\n`);
    if (isVelocity) rejectSeamlessVelocityProtocolWaiters(error);
  });
  let finished = false;
  const finish = (code, signal) => {
    if (finished) return;
    finished = true;
    appendServerLog(`[${label}] Exited (${signal || code}).\n`);
    if (isVelocity) {
      if (seamlessVelocityProcess === processRef) seamlessVelocityProcess = null;
      rejectSeamlessVelocityProtocolWaiters(new Error('The restart proxy exited before completing its control command.'));
    } else if (seamlessLimboProcess === processRef) {
      seamlessLimboProcess = null;
    }
    invalidateStatusCache();
  };
  processRef.once('exit', finish);
  processRef.once('close', finish);
  if (hasChildExited(processRef)) queueMicrotask(() => finish(processRef.exitCode, processRef.signalCode));
}

async function stopOwnedSeamlessSidecar(processRef, command, label) {
  if (!processRef || hasChildExited(processRef)) return true;
  tryWriteSidecarInput(processRef, command, label);
  let exited = await waitForChildExit(processRef, SEAMLESS_RESTART_STOP_TIMEOUT_MS);
  if (!exited) {
    try { processRef.kill(); } catch {}
    exited = await waitForChildExit(processRef, 1500);
  }
  if (!exited) {
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, 1000);
  }
  return exited || hasChildExited(processRef);
}

function stopSeamlessRestartSidecars(options = {}) {
  if (seamlessSidecarStopPromise) return seamlessSidecarStopPromise;
  const velocity = seamlessVelocityProcess;
  const limbo = seamlessLimboProcess;
  if (!velocity && !limbo) {
    seamlessRuntimeProfileId = '';
    if (options.preserveMaintenance !== true) seamlessMaintenanceArmed = false;
    return Promise.resolve({ stopped: true });
  }
  let operation;
  operation = Promise.all([
    stopOwnedSeamlessSidecar(velocity, 'shutdown', 'Restart Proxy'),
    stopOwnedSeamlessSidecar(limbo, 'stop', 'Restart Lobby')
  ]).then(([velocityExited, limboExited]) => {
    const velocityStillRunning = Boolean(velocity && !velocityExited && !hasChildExited(velocity));
    const limboStillRunning = Boolean(limbo && !limboExited && !hasChildExited(limbo));
    if (seamlessVelocityProcess === velocity && !velocityStillRunning) seamlessVelocityProcess = null;
    if (seamlessLimboProcess === limbo && !limboStillRunning) seamlessLimboProcess = null;
    if (velocityStillRunning || limboStillRunning) {
      const labels = [
        velocityStillRunning ? 'restart proxy' : '',
        limboStillRunning ? 'restart lobby' : ''
      ].filter(Boolean);
      throw new Error(`The ${labels.join(' and ')} did not exit after stop and forced termination. Its process handle was preserved; retry stop before changing profiles or setup.`);
    }
    seamlessRuntimeProfileId = '';
    seamlessVelocityLogRemainder = '';
    if (options.preserveMaintenance !== true) seamlessMaintenanceArmed = false;
    invalidateStatusCache();
    return { stopped: true };
  }).finally(() => {
    if (seamlessSidecarStopPromise === operation) seamlessSidecarStopPromise = null;
  });
  seamlessSidecarStopPromise = operation;
  return operation;
}

function startSeamlessRestartSidecars({ profile, paths, config, platform, java }) {
  if (seamlessSidecarStartPromise) return seamlessSidecarStartPromise;
  const seamless = getSeamlessRestartConfig(config);
  if (!seamless.enabled) return Promise.resolve({ enabled: false, config: seamless });
  let operation;
  operation = Promise.resolve().then(async () => {
    const inspection = await getSeamlessRestartInspection(config, paths, platform, java);
    if (!inspection.holding.ready) throw new Error(inspection.holding.error);
    if (seamlessVelocityProcess && seamlessLimboProcess &&
        !hasChildExited(seamlessVelocityProcess) && !hasChildExited(seamlessLimboProcess)) {
      if (seamlessRuntimeProfileId !== profile.id) {
        throw new Error('Another server profile owns the running seamless-restart proxy stack. Stop it before switching servers.');
      }
      if (!inspection.runtime.limboRunning) {
        throw new Error('The selected protected holding lobby is not the verified running lobby. No running server was changed.');
      }
      return { enabled: true, reused: true, config: seamless };
    }
    if (seamlessVelocityProcess || seamlessLimboProcess) await stopSeamlessRestartSidecars();
    if (!inspection.status.setupReady || !inspection.artifactReport.ready) {
      const reason = inspection.status.reasons.find(item => !['VELOCITY_NOT_RUNNING', 'NANO_LIMBO_NOT_READY', 'FABRIC_PROXY_LITE_NOT_LOADED', 'BACKEND_NOT_READY'].includes(item.code));
      throw new Error(`${reason?.message || 'Seamless-restart setup is incomplete.'} Run /silent-restart setup while the server is stopped.`);
    }
    assertApplicationAllowsOwnedChildStart('the seamless-restart proxy stack');
    await Promise.all([
      assertTcpEndpointAvailable(seamless.proxyHost, seamless.proxyPort, 'Public proxy port'),
      assertTcpEndpointAvailable(seamless.limboHost, seamless.limboPort, 'Maintenance port')
    ]);
    seamlessVelocityLogRemainder = '';
    seamlessVelocityProtocolEvents.length = 0;
    seamlessVelocityProtocolSequence = 0;
    const javaPath = java.path || config.javaPath || 'java';
    const limbo = await launchPersistentProcess({
      role: 'restart-lobby',
      executable: javaPath,
      args: inspection.holding.enabled ? inspection.holding.args
        : ['-Xms32M', '-Xmx128M', '-Dfile.encoding=UTF-8', '-jar', paths.seamlessRestartLimboJar],
      cwd: inspection.holding.enabled ? inspection.holding.runtimeRoot : paths.seamlessRestartLimboRoot,
      statePath: paths.persistentLimboState,
      metadata: { profileId: profile.id, holdingType: inspection.holding.type,
        ...(inspection.holding.enabled ? { holdingWorld: 'HoldingLobby' } : {}) }
    });
    try {
      assertApplicationAllowsOwnedChildStart('the seamless-restart proxy stack');
    } catch (error) {
      await stopUnadoptedPersistentProcess(limbo, 'stop');
      throw error;
    }
    seamlessLimboProcess = limbo;
    attachSeamlessSidecarProcess(limbo, 'limbo');
    try {
      if (inspection.holding.enabled) await waitForFabricHoldingLobbyReady(limbo, inspection.holding, paths, seamless);
      else await waitForSeamlessSidecarReady(limbo, seamless.limboHost, seamless.limboPort, 'Restart lobby');
      await prepareProtectedHoldingVoice(profile, config, inspection.holding, javaPath);
      const velocity = await launchPersistentProcess({
        role: 'restart-proxy',
        executable: javaPath,
        args: ['-Xms128M', '-Xmx384M', '-Dfile.encoding=UTF-8', '-jar', paths.seamlessRestartVelocityJar],
        cwd: paths.seamlessRestartVelocityRoot,
        statePath: paths.persistentVelocityState,
        metadata: { profileId: profile.id }
      });
      try {
        assertApplicationAllowsOwnedChildStart('the seamless-restart proxy stack');
      } catch (error) {
        await stopUnadoptedPersistentProcess(velocity, 'shutdown');
        throw error;
      }
      seamlessVelocityProcess = velocity;
      attachSeamlessSidecarProcess(velocity, 'velocity');
      await waitForSeamlessSidecarReady(
        velocity,
        connectHostForSeamlessBind(seamless.proxyHost),
        seamless.proxyPort,
        'Restart proxy'
      );
      await sendSeamlessVelocityControl(
        buildMaintenanceCommand('status'),
        event => event.acknowledged && event.operation === 'status',
        ['status'],
        15_000
      );
      seamlessRuntimeProfileId = profile.id;
      appendServerLog(
        `[Seamless Restart] Proxy ready on ${seamless.proxyHost}:${seamless.proxyPort}; ` +
        `backend=${seamless.backendHost}:${seamless.backendPort}, maintenance=${seamless.limboHost}:${seamless.limboPort}.\n`
      );
      invalidateStatusCache();
      return { enabled: true, reused: false, config: seamless };
    } catch (error) {
      await stopSeamlessRestartSidecars();
      throw error;
    }
  }).finally(() => {
    if (seamlessSidecarStartPromise === operation) seamlessSidecarStartPromise = null;
  });
  seamlessSidecarStartPromise = operation;
  return operation;
}

function canMarkServerReady(startupSettled, processMatches, generationMatches, state, stopRequested) {
  return !startupSettled && processMatches && generationMatches && state === 'starting' && !stopRequested;
}

async function retireUnsafeLavaSourceBeforeStart({
  paths,
  config,
  revalidate,
  descriptorIndex = null,
  artifactPin = null
} = {}) {
  if (!paths?.root || !paths?.mods || typeof revalidate !== 'function') {
    throw new Error('Lava Source retirement did not receive a verified startup context.');
  }
  await revalidate();
  const pin = artifactPin || Object.freeze({
    modId: RETIRED_LAVA_SOURCE_MOD_ID,
    version: RETIRED_LAVA_SOURCE_VERSION,
    sha256: RETIRED_LAVA_SOURCE_SHA256,
    size: RETIRED_LAVA_SOURCE_SIZE
  });
  const index = descriptorIndex || await getModDescriptorIndex(paths);
  const indexedFiles = new Map((index.files || []).map(entry => [entry.name.toLowerCase(), entry]));
  const matches = new Map();
  const entries = await fs.readdir(paths.mods, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jar')) continue;
    const key = entry.name.toLowerCase();
    const candidate = resolveContainedPath(paths.mods, path.join(paths.mods, entry.name));
    const stat = await fs.stat(candidate);
    if (stat.size !== pin.size) continue;
    const sha256 = await calculateFileHash(candidate, 'sha256');
    if (sha256 !== pin.sha256) continue;
    const descriptor = indexedFiles.get(key)?.descriptor || await inspectJarDescriptor(candidate);
    if (descriptor?.fabricModId === pin.modId &&
        String(descriptor.fabricVersion || '').trim() === pin.version) {
      matches.set(key, entry.name);
    }
  }

  const quarantineDirectory = resolveContainedPath(
    paths.root,
    path.join(paths.root, RETIRED_LAVA_SOURCE_DIRECTORY)
  );
  const uniqueQuarantinePath = async (preferredName) => {
    let destination = path.join(quarantineDirectory, preferredName);
    if (!await fs.stat(destination).catch(() => null)) return destination;
    const extension = path.extname(preferredName);
    const stem = path.basename(preferredName, extension);
    destination = path.join(
      quarantineDirectory,
      `${stem}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`
    );
    return destination;
  };

  const retired = [];
  for (const name of [...matches.values()].sort((left, right) => left.localeCompare(right))) {
    await revalidate();
    const source = resolveContainedPath(paths.mods, path.join(paths.mods, name));
    if (!await isRegularFile(source)) continue;
    await fs.mkdir(quarantineDirectory, { recursive: true });
    const destination = await uniqueQuarantinePath(name);
    await fs.rename(source, destination);
    await removeInstalledAddonMetadata(paths, 'mods', name).catch(error => appendServerLog(
      `[Server Manager] Retired ${name}, but its add-on metadata could not be removed: ${error?.message || error}\n`
    ));
    retired.push({ name, destination });
    appendServerLog(
      `[Server Manager SRV-PERF-202] Retired ${name} before startup; Lava Source ${RETIRED_LAVA_SOURCE_VERSION}'s every-tick scanner is blocked.\n`
    );
  }

  const worldName = validateWorldName(config?.levelName || 'world');
  const datapacksDirectory = resolveContainedPath(paths.root, path.join(paths.root, worldName, 'datapacks'));
  const hotfix = resolveContainedPath(
    datapacksDirectory,
    path.join(datapacksDirectory, RETIRED_LAVA_SOURCE_HOTFIX_DATAPACK)
  );
  const hotfixStat = await fs.stat(hotfix).catch(error => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  const hotfixPreserved = Boolean(hotfixStat?.isDirectory());
  if (retired.length && hotfixPreserved) {
    appendServerLog(
      '[Server Manager SRV-PERF-203] Preserved the narrow Lava Source tick override as a fail-safe; unrelated datapack functions are unchanged.\n'
    );
  }

  if (retired.length) {
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
  }
  return {
    checked: true,
    retired: retired.map(entry => entry.name),
    hotfixPreserved,
    partialScan: Boolean(index.partial),
    warning: String(index.warning || '')
  };
}

async function applyQueuedSmpModsBeforeStart({ paths, config, platform, revalidate }) {
  const serverType = normalizeServerType(config?.serverType || platform?.type);
  const minecraftVersion = normalizeAddonVersion(platform?.minecraftVersion || config?.serverVersion);
  if (serverType !== 'fabric' || minecraftVersion !== '26.2') {
    return { checked: false, state: 'unsupported-profile' };
  }
  if (!await isRegularFile(PENDING_SMP_MOD_MANIFEST)) {
    return { checked: false, state: 'manifest-missing' };
  }

  await revalidate();
  if (serverProcess) throw new Error('Pending mods can only be applied before Minecraft starts.');
  const recovery = await recoverPendingModTransaction({
    profileRoot: paths.root,
    serverStopped: true
  });
  if (recovery?.state && recovery.state !== 'nothing-to-recover') {
    appendServerLog(`[Pending Mods] ${recovery.message || 'Recovered an interrupted mod transaction.'}\n`);
  }

  const lootrRetirement = await retireLootrBeforeStart({
    profileRoot: paths.root, config, serverStopped: true, revalidate
  });
  if (lootrRetirement.message) appendServerLog(`[Lootr] ${lootrRetirement.message}\n`);
  for (const name of lootrRetirement.retired || []) {
    await removeInstalledAddonMetadata(paths, 'mods', name);
  }

  await revalidate();
  const status = await getPendingModQueueStatus({
    profileRoot: paths.root,
    manifestPath: PENDING_SMP_MOD_MANIFEST
  });
  if (status?.state === 'not-downloaded') return { checked: true, state: 'not-downloaded' };
  if (!status?.ok) {
    throw new Error(status?.message || 'The pending Fabric mod queue is not ready.');
  }

  appendServerLog(
    '[Pending Mods] Verified ServerCore, Krypton, and spark are queued for the stopped server.\n'
  );
  await revalidate();
  if (serverProcess) throw new Error('Minecraft started while pending mods were being prepared. No queued mod was applied.');
  try {
    const result = await applyPendingModQueue({
      profileRoot: paths.root,
      manifestPath: PENDING_SMP_MOD_MANIFEST,
      serverStopped: true,
      optionalServerKeys: []
    });
    await revalidate();
    appendServerLog(`[Pending Mods] ${result.message || 'Pending Fabric mods verified.'}\n`);
    invalidateStatusCache();
    invalidateCachedWork(`disk-size:${paths.root}`);
    return { checked: true, ...result };
  } catch (error) {
    const friendly = friendlyPendingModError(error);
    throw new Error(friendly.message || error?.message || 'Pending mods could not be installed safely.');
  }
}

function startServer(options = {}) {
  if (seamlessRestartPromise && options?.seamlessRestartRequest?.owner !== seamlessRestartOwner) {
    return Promise.reject(new Error('A managed restart owns server startup. Wait for its update and player handoff to finish.'));
  }
  if (!options.safeModeRetryRequest || options.safeModeRetryRequest !== pendingSafeModeRetry) {
    cancelPendingSafeModeRetry();
  }
  try {
    assertServerStartAllowed();
  } catch (error) {
    return Promise.reject(error);
  }
  if (serverProcess) {
    if (serverState === 'stopping') return Promise.reject(new Error('The server is still stopping. Wait for it to finish.'));
    return serverStartupPromise || Promise.resolve({ state: serverState });
  }
  if (serverStartCoordinator.getActiveKey() === 'start') {
    if (pendingServerStart?.canceled) {
      return Promise.reject(new Error('The previous startup is still canceling. Wait for its preparation step to finish, then try again.'));
    }
    return serverStartCoordinator.run('start', () => ({ state: serverState }));
  }
  const request = { canceled: false };
  pendingServerStart = request;
  const operation = serverStartCoordinator.run('start', () => startServerOperation(options, request));
  return operation;
}

async function startServerOperation(options = {}, request = null) {
  try {
    assertServerStartContinues(request);
    setState('starting');
    return await startServerOperationInternal(options, request);
  } catch (error) {
    if (!serverProcess && (serverState === 'starting' || serverState === 'stopping')) {
      serverStartedAt = null;
      serverReadyGeneration = 0;
      setState('stopped');
    }
    if (request?.canceled || error?.code === 'SERVER_START_CANCELED') {
      return { state: 'stopped', ready: false, canceled: true };
    }
    if (!options?.seamlessRestartRequest && seamlessRuntimeProfileId && !seamlessMaintenanceArmed) {
      await stopSeamlessRestartSidecars().catch(sidecarError => {
        appendServerLog(`[Seamless Restart] Could not clean up the proxy stack after startup failed: ${sidecarError.message || String(sidecarError)}\n`);
      });
    }
    throw error;
  } finally {
    if (pendingServerStart === request) pendingServerStart = null;
  }
}

async function startServerOperationInternal(options = {}, request = null) {
  assertServerStartContinues(request);
  if (serverProcess) {
    if (serverState === 'stopping') throw new Error('The server is still stopping. Wait for it to finish.');
    return serverStartupPromise || { state: serverState };
  }
  const safeMode = Boolean(options.safeMode);
  let config = await readConfig();
  assertServerStartContinues(request);
  await assertLocalOnlyExposureStopped(config);
  assertServerStartContinues(request);
  const profile = await getActiveProfile();
  const paths = getPathsForProfile(profile);
  const startupProfileSnapshot = Object.freeze({ profileId: profile.id, paths });
  await assertNoPendingWorldReset(paths.root);
  const validateManagedRestartLaunch = () => {
    const restart = options.seamlessRestartRequest;
    if (!restart) return;
    assertSeamlessRestartTarget(restart.target, {
      profileId: profile.id, root: paths.root, worldName: validateWorldName(config.levelName || 'world')
    });
    assertSeamlessRestartBackendExited({
      previousPid: restart.previousPid,
      previousExited: hasChildExited(restart.previousProcess),
      previousPidAlive: processExists(restart.previousPid),
      currentBackendPresent: Boolean(serverProcess)
    });
  };
  validateManagedRestartLaunch();
  const revalidateStartupProfile = async () => {
    assertServerStartContinues(request);
    const result = await revalidateServerStartProfile(startupProfileSnapshot);
    assertServerStartContinues(request);
    return result;
  };
  ({ config } = await recoverInterruptedSeamlessRestartTransaction(paths, config, profile.id));
  assertServerStartContinues(request);
  await loadPlayerSpectateSessions(paths);
  assertServerStartContinues(request);
  const startupProtectionAdapter = getBundledProtectionAdapter(config.serverType, config.serverVersion);
  if (startupProtectionAdapter?.id === 'bukkit') {
    const protectionJars = getBundledProtectionJarPaths(paths, startupProtectionAdapter);
    if (await isRegularFile(protectionJars.current) && !await isRegularFile(protectionJars.legacy)) {
      await migrateLegacyBundledProtectionData(paths, { refreshMutable: true });
    }
  }
  const worldName = validateWorldName(config.levelName || 'world');
  const worldPath = resolveContainedPath(paths.root, path.join(paths.root, worldName));
  try {
    await fs.access(worldPath);
    config = await alignJarToWorldVersion(config, paths, worldPath);
  } catch (error) {
    if (String(error?.message || '').includes('SRV-WORLD-')) throw error;
    if (!String(config.seed || '').trim()) config.seed = generateSeed();
  }
  assertServerStartContinues(request);
  await writeConfig(config);
  assertServerStartContinues(request);
  await reconcileManagedBanFilesBeforeStartup(paths);
  assertServerStartContinues(request);
  const missing = getMissingStartSettings(config);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(', ')}`);
  const java = await resolveJava(config);
  assertServerStartContinues(request);
  if (!java.available) throw new Error(`Java was not found. Install Java ${MIN_JAVA_MAJOR}+ or set Java Path in Settings.`);
  if (java.major < MIN_JAVA_MAJOR) {
    throw new Error(`This Minecraft server jar needs Java ${MIN_JAVA_MAJOR}+. Current Java is ${java.version || 'too old'}.`);
  }
  if (java.path && config.javaPath !== java.path) {
    config.javaPath = java.path;
    await writeConfig(config);
    assertServerStartContinues(request);
  }
  try {
    await fs.access(config.jarPath);
  } catch {
    throw new Error('Server jar not found. Install the selected server platform or choose a custom server jar.');
  }
  const platform = await getServerPlatformStatus(config, paths);
  assertServerStartContinues(request);
  if (!platform.compatible) throw new Error(platform.message);
  if (!platform.verified && platform.message) appendServerLog(`[Server Manager] Platform warning: ${platform.message}\n`);
  await applyQueuedSmpModsBeforeStart({
    paths,
    config,
    platform,
    revalidate: revalidateStartupProfile
  });
  assertServerStartContinues(request);
  await retireUnsafeLavaSourceBeforeStart({
    paths,
    config,
    revalidate: revalidateStartupProfile
  });
  assertServerStartContinues(request);
  await applyQueuedWorldMapChangeBeforeStart(paths, revalidateStartupProfile);
  assertServerStartContinues(request);
  await refreshManagedBundledTeleportBeforeStartUnlocked({
    profileSnapshot: startupProfileSnapshot,
    paths,
    serverConfig: config,
    platform,
    revalidate: revalidateStartupProfile
  });
  assertServerStartContinues(request);
  await refreshManagedBundledProtectionBeforeStartUnlocked({
    profileSnapshot: startupProfileSnapshot,
    paths,
    serverConfig: config,
    platform,
    revalidate: revalidateStartupProfile
  });
  assertServerStartContinues(request);
  await refreshManagedDeathLootBeforeStartUnlocked({
    profileSnapshot: startupProfileSnapshot,
    paths,
    serverConfig: config,
    platform,
    revalidate: revalidateStartupProfile
  });
  assertServerStartContinues(request);
  await prepareDimensionLocksBeforeStart({ paths, serverConfig: config, platform, revalidate: revalidateStartupProfile });
  assertServerStartContinues(request);
  await prepareTeamsBeforeStart({ paths, serverConfig: config, platform, revalidate: revalidateStartupProfile });
  assertServerStartContinues(request);
  const startupProtectionConfig = await getProtectionConfig(paths);
  const startupResourceProtectionAdapter = getBundledProtectionAdapter(
    config.serverType,
    platform.minecraftVersion || config.serverVersion
  );
  const fabricAntiXrayEnabled = isFabricPacketAntiXrayConfigured(
    startupResourceProtectionAdapter,
    startupProtectionConfig
  );
  const plannedSeamlessRestart = getSeamlessRestartConfig(config);
  // Reserve only processes that still need to start. Reused lobby/proxy RAM is
  // already excluded from os.freemem(); Java's normal policy retains OS headroom.
  const pendingSidecarMemoryMb = seamlessSidecarMemoryReserveMb({
    enabled: plannedSeamlessRestart.enabled,
    lobbyMemoryMb: await isRegularFile(paths.seamlessRestartHoldingManifest) ? 1024 : 256,
    velocityRunning: Boolean(seamlessVelocityProcess && !hasChildExited(seamlessVelocityProcess)),
    limboRunning: Boolean(seamlessLimboProcess && !hasChildExited(seamlessLimboProcess))
  });
  const startupResourcePlan = planMinecraftStartupResources(config, {
    fabricAntiXrayEnabled,
    totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
    freeMemoryMb: Math.max(0, Math.floor(os.freemem() / 1024 / 1024) - pendingSidecarMemoryMb)
  });
  if (!startupResourcePlan.canStart) {
    throw new Error(
      fabricAntiXrayEnabled
        ? `Fabric Anti-Xray needs at least ${startupResourcePlan.requiredMemoryMb} MB of safely available server memory. ` +
          'Close memory-heavy apps or disable packet Anti-Xray before starting; Click Interval will not risk another heap stall.'
        : 'Minecraft does not have enough safely available memory to start.'
    );
  }
  appendServerLog(
    `[Server Manager SRV-PERF-200] Startup resources: heap=${config.memoryMb} MB, ` +
      `view-distance=${config.viewDistance}, simulation-distance=${config.simulationDistance}, ` +
      `Fabric packet Anti-Xray=${fabricAntiXrayEnabled ? 'enabled' : 'disabled'}, ` +
      `restart-sidecar-reserve=${pendingSidecarMemoryMb} MB.\n`
  );
  assertServerStartContinues(request);
  let seamlessRuntime = { enabled: false, config: plannedSeamlessRestart };
  if (plannedSeamlessRestart.enabled) {
    const rconPort = await readConfiguredRconPort(paths, config);
    if (rconPort && [
      plannedSeamlessRestart.proxyPort,
      plannedSeamlessRestart.backendPort,
      plannedSeamlessRestart.limboPort
    ].includes(rconPort)) {
      throw new Error(`RCON port ${rconPort} collides with the seamless-restart backend stack. Stop Minecraft and run /silent-restart setup again.`);
    }
    await assertTcpEndpointAvailable(
      plannedSeamlessRestart.backendHost,
      plannedSeamlessRestart.backendPort,
      'Backend port'
    );
    assertServerStartContinues(request);
    seamlessRuntime = await startSeamlessRestartSidecars({ profile, paths, config, platform, java });
  } else {
    await assertConfiguredServerPortAvailable(config);
  }
  assertServerStartContinues(request);
  const voicePreparation = await prepareSimpleVoiceNetworkForStartup({ profile, paths, config });
  config = voicePreparation.config;
  assertServerStartContinues(request);
  await prepareBundledVoiceNetworkForStartup({ paths, config, platform });
  assertServerStartContinues(request);
  const runtimeProtectionAdapter = getBundledProtectionAdapter(
    config.serverType,
    platform.minecraftVersion || config.serverVersion
  );
  const args = await buildServerJavaArgs(config, paths, safeMode);
  assertServerStartContinues(request);
  const finalEffectiveMemoryMb = Number(serverEffectiveMemoryMb) || 0;
  if (fabricAntiXrayEnabled && finalEffectiveMemoryMb < startupResourcePlan.requiredMemoryMb) {
    serverEffectiveMemoryMb = null;
    throw new Error(
      `Fabric Anti-Xray needs at least ${startupResourcePlan.requiredMemoryMb} MB of safely available server memory. ` +
      `The final pre-launch memory check could allocate only ${finalEffectiveMemoryMb} MB, so Java was not started. ` +
      'Close memory-heavy apps or disable packet Anti-Xray and try again.'
    );
  }
  if (fabricAntiXrayEnabled && finalEffectiveMemoryMb < startupResourcePlan.recommendedMemoryMb) {
    appendServerLog(
      `[Server Manager SRV-PERF-201] Fabric packet Anti-Xray is running at its supported ` +
      `${startupResourcePlan.requiredMemoryMb} MB floor. ` +
      `${startupResourcePlan.recommendedMemoryMb} MB is recommended for simultaneous fresh-chunk exploration ` +
      `at view-distance ${config.viewDistance}; Click Interval will keep the owner's distance settings unchanged.\n`
    );
  }
  if (safeMode) {
    appendServerLog(
      '[Server Manager SRV-WORLD-201] Starting Minecraft in safe mode\n' +
      '  Reason: The previous startup failed while loading datapacks/worldgen data.\n' +
      '  Result: Minecraft will ignore custom datapacks for this launch and try vanilla recovery.\n'
    );
  }
  lastServerError = '';
  serverStartedAt = Date.now();
  protectionLogRemainder = '';
  seamlessFabricProxyLiteLoaded = false;
  playerLogRemainder = '';
  lastPlayerRosterProbeAt = 0;
  lastPlayerRosterAuthoritativeAt = 0;
  playerInspectionLogRemainder = '';
  playerPoseLogRemainder = '';
  chatHistory.length = 0;
  chatLogRemainder = '';
  chatHistoryHydrated = false;
  nativeWorldMapSnapshotCache = { file: '', mtimeMs: -1, size: -1, value: null };
  nativeWorldMapTerrainReader.clear();
  runtimeGameRulesUnsupported = false;
  lastGameRuleDiagnosticSignature = '';
  lastPvpProtectionSignature = '';
  deferredRuntimeSettings = null;
  pvpTeamProvisioned = false;
  provisionedAccessTeams.clear();
  serverReadyGeneration = 0;
  pendingRuntimeGameRuleBatch = null;
  let datapackLoadFailed = false;
  let processRef;
  try {
    assertServerStartAllowed();
    assertServerStartContinues(request);
    validateManagedRestartLaunch();
    processRef = await launchPersistentProcess({
      role: 'minecraft-server',
      executable: java.path || config.javaPath || 'java',
      args,
      cwd: paths.root,
      statePath: paths.persistentServerState,
      metadata: {
        profileId: startupProfileSnapshot.profileId,
        port: Number(config.port) || 25565,
        startedAt: new Date(serverStartedAt).toISOString(),
        effectiveMemoryMb: finalEffectiveMemoryMb
      }
    });
    try {
      assertServerStartContinues(request);
    } catch (error) {
      await stopUnadoptedPersistentProcess(processRef, 'stop');
      throw error;
    }
  } catch (error) {
    serverEffectiveMemoryMb = null;
    lastServerError = summarizeServerStartupFailure('', error, null, null, config);
    appendServerLog(`[Server Manager SRV-START-500] Server failed to start: ${lastServerError}\n`);
    serverStartedAt = null;
    setState('stopped');
    throw new Error(lastServerError);
  }
  const generation = ++serverLifecycleGeneration;
  stopRequestedGeneration = 0;
  serverProcess = processRef;
  const lifecycleContext = Object.freeze({
    processRef,
    generation,
    profileId: startupProfileSnapshot.profileId,
    paths
  });
  protectionRuntimeHandshake = runtimeProtectionAdapter
    ? beginProtectionRuntimeLifecycle(protectionRuntimeHandshake, {
        generation,
        adapterId: runtimeProtectionAdapter.id,
        expectedCheckCount: isBundledFabricProtectionAdapter(runtimeProtectionAdapter)
          ? Object.keys(PROTECTION_CHECKS).length
          : null,
        now: Date.now()
      })
    : createProtectionRuntimeHandshake();
  try {
    const normal = os.constants?.priority?.PRIORITY_NORMAL;
    os.setPriority(processRef.pid, Number.isFinite(normal) ? normal : 0);
  } catch {}
  processRef.stdin?.on?.('error', (error) => {
    if (serverProcess === processRef) {
      appendServerLog(`[Server Manager SRV-CONSOLE-502] Server console write failed: ${error.message || String(error)}\n`);
    }
  });
  let startupOutput = '';
  let startupSettled = false;
  let processFinished = false;
  let socketListeningAnnounced = false;
  let resolveStartup;
  let rejectStartup;
  const startupPromise = new Promise((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  serverStartupPromise = startupPromise;

  let readinessPollBusy = false;
  const readinessPoll = setInterval(async () => {
    if (readinessPollBusy || !socketListeningAnnounced || serverProcess !== processRef || serverState !== 'starting') return;
    readinessPollBusy = true;
    try {
      const readinessPort = seamlessRuntime.enabled
        ? seamlessRuntime.config.backendPort
        : (Number(config.port) || 25565);
      if (await queryMinecraftStatus('127.0.0.1', readinessPort)) markReady('socket');
    } finally {
      readinessPollBusy = false;
    }
  }, 750);
  readinessPoll.unref?.();

  const startupTimeout = setTimeout(() => {
    if (startupSettled || serverProcess !== processRef) return;
    const error = new Error('Minecraft did not become ready within 10 minutes. Open Console for the final startup messages.');
    lastServerError = error.message;
    appendServerLog(`[Server Manager SRV-START-504] ${error.message}\n`);
    startupSettled = true;
    rejectStartup(error);
    stopServer(options.seamlessRestartRequest
      ? { preserveRestart: true, preserveSeamless: true, seamlessRestartOwner: options.seamlessRestartRequest.owner } : {}).catch((stopError) => {
      appendServerLog(`[Server Manager SRV-STOP-500] Timed-out startup could not be stopped: ${stopError.message || String(stopError)}\n`);
    });
  }, SERVER_START_TIMEOUT_MS);
  startupTimeout.unref?.();

  function clearStartupWatchers() {
    clearInterval(readinessPoll);
    clearTimeout(startupTimeout);
  }

  function markReady(source) {
    // A listening/status socket can precede completed world loading. Never send
    // parked players back until the managed replacement emits its Done marker.
    if (!isSeamlessRestartReadinessSource(source, Boolean(options.seamlessRestartRequest))) return;
    if (!canMarkServerReady(
      startupSettled,
      serverProcess === processRef,
      generation === serverLifecycleGeneration,
      serverState,
      stopRequestedGeneration === generation
    )) return;
    startupSettled = true;
    clearStartupWatchers();
    serverReadyGeneration = generation;
    lastServerError = '';
    setState('running');
    requestPlayerRosterSync(true);
    retryReadyPlayerSpectateRecovery(lifecycleContext)
      .catch((error) => appendPlayerViewRecoveryError('after server readiness', error));
    appendServerLog(`[Server Manager SRV-START-200] Server ready${source === 'socket' ? ' (port accepted connections)' : ''}.\n`);
    Promise.resolve().then(async () => {
      if (!await revalidateServerLifecycleContext(lifecycleContext)) return;
      const latestConfig = await readConfig(paths);
      if (!await revalidateServerLifecycleContext(lifecycleContext)) return;
      if (voicePreparation.active) {
        verifySimpleVoiceUdpListenerAfterStartup({
          paths,
          metadata: voicePreparation.metadata,
          generation,
          processRef
        }).catch((error) => {
          appendServerLog(`[Server Manager SRV-VOICE-402] Voice UDP verification failed: ${error.message || String(error)}\n`);
        });
      }
      if (!isCurrentServerLifecycleContext(lifecycleContext)) return;
      applyRuntimeGameRules(latestConfig, 'startup');
      if (!isCurrentServerLifecycleContext(lifecycleContext)) return;
      await applyRuntimePvpProtection(latestConfig, 'startup', { paths });
      if (!await revalidateServerLifecycleContext(lifecycleContext)) return;
      await applyManagedBansAtStartup(lifecycleContext);
      if (!await revalidateServerLifecycleContext(lifecycleContext)) return;
      if (latestConfig.directHostingEnabled) {
        refreshDirectHostingForLifecycle(lifecycleContext).catch((error) => {
          appendServerLog(`[Server Manager] Direct hosting refresh failed: ${error.message || String(error)}\n`);
        });
      }
    }).catch((error) => {
      appendServerLog(`[Server Manager SRV-CFG-500] Could not apply startup settings: ${error.message || String(error)}\n`);
    });
    resolveStartup({ state: 'running', ready: true });
  }

  const serverOutputIngress = new BoundedChunkQueue(
    MAX_SERVER_OUTPUT_PENDING_CHARS,
    MAX_SERVER_OUTPUT_PENDING_CHUNKS
  );
  let serverOutputIngressTimer = null;
  let serverOutputIngressPaused = false;
  let serverOutputParseDropped = 0;

  function boundedServerOutputText(data) {
    const marker = '\n[Server Manager] Oversized process output was trimmed before parsing.\n';
    if (Buffer.isBuffer(data)) {
      if (data.length <= MAX_SERVER_OUTPUT_CHUNK_CHARS) return { text: data.toString(), dropped: 0 };
      const headLength = 8 * 1024;
      const tailLength = Math.max(1, MAX_SERVER_OUTPUT_CHUNK_CHARS - headLength - marker.length);
      return {
        text: `${data.subarray(0, headLength).toString()}${marker}${data.subarray(-tailLength).toString()}`,
        dropped: Math.max(0, data.length - headLength - tailLength)
      };
    }
    const value = String(data ?? '');
    if (value.length <= MAX_SERVER_OUTPUT_CHUNK_CHARS) return { text: value, dropped: 0 };
    const headLength = 8 * 1024;
    const tailLength = Math.max(1, MAX_SERVER_OUTPUT_CHUNK_CHARS - headLength - marker.length);
    return {
      text: `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`,
      dropped: Math.max(0, value.length - headLength - tailLength)
    };
  }

  function setServerOutputPaused(paused) {
    if (serverOutputIngressPaused === paused) return;
    serverOutputIngressPaused = paused;
    for (const stream of [processRef.stdout, processRef.stderr]) {
      try {
        if (paused) stream?.pause?.();
        else stream?.resume?.();
      } catch {}
    }
  }

  function processOutputText(line, isError = false) {
    noteRuntimeGameRuleOutput(line);
    startupOutput = `${startupOutput}${line}`.slice(-65_536);
    if (!seamlessFabricProxyLiteLoaded && isFabricProxyLiteReadyLog(startupOutput)) {
      seamlessFabricProxyLiteLoaded = true;
      invalidateStatusCache();
    }
    if (/Starting Minecraft server on/i.test(line)) socketListeningAnnounced = true;
    if (/Failed to load datapacks|No key dimensions|No key seed|reset to vanilla with --safeMode/i.test(line)) {
      datapackLoadFailed = true;
    }
    if (!isError) processPlayerLogEvents(line);
    if (!isError) notePlayerInspectionOutput(line);
    if (!isError) notePlayerPoseOutput(line);
    processProtectionLogEvents(line, {
      generation,
      adapterId: runtimeProtectionAdapter?.id || ''
    });
    if (!processFinished && isServerReadyOutput(startupOutput)) markReady('marker');
  }

  function scheduleServerOutputIngress() {
    if (serverOutputIngressTimer || processFinished) return;
    serverOutputIngressTimer = setTimeout(() => drainServerOutputIngress(false), SERVER_OUTPUT_PROCESS_DELAY_MS);
    serverOutputIngressTimer.unref?.();
  }

  function drainServerOutputIngress(finalDrain) {
    if (serverOutputIngressTimer) clearTimeout(serverOutputIngressTimer);
    serverOutputIngressTimer = null;
    if (finalDrain) {
      serverOutputParseDropped += serverOutputIngress.retainLatest(SERVER_OUTPUT_FINAL_BUDGET_CHARS);
    }
    if (serverOutputParseDropped) {
      appendServerLog(
        `[Server Manager] ${serverOutputParseDropped.toLocaleString('en-US')} process-output characters were skipped by background parsers to keep the app responsive. The newest output was retained.\n`
      );
      serverOutputParseDropped = 0;
    }
    const budget = finalDrain ? SERVER_OUTPUT_FINAL_BUDGET_CHARS : SERVER_OUTPUT_PROCESS_BUDGET_CHARS;
    for (const chunk of serverOutputIngress.drain(budget)) {
      processOutputText(chunk.text, Boolean(chunk.metadata?.isError));
    }
    if (serverOutputIngress.length <= SERVER_OUTPUT_RESUME_CHARS) setServerOutputPaused(false);
    if (finalDrain) {
      serverOutputIngress.clear();
      return;
    }
    if (serverOutputIngress.length) scheduleServerOutputIngress();
  }

  function enqueueServerOutput(data, isError = false) {
    const bounded = boundedServerOutputText(data);
    if (!bounded.text) return;
    appendServerLog(bounded.text);
    if (processFinished) return;
    serverOutputParseDropped += bounded.dropped;
    serverOutputParseDropped += serverOutputIngress.append(bounded.text, { isError });
    if (serverOutputIngress.length >= SERVER_OUTPUT_PAUSE_CHARS) setServerOutputPaused(true);
    scheduleServerOutputIngress();
  }

  processRef.stdout.on('data', (data) => enqueueServerOutput(data, false));
  processRef.stderr.on('data', (data) => enqueueServerOutput(data, true));
  serverProcessFinalizers.set(processRef, handleProcessFinished);
  processRef.on('error', (error) => {
    if (serverProcess !== processRef) return;
    const intentionalStop = stopRequestedGeneration === generation || serverState === 'stopping';
    if (!intentionalStop) {
      lastServerError = summarizeServerStartupFailure(startupOutput, error, null, null, config);
      appendServerLog(`[Server Manager SRV-START-500] Server failed to start: ${lastServerError}\n`);
    }
    if (!startupSettled) {
      startupSettled = true;
      clearStartupWatchers();
      if (intentionalStop) resolveStartup({ state: 'stopped', ready: false, canceled: true });
      else rejectStartup(new Error(lastServerError));
    }
    // A failed spawn is terminal even on runtimes that omit the usual follow-up close event.
    if (!processRef.pid || hasChildExited(processRef)) handleProcessFinished(processRef.exitCode, processRef.signalCode || 'SPAWN_ERROR');
  });
  function handleProcessFinished(code, signal) {
    if (processFinished) return;
    processFinished = true;
    serverProcessFinalizers.delete(processRef);
    if (pendingAnnouncedServerShutdown?.processRef === processRef) {
      if (pendingAnnouncedServerShutdown.timer) clearTimeout(pendingAnnouncedServerShutdown.timer);
      pendingAnnouncedServerShutdown.canceled = true;
      pendingAnnouncedServerShutdown = null;
    }
    const ownedLifecycle = serverProcess === processRef && generation === serverLifecycleGeneration;
    drainServerOutputIngress(true);
    appendServerLog(`Server exited (${signal || code}).\n`);
    clearStartupWatchers();
    const stoppedBeforeReady = serverReadyGeneration !== generation;
    const intentionalStop = stopRequestedGeneration === generation || serverState === 'stopping';
    if (stoppedBeforeReady && !startupSettled) {
      startupSettled = true;
      if (intentionalStop) {
        resolveStartup({ state: 'stopped', ready: false, canceled: true });
      } else {
        lastServerError = summarizeServerStartupFailure(startupOutput, null, code, signal, config);
        appendServerLog(`[Server Manager SRV-START-500] Server failed to start: ${lastServerError}\n`);
        rejectStartup(new Error(lastServerError));
      }
    } else if (!intentionalStop && ownedLifecycle) {
      lastServerError = summarizeServerStartupFailure(startupOutput, null, code, signal, config);
      appendServerLog(`[Server Manager SRV-RUN-500] Server stopped unexpectedly: ${lastServerError}\n`);
      if (seamlessRuntime.enabled && !seamlessMaintenanceArmed) {
        void stopSeamlessRestartSidecars().catch(error => {
          appendServerLog(`[Seamless Restart] Proxy cleanup after the backend stopped failed: ${error.message || String(error)}\n`);
        });
      }
    }
    if (serverProcess === processRef) {
      if (playerLogRemainder) processPlayerLogEvents('\n');
      if (protectionLogRemainder) processProtectionLogEvents('\n', {
        generation,
        adapterId: runtimeProtectionAdapter?.id || ''
      });
      if (runtimeProtectionAdapter) {
        protectionRuntimeHandshake = endProtectionRuntimeLifecycle(protectionRuntimeHandshake, {
          generation,
          adapterId: runtimeProtectionAdapter.id,
          now: Date.now()
        });
        cachedStatus = null;
        settleProtectionRuntimeReloadWaiter(protectionRuntimeHandshake);
      }
      serverProcess = null;
      seamlessFabricProxyLiteLoaded = false;
      serverEffectiveMemoryMb = null;
      serverStartedAt = null;
      serverReadyGeneration = 0;
      protectionLogRemainder = '';
      playerLogRemainder = '';
      playerInspectionLogRemainder = '';
      playerPoseLogRemainder = '';
      for (const key of [...playerInspectionRequests.keys()]) {
        clearPlayerInspectionRequest(key, new Error('The server stopped while loading player details.'));
      }
      for (const key of [...playerPoseRequests.keys()]) {
        clearPlayerPoseRequest(key, new Error('The server stopped during player-view recovery.'));
      }
      deferredRuntimeSettings = null;
      pvpTeamProvisioned = false;
      provisionedAccessTeams.clear();
      if (pendingRuntimeGameRuleBatch?.timer) clearTimeout(pendingRuntimeGameRuleBatch.timer);
      pendingRuntimeGameRuleBatch = null;
      setState('stopped');
    }
    if (ownedLifecycle && datapackLoadFailed && !safeMode && !intentionalStop && !options.seamlessRestartRequest) {
      appendServerLog(
        '[Server Manager SRV-WORLD-101] World/datapack load failed\n' +
        '  Meaning: Minecraft rejected the current world data or datapack worldgen settings.\n' +
        '  Action: Retrying once with --safeMode.\n'
      );
      scheduleSafeModeRetry(lifecycleContext);
    } else if (ownedLifecycle && datapackLoadFailed && safeMode) {
      appendServerLog(
        '[Server Manager SRV-WORLD-501] Safe-mode startup still failed\n' +
        '  Next step: restore a world backup or create/switch to a new world. The active world level.dat/datapack state is not loadable by this server jar.\n'
      );
    }
  }
  processRef.on('exit', handleProcessFinished);
  processRef.on('close', handleProcessFinished);
  try {
    return await startupPromise;
  } finally {
    if (serverStartupPromise === startupPromise) serverStartupPromise = null;
  }
}

function getMissingStartSettings(config) {
  const missing = [];
  if (!String(config.levelName || '').trim()) missing.push('World Name');
  if (!Number(config.port)) missing.push('Port');
  if (!Number(config.memoryMb)) missing.push('Memory');
  if (!String(config.javaPath || '').trim()) missing.push('Java Path');
  if (!String(config.serverVersion || '').trim()) missing.push('Minecraft Version');
  if (!config.acceptEula) missing.push('EULA');
  return missing;
}

function normalizeAnnouncedServerShutdownMessage(value) {
  const message = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (message.length > SERVER_ANNOUNCED_SHUTDOWN_MESSAGE_MAX_LENGTH) {
    throw new Error(`Shutdown messages must be ${SERVER_ANNOUNCED_SHUTDOWN_MESSAGE_MAX_LENGTH} characters or fewer.`);
  }
  return message;
}

function parseAnnouncedServerShutdownArgs(args = []) {
  const parts = [...args].map((value) => String(value));
  let countdownSeconds = 0;
  const first = parts[0] || '';
  if (/^\d+$/.test(first)) {
    countdownSeconds = Number(first);
    parts.shift();
  } else if (/^[+-]?\d/.test(first)) {
    throw new Error(`Shutdown countdown must be a whole number from 0 to ${SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS} seconds.`);
  }
  if (!Number.isSafeInteger(countdownSeconds) || countdownSeconds < 0 || countdownSeconds > SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS) {
    throw new Error(`Shutdown countdown must be a whole number from 0 to ${SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS} seconds.`);
  }
  return {
    countdownSeconds,
    message: normalizeAnnouncedServerShutdownMessage(parts.join(' '))
  };
}

function formatAnnouncedServerShutdownText(seconds, message = '') {
  const remaining = Math.max(0, Math.floor(Number(seconds) || 0));
  const timing = remaining > 0
    ? `Server shutting down in ${remaining} second${remaining === 1 ? '' : 's'}.`
    : 'Server shutting down now.';
  return message ? `${timing} ${message}` : timing;
}

function getAnnouncedServerShutdownStatus(now = Date.now()) {
  const request = pendingAnnouncedServerShutdown;
  if (!request) return { pending: false, remainingSeconds: 0, message: '' };
  return {
    pending: true,
    committed: Boolean(request.committed),
    remainingSeconds: request.committed ? 0 : Math.max(0, Math.ceil((request.dueAt - now) / 1000)),
    message: request.message
  };
}

function sendAnnouncedServerShutdownMessage(processRef, seconds, message) {
  const text = formatAnnouncedServerShutdownText(seconds, message);
  const component = JSON.stringify({ text, color: 'yellow' });
  if (!tryWriteServerInput(processRef, `tellraw @a ${component}`)) {
    throw new Error('The server console is unavailable, so the shutdown message could not be delivered.');
  }
}

function cancelPendingAnnouncedServerShutdown(options = {}) {
  const request = pendingAnnouncedServerShutdown;
  if (!request || request.committed) return false;
  request.canceled = true;
  if (request.timer) clearTimeout(request.timer);
  request.timer = null;
  pendingAnnouncedServerShutdown = null;
  if (options.log !== false) appendServerLog('[Server Console] Scheduled shutdown canceled.\n');
  return true;
}

async function finishAnnouncedServerShutdown(request) {
  if (pendingAnnouncedServerShutdown !== request || request.canceled) return;
  if (serverProcess !== request.processRef || hasChildExited(request.processRef)) {
    cancelPendingAnnouncedServerShutdown({ log: false });
    return;
  }
  request.committed = true;
  request.timer = null;
  let messageSent = false;
  try {
    sendAnnouncedServerShutdownMessage(request.processRef, 0, request.message);
    messageSent = true;
  } catch (error) {
    appendServerLog(`[Server Manager SRV-STOP-ANNOUNCE] ${error.message || String(error)} Continuing with shutdown.\n`);
  }
  // Give Minecraft at least one console/network turn to dispatch the final tellraw before
  // its orderly stop closes player connections. This delay is deliberately short and is
  // skipped when the announcement could not be queued.
  if (messageSent) {
    await new Promise((resolve) => setTimeout(resolve, SERVER_ANNOUNCED_SHUTDOWN_DELIVERY_DELAY_MS));
  }
  if (pendingAnnouncedServerShutdown !== request || request.canceled) return;
  if (serverProcess !== request.processRef || hasChildExited(request.processRef)) {
    if (pendingAnnouncedServerShutdown === request) pendingAnnouncedServerShutdown = null;
    return;
  }
  appendServerLog('[Server Console] Announced shutdown countdown finished; stopping Minecraft.\n');
  try {
    await stopServer({ announcedShutdownRequest: request });
  } catch (error) {
    appendServerLog(`[Server Manager SRV-STOP-500] Scheduled shutdown failed: ${error.message || String(error)}\n`);
    throw error;
  } finally {
    if (pendingAnnouncedServerShutdown === request) pendingAnnouncedServerShutdown = null;
  }
}

function scheduleNextAnnouncedServerShutdownCheckpoint(request) {
  if (pendingAnnouncedServerShutdown !== request || request.canceled || request.committed) return;
  const seconds = request.checkpoints.shift();
  if (seconds === undefined) return;
  const delayMs = Math.max(0, request.dueAt - (seconds * 1000) - Date.now());
  request.timer = setTimeout(() => {
    request.timer = null;
    if (pendingAnnouncedServerShutdown !== request || request.canceled || request.committed) return;
    if (serverProcess !== request.processRef || hasChildExited(request.processRef)) {
      cancelPendingAnnouncedServerShutdown({ log: false });
      return;
    }
    const remainingMs = request.dueAt - Date.now();
    if (remainingMs <= 0) {
      void finishAnnouncedServerShutdown(request).catch(() => {});
      return;
    }
    if (seconds === 0) {
      // A wall-clock correction can make a previously scheduled deadline fire early.
      request.checkpoints.unshift(0);
      scheduleNextAnnouncedServerShutdownCheckpoint(request);
      return;
    }
    const actualSeconds = Math.max(1, Math.min(seconds, Math.ceil(remainingMs / 1000)));
    // If the event loop was stalled or the computer slept, discard milestones that are
    // already in the past instead of flooding players with stale warnings back-to-back.
    while (request.checkpoints[0] > 0 && request.checkpoints[0] >= actualSeconds) {
      request.checkpoints.shift();
    }
    try {
      sendAnnouncedServerShutdownMessage(request.processRef, actualSeconds, request.message);
    } catch (error) {
      appendServerLog(`[Server Manager SRV-STOP-ANNOUNCE] ${error.message || String(error)}\n`);
    }
    scheduleNextAnnouncedServerShutdownCheckpoint(request);
  }, delayMs);
  request.timer.unref?.();
}

async function requestAnnouncedServerShutdown(options = {}) {
  const countdownSeconds = options.countdownSeconds === undefined ? 0 : Number(options.countdownSeconds);
  if (!Number.isSafeInteger(countdownSeconds) || countdownSeconds < 0 || countdownSeconds > SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS) {
    throw new Error(`Shutdown countdown must be a whole number from 0 to ${SERVER_ANNOUNCED_SHUTDOWN_MAX_SECONDS} seconds.`);
  }
  const message = normalizeAnnouncedServerShutdownMessage(options.message);
  if (!serverProcess) return { state: 'stopped', scheduled: false, alreadyStopped: true };
  if (!isServerRuntimeReady()) {
    throw new Error('Wait for the Minecraft server to finish starting before announcing a shutdown. Use plain stop to cancel startup.');
  }
  if (pendingAnnouncedServerShutdown) {
    const status = getAnnouncedServerShutdownStatus();
    throw new Error(`A shutdown is already ${status.committed ? 'in progress' : `scheduled in ${status.remainingSeconds} seconds`}. Use shutdown cancel first.`);
  }

  const processRef = serverProcess;
  const request = {
    processRef,
    message,
    dueAt: Date.now() + (countdownSeconds * 1000),
    checkpoints: SERVER_ANNOUNCED_SHUTDOWN_MILESTONES.filter((seconds) => seconds < countdownSeconds).concat(0),
    timer: null,
    canceled: false,
    committed: false
  };
  pendingAnnouncedServerShutdown = request;
  try {
    if (countdownSeconds > 0) {
      sendAnnouncedServerShutdownMessage(processRef, countdownSeconds, message);
      scheduleNextAnnouncedServerShutdownCheckpoint(request);
      appendServerLog(`[Server Console] Shutdown scheduled in ${countdownSeconds} seconds${message ? `: ${message}` : '.'}\n`);
      return { state: 'running', scheduled: true, countdownSeconds, message };
    }
    await finishAnnouncedServerShutdown(request);
    return { state: 'stopped', scheduled: false, countdownSeconds: 0, message };
  } catch (error) {
    if (pendingAnnouncedServerShutdown === request && !request.committed) {
      cancelPendingAnnouncedServerShutdown({ log: false });
    }
    throw error;
  }
}

function requestGracefulServerStop(processRef) {
  const restorable = [...playerSpectateSessions]
    .map(([viewerKey, session]) => [livePlayers.get(viewerKey), session])
    .filter(([viewer]) => Boolean(viewer));
  const commands = restorable.flatMap(([viewer, session]) => buildStopPlayerSpectateCommands(viewer, session.origin));
  return tryWriteServerInput(processRef, `${commands.length ? `${commands.join('\n')}\n` : ''}stop`);
}

async function stopOwnedServerProcess(
  processRef,
  gracefulTimeoutMs = SERVER_STOP_GRACE_TIMEOUT_MS,
  forceTimeoutMs = SERVER_STOP_FORCE_TIMEOUT_MS,
  options = {}
) {
  let exited = hasChildExited(processRef);
  if (!exited && requestGracefulServerStop(processRef)) {
    exited = await waitForChildExit(processRef, gracefulTimeoutMs);
  }
  if (!exited) {
    if (options.requireGraceful === true) {
      appendServerLog('[Seamless Restart] Minecraft has not finished its graceful world save/stop; restart canceled without forced termination.\n');
      return false;
    }
    appendServerLog('[Server Manager SRV-STOP-201] Graceful stop timed out or the console was unavailable; terminating the Java process.\n');
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, forceTimeoutMs);
  }
  return exited;
}

function recoverServerStateAfterFailedStop(processRef) {
  if (serverProcess !== processRef || hasChildExited(processRef)) return 'stopped';
  return serverReadyGeneration > 0 && serverReadyGeneration === serverLifecycleGeneration
    ? 'running'
    : 'starting';
}

function stopServer(options = {}) {
  if (seamlessRestartPromise && options?.seamlessRestartOwner !== seamlessRestartOwner) {
    return Promise.reject(new Error('A managed restart owns the save/update boundary. Wait for it to finish before stopping.'));
  }
  if (pendingAnnouncedServerShutdown && options?.announcedShutdownRequest !== pendingAnnouncedServerShutdown) {
    cancelPendingAnnouncedServerShutdown({ log: false });
  }
  if (options?.preserveRestart !== true) cancelPendingServerRestart();
  cancelPendingSafeModeRetry();
  if (serverStopPromise) return serverStopPromise;
  protectionLogRemainder = '';
  playerLogRemainder = '';

  if (!serverProcess) {
    const startRequest = pendingServerStart;
    if (!startRequest) {
      setState('stopped');
      if (options?.preserveSeamless === true) return Promise.resolve({ state: 'stopped' });
      return stopSeamlessRestartSidecars().then(() => ({ state: 'stopped' }));
    }
    startRequest.canceled = true;
    setState('stopping');
    let trackedCancellation;
    trackedCancellation = serverStartCoordinator.run('start', () => ({ state: 'stopped', canceled: true }))
      .then(async () => {
        if (serverProcess) {
          throw new Error('Minecraft started while its startup cancellation was settling. Press Stop again.');
        }
        setState('stopped');
        if (options?.preserveSeamless !== true) await stopSeamlessRestartSidecars();
        return { state: 'stopped', canceledStart: true };
      })
      .finally(() => {
        if (serverStopPromise === trackedCancellation) serverStopPromise = null;
      });
    serverStopPromise = trackedCancellation;
    return trackedCancellation;
  }

  const processRef = serverProcess;
  stopRequestedGeneration = serverLifecycleGeneration;
  setState('stopping');

  // Persist protection events independently; disk latency must never hold the Java stop command hostage.
  Promise.allSettled([...protectionIncidentQueues.keys()].map((key) => flushProtectionIncidentQueue(key)))
    .catch(() => {});

  let trackedStop;
  trackedStop = Promise.resolve().then(async () => {
    const exited = await stopOwnedServerProcess(processRef, undefined, undefined, options);
    if (!exited) {
      const error = new Error(options.requireGraceful === true
        ? 'Minecraft has not completed its graceful save/stop. Players remain parked; no replacement backend was started.'
        : 'Minecraft did not exit after the stop command. You can retry Stop; if it still does not exit, close the Java process.');
      lastServerError = error.message;
      appendServerLog(`[Server Manager SRV-STOP-500] ${error.message}\n`);
      if (serverProcess === processRef && options.requireGraceful !== true) {
        stopRequestedGeneration = 0;
        setState(recoverServerStateAfterFailedStop(processRef));
      }
      throw error;
    }
    if (serverProcess === processRef) {
      // Let the child's exit/close handler perform the full runtime cleanup first.
      // The fallback below is only for an abnormal child that updated its exit fields without emitting either event.
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (serverProcess === processRef) {
      const finalizeProcess = serverProcessFinalizers.get(processRef);
      if (finalizeProcess) {
        finalizeProcess(processRef.exitCode, processRef.signalCode || 'STOP_FALLBACK');
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    if (serverProcess === processRef) {
      // Test doubles and pre-handler failures have no registered finalizer and no startup promise to settle.
      // Real spawned children always use the finalizer above so startup callers cannot be stranded.
      serverProcessFinalizers.delete(processRef);
      serverProcess = null;
      serverEffectiveMemoryMb = null;
      serverStartedAt = null;
      serverReadyGeneration = 0;
      setState('stopped');
    }
    if (options?.preserveSeamless !== true) await stopSeamlessRestartSidecars();
    return { state: 'stopped' };
  }).catch((error) => {
    if (serverProcess === processRef && serverState === 'stopping' && options.requireGraceful !== true) {
      stopRequestedGeneration = 0;
      lastServerError = error?.message || String(error);
      appendServerLog(`[Server Manager SRV-STOP-500] ${lastServerError}\n`);
      setState(recoverServerStateAfterFailedStop(processRef));
    }
    throw error;
  }).finally(() => {
    if (serverStopPromise === trackedStop) serverStopPromise = null;
  });
  serverStopPromise = trackedStop;
  return trackedStop;
}

async function stopServerAndWait(options = {}) {
  await stopServer(options);
}

function restartServer() {
  if (seamlessRestartPromise) return Promise.reject(new Error('A managed restart is already in progress.'));
  if (pendingServerRestart) return pendingServerRestart.promise;
  cancelPendingSafeModeRetry();
  const request = { canceled: false, profileId: '', promise: null };
  let operation;
  operation = Promise.resolve().then(async () => {
    const profile = await getActiveProfile();
    request.profileId = profile?.id || '';
    if (!request.profileId) throw new Error('Create or select a server before restarting it.');
    if (serverProcess || pendingServerStart || serverStopPromise) {
      await stopServerAndWait({ preserveRestart: true });
    }
    if (request.canceled) return { state: 'stopped', canceled: true };
    assertApplicationAllowsOwnedChildStart('the Minecraft server');
    const currentProfile = await getActiveProfile();
    if (request.canceled || currentProfile?.id !== request.profileId) {
      return { state: 'stopped', canceled: true };
    }
    return startServer({ restartRequest: request });
  }).finally(() => {
    if (pendingServerRestart === request) pendingServerRestart = null;
  });
  request.promise = operation;
  pendingServerRestart = request;
  return operation;
}

async function getSeamlessRestartConsoleStatus() {
  const profile = await getActiveProfile();
  if (!profile) return { available: false, message: 'No server profile is selected.' };
  const paths = getPathsForProfile(profile);
  const config = await readConfig(paths);
  const [platform, java] = await Promise.all([
    getServerPlatformStatus(config, paths),
    resolveJava(config)
  ]);
  const inspection = await getSeamlessRestartInspection(config, paths, platform, java);
  return { ...inspection, profileId: profile.id };
}

function formatSeamlessRestartConsoleStatus(inspection) {
  if (!inspection?.config) return `[Server Console] Seamless restart unavailable: ${inspection?.message || 'no active server.'}`;
  const { config, status, runtime } = inspection;
  const blockers = (status.reasons || [])
    .filter(reason => !['VELOCITY_NOT_RUNNING', 'NANO_LIMBO_NOT_READY', 'FABRIC_PROXY_LITE_NOT_LOADED', 'BACKEND_NOT_READY'].includes(reason.code))
    .slice(0, 4);
  return [
    '[Server Console] Seamless restart',
    `  Enabled: ${config.enabled ? 'yes' : 'no'}`,
    `  Setup integrity: ${status.setupReady ? 'verified' : 'not ready'}`,
    `  Proxy: ${runtime.velocityRunning ? 'running' : 'stopped'} (${config.proxyHost}:${config.proxyPort})`,
    `  Maintenance lobby: ${runtime.limboRunning ? 'running' : 'stopped'} (${config.limboHost}:${config.limboPort})`,
    `  Minecraft backend: ${runtime.backendReady ? 'ready' : 'stopped'} (${config.backendHost}:${config.backendPort})`,
    `  Players parked: ${runtime.maintenanceArmed ? 'yes' : 'no'}`,
    `  Can restart without disconnecting: ${status.canSilentRestart ? 'yes' : 'no'}`,
    ...blockers.map(reason => `  Blocker: ${reason.message}`),
    !config.enabled
      ? '  Next step: stop Minecraft, then run /silent-restart setup.'
      : runtime.maintenanceArmed && runtime.backendReady
        ? '  Next step: run /silent-restart resume to return parked players.'
        : ''
  ].filter(Boolean).join('\n');
}

function resumeSeamlessRestartPlayers(options = {}) {
  if (seamlessResumePromise) {
    return Promise.reject(new Error('Player routing is already being resumed. Wait for that control operation to finish.'));
  }
  if (seamlessRestartPromise && options.internal !== true) {
    return Promise.reject(new Error('A seamless restart is already controlling player routing. Wait for it to finish before using resume.'));
  }
  let operation;
  operation = Promise.resolve().then(async () => {
    const backend = serverProcess;
    const proxy = seamlessVelocityProcess;
    const profileId = seamlessRuntimeProfileId;
    const retryDeadline = Date.now() + 30_000;
    for (let attempt = 0; ; attempt += 1) {
      if (!proxy || seamlessVelocityProcess !== proxy || hasChildExited(proxy)) {
        throw new Error('The restart proxy is not running or changed while resuming players.');
      }
      if (serverProcess !== backend || seamlessRuntimeProfileId !== profileId || !isServerRuntimeReady()) {
        throw new Error('The Minecraft backend is not ready or changed; players will remain safely parked.');
      }
      try {
        const event = await sendSeamlessVelocityControl(
          buildMaintenanceCommand('off'),
          isMaintenanceReadyAcknowledgement,
          ['ready', 'ready_complete'],
          SEAMLESS_RESTART_CONTROL_TIMEOUT_MS
        );
        seamlessMaintenanceArmed = false;
        appendServerLog('[Seamless Restart] Parked players returned to the restarted server.\n');
        return event;
      } catch (error) {
        // Minecraft's Done line can precede the proxy's first successful status ping.
        // Retry only that explicit transient rejection; restore failures/timeouts must not
        // replay routing operations whose outcome is unknown.
        const transientProbe = error?.code === 'SEAMLESS_RESTART_PROXY_REJECTED' &&
          error?.event?.operation === 'ready' && error?.event?.result === 'main_unreachable' &&
          error?.event?.state === 'ARMED';
        const remaining = retryDeadline - Date.now();
        if (!transientProbe || remaining <= 0 || attempt >= 15) throw error;
        if (attempt === 0) appendServerLog(
          '[Seamless Restart] Minecraft is ready; waiting for the proxy to reach its backend before returning players.\n'
        );
        await new Promise(resolve => setTimeout(resolve, Math.min(2_000, remaining)));
      }
    }
  }).finally(() => {
    if (seamlessResumePromise === operation) seamlessResumePromise = null;
  });
  seamlessResumePromise = operation;
  return operation;
}

// prepareUpdate is an internal main-process hook, never renderer/console input.
// It can stage a verified transaction while players play, then publish only at
// this operation's exclusive stopped-backend boundary.
function silentRestartServer(message = '', options = {}) {
  if (seamlessRestartPromise) return seamlessRestartPromise;
  if (options.prepareUpdate !== undefined && typeof options.prepareUpdate !== 'function') {
    return Promise.reject(new TypeError('Managed update preparation must be an internal function.'));
  }
  const cleanMessage = normalizeSeamlessRestartMessage(
    message || 'The server is updating. You will reconnect automatically.'
  );
  const restartOwner = Object.freeze({});
  seamlessRestartOwner = restartOwner;
  let operation;
  operation = Promise.resolve().then(async () => {
    if (seamlessResumePromise) {
      throw new Error('Player routing is currently being resumed. Wait for it to finish before starting another seamless restart.');
    }
    if (pendingAnnouncedServerShutdown) {
      throw new Error('Cancel the scheduled shutdown before starting a seamless restart.');
    }
    if (!isServerRuntimeReady()) throw new Error('Wait for Minecraft to finish starting before using seamless restart.');
    const profile = await getActiveProfile();
    if (!profile) throw new Error('Create or select a server first.');
    const paths = getPathsForProfile(profile);
    const config = await readConfig(paths);
    const previousProcess = serverProcess;
    const previousProxy = seamlessVelocityProcess;
    const previousLobby = seamlessLimboProcess;
    let atStoppedBoundary = false;
    const restartTarget = Object.freeze({
      profileId: profile.id, root: paths.root, worldName: validateWorldName(config.levelName || 'world')
    });
    const updateContext = Object.freeze({
      ...restartTarget,
      previousPid: previousProcess.pid,
      inspectJar: inspectJarDescriptor,
      assertStoppedBoundary: async () => {
        if (!atStoppedBoundary || pendingServerStart || !seamlessMaintenanceArmed ||
            seamlessVelocityProcess !== previousProxy || hasChildExited(previousProxy) ||
            seamlessLimboProcess !== previousLobby || hasChildExited(previousLobby)) {
          throw new Error('The managed update is outside its verified stopped-backend holding boundary.');
        }
        assertSeamlessRestartBackendExited({
          previousPid: previousProcess.pid, previousExited: hasChildExited(previousProcess),
          previousPidAlive: processExists(previousProcess.pid), currentBackendPresent: Boolean(serverProcess)
        });
        const currentProfile = await getActiveProfile();
        const currentConfig = await readConfig(paths);
        assertSeamlessRestartTarget(restartTarget, {
          profileId: currentProfile?.id, root: currentProfile ? getPathsForProfile(currentProfile).root : '',
          worldName: validateWorldName(currentConfig.levelName || 'world')
        });
        if (!atStoppedBoundary || pendingServerStart || serverProcess ||
            seamlessVelocityProcess !== previousProxy || hasChildExited(previousProxy) ||
            seamlessLimboProcess !== previousLobby || hasChildExited(previousLobby)) {
          throw new Error('The managed stopped-backend boundary changed.');
        }
      }
    });
    const [platform, java] = await Promise.all([
      getServerPlatformStatus(config, paths),
      resolveJava(config)
    ]);
    const inspection = await getSeamlessRestartInspection(config, paths, platform, java);
    if (!inspection.config.enabled) {
      throw new Error('Seamless restart is not set up. Stop Minecraft once, then run /silent-restart setup.');
    }
    if (!inspection.status.canSilentRestart) {
      const reason = inspection.status.reasons[0];
      throw new Error(reason?.message || 'The seamless-restart proxy stack did not pass runtime preflight.');
    }
    if (seamlessRuntimeProfileId !== profile.id) {
      throw new Error('The running restart proxy belongs to a different server profile.');
    }
    // Read-only preparation stays before the player drain. No duplicate world
    // JVM or world-copy warmup is launched; queued file hashes warm the OS cache
    // and reject missing/corrupt update files while everybody can still play.
    appendServerLog('[Seamless Restart] Verifying update files while the current world stays playable; only one world backend will run.\n');
    await fs.access(config.jarPath);
    if (normalizeServerType(config.serverType || platform.type) === 'fabric' &&
        normalizeAddonVersion(platform.minecraftVersion || config.serverVersion) === '26.2' &&
        await isRegularFile(PENDING_SMP_MOD_MANIFEST)) {
      const queued = await getPendingModQueueStatus({ profileRoot: paths.root, manifestPath: PENDING_SMP_MOD_MANIFEST });
      if (queued?.state !== 'not-downloaded' && !queued?.ok) {
        throw new Error(queued?.message || 'Queued updates failed verification; players were not moved.');
      }
    }
    const restartProtectionConfig = await getProtectionConfig(paths);
    const restartProtectionAdapter = getBundledProtectionAdapter(config.serverType, platform.minecraftVersion || config.serverVersion);
    const requiredBackendMemoryMb = planMinecraftStartupResources(config, {
      fabricAntiXrayEnabled: isFabricPacketAntiXrayConfigured(restartProtectionAdapter, restartProtectionConfig),
      totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.floor(os.freemem() / 1024 / 1024)
    }).requiredMemoryMb;
    const preparationMemory = evaluateSeamlessRestartPreparationMemory({
      totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.floor(os.freemem() / 1024 / 1024),
      requiredBackendMemoryMb,
      lobbyMemoryMb: inspection.holding.memoryMb,
      velocityRunning: inspection.runtime.velocityRunning,
      limboRunning: inspection.runtime.limboRunning
    });
    if (!preparationMemory.allowed) throw new Error(preparationMemory.message);
    const preparedUpdate = options.prepareUpdate ? await options.prepareUpdate(updateContext) : null;
    if (options.prepareUpdate && (!preparedUpdate || typeof preparedUpdate.publish !== 'function')) {
      throw new Error('Managed update preparation did not return a verified publish transaction; players were not moved.');
    }
    const preparedProfile = await getActiveProfile();
    const preparedConfig = await readConfig(paths);
    assertSeamlessRestartTarget(restartTarget, {
      profileId: preparedProfile?.id, root: preparedProfile ? getPathsForProfile(preparedProfile).root : '',
      worldName: validateWorldName(preparedConfig.levelName || 'world')
    });
    if (serverProcess !== previousProcess || !isServerRuntimeReady()) {
      throw new Error('Minecraft changed during restart preparation; players were not moved.');
    }
    appendServerLog('[Seamless Restart] Saving the world before moving players to the maintenance lobby.\n');
    if (!tryWriteServerInput(serverProcess, 'save-all flush')) {
      throw new Error('The Minecraft console could not save the world, so the restart was canceled.');
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    try {
      await sendSeamlessVelocityControl(
        buildMaintenanceCommand('on', cleanMessage),
        isMaintenanceArmedAcknowledgement,
        ['maintenance_on'],
        SEAMLESS_RESTART_CONTROL_TIMEOUT_MS
      );
      seamlessMaintenanceArmed = true;
    } catch (armError) {
      // A partial drain can leave some players in maintenance even though the safe-to-stop
      // barrier was not reached. The backend is still alive here, so always try to undo it.
      seamlessMaintenanceArmed = armError?.event?.state === 'ARMED';
      const drainStateUnknown = armError?.code === 'SEAMLESS_RESTART_PROXY_TIMEOUT';
      if ((seamlessMaintenanceArmed || drainStateUnknown) && seamlessVelocityProcess &&
          !hasChildExited(seamlessVelocityProcess) && isServerRuntimeReady()) {
        try {
          await resumeSeamlessRestartPlayers({ internal: true });
        } catch (resumeError) {
          if (resumeError?.event?.state === 'ACTIVE') seamlessMaintenanceArmed = false;
          appendServerLog(`[Seamless Restart] Could not fully undo the canceled player drain: ${resumeError.message || String(resumeError)}\n`);
        }
      }
      throw armError;
    }
    appendServerLog('[Seamless Restart] Every connected player is parked; restarting only the Minecraft backend.\n');
    let resumeAttempted = false;
    let backendStopRequested = false;
    try {
      if (serverProcess !== previousProcess || hasChildExited(previousProcess)) {
        throw new Error('The Minecraft backend changed during player handoff. No second backend was started.');
      }
      backendStopRequested = true;
      await stopServerAndWait({ preserveRestart: true, preserveSeamless: true, requireGraceful: true,
        seamlessRestartOwner: restartOwner });
      assertSeamlessRestartBackendExited({
        previousPid: previousProcess.pid, previousExited: hasChildExited(previousProcess),
        previousPidAlive: processExists(previousProcess.pid), currentBackendPresent: Boolean(serverProcess)
      });
      const currentProfile = await getActiveProfile();
      if (currentProfile?.id !== profile.id) {
        throw new Error('The active server changed during restart. Players remain parked.');
      }
      atStoppedBoundary = true;
      try {
        await updateContext.assertStoppedBoundary();
        if (preparedUpdate) await preparedUpdate.publish(updateContext);
        await updateContext.assertStoppedBoundary();
      } finally {
        atStoppedBoundary = false;
      }
      const result = await startServer({
        seamlessRestartRequest: {
          profileId: profile.id, requestedAt: Date.now(), target: restartTarget,
          previousPid: previousProcess.pid, previousProcess, owner: restartOwner
        }
      });
      if (!result?.ready || !isServerRuntimeReady() || !seamlessFabricProxyLiteLoaded) {
        throw new Error('Minecraft did not report ready after restarting. Players remain parked.');
      }
      resumeAttempted = true;
      await resumeSeamlessRestartPlayers({ internal: true });
      return { ...result, seamless: true, playersReconnected: true };
    } catch (error) {
      if (backendStopRequested && serverProcess === previousProcess) {
        // Once the native stop command was accepted it cannot be canceled. Its
        // save may still finish; do not return players to a half-stopping JVM.
        appendServerLog(`[Seamless Restart] The previous backend is still finishing its save/stop. Players remain parked; no second backend was launched. ${error.message || String(error)}\n`);
      } else if (isServerRuntimeReady() && !resumeAttempted && seamlessFabricProxyLiteLoaded) {
        try {
          await resumeSeamlessRestartPlayers({ internal: true });
        } catch (resumeError) {
          appendServerLog(`[Seamless Restart] Players remain parked: ${resumeError.message || String(resumeError)}\n`);
        }
      } else if (isServerRuntimeReady()) {
        appendServerLog(`[Seamless Restart] Players remain parked: ${error.message || String(error)}\n`);
      } else {
        appendServerLog(
          `[Seamless Restart] Backend restart failed; the proxy and maintenance lobby remain online so players are not disconnected. ` +
          `${error.message || String(error)}\n`
        );
      }
      throw error;
    }
  }).finally(() => {
    if (seamlessRestartPromise === operation) {
      seamlessRestartPromise = null;
      seamlessRestartOwner = null;
    }
  });
  seamlessRestartPromise = operation;
  return operation;
}

function isServerRuntimeReady(
  processRef = serverProcess,
  state = serverState,
  readyGeneration = serverReadyGeneration,
  lifecycleGeneration = serverLifecycleGeneration
) {
  return Boolean(processRef && state === 'running' && readyGeneration > 0 && readyGeneration === lifecycleGeneration);
}

function tryWriteServerInput(processRef, command) {
  const input = processRef?.stdin;
  if (!input?.writable || input.destroyed || input.writableEnded) return false;
  try {
    input.write(`${command}\n`, () => {});
    return true;
  } catch (error) {
    if (serverProcess === processRef) {
      appendServerLog(`[Server Manager SRV-CONSOLE-502] Server console write failed: ${error.message || String(error)}\n`);
    }
    return false;
  }
}

function sendCommand(command) {
  if (!serverProcess) throw new Error('Server is not running.');
  if (!tryWriteServerInput(serverProcess, command)) {
    throw new Error('The server console is not available. Wait for the server to finish starting or stopping.');
  }
  return true;
}

function sendServerCommand(command) {
  if (!isServerRuntimeReady()) return false;
  return tryWriteServerInput(serverProcess, command);
}

function validatePlayerName(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) throw new Error('Invalid player name.');
  return clean;
}

function normalizePlayerViewDimension(value) {
  const raw = String(value || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  const aliases = { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', the_nether: 'minecraft:the_nether', end: 'minecraft:the_end', the_end: 'minecraft:the_end' };
  const clean = aliases[raw] || raw;
  if (clean.length > 128 || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(clean)) {
    throw new Error('The saved player-view dimension is invalid.');
  }
  return clean;
}

function normalizePlayerViewNumber(value, label, limit = 60_000_000) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) {
    throw new Error(`The saved player-view ${label} is invalid.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit) throw new Error(`The saved player-view ${label} is invalid.`);
  return Object.is(number, -0) ? 0 : number;
}

function normalizePlayerViewOrigin(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const position = source.position && typeof source.position === 'object' ? source.position : source;
  const rotation = source.rotation && typeof source.rotation === 'object' ? source.rotation : source;
  const gameMode = String(source.gameMode || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PLAYER_SPECTATE_RESTORE_TAGS, gameMode)) {
    throw new Error('The saved player-view game mode is invalid.');
  }
  return {
    dimension: normalizePlayerViewDimension(source.dimension),
    position: {
      x: normalizePlayerViewNumber(position.x, 'X coordinate'),
      y: normalizePlayerViewNumber(position.y, 'Y coordinate'),
      z: normalizePlayerViewNumber(position.z, 'Z coordinate')
    },
    rotation: {
      yaw: normalizePlayerViewNumber(rotation.yaw, 'yaw', 1_000_000),
      pitch: normalizePlayerViewNumber(rotation.pitch, 'pitch', 90)
    },
    gameMode
  };
}

function normalizePlayerSpectateSession(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const viewer = validatePlayerName(source.viewer);
  const target = validatePlayerName(source.target);
  if (viewer.toLowerCase() === target.toLowerCase()) throw new Error('A player-view session cannot target its viewer.');
  const startedAtMs = Date.parse(String(source.startedAt || ''));
  if (!Number.isFinite(startedAtMs)) throw new Error('The saved player-view start time is invalid.');
  const requestedState = source.state === undefined ? 'active' : String(source.state);
  if (!['starting', 'active', 'restoring'].includes(requestedState)) throw new Error('The saved player-view state is invalid.');
  return {
    viewer,
    target,
    startedAt: new Date(startedAtMs).toISOString(),
    state: requestedState,
    origin: normalizePlayerViewOrigin(source.origin),
    generation: Number.isInteger(source.generation) ? source.generation : 0
  };
}

function playerSpectateRecoveryDocument() {
  if (playerSpectateSessions.size > MAX_PLAYER_VIEW_RECOVERY_SESSIONS) {
    throw new Error('Too many player-view recovery sessions are active.');
  }
  const sessions = [...playerSpectateSessions.values()]
    .map((session) => {
      const normalized = normalizePlayerSpectateSession(session);
      return {
        viewer: normalized.viewer,
        target: normalized.target,
        startedAt: normalized.startedAt,
        state: normalized.state,
        origin: normalized.origin
      };
    })
    .sort((left, right) => left.viewer.localeCompare(right.viewer, undefined, { sensitivity: 'base' }));
  const document = { version: 1, sessions };
  if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_PLAYER_VIEW_RECOVERY_BYTES) {
    throw new Error('Player-view recovery data exceeded its safety limit.');
  }
  return document;
}

async function loadPlayerSpectateSessions(paths = null, options = {}) {
  const resolvedPaths = paths || await getPaths();
  const file = path.resolve(resolvedPaths.playerViewRecovery);
  if (playerSpectateSessionsLoaded && playerSpectateRecoveryPath === file) return playerSpectateSessions;
  let parsed = { version: 1, sessions: [] };
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_PLAYER_VIEW_RECOVERY_BYTES) throw new Error('Player-view recovery data is too large.');
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Could not read player-view recovery data: ${error?.message || String(error)}`);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions) || parsed.sessions.length > MAX_PLAYER_VIEW_RECOVERY_SESSIONS) {
    throw new Error('Player-view recovery data is invalid.');
  }
  if (options.isCurrent && !await options.isCurrent()) return null;
  const next = new Map();
  for (const entry of parsed.sessions) {
    const session = normalizePlayerSpectateSession(entry);
    const key = session.viewer.toLowerCase();
    if (next.has(key)) throw new Error(`Player-view recovery contains a duplicate viewer: ${session.viewer}.`);
    next.set(key, { ...session, generation: 0 });
  }
  playerSpectateSessions.clear();
  for (const [key, session] of next) playerSpectateSessions.set(key, session);
  playerSpectateRecoveryPath = file;
  playerSpectateSessionsLoaded = true;
  return playerSpectateSessions;
}

async function persistPlayerSpectateSessions(paths) {
  const file = path.resolve(paths.playerViewRecovery);
  if (!playerSpectateSessionsLoaded || playerSpectateRecoveryPath !== file) {
    throw new Error('Player-view recovery changed server profiles during an active operation.');
  }
  const snapshot = playerSpectateRecoveryDocument();
  return serializeFileWrite(file, () => writeJsonAtomically(file, snapshot));
}

function resetPlayerSpectateRuntimeCache() {
  playerSpectateSessions.clear();
  playerSpectateRecoveryPath = '';
  playerSpectateSessionsLoaded = false;
}

function serializePlayerSpectateMutation(paths, player, work) {
  const key = `${path.resolve(paths.playerViewRecovery)}\0${validatePlayerName(player).toLowerCase()}`;
  const previous = playerSpectateMutations.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  playerSpectateMutations.set(key, current);
  current.finally(() => {
    if (playerSpectateMutations.get(key) === current) playerSpectateMutations.delete(key);
  }).catch(() => {});
  return current;
}

function buildStartPlayerSpectateCommands(viewer, target, origin, retarget = false) {
  const cleanViewer = validatePlayerName(viewer);
  const cleanTarget = validatePlayerName(target);
  if (cleanViewer.toLowerCase() === cleanTarget.toLowerCase()) {
    throw new Error('Choose a different online player as the viewer.');
  }
  normalizePlayerViewOrigin(origin);
  return [`serverprotection view start ${cleanViewer} ${cleanTarget}`];
}

function buildStopPlayerSpectateCommands(viewer, origin) {
  const clean = validatePlayerName(viewer);
  // Keep validating the durable record before issuing a restore, but never fall
  // back to vanilla spectator/gamemode/teleport commands. The managed command
  // owns the atomic camera teardown and exact return operation.
  normalizePlayerViewOrigin(origin);
  return [`serverprotection view stop ${clean}`];
}

function getOnlinePrivilegedSpectateViewers(access, online = livePlayers) {
  const players = online && typeof online.get === 'function' ? online : new Map();
  return (Array.isArray(access?.assignments) ? access.assignments : [])
    .filter((assignment) => accessAssignmentHasCapability(access, assignment, 'player.spectate'))
    .map((assignment) => players.get(String(assignment.player || '').toLowerCase()) || '')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function getPrivilegedSpectateAssignment(access, player) {
  const key = String(player || '').trim().toLowerCase();
  return (Array.isArray(access?.assignments) ? access.assignments : [])
    .find((assignment) => String(assignment?.player || '').toLowerCase() === key &&
      accessAssignmentHasCapability(access, assignment, 'player.spectate')) || null;
}

async function getPlayerSpectateStatus(target = '') {
  const cleanTarget = target ? validatePlayerName(target) : '';
  const targetKey = cleanTarget.toLowerCase();
  const paths = await getPaths();
  await loadPlayerSpectateSessions(paths);
  const [access, companion] = await Promise.all([
    readPlayerAccess(paths),
    getPlayerViewCompanionStatus(paths).catch((error) => ({
      supported: false,
      available: false,
      loader: 'Fabric',
      minecraftVersion: '',
      version: BUNDLED_PLAYER_VIEW_COMPANION_VERSION,
      file: '',
      message: `POV Companion status is unavailable: ${error?.message || String(error)}`
    }))
  ]);
  return {
    target: cleanTarget,
    onlinePlayers: getOnlinePrivilegedSpectateViewers(access),
    companion,
    sessions: [...playerSpectateSessions.values()]
      .filter((session) => !targetKey || session.target.toLowerCase() === targetKey)
      .map((session) => ({
        viewer: session.viewer,
        target: session.target,
        startedAt: session.startedAt,
        state: session.state,
        online: livePlayers.has(session.viewer.toLowerCase())
      }))
  };
}

async function startPlayerSpectating(value = {}) {
  if (!isServerRuntimeReady()) throw new Error('The server must be running before viewing through a player.');
  const viewer = validatePlayerName(value?.viewer);
  const target = validatePlayerName(value?.target);
  const viewerKey = viewer.toLowerCase();
  const targetKey = target.toLowerCase();
  if (viewerKey === targetKey) throw new Error('Choose a different online player as the viewer.');
  const paths = await getPaths();
  return serializePlayerSpectateMutation(paths, viewer, async () => {
    await loadPlayerSpectateSessions(paths);
    if (!isServerRuntimeReady()) throw new Error('The server must be running before viewing through a player.');
    let liveViewer = livePlayers.get(viewerKey);
    let liveTarget = livePlayers.get(targetKey);
    if (!liveViewer) throw new Error(`${viewer} is not online.`);
    if (!liveTarget) throw new Error(`${target} is no longer online.`);
    let access = await readPlayerAccess(paths);
    if (!getPrivilegedSpectateAssignment(access, liveViewer)) {
      throw new Error(`${liveViewer} needs Owner or Admin access, or a custom role with the View players permission, before being used as the POV viewer.`);
    }
    const previous = playerSpectateSessions.get(viewerKey);
    if (previous?.state === 'restoring') {
      throw new Error(`${liveViewer} still has a saved return in progress. Restore them before starting another player view.`);
    }
    let origin = previous?.origin;
    if (!origin) {
      origin = normalizePlayerViewOrigin(await capturePlayerPose(liveViewer));
      if (!isServerRuntimeReady()) throw new Error('The server stopped while saving the viewer return location.');
      liveViewer = livePlayers.get(viewerKey);
      liveTarget = livePlayers.get(targetKey);
      if (!liveViewer) throw new Error(`${viewer} is no longer online.`);
      if (!liveTarget) throw new Error(`${target} is no longer online.`);
      access = await readPlayerAccess(paths);
      if (!getPrivilegedSpectateAssignment(access, liveViewer)) {
        throw new Error(`${liveViewer} no longer has Owner or Admin access or a custom role with the View players permission.`);
      }
    }
    const session = normalizePlayerSpectateSession({
      viewer: liveViewer,
      target: liveTarget,
      startedAt: previous?.startedAt || new Date().toISOString(),
      state: 'starting',
      origin,
      generation: serverLifecycleGeneration
    });
    playerSpectateSessions.set(viewerKey, session);
    await persistPlayerSpectateSessions(paths);
    if (!sendServerCommandBatch(buildStartPlayerSpectateCommands(liveViewer, liveTarget, origin, Boolean(previous)))) {
      throw new Error('The server console did not accept the player-view commands. The saved return was kept.');
    }
    let activatedPose;
    try {
      activatedPose = await capturePlayerPose(liveViewer);
    } catch (error) {
      throw new Error(`Minecraft did not confirm that player view started: ${error?.message || String(error)} The saved return was kept.`);
    }
    if (!activatedPose.activeView || activatedPose.gameMode !== origin.gameMode) {
      try {
        await restorePlayerSpectateSession(paths, session);
      } catch (restoreError) {
        throw new Error(
          `Minecraft rejected player view and the safe return could not be confirmed: ${restoreError?.message || String(restoreError)}`
        );
      }
      const companion = await getPlayerViewCompanionStatus(paths).catch(() => null);
      const requirement = companion?.supported
        ? `${companion.file} for Minecraft ${companion.minecraftVersion}`
        : `POV Companion ${BUNDLED_PLAYER_VIEW_COMPANION_VERSION} for the server's exact Minecraft version`;
      throw new Error(
        `Managed player view was not confirmed. Install or update ${requirement} in the authorized viewer's Fabric mods folder, restart that Minecraft client, and retry. The viewer was returned without changing their game mode.`
      );
    }
    session.state = 'active';
    session.generation = serverLifecycleGeneration;
    playerSpectateSessions.set(viewerKey, session);
    await persistPlayerSpectateSessions(paths);
    return getPlayerSpectateStatus(liveTarget);
  });
}

async function stopPlayerSpectating(value) {
  if (!isServerRuntimeReady()) throw new Error('The server must be running before restoring the viewer.');
  const clean = validatePlayerName(typeof value === 'object' ? value?.viewer : value);
  const requestedTarget = typeof value === 'object' && value?.target ? validatePlayerName(value.target) : '';
  const key = clean.toLowerCase();
  const paths = await getPaths();
  return serializePlayerSpectateMutation(paths, clean, async () => {
    await loadPlayerSpectateSessions(paths);
    const session = playerSpectateSessions.get(key);
    if (!session) throw new Error(`${clean} does not have a saved player-view session.`);
    const target = session.target || requestedTarget;
    await restorePlayerSpectateSession(paths, session);
    return getPlayerSpectateStatus(target);
  });
}

function playerViewRotationDistance(left, right) {
  const difference = ((Number(left) - Number(right) + 540) % 360) - 180;
  return Math.abs(difference);
}

function playerPoseMatchesOrigin(pose, origin) {
  const observed = normalizePlayerViewOrigin(pose);
  const expected = normalizePlayerViewOrigin(origin);
  return observed.dimension === expected.dimension &&
    observed.gameMode === expected.gameMode &&
    Math.abs(observed.position.x - expected.position.x) <= 0.0001 &&
    Math.abs(observed.position.y - expected.position.y) <= 0.0001 &&
    Math.abs(observed.position.z - expected.position.z) <= 0.0001 &&
    playerViewRotationDistance(observed.rotation.yaw, expected.rotation.yaw) <= 0.001 &&
    Math.abs(observed.rotation.pitch - expected.rotation.pitch) <= 0.001;
}

async function restorePlayerSpectateSession(paths, value, lifecycleContext = null) {
  if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
  const session = normalizePlayerSpectateSession(value);
  const key = session.viewer.toLowerCase();
  const liveViewer = livePlayers.get(key);
  if (!isServerRuntimeReady()) throw new Error('The server is not ready to restore the saved player view.');
  if (!liveViewer) throw new Error(`${session.viewer} must be online before their camera and return location can be restored.`);
  session.viewer = liveViewer;
  session.state = 'restoring';
  playerSpectateSessions.set(key, session);
  await persistPlayerSpectateSessions(paths);
  if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
  if (!sendServerCommandBatch(buildStopPlayerSpectateCommands(liveViewer, session.origin))) {
    throw new Error('The server console did not accept the player-view restore commands. Recovery was kept.');
  }
  let observed;
  try {
    observed = await capturePlayerPose(liveViewer);
  } catch (error) {
    throw new Error(`Minecraft did not confirm the player-view return: ${error?.message || String(error)} Recovery was kept.`);
  }
  if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
  if (observed.activeView || !playerPoseMatchesOrigin(observed, session.origin)) {
    throw new Error('Minecraft did not confirm the exact player-view return location, rotation, dimension, and game mode. Recovery was kept.');
  }
  playerSpectateSessions.delete(key);
  try {
    await persistPlayerSpectateSessions(paths);
  } catch (error) {
    playerSpectateSessions.set(key, session);
    throw error;
  }
  return true;
}

function appendPlayerViewRecoveryError(context, error) {
  appendServerLog(`[Server Manager] Player-view recovery ${context} failed: ${error?.message || String(error)}\n`);
}

async function restoreReconnectedPlayerSpectateSession(name, lifecycleContext = null) {
  if (lifecycleContext) {
    if (!await revalidateServerLifecycleContext(lifecycleContext)) return false;
  } else if (!isServerRuntimeReady()) return false;
  const clean = validatePlayerName(name);
  const paths = lifecycleContext?.paths || await getPaths();
  const sessions = await loadPlayerSpectateSessions(paths, lifecycleContext
    ? { isCurrent: () => revalidateServerLifecycleContext(lifecycleContext) }
    : {});
  if (!sessions || (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext))) return false;
  const key = clean.toLowerCase();
  if (!playerSpectateSessions.has(key)) return false;
  return serializePlayerSpectateMutation(paths, clean, async () => {
    if (lifecycleContext && !await revalidateServerLifecycleContext(lifecycleContext)) return false;
    const session = playerSpectateSessions.get(key);
    if (!session) return false;
    return restorePlayerSpectateSession(paths, session, lifecycleContext);
  });
}

async function restoreSessionsWatchingPlayer(name) {
  const targetKey = validatePlayerName(name).toLowerCase();
  if (!isServerRuntimeReady()) return false;
  const paths = await getPaths();
  await loadPlayerSpectateSessions(paths);
  const sessions = [...playerSpectateSessions.values()]
    .filter((session) => session.target.toLowerCase() === targetKey && livePlayers.has(session.viewer.toLowerCase()));
  if (!sessions.length) return false;
  const results = await Promise.allSettled(sessions.map((session) => serializePlayerSpectateMutation(paths, session.viewer, async () => {
    const current = playerSpectateSessions.get(session.viewer.toLowerCase());
    return current ? restorePlayerSpectateSession(paths, current) : false;
  })));
  results.forEach((result) => { if (result.status === 'rejected') appendPlayerViewRecoveryError(`for a departed target`, result.reason); });
  return results.some((result) => result.status === 'fulfilled' && result.value);
}

async function restoreAllPlayerSpectateSessions() {
  if (!isServerRuntimeReady()) return false;
  const paths = await getPaths();
  await loadPlayerSpectateSessions(paths);
  const sessions = [...playerSpectateSessions.values()]
    .filter((session) => livePlayers.has(session.viewer.toLowerCase()));
  if (!sessions.length) return false;
  const results = await Promise.allSettled(sessions.map((session) => serializePlayerSpectateMutation(paths, session.viewer, async () => {
    const current = playerSpectateSessions.get(session.viewer.toLowerCase());
    return current ? restorePlayerSpectateSession(paths, current) : false;
  })));
  results.forEach((result) => { if (result.status === 'rejected') appendPlayerViewRecoveryError('before server stop', result.reason); });
  return results.some((result) => result.status === 'fulfilled' && result.value);
}

async function retryReadyPlayerSpectateRecovery(lifecycleContext = null) {
  if (lifecycleContext) {
    if (!await revalidateServerLifecycleContext(lifecycleContext)) return false;
  } else if (!isServerRuntimeReady()) return false;
  const paths = lifecycleContext?.paths || await getPaths();
  const loaded = await loadPlayerSpectateSessions(paths, lifecycleContext
    ? { isCurrent: () => revalidateServerLifecycleContext(lifecycleContext) }
    : {});
  if (!loaded || (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext))) return false;
  const sessions = [...playerSpectateSessions.values()]
    .filter((session) => livePlayers.has(session.viewer.toLowerCase()));
  if (!sessions.length) return false;
  const results = await Promise.allSettled(sessions.map((session) =>
    restoreReconnectedPlayerSpectateSession(session.viewer, lifecycleContext)));
  results.forEach((result) => { if (result.status === 'rejected') appendPlayerViewRecoveryError('after server readiness', result.reason); });
  return results.some((result) => result.status === 'fulfilled' && result.value);
}

async function restoreRevokedPlayerSpectateSessions(access, paths = null) {
  const resolvedPaths = paths || await getPaths();
  await loadPlayerSpectateSessions(resolvedPaths);
  const revoked = [...playerSpectateSessions.values()]
    .filter((session) => !getPrivilegedSpectateAssignment(access, session.viewer));
  const online = revoked.filter((session) => livePlayers.has(session.viewer.toLowerCase()) && isServerRuntimeReady());
  const results = await Promise.allSettled(online.map((session) => serializePlayerSpectateMutation(resolvedPaths, session.viewer, async () => {
    const current = playerSpectateSessions.get(session.viewer.toLowerCase());
    return current ? restorePlayerSpectateSession(resolvedPaths, current) : false;
  })));
  results.forEach((result) => { if (result.status === 'rejected') appendPlayerViewRecoveryError('after access revocation', result.reason); });
  return {
    restored: results.filter((result) => result.status === 'fulfilled' && result.value).length,
    pending: revoked.length - results.filter((result) => result.status === 'fulfilled' && result.value).length
  };
}

function parsePlayerPositionSnbt(value) {
  const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
  const match = String(value || '').trim().match(new RegExp(`^\\[\\s*${number}[dDfF]?\\s*,\\s*${number}[dDfF]?\\s*,\\s*${number}[dDfF]?\\s*\\]$`));
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function parsePlayerRotationSnbt(value) {
  const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
  const match = String(value || '').trim().match(new RegExp(`^\\[\\s*${number}[dDfF]?\\s*,\\s*${number}[dDfF]?\\s*\\]$`));
  if (!match) return null;
  return { yaw: Number(match[1]), pitch: Number(match[2]) };
}

function parsePlayerScalarSnbt(value) {
  const match = String(value || '').trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:[bBsSlLfFdD])?$/);
  return match ? Number(match[1]) : null;
}

function splitTopLevelSnbtList(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('[') || !source.endsWith(']')) return [];
  const entries = [];
  let start = 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote && character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('[{('.includes(character)) depth += 1;
    else if (']})'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      const entry = source.slice(start, index).trim();
      if (entry) entries.push(entry);
      start = index + 1;
    }
  }
  const finalEntry = source.slice(start, -1).trim();
  if (finalEntry) entries.push(finalEntry);
  return entries;
}

function splitTopLevelSnbtCompound(value) {
  const source = String(value || '').trim();
  if (!source.startsWith('{') || !source.endsWith('}')) return [];
  const entries = [];
  let start = 1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = 1; index < source.length - 1; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote && character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if ('[{('.includes(character)) depth += 1;
    else if (']})'.includes(character)) depth -= 1;
    else if (character === ',' && depth === 0) {
      const entry = source.slice(start, index).trim();
      if (entry) entries.push(entry);
      start = index + 1;
    }
  }
  const finalEntry = source.slice(start, -1).trim();
  if (finalEntry) entries.push(finalEntry);

  return entries.map((entry) => {
    let entryDepth = 0;
    let entryQuote = '';
    let entryEscaped = false;
    for (let index = 0; index < entry.length; index += 1) {
      const character = entry[index];
      if (entryEscaped) { entryEscaped = false; continue; }
      if (entryQuote && character === '\\') { entryEscaped = true; continue; }
      if (entryQuote) { if (character === entryQuote) entryQuote = ''; continue; }
      if (character === '"' || character === "'") { entryQuote = character; continue; }
      if ('[{('.includes(character)) entryDepth += 1;
      else if (']})'.includes(character)) entryDepth -= 1;
      else if (character === ':' && entryDepth === 0) {
        const key = entry.slice(0, index).trim().replace(/^["']|["']$/g, '');
        return [key, entry.slice(index + 1).trim()];
      }
    }
    return ['', ''];
  }).filter(([key]) => key);
}

function playerInventorySection(slot) {
  if (slot >= 0 && slot <= 8) return { section: 'hotbar', index: slot };
  if (slot >= 9 && slot <= 35) return { section: 'inventory', index: slot - 9 };
  if (slot === 100) return { section: 'armor', index: 3 };
  if (slot === 101) return { section: 'armor', index: 2 };
  if (slot === 102) return { section: 'armor', index: 1 };
  if (slot === 103) return { section: 'armor', index: 0 };
  if (slot === -106 || slot === 150) return { section: 'offhand', index: 0 };
  return { section: 'other', index: slot };
}

function parsePlayerItemStackSnbt(value, slot, location = playerInventorySection(slot)) {
  const source = String(value || '').trim();
  const idMatch = source.match(/(?:^|[,\s{])id\s*:\s*(?:["']([^"']+)["']|([a-z0-9_.-]+:[a-z0-9_./-]+))/i);
  const id = idMatch?.[1] || idMatch?.[2] || '';
  if (!id) return null;
  const countMatch = source.match(/(?:^|[,\s{])(?:Count|count)\s*:\s*(\d+)b?/i);
  return {
    id,
    name: id.replace(/^minecraft:/, '').split('_').map((part) => part ? part[0].toUpperCase() + part.slice(1) : '').join(' '),
    count: Math.max(1, Number(countMatch?.[1]) || 1),
    slot,
    ...location
  };
}

function parsePlayerInventorySnbt(value) {
  const items = [];
  for (const entry of splitTopLevelSnbtList(value)) {
    if (items.length >= 64) break;
    const slotMatch = entry.match(/(?:^|[,\s{])Slot\s*:\s*(-?\d+)b?/i);
    if (!slotMatch) continue;
    const slot = Number(slotMatch[1]);
    const item = parsePlayerItemStackSnbt(entry, slot);
    if (item) items.push(item);
  }
  return items.sort((left, right) => left.slot - right.slot);
}

const PLAYER_EQUIPMENT_LOCATIONS = Object.freeze({
  head: Object.freeze({ slot: 103, section: 'armor', index: 0 }),
  chest: Object.freeze({ slot: 102, section: 'armor', index: 1 }),
  legs: Object.freeze({ slot: 101, section: 'armor', index: 2 }),
  feet: Object.freeze({ slot: 100, section: 'armor', index: 3 }),
  offhand: Object.freeze({ slot: -106, section: 'offhand', index: 0 })
});

function parsePlayerEquipmentSnbt(value) {
  const items = [];
  for (const [rawKey, stack] of splitTopLevelSnbtCompound(value)) {
    const key = String(rawKey || '').trim().toLowerCase();
    const location = PLAYER_EQUIPMENT_LOCATIONS[key];
    if (!location) continue;
    const item = parsePlayerItemStackSnbt(stack, location.slot, location);
    if (item) items.push(item);
  }
  return items.sort((left, right) => left.slot - right.slot);
}

function mergePlayerInspectionItems(inventory, equipment) {
  const equipmentItems = Array.isArray(equipment) ? equipment : [];
  const occupied = new Set(equipmentItems.map((item) => `${item.section}:${item.index}`));
  return [
    ...(Array.isArray(inventory) ? inventory : []).filter((item) => !occupied.has(`${item.section}:${item.index}`)),
    ...equipmentItems
  ].sort((left, right) => left.slot - right.slot);
}

const PLAYER_POSE_PHASES = Object.freeze([
  ['position', 'Pos'],
  ['rotation', 'Rotation'],
  ['dimension', 'Dimension'],
  ['gameMode', 'playerGameType'],
  ['activeView', 'Tags']
]);

const PLAYER_GAME_MODE_IDS = Object.freeze({ 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator' });

function clearPlayerPoseRequest(key, error = null, result = null) {
  const request = playerPoseRequests.get(key);
  if (!request) return;
  playerPoseRequests.delete(key);
  clearTimeout(request.timer);
  if (error) request.reject(error);
  else request.resolve(result);
}

function sendPlayerPosePhase(key) {
  const request = playerPoseRequests.get(key);
  if (!request) return false;
  const phase = PLAYER_POSE_PHASES.find(([name]) => name === request.phase);
  const command = phase ? `data get entity ${request.player} ${phase[1]}` : '';
  if (!command || !sendServerCommand(command)) {
    clearPlayerPoseRequest(key, new Error('The server console is unavailable.'));
    return false;
  }
  clearTimeout(request.timer);
  request.timer = setTimeout(() => {
    const current = playerPoseRequests.get(key);
    if (!current) return;
    if (current.phase === 'activeView') {
      current.activeView = false;
      finishPlayerPosePhase(key);
      return;
    }
    clearPlayerPoseRequest(key, new Error(`Minecraft did not return the viewer ${current.phase}.`));
  }, 3000);
  request.timer.unref?.();
  return true;
}

function finishPlayerPosePhase(key) {
  const request = playerPoseRequests.get(key);
  if (!request) return;
  const index = PLAYER_POSE_PHASES.findIndex(([name]) => name === request.phase);
  if (index < 0 || index >= PLAYER_POSE_PHASES.length - 1) {
    clearPlayerPoseRequest(key, null, {
      ...normalizePlayerViewOrigin({
      dimension: request.dimension,
      position: request.position,
      rotation: request.rotation,
      gameMode: request.gameMode
      }),
      activeView: Boolean(request.activeView)
    });
    return;
  }
  request.phase = PLAYER_POSE_PHASES[index + 1][0];
  sendPlayerPosePhase(key);
}

function advancePlayerPose(key, payload) {
  const request = playerPoseRequests.get(key);
  if (!request) return false;
  if (request.phase === 'position') {
    const position = parsePlayerPositionSnbt(payload);
    if (!position) return false;
    request.position = position;
  } else if (request.phase === 'rotation') {
    const rotation = parsePlayerRotationSnbt(payload);
    if (!rotation) return false;
    request.rotation = rotation;
  } else if (request.phase === 'dimension') {
    try { request.dimension = normalizePlayerViewDimension(payload); } catch { return false; }
  } else if (request.phase === 'gameMode') {
    const id = parsePlayerScalarSnbt(payload);
    request.gameMode = PLAYER_GAME_MODE_IDS[id];
    if (!request.gameMode) return false;
  } else if (request.phase === 'activeView') {
    request.activeView = new RegExp(`(?:^|[\\s,\\[\"'])${escapeRegExp(PLAYER_SPECTATE_ACTIVE_TAG)}(?:[\\s,\\]\"']|$)`, 'i').test(String(payload || ''));
  } else return false;
  finishPlayerPosePhase(key);
  return true;
}

function notePlayerPoseOutput(chunk) {
  if (!playerPoseRequests.size) { playerPoseLogRemainder = ''; return; }
  const consumed = consumePlayerLogChunk(playerPoseLogRemainder, chunk);
  playerPoseLogRemainder = consumed.remainder;
  for (const line of consumed.lines) {
    for (const [key, request] of playerPoseRequests) {
      const match = line.match(new RegExp(`${escapeRegExp(request.player)} has the following entity data:\\s*(.+)$`, 'i'));
      if (match && advancePlayerPose(key, match[1])) break;
      if (new RegExp(`(?:No entity was found|Found no elements matching).*${escapeRegExp(request.player)}|${escapeRegExp(request.player)}.*(?:No entity was found|Found no elements matching)`, 'i').test(line)) {
        clearPlayerPoseRequest(key, new Error(`${request.player} is no longer available for player-view recovery.`));
        break;
      }
    }
  }
}

function capturePlayerPose(name) {
  const player = validatePlayerName(name);
  const key = player.toLowerCase();
  if (!isServerRuntimeReady()) return Promise.reject(new Error('The server must be running before saving a player return location.'));
  const livePlayer = livePlayers.get(key);
  if (!livePlayer) return Promise.reject(new Error(`${player} is no longer online.`));
  const existing = playerPoseRequests.get(key);
  if (existing) return existing.promise;
  const inspection = playerInspectionRequests.get(key)?.promise;
  if (inspection) return inspection.catch(() => null).then(() => capturePlayerPose(livePlayer));
  if (playerPoseRequests.size >= MAX_PLAYER_INSPECTION_REQUESTS) {
    return Promise.reject(new Error('Too many player return locations are being checked.'));
  }
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  playerPoseRequests.set(key, {
    player: livePlayer,
    phase: PLAYER_POSE_PHASES[0][0],
    position: null,
    rotation: null,
    dimension: '',
    gameMode: '',
    activeView: false,
    timer: null,
    resolve,
    reject,
    promise
  });
  sendPlayerPosePhase(key);
  return promise;
}

function clearPlayerInspectionRequest(key, error = null, result = null) {
  const request = playerInspectionRequests.get(key);
  if (!request) return;
  playerInspectionRequests.delete(key);
  clearTimeout(request.timer);
  if (error) request.reject(error);
  else request.resolve(result);
}

const PLAYER_INSPECTION_PHASES = Object.freeze([
  ['position', 'Pos'],
  ['dimension', 'Dimension'],
  ['inventory', 'Inventory'],
  ['equipment', 'equipment'],
  ['health', 'Health'],
  ['food', 'foodLevel'],
  ['xpLevel', 'XpLevel'],
  ['xpProgress', 'XpP']
]);

function playerInspectionCommand(request) {
  const phase = PLAYER_INSPECTION_PHASES.find(([name]) => name === request.phase);
  return phase ? `data get entity ${request.player} ${phase[1]}` : '';
}

function sendPlayerInspectionPhase(key) {
  const request = playerInspectionRequests.get(key);
  if (!request) return false;
  const command = playerInspectionCommand(request);
  if (!command || !sendServerCommand(command)) {
    clearPlayerInspectionRequest(key, new Error('The server console is unavailable.'));
    return false;
  }
  schedulePlayerInspectionPhase(key);
  return true;
}

function finishPlayerInspectionPhase(key) {
  const request = playerInspectionRequests.get(key);
  if (!request) return;
  const index = PLAYER_INSPECTION_PHASES.findIndex(([name]) => name === request.phase);
  if (index < 0 || index >= PLAYER_INSPECTION_PHASES.length - 1) {
    clearPlayerInspectionRequest(key, null, {
      player: request.player,
      online: true,
      position: request.position,
      dimension: request.dimension || 'unknown',
      vitals: {
        health: Math.max(0, Math.min(2048, Number(request.health) || 0)),
        food: Math.max(0, Math.min(20, Math.round(Number(request.food) || 0))),
        xpLevel: Math.max(0, Math.min(2_147_483_647, Math.round(Number(request.xpLevel) || 0))),
        xpProgress: Math.max(0, Math.min(1, Number(request.xpProgress) || 0))
      },
      inventory: request.inventory || [],
      updatedAt: new Date().toISOString()
    });
    return;
  }
  request.phase = PLAYER_INSPECTION_PHASES[index + 1][0];
  sendPlayerInspectionPhase(key);
}

function schedulePlayerInspectionPhase(key) {
  const request = playerInspectionRequests.get(key);
  if (!request) return;
  clearTimeout(request.timer);
  request.timer = setTimeout(() => {
    const current = playerInspectionRequests.get(key);
    if (!current) return;
    if (current.phase !== 'position' && current.phase !== 'inventory') {
      finishPlayerInspectionPhase(key);
      return;
    }
    clearPlayerInspectionRequest(key, new Error(`Minecraft did not return ${current.phase === 'position' ? 'the player location' : 'the player inventory'}.`));
  }, request.phase === 'equipment' ? 1000 : 3000);
  request.timer.unref?.();
}

function advancePlayerInspection(key, payload) {
  const request = playerInspectionRequests.get(key);
  if (!request) return false;
  if (request.phase === 'position') {
    const position = parsePlayerPositionSnbt(payload);
    if (!position) return false;
    request.position = position;
    finishPlayerInspectionPhase(key);
    return true;
  }
  if (request.phase === 'dimension') {
    request.dimension = String(payload || '').trim().replace(/^["']|["']$/g, '').replace(/^minecraft:/, '');
    finishPlayerInspectionPhase(key);
    return true;
  }
  if (request.phase === 'inventory') {
    request.inventory = parsePlayerInventorySnbt(payload);
    finishPlayerInspectionPhase(key);
    return true;
  }
  if (request.phase === 'equipment') {
    request.inventory = mergePlayerInspectionItems(request.inventory, parsePlayerEquipmentSnbt(payload));
    finishPlayerInspectionPhase(key);
    return true;
  }
  if (['health', 'food', 'xpLevel', 'xpProgress'].includes(request.phase)) {
    const number = parsePlayerScalarSnbt(payload);
    if (number === null) return false;
    request[request.phase] = number;
    finishPlayerInspectionPhase(key);
    return true;
  }
  return false;
}

function notePlayerInspectionOutput(chunk) {
  if (!playerInspectionRequests.size) { playerInspectionLogRemainder = ''; return; }
  const consumed = consumePlayerLogChunk(playerInspectionLogRemainder, chunk);
  playerInspectionLogRemainder = consumed.remainder;
  for (const line of consumed.lines) {
    for (const [key, request] of playerInspectionRequests) {
      const match = line.match(new RegExp(`${escapeRegExp(request.player)} has the following entity data:\\s*(.+)$`, 'i'));
      if (match && advancePlayerInspection(key, match[1])) break;
      if (request.phase === 'equipment' && /Found no elements matching.*["']?equipment["']?/i.test(line)) {
        advancePlayerInspection(key, '{}');
        break;
      }
      if (new RegExp(`(?:No entity was found|Found no elements matching).*${escapeRegExp(request.player)}|${escapeRegExp(request.player)}.*(?:No entity was found|Found no elements matching)`, 'i').test(line)) {
        if (request.phase === 'dimension') advancePlayerInspection(key, 'unknown');
        else if (request.phase === 'equipment') advancePlayerInspection(key, '{}');
        else clearPlayerInspectionRequest(key, new Error(`${request.player} is no longer online.`));
        break;
      }
    }
  }
}

async function inspectPlayer(name) {
  const player = validatePlayerName(name);
  const key = player.toLowerCase();
  if (!isServerRuntimeReady()) throw new Error('The server must be running before viewing a player.');
  if (!livePlayers.has(key)) throw new Error(`${player} is no longer online.`);
  const pose = playerPoseRequests.get(key)?.promise;
  if (pose) await pose.catch(() => null);
  let promise = playerInspectionRequests.get(key)?.promise;
  if (!promise) {
    if (playerInspectionRequests.size >= MAX_PLAYER_INSPECTION_REQUESTS) {
      throw new Error('Too many player views are loading. Wait for one to finish and try again.');
    }
    let resolve;
    let reject;
    promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    const request = {
      player: livePlayers.get(key) || player,
      phase: 'position',
      position: null,
      dimension: '',
      inventory: [],
      health: 0,
      food: 0,
      xpLevel: 0,
      xpProgress: 0,
      timer: null,
      resolve,
      reject,
      promise
    };
    playerInspectionRequests.set(key, request);
    sendPlayerInspectionPhase(key);
  }
  const snapshot = await promise;
  const paths = await getPaths();
  const identity = await resolvePlayerIdentity(paths, snapshot.player).catch(() => ({ name: snapshot.player, uuid: '' }));
  const config = await readConfig();
  const itemIds = [...new Set(snapshot.inventory.map((item) => item.id).filter(Boolean))].sort();
  const assetKey = crypto.createHash('sha256').update(`${config.serverVersion}\0${itemIds.join('\0')}`).digest('hex');
  const [skin, localAssets] = await Promise.all([
    getPlayerSkin(identity).catch(() => emptyPlayerSkinResult(identity)),
    getCachedWork(`player-assets:${assetKey}`, 5 * 60_000, () => resolveLocalMinecraftAssets({
      version: normalizeAddonVersion(config.serverVersion),
      itemIds
    })).catch(() => null)
  ]);
  const itemAssets = new Map((localAssets?.items || []).map((item) => [item.id, item]));
  const inventory = snapshot.inventory.map((item) => ({
    ...item,
    iconDataUrl: itemAssets.get(item.id)?.dataUrl || '',
    equipmentDataUrl: itemAssets.get(item.id)?.equipmentDataUrl || ''
  }));
  const hud = localAssets?.hud || {};
  const spectate = await getPlayerSpectateStatus(snapshot.player);
  return {
    ...snapshot,
    uuid: identity.uuid || '',
    skin,
    inventory,
    spectate,
    assets: {
      source: localAssets?.available ? 'local-client' : '',
      version: localAssets?.version || '',
      hud: {
        heartContainer: hud.heart?.empty || '',
        heartHalf: hud.heart?.half || '',
        heartFull: hud.heart?.full || '',
        foodEmpty: hud.hunger?.empty || '',
        foodHalf: hud.hunger?.half || '',
        foodFull: hud.hunger?.full || '',
        experienceBackground: hud.xp?.background || '',
        experienceProgress: hud.xp?.progress || ''
      },
      slots: {
        helmet: localAssets?.equipmentSlots?.helmet || '',
        chestplate: localAssets?.equipmentSlots?.chestplate || '',
        leggings: localAssets?.equipmentSlots?.leggings || '',
        boots: localAssets?.equipmentSlots?.boots || '',
        offhand: localAssets?.equipmentSlots?.offhand || ''
      }
    }
  };
}

function normalizePlayerStatistics(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value.stats || value) : {};
  const categories = [];
  let totalEntries = 0;
  for (const [categoryId, rawEntries] of Object.entries(source)) {
    if (categories.length >= 128 || totalEntries >= MAX_PLAYER_STAT_ENTRIES) break;
    if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) continue;
    const entries = [];
    for (const [statId, rawValue] of Object.entries(rawEntries)) {
      if (entries.length >= 5000 || totalEntries + entries.length >= MAX_PLAYER_STAT_ENTRIES) break;
      const statValue = Number(rawValue);
      if (!Number.isSafeInteger(statValue) || statValue < 0) continue;
      entries.push({ id: String(statId).slice(0, 256), value: statValue });
    }
    entries.sort((left, right) => right.value - left.value || left.id.localeCompare(right.id));
    if (!entries.length) continue;
    totalEntries += entries.length;
    categories.push({ id: String(categoryId).slice(0, 128), entries });
  }
  categories.sort((left, right) => left.id.localeCompare(right.id));
  return { categories, totalEntries };
}

async function getPlayerStatistics(name) {
  const player = validatePlayerName(name);
  const paths = await getPaths();
  const config = await readConfig();
  const identity = await resolvePlayerIdentity(paths, player);
  if (!identity.uuid) return { player, uuid: '', categories: [], totalEntries: 0, updatedAt: '' };
  const worldName = validateWorldName(config.levelName || 'world');
  const worldRoot = resolveContainedPath(paths.root, path.join(paths.root, worldName));
  const statsRoot = resolveContainedPath(worldRoot, path.join(worldRoot, 'stats'));
  const file = resolveContainedPath(statsRoot, path.join(statsRoot, `${identity.uuid}.json`));
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('The player statistics file is invalid or too large.');
    const normalized = normalizePlayerStatistics(JSON.parse(await fs.readFile(file, 'utf8')));
    return { player: identity.name || player, uuid: identity.uuid, ...normalized, updatedAt: stat.mtime.toISOString() };
  } catch (error) {
    if (error.code === 'ENOENT') return { player: identity.name || player, uuid: identity.uuid, categories: [], totalEntries: 0, updatedAt: '' };
    if (error instanceof SyntaxError) throw new Error('Minecraft saved invalid player statistics data.');
    throw error;
  }
}

function normalizePlayerUuid(value) {
  const compact = String(value || '').trim().toLowerCase().replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/.test(compact)) return '';
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function offlinePlayerUuid(name) {
  const bytes = crypto.createHash('md5').update(`OfflinePlayer:${validatePlayerName(name)}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return normalizePlayerUuid(bytes.toString('hex'));
}

function normalizeBanMessage(value) {
  return String(value || '')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function formatMinecraftBanDate(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid ban date.');
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} `
    + `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function normalizeTempBanRequest(value, message = '', now = Date.now()) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const cleanMessage = normalizeBanMessage(source ? (source.reason ?? source.message ?? message) : message);
  let endAt;
  if (source && source.endAt !== undefined && source.endAt !== null && source.endAt !== '') {
    endAt = typeof source.endAt === 'number' ? source.endAt : Date.parse(String(source.endAt));
    if (!Number.isFinite(endAt)) throw new Error('Temporary ban end date is invalid.');
    endAt = now + normalizeTempBanDurationMs(endAt - now);
  } else {
    const duration = source ? source.durationMs : value;
    endAt = now + normalizeTempBanDurationMs(duration);
  }
  return { endAt, durationMs: endAt - now, message: cleanMessage };
}

function serializePlayerBanMutation(paths, name, work) {
  if (serverToolMutationCoordinator.getActiveKey().startsWith('world:reset:')) {
    return Promise.reject(new Error('Wait for Reset Data to finish before changing player bans.'));
  }
  const key = `${path.resolve(paths.root)}\0${String(name).toLowerCase()}`;
  const previous = playerBanMutations.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  playerBanMutations.set(key, current);
  current.finally(() => {
    if (playerBanMutations.get(key) === current) playerBanMutations.delete(key);
  }).catch(() => {});
  return current;
}

async function readJsonArrayFile(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_JSON_BYTES) return [];
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === 'object') : [];
  } catch {
    return [];
  }
}

async function resolvePlayerIdentity(paths, name, knownUuid = '') {
  const clean = validatePlayerName(name);
  const supplied = normalizePlayerUuid(knownUuid);
  if (supplied) return { name: clean, uuid: supplied };
  // usercache.json is the server's freshest authenticated name/UUID mapping.
  // Ban, operator, and whitelist files can retain an older owner of a reused name.
  const candidates = [paths.playerCache, paths.nativePlayerBans, path.join(paths.root, 'ops.json'), path.join(paths.root, 'whitelist.json')];
  for (const file of candidates) {
    const rows = await readJsonArrayFile(file);
    const match = rows.find((entry) => String(entry.name || '').toLowerCase() === clean.toLowerCase());
    const uuid = normalizePlayerUuid(match?.uuid);
    if (uuid) return { name: String(match.name || clean), uuid };
  }
  const config = await readJson(paths.config, DEFAULT_CONFIG);
  return { name: clean, uuid: config.onlineMode === false ? offlinePlayerUuid(clean) : '' };
}

function normalizePlayerSkinRequest(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawName = String(source.name || '').trim();
  const name = /^[A-Za-z0-9_]{1,16}$/.test(rawName) ? rawName : '';
  const uuid = normalizePlayerUuid(source.uuid || source.id);
  return { name, uuid };
}

function emptyPlayerSkinResult(identity = {}) {
  const request = normalizePlayerSkinRequest(identity);
  return { name: request.name, uuid: request.uuid, model: 'classic', skinDataUrl: '' };
}

function normalizeOfficialSkinTextureUrl(value) {
  let source;
  try {
    source = new URL(String(value || ''));
  } catch {
    throw new Error('The player profile contained an invalid skin URL.');
  }
  if (!['http:', 'https:'].includes(source.protocol)
    || source.hostname.toLowerCase() !== 'textures.minecraft.net'
    || source.username
    || source.password
    || source.port
    || source.search
    || source.hash
    || !/^\/texture\/[a-f0-9]{32,128}$/i.test(source.pathname)) {
    throw new Error('The player profile contained an untrusted skin URL.');
  }
  const secureUrl = `https://textures.minecraft.net${source.pathname}`;
  return assertSafeHttpsUrl(secureUrl, ['textures.minecraft.net']).toString();
}

function parseOfficialPlayerSkinProfile(profile, fallback = {}, options = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('The official player profile was invalid.');
  }
  const fallbackIdentity = normalizePlayerSkinRequest(fallback);
  const rawName = String(profile.name || fallbackIdentity.name || '').trim();
  const name = /^[A-Za-z0-9_]{1,16}$/.test(rawName) ? rawName : fallbackIdentity.name;
  const uuid = normalizePlayerUuid(profile.id || fallbackIdentity.uuid);
  if (!uuid) throw new Error('The official player profile did not contain a valid UUID.');
  if (options.enforceRequestedName && fallbackIdentity.name && name.toLowerCase() !== fallbackIdentity.name.toLowerCase()) {
    throw new Error('The official player profile name did not match the requested player.');
  }
  if (fallbackIdentity.uuid && uuid !== fallbackIdentity.uuid) {
    throw new Error('The official player profile UUID did not match the requested player.');
  }
  const property = Array.isArray(profile.properties)
    ? profile.properties.find((entry) => entry?.name === 'textures' && typeof entry.value === 'string')
    : null;
  if (!property) return { name, uuid, model: 'classic', skinUrl: '' };
  if (typeof property.signature !== 'string'
    || property.signature.length < 128
    || property.signature.length > 4096
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(property.signature)) {
    throw new Error('The official player texture payload was not signed.');
  }
  const encoded = property.value.trim();
  if (!encoded || encoded.length > 256 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('The official player texture payload was invalid.');
  }
  let payload;
  try {
    const decoded = Buffer.from(encoded, 'base64');
    if (!decoded.length || decoded.length > 128 * 1024) throw new Error('Texture payload too large.');
    payload = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw new Error('The official player texture payload was invalid.');
  }
  const payloadUuid = normalizePlayerUuid(payload?.profileId);
  if (payloadUuid && payloadUuid !== uuid) throw new Error('The official texture payload UUID did not match the player.');
  if (payload?.profileName && String(payload.profileName).toLowerCase() !== name.toLowerCase()) {
    throw new Error('The official texture payload name did not match the player.');
  }
  const skin = payload?.textures?.SKIN;
  if (!skin?.url) return { name, uuid, model: 'classic', skinUrl: '' };
  return {
    name,
    uuid,
    model: skin.metadata?.model === 'slim' ? 'slim' : 'classic',
    skinUrl: normalizeOfficialSkinTextureUrl(skin.url)
  };
}

function validatePlayerSkinPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 57 || buffer.length > MAX_PLAYER_SKIN_BYTES) {
    throw new Error('The official skin image was invalid.');
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('The official skin image was not a valid PNG.');
  }
  let offset = pngSignature.length;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('The official skin PNG was truncated.');
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (length > MAX_PLAYER_SKIN_BYTES || chunkEnd > buffer.length || !/^[A-Za-z]{4}$/.test(type)) {
      throw new Error('The official skin PNG contained an invalid chunk.');
    }
    if (!sawHeader && type !== 'IHDR') throw new Error('The official skin PNG header was missing.');
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw new Error('The official skin PNG header was invalid.');
      sawHeader = true;
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      if (width !== 64 || ![32, 64].includes(height)) {
        throw new Error('The official skin image was not a 64-pixel Minecraft skin PNG.');
      }
    } else if (type === 'IDAT') {
      if (length > 0) sawImageData = true;
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('The official skin PNG end marker was invalid.');
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== buffer.length) {
    throw new Error('The official skin PNG was incomplete.');
  }
  if (nativeImage?.createFromBuffer) {
    let decoded;
    try {
      decoded = nativeImage.createFromBuffer(buffer);
    } catch {
      decoded = null;
    }
    const size = decoded && !decoded.isEmpty?.() ? decoded.getSize?.() : null;
    if (!size || size.width !== 64 || ![32, 64].includes(size.height)) {
      throw new Error('The official skin PNG could not be decoded safely.');
    }
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('The official skin image was not a 64-pixel Minecraft skin PNG.');
  }
  return buffer;
}

function normalizePlayerSkinDataUrl(value) {
  const match = String(value || '').match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('The cached player skin was invalid.');
  const image = validatePlayerSkinPng(Buffer.from(match[1], 'base64'));
  return `data:image/png;base64,${image.toString('base64')}`;
}

function getPlayerSkinCacheRoot() {
  const userData = path.resolve(app.getPath('userData'));
  return resolveContainedPath(userData, path.join(userData, 'cache', 'player-skins'));
}

function getPlayerSkinCacheFiles(identity = {}, allowNameAlias = true) {
  const request = normalizePlayerSkinRequest(identity);
  const root = getPlayerSkinCacheRoot();
  const files = [];
  if (request.uuid) files.push(resolveContainedPath(root, path.join(root, `uuid-${request.uuid.replace(/-/g, '')}.json`)));
  if (allowNameAlias && request.name) files.push(resolveContainedPath(root, path.join(root, `name-${request.name.toLowerCase()}.json`)));
  return [...new Set(files)];
}

function normalizeCachedPlayerSkin(value, requestedIdentity = {}) {
  const request = normalizePlayerSkinRequest(requestedIdentity);
  const result = emptyPlayerSkinResult(value);
  if (!result.uuid || !result.name || !value?.skinDataUrl) return null;
  if (request.uuid && result.uuid !== request.uuid) return null;
  if (!request.uuid && request.name && result.name.toLowerCase() !== request.name.toLowerCase()) return null;
  result.model = value.model === 'slim' ? 'slim' : 'classic';
  result.skinDataUrl = normalizePlayerSkinDataUrl(value.skinDataUrl);
  const cachedAt = Number(value.cachedAt);
  if (!Number.isFinite(cachedAt) || cachedAt <= 0) return null;
  return { result, cachedAt };
}

async function readCachedPlayerSkin(identity, allowNameAlias = true) {
  for (const file of getPlayerSkinCacheFiles(identity, allowNameAlias)) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PLAYER_SKIN_CACHE_BYTES) continue;
      const record = normalizeCachedPlayerSkin(JSON.parse(await fs.readFile(file, 'utf8')), identity);
      if (record) return { ...record, fresh: Date.now() - record.cachedAt <= PLAYER_SKIN_CACHE_TTL_MS };
    } catch {}
  }
  return null;
}

async function writeCachedPlayerSkin(result) {
  const normalized = emptyPlayerSkinResult(result);
  normalized.name = /^[A-Za-z0-9_]{1,16}$/.test(String(result?.name || '')) ? String(result.name) : '';
  normalized.model = result?.model === 'slim' ? 'slim' : 'classic';
  normalized.skinDataUrl = normalizePlayerSkinDataUrl(result?.skinDataUrl);
  if (!normalized.name || !normalized.uuid) throw new Error('Cannot cache a player skin without a verified identity.');
  const record = { ...normalized, cachedAt: Date.now() };
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_PLAYER_SKIN_CACHE_BYTES) {
    throw new Error('The player skin cache record was too large.');
  }
  for (const file of getPlayerSkinCacheFiles(normalized, true)) {
    await serializeFileWrite(file, () => writeJsonAtomically(file, record));
  }
  return normalized;
}

async function getOfficialPlayerProfileByName(name) {
  const clean = validatePlayerName(name);
  const profile = await getJson(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(clean)}`,
    {},
    { allowedHosts: ['api.mojang.com'], maxRedirects: 0, maxBytes: 64 * 1024, timeoutMs: 8_000 }
  );
  const uuid = normalizePlayerUuid(profile?.id);
  const canonicalName = String(profile?.name || '').trim();
  if (!uuid
    || !/^[A-Za-z0-9_]{1,16}$/.test(canonicalName)
    || canonicalName.toLowerCase() !== clean.toLowerCase()) {
    throw new Error('The official player was not found.');
  }
  return { name: canonicalName, uuid };
}

async function getOfficialPlayerSkinProfile(identity, options = {}) {
  const request = normalizePlayerSkinRequest(identity);
  if (!request.uuid) throw new Error('A verified player UUID is required.');
  const compactUuid = request.uuid.replace(/-/g, '');
  const profile = await getJson(
    `https://sessionserver.mojang.com/session/minecraft/profile/${compactUuid}?unsigned=false`,
    {},
    { allowedHosts: ['sessionserver.mojang.com'], maxRedirects: 0, maxBytes: 256 * 1024, timeoutMs: 8_000 }
  );
  return parseOfficialPlayerSkinProfile(profile, request, options);
}

async function resolveAndDownloadPlayerSkin(paths, request, allowNameLookup, lookup = {}) {
  let identity = request;
  if (request.name && !request.uuid) {
    identity = await resolvePlayerIdentity(paths, request.name).catch(() => request);
  }
  const lookupName = String(lookup.name || request.name || '').trim();
  const uuidAuthoritative = Boolean(lookup.uuidAuthoritative);
  let profile = null;
  if (identity.uuid) {
    profile = await getOfficialPlayerSkinProfile(identity, {
      enforceRequestedName: Boolean(lookupName && !uuidAuthoritative)
    }).catch(() => null);
  }
  if (!profile && allowNameLookup && lookupName && !uuidAuthoritative) {
    const officialIdentity = await getOfficialPlayerProfileByName(lookupName);
    profile = await getOfficialPlayerSkinProfile(officialIdentity);
  }
  if (!profile) return emptyPlayerSkinResult(identity);
  if (!profile.skinUrl) return emptyPlayerSkinResult(profile);
  const image = validatePlayerSkinPng(await getBuffer(profile.skinUrl, {
    allowedHosts: ['textures.minecraft.net'],
    maxRedirects: 0,
    maxBytes: MAX_PLAYER_SKIN_BYTES,
    timeoutMs: 8_000,
    accept: 'image/png'
  }));
  return {
    name: profile.name,
    uuid: profile.uuid,
    model: profile.model,
    skinDataUrl: `data:image/png;base64,${image.toString('base64')}`
  };
}

async function getPlayerSkin(value = {}) {
  const request = normalizePlayerSkinRequest(value);
  if (!request.name && !request.uuid) return emptyPlayerSkinResult();
  const paths = await getPaths();
  const config = await readJson(paths.config, DEFAULT_CONFIG);
  const allowNameLookup = config.onlineMode !== false;
  let identity = request;
  if (request.name && !request.uuid) {
    identity = await resolvePlayerIdentity(paths, request.name).catch(() => request);
  }
  const cacheKey = identity.uuid || identity.name.toLowerCase();
  return getCachedWork(`player-skin:${cacheKey}:${allowNameLookup ? 'online' : 'offline'}`, PLAYER_SKIN_MEMORY_TTL_MS, async () => {
    const cached = await readCachedPlayerSkin(identity, allowNameLookup);
    const nameOriginated = Boolean(request.name && !request.uuid);
    const usableCached = nameOriginated && cached?.result?.name?.toLowerCase() !== request.name.toLowerCase()
      ? null
      : cached;
    if (usableCached?.fresh) return usableCached.result;
    try {
      const result = await resolveAndDownloadPlayerSkin(paths, identity, allowNameLookup, {
        name: request.name,
        uuidAuthoritative: Boolean(request.uuid)
      });
      if (result.skinDataUrl) {
        await writeCachedPlayerSkin(result).catch(() => {});
        return result;
      }
      return usableCached?.result || result;
    } catch {
      return usableCached?.result || emptyPlayerSkinResult(identity);
    }
  });
}

function prewarmAuthenticatedPlayerSkin(name) {
  const clean = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) return;
  const key = clean.toLowerCase();
  if (playerSkinPrewarmKeys.has(key) || playerSkinPrewarmQueue.length >= 64) return;
  playerSkinPrewarmKeys.add(key);
  playerSkinPrewarmQueue.push({ key, name: clean });
  drainPlayerSkinPrewarmQueue();
}

function drainPlayerSkinPrewarmQueue() {
  while (playerSkinPrewarmActive < 2 && playerSkinPrewarmQueue.length) {
    const request = playerSkinPrewarmQueue.shift();
    playerSkinPrewarmActive += 1;
    getPaths()
      .then(async (paths) => {
        const config = await readJson(paths.config, DEFAULT_CONFIG);
        if (config.onlineMode !== false) await getPlayerSkin({ name: request.name });
      })
      .catch(() => {})
      .finally(() => {
        playerSkinPrewarmActive -= 1;
        playerSkinPrewarmKeys.delete(request.key);
        drainPlayerSkinPrewarmQueue();
      });
  }
}

async function enrichPlayerSamples(entries) {
  const paths = await getPaths();
  const candidates = (Array.isArray(entries) ? entries : []).slice(0, MAX_PLAYER_STATUS_SAMPLE);
  return mapWithConcurrency(candidates, 4, async (entry) => {
    const source = typeof entry === 'string' ? { name: entry } : (entry || {});
    const name = String(source.name || '').trim();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
    const suppliedUuid = normalizePlayerUuid(source.uuid || source.id);
    const identity = suppliedUuid
      ? { name, uuid: suppliedUuid }
      : await getCachedWork(`player-identity:${paths.root}:${name.toLowerCase()}`, 10_000, () => resolvePlayerIdentity(paths, name)).catch(() => ({ name, uuid: '' }));
    return { name: identity.name || name, uuid: normalizePlayerUuid(identity.uuid) };
  }).then((rows) => rows.filter(Boolean));
}

function upsertNativePlayerBan(rows, record) {
  const name = validatePlayerName(record?.name);
  const uuid = normalizePlayerUuid(record?.uuid);
  const key = name.toLowerCase();
  const filtered = (Array.isArray(rows) ? rows : []).filter((entry) => {
    const sameName = String(entry?.name || '').toLowerCase() === key;
    const sameUuid = uuid && normalizePlayerUuid(entry?.uuid) === uuid;
    return !sameName && !sameUuid;
  });
  if (!uuid) return filtered;
  const endAt = Number(record.endAt) || 0;
  filtered.push({
    uuid,
    name,
    created: formatMinecraftBanDate(record.createdAt || Date.now()),
    source: String(record.source || 'Server').slice(0, 64),
    expires: endAt ? formatMinecraftBanDate(endAt) : 'forever',
    reason: normalizeBanMessage(record.commandReason ?? record.message ?? record.reason)
  });
  return filtered;
}

function removeNativePlayerBan(rows, name, uuid = '') {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  const normalizedUuid = normalizePlayerUuid(uuid);
  return (Array.isArray(rows) ? rows : []).filter((entry) => {
    const sameName = String(entry?.name || '').toLowerCase() === key;
    const sameUuid = normalizedUuid && normalizePlayerUuid(entry?.uuid) === normalizedUuid;
    return !sameName && !sameUuid;
  });
}

async function writeNativePlayerBan(paths, record) {
  return serializeFileWrite(paths.nativePlayerBans, async () => {
    const rows = await readJsonArrayFile(paths.nativePlayerBans);
    const next = upsertNativePlayerBan(rows, record);
    await writeJsonAtomically(paths.nativePlayerBans, next);
    return Boolean(normalizePlayerUuid(record.uuid));
  });
}

async function removeNativePlayerBanForPaths(paths, name, uuid = '') {
  return serializeFileWrite(paths.nativePlayerBans, async () => {
    const rows = await readJsonArrayFile(paths.nativePlayerBans);
    const next = removeNativePlayerBan(rows, name, uuid);
    if (next.length !== rows.length) await writeJsonAtomically(paths.nativePlayerBans, next);
    return next;
  });
}

async function persistManagedBan(paths, key, record) {
  return serializeFileWrite(paths.assemblyBans, async () => {
    const stored = await readJson(paths.assemblyBans, {});
    stored[key] = record;
    await writeJsonAtomically(paths.assemblyBans, stored);
    if (await serverPathsAreActive(paths)) replaceAssemblyBanCache(paths, stored);
    return record;
  });
}

async function removeManagedBan(paths, key) {
  return serializeFileWrite(paths.assemblyBans, async () => {
    const stored = await readJson(paths.assemblyBans, {});
    delete stored[key];
    await writeJsonAtomically(paths.assemblyBans, stored);
    if (await serverPathsAreActive(paths)) replaceAssemblyBanCache(paths, stored);
  });
}

async function readManagedBan(paths, key) {
  return serializeFileWrite(paths.assemblyBans, async () => {
    const stored = await readJson(paths.assemblyBans, {});
    return stored[key] && typeof stored[key] === 'object' ? stored[key] : {};
  });
}

function resetProtectionOffenseProperties(text, name, uuid = '') {
  const clean = validatePlayerName(name);
  const normalizedUuid = normalizePlayerUuid(uuid);
  const lines = String(text || '').split(/\r?\n/);
  const ids = new Set();
  for (const line of lines) {
    const match = line.match(/^([a-f0-9-]{36})\.name\s*[=:]\s*(.*)$/i);
    if (match && String(match[2] || '').trim().toLowerCase() === clean.toLowerCase()) ids.add(match[1].toLowerCase());
  }
  if (normalizedUuid) ids.add(normalizedUuid);
  if (!ids.size) return { text: String(text || ''), changed: false };
  const replacements = new Map();
  for (const id of ids) {
    replacements.set(`${id}.temporarybanuntil`, { key: `${id}.temporaryBanUntil`, value: '0' });
    replacements.set(`${id}.permanentban`, { key: `${id}.permanentBan`, value: 'false' });
    replacements.set(`${id}.offenses`, { key: `${id}.offenses`, value: '0' });
    replacements.set(`${id}.lastaction`, { key: `${id}.lastAction`, value: 'pardoned' });
  }
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([^#!\s][^=:]*?)\s*[=:]\s*(.*)$/);
    const key = String(match?.[1] || '').trim().toLowerCase();
    if (!replacements.has(key)) return line;
    seen.add(key);
    return `${match[1]}=${replacements.get(key).value}`;
  });
  for (const [key, replacement] of replacements) {
    if (!seen.has(key)) next.push(`${replacement.key}=${replacement.value}`);
  }
  return { text: `${next.join('\n').replace(/\n+$/, '')}\n`, changed: true };
}

async function resetProtectionOffensePath(file, name, uuid = '') {
  return serializeFileWrite(file, async () => {
    let text;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('Protection offense data is too large.');
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    const reset = resetProtectionOffenseProperties(text, name, uuid);
    if (!reset.changed) return false;
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(temporary, reset.text);
    await replaceFileAtomically(temporary, file);
    return true;
  });
}

async function resetProtectionOffenseFile(paths, name, uuid = '') {
  const candidates = [paths.protectionOffenses, paths.legacyProtectionOffenses, paths.fabricProtectionOffenses]
    .filter(Boolean);
  const unique = [...new Set(candidates.map((file) => path.resolve(file)))];
  const results = await Promise.all(unique.map((file) => resetProtectionOffensePath(file, name, uuid)));
  return results.some(Boolean);
}

function sendServerCommandBatch(commands) {
  if (!isServerRuntimeReady()) return false;
  const safe = (Array.isArray(commands) ? commands : [])
    .map((command) => String(command || '').replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean);
  return safe.length ? tryWriteServerInput(serverProcess, safe.join('\n')) : false;
}

function replaceRuntimePlayerBan(name, reason) {
  const clean = validatePlayerName(name);
  const suffix = normalizeBanMessage(reason);
  return sendServerCommandBatch([
    `ban ${clean}${suffix ? ` ${suffix}` : ''}`,
    `serverprotection pardon ${clean}`,
    `pardon ${clean}`,
    `ban ${clean}${suffix ? ` ${suffix}` : ''}`
  ]);
}

function requireRuntimeCommandDelivery(wasReady, delivered, action) {
  if (wasReady && !delivered) {
    throw new Error(`${action} was saved, but the running server did not accept the console command. Retry once the server is ready.`);
  }
}

function getPardonCommands(name) {
  const clean = validatePlayerName(name);
  return [`pardon ${clean}`, `serverprotection pardon ${clean}`];
}

function formatBanDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatBanDuration(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return `${days} day${days === 1 ? '' : 's'}${hours ? ` ${hours} hour${hours === 1 ? '' : 's'}` : ''}`;
  if (hours) return `${hours} hour${hours === 1 ? '' : 's'}${minutes ? ` ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}`;
  if (minutes) return `${minutes} minute${minutes === 1 ? '' : 's'}${seconds ? ` ${seconds} second${seconds === 1 ? '' : 's'}` : ''}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function buildAssemblyTempBanReason(endAt, message = '') {
  const prefix = normalizeBanMessage(message);
  const lead = prefix ? `${prefix} ` : '';
  return `${lead}Banned until ${formatBanDateTime(endAt)}.`;
}

function emitBanList(bans) {
  emitAll('server:bans', bans);
}

function clearTempBanTimers(key) {
  clearTimeout(tempBanTimers.get(key));
  tempBanTimers.delete(key);
}

function normalizeTempBanDurationMs(value) {
  const duration = Math.round(Number(value));
  if (!Number.isFinite(duration) || duration < 60_000) {
    throw new Error('Temporary ban duration must be at least 1 minute.');
  }
  return Math.min(MAX_TEMP_BAN_DURATION_MS, duration);
}

function getTempBanTimerDelay(endAt, now = Date.now()) {
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(1, Number(endAt) - Number(now)));
}

function scheduleTempBanExpiry(name, endAt, pathsOverride = null) {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  clearTimeout(tempBanTimers.get(key));
  if (!tempBanTimers.has(key) && tempBanTimers.size >= MAX_TEMP_BAN_TIMERS) return;
  const checkExpiry = () => {
    const remaining = Number(endAt) - Date.now();
    if (remaining <= 0) {
      tempBanTimers.delete(key);
      Promise.resolve().then(async () => {
        if (pathsOverride && !await serverPathsAreActive(pathsOverride)) return;
        await pardonPlayer(clean, { paths: pathsOverride, expectedEndAt: Number(endAt) });
      }).catch(() => {});
      return;
    }
    const timer = setTimeout(checkExpiry, getTempBanTimerDelay(endAt));
    timer.unref?.();
    tempBanTimers.set(key, timer);
  };
  checkExpiry();
}

async function applyManagedBansAtStartup(lifecycleContext = null) {
  const paths = lifecycleContext?.paths || await getPaths();
  const isCurrent = lifecycleContext
    ? () => revalidateServerLifecycleContext(lifecycleContext)
    : null;
  const loaded = await readAssemblyBans(paths, isCurrent);
  if (loaded === false || (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext))) return false;
  let changed = false;
  for (const [key, managed] of [...assemblyBans]) {
    if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
    try {
      const clean = validatePlayerName(managed?.name || key);
      const endAt = Number(managed?.endAt) || 0;
      if (endAt && endAt <= Date.now()) {
        await removeManagedBan(paths, key);
        if (lifecycleContext && !await revalidateServerLifecycleContext(lifecycleContext)) return false;
        clearTempBanTimers(key);
        await removeNativePlayerBanForPaths(paths, clean, managed?.uuid);
        await resetProtectionOffenseFile(paths, clean, managed?.uuid);
        if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
        sendServerCommandBatch(getPardonCommands(clean));
        changed = true;
        continue;
      }
      const reason = endAt
        ? buildAssemblyTempBanReason(endAt, managed?.message)
        : String(managed?.message ?? managed?.reason ?? '').trim();
      managed.commandReason = reason;
      assemblyBans.set(key, managed);
      if (lifecycleContext && !isCurrentServerLifecycleContext(lifecycleContext)) return false;
      replaceRuntimePlayerBan(clean, reason);
      if (endAt) {
        scheduleTempBanExpiry(clean, endAt, paths);
      }
      changed = true;
    } catch (error) {
      appendServerLog(`[Server Manager] Could not restore a managed ban: ${error.message || String(error)}\n`);
    }
  }
  if (changed) {
    if (lifecycleContext && !await revalidateServerLifecycleContext(lifecycleContext)) return false;
    await writeAssemblyBans(paths);
  }
  if (lifecycleContext && !await revalidateServerLifecycleContext(lifecycleContext)) return false;
  await getBannedPlayers(paths, lifecycleContext);
  return true;
}

async function reconcileManagedBanFilesBeforeStartup(paths) {
  await readAssemblyBans(paths);
  const now = Date.now();
  for (const [key, stored] of [...assemblyBans]) {
    const clean = validatePlayerName(stored?.name || key);
    const endAt = Number(stored?.endAt) || 0;
    if (endAt && endAt <= now) {
      clearTempBanTimers(key);
      await removeManagedBan(paths, key);
      await removeNativePlayerBanForPaths(paths, clean, stored?.uuid);
      await resetProtectionOffenseFile(paths, clean, stored?.uuid);
      continue;
    }
    const identity = await resolvePlayerIdentity(paths, clean, stored?.uuid);
    const message = normalizeBanMessage(stored?.message ?? stored?.reason);
    const record = {
      ...stored,
      name: clean,
      uuid: identity.uuid,
      endAt,
      source: stored?.source || 'Server',
      reason: message,
      message,
      commandReason: endAt ? buildAssemblyTempBanReason(endAt, message) : message,
      managed: true
    };
    await persistManagedBan(paths, key, record);
    await writeNativePlayerBan(paths, record);
    if (endAt) scheduleTempBanExpiry(clean, endAt, paths);
  }
}

function parseBanExpiry(value, now = Date.now()) {
  const text = String(value || '').trim();
  if (!text || /^(?:forever|permanent|never)$/i.test(text)) return { endAt: 0, temporary: false, expired: false };
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return { endAt: 0, temporary: false, expired: false };
  return { endAt: parsed, temporary: parsed > now, expired: parsed <= now };
}

async function getBannedPlayers(pathsOverride = null, lifecycleContext = null) {
  const paths = pathsOverride || await getPaths();
  const requestIsCurrent = lifecycleContext
    ? () => revalidateServerLifecycleContext(lifecycleContext)
    : () => serverPathsAreActive(paths);
  if (!await requestIsCurrent()) return [];
  if (assemblyBansPath !== getAssemblyBanCachePath(paths)) {
    const loaded = await readAssemblyBans(paths, requestIsCurrent);
    if (loaded === false) return [];
  }
  if (requestIsCurrent && !await requestIsCurrent()) return [];
  const file = path.join(paths.root, 'banned-players.json');
  const diskBans = await readJsonArrayFile(file);
  if (requestIsCurrent && !await requestIsCurrent()) return [];
  const now = Date.now();
  const rows = [];
  for (const entry of Array.isArray(diskBans) ? diskBans : []) {
    const name = String(entry.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const managed = assemblyBans.get(key) || {};
    const diskExpiry = parseBanExpiry(entry.expires, now);
    const endAt = Number(managed.endAt) || diskExpiry.endAt || 0;
    if (endAt && endAt <= now) {
      await removeManagedBan(paths, key);
      await removeNativePlayerBanForPaths(paths, name, managed.uuid || entry.uuid);
      if (requestIsCurrent && !await requestIsCurrent()) return rows;
      continue;
    }
    if (!managed.managed && diskExpiry.expired) continue;
    rows.push({
      name,
      uuid: normalizePlayerUuid(entry.uuid) || normalizePlayerUuid(managed.uuid),
      source: managed.source || entry.source || 'Minecraft',
      created: entry.created || '',
      reason: managed.managed ? String(managed.message ?? managed.reason ?? '') : entry.reason || '',
      expires: endAt ? new Date(endAt).toISOString() : 'forever',
      endAt,
      temporary: Boolean(endAt || diskExpiry.temporary),
      permanent: !endAt,
      remainingMs: endAt ? Math.max(0, endAt - now) : null,
      managed: Boolean(managed.managed)
    });
  }
  for (const [key, managed] of [...assemblyBans]) {
    if (rows.some((row) => row.name.toLowerCase() === key)) continue;
    const endAt = Number(managed.endAt) || 0;
    if (endAt && endAt <= now) {
      await removeManagedBan(paths, key);
      await removeNativePlayerBanForPaths(paths, managed.name || key, managed.uuid);
      if (requestIsCurrent && !await requestIsCurrent()) return rows;
      continue;
    }
    rows.push({
      name: managed.name,
      uuid: normalizePlayerUuid(managed.uuid),
      source: managed.source || 'Server',
      created: new Date(managed.createdAt || Date.now()).toISOString(),
      reason: String(managed.message ?? managed.reason ?? ''),
      expires: endAt ? new Date(endAt).toISOString() : 'forever',
      endAt,
      temporary: Boolean(endAt),
      permanent: !endAt,
      remainingMs: endAt ? Math.max(0, endAt - now) : null,
      managed: true
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  if (requestIsCurrent && !await requestIsCurrent()) return rows;
  for (const row of rows) {
    if (row.temporary && row.managed) {
      const key = row.name.toLowerCase();
      if (!tempBanTimers.has(key)) {
        scheduleTempBanExpiry(row.name, row.endAt, paths);
      }
    }
  }
  if (requestIsCurrent && !await requestIsCurrent()) return rows;
  emitBanList(rows);
  return rows;
}

async function pardonPlayer(name, options = {}) {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  const paths = options?.paths || await getPaths();
  const expectedEndAt = Number(options?.expectedEndAt) || 0;
  return serializePlayerBanMutation(paths, clean, async () => {
    const managed = await readManagedBan(paths, key);
    const identity = await resolvePlayerIdentity(paths, clean, managed.uuid);
    await assertServerPathsAreActive(paths, 'the pardon');
    if (expectedEndAt && Number(managed.endAt) !== expectedEndAt) return getBannedPlayers(paths);
    clearTempBanTimers(key);
    await removeManagedBan(paths, key);
    await assertServerPathsAreActive(paths, 'the pardon');
    await removeNativePlayerBanForPaths(paths, clean, identity.uuid);
    await resetProtectionOffenseFile(paths, clean, identity.uuid);
    await rememberPlayerHistory(clean, 'pardoned', {}, paths);
    await assertServerPathsAreActive(paths, 'the pardon');
    const runtimeReady = isServerRuntimeReady();
    const delivered = sendServerCommandBatch(getPardonCommands(clean));
    requireRuntimeCommandDelivery(runtimeReady, delivered, 'The pardon');
    appendServerLog(`[Server] Pardoned ${clean}.\n`);
    return getBannedPlayers(paths);
  });
}

async function banPlayer(name, message = '') {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  const paths = await getPaths();
  return serializePlayerBanMutation(paths, clean, async () => {
    const reason = normalizeBanMessage(message);
    const current = await readManagedBan(paths, key);
    const identity = await resolvePlayerIdentity(paths, clean, current.uuid);
    const record = {
      name: clean,
      uuid: identity.uuid,
      endAt: 0,
      createdAt: current.createdAt || Date.now(),
      source: 'Server',
      reason,
      commandReason: reason,
      message: reason,
      managed: true
    };
    await assertServerPathsAreActive(paths, 'the ban');
    clearTempBanTimers(key);
    await persistManagedBan(paths, key, record);
    await writeNativePlayerBan(paths, record);
    await assertServerPathsAreActive(paths, 'the ban');
    if (livePlayers.delete(key)) advancePlayerRosterRevision();
    await rememberPlayerHistory(clean, 'ban', { reason }, paths);
    await assertServerPathsAreActive(paths, 'the ban');
    const runtimeReady = isServerRuntimeReady();
    const delivered = replaceRuntimePlayerBan(clean, reason);
    requireRuntimeCommandDelivery(runtimeReady, delivered, 'The ban');
    await emitLivePlayers();
    return getBannedPlayers(paths);
  });
}

async function tempBanPlayer(name, durationMs, message = '') {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  const paths = await getPaths();
  return serializePlayerBanMutation(paths, clean, async () => {
    const now = Date.now();
    const request = normalizeTempBanRequest(durationMs, message, now);
    const current = await readManagedBan(paths, key);
    const identity = await resolvePlayerIdentity(paths, clean, current.uuid);
    const commandReason = buildAssemblyTempBanReason(request.endAt, request.message);
    const record = {
      name: clean,
      uuid: identity.uuid,
      endAt: request.endAt,
      createdAt: current.createdAt || now,
      source: 'Server',
      reason: request.message,
      commandReason,
      message: request.message,
      managed: true
    };
    await assertServerPathsAreActive(paths, 'the temporary ban');
    clearTempBanTimers(key);
    await persistManagedBan(paths, key, record);
    await writeNativePlayerBan(paths, record);
    await assertServerPathsAreActive(paths, 'the temporary ban');
    if (livePlayers.delete(key)) advancePlayerRosterRevision();
    await rememberPlayerHistory(clean, 'temp-ban', {
      reason: request.message,
      expiresAt: new Date(request.endAt).toISOString()
    }, paths);
    await assertServerPathsAreActive(paths, 'the temporary ban');
    scheduleTempBanExpiry(clean, request.endAt, paths);
    const runtimeReady = isServerRuntimeReady();
    const delivered = replaceRuntimePlayerBan(clean, commandReason);
    requireRuntimeCommandDelivery(runtimeReady, delivered, 'The temporary ban');
    await emitLivePlayers();
    return getBannedPlayers(paths);
  });
}

async function shortenBan(name, durationMs, message = '') {
  const clean = validatePlayerName(name);
  const key = clean.toLowerCase();
  const paths = await getPaths();
  return serializePlayerBanMutation(paths, clean, async () => {
    const current = await readManagedBan(paths, key);
    const requestedMessage = message === '' && durationMs && typeof durationMs === 'object'
      ? (durationMs.reason ?? durationMs.message ?? current.message ?? '')
      : (message || current.message || '');
    const request = normalizeTempBanRequest(durationMs, requestedMessage);
    const identity = await resolvePlayerIdentity(paths, clean, current.uuid);
    const commandReason = buildAssemblyTempBanReason(request.endAt, request.message);
    const record = {
      name: clean,
      uuid: identity.uuid,
      endAt: request.endAt,
      createdAt: current.createdAt || Date.now(),
      source: 'Server',
      reason: request.message,
      commandReason,
      message: request.message,
      managed: true
    };
    await assertServerPathsAreActive(paths, 'the temporary-ban update');
    clearTempBanTimers(key);
    await persistManagedBan(paths, key, record);
    await writeNativePlayerBan(paths, record);
    await assertServerPathsAreActive(paths, 'the temporary-ban update');
    scheduleTempBanExpiry(clean, request.endAt, paths);
    appendServerLog(`[Server] Updated ${clean}'s temporary ban.\n`);
    await rememberPlayerHistory(clean, 'temp-ban-updated', {
      reason: request.message,
      expiresAt: new Date(request.endAt).toISOString()
    }, paths);
    await assertServerPathsAreActive(paths, 'the temporary-ban update');
    const runtimeReady = isServerRuntimeReady();
    const delivered = replaceRuntimePlayerBan(clean, commandReason);
    requireRuntimeCommandDelivery(runtimeReady, delivered, 'The temporary-ban update');
    return getBannedPlayers(paths);
  });
}

function stringifySettingValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === undefined || value === null || value === '') return '(blank)';
  return String(value);
}

function getRestartRequiredSettingChanges(previousConfig, nextConfig) {
  if (!previousConfig) return [];
  const restartFields = [
    ['motd', 'MOTD'],
    ['pvp', 'PvP'],
    ['onlineMode', 'Online mode'],
    ['maxPlayers', 'Max players'],
    ['port', 'Port'],
    ['bindIp', 'Server IP bind'],
    ['difficulty', 'Difficulty'],
    ['gamemode', 'Game mode'],
    ['allowFlight', 'Allow flight'],
    ['allowCheats', 'Allow cheats'],
    ['whiteList', 'Whitelist'],
    ['hardcore', 'Hardcore'],
    ['forceGamemode', 'Force gamemode'],
    ['allowNether', 'Allow Nether'],
    ['generateStructures', 'Generate structures'],
    ['spawnAnimals', 'Spawn animals'],
    ['spawnMonsters', 'Spawn monsters'],
    ['spawnNpcs', 'Spawn NPCs'],
    ['spawnProtection', 'Spawn protection']
  ];
  return restartFields
    .filter(([key]) => String(previousConfig[key]) !== String(nextConfig[key]))
    .map(([key, label]) => ({ key, label, value: nextConfig[key] }));
}

function parseSettingValue(raw, currentValue) {
  if (typeof currentValue === 'boolean') {
    if (/^(true|1|yes|on)$/i.test(raw)) return true;
    if (/^(false|0|no|off)$/i.test(raw)) return false;
    throw new Error('Use true/false for this setting.');
  }
  if (typeof currentValue === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Use a number for this setting.');
    return value;
  }
  return String(raw);
}

function formatAssemblyStatus(status) {
  const config = status.config;
  const perf = status.performance || {};
  const diag = status.joinDiagnostics || {};
  return [
    '[Server Console] Status',
    `  State: ${status.state}`,
    `  World: ${config.levelName}`,
    `  Version: ${config.serverVersion}`,
    `  Network mode: ${config.localOnly ? 'local-only (remote status offline)' : 'public/LAN capable'}`,
    `  Address: ${config.localOnly ? `${LOCAL_ONLY_BIND_IP}:${config.port}` : buildPublicJoinAddress(config) || 'not set'}`,
    `  Port: ${config.port}`,
    `  Players: ${Number(status.players?.online) || 0} / ${Number(status.players?.max) || Number(config.maxPlayers) || 0}`,
    `  Memory: ${Number(perf.memoryUsedMb) || 0} / ${Number(perf.memoryAllocatedMb) || Number(config.memoryMb) || 0} MB`,
    `  CPU: ${Number(perf.cpuPercent) || 0}%`,
    `  Java: ${status.java?.available ? status.java.version : status.java?.message || 'not found'}`,
    `  Jar: ${status.jarExists ? 'present' : 'missing'}`,
    `  Direct hosting: ${status.directHosting?.mapped ? status.directHosting.publicAddress || 'mapped' : 'not mapped'}`,
    `  Diagnostic: ${diag.code || 'none'} ${diag.title ? `- ${diag.title}` : ''}`
  ].join('\n');
}

function formatPlayitStatus(status) {
  const code = !status.installed
    ? 'SRV-TUN-404'
    : status.address
      ? 'SRV-TUN-300'
      : status.sessionNotSetup
        ? 'SRV-TUN-101'
        : 'SRV-TUN-000';
  const title = {
    'SRV-TUN-404': 'playit agent is not downloaded',
    'SRV-TUN-300': 'playit tunnel address detected',
    'SRV-TUN-101': 'playit agent is running, but tunnel setup is incomplete',
    'SRV-TUN-000': 'playit agent status'
  }[code];
  const nextStep = status.address
    ? 'Use the detected tunnel address as your public join address.'
    : status.sessionNotSetup
      ? 'Claim the agent and create a Minecraft TCP tunnel to 127.0.0.1:25565 in Playit.'
      : status.installed
        ? 'Run tunnel start, then check Playit for a Minecraft TCP tunnel.'
        : 'Run tunnel download.';
  return [
    `[Server Manager ${code}] ${title}`,
    `  Downloaded: ${status.installed ? 'yes' : 'no'}`,
    `  Running: ${status.running ? 'yes' : 'no'}${status.running && !status.managed ? ' (outside this app session)' : ''}`,
    `  Path: ${status.path}`,
    `  Tunnel address: ${status.address || 'not detected'}`,
    `  Setup link: ${status.setupUrl || 'not detected'}`,
    `  Last useful message: ${status.lastMessage || 'none'}`,
    `  Repeated Playit noise hidden: ${Number(status.spamSuppressed) || 0} lines`,
    `  Next step: ${nextStep}`
  ].join('\n');
}

function formatWorlds(status) {
  const activeId = status.profiles?.activeProfileId;
  const profiles = status.profiles?.profiles || [];
  if (!profiles.length) return '[Server Console] No worlds found.';
  return [
    '[Server Console] Worlds',
    ...profiles.map((profile) => `  ${profile.id === activeId ? '*' : '-'} ${profile.name} (${profile.id})`)
  ].join('\n');
}

function formatSettings(config, filter = '') {
  const skip = new Set(['uiMode', 'jarPath', 'localOnlyPreviousBindIp']);
  const query = filter.toLowerCase();
  const rows = Object.entries(config)
    .filter(([key]) => !skip.has(key))
    .filter(([key, value]) => !query || `${key} ${value}`.toLowerCase().includes(query))
    .map(([key, value]) => `  ${key}: ${stringifySettingValue(value)}`);
  return rows.length
    ? `[Server Console] Settings${filter ? ` matching "${filter}"` : ''}\n${rows.join('\n')}`
    : `[Server Console] No settings match "${filter}".`;
}

async function removeBundledProtectionFromConsole() {
  return serverToolMutationCoordinator.run('protection:console-remove', async () => {
    const snapshot = await captureActiveServerToolProfile('Server Protection');
    const paths = snapshot.paths;
    return serializeProtectionStateTransaction(paths.root, async () => {
      const installed = await getBundledAntiCheatStatus(paths);
      if (installed.targetCollision || installed.legacyConflict || installed.unverifiedLegacyPresent) {
        throw new Error('Conflicting or unverified protection files were left untouched. Check the Protection page.');
      }
      if (!installed.installed) return 'Bundled Server Protection is not installed.';
      if (!installed.integrityVerified) throw new Error('Server Protection is not a verified managed file; it was left untouched.');
      const configSnapshot = await captureSmallFileSnapshot(paths.protectionConfig);
      await archivePinnedProtection({
        root: paths.root, kind: installed.kind, file: installed.file, sha256: installed.sha256,
        revalidate: () => revalidateServerToolProfile(snapshot, 'Server Protection'),
        commit: () => mutateProtectionConfigForPathsUnlocked(paths, () => ({ enabled: false })),
        rollback: () => restoreSmallFileSnapshot(configSnapshot)
      });
      invalidateStatusCache();
      invalidateCachedWork(`disk-size:${paths.root}`);
      return 'Bundled Server Protection removed and disabled. A recovery copy, shared dependencies, and saved settings are retained. Custom anti-cheats and separate anti-Xray providers are unchanged.';
    });
  });
}

async function removeConsoleCustomAntiCheat(id, profileSnapshotOverride = null) {
  return serverToolMutationCoordinator.run('protection:console-remove-custom', async () => {
    const snapshot = profileSnapshotOverride || await captureActiveServerToolProfile('custom anti-cheats');
    return serializeProtectionStateTransaction(snapshot.paths.root, async () => {
      await revalidateServerToolProfile(snapshot, 'custom anti-cheats');
      await removeCustomAntiCheat(id, snapshot.paths, () => revalidateServerToolProfile(snapshot, 'custom anti-cheats'));
      return `Custom anti-cheat ${id} removed. Saved add-on data retained.`;
    });
  });
}

function bindAntiCheatConsoleToPaths(paths) {
  return createAntiCheatConsoleBindings({
    checks: PROTECTION_CHECKS,
    getConfig: () => getProtectionConfig(paths),
    mutateConfig: update => mutateProtectionConfigForPaths(paths, update),
    listCustom: () => listCustomAntiCheats(paths),
    removeCustom: id => removeConsoleCustomAntiCheat(id)
  });
}

function getAntiCheatConsoleHandlers() {
  return {
    list: async () => {
      const state = await bindAntiCheatConsoleToPaths(await getPaths()).list();
      return [
        `Built-in anti-cheat: ${state.enabled && state.builtInEnabled ? 'enabled in settings' : 'disabled in settings'}`,
        ...state.checks.map(check => `  ${check.id}: ${check.enabled ? 'enabled' : 'disabled'}${check.enabled && !check.effective ? ' (master switch off)' : ''}`),
        'Custom anti-cheats:',
        ...state.custom.map(entry => `  ${entry.id}: ${entry.name} (${entry.kind}/${entry.file}; ${entry.active ? 'installed' : 'missing'})`),
        ...(!state.custom.length ? ['  (none)'] : []),
        'Use /anticheat enable|disable <check-id> (or all for the built-in master switch).',
        'Use /anticheat delete <custom-id>, or /setup delete anticheat to uninstall bundled Server Protection.'
      ].join('\n');
    },
    setCheck: (id, enabled) => serverToolMutationCoordinator.run('protection:console-check', async () => {
      const handlers = bindAntiCheatConsoleToPaths(await getPaths());
      const result = id === 'all' ? await handlers.setEnabled(enabled) : await handlers.setCheckEnabled(id, enabled);
      return `${id === 'all' ? 'Built-in anti-cheat master switch' : `Check ${id}`} ${enabled ? 'enabled' : 'disabled'}.${result.restartRequired ? ' Restart Minecraft to apply this change.' : result.appliedLive ? ' Applied to the running server.' : ' Saved for the next server start.'}`;
    }),
    removeCustom: removeConsoleCustomAntiCheat
  };
}

function getSetupConsoleHandlers() {
  return {
    'silent-restart': {
      status: async () => {
        const result = await getSeamlessRestartConsoleStatus();
        return `${result.config?.enabled ? 'enabled' : 'disabled'}; saved setup ${result.status?.setupReady ? 'verified' : 'not ready'}`;
      },
      remove: async () => {
        await disableSeamlessRestart();
        return 'Silent restart disabled; previous backend forwarding restored. Cached lobby and recovery backups retained. It stays off until setup is explicitly run again.';
      }
    },
    teleport: {
      status: async () => (await getBundledTeleportStatus()).message,
      remove: async () => {
        const result = await removeBundledTeleport();
        return result.changed ? 'Teleport Requests removed. Saved homes and warps retained.' : 'Teleport Requests is not installed as a removable managed add-on.';
      }
    },
    voice: {
      status: async () => (await getBundledVoiceStatus()).message,
      remove: async () => {
        const result = await removeBundledVoice();
        return result.changed
          ? `Proximity Voice removed. Saved data and shared dependencies retained.${result.networkCleanupError ? ` Network cleanup: ${result.networkCleanupError}` : ''}`
          : 'Proximity Voice is not installed as a removable managed add-on.';
      }
    },
    'world-map': {
      status: async () => (await getWorldMapStatus()).message,
      remove: async () => { await removeWorldMap(); return 'Live World Map removal queued for the next server start. Rendered map data retained.'; }
    },
    'direct-hosting': {
      status: async () => (await getDirectHostingStatus()).message,
      remove: async () => (await disableDirectHosting()).message || 'Direct hosting disabled.'
    },
    'local-only': {
      status: async () => (await getLocalOnlyModeStatus()).enabled ? 'enabled' : 'disabled',
      remove: async () => { await setLocalOnlyMode(false); return 'Local-only mode disabled. Public hosting stays off until explicitly enabled.'; }
    },
    anticheat: {
      status: async () => (await getBundledAntiCheatStatus()).message,
      remove: async () => removeBundledProtectionFromConsole()
    }
  };
}

async function listConsoleAddons(kind) {
  const paths = await getPaths();
  const kinds = kind ? [kind] : ['mods', 'plugins'];
  const groups = await Promise.all(kinds.map(async (group) => {
    const entries = await listManagedAddonFiles(paths, group);
    return [`${group}:`, ...entries.map(entry => `  ${entry.name}`), ...(!entries.length ? ['  (none)'] : [])].join('\n');
  }));
  return `${groups.join('\n')}\nRemove with /addons delete <mods|plugins> <exact filename.jar>.\nManaged features: /setup list. Individual protection checks: /anticheat list.\nShared platform dependencies remain protected.`;
}

async function removeConsoleAddon(kind, file) {
  // Delegate managed artifacts to their own uninstallers so their saved state
  // cannot re-create a deleted JAR on the next startup.
  if (kind === 'mods' && file.toLowerCase() === NATIVE_WORLD_MAP_JAR.toLowerCase()) {
    await removeWorldMap();
    return 'Live World Map removal queued for the next server start.';
  }
  if (kind === 'mods' && file.toLowerCase() === 'fabricproxy-lite.jar') {
    await disableSeamlessRestart();
    return 'Silent restart disabled and previous backend forwarding restored. Cached lobby retained.';
  }
  if ((kind === 'mods' && file.toLowerCase() === BUNDLED_PROTECTION_FABRIC_JAR.toLowerCase()) ||
      (kind === 'plugins' && [BUNDLED_PROTECTION_JAR, LEGACY_BUNDLED_PROTECTION_JAR].some(name => file.toLowerCase() === name.toLowerCase()))) {
    return removeBundledProtectionFromConsole();
  }
  const snapshot = await captureActiveServerToolProfile('installed add-ons');
  const installed = await listManagedAddonFiles(snapshot.paths, kind);
  if (!installed.some(entry => entry.name === file)) throw new Error('That exact installed filename was not found. Use /addons list.');
  await revalidateServerToolProfile(snapshot, 'installed add-ons');
  await assertWorldResetPlainPath(snapshot.paths.root, path.join(getAddonTargetDir(snapshot.paths, kind), file));
  const custom = (await listCustomAntiCheats(snapshot.paths)).find(entry => entry.kind === kind && entry.file === file);
  if (custom) return removeConsoleCustomAntiCheat(custom.id, snapshot);
  await deleteManagedJar(kind, file, snapshot);
  return `Removed ${kind}/${file}. Saved add-on data retained.`;
}

async function runAssemblyConsoleCommand(rawCommand) {
  const raw = String(rawCommand || '').trim();
  if (!raw) return '';
  appendServerLog(`> server ${raw}\n`);
  const [commandName = '', ...args] = raw.split(/\s+/);
  let command = commandName.toLowerCase();
  if (command === 'silent') {
    if (args.shift()?.toLowerCase() !== 'restart') throw new Error('Usage: /silent restart setup|status|resume|delete|now');
    command = 'silent-restart';
  }

  if (command === 'help' || command === '?') {
    return [
      '[Server Console] Commands',
      '  help',
      '  status',
      '  worlds',
      '  settings [search]',
      '  get <setting>',
      '  set <setting> <value>',
      '  diagnose',
      '  repair',
      '  selfplay',
      '  local-only enable | local-only disable | local-only status',
      '  start | restart',
      '  silent-restart [now message] | silent-restart setup | status | resume | delete',
      '  silent restart setup (alias; saved across restarts)',
      '  setup list | setup delete <name>',
      '  addons list [mods|plugins] | addons delete <mods|plugins> <filename.jar>',
      '  anticheat list | anticheat enable|disable <check-id> | anticheat delete <custom-id>',
      '  stop [seconds] [message]',
      '  shutdown [seconds] [message] | shutdown cancel | shutdown status',
      '  direct enable | direct disable',
      '  tunnel download | tunnel start | tunnel status | tunnel stop',
      '  send <minecraft command>',
      '  open folder'
    ].join('\n');
  }

  if (command === 'status') return formatAssemblyStatus(await getStatus());
  if (command === 'setup') {
    const result = await runSetupConsoleCommand(args, getSetupConsoleHandlers());
    return `${result}\n  Installed mods/plugins: /addons list. Individual anti-cheat checks: /anticheat list.`;
  }
  if (command === 'addons') {
    const deletion = raw.match(/^addons\s+(delete|remove)\s+(mods|plugins)\s+(.+)$/i);
    const addonArgs = deletion ? deletion.slice(1) : args;
    return runAddonConsoleCommand(addonArgs, { list: listConsoleAddons, remove: removeConsoleAddon });
  }
  if (command === 'anticheat') return runAntiCheatConsoleCommand(args, getAntiCheatConsoleHandlers());
  if (command === 'worlds') return formatWorlds(await getStatus());
  if (command === 'settings') return formatSettings((await getStatus()).config, args.join(' '));
  if (command === 'diagnose' || command === 'repair') {
    const result = await repairConnection();
    const title = result.code === 'SRV-NET-000'
      ? 'Connection check passed'
      : result.diagnostics?.title || 'Connection check complete';
    return `[Server Console] ${result.code}: ${title}\n  External: ${result.external?.online ? 'online' : 'not reachable'}\n  Fixed automatically: ${result.fixed ? 'yes' : 'no'}`;
  }

  if (command === 'local-only') {
    const action = args[0]?.toLowerCase() || 'status';
    if (action === 'status') {
      const status = await getLocalOnlyModeStatus();
      return [
        '[Server Console] Local-only mode',
        `  Enabled: ${status.enabled ? 'yes' : 'no'}`,
        `  Minecraft bind: ${status.bindIp || 'all interfaces'}`,
        `  Local address: ${status.localAddress}`,
        `  Remote status: ${status.enabled ? 'offline by policy' : 'available when publicly exposed'}`,
        `  Managed public exposure stopped: ${status.managedExposureStopped ? 'yes' : 'no'}`,
        `  Playit: ${status.playit?.running ? 'running' : 'stopped'}`,
        `  Router mappings: ${status.directHosting?.mapped || status.directHosting?.voiceMapped ? 'active' : 'none'}`
      ].join('\n');
    }
    if (['enable', 'on'].includes(action)) {
      const status = await setLocalOnlyMode(true);
      return [
        '[Server Console] Local-only mode enabled.',
        `  Local address: ${status.localAddress}`,
        '  Remote status: offline',
        `  Managed public exposure stopped: ${status.managedExposureStopped ? 'yes' : 'no'}`,
        ...(status.warnings || []).map((warning) => `  Warning: ${warning}`)
      ].join('\n');
    }
    if (['disable', 'off'].includes(action)) {
      const status = await setLocalOnlyMode(false);
      if (status.unchanged) {
        return '[Server Console] Local-only mode is already disabled; network settings were unchanged.';
      }
      return [
        '[Server Console] Local-only mode disabled.',
        `  Minecraft bind on next start: ${status.bindIp || 'all interfaces'}`,
        '  Public mapping and tunnel access remain disabled until explicitly enabled.'
      ].join('\n');
    }
    throw new Error('Usage: local-only enable | local-only disable | local-only status');
  }

  if (command === 'selfplay') {
    return [
      '[Server Console] Self-play workaround',
      '  Server Manager cannot force router NAT loopback/hairpin from inside the app.',
      '  If public IP works outside but not on your own Wi-Fi, use one of these:',
      '  1. Enable NAT loopback/hairpin in the router.',
      '  2. Use tunnel download, then tunnel start, and use the tunnel address.',
      '  3. Test public address from mobile data/outside Wi-Fi.',
      '  Note: Dashboard still keeps the public join address as the source of truth.'
    ].join('\n');
  }

  if (command === 'get') {
    const key = args[0];
    if (!key) throw new Error('Usage: get <setting>');
    const config = (await getStatus()).config;
    if (!(key in config)) throw new Error(`Unknown setting: ${key}`);
    return `[Server Console] ${key}: ${stringifySettingValue(config[key])}`;
  }

  if (command === 'set') {
    const [key, ...valueParts] = args;
    if (!key || !valueParts.length) throw new Error('Usage: set <setting> <value>');
    const config = (await getStatus()).config;
    if (!(key in config)) throw new Error(`Unknown setting: ${key}`);
    if (key === 'localOnly' || key === 'localOnlyPreviousBindIp') {
      throw new Error('Use local-only enable or local-only disable so public exposure is cleaned up safely.');
    }
    const nextValue = parseSettingValue(valueParts.join(' '), config[key]);
    const dimensionRequest = Object.hasOwn(dimensionLockSettings.KEYS, key)
      ? { _dimensionLockChanges: { revision: (await getStatus()).dimensionLocks?.revision, profileId: (await getActiveProfile()).id, worldName: config.levelName, changes: { [key]: nextValue } } } : {};
    const next = await saveConfigAndApply({ ...config, [key]: nextValue, ...dimensionRequest });
    return `[Server Console] Updated ${key}: ${stringifySettingValue(next[key])}`;
  }

  if (command === 'start') {
    await startServer();
    return '[Server Console] Start command sent.';
  }
  if (command === 'silent-restart' || command === 'seamless-restart') {
    const action = args[0]?.toLowerCase() || '';
    if (!['', 'now', 'status', 'setup', 'disable', 'delete', 'remove', 'resume'].includes(action) ||
        (action !== 'now' && args.length > 1)) {
      throw new Error('Usage: /silent-restart setup|status|resume|delete|disable OR /silent-restart now [message]');
    }
    if (action === 'status') return formatSeamlessRestartConsoleStatus(await getSeamlessRestartConsoleStatus());
    if (action === 'setup') {
      await setupSeamlessRestart();
      return '[Server Console] Seamless restart setup is verified and enabled. Start Minecraft normally; later /silent-restart commands will park and return players automatically.';
    }
    if (['disable', 'delete', 'remove'].includes(action)) {
      await disableSeamlessRestart();
      return '[Server Console] Silent restart setup disabled and the previous backend forwarding files restored. Cached lobby and recovery backups are retained; setup stays off until you run setup again.';
    }
    if (action === 'resume') {
      await resumeSeamlessRestartPlayers();
      return '[Server Console] Parked players were returned to Minecraft.';
    }
    const restartMessage = (action === 'now' ? args.slice(1) : args).join(' ');
    const result = await silentRestartServer(restartMessage);
    return result?.playersReconnected
      ? '[Server Console] Seamless restart complete; connected players were returned automatically.'
      : '[Server Console] Seamless restart completed.';
  }
  if (command === 'stop' || command === 'shutdown') {
    const action = args[0]?.toLowerCase();
    if (action === 'status') {
      const status = getAnnouncedServerShutdownStatus();
      return status.pending
        ? `[Server Console] Shutdown ${status.committed ? 'is stopping the server now' : `scheduled in ${status.remainingSeconds} seconds`}${status.message ? `: ${status.message}` : '.'}`
        : '[Server Console] No announced shutdown is scheduled.';
    }
    if (action === 'cancel') {
      return cancelPendingAnnouncedServerShutdown()
        ? '[Server Console] Scheduled shutdown canceled.'
        : '[Server Console] There is no cancelable shutdown countdown.';
    }
    if (command === 'stop' && args.length === 0) {
      await stopServer();
      return '[Server Console] Stop command sent.';
    }
    const options = parseAnnouncedServerShutdownArgs(args);
    const result = await requestAnnouncedServerShutdown(options);
    if (result.alreadyStopped) return '[Server Console] Server is already stopped.';
    return result.scheduled
      ? `[Server Console] Shutdown announced and scheduled in ${result.countdownSeconds} seconds${result.message ? `: ${result.message}` : '.'}`
      : '[Server Console] Shutdown message sent and stop completed.';
  }
  if (command === 'restart') {
    await restartServer();
    return '[Server Console] Restart command sent.';
  }

  if (command === 'direct') {
    const action = args[0]?.toLowerCase();
    if (action === 'enable') {
      const status = await enableDirectHosting();
      return `[Server Console] Direct hosting enabled: ${status.message}`;
    }
    if (action === 'disable') {
      const status = await disableDirectHosting();
      return `[Server Console] Direct hosting disabled: ${status.message}`;
    }
    throw new Error('Usage: direct enable | direct disable');
  }

  if (command === 'tunnel') {
    const action = args[0]?.toLowerCase();
    if (action === 'download') {
      const status = await downloadPlayitAgent();
      return [
        '[Server Manager SRV-TUN-000] playit agent downloaded.',
        `  Path: ${status.path}`,
        `  Running: ${status.running ? 'yes' : 'no'}`,
        '  Next step: run tunnel start, then tunnel status.'
      ].join('\n');
    }
    if (action === 'start') {
      const status = await startPlayitAgent();
      return formatPlayitStatus(status);
    }
    if (action === 'status') {
      return formatPlayitStatus(await getPlayitStatus());
    }
    if (action === 'stop') {
      await stopPlayitAgent();
      return '[Server Console] playit tunnel stopped.';
    }
    throw new Error('Usage: tunnel download | tunnel start | tunnel status | tunnel stop');
  }

  if (command === 'send') {
    const minecraftCommand = args.join(' ');
    if (!minecraftCommand) throw new Error('Usage: send <minecraft command>');
    sendCommand(minecraftCommand);
    return `[Server Console] Sent Minecraft command: ${minecraftCommand}`;
  }

  if (command === 'open' && args[0]?.toLowerCase() === 'folder') {
    await shell.openPath((await getPaths()).root);
    return '[Server Console] Opened server folder.';
  }

  throw new Error(`Unknown server command: ${commandName}. Type help.`);
}

async function clearLogs() {
  const paths = await getPaths();
  const logsPath = resolveContainedPath(paths.root, paths.logs);
  await fs.rm(logsPath, { recursive: true, force: true });
  await fs.mkdir(paths.logs, { recursive: true });
  serverLogBuffer.clear();
  recentServerLogBuffer.clear();
  pendingServerLogIpc.clear();
  pendingServerLogDropped = 0;
  clearTimeout(serverLogIpcTimer);
  serverLogIpcTimer = null;
  emitAll('server:clearLog', true);
  return true;
}

function wipeServerData(options = {}) {
  const profileId = typeof options?.profileId === 'string' ? options.profileId : '';
  if (!isSafeProfileId(profileId) || typeof options.resetSettings !== 'boolean') {
    return Promise.reject(new Error('Select a server and confirm whether its Settings should reset.'));
  }
  let resetFields;
  try { resetFields = normalizeResetFields(options.resetFields); }
  catch (error) { return Promise.reject(error); }
  const resetSettings = options.resetSettings;
  const resetIcon = resetFields.includes('serverIcon');
  const changeConfig = resetSettings || resetFields.some(key => key !== 'serverIcon');
  let suspendedBanPaths = null;
  return serverToolMutationCoordinator.run(`world:reset:${profileId}:${resetSettings}:${resetFields.join(',')}`, async () => {
    const snapshot = await captureActiveServerToolProfile('world data');
    if (snapshot.profileId !== profileId) throw new Error('The selected server changed. Open Reset Data again.');
    const { paths } = snapshot;
    const revalidate = async () => {
      await revalidateServerToolProfile(snapshot, 'world data');
      if (pendingServerRestart || pendingSafeModeRetry || seamlessRestartPromise) {
        throw new Error('Wait for the pending server restart or recovery to finish before resetting world data.');
      }
    };
    await revalidate();
    await assertNoPendingWorldReset(paths.root);
    await assertWorldResetPlainPath(paths.root, paths.config);
    const configStat = await fs.stat(paths.config);
    if (!configStat.isFile() || configStat.size > MAX_PROPERTIES_BYTES) throw new Error('Server Settings cannot be read safely.');
    // readConfig performs migrations/writes. Reset without the checkbox must keep
    // saved Settings exactly as they were, including comments in server.properties.
    const storedConfig = JSON.parse(await fs.readFile(paths.config, 'utf8'));
    if (!storedConfig || typeof storedConfig !== 'object' || Array.isArray(storedConfig)) throw new Error('Server Settings are invalid.');
    const config = { ...DEFAULT_CONFIG, ...storedConfig };
    validateWorldName(config.levelName);
    const nextConfig = changeConfig
      ? buildResetServerSettings(config, DEFAULT_CONFIG, generateSeed, { resetSettings, resetFields })
      : config;
    validateWorldName(nextConfig.levelName);
    const plan = await buildWorldResetPlan(paths.root, config, nextConfig, undefined, { resetIcon });
    const lootrReset = await planLootrRemovalWithWorldReset({ profileRoot: paths.root, config });
    plan.move.push(...lootrReset.move);
    const resetFiles = [];
    if (changeConfig) resetFiles.push(paths.config, paths.serverProperties);
    if (resetSettings) resetFiles.push(paths.eula, paths.deathLootConfig);
    if (resetIcon) resetFiles.push(path.join(paths.root, 'server-icon.png'), path.join(paths.root, 'icon.png'));
    for (const file of resetFiles) {
      resolveContainedPath(paths.root, file);
      await assertWorldResetPlainPath(paths.root, file);
      plan.move.push(path.relative(paths.root, file));
    }
    if (changeConfig) {
      // Keep unrecognized server.properties values while resetting the tab's own
      // fields. The original files remain in the backup for complete recovery.
      if (await fs.lstat(paths.serverProperties).then(() => true, error => {
        if (error.code === 'ENOENT') return false;
        throw error;
      })) plan.preserve.push({ source: SERVER_PROPERTIES, destination: SERVER_PROPERTIES });
    }
    let result;
    // Status/map polling may read Settings while originals are in the backup.
    // Supply the captured config so a read cannot migrate/recreate missing files.
    worldResetReadSnapshot = { root: path.resolve(paths.root), config };
    try {
      for (const timer of tempBanTimers.values()) clearTimeout(timer);
      tempBanTimers.clear();
      suspendedBanPaths = paths;
      if (playerHistoryEventFlush) await playerHistoryEventFlush;
      // Persist queued events for this profile before the backup. They must also
      // survive when a later settings/disk error rolls the reset back.
      while (pendingPlayerHistoryEvents.some(event => !event.paths ||
          path.resolve(event.paths.root) === path.resolve(paths.root))) {
        await flushPlayerHistoryEventQueue(paths);
      }
      // An ingress batch can still be awaiting its profile paths before it is
      // visible in the file queues. Drain it before archiving history and bans.
      while (protectionIncidentIngressPromise) await protectionIncidentIngressPromise;
      const incidentQueue = protectionIncidentQueues.get(paths.protectionHistory);
      if (incidentQueue?.flushing) await incidentQueue.flushing;
      while (protectionIncidentQueues.get(paths.protectionHistory)?.incidents.length) {
        await flushProtectionIncidentQueue(paths.protectionHistory);
      }
      await Promise.allSettled([...playerBanMutations.entries()]
        .filter(([key]) => key.startsWith(`${path.resolve(paths.root)}\0`)).map(([, pending]) => pending));
      await Promise.allSettled([...serializedFileWrites.entries()]
        .filter(([file]) => path.resolve(file).startsWith(`${path.resolve(paths.root)}${path.sep}`))
        .map(([, pending]) => pending));
      await revalidate();
      result = await resetWorldTransaction({
        root: paths.root, profileId, plan, resetSettings, resetFields, revalidate,
        applySettings: changeConfig ? async () => {
          await revalidate();
          await fs.writeFile(paths.config, `${JSON.stringify(nextConfig, null, 2)}\n`, { flag: 'wx' });
          await writeServerProperties(nextConfig, paths);
          if (resetSettings) {
            await writeDeathLootRuntimeConfig(paths, nextConfig);
            await dimensionLockSettings.writeChanges(paths.root, nextConfig.levelName, { lockNether: false, lockEnd: false }, undefined, revalidate);
            await fs.writeFile(paths.eula, `eula=${nextConfig.acceptEula ? 'true' : 'false'}\n`, { flag: 'wx' });
          }
        } : null
      });
    } finally {
      worldResetReadSnapshot = null;
    }
    resetProfileRuntimeCaches();
    nativeWorldMapSnapshotCache = { file: '', mtimeMs: -1, size: -1, value: null };
    nativeWorldMapTerrainReader.clear();
    nativeWorldMapRosterReader = createRosterReader({ readNbtFile });
    closeWorldMapSeedEngine();
    invalidateCachedWork(`world-icon:${paths.root}`);
    invalidateCachedWork(`disk-size:${paths.root}`);
    invalidateCachedWork(`player-history-log-import:${paths.root}`);
    serverLogBuffer.clear();
    recentServerLogBuffer.clear();
    pendingServerLogIpc.clear();
    pendingServerLogDropped = 0;
    clearTimeout(serverLogIpcTimer);
    serverLogIpcTimer = null;
    emitAll('server:clearLog', true);
    emitAll('server:history', []);
    emitAll('server:historyEvents', []);
    emitAll('server:bans', []);
    appendServerLog(`[Server Manager] World data reset. Original data backup: ${result.backupPath}\n`);
    return { ...result, config: nextConfig, retiredMods: lootrReset.retiredMods };
  }).catch(async error => {
    // The mutation lock and read snapshot are released before expiry callbacks
    // resume. A failed transaction with a recovery journal must remain untouched.
    if (suspendedBanPaths) {
      try {
        await assertNoPendingWorldReset(suspendedBanPaths.root);
        if (await readAssemblyBans(suspendedBanPaths)) await getBannedPlayers(suspendedBanPaths);
      } catch (restoreError) {
        appendServerLog(`[Server Manager] Temporary ban timers could not resume after the failed reset: ${restoreError.message}\n`);
      }
    }
    throw error;
  });
}

function formatGameRuleValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(Number.isFinite(Number(value)) ? Number(value) : value);
}

function usesRegistryGameRules(version) {
  const text = String(version || '').trim().toLowerCase();
  if (!text || text === 'latest') return true;
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0);
  const patch = Number(match[3] || 0);
  if (major >= 26) return true;
  return major === 1 && (minor > 21 || (minor === 21 && patch >= 11));
}

function getGameRuleCommandCandidates(configKey, value, version) {
  const modernRule = GAME_RULES[configKey];
  const legacyRule = LEGACY_GAME_RULES[configKey];
  if (!modernRule || !legacyRule) return [];
  const modernValue = configKey === 'doFireTick' ? (Boolean(value) ? 128 : 0) : value;
  const modern = { gamerule: modernRule, value: formatGameRuleValue(modernValue) };
  const legacy = { gamerule: legacyRule, value: formatGameRuleValue(value) };
  const ordered = usesRegistryGameRules(version) ? [modern, legacy] : [legacy, modern];
  return ordered.filter((candidate, index) => ordered.findIndex((entry) => entry.gamerule === candidate.gamerule && entry.value === candidate.value) === index);
}

function describeGameRuleValue(value) {
  if (typeof value === 'boolean') return value ? 'turned on' : 'turned off';
  return `set to ${formatGameRuleValue(value)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateRuntimeGameRuleAttempt(entry, attemptIndex) {
  const candidate = entry.candidates[attemptIndex];
  if (!candidate) return false;
  entry.attemptIndex = attemptIndex;
  entry.gamerule = candidate.gamerule;
  entry.value = candidate.value;
  entry.command = `gamerule ${candidate.gamerule} ${candidate.value}`;
  entry.successPattern = new RegExp(`(?:(?:Gamerule|Game rule)\\s+(?:minecraft:)?${escapeRegExp(candidate.gamerule)}\\s+(?:is\\s+now\\s+)?set\\s+to:?\\s+${escapeRegExp(candidate.value)}\\b|Set\\s+game\\s+rule\\s+(?:minecraft:)?${escapeRegExp(candidate.gamerule)}\\s+to\\s+${escapeRegExp(candidate.value)}\\b)`, 'i');
  return true;
}

function makeRuntimeGameRuleEntry(configKey, value, source, reportSuccess, version) {
  const label = GAME_RULE_LABELS[configKey] || configKey;
  const entry = {
    configKey,
    rawValue: value,
    label,
    source,
    reportSuccess,
    candidates: getGameRuleCommandCandidates(configKey, value, version),
    attemptIndex: 0,
    timeoutRetries: 0,
    command: '',
    gamerule: '',
    value: '',
    successPattern: /$a/
  };
  updateRuntimeGameRuleAttempt(entry, 0);
  return entry;
}

function finishPendingRuntimeGameRule(entry, ok, reason = '') {
  if (!pendingRuntimeGameRuleBatch) return;
  pendingRuntimeGameRuleBatch.entries = pendingRuntimeGameRuleBatch.entries.filter((item) => item !== entry);
  if (ok) {
    if (entry.reportSuccess) {
      appendServerLog(
        `[Server Manager SRV-CFG-201] ${entry.label} ${describeGameRuleValue(entry.rawValue)}\n` +
        `  Minecraft rule: ${entry.gamerule}\n` +
        `  Source: ${entry.source}\n` +
        '  Result: Minecraft accepted the runtime gamerule command.\n'
      );
    }
  } else {
    appendServerLog(
      `[Server Manager SRV-CFG-302] Failed to apply ${entry.label}\n` +
      `  Requested: ${describeGameRuleValue(entry.rawValue)}\n` +
      `  Minecraft rule: ${entry.gamerule}\n` +
      `  Command: ${entry.command}\n` +
      `  Reason: ${reason || 'Minecraft did not confirm the change.'}\n`
    );
  }
  if (!pendingRuntimeGameRuleBatch.entries.length) {
    clearTimeout(pendingRuntimeGameRuleBatch.timer);
    pendingRuntimeGameRuleBatch = null;
  }
}

function retryPendingRuntimeGameRule(entry, reason = '') {
  if (!pendingRuntimeGameRuleBatch?.entries.includes(entry)) return false;
  if (!updateRuntimeGameRuleAttempt(entry, entry.attemptIndex + 1)) return false;
  entry.timeoutRetries = 0;
  appendServerLog(
    `[Server Manager SRV-CFG-202] Retrying ${entry.label} with the compatible game-rule name\n` +
    `  Command: ${entry.command}\n` +
    `  Previous result: ${String(reason || 'not accepted').trim().slice(0, 180)}\n`
  );
  const sent = sendServerCommand(entry.command);
  if (sent) scheduleRuntimeGameRuleTimeout();
  return sent;
}

function scheduleRuntimeGameRuleTimeout() {
  if (!pendingRuntimeGameRuleBatch) return;
  clearTimeout(pendingRuntimeGameRuleBatch.timer);
  pendingRuntimeGameRuleBatch.timer = setTimeout(() => {
    const batch = pendingRuntimeGameRuleBatch;
    if (!batch) return;
    for (const entry of [...batch.entries]) {
      if (entry.timeoutRetries < 1 && sendServerCommand(entry.command)) {
        entry.timeoutRetries += 1;
        continue;
      }
      finishPendingRuntimeGameRule(entry, false, 'Minecraft did not confirm the command after one retry.');
    }
    if (pendingRuntimeGameRuleBatch?.entries.length) scheduleRuntimeGameRuleTimeout();
  }, 5000);
  pendingRuntimeGameRuleBatch.timer.unref?.();
}

function applyRuntimeGameRules(config, source = 'settings-save', previousConfig = null) {
  if (!serverProcess || serverState !== 'running' || serverReadyGeneration !== serverLifecycleGeneration) {
    if (serverProcess) deferredRuntimeSettings = { config, source, previousConfig };
    return { deferred: Boolean(serverProcess) };
  }
  if (runtimeGameRulesUnsupported) return;
  const values = Object.keys(GAME_RULES)
    .map((key) => `${key}:${config[key]}`)
    .join('|');
  const signature = `${source}|${values}`;
  if (signature === lastGameRuleDiagnosticSignature) return;
  lastGameRuleDiagnosticSignature = signature;
  const entries = [];
  for (const configKey of Object.keys(GAME_RULES)) {
    const value = config[configKey];
    if (value === undefined || value === null || value === '') continue;
    const changed = previousConfig
      ? formatGameRuleValue(previousConfig[configKey]) !== formatGameRuleValue(value)
      : source === 'startup';
    if (source === 'settings-save' && !changed) continue;
    const entry = makeRuntimeGameRuleEntry(configKey, value, source, source !== 'startup', config.serverVersion);
    if (sendServerCommand(entry.command)) entries.push(entry);
  }
  if (entries.length) {
    if (pendingRuntimeGameRuleBatch?.timer) clearTimeout(pendingRuntimeGameRuleBatch.timer);
    pendingRuntimeGameRuleBatch = {
      source,
      entries,
      timer: null
    };
    scheduleRuntimeGameRuleTimeout();
  }
  deferredRuntimeSettings = null;
  return { deferred: false, count: entries.length };
}

function noteRuntimeGameRuleOutput(text) {
  if (!pendingRuntimeGameRuleBatch || runtimeGameRulesUnsupported) return;
  const line = String(text || '');
  for (const entry of [...pendingRuntimeGameRuleBatch.entries]) {
    if (entry.successPattern.test(line)) {
      finishPendingRuntimeGameRule(entry, true);
      continue;
    }
    if (
      line.includes(`${entry.command}<--[HERE]`) ||
      (/Unknown or incomplete command|Incorrect argument|No such rule|Unknown game rule|Unknown gamerule/i.test(line) && line.toLowerCase().includes(entry.gamerule.toLowerCase()))
    ) {
      if (!retryPendingRuntimeGameRule(entry, line.trim())) finishPendingRuntimeGameRule(entry, false, line.trim());
    }
  }
}

function normalizeManagedAccessTeamIds(value) {
  const candidates = Array.isArray(value) ? value : [];
  return [...new Set(candidates
    .slice(0, 80)
    .map((teamId) => String(teamId || '').trim().toLowerCase())
    .filter((teamId) => /^ci_r_[a-f0-9]{10}$/.test(teamId)))]
    .sort();
}

async function readManagedAccessTeamIds(paths) {
  const state = await readJson(paths.accessTeams, { version: 1, teamIds: [] });
  return Number(state.version) === 1 ? normalizeManagedAccessTeamIds(state.teamIds) : [];
}

async function rememberManagedAccessTeamIds(paths, teamIds, previousTeamIds = []) {
  const next = normalizeManagedAccessTeamIds(teamIds);
  const previous = normalizeManagedAccessTeamIds(previousTeamIds);
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  await serializeFileWrite(paths.accessTeams, () => writeJsonAtomically(paths.accessTeams, {
    version: 1,
    teamIds: next
  }));
}

function classifyServerTeamsScoreboardOwnership(index) {
  const candidates = (Array.isArray(index?.files) ? index.files : [])
    .filter((file) => file?.descriptor?.fabricModId === 'serverteams_fabric');
  const ownsScoreboard = candidates.some(({ descriptor }) =>
    descriptor.kind === 'mods' && descriptor.descriptor === 'fabric.mod.json' &&
    descriptor.fabricEnvironment !== 'client' &&
    Array.isArray(descriptor.fabricMainEntrypoints) &&
    descriptor.fabricMainEntrypoints.includes('dev.serverteams.fabric.ServerTeams'));
  if (ownsScoreboard) return 'serverteams';
  // A partial/ambiguous scan cannot authorize replacing another module's player membership.
  return !index || index.partial || candidates.length ? 'unknown' : 'app';
}

async function getRuntimeScoreboardOwnership(paths, config, processRef, generation) {
  const root = path.resolve(paths.root);
  const previous = runtimeScoreboardOwnership;
  if (previous?.processRef === processRef && previous.generation === generation && previous.root === root) {
    return previous.owner;
  }
  const type = String(config.serverType || '').trim().toLowerCase();
  const owner = ['fabric', 'quilt'].includes(type)
    ? classifyServerTeamsScoreboardOwnership(await getModDescriptorIndex(paths))
    : 'app';
  // Loader membership is fixed for this running process. Adding/removing a disk JAR cannot
  // switch scoreboard ownership until restart; incomplete discovery is retried instead.
  if (owner !== 'unknown' && processRef === serverProcess && generation === serverLifecycleGeneration) {
    runtimeScoreboardOwnership = { processRef, generation, root, owner };
  }
  return owner;
}

function buildServerTeamsAccessTeamPlan(access, options) {
  if (String(options.serverVersion || '').trim() !== '26.2') {
    throw new Error('Server Teams scoreboard handoff requires the verified Minecraft 26.2 PvP rule.');
  }
  const legacy = buildAccessTeamCommandPlan(access, options);
  const cleanupIds = [...new Set([
    ...legacy.activeTeamIds, ...legacy.staleTeamIds,
    ...(Array.isArray(options.provisionedTeamIds) ? options.provisionedTeamIds : [])
  ].filter((teamId) => /^ci_r_[a-f0-9]{10}$/.test(teamId)))].sort();
  const pvpEnabled = options.pvpEnabled !== false;
  // Minecraft 26.2 reads global PvP from GameRules.PVP, not DedicatedServerProperties.
  // Apply the unchanged app policy before releasing our old scoreboard fallback memberships.
  // Remove only deterministic app-owned teams; never use `team leave <player>` or touch st_*.
  const commands = [
    `gamerule minecraft:pvp ${pvpEnabled ? 'true' : 'false'}`,
    ...cleanupIds.map((teamId) => `team remove ${teamId}`),
    `team empty ${PVP_TEAM_NAME}`
  ];
  return {
    commands, activeTeamIds: [], staleTeamIds: cleanupIds, styledPlayers: [],
    scoreboardOwner: 'serverteams',
    signature: crypto.createHash('sha256').update(JSON.stringify({
      scoreboardOwner: 'serverteams', pvpEnabled, cleanupIds
    }), 'utf8').digest('hex')
  };
}

function applyRuntimePvpProtection(config, source = 'settings-save', options = {}) {
  const queuedOptions = {
    ...options,
    queuedProcess: serverProcess,
    queuedGeneration: serverLifecycleGeneration
  };
  const run = () => applyRuntimePvpProtectionUnlocked(config, source, queuedOptions);
  const pending = runtimeAccessTeamMutationQueue.then(run, run);
  runtimeAccessTeamMutationQueue = pending.catch(() => {});
  return pending;
}

async function applyRuntimePvpProtectionUnlocked(config, source = 'settings-save', options = {}) {
  if (options.queuedProcess !== serverProcess || options.queuedGeneration !== serverLifecycleGeneration) {
    return { deferred: false, count: 0, stale: true };
  }
  if (!serverProcess || serverState !== 'running' || serverReadyGeneration !== serverLifecycleGeneration) {
    if (serverProcess) deferredRuntimeSettings = { config, source, previousConfig: null };
    return { deferred: Boolean(serverProcess), count: 0 };
  }
  const generation = serverLifecycleGeneration;
  const processRef = serverProcess;
  const paths = options.paths || await getPaths();
  const access = options.access || await readPlayerAccess(paths);
  if (processRef !== serverProcess || generation !== serverLifecycleGeneration ||
      serverReadyGeneration !== generation || serverState !== 'running') {
    return { deferred: false, count: 0, stale: true };
  }
  const players = [...livePlayers.values()].sort();
  const rememberedTeamIds = await readManagedAccessTeamIds(paths);
  const scoreboardOwner = await getRuntimeScoreboardOwnership(paths, config, processRef, generation);
  // Both descriptor/state reads can yield while a profile switches or its Java process stops.
  if (processRef !== serverProcess || generation !== serverLifecycleGeneration ||
      serverReadyGeneration !== generation || serverState !== 'running') {
    return { deferred: false, count: 0, stale: true };
  }
  if (scoreboardOwner === 'unknown') {
    appendServerLog('[Server Manager SRV-CFG-214] Player role appearance sync deferred: mod identity scan is incomplete. Existing scoreboard memberships were left unchanged.\n');
    return { deferred: true, count: 0, scoreboardOwner };
  }
  if (scoreboardOwner === 'serverteams' && String(config.serverVersion || '').trim() !== '26.2') {
    appendServerLog('[Server Manager SRV-CFG-214] Server Teams scoreboard handoff deferred: native global PvP policy has only been verified for Minecraft 26.2. Existing scoreboard memberships were left unchanged.\n');
    return { deferred: true, count: 0, scoreboardOwner };
  }
  const planOptions = {
    onlinePlayers: players,
    serverVersion: config.serverVersion,
    pvpEnabled: Boolean(config.pvp),
    pvpTeamId: PVP_TEAM_NAME,
    previousConfig: options.previousAccess || null,
    previousTeamIds: rememberedTeamIds,
    provisionedTeamIds: [...provisionedAccessTeams]
  };
  const plan = scoreboardOwner === 'serverteams'
    ? buildServerTeamsAccessTeamPlan(access, planOptions)
    : buildAccessTeamCommandPlan(access, planOptions);
  const signature = `${generation}|${plan.signature}`;
  if (signature === lastPvpProtectionSignature) {
    return { deferred: false, count: 0, unchanged: true, styledPlayers: plan.styledPlayers, scoreboardOwner };
  }
  const commands = [];
  for (const command of plan.commands) {
    const addMatch = command.match(/^team add ([A-Za-z0-9_.+-]{1,16})(?:\s|$)/);
    if (addMatch) {
      const teamId = addMatch[1];
      if (teamId === PVP_TEAM_NAME ? pvpTeamProvisioned : provisionedAccessTeams.has(teamId)) continue;
    }
    commands.push(command);
  }
  const delivered = !commands.length || sendServerCommandBatch(commands);
  if (!delivered) {
    lastPvpProtectionSignature = '';
    return { deferred: false, count: 0, stale: true, styledPlayers: plan.styledPlayers };
  }
  lastPvpProtectionSignature = signature;
  for (const command of commands) {
    const addMatch = command.match(/^team add ([A-Za-z0-9_.+-]{1,16})(?:\s|$)/);
    const removeMatch = command.match(/^team remove ([A-Za-z0-9_.+-]{1,16})$/);
    if (addMatch?.[1] === PVP_TEAM_NAME) pvpTeamProvisioned = true;
    else if (addMatch) provisionedAccessTeams.add(addMatch[1]);
    if (removeMatch) provisionedAccessTeams.delete(removeMatch[1]);
  }
  await rememberManagedAccessTeamIds(paths, plan.activeTeamIds, rememberedTeamIds).catch((error) => {
    const message = String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 240);
    appendServerLog(`[Server Manager SRV-CFG-213] Could not remember managed player-role teams: ${message}\n`);
  });
  if (scoreboardOwner === 'serverteams') {
    appendServerLog(
      '[Server Manager SRV-CFG-214] Server Teams owns player scoreboard membership; app role tags are suspended.\n' +
      '  Role assignments, access capabilities, and command permissions remain unchanged.\n' +
      `  Native global PvP policy: minecraft:pvp=${Boolean(config.pvp)}\n`
    );
  } else if (!config.pvp) {
    appendServerLog(
      `[Server Manager SRV-CFG-212] PvP protection and player role teams synchronized\n` +
      `  PvP: disabled\n` +
      `  Server property: pvp=false\n` +
      `  Styled players: ${plan.styledPlayers.length ? plan.styledPlayers.join(', ') : 'none'}\n` +
      `  Online players: ${players.length ? players.join(', ') : 'none'}\n`
    );
  }
  return { deferred: false, count: commands.length, styledPlayers: plan.styledPlayers, scoreboardOwner };
}

async function saveConfigAndApply(config) {
  const mutationKey = `config:save:${++configSaveMutationSequence}`;
  const result = await serverToolMutationCoordinator.run(mutationKey, async () => {
    await validateCustomHostnameForConfig(config);
    validateVoicePublicAddressForConfig(config);
    const previous = await readConfig().catch(() => null);
    if (previous && config?.localOnly !== undefined
        && Boolean(config.localOnly) !== Boolean(previous.localOnly)) {
      throw new Error('Use the local-only console command to change local-only mode safely.');
    }
    const paths = await getPaths();
    validateWorldName(config.levelName);
    if (!previous && config?._dimensionLockChanges) throw new Error('Current server Settings could not be read. Dimension locks were not changed.');
    const locks = previous ? await applyDimensionLockSettingsRequest(config, previous, paths) : null;
    let next;
    try {
      next = await writeConfig({ ...config,
        lockNether: locks ? locks.state.nether.locked : previous?.lockNether === true,
        lockEnd: locks ? locks.state.end.locked : previous?.lockEnd === true
      });
    } catch (error) {
      if (locks) throw new Error(`Dimension locks were applied, but the other Settings could not be saved. Reload Settings to review them. ${error.message}`);
      throw error;
    }
    applyRuntimeGameRules(next, 'settings-save', previous);
    await applyRuntimePvpProtection(next, 'settings-save');
    await syncEmptyServerAutoStop('settings changed', next);
    await syncServerPowerSaveBlocker(serverState, next);
    const restartChanges = getRestartRequiredSettingChanges(previous, next);
    const pvpChanged = previous && Boolean(previous.pvp) !== Boolean(next.pvp);
    const voiceEndpointChanged = previous && String(previous.voicePublicAddress || '') !== String(next.voicePublicAddress || '');
    if (restartChanges.length) {
      appendServerLog(
        `[Server Manager SRV-CFG-210] Saved server-property setting${restartChanges.length === 1 ? '' : 's'}\n` +
        restartChanges.map((entry) => `  ${entry.label}: ${stringifySettingValue(entry.value)}`).join('\n') + '\n' +
        `  Meaning: Minecraft reads ${SERVER_PROPERTIES} when the server starts.\n` +
        `  Next step: ${serverProcess ? 'Restart the server for this to take effect.' : 'Start the server and this will take effect.'}\n`
      );
    }
    if (voiceEndpointChanged) {
      appendServerLog(
        '[Server Manager SRV-VOICE-210] Saved Simple Voice Chat public UDP endpoint.\n' +
        `  Endpoint: ${next.voicePublicAddress || 'automatic router mapping'}\n` +
        `  Next step: ${serverProcess ? 'Restart the server for voice clients to receive the new endpoint.' : 'Start the server and the voice config will be updated automatically.'}\n`
      );
    }
    const restartForPvp = Boolean(pvpChanged && serverProcess);
    if (restartForPvp) {
      appendServerLog(
        `[Server Manager SRV-CFG-211] Restarting server to apply PvP\n` +
        `  PvP: ${next.pvp ? 'enabled' : 'disabled'}\n` +
        `  Meaning: Minecraft only reads pvp from ${SERVER_PROPERTIES} during startup.\n`
      );
    }
    return { next, restartForPvp };
  });
  // Server startup is intentionally outside the config mutation lock; start
  // itself refuses to race any new tool/config mutation.
  if (result.restartForPvp) await restartServer();
  return result.next;
}

async function setUiMode() {
  const next = await serverToolMutationCoordinator.run(
    `config:ui-mode:${++configSaveMutationSequence}`,
    async () => {
      const config = await readConfig();
      return writeConfig({ ...config, uiMode: 'revamped' });
    }
  );
  for (const win of mainWindows) {
    if (!win.isDestroyed()) await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    await loadConsoleRenderer();
  }
  return next.uiMode;
}

function resetProfileRuntimeCaches() {
  cancelPendingSafeModeRetry();
  cancelPendingServerRestart();
  cancelEmptyServerAutoStop();
  for (const timer of tempBanTimers.values()) clearTimeout(timer);
  tempBanTimers.clear();
  assemblyBans.clear();
  assemblyBansPath = '';
  livePlayers.clear();
  lastPlayerRosterProbeAt = 0;
  lastPlayerRosterAuthoritativeAt = 0;
  advancePlayerRosterRevision();
  resetPlayerSpectateRuntimeCache();
  protectionLogRemainder = '';
  playerLogRemainder = '';
  playerPoseLogRemainder = '';
  cachedStatus = null;
}

function createProfile(name, stopRunning = false) {
  const requestedName = String(name || '').trim();
  return serverToolMutationCoordinator.run(`profile:create:${requestedName}`, async () => {
    if (serverStartCoordinator.getActiveKey()) throw new Error('Wait for the server to finish starting before changing server profiles.');
    if (serverProcess && !stopRunning) throw new Error('Stop the running server before creating or switching worlds.');
    if (serverProcess) await stopServerAndWait();
    const state = await readProfilesState();
    const previousConfig = state.profiles.length ? await readConfig() : { ...DEFAULT_CONFIG };
    const previousPlatform = state.profiles.length ? await readPlatformMetadata().catch(() => null) : null;
    const slug = slugifyProfileName(requestedName);
    const base = isSafeProfileId(slug) ? slug : `Server-${slug}`;
    const levelName = makeSafeWorldName(requestedName || base, base);
    let id = base;
    let suffix = 2;
    while (state.profiles.some((profile) => profile.id === id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    await transitionNatMappingsToProfile(id);
    const nextState = {
      activeProfileId: id,
      profiles: [...state.profiles, { id, name: requestedName || base }]
    };
    await writeProfilesState(nextState);
    resetProfileRuntimeCaches();
    await ensureServerDirs();
    const paths = await getPaths();
    const publicAddress = String(previousConfig.publicAddress || '').trim();
    let jarPath = previousConfig.jarPath || '';
    try {
      if (jarPath && path.resolve(jarPath) !== path.resolve(paths.vanillaJar)) {
        await fs.copyFile(jarPath, paths.vanillaJar);
        jarPath = paths.vanillaJar;
      }
    } catch {
      jarPath = paths.vanillaJar;
    }
    await writeConfig({
      ...previousConfig,
      jarPath,
      publicAddress,
      voiceUdpPort: 0,
      voicePublicAddress: '',
      levelName,
      seed: generateSeed()
    });
    if (previousPlatform && jarPath) {
      await writePlatformMetadata(paths, { ...previousPlatform, copiedAt: new Date().toISOString() });
    }
    cachedStatus = null;
    return getStatus();
  });
}

function switchProfile(profileId, stopRunning = false) {
  const requestedProfileId = String(profileId || '');
  return serverToolMutationCoordinator.run(`profile:switch:${requestedProfileId}`, async () => {
    if (serverStartCoordinator.getActiveKey()) throw new Error('Wait for the server to finish starting before changing server profiles.');
    if (serverProcess && !stopRunning) throw new Error('Stop the running server before switching worlds.');
    if (serverProcess) await stopServerAndWait();
    const state = await readProfilesState();
    if (!state.profiles.some((profile) => profile.id === requestedProfileId)) throw new Error('Server profile not found.');
    await transitionNatMappingsToProfile(requestedProfileId);
    state.activeProfileId = requestedProfileId;
    await writeProfilesState(state);
    resetProfileRuntimeCaches();
    return getStatus();
  });
}

function deleteProfile(profileId, stopRunning = false) {
  const requestedProfileId = String(profileId || '');
  return serverToolMutationCoordinator.run(`profile:delete:${requestedProfileId}`, async () => {
    if (serverStartCoordinator.getActiveKey()) throw new Error('Wait for the server to finish starting before changing server profiles.');
    const state = await readProfilesState();
    const profile = state.profiles.find((item) => item.id === requestedProfileId);
    if (!profile) throw new Error('Server profile not found.');
    if (serverProcess && state.activeProfileId === requestedProfileId && !stopRunning) {
      throw new Error('Stop the running server before deleting the active world.');
    }
    if (serverProcess && state.activeProfileId === requestedProfileId) await stopServerAndWait();
    const paths = getPathsForProfile(profile);
    const nextProfiles = state.profiles.filter((item) => item.id !== requestedProfileId);
    const nextActiveProfileId = state.activeProfileId === requestedProfileId
      ? (nextProfiles[0]?.id || '')
      : (state.activeProfileId || '');
    await transitionNatMappingsToProfile(nextActiveProfileId, requestedProfileId);
    const firewallCleanup = await cleanupProfileFirewallRules({ profileId: profile.id, profileName: profile.name });
    if (firewallCleanup.supported && !firewallCleanup.ok) {
      appendServerLog(`[Server Manager SRV-VOICE-302] Voice firewall cleanup failed for ${profile.name}: ${firewallCleanup.message || firewallCleanup.code}\n`);
    }
    state.profiles = nextProfiles;
    if (state.activeProfileId === requestedProfileId) {
      state.activeProfileId = nextActiveProfileId || null;
    }
    await writeProfilesState(state);
    resetProfileRuntimeCaches();
    const profilesRoot = path.join(app.getPath('userData'), 'minecraft-servers');
    const profileRoot = resolveContainedPath(profilesRoot, paths.root);
    await fs.rm(profileRoot, { recursive: true, force: true });
    if (nextProfiles.length) await ensureServerDirs();
    return getStatus();
  });
}

async function renameProfile(profileId, name) {
  const state = await readProfilesState();
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('Server profile not found.');
  const clean = String(name || '').trim().slice(0, 48);
  if (!clean) throw new Error('Enter a server name.');
  profile.name = clean;
  await writeProfilesState(state);
  cachedStatus = null;
  return getStatus();
}

async function loadMainRenderer(win = mainWindow) {
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

async function loadConsoleRenderer(win = consoleWindow) {
  if (!win || win.isDestroyed()) return;
  await win.loadFile(path.join(__dirname, '..', 'server-console.html'));
}

async function loadWorldMapRenderer(win = worldMapWindow) {
  if (!win || win.isDestroyed()) return;
  await win.loadFile(path.join(__dirname, '..', 'world-map.html'));
}

function normalizeEntityViewerSelector(value) {
  const selector = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(selector)
    ? selector : '';
}

async function loadEntityViewerRenderer(win = entityViewerWindow, selector = '') {
  if (!win || win.isDestroyed()) return;
  const entity = normalizeEntityViewerSelector(selector);
  const options = entity ? { query: { entity } } : undefined;
  await win.loadFile(path.join(__dirname, '..', 'entity-viewer.html'), options);
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Server Manager',
    icon: APP_ICON,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindows.add(win);
  mainWindow = win;
  win.on('closed', () => {
    mainWindows.delete(win);
    if (mainWindow === win) {
      mainWindow = [...mainWindows].find((candidate) => !candidate.isDestroyed()) || null;
    }
    if (!mainWindows.size && consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.close();
    if (!mainWindows.size && chatHistoryWindow && !chatHistoryWindow.isDestroyed()) chatHistoryWindow.close();
    if (!mainWindows.size && worldMapWindow && !worldMapWindow.isDestroyed()) worldMapWindow.close();
    if (!mainWindows.size && entityViewerWindow && !entityViewerWindow.isDestroyed()) entityViewerWindow.close();
  });
  await loadMainRenderer(win);
  win.show();
  win.focus();
  return win;
}

async function createConsoleWindow() {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    if (consoleWindow.isMinimized()) consoleWindow.restore();
    consoleWindow.show();
    consoleWindow.focus();
    return { state: serverState };
  }
  const win = new BrowserWindow({
    width: 820,
    height: 520,
    minWidth: 620,
    minHeight: 380,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Server Console',
    icon: APP_ICON,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  consoleWindow = win;
  win.on('closed', () => {
    if (consoleWindow === win) consoleWindow = null;
  });
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('server:state', serverState);
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  try {
    await loadConsoleRenderer(win);
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    if (consoleWindow === win) consoleWindow = null;
    throw error;
  }
  return { state: serverState };
}

let chatHistoryWindow;
async function createChatHistoryWindow() {
  await hydrateChatHistory();
  if (chatHistoryWindow && !chatHistoryWindow.isDestroyed()) { chatHistoryWindow.show(); chatHistoryWindow.focus(); return { count: chatHistory.length }; }
  const win = new BrowserWindow({ width: 900, height: 620, minWidth: 640, minHeight: 420, show: false, frame: false, title: 'Chat History', backgroundColor: '#101010', icon: APP_ICON, webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  chatHistoryWindow = win;
  win.on('closed', () => { if (chatHistoryWindow === win) chatHistoryWindow = null; });
  win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('chat:history', chatHistory); });
  await win.loadFile(path.join(__dirname, '..', 'chat-history.html'));
  win.show(); win.focus();
  return { count: chatHistory.length };
}

async function createWorldMapWindow(options = {}) {
  const background = options.background === true;
  if (worldMapWindow && !worldMapWindow.isDestroyed()) {
    if (worldMapWindow.isMinimized()) worldMapWindow.restore();
    if (background) worldMapWindow.showInactive();
    else { worldMapWindow.show(); worldMapWindow.focus(); }
    return getWorldMapStatus();
  }
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 520,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Live World Map',
    icon: APP_ICON,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, '..', 'world-map-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  worldMapWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => {
    if (worldMapWindow === win) {
      worldMapWindow = null;
      closeWorldMapSeedEngine();
    }
  });
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.send('server:state', serverState);
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (background) win.showInactive();
    else { win.show(); win.focus(); }
  });
  try {
    await loadWorldMapRenderer(win);
    if (!win.isDestroyed() && !win.isVisible()) {
      if (background) win.showInactive(); else win.show();
    }
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    if (worldMapWindow === win) worldMapWindow = null;
    throw error;
  }
  return getWorldMapStatus();
}

async function createEntityViewerWindow(selector = '') {
  const entity = normalizeEntityViewerSelector(selector);
  if (entityViewerWindow && !entityViewerWindow.isDestroyed()) {
    if (entity) await loadEntityViewerRenderer(entityViewerWindow, entity);
    if (entityViewerWindow.isMinimized()) entityViewerWindow.restore();
    entityViewerWindow.show();
    entityViewerWindow.focus();
    return { opened: true, entity };
  }
  const win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 980,
    minHeight: 680,
    maxWidth: 980,
    maxHeight: 680,
    resizable: false,
    maximizable: false,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: 'Entity Viewer',
    icon: APP_ICON,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, '..', 'entity-viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  entityViewerWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.on('closed', () => {
    if (entityViewerWindow === win) entityViewerWindow = null;
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  try {
    await loadEntityViewerRenderer(win, entity);
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    if (entityViewerWindow === win) entityViewerWindow = null;
    throw error;
  }
  return { opened: true, entity };
}

function attachReconnectedPlayitProcess(processRef) {
  playitProcess = processRef;
  const outputIngress = attachBoundedPlayitOutput(processRef);
  processRef.once('error', (error) => {
    outputIngress.finish();
    appendServerLog(`[Server Manager SRV-TUN-500] Reattached playit agent failed: ${error.message}\n`);
    if (playitProcess === processRef) playitProcess = null;
  });
  processRef.once('exit', (code) => {
    outputIngress.finish();
    appendServerLog(`[Server Manager SRV-TUN-001] Reattached playit agent stopped${code === null ? '' : ` with code ${code}`}.\n`);
    if (playitProcess === processRef) playitProcess = null;
  });
  if (hasChildExited(processRef)) queueMicrotask(() => {
    outputIngress.finish();
    if (playitProcess === processRef) playitProcess = null;
  });
}

function attachReconnectedServerProcess(processRef, profile, paths, config, options = {}) {
  const generation = ++serverLifecycleGeneration;
  let finished = false;
  let ready = false;
  let readinessPollBusy = false;
  let readinessPoll = null;
  let startupOutput = '';
  const statusPort = Number(options.statusPort) || Number(processRef.metadata?.port) || Number(config.port) || 25565;
  const lifecycleContext = Object.freeze({ processRef, generation, profileId: profile.id, paths });
  serverProcess = processRef;
  seamlessFabricProxyLiteLoaded = options.fabricProxyLiteLoaded === true;
  serverStartedAt = Date.parse(processRef.metadata?.startedAt || '') || Date.now();
  serverEffectiveMemoryMb = Number(processRef.metadata?.effectiveMemoryMb) || Number(config.memoryMb) || null;
  serverReadyGeneration = 0;
  stopRequestedGeneration = 0;
  protectionLogRemainder = '';
  playerLogRemainder = '';
  playerInspectionLogRemainder = '';
  playerPoseLogRemainder = '';
  deferredRuntimeSettings = null;

  const markReady = () => {
    if (ready || finished || serverProcess !== processRef || applicationQuitting) return;
    ready = true;
    if (readinessPoll) clearInterval(readinessPoll);
    serverReadyGeneration = generation;
    setState('running');
    appendServerLog(`[Server Manager SRV-UPD-200] Reattached to the running Minecraft server after the Click Interval update (PID ${processRef.pid}).\n`);
    requestPlayerRosterSync(true);
    if (config.directHostingEnabled) refreshDirectHostingForLifecycle(lifecycleContext).catch(error => {
      appendServerLog(`[Server Manager] Direct hosting refresh after update failed: ${error.message || String(error)}\n`);
    });
  };

  const processOutput = (data, isError = false) => {
    const text = data.toString();
    appendServerLog(text);
    startupOutput = `${startupOutput}${text}`.slice(-65_536);
    if (!seamlessFabricProxyLiteLoaded && isFabricProxyLiteReadyLog(text)) seamlessFabricProxyLiteLoaded = true;
    if (!isError) processPlayerLogEvents(text);
    if (!isError) notePlayerInspectionOutput(text);
    if (!isError) notePlayerPoseOutput(text);
    processProtectionLogEvents(text, { generation, adapterId: '' });
    if (isServerReadyOutput(startupOutput)) markReady();
  };
  processRef.stdin?.on?.('error', error => {
    if (serverProcess === processRef) appendServerLog(`[Server Manager SRV-CONSOLE-502] Reattached server console failed: ${error.message || String(error)}\n`);
  });
  processRef.stdout?.on?.('data', data => processOutput(data, false));
  processRef.stderr?.on?.('data', data => processOutput(data, true));

  const finish = (code, signal) => {
    if (finished) return;
    finished = true;
    clearInterval(readinessPoll);
    serverProcessFinalizers.delete(processRef);
    appendServerLog(`Server exited (${signal || code}).\n`);
    if (serverProcess !== processRef) return;
    serverProcess = null;
    serverEffectiveMemoryMb = null;
    serverStartedAt = null;
    serverReadyGeneration = 0;
    setState('stopped');
  };
  serverProcessFinalizers.set(processRef, finish);
  processRef.once('error', error => {
    if (serverProcess === processRef) appendServerLog(`[Server Manager SRV-RUN-500] Reattached server failed: ${error.message || String(error)}\n`);
  });
  processRef.once('exit', finish);
  processRef.once('close', finish);
  if (hasChildExited(processRef)) queueMicrotask(() => finish(processRef.exitCode, processRef.signalCode));
  readinessPoll = setInterval(async () => {
    if (readinessPollBusy || ready || finished || serverProcess !== processRef) return;
    readinessPollBusy = true;
    try {
      if (await queryMinecraftStatus('127.0.0.1', statusPort)) markReady();
    } finally {
      readinessPollBusy = false;
    }
  }, 750);
  readinessPoll.unref?.();
  setState('starting');
  appendServerLog(`[Server Manager SRV-UPD-100] Reattached to preserved Minecraft process ${processRef.pid}; verifying server readiness.\n`);
  loadPlayerSpectateSessions(paths).catch(() => {});
  if (options.ready === true) markReady();
}

async function reattachPersistentRuntime() {
  if (applicationQuitting || serverProcess || pendingServerStart || serverStopPromise) return { attached: false };
  const profile = await getActiveProfile();
  if (!profile?.id) return { attached: false };
  const paths = getPathsForProfile(profile);
  const attachOptional = (statePath, role) => attachPersistentProcess(statePath, { role, optional: true })
    .catch(error => {
      appendServerLog(`[Server Manager SRV-UPD-401] Could not reattach ${role}: ${error.message || String(error)}\n`);
      return null;
    });
  const [serverRef, playitRef, velocityRef, limboRef] = await Promise.all([
    attachOptional(paths.persistentServerState, 'minecraft-server'),
    attachOptional(paths.persistentPlayitState, 'playit-agent'),
    attachOptional(paths.persistentVelocityState, 'restart-proxy'),
    attachOptional(paths.persistentLimboState, 'restart-lobby')
  ]);
  if (applicationQuitting) {
    for (const processRef of [serverRef, playitRef, velocityRef, limboRef]) disconnectPersistentProcess(processRef);
    return { attached: false };
  }
  if (playitRef) attachReconnectedPlayitProcess(playitRef);
  if (velocityRef) {
    seamlessVelocityProcess = velocityRef;
    attachSeamlessSidecarProcess(velocityRef, 'velocity');
    seamlessRuntimeProfileId = profile.id;
  }
  if (limboRef) {
    seamlessLimboProcess = limboRef;
    attachSeamlessSidecarProcess(limboRef, 'limbo');
    seamlessRuntimeProfileId = profile.id;
  }
  const config = await readConfig(paths);
  const seamless = getSeamlessRestartConfig(config);
  if (limboRef?.metadata?.holdingType === 'fabric') {
    // Adoption is read-only. Do not stop the SMP/proxy or replace an idle lobby
    // from this path; only renew this separate lobby's existing voice lease.
    let forwardingSecret = '';
    try { forwardingSecret = (await readSmallTextFile(paths.seamlessRestartVelocitySecret, 16 * 1024)).trim(); } catch {}
    const holding = await inspectHoldingLobby({ seamlessRoot: paths.seamlessRestartRoot,
      expectedPort: seamless.limboPort, expectedHost: seamless.limboHost, mainVoicePort: config.voiceUdpPort, forwardingSecret });
    if (await isVerifiedHoldingLobbyProcess(limboRef, holding, paths)) {
      const holdingJava = await resolveJava(config);
      void prepareProtectedHoldingVoice(profile, config, holding, holdingJava.path);
    } else appendServerLog('[Restart Lobby] Preserved protected lobby readiness is unverified; silent restart remains unavailable.\n');
  }
  if (!serverRef) return { attached: Boolean(playitRef || velocityRef || limboRef) };
  const statusPort = seamless.enabled ? seamless.backendPort
    : (Number(serverRef.metadata?.port) || Number(config.port) || 25565);
  const status = await queryMinecraftStatus('127.0.0.1', statusPort);
  let fabricProxyLiteLoaded = false;
  if (seamless.enabled && status) {
    try {
      const evidence = await inspectPersistentProcessBacklog(paths.persistentServerState, {
        expectedState: serverRef.state,
        predicates: { fabricProxyLite: isFabricProxyLiteReadyLog, backendReady: isServerReadyOutput }
      });
      fabricProxyLiteLoaded = evidence.complete && evidence.matches.fabricProxyLite && evidence.matches.backendReady;
      if (fabricProxyLiteLoaded) appendServerLog('[Seamless Restart] Recovered FabricProxy-Lite readiness from the authenticated startup output of the same preserved backend.\n');
    } catch (error) {
      appendServerLog(`[Seamless Restart] Preserved backend forwarding readiness remains unverified: ${error.message || String(error)}\n`);
    }
  }
  attachReconnectedServerProcess(serverRef, profile, paths, config, {
    ready: Boolean(status), statusPort, fabricProxyLiteLoaded
  });
  return { attached: true, serverReady: Boolean(status), pid: serverRef.pid };
}

function prepareForAppUpdate(options = {}) {
  preserveOwnedProcessesForUpdate = options.preserveServer !== false;
  return {
    preserveServer: preserveOwnedProcessesForUpdate,
    serverRunning: Boolean(serverProcess),
    serverPid: Number(serverProcess?.pid) || 0
  };
}

async function detachOwnedProcessesForUpdate() {
  const ownedProcesses = [serverProcess, playitProcess, seamlessVelocityProcess, seamlessLimboProcess].filter(Boolean);
  const results = await Promise.all(ownedProcesses.map(processRef => disconnectPersistentProcess(processRef)));
  if (results.some(result => result?.checkpointed !== true)) {
    appendServerLog('[Server Manager SRV-UPD-206] A process handoff checkpoint was not acknowledged; the replacement app will attach at the live output boundary.\n');
  }
  suspendHoldingLobbyVoiceNetwork(); // Keep the router mapping while its new app owner takes over.
  return results;
}

async function shutdownOwnedServerForQuit(processRef) {
  if (!processRef) return;
  stopRequestedGeneration = serverLifecycleGeneration;
  try {
    if (processRef.stdin?.writable && !processRef.stdin.destroyed && !processRef.stdin.writableEnded) {
      const restorable = [...playerSpectateSessions]
        .map(([viewerKey, session]) => [viewerKey, livePlayers.get(viewerKey), session])
        .filter(([, viewer]) => Boolean(viewer));
      const commands = restorable.flatMap(([, viewer, session]) => buildStopPlayerSpectateCommands(viewer, session.origin));
      processRef.stdin.write(`${commands.length ? `${commands.join('\n')}\n` : ''}stop\n`);
    }
  } catch {}
  let exited = await waitForChildExit(processRef, 1200);
  if (!exited) {
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, 700);
  }
  if (exited && serverProcess === processRef) serverProcess = null;
}

async function shutdownOwnedPlayitForQuit(processRef, gracefulTimeoutMs = 900, forceTimeoutMs = 500) {
  if (!processRef) return;
  try { processRef.kill(); } catch {}
  let exited = await waitForChildExit(processRef, gracefulTimeoutMs);
  if (!exited) {
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, forceTimeoutMs);
  }
  if (exited && playitProcess === processRef) playitProcess = null;
}

async function shutdownOwnedSeamlessSidecarForQuit(processRef, command, kind) {
  if (!processRef) return;
  tryWriteSidecarInput(processRef, command, kind === 'velocity' ? 'Restart Proxy' : 'Restart Lobby');
  let exited = await waitForChildExit(processRef, 900);
  if (!exited) {
    try { processRef.kill('SIGKILL'); } catch {}
    exited = await waitForChildExit(processRef, 500);
  }
  if (kind === 'velocity' && exited && seamlessVelocityProcess === processRef) seamlessVelocityProcess = null;
  if (kind === 'limbo' && exited && seamlessLimboProcess === processRef) seamlessLimboProcess = null;
}

async function shutdownOwnedChildrenForQuit(
  initialServerProcess,
  initialPlayitProcess,
  initialVelocityProcess,
  initialLimboProcess
) {
  suspendHoldingLobbyVoiceNetwork();
  const stoppedServers = new Set();
  const stoppedPlayitAgents = new Set();
  const stoppedVelocityProxies = new Set();
  const stoppedLimboServers = new Set();
  let ownedServerProcess = initialServerProcess;
  let ownedPlayitProcess = initialPlayitProcess;
  let ownedVelocityProcess = initialVelocityProcess;
  let ownedLimboProcess = initialLimboProcess;
  for (let pass = 0; pass < 3; pass += 1) {
    const cleanup = [];
    if (ownedServerProcess && !stoppedServers.has(ownedServerProcess)) {
      stoppedServers.add(ownedServerProcess);
      cleanup.push(shutdownOwnedServerForQuit(ownedServerProcess));
    }
    if (ownedPlayitProcess && !stoppedPlayitAgents.has(ownedPlayitProcess)) {
      stoppedPlayitAgents.add(ownedPlayitProcess);
      cleanup.push(shutdownOwnedPlayitForQuit(ownedPlayitProcess));
    }
    if (ownedVelocityProcess && !stoppedVelocityProxies.has(ownedVelocityProcess)) {
      stoppedVelocityProxies.add(ownedVelocityProcess);
      cleanup.push(shutdownOwnedSeamlessSidecarForQuit(ownedVelocityProcess, 'shutdown', 'velocity'));
    }
    if (ownedLimboProcess && !stoppedLimboServers.has(ownedLimboProcess)) {
      stoppedLimboServers.add(ownedLimboProcess);
      cleanup.push(shutdownOwnedSeamlessSidecarForQuit(ownedLimboProcess, 'stop', 'limbo'));
    }
    if (cleanup.length) await Promise.allSettled(cleanup);
    ownedServerProcess = serverProcess;
    ownedPlayitProcess = playitProcess;
    ownedVelocityProcess = seamlessVelocityProcess;
    ownedLimboProcess = seamlessLimboProcess;
    const hasUnseenServer = Boolean(ownedServerProcess && !stoppedServers.has(ownedServerProcess));
    const hasUnseenPlayit = Boolean(ownedPlayitProcess && !stoppedPlayitAgents.has(ownedPlayitProcess));
    const hasUnseenVelocity = Boolean(ownedVelocityProcess && !stoppedVelocityProxies.has(ownedVelocityProcess));
    const hasUnseenLimbo = Boolean(ownedLimboProcess && !stoppedLimboServers.has(ownedLimboProcess));
    if (!hasUnseenServer && !hasUnseenPlayit && !hasUnseenVelocity && !hasUnseenLimbo) break;
  }
}

app.on('before-quit', (event) => {
  closeWorldMapSeedEngine();
  if (applicationQuitCleanupFinished) return;
  applicationQuitting = true;
  cancelEmptyServerAutoStop();
  stopServerPowerSaveBlocker();
  cancelPendingSafeModeRetry();
  cancelPendingServerRestart();
  event.preventDefault();
  if (protectionQuitFlushStarted) return;
  protectionQuitFlushStarted = true;
  const ownedServerProcess = serverProcess;
  const ownedPlayitProcess = playitProcess;
  const ownedVelocityProcess = seamlessVelocityProcess;
  const ownedLimboProcess = seamlessLimboProcess;
  const ownedProcesses = [ownedServerProcess, ownedPlayitProcess, ownedVelocityProcess, ownedLimboProcess].filter(Boolean);
  if (serverLogIpcTimer) flushServerLogIpc();
  const protectionFlush = Promise.all(
    [...protectionIncidentQueues.keys()].map((key) => flushProtectionIncidentQueue(key).catch(() => []))
  );
  const historyFlush = flushPlayerHistoryEventQueue().catch(() => []);
  const preserveForUpdate = preserveOwnedProcessesForUpdate && ownedProcesses.length > 0 &&
    ownedProcesses.every(processRef => typeof processRef.disconnectForHandoff === 'function');
  let processHandoff = Promise.resolve();
  if (preserveForUpdate) {
    processHandoff = detachOwnedProcessesForUpdate();
    appendServerLog('[Server Manager SRV-UPD-100] Click Interval is updating; managed server processes are being handed off and will keep running.\n');
  } else if (preserveOwnedProcessesForUpdate && ownedProcesses.length > 0) {
    appendServerLog('[Server Manager SRV-UPD-409] This server was not launched by the persistent update host, so it cannot be handed off safely and will use normal shutdown.\n');
  }
  const cleanup = Promise.allSettled([
    protectionFlush,
    historyFlush,
    preserveForUpdate ? processHandoff : destroyNatClientBestEffort(),
    preserveForUpdate
      ? Promise.resolve()
      : shutdownOwnedChildrenForQuit(
          ownedServerProcess,
          ownedPlayitProcess,
          ownedVelocityProcess,
          ownedLimboProcess
        )
  ]);
  const boundedCleanup = Promise.race([
    cleanup,
    new Promise((resolve) => {
      setTimeout(resolve, 2500);
    })
  ]);
  boundedCleanup
    .finally(() => {
      applicationQuitCleanupFinished = true;
      app.quit();
    });
});

function rememberEmbeddedSender(event) {
  rememberEmbeddedSubscriber(event?.sender);
  return getStatus();
}

ipcMain.handle('status:get', rememberEmbeddedSender);
ipcMain.handle('config:save', (_, config) => saveConfigAndApply(config));
ipcMain.handle('ui:setMode', (_, mode) => setUiMode(mode));
ipcMain.handle('server:downloadVanilla', downloadLatestVanilla);
ipcMain.handle('server:downloadVersion', (_, versionId) => downloadVanillaVersion(versionId));
ipcMain.handle('server:listVersions', getVersionManifest);
ipcMain.handle('server:installPlatform', (_, options) => installServerPlatform(options));
ipcMain.handle('server:platformStatus', () => getServerPlatformStatus());
ipcMain.handle('hostname:check', (_, hostname) => checkHostnameAvailability(hostname));
ipcMain.handle('server:selectJar', selectServerJar);
ipcMain.handle('server:selectIcon', selectServerIcon);
ipcMain.handle('server:removeIcon', removeServerIcon);
ipcMain.handle('server:start', startServer);
ipcMain.handle('server:stop', stopServer);
ipcMain.handle('server:restart', restartServer);
ipcMain.handle('server:command', (_, command) => sendCommand(command));
ipcMain.handle('players:ban', (_, name, message) => banPlayer(name, message));
ipcMain.handle('players:tempBan', (_, name, durationMs, message) => tempBanPlayer(name, durationMs, message));
ipcMain.handle('players:tempBanUntil', (_, name, endAt, message) => tempBanPlayer(name, { endAt, message }));
ipcMain.handle('players:pardon', (_, name) => pardonPlayer(name));
ipcMain.handle('players:shortenBan', (_, name, durationMs, message) => shortenBan(name, durationMs, message));
ipcMain.handle('players:listBans', () => getBannedPlayers());
ipcMain.handle('players:getSkin', (_, value) => getPlayerSkin(value));
ipcMain.handle('players:inspect', (_, name) => inspectPlayer(name));
ipcMain.handle('players:statistics', (_, name) => getPlayerStatistics(name));
ipcMain.handle('players:spectateStatus', (_, name) => getPlayerSpectateStatus(name));
ipcMain.handle('players:startSpectating', (_, value) => startPlayerSpectating(value));
ipcMain.handle('players:stopSpectating', (_, viewer) => stopPlayerSpectating(viewer));
ipcMain.handle('players:exportViewCompanion', exportBundledPlayerViewCompanion);
ipcMain.handle('players:snapshot', () => getPlayerSnapshot());
ipcMain.handle('players:history', getPlayerHistory);
ipcMain.handle('players:historyEvents', async () => flattenPlayerHistoryEvents(await getPlayerHistory()));
ipcMain.handle('players:getAccess', getPlayerAccess);
ipcMain.handle('players:setAccess', (_, value) => savePlayerAccess(value));
ipcMain.handle('players:removeAccess', (_, player) => deletePlayerAccess(player));
ipcMain.handle('players:saveRole', (_, value) => savePlayerAccessRole(value));
ipcMain.handle('players:deleteRole', (_, value) => deletePlayerAccessRole(value));
ipcMain.handle('assembly:command', (_, command) => runAssemblyConsoleCommand(command));
ipcMain.handle('files:importJars', (_, kind) => importJarFiles(kind));
ipcMain.handle('files:deleteJar', (_, kind, name) => deleteManagedJar(kind, name));
ipcMain.handle('addons:search', (_, options) => searchAddons(options));
ipcMain.handle('addons:details', (_, options) => getAddonDetails(options));
ipcMain.handle('addons:install', (_, options) => installAddonForActiveProfile(options));
ipcMain.handle('addons:checkUpdate', (_, kind, name) => checkInstalledAddonUpdate(kind, name));
ipcMain.handle('addons:updateInstalled', (_, kind, name) => updateInstalledAddon(kind, name));
ipcMain.handle('addons:getCurseForgeKeyStatus', getCurseForgeKeyStatus);
ipcMain.handle('addons:setCurseForgeApiKey', (_, value) => setCurseForgeApiKey(value));
ipcMain.handle('tools:getTeleportStatus', () => getBundledTeleportStatus());
ipcMain.handle('tools:installTeleport', installBundledTeleport);
ipcMain.handle('tools:removeTeleport', removeBundledTeleport);
ipcMain.handle('tools:getVoiceStatus', () => getBundledVoiceStatus());
ipcMain.handle('tools:installVoice', installBundledVoice);
ipcMain.handle('tools:removeVoice', removeBundledVoice);
ipcMain.handle('tools:exportVoiceClient', exportBundledVoiceClient);
ipcMain.handle('security:getStatus', getSecurityStatus);
ipcMain.handle('security:applyPreset', (_, options) => applySecurityPreset(options));
ipcMain.handle('security:applyAntiXray', (_, options) => applyAntiXray(options));
ipcMain.handle('security:removeLegacyProtection', removeLegacyProtection);
ipcMain.handle('protection:getConfig', () => getProtectionConfig());
ipcMain.handle('protection:saveConfig', (_, value) => saveProtectionConfigFromRenderer(value));
ipcMain.handle('protection:getExemptions', getProtectionExemptions);
ipcMain.handle('protection:saveExemptions', (_, value) => saveProtectionExemptions(value));
ipcMain.handle('protection:getModPolicy', getModPolicy);
ipcMain.handle('protection:addModPolicyRule', (_, value) => addModPolicyRule(value));
ipcMain.handle('protection:removeModPolicyRule', (_, value) => removeModPolicyRule(value));
ipcMain.handle('protection:addPlayerModException', (_, value) => addPlayerModException(value));
ipcMain.handle('protection:removePlayerModException', (_, value) => removePlayerModException(value));
ipcMain.handle('protection:getHistory', (_, options) => getProtectionHistory(options));
ipcMain.handle('protection:clearHistory', clearProtectionHistory);
ipcMain.handle('protection:installBundled', installBundledAntiCheat);
ipcMain.handle('protection:importCustom', importCustomAntiCheat);
ipcMain.handle('protection:listCustom', listCustomAntiCheats);
ipcMain.handle('protection:removeCustom', (_, id) => removeCustomAntiCheat(id));
ipcMain.handle('files:clearLogs', clearLogs);
ipcMain.handle('files:wipeData', (_, options) => wipeServerData(options));
ipcMain.handle('files:openServerFolder', async () => shell.openPath((await getPaths()).root));
ipcMain.handle('files:openServersFolder', async () => {
  const root = path.join(app.getPath('userData'), 'minecraft-servers');
  await fs.mkdir(root, { recursive: true });
  return shell.openPath(root);
});
ipcMain.handle('links:openJavaDownload', () => shell.openExternal('https://adoptium.net/temurin/releases/?version=25'));
ipcMain.handle('links:openPlayitSetup', () => shell.openExternal('https://playit.gg/setup/agent'));
ipcMain.handle('links:openPlayitDownload', () => shell.openExternal('https://playit.gg/download'));
ipcMain.handle('links:openServerAddons', () => shell.openExternal('https://click-interval.netlify.app/download.html?extensions=minecraft-server&features=teleport-requests%2Cproximity-voice#minecraftFeatures'));
ipcMain.handle('playit:download', downloadPlayitAgent);
ipcMain.handle('playit:start', startPlayitAgent);
ipcMain.handle('playit:stop', stopPlayitAgent);
ipcMain.handle('direct:enable', enableDirectHosting);
ipcMain.handle('direct:disable', disableDirectHosting);
ipcMain.handle('direct:status', getDirectHostingStatus);
ipcMain.handle('connection:repair', repairConnection);
ipcMain.handle('profiles:create', (_, name, stopRunning) => createProfile(name, stopRunning));
ipcMain.handle('profiles:switch', (_, profileId, stopRunning) => switchProfile(profileId, stopRunning));
ipcMain.handle('profiles:delete', (_, profileId, stopRunning) => deleteProfile(profileId, stopRunning));
ipcMain.handle('profiles:rename', (_, profileId, name) => renameProfile(profileId, name));
ipcMain.handle('console:open', createConsoleWindow);
ipcMain.handle('console:getLog', () => serverLogBuffer.toString());
ipcMain.handle('chat-history:open', createChatHistoryWindow);
ipcMain.handle('chat-history:get', async () => { await hydrateChatHistory(); return chatHistory.slice(); });
ipcMain.handle('chat-history:export', async () => {
  await hydrateChatHistory();
  await chatHistoryWriteQueue;
  const paths = await getPaths();
  const persistedText = await fs.readFile(path.join(paths.root, 'chat-history.jsonl'), 'utf8').catch(() => '');
  const persistedEntries = persistedText.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(entry => entry && ['chat', 'private'].includes(entry.kind) && entry.message);
  const exportEntries = persistedEntries.length ? persistedEntries : chatHistory;
  const result = await dialog.showSaveDialog({ title: 'Export chat history', defaultPath: 'chat-history.html', filters: [{ name: 'Portable web page', extensions: ['html'] }, { name: 'JSON', extensions: ['json'] }, { name: 'Text', extensions: ['txt'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const output = result.filePath.toLowerCase().endsWith('.txt')
    ? exportEntries.map(item => `[${item.timestamp}] ${item.raw}`).join('\n')
    : result.filePath.toLowerCase().endsWith('.json')
      ? JSON.stringify(exportEntries, null, 2)
      : `<!doctype html><meta charset="utf-8"><title>Chat history</title><style>body{max-width:960px;margin:32px auto;background:#111;color:#eee;font:14px system-ui}.m{padding:8px;border-bottom:1px solid #333}.p b{color:#d7a6ff}time{color:#8994a0;margin-right:8px}b{color:#6fd3ff}</style><h1>Chat history</h1>${exportEntries.map(item => `<div class="m ${item.kind === 'private' ? 'p' : ''}"><time>${htmlEscape(item.timestamp)}</time><b>${htmlEscape(item.sender)}</b>${item.recipient ? ` → ${htmlEscape(item.recipient)}` : ''}: ${htmlEscape(item.message)}</div>`).join('')}`;
  await fs.writeFile(result.filePath, output, 'utf8');
  return { canceled: false, filePath: result.filePath };
});
ipcMain.handle('world-map:open', (_event, options) => createWorldMapWindow({ background: options?.background === true }));
ipcMain.handle('world-map:snapshot', (_, terrainToken) => getWorldMapSnapshot(terrainToken));
ipcMain.handle('world-map:seedPreview', (_, request) => getWorldMapSeedPreview(request));
ipcMain.handle('world-map:stopSeedPreview', () => { closeWorldMapSeedEngine(); return true; });
ipcMain.handle('world-map:slimeChunks', (_, request) => getWorldMapSlimeChunks(request));
ipcMain.handle('world-map:playerDetails', (_, name) => getWorldMapPlayerDetails(name));
ipcMain.handle('world-map:status', () => getWorldMapStatus());
ipcMain.handle('world-map:install', installWorldMap);
ipcMain.handle('world-map:remove', removeWorldMap);
ipcMain.handle('world-map:export', () => { throw new Error('The native map module is managed automatically by Click Interval.'); });
ipcMain.handle('world-map:kick', (_, name, reason) => kickWorldMapPlayer(name, reason));
ipcMain.handle('world-map:ban', (_, name, reason) => banPlayer(name, reason));
ipcMain.handle('world-map:tempBan', (_, name, durationMs, reason) => tempBanPlayer(name, durationMs, reason));
ipcMain.handle('entity-viewer:open', (_, selector) => createEntityViewerWindow(selector));
ipcMain.handle('entity-viewer:list', listEntityViewerEntities);
ipcMain.handle('entity-viewer:inspect', (_, entityUuid) => inspectEntityForViewer(entityUuid));
ipcMain.handle('entity-viewer:updateOffer', (_, entityUuid, offerIndex, value) =>
  updateEntityViewerOffer(entityUuid, offerIndex, value));
ipcMain.handle('entity-viewer:setAge', (_, entityUuid, value) => setEntityViewerAge(entityUuid, value));
ipcMain.handle('entity-viewer:setCooldown', (_, entityUuid, value) => setEntityViewerCooldown(entityUuid, value));
ipcMain.handle('clipboard:writeText', (_, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window:maximizeToggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});
ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

module.exports = {
  attachHostWindow(hostWindow) {
    mainWindow = hostWindow;
    if (!persistentRuntimeAttachPromise) {
      persistentRuntimeAttachPromise = reattachPersistentRuntime()
        .catch(error => appendServerLog(`[Server Manager SRV-UPD-500] Server update handoff recovery failed: ${error.message || String(error)}\n`))
        .finally(() => { persistentRuntimeAttachPromise = null; });
    }
  },
  ensureServerDirs,
  prepareForAppUpdate,
  silentRestartServer,
  stopServer
};
