import { useEffect, useState } from 'react';
import type { Settings as SettingsType, TypeSettings, EndpointType } from '../shared/types';

export function Slack({ type }: { type: EndpointType }) {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
  }, []);

  if (!settings) return null;
  const cfg = settings[type];

  async function save(patch: Partial<TypeSettings>) {
    setSaving(true);
    setSettings(prev => (prev ? { ...prev, [type]: { ...prev[type], ...patch } } : prev));
    try {
      await window.api.updateSettings({ [type]: patch });
    } catch (e) {
      console.error('slack settings save failed', e);
      setSettings(await window.api.getSettings());
    } finally {
      setSaving(false);
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
    <section style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <div style={card}>
        <Row label="알람 켜기">
          <input
            type="checkbox"
            checked={cfg.alarms_enabled === 1}
            onChange={e => save({ alarms_enabled: e.target.checked ? 1 : 0 })}
          />
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

      <p style={{ fontSize: 12, opacity: 0.55, margin: 0 }}>
        이 설정은 <strong>{type === 'health' ? '헬스체크' : '기능체크'}</strong> 전용입니다. 다른
        탭은 별도 채널/토큰을 가질 수 있습니다.
      </p>

      {saving && <small style={{ opacity: 0.6 }}>저장 중...</small>}
    </section>
  );
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
        border: `1px solid ${active ? '#3b82f6' : '#2a2f3a'}`,
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
  border: '1px solid #2a2f3a',
  borderRadius: 12,
  padding: 20,
  background: '#1c2028',
};
