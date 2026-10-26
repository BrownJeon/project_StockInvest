/**
 * T-096 기준선(§B-5). 순수 함수.
 *
 * 1) universeBaseline — 같은 D0 날짜 유니버스 동일가중 수익. **P1 `universeBaselines`(scripts/profit-engine/postmortem-core.js) 의
 *    d1open 정의를 그대로 옮김**: 종목별 봉 j(D0)에 대해 진입 = j+1 봉 시가, 청산 = j+h 봉 종가, 비용 전.
 *    창 [j, j+h] 에 corp_action_suspect 봉이 있거나 연속 봉 간격 > 9일이면 그 종목-날짜는 뺀다. 날짜당 종목 minN(10) 미만이면 없음.
 *    제외 봉(adj_stale·adj_orphan)은 P1 처럼 **행 자체를 빼고** 계산한다(빈틈 처리). zero_volume 은 P1 처럼 따지지 않는다.
 *    시험: 고정 입력 6지점 패리티(`__tests__/backtest-baseline-parity.test.ts`).
 * 2) equalWeightMonthly — 유니버스 동일가중, 매월 첫 거래일 종가 리밸런스(같은 비용: 매매 금액 × 왕복/2).
 * 3) buyAndHold — 지수 ETF 보유(매수·매도 1회 비용).
 * 4) survivorshipDelta — δ_annual = max(0, CAGR(유니버스 EW) − CAGR(ETF)), 거래당 δ = δ_annual × 보유일/252.
 */
import { roundTrip } from './costs';
import { BAR_GAP_DAYS, calendarOf, dayDiff } from './frames';
import type { CostModel, Frame, Series } from './types';

/** P1(postmortem-core UNIVERSE_MIN_N)과 같은 값 — registry data.universeBaselineMinN 과 같아야 러너가 돈다(checkEngineConstants). */
export const UNIVERSE_MIN_N = 10;

export interface BaselineDetail {
  byDate: Map<string, Record<number, { mean: number; n: number } | null>>;
  excluded: { corp: number; gap: number };
}

function assertOneMarket(frames: Frame[]): void {
  const ms = new Set(frames.map((f) => f.market));
  if (ms.size > 1) throw new Error('universeBaseline: frames must belong to one market');
}

export function universeBaselineDetail(frames: Frame[], horizons: number[], minN: number): BaselineDetail {
  assertOneMarket(frames);
  for (const h of horizons) if (!Number.isInteger(h) || h < 1) throw new RangeError('horizon must be a positive integer');
  const acc = new Map<string, Record<number, { s: number; n: number }>>();
  const excluded = { corp: 0, gap: 0 };
  for (const f of frames) {
    // P1 은 adj_stale·adj_orphan 행을 적재 단계에서 버린다 → 같은 결과가 되게 행을 빼고 계산
    const bars = f.bars.filter((_, i) => !f.excluded[i]);
    const corp = f.bars.map((_, i) => f.corpSuspect[i]).filter((_, i) => !f.excluded[i]);
    for (let j = 0; j < bars.length; j++) {
      const entry = bars[j + 1] ? bars[j + 1].open : NaN;
      if (!(entry > 0)) continue;
      const key = bars[j].date;
      for (const h of horizons) {
        const k = j + h;
        if (k >= bars.length) continue;
        let bad: 'corp' | 'gap' | null = null;
        for (let i = j; i <= k && !bad; i++) {
          if (corp[i]) bad = 'corp';
          else if (i > j && dayDiff(bars[i - 1].date, bars[i].date) > BAR_GAP_DAYS) bad = 'gap';
        }
        if (bad) { excluded[bad]++; continue; }
        if (!(bars[k].close > 0)) continue;
        if (!acc.has(key)) acc.set(key, {});
        const a = acc.get(key)!;
        a[h] = a[h] || { s: 0, n: 0 };
        a[h].s += bars[k].close / entry - 1;
        a[h].n++;
      }
    }
  }
  const byDate = new Map<string, Record<number, { mean: number; n: number } | null>>();
  for (const [key, a] of acc) {
    const v: Record<number, { mean: number; n: number } | null> = {};
    for (const h of horizons) v[h] = a[h] && a[h].n >= minN ? { mean: a[h].s / a[h].n, n: a[h].n } : null;
    byDate.set(key, v);
  }
  return { byDate, excluded };
}

/**
 * §C-1 시그니처. 날짜 → { h: 평균 수익 }. cost 를 주면 같은 왕복 비용을 뺀 값(순), null 이면 비용 전(P1 과 같음).
 * 표본 미달(minN) 지평은 키가 없다.
 */
