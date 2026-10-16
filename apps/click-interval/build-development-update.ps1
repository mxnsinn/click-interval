param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$Notes = 'A new Click Interval update is ready.'
)

$ErrorActionPreference = 'Stop'

# PACKAGING_HARDENING_HELPERS_BEGIN
$forbiddenFreshAnimationsFilename = 'FreshAnimations_v1.10.5.zip'
$forbiddenFreshAnimationsSha256 = 'cf9f17a2977e171b33cb0b598bc4357dd0383e09c10d5f768ff17c12d0a028ee'
$forbiddenDownloadedClientArtifactSha256 = @(
  '26b13c2ee755932e74f80ecf6baf16a25582568ae7482cf472751abb98e7b14a', # EMF 3.3.11 for Fabric 26.2
  'ac66cf294fbd2b1eb1576bdc2396cb096abcd54d9f8f39ecb1973abbc4e00488'  # ETF 7.2.5 for Fabric 26.2
)

function Test-IsTransientMinecraftServerDirectoryName {
  param([Parameter(Mandatory = $true)][string]$Name)

  $normalized = $Name.Trim().ToLowerInvariant()
  if ($normalized -in @('pending-mods', 'client-exports', 'queue', 'queues', 'export', 'exports', 'incomplete')) {
    return $true
  }
  return $normalized -match '(^|[._-])(queue|queues|export|exports|incomplete)([._-]|$)'
}

function Get-DevelopmentUpdateSha256 {
  param([Parameter(Mandatory = $true)][string]$LiteralPath)

  $stream = $null
  $hasher = $null
  try {
    $stream = [System.IO.File]::OpenRead([System.IO.Path]::GetFullPath($LiteralPath))
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($hasher) {
      $hasher.Dispose()
    }
    if ($stream) {
      $stream.Dispose()
    }
  }
}

