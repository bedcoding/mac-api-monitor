# API Monitor

URL 목록을 주기적으로 fetch 해서 응답시간/상태를 모니터링하는 Electron 맥북앱.
임계값 넘으면 슬랙 webhook + macOS 알림.

메뉴바 popover (컴팩트 Dashboard) + 일반 메인 윈도우 ("전체 보기") 2-tier UI.

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
- SQLite (`~/Library/Application Support/mac-api-monitor/mac-api-monitor.db`)
- endpoints / measurements / settings 3개 테이블
- WAL 모드로 동시성 안전
- retention_days 지난 measurement 는 매 tick 끝에 자동 정리

### 🔄 백그라운드
- Electron 앱 실행 중 항상 스케줄러 동작
- 윈도우 닫아도 측정 계속 (완전 종료는 ⌘Q)
- 설정 변경 시 자동 재구성 (간격/임계값 즉시 반영)
- fetch 타임아웃: critical_ms × 2 (응답 안 오면 critical 로 기록)
- tick 재진입 방지 (이전 tick 미완료 시 다음 tick skip)

### 🍎 메뉴바 아이콘 (macOS)
- 상단 메뉴바에 emoji 텍스트로 상태 표시
- 🟢 / 🟡N / 🔴N : 정상 / 주의 N개 / 심각 N개
- endpoint 0개면 ⚪
- 클릭 → popover 열기/닫기
- 우클릭 → 컨텍스트 메뉴 (전체 보기 / DevTools / 종료)

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
mac-api-monitor/
├── electron/           # Electron 메인 프로세스
│   ├── main.ts         # 트레이/popover/메인 윈도우 + IPC 핸들러
│   ├── preload.ts      # contextBridge → window.api
│   ├── db.ts           # SQLite (better-sqlite3)
│   ├── scheduler.ts    # 주기 fetch + retention prune
│   ├── notifier.ts     # 슬랙 + 알림 + 쿨다운/연속카운트
│   └── seed.ts         # 첫 실행 시 자동 삽입할 endpoint (기본 빈 배열)
├── src/                # React 렌더러
│   ├── main.tsx
│   ├── App.tsx        # popover/메인 윈도우 분기 (hash=#popover)
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
└── package.json
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
openMainWindow()                         // popover 의 "전체 보기" 버튼
closePopover()
setPopoverHeight(px)                     // 컨텐츠 높이에 맞춘 윈도우 리사이즈
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

SQLite DB: `~/Library/Application Support/mac-api-monitor/mac-api-monitor.db`

---

## 진행 중인 작업 (다음 세션)

### v0.1 마무리
- [ ] 풀 기능 테스트 미수행 — endpoint 추가 → fetch → 알람 발동 → Slack 까지의 풀 워크플로우 검증

### v0.2 — Health / Features 2-tier 모니터링 (대형 리팩터)

**배경**: 모니터링 대상 API 가 두 종류로 자연스럽게 갈림.

| 종류 | 예시 | 특성 | 알람 의미 |
|---|---|---|---|
| **Health** | `/api/health`, `/api/time` | 가볍고 일관됨, DB 의존 없음 | 즉시 다운 시그널 |
| **Feature** | `common_meta`, `ranking`, content-list 등 | 무겁고 들쭉날쭉, DB/캐시 민감 | 점진적 degrade 시그널 |

같은 임계값/주기/알람 정책으로 다루면 양쪽 다 망가짐 (health 임계값으로 feature 보면 알람 폭격, feature 임계값으로 health 보면 조용한 이상 놓침).

**설계 결정**:

1. **endpoint 에 `type: 'health' | 'feature'` 필드 추가** — 등록 시 사용자가 분류
2. **2탭 UI** — `[Health] [Features] [Endpoints] [Settings]`. 각 탭 안에서 *서버군별 (group) 섹션* 으로 구조화 (Thanos/Wanda/Panther/... 추가돼도 탭은 그대로)
3. **type 별 독립 정책** — Settings 도 `health: {...}` / `feature: {...}` 로 분리. 각자 다른 interval/warning/critical/알람 전략
4. **스케줄링**:
   - Health: 1분 주기 + 5초 stagger, *일제히* 호출하되 burst 만 분산 (스냅샷 의미 유지)
   - Feature: 1분 주기 + 1초 stagger × 27개 → 27초에 한 사이클
   - 두 그룹은 독립 트랙
5. **알람 전략 분기**:
   - Health: `consecutive` (연속 2-3회면 즉시 알람, 다운 직감)
   - Feature: `sliding-window` (최근 N회 측정 중 M개가 임계 초과 시 알람)
6. **그룹 간 상관 분석 (선택)** — 알람 메시지에 다른 그룹 상태 같이 표시. 예: "Feature/Thanos 27개 중 12개 느림 (Health 정상 → DB 병목 의심)"

**그룹 단위 알람 통합**: 같은 서버군의 endpoint 가 연달아 터질 때 알람 1건으로 묶기 (현재는 endpoint 별 N건 burst).

**영향 받는 파일**:
- `db.ts` — endpoints 테이블에 `type` 컬럼, settings 를 type 별로 분리
- `scheduler.ts` — type/group 별 독립 트랙 + per-group stagger. 현재 `Promise.all` 동시 호출 교체
- `notifier.ts` — type 별 알람 전략 분기 (consecutive vs sliding-window), 그룹 단위 카운터
- `pages/` — Dashboard.tsx → Health.tsx + Features.tsx 로 분할. Endpoints.tsx 는 type 선택 UI 추가
- `App.tsx` — 탭 구조 4개로
- `shared/types.ts` — Endpoint 에 type, Settings 분리

### 기타 후보
- 실패 시 에러 메시지 컬럼 (DNS/timeout/HTTP 구분용)
- "회전 가능" endpoint 지원 — URL 의 파라미터 값을 매 측정마다 다른 값으로 순환
- 트레이 아이콘 — 현재 emoji 텍스트만, `assets/tray.png` 16×16 추가하면 풀 컬러
