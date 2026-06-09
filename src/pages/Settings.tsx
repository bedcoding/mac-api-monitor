import { useEffect, useState } from 'react';
import type { Settings as SettingsType, TypeSettings, EndpointType } from '../shared/types';

export function Settings({ onlyType }: { onlyType: EndpointType }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [endpointCount, setEndpointCount] = useState(0);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.listEndpoints().then(eps => {
      setEndpointCount(eps.filter(e => e.type === onlyType).length);
    });
  }, [onlyType]);

  if (!settings) return null;
  const cfg = settings[onlyType];

  async function save(patch: Partial<TypeSettings>) {
    setSettings(prev => (prev ? { ...prev, [onlyType]: { ...prev[onlyType], ...patch } } : prev));
    await window.api.updateSettings({ [onlyType]: patch });
  }

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <CycleCard cfg={cfg} endpointCount={endpointCount} onSave={save} />
      <ThresholdCard cfg={cfg} onSave={save} />
      <AlarmCard cfg={cfg} onSave={save} />
      <RetentionCard cfg={cfg} onSave={save} />
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
 * 카드들 — 각자 draft state + 저장/취소 버튼
 * ────────────────────────────────────────────────────────── */

function CycleCard({
  cfg,
  endpointCount,
  onSave,
}: {
  cfg: TypeSettings;
  endpointCount: number;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
}) {
  return (
    <DraftCard
      title="측정 주기"
      initial={{ interval_ms: cfg.interval_ms, stagger_ms: cfg.stagger_ms }}
      deps={[cfg.interval_ms, cfg.stagger_ms]}
      onSave={onSave}
      render={(draft, setDraft) => {
        const cycleSpread = draft.stagger_ms * Math.max(0, endpointCount - 1);
        const effective = Math.max(draft.interval_ms, cycleSpread + 1000);
        const intervalDominated = effective > draft.interval_ms;
        return (
          <>
            <Row label="측정 간격 (초)" hint="endpoint를 얼마나 자주 호출할지.">
              <NumInput
                min={5}
                value={Math.round(draft.interval_ms / 1000)}
                onChange={v => setDraft({ ...draft, interval_ms: v * 1000 })}
              />
            </Row>
            <Row label="발사 간격 stagger (초)" hint="한 사이클 안 endpoint들 사이 시차.">
              <NumInput
                min={1}
                step={0.5}
                value={draft.stagger_ms / 1000}
                onChange={v => setDraft({ ...draft, stagger_ms: v * 1000 })}
              />
            </Row>
            {endpointCount > 0 && (
              <p style={infoBox}>
                등록 endpoint <strong>{endpointCount}개</strong> 기준 실질 측정 주기:{' '}
                <strong>{Math.round(effective / 1000)}초</strong>
                {intervalDominated && (
                  <>
                    {' '}
                    <span style={{ color: '#fbbf24' }}>
                      ⚠️ stagger × {endpointCount - 1} ={' '}
                      {Math.round(cycleSpread / 1000)}초가 측정 간격{' '}
                      {Math.round(draft.interval_ms / 1000)}초보다 길어 stagger가 주기를 결정합니다.
                    </span>
                  </>
                )}
              </p>
            )}
          </>
        );
      }}
    />
  );
}

function ThresholdCard({
  cfg,
  onSave,
}: {
  cfg: TypeSettings;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
}) {
  return (
    <DraftCard
      title="임계값"
      initial={{ warning_ms: cfg.warning_ms, critical_ms: cfg.critical_ms }}
      deps={[cfg.warning_ms, cfg.critical_ms]}
      onSave={onSave}
      render={(draft, setDraft) => (
        <>
          <Row label="주의 (ms)" hint="이 값 이상이면 🟡 주의 — 로그 적재.">
            <NumInput
              min={1}
              value={draft.warning_ms}
              onChange={v => setDraft({ ...draft, warning_ms: v })}
            />
          </Row>
          <Row label="심각 (ms)" hint="이 값 이상이거나 호출 실패면 🔴 심각.">
            <NumInput
              min={1}
              value={draft.critical_ms}
              onChange={v => setDraft({ ...draft, critical_ms: v })}
            />
          </Row>
        </>
      )}
    />
  );
}

