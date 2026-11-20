const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  whipCrack: () => ipcRenderer.send('whip-crack'),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),
  onAutoWhip: (fn) => ipcRenderer.on('auto-whip', () => fn()),
  onScene: (fn) => ipcRenderer.on('scene', (_e, p) => fn(p)),
  onVisible: (fn) => ipcRenderer.on('stage-visible', (_e, v) => fn(v)),
  onBounds: (fn) => ipcRenderer.on('claude-bounds', (_e, b) => fn(b)),
  sceneDone: () => ipcRenderer.send('scene-done'),
  onSpawnWhip: (fn) => ipcRenderer.on('spawn-whip', () => fn()),
  onDropWhip: (fn) => ipcRenderer.on('drop-whip', () => fn()),
});
