---
task_id: T-097
title: 주문 사이징 — "금액 먼저"에서 "주가(수량) 먼저, 결과 금액으로 처리"로 변경 (P4) — 설계 질문 확정 전 구현 금지
status: doing
priority: medium
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: ac2a4df
risk_level: R2
roles_involved: [leader, judge, analyst, developer, reviewer, qa]
related_tasks: [T-020-fractional-order-quantity-sizing, T-058-signal-cash-gate, T-062-post-market-overseas-p2, T-070-daily-bars-phase0, T-072-validation-gate, T-096-strategy-validation-p2-p3]
tags:
  - type/task
  - domain/safety
  - domain/sizing
aliases:
  - 주가기준사이징
  - P4
waiting: [judge 접수, Developer 구현, Reviewer 독립 감사, QA]
demo_gate:
  required: true
  level: "delta"
  status: "review_requested"
  version: 1
  repo_path: "mockups/T-097-telegram-sizing-line-v1.html"
  artifact_url: ""
  content_sha256: "cd57b7247905332b53eb0ffbdc3f4a4e80e94f815c7e0595600ced5ef5344ccd"
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-097 주문 사이징: 주가 기준 수량 → 결과 금액으로 처리 (P4)

## 사용자 결정 (2026-10-26 오후, 발화 그대로)

- "P4: 그럼 거래에 대한 금액 계산을 금액으로 하는게 아니라 주가로 계산하여 금액 후 계산해서 처리하는 금액으로 처리하도록 작업을 변경해줘"
- Leader 해석(틀리면 정정): 슬롯 금액에서 수량을 나누는 대신 **주가로 수량을 먼저 정하고, 그 결과 금액(주가 × 수량)을 처리 금액으로** 쓴다. 이 해석에는 **세 갈래**가 있어(아래 §지시 해석) 코드를 만들기 전에 사용자 확인이 필요하다.
- 진행: 안전 경로(주문 사이징·한도) 변경이라 구현 전에 **읽기 전용 영향 조사**를 먼저 했다(워크스페이스 원칙 "도메인 자문은 계획 승인 전에"). 사용자 답이 오면 judge 접수 → 설계 확정 → Developer → Reviewer → QA.

## 조사 결과 요약 (읽기 전용, 2026-10-26 16:07 시점 — 상세 근거는 조사 보고 원문 요지)

**한 줄 결론 [확실]**: 코드 변경은 작지만, **이 변경만으로는 MU(미국 약 $880)·국내 20~50만 원대 종목이 집행되지 않는다.** 엔진의 "슬롯(10만 원)"은 독립 개념이 아니라 **1회 한도 × (1 − 비용 버퍼)** 이고(`src/lib/strategy/engine.ts:1339-1344`), 1회 한도는 DB `safety_order_max_pct`=4(시장별 평가액의 4%)다. 최소 1주를 허용해도 `submitOrder` 의 1회 한도 검사(`src/lib/safety/dry-run.ts:198-218`)가 실현액으로 막는다. 한도를 실현액에서 빼 주면 안전장치가 약해진다. Leader 가 `engine.ts`·`service.ts:296-312`·`dry-run.ts:198-218`·DB 값(1회 4%·일일 10%)을 직접 읽어 확인했다.

**지금은 어떤 규칙이든 앱 매수가 실제로 나가지 않는다** [확실]: 킬스위치 ON + 전략 16개 모두 `unvalidated`(T-072 관문). 영향을 받는 곳은 가상 체결(`paper_fills`)·기록·표시·한도 계산뿐.

**가격대별 효과(수량 우선 + 최소 1주 가정, 한도 4%·일일 10%, 환율 1,324 근사, 비율·판정만)**:

| 가격대 | 현행 수량 → 최소1주 | 실현액 ÷ 1회한도 | 판정 |
|---|---|---|---|
| 미국 $50 | 11 → 11 | 0.5~1배 | 동작 동일(기록 금액만 바뀜) |
| 미국 $200 | 2 → 2 | 0.5~1배 | 동작 동일 |
| 미국 $880 | 0 → 1 | **1.5~2배(초과)** | 1회 한도에서 차단 — 통과하려면 한도가 해외 평가액의 약 6~8% 여야 함 |
| 국내 5만 원 | 2 → 2 | 0.5~1배 | 동작 동일 |
| 국내 50만 원 | 0 → 1 | **3~5배(초과)**, 일일도 초과 | 1회·일일 모두 차단 — 국내 평가액의 약 12~20% 필요 |

실제로 풀리는 구간은 "1주가 슬롯보다 크고 1회 한도 이하인" 좁은 창(약 0.4% + 추격 0.5%)뿐이다. 카드(고정 10만 원)는 최소 1주를 적용하면 $200 카드가 생겨 **"카드 금액 10만 원 유지"(T-062 D-6) 와 충돌**한다. 실측(최근 30일 매수 시그널): 국내 845건 중 258건(30.5%)·해외 487건 중 63건(12.9%)이 1주 가격 > 시그널 금액(Analyst 의 27% 와 창·정의가 달라 같은 값 아님). `paper_fills` 는 국내 91행 중 56행(61%)·해외 28행 중 8행(29%)이 수량 0 — 규칙을 바꾸면 T-072 승급 표본(주 ≥20·체결 ≥100)의 정의가 중간에 바뀐다.

**핵심 코드 지점(사이징 합류점 2곳)**: `src/lib/signals/service.ts:240` `sizeOrderQuantity`(호출 5곳: `service.ts:289`·`orders/route.ts:66`·`entry-watcher/route.ts:413`·`post-market-engine.ts:128·258`)와 `service.ts:276` `buildOrderRequest`(호출 4곳). `buildOrderRequest` 는 **`amountKRW` 를 일부러 재계산하지 않는다**(`:305-308`, T-020 D-1 — "기록의 정합성보다 한도의 보수성이 우선"). 이 줄이 이 변경의 번복 지점이다. 주변 호출·표시 지점 12~15곳. 마이그레이션 불필요(`amount_krw` DECIMAL(18,2)·`quantity` DECIMAL(36,18)).

**함정 2개**: ① 해외 가격 단위 — 시그널 `price` 는 원화 환산값인데 `resolveOrderAmountKRWAsync`(`order-limits.ts:43-57`)는 `amountKRW` 가 비면 해외 가격을 USD 로 보고 환율을 **또** 곱한다(약 1,324배) → 실현액을 쓰려면 `amountKRW` 를 원화로 직접 채워야 한다 ② 정수 달러 반올림(단가 $50 에서 최대 약 ±1%) → 실현액은 `overseasLimitUnitUsd`(`signal-cash-gate.ts:192`)로 구해야 어긋나지 않는다.

**SAFETY_PATHS 해당(Reviewer 판정 scope 필요)**: `src/lib/signals/`(service·approval-context·approval-message·approval-notify·signal-cash-gate·entry-cash-precheck·paper-fill·router·scenario-builder), `src/lib/strategy/`(engine·post-market-engine·post-market-overseas·portfolio-stability), `src/lib/safety/`(order-limits·dry-run), `src/app/api/cron/entry-watcher/route.ts`, `src/app/api/signals/`, `src/app/api/orders/route.ts`, `src/app/api/analyst/run/route.ts`, 그리고 그 디렉토리의 `__tests__`(시험도 감시 대상). 거래소 어댑터(`kis-domestic.ts`·`kis-overseas.ts`)는 불변 권고.

**고정 시험(규칙을 뒤집으면 반드시 고쳐야 함)**: `signals/__tests__/order-sizing.test.ts`(`:62-64` 1주 미만 0, `:286` "amount_krw 는 재계산하지 않는다"), `cron/entry-watcher/__tests__/sizing.test.ts`·`cash-precheck.test.ts`, `strategy/__tests__/post-market-domestic-golden.test.ts`(INSERT 100000 골든), `signal-cash-gate*.test.ts`, `safety/__tests__/order-limits*.test.ts`(5개)·`submit-order*.test.ts`·`t081b-daily-limit-*.test.ts` 등 약 40개.

