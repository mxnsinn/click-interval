const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inputDisplay', {
  onConfig: callback => ipcRenderer.on('input-display-config', (_event, value) => callback(value)),
  onEvent: callback => ipcRenderer.on('input-display-event', (_event, value) => callback(value))
});
