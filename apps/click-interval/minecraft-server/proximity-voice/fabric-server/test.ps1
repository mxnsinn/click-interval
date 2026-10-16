$ErrorActionPreference = 'Stop'
$gradleWrapper = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\fabric-client\gradlew.bat'))
if (-not (Test-Path -LiteralPath $gradleWrapper -PathType Leaf)) {
  throw 'The shared Fabric Gradle wrapper is missing.'
}
& $gradleWrapper -p $PSScriptRoot clean test --no-daemon
if ($LASTEXITCODE -ne 0) { throw "Fabric voice server tests failed with exit code $LASTEXITCODE." }
