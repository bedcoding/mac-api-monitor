import { Notification } from 'electron';
import type { Database, Endpoint, Settings, TypeSettings, SlackStatus } from './db';

export type Level = 'warning' | 'critical';

const SLACK_TIMEOUT_MS = 10_000;
const SLACK_MAX_RETRY = 2; // 5xx/429/네트워크/타임아웃 시 추가 재시도 횟수

interface ConsecutiveState {
  consecutive: number;
  lastFiredAt: number;
}

interface SlidingState {
  window: boolean[]; // 최근 측정들: true = 🔴심각 (warning은 알람 대상 아님)
  lastFiredAt: number;
}

function groupKey(ep: Endpoint): string {
  return `${ep.type}::${ep.group?.trim() || '(미분류)'}`;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class Notifier {
  private settings: Settings;
  private consecutiveState = new Map<number, ConsecutiveState>();
  private slidingState = new Map<string, SlidingState>();
  private cycleState = new Map<string, SlidingState>(); // cycle 모드 전용 (sliding과 키 충돌 방지)
  private persistedCooldown = new Map<string, number>(); // `${type}::${group}` → 마지막 알람 ts (재시작 복원)
  private firing = new Map<string, boolean>(); // 복구 알림용 — 현재 "알람 발사됨" 상태인 키 추적

  constructor(private db: Database) {
    this.settings = db.getSettings();
    // 재시작해도 쿨다운이 유지되도록 DB의 마지막 알람 시각을 복원
    // (장애 중 재시작 시 방금 보낸 알람이 즉시 재발송되는 것 방지).
    for (const r of db.lastAlarmAtByGroup()) {
      this.persistedCooldown.set(`${r.type}::${r.group_name}`, r.ts);
    }
  }

  configure(settings: Settings) {
    this.settings = settings;
  }

  reset(endpointId: number) {
    this.consecutiveState.delete(endpointId);
    this.firing.delete(`c:${endpointId}`);
    // 슬라이딩/사이클은 group 단위라 endpoint 제거만으론 정리 어려움 — 다음 측정에 자연 갱신.
  }

  observe(ep: Endpoint, level: Level | null, durationMs: number, status: number) {
    const cfg = this.settings[ep.type];
    if (!cfg.alarms_enabled) return;

    if (cfg.alarm_mode === 'cycle') {
      // cycle 모드는 사이클 끝에 observeCycle로 일괄 판정. per-probe는 무시.
      return;
    }
    if (cfg.alarm_mode === 'sliding') {
      this.observeSliding(ep, cfg, level, durationMs, status);
    } else {
      this.observeConsecutive(ep, cfg, level, durationMs, status);
    }
  }

  /**
   * 한 사이클(전체 endpoint 1회씩) 종료 시 호출.
   * type+group 별로 "🔴심각 endpoint 비율"이 임계치 이상이면 그룹 알람 1건, 심각 0건이면 복구 1건.
   */
  observeCycle(
    type: Endpoint['type'],
    results: Array<{ group: string; hit: boolean; level: Level | null }>,
  ) {
    const cfg = this.settings[type];
    if (!cfg.alarms_enabled) return;
    if (cfg.alarm_mode !== 'cycle') return;

    // group 별 집계 — hit = 🔴심각만 카운트. 🟡주의는 무시.
    const byGroup = new Map<string, { total: number; hits: number }>();
    for (const r of results) {
      const g = byGroup.get(r.group) ?? { total: 0, hits: 0 };
      g.total += 1;
      if (r.level === 'critical') g.hits += 1;
      byGroup.set(r.group, g);
    }

    const now = Date.now();
    const pctThreshold = Math.max(0, Math.min(100, cfg.alarm_cycle_percent));

    for (const [group, agg] of byGroup) {
      if (agg.total === 0) continue;
      const pct = (agg.hits / agg.total) * 100;
      const key = `${type}::${group}`;
      const fireKey = `y:${key}`;
      const prev = this.cycleState.get(key) ?? { window: [], lastFiredAt: 0 };
      const lastFired = Math.max(prev.lastFiredAt, this.persistedCooldown.get(key) ?? 0);
      const cooldownPassed = now - lastFired >= cfg.alarm_cooldown_ms;

      if (pct >= pctThreshold && agg.hits > 0 && cooldownPassed) {
        this.fire({
          ts: now,
          type,
          group_name: group,
          level: 'critical',
          title: `${iconFor('critical')} ${group} (${type})`,
          subtitle: `이번 사이클 ${agg.total}개 중 ${agg.hits}개 🔴심각 (${Math.round(pct)}%)`,
          detail: '서버 전반 이상 추정',
        });
        this.cycleState.set(key, { window: prev.window, lastFiredAt: now });
        this.onFired(type, group, fireKey, now);
      } else if (agg.hits === 0 && this.firing.get(fireKey)) {
        // 사이클에 심각 0건 → 복구
        this.firing.delete(fireKey);
        this.fireRecovery({
          type,
          group_name: group,
          title: `✅ 복구 ${group} (${type})`,
          detail: `이번 사이클 ${agg.total}개 모두 정상`,
        });
      }
    }
  }

  private observeConsecutive(
    ep: Endpoint,
    cfg: TypeSettings,
    level: Level | null,
    durationMs: number,
    status: number,
  ) {
    const prev = this.consecutiveState.get(ep.id) ?? { consecutive: 0, lastFiredAt: 0 };
    const fireKey = `c:${ep.id}`;

    // 🔴심각만 알람 대상. 🟡주의/정상은 카운터 리셋 + (이전에 알람났으면) 복구 알림.
    if (level !== 'critical') {
      this.consecutiveState.set(ep.id, { consecutive: 0, lastFiredAt: prev.lastFiredAt });
      if (this.firing.get(fireKey)) {
        this.firing.delete(fireKey);
        this.fireRecovery({
          type: ep.type,
          group_name: ep.group?.trim() || '(미분류)',
          title: `✅ 복구 ${ep.label}`,
          detail: `${ep.method} ${ep.url} · ${descFor(durationMs, status)}`,
        });
      }
      return;
    }

    const consecutive = prev.consecutive + 1;
    const now = Date.now();
    const threshold = Math.max(1, cfg.alarm_consecutive);
    const coolKey = groupKey(ep);
    const lastFired = Math.max(prev.lastFiredAt, this.persistedCooldown.get(coolKey) ?? 0);
    const cooldownPassed = now - lastFired >= cfg.alarm_cooldown_ms;

    if (consecutive >= threshold && cooldownPassed) {
      this.fire({
        ts: now,
        type: ep.type,
        group_name: ep.group?.trim() || '(미분류)',
        level: 'critical',
        title: `${iconFor('critical')} ${ep.label}`,
        subtitle: `${ep.method} ${ep.url}`,
        detail: descFor(durationMs, status),
      });
      this.consecutiveState.set(ep.id, { consecutive, lastFiredAt: now });
      this.onFired(ep.type, ep.group?.trim() || '(미분류)', fireKey, now);
    } else {
      this.consecutiveState.set(ep.id, { consecutive, lastFiredAt: prev.lastFiredAt });
    }
  }

  private observeSliding(
    ep: Endpoint,
    cfg: TypeSettings,
    level: Level | null,
    durationMs: number,
    status: number,
  ) {
    const key = groupKey(ep);
    const fireKey = `s:${key}`;
    const prev = this.slidingState.get(key) ?? { window: [], lastFiredAt: 0 };

    const hit = level === 'critical'; // 🔴심각만 알람 대상. 🟡주의는 무시.
    const windowSize = Math.max(1, cfg.alarm_window);
    const window = [...prev.window, hit].slice(-windowSize);

    const hits = window.filter(Boolean).length;
    const now = Date.now();
    const threshold = Math.max(1, cfg.alarm_window_hits);
    const lastFired = Math.max(prev.lastFiredAt, this.persistedCooldown.get(key) ?? 0);
    const cooldownPassed = now - lastFired >= cfg.alarm_cooldown_ms;
    const groupName = ep.group?.trim() || '(미분류)';

    if (window.length >= windowSize && hits >= threshold && cooldownPassed) {
      this.fire({
        ts: now,
        type: ep.type,
        group_name: groupName,
        level: 'critical',
        title: `${iconFor('critical')} ${groupName} (${ep.type})`,
        subtitle: `최근 ${windowSize}회 중 ${hits}회 🔴심각`,
        detail: descFor(durationMs, status),
      });
      this.slidingState.set(key, { window, lastFiredAt: now });
      this.onFired(ep.type, groupName, fireKey, now);
    } else {
      this.slidingState.set(key, { window, lastFiredAt: prev.lastFiredAt });
      // 윈도우에 심각 0건이고 이전에 알람났으면 복구
      if (hits === 0 && this.firing.get(fireKey)) {
        this.firing.delete(fireKey);
        this.fireRecovery({
          type: ep.type,
          group_name: groupName,
          title: `✅ 복구 ${groupName} (${ep.type})`,
          detail: descFor(durationMs, status),
        });
      }
    }
  }

  /** 알람 발사 직후 공통 후처리 — group 단위 쿨다운 기록(재시작 복원용) + 복구 추적 플래그. */
  private onFired(type: Endpoint['type'], group: string, fireKey: string, now: number) {
    this.persistedCooldown.set(`${type}::${group}`, now);
    this.firing.set(fireKey, true);
  }

  private async fire(e: {
    ts: number;
    type: Endpoint['type'];
    group_name: string;
    level: Level;
    title: string;
    subtitle: string;
    detail: string;
  }) {
    try {
      new Notification({ title: e.title, body: e.detail }).show();
    } catch {
      // notification permission may be missing
    }

    const text = `${e.title}\n\`${e.subtitle}\`\n${e.detail}`;
    // 슬랙 전송 결과(전송/실패/미설정)를 기다렸다가 알람 내역에 같이 남긴다.
    const slack = await this.sendSlack(e.type, text);

    try {
      this.db.recordAlarmEvent({
        ts: e.ts,
        type: e.type,
        group_name: e.group_name,
        level: e.level,
        title: e.title,
        detail: `${e.subtitle} · ${e.detail}`,
        slack_status: slack.status,
        slack_error: slack.error,
      });
    } catch (err) {
      console.warn('[notifier] event record failed:', err);
    }
  }

  /** 장애가 해소됐을 때 1회 발송하는 복구 알림. level은 critical이 아니므로 'warning'으로 기록하고 title의 ✅로 구분. */
  private async fireRecovery(e: {
    type: Endpoint['type'];
    group_name: string;
    title: string;
    detail: string;
  }) {
    try {
      new Notification({ title: e.title, body: e.detail }).show();
    } catch {
      // notification permission may be missing
    }

    const now = Date.now();
    const slack = await this.sendSlack(e.type, `${e.title}\n${e.detail}`);

    try {
      this.db.recordAlarmEvent({
        ts: now,
        type: e.type,
        group_name: e.group_name,
        level: 'warning',
        title: e.title,
        detail: e.detail,
        slack_status: slack.status,
        slack_error: slack.error,
      });
    } catch (err) {
      console.warn('[notifier] recovery record failed:', err);
    }
  }

  /** 설정 화면의 "Slack 테스트" 버튼용. 해당 type의 슬랙 설정으로 발송(타임아웃 포함). */
  async testSlack(type: Endpoint['type']): Promise<{ ok: boolean; message: string }> {
    const s = this.settings[type];
    const text = `:white_check_mark: API Monitor 테스트 메시지 — ${type} (${new Date().toLocaleString('ko-KR')})`;
    try {
      if (s.slack_mode === 'bot') {
        if (!s.slack_bot_token || !s.slack_channel) {
          return { ok: false, message: 'Bot Token과 채널을 모두 입력하세요.' };
        }
        const r = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${s.slack_bot_token}`,
          },
          body: JSON.stringify({ channel: s.slack_channel, text }),
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        return j.ok
          ? { ok: true, message: '발송 성공! 슬랙 채널을 확인하세요.' }
          : { ok: false, message: `Slack API 오류: ${j.error ?? 'unknown'}` };
      } else {
        if (!s.slack_webhook_url) {
          return { ok: false, message: 'Webhook URL을 입력하세요.' };
        }
        const r = await fetch(s.slack_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
        });
        return r.ok
          ? { ok: true, message: '발송 성공! 슬랙 채널을 확인하세요.' }
          : { ok: false, message: `Webhook 오류: HTTP ${r.status}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `발송 실패: ${this.maskSecret(type, msg)}` };
    }
  }

  /** 에러/로그 문자열에서 webhook URL·bot token 같은 시크릿을 가린다(DB 저장·콘솔 노출 방지). */
  private maskSecret(type: Endpoint['type'], text: string): string {
    const s = this.settings[type];
    let out = text;
    if (s.slack_webhook_url) out = out.split(s.slack_webhook_url).join('[webhook]');
    if (s.slack_bot_token) out = out.split(s.slack_bot_token).join('[token]');
    return out;
  }

  /**
   * 슬랙 발송 — 타임아웃 + 재시도(5xx/429/네트워크/타임아웃) 포함.
   * 4xx 성 오류(설정 문제 등)는 재시도해도 소용없으므로 즉시 실패 처리.
   */
  private async sendSlack(
    type: Endpoint['type'],
    text: string,
  ): Promise<{ status: SlackStatus; error: string | null }> {
    const s = this.settings[type];
    if (s.slack_mode === 'bot') {
      if (!s.slack_bot_token || !s.slack_channel) {
        return { status: 'skipped', error: 'Bot Token 또는 채널 미설정' };
      }
    } else if (!s.slack_webhook_url) {
      return { status: 'skipped', error: 'Webhook URL 미설정' };
    }

    let lastErr = 'unknown';
    for (let attempt = 0; attempt <= SLACK_MAX_RETRY; attempt++) {
      if (attempt > 0) await delay(500 * attempt); // 선형 backoff
      try {
        if (s.slack_mode === 'bot') {
          const r = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              Authorization: `Bearer ${s.slack_bot_token}`,
            },
            body: JSON.stringify({ channel: s.slack_channel, text }),
            signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
          });
          if (r.status === 429 || r.status >= 500) {
            lastErr = `HTTP ${r.status}`;
            continue; // 일시 오류 → 재시도
          }
          // non-JSON 응답(예: 429 HTML)에도 throw 하지 않도록 catch로 방어.
          const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (j.ok) return { status: 'sent', error: null };
          if (j.error === 'rate_limited') {
            lastErr = 'rate_limited';
            continue;
          }
          return { status: 'failed', error: `Slack API: ${j.error ?? 'unknown'}` };
        } else {
          const r = await fetch(s.slack_webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
          });
          if (r.ok) return { status: 'sent', error: null };
          if (r.status === 429 || r.status >= 500) {
            lastErr = `HTTP ${r.status}`;
            continue;
          }
          return { status: 'failed', error: `Webhook HTTP ${r.status}` };
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        // 타임아웃/네트워크 → 재시도 루프 계속
      }
    }
    const masked = this.maskSecret(type, lastErr);
    console.warn('[notifier] slack send failed after retries:', masked);
    return { status: 'failed', error: masked };
  }
}

function iconFor(level: Level): string {
  return level === 'critical' ? '🔴' : '🟡';
}

function descFor(durationMs: number, status: number): string {
  return status === 0 ? `request failed · ${durationMs}ms` : `${status} · ${durationMs}ms`;
}
