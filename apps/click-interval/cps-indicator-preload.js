const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cpsIndicator', {
  onValue: callback => ipcRenderer.on('cps-indicator-value', (_event, value) => callback(value))
});
