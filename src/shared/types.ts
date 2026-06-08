export type EndpointType = 'health' | 'feature';

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
}

export type AlarmMode = 'consecutive' | 'sliding' | 'cycle';
export type SlackMode = 'webhook' | 'bot';

export interface TypeSettings {
  interval_ms: number;
  warning_ms: number;
  critical_ms: number;
  stagger_ms: number;
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
}

export interface Settings {
  retention_days: number;
  health: TypeSettings;
  feature: TypeSettings;
}

export type SettingsPatch = Partial<
  Omit<Settings, 'health' | 'feature'> & {
    health: Partial<TypeSettings>;
    feature: Partial<TypeSettings>;
  }
>;

export interface ProbeResult {
  endpointId: number;
  ts: number;
  durationMs: number;
  status: number;
  ok: boolean;
}

export interface AlarmEvent {
  id: number;
  ts: number;
  type: EndpointType;
  group_name: string;
  level: 'warning' | 'critical';
  title: string;
  detail: string;
}

declare global {
  interface Window {
    api: {
      listEndpoints: () => Promise<Endpoint[]>;
      addEndpoint: (ep: NewEndpoint) => Promise<number>;
      removeEndpoint: (id: number) => Promise<void>;
      importEndpoints: (json: string, forceType?: EndpointType) => Promise<number>;
      recentMeasurements: (endpointId: number, hours: number) => Promise<Measurement[]>;
      recentEvents: (limit: number) => Promise<AlarmEvent[]>;
      testSlack: (type: EndpointType) => Promise<{ ok: boolean; message: string }>;
      getSettings: () => Promise<Settings>;
      updateSettings: (patch: SettingsPatch) => Promise<void>;
      probeNow: (endpointId: number) => Promise<ProbeResult | null>;
      openMainWindow: () => Promise<void>;
      closePopover: () => Promise<void>;
      setPopoverPinned: (pinned: boolean) => Promise<void>;
      setPopoverHeight: (height: number) => Promise<void>;
    };
  }
}
