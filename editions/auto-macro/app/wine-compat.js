'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const WINE_ENVIRONMENT_KEYS = Object.freeze([
  'WINEPREFIX', 'WINELOADERNOEXEC', 'WINEDLLPATH',
  'CX_ROOT', 'CX_BOTTLE', 'CROSSOVER_BOTTLE',
  'WHISKY_BOTTLE_PATH'
]);

function enabled(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function isWineEnvironment({
  environment = process.env,
  platform = process.platform,
  run = spawnSync
} = {}) {
  if (platform !== 'win32') return false;
  if (enabled(environment.CLICK_INTERVAL_WINE_COMPAT)) return true;
  if (WINE_ENVIRONMENT_KEYS.some(key => typeof environment[key] === 'string' && environment[key].trim())) return true;

  // Some GUI Wine/CrossOver launchers do not preserve the shell's WINEPREFIX
  // variables. Wine still exposes this registry key inside the bottle.
  try {
    const systemRoot = String(environment.SystemRoot || environment.windir || 'C:\\windows');
    const result = run(path.join(systemRoot, 'system32', 'reg.exe'), ['query', 'HKCU\\Software\\Wine'], {
      windowsHide: true,
      timeout: 1500,
      encoding: 'utf8'
    });
    return result && result.status === 0;
  } catch (_) {
    return false;
  }
}

function enableWineElectronCompatibility(electronApp, detectionOptions) {
  const wine = isWineEnvironment(detectionOptions);
  if (!wine) return false;
  // Chromium's Windows GPU process is unreliable through multiple Wine/DXVK
  // combinations. Software compositing avoids blank or frozen windows while
  // retaining Electron's renderer sandbox and context isolation.
  electronApp.disableHardwareAcceleration();
  electronApp.commandLine.appendSwitch('disable-gpu');
  return true;
}

module.exports = { WINE_ENVIRONMENT_KEYS, enableWineElectronCompatibility, isWineEnvironment };
