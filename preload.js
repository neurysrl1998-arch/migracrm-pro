// Puente seguro entre el proceso principal y la interfaz
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDB:      ()            => ipcRenderer.invoke('db:load'),
  saveDB:      (content)     => ipcRenderer.invoke('db:save', content),
  attachFile:  ()            => ipcRenderer.invoke('file:attach'),
  openFile:    (stored)      => ipcRenderer.invoke('file:open', stored),
  sendWhatsApp:(phone, text) => ipcRenderer.invoke('wa:send', { phone, text }),
  exportSave:  (suggested, content) => ipcRenderer.invoke('export:save', { suggested, content }),
  openBackups: ()            => ipcRenderer.invoke('backup:folder'),
  paths:       ()            => ipcRenderer.invoke('app:paths'),
  version:     ()            => ipcRenderer.invoke('app:version'),
  onUpdateStatus: (cb)       => ipcRenderer.on('update-status', (e, d) => cb(d)),
  updateInstall:  ()         => ipcRenderer.invoke('update:install'),
  updateCheck:    ()         => ipcRenderer.invoke('update:check')
});
