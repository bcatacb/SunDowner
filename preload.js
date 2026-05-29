const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Library operations
  preloadList: (options) => ipcRenderer.invoke('preload-list', options),
  startDownload: (options) => ipcRenderer.invoke('start-download', options),
  stopDownload: () => ipcRenderer.invoke('stop-download'),
  fetchWorkspaces: (token) => ipcRenderer.invoke('fetch-workspaces', token),
  fetchPlaylists: (token) => ipcRenderer.invoke('fetch-playlists', token),

  // Events from main process
  on: (channel, callback) => {
    const validChannels = [
      'download-progress', 'download-log', 'download-total',
      'download-complete', 'preload-progress', 'preload-complete'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  }
});
