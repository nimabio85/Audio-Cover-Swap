const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coverSwapUpdates', {
  getStatus: () => ipcRenderer.invoke('updates:get-status'),
  onStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('updates:status', handler);
    return () => ipcRenderer.removeListener('updates:status', handler);
  },
  check: () => ipcRenderer.send('updates:check'),
  install: () => ipcRenderer.send('updates:install'),
  openRelease: () => ipcRenderer.send('updates:open-release'),
});
