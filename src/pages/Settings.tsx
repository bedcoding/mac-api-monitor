import { useEffect, useState } from 'react';
import type { Settings as SettingsType, TypeSettings, EndpointType } from '../shared/types';

export function Settings({ onlyType }: { onlyType: EndpointType }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [endpointCount, setEndpointCount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.listEndpoints().then(eps => {
      setEndpointCount(eps.filter(e => e.type === onlyType).length);
    });
  }, [onlyType]);

  if (!settings) return null;

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
    <section style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <TypeCard
        value={settings[onlyType]}
        onChange={patch => saveType(onlyType, patch)}
        endpointCount={endpointCount}
      />
      {saving && <small style={{ opacity: 0.6 }}>저장 중...</small>}
    </section>
  );
}

function TypeCard({
  value,
  onChange,
  endpointCount,
}: {
  value: TypeSettings;
  onChange: (patch: Partial<TypeSettings>) => void;
  endpointCount: number;
}) {
  // 실질 주기 = max(interval, stagger × (개수-1) + 1초)
  // stagger × N 이 interval 보다 크면 interval 무시되고 stagger 가 주기 결정
  const cycleSpreadMs = value.stagger_ms * Math.max(0, endpointCount - 1);
  const effectiveCycleMs = Math.max(value.interval_ms, cycleSpreadMs + 1000);
  const intervalDominated = effectiveCycleMs > value.interval_ms;

  return (
    <div style={card}>
      <h3 style={cardTitle}>측정 / 임계값 / 알람 조건</h3>

      <Row label="측정 간격 (초)" hint="endpoint를 얼마나 자주 호출할지. 짧을수록 타겟 부담 증가.">
        <input
          type="number"
          min={5}
          value={Math.round(value.interval_ms / 1000)}
          onChange={e => onChange({ interval_ms: Math.max(5, Number(e.target.value)) * 1000 })}
        />
      </Row>

      <Row label="발사 간격 stagger (초)" hint="한 사이클 안 endpoint들 사이 시차. 0이면 동시 발사.">
        <input
          type="number"
          min={0}
          step={0.5}
          value={value.stagger_ms / 1000}
          onChange={e => onChange({ stagger_ms: Math.max(0, Number(e.target.value)) * 1000 })}
        />
      </Row>

      {endpointCount > 0 && (
        <p style={cycleInfo}>
          💡 현재 등록된 endpoint <strong>{endpointCount}개</strong> 기준 실질 측정 주기:{' '}
          <strong>{Math.round(effectiveCycleMs / 1000)}초</strong>
          {intervalDominated && (
            <>
              {' '}
              <span style={{ color: '#fbbf24' }}>
                ⚠️ stagger × {endpointCount - 1} = {Math.round(cycleSpreadMs / 1000)}초가 측정 간격
                {Math.round(value.interval_ms / 1000)}초보다 길어 stagger 가 주기를 결정합니다.
              </span>
            </>
          )}
        </p>
      )}

      <Row label="주의 (ms)" hint="이 값 이상이면 🟡 주의 — 로그 적재.">
        <input
          type="number"
          value={value.warning_ms}
          onChange={e => onChange({ warning_ms: Number(e.target.value) })}
        />
      </Row>

      <Row label="심각 (ms)" hint="이 값 이상이거나 호출 실패면 🔴 심각.">
        <input
          type="number"
          value={value.critical_ms}
          onChange={e => onChange({ critical_ms: Number(e.target.value) })}
        />
      </Row>

      <Row label="알람 쿨다운 (분)" hint="알람 발동 후 같은 대상 재알람 막는 시간. 폭격 방지용.">
        <input
          type="number"
          min={0}
          value={Math.round(value.alarm_cooldown_ms / 60_000)}
          onChange={e => onChange({ alarm_cooldown_ms: Math.max(0, Number(e.target.value)) * 60_000 })}
        />
      </Row>

      <Row label="알람 방식" hint="언제 슬랙 알람을 쏠지 판정 기준.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ModeBtn
            active={value.alarm_mode === 'consecutive'}
            onClick={() => onChange({ alarm_mode: 'consecutive' })}
            hint="한 endpoint가 연속 N회 임계 초과 시 알람. 서버 다운 감지에 적합."
          >
            연속 N회
          </ModeBtn>
          <ModeBtn
            active={value.alarm_mode === 'cycle'}
            onClick={() => onChange({ alarm_mode: 'cycle' })}
            hint="한 사이클 안 그룹의 K% 이상이 임계 초과 시 그룹 알람. DB 병목 감지에 적합."
          >
            사이클 동시
          </ModeBtn>
          <ModeBtn
            active={value.alarm_mode === 'sliding'}
            onClick={() => onChange({ alarm_mode: 'sliding' })}
            hint="그룹의 최근 N개 측정 중 M개 임계 초과 시 그룹 알람. 간헐 실패 누적 감지에 적합."
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
          <p style={modeExample}>
            <strong>예시:</strong> 한 endpoint가 측정될 때마다 임계 초과 여부를 카운트. 연속으로{' '}
            <strong>{value.alarm_consecutive}회 이상</strong> 임계 초과면 그 endpoint 알람 발송.
            중간에 정상 응답이 한 번이라도 끼면 카운터 리셋.
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
          <p style={modeExample}>
            <strong>예시:</strong> 같은 그룹에 endpoint 5개가 있다고 가정. 한 사이클(전체 1회씩
            호출) 동안 <strong>{Math.ceil((5 * value.alarm_cycle_percent) / 100)}개 이상</strong>이
            임계 초과면 그룹 알람 1건 발송. (5개 중{' '}
            {Math.ceil((5 * value.alarm_cycle_percent) / 100)}개 = 약{' '}
            {Math.round((Math.ceil((5 * value.alarm_cycle_percent) / 100) / 5) * 100)}%)
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
          <p style={modeExample}>
            <strong>예시:</strong> 그룹 안에서 시간순 최근 {value.alarm_window}회 측정(여러
            endpoint 섞여서) 중 <strong>{value.alarm_window_hits}회 이상</strong> 임계 초과면 그룹
            알람 1건. 한 사이클에 몰리지 않고 띄엄띄엄 쌓이는 패턴까지 잡음.
          </p>
        </>
      )}

      <div style={{ height: 1, background: '#2a2f3a', margin: '16px 0' }} />

      <Row label="데이터 보관 (일)" hint="이 기간보다 오래된 측정/이벤트는 자동 삭제.">
        <input
          type="number"
          min={1}
          value={value.retention_days}
          onChange={e => onChange({ retention_days: Math.max(1, Number(e.target.value)) })}
        />
      </Row>
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <span className="tt">
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
      {hint && <span className="tt-bubble">{hint}</span>}
    </span>
  );
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
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
      {hint ? (
        <span className="tt" style={{ display: 'inline-block', width: 'fit-content' }}>
          <label
            style={{
              opacity: 0.8,
              cursor: 'help',
              borderBottom: '1px dotted #4a5568',
            }}
          >
            {label}
          </label>
          <span className="tt-bubble">{hint}</span>
        </span>
      ) : (
        <label style={{ opacity: 0.8 }}>{label}</label>
      )}
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

const modeExample: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.6,
  opacity: 0.7,
  margin: 0,
  padding: '8px 10px',
  background: '#14161a',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
};

const cycleInfo: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.6,
  opacity: 0.75,
  margin: '0 0 12px',
  padding: '8px 10px',
  background: '#14161a',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
};
