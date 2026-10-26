---
task_id: T-097
title: 주문 사이징 — "금액 먼저"에서 "주가(수량) 먼저, 결과 금액으로 처리"로 변경 (P4) — 설계 질문 확정 전 구현 금지
status: doing
priority: medium
project: StockInvest
created: 2026-10-26
updated: 2026-10-26
base_ref: f50a3f7
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
waiting: [demo_review — Q-E 텔레그램 "수량" 줄 데모 v1(mockups/T-097-telegram-sizing-line-v1.html) 사용자 승인 대기]
demo_gate:
  required: true
  level: "delta"
  status: "approved"
  version: 1
  repo_path: "mockups/T-097-telegram-sizing-line-v1.html"
  artifact_url: ""
  content_sha256: "cd57b7247905332b53eb0ffbdc3f4a4e80e94f815c7e0595600ced5ef5344ccd"
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: "user"
  approved_at: "2026-10-26T21:39:01+09:00"
  approval_quote: "T-097 텔레그램 수량 데모 승인"
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: true
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

## 옵션(최소 1주) ON 배선 task 로 이월하는 필수 조건 (Reviewer 3라운드까지 확정, 17:29 기록)

이번 task 는 옵션 ON 을 **배선하지 않는다**(승인 아님). 나중에 `minOneShare` 를 어느 호출부에서든 켜려면 **별도 task + 별도 Reviewer** 가 아래를 수용 기준에 넣어야 한다:
1. **한도 기준 = `max(목표, 원화환산 실현액, 수량 × 정수달러 단가(overseasLimitUnitUsd) × 환율)`** — 해외 정수 달러 반올림 오차(단가 $50 에서 최대 약 ±1%, F-2). 환율은 송신 시점 어댑터와 같은 출처·값이어야 하며 `buildOrderRequest` 가 동기 함수라 환율 주입 또는 비동기화가 필요하다.
2. **`buildOrderRequest` 를 거치지 않는 호출부**(`entry-watcher/route.ts:441`·`api/orders/route.ts`)는 목표금액을 그대로 쓰므로 옵션만 켜면 1회 한도가 열린다(F-1). `approval-context.ts:140` 은 알림 사전 판정일 뿐이라 거기서는 사전 판정이 낙관적이 된다(실제 한도는 `submitOrder`). **옵션을 켜는 모든 운영 호출부가 `submitOrder` 에 한도 기준 금액을 넘기는지 소스 grep 시험으로 고정.**
3. **호출부는 자기 `sizeOrderQuantity` 결과의 `minOneShareApplied` 로 한도 기준을 올린다**(F-10 — 3라운드 이후 `quantitySource` 는 기록용이고 한도 판정은 `minOneShareApplied` 하나에 걸린다). 기존 이월 ④("`quantitySource` 를 한 곳에서 계산")는 "한도 안전 조건"에서 "기록 정확성"으로 내려갔다(코드 주석 `service.ts:229` 의 ④ 문구는 stale — ON 배선 task 에서 갱신).
4. **승격 조건에 `typeof amountKRW === 'number'`**(F-9): 문자열 금액 `'100000'` + ON + MU 는 나눗셈 강제변환으로 1주로 올라가지만 `limitBasisKrw` 는 숫자가 아닌 목표를 그대로 돌려줘 ON 에서 fail-open 이다(현재 도달 불가: 배선 0, API `invalidNumericField` 와 DB `Number()` 가 거른다). 시험으로 고정.
5. 별개 후속 후보(이번 범위 밖, base 와 동일): `POST /api/signals` 는 `quantity` 와 `amountKRW` 를 따로 받아 매수에서 수량이 크고 금액이 작으면 한도가 작은 쪽으로 판정된다(현재 T-072 관문이 먼저 막음) — 매수 요청 수량 주문의 한도 기준을 `max(amountKRW, 단가×수량)` 로 올리는 후속 task 후보.

## Q-E 데모 승인 기록 (18:46 기록)

- 사용자 발화 그대로: "1. 텔레그램 수량에 대하여 승인"(10-26 저녁, 데모 v1 = `mockups/T-097-telegram-sizing-line-v1.html` 을 보고 한 승인). Leader 는 이 발화를 근거로 Q-E 구현(표시 줄)을 시작했다.
- **게이트 도구 기록은 보류**: `check.mjs approve --version 1 --quote "텔레그램 수량에 대하여 승인"` 이 `DEMO_GATE_REFUSED` — 발화 기록 `.claude/state/demo-gate/prompts.jsonl` 의 마지막 항목이 16:27 이라 이 메시지가 UserPromptSubmit 훅에 기록되지 않았다(원인 미상 — 훅이 이 메시지에서 돌지 않았다). 도구는 Leader 대리 승인을 막으므로 **임의로 기록하지 않았다.** `demo_gate.status` 는 `review_requested` 로 남아 있다. 다음 사용자 발화가 `prompts.jsonl` 에 기록되면 같은 원문으로 재시도한다. 화면 파일이 아니라(텔레그램 메시지 렌더러) 편집 훅이 막지 않는 영역이지만 절차상 기록이 비어 있다는 점을 보고에 명시한다.
- T-042 데모 면제도 같은 사유 + "면제" 표현을 도구가 생략 요청으로 인식하지 않아(`isWaiverText`) 기록하지 못했다 — 사용자에게 "생략" 표현 한 줄을 요청.
- **19:13 재시도·원인 확인**: 사용자 발화 그대로 "T-097 텔레그램 수량 데모 승인, T-042 데모 생략" 을 받아 `approve`·`waive` 를 다시 시도했으나 `DEMO_GATE_REFUSED`(발화 기록에서 못 찾음). **원인 확정 [확실, `hook.mjs` 읽음]**: UserPromptSubmit 훅 `recordPrompt` 는 `isInjectedPrompt` 로 `/<agent-message\s+from=/i`·`/<task-notification>/i` 등이 **프롬프트 안 어디든** 있으면 그 입력 전체를 "하네스 주입"으로 보고 기록하지 않는다(서브에이전트 보고문으로 승인을 위조하지 못하게 하는 의도적 fail-closed). 사용자 메시지가 서브에이전트 보고(`<agent-message from=…>`)와 같은 입력으로 도착한 두 건(저녁 승인 메시지·이 메시지)이 걸러졌고, 보고가 붙지 않은 깨끗한 메시지(18:55)는 기록됐다. **우회(prompts.jsonl 직접 추가 등)는 하지 않는다.** 해결: 모든 서브에이전트가 멈춘 조용한 시점에 사용자가 같은 문장을 다시 보내면 기록된다 — Leader 가 그 시점을 알려 준다. 그 사이 `demo_gate.status` 는 `review_requested` 로 남는다(편집 훅은 이 영역을 막지 않는 warn 단계).

## Q-E 구현 결과와 Reviewer 판정 요약 (19:14 기록)

- Developer(2라운드): `kis-domestic.ts` `roundToTick` 에 `export` 한 단어(로직 변경 0), `approval-message.ts`(`renderQuantityLine`, "금액" 바로 아래)·`approval-notify.ts`(`buildQuantityLine`·`NotifyDeps.fxRate?`)·새 시험 2파일(117개). 국내 단가는 어댑터가 실제 송신하는 호가단위 반올림가(`Math.round(price/tick)*tick`)와 같다. 해외는 정수 달러 단가(`overseasLimitUnitUsd`, 어댑터와 같은 계산)·환율은 현금 게이트와 같은 `fx_rates` 행·`judgeFxRow`(1시간 신선도). 환율 못 얻으면 해외 줄만 생략, 알림·버튼은 그대로.
- **Reviewer 판정 = FAIL(절차 사유)**: 코드 감사는 critical 0·high 0(어댑터 diff 산출 JS 가 `export` 한 단어만 다름, 목업과 문자 단위 일치, 버튼·서명 불변, 호가 표·송신 본문 3,000건 불일치 0, 해외 21만 건 불일치 0, 변이 44종 중 34 사망·7 동치·실질 공백 3(국내 버튼 서명 시험·`renderQuantityLine(null)`), 전체 jest 7,466 pass·tsc 0·기존 시험 수정 0줄). 그러나 `reviewer.md` 규칙상 데모 게이트 `DEMO_GATE_BLOCKED`(승인 미기록) 이면 fail 이다. **게이트 기록(위 사유로 보류)이 채워지면 Reviewer 가 5개 파일 sha256 12자(kis-domestic `eba2778e093a`·approval-message `331258cd4296`·approval-notify `b6dafd7074dd`·t097-approval-qty-line `366fcbd6288a`·t097-domestic-tick-parity `d891a4cc23f8`)만 대조해 PASS 줄을 추가한다**(코드 재감사 불필요 — 파일이 바뀌면 재감사).
- **사용자에게 알릴 고지 2건(Reviewer F-Q3·F-Q4)**: ① 해외 단가는 **알림 시점 환율 기준 예상값**이다 — 승인 때 환율이 움직이면 정수 달러 단가가 $1 어긋날 수 있다(수량은 원화 기준이라 불변; 같은 환율이면 불일치 0; 환율 ±0.1% 이동 시 단가가 달라질 확률은 $1~50 1.3%·$50~200 6%·$200~500 18%·$500~1,000 37%, 환율 캐시 5분·승인 TTL 30분). ② **승인된 목업 안내 문구 "1주 가격이 금액보다 크면 … 시그널 자체가 만들어지지 않습니다(변화 없음)" 는 코드와 다르다** — 수량 0 이면 현금 게이트가 모름(`quantity_zero`)으로 두어 승인 대기 시그널은 만들어지고, 알림은 수량 줄 없이 나가며, 승인하면 `quantity_below_min` 으로 거절된다(줄 규칙 "수량 줄 없음"은 목업과 맞다). 구현은 바꾸지 않고 정정만 고지(목업 HTML 은 승인 해시에 묶여 있어 수정하지 않는다).
- 비차단 보강: 국내 버튼 서명 시험 적용·`renderQuantityLine(null)` 가드 시험·시험 머리말 "독립" 표현 정정(파일이 바뀌면 재감사).

## Q-E 데모 승인 기록 완료 (21:39)

- 사용자 발화 그대로 "T-097 텔레그램 수량 데모 승인, T-042 데모 생략"(21:38 — 발화 기록 `prompts.jsonl` 에 정상 기록, 서브에이전트 보고가 붙지 않은 입력) → `check.mjs approve --version 1`(approved_at 21:39:01, sha256 `cd57b724…44ccd`). 사용자는 앞선 고지(해외 단가 환율 오차·목업 안내 문구 오류)를 받은 뒤 승인했다. 위 "Q-E 데모 승인 기록" 절의 "게이트 도구 기록 보류" 는 이로써 해소.

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

