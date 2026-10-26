/**
 * T-096 같은 날 유니버스 기준선 — P1(T-095) `universeBaselines`(scripts/profit-engine/postmortem-core.js, d1open) 와 패리티.
 * 고정 입력(결정적 합성 일봉 — DB 아님): KR·US 각 12종목, 기업행위 의심 봉·9일 넘는 결측·제외(adj_stale) 행 포함.
 * 6지점(KR·US × 3일자 × h 5/10) 명시 대조 + 전 날짜 전수 대조. δ·동일가중·ETF 보유도 여기서.
 */
import { buyAndHold, cagr, equalWeightMonthly, survivorshipDelta, universeBaseline, universeBaselineDetail } from '../backtest/baseline';
import type { Frame, Market } from '../backtest/types';
import { barsFromCloses, frame, walkCloses, weekdays } from './backtest-fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../../../scripts/profit-engine/postmortem-core.js');

function universe(market: Market, seed0: number): Frame[] {
  const dates = weekdays('2025-03-03', 60);
  return Array.from({ length: 12 }, (_, s) => {
    const closes = walkCloses(60, seed0 + s, 50 + s * 10, 0.03);
    let ds = dates;
    if (s === 3) ds = dates.map((d, i) => (i >= 30 ? weekdays('2025-06-02', 60)[i - 30] : d)); // 결측 구간(> 9일)
    const bars = barsFromCloses(ds, closes);
    if (s === 5) bars[20] = { ...bars[20], flags: 'corp_action_suspect' };
    if (s === 7) bars[40] = { ...bars[40], flags: 'adj_stale' };
    if (s === 9) bars[10] = { ...bars[10], open: NaN };
    return frame(`${market}${s}`, bars, market);
  });
}

/** P1 입력 모양: adj_stale·adj_orphan 행은 P1 적재 단계에서 버린다. */
const toP1 = (frames: Frame[]) => frames.map((f) => ({
  market: f.market,
  bars: f.bars.filter((_, i) => !f.excluded[i]).map((b) => ({
    tradeDate: b.date, open: Number.isFinite(b.open) ? b.open : null, high: b.high, low: b.low, close: b.close, flags: b.flags ? b.flags.split(',') : [],
  })),
}));

