# API Monitor

URL 목록을 주기적으로 fetch 해서 응답시간/상태를 모니터링하는 데스크톱 앱.
임계값 초과 시 Slack + OS 네이티브 알림. **macOS / Windows 모두 지원.**

트레이(메뉴바/시스템 트레이) popover (컴팩트 모니터링) + 일반 메인 윈도우 ("전체 보기") 2단 UI.

---

## Quick Start

```bash
yarn install
yarn rebuild      # better-sqlite3 를 Electron ABI 에 맞춰 재빌드 (install 직후 1회)
yarn dev
```

> **native module 이슈**: `better-sqlite3` 가 native 모듈이라 Electron ABI 와 맞아야 함.
> `yarn rebuild`(= `electron-builder install-app-deps`) 로 맞춤. 그래도 에러 나면 `npx @electron/rebuild`.
>
> **Windows 빌드 전제**: 소스 컴파일이 필요한 경우 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)(“C++ 데스크톱 개발” 워크로드) + Python 3 가 있어야 함. 대부분은 prebuilt 바이너리로 해결됨.

빌드:
```bash
yarn build:mac    # .dmg          → release/   (macOS 에서)
yarn build:win    # .exe(NSIS/포터블) → release/   (Windows 에서)
yarn build        # 현재 OS 기준 빌드
```

> 네이티브 모듈(better-sqlite3) 때문에 **각 OS 에서 그 OS 용 빌드를 만들어야 함** (크로스 빌드 비권장).

---

## 핵심 개념: 헬스체크 vs 기능체크

모니터링 대상을 **2종류로 분리**해서 다른 정책을 적용한다.

| 종류 | 예시 | 특성 | 권장 알람 정책 |
|---|---|---|---|
| **헬스체크** | `/api/health` | 가볍고 일관됨, DB 의존 없음 | 엄격한 임계값(500ms/1초) + 연속 N회 즉시 알람 |
| **기능체크** | 랭킹/콘텐츠 목록 등 | 무겁고 변동성 큼, DB/캐시 민감 | 느슨한 임계값(3초/7초) + 그룹 누적/사이클 동시 알람 |

같은 정책으로 다루면 양쪽 다 망가짐 (헬스 임계값으로 기능 보면 알람 폭격, 기능 임계값으로 헬스 보면 다운 놓침).

각 type 마다 **독립된 측정 주기 / 임계값 / 알람 방식 / 슬랙 채널** 을 가질 수 있다.

---

## 브라우저 점검 (로그인 상태 화면 진입)

헬스/기능체크가 *API 가 사는가*를 본다면, 브라우저 점검은 *로그인한 사용자가 실제 화면에 정상 진입하는가*를 본다. Electron 내장 Chromium 의 숨은 창으로 등록한 화면 URL 에 진입해 정상 렌더 / HTTP 4xx·5xx / 로드 실패 / 세션 만료 / **같은 사이트 데이터 API(XHR·fetch) 5xx·연결 실패**(화면 껍데기는 200이어도 데이터가 터진 "하얀 화면" 케이스)를 판정한다.

- 로그인은 **사람이 1회 수동**으로 한다 (설정 탭 → base URL 입력 → "로그인 창 열기"). 세션은 저장되어 앱 재시작에도 유지되고, 만료되면 다시 로그인하면 된다. **세션 만료는 장애가 아니므로 Slack 알람을 쏘지 않는다.**
- 점검할 화면은 추가 탭에서 URL 로 등록. 설정 탭의 **비상정지 토글**로 자동 점검을 즉시 멈출 수 있다(숨은 창도 닫힘).

### 왜 Playwright 가 아니라 내장 Chromium 인가

