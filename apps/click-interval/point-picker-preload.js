const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pointPicker', {
  language: ipcRenderer.sendSync('get-picker-language'),
  finish: result => ipcRenderer.send('screen-point-picker-result', result)
});
