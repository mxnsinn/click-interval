$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Gradle = Join-Path $ProjectRoot '..\proximity-voice\fabric-client\gradlew.bat'

if (-not (Test-Path -LiteralPath $Gradle -PathType Leaf)) {
    throw "Gradle wrapper not found: $Gradle"
}

& $Gradle -p $ProjectRoot --no-daemon clean test build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Artifact = Join-Path $ProjectRoot 'dist\ServerTeleport-Fabric-1.8.2+mc26.2.jar'
if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) {
    throw "Release artifact was not produced: $Artifact"
}

Get-FileHash -Algorithm SHA256 -LiteralPath $Artifact
