/**
 * `POST /api/signals/custom/confirm` 전용 수치·shape 런타임 가드 (T-029 신설).
 *
 * 🔴 **이 경로가 T-027/T-028 보다 위험한 이유 — 문자열 `+` 는 덧셈이 아니라 연결이다.**
 *
 * 앞선 두 task 가 막은 값은 잘못되면 `NaN` 이 되어 "명백히 틀린 값"으로 드러났고, 아래 단계
 * (주문 한도 fail-closed·어댑터 가드)가 잡아 줬다. 여기는 다르다:
 *
 * ```
 * roundToTick((s.zoneLo + s.zoneHi) / 2)   // zoneLo='100', zoneHi='200'
 * //  '100' + '200'  →  '100200'  →  / 2  →  50100
 * ```
 *
 * `NaN` 이 아니라 **그럴듯해 보이는 완전히 틀린 가격**이 조용히 만들어지고, 그대로
 * `amountKRW = qty × priceMid` 로 금액까지 파생된다. **아래 단계 어느 것도 이걸 못 잡는다** —
 * 유효한 유한수이기 때문이다. 게다가 이 라우트는 INSERT 직후 `approved_pending_entry`
 * (진입 감시)로 전환되어 **사람이 한 번 더 볼 기회가 없다.**
 *
 * 그래서 값이 들어온 API 경계에서 400 으로 되돌린다.
 *
 * ## 왜 `numeric-fields.ts` 의 `invalidNumericField` 를 안 쓰는가
 *
 * 그쪽은 평면 `price/quantity/amountKRW` 용이다. 여기 body 는 **중첩·배열**
 * (`entryZonePct: [lo, hi]`, `manualSlices: {zoneLo,zoneHi,qty}[]`)이라 평면 API 를 억지로
 * 맞추면 양쪽 다 어색해진다. **모양은 여기서, 판정 기준(`isFiniteNumber`)은 공용 모듈에서**
 * 가져와 세 라우트가 같은 잣대를 쓰게 한다.
 *
 * ## 무엇을 막지 *않는가* (과도차단 방지)
 *
 * 실계좌 실거래 중이라 **정상 시나리오 확정을 막는 것 자체가 사고**다. 그래서:
 *  - 모든 최상위 필드는 **선택**이다 — `undefined`/`null` 은 "미지정"이라는 정상 입력이고,
 *    라우트가 각각 `?? 0` / `?? 1` / 기본 구간으로 파생한다.
 *  - 값의 **의미**(lo < hi, qty > 0, 구간이 현재가 근처인지)는 판정하지 않는다. 그건 이 가드가
 *    아니라 UI·전략의 몫이고, 여기서 손대면 지금 되는 시나리오가 막힌다.
 *  - 빈 배열(`manualSlices: []`)은 통과한다 — 라우트가 `length > 0` 으로 분기해 기본 분할
 *    계산으로 넘어가는 기존 경로다.
 */
import { isFiniteNumber } from './numeric-fields';

/** 이 라우트의 `ConfirmBody` 가 구조적으로 만족하는 최소 형태 — 전부 `unknown` 으로 받는다. */
export interface ConfirmFieldCarrier {
  symbol?: unknown;
  currentPrice?: unknown;
  entryZonePct?: unknown;
  splits?: unknown;
  holdingQty?: unknown;
  manualSlices?: unknown;
  sourceSignalId?: unknown;
}

export interface ConfirmFieldViolation {
  /** 400 본문에 실을 문구. 배열 원소면 **몇 번째의 어느 필드**인지 밝힌다. */
  message: string;
  /** 거절된 값 자체 — 서버 로그용. */
  value: unknown;
}

function violation(path: string, expected: string, value: unknown): ConfirmFieldViolation {
  return { message: `${path} must be ${expected}`, value };
}

/** 선택 스칼라: 미지정은 정상, 지정했으면 유한수여야 한다. */
function checkOptionalNumber(
  body: ConfirmFieldCarrier,
  key: 'currentPrice' | 'holdingQty',
): ConfirmFieldViolation | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  return isFiniteNumber(v) ? null : violation(key, 'a finite number', v);
}

/**
 * 선택 정수 카운트: 미지정은 정상, 지정했으면 1 이상의 정수여야 한다.
 *
 * `splits` 는 `calcSplitSlices` 의 **반복 횟수**다. 정수가 아니면 구간 폭 계산(`range / splits`)과
 * 루프 횟수가 어긋나고, `splits < 1` 이면 슬라이스가 0 개가 되어 시그널이 하나도 생기지 않은 채
 * 알람 단계에서 `slices[0]` 접근으로 500 이 난다. 즉 "수인지"만으로는 부족하다.
 */
function checkSplits(body: ConfirmFieldCarrier): ConfirmFieldViolation | null {
  const v = body.splits;
  if (v === undefined || v === null) return null;
  if (!isFiniteNumber(v) || !Number.isInteger(v) || v < 1) {
    return violation('splits', 'an integer >= 1', v);
  }
  return null;
}

