# API Monitor

URL 목록을 주기적으로 fetch 해서 응답시간/상태를 모니터링하는 Electron 맥북앱.
임계값 넘으면 슬랙 webhook + macOS 알림.

> 상세 배경/요구사항은 [BRIEFING.md](./BRIEFING.md) 참조.

---

## 주요 기능

### 📊 Dashboard 탭
- 등록된 endpoint 별 카드 표시
- 상태 점등 (🟢 정상 / 🟡 주의 / 🔴 심각)
- 최근 응답시간 + HTTP status + 측정 시각
- 최근 1시간 응답시간 라인 차트 (Recharts)
  - 주의/심각 임계값 가로선 표시
- **↻ 수동 재측정** 버튼 (스케줄 기다리지 않고 즉시 찍기)

### 📝 Endpoints 탭
- URL 수동 추가 (method / URL / 라벨)
- 삭제
- **JSON Import** (호환 포맷, 아래 참조)

### ⚙️ Settings 탭
- 측정 간격 (기본 30초)
- 임계값 2단계 (주의 / 심각)
- 알람 on/off 토글
- Slack Webhook URL
- 알람 피로 방지: 연속 N회 임계값 초과 시만 발동 + 쿨다운
- Measurement retention (오래된 데이터 자동 삭제, 기본 7일)

### 🔔 알람
- 임계값 초과가 **연속 N회** (기본 3회) 누적되었을 때만 발동
- 한 번 발동 후 **쿨다운 동안** (기본 10분) 같은 endpoint 재알람 안 함
- 발동 시:
  - **macOS 네이티브 알림** (Notification API)
  - **Slack Webhook** (텍스트 메시지)
- 레벨: 🟡 주의 (warning_ms 초과) / 🔴 심각 (critical_ms 초과 or 실패)

### 💾 데이터 저장
- SQLite (`~/Library/Application Support/api-monitor/api-monitor.db`)
- endpoints / measurements / settings 3개 테이블
- WAL 모드로 동시성 안전
- retention_days 지난 measurement 는 매 tick 끝에 자동 정리

### 🔄 백그라운드
- Electron 앱 실행 중 항상 스케줄러 동작
- 윈도우 닫아도 측정 계속 (완전 종료는 ⌘Q)
- 설정 변경 시 자동 재구성 (간격/임계값 즉시 반영)
- fetch 타임아웃: critical_ms × 2 (응답 안 오면 critical 로 기록)
- tick 재진입 방지 (이전 tick 미완료 시 다음 tick skip)

### 🍎 Dock 배지 (macOS)
- 한 눈에 상태 파악
- 🟡N : 주의 endpoint N개
- 🔴N : 심각 endpoint N개
- 모두 정상이면 배지 없음

### 🌱 첫 실행
- 기본은 빈 상태로 시작 (endpoint 0개)
- Endpoints 탭에서 추가하거나 JSON import
- 특정 환경 전용으로 갈 거면 [electron/seed.ts](./electron/seed.ts) 의 `SEED_ENDPOINTS` 배열에 적어두면 첫 실행 시 자동 삽입됨

---

## Quick Start

```bash
yarn install
yarn dev
```

`yarn dev` 하면 Vite + Electron 동시 실행. 윈도우 뜨면 OK.

> **native module 이슈**: `better-sqlite3` 는 native 모듈이라 Electron 과 ABI 가 맞아야 함.
> `yarn install` 후 에러 나면 `npx electron-rebuild` 또는 `yarn add -D @electron/rebuild && npx electron-rebuild` 시도.

## 폴더 구조

```
api-monitor/
├── electron/           # Electron 메인 프로세스
│   ├── main.ts         # 윈도우 생성 + IPC 핸들러
│   ├── preload.ts      # contextBridge → window.api
│   ├── db.ts           # SQLite (better-sqlite3)
│   ├── scheduler.ts    # 주기 fetch + retention prune
│   ├── notifier.ts     # 슬랙 + 알림 + 쿨다운/연속카운트
│   └── seed.ts         # 첫 실행 시 자동 삽입할 endpoint (기본 빈 배열)
├── src/                # React 렌더러
│   ├── main.tsx
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Endpoints.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   └── EndpointCard.tsx
│   └── shared/
│       └── types.ts    # window.api 타입 + Endpoint/Measurement/Settings
├── index.html
├── vite.config.ts
├── package.json
└── BRIEFING.md         # 다음 클로드용 컨텍스트
```

## IPC API (window.api)

```ts
listEndpoints()                          // Endpoint[]
addEndpoint(ep)                          // number (id)
removeEndpoint(id)
importEndpoints(json)                    // number (imported count)
recentMeasurements(endpointId, hours)    // Measurement[]
getSettings()                            // Settings
updateSettings(patch)
probeNow(endpointId)                     // ProbeResult | null
```

## JSON Import 포맷

```json
{
  "version": 1,
  "endpoints": [
    {
      "method": "GET",
      "url": "https://api.example.com/v2/path",
      "label": "홈 메인",
      "note": "DB 부하 1순위",
      "group": "prod-seoul"
    }
  ]
}
```

## 빌드 / 배포

```bash
yarn build:mac    # .dmg 생성 → release/ 폴더
```

빌드본을 맥북에 옮긴 뒤, **시스템 설정 → 일반 → 로그인 항목** 에서 자동 실행 등록.

## 데이터 위치

SQLite DB: `~/Library/Application Support/api-monitor/api-monitor.db`
