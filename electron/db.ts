import BetterSqlite3 from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';

export type EndpointType = 'health' | 'feature';

export interface Endpoint {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group: string | null;
  type: EndpointType;
}

export interface Measurement {
  id: number;
  endpoint_id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
  body: string | null;
}

export type SlackStatus = 'sent' | 'failed' | 'skipped';

export interface AlarmEvent {
  id: number;
  ts: number;
  type: EndpointType;
  group_name: string;
  level: 'warning' | 'critical';
  title: string;
  detail: string;
  slack_status: SlackStatus | null;
  slack_error: string | null;
}

export interface ThresholdEvent {
  id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
  endpoint_id: number;
  label: string;
  url: string;
  method: string;
  group_name: string | null;
  level: 'healthy' | 'warning' | 'critical';
  body: string | null;
}

export interface NewAlarmEvent {
  ts: number;
  type: EndpointType;
  group_name: string;
  level: 'warning' | 'critical';
  title: string;
  detail: string;
  slack_status?: SlackStatus | null;
  slack_error?: string | null;
}

export type AlarmMode = 'consecutive' | 'sliding' | 'cycle';
export type SlackMode = 'webhook' | 'bot';

export interface TypeSettings {
  interval_ms: number;
  warning_ms: number;
  critical_ms: number;
  stagger_ms: number;
  alarm_mode: AlarmMode;
  alarm_consecutive: number; // consecutive 모드: 연속 N회
  alarm_window: number; // sliding 모드: 최근 N개 측정 윈도우
  alarm_window_hits: number; // sliding 모드: 윈도우 안 임계 초과 M개
  alarm_cycle_percent: number; // cycle 모드: 한 사이클에서 임계 초과 비율(%) 임계치
  // 알람/슬랙 (type 별 독립)
  alarms_enabled: number;
  alarm_cooldown_ms: number;
  slack_mode: SlackMode;
  slack_webhook_url: string;
  slack_bot_token: string;
  slack_channel: string;
  // 데이터 보관 (type 별 독립)
  retention_days: number;
}

export interface Settings {
  health: TypeSettings;
  feature: TypeSettings;
}

export interface NewEndpoint {
  method: string;
  url: string;
  label: string;
  note?: string | null;
  group?: string | null;
  type?: EndpointType;
}

const DEFAULT_HEALTH: TypeSettings = {
  interval_ms: 60_000,
  warning_ms: 500,
  critical_ms: 1_000,
  stagger_ms: 5_000,
  alarm_mode: 'consecutive',
  alarm_consecutive: 2,
  alarm_window: 5,
  alarm_window_hits: 3,
  alarm_cycle_percent: 60,
  alarms_enabled: 0,
  alarm_cooldown_ms: 10 * 60_000,
  slack_mode: 'webhook',
  slack_webhook_url: '',
  slack_bot_token: '',
  slack_channel: '',
  retention_days: 7,
};

const DEFAULT_FEATURE: TypeSettings = {
  interval_ms: 60_000,
  warning_ms: 3_000,
  critical_ms: 7_000,
  stagger_ms: 1_000,
  alarm_mode: 'cycle',
  alarm_consecutive: 10,
  alarm_window: 10,
  alarm_window_hits: 10,
  alarm_cycle_percent: 60,
  alarms_enabled: 0,
  alarm_cooldown_ms: 10 * 60_000,
  slack_mode: 'webhook',
  slack_webhook_url: '',
  slack_bot_token: '',
  slack_channel: '',
  retention_days: 7,
};

const DEFAULT_SETTINGS: Settings = {
  health: DEFAULT_HEALTH,
  feature: DEFAULT_FEATURE,
};

interface EndpointRow {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group_name: string | null;
  type: string | null;
}

