'use strict';

const SUPPORTED_SERVER_TYPES = Object.freeze([
  'vanilla',
  'fabric',
  'quilt',
  'forge',
  'neoforge',
  'paper',
  'purpur',
  'spigot'
]);

const PLUGIN_SERVER_TYPES = Object.freeze(['paper', 'purpur', 'spigot']);
const MOD_SERVER_TYPES = Object.freeze(['fabric', 'quilt', 'forge', 'neoforge']);
const NATIVE_ANTI_XRAY_SERVER_TYPES = Object.freeze(['paper', 'purpur']);
const FABRIC_PROTECTION_MINECRAFT_VERSIONS = Object.freeze(['26.2', '26.3']);
// Retained for callers that need one legacy/default value; capability reporting uses the full list.
const FABRIC_PROTECTION_MINECRAFT_VERSION = '26.3';

const BUKKIT_CHECKS = Object.freeze([
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak', 'chatSpam', 'commandSpam', 'inventorySpam'
]);
const FABRIC_CHECKS = Object.freeze([
  'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
  'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
  'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak', 'chatSpam', 'commandSpam', 'inventorySpam'
]);

function normalizeProtectionServerType(value) {
  const normalized = String(value || 'vanilla').trim().toLowerCase();
  return SUPPORTED_SERVER_TYPES.includes(normalized) ? normalized : 'vanilla';
}

function normalizeMinecraftVersion(value) {
  return String(value || '').trim().replace(/^minecraft\s*/i, '');
}

function adapterKindForServerType(serverType) {
  const type = normalizeProtectionServerType(serverType);
  if (PLUGIN_SERVER_TYPES.includes(type)) return 'plugins';
  if (MOD_SERVER_TYPES.includes(type)) return 'mods';
  return '';
}

function resolveProtectionAdapter(serverType, minecraftVersion = '') {
  const type = normalizeProtectionServerType(serverType);
  const version = normalizeMinecraftVersion(minecraftVersion);
  if (PLUGIN_SERVER_TYPES.includes(type)) {
    return Object.freeze({ id: 'bukkit', kind: 'plugins', versionSupported: true });
  }
  if (type === 'fabric' && FABRIC_PROTECTION_MINECRAFT_VERSIONS.includes(version)) {
    return Object.freeze({ id: `fabric-${version}`, kind: 'mods', versionSupported: true });
  }
  return null;
}

/** Describe only protection that the selected runtime can actually load. */
function getProtectionCapabilities(serverType, minecraftVersion = '') {
  const type = normalizeProtectionServerType(serverType);
  const adapterKind = adapterKindForServerType(type);
  const adapter = resolveProtectionAdapter(type, minecraftVersion);
  const bundledAdapterSupported = Boolean(adapter);
  const customAdapterSupported = Boolean(adapterKind);
  const nativeAntiXraySupported = NATIVE_ANTI_XRAY_SERVER_TYPES.includes(type);
  const antiXrayDetectionSupported = Boolean(adapter?.id?.startsWith('fabric-'));
  const antiXrayObfuscationSupported = Boolean(adapter?.id?.startsWith('fabric-'));
  const supportedChecks = adapter?.id?.startsWith('fabric-') ? FABRIC_CHECKS : adapter?.id === 'bukkit' ? BUKKIT_CHECKS : [];
  const tier = bundledAdapterSupported
    ? 'full-bundled'
    : customAdapterSupported
      ? 'baseline-with-custom-adapter'
      : 'baseline-only';

  return Object.freeze({
    serverType: type,
    tier,
    baselineHardeningSupported: true,
    bundledAdapterSupported,
    bundledAdapterId: adapter?.id || '',
    bundledAdapterKind: adapter?.kind || '',
    bundledAdapterVersionSupported: type !== 'fabric' || Boolean(adapter),
    supportedMinecraftVersions: type === 'fabric' ? FABRIC_PROTECTION_MINECRAFT_VERSIONS : Object.freeze([]),
    supportedChecks: Object.freeze([...supportedChecks]),
    customAdapterSupported,
    customAdapterKind: adapterKind,
    eventChecksBundled: bundledAdapterSupported,
    nativeAntiXraySupported,
    antiXrayDetectionSupported,
    antiXrayObfuscationSupported,
    antiXrayMode: nativeAntiXraySupported || antiXrayObfuscationSupported ? 'obfuscation' : antiXrayDetectionSupported ? 'detection' : '',
    // Withholding a tracked player also withholds their nametag and creates unavoidable PvP
    // pop-in. Managed servers intentionally preserve vanilla visibility instead.
    espMitigationSupported: false,
    accessRoleExemptionsSupported: Boolean(adapter),
    accessCommandPermissionsSupported: Boolean(adapter),
    requiresServerRestartForAdapter: customAdapterSupported,
    legacyRecommendedInstallSupported: false
  });
}

/** Resolve whether the selected, verified platform can load its bundled adapter now. */
function getProtectionCapabilityState(serverType, platform = {}, configuredVersion = '') {
  const minecraftVersion = normalizeMinecraftVersion(
    platform.minecraftVersion || configuredVersion
  );
  const capabilities = getProtectionCapabilities(serverType, minecraftVersion);
  const platformType = normalizeProtectionServerType(
    platform.desiredType || platform.declaredType || platform.installedType || capabilities.serverType
  );
  const platformMatches = platformType === capabilities.serverType;
  const runtimeReady = Boolean(
    platform.jarExists &&
    platform.compatible &&
    platform.verified &&
    platform.ready &&
    platformMatches
  );
  const bundledAdapterReady = Boolean(capabilities.bundledAdapterSupported && runtimeReady);

  return Object.freeze({
    ...capabilities,
    minecraftVersion,
    platformMatches,
    runtimeReady,
    bundledAdapterReady,
    effectiveTier: bundledAdapterReady ? 'full-bundled' : capabilities.tier === 'baseline-only'
      ? 'baseline-only'
      : 'baseline-awaiting-adapter'
  });
}

module.exports = {
  SUPPORTED_SERVER_TYPES,
  PLUGIN_SERVER_TYPES,
  MOD_SERVER_TYPES,
  NATIVE_ANTI_XRAY_SERVER_TYPES,
  FABRIC_PROTECTION_MINECRAFT_VERSIONS,
  FABRIC_PROTECTION_MINECRAFT_VERSION,
  BUKKIT_CHECKS,
  FABRIC_CHECKS,
  normalizeProtectionServerType,
  normalizeMinecraftVersion,
  adapterKindForServerType,
  resolveProtectionAdapter,
  getProtectionCapabilities,
  getProtectionCapabilityState
};
