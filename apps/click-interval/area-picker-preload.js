const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('areaPicker', {
  finish: result => ipcRenderer.send('area-picker-result', result)
});
