/**
 * T-087 (T-081 WP-D1a) — 브로커 원장용 **고정소수점 10진수** 유틸(순수 함수, BigInt). DB·네트워크 import 없음.
 *
 * KIS 는 금액·수량을 문자열(`"303.70350"`·`"-5600"`)로 준다. JS number 로 바꿔 더하면 2진 부동소수 오차가 합계 대조(설계 §3.4,
 * "소수 2자리 반올림 뒤 정확 일치")를 흔들고, DECIMAL 열에 넣을 값도 바뀐다. 그래서 값을 10^12 배 정수(BigInt)로 다룬다.
 *
 * 규칙(fail-closed):
 *  - 형식은 `[+-]?\d+(\.\d+)?` 만(앞뒤 공백 허용). 빈 문자열·`null`·`'1e3'`·`'1,000'`·`'abc'` 는 `null` — **0 으로 읽지 않는다**.
 *  - 소수 12자리를 넘는 입력은 12자리로 반올림(0.5 는 0 에서 먼 쪽). 캡처에서 본 가장 긴 소수는 10자리(환율)다.
 *  - 열 정밀도에 맞출 때도 같은 반올림. 정수부가 열 정밀도를 넘으면 `null`(DB 가 잘라 넣게 두지 않는다).
 */

export const DEC_SCALE = 12;
const TEN = 10n;
const SCALE_FACTOR = TEN ** BigInt(DEC_SCALE);
const DEC_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** 0.5 를 0 에서 먼 쪽으로 반올림하는 정수 나눗셈(부호 대칭). */
function divRoundHalfAway(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = an / ad;
  const r = an % ad;
  const rounded = r * 2n >= ad ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** KIS 숫자 문자열 → 10^12 배 정수. 형식이 아니면 `null`. 숫자(number)는 유한하고 지수 표기가 아닐 때만 받는다. */
export function parseDec(v: unknown): bigint | null {
  let s: string;
  if (typeof v === 'string') s = v.trim();
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else return null;
  const m = DEC_RE.exec(s);
  if (!m) return null;
  const [, sign, intPart, frac = ''] = m;
  let units: bigint;
  if (frac.length <= DEC_SCALE) {
    units = BigInt(intPart) * SCALE_FACTOR + BigInt(frac + '0'.repeat(DEC_SCALE - frac.length));
  } else {
    // 12자리 초과 — 전체를 정수로 만든 뒤 반올림으로 줄인다
    units = divRoundHalfAway(BigInt(intPart + frac), TEN ** BigInt(frac.length - DEC_SCALE));
  }
  return sign === '-' ? -units : units;
}

/** 10^12 배 정수 → 소수 `scale` 자리로 반올림한 10^scale 배 정수. */
export function quantize(units: bigint, scale: number): bigint {
  if (scale < 0 || scale > DEC_SCALE || !Number.isInteger(scale)) throw new RangeError(`scale 범위 밖: ${scale}`);
  return divRoundHalfAway(units, TEN ** BigInt(DEC_SCALE - scale));
}

/**
 * DECIMAL(precision, scale) 열에 넣을 문자열. 반올림 뒤 정수부 자리수가 `precision − scale` 를 넘으면 `null`.
 * 예: `toDbDecimal(parseDec('303.70350')!, 24, 4)` → `'303.7035'`, `toDbDecimal(parseDec('-5600')!, 24, 4)` → `'-5600.0000'`.
 */
export function toDbDecimal(units: bigint, precision: number, scale: number): string | null {
  const q = quantize(units, scale);
  const neg = q < 0n;
  const a = neg ? -q : q;
  const f = TEN ** BigInt(scale);
  const intPart = (a / f).toString();
  if (intPart.length > precision - scale) return null;
  const fracPart = scale > 0 ? '.' + (a % f).toString().padStart(scale, '0') : '';
  return `${neg && a !== 0n ? '-' : ''}${intPart}${fracPart}`;
}

/** 소수 2자리 반올림 뒤 같은가(설계 §3.4 "정확" 일치). */
export function equalAt2dp(a: bigint, b: bigint): boolean {
  return quantize(a, 2) === quantize(b, 2);
}

/** 상대 허용치 `|a − b| ≤ tol × max(|a|, |b|)` — `tolPerMille` 는 천분율 정수(1e-3 = 1). 둘 다 0 이면 일치. */
export function withinRelative(a: bigint, b: bigint, tolPerMille: number): boolean {
  const abs = (x: bigint) => (x < 0n ? -x : x);
  const diff = abs(a - b);
  const base = abs(a) > abs(b) ? abs(a) : abs(b);
  return diff * 1000n <= base * BigInt(tolPerMille);
}

/** `units × num ÷ den`(반올림, 결과도 10^12 배). 요율 곱셈용 — 예: 0.25% = `mulDiv(x, 25n, 10_000n)`. */
export function mulDiv(units: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('mulDiv: 0 으로 나눔');
  return divRoundHalfAway(units * num, den);
}

/** 사람이 읽는 표기(시험·진단용). 10^12 배 정수 → 소수 `scale` 자리 문자열(정밀도 제한 없음). */
export function formatDec(units: bigint, scale = 4): string {
  return toDbDecimal(units, 64, scale) as string;
}
