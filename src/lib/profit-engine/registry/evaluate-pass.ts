/**
 * T-096 합격 판정(§B-6)·고원 선택(§B-7) — 순수 함수. 수치는 전부 registry.criteria 에서 읽는다(코드에 숫자를 박지 않는다).
 *
 * 판정값: PASS(1차·2차 IS+OOS 전부) / REJECTED(OOS 어느 조건이든 실패) / INSUFFICIENT(1-1 표본 미달) /
 *        UNTESTED_OOS(IS 실패로 OOS 미실행 — 또는 IS 통과 뒤 OOS 아직 미실행: isPassed 로 구분) /
 *        EXPLORATORY(Tier B·대조군·판정 시장 밖 — 같은 표로 보고만, shape 에 "판정했다면"의 값).
 * δ(생존편향 할인)가 측정되지 않았으면 1-4 를 δ=0 으로 계산하되 promotionBlocked=true(U9: 합격해도 승급 보류).
 * 단일 종목 비중이 null(전체 순수익 ≤ 0 — v1.1 ④ V1)·폴드 이익 비중 null(폴드 순수익 합 ≤ 0, v1.1 ⑤)은 실패로 본다.
 * 1-1·1-2 는 선택된 조합의 IS 판정에서 본다(v1.1 ⑨ — 고원 구성원 자격의 1-1 은 plateau() 가 따로 본다).
 */
import type { ParamValue, Params } from '../backtest/types';
import type { Criteria, PhaseCriteria } from './registry';

export type Verdict = 'PASS' | 'REJECTED' | 'INSUFFICIENT' | 'UNTESTED_OOS' | 'EXPLORATORY';

export interface StrategyMetrics {
  n: number; weeks: number; symbols: number; maxSymbolShare: number | null;
  excessLo: number | null; excessT: number | null;
  netMean: number | null; deltaTrade: number | null;
  pf: number | null; payoff: number | null;
  stressNetMean: number | null;
  foldsPositive?: number | null; foldMaxProfitShare?: number | null;
  sharpe: number | null; benchSharpe?: number | null;
  mdd: number | null; benchMdd?: number | null;
  annualReturn: number | null;
}

export interface JudgeOptions { tier: 'A' | 'B' | 'control'; market: 'US' | 'KR'; judgedMarket: 'US' | 'KR' }
export interface JudgeResult { verdict: Verdict; shape: Exclude<Verdict, 'EXPLORATORY'>; isPassed: boolean; promotionBlocked: boolean; reasons: string[] }

const ge = (x: number | null | undefined, t: number) => x !== null && x !== undefined && Number.isFinite(x) && x >= t;
const le = (x: number | null | undefined, t: number) => x !== null && x !== undefined && Number.isFinite(x) && x <= t;
const gt = (x: number | null | undefined, t: number) => x !== null && x !== undefined && Number.isFinite(x) && x > t;
// PF·손익비는 손실이 없으면 Infinity — 통과로 본다
const geInf = (x: number | null | undefined, t: number) => x === Infinity || ge(x, t);

export function tThreshold(criteria: Criteria): number {
  return criteria.tierATrialsForT <= 100 ? criteria.tThresholds.nLe100 : criteria.tThresholds.nGt100;
}

/** 표본(1-1) 실패 목록. */
export function sampleFailures(m: StrategyMetrics, c: PhaseCriteria, tag: string): string[] {
  const r: string[] = [];
  if (!ge(m.n, c.minEpisodes)) r.push(`${tag}.1-1 에피소드 ${m.n} < ${c.minEpisodes}`);
  if (!ge(m.weeks, c.minWeeks)) r.push(`${tag}.1-1 주 ${m.weeks} < ${c.minWeeks}`);
  if (!ge(m.symbols, c.minSymbols)) r.push(`${tag}.1-1 종목 ${m.symbols} < ${c.minSymbols}`);
  return r;
}

