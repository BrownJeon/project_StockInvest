---
task_id: T-183
title: 거시 하락 게이트 작동 불능 수정 — 11월 급락일에 한 번도 발동하지 않은 신규 매수 차단 게이트(기준 시점·S&P 대용 심볼·시장별 판정·실패 기록)
status: done
waiting: [user_check_gate_alert_on_drop_day]
priority: high
project: StockInvest
created: 2026-11-20
updated: 2026-11-21
base_ref: 10e7f3321abc0884a2f10089da898cde3e34d0c1
risk_level: R2
roles_involved: [leader, judge, analyst, developer, reviewer, qa, deployer]
related_tasks: [T-164-macro-regime-fear-greed-review, T-165-macro-regime-label-c0, T-181-domestic-market-cap-ranking-params]
tags:
  - type/task
  - domain/strategy
  - domain/safety
aliases:
  - 거시 게이트 수정
  - regime gate fix
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·서버 worktree 커밋·PR 까지. PR 머지(=운영 배포)는 사용자 승인 후
  last_event_id: E8
demo_gate:
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "leader"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-183 거시 하락 게이트 작동 불능 수정

작업 worktree: 서버 `~/.node-local/stockinvest-t183`(detached, base `8d9e980` = origin/main, 2026-11-20 23:5x 생성, `node_modules` 는 운영 `current/node_modules` 심볼릭 링크 — package-lock 일치 확인). `src/lib/strategy/` 는 `SAFETY_PATHS` 라 커밋은 서버 worktree 에서 한다(Mac 커밋은 훅 무검사).

⚠ 같은 시각 다른 세션이 T-180(`~/.node-local/stockinvest-t180`, `src/lib/strategy/m40/**`)·T-181(`stockinvest-t181`, `src/lib/exchanges/kis-domestic.ts`·`src/lib/strategy/universe.ts`)·T-182 를 진행 중이다. 그 폴더·파일은 건드리지 않는다. 이 task 의 예상 변경 파일은 `src/lib/strategy/macro.ts`·`src/lib/strategy/engine.ts`(게이트 블록 1440~1500행 부근만)·시험 파일이다. **`engine.ts` 는 T-181 이 건드릴 수 있어 머지 순서·충돌을 PR 단계에서 확인한다.**

## 목표·배경 (Leader)

2026-11-20 메인 세션 의뢰로 analyst 가 11월 하락장(미국 11-05 나스닥 −5.5%·S&P −4.4%, 국내 11-05 −5.28%·11-06 −6.02%·11-20 −5.21%) 대응을 읽기 전용 분석했다. 그 결과 **"KOSPI·S&P500 대용이 전일 대비 −1.5% 이하면 신규 매수 차단"하는 거시 게이트가 11월에 한 번도 발동하지 않았다**(`eval_funnel` `regime_gate_macro_bear`·`regime_gate_macro_error` 11-02~11-20 0건).

목표: 게이트가 **설계 의도("지수가 전일 대비 크게 하락한 날 신규 매수 차단")대로** 판정하고, 판정 불가(시세 조회 실패)도 기록되게 한다. 이번 범위는 **게이트를 고치는 것**이며 임계값(−1.5%)·AND/OR 정책 변경은 analyst 설계 → 사용자 결정 사항이다.

⚠ 현재 운영은 `DRY_RUN=true`·킬스위치 발동(11-20 21:42 자동, 24h −10.2%)이고 전략 16개가 모두 `unvalidated` 라 신규 매수는 검증 관문에서 이미 0건이다. 이 수정은 **당장의 손익을 바꾸지 않는다** — 실매매를 다시 켤 때 하락장 매수 차단이 실제로 작동하게 하는 선행 조건이다.

### 확인한 사실 (analyst 분석 + Leader 재확인, 2026-11-20 22:4x~23:3x KST, 읽기 전용)

- [확실] `src/lib/strategy/macro.ts:22-23` — `KOSPI_PROXY='069500'`(KODEX 200), `SP500_PROXY='NYS:SPY'`.
- [확실] `macro.ts:27-35` `safeChange` — `(t.price − t.open24h)/t.open24h`. `open24h` 는 **당일 시가**(`kis-domestic.ts:113`·`kis-overseas.ts:146`, analyst 확인) → 주석·알림 문구의 "전일 대비"와 다르고 **갭 하락을 보지 못한다**. 예외는 `catch { return null }` 로 삼켜 기록이 없다.
- [확실] `engine.ts:1466` 단일 호출처. AND 조건(`engine.ts:1467-1472` 부근, analyst 인용) — 국내 장중엔 SPY 가 전날 미국 세션 값, 미국 장중엔 KODEX200 이 그날 마감 값이라 **시장 간 시차**가 있다.
- [가능성 높음] SPY 는 NYSE Arca 상장이라 KIS 해외 시세 거래소 코드가 `NYS` 가 아닐 수 있다(`daily_bars` 에는 `AMS:SPY` 로 존재 — analyst). 그렇다면 S&P 값은 늘 `null` → AND 불성립 → 게이트 영구 미발동. **실시세 1회 조회로 확인 필요(미확인).** api-usage 로그는 심볼을 남기지 않아 로그로는 가릴 수 없다(`overseas.get-ticker` 11-20 ok 381 / fail 10, 실패는 `status 500 err http`).
- [가능성 높음] 설계대로였다면 발동했어야 할 날: ET 11-05 미국 세션(유니버스 평균 전일 대비 −4.95%, 시가→종가 −4.52%). 갭 하락 위주였던 국내 11-06(갭 −6.92%·시가→종가 +3.37%)·11-20(갭 −3.31%·시가→종가 −0.89%)은 시가 기준이라 구조상 못 봤다. 수치는 지수가 아니라 DB 유니버스 평균 근사(지수 대용 일봉은 10-27 까지만 있음).

### 설계에서 정할 것 (analyst → 사용자 결정 필요분 표시)

1. 기준 시점: 전일 종가 대비(`prdy_ctrt` 류 응답 필드 또는 전일 종가 조회) — 응답 필드 존재·의미를 실측으로 확인.
2. S&P 대용 심볼 교정(`AMS:SPY`?) 또는 지수 직접 조회 가능 여부.
3. 판정 방식: 지금 AND(두 지수 모두) vs **시장별 독립**(국내 매수는 KOSPI, 해외 매수는 S&P) — 정책 변경이므로 **사용자 결정**.
4. 실패 처리: fail-open 유지(T-003 원칙 — 외부 장애가 매수 전면 차단하지 않게) + `regime_gate_macro_error` 기록·알림 스로틀.
5. 임계값 −1.5% 유지 여부 — 이번 범위 밖(유지), 바꾸려면 별도 결정.

### 실측 결과 (Leader, 2026-11-20 23:4x KST, 운영 KIS 읽기 전용 5회)

방법: 서버 `~/.node-local/t183-probe/probe.cjs`(저장소 밖, T-181 실측 스크립트와 같은 방식) — DB 의 기존 토큰을 읽기만(신규 발급 없음), 앱키는 운영 `.env` 에서 읽어 헤더로만 사용·출력 안 함, 주문·DB 쓰기 없음. 로그 `~/.node-local/t183-probe/probe-*.log`.

| 요청 | 결과 [확실] |
|---|---|
| `NYS:SPY` HHDFS00000300(현 `getTicker` 가 쓰는 API) | `rt_cd=0 정상처리` 인데 **모든 값이 빈 문자열** → `Number('')×fx = 0` → `safeChange` 의 `!t.price` 에 걸려 `null` |
| `NYS:SPY` HHDFS76200200(현재가상세) | 같은 현상 — 빈 값 |
| `AMS:SPY` HHDFS00000300 | `last 709.87 · base 715.87 · rate −0.84` — **`open` 필드 없음**(→ 해외 `getTicker` 의 `open24h` 는 `base`=전일 종가로 채워진다) |
| `AMS:SPY` HHDFS76200200 | `open 712.58 · base 715.87` 등 41 필드 |
| `069500` FHKST01010100(국내 `getTicker`) | `stck_prpr 76210 · stck_oprc 77370 · stck_sdpr 80630 · prdy_ctrt −5.48` |

- **원인 확정 ①** [확실]: S&P 대용 `NYS:SPY` 는 KIS 가 **오류 없이 빈 값을 돌려준다** → S&P 변화율이 늘 `null` → AND 조건이 **영원히 성립하지 않는다.** 게이트는 처음부터 한 번도 작동할 수 없었다(`macro.ts` 도입 이후 `NYS:SPY` 였다면 — 도입 시점 이력은 미확인).
- **원인 확정 ②** [확실]: 국내는 `open24h = stck_oprc`(당일 시가)라 오늘(11-20) KODEX200 이 **전일 대비 −5.48%** 인데 게이트 계산값은 `(76210−77370)/77370 = −1.50%` 다. 갭 하락분이 통째로 빠진다.
- [확실] 해외 쪽은 HHDFS00000300 에 `open` 이 없어 `base`(전일 종가)를 쓰므로, 심볼만 맞았다면 **이미 전일 대비**였다. 즉 두 시장의 기준이 서로 달랐다(국내 시가·해외 전일 종가). 다만 이건 `getTicker` 의 `open24h` 의미가 시장마다 다르다는 뜻이라, `open24h` 를 쓰는 다른 호출처가 있으면 영향 확인 필요(설계 단계).
- `daily_bars` 로 본 지난 1년(2025-10-27~2026-10-27) 전일 종가 대비 −1.5% 이하 일수 [확실 — DB 일봉 기준]: **KODEX200 57/245일(23%)** · AMS:SPY 10/252일(4%). 시가 대비로는 50일·3일. 같은 날 둘 다 −1.5% 이하는 4일(2026-03-26·06-05·06-10·07-29) — 단 같은 날짜 맞춤이라 실제 시차(국내 장중엔 전날 미국 값)는 반영 안 됨.
  - 함의: **시장별 독립 판정이면 국내 신규 매수가 연간 약 23% 의 날 막힌다.** AND 를 유지하면 1년에 몇 번 수준. 판정 방식은 차단 빈도와 직결되므로 사용자 결정으로 올린다.

## 사용자 지시·승인 (원문 보존)

- 2026-11-20 23:3x KST, 메인 세션 질문 「거시 게이트 결함 수정을 새 task 로 진행할까요?」에 대한 답: 「새 task 로 진행」
- 2026-11-20 23:5x KST, 판정 방식 질문(선택지: 시장별 독립 / AND 유지 / OR)에 대한 답: 「시장별 독립 (추천)」 — 국내 매수는 KOSPI 대용, 해외 매수는 S&P 대용 하락만 보고 막는다. 질문에 "국내 신규 매수가 연간 약 23% 의 날 막힌다"를 함께 제시했다.
- 2026-11-21 10:1x KST, 메인 세션 질문 「PR #10 을 머지해서 운영에 배포할까요?」(선택지: 머지 승인 / 나중에)에 대한 답: 「머지 승인」 — PR #10 머지(= main push = webhook blue/green 운영 배포)를 승인. 질문 직전 보고에 DRY_RUN·킬스위치가 켜진 상태라 즉시 손익 영향이 없다는 점, 미검증 항목(운영 cron 발동·알림, 장 시작 직후·휴장 다음 날 전일 종가 의미, 차단일 매도 실행)을 함께 제시했다.

## 설계 (Leader — Developer 구현 사양)

analyst 의 11월 분석(메인 세션 의뢰, 읽기 전용)과 위 실측을 근거로 Leader 가 확정. 임계값 −1.5% 는 그대로 둔다.

