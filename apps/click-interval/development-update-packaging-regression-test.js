const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = __dirname;
const buildScriptPath = path.join(projectRoot, 'build-development-update.ps1');
const buildScript = fs.readFileSync(buildScriptPath, 'utf8');
const blockBetween = (startMarker, endMarker) => {
  const start = buildScript.indexOf(startMarker);
  const end = buildScript.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `Could not find build-script block ${startMarker}`);
  return buildScript.slice(start, end);
};

const releaseFilesBlock = blockBetween('$releaseFiles = @(', 'foreach ($relativePath in $releaseFiles)');
const releaseCacheCleanupBlock = blockBetween('$releaseOnlyBuildDirectories = @(', '# Trade Assistant is retired.');
const newServerMods = [
  {
    directory: 'server-bounties-fabric',
    source: 'src/main/java/com/clickinterval/bounties/ServerBounties.java',
    artifact: 'dist/ServerBounties-Fabric-1.1.1+mc26.2.jar',
  },
  {
    directory: 'server-enchantments-fabric',
    source: 'src/main/java/dev/serverenchantments/fabric/ServerEnchantmentsFabric.java',
    artifact: 'dist/ServerEnchantments-Fabric-1.3.1+mc26.2.jar',
  },
  {
    directory: 'server-villager-trades-fabric',
    source: 'src/main/java/com/clickinterval/villagertrades/ServerVillagerTrades.java',
    artifact: 'dist/ServerVillagerTrades-Fabric-1.3.2+mc26.2.jar',
  },
];
assert(releaseFilesBlock.includes("'localization.js'"), 'localization.js must be included in every staged release');
assert(releaseFilesBlock.includes("'update-lock.js'"), 'the shared update lock must be included in every staged release');
for (const relativeDirectory of [
  'minecraft-server\\click-interval-map-fabric\\.gradle',
  'minecraft-server\\click-interval-map-fabric\\build',
  'minecraft-server\\click-interval-map-fabric\\logs',
  'minecraft-server\\click-interval-restart-proxy\\.gradle',
  'minecraft-server\\click-interval-restart-proxy\\build',
  'minecraft-server\\click-interval-restart-proxy\\logs'
]) {
  assert(buildScript.includes(`'${relativeDirectory}'`), `Build output must be excluded from releases: ${relativeDirectory}`);
}
for (const mod of newServerMods) {
  for (const directory of ['.gradle', 'build', 'logs']) {
    const relativeDirectory = `minecraft-server\\${mod.directory}\\${directory}`;
    assert(releaseCacheCleanupBlock.includes(`'${relativeDirectory}'`),
      `New server mod build output must be pruned from releases: ${relativeDirectory}`);
  }
}

