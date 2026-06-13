import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useState } from 'react';
import type { Endpoint, Measurement, Settings } from '../shared/types';

interface Props {
  endpoint: Endpoint;
  measurements: Measurement[];
  settings: Settings | null;
  onRemove?: () => void;
}

export function EndpointCard({ endpoint, measurements, settings, onRemove }: Props) {
  const [probing, setProbing] = useState(false);
  const [cardHover, setCardHover] = useState(false);
  const latest = measurements[measurements.length - 1];
  const cfg = settings ? settings[endpoint.type] : null;
  const warning = cfg?.warning_ms ?? 3000;
  const critical = cfg?.critical_ms ?? 7000;

  const status = computeStatus(latest, warning, critical);

  const chartData = measurements.map(m => ({
    t: m.ts,
    duration: m.duration_ms,
  }));

  async function onProbe() {
    setProbing(true);
    try {
      await window.api.probeNow(endpoint.id);
    } finally {
      setProbing(false);
    }
  }

  return (
    <article
      onMouseEnter={() => setCardHover(true)}
      onMouseLeave={() => setCardHover(false)}
      style={{
        border: '1px solid #3a4150',
        borderRadius: 12,
        padding: 20,
        background: '#2a3038',
        minWidth: 0,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, minWidth: 0 }}>
        <div
          className="tt"
          style={{
            display: 'inline-flex',
            flexShrink: 0,
            cursor: latest && status.label !== 'healthy' ? 'help' : 'default',
          }}
        >
          <span
            aria-label={status.label}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: status.color,
              boxShadow: `0 0 8px ${status.color}`,
            }}
          />
          {latest && status.label !== 'healthy' && (
            <span
              className="tt-bubble"
              style={{ maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-all' }}
            >
              {statusReason(latest, warning, critical)}
            </span>
          )}
        </div>
        <div className="tt" style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {endpoint.label}
          </div>
          <code
            style={{
              opacity: 0.6,
              fontSize: 11,
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {endpoint.method} {endpoint.url}
          </code>
          <span
            className="tt-bubble"
            style={{ maxWidth: 480, wordBreak: 'break-all', whiteSpace: 'normal' }}
          >
            <span style={{ fontWeight: 600 }}>{endpoint.label}</span>
            <br />
            {endpoint.method} {endpoint.url}
          </span>
        </div>
        <div
          style={{
            textAlign: 'right',
            flexShrink: 0,
            minWidth: 90,
            minHeight: 44,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'flex-end',
          }}
        >
          {cardHover ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={onProbe} disabled={probing} title="지금 측정">
                {probing ? '...' : '↻'}
              </button>
              {onRemove && (
                <button
                  onClick={() => {
                    if (confirm(`"${endpoint.label}" 삭제?`)) onRemove();
                  }}
                  title="삭제"
                  style={{ color: '#f87171' }}
                >
                  ✕
                </button>
              )}
            </div>
          ) : latest ? (
            <>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{latest.duration_ms}ms</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>
                {latest.status === 0 ? 'failed' : `HTTP ${latest.status}`} ·{' '}
                {timeAgo(latest.ts)}
              </div>
            </>
          ) : (
            <span style={{ opacity: 0.5 }}>측정 대기 중</span>
          )}
        </div>
      </header>

      {chartData.length > 1 && (
        <div style={{ height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis
                dataKey="t"
                tickFormatter={t => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                stroke="#4a5568"
                fontSize={10}
              />
              <YAxis stroke="#4a5568" fontSize={10} />
              <Tooltip
                contentStyle={{ background: '#14161a', border: '1px solid #3a4150' }}
                labelFormatter={t => new Date(Number(t)).toLocaleString('ko-KR')}
                formatter={(v: number) => [`${v}ms`, 'duration']}
              />
              <ReferenceLine y={warning} stroke="#fbbf24" strokeDasharray="3 3" />
              <ReferenceLine y={critical} stroke="#ef4444" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="duration"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

function computeStatus(latest: Measurement | undefined, warning: number, critical: number) {
  if (!latest) return { color: '#666', label: 'unknown' };
  if (!latest.ok || latest.duration_ms >= critical) return { color: '#ef4444', label: 'critical' };
  if (latest.duration_ms >= warning) return { color: '#fbbf24', label: 'warning' };
  return { color: '#4ade80', label: 'healthy' };
}

/** dot 에 마우스 올렸을 때 "왜 이 색인지" — 실패면 사유(body), 느림이면 임계 초과 안내. */
function statusReason(latest: Measurement, warning: number, critical: number): string {
  if (!latest.ok) {
    return latest.body?.trim() || `실패 — ${latest.status ? `HTTP ${latest.status}` : '응답 없음'}`;
  }
  if (latest.duration_ms >= critical) {
    return `매우 느림 — ${latest.duration_ms}ms (위험 임계 ${critical}ms 초과)`;
  }
  if (latest.duration_ms >= warning) {
    return `느림 — ${latest.duration_ms}ms (경고 임계 ${warning}ms 초과)`;
  }
  return '정상';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}
