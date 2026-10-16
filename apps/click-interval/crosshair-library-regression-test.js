const fs = require('fs');

const read = name => fs.readFileSync(name, 'utf8');
const html = read('index.html');
const renderer = read('renderer.js');
const main = read('main.js');
const overlay = read('crosshair-overlay.js');
const popup = read('popup.css');

const checks = {
  profilePageRemoved: !html.includes('data-crosshair-page="profiles"') && !html.includes('id="crosshairPageProfiles"'),
  emptyLibraryAllowed: !renderer.includes('At least one saved crosshair') && !renderer.includes('At least one profile'),
  sharedNameDialog: renderer.includes("entity: 'crosshair'") && main.includes("payload.entity === 'crosshair'"),
  unifiedScrollableEditor: html.includes('id="crosshairEditorScroll"') && html.includes('<legend>Crosshair effects</legend>') && html.includes('<legend>Firing effects</legend>') && !html.includes('data-crosshair-page') && !html.includes('data-effect-page'),
  horizontalFiringMovement: html.includes('Alternate left / right') && html.includes('Move left') && html.includes('Move right') && html.includes('>Horizontal <input id="crosshairRecoilSway"'),
  gameWeaponPresets: html.includes('id="crosshairEffectGame"') && html.includes('id="crosshairEffectWeapon"') && renderer.includes('crosshairWeaponCatalog'),
  stableOverlaySurface: overlay.includes('config.enabled && (!aiming || config.showWhileAiming !== false)') && !main.includes('else if (overlay.isVisible()) overlay.hide()'),
  foregroundGameGate: main.includes("cs2: ['cs2.exe']") && read('backend.py').includes('foreground_process_name'),
  liveLibraryPreview: renderer.includes('drawCrosshairLibraryPreview') && renderer.includes("document.createElement('canvas')") && renderer.includes('window.CrosshairDraw.draw(context'),
  wrappedErrorDialog: popup.includes('overflow-wrap: anywhere') && html.includes('crosshairHomeCreate')
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Crosshair library regressions: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: Object.keys(checks).length }));