for (const relativePath of ['entity-viewer.html', 'entity-viewer.css', 'entity-viewer.js', 'entity-viewer-preload.js']) {
  assert(buildScript.includes(`'${relativePath}'`), `Missing optional release entry: ${relativePath}`);
}
const optionalBlock = buildScript.slice(buildScript.indexOf('$optionalReleaseFiles'), buildScript.indexOf('foreach ($relativePath in $optionalReleaseFiles)'));
assert(!optionalBlock.includes('trade-assistant-control.js'), 'retired bridge must not be copied as an optional release file');
assert.match(buildScript, /Trade Assistant is retired\.[\s\S]*?Remove-Item -LiteralPath \$retiredTradeAssistantReleaseRoot -Recurse -Force/);
assert.match(buildScript, /server-trade-assistant-generated\.png'\) -Force -ErrorAction SilentlyContinue/);
assert(!buildScript.includes('$tradeAssistantReleaseFiles'), 'retired Trade Assistant allowlist must be removed');

const expectedObsoleteInstalledFiles = [
  'area-picker.ps1',
  'minecraft-server/server-villager-trades-fabric/dist/ServerVillagerTrades-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-villager-trades-fabric/dist/ServerVillagerTrades-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/server-villager-trades-fabric/dist/ServerVillagerTrades-Fabric-1.1.1+mc26.2.jar',
  'minecraft-server/server-villager-trades-fabric/dist/ServerVillagerTrades-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server/server-villager-trades-fabric/dist/ServerVillagerTrades-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server/server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.0.1+mc26.2.jar',
  'minecraft-server/server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.0.2+mc26.2.jar',
  'minecraft-server/server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/server-enchantments-fabric/dist/ServerEnchantments-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server/click-interval-anticheat/src/main/java/com/clickinterval/anticheat/EntityEspMitigation.java',
  'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.1.1+mc26.2.jar',
  'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.1.2+mc26.2.jar',
  'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.1.3+mc26.2.jar',
  'minecraft-server/proximity-voice/fabric-server/dist/ProximityVoice-Fabric-Server-1.0.0+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.3.1+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.0.0+mc26.3.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.1.0+mc26.3.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.2.0+mc26.3.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.3.0+mc26.3.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.3.1+mc26.3.jar',
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.3.1+mc26.2.jar',
  'minecraft-server/server-protection-fabric-26.2/lib/meowantixray-fabric-1.6.0.jar',
  'minecraft-server/server-protection-fabric-26.2/lib/meowantixray-fabric-1.6.1.jar',
  'minecraft-server/server-protection-fabric/dist/ServerProtection-Fabric-1.0.0+mc26.3.jar',
  'minecraft-server/server-protection-fabric/dist/ServerProtection-Fabric-1.1.0+mc26.3.jar',
  'minecraft-server/server-protection-fabric/dist/ServerProtection-Fabric-1.2.0+mc26.3.jar',
  'minecraft-server/server-protection-fabric/src/main/java/dev/serverprotection/fabric/mixin/ChunkMapAccessor.java',
  'minecraft-server/server-protection-fabric/src/main/java/dev/serverprotection/fabric/mixin/TrackedEntityInvoker.java',
  'minecraft-server/server-protection-fabric/src/main/java/dev/serverprotection/fabric/mixin/TrackedEntityMixin.java',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.4.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.5.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.0+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.1+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.2+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.3+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.4+mc26.2.jar',
  'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.5+mc26.2.jar',
  'minecraft-server/server-trade-assistant-fabric/dist/ServerTradeAssistant-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server/server-trade-assistant-fabric/README.md',
  'minecraft-server/server-trade-assistant-fabric/src/main/resources/assets/tradeassistant/icon.png',
  'minecraft-server/trade-assistant-control-test.js',
  'runtime/_asyncio.pyd',
  'runtime/_bz2.pyd',
  'runtime/_decimal.pyd',
  'runtime/_elementtree.pyd',
  'runtime/_hashlib.pyd',
  'runtime/_lzma.pyd',
  'runtime/_multiprocessing.pyd',
  'runtime/_overlapped.pyd',
  'runtime/_queue.pyd',
  'runtime/_socket.pyd',
  'runtime/_sqlite3.pyd',
  'runtime/_ssl.pyd',
  'runtime/_uuid.pyd',
  'runtime/_wmi.pyd',
  'runtime/_zoneinfo.pyd',
  'runtime/libcrypto-3.dll',
  'runtime/libssl-3.dll',
  'runtime/pyexpat.pyd',
  'runtime/pythonw.exe',
  'runtime/select.pyd',
  'runtime/sqlite3.dll',
  'runtime/unicodedata.pyd',
  'runtime/winsound.pyd',
];
const obsoleteBlock = blockBetween('$obsoleteInstalledFiles = @(', 'foreach ($relativePath in $releaseFiles)');
const obsoletePaths = [...obsoleteBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.deepStrictEqual(obsoletePaths, expectedObsoleteInstalledFiles, 'obsolete installed-file cleanup must remain explicit and complete');
for (const preservedPath of ['localization.js', 'release-channel.json', '__pycache__/backend.cpython-313.pyc', 'work/live-backend-state.json']) {
  assert(!obsoletePaths.includes(preservedPath), `installation-local or required file must be preserved: ${preservedPath}`);
}
for (const currentProtectionArtifact of [
  'minecraft-server/server-protection-fabric-26.2/dist/ServerProtection-Fabric-1.3.3+mc26.2.jar',
  'minecraft-server/server-protection-fabric/dist/ServerProtection-Fabric-1.3.0+mc26.3.jar',
  'minecraft-server/server-protection-client-fabric-26.2/dist/ServerProtection-Companion-Fabric-1.3.2+mc26.2.jar',
  'minecraft-server/server-protection-client-fabric/dist/ServerProtection-Companion-Fabric-1.3.2+mc26.3.jar'
]) {
  assert(!obsoletePaths.includes(currentProtectionArtifact), `current protection artifact must not be removed from installed updates: ${currentProtectionArtifact}`);
  assert(fs.existsSync(path.join(projectRoot, currentProtectionArtifact)), `current protection artifact is missing: ${currentProtectionArtifact}`);
}
const currentMapArtifact = 'minecraft-server/click-interval-map-fabric/dist/ClickIntervalMap-Fabric-1.1.4+mc26.2.jar';
assert(!obsoletePaths.includes(currentMapArtifact), 'the current native map artifact must remain in installed updates');
assert(fs.existsSync(path.join(projectRoot, currentMapArtifact)), 'the current native map artifact is missing');
const serverMain = fs.readFileSync(path.join(projectRoot, 'minecraft-server/main.js'), 'utf8');
assert(serverMain.includes(`const NATIVE_WORLD_MAP_ARTIFACT = '${path.basename(currentMapArtifact)}';`),
  'server startup and release packaging must pin the same current native map artifact');
const currentTeleportArtifact = 'minecraft-server/server-teleport-fabric/dist/ServerTeleport-Fabric-1.6.6+mc26.2.jar';
assert(!obsoletePaths.includes(currentTeleportArtifact), 'the current Teleport artifact must remain in installed updates');
assert(fs.existsSync(path.join(projectRoot, currentTeleportArtifact)), 'the current Teleport artifact is missing');
const obsoleteProtectionBlock = blockBetween('$obsoleteProtectionProviderArtifacts = @(', 'foreach ($relativeFile in $obsoleteProtectionProviderArtifacts)');
assert(obsoleteProtectionBlock.includes('server-protection-fabric-26.2\\dist\\ServerProtection-Fabric-1.3.0+mc26.2.jar') &&
  obsoleteProtectionBlock.includes('server-protection-fabric-26.2\\dist\\ServerProtection-Fabric-1.3.1+mc26.2.jar'),
  'release pruning must remove superseded Fabric 26.2 server artifacts');
for (const version of ['1.3.0', '1.3.1']) {
  assert(obsoleteProtectionBlock.includes(`server-protection-client-fabric-26.2\\dist\\ServerProtection-Companion-Fabric-${version}+mc26.2.jar`) &&
    obsoleteProtectionBlock.includes(`server-protection-client-fabric\\dist\\ServerProtection-Companion-Fabric-${version}+mc26.3.jar`),
    `release pruning must remove superseded Companion ${version} artifacts for both supported versions`);
}
assert(!obsoleteProtectionBlock.includes('ServerProtection-Fabric-1.3.2+mc26.2.jar') &&
  !obsoleteProtectionBlock.includes('ServerProtection-Fabric-1.3.0+mc26.3.jar') &&
  !obsoleteProtectionBlock.includes('ServerProtection-Companion-Fabric-1.3.2'),
  'release pruning must retain the current server and POV Companion artifacts');
assert.match(buildScript, /removeFiles = @\([\s\S]*?\) \+ @\(\$obsoleteInstalledFiles\)/,
  'the update manifest must remove every explicitly obsolete installed file');
assert.match(buildScript, /foreach \(\$relativeFile in \$obsoleteInstalledFiles\)[\s\S]*?Remove-Item -LiteralPath \$releaseFile/,
  'the staged release must also prune explicitly obsolete files');

const hardeningHelpers = blockBetween('# PACKAGING_HARDENING_HELPERS_BEGIN', '# PACKAGING_HARDENING_HELPERS_END');
const officialFreshAnimationsSha256 = 'cf9f17a2977e171b33cb0b598bc4357dd0383e09c10d5f768ff17c12d0a028ee';
assert(hardeningHelpers.includes(officialFreshAnimationsSha256),
  'the official Fresh Animations SHA256 must be forbidden in staged updates');
assert.match(buildScript,
  /Copy-DevelopmentUpdateTree[\s\S]*?-ExcludeMinecraftServerTransientDirectories/,
  'minecraft-server must be copied through the transient-directory filter');
assert.match(buildScript,
  /Get-ValidatedDevelopmentUpdateFiles -StagedRoot \$destination/,
  'every staged update must pass the forbidden-payload audit before publication');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'click-interval-packaging-regression-'));
