import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThresholdEvent, EndpointType, EndpointStat } from '../shared/types';

type ViewMode = 'time' | 'api' | 'server';

const VIEW_LABEL: Record<ViewMode, string> = {
  time: '시간순',
  api: 'API별',
  server: '서버별',
};

const MAX_DOTS_PER_API = 60;
const MAX_DOTS_PER_SERVER = 120;
const STATS_HOURS = 24;
const DOT_SIZE = 14;
const DOT_GAP = 4;

/**
 * dot 박스의 한 줄에 들어가는 dot 개수.
 * 표시 개수를 이 값의 배수로 잘라 마지막 줄이 어중간하게 비지 않게 한다.
 */
function useDotsPerRow(ref: React.RefObject<HTMLDivElement>, hPadding: number) {
  const [perRow, setPerRow] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - hPadding;
      setPerRow(Math.max(1, Math.floor((w + DOT_GAP) / (DOT_SIZE + DOT_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, hPadding]);
  return perRow;
}

function dotCap(perRow: number, max: number): number {
  if (perRow <= 0) return max;
  return perRow * Math.max(1, Math.floor(max / perRow));
}

function formatGap(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}초`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}분`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}시간`;
  return `${Math.round(ms / 86400_000)}일`;
}
const VIEW_STORAGE_KEY = 'events.view';
const ISSUES_ONLY_STORAGE_KEY = 'events.issuesOnly';

type EventCategory = 'failure' | 'critical' | 'warning' | 'healthy';

function categorize(ev: ThresholdEvent): EventCategory {
  if (ev.ok === 0) return 'failure';
  if (ev.level === 'critical') return 'critical';
  if (ev.level === 'healthy') return 'healthy';
  return 'warning';
}

const CATEGORY_COLOR: Record<EventCategory, string> = {
  failure: '#ef4444',
  critical: '#ef4444',
  warning: '#fbbf24',
  healthy: '#4ade80',
};

const CATEGORY_TEXT_COLOR: Record<EventCategory, string> = {
  failure: '#f87171',
  critical: '#fca5a5',
  warning: '#fcd34d',
  healthy: '#86efac',
};

const CATEGORY_EMOJI: Record<EventCategory, string> = {
  failure: '❌',
  critical: '🔴',
  warning: '🟡',
  healthy: '🟢',
};

const CATEGORY_LABEL: Record<EventCategory, string> = {
  failure: '실패',
  critical: '심각',
  warning: '주의',
  healthy: '정상',
};

export function Events({
  refreshKey,
  filterType,
}: {
  refreshKey: number;
  filterType: EndpointType;
}) {
  const [events, setEvents] = useState<ThresholdEvent[]>([]);
  const [statsMap, setStatsMap] = useState<Map<number, EndpointStat>>(new Map());
  // 탭 전환 시 Events 가 unmount 되므로 보기 옵션은 localStorage 에 기억
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      return v === 'time' || v === 'api' || v === 'server' ? v : 'time';
    } catch {
      return 'time';
    }
  });
  const [issuesOnly, setIssuesOnly] = useState(() => {
    try {
      return localStorage.getItem(ISSUES_ONLY_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
      localStorage.setItem(ISSUES_ONLY_STORAGE_KEY, issuesOnly ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [view, issuesOnly]);
  // 모달은 이벤트 스냅샷을 들고 최상위에서 렌더 — 10초 폴링으로
  // dot 이 리스트 밖으로 밀려 unmount 돼도 열린 모달이 유지된다.
  const [modalEv, setModalEv] = useState<ThresholdEvent | null>(null);
  // API 타임라인 모달 (카드 클릭 시 해당 API 의 최근 24시간 측정 전체)
  const [timelineGroup, setTimelineGroup] = useState<ApiGroup | null>(null);

  // 시간순 탭은 이슈 로그 성격이라 항상 이슈만. 정상 포함은 dot 타임라인 탭에서만.
  const wantAll = !issuesOnly && view !== 'time';

  useEffect(() => {
    if (wantAll) {
      window.api.recentMeasurementsAll(filterType, MAX_DOTS_PER_API).then(setEvents);
    } else {
      window.api.recentThresholdExceeded(filterType, 200).then(setEvents);
    }
    window.api.recentEndpointStats(filterType, STATS_HOURS).then(arr => {
      const m = new Map<number, EndpointStat>();
      for (const s of arr) m.set(s.endpoint_id, s);
      setStatsMap(m);
    });
  }, [refreshKey, filterType, wantAll]);

  return (
    <section style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <ViewToggle view={view} onChange={setView} />
      {view !== 'time' && (
        <label
          style={{
            fontSize: 11,
            opacity: 0.7,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            justifySelf: 'end',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={issuesOnly}
            onChange={e => setIssuesOnly(e.target.checked)}
            style={{ margin: 0 }}
          />
          이슈만 보기
        </label>
      )}
      {events.length === 0 ? (
        <EmptyState />
      ) : view === 'time' ? (
        <TimeView events={events} onOpenBody={setModalEv} />
      ) : view === 'api' ? (
        <ServerGroupView
          events={events}
          statsMap={statsMap}
          onOpenBody={setModalEv}
          onOpenTimeline={setTimelineGroup}
        />
      ) : (
        <ServerMergedView events={events} statsMap={statsMap} onOpenBody={setModalEv} />
      )}
      {timelineGroup && (
        <TimelineModal
          group={timelineGroup}
          type={filterType}
          onClose={() => setTimelineGroup(null)}
          onOpenBody={setModalEv}
        />
      )}
      {modalEv && <BodyModal ev={modalEv} onClose={() => setModalEv(null)} />}
    </section>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 4,
      }}
    >
      {(Object.keys(VIEW_LABEL) as ViewMode[]).map(v => {
        const active = view === v;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            aria-pressed={active}
            style={{
              background: active ? '#2a3038' : 'transparent',
              border: `1px solid ${active ? '#4a5568' : 'transparent'}`,
              borderRadius: 6,
              color: active ? '#e6e8ec' : '#8a94a6',
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              padding: '6px 0',
              cursor: 'pointer',
            }}
          >
            {VIEW_LABEL[v]}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <section
      style={{
        padding: 48,
        textAlign: 'center',
        border: '1px dashed #3a4150',
        borderRadius: 12,
        background: '#2a3038',
      }}
    >
      <h2 style={{ fontSize: 18 }}>임계값 초과 이벤트가 없습니다</h2>
      <p style={{ opacity: 0.7 }}>
        응답시간이 임계값을 넘었거나 호출이 실패한 경우 시간순으로 쌓입니다.
      </p>
    </section>
  );
}

function TimeView({
  events,
  onOpenBody,
}: {
  events: ThresholdEvent[];
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      {events.map(ev => (
        <TimeRow key={ev.id} ev={ev} onOpenBody={onOpenBody} />
      ))}
    </div>
  );
}

function TimeRow({
  ev,
  onOpenBody,
}: {
  ev: ThresholdEvent;
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  const hasBody = ev.body !== null;
  const cat = categorize(ev);

  const onUrlClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.api.openExternal(ev.url);
  };

  return (
    <div
      className={hasBody ? 'row-clickable' : undefined}
      onClick={() => hasBody && onOpenBody(ev)}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        background: '#2a3038',
        border: '1px solid #3a4150',
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <span
        aria-label={CATEGORY_LABEL[cat]}
        title={CATEGORY_LABEL[cat]}
        style={{
          fontSize: 14,
          textAlign: 'center',
        }}
      >
        {CATEGORY_EMOJI[cat]}
      </span>

      <div className="tt" style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {ev.label}
          </div>
          <StatusChip status={ev.status} ok={ev.ok} />
        </div>
        <code
          className="url-link"
          onClick={onUrlClick}
          style={{
            fontSize: 11,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {ev.method} {ev.url}
        </code>
        <span
          className="tt-bubble"
          style={{
            maxWidth: 'min(480px, calc(100vw - 72px))',
            wordBreak: 'break-all',
            whiteSpace: 'normal',
          }}
        >
          <span style={{ fontWeight: 600 }}>{ev.label}</span>
          <br />
          {ev.method} {ev.url}
          <br />
          <span style={{ opacity: 0.5, fontSize: 10 }}>
            {hasBody ? 'URL 클릭: 새 탭 · 행 클릭: 전체 응답' : 'URL 클릭: 새 탭에서 열기'}
          </span>
        </span>
      </div>

      <div style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600 }}>
          {ev.ok === 0 ? <span style={{ color: '#f87171' }}>실패</span> : `${ev.duration_ms}ms`}
        </div>
        <div style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="tt" style={{ cursor: 'help' }}>
            <span style={{ opacity: 0.5 }}>{timeAgo(ev.ts)}</span>
            <span className="tt-bubble" style={{ left: 'auto', right: 0 }}>{fullDate(ev.ts)}</span>
          </span>
          {hasBody && (
            <span
              onClick={e => {
                e.stopPropagation();
                onOpenBody(ev);
              }}
              title="전체 응답 보기"
              style={{
                fontSize: 9,
                opacity: 0.4,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              ▸
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, ok }: { status: number; ok: number }) {
  if (status === 0 && ok === 0) {
    return <Chip color="#fca5a5" bg="rgba(248,113,113,0.18)">FAIL</Chip>;
  }
  if (status >= 500) return <Chip color="#fca5a5" bg="rgba(248,113,113,0.18)">{status}</Chip>;
  if (status >= 400) return <Chip color="#fcd34d" bg="rgba(252,211,77,0.18)">{status}</Chip>;
  return <Chip color="#9aa6b8" bg="rgba(138,148,166,0.15)">{status}</Chip>;
}

function Chip({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 3,
        background: bg,
        color,
        letterSpacing: 0.3,
        flexShrink: 0,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

interface ApiGroup {
  endpointId: number;
  label: string;
  url: string;
  method: string;
  groupName: string | null;
  events: ThresholdEvent[];
}

function groupByEndpoint(events: ThresholdEvent[]): ApiGroup[] {
  const map = new Map<number, ApiGroup>();
  for (const ev of events) {
    let g = map.get(ev.endpoint_id);
    if (!g) {
      g = {
        endpointId: ev.endpoint_id,
        label: ev.label,
        url: ev.url,
        method: ev.method,
        groupName: ev.group_name,
        events: [],
      };
      map.set(ev.endpoint_id, g);
    }
    g.events.push(ev);
  }
  return Array.from(map.values()).sort((a, b) => b.events[0].ts - a.events[0].ts);
}


function ApiCard({
  group,
  stat,
  onOpenBody,
  onOpenTimeline,
}: {
  group: ApiGroup;
  stat?: EndpointStat;
  onOpenBody: (ev: ThresholdEvent) => void;
  onOpenTimeline: (g: ApiGroup) => void;
}) {
  const dotBoxRef = useRef<HTMLDivElement>(null);
  const perRow = useDotsPerRow(dotBoxRef, 20);
  // group.events 는 최신순(ts DESC). 최근 N개를 자른 뒤 뒤집어 왼쪽=과거, 오른쪽=최신.
  // 표시 개수는 한 줄 dot 수의 배수로 잘라 마지막 줄을 꽉 채운다.
  const visible = group.events.slice(0, dotCap(perRow, MAX_DOTS_PER_API)).reverse();
  const more = group.events.length - visible.length;
  const last = group.events[0];
  const failureCount = group.events.filter(e => categorize(e) === 'failure').length;
  const criticalCount = group.events.filter(e => categorize(e) === 'critical').length;
  const warningCount = group.events.filter(e => categorize(e) === 'warning').length;

  return (
    <div
      className="row-clickable"
      onClick={() => onOpenTimeline(group)}
      title="클릭해서 최근 24시간 타임라인 보기"
      style={{
        background: '#2a3038',
        border: '1px solid #3a4150',
        borderRadius: 8,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, minWidth: 0 }}>
        <div className="tt" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {group.label}
            </div>
            <span style={{ fontSize: 10, flexShrink: 0 }}>
              <CountBadges failure={failureCount} critical={criticalCount} warning={warningCount} />
              {stat && stat.total > 0 && (
                <>
                  <span style={{ opacity: 0.4 }}> · </span>
                  <SuccessRate stat={stat} />
                </>
              )}
            </span>
          </div>
          <code
            className="url-link"
            onClick={e => {
              e.stopPropagation();
              window.api.openExternal(group.url);
            }}
            style={{
              fontSize: 10,
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {group.method} {group.url}
          </code>
          <span
            className="tt-bubble"
            style={{
              maxWidth: 'min(480px, calc(100vw - 44px))',
              wordBreak: 'break-all',
              whiteSpace: 'normal',
            }}
          >
            <span style={{ fontWeight: 600 }}>{group.label}</span>
            <br />
            {group.method} {group.url}
            <br />
            <span style={{ opacity: 0.5, fontSize: 10 }}>URL 클릭: 새 탭에서 열기</span>
          </span>
        </div>
        <div className="tt" style={{ fontSize: 10, textAlign: 'right', flexShrink: 0, cursor: 'help' }}>
          <span style={{ opacity: 0.6 }}>{timeAgo(last.ts)}</span>
          <span className="tt-bubble" style={{ left: 'auto', right: 0 }}>
            마지막 이벤트: {fullDate(last.ts)}
          </span>
        </div>
      </div>
      <div
        ref={dotBoxRef}
        style={{
          background: '#1f242c',
          borderRadius: 6,
          padding: '8px 10px',
        }}
      >
        {more > 0 && (
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>+{more}건</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: DOT_GAP }}>
          {visible.map((ev, i) => (
            <DotEvent
              key={ev.id}
              ev={ev}
              prevTs={i > 0 ? visible[i - 1].ts : undefined}
              onOpenBody={onOpenBody}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CountBadges({
  failure,
  critical,
  warning,
}: {
  failure: number;
  critical: number;
  warning: number;
}) {
  type IssueCategory = Exclude<EventCategory, 'healthy'>;
  const items: IssueCategory[] = [];
  if (failure > 0) items.push('failure');
  if (critical > 0) items.push('critical');
  if (warning > 0) items.push('warning');
  const n: Record<IssueCategory, number> = { failure, critical, warning };
  return (
    <>
      {items.map((cat, i) => (
        <span key={cat}>
          {i > 0 && <span style={{ opacity: 0.4 }}> · </span>}
          <span style={{ color: CATEGORY_TEXT_COLOR[cat] }}>
            {CATEGORY_EMOJI[cat]}
            {n[cat]}
          </span>
        </span>
      ))}
    </>
  );
}

function SuccessRate({ stat }: { stat: EndpointStat }) {
  const ok = stat.total - stat.threshold;
  const pct = Math.round((ok / stat.total) * 100);
  return (
    <span style={{ fontSize: 10, opacity: 0.55 }}>
      정상 {pct}% ({ok}/{stat.total})
    </span>
  );
}

function DotEvent({
  ev,
  showLabel,
  prevTs,
  onOpenBody,
}: {
  ev: ThresholdEvent;
  showLabel?: boolean;
  prevTs?: number;
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties>({
    top: 'auto',
    bottom: 'calc(100% + 6px)',
    wordBreak: 'break-all',
  });
  const cat = categorize(ev);
  const color = CATEGORY_COLOR[cat];
  const hasBody = ev.body !== null;

  const onEnter = () => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const BUBBLE_WIDTH = 280;
    const BUBBLE_HEIGHT = 160;
    const SAFE = 8;
    const overflowsRight = rect.left + BUBBLE_WIDTH > window.innerWidth - SAFE;
    const overflowsTop = rect.top < BUBBLE_HEIGHT + SAFE;
    setBubbleStyle({
      ...(overflowsTop
        ? { top: 'calc(100% + 6px)', bottom: 'auto' }
        : { top: 'auto', bottom: 'calc(100% + 6px)' }),
      ...(overflowsRight ? { left: 'auto', right: 0 } : {}),
      wordBreak: 'break-all',
    });
  };

  return (
    <span
      ref={wrapRef}
      className="tt"
      onMouseEnter={onEnter}
      onClick={e => {
        if (hasBody) {
          e.stopPropagation();
          onOpenBody(ev);
        }
      }}
      style={{ lineHeight: 0 }}
    >
      {cat === 'failure' ? (
        <span
          aria-label={CATEGORY_LABEL[cat]}
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            fontSize: 12,
            lineHeight: '14px',
            textAlign: 'center',
            cursor: hasBody ? 'pointer' : 'help',
          }}
        >
          ❌
        </span>
      ) : (
        <span
          aria-label={CATEGORY_LABEL[cat]}
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: color,
            cursor: hasBody ? 'pointer' : 'help',
            boxShadow: `0 0 4px ${color}55`,
          }}
        />
      )}
      <span className="tt-bubble" style={bubbleStyle}>
        {showLabel && (
          <>
            <span style={{ fontWeight: 600 }}>{ev.label}</span>
            <br />
          </>
        )}
        {fullDate(ev.ts)}
        <br />
        {cat === 'failure' ? (
          <>
            ❌실패{ev.status > 0 && ` · HTTP ${ev.status}`} · {ev.duration_ms}ms
          </>
        ) : (
          <>
            {CATEGORY_EMOJI[cat]}
            {CATEGORY_LABEL[cat]} · HTTP {ev.status} · {ev.duration_ms}ms
          </>
        )}
        {prevTs !== undefined && (
          <>
            <br />
            <span style={{ opacity: 0.6 }}>
              이 {showLabel ? '서버' : 'API'}의 직전 기록과 간격 {formatGap(ev.ts - prevTs)}
            </span>
          </>
        )}
        {ev.body && (
          <>
            <br />
            <span style={{ opacity: 0.75, fontSize: 11 }}>
              {ev.body.length > 200 ? `${ev.body.slice(0, 200)}…` : ev.body}
            </span>
          </>
        )}
        {hasBody && (
          <>
            <br />
            <span style={{ opacity: 0.5, fontSize: 10 }}>클릭해서 전체 응답 보기</span>
          </>
        )}
      </span>
    </span>
  );
}

const TIMELINE_HOURS = 24;

function TimelineModal({
  group,
  type,
  onClose,
  onOpenBody,
}: {
  group: ApiGroup;
  type: EndpointType;
  onClose: () => void;
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  const [events, setEvents] = useState<ThresholdEvent[] | null>(null);

  useEffect(() => {
    Promise.all([
      window.api.recentMeasurements(group.endpointId, TIMELINE_HOURS),
      window.api.getSettings(),
    ]).then(([ms, settings]) => {
      const cfg = settings[type];
      // recentMeasurements 는 ts ASC — 왼쪽=과거 그대로 사용
      setEvents(
        ms.map(m => ({
          id: m.id,
          ts: m.ts,
          duration_ms: m.duration_ms,
          status: m.status,
          ok: m.ok,
          endpoint_id: m.endpoint_id,
          label: group.label,
          url: group.url,
          method: group.method,
          group_name: group.groupName,
          level:
            m.ok === 0 || m.duration_ms >= cfg.critical_ms
              ? 'critical'
              : m.duration_ms >= cfg.warning_ms
                ? 'warning'
                : 'healthy',
          body: m.body,
        })),
      );
    });
  }, [group, type]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#2a3038',
          border: '1px solid #3a4150',
          borderRadius: 10,
          width: '100%',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid #3a4150',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {group.label}
            </div>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
              최근 {TIMELINE_HOURS}시간 측정 {events ? `${events.length}회` : '...'}
              {' · '}
              <code style={{ fontSize: 10 }}>
                {group.method} {group.url}
              </code>
            </div>
          </div>
          <button onClick={onClose} style={{ flexShrink: 0, padding: '2px 8px' }}>
            ✕
          </button>
        </div>
        <div style={{ padding: '10px 12px', overflowY: 'auto' }}>
          {events === null ? (
            <div style={{ fontSize: 11, opacity: 0.5 }}>불러오는 중...</div>
          ) : events.length === 0 ? (
            <div style={{ fontSize: 11, opacity: 0.5 }}>최근 {TIMELINE_HOURS}시간 측정 기록이 없습니다</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: DOT_GAP }}>
              {events.map((ev, i) => (
                <DotEvent
                  key={ev.id}
                  ev={ev}
                  prevTs={i > 0 ? events[i - 1].ts : undefined}
                  onOpenBody={onOpenBody}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BodyModal({ ev, onClose }: { ev: ThresholdEvent; onClose: () => void }) {
  const cat = categorize(ev);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#2a3038',
          border: '1px solid #3a4150',
          borderRadius: 10,
          maxWidth: '100%',
          maxHeight: '85%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid #3a4150',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ev.label}
            </div>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>
              {fullDate(ev.ts)} · {CATEGORY_EMOJI[cat]}
              {CATEGORY_LABEL[cat]}
              {ev.status > 0 && ` · HTTP ${ev.status}`} · {ev.duration_ms}ms
            </div>
          </div>
          <button onClick={onClose} style={{ flexShrink: 0, padding: '2px 8px' }}>
            ✕
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: 11,
            fontFamily: "'SF Mono', Menlo, monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflow: 'auto',
            opacity: 0.9,
          }}
        >
          {ev.body || '응답 본문이 비어있음'}
        </pre>
      </div>
    </div>
  );
}

interface ServerGroup {
  name: string;
  apis: ApiGroup[];
  events: ThresholdEvent[];
  failureCount: number;
  criticalCount: number;
  warningCount: number;
  lastTs: number;
}

function groupByServer(events: ThresholdEvent[]): ServerGroup[] {
  const map = new Map<string, ThresholdEvent[]>();
  for (const ev of events) {
    const key = ev.group_name?.trim() || '(미분류)';
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(ev);
  }
  const result: ServerGroup[] = [];
  for (const [name, evs] of map) {
    result.push({
      name,
      apis: groupByEndpoint(evs),
      events: evs,
      failureCount: evs.filter(e => categorize(e) === 'failure').length,
      criticalCount: evs.filter(e => categorize(e) === 'critical').length,
      warningCount: evs.filter(e => categorize(e) === 'warning').length,
      lastTs: evs[0].ts,
    });
  }
  return result.sort((a, b) => b.lastTs - a.lastTs);
}

function ServerGroupView({
  events,
  statsMap,
  onOpenBody,
  onOpenTimeline,
}: {
  events: ThresholdEvent[];
  statsMap: Map<number, EndpointStat>;
  onOpenBody: (ev: ThresholdEvent) => void;
  onOpenTimeline: (g: ApiGroup) => void;
}) {
  const servers = useMemo(() => groupByServer(events), [events]);
  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      {servers.map(s => (
        <ServerSection
          key={s.name}
          server={s}
          statsMap={statsMap}
          onOpenBody={onOpenBody}
          onOpenTimeline={onOpenTimeline}
        />
      ))}
    </div>
  );
}

function ServerHeader({
  server,
  statsMap,
  headingId,
}: {
  server: ServerGroup;
  statsMap: Map<number, EndpointStat>;
  headingId: string;
}) {
  const unclassified = server.name === '(미분류)';
  const serverTotal = server.apis.reduce(
    (s, g) => s + (statsMap.get(g.endpointId)?.total ?? 0),
    0,
  );
  const serverThreshold = server.apis.reduce(
    (s, g) => s + (statsMap.get(g.endpointId)?.threshold ?? 0),
    0,
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '0 2px 8px',
        marginBottom: 8,
        flexWrap: 'wrap',
      }}
    >
      <h2
        id={headingId}
        style={{
          fontSize: 14,
          fontWeight: 700,
          margin: 0,
          opacity: unclassified ? 0.7 : 1,
          fontStyle: unclassified ? 'italic' : 'normal',
        }}
      >
        {server.name}
      </h2>
      <div style={{ fontSize: 10, flex: 1 }}>
        <span style={{ opacity: 0.55 }}>API {server.apis.length}개</span>
        {(server.failureCount > 0 || server.criticalCount > 0 || server.warningCount > 0) && (
          <>
            <span style={{ opacity: 0.4 }}> · </span>
            <CountBadges
              failure={server.failureCount}
              critical={server.criticalCount}
              warning={server.warningCount}
            />
          </>
        )}
        {serverTotal > 0 && (
          <>
            <span style={{ opacity: 0.4 }}> · </span>
            <span style={{ opacity: 0.55 }}>
              정상 {Math.round(((serverTotal - serverThreshold) / serverTotal) * 100)}% (
              {serverTotal - serverThreshold}/{serverTotal})
            </span>
          </>
        )}
      </div>
      <div className="tt" style={{ fontSize: 10, cursor: 'help' }}>
        <span style={{ opacity: 0.55 }}>{timeAgo(server.lastTs)}</span>
        <span className="tt-bubble" style={{ left: 'auto', right: 0 }}>{fullDate(server.lastTs)}</span>
      </div>
    </div>
  );
}

function ServerSection({
  server,
  statsMap,
  onOpenBody,
  onOpenTimeline,
}: {
  server: ServerGroup;
  statsMap: Map<number, EndpointStat>;
  onOpenBody: (ev: ThresholdEvent) => void;
  onOpenTimeline: (g: ApiGroup) => void;
}) {
  const headingId = `srv-${server.name.replace(/\s+/g, '_')}`;
  return (
    <section aria-labelledby={headingId}>
      <ServerHeader server={server} statsMap={statsMap} headingId={headingId} />
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        {server.apis.map(g => (
          <ApiCard
            key={g.endpointId}
            group={g}
            stat={statsMap.get(g.endpointId)}
            onOpenBody={onOpenBody}
            onOpenTimeline={onOpenTimeline}
          />
        ))}
      </div>
    </section>
  );
}

function ServerMergedView({
  events,
  statsMap,
  onOpenBody,
}: {
  events: ThresholdEvent[];
  statsMap: Map<number, EndpointStat>;
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  const servers = useMemo(() => groupByServer(events), [events]);
  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      {servers.map(server => (
        <ServerMergedSection
          key={server.name}
          server={server}
          statsMap={statsMap}
          onOpenBody={onOpenBody}
        />
      ))}
    </div>
  );
}

function ServerMergedSection({
  server,
  statsMap,
  onOpenBody,
}: {
  server: ServerGroup;
  statsMap: Map<number, EndpointStat>;
  onOpenBody: (ev: ThresholdEvent) => void;
}) {
  const dotBoxRef = useRef<HTMLDivElement>(null);
  const perRow = useDotsPerRow(dotBoxRef, 24);
  const headingId = `srvm-${server.name.replace(/\s+/g, '_')}`;
  // events 는 최신순(ts DESC). 최근 N개를 자른 뒤 뒤집어 왼쪽=과거, 오른쪽=최신.
  // 표시 개수는 한 줄 dot 수의 배수로 잘라 마지막 줄을 꽉 채운다.
  const visible = server.events.slice(0, dotCap(perRow, MAX_DOTS_PER_SERVER)).reverse();
  const more = server.events.length - visible.length;

  return (
    <section aria-labelledby={headingId}>
      <ServerHeader server={server} statsMap={statsMap} headingId={headingId} />
      <div
        ref={dotBoxRef}
        style={{
          background: '#2a3038',
          border: '1px solid #3a4150',
          borderRadius: 8,
          padding: '10px 12px',
        }}
      >
        {more > 0 && (
          <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 6 }}>+{more}건</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: DOT_GAP }}>
          {visible.map((ev, i) => (
            <DotEvent
              key={ev.id}
              ev={ev}
              showLabel
              prevTs={i > 0 ? visible[i - 1].ts : undefined}
              onOpenBody={onOpenBody}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  return `${Math.floor(diff / 86400_000)}일 전`;
}

function fullDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}
