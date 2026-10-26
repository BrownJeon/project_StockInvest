/**
 * T-096 처리 흐름 조립(§C-3) — 신호 스캔 → 레짐 → 에피소드 → (counts 는 여기서 멈춤) → 체결 → 기준선 초과수익 → 지표 → 포트폴리오.
 * 순수 함수. 입력 Frame 은 호출자가 구간에 맞게 잘라서 준다 — **IS 실행은 isTo 뒤 봉을 받지 않는다**(OOS 가격이 IS 결과에 섞이지 않게,
 * 그래서 IS 끝 무렵 에피소드는 보유 창이 끊겨 미청산으로 빠진다 — 해석, 보고 대상).
 *
 * countCombo 는 표본 수만 센다 — 체결(fill)·기준선·지표·포트폴리오를 **부르지 않는다**(러너 시험이 이것을 고정한다).
 */
import { universeBaselineDetail } from './baseline';
import { roundTrip, scaleSlippage, stopCost } from './costs';
import { toEpisodes } from './episodes';
import { adtv, d1openFill, gapSkip, isTaken, limitFill, type FillOptions } from './fill';
import { FLAG_ZERO_VOLUME, hasFlag, indexOfDate, weekKey, windowBroken } from './frames';
import { annualizedReturn, clusterBootstrapCI, expectancy, foldStats, maxDrawdown, sharpe, type SymbolShareDenominator } from './metrics';
import { simulate, type SimSkipped } from './portfolio';
import { regimeOkAt } from './regime';
import type { CostModel, Episode, FoldWindow, Frame, Params, PortfolioConfig, Series, Signal } from './types';

export interface SignalFn { evaluate: (frame: Frame, i: number, params: Params) => Signal | null; minBars: number }

/** D0 가 [from, to] 인 모든 신호. 각 Frame 의 위치 i 마다 evaluate(frame, i) — evaluate 는 bars[0..i] 만 본다. */
export function scanSignals(frames: Frame[], fn: SignalFn, params: Params, from: string, to: string): Signal[] {
  const out: Signal[] = [];
  for (const f of frames) {
    for (let i = Math.max(0, fn.minBars - 1); i < f.bars.length; i++) {
      const d = f.bars[i].date;
      if (d < from) continue;
      if (d > to) break;
      const s = fn.evaluate(f, i, params);
      if (s) out.push(s);
    }
  }
  return out;
}

export function applyRegime(signals: Signal[], index: Series | null, on: boolean, ma: number): Signal[] {
  if (!on) return signals;
  if (!index) throw new Error('regime on 인데 지수가 없다');
  return signals.filter((s) => regimeOkAt(index, s.d0, ma));
}

export interface AfterFilterCounts {
  entered: number;             // 갭·유동성·거래정지 필터를 통과해 진입했을 에피소드(= IS 의 청산 에피소드 수와 같은 정의)
  weeks: number;
  symbols: number;
  gapSkip: number;
  haltSkip: number;            // 진입 봉 거래 불가(제외 봉·거래량 0·zero_volume·시가 결측) — fill 의 liquidity_skip 일부
  liquiditySkip: number;       // 슬롯 > ADTV20 × adtvMaxShare
  windowBroken: number;        // 보유 창에 결측 구간·제외 봉(체결 null)
}

export interface ComboCounts {
  candidates: number;          // 레짐 필터 뒤 원신호 수
  episodes: number;            // 에피소드 수(재발화 차단 max(windowDays, hold)) — 필터 **전**
  closableEpisodes: number;    // 그중 보유 창(D0+hold)이 주어진 봉 안에 있는 것(봉 존재만 확인)
  weeks: number;               // closable 에피소드의 서로 다른 주(D0 월요일) 수
  symbols: number;             // closable 에피소드의 서로 다른 종목 수
  afterFilters: AfterFilterCounts | null;
}

/** counts 의 진입 필터 설정(registry execution + 슬롯 금액 = 자본 × slotPct 고정). */
export interface CountFilters { gapUp: number; gapDown: number; gapBoundary: 'skip' | 'enter'; adtvWindow: number; adtvMaxShare: number; slotAmount: number }

