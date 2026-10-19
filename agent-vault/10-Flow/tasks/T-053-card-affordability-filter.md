---
task_id: T-053
title: post-market 카드 생성 — 1주 가격이 카드 금액(10만 원)을 넘는 후보는 제외한다 (영원히 실행 불가한 카드가 개수 제한 자리를 차지하는 문제)
status: in-progress
priority: normal
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-046, T-051, T-045]
tags:
  - type/task
  - domain/strategy
  - domain/signals
aliases:
  - 카드 구성 필터
  - card affordability filter
created: 2026-10-19
updated: 2026-10-19
---

# T-053 — 실행 불가능한 카드 제외 (생성 단계)

## 배경

장마감 분석(`post-market-engine.ts`)은 카드 금액을 `amount_krw = 100000` 으로 고정한다. 주문은 1주 단위라 **1주 가격이 10만 원을 넘으면 수량 0**(`sizing_below_min_qty`)이 되어 카드가 영원히 실행되지 않는다.

- 최근 카드 40장 중 **27장(68%)** 이 1주 가격 > 10만 원이었다(2026-10-18 실측).
- 2026-10-19 16:47 생성 5장 중 3장(068270 196,000원·032830 240,000원·009540 265,000원)이 그렇다.
- 이런 카드는 사용자가 승인해도 매 분 `quantity_below_min` 기록만 남기고(T-051 과 같은 계열의 소음), 개수 제한이 있다면 실행 가능한 후보의 자리를 빼앗는다.

## 사용자 결정 (2026-10-19)

"권고대로 진행" — 권고는 **(b) 생성 단계에서 1주 가격이 예산(카드 금액)을 넘는 종목 제외**. 카드 금액 상향(c)은 위험이 커져 **하지 않는다**(별도 판단).

## 사양 (Leader)

1. 후보를 카드로 만들기 **전에**, 후보 가격(카드가 쓰는 기준 가격 — 진입 구간 중간값 등, Developer 가 코드에서 확인) × 1주 > `amount_krw` 면 제외한다. **카드 금액·사이징 로직·다른 필터는 바꾸지 않는다.**
2. 제외는 **개수 제한(상위 N개 등)을 적용하기 전에** 일어나야 한다 — 실행 가능한 후보가 자리를 얻도록. 현재 코드에 그런 제한이 없으면 그 사실만 기록.
3. 결과 JSON 에 제외 건수를 **추가 필드**로 덧붙인다(예 `unaffordableSkipped`; 기존 필드·형태 불변), 로그에도 한 줄. 제외된 후보의 종목·가격을 로그에 남겨 사용자가 "왜 후보가 줄었나"를 알 수 있게.
4. 경계: 1주 가격 == 예산이면 실행 가능(수량 1) → 제외하지 않는다. **(정정 — Developer·Reviewer 확인: 이는 추격률 0 일 때만 참이다. 운영 추격률 0.5% 에서는 "추격 반영 지정가 == 카드 금액 → 생성, +1원 → 제외" 이고 진입 구간 중간값 ≥ 99,502.5 원이면 수량 0 이다.)** 가격이 0/NaN/없음이면 기존 동작 유지(이 필터가 새 실패를 만들지 않게).
5. 해외 post-market(`market=overseas`)도 같은 엔진이다. 통화/환산 가격 기준이 국내와 다르면 **국내만 적용**하고 해외는 기존 동작 유지(이유 기록). 확인은 코드로.
6. T-045/T-046 의 기존 보장(주말 스킵, `NOT EXISTS` 중복 방지, `ER_DUP_ENTRY`→duplicate, KST 시각 저장)을 건드리지 않는다.

## 범위 밖

카드 금액 정책 변경, 전략/신호 자체의 변경, 현금 사전 점검(T-051).

## Reviewer

