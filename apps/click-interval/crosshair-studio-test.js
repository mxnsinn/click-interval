const fs = require('fs');
const files = Object.fromEntries(['index.html', 'renderer.js', 'main.js', 'preload.js', 'backend.py', 'crosshair-overlay.js', 'crosshair-draw.js'].map(name => [name, fs.readFileSync(name, 'utf8')]));
const requiredIds = ['showCrosshair', 'crosshairView', 'crosshairHomePanel', 'crosshairLibraryList', 'crosshairEditorPanel', 'crosshairPreview', 'crosshairEnabled', 'crosshairScale', 'crosshairRotation', 'crosshairBarsEnabled', 'crosshairDot', 'crosshairCircleEnabled', 'crosshairOutline', 'crosshairDisplay', 'crosshairHotkey', 'crosshairEffectPreset', 'crosshairCustomGameExecutable'];
for (const id of requiredIds) if (!files['index.html'].includes(`id="${id}"`)) throw new Error(`Missing UI control: ${id}`);
const checks = [
  ['third tool route', files['renderer.js'].includes("crosshair: ['crosshairView', 'showCrosshair']")],
  ['fixed tool window sizing', !files['main.js'].includes("if (tool === 'crosshair') return") && files['main.js'].includes("return { width: localized ? 520 : 437")],
  ['click-through overlay', files['main.js'].includes('setIgnoreMouseEvents(true')],
  ['fullscreen workspace overlay', files['main.js'].includes('visibleOnFullScreen: true')],
  ['monitor selection', files['main.js'].includes("get-crosshair-displays")],
  ['global toggle', files['main.js'].includes('registerCrosshairShortcut')],
  ['shot bloom event', files['backend.py'].includes('crosshair_fire') && files['crosshair-overlay.js'].includes('onPulse')],
  ['ADS hide event', files['backend.py'].includes('crosshair_ads') && files['crosshair-overlay.js'].includes('onAds')],
  ['profile persistence', files['renderer.js'].includes('crosshairStudio') && files['renderer.js'].includes('saveCrosshairStudio')],
  ['image crosshair', files['main.js'].includes('choose-crosshair-image')],
  ['profile exchange', files['main.js'].includes('export-crosshair-profile') && files['main.js'].includes('import-crosshair-profile')],
  ['PNG export', files['main.js'].includes('export-crosshair-png')],
  ['separate preview window', files['main.js'].includes('createCrosshairPreviewWindow')],
  ['recoil effects', files['renderer.js'].includes('crosshairRecoilEnabled') && files['backend.py'].includes('"active": False')]
  ,['one scrollable editor', files['index.html'].includes('id="crosshairEditorScroll"') && !files['index.html'].includes('data-crosshair-page')]
  ,['bidirectional recoil', files['index.html'].includes('Move left') && files['index.html'].includes('Move right')]
  ,['foreground game gate', files['backend.py'].includes('crosshair_game_is_active') && files['main.js'].includes('crosshairGameProcesses')]
  ,['component editor', files['index.html'].includes('data-enable-control="crosshairBarsEnabled"') && files['index.html'].includes('crosshairScopedColor')]
];
if (files['index.html'].includes('Create and control your overlay')) throw new Error('Removed Crosshair Studio header copy is still present.');
const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Crosshair Studio checks failed: ${failed.join(', ')}`);
console.log(JSON.stringify({ passed: true, checks: checks.length, controls: requiredIds.length }));