1. **전일 종가 노출** — `src/lib/exchanges/types.ts` `Ticker` 에 선택 필드 `prevClose?: number`(전일 종가, `price` 와 같은 통화 단위 — 해외는 KRW 환산) 추가.
   - `kis-domestic.ts` `getTicker` 반환에 `prevClose: Number(o.stck_sdpr)`(기준가=전일 종가). **`open24h` 의 의미는 바꾸지 않는다**(포트폴리오·즐겨찾기 화면이 쓴다 — 아래 범위 밖).
   - `kis-overseas.ts` `getTicker` 반환에 `prevClose: o.base ? Number(o.base) * fx : undefined`.
   - 값이 0·NaN·빈 문자열이면 `undefined`(0 을 넣지 않는다).
   - ⚠ `kis-domestic.ts` 는 T-181 이 `fetchMarketCapPage` 부근(약 511행)을 고친다. 이 task 는 `getTicker` 반환 객체(약 113행)만 건드려 hunk 가 겹치지 않게 한다.
2. **`macro.ts`**
   - `SP500_PROXY = 'AMS:SPY'`(실측: `NYS:SPY` 는 빈 값, `AMS:SPY` 정상).
   - 변화율 = `(price − prevClose)/prevClose×100`. `prevClose` 없으면 그 지수는 판정 불가.
   - `safeChange` 가 예외를 삼키지 않게: 결과를 `{ pct: number | null, error?: string }` 형태로 돌려 **실패 사유(예외 메시지·빈 값·prevClose 없음)** 를 호출자가 기록할 수 있게 한다. `MacroIndicators` 에 지수별 오류 필드 추가(기존 `kospiChangePct`·`sp500ChangePct`·`usdKrwChangePct` 이름은 유지).
   - 실패 결과는 캐시하지 않거나 짧게(성공 TTL 그대로, 실패는 캐시 안 함 — 일시 장애 뒤 다음 틱에 재시도).
3. **`engine.ts` 게이트 블록(약 1459~1491행)만** — 시장별 독립 판정:
   - `market==='domestic'` → `kospiChangePct ≤ −1.5` 이면 신규 매수 차단. `overseas` → `sp500ChangePct ≤ −1.5`.
   - 그 시장의 지수가 판정 불가면 **fail-open 유지** + `rec.error('regime_gate_macro_error', { detail: { index, reason, failOpen: true } })` 기록(지금은 예외 시에만 기록, 빈 값·null 은 무기록이었다).
   - 차단 알림은 `sendAlertThrottled` 로 **시장별 하루 1회** 수준(5분마다 반복 발송 금지). 문구는 "전일 종가 대비"로, 해당 시장 지수만 표기.
   - 차단 시 기존 `regimeGateBlocked` 흐름·`eval_funnel` 라벨(`regime_gate_macro_bear`)은 그대로 쓴다. 보유 종목 청산 경로에는 영향 없음(이미 앞에서 실행됨).
   - 주석의 "KOSPI 또는 S&P500"·"모두" 서술을 실제 동작에 맞게 고친다.
4. **시험** — `src/lib/strategy/__tests__/` 에 macro 단위 시험(전일 종가 기준 계산·`AMS:SPY` 사용·빈 값/0/예외 → null+사유·실패 미캐시)과 게이트 시험(국내만 하락 → 국내 매수 차단·해외 허용, 반대도, 판정 불가 → fail-open + error 기록, 알림 스로틀). 기존 엔진 시험이 `fetchMacroIndicators` 를 mock 하므로 형태 변경에 맞춰 함께 갱신.

**범위 밖(보고만)**: `open24h` 가 국내=당일 시가·해외=전일 종가로 의미가 달라 포트폴리오 `change_24h`·즐겨찾기 등락률도 시장마다 기준이 다르다(`src/app/api/portfolio/route.ts:165`·`src/app/api/favorites/route.ts:56`). 화면 수치 변경이라 별건.

## Analyst

## Developer