function rowToEndpoint(r: EndpointRow): Endpoint {
  return {
    id: r.id,
    method: r.method,
    url: r.url,
    label: r.label,
    note: r.note,
    group: r.group_name,
    type: r.type === 'health' ? 'health' : 'feature',
  };
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'mac-api-monitor.db');
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
        group_name TEXT,
        type TEXT NOT NULL DEFAULT 'feature'
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
      CREATE TABLE IF NOT EXISTS alarm_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        group_name TEXT NOT NULL,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        slack_status TEXT,
        slack_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alarm_events_ts
        ON alarm_events(ts DESC);
    `);

    // 기존 DB (type 컬럼 없음) 호환: ADD COLUMN 시도, 이미 있으면 무시
    try {
      this.db.exec(`ALTER TABLE endpoints ADD COLUMN type TEXT NOT NULL DEFAULT 'feature'`);
    } catch {
      // already exists
    }
    try {
      this.db.exec(`ALTER TABLE measurements ADD COLUMN body TEXT`);
    } catch {
      // already exists
    }
    // 슬랙 전송 결과 기록용 컬럼 (기존 DB 호환)
    try {
      this.db.exec(`ALTER TABLE alarm_events ADD COLUMN slack_status TEXT`);
    } catch {
      // already exists
    }
    try {
      this.db.exec(`ALTER TABLE alarm_events ADD COLUMN slack_error TEXT`);
    } catch {
      // already exists
    }
  }

  listEndpoints(): Endpoint[] {
    const rows = this.db
      .prepare('SELECT id, method, url, label, note, group_name, type FROM endpoints ORDER BY id')
      .all() as EndpointRow[];
    return rows.map(rowToEndpoint);
  }

  addEndpoint(ep: NewEndpoint): number {
    const stmt = this.db.prepare(
      'INSERT INTO endpoints (method, url, label, note, group_name, type) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const r = stmt.run(
      ep.method,
      ep.url,
      ep.label,
      ep.note ?? null,
      ep.group ?? null,
      ep.type ?? 'feature',
    );
    return Number(r.lastInsertRowid);
  }

  addEndpointsBulk(eps: NewEndpoint[]): number {
    const stmt = this.db.prepare(
      'INSERT INTO endpoints (method, url, label, note, group_name, type) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const tx = this.db.transaction((rows: NewEndpoint[]) => {
      for (const ep of rows) {
        stmt.run(
          ep.method,
          ep.url,
          ep.label,
          ep.note ?? null,
          ep.group ?? null,
          ep.type ?? 'feature',
        );
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
        'INSERT INTO measurements (endpoint_id, ts, duration_ms, status, ok, body) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(m.endpoint_id, m.ts, m.duration_ms, m.status, m.ok, m.body);
  }

  /** type 의 가장 최근 측정 시각. 재시작 시 측정 주기를 이어가는 용도. */
  lastMeasurementTs(type: EndpointType): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(m.ts) AS ts
         FROM measurements m JOIN endpoints e ON e.id = m.endpoint_id
         WHERE e.type = ?`,
      )
      .get(type) as { ts: number | null };
    return row.ts;
  }

  recentMeasurements(endpointId: number, limit: number): Measurement[] {
    // 최근 limit 개를 ts ASC(과거→최신) 로 반환. 측정 주기와 무관하게 "개수" 로 끊어
    // 타임라인 모달이 주기가 길든 짧든 일정 분량을 보여주게 한다.
    return this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM measurements WHERE endpoint_id = ? ORDER BY ts DESC LIMIT ?
         ) ORDER BY ts ASC`,
      )
      .all(endpointId, limit) as Measurement[];
  }

  pruneOldByType(type: EndpointType, retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 3600_000;
    const r = this.db
      .prepare(
        `DELETE FROM measurements
         WHERE ts < ?
           AND endpoint_id IN (SELECT id FROM endpoints WHERE type = ?)`,
      )
      .run(cutoff, type);
    this.db
      .prepare('DELETE FROM alarm_events WHERE ts < ? AND type = ?')
      .run(cutoff, type);
    return Number(r.changes);
  }

  recordAlarmEvent(e: NewAlarmEvent) {
    this.db
      .prepare(
        `INSERT INTO alarm_events (ts, type, group_name, level, title, detail, slack_status, slack_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.ts,
        e.type,
        e.group_name,
        e.level,
        e.title,
        e.detail,
        e.slack_status ?? null,
        e.slack_error ?? null,
      );
  }

  recentAlarmEvents(type: EndpointType, limit = 200): AlarmEvent[] {
    return this.db
      .prepare('SELECT * FROM alarm_events WHERE type = ? ORDER BY ts DESC LIMIT ?')
      .all(type, limit) as AlarmEvent[];
  }

  /**
   * 임계값 초과 측정 이벤트 (알람 발동 여부와 무관).
   * - ok=0 (실패) 이거나
   * - duration_ms >= warning_ms (느림)
   */
  recentThresholdExceeded(
    type: EndpointType,
    warningMs: number,
    criticalMs: number,
    limit = 200,
  ): ThresholdEvent[] {
    return this.db
      .prepare(
        `SELECT
           m.id, m.ts, m.duration_ms, m.status, m.ok, m.body,
           e.id AS endpoint_id, e.label, e.url, e.method, e.group_name,
           CASE
             WHEN m.ok = 0 OR m.duration_ms >= ? THEN 'critical'
             WHEN m.duration_ms >= ? THEN 'warning'
             ELSE NULL
           END AS level
         FROM measurements m
         JOIN endpoints e ON e.id = m.endpoint_id
         WHERE e.type = ?
           AND (m.ok = 0 OR m.duration_ms >= ?)
         ORDER BY m.ts DESC
         LIMIT ?`,
      )
      .all(criticalMs, warningMs, type, warningMs, limit) as ThresholdEvent[];
  }

  /**
   * endpoint 별 최근 N개 측정 (정상 포함).
   * '이슈만 보기' 해제 시 dot 타임라인에 정상(🟢)까지 깔아주는 용도.
   */
  recentMeasurementsAll(
    type: EndpointType,
    warningMs: number,
    criticalMs: number,
    perEndpoint = 60,
  ): ThresholdEvent[] {
    return this.db
      .prepare(
        `SELECT id, ts, duration_ms, status, ok, body,
                endpoint_id, label, url, method, group_name, level
         FROM (
           SELECT m.id, m.ts, m.duration_ms, m.status, m.ok, m.body,
                  e.id AS endpoint_id, e.label, e.url, e.method, e.group_name,
                  CASE
                    WHEN m.ok = 0 OR m.duration_ms >= ? THEN 'critical'
                    WHEN m.duration_ms >= ? THEN 'warning'
                    ELSE 'healthy'
                  END AS level,
                  ROW_NUMBER() OVER (PARTITION BY m.endpoint_id ORDER BY m.ts DESC) AS rn
           FROM measurements m
           JOIN endpoints e ON e.id = m.endpoint_id
           WHERE e.type = ?
         )
         WHERE rn <= ?
         ORDER BY ts DESC`,
      )
      .all(criticalMs, warningMs, type, perEndpoint) as ThresholdEvent[];
  }

  /**
   * 최근 N시간 동안 endpoint 별 측정 총횟수 / 임계 초과 횟수.
   * 카드 헤더의 성공률 표시용. (전체 측정 vs 이상 측정)
   */
  recentEndpointStats(
    type: EndpointType,
    hours: number,
    warningMs: number,
  ): Array<{ endpoint_id: number; total: number; threshold: number }> {
    const since = Date.now() - hours * 3600_000;
    return this.db
      .prepare(
        `SELECT
           m.endpoint_id,
           COUNT(*) AS total,
           SUM(CASE WHEN m.ok = 0 OR m.duration_ms >= ? THEN 1 ELSE 0 END) AS threshold
         FROM measurements m
         JOIN endpoints e ON e.id = m.endpoint_id
         WHERE e.type = ? AND m.ts >= ?
         GROUP BY m.endpoint_id`,
      )
      .all(warningMs, type, since) as Array<{
      endpoint_id: number;
      total: number;
      threshold: number;
    }>;
  }

  getSettings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    // 구버전 키 → 두 type 의 fallback 으로 흡수 (전역 슬랙/알람이 type별로 이동했으므로)
    const legacy = {
      interval_ms: map.interval_ms,
      warning_ms: map.warning_ms,
      critical_ms: map.critical_ms,
      alarm_consecutive: map.alarm_consecutive,
      alarms_enabled: map.alarms_enabled,
      alarm_cooldown_ms: map.alarm_cooldown_ms,
      slack_mode: map.slack_mode,
      slack_webhook_url: map.slack_webhook_url,
      slack_bot_token: map.slack_bot_token,
      slack_channel: map.slack_channel,
      retention_days: map.retention_days,
    };

    const readType = (prefix: string, def: TypeSettings): TypeSettings => {
      const rawMode = map[`${prefix}.alarm_mode`];
      const alarm_mode: AlarmMode =
        rawMode === 'sliding' || rawMode === 'consecutive' || rawMode === 'cycle'
          ? rawMode
          : def.alarm_mode;
      const rawSlackMode = map[`${prefix}.slack_mode`] ?? legacy.slack_mode;
      const slack_mode: SlackMode = rawSlackMode === 'bot' ? 'bot' : 'webhook';
      return {
        interval_ms: Number(map[`${prefix}.interval_ms`] ?? legacy.interval_ms ?? def.interval_ms),
        warning_ms: Number(map[`${prefix}.warning_ms`] ?? legacy.warning_ms ?? def.warning_ms),
        critical_ms: Number(map[`${prefix}.critical_ms`] ?? legacy.critical_ms ?? def.critical_ms),
        stagger_ms: Number(map[`${prefix}.stagger_ms`] ?? def.stagger_ms),
        alarm_mode,
        alarm_consecutive: Number(
          map[`${prefix}.alarm_consecutive`] ?? legacy.alarm_consecutive ?? def.alarm_consecutive,
        ),
        alarm_window: Number(map[`${prefix}.alarm_window`] ?? def.alarm_window),
        alarm_window_hits: Number(map[`${prefix}.alarm_window_hits`] ?? def.alarm_window_hits),
        alarm_cycle_percent: Number(
          map[`${prefix}.alarm_cycle_percent`] ?? def.alarm_cycle_percent,
        ),
        alarms_enabled: Number(
          map[`${prefix}.alarms_enabled`] ?? legacy.alarms_enabled ?? def.alarms_enabled,
        ),
        alarm_cooldown_ms: Number(
          map[`${prefix}.alarm_cooldown_ms`] ?? legacy.alarm_cooldown_ms ?? def.alarm_cooldown_ms,
        ),
        slack_mode,
        slack_webhook_url:
          map[`${prefix}.slack_webhook_url`] ?? legacy.slack_webhook_url ?? def.slack_webhook_url,
        slack_bot_token:
          map[`${prefix}.slack_bot_token`] ?? legacy.slack_bot_token ?? def.slack_bot_token,
        slack_channel: map[`${prefix}.slack_channel`] ?? legacy.slack_channel ?? def.slack_channel,
        retention_days: Number(
          map[`${prefix}.retention_days`] ?? legacy.retention_days ?? def.retention_days,
        ),
      };
    };

    return {
      health: readType('health', DEFAULT_HEALTH),
      feature: readType('feature', DEFAULT_FEATURE),
    };
  }

  updateSettings(patch: SettingsPatch) {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );

    const flat: Array<[string, unknown]> = [];
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'health' || key === 'feature') {
        if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) {
            flat.push([`${key}.${k}`, v]);
          }
        }
      } else {
        flat.push([key, value]);
      }
    }

    const tx = this.db.transaction((entries: Array<[string, unknown]>) => {
      for (const [key, value] of entries) {
        stmt.run(key, String(value));
      }
    });
    tx(flat);
  }
}

export type SettingsPatch = Partial<
  Omit<Settings, 'health' | 'feature'> & {
    health: Partial<TypeSettings>;
    feature: Partial<TypeSettings>;
  }
>;
