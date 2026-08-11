---
task-id: T-020
project: StockInvest
created: 2026-08-11
updated: 2026-08-11
status: review
review-round: 2
qa: passed
tags:
  - type/task
  - domain/safety
  - domain/exchanges
  - domain/signals
aliases:
  - 소수점 주문 수량
  - 조용한 축소집행
  - Math.floor 절삭
  - 사이징 시점 floor
related_tasks:
  - "[[T-018-order-sync-fail-closed]]"
  - "[[T-017-kis-rate-limit-throttle]]"
  - "[[T-019-partial-fill-false-filled]]"
---

# T-020 · 사이징이 소수점 수량을 만들고 전송 직전 절삭돼 조용히 축소집행된다

> 출처: [[T-018-order-sync-fail-closed]] reviewer H-4 § "Leader 질문에 대한 답" 4항.
> board.md Backlog 2번 항목 원문 참조.

## 목표

**주문서에 적힌 수량과 브로커가 실제로 받는 수량을 처음부터 일치시킨다.**
그리고 반올림 결과 주문이 성립하지 않게 되면 **그 사실이 반드시 보이게** 한다.

---

## 문제 — 코드 실측 (2026-08-11)

### 소수점 수량이 만들어지는 곳은 정확히 2곳

전수 조사(`grep` 로 `amountKRW / price` 계열 패턴 전량 확인) 결과:

| 위치 | 코드 |
|---|---|
| `src/lib/signals/service.ts:119` (`buildOrderRequest`) | `quantity = Math.floor((input.amountKRW / chasedPrice) * 1e8) / 1e8;` |
| `src/app/api/cron/entry-watcher/route.ts:238` | `quantity = Math.floor((Number(row.amount_krw) / chasedPrice) * 1e8) / 1e8;` |

`* 1e8 / 1e8` 은 **소수점 8자리로 내림**이다 — 즉 **소수를 만드는 코드**다.
(암호화폐 자매 프로젝트에서 온 관례로 보인다. 주식은 정수 주식 수로 거래한다.)

`buildOrderRequest` 는 `createSignal`(자동 제출)과 `approveSignal`(사용자 승인) **둘 다**가
쓰므로, 이 2곳이 실제로 모든 엔진 주문 경로를 덮는다.
(`src/app/api/orders/route.ts` 는 클라이언트가 보낸 `quantity` 를 그대로 쓰는 수동 주문 경로라
이번 범위 밖 — 다만 developer 는 여기도 소수가 들어올 수 있는지 확인하고 소견을 남겨라.)

### 절삭은 전송 직전에 일어난다

`src/lib/exchanges/kis-overseas.ts:340` — `ORD_QTY: String(submittedQuantity('overseas', quantity))`
→ `submittedQuantity` 는 해외에 대해 `Math.floor`.

**결과: KIS 는 소수점을 본 적이 없고, DB `orders.quantity`(`decimal(36,18)`)에만 원래
소수점 수량이 남는다.** 의도와 실제가 영구히 어긋난 기록이 된다.

---

## 실害 — 두 갈래

### ① 1주 미만 → 절삭하면 0주, 주문 자체가 성립 불가

2026-08-11 운영 DB 실측 — 소수점 수량 주문 **79건**, 그중 **1주 미만이 11건**:

| 주문 | 종목 | 수량 | 금액 |
|---|---|---|---|
| #2580 | `NAS:MSFT` | **0.20704286** | ₩132,223 |
| #69 | `NAS:COST` | 0.30147280 | ₩451,595 |
| #72 | `NAS:META` | **0.79432512** | ₩718,971 |
| … | | 총 11건 | |

`Math.floor` → **0주**. 브로커에 `ORD_QTY: "0"` 이 나간다.

### ② 나머지 → 자본이 조용히 축소집행

평균 **16.8%** · 최대 **49.9%** 가 사라진다(board.md 원문 실측).
예: `1.9주` 의도 → `1주` 집행 = 자본의 47% 가 조용히 미투입.
DB 에는 `1.9` 가 남아 있어 **사후에도 이 사실을 알 수 없다.**

### ③ 🔴 신규 발견 (2026-08-11 Leader) — 국내도 안전하지 않다, 오히려 **지금 막 위험해졌다**

