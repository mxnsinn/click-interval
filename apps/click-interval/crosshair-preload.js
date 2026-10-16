const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crosshairOverlay', {
  onConfig: callback => ipcRenderer.on('crosshair-config', (_event, value) => callback(value)),
  onPulse: callback => ipcRenderer.on('crosshair-pulse', (_event, value) => callback(value || {})),
  onAds: callback => ipcRenderer.on('crosshair-ads', (_event, value) => callback(value))
});
