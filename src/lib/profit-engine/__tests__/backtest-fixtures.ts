/**
 * T-096 백테스트 시험용 합성 일봉(실제 DB·daily_bars 없음). 결정적(시드 고정).
 */
import type { Bar, Frame, Market } from '../backtest/types';

/** 평일 날짜 n 개(from 부터). */
export function weekdays(from: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const bar = (date: string, o: number, h: number, l: number, c: number, extra: Partial<Bar> = {}): Bar => ({
  date, open: o, high: h, low: l, close: c, volume: 1_000_000, turnover: 1e10, flags: null, ...extra,
});

/** 종가 배열 → 봉(open = 직전 종가, high/low = ±0.5%). */
export function barsFromCloses(dates: string[], closes: number[], extra: Partial<Bar> = {}): Bar[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return bar(dates[i], o, Math.max(o, c) * 1.005, Math.min(o, c) * 0.995, c, extra);
  });
}

export function frame(symbol: string, bars: Bar[], market: Market = 'US'): Frame {
  return {
    market, symbol, bars,
    excluded: bars.map((b) => !!b.flags && /adj_stale|adj_orphan/.test(b.flags)),
    corpSuspect: bars.map((b) => !!b.flags && /corp_action_suspect/.test(b.flags)),
  };
}

export function flatFrame(symbol: string, from: string, n: number, close = 100, market: Market = 'US'): Frame {
  const dates = weekdays(from, n);
  return frame(symbol, dates.map((d) => bar(d, close, close, close, close)), market);
}

/** 결정적 의사난수 걷기(시드별 종목). */
export function walkCloses(n: number, seed: number, start = 100, vol = 0.02): number[] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: number[] = [];
  let p = start;
  for (let i = 0; i < n; i++) { p *= 1 + (rnd() - 0.5) * 2 * vol; out.push(Math.round(p * 100) / 100); }
  return out;
}

export function walkFrame(symbol: string, from: string, n: number, seed: number, market: Market = 'US', vol = 0.02): Frame {
  const dates = weekdays(from, n);
  return frame(symbol, barsFromCloses(dates, walkCloses(n, seed, 100, vol)), market);
}

/** 미래 봉(i+1..)을 난수로 덮은 복사본. */
export function scrambleFuture(f: Frame, i: number, seed: number): Frame {
  let a = seed >>> 0;
  const rnd = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  const bars = f.bars.map((b, k) => (k <= i ? b : bar(b.date, 1 + rnd() * 500, 600 + rnd() * 100, 0.5 + rnd(), 1 + rnd() * 500, { volume: Math.floor(rnd() * 1e6), turnover: rnd() * 1e9 })));
  return { ...f, bars, excluded: f.excluded.map((x, k) => (k <= i ? x : rnd() < 0.2)), corpSuspect: f.corpSuspect.map((x, k) => (k <= i ? x : rnd() < 0.2)) };
}