describe('universeBaseline ↔ P1 universeBaselines(d1open) 패리티', () => {
  const sets: Array<[Market, Frame[]]> = [['KR', universe('KR', 100)], ['US', universe('US', 900)]];

  test.each(sets)('%s: 전 날짜·h 5/10 평균과 표본 수가 소수 12자리까지 같다', (market, frames) => {
    const mine = universeBaselineDetail(frames, [5, 10], 10).byDate;
    const p1 = core.universeBaselines(toP1(frames), 'd1open').byKey;
    let compared = 0;
    for (const [key, v] of p1) {
      const date = key.split('|')[1];
      expect(key.split('|')[0]).toBe(market);
      for (const h of [5, 10]) {
        const a = v[h], b = mine.get(date)?.[h] ?? null;
        if (a === null) { expect(b).toBeNull(); continue; }
        expect(b).not.toBeNull();
        expect(b!.n).toBe(a.n);
        expect(b!.mean).toBeCloseTo(a.mean, 12);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  test('6지점 명시(KR·US × 3일자 × h 5/10)', () => {
    for (const [, frames] of sets) {
      const p1 = core.universeBaselines(toP1(frames), 'd1open').byKey;
      const mine = universeBaseline(frames, [5, 10], null, 10);
      const dates = [...mine.keys()].sort();
      for (const d of [dates[5], dates[20], dates[35]]) {
        const m = frames[0].market;
        for (const h of [5, 10]) {
          const a = p1.get(`${m}|${d}`)[h];
          if (a) expect(mine.get(d)![h]).toBeCloseTo(a.mean, 12);
          else expect(mine.get(d)![h]).toBeUndefined();
        }
      }
    }
  });

  test('제외 건수(기업행위·결측)도 P1 과 같다', () => {
    for (const [, frames] of sets) {
      const a = core.universeBaselines(toP1(frames), 'd1open', 10).excluded;
      // P1 은 HORIZONS [1,3,5,10] 전부를 센다 → 같은 지평 묶음으로 비교
      const b = universeBaselineDetail(frames, [1, 3, 5, 10], 10).excluded;
      expect(b).toEqual(a);
    }
  });

  test('변이: 종목 제외 규칙(기업행위 봉 포함 창 제외)을 끄면 결과가 달라진다 — 비교 대상이 실제로 그 봉을 포함', () => {
    const frames = universe('US', 900);
    const withRule = universeBaselineDetail(frames, [5], 10).byDate;
    const noCorp = frames.map((f) => ({ ...f, corpSuspect: f.corpSuspect.map(() => false) }));
    const without = universeBaselineDetail(noCorp, [5], 10).byDate;
    const diff = [...withRule.keys()].filter((d) => withRule.get(d)?.[5]?.n !== without.get(d)?.[5]?.n);
    expect(diff.length).toBeGreaterThan(0);
  });

  test('비용을 주면 같은 왕복 비용을 뺀 값, 표본 미달(minN 10) 날짜는 없음', () => {
    const frames = universe('US', 900);
    const gross = universeBaseline(frames, [5], null, 10);
    const net = universeBaseline(frames, [5], { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 }, 10);
    const d = [...gross.keys()][3];
    expect(net.get(d)![5]).toBeCloseTo(gross.get(d)![5] - 0.0065, 12);
    const few = universeBaseline(frames.slice(0, 9), [5], null, 10);
    expect(few.size).toBe(0);
  });

  test('시장이 섞이면 거부', () => {
    expect(() => universeBaselineDetail([...universe('US', 1).slice(0, 2), ...universe('KR', 2).slice(0, 2)], [5], 10)).toThrow();
  });
});

describe('생존편향 δ·동일가중·ETF 보유', () => {
  test('cagr: 252거래일 동안 2배면 100%, 점 1개면 null', () => {
    const v = Array.from({ length: 253 }, (_, i) => 100 * 2 ** (i / 252));
    expect(cagr({ dates: v.map(String), values: v }, 252)).toBeCloseTo(1, 10);
    expect(cagr({ dates: ['a'], values: [1] }, 252)).toBeNull();
  });
  test('δ = max(0, EW − ETF), 거래당 = δ × 보유일/252, 음수면 0', () => {
    const up = (r: number) => { const v = Array.from({ length: 253 }, (_, i) => (1 + r) ** (i / 252)); return { dates: v.map(String), values: v }; };
    const d = survivorshipDelta(up(0.2), up(0.1), 252);
    expect(d.deltaAnnual).toBeCloseTo(0.1, 10);
    expect(d.perTradeFor(5)).toBeCloseTo(0.1 * 5 / 252, 12);
    expect(survivorshipDelta(up(0.05), up(0.1), 252).deltaAnnual).toBe(0);
    expect(survivorshipDelta({ dates: [], values: [] }, up(0.1), 252).deltaAnnual).toBeNull();
  });
  test('동일가중 월 리밸런스: 모든 종목 +1%/일 이면 가치도 +1%/일(비용 0), 비용은 첫 매수에서 왕복/2', () => {
    const dates = weekdays('2025-01-02', 30);
    const fs = Array.from({ length: 3 }, (_, s) => frame(`S${s}`, barsFromCloses(dates, dates.map((_, i) => (10 + s) * 1.01 ** i))));
    const ew = equalWeightMonthly(fs, dates[0], dates[29], null);
    expect(ew.values[0]).toBeCloseTo(1, 12);
    expect(ew.values[10] / ew.values[9]).toBeCloseTo(1.01, 10);
    const ewc = equalWeightMonthly(fs, dates[0], dates[29], { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 });
    expect(ewc.values[0]).toBeCloseTo(1 - 0.00325, 10);
  });
  test('ETF 보유: 매수·매도 각 왕복/2', () => {
    const dates = weekdays('2025-01-02', 5);
    const f = frame('AMS:SPY', barsFromCloses(dates, [100, 101, 102, 103, 110]));
    const s = buyAndHold(f, dates[0], dates[4], { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 });
    expect(s.values[0]).toBeCloseTo(1 - 0.00325, 12);
    expect(s.values[4]).toBeCloseTo((1 - 0.00325) * 1.1 * (1 - 0.00325), 12);
  });
});
