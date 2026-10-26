/**
 * T-096 신호 함수(S1·S7) — 발화/비발화, 룩어헤드 변이(미래 봉 난수 덮기 → 결과 불변), 봉 부족·NaN·제외 봉, 지표 패리티.
 */
import { rsi as rsiApp, sma as smaApp } from '@/lib/strategy/indicators';
import { scanSignals, countCombo } from '../backtest/pipeline';
import * as S1 from '../backtest/signals/rsi-oversold-daily';
import * as S7 from '../backtest/signals/control-spike-contraction';
import { signalModule, SIGNALS } from '../backtest/signals';
import type { Bar, Frame, Params, Signal } from '../backtest/types';
import { bar, barsFromCloses, frame, scrambleFuture, walkCloses, walkFrame, weekdays } from './backtest-fixtures';

/** 시험 하네스 자체 점검용 — 일부러 미래 봉을 보는 신호 함수(이것은 룩어헤드 시험에서 반드시 걸려야 한다). */
const leaky = (f: Frame, i: number): Signal | null => (f.bars[i + 1] && f.bars[i + 1].close > f.bars[i].close ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null);

function lookaheadViolations(fn: (f: Frame, i: number, p: Params) => Signal | null, frames: Frame[], params: Params): number {
  let bad = 0;
  for (const f of frames) {
    for (let i = 0; i < f.bars.length - 1; i += 3) {
      const a = JSON.stringify(fn(f, i, params));
      for (const seed of [1, 2, 3]) if (JSON.stringify(fn(scrambleFuture(f, i, seed + i), i, params)) !== a) bad++;
    }
  }
  return bad;
}

const frames = Array.from({ length: 6 }, (_, s) => walkFrame(`NAS:W${s}`, '2024-01-02', 160, 11 + s, 'US', 0.03));
/** registry strategies[].fixed 와 같은 고정값(엔진 신호 함수는 이것을 params 로 받는다 — 코드 상수 없음). */
const F1 = { maMult: 1.005, rsiPeriod: 14, maPeriod: 20 };
const F7 = { spike: 0.15, atrPeriod: 5 };

describe('룩어헤드 차단 — evaluate(frame, i) 는 bars[i+1..] 를 바꿔도 같다', () => {
  test('하네스 자체 점검: 미래를 보는 함수는 위반이 잡힌다', () => {
    expect(lookaheadViolations(leaky, frames, {})).toBeGreaterThan(0);
  });
  test.each([30, 35, 38])('S1 th=%p 위반 0', (th) => {
    expect(lookaheadViolations(S1.evaluate, frames, { ...F1, th })).toBe(0);
  });
  test('S7 위반 0', () => {
    expect(lookaheadViolations(S7.evaluate, frames, F7)).toBe(0);
  });
  test('S1 은 합성 자료에서 실제로 발화한다(빈 결과로 통과하는 것 방지)', () => {
    expect(scanSignals(frames, { evaluate: S1.evaluate, minBars: 22 }, { ...F1, th: 38 }, '2000-01-01', '2100-01-01').length).toBeGreaterThan(3);
  });
});