export function universeBaseline(frames: Frame[], horizons: number[], cost: CostModel | null, minN: number): Map<string, Record<number, number>> {
  const d = universeBaselineDetail(frames, horizons, minN);
  const c = cost ? roundTrip(cost) : 0;
  const out = new Map<string, Record<number, number>>();
  for (const [date, v] of d.byDate) {
    const r: Record<number, number> = {};
    for (const h of horizons) { const p = v[h]; if (p) r[h] = p.mean - c; }
    if (Object.keys(r).length) out.set(date, r);
  }
  return out;
}

/** 거래일 기준 연환산 수익(CAGR). 점이 2개 미만이거나 시작값 ≤ 0 이면 null. */
export function cagr(s: Series, tradingDays: number): number | null {
  const n = s.values.length;
  if (n < 2 || !(s.values[0] > 0) || !(s.values[n - 1] > 0)) return null;
  return (s.values[n - 1] / s.values[0]) ** (tradingDays / (n - 1)) - 1;
}

/** 각 종목의 date 이하 마지막 유효 종가(제외 봉 건너뜀). 없으면 NaN. pos 는 종목별 탐색 위치(증가만). */
function lastCloseAt(f: Frame, date: string, pos: number[], fi: number): number {
  let p = pos[fi];
  while (p + 1 < f.bars.length && f.bars[p + 1].date <= date) p++;
  pos[fi] = p;
  for (let q = p; q >= 0; q--) if (!f.excluded[q] && f.bars[q].close > 0 && f.bars[q].date <= date) return f.bars[q].close;
  return NaN;
}

/**
 * 유니버스 동일가중 포트폴리오(현금 0 가정 1.0 시작). 매월 첫 거래일 종가에 그날 가격이 있는 종목으로 동일가중 재배분,
 * 매매 금액 × (왕복/2) 비용. 그 달 안에서는 비중이 흘러간다(보유). 반환 = 날짜별 가치.
 */
export function equalWeightMonthly(frames: Frame[], from: string, to: string, cost: CostModel | null): Series {
  assertOneMarket(frames);
  const cal = calendarOf(frames).filter((d) => d >= from && d <= to);
  const half = cost ? roundTrip(cost) / 2 : 0;
  const pos = frames.map(() => -1);
  let shares = new Map<number, number>(); // frame index → 보유 수량(분수)
  let value = 1;
  const dates: string[] = [];
  const values: number[] = [];
  let month = '';
  for (const d of cal) {
    const px = frames.map((f, fi) => lastCloseAt(f, d, pos, fi));
    // 현재 가치
    if (shares.size) {
      let v = 0;
      for (const [fi, q] of shares) v += q * (Number.isFinite(px[fi]) ? px[fi] : 0);
      value = v;
    }
    if (d.slice(0, 7) !== month) {
      month = d.slice(0, 7);
      const live = frames.map((f, fi) => fi).filter((fi) => frames[fi].bars.some((b) => b.date === d) && Number.isFinite(px[fi]));
      if (live.length) {
        const target = value / live.length;
        let traded = 0;
        const next = new Map<number, number>();
        for (const fi of live) next.set(fi, target / px[fi]);
        const all = new Set([...shares.keys(), ...next.keys()]);
        for (const fi of all) {
          const p = Number.isFinite(px[fi]) ? px[fi] : 0;
          traded += Math.abs(((next.get(fi) || 0) - (shares.get(fi) || 0)) * p);
        }
        const fee = traded * half;
        value -= fee;
        shares = new Map([...next].map(([fi, q]) => [fi, q * (value / (value + fee))]));
      }
    }
    dates.push(d);
    values.push(value);
  }
  return { dates, values };
}

/** 단일 종목(ETF) 보유: from 이후 첫 봉 종가 매수(편도 비용), to 까지 보유, 마지막 값에 매도 편도 비용 반영. */
export function buyAndHold(f: Frame, from: string, to: string, cost: CostModel | null): Series {
  const half = cost ? roundTrip(cost) / 2 : 0;
  const idx = f.bars.map((b, i) => i).filter((i) => !f.excluded[i] && f.bars[i].date >= from && f.bars[i].date <= to && f.bars[i].close > 0);
  if (!idx.length) return { dates: [], values: [] };
  const q = (1 - half) / f.bars[idx[0]].close;
  const dates = idx.map((i) => f.bars[i].date);
  const values = idx.map((i) => q * f.bars[i].close);
  values[values.length - 1] *= 1 - half;
  return { dates, values };
}

export function survivorshipDelta(universeEW: Series, indexEtf: Series, tradingDays: number): { deltaAnnual: number | null; perTradeFor: (holdDays: number) => number | null } {
  const u = cagr(universeEW, tradingDays);
  const e = cagr(indexEtf, tradingDays);
  const deltaAnnual = u === null || e === null ? null : Math.max(0, u - e);
  return {
    deltaAnnual,
    perTradeFor: (holdDays: number) => (deltaAnnual === null ? null : deltaAnnual * (holdDays / tradingDays)),
  };
}
