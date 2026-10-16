$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Gradle = Join-Path $ProjectRoot '..\proximity-voice\fabric-client\gradlew.bat'

if (-not (Test-Path -LiteralPath $Gradle -PathType Leaf)) {
    throw "Gradle wrapper not found: $Gradle"
}

& $Gradle -p $ProjectRoot --no-daemon test
exit $LASTEXITCODE
