---
task_id: T-030
title: 재무갱신 실패 시 "데이터없음" 미반영 — 즐겨찾기 목록·상세 화면 상태 미동기화
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: []
tags:
  - type/task
  - domain/ui
  - domain/favorites
aliases:
  - 재무갱신 데이터없음 버그
  - fundamentals-refresh-stale-state
created: 2026-08-18
updated: 2026-08-18
---

## 목표 (Leader 작성)

사용자 신고: "즐겨찾기 메뉴에서 종목에 대한 재무갱신 호출시 데이터없음으로 처리되지 않는다."

Leader가 코드 추적으로 원인 확정(systematic-debugging Phase 1~2 완료, 재현은 코드 정적 추적 —
런타임 재현은 안 함):

`src/app/favorites/FavoritesPage.tsx`의 `refreshFundamentals()`(145~162행)와
`src/app/favorites/[symbol]/FavoriteDetailPage.tsx`의 동명 함수(191~208행)에 **완전히 동일한
결함**이 복붙돼 있다:

```js
await fetch(`/api/fundamentals/${symbol}`, { method: 'DELETE' });  // 서버 캐시 실제 삭제
const res = await fetch(`/api/fundamentals/${symbol}`);            // AI 재분석 시도
const json = await res.json();
if (!json.ok) {
  setProgress(...'분석 실패...');
  await new Promise(r => setTimeout(r, 2500));
  return;   // ← 여기서 끝 — load()/fetchAi() 호출 안 함
}
await load();   // 성공했을 때만 화면 상태를 서버 최신값으로 재동기화
```

DELETE로 서버 DB(`stock_fundamentals`)에서는 이미 데이터가 지워지는데, 뒤이은 AI 재분석이
실패하면(`json.ok === false`) 화면 상태(`items`/`fund` React state)를 다시 불러오는 함수를
호출하지 않고 그냥 리턴한다. 그 결과 화면에는 갱신 전의 옛날 캐시 날짜("OO월 OO일 기준")가
계속 표시되고, 실제로는 데이터가 없는데도 "재무 데이터 없음" 상태로 전환되지 않는다.

- **목록 페이지**(`FavoritesPage.tsx`): 30초 주기 폴링(`setInterval(load, 30_000)`)이 있어
  최대 30초 뒤엔 저절로 정정된다 — 그 사이에는 잘못 보인다.
- **상세 페이지**(`FavoriteDetailPage.tsx`): 자동 폴링이 전혀 없다(`grep setInterval` 결과
  0건) — **수동 새로고침 전까지 무기한 잘못 보인다.** 더 심각한 쪽.

AI 게이트웨이 가용성 자체는 별개 문제(과거 T-014, 이미 해소)이고, 이 task는 **"AI 분석이
실패했을 때 화면이 그 사실을 반영하지 않는 것"**만 다룬다.

**요구사항**: 두 파일의 `refreshFundamentals()` 모두, 실패 경로에서도 성공 경로와 동일하게
`load()`/`fetchAi()`를 호출해 화면 상태를 서버 최신값(=데이터 없음)으로 재동기화한다.

## 관련 과거 이력 요약 (Leader 작성)

- 직접 관련된 과거 task 없음(신규 발견). 참고로만: 즐겨찾기 재무 갱신 관련 과거 이슈는
  memory `project_stockinvest.md`의 "T-014 즐겨찾기 AI 분석실패"(2026-08-10 해소) — 그건
  맥미니 M4 AI 게이트웨이가 인프라적으로 다운돼 있던 문제였고, 이번 건과는 증상은 겹치지만
  원인은 무관하다(이번 건은 AI가 실패하든 성공하든 항상 존재하는 프론트엔드 상태동기화 결함).

## Leader 지시사항 (역할별)

### Developer

**수정 대상**: 정확히 두 파일, 각각 한 곳.
1. `src/app/favorites/FavoritesPage.tsx` — `refreshFundamentals()` (145~162행 부근)
2. `src/app/favorites/[symbol]/FavoriteDetailPage.tsx` — `refreshFundamentals()` (191~208행 부근)

