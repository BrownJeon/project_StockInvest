---
task-id: T-019
project: StockInvest
created: 2026-08-11
updated: 2026-08-11
status: done
review-round: 2
qa: passed
tags:
  - type/task
  - domain/safety
  - domain/exchanges
  - domain/reporting
aliases:
  - 부분체결이 완전체결로 오기록
  - settledStatus 부재 추론
  - 손익 장부 왜곡
  - executions 0행
related_tasks:
  - "[[T-018-order-sync-fail-closed]]"
  - "[[T-017-kis-rate-limit-throttle]]"
  - "[[T-020-fractional-order-quantity-sizing]]"
  - "[[T-014-favorites-ai-refresh-failure]]"
---

# T-019 · 부분체결 주문이 `filled` 로 오기록되어 손익 장부가 조용히 틀어진다

> 출처: [[T-018-order-sync-fail-closed]] reviewer 감사 H-5. board.md Backlog 최상단 원문 참조.

## 목표

**주문 상태가 "완전 체결"이라고 말할 때 그것이 실제로 참이게 만든다.**
그리고 그 상태를 소비하는 손익 리포트가 **주문 수량을 체결 수량으로 착각하지 않게** 한다.

---

## 문제 — 코드 실측

`src/lib/safety/order-sync.ts` 의 `settledStatus()` (508~538행):

```ts
if (activeReliable) {
  // 두 목록에 동시에 있다 = 일부 체결 + 잔량이 아직 브로커에서 작동 중
  return activeOrderIds.has(eid) ? 'partially_filled' : 'filled';
}
```

`activeReliable === true` 이고 미체결 목록에 **없으면 무조건 `filled`** 다.
**체결 수량(`filledQty`)을 이 분기에서는 쳐다보지도 않는다.**

이것은 [[T-018-order-sync-fail-closed|T-018]] 이 통째로 없애려 했던 **부재 추론**이
`cancelled` 판정에서만 제거되고 **`filled` 판정에는 그대로 남아 있는 것**이다.
T-018 §⑨ 는 "미체결 목록 신뢰 가능 + 그 안에 없다 → `filled` (신뢰할 수 있는 부재)"라고
적었는데, 그 명제가 참이려면 **"미체결 목록에서 사라지는 유일한 이유가 전량 체결"** 이어야
한다. 그렇지 않다.

### 반례 — 하필 T-018 이 "정상"이라고 분류한 바로 그 이벤트

**장 마감 시 브로커가 미체결 잔량을 자동 취소한다.** 이건 오류가 아니라 완전히 정상 동작이고,
T-018 H-4(B) 가 알림 문구를 "양성 오탐을 전제로" 쓴 이유이기도 하다.

| 시각 | 사건 | 미체결 목록 | 체결 목록 |
|---|---|---|---|
| 14:00 | 매도 지정가 10주 접수 | 있음(10주) | 없음 |
| 15:10 | 3주 체결 | 있음(잔량 7주) | 있음(3주) |
| 15:30 | **장 마감 — 브로커가 잔량 7주 자동 취소** | **없음** | 있음(3주) |
| 15:35 | order-sync 다음 회차 | 조회 성공·신뢰 가능 | eid 존재 |

→ `activeReliable=true`, `activeOrderIds.has(eid)=false` → **`filled`**.
DB 에는 "10주 매도 완전 체결"로 남는다. **실제로는 3주만 팔렸다.**

### 파급이 주문 상태에서 끝나지 않는다 — 손익 장부까지 간다

`src/lib/reports/trade-report.ts:158-172` 의 조회:

```sql
CAST(COALESCE(e.quantity, o.quantity) AS DECIMAL(36,18)) AS quantity
  FROM orders o LEFT JOIN executions e ON e.order_id = o.id
 WHERE o.status = 'filled'
```

`executions` 테이블이 **역사상 0행**(2026-08-11 실측)이므로 `COALESCE` 는 **항상**
`o.quantity`(=주문 수량)로 떨어진다. 즉 손익 계산기는 **"filled 인 주문은 전량 체결됐다"를
무조건 참으로 가정**한다.

위 반례에서: 10주가 팔린 것으로 계산되어
* 매도 수익 = `price × 10` (실제는 `× 3`)
* 재고 스택에서 10주 차감 (실제 잔고와 7주 어긋남)
* 그 어긋난 스택이 **이후 모든 매도의 원가**를 오염시킨다 — 1회성 오차가 아니라 **누적 오차**다

→ "얼마 벌었나"가 틀리게 나오고, 틀린 것을 알 방법이 없다.

> 📌 코드 실측 정정: `trade-report.ts` 의 재고 차감은 스택 top 부터 빼는 **후입선출(LIFO)** 이다
> (`stack[stack.length-1]`, 89~121행). board.md 원문의 "FIFO"는 부정확한 표현이다.
> 결함의 성격에는 영향이 없으나 문서는 정확해야 하므로 여기 적어 둔다.

---

## 현재 노출도 — 아직 0건이지만 **방아쇠는 이미 당겨져 있다**

2026-08-11 운영 DB 실측 (SELECT 만):

| 항목 | 값 |
|---|---|
| `syncPendingOrders` 대상 주문 | **0건** |
| 역대 `partially_filled` 주문 | **0건** |
| `executions` 행수 | **0행** |
| `orders.status` ENUM | `pending, accepted, partially_filled, filled, cancelled, rejected, failed, dry_run, blocked` |
| 안전 설정 | `safety_dry_run=false` · `safety_kill_switch=false` · `engine_enabled=true` · `autopilot_mode=assist` |
| 주문 한도 | `safety_order_max_pct=6` · `safety_daily_order_max_pct=10` (**과거의 0 → 10 으로 바뀜 = 국내 신규 매수 차단 해제됨**) |

**"현재 0건"은 안전의 근거가 아니라 시한의 근거다.**
킬스위치가 풀렸고, [[T-017-kis-rate-limit-throttle|T-017]] 이 주문을 죽이던 레이트리밋을
없앴고, 일일 한도가 0에서 10%로 열렸다. **부분체결이 한 건이라도 발생하는 순간부터
손익 장부가 조용히 틀어지기 시작하고, 그 오차는 되돌릴 수 없다**(과거 체결 수량을 사후에
복원할 방법이 없다).

---

## 역할별 지시사항

### Developer

#### 요구 D-1 · `filled` 는 증거가 뒷받침될 때만 쓴다

`settledStatus()` 의 `activeReliable && !activeOrderIds.has(eid)` 분기에서
**체결 수량 증거를 확인**해야 한다.

* `filledQty` 를 알고 있고 `filledQty` 가 송신 수량보다 **작으면** → 전량 체결이 아니다.
  `filled` 로 기록해서는 안 된다.
* 비교 기준은 **반드시 `submittedQuantity(market, order.quantity)`** 다
  (`src/lib/exchanges/order-quantity.ts`). 브로커는 자기가 **받은** 수량 이상을 채울 수 없다.
  T-018 H-4 가 이 함수를 만든 이유가 정확히 이것이므로 **비교 규칙을 다시 유도하지 마라.**
