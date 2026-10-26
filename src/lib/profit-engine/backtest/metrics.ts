/**
 * T-096 통계·성과 지표(§B-6·§A-2). 순수 함수.
 *  - expectancy: 청산된(시간·손절) 에피소드의 비용 후 수익 — 평균·PF·손익비·표본(에피소드·주·종목)·단일 종목 이익 비중·평균 초과수익.
 *    단일 종목 비중(1-2, v1.1 ④ — 사용자 확인 대기 V1, 권고값): 분자 = 종목별 순수익 합이 양(+)인 종목 중 최대,
 *    분모 = registry interpretation.symbolShareDenominator — 'total_net'(전체 청산 에피소드 순수익 합, 권고; ≤ 0 이면 null = 1-2 실패)
 *    또는 'positive_sum'(양(+) 종목 합 — v1.0 구현값). 다른 쪽 값은 보조 보고(maxSymbolShareAux).
 *  - clusterBootstrapCI: 주(군집) 블록 부트스트랩 백분위 95% 구간(고정 시드) + 군집 강건 t(자유도 = 주 수 − 1, P1 clusterCi95 와 같은 SE).
 *  - sharpe(√252)·maxDrawdown(보유 중 평가손 포함 일별 가치)·annualizedReturn.
 *  - foldStats: IS 내부 앵커드 폴드(검증 창)별 평균 초과수익·순수익 합.
 */
import { isTaken } from './fill';
import type { Episode, FoldWindow } from './types';

export interface Expectancy {
  mean: number | null;
  pf: number | null;
  payoff: number | null;
  n: number;
  weeks: number;
  symbols: number;
  maxSymbolShare: number | null;
  maxSymbolShareAux: number | null;
  meanExcess: number | null;
}

export type SymbolShareDenominator = 'total_net' | 'positive_sum';

const fin = (x: number) => Number.isFinite(x);

export function expectancy(eps: Episode[], h: number, denominator: SymbolShareDenominator): Expectancy {
  const taken = eps.filter((e) => isTaken(e.fill));
  const nets = taken.map((e) => e.fill!.netRet).filter(fin);
  const n = nets.length;
  const weeks = new Set(taken.map((e) => e.week)).size;
  const symbols = new Set(taken.map((e) => e.signal.symbol)).size;
  if (!n) return { mean: null, pf: null, payoff: null, n: 0, weeks, symbols, maxSymbolShare: null, maxSymbolShareAux: null, meanExcess: null };
  const mean = nets.reduce((a, b) => a + b, 0) / n;
  const wins = nets.filter((x) => x > 0);
  const losses = nets.filter((x) => x < 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -losses.reduce((a, b) => a + b, 0);
  const pf = gl > 0 ? gw / gl : gw > 0 ? Infinity : null;
  const payoff = wins.length && losses.length ? (gw / wins.length) / (gl / losses.length) : wins.length ? Infinity : null;
  const bySym = new Map<string, number>();
  for (const e of taken) bySym.set(e.signal.symbol, (bySym.get(e.signal.symbol) || 0) + e.fill!.netRet);
  const pos = [...bySym.values()].filter((v) => v > 0);
  const posSum = pos.reduce((a, b) => a + b, 0);
  const totalNet = nets.reduce((a, b) => a + b, 0);
  const maxPos = pos.length ? Math.max(...pos) : null;
  const shareTotal = maxPos !== null && totalNet > 0 ? maxPos / totalNet : null;
  const sharePositive = maxPos !== null && posSum > 0 ? maxPos / posSum : null;
  const maxSymbolShare = denominator === 'total_net' ? shareTotal : sharePositive;
  const maxSymbolShareAux = denominator === 'total_net' ? sharePositive : shareTotal;
  const ex = taken.map((e) => e.excess[h]).filter((x) => x !== undefined && fin(x));
  const meanExcess = ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null;
  return { mean, pf, payoff, n, weeks, symbols, maxSymbolShare, maxSymbolShareAux, meanExcess };
}

/** mulberry32 — 고정 시드 재현용 PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClusterCI { lo: number | null; hi: number | null; t: number | null; mean: number | null; se: number | null; df: number; clusters: number; n: number }

/** 군집 강건 표준오차(같은 군집 잔차 합의 제곱합, G/(G−1) 보정) — P1 clusterCi95 와 같은 식. */
export function clusterSe(values: number[], clusters: string[]): { mean: number | null; se: number | null; G: number; n: number } {
  const pairs = values.map((x, i) => [x, clusters[i]] as const).filter(([x]) => fin(x));
  const n = pairs.length;
  if (!n) return { mean: null, se: null, G: 0, n: 0 };
  const m = pairs.reduce((a, [x]) => a + x, 0) / n;
  const sums = new Map<string, number>();
  for (const [x, k] of pairs) sums.set(k, (sums.get(k) || 0) + (x - m));
  const G = sums.size;
  if (G < 2) return { mean: m, se: null, G, n };
  let ss = 0;
  for (const v of sums.values()) ss += v * v;
  return { mean: m, se: Math.sqrt((G / (G - 1)) * ss) / n, G, n };
}

export function clusterBootstrapCI(values: number[], clusters: string[], iters: number, seed: number): ClusterCI {
  if (values.length !== clusters.length) throw new Error('values/clusters length mismatch');
  if (!Number.isInteger(iters) || iters < 1) throw new RangeError('iters must be a positive integer');
  const { mean, se, G, n } = clusterSe(values, clusters);
  const df = Math.max(0, G - 1);
  if (mean === null || G < 2) return { lo: null, hi: null, t: null, mean, se, df, clusters: G, n };
  const groups = new Map<string, { s: number; c: number }>();
  values.forEach((x, i) => {
    if (!fin(x)) return;
    const g = groups.get(clusters[i]) || { s: 0, c: 0 };
    g.s += x; g.c++;
    groups.set(clusters[i], g);
  });
  const keys = [...groups.keys()].sort();
  const gs = keys.map((k) => groups.get(k)!);
  const rnd = mulberry32(seed);
  const stats: number[] = [];
  for (let it = 0; it < iters; it++) {
    let s = 0, c = 0;
    for (let j = 0; j < gs.length; j++) {
      const g = gs[Math.floor(rnd() * gs.length)];
      s += g.s; c += g.c;
    }
    stats.push(s / c);
  }
  stats.sort((a, b) => a - b);
  const q = (p: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(p * stats.length)))];
  const t = se && se > 0 ? mean / se : null;
  return { lo: q(0.025), hi: q(0.975), t, mean, se, df, clusters: G, n };
}