/**
 * counts 단계: 표본 수만. 수익 계산 경로(fill·baseline·metrics·portfolio)를 부르지 않는다.
 * 필터 후 건수(v1.1 (b) V3)는 **진입 시점까지의 정보만** 읽는다: D0 종가·D0 까지 거래대금(ADTV)·D+1 시가·D+1 거래 정지 표시(거래량 0·zero_volume)·
 * 보유 창의 날짜·제외 표시(결측 여부). D+1 이후의 가격(고가·저가·종가)은 읽지 않는다 — d1openFill 과의 차이: 진입 봉의 고가·저가·종가 양수 확인을 하지 않는다
 * (daily_bars.close 는 NOT NULL 이고 고가·저가 결측은 실측 0 — 보고 대상).
 */
export function countCombo(frames: Frame[], fn: SignalFn, params: Params, exec: { hold: number; regime: boolean },
  window: { from: string; to: string }, regime: { index: Series | null; ma: number }, windowDays: number, filters: CountFilters | null): ComboCounts {
  const raw = applyRegime(scanSignals(frames, fn, params, window.from, window.to), regime.index, exec.regime, regime.ma);
  const eps = toEpisodes(raw, windowDays, exec.hold);
  const bySym = new Map(frames.map((f) => [f.symbol, f]));
  const closable = eps.filter((s) => s.d0Index + exec.hold < (bySym.get(s.symbol)?.bars.length ?? 0));
  let afterFilters: AfterFilterCounts | null = null;
  if (filters) {
    const a = { entered: 0, gapSkip: 0, haltSkip: 0, liquiditySkip: 0, windowBroken: 0 };
    const kept: Signal[] = [];
    for (const s of closable) {
      const f = bySym.get(s.symbol)!;
      const i = s.d0Index, e = i + 1;
      if (windowBroken(f, i, i + exec.hold)) { a.windowBroken++; continue; }
      const be = f.bars[e];
      const halted = f.excluded[e] || !(be.volume > 0) || hasFlag(be.flags, FLAG_ZERO_VOLUME) || !(be.open > 0);
      if (halted) { a.haltSkip++; continue; }
      if (gapSkip(f.bars[i].close, be.open, filters.gapUp, filters.gapDown, filters.gapBoundary)) { a.gapSkip++; continue; }
      const v = adtv(f, i, filters.adtvWindow);
      if (v === null || filters.slotAmount > v * filters.adtvMaxShare) { a.liquiditySkip++; continue; }
      a.entered++;
      kept.push(s);
    }
    afterFilters = { ...a, weeks: new Set(kept.map((s) => weekKey(s.d0))).size, symbols: new Set(kept.map((s) => s.symbol)).size };
  }
  return {
    candidates: raw.length,
    episodes: eps.length,
    closableEpisodes: closable.length,
    weeks: new Set(closable.map((s) => weekKey(s.d0))).size,
    symbols: new Set(closable.map((s) => s.symbol)).size,
    afterFilters,
  };
}

export interface ComboContext {
  frames: Frame[];
  cost: CostModel;
  fillOpts: FillOptions;           // gap·boundary·adtv·slotAmount (registry)
  limitChasePct: number;
  stressMultiplier: number;        // 슬리피지 ×1.5 (합격 조건)
  reportMultipliers: number[];     // 슬리피지 ×2.0 등(보고만)
  regime: { index: Series | null; ma: number };
  windowDays: number;
  cooldownToPortfolio: boolean;    // v1.1 ⑧ — 포트폴리오에도 max(windowDays, hold) 재발화 차단
  window: { from: string; to: string };
  folds: FoldWindow[] | null;      // IS 만
  bootstrap: { iters: number; seed: number; auxSeeds: number[] };
  deltaAnnual: number | null;      // 생존편향 할인(연), null = 미측정
  tradingDays: number;             // registry data.tradingDaysPerYear
  minN: number;                    // registry data.universeBaselineMinN
  symbolShareDenominator: SymbolShareDenominator;
  portfolio: Omit<PortfolioConfig, 'hold' | 'stopPct' | 'cost' | 'startDate' | 'endDate' | 'cooldownBars'>;
  benchmark: { equity: Series | null };
}