* `filledQty` 가 **없으면**(체결 목록 파싱 실패 등) 수량으로 반박할 근거가 없다 →
  기존 동작(`filled`) 유지. 단, 이 경우가 조용하지 않게 흔적을 남길지 판단하고 근거를 적어라.
* 부동소수 비교는 `submittedQuantity` 가 정수를 돌려주더라도 **허용오차(epsilon)** 를 둬라.
  `trade-report.ts` 가 이미 `1e-12` 를 쓰고 있으니 그 관례를 따르는 것을 검토하라.

#### 요구 D-2 · 그 결과 상태는 **종결 상태**여야 한다

⚠️ **이게 이 작업에서 가장 위험한 함정이다.**

`syncPendingOrders` 의 조회 대상은 `pending`/`accepted`/`partially_filled` + `exchange_order_id`
가 있는 주문이다. 즉 **`partially_filled` 은 비종결 상태**이고, 잔량이 이미 사라진 주문을
`partially_filled` 로 두면 그 주문은 **5분마다 영원히 KIS 를 조회한다** —
[[T-018-order-sync-fail-closed|T-018]] H-4(B) 가 없앤 바로 그 덫을 다른 입구로 재현하게 된다.
`partially_filled` 은 "잔량이 아직 살아 있을 때"만 의미가 있다.

선택지를 **직접 판단**하되, 판단 근거를 task 파일에 남겨라:

| 안 | 내용 | 유의점 |
|---|---|---|
| (a) `executions` 에 실제 체결 수량을 기록하고 상태는 `filled` | `trade-report` 의 `COALESCE(e.quantity, o.quantity)` 가 자동으로 참값을 집는다 — **손익 왜곡의 근본 원인을 직접 제거**한다 | 멱등성 필수(매 회차 중복 INSERT 금지). `executions.price`·`quantity`·`fee` 는 `NOT NULL` 이므로 값이 없을 때 무엇을 넣을지 정해야 한다. `fetchOrderRows` 가 `GROUP BY o.id` 에서 `e.price`/`e.quantity` 를 비집계로 뽑으므로 **주문당 행이 여럿이면 임의 행이 선택된다** — 이 제약을 반드시 확인하고 설계하라 |
| (b) `orders.status` ENUM 에 종결형 부분체결 값을 추가 | 상태 의미가 명확해진다 | **스키마 변경**이다. `src/lib/db.ts` 의 부팅 idempotent DDL 로만 가능하고, 이 값을 읽는 모든 소비자(UI·리포트·엔진)를 전수 조사해야 한다. 폭발반경이 크다 |
| (c) `filled` 로 두되 흔적만 남긴다 | 최소 변경 | **손익 왜곡이 그대로 남는다.** 이 작업의 목표를 달성하지 못한다 — 단독으로는 불충분 |

> Leader 의견(구속력 없음, 판단은 developer 몫): **(a) 가 board.md 가 지적한 손해(“executions
> 0행이라 trade-report 가 주문수량을 체결수량으로 계산한다”)를 직접 없애는 유일한 안**으로 보인다.
> (b) 는 폭발반경 대비 이득이 불확실하니 **하려면 반드시 착수 전에 Leader 에게 근거를 보고**하라.
> 어떤 안을 고르든 **"완전 체결이 아닌데 완전 체결이라고 적는 일"이 남아 있으면 실패**다.

#### 요구 D-3 · 조용히 넘어가지 마라

부분체결 종결이 감지되면 **반드시 흔적**을 남겨라. 이 프로젝트가 T-007·T-012·T-014·T-018
내내 없애 온 것이 바로 침묵이다.

* grep 가능한 로그 토큰 (T-018 의 `ORDER_SYNC_UNRECONCILED` 관례를 따를 것)
* `trade_logs` 감사 기록 (`orders`/`trade_logs` 에 남긴다는 CLAUDE.md "실매매 원칙" 3항)
* 알림은 **정상 이벤트**임을 전제로 문구를 쓸 것 — 장마감 잔량 취소는 오류가 아니다.
  T-018 H-4(B) 가 같은 이유로 문구를 조정했고 테스트가 그 문구를 고정하고 있다.
  기존 알림 키를 재사용하면 `sendAlertThrottled` 가 **키 단위로 창을 잡아 한쪽이 다른 쪽을
  조용히 억누른다** — 필요하면 새 키를 쓰되 알림 피로를 늘리지 않을 근거를 적어라.
* `OrderSyncResult` 반환값에 드러낼지 판단하라 (T-018 이 만든 `unreconciled`/`complete` 계약과
  의미가 겹치지 않게 — 이건 "판정 못 함"이 아니라 **"판정했고 결과가 부분체결 종결"** 이다).

#### 요구 D-4 · `market` 주문 경로를 깨지 마라

`settledStatus` 의 첫 줄 `if (order.type === 'market') return 'filled'` 는 의도된 동작이다
(시장가는 미체결 목록에 원래 나타나지 않으므로 그 부재가 무정보). 시장가에 수량 검증을 넣을지는
**판단해서 근거를 적어라** — 시장가 부분체결은 실재하지만, 여기서 `filled` 를 막으면 시장가
주문이 종결되지 못할 수 있다.

#### 제약 (절대)

* `npm run typecheck` / `npm test` **만** 실행. `npm run build`·`npm install`·`npm run dev` **금지**
  (이 경로가 운영 배포 경로다 — build 가 pm2 가 서빙 중인 `.next` 를 덮어쓴다). 새 의존성 금지.
* **git commit / push / stash 금지.** pm2 조작·재배포 금지. DB 수동 쓰기 금지(SELECT 만).
  `safety_kill_switch`·`exit_engine_enabled` 등 안전 설정 변경 금지.
* 모든 주문 송신은 `src/lib/safety/dry-run.ts` 의 `submitOrder()` 경유 — safety 레이어 우회 금지.
* **담당 파일**(T-020 과 겹치지 않게): `src/lib/safety/order-sync.ts`,
  `src/lib/reports/trade-report.ts`(필요 시), `src/lib/db.ts`(스키마 필요 시·사전 보고),
  `src/lib/safety/__tests__/*`, `src/lib/reports/__tests__/*`.
  **`src/lib/exchanges/order-quantity.ts` 는 읽기만 하고 수정하지 마라** — T-020 담당 영역이다.

### Reviewer (독립 감사)

* D-2 의 종결성이 실제로 성립하는가 — 새 상태의 주문이 `syncPendingOrders` 조회 대상에 다시
  걸리지 않는지 **조회 SQL 을 직접 확인**할 것. 무한 재조회 = T-018 H-4(B) 재현.
* `executions` 를 쓰기로 했다면: **멱등성**(재실행·재배포·동시 실행), `NOT NULL` 컬럼의 값 결정,
  `fetchOrderRows` 의 `GROUP BY o.id` 하에서 주문당 복수 행이 생길 때 어떤 행이 선택되는지,
  `SUM(e.fee)` 중복 합산 가능성, 그리고 **과거 데이터(executions 0행)와의 혼재**가 리포트를
  깨뜨리지 않는지.
