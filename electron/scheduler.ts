import type { Database, Endpoint, EndpointType, Settings, TypeSettings } from './db';
import type { Notifier, Level } from './notifier';

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

  onProbeComplete: ((result: ProbeResult) => void) | null = null;

  constructor(
    private db: Database,
    private notifier: Notifier,
  ) {
    this.settings = db.getSettings();
    this.tracks = {
      health: new Track('health', this),
      feature: new Track('feature', this),
    };
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
    this.tracks.health.start();
    this.tracks.feature.start();
    this.schedulePrune();
  }

  stop() {
    this.tracks.health.stop();
    this.tracks.feature.stop();
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  reconfigure(settings: Settings) {
    this.settings = settings;
    this.tracks.health.reconfigure();
    this.tracks.feature.reconfigure();
  }

  private schedulePrune() {
    this.pruneTimer = setTimeout(() => {
      try {
        const deleted = this.db.pruneOldMeasurements(this.settings.retention_days);
        if (deleted > 0) console.log(`[scheduler] pruned ${deleted} old measurements`);
      } catch (e) {
        console.warn('[scheduler] prune failed:', e);
      }
      this.schedulePrune();
    }, PRUNE_EVERY_MS);
  }

  async probeOnce(endpointId: number): Promise<ProbeResult | null> {
    const ep = this.db.listEndpoints().find(e => e.id === endpointId);
    if (!ep) return null;
    return probe(this, ep);
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
    this.runCycle();
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
            const r = await probe(this.scheduler, ep);
            if (isCycle) {
              const cc = this.cfg();
              const level = classify(cc, r.durationMs, r.ok);
              cycleResults.push({
                group: ep.group?.trim() || '(미분류)',
                hit: level !== null,
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

async function probe(scheduler: Scheduler, ep: Endpoint): Promise<ProbeResult> {
  const cfg = scheduler.getSettings()[ep.type];
  const start = Date.now();
  let status = 0;
  let ok = false;

  const timeoutMs = Math.max(cfg.critical_ms * 2, 10_000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(ep.url, { method: ep.method, signal: ac.signal });
    status = res.status;
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - start;

  scheduler.getDb().recordMeasurement({
    endpoint_id: ep.id,
    ts: start,
    duration_ms: durationMs,
    status,
    ok: ok ? 1 : 0,
  });

  const level = classify(cfg, durationMs, ok);
  scheduler.getNotifier().observe(ep, level, durationMs, status);

  const result: ProbeResult = { endpointId: ep.id, ts: start, durationMs, status, ok };
  scheduler.emitProbeComplete(result);
  return result;
}
