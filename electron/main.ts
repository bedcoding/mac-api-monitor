import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, session, type NativeImage } from 'electron';
import path from 'node:path';
import { Database, type NewEndpoint, type SettingsPatch, type EndpointType } from './db';
import { Scheduler, type ProbeResult } from './scheduler';
import { Notifier } from './notifier';
import { BrowserRunner } from './browserRunner';
import { seedIfEmpty } from './seed';
import { makeTrayIcon, type TrayLevel } from './windows/trayIcon';

let popover: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let scheduler: Scheduler;
let db: Database;
let notifier: Notifier;
let browserRunner: BrowserRunner;
let popoverPinned = false;
let lastBlurHideAt = 0;
// 종료 시퀀스 진입 플래그. 트레이/창이 파괴되는 도중의 클릭·콜백이
// 파괴된 객체를 건드려 예외를 내고(→ uncaughtException에 삼켜져) 종료가 막히는 걸 방지.
let isQuitting = false;

const lastStatusByEndpoint = new Map<number, 'healthy' | 'warning' | 'critical' | 'failure'>();

// 장시간 떠 있는 메뉴바 앱이라, 미처리 예외/거부가 프로세스 전체를 죽이지 않도록 로깅만 하고 살린다.
process.on('unhandledRejection', reason => {
  console.error('[main] unhandledRejection:', reason);
});
process.on('uncaughtException', err => {
  console.error('[main] uncaughtException:', err);
});

// 브라우저 로그인 상태 — 로그인 창에서 로그인 성공이 감지되면 'ok'로 바뀌고 모든 창에 broadcast.
// (앱 재시작 시 'unknown'으로 초기화 — 세션 쿠키는 살아있어도 유효성은 점검 화면 결과로 확인)
let browserSessionState: 'ok' | 'expired' | 'unknown' = 'unknown';

function broadcastBrowserSession() {
  const payload = { state: browserSessionState, checkedAt: Date.now() };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('browser:session-changed', payload);
  }
}

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

/** 렌더러 창의 외부 내비게이션/새 창을 차단 — 외부 링크는 shell.openExternal 로만 연다. */
function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    // 앱 자신의 렌더러(dev 서버 또는 file://)로의 내비게이션만 허용.
    const dev = rendererURL();
    const allowed = dev ? url.startsWith(dev) : url.startsWith('file://');
    if (!allowed) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
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
      sandbox: true,
    },
  });

  hardenWindow(popover);
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (rendererURL()) {
    popover.loadURL(`${rendererURL()}#popover`);
  } else {
    popover.loadFile(rendererFile(), { hash: 'popover' });
  }

  popover.on('blur', () => {
    if (popoverPinned) return;
    if (popover && !popover.isDestroyed() && !popover.webContents.isDevToolsOpened()) {
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
      sandbox: true,
    },
  });

  hardenWindow(mainWindow);

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
  // macOS: 빈 template 이미지 + setTitle로 메뉴바에 emoji 표시.
  // Windows/Linux: setTitle이 동작하지 않으므로 상태색 원(+개수) 아이콘을 직접 그린다.
  if (process.platform === 'darwin') {
    const img = nativeImage.createEmpty();
    img.setTemplateImage(true);
    return img;
  }
  return makeTrayIcon('none', 0);
}

function statusEmoji(): string {
  const statuses = Array.from(lastStatusByEndpoint.values());
  if (statuses.some(s => s === 'failure')) return '❌';
  if (statuses.some(s => s === 'critical')) return '🔴';
  if (statuses.some(s => s === 'warning')) return '🟡';
  if (statuses.length > 0) return '🟢';
  return '⚪';
}

