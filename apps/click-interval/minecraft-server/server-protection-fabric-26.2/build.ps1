$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradle = Join-Path $project '..\proximity-voice\fabric-client\gradlew.bat'
if (-not (Test-Path -LiteralPath $gradle -PathType Leaf)) {
    throw "Gradle wrapper not found: $gradle"
}

& $gradle -p $project --no-daemon clean test build
if ($LASTEXITCODE -ne 0) { throw "Server Protection Fabric 26.2 build failed." }

$artifact = Join-Path $project 'dist\ServerProtection-Fabric-1.4.6+mc26.2.jar'
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Build completed without the expected artifact: $artifact"
}
$fabricApi = Join-Path $project 'dist\fabric-api-0.161.0+26.2.jar'
if (-not (Test-Path -LiteralPath $fabricApi -PathType Leaf)) {
    throw "Build completed without the pinned Fabric API runtime dependency: $fabricApi"
}
Get-FileHash -Algorithm SHA256 -LiteralPath $artifact, $fabricApi
