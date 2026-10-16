const fs = require('fs');
const read = file => fs.readFileSync(file, 'utf8');
const backend = read('backend.py');
const main = read('main.js');
const settings = read('settings.html');
const settingsWindow = read('settings-window.js');
const overlay = read('input-display.html');
const build = read('build-development-update.ps1');

const checks = {
  macroEmitsMouseDownUp: backend.includes('"source": "macro"') && backend.includes('"action": "up" if action_type == "mouse_up" else "down"'),
  autoClickerEmitsInput: backend.includes('"source": "auto"') && backend.includes('generated_event_clicks') && backend.includes('(1.0 / 30.0)'),
  autoInputTelemetryIsOptional: backend.includes('emit_generated_input_events') && main.includes('settings.showInputDisplay && settings.inputDisplayGenerated'),
  physicalMouseAndKeysEmit: backend.includes('"source": "physical"') && backend.includes('"device": "keyboard"'),
  macroCpsAggregation: main.includes("inputEvent.source === 'macro' && inputEvent.device === 'mouse' && inputEvent.action === 'down'") && main.includes('currentGeneratedCps + macroClickTimes.length'),
  cpsAlwaysAvailable: settings.includes('id="showCpsAlways"') && main.includes('settings.showCpsAlways'),
  customizationDeferred: settings.includes('id="showInputDisplay"') && !settings.includes('id="inputDisplayPage"') && !settingsWindow.includes('showInputDisplaySettings'),
  generatedMouseGraphic: overlay.includes('data-button="Left"') && overlay.includes('data-button="MB5"'),
  keyDownUpStates: overlay.includes("action==='down'?'DOWN':'UP'") && overlay.includes('keycap ${action}'),
  customizationControlsRemoved: !['inputDisplayScale','inputDisplayLingerMs','inputDisplayOpacity','inputDisplayAccent','inputDisplayBackground','inputDisplayText'].some(id => settings.includes(`id="${id}"`)),
  overlayPackaged: ['input-display.html','input-display-preload.js'].every(file => build.includes(`'${file}'`))
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Input display checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
