# 브라우저 기반 점검(시나리오 모니터링) 설계서

> 상태: **설계 확정 진행 중** — 일부 항목은 프론트팀과 합의 후 확정. `TODO(FE)` 표시.
> 작성 배경: 기존 API 헬스체크 위에 "실제 사용자처럼 로그인→페이지 방문→기능 점검"을 얹는다.
>
> **🔒 결정 고정**
> - **v1 범위**: 로그인 상태 "화면 진입 점검" **본격 도입**(부가 레이어 아님). 비회원 헬스체크는 **병행 유지**(대체 X).
> - **실행 엔진**: Playwright 사이드카 아님 → **Electron 내장 크롬(BrowserWindow + `persist:monitor` 파티션)**. (4.4)
> - **로그인**: 자동 로그인 X → **사람이 1회 수동 로그인 + 세션 보존**, 만료 시 자가 재로그인. (4.5)
> - **🔑 선행 조건(필수)**: FE가 ①테스트 계정/세션 ②화면 URL 목록 ③UI 변경 시 시나리오 공동 유지(`data-testid` 협조)를 약속해야 착수. (12-6)

---

## 1. 배경 / 문제

지금 앱은 **API 헬스체크(블랙박스 모니터링)** 다.

- 등록된 URL에 `fetch()` 한 방 → `status / duration / ok`만 본다. ([scheduler.ts `probe()`](../electron/scheduler.ts) L201)
- "서버 부품이 살아있나 + 느린가"만 점검. 가볍고 인증 불필요, 1분 간격으로 수십 개 가능.

한계: 실제 장애는 보통 **로그인 후 화면, 목록에 안 넣은 내부 API**에서 난다. Next.js는 페이지 하나에서 SSR·서버컴포넌트·hydration 후 클라이언트 fetch로 수많은 API를 호출하는데, 이걸 URL로 일일이 등록하는 건 불가능에 가깝다.

→ **실제 페이지를 브라우저로 열어, 그 페이지가 쓰는 API를 통째로 검증**하자는 것이 이 기능의 목적.

---

## 2. 목표 / 비목표

### 목표
- headless 브라우저로 **사용자 시나리오**를 주기적으로 실행.
  - **1차 범위(확정): "스모크/진입 점검"만** — 로그인 1회 후 **주요 화면 URL 목록**을 차례로 방문해 "에러 없이 정상 렌더됐나"만 확인. 복잡한 클릭 플로우 ❌. 즉 *로그인된 상태의 페이지 로드 점검*. (요구사항 커지면 7.1 확장 경로로 — 재설계 없이 step만 추가)
- 시나리오의 **통과/실패 + 단계별 소요시간 + 콘솔 에러**를 기록.
- 실패/지연 시 기존 알람(데스크톱 알림 + Slack) 재사용.
- 실패 시 **스크린샷 / trace**를 남겨 원인 추적.

### 비목표 (이번 범위 아님)
- 기존 API 헬스체크 대체 ❌ — **둘은 보완재.** 헬스체크는 그대로 둔다(가볍고 빠른 1차 경보).
- 부하 테스트 / 성능 벤치마크 ❌.
- 시나리오 GUI 편집기(드래그앤드롭) ❌ — 1차는 코드로 정의(아래 7장).

---

## 3. 두 모니터링의 차이 (요약)

| | 기존: API 헬스체크 | 신규: 브라우저 점검 |
|---|---|---|
| 단위 | URL 1개 | 시나리오 1개(여러 단계) |
| 방식 | `fetch(url)` | 진짜 크롬으로 페이지 실행 |
| 인증 | 비회원 GET만 | 로그인 필요(테스트 계정) |
| 잡는 것 | 서버가 사나/느린가 | 사용자 기능이 실제로 되나 |
| 결과 | status/ms | 통과·실패 + 단계별 ms + 콘솔에러 |
| 비용 | 가벼움(1분 간격 OK) | 무거움(보통 5~15분 간격) |
| 안정성 | 높음 | flaky 위험(셀렉터/타이밍) |

---

## 4. 핵심 설계 결정

### 4.1 새 체크 종류 `browser` 추가 (기존 구조 재사용)
앱은 이미 `EndpointType = 'health' | 'feature'`로 갈라져 있고 type별로 주기·임계값·알람·Slack·보관·탭이 **독립적으로** 돈다. 여기에 **세 번째 type `browser`** 를 얹는다. 스케줄러·알람·보관·이벤트 로그·탭 UI 패턴을 그대로 재사용 → **전면 재설계 아님.**