- [23:06] 실행 도구 claude(developer 서브에이전트). 작업 위치 서버 worktree `~/.node-local/stockinvest-t183`(base `8d9e980`), Mac scratch 미러에서 편집 후 반영. **커밋·push·PR 안 함**, 실 KIS 호출·DB 쓰기·설정 변경 없음.
- [23:06] 설계 1 — `src/lib/exchanges/types.ts` `Ticker.prevClose?: number` 추가(주석: `open24h` 와 의미가 다름을 명시). `kis-domestic.ts` `getTicker` 반환에 `prevClose: Number(o.stck_sdpr) > 0 ? Number(o.stck_sdpr) : undefined`, `kis-overseas.ts` `getTicker` 반환에 `prevClose: Number(o.base) > 0 ? Number(o.base) * fx : undefined` — 두 파일 모두 반환 객체에 2줄만 추가(국내는 113행 부근, T-181 의 `fetchMarketCapPage` 부근과 겹치지 않음). `open24h` 는 그대로.
- [23:06] 설계 2 — `src/lib/strategy/macro.ts`: `SP500_PROXY='AMS:SPY'`, 변화율 = `(price − prevClose)/prevClose×100`. `safeChange` 는 예외를 삼키지 않고 `{ pct, error? }` 반환 — 사유 코드 `price_unavailable`(현재가 빈 값·0·NaN) · `prev_close_unavailable` · `ticker_error: <메시지>`(200자 상한). `MacroIndicators` 에 선택 필드 `kospiError`·`sp500Error` 추가(기존 3개 필드 이름 유지). 캐시는 **지수별**로 바꿔 성공만 5분 캐시하고 실패는 캐시하지 않는다(한쪽 실패가 다른 쪽 재조회를 부르지 않게 — KIS 호출 최소화).
- [23:06] 설계 3 — `src/lib/strategy/engine.ts` 거시 게이트 블록(1511~1556행)만 교체: 국내 평가는 `kospiChangePct`, 해외 평가는 `sp500ChangePct` 만 보고 `≤ −1.5` 이면 차단. 그 시장 지수가 판정 불가면 fail-open + `rec.error('regime_gate_macro_error', { detail: { index: 'kospi'|'sp500', reason, failOpen: true } })`(사유 없으면 `reason: 'unavailable'`). `fetchMacroIndicators` 가 예상 밖으로 던져도 같은 형태로 기록. 차단 알림은 `sendAlertThrottled`(키 `regime_gate_macro_bear:<market>:<현지 날짜>`, TTL 24h — 국내 KST 날짜·해외 ET 날짜) → 시장별·현지 날짜별 1회. 문구 "전일 종가 대비", 그 시장 지수만 표기. `regimeGateBlocked` 흐름·`regime_gate_macro_bear` 라벨·청산 경로는 그대로. 주석의 "KOSPI 또는 S&P500"·"모두" 서술을 실제 동작으로 고침.
- [23:06] 설계 대비 차이(작음, 의미 변화 없음): ① 해외 `prevClose` 조건을 `o.base ? … : undefined` 대신 `Number(o.base) > 0 ? …` 로 써서 "0·NaN·빈 문자열이면 undefined" 규칙을 한 식으로 충족 ② `KOSPI_PROXY`·`SP500_PROXY` 를 시험용으로 export ③ USD/KRW 값도 성공만 캐시(종전에는 null 포함 묶음 캐시 — 게이트는 이 값을 쓰지 않음) ④ `regime_gate_macro_error` detail 키가 종전 `{ error, failOpen }` → `{ index, reason, failOpen }`(설계 문구대로) — `src/` 에 이 detail 을 읽는 코드는 0건(grep 확인), 과거 DB 행은 `error` 키로 남아 있음 ⑤ 알림 스로틀을 "하루 1회"를 현지 날짜 키로 구현(24h 고정 창이면 전날 늦게 울린 뒤 다음 날 이른 급락이 묻히고, 해외 세션은 KST 자정을 넘기 때문).
- [23:06] 설계 4 시험 — 신규 3개: `src/lib/strategy/__tests__/macro-t183.test.ts`(17: AMS:SPY 사용·실측 값으로 −5.48%/−0.84%·open24h 무시·빈 값/0/NaN/예외 → null+사유·실패 미캐시/성공 5분 캐시·USD/KRW 종전 동작) · `src/lib/strategy/__tests__/engine-regime-gate-t183.test.ts`(18: 국내만 하락→국내 차단·해외 허용과 반대, 경계 −1.5 차단/−1.49 허용, 판정 불가 fail-open+error 기록·다른 시장 지수 실패는 미기록, 실제 스로틀 모듈로 같은 날 4틱 알림 1회·시장별 별도·KST 날짜 변경 시 재알림·ET 같은 날 1회) · `src/lib/exchanges/__tests__/kis-ticker-prev-close-t183.test.ts`(12: 국내 stck_sdpr·해외 base×FX, 빈 값/0/숫자 아님 → undefined, open24h 불변, NYS:SPY 실측 모양). 갱신 1개: `src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts` 의 차단 알림 단정 2줄을 `sendAlert` → `sendAlertThrottled`(제목 인자 2번)로. 다른 엔진 시험의 `fetchMacroIndicators` mock 은 새 필드가 선택이라 수정 불필요.
- [23:06] 변이 확인: `engine.ts` 만 base 로 되돌리고 새 게이트 시험 실행 → 18건 중 12건 실패(옛 AND·무기록·비스로틀을 잡음) → 복원. 로그 `~/.node-local/t183-logs/mutation-old-engine.log`.
- [23:06] 시험 결과(모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 로그 `~/.node-local/t183-logs/`): ① `jest src/lib/strategy src/lib/exchanges` — base 3285 통과·1 실패·106 skip(`base-jest.log`) → 변경 후 **3332 통과·1 실패·106 skip**(`after-jest.log`). 실패 1건은 base 와 같은 `records/__tests__/job-slots.test.ts` E11(이 task 와 무관). ② 신규·갱신 4파일 91/91 통과(`new-tests-1.log`). ③ 범위 밖 관련(`src/lib/signals`·`src/lib/safety`·`profit-engine/isolation`·`data/kis-fundamentals-snapshot`·`cron/overseas-universe-refresh`) 2448 통과·3 실패 — 실패 3건은 `profit-engine/__tests__/isolation.test.ts`(지목 파일 `daily-bars-store.ts`·`analysis-data`·`m40` 은 이 diff 밖), base 로 되돌려 같은 3건 실패 확인(`base-isolation.log`). ④ `npx tsc --noEmit` base·변경 후 모두 exit 0. ⑤ lint: 저장소에 ESLint 설정 파일이 없어 `eslint` 직접 실행이 설정 없음으로 종료 — **미실행**.
- [23:06] 미검증: 실 KIS 응답으로 새 코드 경로를 돌려보지 않음(실측은 Leader 프로브 값만 시험 고정값으로 사용). 장 시작 전·장 마감 후·미국 휴장일에 `stck_sdpr`·`base` 가 어느 날의 종가인지(=그 시각 게이트 값이 0% 인지 직전 세션 변화율인지) 미확인. 운영 cron 에서의 실제 발동·알림 미확인(DRY_RUN·킬스위치 상태라 매수 경로 자체가 막혀 있음).
- [23:06] Reviewer 가 볼 지점: ① 시장별 독립으로 **국내 신규 매수가 연간 약 23% 날 막힘**(사용자 승인 사항 — 의도대로인지) ② fail-open 유지 — 지수 판정 불가 시 차단하지 않음(T-003 원칙) ③ 지수별 캐시: 한쪽이 계속 실패하면 그쪽만 매 틱 재조회(KIS 호출 시장당 틱마다 1건 증가 수준) ④ 알림 스로틀 키에 날짜가 들어가 `lastSentAt` Map 에 하루 최대 2키씩 쌓임(프로세스 재시작 시 초기화 — throttle.ts 설계상 허용 범위로 판단) ⑤ `toLocaleDateString('en-CA', { timeZone })` 의존 — `market-hours.ts` 가 이미 같은 ICU 시간대 기능을 씀 ⑥ `regime_gate_macro_error` detail 키 변경(`error`→`reason`+`index`) ⑦ `engine.ts` 는 T-181 이 다른 세션에서 만질 수 있어 PR 단계 충돌 확인 필요(이 diff 는 게이트 블록 hunk 하나) ⑧ `src/lib/exchanges/`·`src/lib/strategy/` 는 `SAFETY_PATHS` — 커밋 시 Reviewer 판정 scope 에 이 diff 의 9개 경로가 모두 들어가야 함.
- [23:41] 라운드 2(Codex C2 지적 2건, Reviewer [23:40] 채택·최소 수정안 그대로). 실행 도구 claude(developer 서브에이전트). 편집은 **서버 worktree 에서 직접**(python 치환 스크립트를 ssh stdin 으로 실행 — Mac 복사 없음). 커밋·push·실 KIS 호출·DB 쓰기 없음, `notify/throttle.ts`·`safety/confirmed-alert.ts` 수정 없음. 시작 전 `confirmed-alert.ts` 실물 확인: `sendAlertUntilDelivered(key, level, title, body, suppressMs, now?)` — 한 채널이라도 전달(`delivered.length > 0`)된 뒤에만 `suppressMs` 억제, 실패·예외면 억제 안 함, 결과를 기다리지 않음(in-flight 10분), seam `__setConfirmedAlertDispatchForTest`·`resetConfirmedAlerts` — 사양과 일치해 그대로 진행.
- [23:41] 지적 1 수정 — `macro.ts` `safeChange` 반환을 `Math.round(pct × 1e6) / 1e6`(상수 `PCT_ROUND = 1e6`)로 반올림. 게이트의 `<= -1.5` 비교는 그대로. 주석에 이유(환산 후 계산이라 `-1.4999999999999927`) 기록. 시험 `macro-t183.test.ts`: 새 describe 「경계 −1.5%」 — 어댑터와 같은 식(`Number('689.50')*1332.1`·`Number('700.00')*1332.1`)으로 `sp500ChangePct === -1.5`(반올림 전 값이 −1.5 가 아님도 전제로 단언), 바로 위 `689.57` → `-1.49` 허용 유지, 국내 정수 쌍 `80600→79391 = -1.5 차단`·`80600→79392 = -1.498759 허용`. 기존 단언 2개를 반올림에 맞춤(국내 `toBe(round6(...))`, 해외 `toBeCloseTo(..., 6)`).
- [23:41] 지적 2 수정 — `engine.ts` 게이트 블록만 `sendAlertThrottled(...)` → `sendAlertUntilDelivered(...)`(import `@/lib/safety/confirmed-alert` 1줄 추가). 키 `regime_gate_macro_bear:${market}:${localDate}`·24h·KST/ET 현지 날짜·문구 그대로, 호출부는 기다리지 않음. 다른 경보의 `sendAlertThrottled` 사용은 그대로. 시험 `engine-regime-gate-t183.test.ts` ⑤ 를 실제 confirmed-alert + seam(`dispatch` 모의) 기반으로 교체: ① 전달 성공 시 4틱 1회(+ 공용 스로틀 경로로는 0회) ② 첫 틱 `delivered: []` → 2틱 재전송 → 3·4틱 억제(`[1,2,2,2]`, 매 틱 차단 유지) ③ 전송 예외도 억제 안 함 ④ 전송이 끝나지 않아도(pending) 그 틱 차단 적용·다음 틱 겹쳐 보내지 않음 ⑤ 시장별 별도 ⑥ KST 같은 날 억제·다음 날 재알림 ⑦ ET 같은 날 1회·다음 ET 날짜 재알림. 추가 ⑦ describe — fetchMacroIndicators 모의를 스위치로 **실제 macro 모듈**(그 아래 `kis.getTicker` 모의, `fx.getUsdKrwRate` 만 1332.1 로 모의)로 돌려 「689.50/700.00·1332.1 → −1.5 → 해외 매수 전부 `regime_gate_macro_bear`·시그널 0·알림 본문 `-1.50%`」를 한 번에 확인(Reviewer L-3 의 단위 합성 부분 충족). `engine-invariant.test.ts`: `@/lib/safety/confirmed-alert` 를 jest.fn 으로 모의(바이트 비교 대상 observable 에 호출 추가 — 실제 모듈이면 변형 간 억제 상태가 달라져 비교가 깨지므로 모의), 발동 장면 단언을 `sendAlertUntilDelivered` 로 옮기고 공용 스로틀로는 안 나감을 함께 단언.
- [23:41] 변이 확인(파일을 `cp -p` 로 보관 후 되돌리고 원복, `cmp` 일치·권한 755 확인): 반올림 제거 → 5건 실패(해외 경계·⑦ 통합·−1.49/−1.498759 정확값·국내 −5.48 정확값). 국내 정수 경계 쌍 `79391` 은 반올림 없이도 정확히 −1.5 라 통과 — 정수 가격은 원래 오차가 없어 이 단언은 결함 검출이 아니라 회귀 방지용이다. 알림을 `sendAlertThrottled` 로 되돌림 → 11건 실패(⑤ 7건 전부·①②의 알림 단언·⑦·invariant 발동 장면). 로그 `~/.node-local/t183-logs/r2-mutation-no-round.log`·`r2-mutation-throttle.log`.
- [23:41] 시험 결과(모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 로그 `~/.node-local/t183-logs/r2-*`): ① 바뀐 시험 3파일 + `kis-ticker-prev-close-t183` = 4 suites **99/99 통과**(종전 91 + 8) `r2-changed-tests.log` ② `jest src/lib/strategy src/lib/exchanges src/lib/safety` — **4450 통과·1 실패·121 skip**(suites 177 통과·1 실패·3 skip) `r2-jest.log`. 실패 1건은 `records/__tests__/job-slots.test.ts` E11 로 base 로그(`base-jest.log`)의 실패와 같은 시험명 — 이 task 와 무관 ③ `npx tsc --noEmit` exit 0 `r2-tsc.log` ④ lint: ESLint 설정 없음 — 미실행(종전과 같음).
- [23:41] 범위·권한 — `git diff --summary` **0줄**(권한 변경 없음, `macro.ts`·`engine.ts` 755 유지). 라운드 2 변경 파일은 허용 5개뿐(수정 전 사본 `~/.node-local/t183-logs/r2-before/` 대비): `macro.ts` +9/−1 · `engine.ts` +5/−1 · `macro-t183.test.ts` +51/−2 · `engine-regime-gate-t183.test.ts` +116/−9 · `engine-invariant.test.ts` +8/−2. 누적 `git diff --stat`(base 대비, 추적 파일): 6 files, +136/−44(`kis-domestic.ts` 2 · `kis-overseas.ts` 2 · `types.ts` 6 · `engine.ts` 62 · `engine-invariant.test.ts` 11 · `macro.ts` 97) + 신규 시험 3개(untracked) — Reviewer scope 9개 경로와 같다.
- [23:41] 남은 위험·관찰: ① 반올림은 경계 ±5e-7 안의 값을 −1.5 로 끌어당긴다(예: −1.4999996 → −1.5 차단) — 사양대로이며 호가 단위상 실영향은 경계 쌍뿐 ② 게이트 알림은 전 채널이 계속 죽어 있으면 5분마다 재시도·`[confirmed-alert] … 전달 실패` 로그(Reviewer 수용 범위) ③ `regimeGateBlocked = true` 는 알림 호출 뒤 줄이다 — `sendAlertUntilDelivered` 는 동기 예외를 내지 않는 구조(전송 예외는 내부 catch)라 종전과 같은 순서로 두었다(설계 변경 회피) ④ 실 KIS·운영 cron 경로 미검증은 라운드 1 과 같다. 다음: Reviewer 수정 부분 재검증 → QA 수정 지점 확인.
- [23:53] 라운드 3(새 base `774bef6` 병합 후속, 실행 도구 claude — developer 서브에이전트). 증상: T-181 시험 `kis-domestic-t181.test.ts:104` 「두 필드가 아예 없으면 두 키 모두 없다」 실패. 직접 원인: T-183 이 `getTicker` 반환에 `prevClose: … : undefined` 로 **키를 늘 실어** 기준가가 없어도 `Object.keys` 에 `prevClose` 가 들어갔다. 수정(서버 worktree 에서 python 정확 치환, Mac 복사 없음): `kis-domestic.ts` → `...(Number(o.stck_sdpr) > 0 ? { prevClose: Number(o.stck_sdpr) } : {})`, `kis-overseas.ts` → `...(Number(o.base) > 0 ? { prevClose: Number(o.base) * fx } : {})` — T-181 과 같은 조건부 spread, 의미(빈 값·0·NaN → 없음)는 같다. 각 +3/−2(주석 1줄 추가). T-181 시험 수정 없음. T-183 시험 3개는 이미 `toBeUndefined`(값 기준)라 수정 불필요 — 변경 없음. `types.ts` 의 `prevClose?: number` 선택 필드라 타입 변경 없음.
- [23:53] 시험(`flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 로그 `~/.node-local/t183-logs/r3-*`): ① `jest src/lib/strategy src/lib/exchanges src/lib/signals src/lib/safety` — **5690 통과·1 실패·138 skip**(suites 209 통과·1 실패·4 skip) `r3-jest.log`. 병합 직후(`rebase/jest.log`) 2 실패 → 1 실패: T-181 :104 통과로 바뀜. 남은 1건 `records/__tests__/job-slots.test.ts` E11 ② base 대조: 별도 worktree `~/.node-local/stockinvest-t183base2`(`774bef6` detach, node_modules 링크)에서 그 파일만 실행 — **같은 E11 1건 실패**(1 failed·18 passed) `r3-base-job-slots.log` → base 기존 실패, 이 task 무관. 확인 뒤 링크 제거·`worktree remove` 완료(목록에 없음 확인) ③ `npx tsc --noEmit` exit 0, 출력 0줄 `r3-tsc.log` ④ lint: ESLint 설정 없음 — 미실행(종전과 같음).
- [23:53] 범위·권한: 라운드 3 변경 파일은 `kis-domestic.ts`·`kis-overseas.ts` 2개뿐(허용 범위 안). `git diff --summary` **0줄**(두 파일 권한 775 — 수정 전후 `stat` 동일). 누적 `git diff --stat`: 6 files, +138/−44(`kis-domestic.ts` 3 · `kis-overseas.ts` 3, 나머지 라운드 2 와 같음) + 신규 시험 3개(untracked). 커밋·push·실 KIS 호출·DB 쓰기 없음. 남은 위험: 반환에서 키가 빠지는 것만 바뀌었고 소비처(`macro.ts`)는 이미 `undefined` 를 `prev_close_unavailable` 로 처리 — 동작 변화 없음(시험으로 확인). 다음: Reviewer 수정 부분 재검증 → QA 수정 지점 확인.

## Reviewer

- [23:15] 실행 도구 claude(reviewer 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t183`(base `8d9e980`)의 diff 와 신규 시험 3개를 읽기 전용으로 감사. 코드 수정·커밋·실 KIS 호출·DB 쓰기 없음. 같은 시각 T-181 worktree 는 열지 않음.
- [23:15] 의도 검증 — 설계 1~4 충족. (a) 영구 미발동 경로: `NYS:SPY`→`AMS:SPY` 교정, 기준을 `open24h`→`prevClose`(국내 `stck_sdpr`·해외 `base`)로 바꿔 갭 하락이 반영됨. 시장별 독립 판정이라 AND 불성립 경로는 사라짐. 남은 미발동 경로는 의도된 fail-open(지수 판정 불가) 뿐이며 이제 사유와 함께 `regime_gate_macro_error` 로 남는다. (b) 오발동 경로: 가격 0·빈 값·NaN → `price_unavailable`, 전일 종가 없음/0 → `prev_close_unavailable`, 예외 → `ticker_error` 로 모두 null(허용) 처리되고 0 을 차단으로 읽는 경로는 없음. 해외는 현재가·전일 종가에 같은 `fx` 를 곱해 환율 값(조회 실패 시 1 대체 포함)이 변화율에서 약분됨. 해외 개장 판정이 정규장(09:30~16:00 ET)만이라 프리마켓 값으로 인한 오판 없음. (c) 청산 영향 없음 — `regimeGateBlocked` 는 `buyBlocked` 로 매수 후보만 제거하고(`engine.ts` 1686 부근) 매도 후보·보유 종목 경로는 그대로.
- [23:15] 안전장치 우회 — `submitOrder`·킬스위치·주문 한도·DRY_RUN 코드와 접점 없음(diff 가 거래소 시세 조회 반환 객체·거시 지표·게이트 블록·시험뿐). `Ticker.prevClose` 는 선택 필드 추가라 기존 생성처·모의에 영향 없고 `open24h` 값·의미는 그대로(국내=당일 시가, 해외=`open`, 없으면 `base`). `open24h` 사용처(포트폴리오·즐겨찾기·대시보드)는 변경 없음. 판정 방식 변경(시장별 독립)으로 국내 매수가 전일 종가 대비 −1.5% 이하인 날 전부 차단되는 것은 사용자가 승인한 정책(연 약 23%).
- [23:15] 장 경계 — 국내는 평일 09:00~15:30 안에서만 평가돼 `stck_sdpr` 가 전일 종가인 구간, 해외는 정규장에서만 평가되고 알림 키가 ET 날짜라 KST 자정을 넘는 세션도 같은 키로 하루 1회. 휴장일은 `isHoliday` 가 평가 자체를 막음. 장 시작 직후 `price=0` 이면 fail-open 이며 기록됨. 실 응답에서 `stck_sdpr`·`base` 가 각 시각에 어느 날 종가인지는 코드만으로 판단 불가 — 미확인(developer 미검증과 동일).
- [23:15] 시험 재실행(서버, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`) — 신규·갱신 4파일(`macro-t183`·`engine-regime-gate-t183`·`kis-ticker-prev-close-t183`·`engine-invariant`) 91/91 통과. `jest src/lib/strategy src/lib/exchanges` 전체: 3332 통과·1 실패·106 skip — 실패 1건은 `records/__tests__/job-slots.test.ts`(이 diff 와 무관, developer 가 base 에서 같은 실패 확인한 것과 일치). `npx tsc --noEmit` exit 0. 구현을 base 로 되돌리는 변이 확인은 직접 재실행하지 않음(worktree 수정 금지) — 시험 설명·단언(옛 AND 가 못 잡는 「S&P 만 하락 → 국내 허용」「KOSPI 만 하락 → 국내 차단」, 스로틀 4틱 1회)이 옛 동작과 구분되는 것은 코드로 확인.
- [23:15] 결함 M-1(MEDIUM, 커밋 전 정리) — 변경 5개 파일(`kis-domestic.ts`·`kis-overseas.ts`·`types.ts`·`engine.ts`·`macro.ts`)의 파일 권한이 `100755`→`100644` 로 바뀌어 있다(`git diff` 의 `old mode 100755 / new mode 100644`, `core.fileMode=true`). Mac 편집본 복사 부산물로 보이며 그대로 커밋하면 권한 변경이 섞인 커밋이 되고 T-181(`kis-domestic.ts`)과의 머지에서 불필요한 충돌·소음을 만든다. 권고: 서버에서 5개 파일을 `chmod 755` 로 복원 후 `git diff --stat` 로 모드 변경이 사라졌는지 확인.
- [23:15] 관찰 L-1(LOW) — `fetchMacroIndicators` 가 시장과 무관하게 두 지수를 함께 조회하므로, 국내 회차에도 SPY 를, 해외 회차에도 KODEX200 을 부른다. 다른 시장 쪽이 계속 실패하면(예: 해외 회차의 국내 휴장일 조회) 실패가 캐시되지 않아 매 틱 추가 KIS 호출이 1건씩 생긴다(기록은 하지 않음 — 의도). 기존에도 두 지수를 모두 불렀으므로 악화는 아님. 필요하면 시장 인자를 받아 해당 지수만 조회하도록 후속 정리.
- [23:15] 관찰 L-2(LOW) — `regime_gate_macro_error` detail 키가 `{error,failOpen}`→`{index,reason,failOpen}` 로 바뀌었다. `src/` 에 이 키를 읽는 코드는 없음을 grep 으로 확인(`eval-funnel-labels.ts` 는 라벨만 사용). 과거 행과 키가 다르다는 점만 운영 조회 시 유의. 관찰 L-3(LOW) — macro→engine 실연결(실제 `kis.getTicker` 응답→`kospiError` 전달→게이트)을 한 번에 도는 시험은 없고 각 단이 따로 시험된다. 통합 오배선은 `engine-invariant` 등이 `fetchMacroIndicators` 를 모의하므로 PR 전 QA 가 실 응답 1회(읽기 전용) 또는 단위 합성으로 한 번 확인하는 것을 권한다.
- [23:15] 충돌 평가 — T-181 은 `kis-domestic.ts` 의 `fetchMarketCapPage`(약 511행) 부근, 이 변경은 `getTicker` 반환 객체(약 113~119행)라 hunk 가 떨어져 있어 내용 충돌 가능성은 낮다(M-1 의 권한 변경이 정리되면 더 낮아짐). `engine.ts` 는 게이트 블록 hunk 1개라 T-181 이 건드릴 때만 확인하면 된다. `universe.ts` 는 이 diff 와 겹치지 않음.
- [23:15] QA 에 넘길 high_risk_areas — `src/lib/strategy/engine.ts` 1511~1556(게이트 블록·시장별 지수 선택·스로틀 키), `src/lib/strategy/macro.ts`(`safeChange` 사유 분기·지수별 캐시), `src/lib/exchanges/kis-overseas.ts` 152행·`kis-domestic.ts` 119행(`prevClose` 실 응답 값). 결함 요약: critical 0 · high 0 · medium 1(M-1) · low 3.
- [23:40] Codex C2 지적 검토(읽기 전용, 서버 worktree 직접 재현·코드 확인, 수정·커밋·push 없음). 실행 도구 claude(reviewer 서브에이전트).
- [23:40] 지적 1(macro.ts:57 부동소수 경계) — 채택. 재현: `price=689.5×1332.1`, `prev=700×1332.1` 이면 `((p−prev)/prev)×100 = −1.4999999999999927`(환산 전 USD 비율은 정확히 −1.5). 환산 후에 계산하므로 환율 곱이 비율에 반올림 잡음을 남긴다(앞선 내 판단 「환율이 약분된다」는 수학적으로는 맞고 부동소수로는 틀렸다 — 정정). 합성 12쌍 중 3쌍이 경계에서 허용으로 뒤집힘. 실영향은 정확히 호가 단위 경계에서만이라 빈도는 낮지만, 수용 기준 「−1.5% 이하 차단」과 신규 경계 시험(`macro` 반환값에 −1.5 를 직접 주입)이 이 오차를 못 잡는다. 판정: 이번 task 범위 안(macro.ts 의 이번 변경분)이고 수정 비용이 한 줄이라 지금 고친다.
- [23:40] 지적 1 최소 수정안 — `src/lib/strategy/macro.ts` `safeChange` 의 반환을 소수 6자리로 반올림: `pct: Math.round(((t.price - prev) / prev) * 100 * 1e6) / 1e6`(−1.4999999999999927 → −1.5, 국내 정수 가격도 같은 경로로 보호). 게이트 비교(`engine.ts` `<= -1.5`)는 그대로. 시험 추가: `macro-t183.test.ts` 에 `kis.getTicker` 를 모의해 `price=689.5×1332.1`·`prevClose=700×1332.1` 을 넣고 `sp500ChangePct === -1.5` 단언(+ 엔진 게이트 시험은 이 값으로 차단 확인). 대안(게이트 쪽 `<= -1.5 + 1e-9`)은 macro 값이 `ai-filter` 등 다른 소비처에도 가므로 한 곳(macro)에서 정규화하는 쪽을 권한다.
- [23:40] 지적 2(engine.ts:1544 알림 선기록) — 채택(결함 실재), 단 공용 `notify/throttle.ts` 는 건드리지 않는다. 확인: `sendAlertThrottled` 는 `lastSentAt.set` 후 fire-and-forget `sendAlert`(반환 void)라 전 채널 실패여도 24h 억제된다(throttle.ts:34-37, notify/index.ts:145). 영향 한도: 차단 자체는 유지되고 알림만 유실 — 자금 위험은 아니고 운영 가시성 문제이며, 어차피 `console.log` 와 eval_funnel 라벨(`regime_gate_macro_bear`)은 남는다.
- [23:40] 지적 2 범위 평가 — `sendAlertThrottled` 호출처가 약 40곳(킬스위치·order-sync·volatility-guard·cron 등)이라 공용 모듈의 선기록 의미를 바꾸면 영향 범위가 task 밖으로 번지고, 무엇보다 이 저장소에는 **같은 문제를 이미 푼 선례**가 있다: `src/lib/safety/confirmed-alert.ts` 의 `sendAlertUntilDelivered`(T-056, 「공용 모듈은 다른 경보 전부가 쓰므로 바꾸지 않고(설계 결정) 이 키들만 처리」). 전달 확인(`delivered.length > 0`) 뒤에만 억제하고, 실패면 다음 틱에 재전송하며, 호출부를 기다리게 하지 않고(in-flight), `__setConfirmedAlertDispatchForTest` seam 이 있다. 따라서 「공용 throttle 변경」과 「게이트 쪽만의 완화(예: 같은 날 N분 재발송)」 둘 다 불필요하다 — 후자는 정상 전달 시에도 하루 여러 번 보내거나 실패 감지를 못 해 열등하다.
- [23:40] 지적 2 최소 수정안 — `src/lib/strategy/engine.ts` 게이트 블록(1544 부근)만: `sendAlertThrottled(key, 'warning', title, body, 24h)` 를 `sendAlertUntilDelivered(key, 'warning', title, body, 24 * 60 * 60 * 1000)` 로 교체(import `@/lib/safety/confirmed-alert`, 키 `regime_gate_macro_bear:${market}:${localDate}` 그대로). 시험: `engine-regime-gate-t183.test.ts` 는 지금 `@/lib/notify` 의 `sendAlert` 를 모의하므로 `__setConfirmedAlertDispatchForTest` 로 `dispatchAlert` 를 바꿔 (a) 전달 성공 → 4틱 1회 (b) 첫 틱 `delivered: []` → 다음 틱 재전송 (c) 성공 뒤 억제 를 단언하고, 기존 KST/ET 날짜 키 시험은 같은 방식으로 이전. `safety/confirmed-alert.ts` 자체와 `notify/throttle.ts` 는 수정하지 않는다. 전 채널이 계속 죽어 있으면 5분마다 시도(로그에 `[confirmed-alert] … 전달 실패`)하는 것은 수용 — 그 상태에서는 어떤 알림도 못 가므로 별도 장애다.
- [23:40] 주의 — 수정 후 `engine.ts` 가 `safety/` 모듈을 하나 더 import 하고(이미 `order-limits` 등을 import 하므로 계층 위반 아님), `kis-domestic.ts` 이외 안전 경로(`src/lib/safety/**`)는 수정하지 않는다. 수정 diff 가 위 3개 파일(`macro.ts`·`engine.ts`·시험 2개)을 넘으면 범위 대조에서 전체 재순환 대상이다. 재검증은 Reviewer 가 수정 부분을 보고, 사용자 전달 전 QA 1회(위 경계 단언 + 알림 재전송 시험 실행)로 충분하다.
- [23:40] Codex C2 판정: 지적1 채택, 지적2 채택(공용 throttle 변경 없이 `sendAlertUntilDelivered` 로 게이트만 교체 — 별건 이관 아님) — 다음: Developer 수정 후 재검증
- [23:55] 라운드 2 재검증(읽기 전용, 수정·커밋·push 없음). 실행 도구 claude(reviewer 서브에이전트). 서버 worktree 에서 `r2-before/` 사본 대비 diff 로 변경분을 직접 읽음.
- [23:55] 채택 판정 대비 — 지적 1: `macro.ts` `safeChange` 가 `Math.round(pct*1e6)/1e6` 로 반올림(상수 `PCT_ROUND`), 게이트 `<= -1.5` 비교 불변, 한 곳 정규화라 다른 소비처도 같은 값을 받음. 지적 2: `engine.ts` 가 `sendAlertThrottled`→`sendAlertUntilDelivered` 로 교체(import 1줄, 키 `regime_gate_macro_bear:${market}:${localDate}`·24h·KST/ET 날짜·문구 그대로), 반환값을 쓰지 않아 호출부 비대기. 최소 수정안과 일치하고 `notify/throttle.ts`·`safety/confirmed-alert.ts` 는 건드리지 않음(diff 에 없음).
- [23:55] `confirmed-alert.ts` 실제 동작과의 맞물림 확인 — 한 채널이라도 `delivered.length > 0` 이어야 `suppressMs` 억제, 빈 배열·예외면 억제 안 함(다음 틱 재전송), 진행 중 키는 `in_flight` 로 겹침 방지, 동기 예외도 내부 catch 라 호출부 예외 없음. 알림 I/O 와 무관하게 `regimeGateBlocked=true` 가 같은 틱에 적용되는 순서도 유지. 전 채널 장애 시 5분마다 재시도·로그는 수용 범위(앞선 판정과 동일).
- [23:55] 범위 대조 — base(8d9e980) 대비 추적 변경 6개 + 신규 시험 3개 = 정확히 9개 경로, 그 밖 변경 없음(node_modules 만 untracked 로 별도). `git diff --summary` 0줄(권한 변경 없음 — 라운드 1 의 M-1 해소 유지). 라운드 2 변경분은 `macro.ts`·`engine.ts`·시험 3개(`macro-t183`·`engine-regime-gate-t183`·`engine-invariant`)뿐. 어댑터 3개(`types.ts`·`kis-domestic.ts`·`kis-overseas.ts`)는 base 대비 diff 가 선택 필드 `prevClose` 추가(각 2~6줄)로 라운드 1 과 동일.
- [23:55] 시험 재실행(서버, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`) — 바뀐 시험 3개 + `kis-ticker-prev-close-t183` = 4 suites 99/99 통과. `jest src/lib/strategy src/lib/exchanges src/lib/safety`: 4450 통과·1 실패·121 skip, 실패 1건은 `records/__tests__/job-slots.test.ts`(이 diff 와 무관, 라운드 1·developer base 기록과 같은 파일). `npx tsc --noEmit` exit 0. 변이 확인(반올림 제거→5건, 스로틀 복귀→11건 실패)은 developer 기록을 신뢰하고 직접 재실행하지 않음 — 미재현. lint 는 ESLint 설정이 없어 미실행.
- [23:55] 라운드 1 결론 유지 — 의도 충족(시장별 독립·전일 종가 기준·fail-open 기록)·안전장치(`submitOrder`·킬스위치·한도·DRY_RUN) 접점 없음·청산 경로 무영향은 그대로. 새 영향은 두 가지뿐: 반올림이 경계 ±5e-7 안의 값을 −1.5 로 끌어당겨(차단 쪽) 호가 단위 경계 쌍의 오판을 막는 방향이고, 알림 신뢰성 개선은 차단 판정에 영향이 없다. 신규 결함 없음(critical 0·high 0·medium 0). 잔여 low: L-1(두 지수 동시 조회)·L-2(detail 키 변경) 유지, L-3(통합 오배선)은 신규 ⑦ describe 가 실제 macro 모듈로 「689.50/700.00·1332.1 → 해외 매수 차단」을 한 번에 단언해 단위 합성 수준에서 해소. 미확인: 실 KIS 응답의 `stck_sdpr`·`base` 가 각 시각에 어느 날 종가인지, 운영 cron 실제 발동 — QA 가 사용자 전달 전 읽기 전용 1회 확인 권고.
- [23:55] 커밋 시 유의 — 9개 경로 모두 `SAFETY_PATHS`(exchanges·strategy) 대상이므로 이 판정 scope 에 9개가 전부 들어 있다. 커밋 메시지에는 T-183 만 인용할 것.
- [23:57] 병합·라운드 3 재검증(읽기 전용, 수정·커밋·push 없음). 실행 도구 claude(reviewer 서브에이전트). 서버 worktree 새 base `774bef6`(detached) 직접 확인.
- [23:57] 변경 전체 대조 — 라운드 2 pass 시점 diff(`t183-tracked.diff`, base 8d9e980)와 지금 `git diff HEAD` 의 추가·삭제 줄을 비교한 결과 차이는 정확히 예상한 2곳뿐: `kis-domestic.ts`·`kis-overseas.ts` 의 `prevClose` 가 `… ? 값 : undefined` 에서 조건부 spread(`...(Number(x) > 0 ? { prevClose: … } : {})`)로 바뀐 것(주석 문구 포함). `types.ts`·`macro.ts`·`engine.ts`·시험 4개의 변경 줄은 동일 — 병합·라운드 3 에서 T-183 의도 밖의 차이는 생기지 않았다. 충돌 표식 0.
- [23:57] T-181 동작 — `kis-domestic.ts` 에서 `marketCapKrw`·`indexTag` 조건부 spread 두 줄은 diff 에 변경 없이 그대로 있고 T-183 spread 가 그 뒤에 이어 붙었을 뿐이다. `types.ts` 도 T-181 필드 뒤에 `prevClose?` 만 추가. T-181 시험 `kis-domestic-t181.test.ts` 18/18 통과(`:104` 「두 필드 없으면 두 키 없음」 포함).
- [23:57] T-183 의미 — 국내 `stck_sdpr`·해외 `base` 모두 `Number(x) > 0` 만 통과(0·NaN·빈 값 → 키 자체 없음), 해외는 `* fx` 환산 유지. `macro.ts:63-64` 가 `prevClose == null`(키 없음 포함)·비유한·0 이하이면 `prev_close_unavailable`(pct null = 판정 불가)로 처리, 반올림 `PCT_ROUND` 유지. 키가 빠지는 것으로 소비 동작은 달라지지 않는다.
- [23:57] 범위 — base 대비 추적 변경 6개(`kis-domestic`·`kis-overseas`·`types`·`engine`·`macro`·`engine-invariant.test`) + 신규 시험 3개 = 정확히 9개 경로, 그 밖 변경 없음(`node_modules` 만 untracked). `git diff HEAD --summary` 0줄(권한 변경 없음). 누적 6 files +138/−44.
- [23:57] 시험 재실행(서버, `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`) — `jest src/lib/strategy src/lib/exchanges src/lib/signals src/lib/safety`: 5690 통과·1 실패·138 skip(suites 209 통과·1 실패·4 skip). 실패 1건은 `records/__tests__/job-slots.test.ts` E11(슬롯 표 ↔ 러너 라벨 21개) — 같은 파일을 직접 다시 실행해도 같은 1건이고, developer 의 새 base 대조 로그 `r3-base-job-slots.log` 도 동일 1 failed·18 passed 라 base 기존 실패이며 이 diff 와 무관. `npx tsc --noEmit` exit 0. lint 는 ESLint 설정 없어 미실행.
- [23:57] 결론 — 신규 결함 없음(critical 0·high 0·medium 0), 잔여 low 는 L-1·L-2 유지. 병합은 T-181 필드를 건드리지 않았고 라운드 3 은 키 유무 모양만 T-181 과 맞췄을 뿐 `prevClose` 의미와 소비처 동작을 바꾸지 않는다. 미확인(그대로): 실 KIS 응답의 `stck_sdpr`·`base` 가 각 시각에 어느 날 종가인지, 운영 cron 실제 발동 — QA 가 사용자 전달 전 읽기 전용 1회 확인 권고. 변이 확인은 직접 재실행하지 않음. 커밋 메시지에는 T-183 만 인용할 것(base 가 T-181 머지 이후라 T-181 ID 를 설명용으로 넣으면 게이트가 섞인다).
- [23:57] **최종 판정: PASS (scope: src/lib/exchanges/types.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/strategy/macro.ts, src/lib/strategy/engine.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts, src/lib/strategy/__tests__/macro-t183.test.ts, src/lib/strategy/__tests__/engine-regime-gate-t183.test.ts, src/lib/exchanges/__tests__/kis-ticker-prev-close-t183.test.ts)**

- [10:25] 병합 후 재검증(e8dbee9 위 cherry-pick, 서버 worktree 읽기 전용): T-184 변경 13파일 중 T-183 과 겹치는 파일은 engine.ts 뿐이며 T-184 쪽은 1231행 skip 사유 문구 1줄(코어 KOSPI 100 → KOSPI200 편입)이다. 게이트 블록(~1511–1556)·변수·알림 키(regime_gate_macro_bear)·skip 사유와 무관해 의미상 간섭 없음.
- [10:25] T-184 변경 전체에서 prevClose·open24h·getTicker·Ticker·macro·regime 토큰 추가 0건, portfolio-stability·universe·index-tier-store 에도 prevClose/open24h 사용 없음. macro.ts·exchanges/*·confirmed-alert 는 T-184 가 건드리지 않았고 sendAlertUntilDelivered 모듈은 main 에 존재한다. ai-filter·skip-reason-formatter 변경은 프롬프트·설명 문구뿐이다.
- [10:25] 코드 변경분(staged src 9개 + task 문서) patch-id 가 원 커밋과 동일(d0d2e30a…) → 게이트 블록은 리뷰한 모습 그대로. 버전 변경은 package.json·package-lock.json(2곳)의 0.21.0 → 0.22.0 만(변경 줄 6, 버전 문자열 외 없음).
- [10:25] **최종 판정: PASS (scope: src/lib/exchanges/types.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/strategy/macro.ts, src/lib/strategy/engine.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts, src/lib/strategy/__tests__/macro-t183.test.ts, src/lib/strategy/__tests__/engine-regime-gate-t183.test.ts, src/lib/exchanges/__tests__/kis-ticker-prev-close-t183.test.ts)**

## 폐기된 판정 이력 (superseded)

- 새 base `774bef6` 병합과 라운드 3 수정으로 아래 라운드 2 판정은 더 이상 마지막 판정이 아니다(원문 보존, 판정 단어는 소문자로 바꿔 둠).
- [23:55] **라운드 2 종합 판정: pass (scope: src/lib/exchanges/types.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/strategy/macro.ts, src/lib/strategy/engine.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts, src/lib/strategy/__tests__/macro-t183.test.ts, src/lib/strategy/__tests__/engine-regime-gate-t183.test.ts, src/lib/exchanges/__tests__/kis-ticker-prev-close-t183.test.ts)**
- Codex C2 지적 2건을 채택하여 수정 후 재검증이 필요해졌으므로 아래 이전 라운드 판정은 더 이상 유효하지 않다(원문 보존, 판정 단어는 소문자로 바꿔 둠).
- [23:15] **이전 라운드 종합 판정: conditional_pass (scope: src/lib/exchanges/types.ts, src/lib/exchanges/kis-domestic.ts, src/lib/exchanges/kis-overseas.ts, src/lib/strategy/macro.ts, src/lib/strategy/engine.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts, src/lib/strategy/__tests__/macro-t183.test.ts, src/lib/strategy/__tests__/engine-regime-gate-t183.test.ts, src/lib/exchanges/__tests__/kis-ticker-prev-close-t183.test.ts)**

## Judge

- [2026-11-20 22:52] intake engine=jev → task_type=bug_investigation · risk=R2 · developer_model=opus · next=ask_user · demo=none/- · actions=clarify_requirements,assign_developer · blocking_gate=requirements | overrides=- | fallback=- | tokens=1382
- [2026-11-20 23:14] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=design_assumption · budget_rule=CX-limit-unknown-r2 · codex_switch=on | overrides=- | fallback=- | tokens=1152

## QA

- [23:16] QA 실행 환경: 서버 worktree `~/.node-local/stockinvest-t183`(HEAD 8d9e980). 명령·로그는 서버 `~/.node-local/t183-qa/` 아래, 무거운 실행은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 로 직렬. 코드 수정·커밋·push·설정 변경·DB 쓰기·주문 없음.
- [23:16] 4-범위 대조: `git diff --stat` 6 files +118/−44 + 신규 3(untracked) = 9개로 Reviewer scope 9개와 일치. `git diff --summary` 0줄 — 파일 권한 변경 없음(E2 의 M-1 조치 유효).
- [23:16] 1-a 신규·갱신 시험 4파일(`macro-t183`·`engine-regime-gate-t183`·`kis-ticker-prev-close-t183`·`engine-invariant`): 4 suites · 91 tests 통과 · 0 실패 (`new4.log`).
- [23:16] 1-b `jest src/lib/strategy src/lib/exchanges src/lib/signals src/lib/safety`: suites 207 통과 · 1 실패 · 4 skip / tests 5642 통과 · 1 실패 · 138 skip. 실패 1건은 `src/lib/strategy/records/__tests__/job-slots.test.ts` E11(슬롯 표 ↔ 러너 라벨 정합)이며 base 8d9e980 의 `base-jest.log` 에도 같은 suite 실패가 있어 이번 변경과 무관한 기존 실패다.
- [23:16] 1-c 범위 밖 기존 실패: `src/lib/profit-engine/__tests__/isolation.test.ts` 3 실패 · 57 통과. 실패 시험명이 base 로그(`base-isolation.log`)와 같고(상대경로 import 허용 목록·`@/lib/strategy` 참조 0건·daily_bars 참조 0건), 이번 diff 는 profit-engine 을 건드리지 않는다 → 기존 실패.
- [23:16] 1-d `npx tsc --noEmit`: exit 0 (`tsc.log`).
- [23:16] 1-e lint: 저장소에 ESLint 설정 파일이 없어 실행 대상이 없다 — NOT_VERIFIED.
- [23:16] 2 엣지 대조(시험명 기준 실행 결과): 국내만 −1.5% 이하 → 국내 차단·해외 허용 통과 / 해외만 차단·국내 허용 통과 / 둘 다 하락 차단 통과 / 정확히 −1.5% 차단·−1.49% 허용 통과 / 현재가 0·NaN → price_unavailable 통과 / 전일 종가 없음·0·NaN → prev_close_unavailable 통과 / 시세 예외(Error·문자열 throw)와 200자 상한 통과 / 실패 지수는 다음 호출에서 재조회·성공 지수는 5분 캐시 통과 / 같은 날 반복 틱 알림 1회·KST 날짜 변경 시 국내 재알림 통과.
- [23:16] 2-a 샌드박스 추가 시험(저장소 밖 복사본, 시험 1건 추가): 해외 같은 ET 날짜 2틱 → 알림 1회, 다음 ET 날짜 → 누적 2회. 19/19 통과 (`qa-extra.log`). 샌드박스는 실행 후 삭제.
- [23:16] 2-b 미실행: 「차단 시 보유 종목 매도 경로 유지」. 코드 대조로는 `engine.ts` 1686~1700 의 `buyBlocked` 가 buy 후보만 제거하고 sell 후보는 통과시키며 게이트 블록(1519~1556)은 매도 후보를 건드리지 않는다. 그러나 보유 종목 fixture 가 필요한 실행 시험은 기존에도 신규에도 없어 실행 확인은 NOT_VERIFIED.
- [23:16] 3 실응답 확인(읽기 전용, KIS 호출 2회, 응답 시각 23:15:36 KST, 스크립트 `probe-qa.cjs`, 로그 `probe-qa.log`). DB 는 기존 토큰 행 SELECT 만, 만료 임박 검사 통과, 앱키는 헤더로만 사용·출력 없음.
- [23:16] 3-a `069500` FHKST01010100: rt_cd 0 · stck_prpr 76210 · stck_sdpr 80630 · stck_oprc 77370 · prdy_ctrt −5.48. 새 매핑 price 76210 · prevClose 80630 → 계산 변화율 −5.4818% → KIS prdy_ctrt 와 소수 둘째 자리 일치. 종전 시가 기준 계산은 −1.50% 로 갭분이 빠진다(같은 응답으로 확인).
- [23:16] 3-b `AMS:SPY` HHDFS00000300: rt_cd 0 · last 711.6107 · base 715.8700 · rate −0.59 · 응답에 open 필드 없음. 새 매핑 prevClose 715.87 → 계산 −0.5950% → KIS rate −0.59 와 소수 둘째 자리 일치. 환율은 price 와 prevClose 에 같은 값이 곱해져 비율에서 약분되므로 검증은 환율 1 로 했다(환율 API 는 호출하지 않음).
- [23:16] 3-c 측정 시각의 장 상태: 국내는 장 마감 후(종가 값), 미국은 정규장 중(09:15 ET, 장중 값). 장 시작 직후·휴장일·장 마감 직후의 `stck_sdpr`·`base` 의미는 이번 측정 범위 밖이라 미검증.
- [23:16] 3-d 미검증: 실 KIS 응답으로 macro→게이트→알림까지 한 번에 돌린 것은 아니다(엔진 시험은 fetchMacroIndicators 를 mock). Reviewer L-3 권고의 통합 확인은 이 범위에서 부분만 충족.
- [23:16] 4 안전장치·보안(변경 범위 대조): 변경 9개 파일에 주문 송신·DRY_RUN·KILL_SWITCH·주문 한도·심볼 허용 경로 변경 없음. 새 SQL 없음(기록은 기존 `rec.error`). 로그·응답에 키·토큰 미출력. `ticker_error` 사유는 200자 상한(시험 확인).
- [23:16] 5 `regime_gate_macro_error` detail 키 변경(Reviewer L-2): `src/` 에서 이 detail 을 읽는 코드를 재확인해 0건이며 기록 지점은 engine.ts 1곳이다(eval-funnel-labels 는 라벨만 사용).
- [23:16] 6 관찰(결함 아님·미확인): `macro.ts` 의 지표 기준이 바뀌어 `src/lib/strategy/ai-filter.ts` 의 `marketContext` 로 들어가는 같은 이름 필드 값도 달라질 수 있다. 실제로 어떤 호출 경로가 이 값을 넘기는지는 이번에 확인하지 않았다(미확인).
- [23:16] 7 운영 영향(정보): 수정 후 국내 신규 매수는 전일 종가 대비 −1.5% 이하인 날 차단된다(사용자 승인 정책). 11-20 실측 KODEX200 −5.48% 이면 이 기준으로 차단 대상이다. 현재 DRY_RUN·킬스위치 상태라 당장 매수는 0이며, 운영 cron 에서의 실제 발동과 알림은 미검증.
- [23:16] 미검증 목록: (1) 차단 시 매도 경로의 실행 확인 (2) 실 응답 기반 게이트 전 경로 (3) 장 시작 직후·휴장일·장 마감 직후 실응답 (4) 운영 cron 발동·알림 (5) ESLint(설정 없음) (6) T-181 과 engine.ts 의 머지 충돌(PR 단계 확인 대상).
- [23:16] QA 판정: PASS
- [23:45] 라운드 2 — 배포 전 전체 QA. 실행 주체 claude(qa 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t183`(HEAD 8d9e980, 코드 수정·커밋·push·설정 변경·DB 쓰기·주문 없음). 로그는 서버 `~/.node-local/t183-qa-r2/` (무거운 실행은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`).
- [23:45] 재현 조건(라운드 2): 서버 Linux, Node·jest 는 서버 설치본, 시계열 입력은 시험 fixture 고정(FX 1332.1, 국내 전일 종가 80600 등), 실 응답 확인만 KIS 실시세(KST 23:44, ET 09:44 정규장). 시각·타임존 고정은 시험 내부 상수 사용(ko-KR·Asia/Seoul 날짜 키).
- [23:45] 1 범위 대조: base 8d9e980 대비 `git diff --name-status` 추적 6개(kis-domestic·kis-overseas·types·engine·engine-invariant·macro) + untracked 신규 시험 3개 = 정확히 9개, `git diff --summary` 0줄(권한 변경 없음 — M-1 해소 유지). 추가 untracked `node_modules` 는 운영 `current/node_modules` 심볼릭 링크(이 task 의 변경 아님). 변경 통계 `6 files +136/−44`(라운드 1 기록 +118/−44 에서 라운드 2 분 증가).
- [23:45] 2-a 자동 시험 — 신규·갱신 4파일(`macro-t183`·`engine-regime-gate-t183`·`kis-ticker-prev-close-t183`·`engine-invariant`): 4 suites · 99 tests 통과 · 0 실패 (`targeted.log`).
- [23:45] 2-b `jest src/lib/strategy src/lib/exchanges src/lib/signals src/lib/safety`: suites 207 통과 · 1 실패 · 4 skip / tests 5650 통과 · 1 실패 · 138 skip. 실패 1건은 `records/__tests__/job-slots.test.ts` 의 「🔴 E11 — 슬롯 표 ↔ 러너 라벨 정합 › 🔴 표의 jobId 집합 = 러너 정적 라벨 + peek 21개」로, base 로그(`~/.node-local/t183-logs/base-jest.log`)의 실패 시험명과 같다(기존 실패, 이번 변경 무관) (`broad-jest.log`).
- [23:45] 2-c `profit-engine/__tests__/isolation.test.ts` 단독 실행: 3 실패 · 57 통과 — 실패 시험명 3건(상대경로 import 허용 목록·`@/lib/strategy` 참조 0건·daily_bars 참조 0건)이 base 로그(`base-isolation.log`)와 같다(기존 실패) (`isolation.log`).
- [23:45] 2-d `npx tsc --noEmit`: exit 0, 출력 0바이트 (`tsc.log`).
- [23:45] 2-e lint: 저장소에 ESLint 설정 없음 — NOT_VERIFIED(라운드 1 과 동일).
- [23:45] 3 엣지 — 시험명으로 덮임 확인(라운드 2 신규 항목 전부 시험이 있어 저장소 밖 임시 스크립트는 불필요했다): 경계 쌍 689.50/700.00·환율 1332.1 → 정확히 −1.5 · `<= -1.5` 참 (`macro-t183` 91, `engine-regime-gate-t183` ⑦ 413 — 실제 macro 모듈 경유) / 689.57/700.00 → −1.49 허용 (`macro-t183` 104) / 국내 정수 쌍 80600→79391(−1.5 차단)·80600→79392(허용) (`macro-t183` test.each) / 전일 종가 대비 계산·open24h 미사용 (`macro-t183` 52·67, `kis-ticker-prev-close-t183` 45·68) / 첫 틱 전 채널 전달 실패(`delivered: []`) → 다음 틱 재전송 → 성공 뒤 억제 (`engine-regime-gate-t183` 319) / 전송 promise 거부 시 억제하지 않고 재전송 (338) / 알림 미완료(pending) 중에도 그 틱 차단 적용·회차 비대기 (349) / 시장별 분리·KST/ET 날짜 키 (362·370·382).
- [23:45] 4 실응답 1회(읽기 전용, 기존 DB 토큰 SELECT 만·신규 발급 없음·앱키 헤더 전용·키 출력 없음, 스크립트 `probe-r2.cjs`, 로그 `probe-r2.log`, 응답 시각 23:44:19 KST). 현재 코드 매핑 식을 반올림(소수 6자리)까지 적용해 대조:
  - `069500` 국내: 원본 stck_prpr 76210 · stck_sdpr 80630 · prdy_ctrt −5.48 → 매핑 price 76210·prevClose 80630 → 계산 −5.4818% → 소수 둘째 자리 일치 PASS(라운드 1 과 같은 값 — 장 마감 후 종가 응답).
  - `AMS:SPY` 해외: last 712.2100 · base 715.8700 · rate −0.51 → 매핑 price 712.21·prevClose 715.87 → 계산 −0.5113% → 소수 둘째 자리 일치 PASS(라운드 1 과 다른 새 시세). 환율은 비율에서 약분되므로 1 로 둠(환율 API 미호출).
  - 주의: 이 대조 스크립트는 워크트리 `kis-*.ts` 를 직접 import 하지 않고 같은 식을 옮겨 적은 것이다(라운드 1 과 같은 한계). 어댑터 실행 경로는 시험(`kis-ticker-prev-close-t183`)이 담당한다.
- [23:45] 5 안전장치·보안(변경 9개 대조): 주문 송신·DRY_RUN·KILL_SWITCH·주문 한도·심볼 허용 경로 변경 없음. 새 SQL 없음. 키·토큰 출력 없음(로그 확인).
- [23:45] 6 미검증(라운드 2 에서도 남음): (1) 차단 시 보유 종목 매도 경로의 실행 확인 — 코드 대조상 `buyBlocked` 는 매수 후보만 제거(engine.ts 1686 부근), 실행 시험 fixture 없음(NOT_VERIFIED) (2) macro→engine 실 응답 통합 1회(실 KIS 응답을 게이트까지 흘리는 실행은 없음 — 시험은 `fetchMacroIndicators` 를 실제 모듈로 돌리되 `getTicker` 만 모의) (3) 장 시작 직후·휴장일·장 마감 직후 `stck_sdpr`·`base` 의미 (4) 운영 cron 실제 발동·알림 전달 (5) ESLint (6) T-181 과 engine.ts 머지 충돌(PR 단계 확인).
- [23:45] 7 결함 목록: Critical 0 · High 0 · Medium 0 · Low 0 신규. 기존 실패 2종(job-slots E11, isolation 3건)은 base 와 같은 시험명이며 이번 변경과 무관하다.
- [23:45] 8 운영 영향(정보): 수정 후 국내 매수는 전일 종가 대비 −1.5% 이하 날 차단된다(승인 정책). 11-20 장 마감 기준 KODEX200(069500) −5.48% 이므로 해당 날 국내 신규 매수는 차단 대상이다. DRY_RUN·킬스위치 상태에서 실제 발동 여부는 운영 cron 에서 아직 확인되지 않았다(미검증).
- [23:45] 배포 전 판단 참고: 위 미검증 (1)(4)는 배포 후 관찰 항목이다. 사용자 결정 전 배포는 Leader 판단 사항이다.
- [23:45] 산출물 정리: 저장소 밖 서버 로그만 남김(`~/.node-local/t183-qa-r2/`), 프로젝트 안 산출물 없음.
- [23:45] QA 판정(배포 전 전체): PASS

## 배포 기록

- [2026-11-20 23:5x KST] 서버 worktree 커밋 `44aca93`(부모 `774bef6` = origin/main, 12 files +1160/−47, 커밋 훅 `✅ Reviewer 감사 기록 확인: T-183` — 다른 task ID 섞임 없음). `git-refs-clean --check` 깨끗. 작업 브랜치 `t183-macro-regime-gate` push(웹훅은 `/main` 으로 끝나는 ref 만 배포 — 배포 아님). Gitea PR #10 생성(본문 U+FFFD 0, 원본과 일치, mergeable true): https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/10
- 머지(= main push = webhook blue/green 운영 배포)는 **사용자 승인 대기**. 머지 때는 Gitea API `merge` 에 검토한 head `44aca93` 을 `head_commit_id` 로 고정한다. 마이그레이션 없음(`--with-migrate` 불필요). 커밋 메시지·이력서의 E3·E4 시각을 처음에 `11-21 00:xx` 로 잘못 적어 `11-20 23:xx` 로 정정했다(커밋된 이력서 사본에는 잘못된 값이 남아 있음 — 승인 기록 커밋 때 함께 반영).
- [2026-11-21 10:1x KST] 사용자 「머지 승인」. 머지 전 확인: 대화에 남아 있던 jest 결과(T-181 시험 실패 포함)는 R3 수정 전 11-20 23:49 실행분이었고, `44aca93` 에서 `kis-domestic-t181`·`kis-ticker-prev-close-t183` 재실행 30/30 통과. 승인 원문과 시각 정정을 담은 이력서 커밋을 같은 브랜치에 더한 뒤(코드 변경 없음), 그 새 head 를 `head_commit_id` 로 고정해 머지한다.
- [2026-11-21 10:16 KST] 머지 직전 검사에서 중단: PR base 가 `e8dbee9`(다른 세션 T-184 PR #9 가 10:15 머지, 0.21.0 으로 10:16 배포 완료)로 바뀌어 Gitea `mergeable=false`. 머지 요청은 보내지 않았다(스크립트 assert 에서 멈춤). → 새 main 위 재적용(E6).
- [2026-11-21 10:2x KST] 재적용 결과: `e8dbee9` 위 `cherry-pick -n 44aca93` 충돌 없음, 코드 patch-id 원 커밋과 동일(`d0d2e30a…`). T-184 가 0.21.0 을 이미 써서 버전 정책대로 **0.22.0**. 전체 jest(491 묶음) 12,989 통과 / 10 실패(7 묶음 — corp-intel·profit-engine isolation, reason-dictionary-keys, job-slots E11, currency-mixing·usd-cash-balance fence, t108-terms-fence) · tsc 0. **같은 7 묶음·10건이 `e8dbee9` 단독에서도 실패하고 위반 항목 17개가 완전히 같다**(T-183 관련 항목 0) — main 에 이미 있는 실패라 T-183 범위 밖. Reviewer 병합 후 재검증 PASS [10:25].
- [2026-11-21 10:2x KST] 재적용 커밋 `1bbb0b5`(0.22.0)를 브랜치에 강제 갱신(`--force-with-lease` 로 `6a87cbb` 확인). ⚠ 커밋 메시지 본문에 버전 사정을 설명하려고 다른 task ID 를 적어, 훅이 그 task 의 판정까지 함께 참조했다(`Reviewer 감사 기록 확인: T-183` 뒤에 그 ID 가 붙음). T-183 판정만으로도 통과하는 커밋이었지만 설명용 task ID 인용은 금지라 다음 커밋에서 그 문구를 지웠다. 그 직후 main 이 다시 `10e7f33`(다른 세션 T-182 PR #11, 10:22 머지·0.22.0 배포)로 전진 → E7.
- [2026-11-21 10:3x KST] `10e7f33` 위 재적용: 겹치는 파일은 `package.json`·`package-lock.json` 뿐, 그쪽 추가 줄에 게이트 관련 토큰(prevClose·open24h·getTicker·regime·macro·sendAlertUntilDelivered) 0건. `cherry-pick -n` 충돌 없음, 코드 patch-id 동일(`d0d2e30a…`), 버전 **0.23.0**(변경 줄 6), 권한 변경 0.
- [2026-11-21 10:4x KST] `10e7f33` 위 합친 트리 전체 jest(496 묶음) 13,058 통과 / 11 실패(8 묶음) · tsc 0. 7 묶음·10건은 `10e7f33` 단독과 위반 항목 17개까지 동일한 기존 실패. 8번째 `m40/forecast-engine` 1건은 전체 실행 부하 속 5초 시간 초과였고, 합친 트리 단독 재실행 21/21 통과(`10e7f33` 단독도 통과) — T-183 무관. 코드 변경분이 리뷰본과 동일하고 겹침이 버전 파일뿐이라 Reviewer 재호출 없이 [10:25] 판정을 유지(Leader 판단, LSN-0009 범위 대조).
- [2026-11-21 10:30 KST] 재적용 커밋 `23fba5c`(부모 `10e7f33`, 커밋 훅 `✅ Reviewer 감사 기록 확인: T-183` — 다른 ID 없음) → 브랜치 강제 갱신(`--force-with-lease` 로 `1bbb0b5` 확인) → Gitea 충돌 재계산 대기 후 `head_commit_id=23fba5c` 고정 머지, HTTP 200, 머지 커밋 `aec552cd12db2af0d0e6c4faff6682aa676c1277`.
- [2026-11-21 10:30:33~10:31:13 KST] webhook blue/green 배포 `RELEASE_RESULT {"status":"ok","release":"20261121-103041-aec552cd","migrated":false}`, exit=0. 확인: `current` → `releases/20261121-103041-aec552cd`, 버전 0.23.0, pm2 `stockinvest`·`stockinvest-cron` online(재시작 0), `/api/health` ok·safety green·dryRun true·killSwitch true, `cron-err.log` 배포 뒤 새 줄 없음. 같은 배포에 실린 다른 작업 없음(T-184·T-182 는 각자 10:16·10:22 에 먼저 배포됨). 토요일이라 게이트 실발동 확인은 다음 장(월요일)부터 가능.
- 이 이력서의 배포 기록·최종 요약은 머지 뒤에 쓴 것이라 공유 NFS 작업 트리에만 있고 아직 커밋되지 않았다(main 직접 push 는 재배포를 일으키므로 다음 vault 문서 커밋에 함께 싣는다).

## 실행 도구·절차 이력

- E1 2026-11-20 23:3x KST — 시작 도구 claude(메인 세션이 Leader 역할 겸임), 절차 claude_standard. 범위: 원인 확인·설계·구현·감사·QA·서버 커밋·PR. 근거: 사용자 「새 task 로 진행」. 남은 일: judge 접수 → SPY 실시세 확인·analyst 설계 → (사용자 결정: 판정 방식) → 구현 → Reviewer → QA → PR → 머지 승인
- E2 2026-11-20 23:2x KST — Leader(메인 세션): Reviewer CONDITIONAL_PASS 의 조건 M-1(파일 권한 100755→100644 변경 5건) 처리. 서버 worktree 에서 `chmod 755` 로 5개 파일(`kis-domestic.ts`·`kis-overseas.ts`·`types.ts`·`engine.ts`·`macro.ts`)을 원복, `git diff --summary` 0줄(모드 변경 없음)·`--stat` 은 6 files +118/−44 로 내용 불변 확인. 내용 변경이 없어 Reviewer 재검토 대상 아님(권한 비트만). 신규 시험 3개는 100644 — 저장소 `src/lib/strategy/__tests__` 의 다수(29/32)와 같다. 남은 일: judge C2 → QA → 커밋·PR → 머지 승인.
- E3 2026-11-20 23:4x KST — Leader(메인 세션): 커밋 직전 `git fetch` 결과 origin/main 이 `8d9e980` → `774bef6`(PR #8, 다른 세션의 T-181 머지)로 전진. T-181 이 같은 두 파일 `src/lib/exchanges/kis-domestic.ts`(getTicker 반환 객체 끝)·`src/lib/exchanges/types.ts`(`Ticker` 필드 끝)에 필드를 더해 **추가-추가 충돌 2곳**. 처리: 변경 백업(`~/.node-local/t183-logs/rebase/t183-tracked.diff`·`t183-untracked.tgz`) → `git stash -u -- src` → `git checkout --detach origin/main` → `stash pop` → 두 곳 모두 **양쪽 유지**(T-181 의 `marketCapKrw`·`indexTag` 뒤에 T-183 `prevClose` 를 이어 붙임, 다른 줄 변경 없음). 충돌 표식 0, 파일 권한 755 유지, 신규 시험 3개는 백업과 `cmp` 동일. 새 base 에서 jest(strategy·exchanges·signals·safety)·tsc 재실행 중 → 결과와 Reviewer 의 병합 결과 확인을 받은 뒤 커밋한다. frontmatter `base_ref` 는 새 base 로 바꾼다.
- E4 2026-11-20 23:5x KST — Leader(메인 세션): 병합 후 T-181 시험 1건 실패 → Developer 라운드 3(조건부 spread) → Reviewer 병합·라운드 3 재검증 최종 PASS [23:57]. 앱 버전 정책(기본 배포 = 마이너 증가)에 따라 웹 버전 `0.20.0 → 0.21.0`(`package.json`·`package-lock.json`, `npm version 0.21.0 --no-git-tag-version`, 버전 문자열 3곳만 변경, 권한 변경 0). 커밋 = 코드 9개 + 버전 2개 + 이 이력서. 다음: 서버 worktree 커밋 → 브랜치 push(배포 아님) → PR → **사용자 머지 승인** → 머지(=운영 배포).
- E5 2026-11-21 10:1x KST — Leader(메인 세션): 사용자 「머지 승인」 수신. 범위: 이력서 커밋 → PR #10 머지 → webhook 배포 결과·health 확인 → 배포 기록·최종 요약. 남은 일: 운영 cron 발동·알림 관찰(사용자).
- E6 2026-11-21 10:2x KST — Leader(메인 세션): 머지 직전 T-184 선머지로 base 변경 → 서버 worktree 를 `origin/main`(`e8dbee9`)에 detach 후 T-183 재적용(코드 동일), 버전 0.22.0, 전체 jest·tsc(기존 실패만 확인), Reviewer 병합 후 재검증 PASS. 이전 브랜치 head `6a87cbb` 는 서버 로컬 태그 `t183-before-t184-rebase` 로 보존. 브랜치를 새 커밋으로 강제 갱신(내 PR 브랜치만) 후 그 head 로 고정해 머지. 사용자 승인 범위(PR #10 머지) 안 — 코드 변경 없음, 버전만 정책대로.
- E7 2026-11-21 10:3x KST — Leader(메인 세션): 강제 갱신 직후 main 이 `10e7f33`(T-182 0.22.0)으로 다시 전진 → 같은 방식으로 재적용, 버전 0.23.0, 이전 head `1bbb0b5` 는 서버 로컬 태그 `t183-before-t182-rebase` 로 보존. 커밋 메시지에서 설명용 다른 task ID 제거. 전체 jest·tsc 재실행 후 커밋·강제 갱신·즉시 머지(경합 창을 줄이려고 갱신과 머지를 붙여 실행).
- E8 2026-11-21 10:3x KST — Leader(메인 세션): PR #10 머지(`aec552c`)·운영 배포 0.23.0 확인, 최종 요약 작성, status done(waiting: 급락일 알림 관찰). 남은 일: 사용자 관찰, 아래 남은 일 목록.

## Codex 검토

### [2026-11-20 23:23] C2 adversarial-review focus=design_assumption — done
- judge 판정: codex_gate/C2 (2026-11-20 23:14, codex_required=true · budget_rule=CX-limit-unknown-r2 · codex_switch=on) / 호출 차수: 1/4 (counts/T-183.json 기준, 이 실행이 첫 호출)
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t183 (서버 worktree, cwd) base=8d9e980(arg — `--base` 로 지정. 이 worktree 에는 T-183 이력서가 없어 base_ref 자동 탐지가 안 되므로 `task_file` 이 아니라 `arg` 로 표시됨) snapshot=26462f9
- 지적 2건:
  - [medium] src/lib/strategy/macro.ts:57 — 해외 last=689.50·base=700.00(정확히 −1.5%)·환율 1332.1 에서 sp500ChangePct 가 -1.4999999999999927 로 계산되어 engine.ts:1537 의 `<= -1.5` 비교가 false 가 된다 (Codex 가 외부 의존성만 모의해 실제 모듈을 메모리에서 실행해 확인, [확실]) → 수용 기준상 차단돼야 할 정확한 임계값에서 해외 신규 매수 후보가 허용됨. 같은 USD 가격쌍도 환율에 따라 판정이 달라질 수 있음. 신규 경계 시험은 macro 반환값에 -1.5 를 직접 주입하므로 이 계산 오차를 잡지 못함. (권고: 십진 연산 또는 명시적 오차 허용 비교 적용, 원시 KIS 응답→환산→변화율→게이트 비교까지 잇는 경계 회귀 시험 추가)
  - [medium] src/lib/strategy/engine.ts:1544 — 해당 시장의 당일 첫 차단 알림이 활성 채널 모두에서 내부 재시도까지 실패한 뒤 채널이 복구될 때 → notify/throttle.ts:35 가 발송 전에 lastSentAt 을 기록하고 notify/index.ts:145 sendAlert 는 전달 결과를 반환하지 않아, 다음 5분 틱이 억제되고 전달 0건이었음 (격리 주입 실행으로 확인, [확실]). 차단 자체는 유지되나 운영자가 당일 차단 알림을 한 번도 못 받을 수 있음. (권고: 전달 성공 시에만 당일 발송 완료 기록, 실패 시 짧은 간격 재시도 분리, 알림이 매수 차단 실행을 기다리게 하지 않음)
- 검토하지 못한 범위 (Codex 보고 그대로):
  - 실 KIS 응답에서 개장 직후·휴장 후·권리락·배당락 시 stck_sdpr·base 가 가리키는 종가 및 거래일 — 제공된 코드·시험으로 검증 불가
  - agent-vault/10-Flow/tasks/T-183-macro-regime-gate-fix.md 는 worktree 체크아웃에 없어 Codex 가 읽지 못함 (인계 묶음이 지정한 파일 — Codex 는 judge·Reviewer 판정 기록을 보지 못한 채 검토함)
  - 전체 Jest·타입검사는 Codex 가 재실행하지 않음. 메모리 내 격리 실행으로만 검증
- 실행 상태: 래퍼 `status=done`, exit_code 0, duration 251s, `files_modified_in_snapshot` 없음(스냅샷 무변경). 서버 node_modules 심볼릭 링크는 실행 전 제거, 종료 뒤 `current/node_modules` 로 복원·확인함.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T141915Z-T-183-C2/raw.txt (stderr.txt·prompt.md 동일 디렉토리)
- 다음: Reviewer 가 지적 2건의 채택·오탐 판정. 이 기록은 채택·수정 판단이 아니다.

## 최종 요약

### [T-183] 거시 하락 게이트 작동 불능 수정

- **상태**: 완료. 운영 배포 0.23.0(2026-11-21 10:31 KST).
- **무엇이 바뀌었나**
  - S&P 대용 심볼 `NYS:SPY` → `AMS:SPY`(빈 값만 받아 미국 하락을 한 번도 감지 못 했다).
  - 하락률 기준을 당일 시가 → 전일 종가로 바꿔 갭 하락을 잡는다.
  - 시장별 독립 판정: 국내 매수는 KOSPI 대용(069500), 해외 매수는 S&P 대용이 −1.5% 이하일 때만 막는다.
  - 지수를 못 받으면 막지 않고(fail-open) `regime_gate_macro_error` 로 기록한다.
  - 차단 알림은 전달이 확인된 뒤에만 그날(시장 현지 날짜) 다시 보내지 않는다.
- **배포**: 머지 커밋 `aec552c`(코드 커밋 `23fba5c`), webhook blue/green, `RELEASE_RESULT ok`, 마이그레이션 없음. 같은 배포에 실린 다른 작업 없음. 머지 직전 다른 세션의 T-184(0.21.0)·T-182(0.22.0)가 차례로 먼저 배포돼 두 번 새 main 위에 다시 적용했다 — 코드 변경분은 리뷰본과 patch-id 동일, 버전만 0.23.0.
- **AI 가 검증한 것**: Reviewer 최종 PASS(T-181 병합 후·T-184 병합 후 재검증 포함), QA 배포 전 전체 PASS, Codex C2 지적 2건 반영, 최종 합친 트리 전체 jest 13,058 통과·tsc 0(실패 11건은 모두 main 에 이미 있던 것 — 아래 이슈), 실 KIS 응답으로 계산한 하락률 = KIS 등락률, 배포 후 health·pm2·버전.
- **AI 가 검증하지 못한 것**: 운영 cron 에서의 실제 발동과 텔레그램 알림 도착, 장 시작 직후·휴장 다음 날·배당락일의 "전일 종가" 값, 차단된 날 보유 종목 매도의 실제 실행.
- **👉 사용자가 확인할 것**: 다음 국내·미국 급락일(전일 종가 대비 −1.5% 이하)에 텔레그램 "거시 지수 하락 — 신규 매수 차단" 알림이 시장별로 하루 1회 오는지. 오지 않거나 같은 날 여러 번 오면 알려 주기.
- **👉 사용자가 결정할 것**: 없음(이전 질문 — 11-06·07 의 자동 모드·주문 한도 무제한·변동성 가드 완화가 의도였는지, 실매매 재개 여부 — 은 이 task 밖이며 여전히 답을 기다린다).
- **남은 일**: 경미 L-1(두 지수를 항상 함께 조회), L-2(오류 기록 상세 키 이름 변경). 범위 밖 발견: 포트폴리오·즐겨찾기의 "등락"이 `open24h`(국내=당일 시가, 해외=전일 종가)를 써서 시장마다 기준이 다르다. 이 배포 기록·요약 커밋.
- **이슈·위험**: 국내 신규 매수가 연간 약 23% 의 날 막힌다(승인한 정책의 결과). main 에 기존 실패 시험 7 묶음(corp-intel·profit-engine isolation, reason-dictionary-keys, job-slots E11, currency-mixing·usd-cash-balance·t108-terms fence)이 있고, 전체 실행 때 `m40/forecast-engine` 이 시간 초과로 흔들린다. 여러 세션이 같은 버전 번호로 동시에 머지를 노려 이번에 두 번 재적용이 필요했다.
