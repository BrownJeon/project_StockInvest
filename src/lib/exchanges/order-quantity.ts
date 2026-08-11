/**
 * 주문 수량의 **단일 진실 공급원** (T-018 / reviewer H-4).
 *
 * ## 왜 이 모듈이 존재하는가
 *
 * `orders.quantity` 에 저장되는 값과 브로커가 실제로 받는 값이 **서로 달랐고, 그 사실이
 * 어디에도 적혀 있지 않았다.**
 *
 * | 지점 | 값 |
 * |---|---|
 * | `dry-run.ts:136` `INSERT INTO orders … quantity` | `req.quantity` — **자르지 않은 원본** (예: `1.7`) |
 * | `kis-overseas.ts` `ORD_QTY` | `Math.floor(quantity)` — **잘린 값** (예: `1`) |
 *
 * `order-sync` 는 "체결수량 ≥ 주문수량이면 전량 체결"로 완결을 판정한다. 그런데 비교
 * 대상이 DB 의 `1.7` 이면 브로커가 최대로 채울 수 있는 수량은 `1` 이므로 **부등식이 영원히
 * 성립하지 않는다.** 결과는 조용한 덫이다 — 완전히 체결된 주문이 `partially_filled` 에
 * 갇혀 5분마다 KIS 조회를 영원히 소모한다([[T-017]] 유량 예산을 잠식한다).
 *
 * 그래서 **자르는 규칙을 다시 유도하지 않고**(반올림이 조금이라도 다르면 버그가 자리만
 * 옮긴다) 송신 경로가 쓰던 바로 그 계산을 여기로 옮겨, 송신부와 판정부가 **같은 함수**를
 * 부르게 한다. 두 경로가 갈라질 수 있는 구조 자체를 없애는 것이 요점이다.
 *
 * ## 현재 상태 (2026-08-11 실측)
 *
 * H-4 는 **아직 한 번도 발화한 적이 없다.** 소수점 수량 주문 79건은 전부
 * `rejected`(70) / `blocked`(9) 로 **브로커에 도달한 적이 없고**(따라서 `exchange_order_id`
 * 가 없어 `syncPendingOrders` 대상이 된 적도 없다), 현재 order-sync 대상 주문은 0건이다.
 * 이것이 살아나는 계기는 [[T-017]] 이다 — 그 제출들을 억누르고 있던 레이트리밋 거절이
 * 사라졌기 때문에, **앞으로 도달하게 된다.** 즉 활성 사고가 아니라 T-017 이 열어 둔
 * 잠재 위험이다.
 */
import type { Market } from './kis-symbols';

/**
 * 브로커에 **실제로 전송되는** 주문 수량.
 *
 * `orders.quantity`(요청 원본)와 이 값이 다를 수 있다는 것이 이 함수의 존재 이유다.
 * 체결 완결성을 따질 때는 **반드시 이 값**과 비교해야 한다 — 브로커는 자기가 받은 수량
 * 이상을 채울 수 없기 때문이다.
 *
 * 규칙은 **송신 경로에서 그대로 가져온 것이며 새로 만든 것이 아니다**:
 *  - `overseas` — KIS 해외 주문은 정수 수량만 받는다 (`ORD_QTY: String(Math.floor(quantity))`).
 *  - `domestic` — 기존 송신 경로가 `String(quantity)` 로 **가공 없이** 보낸다. 동작을
 *    바꾸지 않기 위해 여기서도 그대로 통과시킨다.
 *
 * ⚠️ 국내 경로가 소수를 그대로 보내는 것은 별개의 문제다(KIS 가 거절한다). 다만 그것은
 * **시끄럽게 실패**하므로 이 조용한 덫과 성격이 다르고, 송신 동작을 바꾸는 일이라
 * 이 작업 범위 밖이다. 여기서는 현행 동작을 정확히 반영하기만 한다.
 */
export function submittedQuantity(market: Market, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return market === 'overseas' ? Math.floor(quantity) : quantity;
}
