/**
 * T-096 사전 등록 registry(`preregistration.json`) 타입·검증·격자 전개. 순수 함수 — JSON 은 호출자가 읽어 넘긴다.
 * 수치의 출처는 동결 문서 §B 이고, registry 는 그것을 기계가 읽는 값으로 옮긴 것이다(시험이 §B 원문과 대조한다).
 */
import type { CostModel, FoldWindow, Market, ParamValue, Params } from '../backtest/types';

export interface StrategyEntry {
  label: string;
  id: string;
  tier: 'A' | 'B' | 'control';
  implemented: boolean;
  rank: string;
  minBars?: number;
  grid: Record<string, ParamValue[]>;
  fixed: Record<string, unknown>;
  live?: Record<string, ParamValue>;
}

export interface SplitEntry {
  warmupFrom: string; isFrom: string; isTo: string; oosFrom: string; oosTo: string; forwardFrom: string; folds: FoldWindow[];
}

export interface PhaseCriteria {
  minEpisodes: number; minWeeks: number; minSymbols: number; maxSymbolShare: number;
  excessLoGt: number; minNetAfterDelta: number; minPf: number; minPayoff: number; stressMinNet: number;
  minSharpe: number; maxMdd: number;
  foldsMinPositive?: number; foldMaxProfitShare?: number;
  sharpeMustBeatBenchmark?: boolean; mddMustBeatBenchmark?: boolean; minWfe?: number;
}

export interface Criteria {
  tierATrialsForT: number;
  tThresholds: { nLe100: number; nGt100: number };
  is: PhaseCriteria;
  oos: PhaseCriteria;
}

export interface Registry {
  schema: string;
  task: string;
  document: { path: string; version: string; section_b_sha256: string; frozen_at: string; approved_by: string; approval_quote: string; hash_rule: string };
  markets: { judged: Market; reportedOnly: Market[]; judgeCurrency: string };
  universe: { pit: boolean; limitation: string; expectedSymbols: Record<Market, number>; excludeSymbols: string[] };
  benchmarks: Record<Market, string>;
  asOf: string;
  splits: Record<Market, SplitEntry>;
  costs: Record<Market, CostModel> & { sensitivity: { passMultiplier: number; reportMultipliers: number[] } };
  execution: { judgeModel: string; sensitivityModel: string; limitChasePct: number; gapUp: number; gapDown: number; gapBoundary: 'skip' | 'enter'; adtvWindow: number; adtvMaxShare: number };
  episodes: { windowDays: number; cooldownAppliesToPortfolio: boolean };
  regime: { ma: number };
  portfolio: { capital: Record<Market, number>; slots: number; slotPct: number; integerShares: boolean };
  bootstrap: { iters: number; seed: number; auxSeeds: number[]; cluster: string; prng: string; interval: string };
  data: { barGapDays: number; universeBaselineMinN: number; tradingDaysPerYear: number };
  trials: { tierA: number; control: number; tierB: number; perMarket: number; total: number };
  criteria: Criteria;
  interpretation: Interpretation;
  decisionDate: string;
  rsiOversoldV1DecisionDate: string;
  strategies: StrategyEntry[];
  excludedStrategies: Array<{ id: string; reason: string }>;
}

/**
 * v1.1 해석 스위치 — **한곳에 모음**. pendingUserConfirmation 에 적힌 키(V1 symbolShareDenominator · V2 plateauMembershipRequiresSample ·
 * V3 g1Rule)는 사용자 확인 대기 중 권고값이다. 사용자가 바꾸면 이 블록 값만 바꾸고(H_r 이 바뀐다) 시험·문서 마커를 갱신한다.
 */
export interface Interpretation {
  version: string;
  symbolShareDenominator: 'total_net' | 'positive_sum';      // ④ V1
  plateauMembershipRequiresSample: boolean;                  // ⑨ V2
  plateauMedianFallback: 'nearest_l1' | 'none';              // ⑦
  plateauRegimeTie: 'off' | 'on';                            // ⑦
  plateauEvenMedian: 'low' | 'high';                         // §B-7 짝수 보수 쪽
  plateauTieOrder: string[];                                 // ⑦ 동률 순서(앞이 먼저, 각 축은 낮은 값 우선)
  g1Rule: 'any_combo_meets_u5_after_filters';                // (b) V3
  pendingUserConfirmation: string[];
}

