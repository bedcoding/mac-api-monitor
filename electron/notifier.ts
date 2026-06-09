import { Notification } from 'electron';
import type { Database, Endpoint, Settings, TypeSettings } from './db';

export type Level = 'warning' | 'critical';

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

export class Notifier {
  private settings: Settings;
  private consecutiveState = new Map<number, ConsecutiveState>();
  private slidingState = new Map<string, SlidingState>();

  constructor(private db: Database) {
    this.settings = db.getSettings();
  }

  configure(settings: Settings) {
    this.settings = settings;
  }

  reset(endpointId: number) {
    this.consecutiveState.delete(endpointId);
    // 슬라이딩은 group 단위라 endpoint 제거만으론 정리 어려움 — 그대로 둠 (다음 측정에 자연 갱신)
  }

  observe(ep: Endpoint, level: Level | null, durationMs: number, status: number) {
    const cfg = ep.type === 'health' ? this.settings.health : this.settings.feature;
    if (!cfg.alarms_enabled) return;

    if (cfg.alarm_mode === 'cycle') {
      // cycle 모드는 사이클 끝에 observeCycle 로 일괄 판정. per-probe 는 무시.
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
   * type+group 별로 "🔴심각 endpoint 비율" 이 임계치 이상이면 그룹 알람 1건.
   */
  observeCycle(
    type: Endpoint['type'],
    results: Array<{ group: string; hit: boolean; level: Level | null }>,
  ) {
    const cfg = type === 'health' ? this.settings.health : this.settings.feature;
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
      const prev = this.slidingState.get(key) ?? { window: [], lastFiredAt: 0 };
      const cooldownPassed = now - prev.lastFiredAt >= cfg.alarm_cooldown_ms;

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
        this.slidingState.set(key, { window: prev.window, lastFiredAt: now });
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

    // 🔴심각만 알람 대상. 🟡주의/정상은 카운터 리셋.
    if (level !== 'critical') {
      this.consecutiveState.set(ep.id, { consecutive: 0, lastFiredAt: prev.lastFiredAt });
      return;
    }

    const consecutive = prev.consecutive + 1;
    const now = Date.now();
    const threshold = Math.max(1, cfg.alarm_consecutive);
    const cooldownPassed = now - prev.lastFiredAt >= cfg.alarm_cooldown_ms;

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
    const prev = this.slidingState.get(key) ?? { window: [], lastFiredAt: 0 };

    const hit = level === 'critical'; // 🔴심각만 알람 대상. 🟡주의는 무시.
    const windowSize = Math.max(1, cfg.alarm_window);
    const window = [...prev.window, hit].slice(-windowSize);

    const hits = window.filter(Boolean).length;
    const now = Date.now();
    const threshold = Math.max(1, cfg.alarm_window_hits);
    const cooldownPassed = now - prev.lastFiredAt >= cfg.alarm_cooldown_ms;

    if (window.length >= windowSize && hits >= threshold && cooldownPassed) {
      const groupName = ep.group?.trim() || '(미분류)';
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
    } else {
      this.slidingState.set(key, { window, lastFiredAt: prev.lastFiredAt });
    }
  }

  private fire(e: {
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
    this.sendSlack(e.type, text);

    try {
      this.db.recordAlarmEvent({
        ts: e.ts,
        type: e.type,
        group_name: e.group_name,
        level: e.level,
        title: e.title,
        detail: `${e.subtitle} · ${e.detail}`,
      });
    } catch (err) {
      console.warn('[notifier] event record failed:', err);
    }
  }

  /** 설정 화면의 "Slack 테스트" 버튼용. 해당 type 의 슬랙 설정으로 발송. */
  async testSlack(type: Endpoint['type']): Promise<{ ok: boolean; message: string }> {
    const s = type === 'health' ? this.settings.health : this.settings.feature;
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
        });
        const j = (await r.json()) as { ok?: boolean; error?: string };
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
        });
        return r.ok
          ? { ok: true, message: '발송 성공! 슬랙 채널을 확인하세요.' }
          : { ok: false, message: `Webhook 오류: HTTP ${r.status}` };
      }
    } catch (err) {
      return { ok: false, message: `발송 실패: ${(err as Error).message}` };
    }
  }

  private sendSlack(type: Endpoint['type'], text: string) {
    const s = type === 'health' ? this.settings.health : this.settings.feature;
    if (s.slack_mode === 'bot') {
      if (!s.slack_bot_token || !s.slack_channel) return;
      fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${s.slack_bot_token}`,
        },
        body: JSON.stringify({ channel: s.slack_channel, text }),
      })
        .then(r => r.json())
        .then((j: { ok?: boolean; error?: string }) => {
          if (!j.ok) console.warn('[notifier] slack bot api error:', j.error);
        })
        .catch(err => console.warn('[notifier] slack bot failed:', err?.message ?? err));
    } else {
      if (!s.slack_webhook_url) return;
      fetch(s.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(err => console.warn('[notifier] slack webhook failed:', err?.message ?? err));
    }
  }
}

function iconFor(level: Level): string {
  return level === 'critical' ? '🔴' : '🟡';
}

function descFor(durationMs: number, status: number): string {
  return status === 0 ? `request failed · ${durationMs}ms` : `${status} · ${durationMs}ms`;
}