function Copy-DevelopmentUpdateTree {
  param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$DestinationDirectory,
    [switch]$ExcludeMinecraftServerTransientDirectories
  )

  $source = [System.IO.Path]::GetFullPath($SourceDirectory)
  $targetRoot = [System.IO.Path]::GetFullPath($DestinationDirectory)
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Missing release directory: $source"
  }
  if ($targetRoot.StartsWith($source + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'A release directory cannot be copied into itself.'
  }
  New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

  foreach ($item in Get-ChildItem -LiteralPath $source -Force) {
    if ($ExcludeMinecraftServerTransientDirectories -and $item.PSIsContainer -and
        (Test-IsTransientMinecraftServerDirectoryName -Name $item.Name)) {
      continue
    }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Release input contains a link or reparse point: $($item.FullName)"
    }
    $target = [System.IO.Path]::GetFullPath((Join-Path $targetRoot $item.Name))
    if (-not $target.StartsWith($targetRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Release input escaped its destination: $($item.FullName)"
    }
    if ($item.PSIsContainer) {
      Copy-DevelopmentUpdateTree -SourceDirectory $item.FullName -DestinationDirectory $target `
        -ExcludeMinecraftServerTransientDirectories:$ExcludeMinecraftServerTransientDirectories
    } elseif ($item -is [System.IO.FileInfo]) {
      Copy-Item -LiteralPath $item.FullName -Destination $target -Force
    } else {
      throw "Release input is not a regular file or directory: $($item.FullName)"
    }
  }
}

function Get-ValidatedDevelopmentUpdateFiles {
  param(
    [Parameter(Mandatory = $true)][string]$StagedRoot,
    [string[]]$ApprovedSourceBuiltClientBinaryPaths = @(),
    [string[]]$AdditionalForbiddenSha256 = @()
  )

  $root = [System.IO.Path]::GetFullPath($StagedRoot)
  if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw "The staged update directory is missing: $root"
  }
  $rootItem = Get-Item -LiteralPath $root -Force
  if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The staged update directory cannot be a link or reparse point.'
  }

  $minecraftServerRoot = Join-Path $root 'minecraft-server'
  if (Test-Path -LiteralPath $minecraftServerRoot -PathType Container) {
    $unsafeDirectory = Get-ChildItem -LiteralPath $minecraftServerRoot -Directory -Recurse -Force |
      Where-Object { Test-IsTransientMinecraftServerDirectoryName -Name $_.Name } |
      Select-Object -First 1
    if ($unsafeDirectory) {
      $unsafeRelative = $unsafeDirectory.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
      throw "The staged update contains a transient Minecraft server directory: $unsafeRelative"
    }
  }

  $linkedEntry = Get-ChildItem -LiteralPath $root -Recurse -Force |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
    Select-Object -First 1
  if ($linkedEntry) {
    throw "The staged update contains a link or reparse point: $($linkedEntry.FullName)"
  }

  $approvedPaths = @{}
  foreach ($approvedPath in $ApprovedSourceBuiltClientBinaryPaths) {
    $normalizedApprovedPath = ([string]$approvedPath).Trim().TrimStart('\', '/').Replace('\', '/').ToLowerInvariant()
    if (-not $normalizedApprovedPath -or $normalizedApprovedPath.Contains('../') -or
        [System.IO.Path]::IsPathRooted([string]$approvedPath)) {
      throw "Invalid approved source-built client artifact path: $approvedPath"
    }
    $approvedPaths[$normalizedApprovedPath] = $true
  }

  $forbiddenHashes = @{}
  $forbiddenHashes[$forbiddenFreshAnimationsSha256] = 'Fresh Animations 1.10.5'
  foreach ($hash in $forbiddenDownloadedClientArtifactSha256) {
    $forbiddenHashes[$hash] = 'downloaded EMF/ETF client binary'
  }
  foreach ($hash in $AdditionalForbiddenSha256) {
    $normalizedHash = ([string]$hash).Trim().ToLowerInvariant()
    if ($normalizedHash -notmatch '^[a-f0-9]{64}$') {
      throw "Invalid additional forbidden SHA256: $hash"
    }
    $forbiddenHashes[$normalizedHash] = 'test-forbidden binary payload'
  }

  Get-ChildItem -LiteralPath $root -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
    $relativePath = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
    $normalizedRelativePath = $relativePath.ToLowerInvariant()
    $sha256 = Get-DevelopmentUpdateSha256 -LiteralPath $_.FullName
    if ([string]::Equals($_.Name, $forbiddenFreshAnimationsFilename, [System.StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($sha256, $forbiddenFreshAnimationsSha256, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "The staged update must not contain the Fresh Animations downloadable ZIP: $relativePath"
    }

    $looksLikeDownloadedClientBinary = $_.Name -match '(?i)^entity[-_](model|texture)[-_]features(?:[-_.].*)?\.jar$'
    $matchesForbiddenClientBinary = $forbiddenDownloadedClientArtifactSha256 -contains $sha256
    if (($looksLikeDownloadedClientBinary -or $matchesForbiddenClientBinary) -and
        -not $approvedPaths.ContainsKey($normalizedRelativePath)) {
      throw "The staged update contains an unapproved downloadable EMF/ETF client binary: $relativePath"
    }
    if ($forbiddenHashes.ContainsKey($sha256) -and
        -not [string]::Equals($sha256, $forbiddenFreshAnimationsSha256, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $matchesForbiddenClientBinary) {
      throw "The staged update contains a forbidden binary payload: $relativePath"
    }

    [ordered]@{
      path = $relativePath
      size = $_.Length
      sha256 = $sha256
    }
  }
}
# PACKAGING_HARDENING_HELPERS_END

$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$sourcePackagePath = Join-Path $sourceRoot 'package.json'
if (-not (Test-Path -LiteralPath $sourcePackagePath -PathType Leaf)) {
  throw 'The source package.json is missing.'
}
$sourcePackage = Get-Content -LiteralPath $sourcePackagePath -Raw | ConvertFrom-Json
$sourcePackageVersion = [string]$sourcePackage.version
if (-not [string]::Equals($Version, $sourcePackageVersion, [System.StringComparison]::Ordinal)) {
  throw "Update version '$Version' must match package.json version '$sourcePackageVersion'."
}
$updatesRoot = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot 'work\updates'))
$destination = [System.IO.Path]::GetFullPath((Join-Path $updatesRoot $Version))
$latest = Join-Path $updatesRoot 'latest'
if (-not $destination.StartsWith($updatesRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The update destination is outside the project update directory.'
}

if (Test-Path -LiteralPath $destination) {
  Remove-Item -LiteralPath $destination -Recurse -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null

$releaseFiles = @(
  'area-picker.html', 'area-picker.js', 'area-picker-preload.js', 'backend.py',
  'point-picker.html', 'point-picker.js', 'point-picker-preload.js', 'bootstrap.js', 'update-lock.js',
  'dropdown-window.js', 'dropdown.css', 'dropdown.html', 'hover-hint.html', 'hover-hint-window.js',
  'hotkey-window.js', 'hotkey.html',
  'crosshair-draw.js', 'crosshair-motion.js', 'crosshair-overlay.js', 'crosshair-overlay.html', 'crosshair-preload.js',
  'crosshair-preview.js', 'crosshair-preview.html', 'crosshair-preview-preload.js',
  'index.html', 'localization.js', 'main.js', 'macro-codec.js', 'update-download.js', 'update-manifest.js',
  'macro-delete-window.js', 'macro-delete.html',
  'macro-name-window.js', 'macro-name.html',
  'macro-unsaved-window.js', 'macro-unsaved.html',
  'message-window.js', 'message.html',
  'motd-editor.js', 'motd-editor.html', 'motd-editor.css',
  'player-inspector.js', 'player-inspector-data.js', 'player-inspector.html', 'player-inspector.css',
  'player-role-editor.js', 'player-role-editor.html', 'player-role-editor.css',
  'settings-window.js', 'settings.html', 'settings.css', 'active-indicator.html',
  'cps-indicator.html', 'cps-indicator-preload.js', 'input-display.html', 'input-display-preload.js',
  'settings-unsaved-window.js', 'settings-unsaved.html', 'theme-loader.js', 'theme.css',
  'package.json', 'package-lock.json', 'popup.css', 'preload.js',
  'renderer.js', 'minecraft-server-ui.js', 'server-console.html', 'server-console.js', 'server-console.css', 'chat-history.html', 'chat-history.js', 'chat-history.css',
  'world-map.html', 'world-map.js', 'world-map.css', 'world-map-preload.js',
  'splash.html', 'styles.css', 'voice-processor.js',
  'update-config.json', 'beta-access.json',
  'updater-main.js', 'updater-preload.js', 'updater-renderer.js', 'updater.html', 'updater.css',
  'updater-error-renderer.js', 'updater-error.html', 'updater-error.css',
  'EULA.txt'
)

# Development updates are applied over the existing installation instead of replacing its
# directory wholesale. Keep this list explicit so artifacts retired from the source tree are
# also removed from installations that received an older release.
$obsoleteInstalledFiles = @(
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
  'runtime/winsound.pyd'
)

foreach ($relativePath in $releaseFiles) {
  $source = Join-Path $sourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relativePath" }
  $target = Join-Path $destination $relativePath
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($target)) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets') -Destination (Join-Path $destination 'assets') -Recurse -Force
# MAP_ICON_RUNTIME_ONLY_BEGIN
# Generated originals and local prompt/export metadata are development inputs,
# not runtime dependencies. Keep the small transparent marker PNGs in updates.
$mapIconReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $destination 'assets\map-icons'))
if (-not $mapIconReleaseRoot.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The map icon release directory is outside the staged update.'
}
foreach ($developmentMapIconEntry in @('sources', 'prompts.json', 'export-icons.ps1')) {
  $developmentMapIconPath = [System.IO.Path]::GetFullPath((Join-Path $mapIconReleaseRoot $developmentMapIconEntry))
  if (-not $developmentMapIconPath.StartsWith($mapIconReleaseRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'A map icon development input escaped the staged icon directory.'
  }
  if (Test-Path -LiteralPath $developmentMapIconPath) {
    Remove-Item -LiteralPath $developmentMapIconPath -Recurse -Force
  }
}
# MAP_ICON_RUNTIME_ONLY_END
Copy-DevelopmentUpdateTree -SourceDirectory (Join-Path $sourceRoot 'minecraft-server') `
  -DestinationDirectory (Join-Path $destination 'minecraft-server') `
  -ExcludeMinecraftServerTransientDirectories

# These surfaces are being developed independently. Package each one automatically once it
# exists, without making an older checkout unable to produce an otherwise valid update.
$optionalReleaseFiles = @(
  'entity-viewer.html',
  'entity-viewer.css',
  'entity-viewer.js',
  'entity-viewer-preload.js'
)
foreach ($relativePath in $optionalReleaseFiles) {
  $source = Join-Path $sourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
  $target = Join-Path $destination $relativePath
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($target)) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

# Build caches are useful to developers but are not runtime dependencies. In particular,
# the Fabric Gradle cache can be larger than the complete application update.
$releaseOnlyBuildDirectories = @(
  'minecraft-server\click-interval-map-fabric\.gradle',
  'minecraft-server\click-interval-map-fabric\build',
  'minecraft-server\click-interval-map-fabric\logs',
  'minecraft-server\click-interval-restart-proxy\.gradle',
  'minecraft-server\click-interval-restart-proxy\build',
  'minecraft-server\click-interval-restart-proxy\logs',
  'minecraft-server\proximity-voice\fabric-client\.gradle',
  'minecraft-server\proximity-voice\fabric-client\build',
  'minecraft-server\proximity-voice\fabric-server\.gradle',
  'minecraft-server\proximity-voice\fabric-server\build',
  'minecraft-server\proximity-voice\fabric-server\logs',
  'minecraft-server\server-protection-fabric\.gradle',
  'minecraft-server\server-protection-fabric\build',
  'minecraft-server\server-protection-fabric\logs',
  'minecraft-server\server-protection-fabric-26.2\.gradle',
  'minecraft-server\server-protection-fabric-26.2\build',
  'minecraft-server\server-protection-fabric-26.2\logs',
  'minecraft-server\server-protection-client-fabric\.gradle',
  'minecraft-server\server-protection-client-fabric\build',
  'minecraft-server\server-protection-client-fabric\logs',
  'minecraft-server\server-protection-client-fabric-26.2\.gradle',
  'minecraft-server\server-protection-client-fabric-26.2\build',
  'minecraft-server\server-protection-client-fabric-26.2\logs',
  'minecraft-server\server-teleport-fabric\.gradle',
  'minecraft-server\server-teleport-fabric\build',
  'minecraft-server\server-teleport-fabric\logs',
  'minecraft-server\server-enchantments-fabric\.gradle',
  'minecraft-server\server-enchantments-fabric\build',
  'minecraft-server\server-enchantments-fabric\logs',
  'minecraft-server\server-bounties-fabric\.gradle',
  'minecraft-server\server-bounties-fabric\build',
  'minecraft-server\server-bounties-fabric\logs',
  'minecraft-server\server-villager-trades-fabric\.gradle',
  'minecraft-server\server-villager-trades-fabric\build',
  'minecraft-server\server-villager-trades-fabric\logs',
  'minecraft-server\death-loot-fabric\.gradle',
  'minecraft-server\death-loot-fabric\build',
  'minecraft-server\death-loot-fabric\logs',
  'minecraft-server\server-trade-assistant-fabric\.gradle',
  'minecraft-server\server-trade-assistant-fabric\build',
  'minecraft-server\server-trade-assistant-fabric\logs'
)
foreach ($relativeDirectory in $releaseOnlyBuildDirectories) {
  $releaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $destination $relativeDirectory))
  if (-not $releaseDirectory.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a release cache outside the update directory: $relativeDirectory"
  }
  if (Test-Path -LiteralPath $releaseDirectory -PathType Container) {
    Remove-Item -LiteralPath $releaseDirectory -Recurse -Force
  }
}

# Trade Assistant is retired. The source may remain in a developer checkout for history, but
# no runtime bridge, client artifact, generated icon, or module directory belongs in updates.
$retiredTradeAssistantReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $destination 'minecraft-server\server-trade-assistant-fabric'))
if (-not $retiredTradeAssistantReleaseRoot.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The retired Trade Assistant release directory is outside the update directory.'
}
if (Test-Path -LiteralPath $retiredTradeAssistantReleaseRoot -PathType Container) {
  Remove-Item -LiteralPath $retiredTradeAssistantReleaseRoot -Recurse -Force
}
Remove-Item -LiteralPath (Join-Path $destination 'minecraft-server\trade-assistant-control.js') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $destination 'minecraft-server\renderer\assets\server-trade-assistant-generated.png') -Force -ErrorAction SilentlyContinue

# Only the backend-pinned Teleport Requests artifact belongs in a release. Older generated
# distributables may still exist in a developer checkout and can expose retired commands.
$obsoleteTeleportArtifacts = @(
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.4.0+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.5.0+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.0+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.1+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.2+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.3+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.4+mc26.2.jar',
  'minecraft-server\server-teleport-fabric\dist\ServerTeleport-Fabric-1.6.5+mc26.2.jar'
)
foreach ($relativeFile in $obsoleteTeleportArtifacts) {
  $releaseFile = [System.IO.Path]::GetFullPath((Join-Path $destination $relativeFile))
  if (-not $releaseFile.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an obsolete artifact outside the update directory: $relativeFile"
  }
  Remove-Item -LiteralPath $releaseFile -Force -ErrorAction SilentlyContinue
}

# Keep only the provider version pinned by the managed Fabric 26.2 protection bundle.
$obsoleteProtectionProviderArtifacts = @(
  'minecraft-server\server-protection-fabric-26.2\lib\meowantixray-fabric-1.6.2.jar',
  'minecraft-server\server-protection-fabric-26.2\dist\ServerProtection-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server\server-protection-fabric-26.2\dist\ServerProtection-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server\server-protection-fabric-26.2\dist\ServerProtection-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server\server-protection-fabric-26.2\dist\ServerProtection-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server\server-protection-fabric-26.2\dist\ServerProtection-Fabric-1.3.1+mc26.2.jar',
  'minecraft-server\server-protection-fabric\dist\ServerProtection-Fabric-1.0.0+mc26.3.jar',
  'minecraft-server\server-protection-fabric\dist\ServerProtection-Fabric-1.1.0+mc26.3.jar',
  'minecraft-server\server-protection-fabric\dist\ServerProtection-Fabric-1.2.0+mc26.3.jar',
  'minecraft-server\server-protection-client-fabric-26.2\dist\ServerProtection-Companion-Fabric-1.0.0+mc26.2.jar',
  'minecraft-server\server-protection-client-fabric-26.2\dist\ServerProtection-Companion-Fabric-1.1.0+mc26.2.jar',
  'minecraft-server\server-protection-client-fabric-26.2\dist\ServerProtection-Companion-Fabric-1.2.0+mc26.2.jar',
  'minecraft-server\server-protection-client-fabric-26.2\dist\ServerProtection-Companion-Fabric-1.3.0+mc26.2.jar',
  'minecraft-server\server-protection-client-fabric-26.2\dist\ServerProtection-Companion-Fabric-1.3.1+mc26.2.jar',
  'minecraft-server\server-protection-client-fabric\dist\ServerProtection-Companion-Fabric-1.0.0+mc26.3.jar',
  'minecraft-server\server-protection-client-fabric\dist\ServerProtection-Companion-Fabric-1.1.0+mc26.3.jar',
  'minecraft-server\server-protection-client-fabric\dist\ServerProtection-Companion-Fabric-1.2.0+mc26.3.jar',
  'minecraft-server\server-protection-client-fabric\dist\ServerProtection-Companion-Fabric-1.3.0+mc26.3.jar',
  'minecraft-server\server-protection-client-fabric\dist\ServerProtection-Companion-Fabric-1.3.1+mc26.3.jar'
)
foreach ($relativeFile in $obsoleteProtectionProviderArtifacts) {
  $releaseFile = [System.IO.Path]::GetFullPath((Join-Path $destination $relativeFile))
  if (-not $releaseFile.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an obsolete protection provider outside the update directory: $relativeFile"
  }
  Remove-Item -LiteralPath $releaseFile -Force -ErrorAction SilentlyContinue
}

# The backend uses only ctypes and Python's bundled standard-library archive.
# Keep the release runtime self-contained without shipping unused SSL, SQLite,
# networking, XML, asyncio, and compression extension modules.
$runtimeDestination = Join-Path $destination 'runtime'
New-Item -ItemType Directory -Path $runtimeDestination -Force | Out-Null
$requiredRuntimeFiles = @(
  'python.exe', 'python3.dll', 'python313.dll', 'python313.zip', 'python313._pth',
  '_ctypes.pyd', 'libffi-8.dll', 'vcruntime140.dll', 'vcruntime140_1.dll',
  'LICENSE.txt', 'python.cat'
)
foreach ($runtimeFile in $requiredRuntimeFiles) {
  $runtimeSource = Join-Path (Join-Path $sourceRoot 'runtime') $runtimeFile
  if (-not (Test-Path -LiteralPath $runtimeSource -PathType Leaf)) {
    throw "Missing required click-engine runtime file: $runtimeFile"
  }
  Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $runtimeDestination $runtimeFile) -Force
}
& (Join-Path $runtimeDestination 'python.exe') -B -c "import ctypes, json, os, random, sys, threading, time"
if ($LASTEXITCODE -ne 0) { throw 'The optimized click-engine runtime failed its import smoke test.' }

foreach ($relativeFile in $obsoleteInstalledFiles) {
  $releaseFile = [System.IO.Path]::GetFullPath((Join-Path $destination $relativeFile))
  if (-not $releaseFile.StartsWith($destination + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an obsolete installed artifact outside the update directory: $relativeFile"
  }
  Remove-Item -LiteralPath $releaseFile -Force -ErrorAction SilentlyContinue
}

# Development updates keep polling the stable local channel after installation.
# Production packaging replaces this with the remote HTTPS-only configuration.
$localUpdateConfigPath = Join-Path $destination 'update-config.json'
$localUpdateConfig = Get-Content -LiteralPath $localUpdateConfigPath -Raw | ConvertFrom-Json
$localUpdateConfig.stagedUpdatePath = $latest
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($localUpdateConfigPath, ($localUpdateConfig | ConvertTo-Json), $utf8NoBom)

# Third-party downloads belong in the explicit client-export flow, never in an application
# update. Keep this allowlist empty unless a future client artifact is built from source as
# part of Click Interval and has a reviewed, project-owned release path.
$approvedSourceBuiltClientBinaryPaths = @()
$files = @(Get-ValidatedDevelopmentUpdateFiles -StagedRoot $destination `
  -ApprovedSourceBuiltClientBinaryPaths $approvedSourceBuiltClientBinaryPaths)
$manifest = [ordered]@{
  version = $Version
  notes = $Notes
  manualOnly = $true
  publishedAt = [DateTimeOffset]::UtcNow.ToString('o')
  files = @($files)
  removeFiles = @(
    'owner-console-main.js', 'owner-console-preload.js', 'owner-console.html',
    'owner-console.css', 'owner-console.js',
    'minecraft-server/click-interval-anticheat/dist/ClickIntervalAntiCheat.jar',
    'minecraft-server/assets/ClickIntervalAntiCheat.jar',
    'minecraft-server/ClickIntervalAntiCheat.jar',
    'minecraft-server/trade-assistant-control.js',
    'minecraft-server/renderer/assets/server-trade-assistant-generated.png'
  ) + @($obsoleteInstalledFiles)
}
[System.IO.File]::WriteAllText((Join-Path $destination 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 4), $utf8NoBom)

# Publish through one stable channel path. The installed app polls this path,
# so releasing a new version makes its update icon appear without replacing or
# restarting the running application.
$latestNext = Join-Path $updatesRoot 'latest.next'
if (Test-Path -LiteralPath $latestNext) {
  Remove-Item -LiteralPath $latestNext -Recurse -Force
}
Copy-Item -LiteralPath $destination -Destination $latestNext -Recurse -Force
if (Test-Path -LiteralPath $latest) {
  Remove-Item -LiteralPath $latest -Recurse -Force
}
Move-Item -LiteralPath $latestNext -Destination $latest

Write-Output $destination