function AlarmCard({
  cfg,
  onSave,
}: {
  cfg: TypeSettings;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
}) {
  return (
    <DraftCard
      title="알람 조건"
      initial={{
        alarm_cooldown_ms: cfg.alarm_cooldown_ms,
        alarm_mode: cfg.alarm_mode,
        alarm_consecutive: cfg.alarm_consecutive,
        alarm_window: cfg.alarm_window,
        alarm_window_hits: cfg.alarm_window_hits,
        alarm_cycle_percent: cfg.alarm_cycle_percent,
      }}
      deps={[
        cfg.alarm_cooldown_ms,
        cfg.alarm_mode,
        cfg.alarm_consecutive,
        cfg.alarm_window,
        cfg.alarm_window_hits,
        cfg.alarm_cycle_percent,
      ]}
      onSave={onSave}
      render={(draft, setDraft) => (
        <>
          <Row label="알람 쿨다운 (분)" hint="알람 발동 후 같은 대상 재알람 막는 시간.">
            <NumInput
              min={0}
              value={Math.round(draft.alarm_cooldown_ms / 60_000)}
              onChange={v => setDraft({ ...draft, alarm_cooldown_ms: v * 60_000 })}
            />
          </Row>

          <Row label="알람 방식" hint="언제 슬랙 알람을 쏠지 판정 기준.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <ModeBtn
                active={draft.alarm_mode === 'consecutive'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'consecutive' })}
                hint="한 endpoint가 연속 N회 임계 초과 시 알람."
              >
                연속 N회
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'cycle'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'cycle' })}
                hint="한 사이클 안 그룹의 K% 이상 임계 초과 시 그룹 알람."
              >
                사이클 동시
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'sliding'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'sliding' })}
                hint="그룹의 최근 N개 측정 중 M개 임계 초과 시 그룹 알람."
              >
                시간 누적
              </ModeBtn>
            </div>
          </Row>

          {draft.alarm_mode === 'consecutive' && (
            <>
              <Row label="연속 N회 시 발동">
                <NumInput
                  min={1}
                  value={draft.alarm_consecutive}
                  onChange={v => setDraft({ ...draft, alarm_consecutive: v })}
                />
              </Row>
              <p style={infoBox}>
                한 endpoint가 연속 <strong>{draft.alarm_consecutive}회 이상</strong> 임계 초과면 그
                endpoint 알람. 중간에 정상 응답이 한 번이라도 끼면 카운터 리셋.
              </p>
            </>
          )}

          {draft.alarm_mode === 'cycle' && (
            <>
              <Row label="사이클 내 초과 비율(%)">
                <NumInput
                  min={1}
                  max={100}
                  value={draft.alarm_cycle_percent}
                  onChange={v => setDraft({ ...draft, alarm_cycle_percent: v })}
                />
              </Row>
              <p style={infoBox}>
                같은 그룹 endpoint 5개 가정. 한 사이클 동안{' '}
                <strong>{Math.ceil((5 * draft.alarm_cycle_percent) / 100)}개 이상</strong> 임계
                초과면 그룹 알람 1건.
              </p>
            </>
          )}

          {draft.alarm_mode === 'sliding' && (
            <>
              <Row label="윈도우 크기 (최근 N회)">
                <NumInput
                  min={1}
                  value={draft.alarm_window}
                  onChange={v => setDraft({ ...draft, alarm_window: v })}
                />
              </Row>
              <Row label="초과 M회 시 발동">
                <NumInput
                  min={1}
                  value={draft.alarm_window_hits}
                  onChange={v => setDraft({ ...draft, alarm_window_hits: v })}
                />
              </Row>
              <p style={infoBox}>
                그룹 안 최근 {draft.alarm_window}회 측정 중{' '}
                <strong>{draft.alarm_window_hits}회 이상</strong> 임계 초과면 그룹 알람 1건.
              </p>
            </>
          )}
        </>
      )}
    />
  );
}

function RetentionCard({
  cfg,
  onSave,
}: {
  cfg: TypeSettings;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
}) {
  return (
    <DraftCard
      title="데이터 보관"
      initial={{ retention_days: cfg.retention_days }}
      deps={[cfg.retention_days]}
      onSave={onSave}
      render={(draft, setDraft) => (
        <Row label="보관 기간 (일)" hint="이 기간보다 오래된 측정/이벤트는 자동 삭제.">
          <NumInput
            min={1}
            value={draft.retention_days}
            onChange={v => setDraft({ ...draft, retention_days: v })}
          />
        </Row>
      )}
    />
  );
}

/* ──────────────────────────────────────────────────────────
 * 공통 — draft 카드 래퍼
 * ────────────────────────────────────────────────────────── */

function DraftCard<T extends Partial<TypeSettings>>({
  title,
  initial,
  deps,
  onSave,
  render,
}: {
  title: string;
  initial: T;
  deps: unknown[];
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
  render: (draft: T, setDraft: (next: T) => void) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // 외부 변경 (다른 곳에서 저장됨, type 토글 등) 시 draft 동기화
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(initial), deps);

  const dirty = !shallowEq(draft, initial);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={card}>
      <h3 style={cardTitle}>{title}</h3>
      {render(draft, setDraft)}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid #2a2f3a',
          alignItems: 'center',
        }}
      >
        <button onClick={handleSave} disabled={!dirty || saving} className="btn-primary">
          {saving ? '저장 중...' : '저장'}
        </button>
        <button onClick={() => setDraft(initial)} disabled={!dirty || saving}>
          취소
        </button>
        {dirty ? (
          <span style={{ fontSize: 11, color: '#fbbf24' }}>변경됨 — 저장하지 않은 내용 있음</span>
        ) : savedAt > 0 && Date.now() - savedAt < 3000 ? (
          <span style={{ fontSize: 11, color: '#4ade80' }}>저장됨</span>
        ) : null}
      </div>
    </div>
  );
}

function shallowEq<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/* ──────────────────────────────────────────────────────────
 * 입력 컴포넌트 — 타이핑 자유, 클램프는 commit/blur 시
 * ────────────────────────────────────────────────────────── */

function NumInput({
  value,
  min = 0,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit() {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    let next = Math.max(min, n);
    if (max !== undefined) next = Math.min(max, next);
    setText(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
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
          <label style={{ opacity: 0.8, cursor: 'help', borderBottom: '1px dotted #4a5568' }}>
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
  margin: '0 0 14px',
  fontSize: 14,
};

const infoBox: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.6,
  opacity: 0.75,
  margin: 0,
  padding: '8px 10px',
  background: '#14161a',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
};