- [16:43] 확정 설계 1·2·3 + 수용 (a)(c)(d)(f) 구현 완료(4번 텔레그램 줄은 데모 게이트 대기로 미착수). 격리 worktree `~/.node-local/stockinvest-sizing-t097`(브랜치 `sizing-t097`, base `f50a3f7`), **미커밋**. 변경: `src/lib/signals/service.ts`(수정 +79/−7: `sizeOrderQuantity` 옵션 `{minOneShare}` 추가·기본 OFF, `buildOrderRequest` export + `amountKRW = sizing.limitBasisKrw`(= max(목표, 실현액), 수량 출처 amount 일 때만) + `sizing` 반환, INSERT 직전 `indicators.sizing` 기록(실패 시 키만 생략)), 신규 `src/lib/signals/sizing-snapshot.ts`(순수 함수: computeRealizedKrw·limitBasisKrw·computeSizingSnapshot·attachSizingSnapshot·readSizingSnapshot), 신규 시험 `__tests__/t097-sizing-golden.test.ts`(28)·`t097-sizing-record.test.ts`(7). 기존 시험 수정 0. 전체 jest 282 suites/7310 통과(4 suites skipped = disposable MariaDB), tsc 0. 호출부 배선 0(5곳 모두 옵션 미전달).
- [16:43] Leader 결정 필요: ① 해외 실현액 — `buildOrderRequest` 는 동기·환율 없음이라 원화 환산 단가 × 수량(정수 달러 반올림 미반영, 주당 ±$0.5). `overseasLimitUnitUsd` 정밀 계산은 `computeRealizedKrw({fxRate})` 로 준비·시험만, 주문 경로에 쓰면 OFF 에서도 해외 일부 주문의 amountKRW 가 바뀌어 불변 (a) 위반 ② 요청 수량 주문(exit 매도·직접 주문)에는 max 미적용(적용하면 지금 통과하는 주문이 한도에서 막히는 동작 변경) ③ 부동소수점 잡음 허용치 0.005원(난수 골든에서 실제 발생 확인 — 없으면 OFF 비트 동일성 깨짐).
- [17:06] Reviewer 비차단 권고 반영(Leader 지시, 미커밋). `service.ts` 주석 2곳만 수정(+7/−2, 비주석 변경 0줄 — 1라운드 판을 되살려 `git diff --no-index` 로 확인): F-5 "실제로 나가는 금액" → 원화 환산 단가 기준·정수 달러 반올림 ±$0.5/주 명시, F-1 `SizeOrderOptions` 에 "max 보호는 `buildOrderRequest` 경유 때만(entry-watcher:441·api/orders·approval-context:140 은 목표금액)" + ON 배선 필수 조건 4항. `t097-sizing-golden.test.ts` 에 S1·S2·S3 시험 3개 추가(31개). 복사본 변이 M16·M33·M35 각각 새 시험 1개씩 실패로 사망. 전체 jest 282 suites/7,313 통과(4 skipped), tsc 0. 기존 시험·로직·잡음 허용치·`readSizingSnapshot` 무변경.
- [17:18] Codex C2 지적(low) 반영(Leader 지시, 미커밋). **로직 변경 2줄(`sizing-snapshot.ts` 만)**: `:119` 한도 기준 분기를 `quantitySource==='amount'` → `minOneShareApplied === true` 로(옵션이 실제 적용됐을 때만 `max`, 그 밖은 값 비교 없이 목표 그대로 → OFF 비트 동일이 모든 입력에서 구조적으로 성립), `:94` `limitBasisKrw` 를 엄격한 max 로(`KRW_FLOAT_NOISE` 상수 삭제 — 적용 경로에서는 단가 > 목표가 보장돼 불필요). `service.ts` 는 주석만(F-1 보정: approval-context 는 사전 판정일 뿐; amountKRW 주석 새 규칙). 골든 시험 갱신·추가(Codex 재현값·큰 금액 1e13~1e15 난수 2만·computeSizingSnapshot 분기·F-8 Infinity 수량) 42개 통과. 복사본 변이 8종+F-8 대상 2종 전부 사망. 전체 jest 282 suites/7,317 통과(4 skipped), tsc 0, 기존 시험 수정 0.
- [18:52] Q-E 텔레그램 "수량" 줄 구현(사용자 승인 "1. 텔레그램 수량에 대하여 승인", Leader 지시). 격리 worktree `~/.node-local/stockinvest-qe-t097`(브랜치 `qe-t097`, base `e2a7206`), **미커밋**. 변경: `approval-message.ts`(+43/−0: `QuantityLineView`·`renderQuantityLine`, "금액" 줄 바로 아래 삽입 — 매수·진입 구간 아님·시장 일치·값 유효일 때만), `approval-notify.ts`(+72/−1: `buildQuantityLine`(순수, `readSizingSnapshot`→해외는 `overseasLimitUnitUsd`·`computeRealizedKrw` 재사용), 선택 의존성 `fxRate`(기본 = 현금 게이트와 같은 `fx_rates` USD_KRW 행 + `judgeFxRow`, fx.ts 외부 갱신 유도 없음), 버튼 메시지에만 배선·실패 시 줄만 생략), 신규 시험 `__tests__/t097-approval-qty-line.test.ts`(59). 기존 시험 수정 0(정확 문자열 단언은 간단한 본문뿐이고 간단한 본문은 불변). 변이 16종 중 15 사망·1 생존(M15 빌더 환율 검사 제거 — `overseasLimitUnitUsd` 가 같은 값을 거르는 동치). 전체 jest 283 suites/7,408 통과(4 skipped; 첫 실행에서 무관한 `kis-usage-isolation` 5초 타임아웃 1건 → 단독·재실행 통과), tsc 0. 데모 게이트 check = `DEMO_GATE_BLOCKED`(frontmatter 에 승인 미기록 — Leader 기록 필요, 수정 파일은 화면 경로 아님).
- [18:52] Leader 결정 필요: ① 국내 단가는 기록값(호가 추격 반영) 그대로라 실제 주문가(어댑터 `roundToTick`)와 다르고 원 단위 반올림으로 "=" 산술이 1원 어긋날 수 있다(예: 48,300×1.005 → `2주 × ₩48,541 (= ₩97,083)`, 실제 송신 2×48,550=97,100). 맞추려면 `kis-domestic.ts` 호가단위 함수 export(어댑터 변경) 필요 ② 해외 괄호 = 수량 × 정수 달러 × 환율(데모 예시 `≈ ₩98,000` 은 기록 실현액과 같은 값이라 해석이 갈림) ③ 진입 구간(감시 등록) 시그널은 줄 생략 ④ 간단한 본문(버튼 꺼짐)에는 넣지 않음.
- [18:59] Leader 결정 ① 반영(국내 단가 = 송신가). `kis-domestic.ts` 의 `roundToTick` 에 `export` 한 단어만 추가(`git diff` 1줄, 로직 무변경 — **Reviewer scope 에 이 어댑터 파일 추가**), `buildQuantityLine` 국내 분기가 그 함수로 단가를 만들고 "=" = 단가 × 수량. 어댑터 방향 확인: createOrder `ORD_UNPR = String(roundToTick(price))`, `Math.round(price / tick) * tick` = 가장 가까운 호가·정확히 절반이면 위(매수·매도 같음). 예: 48,300×1.005 → `2주 × ₩48,550 (= ₩97,100)`. 신규 시험 `t097-domestic-tick-parity.test.ts`(57: 경계 격자 47건을 줄·소스에서 옮긴 독립 규칙·진짜 createOrder 송신 본문 `ORD_UNPR` 3중 대조, 방향, 가격대, 소스 고정) + 기존 신규 파일에 발송 경로 사례 1건(60). 변이 23종 중 22 사망(반올림 건너뛰기·방향 반전 내림/올림·복사본 이탈·"=" 기록값 2종 포함)·1 생존(M15 동치). 전체 jest 284 suites/7,466 통과(4 skipped), tsc 0, 새 시험 2파일 타입 검사 0. 미커밋.

## Reviewer

