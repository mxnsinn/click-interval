$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradle = Join-Path $project '..\proximity-voice\fabric-client\gradlew.bat'
& $gradle -p $project --no-daemon test build
if ($LASTEXITCODE -ne 0) { throw 'Server Villager Trades build failed.' }
$versionLine = Get-Content -LiteralPath (Join-Path $project 'gradle.properties') | Where-Object { $_ -match '^mod_version=' }
if (@($versionLine).Count -ne 1) { throw 'Expected exactly one mod_version.' }
$releaseVersion = ($versionLine -split '=', 2)[1].Trim()
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project "dist\ServerVillagerTrades-Fabric-$releaseVersion+mc26.2.jar")
