const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(__dirname, 'work', `theme-ui-test-${process.pid}`));
app.whenReady().then(async () => {
  const settings = {
    theme: 'light', language: 'en', backgroundTools: [], customTheme: {
      accent: '#1683c7', main: '#101010', shadow: '#000000', text: '#ffffff', highlight: '#42a5f5'
    }
  };
  ipcMain.on('load-app-settings', event => { event.returnValue = settings; });
  ipcMain.on('get-window-context', event => { event.returnValue = { availableTools: ['auto-clicker', 'macro'] }; });
  for (const channel of ['settings-draft-changed', 'save-app-settings', 'close-current-window']) ipcMain.on(channel, () => {});
  ipcMain.handle('pick-screen-point', () => ({ canceled: true }));
  const target = new BrowserWindow({
    width: 390, height: 400, show: false, transparent: false, backgroundColor: '#f4f6f8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  try {
    await target.loadFile('settings.html');
    target.showInactive();
    await new Promise(resolve => setTimeout(resolve, 120));
    const palette = await target.webContents.executeJavaScript(`(() => {
      const backgroundTool = document.querySelector('.background-tool-grid label');
      const lightSurface = getComputedStyle(backgroundTool).backgroundColor;
      const transparentChoices = document.querySelectorAll('input[value^="transparent-"]').length;
      return { lightSurface, transparentChoices };
    })()`);
    const result = await target.webContents.executeJavaScript(`(async () => {
      const custom = document.querySelector('input[value="custom"]');
      custom.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      document.getElementById('customAccent').value = '#ff6600';
      document.getElementById('customMain').value = '#123456';
      document.getElementById('customShadow').value = '#654321';
      document.getElementById('customText').value = '#fefefe';
      document.getElementById('customHighlight').value = '#00ff99';
      document.getElementById('customScrollbarTrack').value = '#111827';
      document.getElementById('customScrollbarThumb').value = '#475569';
      document.getElementById('customScrollbarThumbHover').value = '#94a3b8';
      document.getElementById('customScrollbarThumbHover').dispatchEvent(new Event('input', { bubbles: true }));
      const appStyles = document.createElement('link');
      appStyles.rel = 'stylesheet';
      appStyles.href = 'styles.css';
      document.head.append(appStyles);
      await new Promise(resolve => { appStyles.onload = resolve; });
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.checked = true;
      document.body.append(radio);
      return {
        customDialogOpen: document.getElementById('customThemeDialog').open,
        customTheme: document.documentElement.dataset.theme,
        customAccent: getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim(),
        customShadow: getComputedStyle(document.documentElement).getPropertyValue('--theme-shadow').trim(),
        customHighlight: getComputedStyle(document.documentElement).getPropertyValue('--theme-highlight').trim(),
        customScrollbarTrack: getComputedStyle(document.documentElement).getPropertyValue('--theme-scrollbar-track').trim(),
        customScrollbarThumb: getComputedStyle(document.documentElement).getPropertyValue('--theme-scrollbar-thumb').trim(),
        customScrollbarThumbHover: getComputedStyle(document.documentElement).getPropertyValue('--theme-scrollbar-thumb-hover').trim(),
        highlightedRadioBorder: getComputedStyle(radio).borderColor
      };
    })()`);
    Object.assign(result, palette, {
      lightSurfaceFixed: !['rgb(24, 24, 24)', 'rgba(24, 24, 24, 1)'].includes(palette.lightSurface),
      transparentThemesRemoved: palette.transparentChoices === 0
    });
    const passed = result.lightSurfaceFixed && result.transparentThemesRemoved && result.customDialogOpen &&
      result.customTheme === 'custom' && result.customAccent === '#ff6600' && result.customShadow === '#654321' &&
      result.customHighlight === '#00ff99' && result.customScrollbarTrack === '#111827' &&
      result.customScrollbarThumb === '#475569' && result.customScrollbarThumbHover === '#94a3b8' &&
      result.highlightedRadioBorder === 'rgb(0, 255, 153)';
    console.log(JSON.stringify({ passed, ...result }));
    target.destroy();
    app.exit(passed ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