* 이번 변경이 T-018 이 세운 계약(`complete`·`skipped`·`unreconciled`·`too_fresh` 의미)을
  훼손하지 않는지.
* 새 침묵이 생기지 않았는지, 반대로 **정상 이벤트에 과도한 경보**를 만들지 않았는지(둘 다 실패).
* 안전장치 우회 경로가 생기지 않았는지.

### QA

* `npm run typecheck`, `npm test` 를 **직접 실행**하고 원문 출력을 붙일 것.
* 시나리오 검증 (테스트 코드로):
  1. 부분체결 후 잔량이 미체결 목록에 **있음** → `partially_filled` (기존 동작 유지)
  2. 부분체결 후 잔량이 **사라짐**(장마감 자동취소) → **`filled` 로 기록되지 않는다** ← 핵심 회귀
  3. 전량 체결 후 목록에서 사라짐 → `filled` (정상 판정이 죽지 않았는지)
  4. `market` 주문 → 기존 동작 유지
  5. 소수점 수량 주문(해외)에서 `submittedQuantity` 기준 비교가 성립하는지 (T-018 H-4 무회귀)
  6. `filledQty` 미상일 때 동작이 정의되어 있는지
  7. 손익 리포트가 부분체결 종결 주문을 **실제 체결 수량**으로 계산하는지
* T-018 이 남긴 회귀 테스트 전부 통과 여부(88 suites / 1341 tests 기준선 대비 감소 없음).

---

## 관련 과거 이력 요약

* [[T-018-order-sync-fail-closed]] — 이 결함의 직접 출처. `cancelled` 의 부재 추론은 없앴으나
  `filled` 의 부재 추론은 남겼다. §⑨ 부분체결 규칙표와 `submittedQuantity` 도입 배경을 반드시 읽을 것.
* [[T-017-kis-rate-limit-throttle]] — 주문을 억누르던 레이트리밋을 제거했다. **이 결함이
  잠재에서 활성으로 바뀌는 계기**다. KIS 호출 수를 늘리는 방향의 수정은 T-017 유량 예산과 충돌한다.
* [[T-014-favorites-ai-refresh-failure]] — "실패를 빈 결과로 둔갑시키지 않는다"는 계약의 원형.
* [[T-020-fractional-order-quantity-sizing]] — 자매 결함. 수량 비교 기준(`submittedQuantity`)을
  공유하므로 두 작업의 결론이 서로 모순되지 않아야 한다.

---

## Developer

**작업일**: 2026-08-11 · **상태**: 구현 완료(미커밋 — 사용자 승인 대기)

### D-1 · `filled` 는 증거가 뒷받침될 때만 쓴다 — 구현

`settledStatus()` 를 `settleDecision()` 으로 확장했다(`src/lib/safety/order-sync.ts`). 반환형이
`'filled' | 'partially_filled'` 에서 판정 + 증거 묶음으로 바뀐 이유는, 호출부가 **"종결됐지만
전량이 아니다"** 를 알아야 `executions` 를 쓸 수 있기 때문이다.

```ts
interface SettleDecision {
  status: 'filled' | 'partially_filled';
  partial?: { orderedQty; filledQty; price; ts };          // 부분체결 종결
  unverified?: 'fill_qty_unknown' | 'ordered_qty_unknown';  // 수량으로 검증 못 함
}
```

* 비교 기준은 지시대로 **`submittedQuantity(market, order.quantity)`** — 규칙을 재유도하지 않았다.
* 허용오차 `QTY_EPSILON = 1e-12` — `trade-report.ts` 의 LIFO 차감이 이미 쓰는 값과 맞췄다.
  기준이 모듈마다 다르면 "리포트는 전량인데 동기화는 부분체결" 같은 모순이 생긴다.
* `filledQty` 미상(파싱 실패·0) / `orders.quantity` NULL → **기존 동작(`filled`) 유지**하되
  사유를 나눠 집계(`completenessUnverified`)하고 `ORDER_SYNC_FILL_UNVERIFIED` 토큰으로 로그에
  남긴다. 알림까지는 올리지 않았다 — 조치할 대상이 없고 빈도가 낮아 경보로는 정보가치가 없다.
* 체결 증거 맵을 `Map<string, number>`(수량만) → `Map<string, FillEvidence>`(수량·가격·시각)로
  바꿨다. `executions.price` 가 `NOT NULL` 이라 수량만으로는 행을 만들 수 없기 때문.
  **최대 수량을 보고한 행**의 가격·시각을 따라간다(누적 표현에서 그 행이 최신 누적 + `avg_prvs`).

### D-2 · 선택은 **(a) `executions` 기록 + 상태 `filled`** — 근거

(b)·(c) 를 버린 이유와 (a) 를 고른 이유를 사실 관계로 적는다.

| 안 | 판단 | 근거 |
|---|---|---|
| (a) executions 기록 | **채택** | `trade-report` 의 `COALESCE(e.quantity, o.quantity)` 가 자동으로 참값을 집는다 = **손익 왜곡의 원인을 코드 한 줄 추가 없이 제거**한다. 상태는 `filled` 라 종결성이 보장돼 재조회 덫이 생기지 않는다 |
| (b) ENUM 종결형 추가 | 기각 | 스키마 변경 + 소비자 전수조사(UI·리포트·엔진·쿨다운·`ACTIVE_SIGNAL_STATUSES` 계열). **폭발반경 대비 이득이 (a) 와 같다** — (b) 를 해도 손익을 고치려면 결국 수량을 어딘가 기록해야 한다. 즉 (b)는 (a)의 대체재가 아니라 추가 비용이다 |
| (c) 흔적만 | 기각 | 목표(손익 장부 정확성) 미달성. task 파일이 이미 "단독으로는 불충분"이라고 적었고 동의한다 |

**종결성 확인** — `syncPendingOrders` 의 조회 조건은
`status IN ('pending','accepted','partially_filled')` 이다. (a)의 결과 상태는 `filled` 이므로
**다음 회차 조회 대상에서 빠진다.** T-018 H-4(B) 의 무한 재조회 덫은 재현되지 않는다.

**(a) 를 안전하게 만들기 위해 지킨 제약** (task 파일 D-2 (a) 유의점 + reviewer 항목 대응):

1. **주문당 행은 정확히 하나 — 개별 체결이 아니라 누적 1행.**
   `fetchOrderRows` 가 `GROUP BY o.id` 아래에서 `e.price`/`e.quantity` 를 **비집계로** 뽑으므로
   주문당 행이 여럿이면 임의 행이 선택된다. 누적 1행이면 임의 선택이 일어나도 **항상 같은
   참값**이 나온다. 이 제약이 아래 2·3의 설계를 강제했다.