- [18:21] 감사 대상·해시: `post-market-engine.ts` `1ca83d0d79cc`(HEAD blob `ac24a8d0c112` = T-046 감사본 위 +68/−1) · `post-market-engine.test.ts` `7bb0a10073c6`(+213/−3). 작업 트리·격리 사본(`scratchpad/t053repo`)·Leader 표 모두 일치. `git diff HEAD --stat -- src/lib/strategy` 상 T-053 소유 파일은 이 2개뿐(`ai-filter.ts`·`market-context-client.ts` 변경은 타 세션 것 — 커밋 때 같이 stage 하지 말 것). 변이 후 원복·해시 재대조 일치.
- [18:21] [확실] 판정 기준 = 실제 수량 0 조건. entry-watcher HEAD `route.ts:302-320`(`basePrice=row.price` → `chasePct>0 && order_type==='limit' && basePrice>0` 일 때만 `×(1+chasePct)` → `sizeOrderQuantity({market, orderType, requestedQuantity, amountKRW:row.amount_krw, price})`)와 엔진 `cardBuysZeroShares`(`post-market-engine.ts:64-72`)는 같은 함수·같은 입력이다. 카드는 `order_type='limit'`(INSERT 리터럴 :170), `quantity` NULL(운영 SELECT 45장 전부 null), `amount_krw=100000.00`. `roundToTick`(`kis-domestic.ts:256`)은 송신 때 `ORD_UNPR` 만 반올림하고 수량 산출 뒤라 수량에 영향이 없다. 최소수량·수수료 보정은 사이징에 없다(`floor(amount/price)` 뿐).
- [18:21] [확실] 수치 검증(직접 작성한 참조 구현 = route 코드 글자 그대로 + DB `DECIMAL(36,8)` 왕복, 필터와 비교): 가격 90,000~110,000(0.5원 간격) × 추격률 {0, 0.1, 0.5, 1, 2}% = 200,005점에서 불일치 0건. 경계(추격 0.5%): 99,502.4 → 지정가 99,999.91 → 1주(만든다) · 99,502.5 → 100,000.01 → 0주(제외) · 100,000 → 100,500 → 0주(제외). 사양 4 의 "1주 == 예산이면 만든다"는 추격률 0 에서만 참이고, 운영 값에서는 중간값 ≥ 99,502.5 가 수량 0 이다 — Developer 의 해석(실행 경로 기준)이 옳고, Leader 는 사양 4 문구를 그에 맞게 정정해 둘 것.
- [18:21] [확실] 추격률 출처·스위치. 운영 `system_config` 에 `style_default_limitChasePct` 없음(style_default_* 9개 중 해당 키 없음)·`safety_limit_chase_disabled` 행 없음(10-19 읽기 전용 SELECT 재실측) → 0.005. entry-watcher `getEffectiveChasePctSync`(`route.ts:102-106`)는 스위치를 보지 않고 style 값을 그대로 돌려준다 — Developer 지적이 맞다. 스위치를 보는 쪽은 `service.ts getEffectiveChasePct`(:33)이며 `createSignal`(:451)·`approveSignal`(:544)의 즉시 경로에서만 쓴다(Developer 가 말한 `executeSignal` 은 실제 함수명이 아니다 — 의미는 같다). 운영 `hybrid_mode_enabled=true` 이고 post-market 카드는 `price_zone` 이 있어 승인 시 hybrid → entry-watcher 로 간다(`approval-transitions.ts:74-82`). 생성 시점 값과 실행 시점 값이 어긋나는 것은 그 사이 style override 를 바꿀 때뿐(오늘은 override 없음).
- [18:21] [확실] 과도 제외(실행 가능한 카드를 자름) 탐색. 카드 `amount_krw` 를 올리는 UPDATE 경로가 없고(grep), `approveSignalHybrid` 는 status·indicators 만 바꾸며, 사이징은 편집된 구간이 아니라 `row.price` 를 쓴다. 운영 post-market 카드 45장 중 `price ≤ 100,000` 인 15장은 전부 ≤ 96,500 이라 이 필터가 자르는 실행 가능 카드는 이력상 0장(99,500~100,000 구간 이력 0장). 과소 제외(필터는 통과·실행은 수량 0)는 격자 검증 불일치 0 이 보증하되, 아래 R-3 의 1e-8 창만 이론상 예외다.
- [18:21] [확실] 위치·부수효과. 루프 순서는 후보 매칭 → BUY·필수 값 → 신뢰도 < 60 → (신규) 금액 판정 → INSERT(`:386-412`). `continue` 는 INSERT 만 건너뛰어 `NOT EXISTS`·`ER_DUP_ENTRY`→duplicate·`duplicatesSkipped`·`errors` 에 닿지 않는다. 주말 스킵(:289)·KST 저장(:279-280)·`insertScenarioCardIfAbsent` SQL 은 diff 에 없다. 결과 JSON 은 `unaffordableSkipped` 추가뿐이고, `signalsSkipped` 값은 제외 건수만큼 커진다(중복과 같은 관례). 소비자는 cron 라우트의 `{ok:true,...result}` 스프레드와 콘솔뿐이고 `cron-runner.sh` 는 HTTP 코드만 본다(:36-44) — 로그 파서·대시보드 참조 0건(grep).
- [18:21] [확실] 추격률 조회. `getStyleConfig` 는 루프 밖에서 1회/실행(:375-382), 내부 60초 캐시(`style.ts:15`). 다만 `getStyleConfig` 자체가 DB 오류를 삼키고 코드 기본값 0.005 를 돌려주므로(`style.ts:165-182`) 엔진의 catch(예외 → 0)는 사실상 방어용이다 — 실제 DB 장애 때는 0 이 아니라 0.005 로 판정된다(운영은 override 가 없어 같은 값). 두 경우 모두 카드를 덜 만들거나 예전 동작이라 안전한 방향이다. 엔진에 새 import(`signals/service`)는 순수 사이징 함수만 쓰며 주문 송신·킬스위치·한도·블랙리스트 경로 변경 0, 순환 import 없음(post-market-engine 은 cron 라우트와 테스트만 import).
- [18:21] [확실] 기존 테스트 변경 줄 단위 확인(`git diff HEAD`). 바뀐 것은 import 2개 · `../style` 목 · `buy()` 기본 구간(310,000~314,000 → 93,000~94,000) · `beforeEach` 의 `mStyle` · 단언 2곳(`params[2]` 312000→93500, `price_zone`) · 말미 describe 추가뿐이다. T-045/T-046 본문(주말 스킵·`NOT EXISTS`·`ER_DUP_ENTRY`→duplicate·KST 저장·`duplicatesSkipped`)은 한 줄도 바뀌지 않았고 판정 대상 약화는 없다. 오히려 기본 가격을 살 수 있는 값으로 바꾼 덕에 이 테스트들이 계속 INSERT 경로까지 도달하므로 "필터가 전부 자르는" 회귀를 이 테스트들이 잡는다.
- [18:21] [확실] 국내/해외. `loadSymbols('overseas')` → `[]` → `:298-301` 의 `no_symbols` 반환이 추격률 조회·루프보다 앞이라 두 `market==='domestic'` 가드는 도달 불가이고, M4·M4b(해외에도 적용)는 등가 생존이 맞다. `sizeOrderQuantity` 가 환율 환산 없이 KRW 로 나눈다는 주석도 확인(`service.ts` 사이징 ② 주석).
- [18:21] [확실] 사양 2(개수 제한 앞) 미해결의 기록은 정직하다. 엔진에 `slice`·top-N 이 없고(`:384-470` 전수 확인) "최대 5종목"은 `buildPrompt` 마지막 줄(:260)의 LLM 지시뿐이며, 진입 구간은 LLM 응답 뒤에 생기므로 필터를 그 앞에 둘 수 없다는 설명이 맞다. 이력서 Developer 절(55행·63행)에 "비싼 종목 3개가 5자리 중 3자리를 쓰는 문제는 이번 변경으로 풀리지 않는다"가 명시돼 있다. Leader 최종 요약·사용자 보고에 이 한계를 그대로 옮길 것(카드 3장이 안 생길 뿐 그 자리를 다른 후보가 채우지 않는다. 풀려면 별도 task: LLM 전 사전 거름 또는 프롬프트에 예산 안내).
- [18:21] R-1 LOW [확실]: 문자열 진입 구간의 거동이 바뀐다. LLM 이 `lo`/`hi` 를 문자열로 주면 HEAD 는 `lo.toFixed is not a function` 으로 엔진 전체가 예외(cron 500)였는데, T-053 은 `(lo+hi)/2` 가 문자열 연결(예 '93000'+94000 → 4.65e9)이 돼 금액 판정이 먼저 걸려 `unaffordableSkipped=1`(200 OK, `errors` 비어 있음, 로그엔 "중간값 4650047000원")로 조용히 건너뛴다(격리 사본에서 HEAD·T-053 엔진 둘 다 실행해 확인; `lo` 누락(undefined)은 양쪽 모두 `toFixed` 예외). 카드가 안 생기는 안전한 방향이고 이후 결정을 계속 처리하는 장점도 있으나, 오류가 "금액 초과"로 오분류된다. Developer 절 "남은 위험 ④"의 "toFixed 에서 엔진 전체가 예외" 서술은 문자열 구간에 대해 더 이상 맞지 않는다 — 정정하거나, 비차단 후속으로 `typeof number && isFinite` 검증을 필터 앞에 두고 `errors.push('bad_zone:…')` 로 분리할 것.
- [18:21] R-2 LOW [가능성 높음]: 지정가 추격 공식이 entry-watcher·`service.buildOrderRequest`·엔진 3곳에 복제돼 있고, 엔진 쪽 일치는 계약 테스트가 아니라 이번 감사의 격자 검증으로만 보증된다. T-051 이 같은 `entry-watcher/route.ts` 를 병행 수정 중이라 이후 사이징이 바뀌면 필터가 조용히 어긋난다(과도 제외 또는 수량 0 카드 통과). 비차단 후속 권고: `computeChasedPrice` 공용 헬퍼 추출 또는 패리티 테스트.
- [18:21] R-3 INFO: `signals.price` 가 `DECIMAL(36,8)` 이라 약 5e-9 폭의 창(예 99,502.487562189 → 저장 99,502.48756219)에서 필터는 통과하고 실행은 수량 0 이 될 수 있다. LLM 구간이 정수 단위라 중간값이 0.5 의 배수여서 도달 불가에 가깝다. R-4 INFO: 중간값 99,502.5 만 로그가 "1주 지정가 100000원 > 카드 금액 100000원" 으로 보인다(`Math.round`) — 표기뿐. R-5 INFO: 이미 만들어진 pending 카드(10-19 16:47 의 19183·19185·19187, valid_from 10-20 09:00, 1주 > 10만 원)는 필터가 막지 못한다 — 신규 생성만 막으므로 사용자가 직접 거절하거나 10-20 15:30 만료를 기다려야 한다(Leader 보고에 포함).
- [18:21] 변이 재현·추가: Developer 20종(`python3 -I mutate_t053.py`) 재현 = 18 killed · 2 survived(M4·M4b 해외 적용, 등가 확인). 직접 만든 17종(`scratchpad/rv53/mutate_rv53.py`): `Math.round` 판정, `raw ≤ 1`, 추격 합(`+`), 경계 `>=`/`> amount+1`, 추격률 예외 시 throw, 후보마다 `getStyleConfig` 호출, 기본 금액 50000, 상수 ≠ SQL 리터럴, 추격률 ×100, 건수 필드 미증가, 결과를 0 으로 고정, 추격 방향 반대, 사이징 `market` 주문 유형, `requestedQuantity` 주입, `÷2` 누락 → 16 killed · 1 survived(`sizeOrderQuantity` 의 `market:'overseas'` — 정수 수량이라 `floor` 항등인 등가 변이). 모든 변이는 격리 사본에서만 하고 원복했다.
- [18:21] 직접 실행(격리 사본 = HEAD `22aa440` + 감사 대상 2파일): `npx jest …/post-market-engine.test.ts` 55 pass · 전체 `npx jest` 146 suites / 3165 tests pass · `npx tsc --noEmit` 오류 0. 직접 만든 임시 테스트(패리티 격자·문자열 구간)는 격리 사본 밖 `scratchpad/rv53/` 로 옮겼고 사본에는 남기지 않았다. 운영 DB 는 읽기 전용 SELECT 만 사용, post-market 엔드포인트·KIS·외부 API 호출 없음.
- [18:21] 확인하지 못한 것: 운영 cron(평일 16:00)에서 LLM 이 실제로 내는 구간의 형태 분포 · Codex C2 검토 결과(미접수 — 도착하면 채택/오탐 판정) · `next build` · 작업 트리 전체 `tsc`/`jest`(타 세션 미커밋 변경으로 오염) · 위 R-3 창을 실데이터로 밟는지.
- [18:21] QA 인계 high_risk_areas: `post-market-engine.ts:64-72`(판정 함수)·`:375-382`(추격률 조회)·`:396-412`(필터 블록·로그). 집중 항목: ① 추격 0.5% 에서 중간값 99,502.4(생성)/99,502.5(제외) 경계 ② 추격률 0·음수·NaN ③ 결과 JSON 이 `unaffordableSkipped` 추가뿐인지(기존 필드 키·형태) ④ 요약 로그 `금액 초과 N` ⑤ 문자열 구간(R-1)이 `errors` 없이 skip 되는 것을 알고 있는지 ⑥ 해외 호출이 `no_symbols` 로 끝나는지.
- [18:21] **최종 판정: PASS (scope: src/lib/strategy/post-market-engine.ts, src/lib/strategy/__tests__/post-market-engine.test.ts)**

