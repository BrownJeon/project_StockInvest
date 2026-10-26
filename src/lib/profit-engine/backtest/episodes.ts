/**
 * T-096 에피소드 정의(§A-2): 종목별로 에피소드 시작 D0 뒤 windowDays **거래일** 안의 재발화와
 * 보유 중(시작 뒤 holdBars 거래일 안) 재발화는 새 에피소드가 아니다.
 *   → 새 에피소드 조건: d0Index − 직전 에피소드 시작 d0Index > max(windowDays, holdBars).
 *   보유 기간은 **시간 기준**(손절로 일찍 끝나도 보유 기간으로 본다) — 에피소드 수가 가격 경로(수익)에 의존하지 않게 하려는 해석.
 *   (보고 대상: §A-2 는 손절 조기 청산 뒤 재발화를 명시하지 않는다.)
 * 거래일 = 그 종목 Frame 의 봉 위치 차이.
 */
import type { Signal } from './types';

export function toEpisodes(signals: Signal[], windowDays: number, holdBars: number): Signal[] {
  if (!Number.isInteger(windowDays) || windowDays < 0) throw new RangeError('windowDays must be a non-negative integer');
  if (!Number.isInteger(holdBars) || holdBars < 0) throw new RangeError('holdBars must be a non-negative integer');
  const block = Math.max(windowDays, holdBars);
  const bySym = new Map<string, Signal[]>();
  for (const s of signals) {
    if (!bySym.has(s.symbol)) bySym.set(s.symbol, []);
    bySym.get(s.symbol)!.push(s);
  }
  const out: Signal[] = [];
  for (const list of bySym.values()) {
    list.sort((a, b) => a.d0Index - b.d0Index);
    let last = -Infinity;
    for (const s of list) {
      if (s.d0Index === last) continue; // 같은 봉 중복
      if (s.d0Index - last > block) { out.push(s); last = s.d0Index; }
    }
  }
  return out.sort((a, b) => (a.d0 < b.d0 ? -1 : a.d0 > b.d0 ? 1 : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}
