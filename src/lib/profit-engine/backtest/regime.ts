/**
 * T-096 레짐 필터(§A-2): 유니버스 동일가중 지수 < MA100 → 신규 진입 금지. 순수 함수.
 *  - universeIndex: 시장 달력의 날짜마다, 그날 봉이 있고 직전 봉(간격 ≤ 9일)도 있는 종목들의 종가 대비 수익 평균으로 100 부터 잇는다.
 *    제외 봉·corp_action_suspect 봉·비양수 종가의 수익은 넣지 않는다. 그날 수익이 하나도 없으면 0.
 *  - regimeOk(index, i, ma): i 위치까지(포함)의 값만 본다 — value_i ≥ SMA_ma(values[i−ma+1..i]) 이면 true. 점이 ma 개 미만이면 false(보수).
 */
import { BAR_GAP_DAYS, calendarOf, dayDiff } from './frames';
import type { Frame, Series } from './types';

export function universeIndex(frames: Frame[]): Series {
  const ms = new Set(frames.map((f) => f.market));
  if (ms.size > 1) throw new Error('universeIndex: frames must belong to one market');
  const cal = calendarOf(frames);
  const pos = new Map<string, number>(cal.map((d, i) => [d, i]));
  const sum = new Array<number>(cal.length).fill(0);
  const cnt = new Array<number>(cal.length).fill(0);
  for (const f of frames) {
    for (let i = 1; i < f.bars.length; i++) {
      const a = f.bars[i - 1], b = f.bars[i];
      if (f.excluded[i] || f.excluded[i - 1] || f.corpSuspect[i]) continue;
      if (!(a.close > 0 && b.close > 0)) continue;
      if (dayDiff(a.date, b.date) > BAR_GAP_DAYS) continue;
      const p = pos.get(b.date)!;
      sum[p] += b.close / a.close - 1;
      cnt[p]++;
    }
  }
  const values: number[] = [];
  let v = 100;
  for (let p = 0; p < cal.length; p++) {
    if (p > 0 && cnt[p] > 0) v *= 1 + sum[p] / cnt[p];
    values.push(v);
  }
  return { dates: cal, values };
}

export function regimeOk(index: Series, i: number, ma: number): boolean {
  if (!Number.isInteger(ma) || ma < 1) throw new RangeError('ma must be a positive integer');
  if (i < ma - 1 || i >= index.values.length) return false;
  let s = 0;
  for (let k = i - ma + 1; k <= i; k++) s += index.values[k];
  return index.values[i] >= s / ma;
}

/** 날짜 기준 조회 — 그 날짜가 지수 달력에 없으면 그 이전 마지막 날짜를 쓴다(미래 값 사용 없음). */
export function regimeOkAt(index: Series, date: string, ma: number): boolean {
  let lo = 0, hi = index.dates.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.dates[mid] <= date) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && regimeOk(index, best, ma);
}