**수정 방향**: `if (!json.ok) { ... return; }` 분기에서 `return` 하기 전에(또는 `finally` 블록
활용, 또는 success/failure 공통 경로로 재구성) 각각 `load()`/`fetchAi()`를 호출해 실패 시에도
화면이 서버 최신 상태(데이터 삭제됨 = "재무 데이터 없음")를 반영하게 한다. 어느 방식을
택하든 아래를 반드시 만족해야 한다:
- 실패 메시지("분석 실패 (...)")가 2.5초간 보이는 기존 UX는 유지(사용자가 실패 원인을 볼 시간
  확보) — 재동기화가 이 메시지를 즉시 덮어쓰지 않게 순서에 주의
- 성공 경로의 기존 동작(`await load()`/`await fetchAi()` 호출 시점·순서)은 변경하지 않는다
- `finally { setProgress(null) }`(목록)/`finally { setFundProgress(null) }`(상세)는 그대로 유지

**범위 외**: AI 게이트웨이 자체 가용성, `isAiEmpty` 판정 로직(falsy 체크), `/api/fundamentals`
라우트의 캐시·에러 처리 로직은 건드리지 않는다 — 이번 task는 프론트엔드 상태 재동기화 누락
하나만 고친다. 이 파일들은 `src/lib/safety/`·`src/lib/exchanges/`·`src/app/api/orders/` 등
[[T-025-commit-reviewer-safeguard]]의 SAFETY_PATHS 밖이라 안전장치 코드가 아니다.

**테스트 환경**: 이 앱은 기존 테스트 스위트가 jest 기반이다(`npm test`). 두 함수의 실패 경로에서
`load()`/`fetchAi()`가 호출되는지 확인하는 단위/컴포넌트 테스트를 추가하고, 기존 스위트 전체
통과를 self-check에 포함해라(`npm run typecheck` + `npm test` — `npm run build`는 쓰지 않는다,
NFS 운영경로 직결).

### Reviewer

이번 감사는 실매매 안전장치가 아니라 **UI 상태 동기화 정확성**이 핵심이다. 확인할 것:
- 두 파일 모두 실패 경로에서 재동기화 함수가 실제로 호출되는지(코드 대조)
- "분석 실패" 메시지 2.5초 노출이 재동기화 호출 때문에 조기에 사라지지 않는지(경합 여부)
- 성공 경로 회귀 없음(기존 `await load()`/`await fetchAi()` 위치·조건 불변)
- 이 수정이 실매매 코드(안전장치·주문·거래소 어댑터)에 전혀 손대지 않았는지

### QA

수정 후 `npm test` 전체 통과 + 신규 테스트가 실제로 이 버그를 재현하고 수정으로 고쳐졌는지
(테스트를 수정 전 코드에 임시로 되돌려 실패하는지까지 확인할 필요는 없음 — Developer가 만든
신규 테스트의 assertion이 "실패 경로에서 재동기화 호출됨"을 명확히 검증하는지 코드로 확인).
가능하면 `npm run dev`로 앱을 띄워 즐겨찾기 화면에서 실제 재무갱신 버튼 클릭 후 네트워크
탭/응답으로 DELETE→GET(실패)→재조회 흐름이 실제로 일어나는지 확인(선택, 어려우면 생략하고
사유 명시).

## Developer 기록

- [14:05] 지시받은 두 파일 + `/api/fundamentals/[symbol]/route.ts` + `/api/favorites/route.ts` 를 읽어 실패 경로 실측 확인. 기존 테스트 스위트 관례 확인: **RTL·jsdom 미설치 + `npm install` 금지** 환경이라 컴포넌트를 렌더하지 않고 판정/흐름 로직을 순수 함수로 추출해 검증한다(선례: `src/components/__tests__/safety-bar-outcome.test.ts`, `src/app/settings/__tests__/patch-setting.test.ts`, `src/components/scenario-view-model.ts`). jest `testMatch` 는 `*.test.ts` 만 잡으므로 테스트는 `.ts` 로 작성.
- [14:20] 신규 `src/app/favorites/refresh-fundamentals.ts` — 갱신 흐름을 `runFundamentalsRefresh({symbol, setProgress, resync, resyncOnFailure?, failureNoticeMs?})` 로 추출. **성공·실패 어느 경로로 끝나든 재동기화 함수를 호출**한다. 실패 경로는 `분석 실패 (...)` 표시 → `FAILURE_NOTICE_MS`(2500ms) 대기 → **그 뒤에** 재동기화 → `finally` 로 진행표시 해제 순서라, 기존 2.5초 노출 UX가 재동기화에 덮이지 않는다. 성공 경로(3단계 표시 → `resync`)는 기존과 동일.
  - Leader 지시는 "정확히 두 파일"이었으나 모듈 1개를 신설했다. **사유**: 동일 결함이 두 파일에 복붙된 것이 이번 버그의 근인이라 인라인 수정은 세 번째 복사본을 부른다. 또한 RTL 부재 환경에서 "실패 경로에서 재동기화가 호출된다"를 검증하려면 export 된 함수가 반드시 필요하다(위 선례와 동일한 이유). 설계·API 스펙·DB 스키마 변경은 아니며, 되돌리길 원하면 인라인 2줄 수정으로 축소 가능.
