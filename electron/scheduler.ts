import type { Database, Endpoint, EndpointType, Settings, TypeSettings } from './db';
import type { Notifier, Level } from './notifier';
import type { BrowserProbe } from './probeTypes';
import { fetchProbe } from './fetchProbe';
import { browserProbe } from './browserProbe';

export interface ProbeResult {
  endpointId: number;
  ts: number;
  durationMs: number;
  status: number;
  ok: boolean;
}

const PRUNE_EVERY_MS = 50 * 60_000; // 50분마다 retention prune

export class Scheduler {
  private settings: Settings;
  private tracks: Record<EndpointType, Track>;
  private pruneTimer: NodeJS.Timeout | null = null;
  private browserProbe: BrowserProbe | null = null;

  onProbeComplete: ((result: ProbeResult) => void) | null = null;

  constructor(
    private db: Database,
    private notifier: Notifier,
  ) {
    this.settings = db.getSettings();
    this.tracks = {
      health: new Track('health', this),
      feature: new Track('feature', this),
      browser: new Track('browser', this),
    };
  }

  /** main 프로세스가 Electron 기반 브라우저 러너를 주입한다. */
  setBrowserProbe(p: BrowserProbe) {
    this.browserProbe = p;
  }

  /** Track 들이 접근하는 헬퍼 */
  getSettings() {
    return this.settings;
  }
  getDb() {
    return this.db;
  }
  getNotifier() {
    return this.notifier;
  }
  emitProbeComplete(r: ProbeResult) {
    this.onProbeComplete?.(r);
  }

  start() {
    for (const t of Object.values(this.tracks)) t.start();
    this.schedulePrune();
  }

  stop() {
    for (const t of Object.values(this.tracks)) t.stop();
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  reconfigure(settings: Settings) {
    this.settings = settings;
    for (const t of Object.values(this.tracks)) t.reconfigure();
  }

  private schedulePrune() {
    this.pruneTimer = setTimeout(() => {
      try {
        const h = this.db.pruneOldByType('health', this.settings.health.retention_days);
        const f = this.db.pruneOldByType('feature', this.settings.feature.retention_days);
        const b = this.db.pruneOldByType('browser', this.settings.browser.retention_days);
        const total = h + f + b;
        if (total > 0) {
          console.log(`[scheduler] pruned ${total} (health=${h}, feature=${f}, browser=${b})`);
        }
      } catch (e) {
        console.warn('[scheduler] prune failed:', e);
      }
      this.schedulePrune();
    }, PRUNE_EVERY_MS);
  }

  async probeOnce(endpointId: number): Promise<ProbeResult | null> {
    const ep = this.db.listEndpoints().find(e => e.id === endpointId);
    if (!ep) return null;
    return this.runProbe(ep);
  }

  /** 해당 type 의 등록 endpoint 를 지금 즉시 전부 1회 점검(순차). '지금 점검 실행' 버튼용. */
  async probeManyOfType(type: EndpointType): Promise<number> {
    const eps = this.db.listEndpoints().filter(e => e.type === type);
    for (const ep of eps) {
      try {
        await this.runProbe(ep);
      } catch {
        /* 개별 실패는 무시하고 다음 화면 계속 */
      }
    }
    return eps.length;
  }

  /**
   * 점검 1회 실행 → 측정 기록 + 알람 관찰 + 이벤트 emit.
   * 점검 방식(fetch / browser)만 전략으로 분기하고, 기록·알람 등 공통 처리는 여기 한 곳.
   */
  async runProbe(ep: Endpoint): Promise<ProbeResult> {
    const cfg = this.settings[ep.type];
    const raw =
      ep.type === 'browser'
        ? await browserProbe(this.browserProbe, ep, cfg)
        : await fetchProbe(ep, cfg);

    this.db.recordMeasurement({
      endpoint_id: ep.id,
      ts: raw.ts,
      duration_ms: raw.durationMs,
      status: raw.status,
      ok: raw.ok ? 1 : 0,
      body: raw.body,
    });

    // suppressAlarm(예: 세션 만료)은 장애가 아니므로 알람 관찰을 건너뛰고 연속 카운터만 리셋.
    if (raw.suppressAlarm) {
      this.notifier.reset(ep.id);
    } else {
      this.notifier.observe(ep, classify(cfg, raw.durationMs, raw.ok), raw.durationMs, raw.status);
    }

    const result: ProbeResult = {
      endpointId: ep.id,
      ts: raw.ts,
      durationMs: raw.durationMs,
      status: raw.status,
      ok: raw.ok,
    };
    this.emitProbeComplete(result);
    return result;
  }
}

/**
 * type 별 독립 트랙.
 * 한 사이클마다 자기 type 의 endpoint 들을 stagger 간격으로 순차 발사하고,
 * 사이클 시작 기준 interval_ms 후 다음 사이클 시작.
 */
class Track {
  private cycleTimer: NodeJS.Timeout | null = null;
  private staggerTimers: NodeJS.Timeout[] = [];
  private stopped = true;