const helperScriptPath = path.join(temporaryRoot, 'packaging-hardening-helpers.ps1');
fs.writeFileSync(helperScriptPath, [
  "$ErrorActionPreference = 'Stop'",
  hardeningHelpers,
  '& ([scriptblock]::Create($env:CI_PACKAGING_TEST_COMMAND))',
].join('\n'));

const runHelper = (command, environment = {}) => spawnSync('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-File', helperScriptPath,
], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, ...environment, CI_PACKAGING_TEST_COMMAND: command },
});

try {
  const copySource = path.join(temporaryRoot, 'copy-source');
  const copyDestination = path.join(temporaryRoot, 'copy-destination');
  fs.mkdirSync(path.join(copySource, 'safe', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(copySource, 'safe', 'nested', 'kept.txt'), 'safe');
  for (const mod of newServerMods) {
    for (const relativeFile of [mod.source, mod.artifact, 'src/main/resources/fabric.mod.json']) {
      const source = path.join(projectRoot, 'minecraft-server', mod.directory, relativeFile);
      const fixture = path.join(copySource, 'minecraft-server', mod.directory, relativeFile);
      assert(fs.existsSync(source), `Required new server mod release input is missing: ${source}`);
      assert(!obsoletePaths.includes(`minecraft-server/${mod.directory}/${relativeFile}`),
        `Required new server mod release input must not be retired: ${source}`);
      fs.mkdirSync(path.dirname(fixture), { recursive: true });
      fs.copyFileSync(source, fixture);
    }
    for (const directory of ['.gradle', 'build', 'logs']) {
      const fixture = path.join(copySource, 'minecraft-server', mod.directory, directory, 'nested', 'transient.bin');
      fs.mkdirSync(path.dirname(fixture), { recursive: true });
      fs.writeFileSync(fixture, 'not a runtime dependency');
    }
  }
  for (const transientPath of [
    ['pending-mods', 'queues', 'queue-state.json'],
    ['nested', 'client-exports', 'bundle.zip'],
    ['nested', 'queue', 'queued.jar'],
    ['nested', 'export', 'exported.jar'],
    ['nested', 'bundle.incomplete-123', 'partial.zip'],
  ]) {
    const fixture = path.join(copySource, ...transientPath);
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(fixture, 'transient');
  }
  const filteredCopy = runHelper(
    [
      'Copy-DevelopmentUpdateTree -SourceDirectory $env:CI_SOURCE -DestinationDirectory $env:CI_DESTINATION -ExcludeMinecraftServerTransientDirectories',
      '$destination = [System.IO.Path]::GetFullPath($env:CI_DESTINATION)',
      releaseCacheCleanupBlock,
    ].join('\n'),
    { CI_SOURCE: copySource, CI_DESTINATION: copyDestination });
  assert.strictEqual(filteredCopy.status, 0,
    `transient-filter copy failed:\n${filteredCopy.stderr || filteredCopy.stdout}`);
  assert(fs.existsSync(path.join(copyDestination, 'safe', 'nested', 'kept.txt')),
    'normal minecraft-server files must still be copied');
  for (const mod of newServerMods) {
    for (const relativeFile of [mod.source, mod.artifact, 'src/main/resources/fabric.mod.json']) {
      assert.deepStrictEqual(
        fs.readFileSync(path.join(copyDestination, 'minecraft-server', mod.directory, relativeFile)),
        fs.readFileSync(path.join(copySource, 'minecraft-server', mod.directory, relativeFile)),
        `New server mod source/dist content must remain intact after staging: ${mod.directory}/${relativeFile}`);
    }
    for (const directory of ['.gradle', 'build', 'logs']) {
      assert(!fs.existsSync(path.join(copyDestination, 'minecraft-server', mod.directory, directory)),
        `New server mod transient output leaked into the staged release: ${mod.directory}/${directory}`);
    }
  }
  for (const forbiddenDirectory of [
    path.join(copyDestination, 'pending-mods'),
    path.join(copyDestination, 'nested', 'client-exports'),
    path.join(copyDestination, 'nested', 'queue'),
    path.join(copyDestination, 'nested', 'export'),
    path.join(copyDestination, 'nested', 'bundle.incomplete-123'),
  ]) {
    assert(!fs.existsSync(forbiddenDirectory), `transient directory was copied: ${forbiddenDirectory}`);
  }

  const normalStage = path.join(temporaryRoot, 'normal-stage');
  fs.mkdirSync(path.join(normalStage, 'minecraft-server', 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(normalStage, 'minecraft-server', 'safe.js'), 'module.exports = true;');
  fs.writeFileSync(path.join(normalStage, 'minecraft-server', 'manifests', 'client-artifacts.json'), JSON.stringify({
    filename: 'FreshAnimations_v1.10.5.zip',
    sha256: officialFreshAnimationsSha256,
    dependencies: ['entity_model_features-3.3.11-26.2-fabric.jar', 'entity_texture_features-7.2.5-26.2-fabric.jar'],
  }));
  const normalAudit = runHelper(
    '$files = @(Get-ValidatedDevelopmentUpdateFiles -StagedRoot $env:CI_STAGE); Write-Output $files.Count',
    { CI_STAGE: normalStage });
  assert.strictEqual(normalAudit.status, 0,
    `normal staged payload or manifest text was incorrectly blocked:\n${normalAudit.stderr || normalAudit.stdout}`);

  const forbiddenCases = [
    {
      name: 'transient export directory',
      relativePath: ['minecraft-server', 'nested', 'client-exports', 'bundle.zip'],
      contents: 'transient',
      expected: /transient Minecraft server directory/i,
    },
    {
      name: 'Fresh Animations filename',
      relativePath: ['minecraft-server', 'cache', 'FreshAnimations_v1.10.5.zip'],
      contents: 'renamed-or-unverified-pack',
      expected: /must not contain the Fresh Animations downloadable ZIP/i,
    },
    {
      name: 'EMF downloadable filename',
      relativePath: ['minecraft-server', 'cache', 'entity_model_features-3.3.11-26.2-fabric.jar'],
      contents: 'unapproved-third-party-client-binary',
      expected: /unapproved downloadable EMF\/ETF client binary/i,
    },
  ];
  for (const fixture of forbiddenCases) {
    const stage = path.join(temporaryRoot, `forbidden-${fixture.name.replace(/[^a-z]+/gi, '-').toLowerCase()}`);
    const file = path.join(stage, ...fixture.relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fixture.contents);
    const result = runHelper('Get-ValidatedDevelopmentUpdateFiles -StagedRoot $env:CI_STAGE | Out-Null', { CI_STAGE: stage });
    assert.notStrictEqual(result.status, 0, `${fixture.name} must hard-fail the staged payload audit`);
    assert(fixture.expected.test(`${result.stderr}\n${result.stdout}`),
      `${fixture.name} failed for the wrong reason:\n${result.stderr || result.stdout}`);
  }

  const renamedHashStage = path.join(temporaryRoot, 'forbidden-renamed-hash');
  const renamedHashFile = path.join(renamedHashStage, 'minecraft-server', 'cache', 'innocent-looking.bin');
  const renamedHashBytes = Buffer.from('hash-policy-regression-fixture');
  const renamedHash = crypto.createHash('sha256').update(renamedHashBytes).digest('hex');
  fs.mkdirSync(path.dirname(renamedHashFile), { recursive: true });
  fs.writeFileSync(renamedHashFile, renamedHashBytes);
  const renamedHashAudit = runHelper(
    'Get-ValidatedDevelopmentUpdateFiles -StagedRoot $env:CI_STAGE -AdditionalForbiddenSha256 @($env:CI_FORBIDDEN_HASH) | Out-Null',
    { CI_STAGE: renamedHashStage, CI_FORBIDDEN_HASH: renamedHash });
  assert.notStrictEqual(renamedHashAudit.status, 0, 'renamed forbidden payload hashes must hard-fail');
  assert.match(`${renamedHashAudit.stderr}\n${renamedHashAudit.stdout}`, /forbidden binary payload/i);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const escapedBuildScriptPath = buildScriptPath.replace(/'/g, "''");
const parseCommand = [
  '$tokens = $null',
  '$parseErrors = $null',
  `[System.Management.Automation.Language.Parser]::ParseFile('${escapedBuildScriptPath}', [ref]$tokens, [ref]$parseErrors) | Out-Null`,
  'if ($parseErrors.Count -gt 0) { $parseErrors | ForEach-Object { Write-Error $_.Message }; exit 1 }',
].join('; ');
const parseResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parseCommand], {
  cwd: projectRoot,
  encoding: 'utf8',
});
assert.strictEqual(parseResult.status, 0, `PowerShell parser rejected build-development-update.ps1:\n${parseResult.stderr || parseResult.stdout}`);

console.log(JSON.stringify({
  passed: true,
  obsoleteInstalledFiles: expectedObsoleteInstalledFiles.length,
  localizationPackaged: true,
  tradeAssistant: 'retired',
  newServerMods: 'sources and dist retained; build/cache/logs pruned',
  transientMinecraftServerDirectories: 'filtered',
  forbiddenClientDownloads: 'audited'
}));
