const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSkills:  (side)        => ipcRenderer.invoke('skills:list',   { side }),
  readSkill:   (side, name)  => ipcRenderer.invoke('skills:read',   { side, name }),
  deleteSkill: (side, name)  => ipcRenderer.invoke('skills:delete', { side, name }),
  readCatalog: ()            => ipcRenderer.invoke('catalog:read'),
  sidesInfo:   ()            => ipcRenderer.invoke('sides:info'),
});