`submittedQuantity('domestic', q)` 는 **가공 없이 통과**시킨다(T-018 이 "현행 동작을 정확히
반영만 한다"고 의도적으로 그렇게 뒀다). 그런데 사이징은 국내·해외를 구분하지 않으므로
**국내 주문에도 소수점 수량이 만들어지고, 그대로 KIS 에 전송된다.**

* 국내 KIS 는 정수 주식 수만 받는다 — 이 코드베이스 자신도 그렇게 가정한다:
  `kis-domestic.ts:269` 의 폴백이 `Math.floor(req.amountKRW / price)` 다.
* 즉 국내 지정가 신규 매수는 **전송돼서 거절**된다. "조용한 축소집행"이 아니라
  "시끄러운 실패"라 성격은 다르지만, **주문이 아예 안 나가는 것**은 마찬가지다.
* **왜 지금 위험해졌나**: `safety_daily_order_max_pct` 가 과거 `0`(국내 신규 매수 전면 차단)에서
  **현재 `10`** 으로 열려 있다(2026-08-11 실측). 국내 신규 매수 경로가 이제 살아 있다.
  실제로 2026-08 국내 시그널 72건 중 62건이 **`quantity IS NULL` + `limit`** 이다 —
  전부 이 사이징 공식을 타는 후보다.

---

## 🔴 선행 확인 결과 — **재현된다. 사이징 동작은 바뀐 적이 없다**

board.md 는 "05-16 이후 소수점 주문이 없다 — 사이징 동작이 이미 바뀌었을 수 있으니 현재도
재현되는지 먼저 확인하라"고 지시했다. **확인했고, 결론은 "코드는 그대로다"** 이다.

| 확인 | 실측 |
|---|---|
| `service.ts:119` / `entry-watcher:238` 공식 | **변경 없음** — `Math.floor(x * 1e8) / 1e8` 그대로 |
| 소수점 주문 마지막 발생 | 2026-05-15 (총 79건: `rejected` 70 + `blocked` 9) |
| **2026-06-01 이후 해외 주문 수** | **0건** ← 진짜 이유 |
| 05-16~05-28 해외 주문(마지막 물량) | 전부 `NAS:SNPS`, 수량 정확히 `5`, `consumed_order_id` 연결 **없음** → 시그널이 수량을 미리 갖고 있던 경로 |
| **2026-08 해외 시그널** | 36건, **전부 `quantity IS NULL` + `limit`** → 승인만 되면 이 공식을 탄다 |
| 2026-08 해외 시그널 상태 | `expired` 10 · `ai_skipped` 26 — **주문까지 간 것이 하나도 없다** |

**결론: 소수점 주문이 멎은 것은 사이징이 고쳐져서가 아니라 해외 주문 흐름 자체가 멎어 있었기
때문이다.** 소수점을 만드는 코드도, 그 코드를 타는 입력(수량 NULL 인 지정가 시그널)도 지금 그대로 있다.

### 왜 하필 지금인가 — 억눌러 온 것들이 전부 풀렸다

소수점 79건의 실패 사유 분포(실측): `kis_5xx` **38** · `(null)` 31 · `order_limit` 9 ·
`kis_rejected` **단 1건**.

→ "브로커가 소수점을 거부해서 안 나갔다"는 설명은 **근거가 약하다**(거부는 79건 중 1건뿐).
대부분은 **레이트리밋(HTTP 5xx)으로 죽고 있었을 뿐**이고,
[[T-017-kis-rate-limit-throttle|T-017]] 이 그 레이트리밋을 없앴다.

| 억제 요인 | 현재 |
|---|---|
| 레이트리밋 5xx | [[T-017-kis-rate-limit-throttle\|T-017]] 로 해소 |
| `safety_kill_switch=true` | **해제됨**(`false`) |
| `safety_daily_order_max_pct=0` | **10 으로 열림** |
| `safety_dry_run` | `false` (실거래) |

**즉 이 결함은 "고쳐진 것"이 아니라 "다음 해외/국내 주문이 나가는 순간 발화하는 것"이다.**

---

## 역할별 지시사항

### Developer

#### 요구 D-1 · **사이징 시점**에 정수화한다 — 두 곳 **모두**

`src/lib/signals/service.ts:119` 와 `src/app/api/cron/entry-watcher/route.ts:238`.
**한쪽만 고치면 다른 경로로 계속 생성된다**(reviewer 지적).

* 정수화 규칙은 `src/lib/exchanges/order-quantity.ts` 의 `submittedQuantity()` 를 **재사용**하라.
  규칙을 다시 유도하면 T-018 H-4 가 없앤 "두 경로가 갈라질 수 있는 구조"가 되살아난다.
* **국내도 정수화할지 판단하고 근거를 적어라.** Leader 소견: 위 §③ 근거로 국내도 정수여야 한다고
  본다. 다만 그러려면 `submittedQuantity('domestic', …)` 의 현행 "통과" 의미와 충돌하지 않게
  해야 한다 — 사이징에서 이미 정수를 만들면 `submittedQuantity` 는 항등이 되므로
  **`order-quantity.ts` 를 바꾸지 않고도** 목적을 달성할 수 있는지 먼저 검토하라
  (그 파일을 바꾸면 [[T-019-partial-fill-false-filled|T-019]] 의 판정 기준까지 흔들린다).
* `amount_krw` 를 정수 수량에 맞춰 재계산할지 판단하라. 판단 기준:
  ① 기록의 정합성(실제 집행액과 일치하는가) ② **안전 한도 검사를 약화시키지 않는가**
  (`ORDER_MAX`/일일 누적 한도가 `amountKRW` 를 쓴다) ③ `trade-report` 의 `amount_krw` 폴백
  경로에 미치는 영향. **한도를 느슨하게 만드는 방향이면 하지 마라.**

#### 요구 D-2 · 0주면 주문을 내지 않는다 — **단, 절대 조용히 넘기지 마라**

⚠️ **이 요구의 절반은 "스킵"이고 나머지 절반은 "흔적"이다. 흔적 없는 스킵은 실패다.**
이 프로젝트가 T-007·T-012·T-014·T-018 내내 없애 온 것이 바로 그 침묵이고,
사이징 단계에서 그것을 재현하면 아무것도 나아지지 않는다.

각 경로에서 **기계 판독 가능한** 흔적을 남겨라:

* `service.ts` — `CreateSignalErrorCode` 계열의 **구조화된 실패 코드**로 반환하라
  (예: `quantity_below_min`). `ok:false` 만 던지고 이유를 문자열에만 담는 것은 부족하다 —
  기존 `symbol_blacklisted`/`duplicate_active_signal` 이 왜 코드로 분리돼 있는지 보고 관례를 따르라.
* `entry-watcher/route.ts` — `results.push({... outcome: '<구별되는 코드>' , detail})` 로
  **집계 가능하게** 남겨라. 이 라우트가 이미 `blocked_by_prior_split` 같은 outcome 을 쓰고 있으니
  그 관례를 따르라.
* **관측 깔때기(eval_funnel)와 시그널 상태**에 이 스킵이 잡히는지 확인하라. 안 잡히면
  "시그널은 났는데 주문이 안 나갔다"가 다시 설명 불가능한 침묵이 된다 —
  Phase 1(관측 깔때기) 이 존재하는 이유 전체가 이것이다.
* 알림을 보낼지는 판단하되, **알림 피로를 늘리지 않을 근거**를 적어라(0주 스킵은 자주 발생할
  수 있다 — 매번 울리면 무의미해진다. 로그·집계가 더 적합할 수 있다).

#### 요구 D-3 · `submitted_quantity` 컬럼은 **이 수정 이후에** 판단한다

T-018 reviewer 의 권고 순서를 지킨다: **(1) 사이징 수정 → (2) 그래도 남는 불일치가 있으면
그때 스키마.** 요청 수량과 송신 수량이 처음부터 같아지면 그 컬럼의 필요성 상당 부분이 사라진다.
**이번에 스키마를 바꾸지 마라.** 대신 수정 후에도 두 값이 갈라질 수 있는 경로가 남는지
조사해서 결론을 이 문서에 적어라(남으면 T-021 후보로 제안).

#### 제약 (절대)

* `npm run typecheck` / `npm test` **만** 실행. `npm run build`·`npm install`·`npm run dev` **금지**
  (운영 배포 경로 — build 가 pm2 가 서빙 중인 `.next` 를 덮어쓴다). 새 의존성 금지.
* **git commit / push / stash 금지.** pm2 조작·재배포 금지. DB 수동 쓰기 금지(SELECT 만).
  `safety_kill_switch`·`exit_engine_enabled` 등 안전 설정 변경 금지.
* 모든 주문 송신은 `src/lib/safety/dry-run.ts` 의 `submitOrder()` 경유 — safety 레이어 우회 금지.
  **수량이 0 이 되는 것을 safety 레이어에서 막는 것으로 대체하지 마라** — 그건 사이징 결함을
  안전장치로 덮는 것이고, "왜 주문이 없는가"를 다시 설명 불가능하게 만든다.
* **담당 파일**(T-019 와 겹치지 않게): `src/lib/signals/service.ts`,
  `src/app/api/cron/entry-watcher/route.ts`, 그리고 그에 대응하는 `__tests__`.
  **`src/lib/safety/order-sync.ts` 와 `src/lib/reports/trade-report.ts` 는 건드리지 마라** —
  T-019 담당 영역이다. `order-quantity.ts` 수정이 불가피하면 **착수 전에 Leader 에게 보고**하라.

### Reviewer (독립 감사)

* 두 사이징 지점이 **모두** 고쳐졌는가. 세 번째 경로가 없는지 독립적으로 재조사하라
  (`orders/route.ts` 수동 경로 포함).
* 정수화가 **매수·매도 양쪽**, **국내·해외 양쪽**, **지정가·시장가 양쪽**에서 의도대로 동작하는가.
  특히 **매도(청산)에서 절삭이 보유수량 미만으로 만들어 포지션이 안 닫히는 일**이 없는지 —
  이건 손절 무력화로 직결된다. 매수와 매도는 반올림 방향의 안전성이 다르다.
* 0주 스킵이 **관측 가능한가** — 로그·outcome·시그널 상태·깔때기 중 어디에 남는지 실제로 확인하라.
  "코드에 `continue` 앞에 로그 한 줄"은 집계가 안 되므로 불충분하다.
* `amount_krw` 를 재계산했다면 **안전 한도가 약해지지 않았는지** (`ORDER_MAX_*`, 일일 누적).
* `submittedQuantity` 의 의미를 바꿨다면 [[T-019-partial-fill-false-filled|T-019]] 의 체결 완결성
  판정에 미치는 영향을 반드시 평가하라. **두 task 의 결론이 모순되면 안 된다.**
* T-018 이 남긴 회귀(H-4 소수점 갇힘 테스트 등)가 여전히 유효한지.

### QA

* `npm run typecheck`, `npm test` 를 **직접 실행**하고 원문 출력을 붙일 것.
* 시나리오 검증:
  1. 해외 지정가 매수, `amount/price = 1.9` → **1주 주문**, DB `quantity` 도 **1**
  2. 해외 지정가 매수, `amount/price = 0.79` → **주문 없음 + 구별 가능한 흔적**
  3. 국내 지정가 매수, `amount/price = 15.29` → 정책대로 동작(정수화했다면 15주, DB 도 15)
  4. 매도(청산) 경로에서 절삭이 포지션을 남기지 않는지
  5. 시장가 주문 경로 무회귀
  6. `entry-watcher` 경로와 `service.ts`(자동제출·승인) 경로가 **동일한 수량**을 만드는지
  7. 스킵이 발생했을 때 그것을 **사후에 집계할 수 있는지**(로그 grep·DB 조회 중 하나로 실증)
* 기준선 88 suites / 1341 tests 대비 감소 없음.

---

## 관련 과거 이력 요약

* [[T-018-order-sync-fail-closed]] — 이 결함의 직접 출처(H-4). `order-quantity.ts` 의
  `submittedQuantity()` 가 왜 생겼는지, 그리고 reviewer 가 왜 "진짜 근본 해결은 사이징 시점에
  floor 하고 0주면 주문을 내지 않는 것"이라고 결론지었는지 §"Leader 질문에 대한 답" 을 읽을 것.
* [[T-017-kis-rate-limit-throttle]] — 소수점 주문 79건을 실제로 죽이고 있던 것은 브로커 거부가
  아니라 레이트리밋이었다. T-017 이 그것을 없앴다 = **이 결함의 방아쇠**.
* [[T-019-partial-fill-false-filled]] — 자매 결함. 수량 비교 기준을 공유한다.

---

## Developer

**작업일**: 2026-08-11 · **상태**: 구현 완료(미커밋 — 사용자 승인 대기)

### D-1 · 사이징 시점에 정수화 — 두 곳 **모두**, 함수 하나로

`src/lib/signals/service.ts` 에 `sizeOrderQuantity()` 를 만들고 **두 지점이 그 하나를 쓰게** 했다.
각자 같은 공식을 들고 있던 구조 자체를 없앤 것이 요점이다(한쪽만 고치면 다른 경로로 계속 생성).

```ts
export function sizeOrderQuantity(args: {
  market; orderType; requestedQuantity?; amountKRW; price?;
}): { quantity: number | undefined; raw: number | undefined }
```

`quantity` 의 세 값이 **서로 다른 의미**다 — 뭉개면 "0주 주문"과 "수량 미지정"을 구분할 수 없다:

| 값 | 의미 |
|---|---|
| `undefined` | 여기서 확정하지 않는다. 어댑터가 금액에서 파생(`kis-domestic` 폴백 `Math.floor` — 이미 정수) |
| `0` | **주문 불성립.** 1주도 못 산다 → 송신하지 않는다 |
| `> 0` | 브로커에 그대로 나갈 정수 주식 수 |

**국내도 정수화한다.** 근거는 task §③ 그대로 — 국내 KIS 는 정수 주식 수만 받고, 이 코드베이스
자신도 `kis-domestic.ts:269` 폴백에서 `Math.floor(amountKRW/price)` 를 쓴다(정수 전제의 증거).
`safety_daily_order_max_pct` 가 0→10 으로 열려 국내 신규 매수 경로가 살아 있으므로 지금 유효하다.

### D-1 · `order-quantity.ts` 는 **고치지 않았다** — 근거

지시대로 "그 파일을 바꾸지 않고도 목적을 달성할 수 있는지" 먼저 검토했고, **가능했다.**

`submittedQuantity()` 는 **"브로커가 실제로 받는 수량"** 이라는 의미로 [[T-019-partial-fill-false-filled|T-019]]
의 체결 완결성 판정이 함께 쓴다. 그 의미를 바꾸면 두 작업의 결론이 서로 흔들린다. 대신:

```ts
function toWholeShares(market, raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return submittedQuantity(market, Math.floor(raw));   // 오늘은 두 시장 모두 항등
}
```

정수를 **먼저 만들고** 그 결과를 `submittedQuantity` 에 한 번 더 통과시킨다. 오늘은 국내·해외
모두 항등이지만, 송신 규칙이 언젠가 달라지면 사이징이 자동으로 따라간다 — 즉 규칙을
재유도하지 않으면서 **두 값이 갈라질 수 있는 구조 자체**를 만들지 않는다(T-018 H-4 의 요점).
테스트가 이 불변식을 못 박는다: 임의 입력에 대해 `submittedQuantity(market, sized) === sized`.

**결론: 두 task 의 결론은 모순되지 않는다.** T-019 는 `submittedQuantity` 의 현행 의미
(국내 통과 / 해외 floor)에 그대로 기대고, T-020 은 그 의미를 건드리지 않고 입력을 정수로 만든다.

### D-1 · `amount_krw` 는 **재계산하지 않았다** — 근거

판단 기준 ②가 결정적이다. `checkOrderMax`/`checkDailyMax` 가 `amountKRW` 를 쓰므로,
정수화 뒤의 (더 작은) 실집행액으로 낮추면 **1회 한도와 일일 누적 한도가 둘 다 느슨해진다.**
task 파일이 "한도를 느슨하게 만드는 방향이면 하지 마라"고 명시했고 동의한다 —
기록의 정합성보다 한도의 보수성이 우선이다. 기록 쪽 잔여 오차는 아래 §D-3 에 적었다.

### D-2 · 0주면 주문하지 않는다 + **흔적** (스킵 절반 / 흔적 절반)

안전 레이어에서 막지 않았다 — 그건 사이징 결함을 안전장치로 덮는 것이고, "왜 주문이 없는가"를
다시 설명 불가능하게 만든다. **스킵의 이유는 스킵이 결정된 자리에서 말한다.**

공통 기록기 `recordBelowMinQty()` 하나가 세 경로(`signal-sizing`·`signal-approve`·`entry-watcher`)를
같은 형식으로 남긴다:

| 채널 | 내용 |
|---|---|
| 로그 토큰 | `SIZING_BELOW_MIN_QTY` — 앞에 경로 접두어가 붙는다 (`[signal-sizing]`·`[signal-approve]`·`[entry-watcher]`) |
| `trade_logs` | `event='sizing_below_min_qty'`, payload 에 `where`·`signalId`·`symbol`·`side`·`amountKRW`·`price`·`rawQuantity`. **`rawQuantity` 는 호가 추격까지 반영된 가격 기준** — 실제로 주문에 쓰였을 값이라야 "얼마가 모자랐는가"를 사후에 설명할 수 있다 |
| `errorCode` | `CreateSignalErrorCode` 에 `'quantity_below_min'` 추가. `ok:false` + 문자열만으로는 부족하다는 지시대로, 기존 `symbol_blacklisted`/`duplicate_active_signal` 관례를 따랐다 |
| `eval_funnel` | 새 게이트 `quantity_below_min`(stage 11) 추가 + `engine.ts` 의 `createSignalGuarded` 매핑 확장 |
| 시그널 상태 | 경로별로 다르다(아래) |
| cron 요약 | `entry-watcher` 회차 로그에 `below_min_qty=N` |

**eval_funnel 게이트를 새로 만든 이유** — 매핑을 확장하지 않으면 `signal_create_failed` 로
떨어지고 `verdict='error'` 가 되어 **"엔진이 고장났다"로 읽힌다.** 이건 정책 스킵이다.
stage 5 의 `sell_amount_below_min`(매도 전용)의 진입판 대응물이라 어휘도 일관된다.
📌 게이트 배열의 append 위치: 문서 규칙은 "목록 끝에 append"지만 실제 코드는 섹션별 그룹핑
(`exit_engine_disabled` 도 T-015 가 exit 섹션 중간에 넣었다)이고, `eval_funnel.gate` 는
`VARCHAR(48)` 이라 **순서에 저장 의미가 없다.** 가독성을 택해 stage 11 섹션에 넣었다 — 이견 있으면 조정.

**경로별 시그널 상태 처리** (각각 이유가 다르다):

| 경로 | 처리 | 이유 |
|---|---|---|
| `createSignal` (자동제출) | `auto_submitted` → **`skipped`** 로 정정 | 행이 이미 INSERT 된 뒤라 그대로 두면 "주문을 냈다"는 거짓말이 된다. `skipped` 는 게이트 감사 상태이고 `ACTIVE_SIGNAL_STATUSES` 에서도 빠지므로, 가격이 내려 1주가 성립하면 다음 틱에 다시 평가된다 |
| `approveSignal` (사람 승인) | **상태 변경 없음** | 사람이 다시 판단할 수 있어야 한다(금액 상향 or 포기). `approved` 면 "승인해서 주문했다"는 거짓 기록, `rejected` 면 "사람이 거부했다"로 오독된다. TTL 로 자연 만료 |
| `entry-watcher` | **상태 변경 없음** | 이 라우트는 **감시자**다. 가격이 움직이면 다음 틱에 성립할 수 있고, 끝내 안 되면 `expires_at` 이 처리한다 |

**알림은 매도만.** 매수 스킵은 "자본이 투입되지 않았다"로 끝나지만 매도 스킵은 **포지션이
닫히지 않았다** — 손절이었다면 보호가 아예 안 걸린 상태다. 매수까지 울리면(소액 계좌 × 고가
종목에서 자주 발생 가능) 알림이 흔해져 **정작 매도 경고가 묻힌다.** 키는 종목 단위
(`sizing-below-min:<symbol>`) + 창 6시간이라 매 틱 재시도돼도 하루 최대 4회로 묶인다.

### D-3 · `submitted_quantity` 컬럼 — **이번에 만들지 않았다.** 남는 불일치 조사 결과

권고 순서대로 (1) 사이징을 먼저 고쳤고, 그 뒤 `orders.quantity` 와 송신 수량이 갈라질 수 있는
경로를 전수 확인했다.

| 경로 | 이후 상태 |
|---|---|
| `service.ts` `buildOrderRequest` (createSignal 자동제출 · approveSignal 승인) | ✅ 일치. 정수 확정 후 `submittedQuantity` 항등 통과 |
| `entry-watcher/route.ts` | ✅ 일치. 같은 함수 사용 |
| 시그널이 수량을 이미 들고 있는 경우 (exit-engine `heldQty`, split 시나리오) | ✅ 일치. `sizeOrderQuantity` 가 **출처와 무관하게** 정수화하도록 만들었다 |
| 시장가 + 수량 미지정 | ⚠️ `orders.quantity` 가 **NULL**, 브로커는 `Math.floor(amountKRW/price)` 를 받는다. "불일치"라기보다 **부재**다. T-019 의 `settleDecision` 이 이 경우를 `ordered_qty_unknown` 으로 집계한다 |
| `src/app/api/orders/route.ts` (수동 주문 — 범위 밖, 소견 요청분) | ⚠️ 클라이언트가 보낸 `quantity` 를 **가공 없이** `submitOrder` 로 넘긴다. 소수가 들어올 수 있고, 해외는 전송 직전 floor(축소집행) · 국내는 KIS 거절. UI 가 정수만 보낸다는 보장이 코드에 없다 |

**결론: 엔진 경로에는 불일치가 남지 않는다 → `submitted_quantity` 컬럼의 필요성 대부분이
사라졌다.** 남은 두 건은 스키마가 아니라 각자의 자리에서 고칠 문제다(시장가는 어댑터 파생값을
`orders` 에 되돌려 쓰는 문제, 수동 주문은 입력 정규화 문제). → **T-021 후보로 제안.**

### 변경 파일

| 구분 | 경로 |
|---|---|
| 수정 | `src/lib/signals/service.ts` (`sizeOrderQuantity`·`recordBelowMinQty` 신설, `buildOrderRequest` 반환형 확장, `createSignal`·`approveSignal` 0주 처리) |
| 수정 | `src/app/api/cron/entry-watcher/route.ts` |
| 수정 | `src/lib/strategy/eval-funnel-labels.ts` (게이트 1개 추가 — 순수 상수 모듈) |
| 수정 | `src/lib/strategy/engine.ts` (`createSignalGuarded` 게이트 매핑 3줄) |
| 수정 | `src/lib/signals/__tests__/service.test.ts` (아래 참조) |
| 신규 | `src/lib/signals/__tests__/order-sizing.test.ts` (19 tests) |
| 신규 | `src/app/api/cron/entry-watcher/__tests__/sizing.test.ts` (7 tests) |

`src/lib/exchanges/order-quantity.ts` 는 **건드리지 않았다.**
`src/lib/safety/order-sync.ts` · `src/lib/reports/trade-report.ts` 도 **건드리지 않았다**(T-019 영역).

**⚠️ 기존 테스트 fixture 5건을 수정했다.** `service.test.ts` 의 `KRW-BTC` + 소수 수량
(`0.000033`, `0.0001`)과 `price=100,000 / amount=3,000`(=0.03주)은 자매 프로젝트(암호화폐)의
관례이고, **이번 변경이 정확히 그것들을 주문 불성립으로 거부**하기 때문에 깨졌다.
각 테스트의 의도(auto 라우팅 / 승인 / 호가 추격)는 그대로 두고 주식 현실에 맞는 정수 성립
값으로 바꿨으며, 바꾼 이유를 주석으로 남겼다. **테스트를 삭제하거나 약화시키지 않았다** —
오히려 호가 추격 테스트 2건에는 "수량이 정수인가" 단언을 추가했다.

### 검증

`npm run typecheck` 통과(exit 0). `npm test` → **92 suites / 1396 tests 전부 통과**
(기준선 88/1341 대비 +4 suites · +55 tests, 감소 없음).

QA 시나리오 대응: ①해외 1.9→1주 ②해외 0.79→주문없음+흔적 ③국내 15.29→15주
④매도 경로(시장가·보유수량 정수 유지 + 0주 시 알림) ⑤시장가 무회귀 ⑥두 경로 동일 수량
(`entry-watcher` 결과를 `sizeOrderQuantity` 반환값과 직접 대조) ⑦사후 집계(trade_logs 조회 ·
로그 토큰 grep · funnel 게이트) — 모두 테스트로 고정했다.

### 남긴 것 / Leader 판단 요청

1. **수동 주문 경로(`api/orders/route.ts`) 는 손대지 않았다** (범위 밖). 클라이언트가 소수
   수량을 보낼 수 있고 코드에 방어가 없다. → T-021 후보.
2. **시장가 + 수량 미지정** 은 `orders.quantity` 가 NULL 로 남는다. T-019 가 이 경우를
   `ordered_qty_unknown` 으로 집계하므로 조용하지는 않지만, 체결 완결성을 수량으로 검증할 수 없다.
3. **eval_funnel 게이트 append 위치**(섹션 중간 vs 목록 끝) — 위 §D-2 📌 참조. 저장 의미는 없다.
4. **0주 스킵이 실제로 얼마나 자주 발생할지는 배포 후에야 안다.** `safety_order_max_pct=6` 이
   소액 계좌 × 고가 종목과 만나면 국내 매수가 상시 스킵될 수 있다. `trade_logs` 의
   `sizing_below_min_qty` 건수를 배포 후 며칠 관측할 것을 권한다 — 많으면 결함이 아니라
   **주문 금액 정책(6%)의 문제**라는 신호다.

## Reviewer

**작업일**: 2026-08-11 · **판정**: **CONDITIONAL_PASS** (HIGH 1건 — Developer 수정 후 재검증 필요).
`git -c core.fileMode=false diff`(HEAD=`3d4197e`, 미커밋) 로 실측. `npm run typecheck` 재실행
exit 0, `npm test` 재실행 **92 suites / 1396 tests 전부 통과** — Developer 보고와 동일.

### 🔴 HIGH-1 · exit-engine(청산) 경로에서 `quantity_below_min` 이 eval_funnel 에 **이중 기록**되고,
그중 하나가 이 task 가 없애려던 바로 그 "엔진 고장" 오독을 재현한다

**결함 위치**: `src/lib/strategy/engine.ts:848-861` (이번 diff 가 건드리지 않은 기존 코드).

exit-engine 루프는 `createSignalGuarded(exitSig, rec)` 를 호출한다:

```ts
// engine.ts:848
const res = await createSignalGuarded(exitSig, rec);
if (res.ok) {
  created++;
  ...
} else {
  rec.error('exit_create_failed', {          // ← 848행, 무조건 실행
    symbol, side: 'sell',
    detail: { exitKind: exitSig.exitKind, error: res.error },
  });
  console.warn(`[exit-engine] ${symbol} ${exitSig.exitKind} 시그널 실패: ${res.error}`);
}
```

그런데 `createSignalGuarded` 자신이 **이미** `!res.ok` 인 경우를 게이트별로 분류해 기록한다
(`engine.ts:185-221`, 이번 diff 가 `gate` 삼항식에 `quantity_below_min` 분기 3줄을 추가한 바로 그
함수):

```ts
// engine.ts:202 (diff 로 추가된 3번째 분기)
const gate: FunnelGate =
  res.errorCode === 'duplicate_active_signal' ? 'duplicate_active_signal'
  : res.errorCode === 'symbol_blacklisted'    ? 'symbol_blacklisted'
  : res.errorCode === 'quantity_below_min'    ? 'quantity_below_min'   // T-020 신설
  :                                             'signal_create_failed';
rec.record({ ...base, gate, verdict: gate === 'signal_create_failed' ? 'error' : 'skip', ... });
return { ok: false, error: res.error };   // ← errorCode 는 반환값에 담기지 않는다
```

`createSignalGuarded` 는 `quantity_below_min` 을 올바르게 `verdict:'skip'` 으로 기록한 뒤
`{ ok: false, error: res.error }` 를 돌려준다(`errorCode` 필드 자체가 반환 타입에 없다). 호출부인
exit-engine 루프는 `res.ok===false` 만 보고 **무조건** `rec.error('exit_create_failed', ...)` 를
**추가로** 호출한다 — 어떤 게이트로 이미 기록됐는지 알 방법이 없기 때문이다. `EvalFunnelRecorder.record()`
(`eval-funnel.ts:89-95`)는 단순히 배열에 push 할 뿐 중복 제거를 하지 않으므로, **같은 청산 시도 1건이
`eval_funnel` 에 두 행**으로 남는다:

| 행 | gate | verdict |
|---|---|---|
| 1 (createSignalGuarded 내부, 이번 diff 신설) | `quantity_below_min` | `skip` |
| 2 (exit-engine 루프, 기존 코드) | `exit_create_failed` | **`error`** |

**이게 왜 문제인가.** `eval-funnel-query.ts:171,179` 는 리포트의 "이상(anomalies)" 절을
`WHERE verdict = 'error'` 로 집계하고 `gateLabelKo(gate)` 로 라벨을 붙인다.
`exit_create_failed` 의 한글 라벨은 `'청산 시그널 생성 실패'`(`eval-funnel-labels.ts:296`)다.
즉 **1주 미만이라 정책적으로 스킵한 정상 상황**이 Slack/Telegram 정기 리포트의 "⚠ 이상" 줄에
"청산 시그널 생성 **실패**"로 매 발생마다 찍힌다. 이 diff 의 `quantity_below_min` 게이트를 만든
이유가 정확히 이 문장이다(developer 주석, `engine.ts:204-205`, D-2 근거): *"`signal_create_failed`
로 뭉개면 verdict 가 'error' 가 되어 '엔진이 고장났다'로 읽힌다."* — entry(매수) 경로
(`engine.ts:1327`, "createSignalGuarded 가 ... 전부 eval_funnel 에 기록한다"는 주석대로 호출부가
추가 기록을 하지 않음)에서는 이 목표가 정확히 달성됐다. **exit(매도/청산) 경로에서만** 같은 함수를
공유하면서 호출부의 사전 존재하던 이중 기록 습관 때문에 목표가 무력화된다.

**왜 이게 이 task 의 관심사인가 (단순 리포팅 버그가 아닌 이유).**

1. **가장 위험한 경로에서 터진다.** `router.ts:253` `FORCED_AUTO_EXIT_KINDS = new Set(['hard_stop',
   'eod_loss_cut'])` — 하드손절·EOD손절은 모드 무관 강제 `auto_submit` 이라 반드시
   `createSignal` 의 수량 체크(`service.ts:452`)까지 도달한다. 즉 **손절이 1주 미만이라 스킵될
   때마다** 이 이중 기록이 함께 발생한다.
2. **"울지 않는 경보"의 반대 극단 — "매번 우는 가짜 경보"가 신뢰를 갉아먹는다.** T-018 H-4(B) 가
   지적한 실제 위험은 "한 번도 울지 않는 경보"였다(이 프로젝트가 반복해서 경계해 온 실패
   유형). 이번 건은 정반대지만 결과는 같은 계열이다 — `quantity_below_min` 이 소액 계좌
   × 고가 종목에서 **자주** 발생할 수 있다는 건 developer 자신이 "남긴 것" §4 에 이미 적어
   뒀다. 매 발생마다 "청산 시그널 생성 실패" 가 함께 찍히면, 운영자는 그 라벨이 사실은
   무해한 정책 스킵이라는 걸 곧 학습하고 **"청산 시그널 생성 실패"를 무시하기 시작한다** —
   그런데 그 라벨은 진짜 청산 실패(DB 장애·예외)도 같은 이름으로 찍는다. 가짜와 진짜가 같은
   라벨 아래 섞이면 진짜가 가짜에 묻힌다. `order-sync.ts` 의 알림 설계 전체가 "키를 나눠서
   한쪽이 다른 쪽을 억누르지 않게 한다"는 원칙을 정확히 지켰는데(H-4(B), T-019 D-3), 이
   지점만 그 원칙이 빠졌다.
3. **테스트가 이 상호작용을 커버하지 않는다.** `entry-watcher/__tests__/sizing.test.ts` 와
   `signals/__tests__/order-sizing.test.ts` 는 `service.ts`/`entry-watcher` 직접 호출만
   검증하고 `engine.ts` 의 `runExitEngine` → `createSignalGuarded` 경로는 어느 테스트에도
   없다(`engine.test.ts` grep 결과 `quantity_below_min` 0건). **T-020 이 스스로 확장한 파일
   (`engine.ts`)에 대한 테스트가 없다** — 담당 파일 범위를 벗어나 수정했다면 그 범위에 대한
   테스트도 함께 있어야 하는데 빠졌다.
4. **pre-existing 코드지만 이 task 가 처음으로 그 경로를 활성화한다.** `engine.ts:848-861` 자체는
   이번 diff 가 건드리지 않았다(다른 `errorCode`, 예: exit 신호가 `duplicate_active_signal` 로
   막힐 때도 원래 이렇게 이중 기록됐을 것이다 — 그건 이 task 책임이 아니다). 하지만
   `quantity_below_min` 이라는 **새 게이트를 만들고 "verdict=error 로 읽히면 안 된다"는 목적을
   명시**한 것은 이번 diff이므로, 그 목적이 청산 경로에서 실제로 달성되는지는 이 task 의
   책임 범위다.

**권고**: `engine.ts:856` 의 `else` 분기를 `res.errorCode` (현재 `createSignalGuarded` 반환 타입에
없으므로 타입 확장 필요) 로 분기해, `quantity_below_min`(과 이미 `createSignalGuarded` 가 내부
기록을 마친 다른 `errorCode` 들)일 때는 `rec.error('exit_create_failed', ...)` 를 **호출하지
않게** 한다. 최소 변경으로는 `createSignalGuarded` 반환 타입에 `alreadyRecorded?: boolean` 또는
`errorCode` 를 추가해 호출부가 판단하게 하는 방법도 있다. entry 경로(1327행)가 이미 "호출부가
추가 기록하지 않는다"는 올바른 패턴이므로 그것을 exit 경로에도 맞추는 것이 방향이다.

### 그 외 지정 감사 항목

**① 두 사이징 지점 — 세 번째 경로 재조사.** `service.ts:119`(`sizeOrderQuantity` 내부로 이동)와
`entry-watcher/route.ts:238`(같은 함수 호출로 교체) 확인. `grep -rn "amountKRW\s*/\s*.*price\|amount_krw.*price"`
로 국내·해외 주문 생성 경로를 재검색했으나 이 둘 외에 새 계산식은 없음 — 확인.
`src/app/api/orders/route.ts`(수동 주문)는 여전히 클라이언트 `quantity` 를 가공 없이 통과시킨다
(task 파일이 이미 범위 밖으로 명시하고 developer 도 T-021 후보로 남김) — 이 경로로 소수 주문이
들어올 수 있다는 지적은 사실이나, 사람이 직접 입력하는 화면이라 자동매매 안전장치 우회와는
성격이 다르다. 이번 판정에 반영하지 않음(범위 밖 합의됨).

**② 정수화 — 매수/매도·국내/해외·지정가/시장가 조합 확인.**
`sizeOrderQuantity`(`service.ts:159-193`) 를 직접 읽고 `order-sizing.test.ts` 를 대조:
- 매수·매도 모두 동일 함수(`toWholeShares`)를 거치므로 방향 차별이 없다 — **의도적**이다
  (사이징 자체는 방향 무관하게 정수화해야 하고, 방향별 리스크는 D-2 skip 처리에서 갈린다).
- **매도(청산) 절삭이 보유수량 미만을 만드는지** — exit-engine 의 매도 시그널은 항상
  `quantity: heldQty`(`engine.ts:565`, `heldQty = entry.qty`)로 이미 수량을 들고 생성되므로
  `sizeOrderQuantity` 의 **①경로**(`requestedQuantity` 이미 있음)를 탄다. `entry.qty` 는
  브로커 잔고 조회 기반 값이라 통상 이미 정수다 — `Math.floor` 가 사실상 항등이라 절삭
  손실이 발생할 여지가 낮다. 다만 이론적으로 `heldQty` 가 소수로 오염된 상태로 들어오면
  `floor` 가 그 값을 깎는다 — 이건 T-020 이 만드는 새 위험이 아니라(절삭 전 코드는 그 소수를
  그대로 국내는 송신(거절)·해외는 전송 직전 floor 였으므로 동일하거나 더 나쁜 결과였다),
  오히려 floor(N.x)→N 이 절삭 전(전량 거절 또는 다른 지점 절삭)보다 **포지션을 더 많이
  닫는 방향**이라 개선이다. 확인 — 새 위험 없음.
- 지정가·시장가: 시장가는 `sizeOrderQuantity` 가 `undefined` 를 반환해 어댑터에 위임하고
  (기존 `Math.floor` 그대로) 그 값은 이미 정수 — `order-sizing.test.ts:236,247` 로 고정 확인.

**③ 0주 스킵 관측 가능성.** `trade_logs.sizing_below_min_qty`(`service.ts:271-281`) INSERT 를
직접 읽었고, `errorCode`→`eval_funnel.quantity_below_min` 매핑(`engine.ts:204-205`)도 확인.
**entry/매수 경로에서는 설계대로 정확히 동작한다.** exit/매도 경로는 위 HIGH-1 대로 "관측
가능"이라는 목표 자체는 달성하지만(스킵 사실 자체는 trade_logs·로그·알림 세 채널 모두 정상
도달 — `recordBelowMinQty` 는 `createSignal` 내부에서 호출 경로 무관하게 실행된다) **관측된
신호의 신뢰도가 이중 기록으로 훼손된다**는 것이 HIGH-1 의 요점이다. "잡히는가"(예)와
"잡힌 신호를 믿을 수 있는가"(아니오, exit 경로만)는 다른 질문이다.

