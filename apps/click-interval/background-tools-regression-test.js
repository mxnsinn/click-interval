const fs = require('fs');

const main = fs.readFileSync('main.js', 'utf8');
const settings = fs.readFileSync('settings.html', 'utf8');
const settingsWindow = fs.readFileSync('settings-window.js', 'utf8');
const backend = fs.readFileSync('backend.py', 'utf8');

const checks = {
  threeToolChoices: ['backgroundAutoClicker', 'backgroundMacro', 'backgroundCrosshair'].every(id => settings.includes(`id="${id}"`)),
  settingsPersist: settingsWindow.includes('value.backgroundTools') && main.includes('backgroundTools: []'),
  openOrSelectedToolsRun: main.includes("activeMainTool === tool || detachedTool === tool || loadAppSettings().backgroundTools.includes(tool)"),
  inactiveAutoClickerStops: main.includes("if (!toolIsOperational('auto-clicker')) stopTool('auto-clicker')"),
  inactiveMacroStops: main.includes("if (!toolIsOperational('macro')) stopTool('macro')"),
  crosshairVisibilityGated: main.includes('effectiveCrosshairConfig') && main.includes("toolIsOperational('crosshair')"),
  crosshairEventsGated: backend.includes('crosshair_effect_active') && backend.includes('return effect_active and')
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Background tool regressions: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
