import { useEffect, useRef, useState } from 'react';
import type {
  Settings as SettingsType,
  TypeSettings,
  EndpointType,
  BrowserSessionStatus,
} from '../shared/types';

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
      {onlyType === 'browser' && <BrowserConfigCard cfg={cfg} onSave={save} />}
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
                    <br />
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

  const typeLabel = type === 'health' ? '헬스체크' : type === 'browser' ? '브라우저' : '기능체크';
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
                각 API마다 실패 횟수 측정
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'cycle'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'cycle' })}
                hint="한 사이클에 같은 서버 API의 K%가 🔴심각이면 알람"
              >
                같은 서버의 실패 비율 측정
              </ModeBtn>
              <ModeBtn
                active={draft.alarm_mode === 'sliding'}
                onClick={() => setDraft({ ...draft, alarm_mode: 'sliding' })}
                hint="같은 서버의 최근 N개 측정 중 🔴심각이 M번이면 알람"
              >
                같은 서버의 실패 횟수 측정
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
              <p style={{ ...infoBox, position: 'relative', paddingRight: 28 }}>
                <ModeGuide mode={draft.alarm_mode} />
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
              <p style={{ ...infoBox, position: 'relative', paddingRight: 28 }}>
                <ModeGuide mode={draft.alarm_mode} />
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
              <p style={{ ...infoBox, position: 'relative', paddingRight: 28 }}>
                <ModeGuide mode={draft.alarm_mode} />
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
 * 브라우저 점검 전용 — 로그인 페이지 / 세션 확인
 * ────────────────────────────────────────────────────────── */

/**
 * 로그인 페이지 URL 에서 '세션 만료' 판정 패턴(경로)을 자동 추출.
 * 로그인스러운 경로(login/signin/auth)일 때만 채택 — 홈 등 일반 경로를 넣었을 때
 * 모든 페이지가 '만료'로 오판되는 것을 막고 안전한 기본값 '/login' 으로 떨어진다.
 */
function loginPatternFrom(url: string): string {
  try {
    const p = new URL(url).pathname;
    if (/login|signin|sign-in|auth/i.test(p)) return p;
  } catch {
    /* ignore */
  }
  return '/login';
}

