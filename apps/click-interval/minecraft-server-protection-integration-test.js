'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, 'minecraft-server', 'main.js');
const temporaryBase = path.resolve(os.tmpdir());
const testUserData = fs.mkdtempSync(path.join(temporaryBase, 'click-interval-protection-integration-'));
const plain = (value) => JSON.parse(JSON.stringify(value));

function assertSafeTemporaryPath(target) {
  const resolved = path.resolve(target);
  const prefix = `${temporaryBase}${path.sep}`;
  if (!resolved.startsWith(prefix) || !path.basename(resolved).startsWith('click-interval-protection-integration-')) {
    throw new Error(`Refusing to clean an unsafe integration-test path: ${resolved}`);
  }
  return resolved;
}

function loadBackend() {
  const source = `${fs.readFileSync(sourcePath, 'utf8')}\nmodule.exports.__protectionIntegrationTest = {\n`
    + '  saveProtectionConfig, getProtectionConfig, getSecurityStatus, getBundledAntiCheatStatus, installBundledAntiCheat, resetProtectionOffenseFile, getModPolicy, addModPolicyRule, removeModPolicyRule, addPlayerModException, removePlayerModException, refreshManagedBundledProtectionBeforeStartUnlocked, getPaths, readConfig, getServerPlatformStatus\n'
    + '};';
  const ipcHandlers = new Map();
  const electronMock = {
    app: { getPath: () => testUserData, on: () => {} },
    BrowserWindow: { fromWebContents: () => null },
    ipcMain: { handle: (name, handler) => ipcHandlers.set(name, handler) },
    dialog: {},
    shell: {},
    Menu: {},
    clipboard: {},
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => value.toString('utf8')
    }
  };
  const moduleMock = { exports: {} };
  const sandbox = {
    module: moduleMock,
    exports: moduleMock.exports,
    __dirname: path.dirname(sourcePath),
    __filename: sourcePath,
    Buffer,
    URL,
    URLSearchParams,
    process,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: (id) => {
      if (id === 'electron') return electronMock;
      if (id === './vendor/node_modules/nat-api') return class NatApiMock {};
      if (id.startsWith('./')) return require(path.join(path.dirname(sourcePath), id));
      if (id === './mod-policy') return require(path.join(path.dirname(sourcePath), 'mod-policy.js'));
      if (id === './access-policy') return require(path.join(path.dirname(sourcePath), 'access-policy.js'));
      if (id === './protection-messages') return require(path.join(path.dirname(sourcePath), 'protection-messages.js'));
      if (id === './protection-tuning') return require(path.join(path.dirname(sourcePath), 'protection-tuning.js'));
      if (id === './player-assets') return require(path.join(path.dirname(sourcePath), 'player-assets.js'));
      if (id === './nat-lease-ownership') return require(path.join(path.dirname(sourcePath), 'nat-lease-ownership.js'));
      if (id === './performance-safety') return require(path.join(path.dirname(sourcePath), 'performance-safety.js'));
      return require(id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  return { api: moduleMock.exports.__protectionIntegrationTest, ipcHandlers };
}

async function seedProfile() {
  const profileId = 'Protection-Test';
  const profileRoot = path.join(testUserData, 'minecraft-servers', profileId);
  await fs.promises.mkdir(profileRoot, { recursive: true });
  await fs.promises.writeFile(path.join(testUserData, 'assembly-profiles.json'), JSON.stringify({
    activeProfileId: profileId,
    profiles: [{ id: profileId, name: 'Protection Test' }]
  }, null, 2));
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({
    serverType: 'vanilla',
    serverVersion: 'latest',
    levelName: 'world'
  }, null, 2));
  return profileRoot;
}

async function run() {
  const profileRoot = await seedProfile();
  const { api, ipcHandlers } = loadBackend();
  assert(api, 'Protection integration exports failed to load.');
  for (const channel of [
    'protection:getModPolicy',
    'protection:addModPolicyRule',
    'protection:removeModPolicyRule',
    'protection:addPlayerModException',
    'protection:removePlayerModException'
  ]) {
    assert(ipcHandlers.has(channel), `Missing IPC handler: ${channel}`);
  }

  const security = plain(await api.getSecurityStatus());
  assert.equal(security.capabilities.serverType, 'vanilla');
  assert.equal(security.capabilities.baselineHardeningSupported, true);
  assert.equal(security.capabilities.bundledAdapterSupported, false);
  assert.equal(security.capabilities.customAdapterSupported, false);
  assert.equal(security.capabilities.nativeAntiXraySupported, false);
  assert.equal(security.capabilities.legacyRecommendedInstallSupported, false);
  assert.equal(security.capabilities.eventAdapterReady, false);
  assert.equal(Object.hasOwn(security, 'antiCheat'), false);
  assert.equal(Object.hasOwn(security.desiredLayers, 'grim'), false);

  await api.saveProtectionConfig({
    compatibility: {
      permissionOverrides: {
        'clickinterval.compat.inventory': {
          name: 'Inventory helper permission',
          exemptChecks: ['abuse.inventorySpam']
        }
      }
    }
  });

  const [allowedResult, blockedResult] = await Promise.all([
    api.addModPolicyRule({ list: 'allowed', modId: 'MouseTweaks' }),
    api.addModPolicyRule({ list: 'blocked', modId: 'xray-helper' })
  ]);
  assert(allowedResult?.policy && blockedResult?.policy, 'Policy mutations must return the UI policy shape.');
  let policy = await api.getModPolicy();
  assert.deepEqual(plain(policy.modPolicy.allowed), ['mousetweaks']);
  assert.deepEqual(plain(policy.modPolicy.blocked), ['xray-helper']);
  assert.equal(policy.modPolicy.enabled, true);
  assert.equal(policy.modPolicy.enforcement, 'kick');
  assert.equal(policy.modPolicy.enforceAllowlist, true);
  assert.deepEqual(plain(policy.allowedMods), [{ modId: 'mousetweaks' }]);
  assert.deepEqual(plain(policy.blockedMods), [{ modId: 'xray-helper' }]);

  // This mirrors the renderer's generic save: it spreads a previously loaded full config,
  // including compatibility/modPolicy. Start the dedicated policy mutation first so a stale
  // generic payload cannot overwrite it when both operations overlap.
  const staleRendererConfig = plain(await api.getProtectionConfig());
  staleRendererConfig.checks.speed = false;
  const addPolicy = api.addModPolicyRule({ list: 'blocked', modId: 'reach-hack' });
  const saveChecks = ipcHandlers.get('protection:saveConfig')(null, staleRendererConfig);
  await Promise.all([addPolicy, saveChecks]);
  let config = await api.getProtectionConfig();
  assert.equal(config.checks.speed, false, 'Concurrent policy mutation erased a protection-check save.');
  assert.deepEqual(plain(config.modPolicy.allowed), ['mousetweaks']);
  assert.deepEqual(plain(config.modPolicy.blocked), ['reach-hack', 'xray-helper']);

  await api.addModPolicyRule({ list: 'blocked', modId: 'mousetweaks' });
  policy = await api.getModPolicy();
  assert.deepEqual(plain(policy.modPolicy.allowed), [], 'Moving a mod to blocked left it in allowed.');
  assert.deepEqual(plain(policy.modPolicy.blocked), ['mousetweaks', 'reach-hack', 'xray-helper']);
  assert.equal(policy.modPolicy.enforceAllowlist, false);

  await api.addModPolicyRule({ list: 'blocked', modId: 'MouseTweaks' });
  policy = await api.getModPolicy();
  assert.equal(policy.modPolicy.blocked.filter((modId) => modId === 'mousetweaks').length, 1,
    'Adding the same policy rule was not idempotent.');

  for (const modId of ['mousetweaks', 'reach-hack', 'xray-helper']) {
    await api.removeModPolicyRule({ list: 'blocked', modId });
  }
  await api.removeModPolicyRule({ list: 'blocked', modId: 'mousetweaks' });
  policy = await api.getModPolicy();
  assert.deepEqual(plain(policy.modPolicy.allowed), []);
  assert.deepEqual(plain(policy.modPolicy.blocked), []);
  assert.equal(policy.modPolicy.enabled, false, 'Removing the final policy rule did not disable the policy.');
  assert.equal(policy.modPolicy.enforceAllowlist, false);

  await assert.rejects(
    api.addModPolicyRule({ list: 'unknown', modId: 'example' }),
    /allowed or blocked/i
  );
  await assert.rejects(
    api.addModPolicyRule({ list: 'blocked', modId: '../bad mod' }),
    /invalid mod id/i
  );
  await assert.rejects(
    api.removeModPolicyRule({ list: 'blocked', modId: '' }),
    /invalid mod id/i
  );
  await assert.rejects(
    api.addPlayerModException({ player: 'bad player', modId: 'mouse-tweaks', checks: [] }),
    /invalid player/i
  );
  await assert.rejects(
    api.addPlayerModException({ player: 'Alex', modId: 'custom-helper', checks: ['all'] }),
    /unknown protection check/i
  );
  await assert.rejects(
    api.addPlayerModException({ player: 'Alex', modId: 'custom-helper', checks: [] }),
    /at least one exact protection check/i
  );

  await api.addPlayerModException({ player: 'Alex', modId: 'mouse-tweaks', checks: [] });
  await api.addPlayerModException({ player: 'Alex', modId: 'clickinterval', checks: [] });
  config = await api.getProtectionConfig();
  const alex = config.compatibility.playerOverrides.alex;
  assert(alex, 'Alex compatibility rule was not saved.');
  assert.deepEqual(plain(alex.exemptChecks), ['combat.autoClicker', 'combat.clickPattern', 'abuse.inventorySpam']);
  assert.deepEqual(plain(alex.presets), ['click-interval-auto-clicker', 'mouse-tweaks']);
  assert.equal(Object.keys(config.compatibility.playerOverrides).length, 1,
    'A compatibility exception leaked to another player.');
  assert.equal(config.compatibility.playerOverrides.steve, undefined);
  assert.deepEqual(
    plain(config.compatibility.permissionOverrides['clickinterval.compat.inventory'].exemptChecks),
    ['abuse.inventorySpam'],
    'Adding a player exception erased a permission override.'
  );
  assert.equal(config.checks.speed, false, 'Adding compatibility exceptions erased check settings.');

  await api.addPlayerModException({ player: 'Steve', modId: 'custom-helper', checks: ['combat.reach'] });
  const removal = await ipcHandlers.get('protection:removePlayerModException')(null, { player: 'Alex' });
  assert(removal?.policy, 'Removing a player exception must return the UI policy shape.');
  config = await api.getProtectionConfig();
  assert.equal(config.compatibility.playerOverrides.alex, undefined, 'Removed player exception remained saved.');
  assert.deepEqual(
    plain(config.compatibility.playerOverrides.steve.exemptChecks),
    ['combat.reach'],
    'Removing one player exception erased another player.'
  );
  assert.deepEqual(
    plain(config.compatibility.permissionOverrides['clickinterval.compat.inventory'].exemptChecks),
    ['abuse.inventorySpam'],
    'Removing a player exception erased a permission override.'
  );

  const storedPath = path.join(profileRoot, 'click-interval-protection.json');
  let stored = JSON.parse(await fs.promises.readFile(storedPath, 'utf8'));
  assert.equal(stored.compatibility.playerOverrides.alex, undefined);
  assert.deepEqual(stored.compatibility.playerOverrides.steve.exemptChecks, ['combat.reach']);
  assert.equal(stored.modPolicy.enabled, false);

  // Exercise the largest valid rule counts with maximum metadata lengths. The resulting file is
  // intentionally larger than the old 256 KiB read limit but remains below the current 1 MiB cap.
  const bulkPlayers = {};
  const bulkPermissions = {};
  for (let index = 0; index < 511; index += 1) {
    const suffix = index.toString(36).padStart(6, '0');
    const rule = {
      name: `Rule ${suffix} ${'N'.repeat(50)}`,
      reason: 'R'.repeat(200),
      exemptChecks: ['combat.reach']
    };
    bulkPlayers[`p${suffix}`] = rule;
    bulkPermissions[`clickinterval.test.rule${suffix}`] = rule;
  }
  await api.saveProtectionConfig({
    compatibility: {
      playerOverrides: bulkPlayers,
      permissionOverrides: bulkPermissions
    }
  });
  const largeStat = await fs.promises.stat(storedPath);
  assert(largeStat.size > 256 * 1024, 'Max-valid fixture did not cross the former 256 KiB boundary.');
  assert(largeStat.size < 1024 * 1024, 'Max-valid fixture exceeded the bounded 1 MiB config limit.');
  config = await api.getProtectionConfig();
  assert.equal(Object.keys(config.compatibility.playerOverrides).length, 512);
  assert.equal(Object.keys(config.compatibility.permissionOverrides).length, 512);
  assert.deepEqual(plain(config.compatibility.playerOverrides.steve.exemptChecks), ['combat.reach']);
  assert.deepEqual(
    plain(config.compatibility.permissionOverrides['clickinterval.compat.inventory'].exemptChecks),
    ['abuse.inventorySpam']
  );
  stored = JSON.parse(await fs.promises.readFile(storedPath, 'utf8'));
  assert.equal(Object.keys(stored.compatibility.playerOverrides).length, 512);
  assert.equal(Object.keys(stored.compatibility.permissionOverrides).length, 512);

  // Managed Paper/Purpur profiles migrate both the default and safely discovered per-world
  // Anti-Xray ceilings before startup without replacing unrelated settings or comments.
  const paperConfigDir = path.join(profileRoot, 'config');
  const paperWorldRoot = path.join(profileRoot, 'world');
  const paperDimensionRoot = path.join(paperWorldRoot, 'dimensions', 'minecraft', 'overworld');
  const decoyRoot = path.join(profileRoot, 'plugins', 'not-a-world');
  await fs.promises.mkdir(paperConfigDir, { recursive: true });
  await fs.promises.mkdir(paperDimensionRoot, { recursive: true });
  await fs.promises.mkdir(decoyRoot, { recursive: true });
  await fs.promises.writeFile(path.join(paperWorldRoot, 'level.dat'), 'paper-world-marker');
  const paperDefaults = path.join(paperConfigDir, 'paper-world-defaults.yml');
  const paperWorldOverride = path.join(paperWorldRoot, 'paper-world.yml');
  const paperDimensionOverride = path.join(paperDimensionRoot, 'paper-world.yml');
  const decoyOverride = path.join(decoyRoot, 'paper-world.yml');
  await fs.promises.writeFile(paperDefaults,
    'anticheat:\n' +
    '  anti-xray:\n' +
    '    enabled: true # keep default comment\n' +
    '    max-block-height: 128 # old managed ceiling\n' +
    '    update-radius: 1\n' +
    'chunks:\n' +
    '  max-auto-save-chunks-per-tick: 12\n');
  await fs.promises.writeFile(paperWorldOverride,
    'anticheat:\n' +
    '  anti-xray:\n' +
    '    max-block-height: 64 # world override\n' +
    '    use-permission: true\n');
  await fs.promises.writeFile(paperDimensionOverride,
    'anticheat:\n' +
    '  anti-xray:\n' +
    '    max-block-height: 96 # dimension override\n' +
    '    custom-setting: preserve\n');
  await fs.promises.writeFile(decoyOverride,
    'anticheat:\n  anti-xray:\n    max-block-height: 32 # not inside a world directory\n');
  const paperPaths = await api.getPaths();
  const paperStartupContext = {
    profileSnapshot: { profileId: 'Protection-Test', paths: paperPaths },
    paths: paperPaths,
    serverConfig: { serverType: 'paper', serverVersion: '1.21.8', levelName: 'world' },
    platform: { minecraftVersion: '1.21.8' },
    revalidate: async () => true
  };
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-security.json'), '{}');
  const unmanagedPaperStartup = plain(await api.refreshManagedBundledProtectionBeforeStartUnlocked(paperStartupContext));
  assert.equal(unmanagedPaperStartup.configMigrated, false,
    'startup should not claim ownership of an unmanaged Paper Anti-Xray config');
  assert.match(await fs.promises.readFile(paperDefaults, 'utf8'), /^    max-block-height: 128 /m,
    'startup should leave an unmanaged Paper Anti-Xray ceiling untouched');
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-security.json'), JSON.stringify({
    antiXray: {
      enabled: true,
      engineMode: 3,
      includeAir: false,
      path: paperDefaults,
      appliedAt: new Date().toISOString()
    }
  }, null, 2));
  const paperStartupMigration = plain(await api.refreshManagedBundledProtectionBeforeStartUnlocked(paperStartupContext));
  assert.equal(paperStartupMigration.configMigrated, true);
  assert.deepEqual(paperStartupMigration.migratedConfigs.sort(), [
    'config/paper-world-defaults.yml',
    'world/dimensions/minecraft/overworld/paper-world.yml',
    'world/paper-world.yml'
  ]);
  assert.match(await fs.promises.readFile(paperDefaults, 'utf8'),
    /^    max-block-height: 320 # old managed ceiling$/m);
  assert.match(await fs.promises.readFile(paperDefaults, 'utf8'), /^    update-radius: 1$/m,
    'default migration should preserve unrelated managed settings');
  assert.match(await fs.promises.readFile(paperWorldOverride, 'utf8'),
    /^    max-block-height: 320 # world override$/m);
  assert.match(await fs.promises.readFile(paperWorldOverride, 'utf8'), /^    use-permission: true$/m,
    'world migration should preserve unrelated override settings');
  assert.match(await fs.promises.readFile(paperDimensionOverride, 'utf8'),
    /^    max-block-height: 320 # dimension override$/m);
  assert.match(await fs.promises.readFile(paperDimensionOverride, 'utf8'), /^    custom-setting: preserve$/m,
    'dimension migration should preserve unrelated override settings');
  assert.match(await fs.promises.readFile(decoyOverride, 'utf8'), /^    max-block-height: 32 /m,
    'migration should not scan arbitrary non-world directories');
  const repeatedPaperMigration = plain(await api.refreshManagedBundledProtectionBeforeStartUnlocked({
    ...paperStartupContext,
    serverConfig: { ...paperStartupContext.serverConfig, serverType: 'purpur' }
  }));
  assert.equal(repeatedPaperMigration.configMigrated, false,
    'repeating the managed Paper/Purpur migration should not rewrite current configs');
  assert.deepEqual(repeatedPaperMigration.migratedConfigs, []);

  // A verified Fabric 26.3 profile receives the real server mod plus its pinned Fabric API
  // dependency, with runtime data kept out of the Bukkit plugins folder.
  const serverJar = path.join(profileRoot, 'minecraft-server.jar');
  const serverBytes = Buffer.from('verified-fabric-26.3-server-fixture');
  await fs.promises.writeFile(serverJar, serverBytes);
  const serverSha256 = require('node:crypto').createHash('sha256').update(serverBytes).digest('hex');
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({
    serverType: 'fabric',
    serverVersion: '26.3',
    jarPath: serverJar,
    levelName: 'world'
  }, null, 2));
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-platform.json'), JSON.stringify({
    type: 'fabric',
    declaredType: 'fabric',
    minecraftVersion: '26.3',
    source: 'fabricmc',
    sha256: serverSha256,
    size: serverBytes.length,
    verified: true,
    installedAt: new Date().toISOString()
  }, null, 2));

  await api.saveProtectionConfig({
    layers: { antiXray: true, espMitigation: true },
    exemptions: { owners: true, admins: false, players: ['Steve'] },
    messages: { warning: { text: 'Fabric warning: {reason}', color: '#123456' } }
  });
  const installed = plain(await api.installBundledAntiCheat());
  assert.equal(installed.installed, true, installed.message);
  assert.equal(installed.ready, true, installed.message);
  const fabricProtection = path.join(profileRoot, 'mods', 'ServerProtection-Fabric.jar');
  const fabricApi = path.join(profileRoot, 'mods', 'fabric-api-0.161.0+26.3.jar');
  assert.equal((await fs.promises.stat(fabricProtection)).size, 533_365);
  assert.equal((await fs.promises.stat(fabricApi)).size, 2_620_967);
  assert.equal(fs.existsSync(path.join(profileRoot, 'plugins', 'ServerProtection.jar')), false);
  const fabricConfig = path.join(profileRoot, 'config', 'server-protection', 'config.yml');
  const installedFabricConfig = await fs.promises.readFile(fabricConfig, 'utf8');
  assert.match(installedFabricConfig, /wallHit: true/);
  for (const check of [
    'speed', 'flight', 'phase', 'invalidPosition', 'invalidRotation', 'groundSpoof', 'waterWalk', 'step', 'timer', 'noSlow',
    'reach', 'wallHit', 'autoClicker', 'multiTarget', 'aimDirection', 'killAura', 'clickPattern', 'criticals',
    'fastBreak', 'fastPlace', 'breakReach', 'placeReach', 'scaffold', 'multiBreak',
    'chatSpam', 'commandSpam', 'inventorySpam'
  ]) {
    assert.match(installedFabricConfig, new RegExp(`^\\s+${check}: (?:true|false)$`, 'm'),
      `managed Fabric config should render ${check}`);
  }
  for (const limit of [
    'maxBreaksPerSecond', 'maxPlacesPerSecond', 'maxChatPerFiveSeconds',
    'maxCommandsPerFiveSeconds', 'maxInventoryClicksPerSecond', 'maxAimDeviationDegrees',
    'rapidSwitchMillis', 'clickPatternSamples', 'blockReachAllowance'
  ]) {
    assert.match(installedFabricConfig, new RegExp(`^\\s+${limit}: \\d+(?:\\.\\d+)?$`, 'm'),
      `managed Fabric config should render ${limit}`);
  }
  assert.match(installedFabricConfig, /grace:[\s\S]*joinSeconds: 4[\s\S]*teleportSeconds: 3[\s\S]*velocitySeconds: 2/);
  assert.match(installedFabricConfig, /^messages:/m);
  assert.match(installedFabricConfig, /text: "Fabric warning: \{reason\}"/);
  assert.match(installedFabricConfig, /mitigations:[\s\S]*entityEsp:[\s\S]*enabled: false/,
    'PvP-safe managed config must never withhold player entities or nametags');
  assert.match(installedFabricConfig, /detection:[\s\S]*antiXray:[\s\S]*enabled: true/);
  assert.match(installedFabricConfig, /exemptions:[\s\S]*owners: true[\s\S]*admins: false[\s\S]*- "Steve"/);
  const fabricStatus = plain(await api.getBundledAntiCheatStatus());
  assert.equal(fabricStatus.adapterId, 'fabric-26.3');
  assert.equal(fabricStatus.kind, 'mods');
  assert.equal(fabricStatus.runtimeCompatible, true);
  assert.equal(fabricStatus.integrityVerified, true);
  assert.equal(fabricStatus.dependencyReady, true);
  assert.equal(fabricStatus.dependencyManaged, true);
  assert.equal(fabricStatus.ready, true);
  assert.equal(fabricStatus.antiXrayProviderId, 'meowantixray');
  assert.equal(fabricStatus.antiXrayProviderVersion, '1.7.0');
  assert.equal(fabricStatus.antiXrayNestedFile, 'meowantixray-fabric-1.7.0.jar');
  const fabricSecurity = plain(await api.getSecurityStatus());
  assert.equal(fabricSecurity.capabilities.espMitigationSupported, false);
  assert.equal(fabricSecurity.capabilities.antiXrayDetectionSupported, true);
  assert.equal(fabricSecurity.capabilities.antiXrayObfuscationSupported, true);
  assert.equal(fabricSecurity.capabilities.antiXrayMode, 'obfuscation');
  assert.equal(fabricSecurity.antiXray.mode, 'obfuscation');
  assert.equal(fabricSecurity.antiXray.supported, true);
  assert.equal(fabricSecurity.antiXray.configured, true);
  assert.equal(fabricSecurity.antiXray.active, false);
  assert.equal(fabricSecurity.antiXray.provider, 'meowantixray');
  assert.equal(fabricSecurity.antiXray.providerVersion, '1.7.0');
  assert.equal(fabricSecurity.antiXray.secondaryDetection, true);
  assert.equal(fabricSecurity.espMitigation.supported, false);
  assert.equal(fabricSecurity.espMitigation.configured, false);
  const securityMetadata = JSON.parse(await fs.promises.readFile(path.join(profileRoot, 'assembly-security.json'), 'utf8'));
  assert.equal(securityMetadata.builtInProtection.adapters.fabric_26_3.adapterId, 'fabric-26.3');

  const packetAntiXrayConfig = path.join(profileRoot, 'config', 'meowantixray.yml');
  const freshPacketAntiXrayText = await fs.promises.readFile(packetAntiXrayConfig, 'utf8');
  assert.match(freshPacketAntiXrayText, /^  enabled: true$/m,
    'install should synchronize the effective Fabric packet Anti-Xray toggle');
  assert.match(freshPacketAntiXrayText, /^  max-block-height: 320$/m,
    'fresh Fabric packet Anti-Xray config should cover the full supported Overworld build height');
  assert.match(freshPacketAntiXrayText, /^  engine-mode: 1$/m,
    'fresh Fabric packet Anti-Xray config should avoid the replacement-block allocation amplifier');
  assert.match(freshPacketAntiXrayText, /^  only-obfuscate-hidden-blocks: false$/m,
    'fresh Fabric packet Anti-Xray config should conceal cave-facing ores until a nearby reveal update');
  assert.match(freshPacketAntiXrayText, /^  guarantee-hide-all-hidden-blocks: true$/m,
    'fresh Fabric packet Anti-Xray config should cover every configured hidden ore');
  assert.match(freshPacketAntiXrayText, /^  max-blocks-per-chunk: 4096$/m,
    'fresh Fabric packet Anti-Xray config should have a hard per-chunk work ceiling');
  for (const dimension of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) {
    assert.match(freshPacketAntiXrayText,
      new RegExp(`^    ${dimension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[\\s\\S]*?^      max-block-height: 320$`, 'm'),
      `fresh Fabric packet Anti-Xray config should cover all supported heights in ${dimension}`);
  }
  await fs.promises.writeFile(packetAntiXrayConfig,
    '# retain provider tuning\n' +
    'anti-xray:\n' +
    '  enabled: true\n' +
    '  async-worker-threads: 1\n' +
    '  max-block-height: 64 # legacy provider default\n' +
    '  hidden-blocks:\n' +
    '    - minecraft:diamond_ore\n' +
    '  dimension-settings:\n' +
    '    overworld:\n' +
    '      max-block-height: 64 # missed mountain ores\n' +
    '      replacement-blocks:\n' +
    '        - minecraft:stone\n' +
    '    example:skylands:\n' +
    '      enabled: true\n' +
    '      max-block-height: 112\n' +
    '      hidden-blocks:\n' +
    '        - example:sky_ore\n');
  const startupPaths = await api.getPaths();
  const startupConfig = await api.readConfig(startupPaths);
  const startupPlatform = await api.getServerPlatformStatus(startupConfig, startupPaths);
  const startupRefresh = plain(await api.refreshManagedBundledProtectionBeforeStartUnlocked({
    profileSnapshot: { profileId: 'Protection-Test', paths: startupPaths },
    paths: startupPaths,
    serverConfig: startupConfig,
    platform: startupPlatform,
    revalidate: async () => true
  }));
  assert.equal(startupRefresh.reason, 'current');
  assert.equal(startupRefresh.configMigrated, true,
    'a current managed Fabric install should migrate its packet Anti-Xray config before startup');
  assert.match(await fs.promises.readFile(packetAntiXrayConfig, 'utf8'), /^  enabled: true$/m,
    'startup migration should retain the requested packet Anti-Xray state');
  await api.saveProtectionConfig({ layers: { antiXray: false } });
  let packetAntiXrayText = await fs.promises.readFile(packetAntiXrayConfig, 'utf8');
  assert.match(packetAntiXrayText, /^  enabled: false$/m);
  assert.match(packetAntiXrayText, /^  async-worker-threads: 3$/m,
    'manager should apply the bounded provider worker count when disabling packet Anti-Xray');
  assert.match(packetAntiXrayText, /^  max-block-height: 320 # legacy provider default$/m,
    'manager should migrate the provider global limit beyond the old Y=64 default');
  assert.match(packetAntiXrayText,
    /^    overworld:[\s\S]*?^      max-block-height: 320 # missed mountain ores$/m,
    'manager should migrate an existing Overworld alias without duplicating it');
  assert.match(packetAntiXrayText,
    /^    example:skylands:[\s\S]*?^      max-block-height: 320$/m,
    'manager should cover custom dimension overrides while preserving their settings');
  assert.match(packetAntiXrayText, /^        - example:sky_ore$/m,
    'manager should preserve custom hidden-block lists');
  for (const dimension of ['minecraft:the_nether', 'minecraft:the_end']) {
    assert.match(packetAntiXrayText,
      new RegExp(`^    ${dimension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[\\s\\S]*?^      max-block-height: 320$`, 'm'),
      `manager should add a missing managed range for ${dimension}`);
  }
  assert.equal((packetAntiXrayText.match(/max-block-height: 320/g) || []).length, 5,
    'migration should render exactly one full-height scalar globally and per existing/managed dimension');
  await api.saveProtectionConfig({ layers: { antiXray: true } });
  packetAntiXrayText = await fs.promises.readFile(packetAntiXrayConfig, 'utf8');
  assert.match(packetAntiXrayText, /^  enabled: true$/m);
  assert.match(packetAntiXrayText, /^  async-worker-threads: 3$/m,
    'manager should retain the bounded provider worker count when re-enabling packet Anti-Xray');
  assert.equal((packetAntiXrayText.match(/max-block-height: 320/g) || []).length, 5,
    'reapplying protection settings should not duplicate managed height ranges');

  await api.saveProtectionConfig({ checks: { wallHit: false, reach: true } });
  assert.match(await fs.promises.readFile(fabricConfig, 'utf8'), /wallHit: false/);
  assert.match(await fs.promises.readFile(fabricConfig, 'utf8'), /^messages:/m,
    'Fabric runtime config should retain its supported managed messages.');

  const offenseFile = path.join(profileRoot, 'config', 'server-protection', 'offenses.properties');
  await fs.promises.writeFile(offenseFile,
    '123e4567-e89b-12d3-a456-426614174000.name=Steve\n' +
    '123e4567-e89b-12d3-a456-426614174000.offenses=4\n' +
    '123e4567-e89b-12d3-a456-426614174000.permanentBan=true\n');
  assert.equal(await api.resetProtectionOffenseFile({
    protectionOffenses: path.join(profileRoot, 'plugins', 'ServerProtection', 'offenses.properties'),
    legacyProtectionOffenses: path.join(profileRoot, 'plugins', 'ClickIntervalAntiCheat', 'offenses.properties'),
    fabricProtectionOffenses: offenseFile
  }, 'Steve', '123e4567-e89b-12d3-a456-426614174000'), true);
  assert.match(await fs.promises.readFile(offenseFile, 'utf8'), /permanentBan=false/);

  const duplicateProtection = path.join(profileRoot, 'mods', 'Duplicate-Protection.jar');
  await fs.promises.copyFile(fabricProtection, duplicateProtection);
  const conflicted = plain(await api.getBundledAntiCheatStatus());
  assert.equal(conflicted.ready, false);
  assert.equal(conflicted.dependencyConflict, true);
  await fs.promises.rm(duplicateProtection, { force: true });

  // A foreign or damaged file at the reserved Fabric API path is an explicit
  // collision, not a falsely recoverable "missing dependency" state.
  const validFabricApiBackup = `${fabricApi}.test-backup`;
  await fs.promises.rename(fabricApi, validFabricApiBackup);
  try {
    await fs.promises.writeFile(fabricApi, Buffer.from('not-a-fabric-api-jar'));
    const occupiedDependency = plain(await api.getBundledAntiCheatStatus());
    assert.equal(occupiedDependency.ready, false);
    assert.equal(occupiedDependency.dependencyReady, false);
    assert.equal(occupiedDependency.dependencyConflict, true);
    assert.match(occupiedDependency.message, /conflicting Server Protection or Fabric API/i);
  } finally {
    await fs.promises.rm(fabricApi, { force: true });
    await fs.promises.rename(validFabricApiBackup, fabricApi);
  }

  // The same managed installer selects the exact 26.2 adapter and dependency pins when the
  // verified profile targets 26.2. Remove the prior fixture's managed files to model a clean
  // version migration; the production installer deliberately does not delete old mods itself.
  await fs.promises.rm(fabricProtection, { force: true });
  await fs.promises.rm(fabricApi, { force: true });
  const server26_2Bytes = Buffer.from('verified-fabric-26.2-server-fixture');
  await fs.promises.writeFile(serverJar, server26_2Bytes);
  const server26_2Sha256 = require('node:crypto').createHash('sha256').update(server26_2Bytes).digest('hex');
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-config.json'), JSON.stringify({
    serverType: 'fabric',
    serverVersion: '26.2',
    jarPath: serverJar,
    levelName: 'world'
  }, null, 2));
  await fs.promises.writeFile(path.join(profileRoot, 'assembly-platform.json'), JSON.stringify({
    type: 'fabric',
    declaredType: 'fabric',
    minecraftVersion: '26.2',
    source: 'fabricmc',
    sha256: server26_2Sha256,
    size: server26_2Bytes.length,
    verified: true,
    installedAt: new Date().toISOString()
  }, null, 2));

  const installed26_2 = plain(await api.installBundledAntiCheat());
  assert.equal(installed26_2.installed, true, installed26_2.message);
  assert.equal(installed26_2.ready, true, installed26_2.message);
  const fabric26_2Api = path.join(profileRoot, 'mods', 'fabric-api-0.161.0+26.2.jar');
  assert.equal((await fs.promises.stat(fabricProtection)).size, 541_481);
  assert.equal(
    require('node:crypto').createHash('sha256').update(await fs.promises.readFile(fabricProtection)).digest('hex'),
    '6fe8b964350a10cd98f05535bd9f22a43f8c398060c1db70b706db24dcd0b6dd'
  );
  assert.equal((await fs.promises.stat(fabric26_2Api)).size, 2_566_123);
  assert.equal(fs.existsSync(fabricApi), false);
  const fabric26_2Status = plain(await api.getBundledAntiCheatStatus());
  assert.equal(fabric26_2Status.adapterId, 'fabric-26.2');
  assert.equal(fabric26_2Status.minecraftVersion, '26.2');
  assert.equal(fabric26_2Status.runtimeCompatible, true);
  assert.equal(fabric26_2Status.integrityVerified, true);
  assert.equal(fabric26_2Status.dependencyReady, true);
  assert.equal(fabric26_2Status.dependencyManaged, true);
  assert.equal(fabric26_2Status.ready, true);
  assert.equal(fabric26_2Status.antiXrayProviderId, 'meowantixray');
  assert.equal(fabric26_2Status.antiXrayProviderVersion, '1.6.3');
  assert.equal(fabric26_2Status.antiXrayNestedFile, 'meowantixray-fabric-1.6.3.jar');
  assert.deepEqual(fabric26_2Status.supportedMinecraftVersions, ['26.2', '26.3']);
  const securityMetadata26_2 = JSON.parse(
    await fs.promises.readFile(path.join(profileRoot, 'assembly-security.json'), 'utf8')
  );
  assert.equal(securityMetadata26_2.builtInProtection.adapters.fabric_26_2.adapterId, 'fabric-26.2');
}

run()
  .then(() => {
    console.log('PASS Minecraft server protection integration tests');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const safeTarget = assertSafeTemporaryPath(testUserData);
    await fs.promises.rm(safeTarget, { recursive: true, force: true });
  });