  constructor(
    private type: EndpointType,
    private scheduler: Scheduler,
  ) {}

  private cfg(): TypeSettings {
    return this.scheduler.getSettings()[this.type];
  }

  start() {
    this.stopped = false;
    // 재시작할 때마다 즉시 전체 측정을 쏘면 잦은 재시작(dev 모드 등)에서
    // API 호출이 폭주한다. 마지막 측정 시각 기준으로 남은 주기만큼 기다렸다 시작.
    const last = this.scheduler.getDb().lastMeasurementTs(this.type);
    const elapsed = last === null ? Infinity : Date.now() - last;
    const remaining = this.cfg().interval_ms - elapsed;
    if (remaining <= 0) {
      this.runCycle();
    } else {
      console.log(`[scheduler] ${this.type}: 직전 측정 후 ${Math.round(elapsed / 1000)}초 경과, ${Math.round(remaining / 1000)}초 뒤 사이클 시작`);
      this.cycleTimer = setTimeout(() => this.runCycle(), remaining);
    }
  }

  stop() {
    this.stopped = true;
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.cycleTimer = null;
    for (const t of this.staggerTimers) clearTimeout(t);
    this.staggerTimers = [];
  }

  reconfigure() {
    // 진행 중 사이클은 그대로 두고, 다음 사이클부터 새 설정 적용.
  }

  private runCycle() {
    if (this.stopped) return;

    const cfg = this.cfg();

    // 비상정지(checks_enabled=0): 자동 사이클을 건너뛰되, 다음 사이클은 예약해 둬서
    // 다시 켜면 끊김 없이 이어진다. (현재 UI 는 browser 만 끄게 노출)
    if (!cfg.checks_enabled) {
      this.cycleTimer = setTimeout(() => this.runCycle(), Math.max(5_000, cfg.interval_ms));
      return;
    }

    const endpoints = this.scheduler
      .getDb()
      .listEndpoints()
      .filter(e => e.type === this.type);

    const stagger = Math.max(0, cfg.stagger_ms);
    this.staggerTimers = [];

    const isCycle = cfg.alarm_mode === 'cycle';
    const cycleResults: Array<{ group: string; hit: boolean; level: Level | null }> = [];
    const probePromises: Promise<void>[] = [];

    endpoints.forEach((ep, i) => {
      const delay = stagger * i;
      const p = new Promise<void>(resolve => {
        const t = setTimeout(async () => {
          if (this.stopped) return resolve();
          try {
            const r = await this.scheduler.runProbe(ep);
            if (isCycle) {
              const cc = this.cfg();
              const level = classify(cc, r.durationMs, r.ok);
              cycleResults.push({
                group: ep.group?.trim() || '(미분류)',
                hit: level === 'critical', // 🔴심각만 hit (🟡주의는 알람 무관)
                level,
              });
            }
          } catch {
            /* ignore */
          } finally {
            resolve();
          }
        }, delay);
        this.staggerTimers.push(t);
      });
      probePromises.push(p);
    });

    // cycle 모드: 모든 probe 끝나면 그룹 일괄 판정
    if (isCycle) {
      Promise.all(probePromises).then(() => {
        if (this.stopped) return;
        this.scheduler.getNotifier().observeCycle(this.type, cycleResults);
      });
    }

    // 다음 사이클: interval_ms 와 "stagger 로 다 쏘는 시간" 중 큰 쪽 + 약간 여유
    const spread = stagger * Math.max(0, endpoints.length - 1);
    const nextDelay = Math.max(cfg.interval_ms, spread + 1_000);

    this.cycleTimer = setTimeout(() => this.runCycle(), nextDelay);
  }
}

function classify(cfg: TypeSettings, durationMs: number, ok: boolean): Level | null {
  if (!ok || durationMs >= cfg.critical_ms) return 'critical';
  if (durationMs >= cfg.warning_ms) return 'warning';
  return null;
}
