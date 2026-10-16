'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clickIntervalUpdater', {
  close: () => ipcRenderer.send('click-interval-updater-close'),
  onProgress: callback => ipcRenderer.on('click-interval-update-progress', (_event, value) => callback(value))
});