## Leader 기록

- [10-19] 등록. judge 접수: `local_fix` · 복잡도 1.32 · 위험 R1 · (judge 추천 developer sonnet, 프로젝트 정책에 따라 Opus 로 진행: 전략 발화 안전 경로) · 데모 불필요 · 다음 `assign`.
- [10-19 18:3x] Reviewer **PASS**(Critical·High·Medium 0, LOW 2·INFO 3; 변이 37종 중 34 사망·3 등가 생존; 판정 기준 = 실제 수량 0 조건을 가격 20만 점×추격률 5종으로 DB 왕복 포함 비교해 불일치 0; 과도 제외 이력상 0장). judge C2: `codex_required=false`(규칙 `CX-limit-unknown-hold`, 위험 R1·카드를 덜 만드는 방향·주문 경로 불변) → **Codex 생략**. 이월: R-2 추격 공식이 entry-watcher·`service.buildOrderRequest`·엔진 3곳에 복제됨(패리티 테스트/공용 헬퍼 후속 — T-051 이 같은 `entry-watcher/route.ts` 를 병행 수정 중이라 어긋날 위험), R-3~R-5 INFO(이미 만들어진 pending 카드 3장 #19183·#19185·#19187 은 필터가 못 막음 — 사용자가 승인하지 않거나 15:30 만료 대기).
- [10-19] **미해결(사양 2, 사용자 결정 큐):** 개수 제한이 코드에 없고 "최대 5종목"은 LLM 프롬프트 문구뿐이라, 이 필터는 "수량 0 카드를 만들지 않는 데까지"다. 비싼 종목이 5자리 중 3자리를 쓰는 문제는 풀리지 않는다 → 선택지: (a) 프롬프트에 카드 금액·1주 상한을 알려 처음부터 살 수 있는 종목을 고르게 함(분석 성격이 바뀌는 변경) (b) LLM 호출 전 종가×여유폭 사전 필터. 코드 전에 사용자 의견을 구한다.

## Developer

- [18:10] 변경 파일(미커밋, 기준 HEAD `22aa440`): `src/lib/strategy/post-market-engine.ts` (sha256 앞 12자리 `1ca83d0d79cc`, +67/−1) · `src/lib/strategy/__tests__/post-market-engine.test.ts` (`7bb0a10073c6`, +209/−4). 그 밖의 파일은 수정하지 않았다(`signals/service.ts`·`strategy/style.ts` 는 import 만).
- [18:10] 기준 가격 근거: 카드 price = 진입 구간 중간값 `entryMid`(`post-market-engine.ts:396`, INSERT `price: entryMid` :452), 카드 금액은 SQL 리터럴 100000(:170). 실행 경로는 승인 → `approved_pending_entry` → entry-watcher 이며, 사이징 입력은 `basePrice = row.price` → `chasedPrice = basePrice × (1 + chasePct)`(chasePct > 0 이고 basePrice > 0 일 때만) → `sizeOrderQuantity({amountKRW: row.amount_krw, price: chasedPrice})` (HEAD `src/app/api/cron/entry-watcher/route.ts:175`·`:302-306`·`:314-320`; `chasePct = style.limitChasePct`, 기본 0.005 `style.ts:100`, 운영 DB 에 `style_default_limitChasePct` override 없음 — 10-19 SELECT 실측). 즉 **중간값과 사이징 기준이 어긋난다**(추격 0.5%). 중간값만 보면 99,503~100,000원 카드가 "필터 통과·수량 0" 이 되므로 사이징과 같은 기준(`중간값 × (1+추격률)` 을 `sizeOrderQuantity` 에 그대로 넣어 수량 0 인지)을 쓴다 → `cardBuysZeroShares()` (:64). 종가(`candidate.close`)는 쓰지 않는다: 실측 40장에서 중간값/종가 비가 0.960~1.013 이고 017670(종가 100,500 → 중간값 96,500, 1주 가능)처럼 종가 기준이면 실행 가능한 카드를 잘라낸다.
- [18:10] 🔴 사양 4 와 다른 점: "1주 가격 == 예산 → 수량 1" 은 **추격률 0 일 때만** 참이다. 운영값(0.5%)에서는 중간값 100,000원 카드가 지정가 100,500원 → 0주라 제외된다. 경계는 "추격 반영 지정가 == 카드 금액 → 만든다, +1원 → 제외" 로 테스트했다(추격 0 에서 100,000 생성 / 100,001 제외, 추격 0.5% 에서 99,500 생성 / 99,600 제외).
- [18:10] 🔴 사양 2(개수 제한 앞): **코드에 강제된 개수 제한은 없다**(결정 루프 :386~ 는 BUY 결정을 전부 INSERT, slice/top-N 없음). 유일한 제한은 프롬프트 문구 "최대 5종목 BUY 선택"(`buildPrompt` 끝, LLM 지시)이고, 기준 가격인 진입 구간은 **LLM 응답 뒤에야** 생긴다. 그래서 정확한 필터를 그 제한 앞(LLM 호출 전)에 둘 수 없다. 종가 기반 사전 제외는 위 017670 사례처럼 실행 가능한 후보를 잘라내므로 넣지 않았다. → **10-19 처럼 LLM 이 비싼 종목 3개로 5자리 중 3자리를 쓰는 문제는 이번 변경으로 풀리지 않는다**(카드 3장이 안 생길 뿐, 그 자리를 다른 후보가 채우지 않는다). 풀려면 Leader 판단이 필요: (a) LLM 전 후보를 종가 × 여유폭으로 거르는 별도 파라미터, (b) 프롬프트에 카드 금액·1주 상한을 알려 주는 변경(prompt 담당). dedup(:298~307, 종목당 1개)은 필터 앞이며 변경 없다.
- [18:10] 사양 5(국내만): 해외는 `loadSymbols('overseas')` 가 `[]` 를 돌려 `no_symbols` 로 먼저 끝나고(:196-199, :268-271), INSERT 는 `market='domestic'` 고정(:170), `sizeOrderQuantity` 는 해외 USD 가격을 KRW 예산과 환산 없이 나눈다(HEAD `service.ts:199` 주석). 그래서 필터와 추격률 조회 모두 `market === 'domestic'` 조건 안에 두었다(지금은 도달 불가지만 해외 카드가 구현될 때 KRW 비교가 조용히 적용되지 않게).
- [18:10] 구현: 다른 필터(BUY 아님·필수 값 없음·신뢰도 < 60)를 그대로 먼저 적용한 뒤 INSERT 직전에 판정 → 제외 시 `unaffordableSkipped++`·`signalsSkipped++`(duplicatesSkipped 와 같은 관례)·`continue`, 종목별 로그 `[post-market] 💸 <종목> 금액 초과 — 1주 지정가 N원 > 카드 금액 100000원 (진입 구간 중간값 M원, 지정가 추격 0.50%)`, 요약 줄에 `금액 초과 N`. 결과 JSON 에 `unaffordableSkipped` 추가(마지막 정상 경로 return 에만 — `duplicatesSkipped` 와 같다; 기존 필드 불변). 카드 금액은 `POST_MARKET_CARD_AMOUNT_KRW` 상수로 두고 SQL 리터럴과 같음을 테스트로 대조(SQL 문자열은 바꾸지 않음 — T-045 R-3 고정 테스트 유지). 추격률을 읽다 예외면 0 으로 판정(경고 로그만, `errors` 불변) — 덜 걸러질 뿐 실행 가능한 카드를 자르지 않는다. 가격 0·음수·NaN 은 `sizeOrderQuantity` 가 수량을 정하지 않아 필터가 판정하지 않는다(기존 동작).
- [18:10] 기존 테스트 변경(의도 불변, 값만): 공용 픽스처 `buy()` 기본 구간 310,000~314,000 → 93,000~94,000 (예전 값은 이제 정상적으로 제외되기 때문), 그에 따른 단언 2곳(`params[2]` 312000→93500, `price_zone`). `../style` 목 추가(엔진이 `getStyleConfig` 를 부르면 공용 `query` 목의 INSERT 응답 순서를 먹어 버리므로). T-045/T-046 테스트 본문의 판정 대상(주말 스킵·NOT EXISTS·ER_DUP_ENTRY·KST 저장·duplicatesSkipped)은 그대로이고 모두 통과.
- [18:10] TDD: 수정 전 엔진(HEAD)으로 새 테스트 실행 → **20 failed / 35 passed**(새 20건 전부 실패, 기존 35건 통과) → 구현 후 **55 passed**.
- [18:10] 변이 시험(격리 사본, `scratchpad/mutate_t053.py`, 결과 `t053-mutation2.out`): 20개 중 18 KILLED — 경계 `===0`→`<=1`(>= 효과), 필터 제거, 필터를 INSERT 뒤로 이동, 기준가→종가·추격 무시 중간값·구간 상단·하단, continue 제거·break, signalsSkipped 미포함, 오류 시 추격 0.005 폴백, 추격률 미조회, 추격 방향 반대, 다른 필터보다 먼저 판정, 결과 필드 누락, 로그 가격·요약 건수 누락, 음수 추격 그대로 적용. **SURVIVED 2: "해외에도 적용"(두 곳)** — 해외는 `no_symbols` 로 필터 전에 끝나 도달 불가한 등가 변이라 테스트로 죽일 수 없다(가드는 장래 대비 문서 역할).
- [18:10] 격리 사본(`scratchpad/t053repo`, HEAD `22aa440` archive + 변경 2파일 cp, 원본과 `cmp` 일치): 수정 전 기준선 tsc 오류 0 · jest 146 suites/3145 tests 통과 → 수정 후 **tsc 오류 0 · jest 146 suites/3165 tests 통과**(+20). lint 는 저장소에 ESLint 설정이 없어 실행 불가(`next lint` 는 대화형 초기화).
- [18:10] DB 는 읽기 전용 SELECT 1회(`scratchpad/t053_q1.js`: post-market 최근 40장 price/close/zone, style override) — 40장 중 27장 > 10만 원 재확인. post-market 엔드포인트 호출·커밋·배포 없음.
- [18:10] 남은 위험: ① 위 사양 2 미해결(LLM 5자리 문제). ② 추격률은 **생성 시점** 값으로 판정 — 실행 전에 `style_default_limitChasePct` 를 바꾸면 경계 부근(±추격률 폭)에서 판정이 어긋날 수 있다. ③ `service.ts` 의 `executeSignal` 경로는 `safety_limit_chase_disabled` 스위치가 켜지면 추격 0 을 쓰지만 entry-watcher 는 이 스위치를 보지 않는다(`getEffectiveChasePctSync`) — 이 필터는 entry-watcher 기준(스위치 무시)을 따랐다. 스위치가 켜진 상태에서 즉시 실행 경로로 가는 99,503~100,000원 카드는 실제로는 1주 가능한데 제외된다(폭 0.5%, 드묾). ④ 기존 결함(범위 밖, 손대지 않음): LLM 이 `entry_zone.lo/hi` 를 문자열로 주면 `toFixed` 에서 엔진 전체가 예외로 끝난다. **[Reviewer R-1 정정: T-053 이후에는 `(lo+hi)/2` 가 문자열 연결이 되어 "금액 초과"로 조용히 건너뛴다(200 OK, errors 비어 있음) — 카드가 안 생기는 안전한 방향이지만 오류가 오분류된다. 이 서술은 더 이상 맞지 않는다.]**
- [18:10] 안전장치 self-check: 주문 송신 경로·submitOrder·KILL_SWITCH·한도·블랙리스트 코드 변경 없음(카드 생성 단계 필터만 추가, 카드를 덜 만드는 방향). Reviewer 재현: 격리 사본에서 `npx jest src/lib/strategy/__tests__/post-market-engine.test.ts` (55 통과 기대), `python3 -I scratchpad/mutate_t053.py` (18 KILLED / 2 SURVIVED 기대). curl 대상 엔드포인트 없음(운영 DB 에 카드를 쓰므로 호출 금지).