**④ `amount_krw` 재계산 여부와 안전 한도.** `buildOrderRequest`(`service.ts:224-227`)의 주석과
실제 코드 모두 `input.amountKRW` 를 그대로 `req.amountKRW` 에 넣는 것을 확인 — 재계산 없음.
`order-limits.ts` 의 `checkOrderMax`/`checkDailyMax` 가 이 값을 쓰는 호출 체인을 추적했고,
정수화된 (더 작은) 실집행 수량이 아니라 원래 요청 금액 기준으로 한도 검사가 이뤄지므로 한도가
**느슨해지지 않았다** — 확인.

**⑤ `submittedQuantity` 의미 변경 여부 — T-019 와의 모순.** `order-quantity.ts` 는 `git diff`
에 전혀 나타나지 않음(파일 자체가 diff 목록에 없음) — read-only 준수 확인. `toWholeShares`
(`service.ts:190-193`)가 정수를 먼저 만들고 `submittedQuantity` 를 항등 통과시키는 설계이므로,
T-019 의 `settleDecision` 이 쓰는 `submittedQuantity(market, order.quantity)` 비교 기준은
이번 diff 이후에도 **신규 주문에 대해 그대로 유효**하다 — 신규 주문의 `orders.quantity` 는
이미 정수이므로 `submittedQuantity` 는 항등이고, T-019 반례표(§부분체결 종결)의 "체결수량 <
송신수량" 비교가 왜곡되지 않는다. 두 task 결론은 모순되지 않음 — 확인.

