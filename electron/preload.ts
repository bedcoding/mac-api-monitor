import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listEndpoints: () => ipcRenderer.invoke('endpoints:list'),
  addEndpoint: (ep: unknown) => ipcRenderer.invoke('endpoints:add', ep),
  removeEndpoint: (id: number) => ipcRenderer.invoke('endpoints:remove', id),
  importEndpoints: (json: string, forceType?: string) =>
    ipcRenderer.invoke('endpoints:import', json, forceType),
  recentMeasurements: (endpointId: number, hours: number) =>
    ipcRenderer.invoke('measurements:recent', endpointId, hours),
  recentEvents: (limit: number) => ipcRenderer.invoke('events:recent', limit),
  testSlack: (type: 'health' | 'feature') => ipcRenderer.invoke('slack:test', type),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  probeNow: (endpointId: number) => ipcRenderer.invoke('probe:now', endpointId),
  openMainWindow: () => ipcRenderer.invoke('window:openMain'),
  closePopover: () => ipcRenderer.invoke('window:closePopover'),
  setPopoverPinned: (pinned: boolean) =>
    ipcRenderer.invoke('window:setPopoverPinned', pinned),
  setPopoverHeight: (height: number) =>
    ipcRenderer.invoke('window:setPopoverHeight', height),
});
