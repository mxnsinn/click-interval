param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\artifacts'),
  [string]$UpdatePrivateKey = $env:CI_UPDATE_PRIVATE_KEY
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceApp = Join-Path $repo 'editions\auto-macro\app'
$output = [IO.Path]::GetFullPath($OutputRoot)
if (-not $output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build output must remain inside the repository artifacts directory.'
}

$package = Get-Content -Raw (Join-Path $sourceApp 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$stage = Join-Path $output 'auto-macro-stage'
$portable = Join-Path $output 'Click-Interval-win-x64'
$archive = Join-Path $output "Click-Interval-$version-win-x64.zip"

foreach ($path in @($stage, $portable)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }

Copy-Item -Path (Join-Path $sourceApp '*') -Destination $stage -Recurse -Force

$pythonVersion = '3.13.15'
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$pythonSha256 = 'd1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf'
$pythonArchive = Join-Path $output "python-$pythonVersion-embed-amd64.zip"
Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonArchive
$actualPythonHash = (Get-FileHash -LiteralPath $pythonArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualPythonHash -ne $pythonSha256) { throw "Python runtime checksum mismatch: $actualPythonHash" }
Expand-Archive -LiteralPath $pythonArchive -DestinationPath (Join-Path $stage 'runtime') -Force

if ([string]::IsNullOrWhiteSpace($UpdatePrivateKey)) {
  throw 'CI_UPDATE_PRIVATE_KEY is required to create the application integrity record.'
}
$ownerRoot = Join-Path $output 'owner-private'
New-Item -ItemType Directory -Force -Path $ownerRoot | Out-Null
$privateKeyPath = Join-Path $ownerRoot 'friend-update-private-key.pem'
[IO.File]::WriteAllText($privateKeyPath, $UpdatePrivateKey, [Text.Encoding]::ASCII)
$config = Get-Content -Raw (Join-Path $stage 'update-config.json') | ConvertFrom-Json
$channel = [ordered]@{
  channel = [string]$config.channel
  manifestUrl = [string]$config.manifestUrl
  privateKeyPath = $privateKeyPath
}
$channel | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ownerRoot 'channel.json') -Encoding utf8
& node (Join-Path $repo 'scripts\sign-integrity.js') --app-root $stage --owner-root $ownerRoot
if ($LASTEXITCODE -ne 0) { throw 'Application integrity signing failed.' }

$electron = Join-Path $repo 'node_modules\electron\dist'
if (-not (Test-Path -LiteralPath (Join-Path $electron 'electron.exe'))) {
  & node (Join-Path $repo 'node_modules\electron\install.js')
}
if (-not (Test-Path -LiteralPath (Join-Path $electron 'electron.exe'))) { throw 'Run npm ci before building.' }
Copy-Item -Path (Join-Path $electron '*') -Destination $portable -Recurse -Force
$defaultApp = Join-Path $portable 'resources\default_app.asar'
if (Test-Path -LiteralPath $defaultApp) { Remove-Item -LiteralPath $defaultApp -Force }
Copy-Item -LiteralPath $stage -Destination (Join-Path $portable 'resources\app') -Recurse -Force
Move-Item -LiteralPath (Join-Path $portable 'electron.exe') -Destination (Join-Path $portable 'Click Interval.exe') -Force
& node (Join-Path $repo 'scripts\set-metadata.js') (Join-Path $portable 'Click Interval.exe') (Join-Path $stage 'package.json') (Join-Path $stage 'assets\toolbox-icon.ico')
if ($LASTEXITCODE -ne 0) { throw 'Executable metadata update failed.' }

Compress-Archive -LiteralPath $portable -DestinationPath $archive -CompressionLevel Optimal
Write-Output $archive
