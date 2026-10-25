---
task_id: T-086
title: D0 — 거래 리포트가 재고 없는 매도를 "대금 전액 이익"으로 계산하는 오류 수정 (원가 미상 분리)
status: done
priority: high
roles_involved: [leader, developer, reviewer, qa, judge, codex]
related_tasks: [T-081, T-019, T-087]
tags:
  - type/task
  - domain/reports
aliases:
  - D0원가미상
created: 2026-10-25
updated: 2026-10-25
base_ref: aa51dd05cb1ee057f806f05b3578a0fc570cfdf7
risk_level: R2
developer_model: opus
waiting: []
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-086 — D0: 원가 미상 매도를 이익으로 세지 않는다

> **수익 경로 연결(제1원칙)**: 지금 사용자가 보는 실현손익 숫자가 틀린 방향으로 부풀려질 수 있다. 앱이 접수·체결한 주문 17건은 전부 매도이고(매수 0건) 취득 원가가 앱 밖에 있으므로, 이 계산은 "원가 0 으로 판 것"으로 읽어 대금 전액을 이익으로 더한다. 수익이 존재 이유인 프로젝트에서 **틀린 이익**은 틀린 손실보다 해롭다 — 잘 되고 있다는 오판을 만든다. 근거: `docs/reports/2026-10-22-profitability-audit.md` F02, 설계 `docs/design/2026-10-25-wpd-broker-fills-design.md` §1 F2·§7 D0.

## 사용자 결정 (2026-10-25, 원문 "DDL적용 승인 / 모든 작업들에 대하여 권고대로 착수 진행해줘")
보고서의 "별도 제안: D0 소형 작업 — 거래 리포트가 재고 없는 매도를 '대금 전액 이익'으로 계산하는 오류를 먼저 고친다" 를 권고대로 진행.

## 문제 (코드 근거, `src/lib/reports/trade-report.ts:183-232` `computeLifoPnl`)
- LIFO 재고가 비어 `costBasis = 0` 이고 `matchedQty = 0` 인데 `r.price != null` 이면 `sellRevenue = r.amount_krw` (price 분기 불성립 → amount_krw 폴백) → `pnl = amount_krw − 0 − fee` = **매도대금 전액 이익.**
- 재고가 일부 있으면 `matchedQty > 0 && price != null` 로 `sellRevenue = price × matchedQty` — 초과분(원가 미상 수량)은 **누락(과소 계상)**. `price == null` 이면 `amount_krw` 전액 vs 부분 원가로 **과대 계상**.
- 결과를 쓰는 곳: `trade-report.ts:336` `lifo = computeLifoPnl(...)`, `src/app/api/cron/trade-report/route.ts:249` `lifoPnlKRW: Math.round(report.lifoPnlKRW)` 외 소비자(Developer 가 grep 으로 전수 확인: `src/lib/http.ts`, `src/lib/safety/order-sync.ts`, `src/lib/safety/snapshot-cleanup.ts`, `src/app/api/settings/safety/route.ts`, `src/app/api/research/tracked/…`).

## 설계 방향 ("불명 우선" — WP-F 월 수익률과 같은 원칙)
1. `computeLifoPnl` 은 **원가를 아는 부분(재고와 매칭된 수량)만** 손익에 넣는다. 매칭 수량 비례로 매도대금·수수료를 배분한다(수수료 `r.fee` 는 매칭 비율만큼).
2. 재고가 모자라 매칭 못 한 수량은 **이익도 손실도 아닌 "원가 미상"** 으로 따로 센다: 반환값에 `unmatched`(종목별 미매칭 수량·건수)와 `unmatchedSellCount` 를 추가한다. 기존 반환 필드 `totalKRW`·`perSymbol` 의 의미는 "원가를 아는 부분의 합"으로 **좁아진다** — 이 변경을 호출부 전부가 인지하도록 타입으로 드러낸다(필드 이름을 바꾸지 않고 의미만 바꾸면 소비자가 모르고 낡은 의미로 읽는다 → 새 필드를 추가하고, 소비자는 `unmatchedSellCount > 0` 이면 합계에 "원가 미상 매도 N건 제외" 표지를 붙인다).
3. 리포트 출력(텔레그램·슬랙·화면용 문자열)에는 `원가 미상 매도 N건 — 실현손익에서 제외` 문구를 넣는다. 숫자를 지우지 않되 **부분합임을 숨기지 않는다.** 모든 매도가 미상이면 합계 칸은 숫자 대신 `원가 미상`.
4. `rangeStart` 이전 prefetch 로 재고를 만드는 기존 동작·`executions` 비율 축소(T-019)·`price` 없는 매수의 `amount_krw/quantity` 폴백은 **바꾸지 않는다.**
5. 이 task 는 **브로커 원가를 가져오지 않는다**(그건 T-087 D1a 수집 + D2/D3 몫). 오직 "모르는 걸 이익으로 세지 않기" 만 한다.

