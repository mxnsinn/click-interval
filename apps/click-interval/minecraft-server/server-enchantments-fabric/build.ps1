$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$gradle = Join-Path $project '..\proximity-voice\fabric-client\gradlew.bat'
& $gradle -p $project --no-daemon clean test build
if ($LASTEXITCODE -ne 0) { throw 'Server Enchantments build failed.' }
$version = (Get-Content -LiteralPath (Join-Path $project 'gradle.properties') | Where-Object { $_ -match '^mod_version=' }) -replace '^mod_version=', ''
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $project "dist\ServerEnchantments-Fabric-$version+mc26.2.jar")