- [17:01] 1라운드 독립 감사. 대상 = worktree `~/.node-local/stockinvest-sizing-t097`(base `f50a3f7`) 미커밋 4파일(`service.ts` 수정·`sizing-snapshot.ts`·시험 2개 신규). Developer 보고를 믿지 않고 직접 실행: 전체 jest 282 suites pass·4 skipped·7,310 tests pass, `tsc --noEmit` 오류 0, 새 시험 35개 pass [확실]. `git status` 로 기존 시험 파일 수정 0줄(`order-sizing.test.ts:62-64`·`:286` 포함)·`approval-message.ts`/`approval-notify.ts` 무변경(텔레그램 "수량" 줄 흔적 없음) 확인 [확실]. 새 코드에 비밀·`.env`·금액 절대값 하드코딩 없음(상수는 `KRW_FLOAT_NOISE=0.005` 하나), DB 컬럼 변경 없음.
- [17:01] 항목1 옵션 OFF 비트 동일(수용 a) — Developer 골든(base 를 손으로 복제)과 별개로 **`git show f50a3f7` 원문 그대로**를 모듈로 만들어 변경 후와 같은 입력에 대조했다(스크래치패드 `t097rev/repo`). ① `buildOrderRequest` 3,000,000 난수(국내·해외 7개 심볼·지정가/시장가·매수/매도·추격 0~20%·수량 유무·NaN/±Infinity/-0/문자열/0/음수 금액·가격, 가격의 정수배 ±1ulp 경계 35%): **목표금액 ≤ 3e13 원 범위에서 `req`·`sized` 키 집합·`Object.is` 값 불일치 0건, `amountKRW` 변경 0건**. ② `sizeOrderQuantity` 단독 1,000,000 난수 불일치 0건. ③ 3e13 원을 넘는 비현실 금액(2e14~1e18 원)에서만 30건 불일치 — 전부 base 보다 **큰**(엄격한) 쪽이고 작은 쪽 0건: 절대 허용치 0.005원이 그 규모의 1ulp(≥0.0078원)보다 작아져서다. 실무 금액(슬롯 10만~수백만 원)과 무관하나 "비트 동일"의 성립 범위는 목표금액 약 3.5e13 원 미만이다.
- [17:01] 항목1 부동소수 경계·허용치 0.005원 평가 — 경계 사례는 실제로 발생한다(`floor(a/p)×p > a` 가 2,000,000 표본당 783건(1e5 규모)~47,818건(1e11 규모)). 초과폭 최대: 1e5~1e7 규모 ≤ 2e-9 원, 1e11 규모 3e-5 원, 1e13 규모 0.002 원(전부 0.005 미만), 3.5e13 부터 0.0078 원. 즉 실무 규모에서 잡음은 허용치보다 6~7자리 작고, 허용치가 숨길 수 있는 **실제** 초과는 옵션 OFF 에서는 0(내림 규칙의 실현액은 수학적으로 목표 이하), 옵션 ON 에서는 "1주 단가가 목표를 0.005원 이하로 넘는" 경우뿐이라 실무 영향은 0이다. 그래도 필요보다 훨씬 크고 3.5e13 원 위에서는 오히려 작으니 잡음 보정은 `minOneShareApplied=false` 일 때만 쓰거나 상대 허용치로 바꾸길 권한다(낮음).
- [17:01] 항목2 한도 약화·fail-open — **base 보다 작은 한도 기준 금액이 나오는 입력 0건** [확실]. 근거: (a) 코드 — `limitBasisKrw` 는 목표금액이 유한 양수일 때 `target` 또는 `realized(>target+0.005)` 둘 중 하나만 돌려주므로 항상 ≥ target, 비정상 목표(NaN·0·음수·문자열·Infinity)는 받은 값 그대로라 `checkOrderMax` 의 `!(amount > 0)` 가 지금처럼 막는다. (b) 실행 — 위 3M 난수에서 `now < base` 0건, 옵션 ON 1,000,000 난수에서도 `now < base` 0건, `basis + 0.005 < 수량×지정가` 0건, 내림 결과가 1주 이상이면 ON 과 OFF 의 주문 요청이 같음. 경로 추적: `req.amountKRW` → `submitOrder`(`dry-run.ts:153`) `resolveOrderAmountKRWAsync`(>0 이면 그대로) → `orders.amount_krw` 저장·`checkOrderMax`(`:202`)·`checkDailyMax`(`:213`, 일일 합산) — 전부 이 값을 쓰고 base 와 값이 같다. `createSignal` 의 sizing 기록은 INSERT 의 `indicators` 에만 들어가고, 자동 제출 주문은 INSERT 뒤 `buildOrderRequest` 를 **새로** 호출(`service.ts:713`)하므로 기록 실패·기록값이 한도 기준에 영향을 주지 못한다. `decision`(routeSignal)도 sizing 첨부 전(`:585`)에 이미 계산된다.
- [17:01] 항목3 옵션 배선 0 — `sizeOrderQuantity` 외부 호출부 4곳(`orders/route.ts:66`·`entry-watcher/route.ts:413`·`post-market-engine.ts:128`·`:258`)과 `buildOrderRequest` 내부 호출 1곳, `buildOrderRequest` 호출부 4곳(`service.ts:483`·`:568`·`:713`·`:833`)과 새 기록 호출 `:642` 전부 옵션 미전달. `minOneShare` 는 src 전체에서 `service.ts`·`sizing-snapshot.ts` 에만 있고 `process.env`·`system_config`·요청 본문 어느 경로로도 켜지 않는다 [확실].
- [17:01] 항목4 `createSignal` 변경 — 새 읽기는 `getStyleConfig`(60초 캐시·내부에서 예외 삼킴)와 `getEffectiveChasePct`(`SELECT … LIMIT 1`·`catch` 로 삼킴) 둘이고 둘 다 읽기 전용, 순서는 중복 검사 뒤·INSERT 앞이라 검증 관문·현금 게이트·중복 검사·킬스위치(`submitOrder` 안) 순서는 그대로다. 실패 모드는 INSERT 와 같은 DB 도메인이고(DB 가 멈추면 INSERT 도 멈춤), 추가 비용은 시그널당 uncached 읽기 1회(자동 제출 경로는 INSERT 뒤에 같은 읽기를 한 번 더 한다) — 보호 청산 매도 시그널도 같은 지연을 받으나 한 왕복이라 새 위험으로 보지 않는다(낮음, 값 재사용 또는 requested 출처 생략 최적화 여지). `indicators.sizing` 소비자: `approval-notify`(`exit_kind`·`extractEntryZone` 만)·`approval-transitions`·`custom-confirm-guard`·`paper-fill`(복사 후 키 추가)·`telegram-*`·`rag/format`(ai.* 와 rsi 등 고정 키)·`trade-report`/`signal-quality`/`postmortem-core.js`(JSON_EXTRACT 고정 경로)·`signal-followup`·`missed`·화면(`Dashboard`·`SignalFeed`·`OrderDetail`·`TradingBoard` 등 고정 키 접근)을 grep·읽기로 확인 — 키 전체를 순회하는 소비자 0, 새 키에 안전 [확실]. 예외 하나: `scripts/export-llm-trainset.sh` 가 `s.indicators` 를 원문 그대로 LoRA 학습 JSONL 에 싣는다 — 새 키(약 224바이트)가 학습 데이터에 섞일 뿐 해는 없다(낮음). `json_valid` CHECK·텔레그램 길이·화면과 무관(알림 본문에 indicators 를 싣지 않는다). 호출부가 미리 넣은 `sizing` 은 서버 계산으로 덮고(시험 있음), 배열·문자열 indicators 는 그대로 둔다 → 사용자가 `POST /api/signals` 로 위조 sizing 을 심을 수 없다.
- [17:01] 항목6 변이 시험 — 복사본에서 핵심 로직 35종 변이, 새 시험 35개 기준 **32종 사망·3종 생존**. 사망: M01 `amountKRW` 를 실현액 단독(11개 시험 실패)·M02 max→min(13)·M32 한도 기준을 항상 실현액(12)·M03 허용치 0·M04 0.5원·M05 50원·M34 허용치 부호 반전·M27 `>` 경계·M06 `requested` 판정 제거·M07 max 대상을 requested 까지 확대·M25 시장가도 amount·M12 옵션 OFF 판정 반전(7)·M13 ON 분기 가드 제거·M26/M18 ON 플래그 누락·M08 catch 를 재던짐으로·M09 null indicators·M10 배열 처리·M11 덮어쓰기 순서·M14 규칙 버전 검사·M15/M28 정수 검사·M17 Infinity 실현액·M19 추격 비율·M20/M31 해외 정밀 분기·M21 단가 추격·M22 추격 스위치·M23 첨부 제거·M24 amountKRW 원복·M29 null→undefined·M30 매도 추격 방향. **생존 3**: (S1) M16 `limitBasisKrw` 의 "목표금액이 유한 양수가 아니면 받은 값 그대로" 가드 제거 — `buildOrderRequest` 로는 도달 불가(목표 ≤ 0 이면 수량 0)라 시험이 못 잡는다, 직접 호출 `limitBasisKrw(0, 5000)===0`·`(-5, 5000)===-5` 시험 추가 권고. (S2) M33 ON 분기의 `Number.isFinite(raw)` 제거 — 금액 Infinity 시험 없음(결과는 `Infinity` 한도 기준이라 한도에서 막혀 실해 없음). (S3) **M35 `quantitySource` 판정에서 `Number.isFinite` 제거**(NaN 수량을 requested 로 오분류) — 옵션 ON 에서 NaN 수량+지정가+목표 10만+MU 이면 올바른 코드는 `amount`·한도 기준 1,165,120, 변이는 `requested`·한도 기준 10만(**한도가 느슨해짐**)인데 시험이 없다. 이 판정은 `sizeOrderQuantity` 의 분기 조건을 복제한 것이라 두 곳이 어긋나면 ON 에서 한도가 새는 구조다 — 시험 추가와, ON 배선 task 에서 출처를 한 곳에서 계산하도록 정리하길 권고.
- [17:01] 항목7 전체 시험 — 위 1번 줄 그대로(282 pass·4 skipped·7,310·tsc 0 재현). `tsconfig.json` 이 `__tests__`·`*.test.ts` 를 제외하므로 새 시험 파일은 tsc 타입 검사 대상이 아니다(프로젝트 전체 기존 구성, 낮음).
- [17:01] 항목9 주석 사실성 — `:360-365` 갱신 주석의 핵심("내림 규칙에서는 실현액 ≤ 목표라 결과는 T-097 이전과 같다", `requested`·`unresolved` 는 목표 그대로, 해외 원화 직접 채움·환율 이중 곱 약 1,300배)은 코드·시험과 맞다 [확실]. 부정확한 곳 2군데: (i) `:363` "실제로 나가는 금액으로 한도를 판정한다" — 해외는 원화 환산 단가×수량이지 정수 달러로 반올림된 실제 송신가가 아니다(±0.5달러/주 오차, 아래 판단 ①). (ii) `SizeOrderOptions` 주석(`:219-227`) "켜면 … 한도 판정은 실현액 기준으로 막힌다" — `buildOrderRequest` 를 거칠 때만 참이다. `entry-watcher`(`route.ts:441` `amountKRW: Number(row.amount_krw)`)와 `orders/route.ts`(`amountKRW: body.amountKRW`)는 `buildOrderRequest` 를 쓰지 않고 자기 요청을 만들고, `approval-context.ts:140` 사전 판정도 목표금액을 쓴다. 이 호출부에서 옵션을 켜면 1주(예: 해외 $880)가 목표 10만 원 기준 한도를 통과해 **fail-open** 이다(발견 F-1).
- [17:01] 발견 목록 — critical 0 · high 0 · medium 2 · low 5. **F-1 (medium, 잠복·현재 도달 불가)** `minOneShare` 가 공유 함수 `sizeOrderQuantity` 의 옵션으로 열려 있어, 설계 문구 "호출부가 고름"대로 `entry-watcher`·`api/orders` 에서 켜면 `max(목표, 실현액)` 보호가 따라가지 않는다(`service.ts:219-227`, `:261-269`). 현재 배선 0이라 위험은 없다. ON 배선 task 의 필수 조건으로 적는다(아래 판단 ① 이월 목록). **F-2 (medium)** 해외 실현액이 원화 환산 단가×수량이라 정수 달러 반올림 분만큼 실제 송신 금액을 낮게 본다 — 실측 예시 $50.5·10주·목표 668,620원이면 실제 송신 675,240원(+0.99%), 옵션 ON 으로 올려지는 1주($75 이상)는 최대 0.67%·$880 는 0.06%. base 와 동일한 기존 공백이라 이번 변경이 악화시키지 않는다(`max` 도 이를 닫지 못한다). **F-3 (low)** 허용치 0.005원 — 위 항목1. **F-4 (low)** 변이 생존 3종(S1~S3, 특히 S3). **F-5 (low)** 주석 부정확 2곳(항목9). **F-6 (low)** `readSizingSnapshot` 은 운영 코드 호출자가 없다(데모 승인 대기 중인 4번 텔레그램 줄 준비용·시험 있음), `buildOrderRequest` export 는 시험용이다. **F-7 (low)** `export-llm-trainset.sh` 학습 데이터에 새 키 혼입·시그널당 uncached 읽기 1회 추가·`__tests__` 가 tsc 대상 밖.
- [17:01] Leader 결정 요청 ① 해외 실현액=원화 환산 단가×수량(정수 달러 정밀 계산은 함수·시험만) — **이번 task 에서는 수용**한다. 정밀 계산을 주문 경로에 쓰면 옵션 OFF 에서도 해외 일부 주문의 `amountKRW` 가 최대 약 1% 바뀌어 수용 (a) 를 깬다(반올림이 위로 갈 때만 커지므로 더 보수적인 쪽이긴 하다). 단 확정 설계 2("`overseasLimitUnitUsd` 와 같은 계산")에서 의식적으로 이탈한 것이므로 **ON 배선 task 의 필수 처리 사항**으로 이월한다: (1) 실현액을 `수량 × overseasLimitUnitUsd(단가, 환율) × 환율` 로 계산하고 한도 기준은 `max(목표, 원화환산 실현액, 정밀 실현액)` (2) 환율은 송신 시점 어댑터와 같은 출처·값을 쓸 것(비동기가 필요하므로 `buildOrderRequest` 동기 구조 변경 또는 호출부에서 환율을 주입) (3) `entry-watcher`·`api/orders`·`approval-context.ts:140` 사전 판정도 같은 한도 기준을 쓰도록 배선하고, "옵션을 넘기는 모든 운영 호출부는 `submitOrder` 에 `limitBasisKrw` 를 넘긴다"를 소스 grep 시험으로 고정 (4) `quantitySource` 를 `sizeOrderQuantity` 와 한 곳에서 계산(S3 시험 포함) (5) 반올림이 아래로 가는 경우(실제 송신이 더 작음)는 보수 방향이라 그대로 둔다.
- [17:01] Leader 결정 요청 ② 요청 수량 주문(exit 매도·직접 주문)에 max 미적용 — **동의한다.** 매도는 `submitOrder` 가 1회·일일 한도에서 애초에 제외(`dry-run.ts:201`·`:212` `side !== 'sell'`)해 한도 기준 금액이 쓰이지 않고, 매수 요청 수량 주문에 적용하면 지금 통과하는 주문이 막히는 동작 변경이라 수용 (a) 와 충돌한다. 관찰 하나(이번 변경 범위 밖·기존 구조, base 와 동일 [확실]): `POST /api/signals` 는 `quantity` 와 `amountKRW` 를 따로 받아, 매수에서 `quantity` 가 크고 `amountKRW` 가 작으면 한도가 작은 쪽으로 판정된다. 지금은 G1·G6 검증 관문(전략 16개 모두 unvalidated)이 매수를 먼저 막고 있다. 후속 후보: 매수 요청 수량 주문의 한도 기준을 `max(amountKRW, 단가×수량)` 로 올리는 별도 task(호출부 영향 조사 후 `/이슈기록` 또는 새 task). 이번 sizing 기록은 `requested` 출처에도 `realizedKrw` 를 남기므로 이 불일치가 관측 가능해진다.
- [17:01] Leader 결정 요청 ③ 잡음 허용치 0.005원 — **이번 task 에서는 수용**한다(실무 규모에서 숨기는 실제 금액 0원, 시험이 상·하한을 고정: 변이 M03/M04/M05/M34 사망). 다만 위 항목1 대로 상대 허용치(예: `max(target, realized)×1e-12`)이거나, 허용치는 `minOneShareApplied=false`(내림 결과라 실현액>목표가 곧 잡음) 일 때만 쓰고 ON 으로 올린 경우는 엄격 `max` 로 바꾸는 쪽을 권한다. 비차단.
- [17:01] 확인하지 못한 것: 운영 DB·KIS·서버·텔레그램 실발송(금지 범위라 실행 안 함), 데모 승인 대기 중인 텔레그램 "수량" 줄(이번 범위 밖), 옵션 ON 배선 후 실주문 경로(미구현), `git commit` 시 훅 동작(커밋 금지). 판정 scope 는 아래 4파일이며 추적 목적으로 읽은 `dry-run.ts`·`order-limits.ts`·`entry-watcher/route.ts`·`orders/route.ts`·`approval-context.ts` 등은 무변경이라 scope 에 넣지 않았다.
- [17:01] **최종 판정: PASS (scope: src/lib/signals/service.ts, src/lib/signals/sizing-snapshot.ts, src/lib/signals/__tests__/t097-sizing-golden.test.ts, src/lib/signals/__tests__/t097-sizing-record.test.ts)**
- [17:12] 2라운드(변경분 재감사). 1라운드 pass 뒤 Developer 가 비차단 권고를 반영했다. 변경 파일 확인 — 1라운드에 내가 쓴 스크래치패드 복사본(그 시점 worktree 와 `cmp` 동일을 확인해 둔 것)과 현재 worktree 를 `sha256` 로 대조: `sizing-snapshot.ts`(`696cb48a…`)와 `t097-sizing-record.test.ts`(`c43af227…`)는 **동일 = 이번에 바뀌지 않았다**, 바뀐 것은 `service.ts`(`d33cb42a…`→`2cbd2c7e…`)와 `t097-sizing-golden.test.ts`(`1cc27435…`→`862ba975…`) 둘뿐이다. Developer 가 만든 `service.round1.ts` 는 쓰지 않았다 [확실].
- [17:12] 확인 1(비주석 변경 0줄) — 1라운드 복사본 대비 `diff` 결과는 두 군데(`SizeOrderOptions` JSDoc 1줄→5줄, `amountKRW` 설명 `//` 1줄→2줄, +7/−2)이고 전부 주석 줄이다. 추가로 TypeScript `transpileModule(removeComments)` 로 두 판의 산출 JS 를 비교하니 **완전 일치(27,000자=27,000자)** — 비주석 변경 0줄 [확실]. 골든 시험은 360줄 이후 추가만(기존 줄 변경 0, 28→31개).
- [17:12] 확인 2(주석 사실성) — F-5 주석 "실현액 = 수량 × 호가 추격 지정가(원), 해외는 원화 환산 단가 기준이라 정수 달러 송신과 주당 최대 ±$0.5 다르다": `computeRealizedKrw` 의 환율 없는 분기(`수량 × unitPriceKrw`, `unitPriceKrw=chasedPrice`)와 일치하고, 어댑터 `kis-overseas.ts:564-569`(`roundToTickOverseas`: $1 이상 `Math.round`·미만 소수 4자리)·`:615-619`(지정가는 추가 보정 없음, 시장가만 ±0.5%)와 맞다 [확실]. F-1 주석: `entry-watcher/route.ts:441` `amountKRW: Number(row.amount_krw)`·`api/orders/route.ts:81` `amountKRW: body.amountKRW`·`approval-context.ts:140` `amountKRW: args.amountKRW` 줄이 실제로 그 내용이고 셋 다 `buildOrderRequest` 를 거치지 않는다 — "max 보호는 `buildOrderRequest` 경유 시만"과 ON 배선 필수 조건 4항(①한도 기준 3값 max ②환율 출처 ③세 호출부 동일 기준 ④출처 한 곳 계산)은 1라운드 이월 목록과 같다. 사소한 과일반화 1건: `approval-context.ts` 는 알림 사전 판정일 뿐 실제 한도 게이트가 아니라 "거기서 옵션만 켜면 한도가 열린다"는 `entry-watcher`·`api/orders` 에만 정확하고, `approval-context` 는 사전 판정이 낙관적이 되는 것(실제 한도는 `submitOrder` 가 판정)이다(낮음, 주석 문구 보정 권고).
- [17:12] 확인 3(새 시험 3개의 의미) — S1 은 `limitBasisKrw(0,5000)===0`·`(-5,5000)===-5`, S2 는 옵션 ON+금액 Infinity 에서 `{quantity:0, raw:Infinity, minOneShareApplied:false}`·`req` 가 base 와 `Object.is` 동일, S3 는 옵션 ON+수량 NaN+지정가+MU 에서 수량 1·`quantitySource:'amount'`·한도 기준=`req.amountKRW`=1,165,120 을 단언한다. 복사본에서 전체 변이를 다시 돌렸다(38개 시험 기준): 1라운드 생존이던 **M16·M33·M35 는 모두 사망**(각 1개 실패), 나머지 1라운드 사망 32종도 전부 계속 사망(회귀 0). S3 계열로 직접 만든 추가 변이 5종: N03(`sizeOrderQuantity` 요청 수량 `isFinite` 제거)·N08(`isFinite`→`isInteger`)·N11(ON 으로 올린 경우 한도 기준을 목표로)·N12(수량 0 이면 `unresolved` 로 기록) 사망, **N01(`isFinite`→`> 0`)·N09(`isFinite`→`!isNaN`) 생존**.
- [17:12] 새 발견 F-8 (low) — N01·N09 생존: `quantitySource` 판정이 Infinity 수량을 `requested` 로 오분류해도 시험이 못 잡는다. 올바른 코드는 옵션 ON+Infinity 수량+MU 에서 수량 1·`amount`·한도 기준 1,165,120 이고(직접 실행 확인), 변이는 한도 기준이 목표 10만이 된다(한도가 느슨해짐). 현재는 도달 불가 — 옵션 배선 0이고 JSON 본문·DB DECIMAL 로는 Infinity 수량이 만들어지지 않으며 `invalidNumericField` 도 거른다. 그래도 `sizeOrderQuantity` 분기 조건을 복제한 구조(1라운드 S3 의 뿌리)가 그대로이므로 ON 배선 task 의 ④(출처를 한 곳에서 계산)에서 해소하고, 그 전이라면 `quantity: Infinity` 시험 한 줄을 S3 옆에 추가하길 권한다. 이번 변경 pass 를 막지 않는다.
- [17:12] 확인 4·5(전체 시험·기존 시험) — worktree 에서 전체 jest 재실행: 282 suites pass·4 skipped, **7,313 tests pass**(Developer 주장과 일치, 1라운드 7,310+새 시험 3), `tsc --noEmit` 오류 0. `git status` 상 tracked 시험 파일 수정 0줄(수정된 tracked 파일은 `service.ts` 와 worktree 안 vault task 파일뿐)·`order-sizing.test.ts:62-64`·`:286` 무변경 유지 [확실]. 참고(Leader 몫): worktree 의 `agent-vault/10-Flow/tasks/T-097-price-first-sizing.md` 사본은 메인 트리와 따로 있어 커밋 훅은 그쪽 `## Reviewer` 의 마지막 판정 줄을 읽는다 — 이 2라운드 줄을 그 사본에도 옮겨야 한다(나는 지정된 메인 트리 파일만 고쳤다).
- [17:12] **최종 판정: PASS (scope: src/lib/signals/service.ts, src/lib/signals/sizing-snapshot.ts, src/lib/signals/__tests__/t097-sizing-golden.test.ts, src/lib/signals/__tests__/t097-sizing-record.test.ts)**
- [17:27] 3라운드(Codex C2 지적 반영 재감사, 비주석 로직 변경 포함). 파일 대조 — 스크래치패드의 2라운드 감사 복사본 대비 sha256: `t097-sizing-record.test.ts`(`c43af227…`)는 **동일 = 이번에 바뀌지 않았다**. 바뀐 것은 `sizing-snapshot.ts`(`696cb48a…`→`81214a2e…`)·`t097-sizing-golden.test.ts`(`862ba975…`→`05ab182d…`)·`service.ts`(`2cbd2c7e…`→`16e856e1…`). `sizing-snapshot.ts` 는 변경분만이 아니라 파일 전체를 다시 읽고 주석을 뺀 산출 JS 로 로직을 한 번 더 확인했다 [확실].
- [17:27] 확인 6(`service.ts` 비주석 0줄·기존 시험 0줄) — 1라운드에 내가 보관한 복사본(`service.round1.reviewer.ts`, 1라운드 pass 시점 worktree 와 `cmp` 동일을 확인해 둔 것)과 현재 worktree 의 `diff` 는 주석 줄뿐(`SizeOrderOptions` JSDoc·`amountKRW` 설명 `//`)이고, `transpileModule(removeComments)` 산출 JS 가 **완전 일치(27,000자=27,000자)** — 1라운드 판 대비 비주석 변경 0줄 [확실]. `git status`: tracked 파일 중 수정된 것은 `service.ts` 와 worktree 안 vault 사본뿐, `git diff -- '*.test.ts'` 비어 있음(기존 시험 수정 0줄, `order-sizing.test.ts` 포함). `KRW_FLOAT_NOISE` 는 src·scripts·docs 어디에도 남지 않았다.
- [17:27] 확인 1(옵션 OFF 비트 동일이 구조적으로 성립) — 코드 추적: `minOneShareApplied` 키는 `sizeOrderQuantity` ②(지정가+수량 미지정)에서 `opts.minOneShare === true` 일 때만 생기고(`opts.minOneShare !== true` 면 `{quantity, raw}` 로 끝나 **키 자체가 없다**), `true` 는 `quantity === 0 && Number.isFinite(raw) && raw > 0`(내림 0주→1주 승격) 한 곳뿐이다. ①(요청 수량)·③(시장가)은 옵션 ON 이어도 키가 없다. `buildOrderRequest` 는 이 값을 그대로 `computeSizingSnapshot` 에 넘기고, 거기서 `args.minOneShareApplied === true` 가 거짓이면 `basis = args.targetKrw`(값 비교·연산 없이 같은 값) → `amountKRW: sizing.limitBasisKrw` 가 `input.amountKRW` 와 `Object.is` 로 같다 — 입력 크기와 무관한 **구조적 동일** [확실]. 실행 재확인(스크래치패드 `repo2`, 원문 `git show f50a3f7` 모듈 vs 변경 후): `buildOrderRequest` 난수 3,000,000건(금액 최대 1e18·NaN/±Infinity/-0/문자열·가격 1e-9 포함) **불일치 0·`amountKRW` 변경 0**(1라운드 때는 2e14 원 이상에서 30건), `sizeOrderQuantity` 단독 1,000,000건 불일치 0, 1e5~1e15 원 구간별 200,000건 중 변경 0(1e14 구간은 이전 3,285건·1e15 구간은 3,647건이었다).
- [17:27] 확인 2(한도 약화·fail-open) — base 보다 작은 한도 기준 0건 [확실]: OFF 3M건 `smaller=0`, ON 1M건(`shortfall`=수량×지정가가 한도 기준보다 0.005원 넘게 큰 경우 0, `smaller` 0, 내림 1주 이상이면 ON 과 OFF 요청 동일). Developer 논거 검증 — 적용(`true`)이 되려면 `fl(a ÷ p) < 1` 이고, IEEE 나눗셈은 정확 반올림·단조라 `a ≥ p` 이면 `fl(a ÷ p) ≥ 1` 이므로 적용 ⇒ `a < p`(엄격)이며 수량은 정확히 1이라 실현액 `1 × p` = `p` > `a` → 엄격한 `max` 는 항상 실현액을 고른다. 반례 탐색: 3,200,018쌍 (정수배·`a=p`·`nextDown(p)`·`nextUp(p)`·`p×(1−2⁻⁵³)`·`p×(1±2⁻⁵²)`·1e-10~1e20 규모·서브노멀 `5e-324`·`Number.MAX_VALUE` 조합, 국내·해외) 에서 불변식 위반 **0건**(적용 1,800,357건), `buildOrderRequest` ON 1,500,000건에서 적용(1,004,658건) 때 `req.amountKRW === 추격 지정가 > 목표 && 수량 1` 위반 0, 비적용 때 base 와 `Object.is` 불일치 0 [확실].
- [17:27] 확인 3(`quantitySource` 는 기록용) — src 전체 grep: `quantitySource` 는 `service.ts` 가 값을 만들어 `computeSizingSnapshot` 에 넘기고 스냅샷에 싣고 `readSizingSnapshot` 이 읽을 뿐, 한도 기준 계산에는 쓰이지 않는다 [확실]. 이월 4항과의 관계: 충돌하지 않고 오히려 약해진다 — 라벨이 어긋나도(변이 N01·N09: Infinity 수량을 `requested` 로 오분류) 이제 한도는 새지 않는다(1~2라운드 F-8 해소). 대신 한도 기준이 `sized.minOneShareApplied` 하나에 걸린다. 따라서 이월 ④의 성격이 "출처를 한 곳에서 계산(한도 안전)"에서 "기록 정확성"으로 내려가고, ON 배선 호출부(`entry-watcher`·`api/orders`)는 자기 `sizeOrderQuantity` 결과의 `minOneShareApplied` 로 한도 기준을 올려야 한다(F-10).
- [17:27] 확인 4(변이 시험, 복사본 · 시험 42개 기준 = 골든 35 + 기록 7) — 이번 run 62종 중 **killed 51 · survived 2 · skip 9**(skip 9 = 허용치 상수 삭제·분기 조건 변경으로 텍스트가 사라진 1·2라운드 변이 M02·M03·M04·M05·M07·M27·M32·M34·N11). 새 로직 변이 21종(P01~P21): 분기 제거(P01)·반전(P02)·`=== true` 완화 `!= null`(P03)·`quantitySource` 트리거 복원(P04)·OR 복원(P05)·max→min(P06)·항상 실현액(P07)·**고정 허용치 복원(P09)**·목표 가드 제거(P10)·Infinity 실현액 가드 제거(P11)·항상 목표(P12)·실현액 0.99배(P13)·적용 플래그 전달 제거(P14)·OFF 판정 반전(P15)·적용 플래그 false(P16)·ON 1주 이상에도 true(P17)·승격 조건 `quantity===0` 제거(P18)·`raw>0` 제거(P19)·`req.amountKRW` 실현액 단독(P20)·원복(P21) **전부 사망**, 생존은 P08(`>`→`>=`)뿐인데 같으면 같은 값이라 동치 변이다. 1·2라운드 변이 중 M01·M06·M08~M26·M28~M31·M33·M35·N01·N03·N09·N12 계속 사망(회귀 0) — 지정하신 M16·M33·M35·N03·N12 포함, M02·M32·N11 은 P06·P07·P12 로 이동해 사망. 삭제된 허용치 시험(M03·M04·M05·M34)의 실질 대체: 허용치 복원 변이 P09 가 새 시험 2개(Codex 재현값·`limitBasisKrw(100_000, 100_000.001)`)에 죽고, 분기 제거 P01 이 Codex 재현값 시험에 죽는다 — 대체됨. **생존 1건 N08**(`quantitySource` 판정 `isFinite`→`isInteger`, 소수 수량의 라벨만 `amount` 로 바뀜): 한도 영향 없는 기록 라벨이라 낮음 — 2라운드에서는 한도에 영향이 있어 죽었으나 이번 변경으로 영향이 사라졌다.
- [17:27] 확인 5(전체 시험) — worktree 에서 재실행: 282 suites pass·4 skipped, **7,317 tests pass**(Developer 주장과 일치), `tsc --noEmit` 오류 0 [확실]. 새 시험 4개(Codex 재현값 `383614116660319.2`/`42623790740035.47` 이 실현액−목표 > 0.005 임을 단언해 옛 로직이면 실패함을 입증, 1e13~1e15 난수 20,000건, `computeSizingSnapshot` 분기 조합, F-8 Infinity 수량 ON)는 변이로 실효를 확인했다.
- [17:27] 확인 7(`sizing-snapshot.ts` 주석 사실성) — 머리말 2항(적용 시에만 계산·그 밖은 값 비교 없이 목표)·Codex C2 언급(허용치 방식은 3.5e13 원 이상에서 곱셈 오차가 허용치 초과 — 내 1라운드 실측과 일치)·`SizingQuantitySource`(기록용, `amount` 가 옵션이 적용될 수 있는 유일한 출처)·`limitBasisKrw`(엄격한 max, `fl(목표÷단가)<1 → 단가>목표 → 실현액>목표` 논거는 위 3.2M쌍 검증과 일치)·`computeSizingSnapshot`(분기이지 값 비교가 아님, `requested` 에 max 비적용=범위 밖)·`SizingSnapshot.limitBasisKrw` 행이 모두 코드와 맞다 [확실]. 단 `limitBasisKrw` 주석의 "실현액(1 × 단가) > 목표" 연쇄는 환율을 주지 않은 원화 환산 실현액 기준이다 — 이월 ①로 `fxRate` 정밀 실현액(정수 달러 반올림, 아래로 내려갈 수 있음)을 넘기면 이 부등식은 보장되지 않으므로 호출부는 세 값의 `max` 를 받아야 한다(이미 이월 ① 문구에 있음).
- [17:27] 새 발견 — critical 0 · high 0 · medium 0 · low 3. **F-9 (low, 옵션 ON 전용 잠복)** 문자열 금액 `'100000'` + ON + MU: `sizeOrderQuantity` 는 나눗셈 강제변환으로 1주로 올리지만(`applied:true`) `limitBasisKrw` 는 숫자가 아닌 목표를 받은 값 그대로 돌려줘 한도 기준이 `'100000'` 문자열 그대로다(실현액으로 올라가지 않음 = ON 에서 fail-open) — 직접 실행으로 확인. 지금은 도달 불가(옵션 배선 0, API `invalidNumericField` 가 `Number.isFinite` 로 비숫자 금액을 400 으로 거름, DB 경로는 `Number()`). 1·2라운드 코드도 같은 동작이라 회귀 아님. ON 배선 task 에서 승격 조건에 `typeof amountKRW === 'number'` 를 넣고 시험으로 고정할 것. **F-10 (low, 문서)** `service.ts:229` ON 배선 필수 조건 ④ "`quantitySource` 를 한 곳에서 계산"이 이번 변경으로 한도 안전 조건이 아니라 기록 정확성으로 내려갔다 — 문구를 "호출부는 자기 `sizeOrderQuantity` 결과의 `minOneShareApplied` 로 한도 기준을 올린다"로 갱신하길 권한다(비차단, 다음 코드 수정 때). **F-11 (low)** 변이 N08 생존(라벨 전용).
- [17:27] 확인하지 못한 것: 운영 DB·KIS·서버·텔레그램 실발송(금지), 옵션 ON 배선 후 실주문 경로(미구현), 커밋 훅 동작(커밋 금지). 참고(Leader 몫): worktree 안 vault 사본의 `## Reviewer` 에 이 3라운드 줄까지 옮겨야 훅이 읽는다(나는 지정된 메인 트리 파일만 고쳤다). Codex 지적의 판정: **채택**(근거 확인됨 — 1·2라운드 방식은 3.5e13 원 이상에서 실제로 base 와 달라졌고, 이번 구조 변경이 이를 제거했다).
- [17:27] **최종 판정: PASS (scope: src/lib/signals/service.ts, src/lib/signals/sizing-snapshot.ts, src/lib/signals/__tests__/t097-sizing-golden.test.ts, src/lib/signals/__tests__/t097-sizing-record.test.ts)**
- [19:11] Q-E 감사(텔레그램 "수량" 줄). 대상 = worktree `~/.node-local/stockinvest-qe-t097`(브랜치 `qe-t097`, base `e2a7206`) 미커밋 5파일, sha256(앞 12자): `kis-domestic.ts` `eba2778e093a`·`approval-message.ts` `331258cd4296`·`approval-notify.ts` `b6dafd7074dd`·`t097-approval-qty-line.test.ts` `366fcbd6288a`·`t097-domestic-tick-parity.test.ts` `d891a4cc23f8`. **코드 감사 결과는 pass 급**(critical 0·high 0)이지만, **데모 게이트 `check` 가 `DEMO_GATE_BLOCKED`(사유: 사용자 승인이 기록되지 않았습니다, status `review_requested`)** 라서 역할 규칙(`reviewer.md` "DEMO_GATE_BLOCKED 면 fail")에 따라 아래 맨 끝 판정 줄은 fail 이다. 승인 발화 자체를 의심하는 것이 아니다 — 게이트 도구가 그 발화를 `prompts.jsonl` 에서 찾지 못해 기록이 비어 있고, 에이전트가 `approve`·`waive` 를 대신 실행하거나 `.claude/state/demo-gate/` 를 직접 쓴 흔적은 없다(`evidence.jsonl` 마지막 3줄은 T-084·T-088·T-091 승인, T-097 줄 없음) [확실].
- [19:11] 확인 1(어댑터 diff = `export` 한 단어) — `git diff` 는 `kis-domestic.ts:286` 한 줄(`function roundToTick` → `export function roundToTick`)이고, 기준 판(`git show HEAD:`)과 현재 판을 `transpileModule(removeComments)` 로 비교한 산출 JS 는 정확히 한 줄(`function roundToTick`→`export function roundToTick`)만 다르다 — 로직 변경 0 [확실]. `git diff --stat e2a7206 -- src/lib/exchanges` 도 이 1줄뿐. 새 import 는 `approval-notify.ts:25` 한 곳이다. `kis-domestic` 의 정적 import 그래프(13개 모듈)는 `approval-notify` 로 되돌아오지 않아 순환 없음(`db.ts` 경유로 `signals/statuses`·`autopilot` 에 닿을 뿐 `approval-notify` 는 이미 `db` 를 import 한다), 최상위 타이머·부수효과 0, 서버 쪽에서는 `service.ts → kis.ts → kis-domestic` 로 이미 같은 프로세스에 올라와 있어 번들·기동에 새 영향이 없다. 같은 이름의 로컬 `roundToTick` 은 다른 파일 4곳(`scenario-builder.ts`·`custom/confirm/route.ts`·`ScenarioBuilder.tsx`·`ScenarioDetail.tsx`)에 각자 있어 이번 export 와 충돌하지 않는다.
- [19:11] 확인 2(줄 형식·위치·조건·버튼 불변) — 목업 HTML 을 코드로 읽어(`display:block` span → 줄) 렌더 출력과 **문자 단위·코드포인트 단위로 대조**: 해외 예시 꼬리(`금액` 줄부터 `만료` 줄까지)가 일치하고 줄은 정확히 `수량   2주 × $37  (≈ ₩98,000)`, 국내 예시는 제목 줄까지 **본문 전체가 목업과 완전 일치**(`수량   2주 × ₩48,300  (= ₩96,600)`; 라벨 뒤 공백 3칸·괄호 앞 공백 2칸·`×`·`≈`/`=` 포함). 실제 기록(`computeSizingSnapshot`)→`notifyApprovalRequest` 전체 경로로 목업 해외 줄(환율 1324.3243)도 재현했다. 위치는 "금액" 바로 아래·"오늘 한도" 줄 위, 순서 금액→수량→한도·현금→승인하면→만료 불변. 나타나는 조건: 매수·`sizing` 유효·수량≥1·진입 구간 없음·시장 일치일 때만(시험 14+12건과 변이 A01~A03 사망으로 확인), 그 밖은 줄 없음. 버튼: 승인·거절·"앱에서 자세히" 키보드가 줄 유무와 `toEqual` 동일하고, **서명 입력은 DB `amount_krw`** — 해외·국내 둘 다 직접 확인(`verifyCallbackData(…, 99_600)` true, 실현액 98,000·96,600 으로는 false) [확실]. 간단한 본문(버튼 꺼짐)에는 줄도 환율 읽기도 없다.
- [19:11] 확인 3(국내 단가 = 실제 송신가) — 어댑터 소스 `kis-domestic.ts:334` `ORD_UNPR: req.type === 'market' ? '0' : String(roundToTick(price))`·`:333` `ORD_QTY: String(submittedQuantity('domestic', quantity))` 확인. `roundToTick` 은 `Math.round(price / tick) * tick` = 가장 가까운 호가, 정확히 절반이면 위(매수·매도 동일). 호가표를 내가 따로 적은 KRX 표(2천 미만 1·5천 미만 5·2만 미만 10·5만 미만 50·20만 미만 100·50만 미만 500·그 이상 1,000 — 외부 규정 기억이라 [가능성 높음])와 정수 연산 반올림으로 난수 1,000,000건(정수·소수·추격 곱) 대조 → 불일치 0, 진짜 `createOrder`(`kisFetch` 목) 송신 본문 3,000건에서 `ORD_UNPR === String(roundToTick(price))`·`ORD_QTY === 수량`·"=" = `ORD_UNPR × ORD_QTY` 위반 0. Developer 시험의 "독립 규칙"은 어댑터 표를 그대로 옮긴 것이라 독립성은 약하지만(낮음) 위 내 대조가 보강한다. 생성 시점 줄 vs 승인 시점 실제 주문(`buildOrderRequest` 재계산 + 어댑터 반올림, 승인 때는 `signals.price` DECIMAL(36,8)·`amount_krw` DECIMAL(18,2) 로 읽은 값): **같은 추격 설정이면 국내 316,927건 중 수량·단가·"=" 불일치 0**(DB 반올림 포함). 추격 설정(`safety_limit_chase_disabled`·`style_default_limitChasePct`)이 알림~승인 사이에 바뀌면 줄이 실제와 **전부** 달라진다(같은 표본에서 100%) — 운영 설정 변경은 드물고 TTL 30분이라 사용자 오해 수준은 낮다고 본다(낮음).
- [19:11] 확인 4(해외·환율·실패 격리) — 환율은 `fx_rates` `pair='USD_KRW'` 한 행을 읽고 `judgeFxRow`(1시간 신선도·100~10,000)로 판정 — 현금 게이트 `readGateUsdKrwRate` ②와 같은 행·같은 함수다(① `getUsdKrwRate` 갱신 유도는 하지 않음 — 외부 호출 0, KIS 호출 0, DB 쓰기 0, `SELECT` 한 번뿐) [확실]. 정수 달러·괄호는 `overseasLimitUnitUsd`·`computeRealizedKrw({fxRate})` 재사용이고 어댑터 `roundToTickOverseas` 와 같은 계산이다(같은 환율 기준 해외 210,291건 불일치 0). 환율 null·오래됨·비정상·행 없음·읽기 오류(비동기 throw)·`fxRate` 의존성 없음·**동기 throw**(내가 추가로 확인)·1달러 미만 종목(정수 달러 아님) 모두 해외 줄만 빠지고 `sendRich` 는 그대로 호출되며 키보드 2행(승인·거절 / 앱) 유지. `quantityLineNeedsFx`·`buildQuantityLine`·`fxRate` 호출이 전부 `try` 안, `renderApprovalRequest` 는 검증된 값만 받아 던질 경로가 없다(`readSizingSnapshot`·`renderQuantityLine` 이 숫자·정수 검증 뒤에만 `toLocaleString`). 진입 구간 시그널은 줄은 안 나가지만 환율 `SELECT` 는 한 번 나간다(낮음, 무시 가능). 해외 정수 달러 단가는 **알림 시점 환율**로 만들어지고 승인 때 어댑터는 그때 환율(캐시 5분)로 다시 만든다 — 환율이 ±0.1% 움직이면 단가가 달라질 확률이 $1~50 1.3%·$50~200 6%·$200~500 18%·$500~1,000 37%(±0.2% 이면 2.5/12/35/65%), 수량은 원화 기준이라 불변, 같은 환율이면 불일치 0. 목업이 "≈" 로 알린 것은 합계뿐이고 단가는 "실제 송신 단가와 같은 정수 달러"라 했으므로 **사용자 결정 거리**로 올린다(낮음~중간, 승인 후 몇 분 이내면 5분 캐시로 거의 같다).
- [19:11] 확인 5(이스케이프·길이) — 새 줄에 들어가는 동적 값은 숫자뿐이고 전부 `h()` 를 거친다. 종목명·사유·심볼에 `< > & <b>` 가 있어도(내 `AT&T <Inc> & Co` 사례와 Developer 퍼징 400회) 정적 `<b>` 외 `<`·맨몸 `&` 0, 텔레그램 4096자 안(최대 자릿수 수량 줄 포함), `$`·`≈`·`×`·`₩` 는 HTML parse mode 에서 문제 없는 문자다. 줄 순서는 목업 대조로 만료 줄까지 불변.
- [19:11] 확인 6(한도·주문 로직 무변경) — `service.ts`(`16e856e1840f`)·`sizing-snapshot.ts`(`81214a2ee9ce`)·`order-limits.ts`·`dry-run.ts`·`signal-cash-gate.ts`·`t097-sizing-golden/record.test.ts` 는 HEAD 와 sha256 동일, `git status` 상 수정 파일은 `kis-domestic.ts`·`approval-message.ts`·`approval-notify.ts` 셋뿐이고 `git diff -- '*.test.ts'` 가 비어 있다 [확실]. `NotifyDeps.fxRate?` 는 선택 항목이라 기존 호출부·시험이 그대로 통과한다.
- [19:11] 확인 7(변이, 복사본, 새 시험 117개 기준) — 44종: **killed 34 · survived 10 · skip 0**. 사망: 줄 위치(맨 위·2번째 A05/A06)·조건 3종(A01 매수·A02 구간·A03 시장)·수량 가드·정수 달러 가드·라벨 공백 3→2(A10)·괄호 앞 공백(A11)·`≈`↔`=`(A12/A13)·`$` 제거(A14)·`×`→`x`(A15)·국내 가드·**버튼 서명 입력을 실현액으로(A17)**·반올림 건너뛰기(B01, 50개 실패)·"=" 를 기록 실현액으로(B02)·0원 가드(B03)·매도 가드(B04)·해외 괄호를 원화 환산 실현액으로(B08)·환율 필요 판정 반전(B09)·환율 호출 조건 제거(B10)·**fx 예외 두 겹 다 제거(B13)**·신선도 판정 무시(B14)·나이 무시(B15)·행 없음 가드(B16)·통화쌍(B17)·줄 연결 제거(B18)·반올림 방향 floor/ceil(K01/K02)·호가표 변경(K03)·어댑터 반올림 제거(K05)·export 제거(K06). **생존 10 중 7은 동치·중복 방어**: A04(옵셔널 체인 동치)·B05(수량 가드 — 하위 `realizedKrw`/정수 검사가 같은 결과)·B06(null 가드 — 하위 검사가 같은 결과)·B07(환율 가드 — `overseasLimitUnitUsd` 가 NaN·0 을 거름)·B11·B12(`fxRate().catch` 와 바깥 `try/catch` 는 두 겹이라 한 겹만 빼면 동치 — 둘 다 빼면 B13 이 죽음)·K04(`<2000`→`<=2000` 은 정확히 2000 에서 값이 같음). **실질 시험 공백 3**: A18·B19(국내 버튼 서명 입력을 국내 합계로 바꿔도 안 죽음 — 서명 시험이 해외 줄만 쓴다; 실제 코드는 국내도 `amount_krw` 로 서명함을 내가 직접 확인해 결함은 아니다)와 A19(`renderQuantityLine(null)` 직접 호출 가드 — 호출부가 이미 거른다). 보강 권고: 서명 시험을 국내 `qDomestic` 에도 적용(1줄).
- [19:11] 확인 8(전체 시험) — worktree 에서 재실행: 284 suites pass·4 skipped, **7,466 tests pass**(Developer 주장과 일치), `tsc --noEmit` 오류 0, 기존 시험 파일 수정 0줄 [확실]. 새 시험 2파일은 `tsconfig` 제외 대상이라 tsc 타입 검사 밖이다(낮음, 프로젝트 기존 구성). `next build` 는 돌리지 않았다.
- [19:11] 확인 9(주석 사실성) — `QuantityLineView`·`renderQuantityLine`·`quantityLine` 필드 주석(해외 정수 달러·`× 환율` 괄호, 국내 호가단위 반올림 단가×수량, 값 이상하면 줄 없음, 모듈은 순수)과 `buildQuantityLine`·`quantityLineNeedsFx`·`NotifyDeps.fxRate`·`defaultDeps.fxRate`(게이트 ②와 같은 행·판정, 외부 조회 유도 없음, 게이트가 이미 갱신 유도) 주석이 코드와 맞다 [확실]. 부정확한 곳은 두 군데: (i) `t097-domestic-tick-parity.test.ts` 머리말의 "독립 기대값"은 어댑터 표를 옮긴 사본이라 독립이 아니다(낮음). (ii) **승인된 목업의 안내 문구** "1주 가격이 금액보다 크면 수량 0 이라 시그널 자체가 만들어지지 않습니다(변화 없음)"는 코드와 다르다 — 현금 게이트는 수량 0 을 `quantity_zero`(모름)로 두고 `createSignal` 은 승인 대기 시그널을 만든다(`t097-sizing-record` 시험 "해외 1주 미만 … ok:true"), 알림은 수량 줄 없이 나가고 승인하면 `quantity_below_min` 으로 거절된다. 구현은 "줄 없음"으로 목업의 줄 규칙과는 맞지만, 사용자가 읽은 설명이 틀렸으므로 정정·고지가 필요하다(Leader 몫).
- [19:11] 발견 목록 — critical 0 · high 0 · medium 0 · low 6 · **차단 1(절차)**. **F-Q1 (차단, 절차)** 데모 게이트 `DEMO_GATE_BLOCKED`(승인 미기록). **F-Q2 (low)** 국내 버튼 서명 입력 시험 공백(A18·B19). **F-Q3 (low~medium, 사용자 결정)** 해외 단가는 알림 시점 환율 기준이라 승인 때 환율이 움직이면 $1 어긋날 수 있음, 국내는 추격 설정이 바뀌면 어긋남. **F-Q4 (low, 문서)** 목업 안내 문구가 코드와 다름(위 9). **F-Q5 (low)** 시험 머리말 "독립" 과장·진입 구간 시그널의 불필요한 환율 `SELECT` 1회·새 시험 tsc 대상 밖.
- [19:11] 확인하지 못한 것: 운영 DB·KIS·텔레그램 실발송(금지), 실제 텔레그램에서의 렌더(클라이언트 표시), `next build`, 커밋 훅 동작. 이 fail 은 코드 결함이 아니라 게이트 기록 때문이므로, 사용자 승인이 게이트 도구에 기록된 뒤(Leader 가 사용자 발화를 `prompts.jsonl` 에 남기고 `approve` 를 실행해 `check` 가 pass 가 되면) 알려 주면 위 5개 파일 sha256 이 같은지와 `check` 결과만 다시 확인해 판정 줄을 추가한다(코드 재감사 불필요). 에이전트가 `approve`·`waive` 를 대신 실행하는 것은 금지다.
- [19:11] **최종 판정: FAIL (scope: src/lib/exchanges/kis-domestic.ts, src/lib/signals/approval-message.ts, src/lib/signals/approval-notify.ts, src/lib/signals/__tests__/t097-approval-qty-line.test.ts, src/lib/signals/__tests__/t097-domestic-tick-parity.test.ts)**

