export interface Endpoint {
  id: number;
  method: string;
  url: string;
  label: string;
  note: string | null;
  group: string | null;
}

export interface NewEndpoint {
  method: string;
  url: string;
  label: string;
  note?: string | null;
  group?: string | null;
}

export interface Measurement {
  id: number;
  endpoint_id: number;
  ts: number;
  duration_ms: number;
  status: number;
  ok: number;
}

export interface Settings {
  interval_ms: number;
  warning_ms: number;
  critical_ms: number;
  slack_webhook_url: string;
  alarms_enabled: number;
  retention_days: number;
  alarm_consecutive: number;
  alarm_cooldown_ms: number;
}

export interface ProbeResult {
  endpointId: number;
  ts: number;
  durationMs: number;
  status: number;
  ok: boolean;
}

declare global {
  interface Window {
    api: {
      listEndpoints: () => Promise<Endpoint[]>;
      addEndpoint: (ep: NewEndpoint) => Promise<number>;
      removeEndpoint: (id: number) => Promise<void>;
      importEndpoints: (json: string) => Promise<number>;
      recentMeasurements: (endpointId: number, hours: number) => Promise<Measurement[]>;
      getSettings: () => Promise<Settings>;
      updateSettings: (patch: Partial<Settings>) => Promise<void>;
      probeNow: (endpointId: number) => Promise<ProbeResult | null>;
      openMainWindow: () => Promise<void>;
      closePopover: () => Promise<void>;
      setPopoverPinned: (pinned: boolean) => Promise<void>;
      setPopoverHeight: (height: number) => Promise<void>;
    };
  }
}
