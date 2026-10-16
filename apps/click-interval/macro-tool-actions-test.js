const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const renderer = fs.readFileSync('renderer.js', 'utf8');
const backend = fs.readFileSync('backend.py', 'utf8');
const checks = {
  menuOptions: html.includes('value="switch_crosshair"') && html.includes('value="auto_clicker_control"'),
  crosshairEditor: html.includes('id="actionEditCrosshairFields"') && renderer.includes("action.type === 'switch_crosshair'"),
  autoClickerEditor: html.includes('id="actionEditAutoClickerFields"') && renderer.includes("action.type === 'auto_clicker_control'"),
  validActions: renderer.includes("'switch_crosshair', 'auto_clicker_control'"),
  backendCrosshair: backend.includes('"type": "macro_crosshair_profile"'),
  backendAutoClicker: backend.includes('action.get("type") == "auto_clicker_control"') && backend.includes('set_running(True)')
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Macro tool actions failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