## QA

- [17:38] QA 실행 검증(Reviewer·Developer 기록을 믿지 않고 직접 실행). 대상 = worktree 미커밋 4파일(`service.ts`·`sizing-snapshot.ts`·`t097-sizing-golden.test.ts`·`t097-sizing-record.test.ts`), 기준 = 메인 트리 HEAD `d414bb9`. 작업은 전부 스크래치패드 `t097qa/` 안(메인 트리·worktree 소스 편집 0, 커밋·push·배포·DB 쓰기·KIS 호출 0, 훅 설치·`test-git-hooks.sh` 미실행) [확실].
- [17:38] 항목1 깨끗한 사본 — `git archive HEAD` + 4파일 덮어쓰기, `diff -rq`(node_modules 제외) 차이 **정확히 4개**(service.ts 변경·신규 3개) [확실]. `npx jest` 전체: **282 suites pass·4 skipped, 7,349 tests pass**(149 skipped), 2회 실행 모두 같음(13.6초·11.2초), `tsc --noEmit -p tsconfig.json` 오류 0(2회). 주의: 기대치 7,317 과 32 다른 이유는 HEAD 가 worktree base `f50a3f7` 보다 앞서 T-095 시험(`profit-engine/__tests__/signal-postmortem-core.test.ts` 의 `it(` 36→68 = +32)이 들어 있어서다 — HEAD 단독(4파일 없이) 기준선은 280 suites·7,307 pass 이고 4파일 추가로 +2 suites·+42 tests 가 정확히 새 시험(골든 35·기록 7)이다. 새 시험 단독 실행 42/42 pass [확실].
- [17:38] 항목2 훅 모의 커밋(일회용 저장소 `t097qa/mockrepo-run1`, `GIT_CONFIG_GLOBAL=/dev/null`, 복사한 훅 sha256 이 메인 트리 `scripts/git-hooks/commit-msg` 와 동일 `78d81c01…`, base 커밋 후 `core.hooksPath` 지정, 메인 트리 현재 T-097 task 복사 — 마지막 판정 줄은 17:27 3라운드 줄): ① 4파일 전부+`feat(T-097)` → **통과**("✅ Reviewer 감사 기록 확인: T-097") ② scope 에서 `sizing-snapshot.ts` 제외 → **차단**(그 파일만 나열, 검토된 범위 합집합 표시) ③ 메시지에서 T-097 제거 → **차단**("task ID(T-NNN)가 없습니다") ④ `CONDITIONAL_PASS` → 통과 · 소문자 `pass` → 차단("판정을 읽지 못했습니다") · 소문자 `conditional_pass` → 차단. 추가 확인: `FAIL` 차단 · scope 없는 PASS 차단("구 형식") · `T-0970`(자릿수 초과) 차단 · 파일 없는 `T-999` 차단 · service.ts 만 staged 하면 통과 · scope 를 디렉토리 `src/lib/signals/` 로 넓히면 통과(= 사람 규율 영역, 훅 한계 L8). 모든 모의 커밋 후 일회용 저장소에서 `reset --soft` 로 상태 복원, 훅 우회 플래그 미사용 [확실]. 참고(Leader 몫): worktree 안 vault 사본의 `## Reviewer` 마지막 판정 줄은 17:01 1라운드 줄(scope 동일 4파일)이라 지금 worktree 에서 커밋하면 훅은 통과하지만 3라운드 기록이 아니다 — 커밋할 task 파일에 3라운드 줄까지 옮길 것.
- [17:38] 항목3 OFF 동작 스모크(QA 자체 입력, `git show HEAD:service.ts` 원문 사본 vs 새 코드): 국내 5만·50만 원, 미국 $50·$200·$880(환율 1,324)×목표 10만·75만×추격 0·0.5%×지정가·시장가×매수·매도×수량 미지정·3·0·2.5×가격 유무 = 640 조합 × (`buildOrderRequest` 기본·`{}`·`{minOneShare:false}` 3종 + `sizeOrderQuantity` 3종), 키 집합·`Object.is` **불일치 0건**. NaN·0·-0·음수·±Infinity·문자열·null·1e-9·1e18 금액×가격 조합도 불일치 0. ON: MU급(미국 $880) 목표 10만 → 수량 1·`minOneShareApplied=true`·`limitBasisKrw`=`req.amountKRW`=실현액(추격 0 이면 1,165,120, +0.5% 이면 1,170,945.6)·`resolveOrderAmountKRW`(환율 이중 곱 없음)·**`checkOrderMax` 한도 20만에서 `order_limit` 차단**(OFF 는 0주=불성립, 한도 기준 10만 그대로). 국내 50만 원 종목도 1주·한도 기준 50만(추격 +0.5% 이면 502,500)·20만 한도 차단. ON 이어도 내림 1주 이상·수량 지정·시장가·금액 NaN/0/음수는 OFF 와 같은 요청(승격 없음). 이 스모크가 실제로 실패할 수 있음을 변이 2종(한도 기준을 실현액 단독/목표 단독)으로 확인 — 각각 4개·2개 시험이 실패. 스모크 파일은 사본 안에서만 쓰고 이력서 정리를 위해 `t097qa/qa-only/` 로 옮겼다(단 사본에 둔 채 전체 시험을 돌리면 `submit-order-callsites.test.ts` 가 사본의 base 복사본 때문에 호출부 목록 불일치로 실패한다 — 스모크 설정의 부작용이며 이번 변경의 결함이 아님, 파일을 뺀 뒤 전체 pass 재확인) [확실].
- [17:38] 항목4 호출부 무배선·무변경 — 사본 전체 grep: `minOneShare` 는 `service.ts`·`sizing-snapshot.ts`·`t097-*` 시험 2개(+ vault task 문서)에만 있고 `src/` 의 다른 곳 0건. 호출부 5곳(`orders/route.ts:66`·`entry-watcher/route.ts:413`·`post-market-engine.ts:128·258`·`service.ts` 내부 `buildOrderRequest`)은 옵션 인자를 넘기지 않는다(소스 확인). HEAD 와 sha256 동일: `dry-run.ts`·`order-limits.ts`·`kis-domestic.ts`·`kis-overseas.ts`·`kis.ts`·`fx.ts`·`order-quantity.ts`·`approval-message.ts`·`approval-notify.ts`·`approval-context.ts`·`signal-cash-gate.ts`·`orders/route.ts`·`entry-watcher/route.ts`·`post-market-engine.ts`·`engine.ts` 전부 SAME, `system_config` 를 쓰는 src 파일 63개 중 62개 SAME(나머지 1개는 변경 대상 `service.ts` 자신, 추가된 줄에 `system_config` 언급 없음). 사본 전체가 HEAD 와 4파일 외 바이트 동일(`diff -rq`) [확실].
- [17:38] 항목5 금지 흔적 grep(4파일) — 비밀·`.env`·`process.env`·token·credential 0건, `TODO`/`FIXME`/`XXX`/`HACK`/`eval`/`new Function`/`debugger` 0건, 운영 코드의 4자리 이상 금액 상수 0건(시험 파일의 금액은 입력 고정값), `console.*` 는 기존 줄이 대부분이고 **추가된 줄은 `console.warn` 1건**(`[signal-sizing] indicators.sizing 기록 생략` — 기존 로그 규약, 디버그 `console.log` 추가 0). 텔레그램 "수량" 줄 구현 흔적 없음: `approval-message.ts`·`approval-notify.ts` 는 HEAD 와 바이트 동일, 알림 쪽은 `indicators` 에서 `exit_kind`·`ai.scenario.entry.price_zone` 만 읽어 `sizing` 키가 메시지에 영향을 주지 않는다. 새 코드의 준비물 `readSizingSnapshot` 은 시험 밖 호출자 0(Reviewer F-6 와 일치, 4번 줄 데모 승인 대기용) [확실].
- [17:38] 항목6 요약 — 줄 수 `service.ts` 1,057(+86/−7)·`sizing-snapshot.ts` 177·골든 시험 442·기록 시험 147(합 1,823줄). 새 시험 42개(골든 35·기록 7) 전부 pass. 전체 시험 시간 jest 11.2~13.6초(12코어), tsc 5.8초. 집중 실행(safety·signals·entry-watcher·orders·post-market) 2,447 pass 중 실패 1건은 위 스모크 사본 오염(결함 아님)이었고 제거 후 전체 재실행에서 0 failed.
- [17:38] 확인하지 못한 것: 운영 DB·KIS·서버·텔레그램 실발송(금지 범위), `indicators.sizing` INSERT 의 실제 MariaDB 왕복(일회용 MariaDB 시험은 4 suites skipped — 환경 의존), 옵션 ON 배선 후 실주문 경로(미구현), 메인 저장소의 실제 훅 설치 상태에서의 커밋(금지), 텔레그램 "N주 × 단가" 줄(데모 v1 승인 대기라 미구현). 결함 0건, critical 0.
- [17:38] ✅ 검증 통과 (결함 0건)