describe('S1 rsi-oversold-daily — RSI14 < th ∧ close < MA20×1.005 ∧ (양봉 ∨ 저점 유지)', () => {
  test('독립 계산과 위치마다 일치(지표 = strategy/indicators 같은 수식, 소수 8자리)', () => {
    for (let s = 0; s < 10; s++) {
      const f = walkFrame(`X${s}`, '2024-01-02', 120, 100 + s, 'US', 0.03);
      const closes = f.bars.map((b) => b.close);
      const R = rsiApp(closes, 14), M = smaApp(closes, 20);
      for (let i = 0; i < f.bars.length; i++) {
        const got = S1.evaluate(f, i, { ...F1, th: 38 });
        const b = f.bars[i];
        const want = i >= 21 && R[i] !== null && M[i] !== null && R[i]! < 38 && b.close < M[i]! * 1.005 && (b.close > b.open || b.low >= f.bars[i - 1].low);
        expect(!!got).toBe(want);
        if (got) { expect(got.score).toBeCloseTo(R[i]!, 8); expect(got.d0).toBe(b.date); expect(got.d0Index).toBe(i); }
      }
    }
  });
  test('th 경계: RSI 가 th 와 같으면 미발화(<), 바로 위 th 면 발화', () => {
    const f = walkFrame('E', '2024-01-02', 200, 77, 'US', 0.04);
    const hits = scanSignals([f], { evaluate: S1.evaluate, minBars: 22 }, { ...F1, th: 100 }, '2000-01-01', '2100-01-01');
    expect(hits.length).toBeGreaterThan(0);
    const h = hits[0];
    expect(S1.evaluate(f, h.d0Index, { ...F1, th: h.score })).toBeNull();
    expect(S1.evaluate(f, h.d0Index, { ...F1, th: h.score + 1e-9 })).not.toBeNull();
  });
  const decline = (last: Partial<Bar>) => {
    const d = weekdays('2024-01-02', 30);
    const bars = barsFromCloses(d, d.map((_, k) => 100 - k));
    bars[29] = { ...bars[29], ...last };
    return frame('DN', bars);
  };
  test('하락 끝 양봉 → 발화, 음봉이고 저점도 깨면 미발화, 음봉이어도 저점 유지면 발화', () => {
    expect(S1.evaluate(decline({ open: 70, close: 71.5, low: 69.9, high: 72 }), 29, { ...F1, th: 30 })).not.toBeNull();
    expect(S1.evaluate(decline({ open: 72, close: 71, low: 60, high: 72 }), 29, { ...F1, th: 30 })).toBeNull();
    expect(S1.evaluate(decline({ open: 72, close: 71, low: 72.5, high: 73 }), 29, { ...F1, th: 30 })).not.toBeNull();
  });
  test('종가 < MA20×1.005 경계(변이: 배수 1.005 를 1 로 바꾸면 첫 경우가 미발화로 바뀐다)', () => {
    const d = weekdays('2024-01-02', 30);
    const at = (c: number) => frame('F', barsFromCloses(d, d.map((_, k) => (k < 29 ? 100 : c))));
    // MA20 = (19×100 + c)/20 → c=100.4: MA 100.02, ×1.005 = 100.52 → 발화(MA 보다는 위) · c=100.6: MA×1.005 = 100.53 → 미발화
    expect(S1.evaluate(at(100.4), 29, { ...F1, th: 101 })).not.toBeNull();
    expect(S1.evaluate(at(100.6), 29, { ...F1, th: 101 })).toBeNull();
  });
  test('봉 부족(< 22)·NaN·창 안 제외 봉 → null, th 형식 오류는 예외', () => {
    const f = decline({ open: 70, close: 71.5, low: 69.9, high: 72 });
    expect(S1.evaluate(f, 20, { ...F1, th: 99 })).toBeNull();
    const nan = { ...f, bars: f.bars.map((b, k) => (k === 15 ? { ...b, close: NaN } : b)) };
    expect(S1.evaluate(nan, 29, { ...F1, th: 30 })).toBeNull();
    const ex = { ...f, excluded: f.excluded.map((_, k) => k === 25) };
    expect(S1.evaluate(ex, 29, { ...F1, th: 30 })).toBeNull();
    expect(() => S1.evaluate(f, 29, { ...F1, th: true })).toThrow();
    expect(S1.evaluate(f, 99, { ...F1, th: 30 })).toBeNull();
  });
});

describe('S7 control-spike-contraction (해석 정의)', () => {
  function spikeFrame(opts: { spike?: number; contract?: boolean; breakout?: boolean } = {}) {
    const { spike = 0.2, contract = true, breakout = true } = opts;
    const d = weekdays('2024-01-02', 40);
    const bars: Bar[] = [];
    for (let k = 0; k < 40; k++) {
      let c = 100;
      if (k >= 20 && k <= 28) c = 100 * (1 + spike * ((k - 19) / 9));
      if (k > 28) c = 100 * (1 + spike);
      const wide = k <= 33 || !contract;
      const r = wide ? 3 : 0.2;
      bars.push(bar(d[k], c, c + r, c - r, c));
    }
    if (breakout) bars[39] = { ...bars[39], close: bars[39].close + 1, high: bars[39].close + 1.5 };
    return frame('SP', bars);
  }
  test('급등(+20%)·수축·재돌파 → 발화', () => {
    expect(S7.evaluate(spikeFrame(), 39, F7)).not.toBeNull();
  });
  test('급등 +10% (< 15%) → 미발화', () => {
    expect(S7.evaluate(spikeFrame({ spike: 0.1 }), 39, F7)).toBeNull();
  });
  test('수축 없음 → 미발화, 재돌파 없음 → 미발화, 봉 부족 → null', () => {
    expect(S7.evaluate(spikeFrame({ contract: false }), 39, F7)).toBeNull();
    expect(S7.evaluate(spikeFrame({ breakout: false }), 39, F7)).toBeNull();
    expect(S7.evaluate(spikeFrame(), 25, F7)).toBeNull();
  });
});