> 네이밍 주의: 기존 `feature`가 이미 "느린 API" 칸이라 `browser`와 헷갈릴 수 있음. UI 라벨은 "브라우저 점검"으로. `TODO(FE)` 최종 네이밍 합의.

### 4.2 [선결 리팩터링] type 디스패치를 테이블 기반으로
지금 곳곳에 `type === 'health' ? s.health : s.feature` 이분 삼항이 박혀 있다 ([notifier.ts](../electron/notifier.ts) L39·L61·L209·L250, [main.ts](../electron/main.ts) `classifyStatus` L229·IPC 핸들러들). type이 3개가 되면 전부 깨진다.
→ **`settings[type]` 룩업으로 치환**하고 IPC type-guard도 `['health','feature','browser']` 멤버십 체크로 일반화. 동작 변화 없음, 확장만 쉬워짐. (M0)

### 4.3 probe를 "전략"으로 분리
[scheduler.ts `probe()`](../electron/scheduler.ts) L201은 fetch 전용 자유함수다. 인터페이스를 맞춰 둘로 나눈다:
- `fetchProbe(ep)` — 지금 그대로.
- `runScenario(scenario)` — Playwright로 시나리오 실행.

`Track`(스케줄러)은 type만 받아 도는 제네릭이라 거의 안 건드린다. 다만 **브라우저 트랙은 cadence가 다르다**(많은 endpoint를 stagger로 쏘는 게 아니라, 소수 시나리오를 **순차·저동시성·긴 간격**으로). → `BrowserTrack` 변형 또는 Track에 "동시 실행 1개" 모드 추가.

### 4.4 Playwright 실행 방식 — **사이드카 채택** ⚠️ 가장 큰 결정

| | A. Playwright 사이드카(자식 프로세스) | B. Electron 내장 크롬(offscreen BrowserWindow) |
|---|---|---|
| 자동 대기/locator/codegen | ✅ 있음 | ❌ 직접 구현 |
| flaky 대응·trace·video | ✅ 강력 | ❌ 수작업 |
| 추가 바이너리 | ⚠️ 크롬 ~150–300MB | ✅ 없음(Electron 크롬 재사용) |
| 패키징 난이도 | ⚠️ 높음(asarUnpack/다운로드) | ✅ 낮음 |
| 안정성 | ✅ 크래시 격리 | ⚠️ 앱과 한 몸 |

**🔁 [v1 결정] B(Electron 내장 크롬) 채택.** 자동 로그인을 안 하기로 했으므로(4.5) Playwright의 최대 강점(로그인 플로우 codegen·복잡 단계 auto-wait)이 v1에선 거의 불필요. 대신 B가 **로그인을 자연스럽게 해결**한다: 사람이 보이는 `BrowserWindow`에서 1회 로그인 → 쿠키가 `session.fromPartition('persist:monitor')`에 저장 → 모니터가 *같은 파티션*의 숨은(offscreen) 창으로 각 화면 순회. **추가 바이너리 0, 패키징 간단.** 진입 점검 수준의 판정(2xx·콘솔에러·요소 노출·로그인 리다이렉트 감지)은 `webContents` 이벤트 + `executeJavaScript`로 충분.

**A(사이드카)는 "확장(7.1)" 카드로 보류.** 나중에 복잡한 클릭 플로우/auto-wait/trace가 필요해지면 그때 도입. (그땐 크롬을 첫 실행 시 `userData`로 다운로드해 dmg/nsis 가볍게 유지)

> 구현 시점에 Playwright/Electron 버전별 패키징 디테일은 재확인. ([electron-builder](../package.json) `asarUnpack`/`extraResources`/`files` 조정 필요)

### 4.5 인증 — **[v1 결정] 자동 로그인 안 함. 사람이 1회 수동 로그인 + 세션 보존.**
자동 로그인(비번 저장·MFA 자동입력)이 이 기능 최대 난관 → **들어낸다.** 대신:
1. 사람이 앱 안의 보이는 `BrowserWindow`에서 **1회 직접 로그인**(MFA도 사람이 처리).
2. 쿠키/세션을 **디스크에 영속**(`persist:monitor` 파티션) → 앱 재시작·재부팅해도 로그인 유지. *(라이브 창 하나 켜두는 방식 ❌ — 크래시/재부팅에 날아감)*
3. 모니터는 그 세션으로 각 화면 순회만.