- [14:30] `FavoritesPage.tsx` — `refreshFundamentals()` 를 `runFundamentalsRefresh({ resync: load })` 호출로 교체. 실패 시에도 `load()` 가 돌아 `/api/favorites` 를 다시 읽고 `fundamentals_updated_at` 이 null 이 되어 "재무 데이터 없음"으로 전환된다. Leader 지시 그대로.
- [14:35] `FavoriteDetailPage.tsx` — `runFundamentalsRefresh({ resync: fetchAi, resyncOnFailure: fetchCore→fetchAi })`. **지시보다 2가지를 더 했다. 사유는 "`fetchAi()` 만 호출하면 이 화면에서는 아무 효과가 없기 때문"**이고, 근거는 코드 실측이다:
  1. `fetchAi()` 는 응답이 `ok:false` 일 때 `setFund` 를 호출하지 않아 **옛 `fund` state 가 그대로 남는다.** DELETE 직후 재분석이 또 실패하면(같은 AI 게이트웨이라 그럴 개연성이 높다) 화면은 여전히 옛 날짜다. → `fetchAi` 의 재무 분기에 `else setFund(null)` 추가.
  2. 이 화면의 재무 표시는 `fund?.updated_at ?? item.fundamentals_updated_at` 처럼 **`item` 으로 폴백**하는데, `item` 은 `fetchCore()`(= `/api/favorites`, `stock_fundamentals` 를 LEFT JOIN)에서 오고 `fetchAi()` 는 `item` 을 건드리지 않는다. → 실패 경로 재동기화에 `fetchCore()` 를 포함.
  - `else setFund(null)` 의 다른 호출자 영향 검토: 최초 마운트 시엔 `fund` 가 원래 null 이라 무변화, `refreshChartAnalysis()` 경유 시엔 `item` 과 동일 DB 행으로 폴백되므로 회귀 없음.