function dailyReturns(eq: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < eq.length; i++) if (eq[i - 1] > 0 && fin(eq[i])) r.push(eq[i] / eq[i - 1] - 1);
  return r;
}

/** 일별 가치 → 샤프(√tradingDays — registry data.tradingDaysPerYear = 252, 무위험 0, 표본 표준편차). 수익률 2개 미만·분산 0 이면 0(보수). */
export function sharpe(dailyEquity: number[], tradingDays: number): number {
  const r = dailyReturns(dailyEquity);
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  if (!(v > 0)) return 0;
  return (m / Math.sqrt(v)) * Math.sqrt(tradingDays);
}

/** 최대 낙폭(0~1) — 일별 가치의 고점 대비 최대 하락(보유 중 평가손 포함). */
export function maxDrawdown(dailyEquity: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const x of dailyEquity) {
    if (!fin(x)) continue;
    if (x > peak) peak = x;
    if (peak > 0) mdd = Math.max(mdd, (peak - x) / peak);
  }
  return mdd;
}

export function annualizedReturn(dailyEquity: number[], tradingDays: number): number | null {
  const n = dailyEquity.length;
  if (n < 2 || !(dailyEquity[0] > 0) || !(dailyEquity[n - 1] > 0)) return null;
  return (dailyEquity[n - 1] / dailyEquity[0]) ** (tradingDays / (n - 1)) - 1;
}

export interface FoldStat { testFrom: string; testTo: string; n: number; meanExcess: number | null; netSum: number }

export function foldStats(eps: Episode[], folds: FoldWindow[], h: number): { folds: FoldStat[]; positive: number; maxProfitShare: number | null } {
  const out: FoldStat[] = folds.map((w) => {
    const sel = eps.filter((e) => isTaken(e.fill) && e.signal.d0 >= w.testFrom && e.signal.d0 <= w.testTo);
    const ex = sel.map((e) => e.excess[h]).filter((x) => x !== undefined && fin(x));
    return {
      testFrom: w.testFrom, testTo: w.testTo, n: sel.length,
      meanExcess: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null,
      netSum: sel.reduce((a, e) => a + e.fill!.netRet, 0),
    };
  });
  const positive = out.filter((f) => f.meanExcess !== null && f.meanExcess > 0).length;
  const total = out.reduce((a, f) => a + f.netSum, 0);
  const maxProfitShare = total > 0 ? Math.max(...out.map((f) => f.netSum)) / total : null;
  return { folds: out, positive, maxProfitShare };
}