**표시**: 텔레그램 승인 요청(`approval-message.ts:106`)에는 금액 줄만 있고 수량·단가 줄이 없다. `scenario-card-display.ts:288-297` `overseasFootnote` 의 "1주 가격이 {금액} 이하인 종목만 만들어집니다" 문장은 규칙 변경 시 거짓이 되어 수정 대상. 웹 화면 12곳은 값을 그대로 보여 주므로 코드 수정 없이 동작하나 의미(목표→실현액)가 바뀐다. 신규 화면·구조 변경은 없고 문구·표시 변경(데모 게이트 판정은 judge).

## §지시 해석 — 세 갈래 (사용자 선택 필요)

- **(i)** 수량은 지금처럼 내림하되 **기록·한도·표시 금액을 실현액(주가×수량)** 으로 바꾼다. T-020 D-1 결정(한도는 목표금액 기준)을 **번복**한다. 사용자 문장("주가로 계산하여 금액 후 계산")에 가장 가깝다 [가능성 높음]. 단 (i) 만으로는 MU 가 풀리지 않는다.
- **(ii)** (i) + **최소 1주 허용**(Leader 의 첫 해석). 한도 정책을 함께 정하지 않으면 효과가 거의 없다(위 표).
- **(iii)** 한도 누적을 **체결 후 실제 금액**(`broker_fills`)으로 한다. 지금 일일 한도는 주문 시점 `orders.amount_krw` 를 부분체결과 무관하게 전액 합산한다(`order-limits.ts:228-264`).

## 사용자 설계 결정 질문 (권고 포함)

- **Q-A 의도**: (i)·(ii)·(iii) 중? **권고: (i) 를 기본으로 구현하고, (ii) 는 옵션 플래그(기본 OFF, 호출부가 고름)로 코드만 준비** — 한도 정책을 정하기 전에는 켜지 않는다. 이유: (ii) 는 한도를 올리지 않으면 효과가 없고, 한도를 올리면 집중 위험이 생긴다.
- **Q-B 1회 한도(자산의 4%)·일일 한도(10%)**: 그대로 둘지, 올릴지? **권고: 그대로.** 올리면 MU 1주(해외 평가액의 약 6~8%)가 가능하나 T-064 §7.1 "열 2%" 설계와 충돌하고, 전략이 하나도 검증되지 않은 지금 집중을 늘릴 근거가 없다. 한도는 코드 변경 없이 설정(`safety_order_max_pct`)으로 언제든 올릴 수 있다 — 다만 설정 API 에 상한 검증이 없다는 점은 별도 위험.
- **Q-C 한도 판정 기준**: 목표금액 유지 vs 실현액? **권고: `max(목표, 실현액)`(보수적)**. 실현액만 쓰면 같은 10% 안에서 내림 잔여만큼 더 살 수 있어 한도가 느슨해진다(T-020 D-1 번복이므로 사용자 명시 결정 필요).
- **Q-D 카드 금액 10만 원 유지(T-062 D-6)**: 유지? **권고: 유지.** 최소 1주를 카드에 적용하면 $200 카드가 생겨 결정과 충돌.
- **Q-E 텔레그램 승인 메시지에 "N주 × 단가" 줄 추가**: **권고: 추가**(수량이 생성 시 고정되면 승인 시점에 실제 주문 수량을 봐야 한다). 사소한 표시 변경이지만 사용자 화면(알림) 변경이라 확인.
- (참고) **T-070 P4 (a)(b)(c) 와의 관계**: 이 지시는 "수량을 어떻게 정하나", P4 는 "예산이 얼마인가"의 답이라 서로 대체되지 않는다. **권고 (b) "1주 ≤ 슬롯인 종목만 시그널"을 유지**하고 수량 우선은 기록·한도 정합용으로 한정.
- (참고) **`paper_fills` 표본 연속성**: 규칙 변경 시점을 `fill_model` 에 규칙 버전으로 남겨 T-072 승급 표본이 섞이지 않게 한다(권고).