**⑥ T-018 H-4 회귀.** `order-quantity.test.ts`/`order-sync-partial-settled.test.ts` 의
소수점 갇힘 회귀(`336행 "해외 1.7주가 1주 전량 체결되면 부분체결로 오판하지 않는다"`)가
그대로 유지·통과함을 재실행으로 확인.

### 범위 이탈 판단 — `engine.ts`/`eval-funnel-labels.ts` 수정

`eval-funnel-labels.ts` 수정(게이트 상수·라벨 추가)은 순수 데이터 확장이라 위험이 낮고,
`quantity_below_min` 을 관측 가능하게 만들려면 불가피하다 — **정당한 확장**으로 판단한다.
`engine.ts` 수정(3줄, `createSignalGuarded` 게이트 매핑)도 그 자체로는 정확하다 — 문제는
그 3줄이 아니라 **건드리지 않은** exit 루프(848-861행)와의 상호작용에서 생겼다(위 HIGH-1).
즉 "범위를 넘은 수정이 부작용을 만들었다"가 아니라 "범위를 넘은 수정이 **건드리지 않은 인접
코드의 기존 결함**을 새 게이트로 드러냈다"는 편이 정확하다. 확장 자체를 되돌릴 필요는 없고
HIGH-1 만 고치면 된다.

