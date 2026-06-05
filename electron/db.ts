import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';

export interface Endpoint {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group: string | null;
}

export interface Measurement {
  id: number;
  endpoint_id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
}

export interface Settings {
  interval_ms: number;
  warning_ms: number;
  critical_ms: number;
  slack_webhook_url: string;
  alarms_enabled: number;
  retention_days: number;
  alarm_consecutive: number;
  alarm_cooldown_ms: number;
}

export interface NewEndpoint {
  method: string;
  url: string;
  label: string;
  note?: string | null;
  group?: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  interval_ms: 30_000,
  warning_ms: 3_000,
  critical_ms: 7_000,
  slack_webhook_url: '',
  alarms_enabled: 0,
  retention_days: 7,
  alarm_consecutive: 3,
  alarm_cooldown_ms: 10 * 60_000,
};

interface EndpointRow {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group_name: string | null;
}

function rowToEndpoint(r: EndpointRow): Endpoint {
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    label: r.label,
    note: r.note,
    group: r.group_name,
  };
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'api-monitor.db');
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT NOT NULL DEFAULT 'GET',
        url TEXT NOT NULL,
        label TEXT NOT NULL,
        note TEXT,
        group_name TEXT
      );
      CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_measurements_endpoint_ts
        ON measurements(endpoint_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_measurements_ts
        ON measurements(ts);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  listEndpoints(): Endpoint[] {
    const rows = this.db
      .prepare('SELECT id, method, url, label, note, group_name FROM endpoints ORDER BY id')
      .all() as EndpointRow[];
    return rows.map(rowToEndpoint);
  }

  addEndpoint(ep: NewEndpoint): number {
    const stmt = this.db.prepare(
      'INSERT INTO endpoints (method, url, label, note, group_name) VALUES (?, ?, ?, ?, ?)',
    );
    const r = stmt.run(ep.method, ep.url, ep.label, ep.note ?? null, ep.group ?? null);
    return Number(r.lastInsertRowid);
  }

  addEndpointsBulk(eps: NewEndpoint[]): number {
    const stmt = this.db.prepare(
      'INSERT INTO endpoints (method, url, label, note, group_name) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = this.db.transaction((rows: NewEndpoint[]) => {
      for (const ep of rows) {
        stmt.run(ep.method, ep.url, ep.label, ep.note ?? null, ep.group ?? null);
      }
    });
    tx(eps);
    return eps.length;
  }

  removeEndpoint(id: number) {
    this.db.prepare('DELETE FROM endpoints WHERE id = ?').run(id);
  }

  recordMeasurement(m: Omit<Measurement, 'id'>) {
    this.db
      .prepare(
        'INSERT INTO measurements (endpoint_id, ts, duration_ms, status, ok) VALUES (?, ?, ?, ?, ?)',
      )
      .run(m.endpoint_id, m.ts, m.duration_ms, m.status, m.ok);
  }

  recentMeasurements(endpointId: number, hours: number): Measurement[] {
    const since = Date.now() - hours * 3600_000;
    return this.db
      .prepare(
        'SELECT * FROM measurements WHERE endpoint_id = ? AND ts >= ? ORDER BY ts',
      )
      .all(endpointId, since) as Measurement[];
  }

  pruneOldMeasurements(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 3600_000;
    const r = this.db.prepare('DELETE FROM measurements WHERE ts < ?').run(cutoff);
    return Number(r.changes);
  }

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    return {
      interval_ms: Number(map.interval_ms ?? DEFAULT_SETTINGS.interval_ms),
      warning_ms: Number(map.warning_ms ?? DEFAULT_SETTINGS.warning_ms),
      critical_ms: Number(map.critical_ms ?? DEFAULT_SETTINGS.critical_ms),
      slack_webhook_url: map.slack_webhook_url ?? DEFAULT_SETTINGS.slack_webhook_url,
      alarms_enabled: Number(map.alarms_enabled ?? DEFAULT_SETTINGS.alarms_enabled),
      retention_days: Number(map.retention_days ?? DEFAULT_SETTINGS.retention_days),
      alarm_consecutive: Number(map.alarm_consecutive ?? DEFAULT_SETTINGS.alarm_consecutive),
      alarm_cooldown_ms: Number(map.alarm_cooldown_ms ?? DEFAULT_SETTINGS.alarm_cooldown_ms),
    };
  }

  updateSettings(patch: Partial<Settings>) {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const tx = this.db.transaction((entries: Array<[string, unknown]>) => {
      for (const [key, value] of entries) {
        stmt.run(key, String(value));
      }
    });
    tx(Object.entries(patch));
  }
}