이 방식의 효과:
- ✅ **비번 디스크 저장 불필요**(평문/safeStorage 고민 사라짐). **MFA도 사람이 1회만** → 자동화 블로커 해소.
- ✅ **개인 계정 리스크 급감**(자동 로그인 폭탄·비번 유출면 제거). 인격 귀속만 약간 잔존 → 전용계정이면 더 깔끔하지만 v1은 개인계정으로 출발 가능.
- ⚠️ **세션 만료 처리 필수**: 만료 시 `/login` 리다이렉트/401 감지 → "장애" 아닌 "**재로그인 필요**"로 분리 표시(헛알람 방지). 절대 만료면 며칠에 1회 수동 재로그인.
- trace/스크린샷에 로그인 PII → **로컬 보관만**, retention, 필요시 마스킹.

---

## 5. 재사용 vs 신규 (구체 매핑)

| 영역 | 재사용 | 신규 |
|---|---|---|
| 스케줄러 | `Track` 골격 | `BrowserTrack`(순차·1동시성·긴 간격) |
| 체크 실행 | — | `runScenario()` + 사이드카 |
| 알람 | `Notifier` 전체(consecutive/sliding/cooldown/Slack) | run→level 매핑 어댑터 |
| DB | `migrate()` 패턴, prune, alarm_events | `scenarios`/`scenario_runs`/`step_results` 테이블 |
| 설정 | `getSettings/updateSettings`(prefix flatten) | `browser` TypeSettings + 브라우저 전용 필드 |
| 트레이 | `lastStatusByEndpoint`/`updateTray` | 시나리오 상태 합산 |
| IPC | preload/ipcMain 패턴 | `scenarios:*`, `runs:*` 채널 |
| UI | Dashboard/Events 탭 패턴, recharts | "브라우저" 탭 + 단계 타임라인/스샷 |

---

## 6. 데이터 모델 (초안)

`endpoints`/`measurements`는 **건드리지 않는다.** 별도 테이블 추가(기존 `try/catch ALTER` 마이그레이션 스타일 유지):

```sql
CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT,
  base_url TEXT NOT NULL,
  steps_json TEXT NOT NULL,      -- 단계 정의 (7장)
  account_ref TEXT,              -- safeStorage 키 참조 (nullable)
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE scenario_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,           -- 전체 통과 여부
  failed_step TEXT,              -- 실패 단계명 (nullable)
  error TEXT,                    -- 에러 메시지(truncated)
  console_errors INTEGER NOT NULL DEFAULT 0,
  trace_path TEXT,               -- 실패 시 trace/스샷 경로 (nullable)
  FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);
CREATE TABLE step_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  ok INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  detail TEXT,
  FOREIGN KEY (run_id) REFERENCES scenario_runs(id) ON DELETE CASCADE
);
```
알람은 기존 `alarm_events`를 `type='browser'`로 재사용.

---

## 7. 시나리오 정의 포맷

**1차 형태 = "진입 점검 배치"(확정).** 시나리오 하나가 *로그인 1회 → 화면 URL 목록을 순회하며 각각 진입 확인*. 따라서 실질 정의는 거의 **URL 목록 + 화면별 "정상" 판정 기준**이면 충분하다(복잡한 단계 정의 불필요).

화면별 "정상 진입" 판정 기준(택1~조합):
- HTTP 응답이 2xx (5xx/4xx 아님)
- 페이지 콘솔 에러 0건
- 핵심 요소 노출(`data-testid` 권장) 또는 "에러 화면 아님"(에러 바운더리/404 텍스트 부재)
- 페이지 내 네트워크 호출 중 실패(5xx) 0건

**정의 방식: 코드(TS).** 가장 빠르고 타입 안전하며, Playwright `codegen`으로 로그인 부분만 녹화해 초안을 뽑을 수 있다. DSL을 처음부터 만들지 않는다.

```ts
// 1차 = 로그인 1회 + 화면 목록 순회
const smoke: Scenario = {
  name: '주요 화면 진입',
  baseUrl: '...',                       // TODO(FE)
  login: async (page, creds) => { /* codegen 으로 뽑기 */ },
  pages: [                              // TODO(FE): 화면 링크 목록
    { name: '홈', path: '/', mustSee: 'home-main' },
    { name: '마이페이지', path: '/my', mustSee: 'my-root' },
    // ...
  ],
};
// 실행: login() 1회 → pages 각각 goto → 위 판정 기준 → step_results 1줄씩
```

