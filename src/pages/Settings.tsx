import { useEffect, useRef, useState } from 'react';
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
                등록 endpoint {endpointCount}개 기준 실질 측정 주기:{' '}
                {Math.round(effective / 1000)}초
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
          <Row
            label="주의 (ms)"
            hint="이 값 이상이면 🟡주의 — 대시보드/차트/로그 시각화 전용. 슬랙 알람은 발사하지 않음."
          >
            <NumInput
              min={1}
              value={draft.warning_ms}
              onChange={v => setDraft({ ...draft, warning_ms: v })}
            />
          </Row>
          <Row
            label="심각 (ms)"
            hint="이 값 이상이거나 호출 실패면 🔴심각 — 슬랙 알람의 유일한 트리거."
          >
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

export function AlarmCard({
  cfg,
  onSave,
  type,
}: {
  cfg: TypeSettings;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
  type: EndpointType;
}) {
  const [stats, setStats] = useState<{
    total: number;
    groups: Array<{ name: string; size: number }>;
  }>({ total: 0, groups: [] });

  useEffect(() => {
    window.api.listEndpoints().then(eps => {
      const mine = eps.filter(e => e.type === type);
      const byGroup = new Map<string, number>();
      for (const ep of mine) {
        const g = ep.group?.trim() || '(미분류)';
        byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
      }
      const groups = [...byGroup.entries()]
        .map(([name, size]) => ({ name, size }))
        .sort((a, b) => b.size - a.size);
      setStats({ total: mine.length, groups });
    });
  }, [type]);

  const typeLabel = type === 'health' ? '헬스체크' : '기능체크';
  const groupsAllSingleton = stats.groups.length > 0 && stats.groups.every(g => g.size === 1);

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

          <Row
            label="알람 방식"
            alignTop
            hint={
              `🔴심각 응답을 어떤 패턴으로 묶어 알람을 쏠지 결정.
               🟡주의는 어느 방식에서도 알람 대상이 아님.

               * 같은 서버 기준: '추가' 메뉴에서 입력한 group 필드`
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <ModeBtn
                active={draft.alarm_mode === 'consecutive'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'consecutive' })}
                hint="한 API가 🔴심각을 연속 N회 기록하면 그 API 알람"
              >
                각 API 따로 카운트
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'cycle'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'cycle' })}
                hint="한 사이클에 같은 서버 API의 K%가 동시에 🔴심각이면 서버 알람"
              >
                같은 서버 API 동시 다운
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'sliding'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'sliding' })}
                hint="같은 서버의 최근 N개 측정 중 🔴심각이 M번이면 서버 알람"
              >
                같은 서버 API 누적 실패
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
                같은 API가 연속 {draft.alarm_consecutive}회 🔴심각이면 그 API 알람 발사.
                <br />
                <br />
                • 🟡주의나 🟢정상이 한 번이라도 끼면 카운터 0으로 리셋
                <br />
                • 다른 API의 🔴심각은 합산되지 않음
              </p>
            </>
          )}

          {draft.alarm_mode === 'cycle' && (
            <>
              <Row
                label="사이클 내 🔴심각 비율(%)"
                hint="한 사이클: 모든 API를 1회씩 호출"
              >
                <NumInput
                  min={1}
                  max={100}
                  value={draft.alarm_cycle_percent}
                  onChange={v => setDraft({ ...draft, alarm_cycle_percent: v })}
                />
              </Row>
              <p style={infoBox}>
                한 사이클에서 같은 서버에 속한 API의 {draft.alarm_cycle_percent}% 이상이 🔴심각이면 그 서버 알람 발사.<br />
                <br />
                {stats.groups.length > 0 ? (
                  <span style={{ opacity: 0.85 }}>
                    {stats.groups.map(g => {
                      const need = Math.max(1, Math.ceil((g.size * draft.alarm_cycle_percent) / 100));
                      return (
                        <span key={g.name}>
                          • <code>{g.name}</code>: {g.size}개 중{' '}
                          {need}개 이상 🔴심각 → 알람
                          <br />
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  <span style={{ opacity: 0.85 }}>
                    예) 한 서버에 API 5개를 등록했고 비율을 {draft.alarm_cycle_percent}%로 두면, 한
                    사이클에{' '}
                    
                      {Math.max(1, Math.ceil((5 * draft.alarm_cycle_percent) / 100))}개 이상
                    
                    이 동시에 🔴심각이면 그 서버 알람 1건.
                    <br />
                    <span style={{ opacity: 0.7 }}>
                      * endpoint를 등록하면 본인 서버 기준 실제 임계치로 표시됩니다.
                    </span>
                  </span>
                )}
                
                {groupsAllSingleton && (
                  <>
                    <br />
                    <span style={{ color: '#fbbf24' }}>
                      ⚠️ 현재 {typeLabel}의 모든 서버에 API가 1개씩만 등록되어 있어 이 모드는 "각 API 따로 카운트"와 사실상 동일하게 동작합니다.
                    </span>
                  </>
                )}
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
              <Row label="🔴심각 M회 시 발동">
                <NumInput
                  min={1}
                  value={draft.alarm_window_hits}
                  onChange={v => setDraft({ ...draft, alarm_window_hits: v })}
                />
              </Row>
              <p style={infoBox}>
                같은 서버 API의 최근 {draft.alarm_window}회 측정 중 {draft.alarm_window_hits}회가 🔴심각이면 그 서버 알람 발사.
                {groupsAllSingleton && (
                  <>
                    <br />
                    <br />
                    <span style={{ color: '#fbbf24' }}>
                      ⚠️ 현재 {typeLabel}의 모든 서버에 API가 1개씩만 등록되어 있어 이 모드는 "한
                      API의 최근 {draft.alarm_window}회 중 {draft.alarm_window_hits}회 실패"와
                      같습니다.
                    </span>
                  </>
                )}
              </p>
            </>
          )}

          <div style={guideBox}>
            {
              {
                consecutive: 'API마다 다른 서버를 가리킬 때 적합 (추천: 헬스체크)',
                cycle: '여러 API가 같은 서버를 공유할 때 적합 (추천: 기능체크)',
                sliding: '여러 API가 같은 서버를 공유할 때 적합 (추천: 기능체크)',
              }[draft.alarm_mode]
            }
          </div>
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
          borderTop: '1px solid #3a4150',
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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties | undefined>();

  function updatePosition() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const TOOLTIP_MAX_W = 280;
    const SAFE_MARGIN = 12;
    const overflowsRight = rect.left + TOOLTIP_MAX_W > window.innerWidth - SAFE_MARGIN;
    setBubbleStyle(overflowsRight ? { left: 'auto', right: 0 } : undefined);
  }

  return (
    <span
      className="tt"
      ref={wrapRef}
      onMouseEnter={updatePosition}
      style={{ display: 'block', width: '100%' }}
    >
      <button
        onClick={onClick}
        aria-pressed={active}
        style={{
          background: active ? '#3b82f6' : 'transparent',
          border: `1px solid ${active ? '#3b82f6' : '#3a4150'}`,
          color: active ? '#fff' : '#a0aec0',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {children}
      </button>
      {hint && (
        <span className="tt-bubble" style={bubbleStyle}>
          {hint}
        </span>
      )}
    </span>
  );
}

function Row({
  label,
  children,
  hint,
  alignTop,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  alignTop?: boolean;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties | undefined>();

  function updatePosition() {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const TOOLTIP_MAX_W = 280;
    const SAFE_MARGIN = 12;
    const overflowsRight = rect.left + TOOLTIP_MAX_W > window.innerWidth - SAFE_MARGIN;
    setBubbleStyle(overflowsRight ? { left: 'auto', right: 0 } : undefined);
  }

  const labelStyle: React.CSSProperties = {
    opacity: 0.8,
    paddingTop: alignTop ? 6 : 0,
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        alignItems: alignTop ? 'flex-start' : 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
      {hint ? (
        <span
          className="tt"
          ref={wrapRef}
          onMouseEnter={updatePosition}
          style={{ display: 'inline-block', width: 'fit-content' }}
        >
          <label
            style={{
              ...labelStyle,
              cursor: 'help',
              borderBottom: '1px dotted #4a5568',
            }}
          >
            {label}
          </label>
          <span className="tt-bubble" style={bubbleStyle}>
            {hint}
          </span>
        </span>
      ) : (
        <label style={labelStyle}>{label}</label>
      )}
      <div>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #3a4150',
  borderRadius: 12,
  padding: 20,
  background: '#2a3038',
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
  border: '1px solid #3a4150',
};

const guideBox: React.CSSProperties = {
  fontSize: 12,
  padding: '8px 12px',
  background: 'rgba(59, 130, 246, 0.1)',
  borderLeft: '3px solid #3b82f6',
  borderRadius: 4,
  marginTop: 3,
  marginBottom: 4,
  color: '#cbd5e1',
};