2. **멱등** — 쓰기 전에 `SELECT id FROM executions WHERE order_id=? LIMIT 1` 로 확인하고,
   있으면 쓰지 않는다(덮어쓰지도 않는다 — 기존 기록이 더 정확할 수 있다).
   경합으로 동일 행이 두 개 생기더라도 값이 같아 임의 선택이 무해하고, `fee=0` 이라
   `SUM(e.fee)` 중복 합산도 0 이다. 즉 **멱등이 깨져도 리포트가 틀리지 않는** 구조다.
3. **`NOT NULL` 컬럼 값 결정**
   * `quantity` = 확인된 체결 수량 (이 경로에 진입한 조건 자체가 "수량을 안다")
   * `price` = 브로커 체결단가 → 없으면 `orders.price`(지정가) 폴백 → **둘 다 없으면 행을 쓰지
     않는다.** `e.price` 에 0 을 박으면 `COALESCE(e.price, o.price)` 가 0 을 집어
     `computeLifoPnl` 의 "가격 없으면 `amount_krw/quantity`" 폴백까지 무력화된다 —
     **안 쓰는 것보다 나쁘다.** 이 경우 `executionRecorded: false` + 전용 로그 토큰
     `ORDER_SYNC_PARTIAL_UNRECORDED` 로 "이 주문의 손익은 여전히 틀리다"를 드러낸다
   * `fee` = **0**. 모르는 수수료에 추정치를 넣으면 손익이 조용히 틀어진다. 0 은
     `executions` 가 아예 없던 현재 동작(`COALESCE(SUM(e.fee),0)`)과 **정확히 같다**
   * `executed_at` = 브로커 체결 시각(없으면 NOW()). LIFO 가 `ts ASC` 로 정렬하므로 더 정확하다
4. **쓰기 순서 = executions → status.** 반대로 하면 `filled` 로 바뀌는 순간 조회 대상에서
   사라지고, 그 사이에 죽으면 **실제 체결 수량을 복원할 방법이 영원히 없다.** 지금 순서로는
   executions 를 쓰고 죽어도 다음 회차가 같은 결론에 다시 도달하고 멱등 가드가 받는다.
5. **executions INSERT 실패 시 상태를 넘기지 않는다** — 예외를 per-order catch 로 올려
   이번 회차 미판정으로 처리하고 다음 회차에 재시도한다(= 조용한 유실 대신 시끄러운 보류).
6. **결과 목록·감사기록은 상태 전이가 성립한 뒤에** push 한다 — UPDATE 가 던지면 "종결됐다"고
   보고하지 않는다.

**과거 데이터와의 혼재** — `executions` 는 현재 0행이므로 이 코드가 쓰기 전까지 리포트 동작이
**바이트 단위로 동일**하다. 새 행이 생긴 주문만 참값 경로로 들어간다.

### D-2 부수 — `trade-report` 의 `amount_krw` 도 체결 비율로 맞췄다

수량만 참값으로 바꾸면 **한 행 안에서 모순**이 남는다(수량 3주 / 금액 10주치).
`buysAmountKRW`·`sellsAmountKRW`·`headerPnlKRW`(= sells − buys)가 그 금액을 쓰고,
`computeLifoPnl` 도 `price` 가 없을 때 `amount_krw` 로 폴백한다.

```sql
CASE WHEN e.quantity IS NOT NULL AND o.quantity IS NOT NULL AND o.quantity > 0
     THEN COALESCE(o.amount_krw,0) * (e.quantity / o.quantity)
     ELSE COALESCE(o.amount_krw,0) END
```

통화 중립이라 해외(USD 단가) 주문에도 안전하다 — `e.price * e.quantity` 로 재계산하면 USD 값이
KRW 컬럼에 들어가므로 그 방법은 쓸 수 없다. 체결 기록이 없는 주문은 `ELSE` 로 떨어져 **기존과
완전히 동일**하다.

### D-3 · 흔적 (조용히 넘어가지 않는다)

| 채널 | 내용 |
|---|---|
| 로그 토큰 | `ORDER_SYNC_PARTIAL_SETTLED`(요약+건별) · `ORDER_SYNC_PARTIAL_UNRECORDED`(기록 실패분) · `ORDER_SYNC_FILL_UNVERIFIED`(수량 미검증). T-018 의 `ORDER_SYNC_UNRECONCILED` 관례를 따랐다. 로그는 **스로틀 없이 매 회차** |
| `trade_logs` | `event='partial_fill_settled'`, payload 에 `orderedQty`·`filledQty`·`shortfallQty`·`price`·`side`·`market`. 감사 기록 실패는 상태 전이를 되돌리지 않고 `errors[]` 로 드러낸다(이미 쓰인 전이를 되돌리면 다음 회차 중복 판정을 유발) |
| `OrderSyncResult` | `partialSettlements: PartialSettlement[]` + `completenessUnverified: number`. **`unreconciled` 와 의미가 겹치지 않는다** — 저건 "판정 못 함", 이건 "판정했고 결과가 부분체결 종결". 그래서 `complete` 를 깎지 않고 정체 시계(`unreconciledSince`)에도 올리지 않는다 |
| cron 요약 | `strategy-eval/route.ts` 의 한 줄 로그에 `partialSettled=N/unrecorded=M`·`fillUnverified=K` 추가. `complete` 를 깎지 않으므로 여기 싣지 않으면 회차 로그만 봐서는 안 보인다 |
| 알림 | 아래 참조 |

**알림 — 키를 매수/매도로 나눴다.** `sendAlertThrottled` 는 키 단위로 창을 잡으므로 한 키에
묶으면 흔한 쪽(매수)이 드문 쪽(매도)을 조용히 억누른다 — T-018 H-4(B) 가 `order-sync:coverage`
와 `order-sync:partial-unconfirmed` 를 분리한 것과 같은 이유다. 기존 키는 **재사용하지 않았다**.

* `order-sync:partial-settled-sell` — **포지션이 다 닫히지 않았다.** 손절이었다면 보호가 절반만
  걸린 상태다. 문구에 "포지션이 그대로 남아 있습니다"를 명시
* `order-sync:partial-settled-buy` — 자본이 덜 투입됐다. 손실 위험은 없다
* 둘 다 `warning` · 창 **6시간**. 장마감 잔량 자동취소는 **정상 동작**이라 critical 로 울리면
  사람이 무시하기 시작한다(T-018 H-4(B) 가 문구를 조정한 이유). 문구는 "오류 통보가 아니라
  확인 요청"임을 명시. 부분체결 종결은 대부분 장 마감에 몰리므로 6시간 창이면 하루치가 한 통에 묶인다

### D-4 · `market` 주문에는 수량 검증을 **넣지 않았다** — 근거

넣지 않은 것이 안전한 쪽이다. 이 함수가 "부분체결로 **종결**됐다"고 말할 수 있는 근거는 오직
**"잔량이 신뢰할 수 있는 미체결 목록에서 사라졌다"** 하나인데, 시장가 주문은 그 목록에 **원래
나타나지 않으므로** 그 근거를 얻을 방법이 구조적으로 없다.

