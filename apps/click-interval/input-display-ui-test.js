const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.setPath('userData', path.join(__dirname, 'work', `input-display-ui-${process.pid}`));
app.whenReady().then(async () => {
  const settings = {
    theme: 'obsidian', language: 'en', backgroundTools: [],
    showInputDisplay: true, inputDisplayMouse: true, inputDisplayKeyboard: true,
    inputDisplayPhysical: true, inputDisplayGenerated: true,
    inputDisplayScale: 100, inputDisplayLingerMs: 900, inputDisplayOpacity: 88,
    inputDisplayAccent: '#42a5f5', inputDisplayBackground: '#11151a', inputDisplayText: '#ffffff',
    customTheme: { accent: '#1683c7', main: '#101010', shadow: '#000000', text: '#ffffff', highlight: '#42a5f5' }
  };
  ipcMain.on('load-app-settings', event => { event.returnValue = settings; });
  ipcMain.on('get-window-context', event => { event.returnValue = { availableTools: ['auto-clicker', 'macro'] }; });
  for (const channel of ['settings-draft-changed', 'save-app-settings', 'close-current-window']) ipcMain.on(channel, () => {});
  ipcMain.handle('pick-screen-point', () => ({ canceled: true }));
  const target = new BrowserWindow({
    width: 390, height: 400, show: false, backgroundColor: '#101010',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  try {
    await target.loadFile('settings.html');
    const result = await target.webContents.executeJavaScript(`(() => {
      const toggle = document.getElementById('showInputDisplay');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      const value = settingsValue();
      return {
        togglePresent: Boolean(toggle),
        editorAbsent: !document.getElementById('inputDisplayPage') && !document.getElementById('openInputDisplaySettings'),
        showInputDisplay: value.showInputDisplay
      };
    })()`);
    const passed = result.togglePresent && result.editorAbsent && result.showInputDisplay === false;
    console.log(JSON.stringify({ passed, ...result }));
    target.destroy();
    app.exit(passed ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
