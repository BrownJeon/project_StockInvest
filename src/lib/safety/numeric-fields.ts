/**
 * 주문 발원 API 경계의 수치 필드 런타임 가드 (T-027 신설 → T-028 공용화).
 *
 * 🔴 배경 — `price?: number` 류 선언은 **타입일 뿐 런타임 가드가 아니다.**
 * JSON 본문은 무엇이든 담을 수 있고, 비-number 수치는 아래로 흘러가며 조용히 통과했다:
 *  - `quantity: '3.7'` → `sizeOrderQuantity` 가 값을 만들지 못해(`undefined`) 원본이 그대로
 *    `orderReq.quantity` 에 남고, 어댑터의 `quantity <= 0` 이 `'3.7' <= 0 → false` 로
 *    통과시켜 **라이브 KIS 주문 호출까지** 도달했다.
 *  - `price: 'abc'` → `resolveOrderAmountKRW` 가 `NaN` 을 만들고, `checkOrderMax` 의
 *    `amount <= 0` 도 `amount > max` 도 NaN 비교라 **둘 다 false** → 1회·일일 한도가 통째로
 *    무력화됐다.
 *
 * 어댑터와 한도 검사 쪽도 각각 fail-closed 로 고쳤지만(방어 이중화), **원인을 가장 잘 설명할
 * 수 있는 자리는 값이 들어온 API 경계**다. 여기서 400 으로 되돌려 주면 호출자가 무엇을 잘못
 * 보냈는지 즉시 안다.
 *
 * 이 모듈은 그 규칙을 **한 벌만** 두기 위한 것이다 — 주문 발원 경로가
 * `POST /api/orders`(직접 주문)와 `POST /api/signals`(시그널 → 자동제출) 둘이므로, 같은 규칙을
 * 복붙하면 한쪽만 바뀌는 상태가 다시 결함의 구조가 된다.
 *
 * ⚠️ **이 경계는 `price` 도 엄격하다**(어댑터는 느슨하다 — `Number(x)` 로 판정해 `'70000'` 같은
 * 숫자 문자열을 통과시킨다). 비대칭이 의도적인 이유: 느슨함이 필요한 근거는 mysql2 가 DECIMAL 을
 * 문자열로 돌려주는 **DB 경유 경로**인데, 그 경로들(`approveSignal`·entry-watcher)은
 * 이 API 경계를 지나지 않고 **자기 쪽에서 이미 `Number(row.price)` 로 변환**한다(T-028 실측).
 * 즉 여기로 숫자 문자열이 들어올 정상 사유가 없다.
 */

/** 주문 금액·수량·가격을 결정하는 필드 — 하나라도 비-number 면 아래 계산이 전부 오염된다. */
export const ORDER_NUMERIC_FIELDS = ['price', 'quantity', 'amountKRW'] as const;

export type OrderNumericField = (typeof ORDER_NUMERIC_FIELDS)[number];

/** 각 라우트의 `CreateBody` 가 구조적으로 만족하는 최소 형태. */
export type NumericFieldCarrier = Partial<Record<OrderNumericField, unknown>>;

/**
 * 비-number(= 유한 숫자가 아닌) 수치 필드를 하나 찾아 그 이름을 돌려준다. 없으면 `null`.
 *
 * `undefined`/`null` 은 **정상 입력**이다 — "미지정"이라는 뜻이고, 하위 사이징·어댑터가
 * 금액에서 파생한다. required 여부는 각 라우트의 기존 검사가 따로 판정한다.
 */
export function invalidNumericField(body: NumericFieldCarrier): OrderNumericField | null {
  for (const field of ORDER_NUMERIC_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    // Number.isFinite 는 non-number 에 대해 강제변환 없이 false 를 돌려준다
    // (`Number.isFinite('3.7') === false`) — 전역 isFinite 와 다른 지점이자 이 가드의 핵심.
    if (!Number.isFinite(v)) return field;
  }
  return null;
}

/** 400 응답 본문에 실을 에러 문구. 두 라우트가 같은 계약을 갖도록 여기서만 만든다. */
export function numericFieldError(field: OrderNumericField): string {
  return `${field} must be a finite number`;
}

/**
 * 흔적 없는 거절을 남기지 않는다. 여기서 막힌 요청은 `orders`/`signals` 행이 생기기 전이라
 * 감사 로그에 남지 않으므로(= 정상 400 과 동일 취급), 최소한 서버 로그에는 남긴다.
 *
 * 값 자체를 문자열화하다 던지는 일이 없도록 `JSON.stringify` 실패는 삼킨다.
 */
export function warnNumericFieldRejected(
  routeTag: string,
  field: OrderNumericField,
  body: NumericFieldCarrier & { symbol?: unknown },
): void {
  let value: string;
  try {
    value = JSON.stringify(body[field]) ?? String(body[field]);
  } catch {
    value = '<직렬화 불가>';
  }
  console.warn(
    `[${routeTag}] 비-number ${field} 거절 — symbol=${String(body.symbol)} ` +
    `type=${typeof body[field]} value=${value}`,
  );
}