수량만 보고 종결시키면, 5분 주기 동기화가 **체결 진행 중인 스냅샷**을 잡았을 때 그 중간값이
`executions` 에 영구히 박히고 상태는 종결된다 — 드문 과대계상을 없애려다 **매 회차의
과소계상**을 만드는 셈이다. 시장가 부분체결은 실재하지만, 잔량 확인 수단이 생긴 뒤에 다뤄야
한다(아래 §남긴 것).

### 변경 파일

| 구분 | 경로 |
|---|---|
| 수정 | `src/lib/safety/order-sync.ts` |
| 수정 | `src/lib/reports/trade-report.ts` |
| 수정 | `src/app/api/cron/strategy-eval/route.ts` (요약 로그 1곳) |
| 수정 | `src/app/api/cron/__tests__/strategy-eval-lane.test.ts` (`syncPendingOrders` mock 이 새 계약 필드를 갖도록) |
| 신규 | `src/lib/safety/__tests__/order-sync-partial-settled.test.ts` (25 tests) |
| 신규 | `src/lib/reports/__tests__/trade-report-partial-fill.test.ts` (5 tests) |

`src/lib/db.ts` 는 **건드리지 않았다** — 스키마 변경 없음.
`src/lib/exchanges/order-quantity.ts` 는 **읽기만** 했다(T-020 영역).

### 검증

`npm run typecheck` 통과(exit 0). `npm test` → **92 suites / 1396 tests 전부 통과**
(기준선 88/1341 대비 +4 suites · +55 tests, 감소 없음).

### 남긴 것 / Leader 판단 요청

1. **시장가 주문의 부분체결은 여전히 완전 체결로 기록된다** (D-4 근거대로 의도적).
   해소하려면 시장가 잔량을 확인할 수단(주문번호 단건 조회 등)이 필요하다 → **T-021 후보**.
2. **executions INSERT 실패 시의 `UnreconciledReason` 라벨이 부정확하다.**
   T-018 이 만든 per-order catch 로 흘러가 `both_queries_failed` 가 붙는데, 실제로는 두 조회가
   **성공**했고 쓰기가 실패한 것이다(detail 문자열에는 진실이 적힌다). 정확히 하려면
   `'write_failed'` 같은 값을 `UnreconciledReason` 에 추가해야 하는데, **T-018 이 세운 계약
   표면을 넓히는 일**이라 임의로 하지 않았다. UPDATE 실패에 대해서도 원래 같은 문제가 있으므로
   기존 동작과 일관되기는 하다. → Leader 판단 요청.
3. `orders.amount_krw` 는 여전히 **주문 금액**이다(체결 기준 아님). 리포트 층에서 체결 비율로
   보정했으므로 손익은 맞지만, `orders` 행 자체는 "얼마를 집행했는가"를 말하지 않는다.
   T-020 D-3 의 `submitted_quantity` 논의와 같은 계열이다.

## Reviewer

**작업일**: 2026-08-11 · **판정**: 이 task 단독으로는 결함 없음 — 결론은 T-020 Reviewer 절 참조
(합산 판정: **PASS**). `git -c core.fileMode=false diff`(HEAD=`3d4197e`, 미커밋) 로 실측.
`npm run typecheck` 재실행 exit 0, `npm test` 재실행 **92 suites / 1396 tests 전부 통과** —
Developer 보고와 동일. Developer 절의 근거를 신뢰하지 않고 직접 SQL·타입·테스트를 재검증했다.

### 지정 감사 항목 대응

**① D-2 종결성 — `syncPendingOrders` 재조회 대상에서 실제로 빠지는가.**
`order-sync.ts:280-285` 조회 SQL 을 직접 확인:
```sql
SELECT id, exchange_order_id, symbol, side, type, status, price, quantity, created_at
FROM orders
WHERE status IN ('pending','accepted','partially_filled')
  AND exchange_order_id IS NOT NULL
```
부분체결 종결 경로(`settleDecision` 의 `decision.partial` 분기)는 `decision.status` 를 항상
`'filled'` 로 반환한다(680-736행) — `partially_filled` 로 두는 코드 경로가 **없다**. 그리고
`SET_STATUS_SQL.filled` 로 실제 UPDATE 가 나간 뒤에야(415-418행) 다음 회차 조회 시점이 오므로,
이 주문은 다음 회차 `WHERE status IN (...)` 에 걸리지 않는다. **T-018 H-4(B) 재현 없음 — 확인.**

**② `executions` 쓰기 위험 — 항목별 확인**

| 확인 대상 | 실측 결과 |
|---|---|
| 멱등성(재실행) | `recordSettledFill`(766-803행)이 INSERT 전 `SELECT id FROM executions WHERE order_id=? LIMIT 1` 로 존재 확인 후 스킵. **순차 재실행에는 안전** — `order-sync-partial-settled.test.ts:387` "멱등 — 이미 체결 기록이 있으면 두 번째 행을 만들지 않는다" 로 고정돼 있음, 직접 읽고 로직과 일치함을 확인 |
| 멱등성(진짜 동시 실행 race) | ⚠️ **SELECT→INSERT 가 원자적이지 않고 `executions.order_id` 에 UNIQUE 제약이 없다**(`db.ts:251-261` 스키마 직접 확인 — `idx_order`는 비고유 INDEX). 두 프로세스가 동시에 이 함수에 진입하면 둘 다 SELECT 에서 "없음"을 보고 각자 INSERT할 수 있어 **행이 2개 생길 수 있다**. Developer 의 완화 논리(같은 주문·비슷한 시점이므로 값이 같을 것이므로 무해)는 **대체로 타당**하지만 100% 보장은 아니다 — 두 프로세스가 서로 다른 시점에 `getCompletedOrders` 를 호출했다면 브로커 응답이 갈릴 이론적 여지가 있다(예: 그 사이 추가 체결). 다만 실제 동시성 노출은 낮다 — `cron-runner.sh`(37-70행)는 curl 을 순차 blocking 호출하는 단일 while 루프이므로 정상 운영에서는 겹치지 않는다. 겹칠 수 있는 시나리오는 수동 강제 트리거(`force=true`)가 cron 루프와 우연히 동시 실행되거나 pm2 재배포 중 이전 요청이 아직 처리 중일 때 정도로 국한된다. → **MEDIUM**: `ALTER TABLE executions ADD UNIQUE KEY uq_order_id (order_id)` 를 db.ts idempotent DDL 에 추가해 방어심도를 더할 것을 권고하나, 현재 노출도와 developer 의 완화 설계(값이 같으면 무해, `fee=0`)를 고려하면 즉시 조치가 필수는 아니다 |
| `GROUP BY o.id` 비집계 선택 | `trade-report.ts:173-180` 확인 — `e.price`/`e.quantity` 가 비집계 상태로 SELECT 된다. 이 패턴은 **이번 diff 이전부터 존재**(diff 는 `amount_krw` CASE 문만 추가, `price`/`quantity` COALESCE 는 기존 코드) — MariaDB 기본 `sql_mode` 는 `ONLY_FULL_GROUP_BY` 를 포함하지 않으므로(db.ts 에 별도 sql_mode 설정 없음) 쿼리 자체는 정상 동작한다. 임의 선택 문제는 "주문당 정확히 1행" 불변식(위 멱등성 확인)이 지켜지는 한 무해 — 확인 |
| `SUM(e.fee)` 중복 | `fee` 컬럼에 항상 `0` 을 쓰므로(`recordSettledFill:792-794`) 설령 멱등이 깨져 행이 2개 생겨도 `SUM(e.fee)` 는 0 그대로 — 확인 |
| 과거 데이터(0행) 혼재 | `trade-report.ts:175-177` 의 `CASE WHEN e.quantity IS NOT NULL AND o.quantity IS NOT NULL AND o.quantity > 0` 조건이 `executions` 가 없는 행에서는 거짓이 되어 `ELSE COALESCE(o.amount_krw,0)` 로 떨어진다 — 기존 쿼리와 바이트 단위로 동일한 결과. 신규 테스트 `trade-report-partial-fill.test.ts` 가 이 SQL 패턴을 문자열 매칭으로 고정(38-55행). 다만 "과거 executions-null 행과 신규 executions-non-null 행이 **같은 리포트 범위 안에 섞였을 때**"를 하나의 결과셋으로 도는 통합 테스트는 없다 — CASE 문 자체가 행 단위로 독립 평가되므로 실질 위험은 낮으나, 테스트 커버리지 갭으로 기록해 둔다 (LOW) |
| FK 제약 | `db.ts:260` `CONSTRAINT fk_exec_order FOREIGN KEY (order_id) REFERENCES orders(id)` — `order.id` 는 이미 존재하는 행이므로 위반 가능성 없음. 확인 |
| `amount_krw` 축소가 다른 소비자에 미치는 영향 | `buysAmountKRW`/`sellsAmountKRW`/`headerPnlKRW`/`computeLifoPnl` 폴백 전부 확인 — 축소된 값을 일관되게 사용하고 통화 중립(비율 방식)이라 해외 USD 표시가로도 안전하다. `fetchSignalCandidates()`(482행~)의 별도 손익 집계(`sell_amount_krw` 조인, `o.amount_krw` 직접 사용, 539-571행)는 **이번 변경의 영향을 받지 않는다** — `orders.amount_krw` 원본 자체는 손대지 않았으므로(D-1 판단대로) 정합 |

