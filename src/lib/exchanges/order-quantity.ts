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

/**
 * 주문 송신 직전 **수량이 쓸 수 없는 값인지** 판정하고, 그렇다면 사유 문자열을 돌려준다 (T-027).
 * 쓸 수 있으면 `null`.
 *
 * ## 왜 `quantity <= 0` 만으로는 부족했는가
 *
 * `OrderRequest.quantity` 의 `?: number` 는 **컴파일타임 선언일 뿐 런타임 가드가 아니다.**
 * JSON 본문 등 타입 경계 밖에서 온 값은 무엇이든 될 수 있는데, JS 의 관계연산자는 피연산자를
 * 숫자로 강제변환하므로 `'3.7' <= 0` 은 **false** 다. 즉 타입이 깨진 수량이 어댑터의 가드를
 * 그대로 통과해 **라이브 주문 API 호출까지 도달**했다(T-024 Reviewer MEDIUM → [[T-027]]).
 *
 * 자금이 나가는 경로는 아니다 — 최종 `ORD_QTY` 는 위 `submittedQuantity` 의 엄격한
 * `Number.isFinite` 덕에 `"0"` 이 되어 브로커가 거절한다. 그래도 "가드가 있는데 안 걸리는"
 * 상태를 주문 송신 경로에 남겨 두지 않는다.
 *
 * ## 왜 사유를 두 갈래로 나누는가
 *
 * `quantity 계산 실패`(사이징이 0을 만든 정상 분기)와 `quantity 타입 오류`(호출부가 애초에
 * 숫자가 아닌 값을 넘긴 결함)는 **원인도 조치도 다르다.** 로그만 보고 판별할 수 있어야 하므로
 * 문자열을 분리하고, `categorizeRejectReason` 이 각각 `qty_calc_failed` / `bad_number_field` 로
 * 분류해 `orders.blocked_by` 에 남긴다. 후자는 두 어댑터의 `price 타입 오류` 와 **공유하는**
 * 카테고리다 — 같은 원인(호출부가 숫자 아닌 값을 넘김)이라 함께 조회하는 편이 진단에 낫다.
 *
 * 기존 `quantity 계산 실패` 문구는 **그대로 유지한다** — 이미 분류 정규식과 운영 로그가
 * 그 문자열에 걸려 있다. `context` 는 해외 어댑터가 쓰던 부연을 잃지 않기 위한 것이다.
 */
export function unusableQuantityReason(quantity: unknown, context?: string): string | null {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    return `quantity 타입 오류: 유한한 숫자가 아님 (${describeValue(quantity)})`;
  }
  if (quantity <= 0) {
    return context ? `quantity 계산 실패 (${context})` : 'quantity 계산 실패';
  }
  return null;
}

/** 진단 로그용 값 표기. 어떤 입력에도 던지지 않는다 (심볼·BigInt·순환참조 포함). */
function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `string: ${JSON.stringify(v)}`;
  if (typeof v === 'number') return `number: ${v}`;   // NaN / Infinity
  try {
    return `${typeof v}: ${JSON.stringify(v) ?? String(v)}`;
  } catch {
    return `${typeof v}: (직렬화 불가)`;
  }
}
