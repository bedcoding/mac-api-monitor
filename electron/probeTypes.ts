/**
 * 점검 전략(fetch / browser)이 공유하는 타입.
 * 각 전략은 "원시 결과(RawProbe)"만 만들고, 측정 기록·알람·이벤트는 Scheduler가 공통 처리한다.
 */

export interface RawProbe {
  ts: number; // 측정 시작 시각 (measurement.ts로 그대로 기록)
  status: number; // HTTP 상태 (0 = 알 수 없음 / 네트워크 오류)
  ok: boolean;
  durationMs: number;
  body: string | null; // 실패/특이사항 단서 (성공이면 보통 null)
  suppressAlarm?: boolean; // true 면 알람 관찰을 건너뜀 (예: 세션 만료 — 장애 아님)
}

/** 브라우저 점검 실행기 인터페이스 (Electron 의존을 main/browserRunner 쪽에 가둬두기 위한 경계). */
export interface BrowserProbe {
  run(
    url: string,
    opts: { timeoutMs: number; loginPattern: string; collectApiErrors?: boolean },
  ): Promise<{
    ok: boolean;
    status: number;
    durationMs: number;
    body: string | null;
    loginRedirect: boolean;
    apiErrors: Array<{ url: string; status: number }>;
  }>;
}
