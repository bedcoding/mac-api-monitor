import { useEffect, useRef, useState } from 'react';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Endpoints } from './pages/Endpoints';

type Tab = 'dashboard' | 'endpoints' | 'settings';

const isPopover = typeof window !== 'undefined' && window.location.hash === '#popover';

export function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRefreshKey(k => k + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const body = (
    <>
      {tab === 'dashboard' && <Dashboard refreshKey={refreshKey} />}
      {tab === 'endpoints' && <Endpoints onChange={() => setRefreshKey(k => k + 1)} />}
      {tab === 'settings' && <Settings />}
    </>
  );

  const nav = (
    <nav style={{ display: 'flex', gap: 4 }}>
      <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
        Dashboard
      </TabButton>
      <TabButton active={tab === 'endpoints'} onClick={() => setTab('endpoints')}>
        Endpoints
      </TabButton>
      <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
        Settings
      </TabButton>
    </nav>
  );

  if (isPopover) {
    return <PopoverShell nav={nav}>{body}</PopoverShell>;
  }

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>API Monitor</h1>
        {nav}
      </header>
      {body}
    </main>
  );
}

const HEADER_HEIGHT = 40;
const BODY_VPAD = 28; // padding 14 × 2
const POPOVER_MIN = 200;
const POPOVER_MAX = 760;

function PopoverShell({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(0);

  async function openMain() {
    await window.api.openMainWindow();
    await window.api.closePopover();
  }

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    let raf = 0;
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

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(send);
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
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
        border: '1px solid #2a2f3a',
      }}
    >
      <header
        style={{
          height: HEADER_HEIGHT,
          padding: '0 14px',
          borderBottom: '1px solid #2a2f3a',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 13 }}>API Monitor</strong>
        <div style={{ flex: 1 }}>{nav}</div>
        <button onClick={openMain} style={{ fontSize: 12, padding: '4px 10px' }}>
          전체 보기
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: 14, minWidth: 0 }}>
        <div ref={innerRef}>{children}</div>
      </div>
    </div>
  );
}

function TabButton({
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
      style={{
        background: active ? '#3b82f6' : 'transparent',
        border: active ? '1px solid #3b82f6' : '1px solid transparent',
        color: active ? '#fff' : '#a0aec0',
        fontSize: 12,
        padding: '4px 10px',
      }}
    >
      {children}
    </button>
  );
}
