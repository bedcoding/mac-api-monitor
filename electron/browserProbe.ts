import type { Endpoint, TypeSettings } from './db';
import type { RawProbe, BrowserProbe } from './probeTypes';

/** 실패한 같은 사이트 API 목록을 사람이 읽을 사유 문자열로. */
function apiErrorBody(apiErrors: Array<{ url: string; status: number }>): string {
  const n = apiErrors.length;
  const sample = apiErrors
    .slice(0, 3)
    .map(e => {
      let where = e.url;
      try {
        const u = new URL(e.url);
        where = u.host + u.pathname;
      } catch {
        /* ignore */
      }
      return `${where} → ${e.status === 0 ? '연결실패' : e.status}`;
    })
    .join(', ');
  return `API ${n}건 실패 — ${sample}${n > 3 ? ' …' : ''}`;
}

/**
 * 브라우저 점검 (browser).
 * 등록된 화면 URL을 로그인된 숨은 창(BrowserProbe 러너)으로 진입시켜 정상 렌더 여부를 본다.
 * - 세션 만료(로그인 페이지로 튕김)는 장애가 아니므로 suppressAlarm으로 표시해 알람을 막는다.
 * - fail_on_api_error가 켜져 있으면, 진입은 됐어도 같은 사이트 API(XHR/fetch)가 5xx/연결실패면
 *   실패로 잡는다(껍데기 HTML은 200인데 데이터 API가 터져 화면이 하얀 케이스). 이건 알람 대상.
 * 측정 기록/알람은 하지 않는다 — 원시 결과(RawProbe)만 반환.
 */
export async function browserProbe(
  runner: BrowserProbe | null,
  ep: Endpoint,
  cfg: TypeSettings,
): Promise<RawProbe> {
  const start = Date.now();

  if (!runner) {
    return {
      ts: start,
      status: 0,
      ok: false,
      durationMs: 0,
      body: '브라우저 러너가 아직 준비되지 않았습니다.',
    };
  }

  const failOnApi = cfg.fail_on_api_error === 1;
  const timeoutMs = Math.max(cfg.critical_ms * 2, 15_000);
  try {
    const r = await runner.run(ep.url, {
      timeoutMs,
      loginPattern: cfg.login_pattern,
      collectApiErrors: failOnApi,
    });

    // 진입은 정상인데 같은 사이트 API가 터진 경우 → 실패로 승격(알람 대상, suppressAlarm 안 함).
    if (failOnApi && r.ok && r.apiErrors.length > 0) {
      return {
        ts: start,
        status: r.status,
        ok: false,
        durationMs: r.durationMs,
        body: apiErrorBody(r.apiErrors),
      };
    }

    return {
      ts: start,
      status: r.status,
      ok: r.ok,
      durationMs: r.durationMs,
      body: r.body,
      suppressAlarm: r.loginRedirect, // 세션 만료는 알람 대상 아님
    };
  } catch (e) {
    return {
      ts: start,
      status: 0,
      ok: false,
      durationMs: Date.now() - start,
      body: `브라우저 실행 오류: ${e instanceof Error ? e.message : String(e)}`.slice(0, 2048),
    };
  }
}
