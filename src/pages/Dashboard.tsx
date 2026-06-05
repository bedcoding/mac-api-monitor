import { useEffect, useState } from 'react';
import type { Endpoint, Measurement, Settings } from '../shared/types';
import { EndpointCard } from '../components/EndpointCard';

export function Dashboard({ refreshKey }: { refreshKey: number }) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [measurements, setMeasurements] = useState<Record<number, Measurement[]>>({});
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    (async () => {
      const eps = await window.api.listEndpoints();
      setEndpoints(eps);
      setSettings(await window.api.getSettings());

      const map: Record<number, Measurement[]> = {};
      await Promise.all(
        eps.map(async ep => {
          map[ep.id] = await window.api.recentMeasurements(ep.id, 1);
        }),
      );
      setMeasurements(map);
    })();
  }, [refreshKey]);

  if (endpoints.length === 0) {
    return (
      <section style={emptyStyle}>
        <h2>등록된 endpoint 가 없습니다</h2>
        <p style={{ opacity: 0.7 }}>
          상단 <strong>Endpoints</strong> 탭에서 URL 을 추가하거나 JSON 을 import 하세요.
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      {endpoints.map(ep => (
        <EndpointCard
          key={ep.id}
          endpoint={ep}
          measurements={measurements[ep.id] ?? []}
          settings={settings}
        />
      ))}
    </section>
  );
}

const emptyStyle: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  border: '1px dashed #2a2f3a',
  borderRadius: 12,
  background: '#1c2028',
};
