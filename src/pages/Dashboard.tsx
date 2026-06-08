import { useEffect, useState } from 'react';
import type { Endpoint, EndpointType, Measurement, Settings } from '../shared/types';
import { EndpointCard } from '../components/EndpointCard';

export const TYPE_LABEL: Record<EndpointType, string> = {
  health: '헬스체크',
  feature: '기능체크',
};

/** 조회 화면: 해당 type 의 endpoint 카드 + 차트 (그룹별 섹션) */
export function MonitorList({
  refreshKey,
  filterType,
  onChange,
}: {
  refreshKey: number;
  filterType: EndpointType;
  onChange: () => void;
}) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [measurements, setMeasurements] = useState<Record<number, Measurement[]>>({});
  const [settings, setSettings] = useState<Settings | null>(null);

  async function load() {
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
  }

  useEffect(() => {
    load();
  }, [refreshKey]);

  async function onRemove(id: number) {
    await window.api.removeEndpoint(id);
    await load();
    onChange();
  }

  const shown = endpoints.filter(e => e.type === filterType);
  const groups = groupBy(shown);

  if (shown.length === 0) {
    return (
      <section style={emptyStyle}>
        <h2 style={{ fontSize: 18 }}>{TYPE_LABEL[filterType]} endpoint가 없습니다</h2>
        <p style={{ opacity: 0.7 }}>
          <strong>추가</strong> 탭에서 URL을 등록하거나 JSON을 import 하세요.
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      {groups.map(([groupName, eps]) => (
        <div key={groupName} style={{ display: 'grid', gap: 12 }}>
          {groups.length > 1 && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                opacity: 0.6,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {groupName} · {eps.length}
            </div>
          )}
          {eps.map(ep => (
            <EndpointCard
              key={ep.id}
              endpoint={ep}
              measurements={measurements[ep.id] ?? []}
              settings={settings}
              onRemove={() => onRemove(ep.id)}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

/** 추가 화면: 직접 추가 / JSON Import (해당 type 으로 고정) */
export function AddPanel({ type, onDone }: { type: EndpointType; onDone: () => void }) {
  const [draft, setDraft] = useState({ method: 'GET', url: '', label: '', group: '' });
  const [importText, setImportText] = useState('');

  async function onAdd() {
    const url = draft.url.trim();
    if (!url) return;
    try {
      await window.api.addEndpoint({
        method: draft.method,
        url,
        label: draft.label.trim() || url,
        note: null,
        group: draft.group.trim() || null,
        type,
      });
      setDraft({ method: 'GET', url: '', label: '', group: '' });
      onDone();
    } catch (e) {
      alert(`추가 실패: ${(e as Error).message}`);
    }
  }

  async function onImport() {
    try {
      const count = await window.api.importEndpoints(importText, type);
      alert(`${count}개 import 완료 (${TYPE_LABEL[type]})`);
      setImportText('');
      onDone();
    } catch (e) {
      alert(`Import 실패: ${(e as Error).message}`);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={card}>
        <h4 style={sectionTitle}>직접 추가</h4>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,1fr)', gap: 8 }}>
            <select
              value={draft.method}
              onChange={e => setDraft(d => ({ ...d, method: e.target.value }))}
              style={selectStyle}
            >
              <option>GET</option>
              <option>POST</option>
              <option>HEAD</option>
            </select>
            <input
              placeholder="https://api.example.com/v2/path"
              value={draft.url}
              onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
              style={{ minWidth: 0 }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input
              placeholder="라벨 (예: 홈 메인)"
              value={draft.label}
              onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
              style={{ minWidth: 0 }}
            />
            <input
              placeholder="그룹 (예: main-api)"
              value={draft.group}
              onChange={e => setDraft(d => ({ ...d, group: e.target.value }))}
              style={{ minWidth: 0 }}
            />
          </div>
          <button onClick={onAdd} className="btn-primary" style={{ justifySelf: 'start' }}>
            + {TYPE_LABEL[type]}
          </button>
        </div>
      </div>

      <div style={card}>
        <h4 style={sectionTitle}>JSON Import</h4>
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={`{
  "version": 1,
  "endpoints": [
    {
      "method": "GET",
      "url": "https://api.example.com/v2/health",
      "label": "메인 헬스체크",
      "group": "main-api"
    },
    {
      "method": "GET",
      "url": "https://api.example.com/v2/ranking",
      "label": "랭킹 API",
      "group": "main-api"
    }
  ]
}`}
            style={{ width: '100%', minHeight: 100, fontFamily: 'monospace' }}
          />
          <button
            onClick={onImport}
            disabled={!importText.trim()}
            className="btn-primary"
            style={{ justifySelf: 'start' }}
          >
            + {TYPE_LABEL[type]}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupBy(endpoints: Endpoint[]): Array<[string, Endpoint[]]> {
  const map = new Map<string, Endpoint[]>();
  for (const ep of endpoints) {
    const key = ep.group?.trim() || '(미분류)';
    const arr = map.get(key);
    if (arr) arr.push(ep);
    else map.set(key, [ep]);
  }
  return Array.from(map.entries());
}

const card: React.CSSProperties = {
  border: '1px solid #2a2f3a',
  borderRadius: 10,
  padding: 14,
  background: '#1c2028',
};

const selectStyle: React.CSSProperties = {
  background: '#1c2028',
  color: '#e6e8ec',
  border: '1px solid #2a2f3a',
  borderRadius: 6,
  padding: '6px 10px',
};

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  color: '#e6e8ec',
};

const emptyStyle: React.CSSProperties = {
  padding: 48,
  textAlign: 'center',
  border: '1px dashed #2a2f3a',
  borderRadius: 12,
  background: '#1c2028',
};
