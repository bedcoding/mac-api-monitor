import type { Endpoint, TypeSettings } from './db';
import type { RawProbe } from './probeTypes';

/**
 * fetch 기반 점검 (health / feature).
 * URL 에 HTTP 요청을 보내 상태·응답시간을 재고, 실패 시 단서(본문/에러)를 남긴다.
 * 측정 기록/알람은 하지 않는다 — 원시 결과(RawProbe)만 반환.
 */
export async function fetchProbe(ep: Endpoint, cfg: TypeSettings): Promise<RawProbe> {
  const start = Date.now();
  let status = 0;
  let ok = false;
  let body: string | null = null;

  const timeoutMs = Math.max(cfg.critical_ms * 2, 10_000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(ep.url, { method: ep.method, signal: ac.signal });
    status = res.status;
    ok = res.ok;
    // 200 OK 가 아닐 때만 본문 저장 (4xx/5xx 디버깅 단서).
    // 본문은 앞 2KB 만, PII/토큰 등 저장 위험을 줄임.
    if (!ok) {
      try {
        body = (await res.text()).slice(0, 2048);
      } catch {
        body = null;
      }
    }
  } catch (e) {
    ok = false;
    // fetch 자체가 throw 한 경우 (timeout/DNS/연결 거부 등). 에러 메시지를 단서로 저장.
    if (ac.signal.aborted) {
      body = `응답시간 초과 (${timeoutMs}ms)`;
    } else {
      // undici 는 겉으로 'fetch failed' 만 던지고 진짜 원인(ENOTFOUND 등)은 cause 에 숨김
      let msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.cause) {
        const c = e.cause;
        const detail =
          c instanceof AggregateError && c.errors.length
            ? c.errors.map(x => (x instanceof Error ? x.message : String(x))).join(', ')
            : c instanceof Error
              ? c.message
              : String(c);
        if (detail) msg += ` (${detail})`;
      }
      body = msg.slice(0, 2048);
    }
  } finally {
    clearTimeout(timer);
  }

  return { ts: start, status, ok, durationMs: Date.now() - start, body };
}
