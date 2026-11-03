const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shell', {
  setMode: (mode) => ipcRenderer.send('shell:set-mode', mode === 'tiny' ? 'tiny' : 'full'),
});