function statusLevelAndCount(): { level: TrayLevel; count: number } {
  const statuses = Array.from(lastStatusByEndpoint.values());
  const failure = statuses.filter(s => s === 'failure').length;
  const critical = statuses.filter(s => s === 'critical').length;
  const warning = statuses.filter(s => s === 'warning').length;
  if (failure > 0) return { level: 'failure', count: failure };
  if (critical > 0) return { level: 'critical', count: critical };
  if (warning > 0) return { level: 'warning', count: warning };
  if (statuses.length > 0) return { level: 'healthy', count: 0 };
  return { level: 'none', count: 0 };
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const statuses = Array.from(lastStatusByEndpoint.values());
  const failure = statuses.filter(s => s === 'failure').length;
  const critical = statuses.filter(s => s === 'critical').length;
  const warning = statuses.filter(s => s === 'warning').length;

  if (process.platform === 'darwin') {
    // macOS: 메뉴바에 emoji + 개수 텍스트
    const emoji = statusEmoji();
    let title = emoji;
    if (failure > 0) title = `${emoji}${failure}`;
    else if (critical > 0) title = `${emoji}${critical}`;
    else if (warning > 0) title = `${emoji}${warning}`;
    tray.setTitle(title);
  } else {
    // Windows/Linux: 상태색 원 + 개수 숫자를 그린 동적 아이콘
    const { level, count } = statusLevelAndCount();
    tray.setImage(makeTrayIcon(level, count));
  }

  tray.setToolTip(
    `API Monitor — f:${failure} c:${critical} w:${warning} total:${statuses.length}`,
  );
}

function positionPopover() {
  if (!popover || popover.isDestroyed() || !tray || tray.isDestroyed()) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const [, ph] = popover.getSize();

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2);
  x = Math.max(dx + 8, Math.min(x, dx + dw - POPOVER_WIDTH - 8));

  // macOS는 메뉴바가 화면 상단이라 트레이 '아래'에 띄운다.
  // Windows/Linux는 트레이가 보통 우하단(작업표시줄)이라 '아래'로 띄우면 화면 밖으로 나간다.
  // → 트레이 '위'에 띄우고, 어느 쪽이든 workArea 안으로 클램프.
  let y =
    process.platform === 'darwin'
      ? Math.round(trayBounds.y + trayBounds.height + 4)
      : Math.round(trayBounds.y - ph - 4);
  y = Math.max(dy + 8, Math.min(y, dy + dh - ph - 8));

  popover.setPosition(x, y, false);
}

function togglePopover() {
  // 종료 중이거나 popover가 이미 파괴된 뒤의 트레이 클릭은 무시.
  // (popover 변수는 파괴돼도 null이 아니라, null 체크만으론 'Object has been destroyed'를 못 막음)
  if (isQuitting || !popover || popover.isDestroyed()) return;
  if (popover.isVisible()) {
    popover.hide();
  } else {
    // blur로 방금 닫힌 직후의 트레이 클릭은 "닫기 의도"였으므로 다시 열지 않음.
    // 안 그러면 trayClick → blur → hide → click → show 순으로 처리되어
    // 사용자가 닫으려고 누른 클릭이 도리어 popover를 다시 띄움.
    if (Date.now() - lastBlurHideAt < 250) return;
    positionPopover();
    popover.show();
    popover.focus();
  }
}

function createTray() {
  tray = new Tray(trayIconImage());
  updateTray();

  // macOS에서 OS가 빠른 두 클릭을 더블클릭으로 합쳐버려 click 이벤트가
  // 한 번만 발사되는 경우가 있다. 이걸 끄면 두 클릭이 각각 click으로 들어옴.
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

function classifyStatus(result: ProbeResult): 'healthy' | 'warning' | 'critical' | 'failure' {
  const s = db.getSettings();
  const ep = db.listEndpoints().find(e => e.id === result.endpointId);
  const cfg = s[ep?.type ?? 'feature'];
  if (!result.ok) return 'failure';
  if (result.durationMs >= cfg.critical_ms) return 'critical';
  if (result.durationMs >= cfg.warning_ms) return 'warning';
  return 'healthy';
}

/** http/https URL만 허용 — 임의 scheme(file: 등)·내부망 점검으로의 오남용 방지. */
function assertHttpUrl(url: string, label = 'url'): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${label}이(가) 올바른 URL이 아닙니다: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`${label}은(는) http(s) URL만 허용됩니다: ${url}`);
  }
}

