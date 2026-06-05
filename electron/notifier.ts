import { Notification } from 'electron';
import type { Database, Endpoint, Settings } from './db';

export type Level = 'warning' | 'critical';

interface AlarmState {
  consecutive: number;
  lastFiredAt: number;
  lastLevel: Level | null;
}

export class Notifier {
  private settings: Settings;
  private state = new Map<number, AlarmState>();

  constructor(db: Database) {
    this.settings = db.getSettings();
  }

  configure(settings: Settings) {
    this.settings = settings;
  }

  reset(endpointId: number) {
    this.state.delete(endpointId);
  }

  observe(ep: Endpoint, level: Level | null, durationMs: number, status: number) {
    if (!this.settings.alarms_enabled) return;

    const prev = this.state.get(ep.id) ?? { consecutive: 0, lastFiredAt: 0, lastLevel: null };

    if (level === null) {
      this.state.set(ep.id, { consecutive: 0, lastFiredAt: prev.lastFiredAt, lastLevel: null });
      return;
    }

    const consecutive =
      prev.lastLevel === level ? prev.consecutive + 1 : level === 'critical' && prev.lastLevel === 'warning' ? prev.consecutive + 1 : 1;

    const now = Date.now();
    const threshold = Math.max(1, this.settings.alarm_consecutive);
    const cooldownPassed = now - prev.lastFiredAt >= this.settings.alarm_cooldown_ms;

    if (consecutive >= threshold && cooldownPassed) {
      this.fire(level, ep, durationMs, status);
      this.state.set(ep.id, { consecutive, lastFiredAt: now, lastLevel: level });
    } else {
      this.state.set(ep.id, { consecutive, lastFiredAt: prev.lastFiredAt, lastLevel: level });
    }
  }

  private fire(level: Level, ep: Endpoint, durationMs: number, status: number) {
    const icon = level === 'critical' ? '🔴' : '🟡';
    const title = `${icon} ${ep.label}`;
    const body = status === 0 ? `request failed · ${durationMs}ms` : `${status} · ${durationMs}ms`;

    try {
      new Notification({ title, body }).show();
    } catch {
      // notification permission may be missing
    }

    if (this.settings.slack_webhook_url) {
      const text = `${title}\n\`${ep.method} ${ep.url}\`\n${body}`;
      fetch(this.settings.slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }).catch(err => {
        console.warn('[notifier] slack webhook failed:', err?.message ?? err);
      });
    }
  }
}