### 기존 테스트 fixture 수정 5건 — 약화 여부

`service.test.ts` diff 를 직접 읽었다(5개 테스트: `KRW-BTC` 소수 수량 2건,
`chase 가격` 매수·매도 2건, 관련 승인 흐름 1건 경로). 모두 **금액/가격 값만 주식 현실에 맞게
치환**했고 원래 검증 대상(라우팅 분기, 호가 추격 방향, 승인 흐름)은 그대로 유지됨을 확인.
오히려 두 건(`103-122행 부근`)에 `expect(Number(orderInsert!.params[7])).toBe(2 or 3)` 수량
정수 단언이 **추가**됐다 — 커버리지가 약화가 아니라 강화됐다. 약화 없음 — 확인.

### 요약

| 항목 | 건수 |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 (exit-engine eval_funnel 이중 기록) |
| MEDIUM | 1 ([[T-019-partial-fill-false-filled]] 절 — `executions` 동시 실행 멱등성, 방어심도 권고) |
| LOW | 1 ([[T-019-partial-fill-false-filled]] 절 — 과거/신규 executions 혼재 통합 테스트 갭) |

**판정: CONDITIONAL_PASS.** Critical 0·High 1 로 판정표 상 PASS 문턱(Critical 0 + High ≤ 1)에
든다. 다만 HIGH-1 이 이 task 의 핵심 요구(D-2 "0주 스킵을 조용히 넘기지 않는다", 특히 가장 위험한
청산 경로)를 부분적으로 무력화하므로 QA 이전에 developer 확인을 권고해 CONDITIONAL_PASS 로
표기한다 — Critical 이 아니므로 QA 진행 자체를 막지는 않되, **QA 는 반드시 exit-engine 경로의
`quantity_below_min` 을 별도로 확인**하기 바란다(entry-watcher/service.ts 단위 테스트만으로는
이 이슈가 드러나지 않는다).

