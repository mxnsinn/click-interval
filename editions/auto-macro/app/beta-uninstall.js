'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { minimalChildEnvironment } = require('./process-environment');

function canonicalInstallRoot() {
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData ? path.resolve(localAppData, 'Programs', 'Click Interval Auto Macro') : '';
}

function supportedInstalledCopy(applicationPath, executablePath) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const compare = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const variants = [
    { installRoot: canonicalInstallRoot(), executableName: 'Click Interval.exe' },
    // Compatibility only: v1.5.143 installs update in place and therefore keep
    // their original private install directory and executable filename.
    { installRoot: path.resolve(localAppData, 'Programs', 'Click Interval Friend'), executableName: 'Click Interval Friend.exe' }
  ];
  return variants.find(variant =>
    compare(applicationPath) === compare(path.join(variant.installRoot, 'resources', 'app')) &&
    compare(executablePath) === compare(path.join(variant.installRoot, variant.executableName))
  ) || null;
}

function isCanonicalInstalledCopy(applicationPath, executablePath) {
  return Boolean(supportedInstalledCopy(applicationPath, executablePath));
}

function queueCanonicalUninstall({ applicationPath, executablePath, parentPid }) {
  const installedCopy = process.platform === 'win32' ? supportedInstalledCopy(applicationPath, executablePath) : null;
  if (!installedCopy) {
    throw new Error('This portable copy cannot remove itself automatically. Close it and delete its folder.');
  }
  const payload = Buffer.from(JSON.stringify({
    installRoot: installedCopy.installRoot,
    executablePath: path.resolve(executablePath),
    parentPid: Number(parentPid)
  }), 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    '$value=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))|ConvertFrom-Json',
    "$localData=[Environment]::GetFolderPath('LocalApplicationData')",
    "$programs=[IO.Path]::GetFullPath((Join-Path $localData 'Programs'))",
    "$expected=[IO.Path]::GetFullPath((Join-Path $programs 'Click Interval Auto Macro'))",
    "$expectedLegacy=[IO.Path]::GetFullPath((Join-Path $programs 'Click Interval Friend'))",
    '$target=[IO.Path]::GetFullPath([string]$value.installRoot)',
    '$executable=[IO.Path]::GetFullPath([string]$value.executablePath)',
    "$currentExe=[IO.Path]::GetFullPath((Join-Path $expected 'Click Interval.exe'))",
    "$legacyExe=[IO.Path]::GetFullPath((Join-Path $expectedLegacy 'Click Interval Friend.exe'))",
    '$isCurrent=[string]::Equals($target,$expected,[StringComparison]::OrdinalIgnoreCase) -and [string]::Equals($executable,$currentExe,[StringComparison]::OrdinalIgnoreCase)',
    '$isLegacy=[string]::Equals($target,$expectedLegacy,[StringComparison]::OrdinalIgnoreCase) -and [string]::Equals($executable,$legacyExe,[StringComparison]::OrdinalIgnoreCase)',
    "if(-not($isCurrent -or $isLegacy)){throw 'Unsafe uninstall path.'}",
    '$deadline=[DateTime]::UtcNow.AddSeconds(60)',
    'while((Get-Process -Id ([int]$value.parentPid) -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 150}',
    "if(Get-Process -Id ([int]$value.parentPid) -ErrorAction SilentlyContinue){throw 'The app did not close.'}",
    "$shortcuts=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Click Interval.lnk'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Click Interval.lnk'),(Join-Path ([Environment]::GetFolderPath('Desktop')) 'Click Interval Friend.lnk'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Click Interval Friend.lnk'))",
    '$shell=New-Object -ComObject WScript.Shell',
    "foreach($shortcut in $shortcuts){if(Test-Path -LiteralPath $shortcut -PathType Leaf){try{$resolved=[IO.Path]::GetFullPath($shell.CreateShortcut($shortcut).TargetPath);if([string]::Equals($resolved,[IO.Path]::GetFullPath([string]$value.executablePath),[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $shortcut -Force}}catch{}}}",
    'if(Test-Path -LiteralPath $target -PathType Container){Remove-Item -LiteralPath $target -Recurse -Force}'
  ].join(';');
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand, payload], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: minimalChildEnvironment()
  });
  child.unref();
  return true;
}

// The filename is retained only because older signed update clients require it
// to exist in the first migration release. Uninstallation can only be started
// by an explicit local user action; no network response can call this helper.
module.exports = { canonicalInstallRoot, isCanonicalInstalledCopy, queueCanonicalUninstall };
