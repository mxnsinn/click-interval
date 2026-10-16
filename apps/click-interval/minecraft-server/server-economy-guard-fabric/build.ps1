$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradle = Join-Path $project '..\proximity-voice\fabric-client\gradlew.bat'
& $gradle -p $project --no-daemon test build
if ($LASTEXITCODE -ne 0) { throw 'Server Economy Guard build failed.' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project 'dist\ServerEconomyGuard-Fabric-1.0.0+mc26.2.jar')
