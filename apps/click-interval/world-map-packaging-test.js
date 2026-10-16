'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const builder = fs.readFileSync(path.join(root, 'build-development-update.ps1'), 'utf8');
function block(start, end) {
  const from = builder.indexOf(start); const to = builder.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing builder section ${start}`);
  return builder.slice(from, to);
}
const helpers = block('# PACKAGING_HARDENING_HELPERS_BEGIN', '# PACKAGING_HARDENING_HELPERS_END');
const cleanup = block('$releaseOnlyBuildDirectories = @(', '# Trade Assistant is retired.');
const iconCleanup = block('# MAP_ICON_RUNTIME_ONLY_BEGIN', '# MAP_ICON_RUNTIME_ONLY_END');
assert.match(builder, /Copy-Item -LiteralPath \(Join-Path \$sourceRoot 'assets'\) -Destination \(Join-Path \$destination 'assets'\) -Recurse -Force/);
assert.match(builder, /Copy-DevelopmentUpdateTree -SourceDirectory \(Join-Path \$sourceRoot 'minecraft-server'\)[\s\S]*?-ExcludeMinecraftServerTransientDirectories/);
const icons = ['spawn', 'mineshaft', 'stronghold', 'village', 'mansion', 'monument', 'ancient_city', 'trial_chambers', 'outpost', 'fortress', 'bastion', 'end_city', 'ruined_portal', 'desert_pyramid', 'jungle_pyramid', 'shipwreck', 'buried_treasure', 'igloo', 'swamp_hut', 'ocean_ruin', 'trail_ruins'];
const files = [
  'world-map.js', 'world-map.html', 'world-map.css', 'world-map-preload.js',
  'minecraft-server/world-map-data.js', 'minecraft-server/seed-preview.js',
  'minecraft-server/seed-preview/seed-preview.jar', 'minecraft-server/seed-preview/log4j2.xml',
  ...icons.map(name => `assets/map-icons/${name}.png`)
];
const work = path.join(root, 'work', 'live-map-improvement');
fs.mkdirSync(work, { recursive: true });
const fixture = fs.mkdtempSync(path.join(work, 'packaging-test-'));
const source = path.join(fixture, 'source'); const staged = path.join(fixture, 'staged');
for (const relative of files) {
  const input = path.join(root, relative); const target = path.join(source, relative);
  assert(fs.existsSync(input), `Missing runtime input ${relative}`);
  assert(!builder.includes(`'${relative}'`) || relative.startsWith('world-map'), `Unexpected runtime deletion entry ${relative}`);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(input, target);
}
for (const relative of ['sources/private-original.png', 'prompts.json', 'export-icons.ps1']) {
  const target = path.join(source, 'assets', 'map-icons', relative);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'development-only fixture');
}
const script = path.join(fixture, 'stage-map.ps1');
fs.writeFileSync(script, [
  "$ErrorActionPreference = 'Stop'", helpers,
  '$sourceRoot = [System.IO.Path]::GetFullPath($env:CI_MAP_PACKAGING_SOURCE)',
  '$destination = [System.IO.Path]::GetFullPath($env:CI_MAP_PACKAGING_STAGE)',
  'New-Item -ItemType Directory -Path $destination -Force | Out-Null',
  "Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets') -Destination (Join-Path $destination 'assets') -Recurse -Force",
  iconCleanup,
  "Copy-DevelopmentUpdateTree -SourceDirectory (Join-Path $sourceRoot 'minecraft-server') -DestinationDirectory (Join-Path $destination 'minecraft-server') -ExcludeMinecraftServerTransientDirectories",
  "foreach ($file in @('world-map.js','world-map.html','world-map.css','world-map-preload.js')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $destination $file) }",
  cleanup,
  '$files = @(Get-ValidatedDevelopmentUpdateFiles -StagedRoot $destination)',
  'Write-Output $files.Count'
].join('\n'));
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
  encoding: 'utf8', cwd: root,
  env: { ...process.env, CI_MAP_PACKAGING_SOURCE: source, CI_MAP_PACKAGING_STAGE: staged }, timeout: 30_000
});
assert.equal(result.status, 0, result.stderr || result.stdout);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const verified = files.map(relative => {
  assert.equal(hash(path.join(staged, relative)), hash(path.join(root, relative)), `Staged bytes changed ${relative}`);
  return { path: relative, sha256: hash(path.join(staged, relative)) };
});
for (const relative of ['sources', 'prompts.json', 'export-icons.ps1']) {
  assert(!fs.existsSync(path.join(staged, 'assets', 'map-icons', relative)), `Development asset leaked into runtime: ${relative}`);
  assert(fs.existsSync(path.join(source, 'assets', 'map-icons', relative)), `Source asset must remain untouched: ${relative}`);
}
const receipt = { passed: true, files: verified, iconCount: icons.length, builderChanged: true, developmentIconInputsExcluded: true,
  actualCopyAndValidationHelpersExercised: true, liveServerTouched: false, updatePublished: false };
fs.writeFileSync(path.join(work, 'map-packaging.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ passed: true, runtimeFilesVerified: files.length, iconCount: icons.length, developmentIconInputsExcluded: true, updatePublished: false }));