describe('신호 목록·counts 조립', () => {
  test('1단계 구현은 S1·S7 둘뿐(S2·S4·Tier B 미구현)', () => {
    expect(Object.keys(SIGNALS).sort()).toEqual(['control-spike-contraction', 'rsi-oversold-daily']);
    expect(signalModule('pullback-trend-daily')).toBeNull();
    expect(signalModule('xs-momentum')).toBeNull();
    expect(signalModule('toString')).toBeNull();
  });
  test('countCombo: 레짐 off/on·hold 별 에피소드, closable 은 보유 창이 봉 안에 있는 것만', () => {
    const fs = Array.from({ length: 4 }, (_, s) => walkFrame(`C${s}`, '2024-01-02', 200, 300 + s, 'US', 0.04));
    const mod = signalModule('rsi-oversold-daily')!;
    const c5 = countCombo(fs, mod, { ...F1, th: 45 }, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, null);
    const c10 = countCombo(fs, mod, { ...F1, th: 45 }, { hold: 10, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, null);
    expect(c5.candidates).toBe(c10.candidates);
    expect(c10.episodes).toBeLessThanOrEqual(c5.episodes);
    expect(c5.closableEpisodes).toBeLessThanOrEqual(c5.episodes);
    expect(c5.weeks).toBeGreaterThan(0);
    expect(() => countCombo(fs, mod, { ...F1, th: 45 }, { hold: 5, regime: true }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, null)).toThrow();
  });
  test('M31: closable = D0+hold < 봉 수(보유 창이 마지막 봉에서 끝나면 포함, 넘으면 제외)', () => {
    const d = weekdays('2024-01-02', 30);
    const flat = (sym: string) => frame(sym, d.map((x) => bar(x, 100, 100, 100, 100)));
    const at: Record<string, number> = { A: 24, B: 25 };
    const fn = { minBars: 1, evaluate: (f: Frame, i: number): Signal | null => (i === at[f.symbol] ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null) };
    const c = countCombo([flat('A'), flat('B')], fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, null);
    expect(c.episodes).toBe(2);
    expect(c.closableEpisodes).toBe(1);
    expect(c.symbols).toBe(1);
  });
  test('(b) V3 필터 후 건수: 갭·거래정지·유동성·창 결측을 따로 세고, 진입 건수만 U5 비교 대상', () => {
    const d = weekdays('2024-01-02', 40);
    const mk = (sym: string, over: Record<number, Partial<Bar>> = {}, turnover = 1e10) => frame(sym, d.map((x, k) => bar(x, 100, 100, 100, 100, { turnover, ...(over[k] || {}) })));
    const fs = [
      mk('A'),                                              // 진입
      mk('B', { 26: { open: 103, high: 103 } }),            // 갭 +3% → gapSkip
      mk('C', { 26: { volume: 0, flags: 'zero_volume' } }), // 거래정지 → haltSkip
      mk('D', {}, 1000),                                    // ADTV 1000 × 0.1% < 슬롯 → liquiditySkip
      mk('E', { 28: { flags: 'adj_stale' } }),              // 보유 창에 제외 봉 → windowBroken
    ];
    const fn = { minBars: 1, evaluate: (f: Frame, i: number): Signal | null => (i === 25 ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null) };
    const filters = { gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip' as const, adtvWindow: 20, adtvMaxShare: 0.001, slotAmount: 1500 };
    const c = countCombo(fs, fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, filters);
    expect(c.closableEpisodes).toBe(5);
    expect(c.afterFilters).toEqual({ entered: 1, weeks: 1, symbols: 1, gapSkip: 1, haltSkip: 1, liquiditySkip: 1, windowBroken: 1 });
  });
  test('N04 유동성 경계: 슬롯 > ADTV20 × adtvMaxShare 일 때만 제외(경계 = 진입), 기준 배수가 바뀌면 결과가 바뀐다', () => {
    const d = weekdays('2024-01-02', 40);
    // 슬롯 1500, share 0.001 → ADTV 1.5e6 이 경계. 1.4e6(1400 < 1500 → 제외)·1.5e6(같음 → 진입)·1.6e6(진입)·1.0e5(제외)
    const mk = (sym: string, turnover: number) => frame(sym, d.map((x) => bar(x, 100, 100, 100, 100, { turnover })));
    const fs = [mk('L1', 1.4e6), mk('L2', 1.5e6), mk('L3', 1.6e6), mk('L4', 1e5)];
    const fn = { minBars: 1, evaluate: (f: Frame, i: number): Signal | null => (i === 25 ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null) };
    const filters = { gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip' as const, adtvWindow: 20, adtvMaxShare: 0.001, slotAmount: 1500 };
    const c = countCombo(fs, fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, filters);
    expect(c.afterFilters).toEqual(expect.objectContaining({ entered: 2, liquiditySkip: 2, symbols: 2 }));
    // share 를 10배로 하면 1.4e6 도 통과(1.0e5 는 그래도 제외) — 기준이 share 에 비례함
    const c10 = countCombo(fs, fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, { ...filters, adtvMaxShare: 0.01 });
    expect(c10.afterFilters).toEqual(expect.objectContaining({ entered: 3, liquiditySkip: 1 }));
    // 거래대금 결측(ADTV 계산 불가)·창이 짧음(D0 < 19) → 제외
    const nul = frame('L5', d.map((x, k) => bar(x, 100, 100, 100, 100, { turnover: k === 20 ? null : 1e10 })));
    expect(countCombo([nul], fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, filters).afterFilters!.liquiditySkip).toBe(1);
  });
  test('N07 필터 후 주·종목은 진입한 에피소드 기준(필터 전 closable 기준이 아님)', () => {
    const d = weekdays('2024-01-01', 60); // 월요일 시작
    const at: Record<string, number> = { A: 25, B: 30, C: 35, D: 40 }; // 서로 다른 주
    const mk = (sym: string, over: Record<number, Partial<Bar>> = {}) => frame(sym, d.map((x, k) => bar(x, 100, 100, 100, 100, { turnover: 1e10, ...(over[k] || {}) })));
    const fs = [
      mk('A'),                                              // 진입(1주차)
      mk('B', { [at.B + 1]: { open: 103, high: 103 } }),    // 갭 → 제외
      mk('C', { [at.C + 1]: { volume: 0, flags: 'zero_volume' } }), // 거래정지 → 제외
      mk('D', {}),                                          // 진입(다른 주)
    ];
    const fn = { minBars: 1, evaluate: (f: Frame, i: number): Signal | null => (i === at[f.symbol] ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null) };
    const filters = { gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip' as const, adtvWindow: 20, adtvMaxShare: 0.001, slotAmount: 1500 };
    const c = countCombo(fs, fn, {}, { hold: 5, regime: false }, { from: '2000-01-01', to: '2100-01-01' }, { index: null, ma: 100 }, 5, filters);
    expect(c.closableEpisodes).toBe(4);
    expect(c.weeks).toBe(4);
    expect(c.symbols).toBe(4);
    expect(c.afterFilters).toEqual({ entered: 2, weeks: 2, symbols: 2, gapSkip: 1, haltSkip: 1, liquiditySkip: 0, windowBroken: 0 });
  });
  test('scanSignals 는 [from, to] 의 D0 만', () => {
    const f = walkFrame('R', '2024-01-02', 200, 5, 'US', 0.05);
    const all = scanSignals([f], { evaluate: S1.evaluate, minBars: 22 }, { ...F1, th: 60 }, '2000-01-01', '2100-01-01');
    const mid = scanSignals([f], { evaluate: S1.evaluate, minBars: 22 }, { ...F1, th: 60 }, '2024-04-01', '2024-06-30');
    expect(mid.every((s) => s.d0 >= '2024-04-01' && s.d0 <= '2024-06-30')).toBe(true);
    expect(mid.length).toBeLessThan(all.length);
    expect(walkCloses(3, 1)).toEqual(walkCloses(3, 1));
  });
});