## 배포 기록

## Codex 검토

### [2026-10-26 17:09] C2 review focus=none — done (지적 1건, 낮음)
- judge 판정: Leader 전달 판정(2026-10-26 17:04, `codex_required: true`, `budget_rule: CX-limit-unknown-r2`) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-sizing-t097 base=f50a3f7(task_file) snapshot=15a6169(worktree 기준)
- 지적 1건:
  - [low] `src/lib/signals/sizing-snapshot.ts:98` — 옵션 OFF 지정가 주문에서 targetKrw·unitPriceKrw가 매우 커서 IEEE-754 곱셈 오차가 고정 허용치 0.005원을 넘을 때 → `limitBasisKrw` 가 `realizedKrw` 를 골라 `service.ts:371` 의 `req.amountKRW` 가 base 의 `input.amountKRW` 와 비트 단위로 달라진다(예: targetKrw=383614116660319.2, unitPriceKrw=42623790740035.47 → 0.0625원 증가). 금액이 늘어나므로 한도 약화는 아니고 정상 운영 금액에서는 발생 가능성 낮음. (권고: 옵션 OFF 기본 경로에서는 `req.amountKRW` 를 항상 `input.amountKRW` 로 유지하고, 실현액 기반 상향은 옵션이 실제 적용된 경우에만 수행)
