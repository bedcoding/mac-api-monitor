export type EndpointType = 'health' | 'feature' | 'browser';

export interface Endpoint {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group: string | null;
  type: EndpointType;
}

export interface NewEndpoint {
  method: string;
  url: string;
  label: string;
  note?: string | null;
  group?: string | null;
  type?: EndpointType;
}

export interface Measurement {
  id: number;
  endpoint_id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
  body: string | null;
}

export type AlarmMode = 'consecutive' | 'sliding' | 'cycle';
export type SlackMode = 'webhook' | 'bot';

export interface TypeSettings {
  interval_ms: number;
  warning_ms: number;
  critical_ms: number;
  stagger_ms: number;
  base_url: string;
  login_pattern: string;
  checks_enabled: number;
  fail_on_api_error: number;
  alarm_mode: AlarmMode;
  alarm_consecutive: number;
  alarm_window: number;
  alarm_window_hits: number;
  alarm_cycle_percent: number;
  alarms_enabled: number;
  alarm_cooldown_ms: number;
  slack_mode: SlackMode;
  slack_webhook_url: string;
  slack_bot_token: string;
  slack_channel: string;
  retention_days: number;
}

export interface Settings {
  health: TypeSettings;
  feature: TypeSettings;
  browser: TypeSettings;
}

export type SettingsPatch = Partial<
  Omit<Settings, 'health' | 'feature' | 'browser'> & {
    health: Partial<TypeSettings>;
    feature: Partial<TypeSettings>;
    browser: Partial<TypeSettings>;
  }
>;

export type BrowserSessionState = 'ok' | 'expired' | 'unknown';

export interface BrowserSessionStatus {
  state: BrowserSessionState;
  finalUrl?: string;
  checkedAt: number;
}

export interface ProbeResult {
  endpointId: number;
  ts: number;
  durationMs: number;
  status: number;
  ok: boolean;
}

export type SlackStatus = 'sent' | 'failed' | 'skipped';

export interface AlarmEvent {
  id: number;
  ts: number;
  type: EndpointType;
  group_name: string;
  level: 'warning' | 'critical';
  title: string;
  detail: string;
  slack_status: SlackStatus | null;
  slack_error: string | null;
}

export interface EndpointStat {
  endpoint_id: number;
  total: number;
  threshold: number;
}

export interface ThresholdEvent {
  id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
  endpoint_id: number;
  label: string;
  url: string;
  method: string;
  group_name: string | null;
  level: 'healthy' | 'warning' | 'critical';
  body: string | null;
}

declare global {
  interface Window {
    api: {
      listEndpoints: () => Promise<Endpoint[]>;
      addEndpoint: (ep: NewEndpoint) => Promise<number>;
      removeEndpoint: (id: number) => Promise<void>;
      importEndpoints: (json: string, forceType?: EndpointType) => Promise<number>;
      recentMeasurements: (endpointId: number, limit: number) => Promise<Measurement[]>;
      recentEvents: (type: EndpointType, limit: number) => Promise<AlarmEvent[]>;
      recentThresholdExceeded: (type: EndpointType, limit: number) => Promise<ThresholdEvent[]>;
      recentEndpointStats: (type: EndpointType, hours: number) => Promise<EndpointStat[]>;
      recentMeasurementsAll: (type: EndpointType, perEndpoint: number) => Promise<ThresholdEvent[]>;
      testSlack: (type: EndpointType) => Promise<{ ok: boolean; message: string }>;
      getSettings: () => Promise<Settings>;
      updateSettings: (patch: SettingsPatch) => Promise<void>;
      probeNow: (endpointId: number) => Promise<ProbeResult | null>;
      openBrowserLogin: () => Promise<{ ok: boolean; message: string }>;
      browserSessionStatus: () => Promise<BrowserSessionStatus>;
      onBrowserSessionChange: (cb: (s: BrowserSessionStatus) => void) => () => void;
      setBrowserVisible: (visible: boolean) => Promise<void>;
      isBrowserVisible: () => Promise<boolean>;
      runBrowserChecksNow: () => Promise<number>;
      onBrowserVisibleChange: (cb: (visible: boolean) => void) => () => void;
      openMainWindow: () => Promise<void>;
      closePopover: () => Promise<void>;
      setPopoverPinned: (pinned: boolean) => Promise<void>;
      setPopoverHeight: (height: number) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
