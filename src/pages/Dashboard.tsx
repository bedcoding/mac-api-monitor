import { useEffect, useState } from 'react';
import type { Endpoint, EndpointType, Measurement, Settings } from '../shared/types';
import { EndpointCard } from '../components/EndpointCard';

const GRAPH_POINTS_KEY = 'dashboard.graphPoints';
const GRAPH_POINTS_DEFAULT = 60;
const GRAPH_POINTS_MIN = 10;
const GRAPH_POINTS_MAX = 1000;
// 이 시간 안에 로딩이 끝나면 스피너를 띄우지 않는다 (짧은 로딩 깜빡임 방지).
const SPINNER_DELAY_MS = 300;

function clampPoints(n: number): number {
  if (!Number.isFinite(n)) return GRAPH_POINTS_DEFAULT;
  return Math.max(GRAPH_POINTS_MIN, Math.min(GRAPH_POINTS_MAX, Math.round(n)));
}

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
  // 첫 load() 완료 전에는 empty 화면을 띄우지 않는다 — "데이터 없음" 과 "아직 로딩 중" 을 구분.
  const [loaded, setLoaded] = useState(false);
  // 로딩이 SPINNER_DELAY_MS 넘게 걸릴 때만 스피너를 띄운다.
  // 0.3초 만에 끝나는 보통 로딩에서는 스피너가 아예 안 떠 깜빡임이 없다.
  const [showSpinner, setShowSpinner] = useState(false);
  // 그래프에 띄울 최근 측정 개수 — 사용자가 조정, localStorage 에 기억
  const [graphPoints, setGraphPoints] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(GRAPH_POINTS_KEY));
      return v > 0 ? clampPoints(v) : GRAPH_POINTS_DEFAULT;
    } catch {
      return GRAPH_POINTS_DEFAULT;
    }
  });
  const [pointsInput, setPointsInput] = useState(() => String(graphPoints));

  async function load() {
    // endpoints / settings / measurements 를 모두 모은 뒤 한 번에 커밋한다.
    // 따로 setState 하면 "endpoints 만 있고 measurements 는 빈" 중간 렌더가 새어나가
    // 카드가 잠깐 "측정 대기 중" 으로 보였다가 그래프가 뿅 채워지는 깜빡임이 생긴다.
    const eps = await window.api.listEndpoints();
    const nextSettings = await window.api.getSettings();
    const map: Record<number, Measurement[]> = {};
    await Promise.all(
      eps.map(async ep => {
        // recentMeasurements 는 "개수" 기준 — 그래프용 최근 graphPoints 개 측정
        map[ep.id] = await window.api.recentMeasurements(ep.id, graphPoints);
      }),
    );
    // React 18 자동 배칭: 같은 tick 의 setState 들이 한 렌더로 묶인다.
    setEndpoints(eps);
    setSettings(nextSettings);
    setMeasurements(map);
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, [refreshKey, graphPoints]);

  // 로딩이 SPINNER_DELAY_MS 를 넘길 때만 스피너를 켠다.
  // 그 전에 load() 가 끝나면(loaded=true) 타이머가 취소되어 스피너가 아예 안 뜬다.
  useEffect(() => {
    if (loaded) {
      setShowSpinner(false);
      return;
    }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [loaded]);

  useEffect(() => {
    try {
      localStorage.setItem(GRAPH_POINTS_KEY, String(graphPoints));
    } catch {
      /* ignore */
    }
  }, [graphPoints]);

  function applyPoints() {
    const n = clampPoints(Number(pointsInput));
    setGraphPoints(n);
    setPointsInput(String(n));
  }

  async function onRemove(id: number) {
    await window.api.removeEndpoint(id);
    await load();
    onChange();
  }

  const shown = endpoints.filter(e => e.type === filterType);
  const groups = groupBy(shown);

  // 첫 load() 가 끝나기 전에는 empty 화면을 띄우지 않는다.
  // 그렇지 않으면 데이터가 있어도 잠깐 "endpoint가 없습니다" 가 보였다가 그래프가 뿅 나타난다.
  // 스피너는 로딩이 SPINNER_DELAY_MS 를 넘길 때만 — 짧은 로딩에선 빈 영역만 잠깐 보인다.
  if (!loaded) {
    return (
      <section
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}
      >
        {showSpinner && <div className="spinner" />}
      </section>
    );
  }

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

  // 전역 컨트롤 — 첫 그룹 타이틀 줄 오른쪽에 함께 띄운다.
  const pointsControl = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <label htmlFor="graph-points" style={{ opacity: 0.6 }}>
        그래프 표시 개수
      </label>
      <input
        id="graph-points"
        type="number"
        min={GRAPH_POINTS_MIN}
        max={GRAPH_POINTS_MAX}
        value={pointsInput}
        onChange={e => setPointsInput(e.target.value)}
        onBlur={applyPoints}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        title={`${GRAPH_POINTS_MIN}~${GRAPH_POINTS_MAX} 사이, 최근 측정 개수`}
        style={{ width: 60, textAlign: 'right', padding: '3px 6px' }}
      />
      <span style={{ opacity: 0.5 }}>개</span>
    </div>
  );

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }}>
      {groups.map(([groupName, eps], gi) => (
        <div key={groupName} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {/* 첫 그룹 줄에만 컨트롤을 함께 띄운다. 그룹 1개라 타이틀이 없으면 컨트롤만 우측 정렬. */}
          {(groups.length > 1 || gi === 0) && (
            <div
              style={{
                display: 'flex',
                justifyContent: groups.length > 1 ? 'space-between' : 'flex-end',
                alignItems: 'center',
                gap: 12,
                minHeight: 22,
              }}
            >
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
              {gi === 0 && pointsControl}
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
  border: '1px solid #3a4150',
  borderRadius: 10,
  padding: 14,
  background: '#2a3038',
};

const selectStyle: React.CSSProperties = {
  background: '#1c2028',
  color: '#e6e8ec',
  border: '1px solid #3a4150',
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
  border: '1px dashed #3a4150',
  borderRadius: 12,
  background: '#2a3038',
};
