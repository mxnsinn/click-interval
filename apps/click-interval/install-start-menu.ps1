$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath('D:\Codex-Projects\OPMouseHotkeyElectron')
$launcherBuilder = Join-Path $projectRoot 'build-branded-launcher.js'
& node $launcherBuilder
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Click Interval launcher.' }
$installedRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'work\installed\current'))
$assetRoot = [System.IO.Path]::GetFullPath((Join-Path $installedRoot 'assets'))

$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$visibleShortcutName = 'Click Interval V 1.5.lnk'
$newShortcutPath = Join-Path $programs $visibleShortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($newShortcutPath)
$shortcut.TargetPath = Join-Path $projectRoot 'node_modules\electron\dist\Click Interval.exe'
$shortcut.Arguments = '"D:\Codex-Projects\OPMouseHotkeyElectron\work\installed\current" --click-interval-launch'
$shortcut.WorkingDirectory = $installedRoot
$shortcut.IconLocation = (Join-Path $assetRoot 'toolbox-icon.ico') + ',0'
$shortcut.Description = 'Click Interval V 1.5'
$shortcut.Save()
[System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null
[System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null

$refresh = Get-Command ie4uinit.exe -ErrorAction SilentlyContinue
if ($refresh) {
  & $refresh.Source -ClearIconCache
  & $refresh.Source -show
}

Write-Output $newShortcutPath