/** 1차 관문 1-3~1-7(고원 집합 P 의 조건). phase='is' 면 t 임계·폴드 조건 포함. */
export function firstGateCore(m: StrategyMetrics, c: PhaseCriteria, criteria: Criteria, phase: 'is' | 'oos'): string[] {
  const r: string[] = [];
  const tag = phase;
  if (!gt(m.excessLo, c.excessLoGt)) r.push(`${tag}.1-3 초과수익 구간 하한 ≤ ${c.excessLoGt}`);
  if (phase === 'is' && !ge(m.excessT, tThreshold(criteria))) r.push(`${tag}.1-3 t < ${tThreshold(criteria)}`);
  const net = m.netMean === null ? null : m.netMean - (m.deltaTrade ?? 0);
  if (!ge(net, c.minNetAfterDelta)) r.push(`${tag}.1-4 순기대값−δ < ${c.minNetAfterDelta}`);
  if (!geInf(m.pf, c.minPf)) r.push(`${tag}.1-5 PF < ${c.minPf}`);
  if (!geInf(m.payoff, c.minPayoff)) r.push(`${tag}.1-5 손익비 < ${c.minPayoff}`);
  if (!ge(m.stressNetMean, c.stressMinNet)) r.push(`${tag}.1-6 슬리피지 민감도 순기대값 < ${c.stressMinNet}`);
  if (phase === 'is') {
    if (!ge(m.foldsPositive ?? null, c.foldsMinPositive ?? Infinity)) r.push(`${tag}.1-7 양(+) 폴드 < ${c.foldsMinPositive}`);
    if (!le(m.foldMaxProfitShare ?? null, c.foldMaxProfitShare ?? -Infinity)) r.push(`${tag}.1-7 한 폴드 이익 비중 > ${c.foldMaxProfitShare}`);
  }
  return r;
}

function phaseFailures(m: StrategyMetrics, c: PhaseCriteria, criteria: Criteria, phase: 'is' | 'oos', isM?: StrategyMetrics): string[] {
  const r: string[] = [];
  if (!le(m.maxSymbolShare, c.maxSymbolShare)) r.push(`${phase}.1-2 단일 종목 비중 > ${c.maxSymbolShare}`);
  r.push(...firstGateCore(m, c, criteria, phase));
  if (!ge(m.sharpe, c.minSharpe)) r.push(`${phase}.2-1 샤프 < ${c.minSharpe}`);
  if (c.sharpeMustBeatBenchmark && !(m.sharpe !== null && m.benchSharpe !== null && m.benchSharpe !== undefined && m.sharpe > m.benchSharpe)) r.push(`${phase}.2-1 벤치마크 샤프 미초과`);
  if (!le(m.mdd, c.maxMdd)) r.push(`${phase}.2-2 MDD > ${c.maxMdd}`);
  if (c.mddMustBeatBenchmark && !(m.mdd !== null && m.benchMdd !== null && m.benchMdd !== undefined && m.mdd < m.benchMdd)) r.push(`${phase}.2-2 벤치마크 MDD 미만 아님`);
  if (c.minWfe !== undefined) {
    const isAnn = isM?.annualReturn ?? null;
    if (!(isAnn !== null && isAnn > 0 && m.annualReturn !== null && m.annualReturn / isAnn >= c.minWfe)) r.push(`${phase}.2-3 WFE < ${c.minWfe} (또는 IS 연수익 ≤ 0)`);
  }
  return r;
}

