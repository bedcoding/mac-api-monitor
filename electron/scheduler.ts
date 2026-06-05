import type { Database, Endpoint, Settings } from './db';
import type { Notifier, Level } from './notifier';

export interface ProbeResult {
  endpointId: number;
  ts: number;
  durationMs: number;
  status: number;
  ok: boolean;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private settings: Settings;
  private busy = false;
  private stopped = true;
  private tickCount = 0;

  onProbeComplete: ((result: ProbeResult) => void) | null = null;

  constructor(
    private db: Database,
    private notifier: Notifier,
  ) {
    this.settings = db.getSettings();
  }

  start() {
    this.stopped = false;
    this.scheduleNext(0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reconfigure(settings: Settings) {
    this.settings = settings;
    // 진행 중인 tick 은 끝까지 두고, 다음 tick 부터 새 interval 적용.
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick() {
    if (this.busy) {
      // 이전 tick 이 아직 안 끝났으면 skip — 다음 interval 에 재시도
      this.scheduleNext(this.settings.interval_ms);
      return;
    }
    this.busy = true;
    try {
      const endpoints = this.db.listEndpoints();
      await Promise.all(endpoints.map(ep => this.probe(ep)));

      // retention prune: 매 tick 마다는 과함, 100 tick 마다 (30초 × 100 = 50분)
      this.tickCount++;
      if (this.tickCount % 100 === 0) {
        try {
          const deleted = this.db.pruneOldMeasurements(this.settings.retention_days);
          if (deleted > 0) {
            console.log(`[scheduler] pruned ${deleted} old measurements`);
          }
        } catch (e) {
          console.warn('[scheduler] prune failed:', e);
        }
      }
    } finally {
      this.busy = false;
      this.scheduleNext(this.settings.interval_ms);
    }
  }

  async probeOnce(endpointId: number): Promise<ProbeResult | null> {
    const ep = this.db.listEndpoints().find(e => e.id === endpointId);
    if (!ep) return null;
    return this.probe(ep);
  }

  private async probe(ep: Endpoint): Promise<ProbeResult> {
    const start = Date.now();
    let status = 0;
    let ok = false;

    const timeoutMs = Math.max(this.settings.critical_ms * 2, 10_000);
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

    this.db.recordMeasurement({
      endpoint_id: ep.id,
      ts: start,
      duration_ms: durationMs,
      status,
      ok: ok ? 1 : 0,
    });

    const level = this.classify(durationMs, ok);
    this.notifier.observe(ep, level, durationMs, status);

    const result: ProbeResult = { endpointId: ep.id, ts: start, durationMs, status, ok };
    this.onProbeComplete?.(result);
    return result;
  }

  private classify(durationMs: number, ok: boolean): Level | null {
    if (!ok || durationMs >= this.settings.critical_ms) return 'critical';
    if (durationMs >= this.settings.warning_ms) return 'warning';
    return null;
  }
}
