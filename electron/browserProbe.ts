import type { Endpoint, TypeSettings } from './db';
import type { RawProbe, BrowserProbe } from './probeTypes';

/**
 * 브라우저 점검 (browser).
 * 등록된 화면 URL 을 로그인된 숨은 창(BrowserProbe 러너)으로 진입시켜 정상 렌더 여부를 본다.
 * 세션 만료(로그인 페이지로 튕김)는 장애가 아니므로 suppressAlarm 으로 표시해 알람을 막는다.
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

  const timeoutMs = Math.max(cfg.critical_ms * 2, 15_000);
  try {
    const r = await runner.run(ep.url, { timeoutMs, loginPattern: cfg.login_pattern });
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