export function judge(isM: StrategyMetrics, oosM: StrategyMetrics | null, criteria: Criteria, opts: JudgeOptions): JudgeResult {
  const exploratory = opts.tier !== 'A' || opts.market !== opts.judgedMarket;
  const reasons: string[] = [];
  let promotionBlocked = false;
  if (isM.deltaTrade === null || (oosM && oosM.deltaTrade === null)) { promotionBlocked = true; reasons.push('δ 미측정 — 1-4 를 δ=0 으로 계산, 합격해도 승급 보류(U9)'); }
  let shape: JudgeResult['shape'];
  let isPassed = false;
  const isSample = sampleFailures(isM, criteria.is, 'is');
  if (isSample.length) { shape = 'INSUFFICIENT'; reasons.push(...isSample); }
  else {
    const isF = phaseFailures(isM, criteria.is, criteria, 'is');
    if (isF.length) { shape = 'UNTESTED_OOS'; reasons.push(...isF); }
    else if (!oosM) { shape = 'UNTESTED_OOS'; isPassed = true; reasons.push('IS 통과 — OOS 미실행'); }
    else {
      isPassed = true;
      const oosSample = sampleFailures(oosM, criteria.oos, 'oos');
      if (oosSample.length) { shape = 'INSUFFICIENT'; reasons.push(...oosSample); }
      else {
        const oosF = phaseFailures(oosM, criteria.oos, criteria, 'oos', isM);
        if (oosF.length) { shape = 'REJECTED'; reasons.push(...oosF); } else shape = 'PASS';
      }
    }
  }
  if (exploratory) reasons.unshift(`EXPLORATORY — tier ${opts.tier}·시장 ${opts.market} 는 판정 대상이 아님(보고만)`);
  return { verdict: exploratory ? 'EXPLORATORY' : shape, shape, isPassed, promotionBlocked, reasons };
}

export interface GridResult { params: Params; isM: StrategyMetrics }
export interface PlateauResult {
  perfOnly: Params[];          // P_perf = IS 1차 관문 1-3~1-7 통과(표본 조건 없음) — 이웃 증거 집합
  members: Params[];           // 고원 구성원 = P_perf ∩ (1-1 충족, 설정 시) ∧ 격자 안 이웃이 모두 P_perf
  edgeMembers: Params[];       // 구성원 중 격자 가장자리(한쪽 이웃 없음 — "한쪽만 확인", v1.1 (a))
  chosen: Params | null;
  reason: string | null;       // 'empty_P' | 'no_plateau' | 'median_fallback_nearest' | 'median_not_in_plateau' | null
  /** v1.0 이름 호환 — perfOnly·members 와 같은 값 */
  inP: Params[];
  plateau: Params[];
}
export interface PlateauOptions {
  membershipRequiresSample: boolean;     // v1.1 ⑨(V2, 사용자 확인 대기 — 권고 true)
  medianFallback: 'nearest_l1' | 'none'; // v1.1 ⑦
  regimeTie: 'off' | 'on';               // v1.1 ⑦
  evenMedian: 'low' | 'high';            // §B-7
  tieOrder: string[];                    // v1.1 ⑦ 동률 순서
}

const keyOf = (p: Params) => JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));

/**
 * §B-7(v1.1 패치 6): P_perf = IS 1차 관문 1-3~1-7 을 만족하는 조합(표본 조건 없음). 고원 구성원 = P_perf 에 속하고
 * (membershipRequiresSample 이면) 1-1 표본을 충족하며, 격자 안 이웃(각 파라미터 ±1 스텝, regime 은 같은 값)이 **모두** P_perf 인 조합.
 * 격자 밖 이웃은 조건 없음 — 그런 구성원은 edgeMembers 에 표시. 구성원이 비면 chosen=null(전략 REJECTED(IS)).
 * 선택 = 구성원들의 파라미터별 중앙값(중복 포함, 짝수면 evenMedian 쪽; regime 은 다수결·동률 regimeTie).
 * 중앙값 조합이 구성원이 아니면(medianFallback='nearest_l1') 격자 스텝 L1 거리가 가장 가까운 구성원, 동률은 tieOrder 순서로 각 축 낮은 값 우선
 * (regime 은 regimeTie 쪽 우선). 성과 값을 보지 않는 기계적 규칙이다.
 */
