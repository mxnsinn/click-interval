$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("proximity-voice-tests-" + [guid]::NewGuid().ToString('N'))
$Classes = Join-Path $TempRoot 'classes'

function Assert-Tool([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Install a JDK 21 or newer and try again."
    }
}

try {
    Assert-Tool 'javac'
    Assert-Tool 'java'
    New-Item -ItemType Directory -Force -Path $Classes | Out-Null
    $CoreSources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src/main/java/dev/proximityvoice/core') -Filter '*.java' | ForEach-Object FullName
    $PluginUtilitySources = @(
        (Join-Path $ProjectRoot 'src/main/java/dev/proximityvoice/plugin/VoiceRelayServer.java'),
        (Join-Path $ProjectRoot 'src/main/java/dev/proximityvoice/plugin/RelayLifecycle.java')
    )
    $TestSources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src/test/java') -Recurse -Filter '*.java' | ForEach-Object FullName
    $Sources = @($CoreSources) + $PluginUtilitySources + @($TestSources)
    & javac --release 21 -encoding UTF-8 -d $Classes $Sources
    if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
    & java -ea -cp $Classes dev.proximityvoice.core.AllTests
    if ($LASTEXITCODE -ne 0) { throw "Tests failed with exit code $LASTEXITCODE" }

    # This compiles every production source (including the Bukkit plugin and
    # VoiceConfig) with integrity-pinned APIs, then proves dist is that exact build.
    & (Join-Path $ProjectRoot 'build.ps1') -VerifyOnly
    if ($LASTEXITCODE -ne 0) { throw "Artifact verification failed with exit code $LASTEXITCODE" }
}
finally {
    $ResolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $ResolvedTarget = [System.IO.Path]::GetFullPath($TempRoot)
    if ($ResolvedTarget.StartsWith($ResolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $ResolvedTarget)) {
        Remove-Item -LiteralPath $ResolvedTarget -Recurse -Force
    }
}
