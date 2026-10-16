const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  loadAppSettings: () => ipcRenderer.sendSync('load-app-settings'),
  onAppThemeChanged: callback => ipcRenderer.on('app-theme-changed', (_event, value) => callback(value))
});

contextBridge.exposeInMainWorld('worldMap', {
  getSnapshot: terrainToken => ipcRenderer.invoke('world-map:snapshot', terrainToken),
  getSeedPreview: viewport => ipcRenderer.invoke('world-map:seedPreview', viewport),
  stopSeedPreview: () => ipcRenderer.invoke('world-map:stopSeedPreview'),
  getSlimeChunks: viewport => ipcRenderer.invoke('world-map:slimeChunks', viewport),
  install: () => ipcRenderer.invoke('world-map:install'),
  disable: () => ipcRenderer.invoke('world-map:remove'),
  getPlayerDetails: name => ipcRenderer.invoke('world-map:playerDetails', name),
  getPlayerSkin: player => ipcRenderer.invoke('players:getSkin', player),
  kickPlayer: (name, reason) => ipcRenderer.invoke('world-map:kick', name, reason),
  banPlayer: (name, reason) => ipcRenderer.invoke('world-map:ban', name, reason),
  tempBanPlayer: (name, durationMs, reason) => ipcRenderer.invoke('world-map:tempBan', name, durationMs, reason),
  openPlayerProfile: name => ipcRenderer.send('open-player-inspector', name),
  windowAction: action => ipcRenderer.invoke(action === 'maximize' ? 'window:maximizeToggle' : `window:${action}`),
  onPlayers: callback => ipcRenderer.on('server:players', (_event, players) => callback(players)),
  onState: callback => ipcRenderer.on('server:state', (_event, state) => callback(state)),
  onMapStatus: callback => ipcRenderer.on('world-map:status', (_event, status) => callback(status))
});
