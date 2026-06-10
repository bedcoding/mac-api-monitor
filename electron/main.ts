import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, type NativeImage } from 'electron';
import path from 'node:path';
import { Database, type NewEndpoint, type SettingsPatch } from './db';
import { Scheduler, type ProbeResult } from './scheduler';
import { Notifier } from './notifier';
import { seedIfEmpty } from './seed';

let popover: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let scheduler: Scheduler;
let db: Database;
let notifier: Notifier;
let popoverPinned = false;
let lastBlurHideAt = 0;

const lastStatusByEndpoint = new Map<number, 'healthy' | 'warning' | 'critical'>();

const POPOVER_WIDTH = 520;
const POPOVER_HEIGHT = 620;
const POPOVER_MIN_HEIGHT = 200;
const POPOVER_MAX_HEIGHT = 850;

function rendererURL(): string {
  return process.env.VITE_DEV_SERVER_URL ?? '';
}
function rendererFile(): string {
  return path.join(__dirname, '../dist/index.html');
}

function createPopover() {
  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (rendererURL()) {
    popover.loadURL(`${rendererURL()}#popover`);
  } else {
    popover.loadFile(rendererFile(), { hash: 'popover' });
  }

  popover.on('blur', () => {
    if (popoverPinned) return;
    if (popover && !popover.webContents.isDevToolsOpened()) {
      popover.hide();
      lastBlurHideAt = Date.now();
    }
  });
}

function openMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.dock?.show();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (rendererURL()) {
    mainWindow.loadURL(rendererURL());
  } else {
    mainWindow.loadFile(rendererFile());
  }

  if (process.platform === 'darwin') app.dock?.show();

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 메인 윈도우 닫히면 Dock 아이콘도 같이 숨김 (다른 윈도우 없을 때만)
    if (process.platform === 'darwin' && BrowserWindow.getAllWindows().filter(w => w !== popover).length === 0) {
      app.dock?.hide();
    }
  });
}

function trayIconImage(): NativeImage {
  // 빈 16×16 투명 이미지를 template 으로 만들고 상태는 setTitle 로 emoji.
  // (실제 아이콘 파일을 쓰려면 assets/tray.png 추가 후 nativeImage.createFromPath 로 교체)
  const img = nativeImage.createEmpty();
  img.setTemplateImage(true);
  return img;
}

function statusEmoji(): string {
  const statuses = Array.from(lastStatusByEndpoint.values());
  if (statuses.some(s => s === 'critical')) return '🔴';
  if (statuses.some(s => s === 'warning')) return '🟡';
  if (statuses.length > 0) return '🟢';
  return '⚪';
}

function updateTray() {
  if (!tray) return;
  const emoji = statusEmoji();
  const statuses = Array.from(lastStatusByEndpoint.values());
  const critical = statuses.filter(s => s === 'critical').length;
  const warning = statuses.filter(s => s === 'warning').length;

  let title = emoji;
  if (critical > 0) title = `${emoji}${critical}`;
  else if (warning > 0) title = `${emoji}${warning}`;

  tray.setTitle(title);
  tray.setToolTip(
    `API Monitor — c:${critical} w:${warning} total:${statuses.length}`,
  );
}

function positionPopover() {
  if (!popover || !tray) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { x: dx, y: dy, width: dw } = display.workArea;
  void dy;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2);
  x = Math.max(dx + 8, Math.min(x, dx + dw - POPOVER_WIDTH - 8));
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  popover.setPosition(x, y, false);
}

function togglePopover() {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
  } else {
    // blur 로 방금 닫힌 직후의 트레이 클릭은 "닫기 의도" 였으므로 다시 열지 않음.
    // 안 그러면 trayClick → blur → hide → click → show 순으로 처리되어
    // 사용자가 닫으려고 누른 클릭이 도리어 popover 를 다시 띄움.
    if (Date.now() - lastBlurHideAt < 250) return;
    positionPopover();
    popover.show();
    popover.focus();
  }
}

function createTray() {
  tray = new Tray(trayIconImage());
  updateTray();

  // macOS 에서 OS 가 빠른 두 클릭을 더블클릭으로 합쳐버려 click 이벤트가
  // 한 번만 발사되는 경우가 있다. 이걸 끄면 두 클릭이 각각 click 으로 들어옴.
  tray.setIgnoreDoubleClickEvents(true);

  tray.on('click', () => togglePopover());
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: '열기 / 닫기', click: () => togglePopover() },
      { label: '전체 보기', click: () => openMainWindow() },
      { type: 'separator' },
      {
        label: 'DevTools (popover)',
        click: () => popover?.webContents.openDevTools({ mode: 'detach' }),
      },
      {
        label: 'DevTools (main)',
        click: () => mainWindow?.webContents.openDevTools(),
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });
}

