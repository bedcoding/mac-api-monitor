import { useEffect, useState } from 'react';
import type { AlarmEvent, EndpointType } from '../shared/types';

export function Events({
  refreshKey,
  filterType,
}: {
  refreshKey: number;
  filterType?: EndpointType;
}) {
  const [events, setEvents] = useState<AlarmEvent[]>([]);

  useEffect(() => {
    window.api.recentEvents(200).then(setEvents);
  }, [refreshKey]);

  const shown = filterType ? events.filter(e => e.type === filterType) : events;

  if (shown.length === 0) {
    return (
      <section style={emptyStyle}>
        <h2 style={{ fontSize: 18 }}>알람 이벤트가 없습니다</h2>
        <p style={{ opacity: 0.7 }}>
          임계값 초과로 알람이 발동하면 여기에 시간순으로 쌓입니다. (설정에서 알람을 켜야 발동)
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 8 }}>
      {shown.map(ev => (
        <div
          key={ev.id}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: 12,
            background: '#1c2028',
            border: '1px solid #2a2f3a',
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 10,
              background: ev.level === 'critical' ? '#7f1d1d' : '#78350f',
              color: ev.level === 'critical' ? '#fecaca' : '#fde68a',
              fontWeight: 600,
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            {ev.level === 'critical' ? '심각' : '주의'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{ev.title}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{ev.detail}</div>
            <div style={{ fontSize: 11, opacity: 0.45, marginTop: 4 }}>
              {ev.type} · {ev.group_name} · {formatTime(ev.ts)}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  const rel =
    diff < 60_000
      ? `${Math.floor(diff / 1000)}초 전`
      : diff < 3600_000
        ? `${Math.floor(diff / 60_000)}분 전`
        : diff < 86400_000
          ? `${Math.floor(diff / 3600_000)}시간 전`
          : `${Math.floor(diff / 86400_000)}일 전`;
  return `${d.toLocaleString('ko-KR')} (${rel})`;
}

const emptyStyle: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  border: '1px dashed #2a2f3a',
  borderRadius: 12,
  background: '#1c2028',
};