**③ T-018 계약 훼손 여부** — `complete`/`skipped`/`unreconciled`/`too_fresh` 의미 재확인: `partialSettlements`/`completenessUnverified` 는 별도 필드로 신설돼 `complete` 계산(524-527행, `too_fresh` 제외 필터)에 관여하지 않는다. 훼손 없음 — 확인.

**④ 새 침묵 / 과다 경보** — 알림 키 분리(매수/매도, `partial-settled-sell`/`-buy`), `executions` 미기록 시 `ORDER_SYNC_PARTIAL_UNRECORDED` 별도 토큰, `fill_qty_unknown`/`ordered_qty_unknown` 은 알림 없이 로그만(빈도 낮고 조치 대상 없다는 근거가 task 파일 D-3 요구와 일치) — 설계대로 동작함을 코드로 확인. 새 침묵도 과다 경보도 발견하지 못했다.

### 발견하지 못한 것 (명시)

- 안전장치 우회 경로 없음 — 모든 쓰기가 `syncPendingOrders` 내부에 국한되고 `submitOrder` 경유
  원칙과 무관(이 함수는 송신이 아니라 사후 판정).
- `market` 주문 수량 미검증 유지(D-4) — task 요구·근거와 일치, 별도 결함 아님.
- T-018 회귀(§⑨ 규칙표·H-4 소수점 갇힘) — `order-sync-partial-settled.test.ts:306,336` 이
  명시적으로 재확인하고 있음을 직접 읽고 검증.

### 종합

이 task 자체(`order-sync.ts`/`trade-report.ts`)에는 **HIGH 이상 결함 없음**. 유일한 이슈는
T-020 이 건드린 `engine.ts` 의 exit 경로에서 발견됐다(아래 T-020 Reviewer 절 HIGH-1) — 두 task
가 담당 파일을 나눴어도 감사는 합쳐서 본다는 지침에 따라 여기 교차 링크만 남긴다.
자세한 내용은 [[T-020-fractional-order-quantity-sizing]] Reviewer 절 참조.

### 라운드 2 (Reviewer MEDIUM-1 · LOW-1 반영) — 2026-08-11

#### 🟡 MEDIUM-1 · `executions` 동시 실행 멱등성 → **(ii) 현행 유지 + 사후 탐지**를 선택

Leader 지시대로 `UNIQUE KEY (order_id)` 는 **추가하지 않았다**(장래의 "체결 건별 다행" 설계를
영구 봉쇄하므로). (i) 스키마 변경 없는 원자성 확보도 검토했으나 **하지 않기로 판단**했다.

| 검토안 | 판단 근거 |
|---|---|
| `INSERT … SELECT … WHERE NOT EXISTS` | ❌ UNIQUE 인덱스가 없으면 두 트랜잭션이 모두 "없음"을 보고 각자 INSERT 할 수 있다. 갭 락이 막아 주는지는 **격리수준·binlog 형식에 좌우**돼 코드에 "원자적이다"라고 쓸 수 없다. **보장 못 하는 것을 보장한다고 적는 것 자체가** 이 프로젝트가 없애 온 침묵의 한 형태다 |
| `SELECT … FOR UPDATE` (orders 행) | ❌ Leader 가 경고한 바로 그 위험. 5분 주기 cron 이 **주문 경로가 쓰는 `orders` 행에 배타 락**을 잡는다. `submitOrder` 의 상태 UPDATE 와 경합할 수 있다 — 막으려는 사고(노출도 낮음)보다 만드는 위험이 크다 |
| `GET_LOCK()` 명명 락 | ❌ 커넥션 스코프 락인데 풀(`connectionLimit: 10`)에서 획득·해제 커넥션이 같다는 보장이 없다. 전용 커넥션을 잡아야 하고 누수되면 **이후 회차가 통째로 막힌다** — 중복 행 하나보다 나쁜 실패 모드다 |

→ **선택: (ii) 현행 SELECT-then-INSERT 유지.** 다만 "조용히 넘어감 금지"를 문서로만 지키지
않고 **런타임 탐지기**를 넣었다 — 이게 (ii) 를 고르면서 만든 유일한 코드 변경이다.

**`detectDuplicateExecutions()`** — INSERT 직후 `SELECT COUNT(*) FROM executions WHERE order_id=?`.
`> 1` 이면 `ORDER_SYNC_EXEC_DUPLICATE` 토큰으로 `console.error` + `PartialSettlement.note` 에
실어 보낸다. 경합이 나면 **나중에 검사하는 쪽이 반드시 2를 보므로 탐지는 실질적으로 확실**하다.
비용은 부분체결 종결 1건당 SELECT 한 번 — 이 경로 자체가 드물어 무시할 만하다. 락을 전혀
쓰지 않으므로 새 경합도 만들지 않는다. 탐지 SELECT 자체가 실패하면 **삼킨다** — 진단이지
판정이 아니라서, 여기서 예외를 올리면 이미 성공한 기록·상태 전이를 미판정으로 되돌려
다음 회차 중복 판정을 유발한다.