function BrowserConfigCard({
  cfg,
  onSave,
}: {
  cfg: TypeSettings;
  onSave: (patch: Partial<TypeSettings>) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = useState(cfg.base_url);
  const [session, setSession] = useState<BrowserSessionStatus | null>(null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);

  useEffect(() => setBaseUrl(cfg.base_url), [cfg.base_url]);

  // 로그인 상태: 초기엔 main 의 추적값을 받고, 로그인 창에서 로그인 감지 시 push 로 자동 갱신.
  useEffect(() => {
    window.api.browserSessionStatus().then(setSession);
    return window.api.onBrowserSessionChange(setSession);
  }, []);

  async function openLogin() {
    const r = await window.api.openBrowserLogin();
    setLoginMsg(r.message);
  }

  const badge =
    session === null || session.state === 'unknown'
      ? { text: '로그인 상태 미확인 — 아래 버튼으로 로그인', color: '#9aa6b8' }
      : session.state === 'ok'
        ? { text: '로그인됨 ✓', color: '#4ade80' }
        : { text: '세션 만료 — 재로그인 필요', color: '#f87171' };

  return (
    <div style={card}>
      <h3 style={cardTitle}>브라우저 / 로그인</h3>

      {/* 비상정지 토글 — "맥북 연기 모락모락" 시 클릭. 끄면 자동 점검 즉시 중단 + 숨은 창 닫힘. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          marginBottom: 14,
          background: '#14161a',
          borderRadius: 8,
          border: `1px solid ${cfg.checks_enabled ? '#3a4150' : '#ef4444'}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            자동 점검 {cfg.checks_enabled ? '켜짐 🟢' : '꺼짐 ⛔ (비상정지)'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
            끄면 자동 화면 점검이 즉시 멈추고 숨은 창도 닫힙니다. 다시 켜면 이어서 점검.
          </div>
        </div>
        <label style={{ flexShrink: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cfg.checks_enabled === 1}
            onChange={e => onSave({ checks_enabled: e.target.checked ? 1 : 0 })}
            style={{ width: 18, height: 18 }}
          />
        </label>
      </div>

      {/* 데이터 API 실패 감지 — 껍데기 HTML 은 200이어도 같은 도메인 API 가 터지면 실패로. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          marginBottom: 14,
          background: '#14161a',
          borderRadius: 8,
          border: '1px solid #3a4150',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>데이터 API 실패도 장애로 잡기</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
            화면 껍데기는 200이어도, 같은 도메인 API(XHR·fetch)가 5xx거나 연결 실패면 실패로 표시합니다
            (화면 하얀 케이스). 끄면 껍데기 HTTP 상태만 봅니다.
          </div>
        </div>
        <label style={{ flexShrink: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cfg.fail_on_api_error === 1}
            onChange={e => onSave({ fail_on_api_error: e.target.checked ? 1 : 0 })}
            style={{ width: 18, height: 18 }}
          />
        </label>
      </div>

      <Row
        label="로그인 페이지 URL"
        hint="로그인하는 페이지 주소. '로그인 창 열기'가 이 주소를 열고, 점검 중 화면이 여기로 튕기면 '세션 만료'로 자동 판정. 로그인 패턴은 이 주소에서 자동 추출됨 (예: https://www.example.com/login)"
      >
        <input
          type="text"
          placeholder="https://www.example.com/login"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          onBlur={() => {
            const v = baseUrl.trim();
            if (v !== cfg.base_url) onSave({ base_url: v, login_pattern: loginPatternFrom(v) });
          }}
          style={{ width: '100%' }}
        />
      </Row>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginTop: 4,
          flexWrap: 'wrap',
        }}
      >
        <button className="btn-primary" onClick={openLogin}>
          로그인 창 열기
        </button>
        <span style={{ fontSize: 12, color: badge.color }}>● {badge.text}</span>
      </div>
      {loginMsg && <p style={{ fontSize: 11, opacity: 0.6, margin: '8px 0 0' }}>{loginMsg}</p>}

      <p style={{ ...infoBox, marginTop: 10 }}>
        <strong>로그인 창 열기</strong> → 로그인하면 자동으로 '로그인됨'이 표시됩니다 (세션은 저장돼 앱을
        껐다 켜도 유지). 점검할 화면은 <strong>추가</strong> 탭에서 <strong>로그인해야 보이는 URL</strong> 로
        등록하세요. 세션이 끊기면 그 화면들이 조회/로그에서 빨강('재로그인 필요')으로 알려줍니다.
        <br />※ 세션 만료는 슬랙 알람을 쏘지 않습니다(장애 아님).
      </p>
    </div>
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
      onChange={e => {
        const v = e.target.value;
        setText(v);
        if (v === '') return; // 입력 도중 빈 값은 무시 (blur 시 안전망에서 복원)
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        const next = Math.max(min, max !== undefined ? Math.min(max, n) : n);
        if (next !== value) onChange(next);
      }}
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

function ModeGuide({ mode }: { mode: 'consecutive' | 'cycle' | 'sliding' }) {
  const text = {
    consecutive: 'API마다 다른 서버를 가리킬 때 적합 (추천: 헬스체크)',
    cycle: '여러 API가 같은 서버 공유 시 적합 (추천: 기능체크)',
    sliding: '여러 API가 같은 서버 공유 시 적합 (추천: 기능체크)',
  }[mode];

  return (
    <span
      className="tt"
      style={{ position: 'absolute', top: 6, right: 8 }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, cursor: 'help', opacity: 0.55 }}>ⓘ</span>
      <span
        className="tt-bubble"
        style={{ left: 'auto', right: 0 }}
      >
        {text}
      </span>
    </span>
  );
}