> 즉 FE가 "화면 링크 목록"만 주면 거의 끝.

### 7.1 확장 경로 (요구사항 늘어날 때 — 갈아엎기 X)
1차 "진입 점검"은 **일반 시나리오의 최단 특수형**(모든 step이 `goto + 렌더 확인`)이다. 그래서 나중에 요구사항이 커져도 **구조 변경 없이 step만 풍부해진다**:
- 클릭 플로우(로그인→담기→결제) 추가 → `pages[]`를 `steps[]`(click/fill/expect…)로 확장. 테이블·알람·UI 그대로.
- 시나리오를 코드(TS)에서 → JSON 데이터/`steps_json`으로 → (정말 필요하면) GUI 편집기로. 단계적 승급.
- **지금 안 만든다(YAGNI)**: JSON DSL·드래그앤드롭 편집기. 실제 요구 오면 그때.

```ts
// 단계 = {name, run(page)}. run 안에서 Playwright locator 사용.
const loginAndHome: Scenario = {
  name: '로그인→홈',
  baseUrl: '...',          // TODO(FE)
  steps: [
    { name: '로그인', run: async (page, creds) => {
        await page.goto('/login');
        await page.getByLabel('이메일').fill(creds.id);
        await page.getByLabel('비밀번호').fill(creds.pw);
        await page.getByRole('button', { name: '로그인' }).click();
        await page.waitForURL('/');
    }},
    { name: '홈 핵심영역 노출', run: async (page) => {
        await page.getByTestId('home-main').waitFor({ state: 'visible' });
    }},
  ],
};
```
**2차(선택): JSON 데이터 기반** 시나리오 + UI 편집 — 수요가 확인되면 그때. `steps_json`이 그 그릇.

각 step을 `step_results`에 기록. step의 `run`을 try/catch로 감싸 실패 step명·소요시간 저장, 실패 시 `page.screenshot()` + trace 저장.

---

## 8. 알람 통합 (Notifier 재사용)

run 1건을 level로 매핑해 기존 [`Notifier.observe`](../electron/notifier.ts)에 흘린다:

- `!ok`(흐름 깨짐) **또는** `duration_ms >= critical_ms` → `critical`
- `duration_ms >= warning_ms` → `warning`
- 그 외 → 정상

**flaky 억제 핵심:** browser type의 알람 모드를 `consecutive`로, `alarm_consecutive >= 2`로 둬서 **1회 실패로는 알람 안 울리게** 한다(연속 2회 이상 실패만 진짜로 취급). cooldown·Slack은 type별 설정 그대로 재사용.

---

## 9. UI

새 탭 "브라우저 점검" — 기존 [Dashboard](../src/pages/Dashboard.tsx)/[Events](../src/pages/Events.tsx) 패턴 재사용:
- 시나리오 카드(최근 상태/성공률), "지금 실행" 버튼(`probe:now` 대응 IPC).
- run 히스토리 + **단계별 타임라인**(어느 step에서 몇 초/실패).
- 실패 run에서 **스크린샷/trace 열기**.
- **로그인 세션 상태 배지**(로그인됨 / 만료-재로그인 필요) + **"로그인" 버튼**(보이는 창 열어 1회 로그인).
- 설정: 주기, warning/critical(전체 소요 기준), headless 토글, base URL, 계정, Slack(기존 폼 재사용).

---

## 10. 구현 마일스톤 (각 단계 독립 검증 가능)

| # | 내용 | 검증 |
|---|---|---|
| **M0** | type 디스패치 테이블화 + `'browser'` 타입 추가(UI 無) | 기존 health/feature 정상 동작 |
| **M1** | spike: 보이는 `BrowserWindow`에서 1회 수동 로그인(`persist:monitor`) → 숨은 창으로 화면 1개 진입 확인. **세션이 앱 재시작 후에도 유지되는지** 검증 | **로그인/세션 영속 실현성(최대 리스크 먼저)** |
| **M2** | 테이블 3종 + `BrowserTrack` 주기 실행 + 결과 기록 | DB에 run/step 쌓임 |
| **M3** | run→level→Notifier(연속2회·Slack) | 실패 시 알람·Slack 도착 |
| **M4** | "브라우저" 탭(목록·히스토리·단계 타임라인·지금실행) | 화면에서 결과 확인 |
| **M5** | 세션 만료 감지 + "재로그인 필요" 분리 표시/알림 + 스샷 보관·retention + 설정 폼 | 만료 시 장애와 구분 표시, "로그인" 버튼으로 10초 복구 |
| **M6** | 크롬 번들/다운로드 + electron-builder(mac dmg / win nsis) | 패키징본에서 동작 |