/** 격자 전개 — 키 이름 순서를 고정(사전순)해 결정적으로 만든다. 빈 격자는 조합 1개({}). */
export function expandGrid(grid: Record<string, ParamValue[]>): Params[] {
  const keys = Object.keys(grid).sort();
  let out: Params[] = [{}];
  for (const k of keys) {
    const vals = grid[k];
    if (!Array.isArray(vals) || !vals.length) throw new Error(`grid.${k} 가 비었다`);
    const next: Params[] = [];
    for (const p of out) for (const v of vals) next.push({ ...p, [k]: v });
    out = next;
  }
  return out;
}

export function trialCount(reg: Registry): { tierA: number; control: number; tierB: number; perMarket: number } {
  const c = { tierA: 0, control: 0, tierB: 0, perMarket: 0 };
  for (const s of reg.strategies) {
    const n = expandGrid(s.grid).length;
    if (s.tier === 'A') c.tierA += n; else if (s.tier === 'control') c.control += n; else c.tierB += n;
    c.perMarket += n;
  }
  return c;
}

export function strategyEntry(reg: Registry, id: string): StrategyEntry | null {
  return reg.strategies.find((s) => s.id === id) ?? null;
}

/** 조합 파라미터 + 고정값에서 체결 쪽 값(hold·stop·regime)을 꺼낸다. 없으면 오류(등록 누락). */
export function executionParams(entry: StrategyEntry, p: Params): { hold: number; stop: number | null; regime: boolean } {
  const hold = (p.hold ?? entry.fixed.hold) as number;
  const stopRaw = p.stop !== undefined ? p.stop : (entry.fixed.stop as number | null | undefined);
  const regimeRaw = p.regime !== undefined ? p.regime : (entry.fixed.regime as boolean | undefined);
  if (!Number.isInteger(hold) || hold < 1) throw new Error(`${entry.id}: hold 미등록`);
  if (stopRaw !== null && stopRaw !== undefined && typeof stopRaw !== 'number') throw new Error(`${entry.id}: stop 형식 오류`);
  return { hold, stop: stopRaw === undefined ? null : (stopRaw as number | null), regime: regimeRaw === true };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 형식·정합 검증 — 틀리면 오류 목록(빈 배열 = 통과). 수치가 §B 와 같은지는 시험이 원문과 대조한다. */
export function validateRegistry(reg: Registry): string[] {
  const err: string[] = [];
  if (reg.schema !== 't096-preregistration@1') err.push('schema');
  if (!/^[0-9a-f]{64}$/.test(reg.document?.section_b_sha256 ?? '')) err.push('document.section_b_sha256');
  for (const m of ['US', 'KR'] as const) {
    const s = reg.splits?.[m];
    if (!s) { err.push(`splits.${m}`); continue; }
    for (const k of ['warmupFrom', 'isFrom', 'isTo', 'oosFrom', 'oosTo', 'forwardFrom'] as const) if (!YMD.test(s[k])) err.push(`splits.${m}.${k}`);
    if (!(s.warmupFrom < s.isFrom && s.isFrom < s.isTo && s.isTo < s.oosFrom && s.oosFrom <= s.oosTo && s.oosTo < s.forwardFrom)) err.push(`splits.${m} 순서`);
    for (const f of s.folds) if (!(f.trainTo < f.testFrom && f.testFrom <= f.testTo && f.testTo <= s.isTo && f.testFrom >= s.isFrom)) err.push(`splits.${m}.folds`);
    const c = reg.costs?.[m];
    if (!c || ![c.feeRoundTrip, c.slippage, c.stopSlippage].every((x) => Number.isFinite(x) && x >= 0)) err.push(`costs.${m}`);
  }
  const ids = new Set<string>();
  for (const s of reg.strategies ?? []) {
    if (ids.has(s.id)) err.push(`strategies 중복 ${s.id}`);
    ids.add(s.id);
    try { expandGrid(s.grid); } catch { err.push(`strategies.${s.id}.grid`); }
    if (s.live) for (const [k, v] of Object.entries(s.live)) if (!(s.grid[k] ?? []).includes(v)) err.push(`strategies.${s.id} 라이브 값 ${k}=${v} 가 격자 밖`);
  }
  const c = trialCount(reg);
  if (c.tierA !== reg.trials?.tierA || c.control !== reg.trials?.control || c.tierB !== reg.trials?.tierB || c.perMarket !== reg.trials?.perMarket) err.push('trials 합계 불일치');
  if (reg.trials?.total !== reg.trials?.perMarket * 2) err.push('trials.total');
  if (reg.criteria?.tierATrialsForT !== c.tierA) err.push('criteria.tierATrialsForT');
  const it = reg.interpretation;
  if (!it) err.push('interpretation');
  else {
    if (!['total_net', 'positive_sum'].includes(it.symbolShareDenominator)) err.push('interpretation.symbolShareDenominator');
    if (typeof it.plateauMembershipRequiresSample !== 'boolean') err.push('interpretation.plateauMembershipRequiresSample');
    if (!['nearest_l1', 'none'].includes(it.plateauMedianFallback)) err.push('interpretation.plateauMedianFallback');
    if (!['off', 'on'].includes(it.plateauRegimeTie)) err.push('interpretation.plateauRegimeTie');
    if (!['low', 'high'].includes(it.plateauEvenMedian)) err.push('interpretation.plateauEvenMedian');
    if (!Array.isArray(it.plateauTieOrder)) err.push('interpretation.plateauTieOrder');
    if (it.g1Rule !== 'any_combo_meets_u5_after_filters') err.push('interpretation.g1Rule');
  }
  if (!['skip', 'enter'].includes(reg.execution?.gapBoundary)) err.push('execution.gapBoundary');
  if (!(Array.isArray(reg.bootstrap?.auxSeeds) && reg.bootstrap.auxSeeds.every(Number.isInteger))) err.push('bootstrap.auxSeeds');
  if (!YMD.test(reg.decisionDate ?? '')) err.push('decisionDate');
  if (!YMD.test(reg.asOf ?? '')) err.push('asOf');
  for (const m of ['US', 'KR'] as const) if (reg.splits?.[m] && reg.splits[m].oosTo !== reg.asOf) err.push(`splits.${m}.oosTo ≠ asOf`);
  return err;
}

/**
 * 엔진 코드에 남은 구조 상수가 registry(단일 출처)와 같은지. 다르면 is·oos 거부. 엔진이 지원하지 않는 모델·옵션 값도 여기서 거부한다
 * (registry 에 적힌 값이 실제로 쓰이지 않는 "죽은 값"이 되지 않게 — 읽어서 확인하거나 계산에 넘긴다).
 */
export function checkEngineConstants(reg: Registry, k: { BAR_GAP_DAYS: number; UNIVERSE_MIN_N: number; signalMinBars: Record<string, number> }): string[] {
  const e: string[] = [];
  if (reg.data.barGapDays !== k.BAR_GAP_DAYS) e.push(`data.barGapDays ${reg.data.barGapDays} ≠ 엔진 ${k.BAR_GAP_DAYS}`);
  if (reg.data.universeBaselineMinN !== k.UNIVERSE_MIN_N) e.push(`data.universeBaselineMinN ${reg.data.universeBaselineMinN} ≠ 엔진 ${k.UNIVERSE_MIN_N}`);
  if (reg.execution.judgeModel !== 'd1open') e.push(`execution.judgeModel ${reg.execution.judgeModel} — 엔진은 d1open 만 판정`);
  if (reg.execution.sensitivityModel !== 'limit') e.push(`execution.sensitivityModel ${reg.execution.sensitivityModel} — 엔진은 limit 만`);
  if (reg.bootstrap.prng !== 'mulberry32') e.push('bootstrap.prng — 엔진은 mulberry32 만');
  if (reg.bootstrap.interval !== 'percentile95') e.push('bootstrap.interval — 엔진은 percentile95 만');
  if (reg.bootstrap.cluster !== 'week_monday_of_d0') e.push('bootstrap.cluster — 엔진은 D0 월요일 주 군집만');
  if (reg.universe.pit !== false) e.push('universe.pit=true — PIT 유니버스는 엔진이 지원하지 않는다');
  if (reg.portfolio.integerShares !== true && reg.portfolio.integerShares !== false) e.push('portfolio.integerShares');
  for (const s of reg.strategies.filter((x) => x.implemented)) {
    if (k.signalMinBars[s.id] === undefined) e.push(`구현 표시인데 엔진에 없음: ${s.id}`);
    else if (s.minBars !== k.signalMinBars[s.id]) e.push(`${s.id}.minBars ${s.minBars} ≠ 엔진 ${k.signalMinBars[s.id]}`);
  }
  for (const id of Object.keys(k.signalMinBars)) if (!reg.strategies.some((s) => s.id === id && s.implemented)) e.push(`엔진에 있는데 registry 미구현 표시: ${id}`);
  return e;
}

/** 신호 함수에 넘길 파라미터 = 등록 고정값(fixed 중 숫자·불리언) + 격자의 신호 파라미터. 격자 값이 고정값을 덮지 못하게 겹치면 오류. */
export function signalParamsOf(entry: StrategyEntry, gridParams: Params, signalKeys: string[]): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(entry.fixed)) if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  for (const k of signalKeys) {
    if (k in out) throw new Error(`${entry.id}: 신호 파라미터 ${k} 가 fixed 와 겹친다`);
    out[k] = gridParams[k];
  }
  return out;
}
