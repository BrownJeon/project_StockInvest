/**
 * T-096 S7 `control-spike-contraction` — 급등 후 수렴 **대조군**(§B-1, 판정 대상 아님·승급 불가).
 *
 * §B-1 원문: "20봉 내 +15% 이상 급등 뒤 5봉 ATR 수축 후 5봉 고점 재돌파". 원문이 창 경계·ATR 기간·수축 비교 대상을 정하지 않아
 * 아래는 **Developer 해석**이다(보고 대상 — Leader 가 새 버전에서 확정할 것. 대조군이라 승급·판정에는 영향이 없다):
 *   ① 급등: 급등 창 W = 봉 [i−25, i−6](20봉) 안에서 앞선 종가 대비 뒤 종가가 +15% 이상(max_{a<b∈W} close_b/close_a − 1 ≥ 0.15).
 *   ② 수축: ATR(5, Wilder)의 i−1 값 < ATR(5) 의 i−6 값(급등 창 끝 대비 직전 5봉 동안 변동폭 감소).
 *   ③ 재돌파: close_i > max(high[i−5..i−1]).
 *   봉 ≥ 27. 순위: 정의 없음 → score 0(동률 → 종목코드 순).
 * 자유 파라미터 없음(hold ∈ {5,10}, stop 5% 고정은 체결 쪽). 룩어헤드 차단: bars[0..i] 만 사용.
 * v1.1 ② 로 위 해석이 확정(추인·동결)됐다. spike(0.15)·atrPeriod(5)는 registry fixed 에서 params 로 받는다.
 */
import { atr } from '@/lib/strategy/indicators/atr';
import type { Frame, Params, Signal } from '../types';

export const ID = 'control-spike-contraction';
export const MIN_BARS = 27;

export function evaluate(frame: Frame, i: number, params: Params): Signal | null {
  const spikeTh = params.spike, atrPeriod = params.atrPeriod;
  if (typeof spikeTh !== 'number' || !Number.isFinite(spikeTh)) throw new TypeError('params.spike must be a finite number');
  if (typeof atrPeriod !== 'number' || !Number.isInteger(atrPeriod) || atrPeriod < 1) throw new TypeError('params.atrPeriod must be a positive integer');
  if (!Number.isInteger(i) || i < MIN_BARS - 1 || i >= frame.bars.length) return null;
  for (let k = i - MIN_BARS + 1; k <= i; k++) if (frame.excluded[k]) return null;
  const bars = frame.bars.slice(0, i + 1);
  if (bars.some((b) => ![b.high, b.low, b.close].every(Number.isFinite))) return null;
  // ① 급등
  let runMin = Infinity, spike = false;
  for (let k = i - 25; k <= i - 6; k++) {
    const c = bars[k].close;
    if (runMin > 0 && runMin !== Infinity && c / runMin - 1 >= spikeTh) { spike = true; break; }
    if (c < runMin) runMin = c;
  }
  if (!spike) return null;
  // ② 수축
  const a = atr(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })), atrPeriod);
  const now = a[i - 1], then = a[i - 6];
  if (now === null || then === null || !(now < then)) return null;
  // ③ 재돌파
  let hh = -Infinity;
  for (let k = i - 5; k <= i - 1; k++) hh = Math.max(hh, bars[k].high);
  if (!(bars[i].close > hh)) return null;
  return { symbol: frame.symbol, d0: bars[i].date, d0Index: i, score: 0 };
}
