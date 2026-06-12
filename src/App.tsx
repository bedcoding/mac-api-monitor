import { useEffect, useRef, useState } from 'react';
import type { EndpointType } from './shared/types';
import { MonitorList, AddPanel, TYPE_LABEL } from './pages/Dashboard';
import { Events } from './pages/Events';
import { Settings } from './pages/Settings';
import { Slack } from './pages/Slack';

type Action = 'monitor' | 'add' | 'log' | 'settings' | 'slack';

const ACTION_LABEL: Record<Action, string> = {
  monitor: '조회',
  add: '추가',
  log: '로그',
  settings: '설정',
  slack: '슬랙',
};

const TYPE_TOOLTIP: Record<EndpointType, string> = {
  health: `서버 생존 확인용 가벼운 API (예: /health)`,
  feature: `실제 비즈니스 로직 API (랭킹, 콘텐츠 목록 등)`,
};

const isPopover = typeof window !== 'undefined' && window.location.hash === '#popover';

export function App() {
  const [action, setAction] = useState<Action>('monitor');
  const [type, setType] = useState<EndpointType>('health');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const bump = () => setRefreshKey(k => k + 1);

  // 추가 완료 후 조회로 자동 전환
  const onAdded = () => {
    bump();
    setAction('monitor');
  };

  const body = (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <TypeToggle type={type} onChange={setType} />
      {action === 'monitor' && (
        <MonitorList refreshKey={refreshKey} filterType={type} onChange={bump} />
      )}
      {action === 'add' && <AddPanel type={type} onDone={onAdded} />}
      {action === 'log' && <Events refreshKey={refreshKey} filterType={type} />}
      {action === 'settings' && <Settings onlyType={type} />}
      {action === 'slack' && <Slack type={type} />}
    </div>
  );

  const nav = (
    <nav
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 4,
        width: '100%',
        background: '#14161a',
        padding: 4,
        borderRadius: 10,
      }}
    >
      {(Object.keys(ACTION_LABEL) as Action[]).map(a => (
        <TabButton key={a} active={action === a} onClick={() => setAction(a)}>
          {ACTION_LABEL[a]}
        </TabButton>
      ))}
    </nav>
  );

  if (isPopover) {
    return <PopoverShell nav={nav}>{body}</PopoverShell>;
  }

  return (
    <>
      {/* macOS 신호등 버튼 영역 + 창 드래그 핸들 */}
      <div
        style={{
          height: 28,
          // @ts-expect-error -- non-standard webkit property for window drag
          WebkitAppRegion: 'drag',
          width: '100%',
        }}
      />
      <main style={{ padding: '8px 24px 24px', maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>{nav}</header>
        {body}
      </main>
    </>
  );
}

function TypeToggle({
  type,
  onChange,
}: {
  type: EndpointType;
  onChange: (t: EndpointType) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 8,
      }}
    >
      {(['health', 'feature'] as EndpointType[]).map(t => {
        const active = type === t;
        return (
          <div key={t} className="tt">
            <button
              onClick={() => onChange(t)}
              style={{
                width: '100%',
                background: active ? 'rgba(59,130,246,0.15)' : '#1c2028',
                border: `1px solid ${active ? '#3b82f6' : '#3a4150'}`,
                color: active ? '#60a5fa' : '#8a94a6',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                padding: '8px 0',
                borderRadius: 8,
              }}
            >
              {TYPE_LABEL[t]}
            </button>
            <span className="tt-bubble">{TYPE_TOOLTIP[t]}</span>
          </div>
        );
      })}
    </div>
  );
}

const HEADER_HEIGHT = 52;
const BODY_VPAD = 28; // padding 14 × 2
const POPOVER_MIN = 200;
const POPOVER_MAX = 850;
const PIN_STORAGE_KEY = 'popover.pinned';

function PopoverShell({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(0);
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PIN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    window.api.setPopoverPinned(pinned);
    try {
      localStorage.setItem(PIN_STORAGE_KEY, pinned ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [pinned]);

  async function openMain() {
    await window.api.openMainWindow();
    await window.api.closePopover();
  }

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      const contentHeight = el.scrollHeight;
      const target = Math.max(
        POPOVER_MIN,
        Math.min(POPOVER_MAX, contentHeight + HEADER_HEIGHT + BODY_VPAD),
      );
      if (Math.abs(target - lastSentRef.current) < 4) return;
      lastSentRef.current = target;
      window.api.setPopoverHeight(target);
    };

    // 탭 전환 시 빈 초기 렌더 → 데이터 로딩 후 재렌더 사이의 중간 높이를
    // 메인 프로세스로 흘려보내지 않도록 debounce. rAF(16ms)로는 데이터 fetch가
    // 끝난 두 번째 렌더가 따로 발사되어 깜빡임이 보였음.
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, 80);
    });
    observer.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#1c2028',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #3a4150',
      }}
    >
      <header
        style={{
          padding: '8px 12px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>{nav}</div>
        <PinButton pinned={pinned} onToggle={() => setPinned(p => !p)} />
        <ExpandButton onClick={openMain} />
      </header>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 12px 12px', minWidth: 0 }}>
        <div ref={innerRef} style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={pinned ? '핀 해제 (포커스 잃으면 자동으로 닫힘)' : '핀 고정 (다른 곳 클릭해도 안 닫힘)'}
      aria-pressed={pinned}
      style={{
        background: pinned ? '#3b82f6' : 'transparent',
        border: `1px solid ${pinned ? '#3b82f6' : '#3a4150'}`,
        color: pinned ? '#fff' : '#a0aec0',
        fontSize: 12,
        padding: '4px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: pinned ? 'rotate(0deg)' : 'rotate(45deg)', transition: 'transform 120ms' }}
      >
        <path d="M9.5 1.5l5 5-2 2-1-1-3.5 3.5.5 2-1 1-6-6 1-1 2 .5 3.5-3.5-1-1 2-2z" />
        <path d="M5 11l-3 3" />
      </svg>
    </button>
  );
}

function ExpandButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="전체 보기 (큰 창으로 열기)"
      style={{
        background: 'transparent',
        border: '1px solid #3a4150',
        color: '#a0aec0',
        fontSize: 12,
        padding: '4px 8px',
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.5 2.5h4v4" />
        <path d="M13.5 2.5l-5 5" />
        <path d="M6.5 13.5h-4v-4" />
        <path d="M2.5 13.5l5-5" />
      </svg>
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: active ? '#3b82f6' : 'transparent',
        border: 'none',
        borderRadius: 7,
        color: active ? '#fff' : '#8a94a6',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        padding: '7px 0',
        width: '100%',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
