/**
 * T-096 처리 흐름 — IS 실행이 isTo 뒤(OOS) 봉을 쓰지 않음(뒤 봉을 난수로 바꿔도 IS·counts 결과 동일, 잘라 넣어도 동일),
 * runCombo 의 초과수익·민감도·δ·에피소드 정의, counts 필터 후 건수 = IS 청산 에피소드 수(정의 일치). 합성 자료만.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as engine from '../backtest';
import { universeBaselineDetail } from '../backtest/baseline';
import { roundTrip } from '../backtest/costs';
import { toEpisodes } from '../backtest/episodes';
import { indexOfDate } from '../backtest/frames';
import { countCombo, runCombo, scanSignals, type ComboContext } from '../backtest/pipeline';
import { universeIndex } from '../backtest/regime';
import { walkCloses, walkFrame, weekdays } from './backtest-fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../../../../scripts/profit-engine/backtest-runner-core.js');

const ROOT = path.resolve(__dirname, '../../../..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, core.PATHS.registry), 'utf8'));

function rows(nSyms: number, scrambleAfter: string | null, cutAfter: string | null = null) {
  const dates = weekdays('2023-08-17', 900).filter((d) => d <= '2026-10-23');
  const out: Array<Record<string, unknown>> = [];
  const syms = [...Array.from({ length: nSyms }, (_, s) => `NAS:P${s}`), 'AMS:SPY'];
  syms.forEach((sym, s) => {
    const closes = walkCloses(dates.length, 50 + s, 80 + s, 0.03);
    const alt = walkCloses(dates.length, 9999 + s, 300, 0.08);
    dates.forEach((d, k) => {
      if (cutAfter && d > cutAfter) return;
      const c = scrambleAfter && d > scrambleAfter ? alt[k] : closes[k];
      const pc = k ? (scrambleAfter && dates[k - 1] > scrambleAfter ? alt[k - 1] : closes[k - 1]) : c;
      out.push({ market: 'US', symbol: sym, d, open: pc, high: Math.max(pc, c) * 1.01, low: Math.min(pc, c) * 0.99, close: c, volume: 1e6, turnover: 1e10, flags: null });
    });
  });
  return out;
}

const reg = JSON.parse(JSON.stringify(REG));
reg.universe.expectedSymbols.US = 8;
reg.bootstrap.iters = 50;

describe('IS 는 OOS 가격을 보지 않는다', () => {
  test('isTo 뒤 봉을 난수로 바꿔도 IS 결과(격자 전수 지표·판정·고원)가 같다', () => {
    const a = core.runIs(engine, rows(8, null), reg, 'US', ['rsi-oversold-daily']);
    const b = core.runIs(engine, rows(8, reg.splits.US.isTo), reg, 'US', ['rsi-oversold-daily']);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.strategies[0].grid).toHaveLength(24);
    expect(a.window.dataMax).toBe('2025-09-30');
  }, 120_000);
  test('M76: counts 는 isTo 뒤 봉과 무관 — 값을 바꿔도, 아예 잘라 넣어도 같다', () => {
    const a = core.runCounts(engine, rows(8, null), reg, 'US', ['rsi-oversold-daily', 'control-spike-contraction']);
    const b = core.runCounts(engine, rows(8, reg.splits.US.isTo), reg, 'US', ['rsi-oversold-daily', 'control-spike-contraction']);
    const c = core.runCounts(engine, rows(8, null, reg.splits.US.isTo), reg, 'US', ['rsi-oversold-daily', 'control-spike-contraction']);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.window.dataMax).toBe('2025-09-30');
  });
  test('대조: OOS 실행은 isTo 뒤 봉에 반응한다(시험이 실제로 다른 자료를 넣고 있음)', () => {
    const chosen = { th: 38, hold: 5, stop: 0.03, regime: false };
    const isRow = { params: chosen, metrics: { annualReturn: 0.1 } };
    const a = core.runOos(engine, rows(8, null), reg, 'US', 'rsi-oversold-daily', chosen, isRow);
    const b = core.runOos(engine, rows(8, reg.splits.US.isTo), reg, 'US', 'rsi-oversold-daily', chosen, isRow);
    expect(JSON.stringify(b.metrics)).not.toBe(JSON.stringify(a.metrics));
    expect(a.window.dataMax).toBe('2026-10-23');
  }, 60_000);
});

describe('runCombo — 정의', () => {
  const frames = Array.from({ length: 12 }, (_, s) => walkFrame(`NAS:R${s}`, '2024-01-02', 260, 700 + s, 'US', 0.035));
  const cost = { feeRoundTrip: 0.005, slippage: 0.0015, stopSlippage: 0.0025 };
  const fillOpts = { gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip' as const, adtvWindow: 20, adtvMaxShare: 0.001, slotAmount: 1500 };
  const ctx: ComboContext = {
    frames, cost, fillOpts, limitChasePct: 0.005, stressMultiplier: 1.5, reportMultipliers: [2.0],
    regime: { index: universeIndex(frames), ma: 100 }, windowDays: 5, cooldownToPortfolio: true, window: { from: '2024-03-01', to: '2024-12-31' }, folds: null,
    bootstrap: { iters: 100, seed: 1, auxSeeds: [1, 2] }, deltaAnnual: 0.02, tradingDays: 252, minN: 10, symbolShareDenominator: 'total_net',
    portfolio: { capital: 15000, slots: 10, slotPct: 0.1, gapUp: 0.02, gapDown: 0.03, gapBoundary: 'skip', adtvWindow: 20, adtvMaxShare: 0.001, integerShares: true },
    benchmark: { equity: null },
  };
  const mod = engine.signalModule('rsi-oversold-daily')!;
  const P = { maMult: 1.005, rsiPeriod: 14, maPeriod: 20, th: 45 };
  const r = runCombo(mod, P, { hold: 5, stop: 0.05, regime: false }, ctx);
  test('초과수익 = 거래 순수익 − (같은 D0 유니버스 평균 − 왕복)', () => {
    const base = universeBaselineDetail(frames, [5], 10).byDate;
    const taken = r.episodes.filter((e) => engine.isTaken(e.fill) && e.excess[5] !== undefined);
    expect(taken.length).toBeGreaterThan(5);
    for (const e of taken) expect(e.excess[5]).toBeCloseTo(e.fill!.netRet - (base.get(e.signal.d0)![5]!.mean - roundTrip(cost)), 12);
  });
  test('민감도: ×1.5 < 기본 순기대값, ×2.0(보고) < ×1.5', () => {
    expect(r.metrics.stressNetMean!).toBeLessThan(r.metrics.netMean!);
    expect(r.metrics.stressReport).toHaveLength(1);
    expect(r.metrics.stressReport[0].multiplier).toBe(2);
    expect(r.metrics.stressReport[0].netMean!).toBeLessThan(r.metrics.stressNetMean!);
  });
  test('M30: δ_trade = δ_annual × 평균 보유 거래일 / tradingDays(252)', () => {
    const taken = r.episodes.filter((e) => engine.isTaken(e.fill));
    const days = taken.map((e) => { const f = frames.find((x) => x.symbol === e.signal.symbol)!; return indexOfDate(f, e.fill!.exitDate) - indexOfDate(f, e.fill!.entryDate) + 1; });
    const avg = days.reduce((a, b) => a + b, 0) / days.length;
    expect(r.metrics.deltaTrade!).toBeCloseTo(0.02 * avg / 252, 15);
    const r365 = runCombo(mod, P, { hold: 5, stop: 0.05, regime: false }, { ...ctx, tradingDays: 365 });
    expect(r365.metrics.deltaTrade!).toBeCloseTo(0.02 * avg / 365, 15);
  });
  test('M33: 에피소드 차단 창 = max(windowDays, hold) — hold 10 이면 hold 5 보다 에피소드가 적고 toEpisodes(raw, 5, 10) 와 같다', () => {
    const r10 = runCombo(mod, P, { hold: 10, stop: 0.05, regime: false }, ctx);
    const raw = scanSignals(frames, mod, P, '2024-03-01', '2024-12-31');
    expect(r10.counts.episodes).toBe(toEpisodes(raw, 5, 10).length);
    expect(r.counts.episodes).toBe(toEpisodes(raw, 5, 5).length);
    expect(r10.counts.episodes).toBeLessThan(r.counts.episodes);
  });
  test('N11·N12 ⑧ 포트폴리오 재발화 차단 배선: runCombo 가 cooldown = max(windowDays, hold) 를 넘긴다 — cooldown 으로 뺀 신호 수 = 원신호 − 에피소드(hold 5·10 각각)', () => {
    const raw = scanSignals(frames, mod, P, '2024-03-01', '2024-12-31');
    for (const hold of [5, 10]) {
      const rh = runCombo(mod, P, { hold, stop: 0.05, regime: false }, ctx);
      // 시뮬레이터는 매 신호를 차단 규칙에 먼저 통과시키므로(보유·슬롯 판단 전) 차단 수는 toEpisodes 와 정확히 맞아야 한다
      expect(rh.portfolio.skipped.cooldown).toBe(raw.length - toEpisodes(raw, 5, hold).length);
      expect(rh.portfolio.skipped.cooldown).toBe(rh.counts.candidates - rh.counts.episodes);
      expect(rh.portfolio.skipped.cooldown).toBeGreaterThan(0);
    }
    // 차단 길이를 windowDays 로만 하면(hold 무시) hold 10 에서 수가 달라진다 — 시험이 둘을 구별할 수 있는 자료임을 확인
    expect(raw.length - toEpisodes(raw, 5, 5).length).not.toBe(raw.length - toEpisodes(raw, 5, 10).length);
    // registry 스위치가 꺼지면 차단 0
    expect(runCombo(mod, P, { hold: 10, stop: 0.05, regime: false }, { ...ctx, cooldownToPortfolio: false }).portfolio.skipped.cooldown).toBe(0);
  });
  test('N11·N12 진입 집합: 신호가 매 봉 나는 종목에서 포트폴리오 진입 수 = toEpisodes 에피소드 수(hold 5·10, 손절 없음·갭·슬롯 제약 없음)', () => {
    const fr = Array.from({ length: 12 }, (_, s) => walkFrame(`NAS:Q${String(s).padStart(2, '0')}`, '2024-01-02', 200, 900 + s, 'US', 0.004));
    const every = { minBars: 1, evaluate: (f: engine.Frame, i: number): engine.Signal | null => (f.symbol <= 'NAS:Q02' ? { symbol: f.symbol, d0: f.bars[i].date, d0Index: i, score: 0 } : null) };
    const c2: ComboContext = { ...ctx, frames: fr, regime: { index: universeIndex(fr), ma: 100 }, window: { from: '2024-03-01', to: '2024-08-30' }, bootstrap: { iters: 20, seed: 1, auxSeeds: [] } };
    for (const hold of [5, 10]) {
      const raw = scanSignals(fr, every, {}, c2.window.from, c2.window.to);
      const eps = toEpisodes(raw, 5, hold);
      expect(raw.length).toBeGreaterThan(300);
      const r = runCombo(every, {}, { hold, stop: null, regime: false }, c2);
      const s = r.portfolio.skipped;
      expect(s.cooldown).toBe(raw.length - eps.length);
      expect([s.gap, s.noSlot, s.liquidity, s.cash, s.priceAboveSlot]).toEqual([0, 0, 0, 0, 0]);
      // 에피소드 시작 신호는 전부 진입(창 끝에서 다음 봉이 창 밖이면 noForwardBars)
      expect(r.portfolio.entries + s.noForwardBars).toBe(eps.length);
      // 쿨다운 없이(N12)라면 보유가 끝난 다음 날마다 재진입해 더 많이 들어간다
      expect(runCombo(every, {}, { hold, stop: null, regime: false }, { ...c2, cooldownToPortfolio: false }).portfolio.entries).toBeGreaterThan(r.portfolio.entries);
    }
  });
  test('보조 시드(⑩) 하한 2개 보고, 건수 합 = 에피소드, 지정가 체결률 0~1, 창 밖 D0 없음', () => {
    expect(r.metrics.excessLoAux).toHaveLength(2);
    expect(typeof r.metrics.seedSensitive).toBe('boolean');
    const c = r.counts;
    expect(c.taken + c.gapSkip + c.liquiditySkip + c.unclosed).toBe(c.episodes);
    expect(r.limitModel.fillRate === null || (r.limitModel.fillRate >= 0 && r.limitModel.fillRate <= 1)).toBe(true);
    expect(r.episodes.every((e) => e.signal.d0 >= '2024-03-01' && e.signal.d0 <= '2024-12-31')).toBe(true);
    expect(r.portfolio.entries).toBeGreaterThan(0);
  });
  test('(b) counts 필터 후 진입 건수·주·종목 = runCombo 의 청산 에피소드(같은 정의 — G1 숫자가 IS 표본과 맞는다)', () => {
    for (const hold of [5, 10]) {
      const rc = runCombo(mod, P, { hold, stop: 0.05, regime: false }, ctx);
      const cc = countCombo(frames, mod, P, { hold, regime: false }, ctx.window, ctx.regime, 5, { ...fillOpts, slotAmount: 1500 });
      expect(cc.afterFilters!.entered).toBe(rc.counts.taken);
      expect(cc.afterFilters!.gapSkip).toBe(rc.counts.gapSkip);
      expect(cc.afterFilters!.weeks).toBe(rc.metrics.weeks);
      expect(cc.afterFilters!.symbols).toBe(rc.metrics.symbols);
    }
  });
});
