const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('postDesktop', {
  toggleCompact: () => ipcRenderer.invoke('window:toggle-compact'),
  setDirectFill: enabled => ipcRenderer.invoke('window:set-direct-fill', Boolean(enabled)),
  writeClipboard: text => ipcRenderer.invoke('clipboard:write', String(text ?? '')),
  fillActive: text => ipcRenderer.invoke('clipboard:fill-active', String(text ?? '')),
  captureAutomationPoint: delayMs => ipcRenderer.invoke('automation:capture-point', Number(delayMs) || 3000),
  setAutomationRunning: running => ipcRenderer.invoke('automation:set-running', Boolean(running)),
  clickAutomationPoint: point => ipcRenderer.invoke('automation:click', point),
  invokeAutomationControl: (point, name) => ipcRenderer.invoke('automation:invoke', point, String(name ?? '')),
  clickPasteAutomationPoint: (point, text) => ipcRenderer.invoke('automation:click-paste', point, String(text ?? '')),
  onCompactState: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('window:compact-state', (_event, compact) => callback(Boolean(compact)));
  },
  onDirectFillState: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('window:direct-fill-state', (_event, enabled) => callback(Boolean(enabled)));
  },
  onAutomationState: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('window:automation-state', (_event, running) => callback(Boolean(running)));
  }
});
