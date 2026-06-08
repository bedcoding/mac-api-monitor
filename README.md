# API Monitor

URL 목록을 주기적으로 fetch 해서 응답시간/상태를 모니터링하는 macOS 메뉴바 앱.
임계값 초과 시 Slack + macOS 네이티브 알림.

메뉴바 popover (컴팩트 모니터링) + 일반 메인 윈도우 ("전체 보기") 2단 UI.

---

## Quick Start

```bash
yarn install
yarn dev
```

> **native module 이슈**: `better-sqlite3` 가 native 모듈이라 Electron ABI 와 맞아야 함.
> `yarn install` 후 에러 나면 `npx electron-rebuild`.

빌드:
```bash
yarn build:mac    # .dmg → release/
```

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

## UI 구조

```
┌ 상위 탭: 조회 / 추가 / 로그 / 설정 / 슬랙 ┐
└ 하위 토글: 헬스체크 / 기능체크          ┘
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

- **SQLite**: `~/Library/Application Support/mac-api-monitor/mac-api-monitor.db`
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

## 메뉴바 아이콘 (macOS)

- 상태에 따라 텍스트 변경: 🟢 (전부 정상) / 🟡N (주의 N개) / 🔴N (심각 N개) / ⚪ (endpoint 0개)
- 좌클릭 → popover 열기/닫기
- 우클릭 → 컨텍스트 메뉴 (전체 보기 / DevTools / 종료)

윈도우 닫아도 메뉴바에 남아 측정 계속. 완전 종료는 우클릭 → 종료 또는 ⌘Q.
