import { useEffect, useState } from 'react';
import type { ThresholdEvent, EndpointType } from '../shared/types';

export function Events({
  refreshKey,
  filterType,
}: {
  refreshKey: number;
  filterType: EndpointType;
}) {
  const [events, setEvents] = useState<ThresholdEvent[]>([]);

  useEffect(() => {
    window.api.recentThresholdExceeded(filterType, 200).then(setEvents);
  }, [refreshKey, filterType]);

  if (events.length === 0) {
    return (
      <section style={emptyStyle}>
        <h2 style={{ fontSize: 18 }}>임계값 초과 이벤트가 없습니다</h2>
        <p style={{ opacity: 0.7 }}>
          응답시간이 임계값을 넘었거나 호출이 실패한 경우 시간순으로 쌓입니다.
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 6 }}>
      {events.map(ev => (
        <div
          key={ev.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '60px 1fr auto auto',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
            background: '#1c2028',
            border: '1px solid #2a2f3a',
            borderRadius: 6,
            fontSize: 12,
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
              textAlign: 'center',
            }}
          >
            {ev.level === 'critical' ? '심각' : '주의'}
          </span>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{ev.label}</div>
            <code
              style={{
                opacity: 0.55,
                fontSize: 11,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ev.method} {ev.url}
            </code>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600 }}>
              {ev.ok === 0 ? <span style={{ color: '#f87171' }}>실패</span> : `${ev.duration_ms}ms`}
            </div>
            <div style={{ fontSize: 10, opacity: 0.5 }}>
              {ev.status === 0 ? '-' : `HTTP ${ev.status}`}
            </div>
          </div>

          <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'right', minWidth: 70 }}>
            {timeAgo(ev.ts)}
          </div>
        </div>
      ))}
    </section>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  return `${Math.floor(diff / 86400_000)}일 전`;
}

const emptyStyle: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  border: '1px dashed #2a2f3a',
  borderRadius: 12,
  background: '#1c2028',
};