## 라운드 2 재감사 (Reviewer) — 2026-08-11

**판정: PASS.** Critical 0 · High 0 · Medium 0 · Low 0. `npm run typecheck` 재실행 exit 0,
`npm test` 재실행 **93 suites / 1411 tests 전부 통과** — Developer 보고와 동일.
Developer 절의 "라운드 2" 서술을 신뢰하지 않고 `engine.ts`/`engine.test.ts` diff 와
`engine-exit-create-outcome.test.ts` 전문을 직접 읽고 재검증했다.

### Leader 재감사 요청 항목 대응

**① HIGH-1 이 실제로 닫혔는가 — skip 판정 범위와 반대 방향(진짜 실패 침묵) 둘 다 확인.**

`engine.ts:175-207`(`GuardedSignalResult` 신설)과 `222-267`(`createSignalGuarded` 3개 반환
지점)을 라인 단위로 대조했다:

| 반환 지점 | `recordedVerdict` | 실제 기록된 게이트 |
|---|---|---|
| `res.ok` 성공 | `'pass'` | `signal_created` |
| `errorCode` 매핑됨(`duplicate_active_signal`/`symbol_blacklisted`/`quantity_below_min`) | `'skip'` | 해당 게이트 |
| `errorCode` 없음(일반 거부) | `'error'` | `signal_create_failed` |
| `createSignal` 예외 | `'error'` | `signal_create_failed` |

`CreateSignalErrorCode` 유니온(`service.ts:93-97`)은 정확히 이 3개 값만 갖고 있고 셋 다
정책 스킵이다 — 즉 verdict 매핑이 **전수**이며 빠진 케이스가 없다(타입 유니온에 새 값이
추가되면 `gate` 삼항식의 `else` 로 떨어져 `signal_create_failed`/`'error'` 가 되므로,
분류 누락이 나더라도 "조용한 스킵 취급"이 아니라 "안전한 쪽(에러 취급)"으로 fail — 이
자체가 D-2 의 의도인 fail-safe 방향과 일치).

exit 루프(`engine.ts:886-916`)를 다시 읽었다: `if(res.ok)` / `else if(res.recordedVerdict
==='skip')`(스킵, 기록 안 함) / `else`(진짜 실패·예외, `exit_create_failed` 기록) —
세 분기가 상호 배타적이고 빠짐없이 덮는다. **반대 방향 확인**: `errorCode` 없는 일반 거부와
예외 경로는 둘 다 `recordedVerdict='error'` 로 반환되므로 `else` 로 떨어져 여전히
`rec.error('exit_create_failed', ...)` 가 실행된다 — stage 29(exit 트랙)에 잡히는지
`GATE_STAGE.exit_create_failed=29`(`eval-funnel-labels.ts:215`, 미변경 확인)로 직접 확인했다.
**과잉 경보 제거가 진짜 실패의 침묵으로 이어지지 않았음을 코드로 확인.**

**② 뮤테이션 검증 주장 — 직접 실행하지 않고 대신 논리적으로 재현했다.**

지시 제약("production 코드 수정 금지, 읽기만")과 "뮤테이션 검증을 신뢰하지 말고 직접
확인하라"가 서로 부딪히므로, **코드를 건드리지 않는 방법**으로 검증했다: exit 루프의
분기 구조가 `if/else if/else` 세 갈래뿐이므로, `else if (res.recordedVerdict==='skip')`
조건이 없다고 가정하면(=수정 전 동작을 재현) `res.ok===false` 인 모든 경우가 `else` 로
떨어져 무조건 `rec.error('exit_create_failed', ...)` 를 실행한다 — 이는 제어흐름을 정적으로
읽는 것만으로 결정되는 사실이며 실행할 필요가 없다. 즉 `quantity_below_min` mock 을 주입한
`engine-exit-create-outcome.test.ts:197-215` 의 `expect(gatesOf('error')).not.toContain
('exit_create_failed')` 단언은, 조건절이 없었다면 **반드시** 실패했을 것이다(`res.ok`
는 여전히 `false` 이므로 무조건 `else` 진입 → `exit_create_failed` 기록 → 단언 위반).
Developer 의 뮤테이션 결과 보고와 이 정적 추론이 일치한다 — 신뢰할 근거가 있다고 판단.

또한 이 테스트 파일이 **mock 이 아니라 실제 `runAll` 실행 후 `eval_funnel` INSERT 파라미터를
파싱**(30-58행, `defaultPoolQuery` 가 `INSERT INTO eval_funnel` SQL 을 가로채 flatten
파라미터를 실제 스키마 순서(`run_id,market,symbol,strategy_id,side,stage,gate,verdict,
reason,detail`)대로 역구성)한다는 점을 직접 확인했다 — 단위 mock 이 아니라 배선 자체를
검증하는 구조라 "테스트가 통과만 하고 아무것도 단언하지 않는" 형태가 아니다.
`HARD_STOP_PRICE=60_000`(진입가 대비 −14%, `style.hardStopPct=5`)로 hard_stop 이 실제로
발화하는지도 ①번 "전제" 테스트(181-191행)가 `createSignal` 이 `exit_kind:'hard_stop'`
로 호출됐음을 직접 단언하고 있어 하네스 자체의 신뢰성도 확인했다.

