// Мост между игрой и окном: настройки экрана и выход.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiLabDesktop', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  setConfig: (patch) => ipcRenderer.invoke('cfg:set', patch),
  displays: () => ipcRenderer.invoke('displays'),
  quit: () => ipcRenderer.send('quit'),
  // 'win32' или 'darwin': подсказки о клавишах в игре.
  platform: process.platform,
});
