'use strict';

// Isolated, hidden renderer test. This never loads the app or Minecraft backend.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'work', `reset-data-popup-test-${process.pid}`));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let dialog;
let confirmations = [];
let closeRequests = 0;
ipcMain.on('load-app-settings', event => { event.returnValue = { theme: 'obsidian', language: 'en' }; });
ipcMain.on('load-macro-delete-dialog', event => { event.returnValue = dialog; });
ipcMain.on('confirm-macro-delete', (_event, options) => { confirmations.push(options); });
ipcMain.on('close-current-window', () => { closeRequests++; });

app.whenReady().then(async () => {
  let target;
  try {
    dialog = {
      entity: 'server', action: 'wipe', title: 'Reset Data', confirmText: 'Reset Data',
      question: 'Reset the entire world for “A long Minecraft survival server profile name”? This resets all dimensions and player progress, clears joined-player history, and unbans everyone. Lootr is also removed. Operators and the whitelist are kept. A backup is created first. Settings are kept unless selected below.'
    };
    target = new BrowserWindow({
      width: 540, height: 500, useContentSize: true, show: false,
      webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    await target.loadFile(path.join(__dirname, 'macro-delete.html'));
    const layout = await target.webContents.executeJavaScript(`(() => {
      const button = document.getElementById('confirmDelete');
      const checkbox = document.getElementById('resetServerSettings');
      const help = document.getElementById('resetServerSettingsHelp');
      return { checked: checkbox.checked, hidden: checkbox.closest('label').hidden, label: button.textContent,
        bottom: button.getBoundingClientRect().bottom, viewport: innerHeight, scrollWidth: document.body.scrollWidth,
        width: innerWidth, help: help.textContent, focused: document.activeElement.id,
        fields: Array.from(document.querySelectorAll('#resetServerFields input')).map(input => ({ id: input.id, checked: input.checked, visible: input.getBoundingClientRect().height > 0 })) };
    })()`);
    assert.equal(layout.checked, false);
    assert.equal(layout.hidden, false);
    assert.equal(layout.label, 'Reset Data');
    assert.match(layout.help, /Settings section in Click Interval/);
    assert.equal(layout.focused, 'cancelDelete');
    assert.equal(layout.fields.length, 7);
    for (const field of layout.fields) { assert.equal(field.checked, false); assert.equal(field.visible, true); }
    assert.ok(layout.bottom <= layout.viewport - 8, `Reset controls clipped: ${JSON.stringify(layout)}`);
    assert.ok(layout.scrollWidth <= layout.width, 'dialog must not overflow horizontally');
    const previewFolder = path.join(__dirname, 'work', 'reset-preserve-release');
    fs.mkdirSync(previewFolder, { recursive: true });
    fs.writeFileSync(path.join(previewFolder, 'reset-data-ui-preview.png'), (await target.webContents.capturePage()).toPNG());
    assert.equal(confirmations.length, 0, 'opening the dialog must not dispatch reset');
    await target.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light';`);
    fs.writeFileSync(path.join(previewFolder, 'reset-data-ui-light-preview.png'), (await target.webContents.capturePage()).toPNG());
    await target.webContents.executeJavaScript(`document.getElementById('cancelDelete').click();`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(closeRequests, 1); assert.equal(confirmations.length, 0, 'Cancel must not dispatch reset');
    await target.webContents.executeJavaScript(`document.getElementById('resetServerSettings').click(); document.getElementById('resetServerField-serverIcon').click(); document.getElementById('confirmDelete').click();`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(confirmations.length, 1); assert.equal(confirmations[0].resetSettings, true);
    assert.deepEqual(confirmations[0].resetFields, ['serverIcon']);
    await target.webContents.executeJavaScript(`document.getElementById('confirmDelete').click();`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(confirmations.length, 1, 'disabled confirmation cannot dispatch a second click');
    target.destroy();

    dialog = { entity: 'macro', name: 'Example macro' }; confirmations = [];
    target = new BrowserWindow({ width: 330, height: 158, useContentSize: true, show: false,
      webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    await target.loadFile(path.join(__dirname, 'macro-delete.html'));
    const macro = await target.webContents.executeJavaScript(`({ title: document.title, hidden: document.getElementById('resetServerSettingsOption').hidden, bottom: document.getElementById('confirmDelete').getBoundingClientRect().bottom, height: innerHeight })`);
    assert.equal(macro.title, 'Delete Macro'); assert.equal(macro.hidden, true); assert.ok(macro.bottom <= macro.height);
    console.log('PASS hidden Reset Data and existing macro popup layout/checkbox test');
  } catch (error) {
    console.error(error); process.exitCode = 1;
  } finally {
    if (target && !target.isDestroyed()) target.destroy();
    app.exit(process.exitCode || 0);
  }
});
