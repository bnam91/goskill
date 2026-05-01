const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSkills:  (side)        => ipcRenderer.invoke('skills:list',   { side }),
  readSkill:   (side, name)  => ipcRenderer.invoke('skills:read',   { side, name }),
  deleteSkill: (side, name)  => ipcRenderer.invoke('skills:delete', { side, name }),
  readCatalog: ()            => ipcRenderer.invoke('catalog:read'),
  sidesInfo:   ()            => ipcRenderer.invoke('sides:info'),
  gitPull:     ()            => ipcRenderer.invoke('git:pull'),
  downloadSkill: (name)      => ipcRenderer.invoke('skills:download', { name }),
  clipboardWrite: (text)     => ipcRenderer.invoke('clipboard:write', text),
});
