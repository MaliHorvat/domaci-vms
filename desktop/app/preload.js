// Most med oknom in aplikacijo. Strani s strežnika dobijo samo oznako, da tečejo v namizni aplikaciji;
// nastavitve povezave lahko spreminja le lokalni povezovalni zaslon (preverjeno tudi v main.js).
const { contextBridge, ipcRenderer } = require('electron');

const local = location.protocol === 'file:';
contextBridge.exposeInMainWorld('v1desktop', local ? {
  desktop: true,
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  decode: code => ipcRenderer.invoke('cfg:decode', code),
  probe: url => ipcRenderer.invoke('cfg:probe', url),
  save: v => ipcRenderer.invoke('cfg:save', v),
  back: () => ipcRenderer.invoke('cfg:back'),
  onStatus: fn => ipcRenderer.on('status', (_e, s) => fn(s)),
} : { desktop: true });