function classifyStatus(result: ProbeResult): 'healthy' | 'warning' | 'critical' {
  const s = db.getSettings();
  const ep = db.listEndpoints().find(e => e.id === result.endpointId);
  const cfg = ep?.type === 'health' ? s.health : s.feature;
  if (!result.ok || result.durationMs >= cfg.critical_ms) return 'critical';
  if (result.durationMs >= cfg.warning_ms) return 'warning';
  return 'healthy';
}

function parseImport(json: string, forceType?: 'health' | 'feature'): NewEndpoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON 파싱 실패: ${(e as Error).message}`);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { endpoints?: unknown }).endpoints)
  ) {
    throw new Error('포맷이 잘못되었습니다. { "version": 1, "endpoints": [...] } 형식이어야 합니다.');
  }

  const items = (parsed as { endpoints: unknown[] }).endpoints;
  const result: NewEndpoint[] = [];

  for (let i = 0; i < items.length; i++) {
    const ep = items[i] as Record<string, unknown> | null;
    if (!ep || typeof ep !== 'object') {
      throw new Error(`endpoints[${i}] 가 객체가 아닙니다.`);
    }
    const url = typeof ep.url === 'string' ? ep.url.trim() : '';
    if (!url) {
      throw new Error(`endpoints[${i}].url이 비어있습니다.`);
    }
    const rawType = typeof ep.type === 'string' ? ep.type.toLowerCase() : '';
    const type = forceType ?? (rawType === 'health' ? 'health' : 'feature');

    result.push({
      method: typeof ep.method === 'string' ? ep.method : 'GET',
      url,
      label: typeof ep.label === 'string' && ep.label.trim() ? ep.label : url,
      note: typeof ep.note === 'string' ? ep.note : null,
      group: typeof ep.group === 'string' ? ep.group : null,
      type,
    });
  }

  return result;
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  db = new Database();
  notifier = new Notifier(db);
  scheduler = new Scheduler(db, notifier);

  seedIfEmpty(db);

  scheduler.onProbeComplete = result => {
    lastStatusByEndpoint.set(result.endpointId, classifyStatus(result));
    updateTray();
  };

  scheduler.start();

  createPopover();
  createTray();
});

app.on('window-all-closed', () => {
  // 메뉴바 앱은 윈도우 없어도 계속 동작. 종료는 트레이 우클릭 → 종료.
});

ipcMain.handle('endpoints:list', () => db.listEndpoints());
ipcMain.handle('endpoints:add', (_e, ep: NewEndpoint) => {
  if (!ep || typeof ep.url !== 'string' || !ep.url.trim()) {
    throw new Error('url이 비어있습니다.');
  }
  return db.addEndpoint({
    method: ep.method ?? 'GET',
    url: ep.url.trim(),
    label: ep.label?.trim() || ep.url.trim(),
    note: ep.note ?? null,
    group: ep.group ?? null,
    type: ep.type === 'health' ? 'health' : 'feature',
  });
});
ipcMain.handle('endpoints:remove', (_e, id: number) => {
  db.removeEndpoint(id);
  lastStatusByEndpoint.delete(id);
  notifier.reset(id);
  updateTray();
});
ipcMain.handle('endpoints:import', (_e, json: string, forceType?: string) => {
  const ft = forceType === 'health' || forceType === 'feature' ? forceType : undefined;
  const eps = parseImport(json, ft);
  return db.addEndpointsBulk(eps);
});

ipcMain.handle('measurements:recent', (_e, endpointId: number, hours: number) =>
  db.recentMeasurements(endpointId, hours),
);

ipcMain.handle('events:recent', (_e, limit: number) => db.recentAlarmEvents(limit));

ipcMain.handle('events:thresholdExceeded', (_e, type: 'health' | 'feature', limit: number) => {
  const s = db.getSettings();
  const cfg = type === 'health' ? s.health : s.feature;
  return db.recentThresholdExceeded(type, cfg.warning_ms, cfg.critical_ms, limit);
});

ipcMain.handle('slack:test', (_e, type: 'health' | 'feature') => notifier.testSlack(type));

ipcMain.handle('settings:get', () => db.getSettings());
ipcMain.handle('settings:update', (_e, patch: SettingsPatch) => {
  db.updateSettings(patch);
  const next = db.getSettings();
  scheduler.reconfigure(next);
  notifier.configure(next);
});

ipcMain.handle('probe:now', async (_e, endpointId: number) => {
  return scheduler.probeOnce(endpointId);
});

ipcMain.handle('window:openMain', () => openMainWindow());
ipcMain.handle('window:closePopover', () => popover?.hide());
ipcMain.handle('window:setPopoverPinned', (_e, pinned: boolean) => {
  popoverPinned = !!pinned;
});
ipcMain.handle('window:setPopoverHeight', (_e, height: number) => {
  if (!popover) return;
  const clamped = Math.max(POPOVER_MIN_HEIGHT, Math.min(POPOVER_MAX_HEIGHT, Math.round(height)));
  const [w] = popover.getSize();
  popover.setSize(w, clamped, true);
});