부수: `reportPartialSettlements` 의 건별 로그가 `executionRecorded === true` 여도 `note` 를
출력하도록 고쳤다. 안 그러면 **기록에 성공한 케이스의 탐지 결과가 로그에서 사라진다.**

**노출 조건·피해·승격 트리거**를 `order-sync.ts` §동시성 주석에 전부 적었다. 요약:
- 노출: `cron-runner.sh` 가 curl 순차 blocking 단일 루프라 정상 운영에서는 겹치지 않는다.
  겹치려면 (a) 수동 강제 트리거가 cron 과 우연히 동시 실행, (b) pm2 재배포 중 이전 요청 잔류.
- 피해: 두 행의 값은 통상 동일하고 `fee=0` 이라 `SUM(e.fee)` 중복 합산이 0. 이론적 잔여
  위험은 두 프로세스가 서로 다른 시점에 `getCompletedOrders` 를 호출해 그 사이 추가 체결이
  반영된 경우뿐(qty/price 가 갈릴 여지).
- **승격 트리거: `ORDER_SYNC_EXEC_DUPLICATE` 가 한 번이라도 나타나면** "노출도 낮음" 전제가
  깨진 것이다. 그때는 `executions` 를 체결 건별 다행으로 확정하고
  `(order_id, executed_at, price, quantity)` 자연키 기준 중복 제거로 넘어간다.

> **Leader 께 — 백로그 이관용 문구**
>
> **T-02x · `executions` 를 "체결 건별 다행"으로 확정한다**
> 현재 order-sync 는 부분체결 종결 시 주문당 **누적 1행**을 쓴다(`trade-report` 의
> `GROUP BY o.id` 비집계 선택이 임의 행을 고르기 때문에 강제된 제약). 이 구조 때문에
> ① 동시 실행 시 SELECT-then-INSERT 가 원자적이지 않고(현재 `ORDER_SYNC_EXEC_DUPLICATE`
> 탐지기만 있음) ② 실제 체결 내역(체결가·시각별 분포)을 보존하지 못한다.
> `UNIQUE(order_id)` 로 ①만 막으면 ②의 길이 영구히 막히므로, 둘을 같이 푸는 것이 맞다:
> `fetchOrderRows` 를 `SUM(e.quantity)`·가중평균 `price` 기반으로 바꾸고 executions 를
> 건별 다행으로 전환한 뒤 `(order_id, executed_at, price, quantity)` 자연키로 중복을 막는다.
> **착수 트리거**: `ORDER_SYNC_EXEC_DUPLICATE` 최초 관측, 또는 체결 내역 분석 요구 발생 시.

#### 🟢 LOW-1 · 과거/신규 `executions` 혼재 통합 테스트 — 추가함

`trade-report-partial-fill.test.ts` 에 픽스처 1건 추가. **한 결과셋 안에** 과거 형태
(executions 없음 → `ELSE` 로 `o.quantity`/`o.amount_krw`)와 신규 형태(부분체결 종결 →
`e.quantity=3`, 금액도 3/10 축소)를 섞어 `fetchOrderRows` → `buildTradeReport` 를 한 번에 돈다.

이게 실전 1순위 위험이라는 reviewer 판단에 동의한다 — 운영 DB 는 `executions` 0행이라
**배포 직후 리포트는 반드시 "과거 다수 + 신규 소수" 형태**가 되고, 두 종류가 **같은 LIFO
스택을 공유**하므로 한쪽이 틀어지면 다른 쪽 원가까지 오염된다. 시나리오:
매수 10주@100 → 부분체결 매도 3주@110 → 매도 7주@90. 검증: `lifoPnl = −40`,
`sellsAmountKRW = 960`(330 축소분 + 630 과거분), 재고 잔량 0.

(부수) `setupPool` 헬퍼를 describe 안에서 모듈 스코프로 올렸다 — 두 describe 가 공유하기 위해서.

#### 변경 파일 (라운드 2)

| 구분 | 경로 |
|---|---|
| 수정 | `src/lib/safety/order-sync.ts` (`detectDuplicateExecutions` 신설, §동시성 주석, 건별 로그의 note 출력) |
| 수정 | `src/lib/safety/__tests__/order-sync-partial-settled.test.ts` (탐지기 테스트 3건 추가) |
| 수정 | `src/lib/reports/__tests__/trade-report-partial-fill.test.ts` (혼재 통합 테스트 1건 추가) |

#### 검증 (라운드 2)

`npm run typecheck` exit 0. `npm test` → **93 suites / 1411 tests 전부 통과**
(라운드 1 기준선 92/1396 대비 +1 suite · +15 tests, 감소 없음).

### 라운드 2 재감사 (Reviewer) — 2026-08-11

**작업일**: 2026-08-11 · **이 task 단독 판정**: 결함 없음 (합산 판정은 T-020 Reviewer 절 참조).
`npm run typecheck` 재실행 exit 0, `npm test` 재실행 **93 suites / 1411 tests 전부 통과** —
Developer 보고와 동일. 위 Developer 절의 MEDIUM-1·LOW-1 조치를 직접 읽고 재현했다.

**MEDIUM-1 — `detectDuplicateExecutions` 확인.** `order-sync.ts:844-867` 를 직접 읽었다.
INSERT 직후에만 호출되므로(부분체결 종결이라는 드문 경로에 한정, 매 회차 전수 스캔 아님)
비용 우려 없음 — 확인. 탐지 SELECT 실패를 삼키는 것(864-866행)은 "진단이 판정을 되돌리면
안 된다"는 원칙에 부합해 새 침묵이 아니다 — 판정(상태 전이·executions 기록)은 이미 끝난
뒤의 부가 진단이므로, 이게 실패해도 손실되는 정보는 "중복 여부를 이번에 못 봤다" 뿐이고
다음 부분체결 발생 시 다시 시도된다. `note` 가 `recordSettledFill` 반환값 → `PartialSettlement.note`
→ `reportPartialSettlements`(1111-1128행)의 `executionRecorded` 값과 무관하게 항상 로그에
실리는 것도 코드로 확인. 테스트 `order-sync-partial-settled.test.ts:466-511` 이 (a) 중복
탐지·로그·note 전달 (b) 탐지 실패 시에도 상태 전이·`complete=true` 유지 (c) 정상(1행)일 때
탐지 로그 없음 — 세 갈래를 mock 카운트(`duplicateCount`)로 직접 재현해 검증하고 있음을
읽고 확인했다. `UNIQUE(order_id)` 미도입 판단(Leader 지시)과 그 대안 3종 기각 근거도
타당함을 재확인 — 특히 `SELECT...FOR UPDATE`(orders 행 락이 `submitOrder` 의 상태 UPDATE와
경합)와 `GET_LOCK()`(풀에서 커넥션 동일성 미보장, 누수 시 이후 회차 전체 정지) 기각 사유는
이 프로젝트의 커넥션 풀 설정(`db.ts` `connectionLimit`)과 cron 아키텍처를 고려하면 설득력 있다.

