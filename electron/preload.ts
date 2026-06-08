import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  listEndpoints: () => ipcRenderer.invoke('endpoints:list'),
  addEndpoint: (ep: unknown) => ipcRenderer.invoke('endpoints:add', ep),
  removeEndpoint: (id: number) => ipcRenderer.invoke('endpoints:remove', id),
  importEndpoints: (json: string) => ipcRenderer.invoke('endpoints:import', json),
  recentMeasurements: (endpointId: number, hours: number) =>
    ipcRenderer.invoke('measurements:recent', endpointId, hours),
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
