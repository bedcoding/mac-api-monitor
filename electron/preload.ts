import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listEndpoints: () => ipcRenderer.invoke('endpoints:list'),
  addEndpoint: (ep: unknown) => ipcRenderer.invoke('endpoints:add', ep),
  removeEndpoint: (id: number) => ipcRenderer.invoke('endpoints:remove', id),
  importEndpoints: (json: string, forceType?: string) =>
    ipcRenderer.invoke('endpoints:import', json, forceType),
  recentMeasurements: (endpointId: number, limit: number) =>
    ipcRenderer.invoke('measurements:recent', endpointId, limit),
  recentEvents: (type: 'health' | 'feature', limit: number) =>
    ipcRenderer.invoke('events:recent', type, limit),
  recentThresholdExceeded: (type: 'health' | 'feature', limit: number) =>
    ipcRenderer.invoke('events:thresholdExceeded', type, limit),
  recentEndpointStats: (type: 'health' | 'feature', hours: number) =>
    ipcRenderer.invoke('endpoints:stats', type, hours),
  recentMeasurementsAll: (type: 'health' | 'feature', perEndpoint: number) =>
    ipcRenderer.invoke('measurements:recentAll', type, perEndpoint),
  testSlack: (type: 'health' | 'feature') => ipcRenderer.invoke('slack:test', type),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  probeNow: (endpointId: number) => ipcRenderer.invoke('probe:now', endpointId),
  openBrowserLogin: () => ipcRenderer.invoke('browser:openLogin'),
  browserSessionStatus: () => ipcRenderer.invoke('browser:sessionStatus'),
  onBrowserSessionChange: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('browser:session-changed', listener);
    return () => ipcRenderer.removeListener('browser:session-changed', listener);
  },
  setBrowserVisible: (visible: boolean) => ipcRenderer.invoke('browser:setVisible', visible),
  isBrowserVisible: () => ipcRenderer.invoke('browser:isVisible'),
  runBrowserChecksNow: () => ipcRenderer.invoke('browser:runNow'),
  onBrowserVisibleChange: (cb: (visible: boolean) => void) => {
    const listener = (_e: unknown, payload: { visible: boolean }) => cb(payload.visible);
    ipcRenderer.on('browser:visible-changed', listener);
    return () => ipcRenderer.removeListener('browser:visible-changed', listener);
  },
  openMainWindow: () => ipcRenderer.invoke('window:openMain'),
  closePopover: () => ipcRenderer.invoke('window:closePopover'),
  setPopoverPinned: (pinned: boolean) =>
    ipcRenderer.invoke('window:setPopoverPinned', pinned),
  setPopoverHeight: (height: number) =>
    ipcRenderer.invoke('window:setPopoverHeight', height),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});