> M1을 먼저 하는 이유: "Electron+Playwright 패키징"과 "운영 사이트 로그인 가능 여부"가 제일 불확실. 여기서 막히면 설계를 바꿔야 하므로 코드 많이 짜기 전에 뚫는다.

---

## 11. 리스크 / 함정
- ⚠️ **세션 만료를 장애로 오인**: 만료를 "사이트 죽음"으로 잘못 알람하면 헛경보 + 또 한밤 호출. → 만료는 `/login` 리다이렉트/401로 감지해 "**재로그인 필요**"로 분리(4.5). 재로그인은 알림 클릭 → 로그인 창 → 10초 자가 복구.
- 🚨 **운영(prod) 직격**: FE가 "운영" 선택. headless가 WAF/봇탐지에 막힐 수 있고, 개발 중 트래픽/애널리틱스 오염. → UA/IP allowlist, 개발은 스테이징에서.
- **Flaky(헛알람)**: 셀렉터/타이밍. → locator+auto-wait, 연속 2회 규칙, `data-testid` 사용 요청(`TODO(FE)`).
- **유지보수 전가**: FE가 UI 바꾸면 시나리오 깨짐. → **시나리오는 FE팀과 공동 소유**여야 함(안 그러면 결국 또 나한테 옴). `TODO(FE)` 합의 필수.
- **패키징 크기/난이도**: 크롬 바이너리. → 첫 실행 다운로드 전략.
- **봇 차단(WAF/Cloudflare)**: 운영 환경이 headless를 막을 수 있음. → User-Agent/세션 재사용, 필요시 IP/UA allowlist. `TODO(FE)`.
- **PII**: trace/스샷에 로그인 정보. → 로컬 보관·retention·마스킹.
- **부하**: 운영에 봇 트래픽. → 긴 간격(5~15분), 저권한 전용 계정.

---

## 12. 프론트팀과 합의할 결정
1. ✅ **시나리오**: "주요 화면 링크 → 정상 진입 확인"(스모크). → FE가 **화면 URL 목록** 제공. `TODO(FE)` 목록.
2. ⚠️ **환경**: **운영** 결정. → **WAF/봇 allowlist 필요 여부** 확인 + 개발은 스테이징 권장. `TODO(FE)` allowlist.
3. ✅ **계정/로그인**: 자동 로그인 안 함 → **사람이 1회 수동 로그인 + 세션 보존**(4.5). 개인 계정으로 v1 출발 OK. 단 **재로그인이 잦으면**(세션 수명 짧으면) 그때 전용 계정/장기 토큰을 백엔드에 요청. `TODO(FE)` 세션 수명 확인.
4. ✅ **주기 / 실패·지연 기준**: 기존 설정 페이지에서 사용자 조절(=재사용). 단 *화면당* vs *전체* 기준 정의 필요.
5. **알람 채널** (기존과 같은 Slack? 별도 채널?) `TODO(FE)`
6. 🔑 **시나리오 유지보수 책임 (본격 도입 → 선행 필수)** — FE 공동 소유 + UI에 `data-testid` 협조. **이 약속 없이 착수 금지**(없으면 "그들 모니터링 깨짐 → 또 너한테" 재발). `TODO(FE)` 글/티켓 확약.
7. type 네이밍 (`browser` / "브라우저 점검") 확정

---

## 13. 의존성 / 패키징 영향
- 추가: `playwright`(또는 `playwright-core` + 브라우저 다운로드).
- [package.json](../package.json) `build`: 사이드카 스크립트 `files`/`extraResources` 포함, `asarUnpack`에 playwright 관련 추가, `PLAYWRIGHT_BROWSERS_PATH`로 `userData` 지정.
- 플랫폼: 사용자는 Mac 1차·Windows 격리 방침([memory] 참고). Playwright는 크로스플랫폼이나 사이드카 spawn 경로/바이너리 경로는 OS별 분기 → Windows 특이사항은 `electron/windows/`에 격리.

## 14. 미해결 질문
- trace/스샷 보관 위치·용량 상한·자동삭제 정책?
- 동시 실행 정책(전역 1개 vs type 내 1개)?
- 기존 `feature`(느린 API) 트랙과의 관계 정리 — 통합 표시할지 분리할지?
