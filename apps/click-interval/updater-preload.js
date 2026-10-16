const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updaterBridge', {
  ready: () => ipcRenderer.send('updater-ready'),
  windowControl: action => ipcRenderer.send('updater-window-control', action),
  cancel: () => ipcRenderer.send('updater-cancel'),
  onDetails: callback => ipcRenderer.on('updater-details', (_event, payload) => callback(payload)),
  onProgress: callback => ipcRenderer.on('updater-progress', (_event, payload) => callback(payload)),
  onErrorDetails: callback => ipcRenderer.on('updater-error-details', (_event, payload) => callback(payload))
});
