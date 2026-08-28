const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opencodeFloat', {
  api: (req) => ipcRenderer.invoke('api', req),
  getConfig: () => ipcRenderer.invoke('config:get'),
  patchConfig: (patch) => ipcRenderer.invoke('config:patch', patch),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  stageImage: (p) => ipcRenderer.invoke('stage-image', p),
  saveImage: (bytes, mime) => ipcRenderer.invoke('save-image', bytes, mime),
  removeFile: (p) => ipcRenderer.invoke('remove-file', p),
  resize: (h, w) => ipcRenderer.invoke('win:resize', { h, w }),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:set-always-on-top', v),
  quit: () => ipcRenderer.invoke('app:quit'),
});
