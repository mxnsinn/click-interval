const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crosshairPreviewBridge', {
  loadAppSettings: () => ipcRenderer.sendSync('load-app-settings'),
  control: action => ipcRenderer.send('crosshair-preview-control', action),
  onConfig: callback => ipcRenderer.on('crosshair-config', (_event, value) => callback(value)),
  onPulse: callback => ipcRenderer.on('crosshair-pulse', (_event, value) => callback(value || {}))
});
