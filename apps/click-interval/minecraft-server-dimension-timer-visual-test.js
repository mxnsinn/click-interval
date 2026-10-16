'use strict';
// Hidden, isolated renderer only. No app preload or Minecraft backend is loaded.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const work = path.join(__dirname, 'work', 'dimension-timer-release');
app.setPath('userData', path.join(work, `visual-profile-${process.pid}`));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const source = fs.readFileSync(path.join(__dirname, 'minecraft-server-ui.js'), 'utf8');
function slice(from, to) { const start = source.indexOf(from), end = source.indexOf(to, start); assert.ok(start >= 0 && end > start); return source.slice(start, end); }
const settingsMarkup = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').match(/<div id="msSettingsPage"[^]*?<\/form><\/div>/)[0].replace(' hidden', '');
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(__dirname, 'styles.css'))}"><style>:root{--theme-bg:#101010;--theme-text:#eee;--theme-muted:#aaa;--theme-border:#303030;--theme-raised:#222}body{padding:8px}.ms-page{height:344px}</style>${settingsMarkup}`;
fs.mkdirSync(work, { recursive: true });
const fixture = path.join(work, 'timer-visual-fixture.html'); fs.writeFileSync(fixture, html);
const watchdog = setTimeout(() => app.exit(1), 25000);
app.whenReady().then(async () => {
  let window;
  try {
    window = new BrowserWindow({ width: 420, height: 360, useContentSize: true, show: false, frame: false,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true } });
    await window.loadFile(fixture);
    await window.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, 'dimension-lock-controls.js'), 'utf8'));
    await window.webContents.executeJavaScript(`
      const $ = id => document.getElementById(id); let settingsDirty=false;
      const status={profiles:{activeProfileId:'test'},dimensionLocks:{canEdit:true,revision:'one',worldName:'test',nether:{locked:true},end:{locked:true}}};
      ${slice('  const settingGroups = [', '  const settingDescriptions = {')}
      const settingDescriptions={};
      ${slice('  function settingName(', '  function normalizeNumericSetting(')}
      function prepareNumericSetting(){} function buildMotdSetting(){} function buildServerIconSetting(){}
      ${slice('  function buildSettings()', '  function hydrateSettings()')}
      buildSettings();
      const draft=DimensionLockControls.createDraft(status.dimensionLocks,'test');
      DimensionLockControls.hydrate(draft,key=>$('msSetting_'+key));
      DimensionLockControls.sync(status.dimensionLocks,key=>$('msSetting_'+key));
    `);
    const footer = await window.webContents.executeJavaScript(`(() => {const r=$('msResetDataSettings').getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:document.body.scrollWidth,viewport:innerWidth};})()`);
    assert.ok(footer.top >= 0 && footer.bottom <= 360, 'Reset Data remains visible before scrolling');
    assert.ok(footer.width <= footer.viewport, 'no horizontal overflow');
    await window.webContents.executeJavaScript(`$('msSetting_lockNether').closest('section').scrollIntoView();`);
    await new Promise(resolve => setTimeout(resolve, 120));
    fs.writeFileSync(path.join(work, 'dimension-manual-preview.png'), (await window.webContents.capturePage()).toPNG());
    const manual = await window.webContents.executeJavaScript(`({checked:$('msSetting_netherAutoOpen').checked,hidden:$('msSetting_netherTimer').hidden})`);
    assert.deepEqual(manual, { checked: false, hidden: true });
    await window.webContents.executeJavaScript(`$('msSetting_netherAutoOpen').click();$('msSetting_netherDuration').value='12';$('msSetting_netherDurationUnit').value='hours';`);
    const timer = await window.webContents.executeJavaScript(`(() => {const r=$('msSetting_netherDurationUnit').getBoundingClientRect();return {hidden:$('msSetting_netherTimer').hidden, right:r.right,width:innerWidth,seconds:DimensionLockControls.collect(draft,key=>$('msSetting_'+key)).changes.lockNether.durationSeconds};})()`);
    assert.equal(timer.hidden, false); assert.equal(timer.seconds, 43200); assert.ok(timer.right <= timer.width);
    await new Promise(resolve => setTimeout(resolve, 120));
    fs.writeFileSync(path.join(work, 'dimension-timer-preview.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS hidden Settings renderer: visible Reset shortcut, manual default, explicit timer, bounded 420px layout.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(watchdog); if (window && !window.isDestroyed()) window.destroy(); app.exit(process.exitCode || 0); }
});