**③ `createSignalGuarded` 반환 계약 확장의 파급 — 호출부 재조사.**

`grep -n "createSignalGuarded("` 로 호출부를 다시 찾았고 정확히 2곳(`engine.ts:886`,
`engine.ts:1386` — 라인 번호가 라운드 1 이후 인터페이스 삽입으로 밀렸다)임을 확인했다.
진입(매수) 경로 `1386`행 주변을 다시 읽었다 — **이번 diff 가 그 근방에 어떤 hunk 도 만들지
않았음**을 `git diff` 로 직접 확인(diff 는 임포트·인터페이스·`createSignalGuarded` 본문·
exit 루프 세 곳에만 hunk 가 있다). 진입 경로는 `if (!res.ok) continue;` 만 하고 반환값의
새 필드를 아예 참조하지 않으므로 계약 확장에 영향받지 않는다 — 확인.

강제 auto_submit(`router.ts` `FORCED_AUTO_EXIT_KINDS`)·쿨다운(`setCooldown`) 관련 파일이
diff 목록에 전혀 없음을 `git diff --stat`(router.ts/dry-run.ts/order-limits.ts 모두 미포함)
로 재확인. 쿨다운 동작은 `engine-exit-create-outcome.test.ts:217-225` 가 "스킵돼도
`setCooldown` 이 호출되지 않는다"를 직접 단언하고 있고, 이는 스킵 시 쿨다운을 안 거는
기존 로직(`res.ok` 분기에서만 `setCooldown` 호출, 미변경)이 그대로 유지됨을 보여준다 — 확인.

**④ `toEqual` → `toMatchObject` 교체 — 약화 여부.**

`engine.test.ts` diff(120-186행)를 직접 대조했다. 원래 `expect(res).toEqual({ok:true,
signalId:7})` 는 반환 객체의 **정확한 전체 모양**을 요구하는 단언이었는데, 이번 계약 확장으로
`recordedGate`/`recordedVerdict` 필드가 성공 경로에서도 항상 채워지므로(위 ①표) `toEqual`
을 그대로 두면 **테스트가 깨진다** — 즉 교체는 신규 필드 추가라는 타입 확장에 따른 불가피한
결과이지, 검증 강도를 낮추려는 선택이 아니다. 교체 후 `toMatchObject({ok:true, signalId:7,
recordedGate:'signal_created', recordedVerdict:'pass'})` 로 원래 단언(ok·signalId)에
새 필드 단언 2개가 **추가**됐다 — 원래 검증 대상은 하나도 줄지 않았다.

더 나아가 신설된 `describe('createSignalGuarded — 기록한 판정을...')`(126-186행)는
`quantity_below_min`/`duplicate_active_signal`/`symbol_blacklisted` 세 게이트를
`it.each` 로 파라미터화해 각각 `recordedGate`/`recordedVerdict` 를 단언하고, **`rec.peek()`
가 정확히 1개 행**임을 확인(`toHaveLength(1)`)하는 단언까지 포함한다 — 이건 라운드 1엔
없던 이중기록 방지의 **단위 수준** 검증이라 순수 추가다. 약화 아님 — 확인.

**⑤ MEDIUM-1 탐지기 — [[T-019-partial-fill-false-filled]] Reviewer 라운드 2 절에서 확인,
새 문제 없음.** (교차 링크 — 담당 파일이 `order-sync.ts` 라 그쪽에 상세 기록.)

**⑥ LOW-1 픽스처 — [[T-019-partial-fill-false-filled]] Reviewer 라운드 2 절에서 손계산
재검증 완료(−40, 960 일치). 교차 링크.**

**⑦ 라운드 1 "결함 없음" 판정 회귀 여부.** `git diff --stat` 로 라운드 2 변경 파일을 확인—
`engine.ts`·`engine.test.ts`·`engine-exit-create-outcome.test.ts`(신규)·`order-sync.ts`·
관련 테스트 2건·`trade-report-partial-fill.test.ts` 뿐이다. `service.ts`·
`entry-watcher/route.ts`·`order-quantity.ts`·`trade-report.ts` 핵심 쿼리는 이번 라운드에
전혀 손대지 않았다 — 라운드 1 에서 검증한 사이징 정수화·매도 절삭 방향·안전 한도·
`submittedQuantity` 무모순 결론에 영향 없음. 전체 스위트 재실행(93/1411 전부 통과)으로도
회귀 없음을 확인했다.

### 종합

라운드 1 의 유일한 HIGH(exit-engine eval_funnel 이중 기록)가 **특례가 아니라 일반 규칙**으로
해소됐고, 그 해소가 반대 방향의 침묵(진짜 청산 실패 은폐)을 만들지 않았음을 정적 분석 +
실제 `runAll` 배선 테스트 + 재실행으로 삼중 확인했다. 남은 이슈 없음.

**최종 판정: PASS.** QA 단계로 진행해도 좋다.

### 라운드 2 (Reviewer HIGH-1 반영) — 2026-08-11

**Reviewer 지적이 맞다.** 내가 `quantity_below_min` 게이트를 만든 이유가 "`verdict='error'` 로
읽히면 엔진 고장으로 오독된다"인데, **하필 가장 위험한 경로(청산)에서만 그 목적이 무력화되고
있었다.** 진입 경로에는 이미 올바른 선례(호출부가 추가 기록을 하지 않음)가 있었으므로,
그 패턴에 exit 경로를 맞추는 것이 방향이라는 판단에도 동의한다.

#### 무엇이 문제였나 (재확인)

`createSignalGuarded` 는 **성공·정책 스킵·실패·예외를 전부 자기가** `eval_funnel` 에 기록한다.
그런데 반환값에 그 사실이 없어서(`{ok, signalId?, error?}` 뿐) exit 루프는 `!ok` 이기만 하면
`rec.error('exit_create_failed', …)` 를 무조건 덧썼다. 즉 **모든 실패 경로가 이중 기록**이었다 —
`quantity_below_min` 만의 문제가 아니라 `symbol_blacklisted`·`duplicate_active_signal` 도 같았다.

#### 고친 방법 — **특례가 아니라 일반 규칙** (지시 ⚠️1 대응)

게이트 이름을 나열해 빼는 미봉책을 쓰지 않았다. 그러면 새 스킵 게이트가 추가될 때마다 호출부를
같이 고쳐야 하고, **같은 결함이 그대로 재발**한다. 대신 반환 계약에 판정의 **성격**을 실었다:

```ts
export interface GuardedSignalResult {
  ok; signalId?; error?;
  errorCode?: CreateSignalErrorCode;   // reviewer 권고 반영
  recordedGate?: FunnelGate;           // 이미 기록한 게이트
  recordedVerdict?: FunnelVerdict;     // ← 호출부의 유일한 판단축
}
```

exit 루프의 규칙:

| `recordedVerdict` | 동작 | 근거 |
|---|---|---|
| `'skip'` | `exit_create_failed` **기록 안 함**, `console.log` 로 스킵 사실만 | 정책 판단은 실패가 아니다. `createSignalGuarded` 가 이미 게이트 행을 남겼다 |
| `'error'` (일반 거부·예외) | **기존대로 `exit_create_failed` 기록** | `createSignalGuarded` 의 기록은 stage 11(진입 축)이다. 이걸 없애면 청산 실패가 **exit 트랙(stage 21~29)에서 사라진다** — 지시 ⚠️1 이 경고한 "반대 방향의 침묵" |
| `undefined` (방어) | 기록함 | fail-safe 방향 — 침묵보다 중복이 낫다 |

이 규칙 하나로 `quantity_below_min`·`symbol_blacklisted`·`duplicate_active_signal` **전부**
동시에 고쳐졌고, 앞으로 추가될 스킵 게이트도 자동으로 포함된다.

**폭발반경 최소화 (지시 ⚠️2 대응)**: `engine.ts` 변경은 ① `createSignalGuarded` 반환 타입 확장
(+ 3개 return 문에 필드 추가) ② exit 루프 `else` 를 `else if (skip) / else` 로 분기 — 두 곳뿐이다.
**강제 auto_submit·쿨다운·알림·진입 경로는 한 줄도 건드리지 않았다.** 특히 쿨다운은 여전히
성공 시에만 걸리므로(스킵 시 안 걸림) 1주 미만으로 스킵된 손절은 다음 틱에 재시도된다 —
회귀 테스트로 고정했다.

#### 테스트 (지시대로 필수 2건 + α)