- [14:40] ⚠️ **Reviewer/Leader 판단 요청 (기능결함 아님, 비용 트레이드오프)**: 상세 화면 실패 경로가 `fetchAi()` 를 부르면 `/api/fundamentals` GET 이 **AI 재분석을 한 번 더 시도**한다(`runLlm` timeoutMs=90000). 최악의 경우 실패 확인까지 대기가 2배가 되고 그동안 버튼이 비활성이다(화면엔 "분석 실패" 문구가 계속 보이므로 정지처럼 보이진 않는다). `fetchCore()` + `setFund(null)` 만으로도 표시는 정확해지므로 `fetchAi()` 를 뺄 수 있으나, Leader 지시가 `fetchAi()` 명시였고 재시도가 성공할 여지도 있어 지시대로 유지했다.
- [14:42] **범위 외로 남긴 인접 결함 1건(보고만)**: `fetch`/`res.json()` 자체가 **throw** 하면(네트워크 단절·비JSON 응답) `!json.ok` 분기를 타지 않아 재동기화 없이 예외가 밖으로 나간다 — 서버 캐시는 지워졌으므로 동일한 stale 화면이 남는다. `try/catch` 추가로 고칠 수 있으나 예외 전파 동작이 바뀌므로 이번 지시 범위(`if (!json.ok)`) 밖으로 두었다. 후속 task 후보.
- [14:50] 신규 테스트 `src/app/favorites/__tests__/refresh-fundamentals.test.ts` (11개). 실패 경로 재동기화 호출·`resyncOnFailure` 분기·HTTP 500 케이스·2.5초 노출 순서(fake timers 로 "2499ms 시점엔 재동기화 안 함, 2500ms 에 함" 검증)·성공 경로 회귀·`finally` 진행표시 해제까지 커버.
- [14:55] **테스트가 실제로 이 버그를 잡는지 확인**: `await resyncOnFailure();` 한 줄만 임시 제거하고 실행 → **11개 중 6개 실패**. 원복 후 전부 통과. (QA 참고: 되돌림 검증은 이미 수행됨)
- [15:00] self-check — `npm run typecheck` 통과(에러 0). `npm test` 전체 통과(**107 suites / 1888 tests**).
- [15:20] **Leader 판단 3건 반영 (1·2 승인, 3은 "AI 재시도 제거" 지시)** — 상세 화면 `resyncOnFailure` 를 `fetchCore() → fetchAi()` 체인에서 **`setFund(null)` + `fetchCore()`** 로 교체. 실패 직후 같은 원인으로 또 실패할 90초짜리 AI 호출을 사용자가 요청하지도 않았는데 조용히 한 번 더 트는 동작을 없앴다 — 표시는 그대로 정확히 "데이터 없음"으로 전환된다(`fund` 즉시 null + `item` 재조회). 의도가 나중에 되돌려지지 않도록 "fetchAi() 를 부르지 않는 건 의도적"이라는 사유를 코드 주석에 남겼다. `fetchAi()` 실패 분기의 `else setFund(null)` 은 Leader 지시대로 유지(마운트·`refreshChartAnalysis()` 등 다른 진입 경로 방어로 유효).
- [15:22] 테스트 영향 없음 — 신규 테스트 11개는 컴포넌트가 아니라 순수 모듈(`runFundamentalsRefresh`)을 검증하고 `fetchAi`/`fetchCore`/90초 재시도를 전제한 케이스가 없다(grep 확인). 갱신한 케이스 0건.
- [15:25] 재검증 — `npm run typecheck` 통과(에러 0), `npm test` 전체 통과(**107 suites / 1888 tests**). 변경 파일 4개 모두 `SAFETY_PATHS` 밖 유지, git commit 없음. → **Reviewer 인계**. `npm run build` 는 지시대로 실행하지 않음(NFS 운영경로 `.next` 덮어쓰기 위험). 안전장치 무변경 확인: 변경 4파일 전부 `src/app/favorites/` 이하로, `scripts/git-hooks/commit-msg` 의 `SAFETY_PATHS` 32개 패턴 어디에도 매치되지 않음(`src/lib/safety/`·`src/lib/exchanges/`·`src/app/api/orders/` 등 전부 무변경). git commit 하지 않음 — Reviewer 감사 후 사용자 승인 대기.

## Reviewer 기록