Electron 은 이미 Chromium 을 내장한다. v1 목표가 "로그인 상태로 주요 화면이 정상 렌더되는지"(진입 점검)라, 별도 브라우저(수백 MB)를 받아 패키징·프로세스 관리하는 Playwright 보다 내장 크롬이 의존성·패키징·세션 처리 모두 단순하다. Playwright 의 강점(auto-wait·codegen·trace)은 복잡한 다단계 플로우에서 빛나는데 v1엔 그 시나리오가 없다. 복잡한 플로우가 필요해지면 실행부(`BrowserProbe` 인터페이스)만 Playwright 사이드카로 교체하면 된다 — 스케줄러·알람·UI·DB 는 그대로. (설계 전반: [docs/browser-checks-plan.md](docs/browser-checks-plan.md))

---

## UI 구조

```
┌ 상위 탭: 조회 / 추가 / 로그 / 설정 / 슬랙 ┐
└ 하위 토글: 헬스체크 / 기능체크 / 브라우저  ┘
   └ 내용
```

- **상위탭** = 무엇을 할지 (action)
- **하위토글** = 어느 type 에 적용할지

탭을 옮겨도 type 토글은 유지된다 — 헬스체크 조회 보다가 "로그" 누르면 헬스체크 로그가 바로 뜸.

### 탭별 역할

- **조회**: 등록된 endpoint 카드 + 라인 차트, group 별 섹션
- **추가**: 직접 추가(URL/메서드/라벨/그룹) + JSON Import (선택한 type 으로 고정 등록)
- **로그**: 알람 발동 이력 (시간순)
- **설정**: 측정 간격 / stagger / 임계값 / 쿨다운 / 알람 방식 + 보관일(공통)
- **슬랙**: 알람 on/off / Webhook 또는 Bot Token / 채널 / Slack 테스트 발송

### 알람 방식 3가지 (각 type 별 선택)

- **연속 N회**: 한 endpoint 가 단독으로 연속 N회 임계 초과 → 그 endpoint 알람
- **사이클 동시(%)**: 한 사이클(전체 endpoint 1회씩) 동안 그룹의 K% 이상 임계 초과 → 그룹 알람 1건
- **시간 누적(N중 M)**: group 안 최근 N개 측정 중 M개 임계 초과 → 그룹 알람 1건

발동 시 macOS 알림 + Slack 동시 발송, 한 번 발동 후 **쿨다운**(기본 10분) 동안 재발동 없음.

---

## 데이터

- **SQLite**:
  - macOS: `~/Library/Application Support/API Monitor/mac-api-monitor.db`
  - Windows: `%APPDATA%\API Monitor\mac-api-monitor.db`
  - (Electron `app.getPath('userData')` 기준 — OS 표준 앱 데이터 폴더)
- 보관일(기본 7일) 지난 측정/이벤트 자동 정리

### JSON Import 포맷

```json
{
  "version": 1,
  "endpoints": [
    {
      "method": "GET",
      "url": "https://api.example.com/v2/path",
      "label": "홈 메인",
      "note": "메모",
      "group": "main-api"
    }
  ]
}
```

---

## 트레이 아이콘

상태에 따라 표시가 바뀜:

- **macOS** (메뉴바): 텍스트 — 🟢 (전부 정상) / 🟡N (주의 N개) / 🔴N (심각 N개) / ⚪ (endpoint 0개)
- **Windows** (시스템 트레이): 상태색 원 아이콘 — 초록(정상) / 노랑+N(주의) / 빨강+N(심각) / 회색(0개). 정확한 개수는 아이콘 hover 툴팁에도 표시.

공통:

- 좌클릭 → popover 열기/닫기 (macOS 는 메뉴바 아래, Windows 는 트레이 위에 표시)
- 우클릭 → 컨텍스트 메뉴 (전체 보기 / DevTools / 종료)

윈도우 닫아도 트레이에 남아 측정 계속. 완전 종료는 우클릭 → 종료 (macOS 는 ⌘Q 도 가능).

> 트레이 동적 아이콘 렌더링은 [electron/windows/trayIcon.ts](electron/windows/trayIcon.ts) — **Windows/Linux 전용** (macOS 는 `tray.setTitle` 사용). Windows 전용 로직은 `electron/windows/` 폴더로 격리.