- 검토하지 못한 범위: 전체 Jest·tsc 는 재실행하지 않음(제공된 실행 결과 전제, 정적 검토와 경계값 재현만). 한도 약화·fail-open·송신 우회·선행 읽기 영구 실패 경로는 확인되지 않았다고 Codex 가 보고(요약 기준).
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261026T080858Z-T-097-C2/raw.txt

## 최종 요약

> 작성자: 메인 세션(Leader 겸임) · 2026-10-26 17:41 KST · 양식: `docs/user-report-format.md` §3 — **1단계(기록·옵션) 완료, Q-E(텔레그램 "수량" 줄)는 데모 승인 대기라 이 task 는 아직 열려 있다.**

### [T-097] 주문 사이징 — 주가(수량) 기준 기록과 보수적 옵션 (P4, 1단계)

- **상태**: 🔁 1단계 완료(운영 반영 아님) · ⏳ Q-E 표시 줄 데모 승인 대기
- **무엇이 바뀌었나**: 시그널을 만들 때 목표 금액·수량·실제 금액(주가×수량)을 `indicators.sizing` 에 기록한다. 한도 판정 기준 금액은 **옵션이 적용된 경우에만** `max(목표, 실제 금액)`, 그 밖에는 입력 목표금액 그대로(**옵션이 꺼진 기본 상태에서 주문 요청은 변경 전과 모든 입력에서 비트 동일** — 코드 분기로 보장). 최소 1주 허용은 옵션(`minOneShare`)으로만 만들고 **어떤 호출부도 켜지 않는다.** 한도 설정(4%·10%)·카드 금액(10만 원)·거래소 어댑터·텔레그램 메시지는 그대로. 화면·알림 변화 없음.
- **배포**: ⏸ 미배포 — 커밋 `7ca2b62`(main, 훅 통과, 로컬·미push). 다음 push 에 문서 커밋들과 함께 나간다(옵션 미배선이라 운영 동작 불변). 같은 배포에 함께 실릴 작업: T-095(`96fdf99`)·문서 커밋들
- **AI 가 검증한 것**: Reviewer 3라운드 PASS(원문 대조 buildOrderRequest 300만·sizeOrderQuantity 100만 건 불일치 0, 한도 기준이 변경 전보다 작아지는 입력 0, 반례 탐색 320만 쌍 위반 0, 옵션 배선 0, 변이 62종 중 51 사망·2 생존(동치·라벨)) · Codex C2 1건(low — 3.8e14 원대 부동소수 오차) 채택·구조 변경으로 제거 · QA 통과(깨끗한 사본 전체 jest 282 스위트·7,349 통과·tsc 0, 훅 모의 커밋 허용·차단, OFF 스모크 640 조합 불일치 0) · 기존 시험 수정 0줄
  - 검증 못 한 것: 실제 MariaDB 에 `indicators.sizing` INSERT(일회용 DB 시험은 환경 의존으로 skip — `json_valid` 는 통과할 것으로 봄 [가능성 높음]), 옵션 ON 배선 후 실주문 경로(미구현), 텔레그램 실발송