## 사용자 설계 결정 (2026-10-26 16:30 이전, 발화 그대로) 와 확정 설계

- "4. Q-A: 권고대로 진행해줘" → **(i) 를 기본 구현 + (ii) 최소 1주는 옵션(기본 OFF, 호출부가 고름)으로 코드만 준비.**
- "5. Q-B: 한도는 그대로 두고 설정에서 변경할께" → **1회 한도(4%)·일일 한도(10%) 코드·DB 설정 모두 건드리지 않는다.** 한도 변경은 사용자가 설정 화면에서 직접 한다(설정 API 에 상한 검증이 없다는 점은 별도 위험으로 기록만).
- "6. Q-C,D, E: 권고대로 진행해줘" → **Q-C** 한도 판정 기준 = `max(목표금액, 실현액)`(보수적), **Q-D** 카드 금액 10만 원 유지(카드 생성 코드·금액 불변), **Q-E** 텔레그램 승인 메시지에 "N주 × 단가" 줄 추가.

**Leader 확정 설계(해석을 명시 — 틀리면 사용자가 정정)**: 사용자 결정 전체를 모으면 이 변경은 **동작을 바꾸지 않는 기록·표시 변경 + 나중을 위한 보수적 옵션**이다(수량은 지금처럼 내림, 한도는 그대로, 카드 불변). 조사로 확인한 대로 한도를 올리지 않는 한 비싼 종목은 풀리지 않는다.
1. **수량 규칙 불변**: `sizeOrderQuantity` 의 기본 동작(`floor(금액 ÷ 가격)`, 0 이면 불성립)은 그대로. 옵션 `{ minOneShare?: boolean }`(기본 false)를 추가해 true 일 때만 `max(1, floor)`. **이번 task 에서는 어떤 호출부도 이 옵션을 켜지 않는다**(배선 안 함 — 한도 정책을 정한 뒤 별도 task). 옵션이 켜졌을 때의 결과 구조(`minOneShareApplied`·`realizedKrw`)와 시험까지만 준비.
2. **한도 기준 금액 = `max(목표, 실현액)`**: `buildOrderRequest` 가 `amountKRW` 를 만들 때 명시적으로 `max(input.amountKRW, 실현액)` 을 쓴다. 내림 규칙에서는 실현액 ≤ 목표라 **현행과 결과가 같고**(T-020 D-1 보수성 유지, 번복 아님), 옵션이 켜지는 날 한도가 자동으로 보수적이 된다. 해외는 **원화로 직접 채운다**(조사의 함정 ①: `amountKRW` 가 비면 해외 가격을 USD 로 보고 환율을 또 곱함) — 실현액은 `overseasLimitUnitUsd`(`signal-cash-gate.ts:192`)와 같은 계산으로(정수 달러 반올림, 함정 ②).
3. **기록**: 시그널 생성 시(`signals/service.ts` INSERT 부근) `indicators.sizing` JSON 에 `{rule:'qty_first_v1', targetKrw, quantity, unitPriceKrw, realizedKrw, limitBasisKrw}` 를 남긴다(DDL 불필요, 사후검증 H-G "1주 가격 > 시그널 금액" 정의가 사라지지 않게). `signals.amount_krw`·`orders.amount_krw` 컬럼의 의미(한도·일일 합산·텔레그램 버튼 서명 기준)는 **그대로**. 카드(post-market)·`entry-watcher`·`api/orders`·`api/signals/custom/confirm` 은 건드리지 않는다.
4. **표시(Q-E)**: 텔레그램 승인 요청 메시지(`approval-message.ts`·`approval-notify.ts`)에 `indicators.sizing` 이 있을 때 "수량·단가" 줄 추가(예: `수량 N주 × 단가 ₩X ≈ ₩Y`). 없으면(옛 시그널·카드) 줄 없음. **HTML 이스케이프 필수**(T-042: `<` 미이스케이프가 승인 요청 78% 유실 원인이었다). 텔레그램 버튼 서명 검증 입력(`amount_krw` 반올림)은 불변.
5. **수용 기준(핵심)**: (a) 옵션 OFF(기본)에서 **주문 요청이 현행과 비트 단위로 같다** — 가격 격자(미국 $50·$200·$880, 국내 5만·50만 원, 추격가 포함)에 대해 변경 전/후 `buildOrderRequest`·`sizeOrderQuantity` 출력 일치를 골든 시험으로 고정 (b) 기존 시험은 **수정 없이 통과**해야 하며, 텔레그램 메시지 정확 문자열을 단언하는 시험만 추가 줄을 반영해 고친다(고친 시험 목록을 보고) (c) 옵션 ON 시험: 1주가 목표보다 큰 경우 `limitBasisKrw` 가 실현액이고 1회 한도에서 막힌다 (d) 해외 원화 직접 채움 시험(환율 이중 곱 재현·방지) (e) 텔레그램 메시지 이스케이프·길이·줄 순서 시험 (f) 전체 jest·tsc 통과 (g) Reviewer 판정(scope: 건드린 안전 경로 파일 전부) → judge C2 → QA.
6. **하지 않는 것(재확인)**: 한도 설정값·코드 변경, 카드 금액·카드 생성 변경, 호출부 배선, DB DDL, 운영 DB 쓰기, KIS 호출, push·배포. 전략 승급 관문(T-072)은 그대로.

