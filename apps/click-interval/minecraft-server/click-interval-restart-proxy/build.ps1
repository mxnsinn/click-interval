$ErrorActionPreference = 'Stop'

$ProjectRoot = $PSScriptRoot
$Gradle = Join-Path $ProjectRoot 'gradlew.bat'

if (-not (Test-Path -LiteralPath $Gradle -PathType Leaf)) {
    throw "Gradle wrapper not found: $Gradle"
}

& $Gradle -p $ProjectRoot --no-daemon clean build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Artifact = Join-Path $ProjectRoot 'dist\ClickIntervalRestartProxy-1.0.2.jar'
if (-not (Test-Path -LiteralPath $Artifact -PathType Leaf)) {
    throw "Release artifact was not produced: $Artifact"
}

Get-FileHash -Algorithm SHA256 -LiteralPath $Artifact
