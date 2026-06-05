import { useEffect, useState } from 'react';
import type { Settings as SettingsType } from '../shared/types';

export function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  async function save(patch: Partial<SettingsType>) {
    setSaving(true);
    setSettings(prev => (prev ? { ...prev, ...patch } : prev));
    try {
      await window.api.updateSettings(patch);
    } catch (e) {
      console.error('settings save failed', e);
      const fresh = await window.api.getSettings();
      setSettings(fresh);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 24, maxWidth: 600 }}>
      <div style={card}>
        <h3 style={{ marginTop: 0 }}>측정 간격</h3>
        <Row label="간격 (ms)">
          <input
            type="number"
            min={5000}
            value={settings.interval_ms}
            onChange={e => save({ interval_ms: Number(e.target.value) })}
          />
          <small style={{ marginLeft: 8, opacity: 0.6 }}>
            ({Math.round(settings.interval_ms / 1000)}초)
          </small>
        </Row>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>임계값</h3>
        <Row label="주의 (ms)">
          <input
            type="number"
            value={settings.warning_ms}
            onChange={e => save({ warning_ms: Number(e.target.value) })}
          />
        </Row>
        <Row label="심각 (ms)">
          <input
            type="number"
            value={settings.critical_ms}
            onChange={e => save({ critical_ms: Number(e.target.value) })}
          />
        </Row>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>알람</h3>
        <Row label="알람 켜기">
          <input
            type="checkbox"
            checked={settings.alarms_enabled === 1}
            onChange={e => save({ alarms_enabled: e.target.checked ? 1 : 0 })}
          />
        </Row>
        <Row label="Slack Webhook URL">
          <input
            type="text"
            placeholder="https://hooks.slack.com/services/..."
            value={settings.slack_webhook_url}
            onChange={e => save({ slack_webhook_url: e.target.value })}
            style={{ width: '100%' }}
          />
        </Row>
        <Row label="연속 N회 시 발동">
          <input
            type="number"
            min={1}
            value={settings.alarm_consecutive}
            onChange={e => save({ alarm_consecutive: Math.max(1, Number(e.target.value)) })}
          />
          <small style={{ marginLeft: 8, opacity: 0.6 }}>회</small>
        </Row>
        <Row label="알람 쿨다운 (분)">
          <input
            type="number"
            min={0}
            value={Math.round(settings.alarm_cooldown_ms / 60_000)}
            onChange={e => save({ alarm_cooldown_ms: Math.max(0, Number(e.target.value)) * 60_000 })}
          />
        </Row>
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          1주일 정도 데이터 쌓고 베이스라인 본 후에 켜는 걸 권장.
        </p>
      </div>

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>데이터 보관</h3>
        <Row label="보관 기간 (일)">
          <input
            type="number"
            min={1}
            value={settings.retention_days}
            onChange={e => save({ retention_days: Math.max(1, Number(e.target.value)) })}
          />
        </Row>
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          이 기간보다 오래된 measurement 는 자동 삭제됩니다.
        </p>
      </div>

      {saving && <small style={{ opacity: 0.6 }}>저장 중...</small>}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={{ opacity: 0.8 }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #2a2f3a',
  borderRadius: 12,
  padding: 20,
  background: '#1c2028',
};