export function plateau(gridResults: GridResult[], criteria: Criteria, grid: Record<string, ParamValue[]>, opt: PlateauOptions): PlateauResult {
  const P = gridResults.filter((g) => firstGateCore(g.isM, criteria.is, criteria, 'is').length === 0);
  const inP = new Set(P.map((g) => keyOf(g.params)));
  const axes = Object.keys(grid).filter((k) => k !== 'regime');
  const neighborsOk = (p: Params) => axes.every((k) => {
    const vals = grid[k];
    const idx = vals.indexOf(p[k]);
    if (idx < 0) return false;
    return [idx - 1, idx + 1].filter((j) => j >= 0 && j < vals.length).every((j) => inP.has(keyOf({ ...p, [k]: vals[j] })));
  });
  // 가장자리 = 값이 3개 이상인 축의 양 끝(예: th=30·38). 값이 2개인 축(hold·stop)은 모든 값이 이웃 1개뿐이라 표시하지 않는다(정보 없음).
  const isEdge = (p: Params) => axes.some((k) => { const n = grid[k].length; const idx = grid[k].indexOf(p[k]); return n >= 3 && (idx === 0 || idx === n - 1); });
  const memberRows = P.filter((g) => (!opt.membershipRequiresSample || sampleFailures(g.isM, criteria.is, 'is').length === 0) && neighborsOk(g.params));
  const members = memberRows.map((g) => g.params);
  const perfOnly = P.map((g) => g.params);
  const base = { perfOnly, members, edgeMembers: members.filter(isEdge), inP: perfOnly, plateau: members };
  if (!members.length) return { ...base, chosen: null, reason: P.length ? 'no_plateau' : 'empty_P' };
  const regimeRank = (v: ParamValue) => (opt.regimeTie === 'off' ? Number(v) : 1 - Number(v));
  const median: Params = {};
  for (const k of Object.keys(grid)) {
    const order = grid[k];
    if (k === 'regime') {
      const on = members.filter((p) => p[k] === true).length, off = members.length - on;
      median[k] = on > off ? true : off > on ? false : opt.regimeTie === 'on';
      continue;
    }
    const vals = members.map((p) => p[k]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const lo = Math.floor((vals.length - 1) / 2), hi = Math.ceil((vals.length - 1) / 2);
    median[k] = vals[opt.evenMedian === 'low' ? lo : hi];
  }
  if (members.some((p) => keyOf(p) === keyOf(median))) return { ...base, chosen: median, reason: null };
  if (opt.medianFallback === 'none') return { ...base, chosen: null, reason: 'median_not_in_plateau' };
  const pos = (k: string, v: ParamValue) => (k === 'regime' ? Number(v) : grid[k].indexOf(v));
  const dist = (p: Params) => Object.keys(grid).reduce((a, k) => a + Math.abs(pos(k, p[k]) - pos(k, median[k])), 0);
  const order = [...opt.tieOrder.filter((k) => k in grid), ...Object.keys(grid).filter((k) => !opt.tieOrder.includes(k)).sort()];
  const cmp = (a: Params, b: Params) => {
    const d = dist(a) - dist(b);
    if (d) return d;
    for (const k of order) {
      const x = k === 'regime' ? regimeRank(a[k]) : pos(k, a[k]);
      const y = k === 'regime' ? regimeRank(b[k]) : pos(k, b[k]);
      if (x !== y) return x - y;
    }
    return 0;
  };
  return { ...base, chosen: [...members].sort(cmp)[0], reason: 'median_fallback_nearest' };
}

/** registry.interpretation → PlateauOptions (한곳에서만 변환). */
export function plateauOptionsOf(it: { plateauMembershipRequiresSample: boolean; plateauMedianFallback: 'nearest_l1' | 'none'; plateauRegimeTie: 'off' | 'on'; plateauEvenMedian: 'low' | 'high'; plateauTieOrder: string[] }): PlateauOptions {
  return { membershipRequiresSample: it.plateauMembershipRequiresSample, medianFallback: it.plateauMedianFallback, regimeTie: it.plateauRegimeTie, evenMedian: it.plateauEvenMedian, tieOrder: it.plateauTieOrder };
}
