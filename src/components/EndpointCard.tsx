import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useState } from 'react';
import type { Endpoint, Measurement, Settings } from '../shared/types';

interface Props {
  endpoint: Endpoint;
  measurements: Measurement[];
  settings: Settings | null;
}

export function EndpointCard({ endpoint, measurements, settings }: Props) {
  const [probing, setProbing] = useState(false);
  const latest = measurements[measurements.length - 1];
  const warning = settings?.warning_ms ?? 3000;
  const critical = settings?.critical_ms ?? 7000;

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
      style={{
        border: '1px solid #2a2f3a',
        borderRadius: 12,
        padding: 20,
        background: '#1c2028',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
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
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{endpoint.label}</div>
          <code style={{ opacity: 0.6, fontSize: 11 }}>
            {endpoint.method} {endpoint.url}
          </code>
        </div>
        <div style={{ textAlign: 'right' }}>
          {latest ? (
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
        <button onClick={onProbe} disabled={probing}>
          {probing ? '...' : '↻'}
        </button>
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
                contentStyle={{ background: '#14161a', border: '1px solid #2a2f3a' }}
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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}
