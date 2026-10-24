/**
 * T-074 — 금액 표기 도우미 (순수, 서버·클라이언트 공용).
 *
 * `krRead` 는 승인 데모의 같은 이름 함수를 옮긴 것이다(만 단위 읽기: 2,056,912 → "205만 6,912원").
 * 데모는 `toLocaleString('ko-KR')` 로 천 단위를 찍지만, 서버·브라우저 ICU 차이를 없애려고 정규식 구분자를 쓴다(정수에서는 결과가 같다).
 * 음수는 데모가 다루지 않던 입력이라(금액은 항상 양수) 앞에 '−' 를 붙이고 절댓값을 읽는다 — 데모와 다른 유일한 점.
 *
 * 나머지(`fmtWon`·`fmtSignedWon`·`fmtUsd`·`fmtSignedUsd`·`fmtRate`)는 서버가 만드는 반영 근거 문장(anchor_detail)·경고 문장에 쓴다.
 * 음수 기호는 데모와 같은 U+2212 '−' 이다.
 */
import { isUsd } from './rules';

const MINUS = '−';

/** 정수 천 단위 구분(반올림, 절댓값) */
export function groupInt(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 만 단위 읽기 — 데모 `krRead` */
export function krRead(n: number): string {
  let v = Math.round(n);
  if (!v) return '0원';
  const neg = v < 0;
  if (neg) v = -v;
  const eok = Math.floor(v / 1e8);
  const man = Math.floor((v % 1e8) / 1e4);
  const rest = v % 1e4;
  const out: string[] = [];
  if (eok) out.push(`${groupInt(eok)}억`);
  if (man) out.push(`${groupInt(man)}만`);
  if (rest) out.push(groupInt(rest));
  return (neg ? MINUS : '') + out.join(' ') + '원';
}

/** 1,000,000원 / −300,000원 (데모 `won`) */
export function fmtWon(n: number): string {
  return (n < 0 && Math.round(n) !== 0 ? MINUS : '') + groupInt(n) + '원';
}

/** +1,000,000원 / −300,000원 / 0원 (데모 `swon`) */
export function fmtSignedWon(n: number): string {
  const r = Math.round(n);
  return (r > 0 ? '+' : r < 0 ? MINUS : '') + groupInt(n) + '원';
}

function cents2(n: number): string {
  const c = Math.round(Math.abs(n) * 100);
  const whole = Math.floor(c / 100);
  const frac = c % 100;
  return `${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac < 10 ? '0' : ''}${frac}`;
}

/** $1,000.00 (절댓값, 데모 `usd`) */
export function fmtUsd(n: number): string {
  return `$${cents2(n)}`;
}

/** +$200.00 / −$368.60 */
export function fmtSignedUsd(n: number): string {
  const c = Math.round(n * 100);
  return (c > 0 ? '+' : c < 0 ? MINUS : '') + fmtUsd(n);
}

/** 1,250.00 (환율·원/$ 2자리, 데모 `rt`) */
export function fmtRate(n: number): string {
  return cents2(n);
}

/** 통화별 금액(절댓값) */
export function fmtAmount(currency: 'KRW' | 'USD', n: number): string {
  return isUsd(currency) ? fmtUsd(n) : groupInt(n) + '원';
}
