import { app, BrowserWindow } from 'electron';

/**
 * 브라우저 점검 실행기.
 *
 * 핵심 아이디어: 자동 로그인을 하지 않는다. 사람이 "로그인 창"에서 1회 직접 로그인하면
 * 그 세션(쿠키/스토리지)이 `persist:monitor` 파티션에 저장되고, 모니터는 같은 파티션의
 * 숨은 창으로 각 화면을 navigate 하기만 한다. 세션이 디스크에 영속되므로 앱을 껐다 켜도
 * 로그인이 유지된다.
 *
 * - run(): 화면 1개 진입 점검. 동시에 여러 navigate 가 한 창에서 충돌하지 않도록 순차 큐로 직렬화.
 * - openLoginWindow(): 보이는 창을 띄워 사람이 로그인하게 한다. 창이 로그인 페이지를 벗어나면 로그인 성공으로 감지.
 */

const PARTITION = 'persist:monitor';

export interface BrowserRunResult {
  ok: boolean;
  status: number; // 메인 프레임 HTTP 상태 (0 = 알 수 없음/네트워크 오류)
  durationMs: number;
  body: string | null; // 실패/특이사항 단서 (성공이면 보통 null)
  loginRedirect: boolean; // 로그인 페이지로 튕김 = 세션 만료
}