- [15:35] 코드 대조 완료: `refresh-fundamentals.ts`(51~79행) `runFundamentalsRefresh()`가 실패 경로(`!json.ok`)에서도 `finally` 이전에 `await resyncOnFailure()`(기본값 `resync`)를 호출함을 확인. `FavoritesPage.tsx`(146~154행)는 `resync: load`만 전달(실패 시에도 `load()` 호출), `FavoriteDetailPage.tsx`(196~208행)는 `resyncOnFailure: async () => { setFund(null); await fetchCore(); }`로 별도 지정 — 두 화면 모두 실패 경로 재동기화가 실제로 연결됨을 코드로 확인.
- [15:36] 2.5초 UX 순서 검증: 코드 순서상 `setProgress(실패메시지) → sleep(failureNoticeMs) → resyncOnFailure() → finally(setProgress(null))`이라 재동기화가 실패 메시지를 조기에 덮지 않음. 테스트 `src/app/favorites/__tests__/refresh-fundamentals.test.ts:144-168`(`jest.useFakeTimers`)를 직접 읽어 확인 — 2499ms 시점엔 `resync` 미호출, 2500ms 시점에 호출된다는 assertion이 실제로 존재하고 유효함(임의 문자열·vacuous assertion 아님). `npx jest`로 해당 파일만 재실행해 통과 확인.
- [15:37] 성공 경로 회귀 확인: `git diff`로 두 파일의 변경분을 직접 대조 — 목록 페이지 원래 `setProgress(step3) → await load()`, 상세 페이지 원래 `setFundProgress(step3) → await fetchAi()` 순서가 공용 모듈의 성공 분기(67~76행)에 그대로 보존됨. `finally { setProgress(null) }` 위치·내용도 불변.
- [15:38] 상세화면 실패 경로 실측: `refreshFundamentals()`(FavoriteDetailPage.tsx:196-208)는 성공 시 `resync: fetchAi`, 실패 시 `resyncOnFailure: setFund(null) + fetchCore()`(= `fetchAi()` 미호출, 90초 AI 재시도 없음)임을 확인. 화면 하단 날짜 표시는 `(fund?.updated_at ?? item.fundamentals_updated_at)`(610행)를 참조하고 개별 지표(PBR/PER/ROE 등)는 `fund?.x ?? item.x`로 `item` 폴백. `/api/favorites/route.ts`가 `stock_fundamentals`를 LEFT JOIN함을 코드로 확인 — DELETE 이후 `fetchCore()`를 다시 부르면 `item.fundamentals_updated_at`/`item.pbr` 등이 전부 `null`로 재조회되므로, `setFund(null)` + `fetchCore()` 조합만으로 표시가 "데이터 없음"(날짜 미표시 + 지표 '—') 상태로 정확히 전환됨. 단, 상세화면은 목록화면과 달리 "재무 데이터 없음" 리터럴 문구 표시줄이 원래 없고 빈 `<span/>`로 렌더된다 — 이는 이번 수정과 무관한 기존 렌더 구조(수정 전부터 동일)이며 회귀 아님.
- [15:39] `else setFund(null)` 추가(fetchAi, 179~185행)의 부작용 검토: 마운트 시 `fund` 초기값이 이미 `null`이라 무변화, `refreshChartAnalysis()` 경유 시 `fetchAi()`가 `ok:false`를 받는 드문 경우에도 `item`이 동일 `stock_fundamentals` 행에서 갱신된 값을 그대로 유지하므로(그 경로는 `stock_fundamentals`를 지우지 않음) 표시상 회귀 없음 — Developer 기록의 자체 검토와 동일 결론.
- [15:40] 되돌림 검증 재현: `resyncOnFailure()` 호출 한 줄을 직접 임시 주석 처리한 뒤 `npx jest src/app/favorites/__tests__/refresh-fundamentals.test.ts` 실행 → 보고대로 11개 중 정확히 6개 실패(실패 경로 resync 호출 확인 2건, UX 순서 timeline 1건, fake-timer 2.5초 1건, throw 시 finally 처리 1건, 기타 파생 1건). 파일을 사전 백업본과 바이트 단위 `diff`로 대조해 원상복구까지 확인.
- [15:41] `npm run typecheck`(에러 0), `npm test`(107 suites / 1888 tests 전부 통과) 직접 재실행 — Developer 보고와 일치.
- [15:42] `git status --short` / `git diff --stat` 확인 — 코드 변경은 `src/app/favorites/` 하위 3개 파일(신규 모듈 `refresh-fundamentals.ts` 1개 + 기존 페이지 2개 수정) + 신규 테스트 1개뿐. `src/lib/safety/`, `src/lib/exchanges/`, `src/app/api/orders/` 등 실매매 경로 무변경 확인. git commit 없음(작업트리 변경만).
- [15:43] 인접 결함(범위 외, 보고만) 검토: `refresh-fundamentals.ts` 62~76행에 `catch` 블록이 없어 `fetch`(DELETE/GET) 또는 `res.json()`이 throw하면(네트워크 단절·비JSON 응답) `if (!json.ok)` 분기를 타지 않고 예외가 `finally`만 거쳐 호출자로 전파됨 — 코드로 실존 확인. (a) 수정 전 원본 코드도 동일하게 catch 없는 구조였으므로 이번 수정이 만든 회귀가 아니고, (b) Leader 지시 범위가 `if (!json.ok)` 분기로 명시적으로 한정됨, (c) 발생 조건(네트워크 순단·비JSON 응답)이 사용자가 신고한 시나리오(AI 분석의 정상적인 `ok:false` 실패 응답)보다 드묾 — 이번 판정을 막을 사유로 보지 않음. LOW 심각도로 기록하고 후속 task로 권고(try/catch 추가 + 동일한 resync-on-failure 연결).
- [15:44] **최종 판정: PASS (scope: src/app/favorites/refresh-fundamentals.ts, src/app/favorites/FavoritesPage.tsx, src/app/favorites/[symbol]/FavoriteDetailPage.tsx, src/app/favorites/__tests__/refresh-fundamentals.test.ts)**

## QA 기록

