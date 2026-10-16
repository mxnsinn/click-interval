$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $project '..\proximity-voice\fabric-client\gradlew.bat') -p $project --no-daemon test build
if ($LASTEXITCODE -ne 0) { throw 'Server Teams build failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project 'dist\ServerTeams-Fabric-1.0.5+mc26.2.jar')