- **👉 사용자가 확인할 것**: 없음(운영 동작 불변)
- **👉 사용자가 결정할 것**: **Q-E 텔레그램 "수량" 줄 데모 v1 승인**(승인 시 구현, "생략"이면 줄 없이 이 task 종료). 데모: `mockups/T-097-telegram-sizing-line-v1.html`
- **남은 일**: ① Q-E 구현(승인 시 — `approval-message.ts`·`approval-notify.ts`·시험 갱신, 이스케이프, Reviewer→QA) ② **옵션 ON 배선은 별도 task**(필수 조건 5항은 위 "옵션(최소 1주) ON 배선 task 로 이월하는 필수 조건" 절) ③ 후속 후보: 매수 요청 수량 주문의 한도 기준 상향
- **이슈·위험**: MU 같은 비싼 종목은 이 변경으로 풀리지 않는다(1회 한도 4% 가 막음 — 한도는 사용자가 설정에서 변경). 롤백: 커밋 `7ca2b62` revert(신규 파일 + `service.ts` 변경뿐, DB 정리 불필요)


## 데모 검토 (demo gate)

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음(판정은 사용자 답 뒤 judge) | - | - | - | - |
| - | 작성중 | - | - | judge: delta (DM-kw-risky-cta) | 10-26 16:32 |
| v1 | 검토요청 | mockups/T-097-telegram-sizing-line-v1.html | - | 사용자 검토 요청 | 10-26 16:32 |
| v1 | 승인 | mockups/T-097-telegram-sizing-line-v1.html | - | "T-097 텔레그램 수량 데모 승인" | 10-26 21:39 |