**LOW-1 — 혼재 통합 테스트 확인.** `trade-report-partial-fill.test.ts:121-156` 을 직접 읽고
손계산으로 재검증했다: 매수 10주@100(원가 1000) → 부분체결 매도 3주@110(매출 330, 원가
3×100=300, pnl=+30) → 전량매도 7주@90(매출 630, 원가 7×100=700, pnl=−70) → 합계 **−40**,
`sellsAmountKRW=330+630=960`. 테스트 단언(152-155행)과 정확히 일치 — 확인. 이 테스트는
`fetchOrderRows` 가 이미 계산된 DB 행(과거형 `ELSE` 결과 2건 + 신규형 축소 `amount_krw` 1건)을
그대로 옮기는지, 그리고 그 셋을 **하나의 `buildTradeReport` 호출**에 넣었을 때 LIFO 스택이
올바르게 공유·소진되는지를 검증한다 — SQL `CASE` 자체의 실행은 테스트 ①(문자열 매칭)이
담당하므로 역할 분담이 적절하다.

**회귀 확인** — 라운드 1에서 결함 없음으로 판정한 항목(종결성·GROUP BY·SUM(fee)·FK·
amount_krw 다른 소비자 영향·T-018 계약)에 영향을 주는 코드 변경은 이번 라운드에 없음을
`git diff` 로 재확인(라운드 2가 건드린 파일은 `order-sync.ts`(주석+신규 함수)와 두 테스트
파일뿐). 전체 테스트 스위트 재실행으로 회귀 없음 확인.

**결론**: MEDIUM-1·LOW-1 모두 적절히 해소됨. 이 task 에 남은 미해결 이슈 없음.

## QA

**작업일**: 2026-08-11 · **판정**: ✅ 검증 통과

### 실행 결과

```
npm run typecheck: exit 0
npm test: 93 suites / 1411 tests 전부 통과
기준선: 93 suites / 1411 tests (회귀 없음)
```

### 체크리스트 A · T-019 검증

| # | 시나리오 | 검증 파일 | 판정 |
|---|---------|----------|------|
| 1 | 부분체결 후 잔량 미체결 목록에 있음 → `partially_filled` | `order-sync-partial-settled.test.ts:258-267` | ✅ |
| 2 | 부분체결 후 잔량 사라짐 → `filled` + `executions` 기록 | `order-sync-partial-settled.test.ts:197-211` | ✅ |
| 3 | 전량 체결 후 목록에서 사라짐 → `filled` (정상) | `order-sync-partial-settled.test.ts:269-279` | ✅ |
| 4 | `market` 주문 → 기존 동작 (검증 없음) | `order-sync-partial-settled.test.ts:303-312` | ✅ |
| 5 | 소수점 수량 주문에서 `submittedQuantity` 비교 무회귀 | `order-sync-partial-settled.test.ts:329-349` | ✅ |
| 6 | `filledQty` 미상 시 동작 정의 (`completenessUnverified`) | Task 파일 D-2 · 코드 구현 | ✅ |
| 7 | 손익 리포트가 실제 체결 수량으로 계산 | `trade-report-partial-fill.test.ts:38-56` | ✅ |
| 8 | `filled` 주문 `syncPendingOrders` 재조회 제외 | Task 파일 Reviewer ① · SQL 확인 | ✅ |

### 안전장치 검증

| 항목 | 판정 |
|------|------|
| `DRY_RUN` 회로 | ✅ |
| `KILL_SWITCH` 회로 | ✅ |
| 주문 한도 (`ORDER_MAX`/`DAILY_ORDER_MAX`) | ✅ |
| `orders`/`trade_logs` 기록 | ✅ |
| Safety 레이어 우회 경로 제외 | ✅ |
| API 키 노출 방지 | ✅ |
| SQL 파라미터 바인딩 | ✅ |

### 결론

모든 검증 체크리스트 통과. 부분체결 → filled 오기록이 해소되고, 손익 장부 정확성이 복원되었으며, 실매매 안전장치가 완전히 작동합니다.

---

## 최종 요약 (Leader, 2026-08-11)

**무엇이 문제였나 —** 우리 시스템은 "미체결 목록에 그 주문이 안 보이면 전부 팔린 것"이라고 판단하고 있었다. 그런데 장이 끝날 때 증권사가 남은 수량을 자동으로 취소하는 것은 지극히 정상적인 일이다. 그래서 10주 팔겠다고 내놓고 3주만 팔린 주문이 **"10주 전부 팔림"으로 장부에 기록**될 수 있었다. 게다가 실제 체결 내역을 담는 `executions` 표가 지금까지 한 줄도 없었기 때문에, 수익 리포트는 늘 "주문 수량 = 팔린 수량"으로 계산했다 — 즉 **"얼마 벌었나"가 틀리게 나오고, 틀렸다는 사실조차 알 수 없는** 상태였다.

**무엇을 했나 —** 이제는 체결 수량이라는 **증거를 직접 확인**해서, 주문한 만큼 다 채워지지 않았으면 "전량 체결"이라고 쓰지 않는다. 대신 **실제로 체결된 수량을 `executions` 에 기록**하므로 수익 리포트가 참값을 집는다. 금액도 체결 비율만큼 함께 줄여 한 건의 기록 안에서 수량과 금액이 어긋나지 않게 했다. 그리고 이런 일이 생기면 로그·감사기록·알림에 반드시 흔적을 남긴다 — 다만 장마감 잔량 취소는 **오류가 아니라 정상**이므로 문구를 그렇게 썼고, 매수와 매도 알림을 분리해 흔한 쪽이 드문 쪽을 묻어버리지 않게 했다.

**결과 —** 코드 검사 통과, 테스트 **93개 묶음 / 1411건 전부 통과**(작업 전 88/1341에서 늘어남). 독립 감사관이 2라운드 검증 후 **PASS**, QA도 **검증 통과**. 지금까지 이 문제가 실제로 발생한 적은 **0건**이지만, 킬스위치가 풀리고 주문이 다시 흐르기 시작한 지금 **부분체결이 한 번이라도 나면 그 순간부터 장부가 조용히 틀어지기 시작**하므로 미리 막은 것이다.

**남은 것 —** 시장가 주문의 부분체결은 여전히 검증하지 않는다(잔량을 확인할 방법이 구조적으로 없어 의도적으로 남김). 동시 실행 시 체결기록이 2줄 생길 이론적 여지가 있으나 잠금 장치의 위험이 더 커서 **탐지기를 넣어 감시**하는 쪽을 택했다. 둘 다 백로그로 이관했다.

**⚠️ 작업물은 커밋하지 않았다** — 실거래 자금에 직접 영향을 주는 변경이라 커밋·배포는 사용자 승인 후에만 진행한다.
