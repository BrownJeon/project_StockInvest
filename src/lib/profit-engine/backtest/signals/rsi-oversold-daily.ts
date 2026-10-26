/**
 * T-096 S1 `rsi-oversold-daily` — `rsi-oversold-v1`(30분~1h) 의 일봉 아날로그(§B-1, Tier A). **다른 전략**이다(봉 간격이 다름).
 *
 * 정의(등록 그대로): RSI14(close) < th ∧ close < MA20 × 1.005 ∧ (close > open ∨ low ≥ low_prev). 봉 ≥ 22.
 * 자유 파라미터 th ∈ {30, 35, 38}(라이브 38) — hold·stop·regime 은 체결·필터 쪽 파라미터라 이 함수는 받지 않는다.
 * 고정값 maMult(1.005)·rsiPeriod(14)·maPeriod(20)은 registry strategies[].fixed 에서 params 로 받는다(코드 상수 없음 — 단일 출처).
 * 동시 신호 순위: RSI 낮은 순(score = RSI, 작을수록 먼저).
 *
 * 룩어헤드 차단: bars[0..i] 만 잘라서 지표를 계산한다 — bars[i+1..] 를 무엇으로 바꿔도 결과가 같다(시험으로 고정).
 * 결측·제외: 판단 창(i−21..i)에 제외 봉(adj_stale·adj_orphan)이 있거나 값이 유한하지 않으면 null.
 */
import { rsi } from '@/lib/strategy/indicators/rsi';
import { sma } from '@/lib/strategy/indicators/sma';
import type { Frame, Params, Signal } from '../types';

export const ID = 'rsi-oversold-daily';
export const MIN_BARS = 22;

const num = (p: Params, k: string): number => {
  const v = p[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`params.${k} must be a finite number`);
  return v;
};

export function evaluate(frame: Frame, i: number, params: Params): Signal | null {
  const th = num(params, 'th');
  const maMult = num(params, 'maMult');
  const rsiPeriod = num(params, 'rsiPeriod');
  const maPeriod = num(params, 'maPeriod');
  if (!Number.isInteger(i) || i < MIN_BARS - 1 || i >= frame.bars.length) return null;
  for (let k = i - MIN_BARS + 1; k <= i; k++) if (frame.excluded[k]) return null;
  const bars = frame.bars.slice(0, i + 1);
  const closes = bars.map((b) => b.close);
  if (closes.some((c) => !Number.isFinite(c))) return null;
  const r = rsi(closes, rsiPeriod)[i];
  const ma = sma(closes, maPeriod)[i];
  const b = bars[i];
  const prev = bars[i - 1];
  if (r === null || ma === null || !Number.isFinite(r) || !Number.isFinite(ma)) return null;
  if (![b.open, b.low, prev.low].every(Number.isFinite)) return null;
  const reversal = b.close > b.open || b.low >= prev.low;
  if (r < th && b.close < ma * maMult && reversal) {
    return { symbol: frame.symbol, d0: b.date, d0Index: i, score: r, note: `rsi14=${r.toFixed(2)}` };
  }
  return null;
}