/**
 * 원본 시그널 ID: 미지정은 정상, 지정했으면 정수여야 한다.
 *
 * 이 값은 `UPDATE signals ... WHERE id=?` 의 바인딩 파라미터로 직행한다. 수치 오염 문제는
 * 아니지만 **같은 body 의 수치 필드**이고, 객체·배열이 mysql2 플레이스홀더에 들어가면 의도치
 * 않은 SQL 이 만들어질 수 있어 같은 자리에서 함께 막는다. (Leader 지시 4항목 외 추가분 —
 * 호출자 2곳 모두 DB 정수 PK 를 그대로 보내므로 과도차단 위험 없음.)
 */
function checkSourceSignalId(body: ConfirmFieldCarrier): ConfirmFieldViolation | null {
  const v = body.sourceSignalId;
  if (v === undefined || v === null) return null;
  if (!isFiniteNumber(v) || !Number.isInteger(v)) {
    return violation('sourceSignalId', 'an integer', v);
  }
  return null;
}

/**
 * 레거시 진입 구간 `[loPct, hiPct]`.
 *
 * 라우트가 `as [number, number]` 로 캐스트하던 자리다 — **캐스트는 런타임에 아무것도 보장하지
 * 않는다.** 길이가 3 이든 원소가 문자열이든 컴파일은 통과하고, `pctHi - pctLo` 가 조용히
 * 이상한 값을 만든다. 여기서 배열인지·길이 2인지·원소가 유한수인지를 실제로 확인한다.
 */
function checkEntryZonePct(body: ConfirmFieldCarrier): ConfirmFieldViolation | null {
  const v = body.entryZonePct;
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isFiniteNumber)) {
    return violation('entryZonePct', 'an array of exactly 2 finite numbers', v);
  }
  return null;
}

/** 슬라이스 원소가 반드시 갖춰야 하는 수치 필드 — 하나라도 비면 가격·금액 파생이 오염된다. */
const SLICE_NUMERIC_FIELDS = ['zoneLo', 'zoneHi', 'qty'] as const;

/**
 * 슬라이스별 개별 입력값 — **이 task 의 핵심.**
 *
 * 최상위 스칼라와 달리 원소 내부 필드는 **필수**다. 원소가 존재한다는 것은 "이 구간에 이만큼
 * 주문하겠다"는 뜻인데 값이 빠지면 `undefined + undefined → NaN` 이 되고, 값이 문자열이면
 * 위 주석의 `'100'+'200' → 50100` 오염이 된다. 둘 다 원소 단위로 막는다.
 */
function checkManualSlices(body: ConfirmFieldCarrier): ConfirmFieldViolation | null {
  const v = body.manualSlices;
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return violation('manualSlices', 'an array', v);

  for (let i = 0; i < v.length; i++) {
    const slice: unknown = v[i];
    if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) {
      return violation(`manualSlices[${i}]`, 'an object', slice);
    }
    const rec = slice as Record<string, unknown>;
    for (const field of SLICE_NUMERIC_FIELDS) {
      if (!isFiniteNumber(rec[field])) {
        return violation(`manualSlices[${i}].${field}`, 'a finite number', rec[field]);
      }
    }
  }
  return null;
}

/**
 * 무효한 수치·shape 를 하나 찾아 돌려준다. 없으면 `null`.
 *
 * 첫 위반에서 멈춘다 — 호출자가 고쳐야 할 지점을 하나씩 정확히 알려주는 편이,
 * 전부 모아 보여 주는 것보다 이 화면(한 번에 한 시나리오)에서 유용하다.
 */
export function invalidConfirmField(body: ConfirmFieldCarrier): ConfirmFieldViolation | null {
  return (
    checkOptionalNumber(body, 'currentPrice') ??
    checkSplits(body) ??
    checkOptionalNumber(body, 'holdingQty') ??
    checkEntryZonePct(body) ??
    checkManualSlices(body) ??
    checkSourceSignalId(body)
  );
}

/**
 * 흔적 없는 거절을 남기지 않는다. 여기서 막힌 요청은 `signals` 행이 생기기 **전**이라
 * 감사 로그에 남지 않으므로(= 정상 400 과 동일 취급), 최소한 서버 로그에는 남긴다.
 * (T-027/T-028 의 `warnNumericFieldRejected` 와 같은 이유·같은 모양.)
 */
export function warnConfirmFieldRejected(
  routeTag: string,
  v: ConfirmFieldViolation,
  body: ConfirmFieldCarrier,
): void {
  let value: string;
  try {
    value = JSON.stringify(v.value) ?? String(v.value);
  } catch {
    value = '<직렬화 불가>';
  }
  console.warn(
    `[${routeTag}] 무효 수치/shape 거절 — symbol=${String(body.symbol)} ` +
    `${v.message} (type=${typeof v.value} value=${value})`,
  );
}