function platformToken(): string {
  if (process.platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  if (process.platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  return 'X11; Linux x86_64';
}

/** Electron 기본 UA 에는 "Electron/..." 토큰이 박혀 일부 사이트가 다르게 굴 수 있다. 평범한 Chrome 처럼 보이게. */
function userAgent(): string {
  const chrome = process.versions.chrome || '120.0.0.0';
  return `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** p 가 ms 안에 안 끝나면 onTimeout 호출 후 reject. */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        onTimeout();
      } catch {
        /* ignore */
      }
      reject(new Error(`응답시간 초과 (${ms}ms)`));
    }, ms);
    p.then(
      v => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class BrowserRunner {
  private hidden: BrowserWindow | null = null;
  private loginWindow: BrowserWindow | null = null;
  private loginNavCleanup: (() => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** navigate 들을 한 번에 하나씩만 돌린다(한 창 공유). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    // 큐 자체는 에러를 삼켜 체인이 끊기지 않게.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private ensureHidden(): BrowserWindow {
    if (this.hidden && !this.hidden.isDestroyed()) return this.hidden;
    this.hidden = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: PARTITION,
        backgroundThrottling: false, // 숨은 창이라도 타이머/렌더가 멈추지 않게
      },
    });
    // 점검용 숨은 창은 팝업(window.open)을 전부 차단 — 페이지가 새 창을 띄워 폭주(옴닉사태)하는 것 원천 봉쇄.
    this.hidden.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return this.hidden;
  }

  /**
   * 화면 1개 진입 점검.
   * - 메인 프레임 HTTP 상태, 최종 URL(로그인 리다이렉트 여부), 콘솔 에러 수를 본다.
   */
  run(url: string, opts: { timeoutMs: number; loginPattern: string }): Promise<BrowserRunResult> {
    return this.enqueue(() => this.doRun(url, opts));
  }

  private async doRun(
    url: string,
    opts: { timeoutMs: number; loginPattern: string },
  ): Promise<BrowserRunResult> {
    const win = this.ensureHidden();
    const wc = win.webContents;

    let status = 0;
    let consoleErrors = 0;
    const onConsole = (_e: unknown, level: number) => {
      // Electron 31: level 3 = error
      if (typeof level === 'number' && level >= 3) consoleErrors++;
    };
    const onNavigate = (_e: unknown, _url: string, httpResponseCode?: number) => {
      if (typeof httpResponseCode === 'number' && httpResponseCode > 0) status = httpResponseCode;
    };
    wc.on('console-message', onConsole);
    wc.on('did-navigate', onNavigate);

    const start = Date.now();
    let ok = false;
    let body: string | null = null;
    let loginRedirect = false;

    try {
      await withTimeout(wc.loadURL(url, { userAgent: userAgent() }), opts.timeoutMs, () =>
        wc.stop(),
      );
      // 클라이언트(JS) 리다이렉트가 로드 직후 일어날 수 있어 잠깐 기다렸다 최종 URL 확인.
      await delay(600);
      const finalUrl = wc.getURL();
      loginRedirect = !!opts.loginPattern && finalUrl.includes(opts.loginPattern);

      if (loginRedirect) {
        ok = false;
        body = `SESSION_EXPIRED: 로그인 페이지로 이동됨 — 재로그인 필요 (${finalUrl})`;
      } else if (status >= 400) {
        ok = false;
        body = `HTTP ${status} · ${finalUrl}`;
      } else {
        ok = true;
        if (consoleErrors > 0) body = `로드 성공 · 콘솔 에러 ${consoleErrors}건`;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 리다이렉트로 원래 내비게이션이 교체되면 ERR_ABORTED 가 나지만 실제 페이지는 떴을 수 있다.
      // 이때는 실패로 단정하지 말고 최종 URL 로 다시 판정한다.
      if (/ERR_ABORTED/i.test(msg)) {
        await delay(600);
        const finalUrl = wc.getURL();
        loginRedirect = !!opts.loginPattern && finalUrl.includes(opts.loginPattern);
        if (loginRedirect) {
          ok = false;
          body = `SESSION_EXPIRED: 로그인 페이지로 이동됨 — 재로그인 필요 (${finalUrl})`;
        } else if (finalUrl && finalUrl !== 'about:blank' && status < 400) {
          ok = true;
          if (consoleErrors > 0) body = `로드 성공(리다이렉트) · 콘솔 에러 ${consoleErrors}건`;
        } else {
          ok = false;
          body = `로드 중단(ERR_ABORTED) · ${finalUrl || '알 수 없음'}`;
        }
      } else {
        ok = false;
        body = `로드 실패: ${msg}`.slice(0, 2048);
      }
    } finally {
      wc.off('console-message', onConsole);
      wc.off('did-navigate', onNavigate);
    }

    return { ok, status, durationMs: Date.now() - start, body, loginRedirect };
  }

  /**
   * 로그인 성공 자동 감지를 붙인다(기존 감지가 있으면 갈아끼움).
   * 같은 사이트(origin) 안에서 로그인 경로를 벗어나면 = 로그인 성공으로 보고 onLogin() 을 1회 호출.
   * SNS 로그인 중 외부 도메인(kakao 등)으로 가는 건 origin 이 달라 무시된다.
   */
  private attachLoginDetection(
    win: BrowserWindow,
    url: string,
    loginPattern: string,
    onLogin: () => void,
  ) {
    this.loginNavCleanup?.(); // 재오픈 시 이전 감지(fired=true 로 굳은 것 포함) 제거하고 새로 시작
    let baseOrigin = '';
    try {
      baseOrigin = new URL(url).origin;
    } catch {
      /* ignore */
    }

    // 주소창이 없는 창이라 "지금 어느 URL인지"를 제목줄에 표시한다(주소창 대용, 입력은 안 됨).
    const setUrlTitle = () => {
      if (!win.isDestroyed()) win.setTitle(win.webContents.getURL() || url);
    };
    // 페이지가 document.title 로 창 제목을 덮어쓰는 것 막고 URL 을 유지.
    const onTitle = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      setUrlTitle();
    };

    let fired = false;
    const onNav = (_e: unknown, navUrl: string) => {
      setUrlTitle();
      if (fired || !baseOrigin) return;
      if (navUrl.startsWith(baseOrigin) && (!loginPattern || !navUrl.includes(loginPattern))) {
        fired = true;
        onLogin();
      }
    };
    win.webContents.on('did-navigate', onNav);
    win.webContents.on('did-navigate-in-page', onNav);
    win.webContents.on('page-title-updated', onTitle);
    this.loginNavCleanup = () => {
      if (!win.isDestroyed()) {
        win.webContents.off('did-navigate', onNav);
        win.webContents.off('did-navigate-in-page', onNav);
        win.webContents.off('page-title-updated', onTitle);
      }
      this.loginNavCleanup = null;
    };
  }

  /**
   * 보이는 창을 띄워 사람이 직접 로그인하게 한다. 세션은 파티션에 영속된다.
   * 이미 창이 열려 있으면 로그인 페이지를 다시 불러오고 감지를 리셋한다
   * (이미 로그인돼 있으면 사이트가 로그인 페이지에서 홈으로 튕겨내 '로그인됨'이 재확정됨).
   */
  openLoginWindow(
    url: string,
    loginPattern: string,
    onLogin: () => void,
  ): { ok: boolean; message: string } {
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, message: '설정에서 로그인 페이지 URL을 먼저 입력하세요.' };
    }
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      const win = this.loginWindow;
      this.attachLoginDetection(win, url, loginPattern, onLogin);
      win.loadURL(url, { userAgent: userAgent() });
      win.show();
      win.focus();
      return { ok: true, message: '로그인 페이지를 다시 불러왔습니다.' };
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 820,
      title: '모니터링 로그인 — 여기서 1회 로그인하면 세션이 저장됩니다',
      webPreferences: {
        partition: PARTITION,
      },
    });
    this.loginWindow = win;
    if (process.platform === 'darwin') app.dock?.show();

    this.attachLoginDetection(win, url, loginPattern, onLogin);

    win.loadURL(url, { userAgent: userAgent() });
    win.on('closed', () => {
      this.loginNavCleanup?.();
      this.loginWindow = null;
    });
    return { ok: true, message: '로그인 창을 열었습니다. 로그인하면 자동으로 감지됩니다.' };
  }

  destroy() {
    for (const w of [this.hidden, this.loginWindow]) {
      if (w && !w.isDestroyed()) w.destroy();
    }
    this.hidden = null;
    this.loginWindow = null;
  }
}
