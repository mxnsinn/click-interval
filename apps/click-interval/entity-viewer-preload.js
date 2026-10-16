const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  loadAppSettings: () => ipcRenderer.sendSync('load-app-settings'),
  onAppThemeChanged: callback => ipcRenderer.on('app-theme-changed', (_event, value) => callback(value))
});

contextBridge.exposeInMainWorld('entityViewer', {
  list: () => ipcRenderer.invoke('entity-viewer:list'),
  inspect: id => ipcRenderer.invoke('entity-viewer:inspect', id),
  updateOffer: (id, index, offer) => ipcRenderer.invoke('entity-viewer:updateOffer', id, index, offer),
  setAge: (id, value) => ipcRenderer.invoke('entity-viewer:setAge', id, value),
  setCooldown: (id, value) => ipcRenderer.invoke('entity-viewer:setCooldown', id, value),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close')
});
