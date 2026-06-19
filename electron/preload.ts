import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserSessionStatus } from '../src/shared/types';

// 렌더러가 신뢰하는 계약(src/shared/types의 Window['api'])에 노출 객체를 묶어,
// 채널/인자/반환 타입이 어긋나면 런타임이 아니라 tsc 단계에서 잡히게 한다.
type Api = Window['api'];

const api: Api = {
  listEndpoints: () => ipcRenderer.invoke('endpoints:list'),
  addEndpoint: ep => ipcRenderer.invoke('endpoints:add', ep),
  removeEndpoint: id => ipcRenderer.invoke('endpoints:remove', id),
  importEndpoints: (json, forceType) => ipcRenderer.invoke('endpoints:import', json, forceType),
  recentMeasurements: (endpointId, limit) =>
    ipcRenderer.invoke('measurements:recent', endpointId, limit),
  recentEvents: (type, limit) => ipcRenderer.invoke('events:recent', type, limit),
  recentThresholdExceeded: (type, limit) =>
    ipcRenderer.invoke('events:thresholdExceeded', type, limit),
  recentEndpointStats: (type, hours) => ipcRenderer.invoke('endpoints:stats', type, hours),
  recentMeasurementsAll: (type, perEndpoint) =>
    ipcRenderer.invoke('measurements:recentAll', type, perEndpoint),
  testSlack: type => ipcRenderer.invoke('slack:test', type),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  probeNow: endpointId => ipcRenderer.invoke('probe:now', endpointId),
  openBrowserLogin: () => ipcRenderer.invoke('browser:openLogin'),
  browserSessionStatus: () => ipcRenderer.invoke('browser:sessionStatus'),
  onBrowserSessionChange: cb => {
    const listener = (_e: unknown, s: BrowserSessionStatus) => cb(s);
    ipcRenderer.on('browser:session-changed', listener);
    return () => ipcRenderer.removeListener('browser:session-changed', listener);
  },
  setBrowserVisible: visible => ipcRenderer.invoke('browser:setVisible', visible),
  isBrowserVisible: () => ipcRenderer.invoke('browser:isVisible'),
  runBrowserChecksNow: () => ipcRenderer.invoke('browser:runNow'),
  onBrowserVisibleChange: cb => {
    const listener = (_e: unknown, payload: { visible: boolean }) => cb(payload.visible);
    ipcRenderer.on('browser:visible-changed', listener);
    return () => ipcRenderer.removeListener('browser:visible-changed', listener);
  },
  openMainWindow: () => ipcRenderer.invoke('window:openMain'),
  closePopover: () => ipcRenderer.invoke('window:closePopover'),
  setPopoverPinned: pinned => ipcRenderer.invoke('window:setPopoverPinned', pinned),
  setPopoverHeight: height => ipcRenderer.invoke('window:setPopoverHeight', height),
  openExternal: url => ipcRenderer.invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('api', api);