## 범위 / 비범위
- 수정: `src/lib/reports/trade-report.ts` (+ 그 반환값을 쓰는 소비자의 최소 수정). 시험: 기존 시험 보존 + 새 시험.
- 비범위: DB 변경 없음, 마이그레이션 없음, 신규 화면 없음(기존 리포트 문구 변경만 — 데모 게이트 `none`), KIS 호출 없음, 주문 경로 변경 없음.
- 확인 사항: 소비자 중 `src/app/api/cron/` · `src/app/api/settings/safety/` · `src/lib/safety/` 는 SAFETY_PATHS 대상 → 수정하게 되면 Reviewer scope 에 포함해야 한다. Developer 는 "수정한 파일 중 SAFETY_PATHS 에 걸리는 것" 목록을 보고서에 적는다(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`).

## 시험 요구 (수치는 합성 값)
1. 재고 없음 + 매도 → 손익 0 기여, `unmatched` 에 수량 기록, 합계가 매도대금만큼 늘지 않는다 **(F02 회귀)**.
2. 재고 일부 + 더 큰 매도 → 매칭분만 `price × matched − cost − fee×비율`, 초과분은 `unmatched`.
3. 재고 충분 → 기존 결과와 **완전히 동일**(기존 시험 전부 그대로 통과).
4. `price == null` 매도: 매칭분만 `amount_krw × (matched/qty)` 로, 미매칭분은 `unmatched`.
5. `rangeStart` 이전 매도(재고만 소진)는 손익·`unmatched` 에 들어가지 않는다(기간 밖).
6. 리포트 문자열: `unmatchedSellCount > 0` 이면 표지 문구가 들어가고, 0 이면 기존 문자열과 동일.
7. 소비자(cron route 등)가 새 필드를 무시해 낡은 의미로 읽는 경로가 없는지 정적 점검 시험(필드 사용 지점 목록).

## 단계
Developer → Reviewer(scope: 수정 파일 전부, SAFETY_PATHS 포함분 명시) → (judge C2 → Codex 필요 시) → QA(직접 실행) → 명시 경로만 커밋 → push.

## 완료 기준
- F02 회귀 시험 통과, 기존 시험 무회귀, `npx tsc --noEmit`·eslint 통과.
- 운영 DB 합성 없이 읽기 전용 실측: 현재 `orders` 17건 filled(전부 매도)로 계산했을 때 **이전 결과(전액 이익)와 새 결과(원가 미상 17건 제외)** 를 비교해 최종 요약에 숫자 없이 "달라졌다/같다" 만 적는다(금액 실값은 문서에 쓰지 않는다).

## 판단 기록 (judge)
- 2026-10-25 19:3x intake #1(규칙 엔진 폴백): 요약문의 부정문 "주문 경로 변경 없음" 에 `DM-kw-risky-cta`(RISKY_OBJECT `주문` + RISKY_CHANGE `변경`)가 걸려 데모 `delta`·`next=demo_first` 로 나왔다. 정규식이 부정문을 구분하지 못한 **오탐**(화면·CTA 변경 없음). 결과 `docs/design/judge-result-T-086-intake.json` 보존.
- 2026-10-25 19:4x intake #2(`-clarified`, 선례 T-077): 부정문을 뺀 정확한 범위 요약("화면 컴포넌트와 DB 는 바꾸지 않는다")으로 재실행 → risk R1, developer opus, 데모 **none**, next=assign. 결과 `docs/design/judge-result-T-086-intake-clarified.json`. 재실행은 Leader 권한(데모 게이트 절차서 Leader 행)이며 **데모 생략(waive)이 아니다.**
- **안전 조건(데모 게이트 보존)**: 이 task 는 `.tsx` 화면 컴포넌트를 수정하지 않는다. Developer 가 소비자 조사에서 화면에 표시되는 경로(`lifoPnlKRW` 등을 렌더링하는 컴포넌트)를 발견하면 **수정하지 말고 Leader 에게 보고** — 그 표시 변경은 designer 데모 게이트 대상이다.
- Leader 보정: 소비자 중 `src/app/api/cron/`·`src/lib/safety/`·`src/app/api/settings/safety/` 는 SAFETY_PATHS → 수정하면 Reviewer scope 에 포함.

## Developer 기록
- [20:48] 구현 완료(미커밋, git 조작 없음). base_ref 이후 작업 트리 기준.
- [20:48] 수정 파일: `src/lib/reports/trade-report.ts` · `src/app/api/cron/trade-report/route.ts`(응답 JSON 2필드 추가) · `src/lib/reports/__tests__/trade-report-partial-fill.test.ts`(기대값 1건 갱신) · 신규 `src/lib/reports/__tests__/trade-report-unmatched-sell.test.ts`.
- [20:48] `computeLifoPnl` 반환 타입을 `LifoPnlResult` 로 명시: `totalKRW`·`perSymbol`(원가를 아는 부분만) + 신규 `unmatched: Map<symbol,{quantity,sellCount}>`·`unmatchedSellCount`(원가 미상 수량이 있던 기간 내 매도 건수, 부분 매칭 포함)·`matchedSellCount`(원가를 아는 수량이 조금이라도 있던 건수).
- [20:48] 계산 규칙: 매칭 수량 > 0 일 때만 손익 반영. 비율 = 전량 매칭이면 정확히 1, 아니면 matched/qty. 매출 = price 있으면 `price × matched`(예전 식), 없으면 `amount_krw × 비율`. 수수료 = `fee × 비율`. 전량 매칭은 예전 식과 같은 값이 나오도록 비율 1을 그대로 쓴다(시험에서 근사가 아닌 `toBe` 로 대조). 수량 0 이하·NaN 매도는 원가 미상으로 센다(예전엔 대금 전액 이익). prefetch 재고·T-019 비율 축소·price 없는 매수 폴백은 손대지 않았다.
- [20:48] `TradeReport` 에 `unmatchedSellCount`·`matchedSellCount` 필수 필드 추가, `SymbolPnl` 에 `unmatchedSellCount`·`unmatchedQty` 추가. `lifoPnlKRW`·`realizedKRW` 이름은 유지하고 JSDoc 에 "원가를 아는 부분만의 합" 의미를 명시.
- [20:48] 리포트 문자열(`formatLifoPnlLines`, `formatReportMessage` 의 LIFO 분기만): 미상 0건이면 예전 한 줄 그대로 / 일부 미상이면 숫자 유지 + `• 원가 미상 매도 N건 — 실현손익에서 제외` / 전부 미상이면 `• 실현 손익: 원가 미상` + 같은 표지 줄. 문구는 `UNMATCHED_SELL_NOTE()` 한 곳에서 만든다.
- [20:48] 표지를 넣지 않은 곳: `candidates.sellPnl`(exit-engine indicators 기반 "매도 손익" 섹션) 분기. 이 분기는 `lifoPnlKRW` 를 표시하지 않고 별도 계산(`entry_price × qty`)을 쓴다 — Leader 확인 사항으로 보고.
- [20:48] 소비자 전수표(`grep -rnE "computeLifoPnl|lifoPnlKRW|trade-report" src`): ① `src/app/api/cron/trade-report/route.ts:249` `lifoPnlKRW` 응답 JSON — 반영함(`unmatchedSellCount`·`matchedSellCount` 동봉) ② `src/lib/reports/trade-report.ts` 내부(`buildTradeReport`·`formatReportMessage`) — 반영함 ③ `src/app/api/research/tracked/route.ts:12`·`[symbol]/run/route.ts:24` — `fetchCurrentQuotes` 만 import, 해당 없음 ④ `src/lib/http.ts:47`·`src/lib/safety/snapshot-cleanup.ts:19`·`src/lib/safety/order-sync.ts:112,252,261,1083,1192,1211,1253,1320`·`src/app/api/settings/safety/route.ts:204` — 주석 언급뿐, 해당 없음(수정 안 함) ⑤ `src/lib/__tests__/currency-mixing-fence.test.ts:50,67` — 파일 경로 문자열, 해당 없음 ⑥ 라우트 시험 2개의 mock 객체 — 새 필드 없이도 통과(수정 안 함).
- [20:48] 화면 컴포넌트: `.tsx` 중 `lifoPnlKRW`·`computeLifoPnl` 을 렌더링·호출하는 파일 0건(정적 점검 시험으로 고정). `.tsx` 수정 없음.
- [20:48] SAFETY_PATHS 해당 수정 파일: `src/app/api/cron/trade-report/route.ts` 1개(`^src/app/api/cron/`). `src/lib/reports/` 는 해당 없음.
- [20:48] 기존 시험 변경 1건: `trade-report-partial-fill.test.ts` "회귀 — 주문 수량(10주)으로 계산하면…" 의 기대값이 바로 F02 결함 동작(재고 빈 7주 매도를 대금 전액 이익으로 더함)을 고정하고 있어 `100 + 630` → `100` + `unmatchedSellCount 1`·미상 7주로 갱신. 참값(−40)과 다르다는 단언은 유지.
- [20:48] 시험: `npx jest src/lib/reports src/app/api/cron/trade-report` → 8 suites / 139 tests 통과. 회귀 `npx jest src/lib/safety src/app/api/cron src/app/api/settings/safety src/lib/__tests__/currency-mixing-fence.test.ts src/lib/__tests__/http.test.ts src/lib/reports` → 62 suites 통과·1 skipped / 1428 통과·14 skipped·실패 0. 새 시험 파일은 요구 1~7(F02 회귀·부분 매칭·재고 충분 동일성 6케이스·price 없음·기간 밖 매도·문자열 3형태·소비자 정적 점검 3건)을 덮는다.
- [20:48] `npx tsc --noEmit` 전체 → 오류 0. eslint: 저장소에 ESLint 설정 파일이 없어 `npx eslint` 가 "configuration file 없음"으로 실행 불가, `next lint` 는 대화형 설정 질문을 띄워 중단(파일 생성 없음 확인). 린트는 실행하지 못했다.
- [20:48] 운영 DB 읽기 전용 실측(`SET SESSION TRANSACTION READ ONLY` + `START TRANSACTION READ ONLY`, `@@session.tx_read_only`=1 확인, SELECT 1회 후 ROLLBACK, 앱 `@/lib/db` 미사용): `orders` filled 17건(매도 17·매수 0). HEAD 의 `computeLifoPnl` 과 현재 코드를 같은 행에 돌린 결과 — 합계 **달라졌다**(예전 양수 → 새 0), 새 `unmatchedSellCount` 17·`matchedSellCount` 0 → 리포트에는 "실현 손익: 원가 미상" + 표지 17건 형태가 된다. 금액 실값은 출력·기록하지 않음. 스크립트: scratchpad `t086/compare.js`.

## Reviewer
- [20:55] 감사 범위: `src/lib/reports/trade-report.ts` · `src/app/api/cron/trade-report/route.ts`(SAFETY_PATHS `^src/app/api/cron/` 해당 → 판정 scope 포함) · `src/lib/reports/__tests__/trade-report-partial-fill.test.ts` · `src/lib/reports/__tests__/trade-report-unmatched-sell.test.ts`. 구현자 보고는 믿지 않고 `git diff`·직접 실행으로 판단. 감사한 파일은 작업 트리의 미커밋 상태이며 스크래치 스냅샷과 현재 파일이 동일함을 확인했다(감사 중 변경 없음).
- [20:55] 기준 커밋 주의: 감사 시작 때 HEAD 는 aa51dd05 였으나 감사 도중 다른 세션(T-084 앱 M1)이 2커밋(46d4148·b435399, 20:52)을 만들어 HEAD 가 b435399 로 이동했다. 두 커밋은 `src/lib/reports`·`src/app/api/cron/trade-report` 를 건드리지 않았고(`git diff aa51dd05 HEAD -- 두 경로` 비어 있음) 이전 구현 대조본은 aa51dd05 의 파일과 바이트 동일 확인. 감사 전후 `git diff --cached --stat` 비어 있음(스테이징 없음).
- [20:55] 계산 정확성(줄 단위 손 추적): ① 재고 없음 → `toRemove`=수량, `matchedQty`=0, `fullyMatched`=false → 원가 미상 1건·손익 0 기여. ② 재고 일부 → 비율=`matched/qty`∈(0,1), 매출 `price×matched`(price 없으면 `amount_krw×비율`), 수수료 `fee×비율`, 원가는 스택이 소진된 매칭분만이라 자기일관. ③ 재고 충분 → 비율을 1 로 고정해 `price×matchedQty`·`amount_krw`·`fee` 가 예전 식과 같은 연산을 탄다. ④ 0 나눗셈 없음(비율은 `validQty`(유한·양수) 안에서만 계산), 비율>1 불가(`toRemove` 는 시작값=수량에서 양수 lot 만큼만 줄어듦), 매도별 독립 계산이라 누적 오차 없음. ⑤ 수량 0·음수·NaN 매도 → 원가 미상으로 센다(예전엔 `amount_krw` 전액 이익). ⑥ `rangeStart` 이전 매도 → 재고만 소진, 손익·미상 어디에도 안 들어감. ⑦ 같은 종목 매수-매도 교차에서 부분 매칭 뒤 새 매수가 들어와도 재고 상태가 올바르게 이어짐(교차 케이스 손계산 22 → 23: 수수료 3×2/3 만 반영, 일치).
- [20:55] 이전 구현 대비 속성 비교(스크래치패드 `t086-reviewer/prop.js`: `git show` 로 받은 이전 `computeLifoPnl` 과 현재 것을 TypeScript 컴파일해 같은 입력으로 실행, 무작위 20,000건·분수 수량 절반·price 없는 매수/매도·수수료·기간 경계·3종목 혼합): 새 구현이 "원가 미상 0건"으로 판정한 12,453건에서 이전 `totalKRW`·종목별 `perSymbol` 이 `Object.is` 로 완전 일치(불일치 0), `unmatched` 맵 비어 있음. 원가 미상이 있는 7,547건은 정수 스케일(수량×10)을 쓰는 별도 독립 오라클로 재계산해 총합(상대 1e-6)·`unmatchedSellCount`·`matchedSellCount`·종목별 미상 수량 전부 일치(불일치 0). 부분 매칭에서 이전과 달라지는 것은 의도대로 두 가지뿐 — 초과분 대금 누락(price 있음)/전액 과대(price 없음)이 매칭분만으로 바뀌고, 수수료가 `fee`→`fee×비율`.
- [20:55] 경계값 직접 실행(스크래치 `edge.js`): NaN·0·음수 수량 매도 → 이전 `+500`(대금 전액) → 새 `0`·미상 1건(수량 0). `0.1+0.2` 대 `0.30000000000000004` 부동소수 → 이전과 완전 동일·미상 0. 매도가 재고를 5e-13 초과 → 허용오차 안이라 전량 매칭(이전과 동일). 2e-12 초과 → 미상 1건·수량 2e-12(기존 `1e-12` 절대 허용오차와 같은 기준, 운영 수량은 정수 주식이라 도달하지 않음). 수수료 비례(8, 1/4) → 이전 12 → 새 18. 한 가지 구멍은 지적 L-1 로 적는다.
- [20:55] 기존 시험 기대값 변경의 정당성: `git diff` 상 삭제된 줄은 4줄뿐(구조분해·주석 2줄·`toBeCloseTo(100+630)`) 이고 같은 시험의 나머지 단언(`not.toBeCloseTo(-40)`)은 유지됐다. 이 시험의 의도는 "부분체결을 주문 수량(10주)으로 잘못 기록하면 올바른 값(−40)에서 벗어난다"는 T-019 반례의 증명이고, 올바른 입력(체결 3주)으로 −40 이 나오는 바로 위 시험(88행)은 한 줄도 안 바뀌고 통과한다. 예전 기대값 `+730` 은 재고가 빈 7주 매도의 대금 630 을 전액 이익으로 더한 값이라 F02 결함 그 자체를 정답으로 고정하고 있었으니 구현자의 설명은 사실이다. 새 값 `+100`(첫 매도 매칭분만)·미상 1건·7주는 손으로 다시 계산해 일치. T-019 의 의도(수량·금액 정합성)는 훼손되지 않는다. 다른 기존 시험은 `git diff --name-only -- src/lib/reports src/app/api/cron` 가 변경 3파일뿐이고 그중 시험은 이 1건뿐 — 기대값을 몰래 바꾼 곳 없음. `trade-report.test.ts`·라우트 시험 2개·total-unknown 시험들은 무변경 통과.
- [20:55] 소비자 전수(`grep -rnE "computeLifoPnl|lifoPnlKRW|\.lifo|unmatchedSellCount|matchedSellCount|realizedKRW|churnSymbols|buildTradeReport|formatReportMessage"` 를 src·scripts 에): `computeLifoPnl` 호출은 `trade-report.ts` 내부 `buildTradeReport` 1곳뿐. `lifoPnlKRW` 를 읽는 운영 코드는 `trade-report.ts`(`formatLifoPnlLines` — 새 필드와 함께 읽음)와 `cron/trade-report/route.ts`(응답 JSON — 새 필드 동봉)뿐. `realizedKRW` 를 읽는 곳은 같은 파일의 정렬(`|realizedKRW|`)뿐이고 메시지에 종목별 실현손익을 찍는 곳은 없다(`churnSymbols` 는 사이클 수 기반이라 의미 불변, 단 종목 순서가 `|realizedKRW|` 정렬을 따르므로 원가 미상이 있을 때 "회전매매" 줄의 종목 나열 순서만 달라질 수 있다 — 집합은 6,000회 비교에서 항상 동일). `src/lib/safety/*`·`http.ts`·`snapshot-cleanup.ts`·`settings/safety/route.ts` 는 주석 언급뿐, `research/tracked/*` 는 `fetchCurrentQuotes` 만 import. `scripts/` 에 응답 필드를 파싱하는 곳 없음(`cron-runner.sh` 는 200 이면 `OK` 만 찍고 본문을 버린다). 구현자의 소비자 처리표는 사실이다. 낡은 의미로 읽는 소비자 없음.
- [20:55] 화면: `grep -rnE "lifoPnl|cron/trade-report|trade-report|실현 ?손익" src --include=*.tsx --include=*.jsx` 결과 0건 — `.tsx` 가 `lifoPnlKRW`·리포트 문구를 렌더링하지 않는다(데모 게이트 `none` 전제 유지). 정적 점검 시험 3건(호출자 1곳·읽는 파일 목록 고정·`.tsx` 0건)이 같은 사실을 고정한다. `sellPnl`·`headerPnlKRW`·`sellsAmountKRW` 는 이번에 손대지 않았고 메시지에 실리는 것은 `sellPnl`(별도 소스)·거래 요약 금액뿐이다.
- [20:55] 리포트 문구 3형태: 원가 미상 0건이면 `[• 실현 손익: ±₩N]` 한 줄 그대로. 이전 구현·현재 구현의 `buildTradeReport`+`formatReportMessage` 를 같은 입력(분수 수량 포함, 후보 없음/`sellPnl` 있음 2형태 × 3,000 입력 = 6,000 메시지)으로 돌려, 원가 미상 0건인 2,298건이 `Buffer.compare` 로 바이트 동일(불일치 0). 일부 미상이면 숫자를 유지하고 바로 아래 `• 원가 미상 매도 N건 — 실현손익에서 제외` 를 붙인다. 전부 미상(`matchedSellCount`=0)이면 `• 실현 손익: 원가 미상` — `+₩0`/`₩0` 이 나오지 않는 것을 시험(`not.toMatch(/실현 손익: [+−]?₩/)`)과 직접 실행으로 확인. 0 과 모름이 구분된다. 숫자를 숨기지 않는다. `formatLifoPnlLines` 는 `unmatchedSellCount` 가 undefined 인 낡은 mock 이 와도 예전 한 줄로 안전하게 떨어진다. 텔레그램 HTML 변환에 문제될 문자(`< > &`)는 없다.
- [20:55] route JSON 호환: 응답에 `unmatchedSellCount`·`matchedSellCount` 두 필드가 **추가만** 됐고(3줄 추가·삭제 0), 기존 필드 이름·타입·값 계산은 그대로다. 라우트 시험 2개(`route.test.ts`·`route-total-unknown.test.ts`)는 mock 객체에 새 필드가 없어도 통과(JSON 직렬화에서 undefined 는 생략) — 운영에서는 `buildTradeReport` 가 항상 숫자를 채운다. 이 라우트를 기계 파싱하는 소비자가 저장소에 없다.
- [20:55] 시험 직접 실행: `npx jest src/lib/reports src/app/api/cron/trade-report` → 8 suites / 139 tests 통과(구현자 보고와 일치). 구현자의 전체 회귀 묶음(`src/lib/safety src/app/api/cron src/app/api/settings/safety src/lib/__tests__/currency-mixing-fence.test.ts src/lib/__tests__/http.test.ts src/lib/reports`) → 62 suites 통과·1 skipped / 1428 통과·14 skipped·실패 0(일치). 지시된 회귀(`src/lib/safety src/app/api/cron src/app/api/settings/safety`) → 54 suites 통과·1 skipped / 1304 통과·14 skipped·실패 0. `npx tsc --noEmit` 전체 → 출력 없음(오류 0). eslint 는 저장소에 설정이 없어 구현자와 같은 이유로 실행하지 못했다(내가 생성하지 않음).
- [20:55] 비범위 침범 없음: DB 변경·마이그레이션 없음, `.tsx`·화면 없음, 주문 경로·`kill-switch`·`src/lib/safety/` 무변경, 변경 파일은 감사 대상 4개뿐(`git diff --name-only -- src/lib/reports src/app/api/cron` 3개 + 신규 시험 1개). 작업 트리의 `docs/mobile-app-procedure.md`·`scripts/git-hooks/commit-msg`·`scripts/test-git-hooks.sh` 등 다른 변경은 T-084/T-085 소유라 이번 감사 범위가 아니다. 이 계산의 결과가 킬스위치·주문 한도·시그널 판정으로 흘러가는 경로는 없다(호출자 1곳이 메시지 문자열과 응답 JSON 만 만든다).
- [20:55] 민감값: 새 시험·task 문서에 8자리 이상 숫자열·계좌 형태·키/토큰 문자열 0건(`grep -nE`). 새 시험의 종목은 `A`·`AAA`·`BBB` 합성값, 금액은 3자리 이하 합성 정수. task 문서에 운영 금액 실값 없음("달라졌다" 한 줄만).
- [20:55] 범위 밖 의견 — `candidates.sellPnl` 폴백: `fetchSignalCandidates` 의 `pnlKRW = costBasis > 0 ? sellAmt − entry×qty : pnlPct/100 × sellAmt` 에서 `entry_price`(시그널 지표 JSON)가 없을 때의 폴백은 "대금 전액 이익"이 아니라 수익률×매도금액이라 F02 와 같은 부류의 결함은 아니다(다만 수식은 `pnlPct/(100+pnlPct)` 가 정확하므로 |수익률|% 만큼 과대 계상되는 근사). 이번 변경으로 새로 노출되는 위험은 직접 없음 — 그러나 F02 수정 뒤에는 `sellPnl` 이 있는 날 "매도 손익" 절이 사용자가 보는 유일한 실현손익 숫자가 되므로(`else if` 구조라 그날은 LIFO 줄과 원가 미상 표지가 통째로 안 나간다) `indicators.entry_price` 의 출처(앱 밖에서 산 종목의 평단이 맞게 들어가는지)가 더 중요해진다. 이 출처는 내가 확인하지 못했다. 후속 항목 후보(T-087 D2/D3 와 연결). 수정 요구 아님.
- [20:55] 지적 요약(수정 요구 없음 — 모두 LOW/정보): L-1(`trade-report.ts:269-292`) 수량이 양수지만 1e-12 이하인 먼지 수량 매도가 재고 없이 들어오면 `fullyMatched`=true·`matchedQty`=0 이라 매칭도 미상도 아닌 채 조용히 빠진다(이전엔 `amount_krw` 전액 이익). 주식 수량이라 도달 불가능에 가깝고 그 매도만 있는 날 문구가 `₩0` 이 될 수 있다. 원하면 `fullyMatched = validQty && toRemove <= 1e-12 && matchedQty > 1e-12` 로 좁히면 닫힌다. L-2(`trade-report-partial-fill.test.ts:106-114`) 시험 제목은 "손익이 부풀고"인데 단언은 이제 `≠ −40` 뿐이다(`+100 > −40` 이라 방향은 여전히 맞다). `expect(totalKRW).toBeGreaterThan(-40)` 한 줄을 더하면 제목과 단언이 맞는다. L-3 문구 "원가 미상 매도 N건 — 실현손익에서 제외"의 N 은 부분 매칭 매도(매칭분은 손익에 포함)도 센다 — 설계서가 정한 문구라 그대로 두되 부분 매칭을 읽는 사람이 오해할 수 있음을 알린다. 정보: `prefetchDays` 30일 밖에서 산 종목을 지금 파는 정상 운용에서도 이제 `원가 미상` 이 나온다(예전엔 이익 부풀림) — 방향은 맞고 T-087 D2/D3 가 메울 몫. `headerPnlKRW`(= 매도금액 − 매수금액)는 매도만 있는 구간에서 같은 부풀림을 갖지만 메시지·화면에 나오지 않고 cron 응답 JSON 에만 남는다 — 후속 후보.
- [20:55] QA 에 넘기는 high_risk_areas: `trade-report.ts:268-292`(분기 3종 — 전량/부분/수량 무효), `trade-report.ts:577-585`(`formatLifoPnlLines` 3형태), 라우트 응답 JSON 두 필드, 합성 입력으로 전부-미상/일부-미상/충분 3형태 메시지를 직접 만들어 줄 단위로 읽는 것. 운영 DB 실측(17건 전부 매도)은 구현자가 읽기 전용으로 수행했다고 기록했으나 나는 운영 DB 에 접근하지 않았으므로 그 숫자는 재검증하지 않았다.
- [20:55] **최종 판정: PASS (scope: src/lib/reports/trade-report.ts, src/app/api/cron/trade-report/route.ts, src/lib/reports/__tests__/trade-report-partial-fill.test.ts, src/lib/reports/__tests__/trade-report-unmatched-sell.test.ts)**

## Codex 검토 (C2)
- 2026-10-25 20:56 judge C2(규칙 엔진 폴백): `codex_required=true`(`CX-limit-unknown-r2`). 결과 `docs/design/judge-result-T-086-C2.json`.
- Codex 읽기 전용 검토(47초, `status=done`). **대상은 이 task 파일 4개만 담은 격리 저장소**. **지적 0건.** 요약: 완전·부분·미매칭 매도의 손익·수수료 배분, `price` null 폴백, 기간 이전 재고 소진, 종목별 LIFO 분리, 원가 미상 표시, API 필드 전달에서 결함 없음.
- Codex 가 보지 못한 것: Jest·tsc 실행(읽기 전용), `sellPnl` 폴백(범위 밖) — 독립 감사가 속성 비교 20,000건·시험·tsc 로 확인.
- **독립 감사 Low 3건은 수정하지 않고 기록**(코드 변경 시 재감사가 필요하고 현실 도달 불가·표현 문제): L-1 수량 1e-12 이하 먼지 매도가 매칭도 미상도 아닌 채 빠짐 / L-2 `trade-report-partial-fill.test.ts` 시험 제목 "손익이 부풀고"와 단언(`≠ −40`)의 불일치 / L-3 표지 문구의 N 이 부분 매칭 매도도 셈.
- **후속 후보(실행 원장 등록)**: ① 청산 엔진 `sellPnl` 섹션이 있는 날 그 섹션이 유일한 실현손익 숫자가 됨 — `indicators.entry_price` 가 앱 밖에서 산 종목의 평단을 맞게 담는지 미확인(`else if` 구조라 그날은 LIFO 줄과 원가 미상 표지가 안 나감) ② `headerPnlKRW`(= 매도금액 − 매수금액)는 매도만 있는 구간에서 같은 부풀림이 있으나 cron 응답 JSON 에만 남음 ③ `prefetchDays` 30일보다 오래된 매수 종목의 매도는 이제 원가 미상으로 나옴(방향은 맞고 T-087 이 메울 몫).
- **사용자에게 보이는 변화**: 다음 거래 리포트부터 앱 체결 17건 전부가 원가 미상이라 실현 손익 줄이 `원가 미상` 으로 표시된다(이전: 양의 합계).

## QA 기록
- [21:05] 검증 시작 기준: HEAD `b4353994`(검증 전후 동일), `git diff --cached` 비어 있음, T-086 소유 4개 파일 sha256 을 검증 전후 비교해 검증 중 변경 없음 확인(`trade-report.ts`·`cron/trade-report/route.ts`·`trade-report-partial-fill.test.ts`·신규 `trade-report-unmatched-sell.test.ts`). 구현자·감사자 보고를 믿지 않고 전부 직접 실행했다. 산출물은 scratchpad `qa-t086/` 에만 두었고 저장소 파일은 이 절 외에 수정하지 않았다(git add/commit/stash/reset 없음, 운영 DB 쓰기·KIS·텔레그램 호출 없음, `.env` 열람 없음).
- [21:05] 체크1 jest — `npx jest src/lib/reports src/app/api/cron/trade-report` → 8 suites 통과 / 139 tests 통과 / 실패 0 / skip 0. 안전·cron 회귀 `npx jest src/lib/safety src/app/api/cron src/app/api/settings/safety src/lib/__tests__` → 62 suites 중 61 통과·1 skipped / 1375 통과·14 skipped·실패 0(skip 1건은 일회용 MariaDB 포트가 있을 때만 도는 `t081b-daily-limit-race-disposable-mariadb.test.ts` 의 환경 의존 skip — 이 task 와 무관). 추가로 전체 `npx jest` → 261 suites 중 257 통과·3 skipped·1 실패 / 6542 통과·75 skipped·4 실패. 실패 1건은 `src/lib/exchanges/__tests__/kis-ledger-adapters.test.ts`(미추적 신규 파일, T-087 D1a 구현 중)라 **T-087 소유**이고 `reports/`·`cron/trade-report` 시험은 전부 통과다.
- [21:05] 체크2 tsc — 작업 트리 전체 `npx tsc --noEmit`(증분)·`--incremental false` 둘 다 오류 **6건**(exit 2). 6건 전부 `kis-domestic-ledger.ts`(3)·`kis-overseas-ledger.ts`(3) 의 `'label' does not exist in type 'LedgerQuerySpec'` 로 **T-087 미추적 파일**(검증 중에도 20:59~21:00 에 계속 수정되던 파일)이다. T-086 소유 파일 오류 0건. 분리 증명: scratchpad 복사본에서 T-087 변경(수정 3 + 신규 파일들)을 HEAD 상태로 되돌리고 T-086 변경만 남겨 `tsc --noEmit --incremental false` → **오류 0(exit 0)**. 즉 T-086 변경은 단독으로 타입 통과한다. 단, 작업 트리 전체 tsc 가 0 이 되는 것은 T-087 이 끝나야 한다(커밋은 명시 경로만 하므로 T-086 커밋에는 영향 없음).
- [21:06] 체크2 보충 lint — 저장소에는 ESLint 설정 파일이 없어 `next lint` 는 쓸 수 없다. scratchpad 의 임시 설정(`eslint-config-next` core-web-vitals + typescript, 저장소에 파일 생성 없음)으로 4개 파일을 린트 → 4 files, errors 0, warnings 0. 저장소 기준 린트 게이트가 아니므로 참고 증거다.
- [21:07] 체크3 시험 요구 1~7 대응과 변이 확인 — 새 시험 파일에 요구별 시험이 모두 있다: ①F02 회귀 4건(재고 0/price 없음/여러 종목/수량 0) ②재고 일부 2건(price 있음 54 손계산 일치·price 없음 18 일치) ③재고 충분 6케이스(`toBe` 정확 일치, 기준 구현 `legacyLifoTotal` 대조) ④price 없음 부분 매칭(②에 포함) ⑤기간 밖 매도 2건 ⑥문자열 3형태 + 문구 고정 ⑦소비자 정적 점검 3건. 격리 복사본(`mut/base`, 저장소 파일 불변)에서 `trade-report.ts`·`route.ts` 핵심 줄을 되돌리는 변이 14종을 새 시험·partial-fill 시험·라우트 시험 2개로 돌렸다 → **13종 실패(시험이 잡음), 1종(M9) 생존.** 잡은 변이: M1 미매칭 매도에 `amount_krw` 전액 이익(옛 F02 동작, 8건 실패·partial-fill 회귀 시험 포함) / M2 수수료 비례 제거 / M3 price 없는 매도 비율 제거 / M4 부분 매칭 건수 누락 / M5 전부 미상일 때 숫자 표시 / M6 표지 줄 삭제 / M7 기간 밖 매도 포함 / M8 수량 0 가드 제거 / M10 재고 충분 매도 식 변경(소수 수량 케이스가 잡음) / M11 route 응답에서 `unmatchedSellCount` 제거(정적 점검 시험이 잡음) / M12 `buildTradeReport` 배선 누락 / M13 미상 수량 누락 / M14 `matchedSellCount` 0 고정. 생존한 M9(`const ratio = fullyMatched ? 1 : matchedQty / r.quantity` 에서 `fullyMatched ? 1` 제거)는 결함이 아니라 **시험 틈**이다: 실제 코드로 별도 퍼지(전량 매칭 20,000건, 소수 수량·수수료·price 없는 매도 혼합)를 돌리면 현재 코드는 예전 식과 `Object.is` 일치(차이 0)이고 M9 변이는 4,891건에서 1e-14 급 차이가 난다. 즉 "완전히 동일"은 현재 구현에서 참이지만 그 성질을 저장소 시험이 부동소수 잔여 케이스로 못 박고 있지는 않다. 금액 영향은 없다(1e-14).
- [21:08] 체크4 리포트 문구 직접 출력(합성값, 복사본에서 `buildTradeReport`+`formatReportMessage` 호출) — (a) 재고 충분(매수 3@100, 매도 3@120, 수수료 6): 거래 요약 3줄 `매수 1건 / ₩300`·`매도 1건 / ₩360`·`실현 손익: +₩54`, **표지 없음**. (b) 일부 미상(다른 종목 재고 없는 매도 1건 추가): `실현 손익: +₩54` 바로 아래 `원가 미상 매도 1건 — 실현손익에서 제외`. (b2) 한 매도 안에서 재고 3주 + 초과 2주: 실현 +₩54(손계산 360−300−6 일치)와 `원가 미상 매도 1건` 표지, 매도 금액 줄은 전체 대금(₩600)을 그대로 보여 준다(거래 요약은 의도적으로 불변). (c) 전부 미상: `실현 손익: 원가 미상` + `원가 미상 매도 2건 — 실현손익에서 제외`, **`₩0`·`+₩0` 없음**. (d) 매도 없음: 예전 `*매도 없음*` 그대로, 표지 없음.
- [21:08] 체크5 cron 라우트 — `git diff -U0 route.ts`: 추가 3줄(주석 1 + `unmatchedSellCount`·`matchedSellCount` 2), **삭제 0줄**. 라우트 시험 2개(`route.test.ts`·`route-total-unknown.test.ts`)는 파일 무변경으로 통과. 다만 이 시험들은 mock 보고서에 새 필드가 없어 응답 JSON 의 새 필드를 단언하지 않는다 → scratchpad 복사본에서 mock 에 `unmatchedSellCount: 3`·`matchedSellCount: 2`·`lifoPnlKRW: 50.4` 를 넣은 라우트 시험을 추가로 돌려 실제 응답 키가 `ok, sent, channel, partial, delivered, failed, unconfigured, noTargetChannel, lastSentAtAdvanced, rangeStart, rangeEnd, rangeCapped, buys, sells, headerPnlKRW, lifoPnlKRW, unmatchedSellCount, matchedSellCount` 이고 새 값 3·2 가 실리며 기존 `lifoPnlKRW`(반올림 50)·`headerPnlKRW`·`buys`·`sells`·`ok`·`sent` 가 불변인 것을 확인했다(29 tests 통과). 저장소의 응답 새 필드 보증은 정적 점검 시험(소스 텍스트 검사)뿐이다.
- [21:09] 체크6 화면 비침범 — `grep -rnE "lifoPnl|trade-report|실현 손익|unmatchedSell" src --include=*.tsx --include=*.jsx` → **0건**. `git diff --stat -- src/components src/app` 는 `cron/trade-report/route.ts` 1개(+3)뿐이고 작업 트리 전체에서 변경·미추적 `.tsx`/`.jsx` 0개. `computeLifoPnl` 호출 지점은 `trade-report.ts:402` 1곳, `lifoPnlKRW` 를 읽는 운영 코드는 `trade-report.ts`(`formatLifoPnlLines`)와 `route.ts` 뿐(`order-sync.ts:1211` 은 주석). `scripts/cron-runner.sh:212` 는 라우트를 호출만 하고 응답 본문을 파싱하지 않는다. 데모 게이트 `none` 전제 유지.
- [21:09] 체크7 운영 데이터 읽기 전용 — scratchpad `t086/compare.js` 를 먼저 읽어 안전성 확인(SELECT 한 번뿐, `SET SESSION TRANSACTION READ ONLY`+`START TRANSACTION READ ONLY`+`tx_read_only=1` 아니면 중단, 끝에 ROLLBACK, 앱 `@/lib/db` 미사용, 출력은 건수·참/거짓뿐), 비교 기준 `t086/trade-report.head.ts` 가 `git show HEAD:src/lib/reports/trade-report.ts` 와 바이트 동일함을 `cmp` 로 확인한 뒤 실행. 결과: `tx_read_only = 1` / 앱 체결(filled) 주문 **17건**(매도 17·매수 0) / 새 계산 `unmatchedSellCount` 17·`matchedSellCount` 0 / 이전 대비 새 합계 **달라졌다**(이전 양수 → 새 0). 금액·수량·종목 실값은 출력·기록하지 않았다. 이 스크립트는 기간을 제한하지 않은 전체 이력(rangeStart 가 1970년) 기준이므로, 실제 정기 리포트(수 시간 창)에서는 그 창에 들어온 매도 건수만 표지에 나온다.
- [21:10] 체크8 민감값 — 변경·신규 파일과 task 문서의 `[0-9]{8,}` 매치: 새 시험 파일 0건, `trade-report.ts`·`route.ts` 0건, 변경 diff 의 추가된 줄 0건. 매치가 있는 곳은 기존(이번에 추가되지 않은) `trade-report-partial-fill.test.ts` 의 DECIMAL 문자열 고정값 8줄(예 `'70100.00000000'`)과 task 문서 105행의 부동소수 리터럴 `0.30000000000000004` 뿐이다. 키·토큰·비밀번호·계좌번호 패턴(`api key`/`secret`/`token`/`password`/`bearer`/계좌 형태)은 새 시험·task 문서·변경 diff 에서 0건이다.
- [21:10] 체크9 저장소 점검 — 검증 전후 `git rev-parse HEAD` 동일(`b4353994…`), `git diff --cached --stat` 비어 있음(0바이트·0파일), T-086 소유 4개 파일 sha256 전후 동일. 검증 중 작업 트리의 다른 변경(`T-084` task 문서, `kis-usage-scenarios.ts` 등)이 늘었으나 다른 세션 소유이며 건드리지 않았다. `git stash list` 에 1건이 있으나 내가 만든 것이 아니다(stash 명령을 쓰지 않았다). 기록 직후 다른 세션이 T-085 커밋 `21f84c3` 을 만들어 HEAD 가 이동했다(검증 중이 아니라 이후) — `git diff b4353994 HEAD -- src/lib/reports src/app/api/cron/trade-report` 비어 있고 T-086 4개 파일 해시도 동일해 판정에는 영향이 없다. 이 커밋은 훅(`commit-msg`)을 바꾸므로 T-086 커밋 때는 새 훅 기준 SAFETY_PATHS 로 다시 확인하면 된다(위 대조에서 T-086 중 걸리는 파일은 `route.ts` 1개로 동일).
- [21:10] 안전장치 영향 점검 — 이 변경은 주문 송신 경로(`submitOrder`·DRY_RUN·킬스위치·주문 한도·심볼 차단)를 건드리지 않는다. `src/lib/safety/` 무변경, 변경 diff 에 `submitOrder`·`process.env` 추가 없음. 이 계산 결과(`lifoPnlKRW`)는 메시지 문자열과 cron 응답 JSON 으로만 흐르며 킬스위치·한도·시그널 판정으로 가는 경로가 없다. SAFETY_PATHS(현재 작업 트리 훅·HEAD 훅 둘 다)에 걸리는 T-086 파일은 `src/app/api/cron/trade-report/route.ts` 1개(`^src/app/api/cron/`)이고 Reviewer 판정 scope 에 포함돼 있다. 커밋 훅 실검증(`git commit` 시도)은 하지 않았다(금지 범위).
- [21:11] 확인하지 못한 것: ① 작업 트리 전체 tsc 0 오류(T-087 진행 중 6건이 남아 있어 T-086 단독 복사본으로만 증명) ② 저장소 린트 게이트(설정 파일 없음 — 임시 설정 린트만 0) ③ 운영 텔레그램/슬랙에 실제로 나가는 메시지(발송 금지라 합성 입력의 문자열까지만 확인, 텔레그램 HTML 변환기 `mrkdwnToTelegramHtml` 는 라우트 시험에서 mock) ④ 청산 엔진 `sellPnl` 분기와 `indicators.entry_price` 의 정확성(범위 밖, Reviewer 가 후속 후보로 기록) ⑤ 커밋 훅의 실제 통과 여부.
- [21:11] 사용자에게 보이는 변화(Leader 보고용): 다음 거래 리포트부터, **매도가 있고 그 창에 `매도 손익`(청산 엔진) 섹션이 없는 리포트**에서 `실현 손익` 줄이 숫자 대신 `원가 미상` 으로 바뀌고 바로 아래 `원가 미상 매도 N건 — 실현손익에서 제외` 줄이 붙는다(앱 체결 17건이 전부 매도·매수 0건이라 현재 이력 기준 전부 해당). `매도 손익` 섹션이 있는 창에서는 그 섹션이 그대로 쓰이므로 이번 변경의 표지가 나오지 않는다(`else if` 구조, Reviewer 후속 후보 ①). 화면(웹/앱)·DB·주문에는 변화 없음.
- [21:11] 결함 목록: Critical 0 / High 0 / Medium 0 / Low 2(참고, 수정 요구 아님) — Low-A 시험 틈: 변이 M9 생존(전량 매칭 비율 1 고정을 부동소수 잔여 케이스로 못 박는 시험 없음, 구현은 현재 참) / Low-B 시험 틈: 라우트 응답의 새 필드는 소스 텍스트 정적 점검으로만 보증되고 라우트 시험에 값 단언이 없음(런타임 동작은 복사본 시험으로 확인). Reviewer 의 L-1·L-2·L-3 는 그대로 유효하며 코드 영향 없음.
- [21:12] QA 판정: 통과

## 최종 요약

### [T-086] 거래 리포트가 원가를 모르는 매도를 "대금 전액 이익"으로 세던 오류 수정

- **상태**: ✅ 완료
- **무엇이 바뀌었나**: 거래 리포트(텔레그램)의 실현 손익 계산이 앱 안에 매수 기록이 없는 종목의 매도를 "원가 0 으로 판 것"으로 읽어 대금 전액을 이익으로 더하던 오류를 고쳤다. 이제 원가를 아는 수량만 손익에 넣고, 모르는 수량은 이익도 손실도 아닌 "원가 미상"으로 따로 센다. 해당 매도가 리포트 구간에 있으면 `원가 미상 매도 N건 — 실현손익에서 제외` 줄이 붙고, 전부 원가 미상이면 숫자 대신 `원가 미상` 으로 표시된다(`₩0` 으로 표시하지 않는다).
- **배포**: ✅ 운영 반영 — 커밋 `7f7b038` · 2026-10-25 21:06 KST · push(webhook) · 결과 ok(릴리스 `20261025-210643-7f7b0384`), 배포 직후 크론 `trade-report OK`
  - 같은 배포에 함께 실린 작업: T-085(`21f84c3`)
- **AI 가 검증한 것**: 이전 구현과 같은 입력 20,000건 비교(원가 미상 0건 12,453건은 값 완전 일치, 미상 포함 7,547건은 독립 계산과 일치), 리포트 문자열 원가 미상 0건 2,298개 바이트 동일, 시험 139건·안전/cron 회귀 1,375건 통과, `tsc` 0, 변이 14종 중 13종 포착, 독립 감사 통과·Codex 지적 0·QA 통과.
  - 검증 못 한 것: 운영 텔레그램에 실제로 나가는 메시지(발송 금지라 합성 입력의 문자열까지만 확인).
- **👉 사용자가 확인할 것**: 없음.
  - **사용자에게 보이는 변화 정정**: 처음에는 "다음 리포트부터 실현 손익 줄이 `원가 미상` 으로 바뀐다"고 보고했으나 **틀렸다.** 리포트는 거래일에만 3시간 주기(08:00 기준)로 나가고, 손익은 **그 리포트 구간 안의 매도**만 센다. 앱이 마지막으로 체결한 주문은 05-27 이라 다음 리포트(월 10-26 08:00 KST)의 구간에는 앱 매도가 없어 **출력이 이전과 같다.** `원가 미상` 표시는 앱이 다시 매도 주문을 체결할 때(킬스위치 해제 후 등) 처음 나타난다.
- **👉 사용자가 결정할 것**: 없음
- **남은 일**: 후속 A13(청산 엔진 "매도 손익" 섹션이 있는 날 그 섹션이 유일한 실현손익 숫자가 됨 — `entry_price` 가 앱 밖에서 산 종목의 평단을 맞게 담는지 미확인. 청산 엔진을 다시 켜기 전에 확인 필요), A16(독립 감사 Low 3건·QA Low 2건)
- **이슈·위험**: 청산 엔진은 현재 OFF 라 A13 은 지금 영향이 없다. 롤백: `git revert 7f7b038` 후 push
