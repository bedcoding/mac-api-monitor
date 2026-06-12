import { useEffect, useState } from 'react';
import type {
  Settings as SettingsType,
  TypeSettings,
  EndpointType,
  AlarmEvent,
  SlackStatus,
} from '../shared/types';
import { AlarmCard } from './Settings';

export function Slack({ type }: { type: EndpointType }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;
  const cfg = settings[type];

  async function save(patch: Partial<TypeSettings>) {
    // 낙관적 즉시 반영. 실패하면 서버 값으로 롤백 — 그 자체가 피드백이라 별도 표시는 두지 않는다.
    setSettings(prev => (prev ? { ...prev, [type]: { ...prev[type], ...patch } } : prev));
    try {
      await window.api.updateSettings({ [type]: patch });
    } catch (e) {
      console.error('slack settings save failed', e);
      setSettings(await window.api.getSettings());
    }
  }

  async function onTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await window.api.testSlack(type);
      setTestMsg(r);
    } catch (e) {
      setTestMsg({ ok: false, message: `오류: ${(e as Error).message}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={card}>
        <Row label="알람 켜기">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <input
              type="checkbox"
              checked={cfg.alarms_enabled === 1}
              onChange={e => save({ alarms_enabled: e.target.checked ? 1 : 0 })}
            />
            <AlarmHistoryButton type={type} />
          </div>
        </Row>

        <Row label="발송 방식">
          <div style={{ display: 'flex', gap: 6 }}>
            <ModeBtn active={cfg.slack_mode === 'webhook'} onClick={() => save({ slack_mode: 'webhook' })}>
              Webhook
            </ModeBtn>
            <ModeBtn active={cfg.slack_mode === 'bot'} onClick={() => save({ slack_mode: 'bot' })}>
              Bot Token
            </ModeBtn>
          </div>
        </Row>

        {cfg.slack_mode === 'webhook' ? (
          <Row label="Webhook URL">
            <input
              type="text"
              placeholder="https://hooks.slack.com/services/..."
              value={cfg.slack_webhook_url}
              onChange={e => save({ slack_webhook_url: e.target.value })}
              style={{ width: '100%' }}
            />
          </Row>
        ) : (
          <>
            <Row label="Bot Token">
              <input
                type="password"
                placeholder="xoxb-..."
                value={cfg.slack_bot_token}
                onChange={e => save({ slack_bot_token: e.target.value })}
                style={{ width: '100%' }}
              />
            </Row>
            <Row label="채널">
              <input
                type="text"
                placeholder="#alerts 또는 C0XXXXXXX"
                value={cfg.slack_channel}
                onChange={e => save({ slack_channel: e.target.value })}
                style={{ width: '100%' }}
              />
            </Row>
            <p style={{ fontSize: 11, opacity: 0.5, margin: '0 0 8px' }}>
              봇을 채널에 초대해야 발송됩니다. 토큰엔 <code>chat:write</code> 권한 필요.
            </p>
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button onClick={onTest} disabled={testing}>
            {testing ? '발송 중...' : 'Slack 테스트'}
          </button>
          {testMsg && (
            <span style={{ fontSize: 12, color: testMsg.ok ? '#4ade80' : '#f87171' }}>
              {testMsg.message}
            </span>
          )}
        </div>
      </div>

      <AlarmCard cfg={cfg} onSave={save} type={type} />
    </section>
  );
}

const HISTORY_PAGE_SIZE = 8;

const SLACK_STATUS_META: Record<SlackStatus, { icon: string; label: string; color: string }> = {
  sent: { icon: '✅', label: '전송됨', color: '#4ade80' },
  failed: { icon: '❌', label: '실패', color: '#f87171' },
  skipped: { icon: '⏭️', label: '미설정', color: '#9aa6b8' },
};

function AlarmHistoryButton({ type }: { type: EndpointType }) {
  const [open, setOpen] = useState(false);
  // 버튼 배지용 최근 1건. 모달 닫힐 때 갱신해 새 발송 결과를 반영.
  const [recent, setRecent] = useState<AlarmEvent | null | undefined>(undefined);

  useEffect(() => {
    if (!open) window.api.recentEvents(type, 1).then(arr => setRecent(arr[0] ?? null));
  }, [type, open]);

  const badge = recent?.slack_status ? SLACK_STATUS_META[recent.slack_status] : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={recent ? `알람 발송 내역 · 최근 ${fmtTs(recent.ts)}` : '알람 발송 내역'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        알람 발송 내역
        {recent && badge && (
          <span style={{ color: badge.color, fontWeight: 400 }}>{badge.icon}</span>
        )}
      </button>
      {open && <AlarmHistoryModal type={type} onClose={() => setOpen(false)} />}
    </>
  );
}

function AlarmHistoryModal({ type, onClose }: { type: EndpointType; onClose: () => void }) {
  const [events, setEvents] = useState<AlarmEvent[] | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    window.api.recentEvents(type, 200).then(setEvents);
  }, [type]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const total = events?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const p = Math.min(page, totalPages - 1);
  const slice = (events ?? []).slice(p * HISTORY_PAGE_SIZE, (p + 1) * HISTORY_PAGE_SIZE);

  const sent = (events ?? []).filter(e => e.slack_status === 'sent').length;
  const failed = (events ?? []).filter(e => e.slack_status === 'failed').length;
  const skipped = (events ?? []).filter(e => e.slack_status === 'skipped').length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#2a3038',
          border: '1px solid #3a4150',
          borderRadius: 10,
          width: '100%',
          maxWidth: 720,
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid #3a4150',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>알람 발송 내역</div>
            {total > 0 && (
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                최근 {total}건
                {sent > 0 && <span style={{ color: '#4ade80' }}> · ✅{sent}</span>}
                {failed > 0 && <span style={{ color: '#f87171' }}> · ❌{failed}</span>}
                {skipped > 0 && <span style={{ color: '#9aa6b8' }}> · ⏭️{skipped}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ flexShrink: 0, padding: '2px 8px' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 12, overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
          {events === null ? (
            <div style={{ fontSize: 12, opacity: 0.5 }}>불러오는 중...</div>
          ) : total === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.6 }}>
              아직 발사된 알람이 없습니다.
              <br />
              <span style={{ opacity: 0.7 }}>
                알람 조건(연속/슬라이딩/사이클)이 한 번도 충족된 적이 없다는 뜻입니다. 알람이 와야 할
                상황인데 비어 있다면 알람 정책이 너무 빡빡한지 확인하세요.
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {slice.map(ev => (
                <AlarmRow key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '10px 12px',
              borderTop: '1px solid #3a4150',
              fontSize: 12,
            }}
          >
            <button onClick={() => setPage(p - 1)} disabled={p === 0} style={{ padding: '2px 10px' }}>
              ‹ 이전
            </button>
            <span style={{ opacity: 0.6, minWidth: 90, textAlign: 'center' }}>
              {p + 1} / {totalPages} 페이지
            </span>
            <button
              onClick={() => setPage(p + 1)}
              disabled={p >= totalPages - 1}
              style={{ padding: '2px 10px' }}
            >
              다음 ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AlarmRow({ ev }: { ev: AlarmEvent }) {
  const meta = ev.slack_status
    ? SLACK_STATUS_META[ev.slack_status]
    : { icon: '', label: '기록 없음', color: '#9aa6b8' };
  // detail 은 "URL/요약 · 결과(상태·응답시간)" 형태. 첫 ' · ' 기준으로 갈라
  // 앞(긴 URL)은 말줄임, 뒤(짧은 결과)는 다음 줄에 항상 보이게 한다.
  const dotIdx = ev.detail.indexOf(' · ');
  const detailHead = dotIdx >= 0 ? ev.detail.slice(0, dotIdx) : ev.detail;
  const detailTail = dotIdx >= 0 ? ev.detail.slice(dotIdx + 3) : '';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 1fr auto',
        alignItems: 'start',
        gap: 10,
        padding: '8px 10px',
        background: '#1c2028',
        border: '1px solid #3a4150',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <span title={`슬랙 ${meta.label}`} style={{ fontSize: 13, textAlign: 'center' }}>
        {meta.icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ev.title}
        </div>
        <div
          title={ev.detail}
          style={{
            fontSize: 11,
            opacity: 0.6,
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {detailHead}
        </div>
        {detailTail && (
          <div style={{ fontSize: 11, opacity: 0.45, marginTop: 1 }}>{detailTail}</div>
        )}
        <div
          style={{
            fontSize: 11,
            marginTop: 4,
            paddingTop: 4,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <span style={{ color: meta.color }}>슬랙 {meta.label}</span>
          {ev.slack_error && <span style={{ opacity: 0.6 }}> · {ev.slack_error}</span>}
        </div>
      </div>
      <div style={{ fontSize: 10, opacity: 0.5, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {fmtTs(ev.ts)}
      </div>
    </div>
  );
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mo}-${da} ${h}:${mi}`;
}

function ModeBtn({
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
      aria-pressed={active}
      style={{
        background: active ? '#3b82f6' : 'transparent',
        border: `1px solid ${active ? '#3b82f6' : '#3a4150'}`,
        color: active ? '#fff' : '#a0aec0',
        fontSize: 12,
        padding: '4px 10px',
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}
    >
      <label style={{ opacity: 0.8 }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #3a4150',
  borderRadius: 12,
  padding: 20,
  background: '#2a3038',
};
