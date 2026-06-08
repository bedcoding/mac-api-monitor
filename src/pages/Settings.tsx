import { useEffect, useState } from 'react';
import type { Settings as SettingsType, TypeSettings, EndpointType } from '../shared/types';

export function Settings({ onlyType }: { onlyType: EndpointType }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  async function saveCommon(patch: Partial<Omit<SettingsType, 'health' | 'feature'>>) {
    setSaving(true);
    setSettings(prev => (prev ? { ...prev, ...patch } : prev));
    try {
      await window.api.updateSettings(patch);
    } catch (e) {
      console.error('settings save failed', e);
      setSettings(await window.api.getSettings());
    } finally {
      setSaving(false);
    }
  }

  async function saveType(type: EndpointType, patch: Partial<TypeSettings>) {
    setSaving(true);
    setSettings(prev => (prev ? { ...prev, [type]: { ...prev[type], ...patch } } : prev));
    try {
      await window.api.updateSettings({ [type]: patch });
    } catch (e) {
      console.error('settings save failed', e);
      setSettings(await window.api.getSettings());
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <TypeCard
        value={settings[onlyType]}
        onChange={patch => saveType(onlyType, patch)}
      />

      <div style={card}>
        <h3 style={cardTitle}>데이터 보관 (공통)</h3>
        <Row label="보관 기간 (일)">
          <input
            type="number"
            min={1}
            value={settings.retention_days}
            onChange={e => saveCommon({ retention_days: Math.max(1, Number(e.target.value)) })}
          />
        </Row>
        <p style={{ fontSize: 12, opacity: 0.6, margin: '4px 0 0' }}>
          이 기간보다 오래된 측정/이벤트는 자동 삭제됩니다.
        </p>
      </div>

      {saving && <small style={{ opacity: 0.6 }}>저장 중...</small>}
    </section>
  );
}

function TypeCard({
  value,
  onChange,
}: {
  value: TypeSettings;
  onChange: (patch: Partial<TypeSettings>) => void;
}) {
  return (
    <div style={card}>
      <h3 style={cardTitle}>측정 / 임계값 / 알람 조건</h3>
      <Row label="측정 간격 (초)">
        <input
          type="number"
          min={5}
          value={Math.round(value.interval_ms / 1000)}
          onChange={e => onChange({ interval_ms: Math.max(5, Number(e.target.value)) * 1000 })}
        />
      </Row>
      <Row label="발사 간격 stagger (초)">
        <input
          type="number"
          min={0}
          step={0.5}
          value={value.stagger_ms / 1000}
          onChange={e => onChange({ stagger_ms: Math.max(0, Number(e.target.value)) * 1000 })}
        />
      </Row>
      <Row label="주의 (ms)">
        <input
          type="number"
          value={value.warning_ms}
          onChange={e => onChange({ warning_ms: Number(e.target.value) })}
        />
      </Row>
      <Row label="심각 (ms)">
        <input
          type="number"
          value={value.critical_ms}
          onChange={e => onChange({ critical_ms: Number(e.target.value) })}
        />
      </Row>
      <Row label="알람 쿨다운 (분)">
        <input
          type="number"
          min={0}
          value={Math.round(value.alarm_cooldown_ms / 60_000)}
          onChange={e => onChange({ alarm_cooldown_ms: Math.max(0, Number(e.target.value)) * 60_000 })}
        />
      </Row>

      <Row label="알람 방식">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ModeBtn
            active={value.alarm_mode === 'consecutive'}
            onClick={() => onChange({ alarm_mode: 'consecutive' })}
          >
            연속 N회
          </ModeBtn>
          <ModeBtn
            active={value.alarm_mode === 'cycle'}
            onClick={() => onChange({ alarm_mode: 'cycle' })}
          >
            사이클 동시
          </ModeBtn>
          <ModeBtn
            active={value.alarm_mode === 'sliding'}
            onClick={() => onChange({ alarm_mode: 'sliding' })}
          >
            시간 누적
          </ModeBtn>
        </div>
      </Row>

      {value.alarm_mode === 'consecutive' && (
        <>
          <Row label="연속 N회 시 발동">
            <input
              type="number"
              min={1}
              value={value.alarm_consecutive}
              onChange={e => onChange({ alarm_consecutive: Math.max(1, Number(e.target.value)) })}
            />
          </Row>
          <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
            각 endpoint가 단독으로 연속 {value.alarm_consecutive}회 임계 초과 시 알람.
          </p>
        </>
      )}

      {value.alarm_mode === 'cycle' && (
        <>
          <Row label="사이클 내 초과 비율(%)">
            <input
              type="number"
              min={1}
              max={100}
              value={value.alarm_cycle_percent}
              onChange={e =>
                onChange({ alarm_cycle_percent: Math.max(1, Math.min(100, Number(e.target.value))) })
              }
            />
          </Row>
          <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
            한 사이클(그룹 endpoint 1회씩) 동안 {value.alarm_cycle_percent}% 이상이 임계 초과면 그룹
            알람 1건.
          </p>
        </>
      )}

      {value.alarm_mode === 'sliding' && (
        <>
          <Row label="윈도우 크기 (최근 N회)">
            <input
              type="number"
              min={1}
              value={value.alarm_window}
              onChange={e => onChange({ alarm_window: Math.max(1, Number(e.target.value)) })}
            />
          </Row>
          <Row label="초과 M회 시 발동">
            <input
              type="number"
              min={1}
              value={value.alarm_window_hits}
              onChange={e => onChange({ alarm_window_hits: Math.max(1, Number(e.target.value)) })}
            />
          </Row>
          <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
            같은 group 안에서 최근 {value.alarm_window}회 측정 중 {value.alarm_window_hits}회 임계
            초과 시 그룹 알람 1건.
          </p>
        </>
      )}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? '#3b82f6' : 'transparent',
        border: `1px solid ${active ? '#3b82f6' : '#2a2f3a'}`,
        color: active ? '#fff' : '#a0aec0',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
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

const cardTitle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
};
