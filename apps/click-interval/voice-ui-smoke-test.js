const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  ipcMain.on('get-window-context', event => { event.returnValue = { role: 'main', tool: 'auto-clicker', activeMainTool: 'auto-clicker', detachedTool: null, lockedTool: null, operationalTools: ['auto-clicker'], appVersion: 'test' }; });
  ipcMain.on('load-preferences', event => { event.returnValue = {}; });
  ipcMain.on('load-macro-library', event => { event.returnValue = { version: 2, selectedId: null, macros: [] }; });
  ipcMain.on('load-hotkey', event => { event.returnValue = null; });
  ipcMain.on('load-voice-processor-source', event => { event.returnValue = require('fs').readFileSync(path.join(__dirname, 'voice-processor.js'), 'utf8'); });
  ipcMain.on('load-app-settings', event => { event.returnValue = { theme: 'obsidian', backgroundTools: [] }; });
  ipcMain.handle('get-crosshair-displays', () => [{ id: '1', label: 'Display', primary: true, width: 1920, height: 1080 }]);
  ipcMain.handle('read-clipboard-text', () => '');
  try {
    const target = new BrowserWindow({ width: 437, height: 423, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    await target.loadFile('index.html');
    await target.webContents.executeJavaScript("showTool('voice')");
    target.webContents.focus();
    const knobPoint = await target.webContents.executeJavaScript(`(() => { const face=document.querySelector('#voiceBass').closest('.voice-knob-face'); face.scrollIntoView({block:'center'}); const rect=face.getBoundingClientRect(); return {x:Math.round(rect.right-4),y:Math.round(rect.top+rect.height/2)}; })()`);
    target.webContents.sendInputEvent({ type: 'mouseDown', x: knobPoint.x, y: knobPoint.y, button: 'left', clickCount: 1 });
    target.webContents.sendInputEvent({ type: 'mouseUp', x: knobPoint.x, y: knobPoint.y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 60));
    const result = await target.webContents.executeJavaScript(`(() => {
    const tabs = [...document.querySelectorAll('.tool-tab')].map(element => element.getBoundingClientRect());
    const pointerBass = Number(document.getElementById('voiceBass').value);
    const preset = document.getElementById('voicePreset');
    preset.value = 'deep';
    preset.dispatchEvent(new Event('change', {bubbles:true}));
    const bass = document.getElementById('voiceBass');
    bass.value = '12';
    bass.dispatchEvent(new Event('input', {bubbles:true}));
    return {
      tabs: tabs.length,
      tabsFit: Math.max(...tabs.map(rect => rect.right)) <= innerWidth,
      voiceControls: document.querySelectorAll('#voiceView input[type=range]').length,
      voiceScrollable: getComputedStyle(document.querySelector('.voice-scroll')).overflowY === 'auto',
      audioStartsOff: typeof voiceAudioContext !== 'undefined' && voiceAudioContext === null,
      presetWorks: document.getElementById('voicePitch').value === '-5',
      knobWorks: bass.closest('.voice-knob').querySelector('output').textContent === '12 dB'
      ,pointerKnobWorks: pointerBass !== 0
    };
    })()`);
    const passed = result.tabs === 4 && result.tabsFit && result.voiceControls === 12 && result.voiceScrollable && result.audioStartsOff && result.presetWorks && result.knobWorks && result.pointerKnobWorks;
    console.log(JSON.stringify({ passed, ...result }));
    target.destroy();
    app.exit(passed ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