## 구현 방식(사용자 결정 뒤 — 권고)

`sizeOrderQuantity` 를 전역으로 바꾸지 말고 옵션(예: `minOneShare`)으로 호출부가 고르게 한다(전역 변경이면 카드의 "수량 0 필터" `cardBuysZeroShares` 가 무력화). 원래 슬롯은 `indicators.sizing`(JSON, DDL 불필요)에 남겨 사후검증 H-G 정의가 사라지지 않게 한다. 텔레그램 버튼 서명은 DB `amount_krw` 로 검증하므로 금액은 생성 시 한 번 고정해 저장한다.

## 하지 않는 것

사용자 설계 결정 전 코드 변경, 한도 설정값 변경, 운영 DB 쓰기, KIS 호출, push·배포. 전략 승급(T-072 관문 해제)과 이 변경은 별개 — 이 변경은 관문을 풀지 않는다.

## 허용 권한

읽기 전용 조사(완료). 구현 권한은 Q-A~Q-E 답 뒤 judge 접수·Reviewer 게이트와 함께.

## 판단 기록 (judge)

(사용자 답 뒤 접수)

## 관련 과거 이력 요약

- [[T-020-fractional-order-quantity-sizing]]: D-1 "한도는 목표금액 기준"(`service.ts:305-308`).
- [[T-058-signal-cash-gate]]: 현금 게이트(사이징된 주문 전체 비용 = 수량×지정가×1.002 vs 현금).
- [[T-062-post-market-overseas-p2]]: 카드 금액 10만 원 유지(D-6).
- [[T-070-daily-bars-phase0]] Analyst 검토 §4 P4: 자본·유니버스 정합 선택지 (a) 슬롯 10만 상향 (b) 1주≤슬롯 종목만 (c) 미국 저가 유니버스.
- 사용한 교훈 ID: 없음.

## 진행 기록

- 2026-10-26 16:07: 사용자 지시 접수 → 읽기 전용 영향 조사(서브에이전트) 완료 → Leader 가 핵심 주장을 코드·DB 로 대조 확인 → 설계 질문 정리, 사용자 결정 대기. 구현 착수 안 함.

## Developer

## Reviewer

## QA

## 배포 기록

## Codex 검토

## 최종 요약

(완료 시 Leader 가 작성)

## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음(판정은 사용자 답 뒤 judge) | - | - | - | - |
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-26 16:32 |
| v1 | 검토요청 | mockups/T-097-telegram-sizing-line-v1.html | - | 사용자 검토 요청 | 10-26 16:32 |
