const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const path = require('path');
const applicationRoot = process.env.CLICK_INTERVAL_TEST_ROOT || __dirname;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => ['media', 'display-capture', 'speaker-selection'].includes(permission));
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback((permission === 'media' && (mediaTypes.length === 0 || mediaTypes.includes('audio'))) || permission === 'display-capture' || permission === 'speaker-selection');
  });
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!request.audioRequested) { callback({}); return; }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    callback({ video: sources[0], audio: 'loopback' });
  });
  ipcMain.on('get-window-context', event => { event.returnValue = { role: 'main', tool: 'voice', activeMainTool: 'voice', detachedTool: null, lockedTool: null, operationalTools: ['voice'], appVersion: 'test' }; });
  ipcMain.on('load-preferences', event => { event.returnValue = { voiceChanger: { isolation: true, pcAudioCancellation: true } }; });
  ipcMain.on('load-macro-library', event => {
    event.returnValue = { version: 2, selectedId: 'startup-macro', macros: [{ id: 'startup-macro', name: 'Startup macro', actions: [] }] };
  });
  ipcMain.on('load-hotkey', event => { event.returnValue = null; });
  ipcMain.on('load-voice-processor-source', event => { event.returnValue = require('fs').readFileSync(path.join(applicationRoot, 'voice-processor.js'), 'utf8'); });
  ipcMain.on('load-app-settings', event => { event.returnValue = { theme: 'obsidian', backgroundTools: [] }; });
  let reportedError = '';
  const rendererErrors = [];
  ipcMain.on('open-message-window', (_event, payload) => { reportedError = `${payload?.title || ''}: ${payload?.message || ''}`; });
  ipcMain.handle('get-crosshair-displays', () => [{ id: '1', label: 'Display', primary: true, width: 1920, height: 1080 }]);
  ipcMain.handle('read-clipboard-text', () => '');
  const target = new BrowserWindow({ width: 437, height: 423, show: false, webPreferences: { preload: path.join(applicationRoot, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  target.webContents.on('console-message', event => {
    if (event?.level === 'error' && event?.message) rendererErrors.push(String(event.message));
  });
  target.webContents.on('preload-error', (_event, _path, error) => rendererErrors.push(String(error?.message || error)));
  try {
    await target.loadFile(path.join(applicationRoot, 'index.html'));
    await target.webContents.executeJavaScript(`document.getElementById('voicePower').click()`);
    await new Promise(resolve => setTimeout(resolve, 1600));
    const result = await target.webContents.executeJavaScript(`({
      active: Boolean(voiceAudioContext && voiceMediaStream && voiceNodes),
      tracks: voiceMediaStream ? voiceMediaStream.getAudioTracks().length : 0,
      systemTracks: voiceSystemStream ? voiceSystemStream.getAudioTracks().length : 0,
      systemReference: Boolean(voiceNodes?.systemReferenceActive),
      microphoneSettings: voiceMediaStream?.getAudioTracks?.()[0]?.getSettings?.() || null,
      systemSettings: voiceSystemStream?.getAudioTracks?.()[0]?.getSettings?.() || null,
      microphones: document.getElementById('voiceInputDevice').options.length,
      outputs: document.getElementById('voiceOutputDevice').options.length,
      status: document.getElementById('voiceMeterText').textContent
    })`);
    const processing = await target.webContents.executeJavaScript(`(async () => {
      const bass = document.getElementById('voiceBass');
      bass.value = '12';
      bass.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 120));
      return {
        bassControl: Number(bass.value),
        bassNode: voiceNodes?.bass?.gain?.value,
        preset: document.getElementById('voicePreset').value
      };
    })()`);
    await target.webContents.executeJavaScript('stopVoiceAudio()');
    const passed = result.active && result.tracks > 0 && result.systemTracks > 0 && result.systemReference &&
      result.microphoneSettings?.echoCancellation === false && result.microphoneSettings?.noiseSuppression === false &&
      result.systemSettings?.echoCancellation === false && result.systemSettings?.noiseSuppression === false &&
      result.microphones > 1 && result.outputs > 1 &&
      processing.bassControl === 12 && Math.abs(processing.bassNode - 12) < 0.25 && !reportedError;
    console.log(JSON.stringify({ passed, ...result, processing, error: reportedError, rendererErrors }));
    target.destroy();
    app.exit(passed ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ error: String(error?.message || error), rendererErrors }));
    target.destroy();
    app.exit(1);
  }
});
