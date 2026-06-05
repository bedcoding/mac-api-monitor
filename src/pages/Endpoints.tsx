import { useEffect, useState } from 'react';
import type { Endpoint } from '../shared/types';

export function Endpoints({ onChange }: { onChange: () => void }) {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [draft, setDraft] = useState({ method: 'GET', url: '', label: '' });
  const [importText, setImportText] = useState('');

  async function refresh() {
    setEndpoints(await window.api.listEndpoints());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onAdd() {
    const url = draft.url.trim();
    if (!url) return;
    try {
      await window.api.addEndpoint({
        method: draft.method,
        url,
        label: draft.label.trim() || url,
        note: null,
        group: null,
      });
      setDraft({ method: 'GET', url: '', label: '' });
      await refresh();
      onChange();
    } catch (e) {
      alert(`추가 실패: ${(e as Error).message}`);
    }
  }

  async function onRemove(id: number) {
    await window.api.removeEndpoint(id);
    await refresh();
    onChange();
  }

  async function onImport() {
    try {
      const count = await window.api.importEndpoints(importText);
      alert(`${count}개 import 완료`);
      setImportText('');
      await refresh();
      onChange();
    } catch (e) {
      alert(`Import 실패: ${(e as Error).message}`);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <div style={card}>
        <h3 style={cardTitle}>새 endpoint 추가</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '70px minmax(0, 2fr) minmax(0, 1fr) auto',
            gap: 8,
          }}
        >
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
          <input
            placeholder="라벨 (예: 홈 메인)"
            value={draft.label}
            onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            style={{ minWidth: 0 }}
          />
          <button onClick={onAdd}>추가</button>
        </div>
      </div>

      <div style={card}>
        <h3 style={cardTitle}>등록된 endpoint ({endpoints.length})</h3>
        {endpoints.length === 0 ? (
          <p style={{ opacity: 0.6 }}>없음</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
            {endpoints.map(ep => (
              <li
                key={ep.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  background: '#14161a',
                  borderRadius: 6,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{ep.label}</div>
                  <code style={{ opacity: 0.6, fontSize: 11 }}>
                    {ep.method} {ep.url}
                  </code>
                </div>
                <button onClick={() => onRemove(ep.id)}>삭제</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={card}>
        <h3 style={cardTitle}>JSON Import</h3>
        <textarea
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder={`{\n  "version": 1,\n  "endpoints": [\n    { "method": "GET", "url": "...", "label": "..." }\n  ]\n}`}
          style={{ width: '100%', minHeight: 100, fontFamily: 'monospace' }}
        />
        <button onClick={onImport} disabled={!importText.trim()} style={{ marginTop: 8 }}>
          Import
        </button>
      </div>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #2a2f3a',
  borderRadius: 10,
  padding: 14,
  background: '#1c2028',
};

const cardTitle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  background: '#1c2028',
  color: '#e6e8ec',
  border: '1px solid #2a2f3a',
  borderRadius: 6,
  padding: '6px 10px',
};