function parseImport(json: string, forceType?: EndpointType): NewEndpoint[] {
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
      throw new Error(`endpoints[${i}]가 객체가 아닙니다.`);
    }
    const url = typeof ep.url === 'string' ? ep.url.trim() : '';
    if (!url) {
      throw new Error(`endpoints[${i}].url이 비어있습니다.`);
    }
    assertHttpUrl(url, `endpoints[${i}].url`);
    const rawType = typeof ep.type === 'string' ? ep.type.toLowerCase() : '';
    const type: EndpointType =
      forceType ??
      (rawType === 'health' ? 'health' : rawType === 'browser' ? 'browser' : 'feature');

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
  // Windows: 알림(토스트)이 올바른 앱 신원으로 뜨고 작업표시줄에서 묶이도록 AUMID 설정.
  // build.appId와 동일하게 맞춘다. (macOS/Linux에선 사실상 no-op)
  app.setAppUserModelId('com.local.mac-api-monitor');

  // 렌더러(popover/main)에 CSP 적용. 브라우저 점검 창은 persist:monitor 파티션이라 영향 없음.
  // dev는 Vite HMR(eval/ws) 때문에 느슨, 프로덕션(loadFile)은 엄격하게.
  const isDev = !!rendererURL();
  const csp = isDev
    ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: http://localhost:* http://127.0.0.1:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Windows/Linux는 Electron 기본 메뉴(File/Edit/View/Window/Help)가 창 안에 메뉴바로 붙는다.
  // 트레이/popover 앱이라 불필요한 노이즈 → 숨긴다.
  // macOS는 시스템 메뉴바에 있고 ⌘Q·복사/붙여넣기 단축키를 제공하므로 기본 메뉴 유지.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  db = new Database();
  notifier = new Notifier(db);
  scheduler = new Scheduler(db, notifier);
  browserRunner = new BrowserRunner();
  scheduler.setBrowserProbe(browserRunner);
  // '실제 동작 보기' 창을 사용자가 직접 닫으면 렌더러 체크박스도 풀리도록 broadcast.
  browserRunner.onVisibleChange = (visible: boolean) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('browser:visible-changed', { visible });
    }
  };

  seedIfEmpty(db);

  scheduler.onProbeComplete = result => {
    lastStatusByEndpoint.set(result.endpointId, classifyStatus(result));
    updateTray();
    // 브라우저 점검 결과로 로그인 세션 상태 갱신: 세션 만료 감지 시 'expired', 정상 진입 시 'ok'.
    // (일반 장애는 세션 유효성과 무관하므로 상태를 바꾸지 않는다)
    const ep = db.listEndpoints().find(e => e.id === result.endpointId);
    if (ep?.type === 'browser') {
      const next = result.sessionExpired ? 'expired' : result.ok ? 'ok' : browserSessionState;
      if (next !== browserSessionState) {
        browserSessionState = next;
        broadcastBrowserSession();
      }
    }
  };

  scheduler.start();

  createPopover();
  createTray();

  // dev 좀비 방지: macOS는 Electron을 launchd로 reparent 하므로(부모 PID=1),
  // Vite가 떠 있던 터미널을 닫아도 SIGHUP이 오지 않아 고아 프로세스로 살아남는다.
  // Vite(부모)가 사라지면 stdin이 EOF/close가 되는 걸 신호로 받아 함께 종료한다.
  // (터미널에 attach 된 동안엔 stdin이 안 닫히므로 dev 중 오작동 없음. 프로덕션은 isDev=false라 미적용)
  if (isDev) {
    const quitOnParentExit = () => app.quit();
    process.stdin.on('end', quitOnParentExit);
    process.stdin.on('close', quitOnParentExit);
    process.stdin.on('error', quitOnParentExit);
    process.stdin.resume();
  }
});

app.on('window-all-closed', () => {
  // 메뉴바 앱은 윈도우 없어도 계속 동작. 종료는 트레이 우클릭 → 종료.
});

app.on('before-quit', () => {
  isQuitting = true;
  // 점검 중단 → 브라우저 창 정리 → DB 연결 종료 순으로 깨끗이 종료(타이머/소켓/WAL 정리).
  scheduler?.stop();
  browserRunner?.destroy();
  db?.close();
  // 트레이를 명시적으로 제거하지 않으면 비정상 종료 시 메뉴바에 아이콘(좀비)이 남는다.
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});