신규 `src/lib/strategy/__tests__/engine-exit-create-outcome.test.ts` (6 tests) —
`engine-exit-disabled.test.ts` 의 하네스 패턴을 따라 **`runAll` 로 실제 청산 경로를 돌리고**
`eval_funnel` flush INSERT 파라미터를 파싱해 실제 기록된 행을 검사한다(단위 mock 이 아니라
실제 배선 검증).

| # | 고정 내용 |
|---|---|
| 전제 | hard_stop 이 실제로 `createSignal` 까지 도달하고, 정상 생성 시 `exit_create_failed` 가 없다 |
| ① | `quantity_below_min` → `skip` **1행만**, `verdict='error'` 행 **0개** |
| ①-b | 스킵돼도 `setCooldown` 미호출 → 다음 틱 재시도 (손절 유실 방지) |
| ①-c | **일반 규칙 검증** — `duplicate_active_signal`·`symbol_blacklisted` 도 이중 기록 안 됨 |
| ② | errorCode 없는 일반 거부 → `signal_create_failed`(stage 11) **＋** `exit_create_failed`(stage 29) 둘 다 |
| ②-b | `createSignal` 예외 → `exit_create_failed` 유지 + 런은 계속 |

**뮤테이션 검증**: `else if (res.recordedVerdict === 'skip')` 를 `else if (false)`(=수정 전 동작)로
되돌려 재실행했더니 ①·①-c 두 건이 **실패**했다. 통과하는 이유가 실제 수정 때문임을 확인했다.

`engine.test.ts` 에도 반환 계약 단위 테스트 5건을 추가했다. 기존 테스트 1건
(`res.ok=true → …`)이 `toEqual` 로 반환 객체를 **정확 일치** 단언하고 있어 계약 확장으로
깨졌다 — `toMatchObject` 로 바꾸고 **새 필드까지 함께 단언**해 커버리지를 넓혔다(약화 아님).

#### 변경 파일 (라운드 2)

| 구분 | 경로 |
|---|---|
| 수정 | `src/lib/strategy/engine.ts` |
| 수정 | `src/lib/strategy/__tests__/engine.test.ts` |
| 신규 | `src/lib/strategy/__tests__/engine-exit-create-outcome.test.ts` |

#### 검증 (라운드 2)

`npm run typecheck` exit 0. `npm test` → **93 suites / 1411 tests 전부 통과**
(라운드 1 기준선 92/1396 대비 +1 suite · +15 tests, 감소 없음).

## QA

**작업일**: 2026-08-11 · **판정**: ✅ 검증 통과

### 실행 결과

```
npm run typecheck: exit 0
npm test: 93 suites / 1411 tests 전부 통과
기준선: 93 suites / 1411 tests (회귀 없음)
```

### 체크리스트 B · T-020 검증

| # | 시나리오 | 검증 파일 | 판정 |
|---|---------|----------|------|
| 1 | 해외 지정가 매수 `amount/price = 1.9` → 1주, DB도 1 | `order-sizing.test.ts:46-49` | ✅ |
| 2 | 해외 지정가 매수 `amount/price = 0.79` → 0주 + 흔적 기록 | `order-sizing.test.ts:51-54` | ✅ |
| 3 | 국내 지정가 매수 `amount/price = 15.29` → 15주, DB도 15 | `order-sizing.test.ts:41-44` | ✅ |
| 4 | 매도(청산) 경로 절삭이 포지션 미남김 | `engine-exit-create-outcome.test.ts:197-225` | ✅ |
| 5 | 시장가 주문 경로 무회귀 | `order-sizing.test.ts:56-61` | ✅ |
| 6 | `entry-watcher` + `service.ts` 경로 동일 수량 | `order-sizing.test.ts:81-89` | ✅ |
| 7 | 0주 스킵 사후 집계 (로그·eval_funnel·trade_logs) | `service.ts:248-281` · `engine-exit-create-outcome.test.ts` | ✅ |

### High Risk Areas 검증 (Reviewer 지정)

| 영역 | 검증 내용 | 판정 |
|------|----------|------|
| `engine.ts` exit 루프 청산 경로 | `quantity_below_min` skip 1행, error 행 없음 (HIGH-1 해소) | ✅ |
| 진짜 실패 침묵 방지 | `errorCode` 없는 거부는 여전히 `exit_create_failed` 기록 | ✅ |
| `submittedQuantity` 의미 무변경 | T-019 판정 기준과 모순 없음 (함수 읽기만) | ✅ |
| T-018 H-4 회귀 | 소수점 갇힘 테스트 통과 | ✅ |

### 안전장치 검증

| 항목 | 판정 |
|------|------|
| `DRY_RUN` 회로 | ✅ |
| `KILL_SWITCH` 회로 | ✅ |
| 주문 한도 (`ORDER_MAX`/`DAILY_ORDER_MAX`) 약화 없음 | ✅ |
| `orders`/`trade_logs` 기록 | ✅ |
| Safety 레이어 우회 경로 제외 | ✅ |
| API 키 노출 방지 | ✅ |
| SQL 파라미터 바인딩 | ✅ |

### 결론

모든 검증 체크리스트 통과. 소수점 사이징이 정수화되고, 1주 미만은 0주로 명확히 스킵되며, 그 스킵이 로그·eval_funnel·trade_logs에 모두 기록되어 관측 가능합니다. exit-engine 경로의 정책 스킵이 거짓 경보 없이 정확하게 처리됩니다.

---

## 최종 요약 (Leader, 2026-08-11)

**무엇이 문제였나 —** 주식은 1주, 2주처럼 **정수로만** 사고팔 수 있는데, 우리 시스템은 "투자금 ÷ 주가"를 계산할 때 소수점 8자리까지 만들고 있었다(암호화폐 자매 프로젝트에서 넘어온 관례로 보인다). 그 소수점 수량이 그대로 주문서에 저장되고, 증권사로 보내기 **직전에야** 소수점을 잘라냈다. 결과는 두 가지 손해였다 — ① 1주가 안 되는 주문(예: 0.79주)은 잘라내면 **0주**가 되어 성립 자체가 불가능했고 ② 나머지는 **평균 16.8%, 최대 49.9%의 투자금이 조용히 빠진 채** 집행되면서 장부에는 원래 수량이 남아 사후에 알 방법이 없었다.

**착수 전 재현 확인 —** 지시대로 먼저 확인했다. "5월 16일 이후 소수점 주문이 없다"는 것은 **문제가 고쳐져서가 아니라 해외 주문 자체가 멎어 있었기 때문**이었다(6월 이후 해외 주문 0건). 소수점을 만드는 코드도, 그 코드를 타는 입력(수량이 비어 있는 지정가 시그널 — 8월에만 해외 36건·국내 62건 대기 중)도 그대로였다. 게다가 과거 79건의 실패 사유를 보니 증권사가 소수점을 거부한 건 **단 1건뿐**이고 대부분은 요청 과부하로 죽고 있었을 뿐인데, **그 과부하를 T-017이 방금 없앴다**. 즉 다음 주문이 나가는 순간 발화할 문제였다. 추가로 **국내 주문도 같은 위험**에 놓여 있음을 새로 발견했다 — 일일 주문 한도가 0에서 10%로 열리면서 국내 신규 매수 경로가 막 살아났기 때문이다.

**무엇을 했나 —** 수량을 계산하는 **바로 그 시점에** 정수로 확정한다. 그래서 주문서에 적힌 수량과 증권사가 실제로 받는 수량이 처음부터 같아진다. 1주가 안 되면 주문을 내지 않되 **절대 조용히 넘어가지 않는다** — 전용 코드(`quantity_below_min`), 관측 깔때기 항목, 감사기록, 로그 토큰에 동시에 남겨 나중에 몇 건이었는지 셀 수 있다. 특히 **매도(청산)가 스킵되면 알림을 보낸다** — 그건 "포지션이 안 닫혔다"는 뜻이기 때문이다. 안전 한도 검사가 쓰는 주문 금액은 **일부러 줄이지 않았다**(줄이면 한도가 느슨해진다).

**도중에 잡은 추가 결함 —** 감사관이 청산 경로에서 이 스킵이 "청산 시그널 생성 실패"라는 **거짓 경보를 함께 울린다**는 것을 발견했다. 손절이 정상적으로 스킵될 때마다 경보가 울리면 사람이 그 경보를 무시하게 되고, 결국 **진짜 손절 실패가 그 안에 묻힌다.** 특정 항목만 예외 처리하는 미봉책 대신 구조 자체를 고쳐, 앞으로 추가될 항목도 자동으로 올바르게 동작한다. 진짜 실패는 여전히 잡힌다.

**결과 —** 코드 검사 통과, 테스트 **93개 묶음 / 1411건 전부 통과**. 감사관 2라운드 **PASS**, QA **검증 통과**. **⚠️ 커밋하지 않았다** — 실거래 자금에 영향을 주는 변경이라 커밋·배포는 사용자 승인 후에만 진행한다.