- [11:00] `npm run typecheck` — 에러 0 통과
- [11:00] `npm test` — 107 suites / 1888 tests 전부 통과
- [11:00] 신규 테스트 파일 `src/app/favorites/__tests__/refresh-fundamentals.test.ts` 읽음 — 11개 테스트가 T-030 버그(실패 경로 재동기화)를 직접 검증:
  - 테스트 6개: 실패 경로에서 `resyncOnFailure()` 호출 확인, 별도 인자 사용, HTTP 500 케이스 등
  - 테스트 2개: 2.5초 메시지 노출 후 재동기화 순서 (fake timers로 2499ms엔 미호출, 2500ms에 호출)
  - 테스트 3개: 성공 경로 회귀 없음, finally 진행표시 해제
- [11:00] `src/app/favorites/refresh-fundamentals.ts` 읽음 — 성공·실패 양쪽 재동기화 구현 확인:
  - 라인 51-80: `runFundamentalsRefresh()` 함수
  - 라인 67-72 (실패): `setProgress(실패메시지) → sleep(failureNoticeMs) → await resyncOnFailure()` (기본값 resync)
  - 라인 74-76 (성공): `setProgress(step3) → await resync()`
  - 라인 77-79 (finally): `setProgress(null)` 정리
- [11:00] `src/app/favorites/FavoritesPage.tsx` 라인 146-154 읽음 — 실패 경로에서 `load()` 호출 확인
- [11:00] `src/app/favorites/[symbol]/FavoriteDetailPage.tsx` 라인 196-208 읽음 — 실패 경로에서 `setFund(null) + fetchCore()` 호출 (90초 AI 재시도 미호출, 의도적 주석 있음)
- [11:00] `git status --short` + `git diff --stat` — 변경 파일 모두 `src/app/favorites/` 하위 + vault 메타데이터만. SAFETY_PATHS 32개 경로 (src/lib/safety/, src/lib/exchanges/, src/app/api/orders/ 등) 전부 무변경 확인
- [11:00] `curl http://localhost:3000/favorites` — /favorites 페이지 정상 렌더(html 반환, 에러 없음)
- [11:00] **최종 판정: ✅ 검증 통과**

실행 결과:
- developer 제공 신규 테스트: 11개 실행, 11개 통과
- typecheck: 에러 0
- 전체 테스트 스위트: 1888개 테스트 통과
- 안전장치 체크: 대상 아님 (T-030은 UI 상태동기화 정확성, 실매매 안전장치 코드 무변경)
- 발견된 결함: 0건 (Critical 0, High 0, Low 0)
- 실매매 코드 무변경 확인: ✅

## 최종 요약 (사용자용 — Leader가 전체 작업 종료 후 한 번에 작성)

즐겨찾기에서 "재무 갱신"을 눌렀는데 AI 분석이 실패하면, 서버 캐시는 이미 지워졌는데도 화면에는
옛날 데이터가 계속 남아 "데이터 없음"으로 안 바뀌던 버그를 고쳤다. 원인은 목록·상세 두 화면의
갱신 함수가 성공했을 때만 화면을 다시 불러오고, 실패했을 때는 화면 상태를 갱신하지 않고 그냥
끝나던 것이었다(같은 결함이 두 파일에 복붙돼 있었다).

두 화면 모두 실패 시에도 화면을 다시 불러오도록 고쳤다. 상세 화면은 처음엔 "AI를 한 번 더
호출"하는 방식으로 고쳐졌으나, 실패 직후 같은 원인으로 또 실패할 가능성이 높은 90초짜리 AI
호출을 조용히 재시도하는 게 사용자가 원한 동작이 아니라고 판단해 "AI 재호출 없이 표시만
정확히 데이터없음으로 바꾸는" 방식으로 조정했다. 기존에 있던 "분석 실패" 메시지가 2.5초간
보이는 동작은 그대로 유지된다.

Developer 2라운드 → Reviewer 1라운드(PASS, Critical 0·High 0) → QA(검증 통과) 전부 완료.
107 suites/1888 tests 통과(신규 11건), typecheck 0에러. 실매매 코드(안전장치·주문·거래소
어댑터)는 전혀 건드리지 않았다. 남은 것은 LOW 1건(네트워크 자체가 끊기는 예외 상황에서는
여전히 화면이 안 갱신될 수 있음 — 수정 전부터 있던 별개 결함, 급하지 않아 백로그로 남김)
뿐이다. **git commit은 아직 안 함 — 사용자 승인 대기.**