ipcMain.handle('endpoints:list', () => db.listEndpoints());
ipcMain.handle('endpoints:add', (_e, ep: NewEndpoint) => {
  if (!ep || typeof ep.url !== 'string' || !ep.url.trim()) {
    throw new Error('url이 비어있습니다.');
  }
  const url = ep.url.trim();
  assertHttpUrl(url);
  return db.addEndpoint({
    method: ep.method ?? 'GET',
    url,
    label: ep.label?.trim() || url,
    note: ep.note ?? null,
    group: ep.group ?? null,
    type: ep.type === 'health' ? 'health' : ep.type === 'browser' ? 'browser' : 'feature',
  });
});
ipcMain.handle('endpoints:remove', (_e, id: number) => {
  db.removeEndpoint(id);
  lastStatusByEndpoint.delete(id);
  notifier.reset(id);
  updateTray();
});
ipcMain.handle('endpoints:import', (_e, json: string, forceType?: string) => {
  const ft =
    forceType === 'health' || forceType === 'feature' || forceType === 'browser'
      ? forceType
      : undefined;
  const eps = parseImport(json, ft);
  return db.addEndpointsBulk(eps);
});

ipcMain.handle('measurements:recent', (_e, endpointId: number, limit: number) =>
  db.recentMeasurements(endpointId, limit),
);

ipcMain.handle('events:recent', (_e, type: EndpointType, limit: number) =>
  db.recentAlarmEvents(type, limit),
);

ipcMain.handle('events:thresholdExceeded', (_e, type: EndpointType, limit: number) => {
  const s = db.getSettings();
  const cfg = s[type];
  return db.recentThresholdExceeded(type, cfg.warning_ms, cfg.critical_ms, limit);
});

ipcMain.handle('measurements:recentAll', (_e, type: EndpointType, perEndpoint: number) => {
  const s = db.getSettings();
  const cfg = s[type];
  return db.recentMeasurementsAll(type, cfg.warning_ms, cfg.critical_ms, perEndpoint);
});

ipcMain.handle('endpoints:stats', (_e, type: EndpointType, hours: number) => {
  const s = db.getSettings();
  const cfg = s[type];
  return db.recentEndpointStats(type, hours, cfg.warning_ms);
});

ipcMain.handle('slack:test', (_e, type: EndpointType) => notifier.testSlack(type));

ipcMain.handle('settings:get', () => db.getSettings());
ipcMain.handle('settings:update', (_e, patch: SettingsPatch) => {
  db.updateSettings(patch);
  const next = db.getSettings();
  scheduler.reconfigure(next);
  notifier.configure(next);
  // 브라우저 점검을 끄면(비상정지) 숨은 창을 즉시 닫아 진행 중 navigate까지 중단.
  if (next.browser.checks_enabled === 0) browserRunner?.destroy();
});

ipcMain.handle('probe:now', async (_e, endpointId: number) => {
  return scheduler.probeOnce(endpointId);
});

// 브라우저 점검: 사람이 1회 로그인할 창을 띄운다 (세션은 persist 파티션에 저장).
// 로그인 창이 로그인 페이지를 벗어나면(=로그인 성공) 자동 감지해 상태를 'ok'로 broadcast.
ipcMain.handle('browser:openLogin', () => {
  const cfg = db.getSettings().browser;
  return browserRunner.openLoginWindow(cfg.base_url, cfg.login_pattern, () => {
    browserSessionState = 'ok';
    broadcastBrowserSession();
  });
});

// 브라우저 로그인 상태 조회 — main이 추적 중인 값을 반환(프로빙 X). 실시간 갱신은 browser:session-changed 이벤트.
ipcMain.handle('browser:sessionStatus', () => ({
  state: browserSessionState,
  checkedAt: Date.now(),
}));

// '실제 동작 보기': 점검용 창을 보이게/숨기게 + 현재 가시성 조회.
ipcMain.handle('browser:setVisible', (_e, visible: boolean) => {
  browserRunner.setVisible(!!visible);
});
ipcMain.handle('browser:isVisible', () => browserRunner.isVisible());

// '지금 점검 실행': 등록된 브라우저 화면을 즉시 전부 1회 점검(순차) → 점검한 개수 반환.
// 비상정지(checks_enabled=0) 중이면 무시 — 자동 사이클(runCycle)과 동일하게 막는다.
ipcMain.handle('browser:runNow', () => {
  if (!db.getSettings().browser.checks_enabled) return 0;
  return scheduler.probeManyOfType('browser');
});

ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  shell.openExternal(url);
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