export interface ComboResult {
  metrics: {
    n: number; weeks: number; symbols: number; maxSymbolShare: number | null; maxSymbolShareAux: number | null;
    excessLo: number | null; excessHi: number | null; excessT: number | null; excessMean: number | null;
    excessLoAux: Array<number | null>; seedSensitive: boolean;
    netMean: number | null; deltaTrade: number | null; pf: number | null; payoff: number | null; stressNetMean: number | null;
    stressReport: Array<{ multiplier: number; netMean: number | null }>;
    foldsPositive: number | null; foldMaxProfitShare: number | null;
    sharpe: number | null; benchSharpe: number | null; mdd: number | null; benchMdd: number | null; annualReturn: number | null;
  };
  counts: { candidates: number; episodes: number; taken: number; stops: number; gapSkip: number; liquiditySkip: number; unclosed: number; corpSuspect: number };
  limitModel: { attempted: number; filled: number; fillRate: number | null };
  portfolio: { entries: number; skipped: SimSkipped; priceAboveSlotRate: number | null; openAtEnd: number };
  episodes: Episode[];
}

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** 한 격자 조합의 수익 경로 계산(IS 또는 OOS 구간). counts 단계에서는 부르지 않는다. */
export function runCombo(fn: SignalFn, params: Params, exec: { hold: number; stop: number | null; regime: boolean }, ctx: ComboContext): ComboResult {
  const { frames, cost } = ctx;
  const bySym = new Map(frames.map((f) => [f.symbol, f]));
  const raw = applyRegime(scanSignals(frames, fn, params, ctx.window.from, ctx.window.to), ctx.regime.index, exec.regime, ctx.regime.ma);
  const epSignals = toEpisodes(raw, ctx.windowDays, exec.hold);
  const base = universeBaselineDetail(frames, [exec.hold], ctx.minN).byDate;
  const rt = roundTrip(cost);
  const stressCosts = [ctx.stressMultiplier, ...ctx.reportMultipliers].map((m) => scaleSlippage(cost, m));
  const episodes: Episode[] = [];
  const counts = { candidates: raw.length, episodes: epSignals.length, taken: 0, stops: 0, gapSkip: 0, liquiditySkip: 0, unclosed: 0, corpSuspect: 0 };
  const lim = { attempted: 0, filled: 0 };
  const holdDays: number[] = [];
  const stressNets: number[][] = stressCosts.map(() => []);
  for (const s of epSignals) {
    const f = bySym.get(s.symbol)!;
    const fill = d1openFill(f, s.d0Index, exec.hold, exec.stop, cost, ctx.fillOpts);
    const x = s.d0Index + exec.hold;
    const horizonRets: Record<number, number> = {};
    const excess: Record<number, number> = {};
    const entry = f.bars[s.d0Index + 1]?.open;
    if (x < f.bars.length && entry > 0) horizonRets[exec.hold] = f.bars[x].close / entry - 1;
    const b = base.get(s.d0)?.[exec.hold];
    // 초과수익(v1.1 ③ 확정) = 이 거래의 비용 후 수익 − (같은 D0 유니버스 평균 − 왕복 비용) — 손절 거래는 손절 비용까지 반영
    if (isTaken(fill) && b) excess[exec.hold] = fill.netRet - (b.mean - rt);
    const corp = f.corpSuspect.slice(s.d0Index, Math.min(f.bars.length, x + 1)).some(Boolean);
    episodes.push({ signal: s, fill, horizonRets, excess, week: weekKey(s.d0), corpSuspect: corp });
    if (!fill) counts.unclosed++;
    else if (fill.exitKind === 'gap_skip') counts.gapSkip++;
    else if (fill.exitKind === 'liquidity_skip') counts.liquiditySkip++;
    if (isTaken(fill)) {
      counts.taken++;
      if (fill.exitKind === 'stop') counts.stops++;
      if (corp) counts.corpSuspect++;
      holdDays.push(indexOfDate(f, fill.exitDate) - indexOfDate(f, fill.entryDate) + 1);
      stressCosts.forEach((sc, k) => stressNets[k].push(fill.grossRet - (fill.exitKind === 'stop' ? stopCost(sc) : roundTrip(sc))));
    }
    const lf = limitFill(f, s.d0Index, exec.hold, exec.stop, cost, ctx.limitChasePct, ctx.fillOpts);
    if (lf && lf.exitKind !== 'liquidity_skip') { lim.attempted++; if (lf.exitKind !== 'unfilled') lim.filled++; }
  }
  const exp = expectancy(episodes, exec.hold, ctx.symbolShareDenominator);
  const taken = episodes.filter((e) => isTaken(e.fill) && e.excess[exec.hold] !== undefined);
  const xs = taken.map((e) => e.excess[exec.hold]);
  const ws = taken.map((e) => e.week);
  const ci = clusterBootstrapCI(xs, ws, ctx.bootstrap.iters, ctx.bootstrap.seed);
  // 보조 시드(v1.1 ⑩) — 보고 전용. 주 시드와 하한 부호가 갈리면 seedSensitive
  const excessLoAux = ctx.bootstrap.auxSeeds.map((sd) => clusterBootstrapCI(xs, ws, ctx.bootstrap.iters, sd).lo);
  const sign = (v: number | null) => (v === null ? 0 : v > 0 ? 1 : -1);
  const seedSensitive = excessLoAux.some((lo) => sign(lo) !== sign(ci.lo));
  const fold = ctx.folds ? foldStats(episodes, ctx.folds, exec.hold) : null;
  const avgHold = meanOf(holdDays);
  const deltaTrade = ctx.deltaAnnual === null || avgHold === null ? null : ctx.deltaAnnual * (avgHold / ctx.tradingDays);
  // 포트폴리오: 레짐 필터 뒤 원신호를 날짜별로(재발화 차단·보유 중 중복은 시뮬레이터가 거른다)
  const byDate = new Map<string, Signal[]>();
  for (const s of raw) { if (!byDate.has(s.d0)) byDate.set(s.d0, []); byDate.get(s.d0)!.push(s); }
  const sim = simulate(frames, byDate, {
    ...ctx.portfolio, hold: exec.hold, stopPct: exec.stop, cost, startDate: ctx.window.from, endDate: ctx.window.to,
    cooldownBars: ctx.cooldownToPortfolio ? Math.max(ctx.windowDays, exec.hold) : 0,
  });
  const eqv = sim.equity.values;
  const bench = ctx.benchmark.equity;
  const pas = sim.skipped.priceAboveSlot;
  return {
    metrics: {
      n: exp.n, weeks: exp.weeks, symbols: exp.symbols, maxSymbolShare: exp.maxSymbolShare, maxSymbolShareAux: exp.maxSymbolShareAux,
      excessLo: ci.lo, excessHi: ci.hi, excessT: ci.t, excessMean: ci.mean, excessLoAux, seedSensitive,
      netMean: exp.mean, deltaTrade, pf: exp.pf, payoff: exp.payoff,
      stressNetMean: meanOf(stressNets[0]),
      stressReport: ctx.reportMultipliers.map((m, k) => ({ multiplier: m, netMean: meanOf(stressNets[k + 1]) })),
      foldsPositive: fold ? fold.positive : null, foldMaxProfitShare: fold ? fold.maxProfitShare : null,
      sharpe: eqv.length ? sharpe(eqv, ctx.tradingDays) : null, benchSharpe: bench && bench.values.length ? sharpe(bench.values, ctx.tradingDays) : null,
      mdd: eqv.length ? maxDrawdown(eqv) : null, benchMdd: bench && bench.values.length ? maxDrawdown(bench.values) : null,
      annualReturn: annualizedReturn(eqv, ctx.tradingDays),
    },
    counts,
    limitModel: { ...lim, fillRate: lim.attempted ? lim.filled / lim.attempted : null },
    portfolio: { entries: sim.entries, skipped: sim.skipped, priceAboveSlotRate: sim.entries + pas ? pas / (sim.entries + pas) : null, openAtEnd: sim.open.length },
    episodes,
  };
}
