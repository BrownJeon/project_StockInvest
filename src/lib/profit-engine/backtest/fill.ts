/**
 * T-096 체결 모델(§B-4·§A-2). 순수 함수.
 *
 * d1openFill(판정용): 신호 D0(위치 i) → 진입 = D+1(i+1) 시가, 시간 청산 = D+h(i+hold) 종가(D+1 = 진입 당일, P1 d1open 정의).
 *   - 갭 필터: open_{D+1} / close_D ≥ 1+gapUp 또는 ≤ 1−gapDown 이면 미진입('gap_skip'). **경계값은 미진입**(§C-4 시험 계약).
 *     (§A-2 표는 `>`/`<` 로 적혀 있어 §C-4 와 다르다 — 보고 대상. 여기서는 §C-4 를 따른다.)
 *   - 유동성 필터: 슬롯 금액 > ADTV20(D0 포함 직전 20봉 거래대금 평균) × adtvMaxShare 이면 미진입('liquidity_skip').
 *     거래대금이 20봉 모두 있지 않으면 판단 불가 → 미진입(보수). 진입봉이 거래 불가(zero_volume 등)여도 'liquidity_skip'.
 *   - 손절: 진입 당일 포함, low ≤ 진입가×(1−stop) 이면 그날 손절 — open < 손절가면 시가, 아니면 손절가. 같은 날 선후 불명은 손절 먼저.
 *   - 거래 불가일(zero_volume)에는 손절·청산하지 않고, 청산일이 거래 불가면 다음 거래 가능 봉 종가로 미룬다.
 *   - 비용: 시간 청산 = 왕복, 손절 = 손절 비용(가산식, P1 과 같음).
 *   - 보유 창(i..i+hold)이 데이터 끝을 넘거나 결측 구간·제외 봉을 포함하면 null(청산되지 않은 에피소드).
 * limitFill(민감도용, T-064 §6.3): 지정가 = close_D×(1+chasePct), D+1 당일만 유효, low_{D+1} < 지정가 − 1틱 이면
 *   체결가 = min(open_{D+1}, 지정가). 미체결은 'unfilled'. 이후 손절·청산 규칙은 d1openFill 과 같다.
 */
import { roundTrip, stopCost } from './costs';
import { isTradable, windowBroken } from './frames';
import type { CostModel, Fill, Frame } from './types';

/** 모든 값은 registry(execution·portfolio)에서 온다 — 기본값을 코드에 두지 않는다(단일 출처, v1.1 H-1). */
export interface FillOptions {
  gapUp: number;
  gapDown: number;
  /** 'skip' = 경계값(정확히 +gapUp/−gapDown)은 미진입(v1.1 ① 확정), 'enter' = 경계값은 진입. */
  gapBoundary: 'skip' | 'enter';
  /** 슬롯 금액(현지 통화). null 이면 유동성 필터를 쓰지 않는다(시험용). */
  slotAmount: number | null;
  adtvWindow: number;
  adtvMaxShare: number;
}

const EPS = 1e-12;

/** D0(위치 i) 포함 직전 n 봉 거래대금 평균. n 봉 모두 유한하지 않으면 null. */
export function adtv(f: Frame, i: number, n: number): number | null {
  if (i - n + 1 < 0) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) {
    const t = f.bars[k].turnover;
    if (t === null || !Number.isFinite(t) || t < 0) return null;
    s += t;
  }
  return s / n;
}

/** 갭 필터 — 미진입이면 true. close·open 이 양수가 아니면 true(판단 불가). boundary='skip' 이면 경계값도 미진입. */
export function gapSkip(closeD0: number, openD1: number, gapUp: number, gapDown: number, boundary: 'skip' | 'enter'): boolean {
  if (!(closeD0 > 0 && openD1 > 0)) return true;
  const r = openD1 / closeD0;
  if (boundary === 'skip') return r >= 1 + gapUp - EPS || r <= 1 - gapDown + EPS;
  return r > 1 + gapUp + EPS || r < 1 - gapDown - EPS;
}

/** 미국 1틱 = $0.01, 국내 = KRX 호가 단위(2023 개편). */
export function tickSize(market: 'US' | 'KR', price: number): number {
  if (market === 'US') return 0.01;
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

const skip = (f: Frame, e: number, kind: Fill['exitKind'], price: number): Fill => ({
  entryDate: f.bars[e].date, entryPrice: price, exitDate: f.bars[e].date, exitPrice: price, exitKind: kind, grossRet: 0, netRet: 0,
});

/** 진입 뒤 보유·손절·청산(공용). e = 진입 봉, x = 계획 청산 봉. */
function holdAndExit(f: Frame, e: number, x: number, entryPrice: number, stopPct: number | null, cost: CostModel): Fill | null {
  const stopPrice = stopPct === null ? null : entryPrice * (1 - stopPct);
  for (let k = e; k < f.bars.length; k++) {
    if (!isTradable(f, k)) continue; // 거래 불가일: 손절·청산 없음
    // 계획 청산일(x) 뒤로 미뤄진 경우: x..k 사이가 결측 구간·제외 봉이면 청산을 정할 수 없다
    if (k > x && windowBroken(f, x, k)) return null;
    const b = f.bars[k];
    if (stopPrice !== null && b.low <= stopPrice) {
      const px = b.open < stopPrice ? b.open : stopPrice;
      const gross = px / entryPrice - 1;
      return { entryDate: f.bars[e].date, entryPrice, exitDate: b.date, exitPrice: px, exitKind: 'stop', grossRet: gross, netRet: gross - stopCost(cost) };
    }
    if (k >= x) {
      const gross = b.close / entryPrice - 1;
      return { entryDate: f.bars[e].date, entryPrice, exitDate: b.date, exitPrice: b.close, exitKind: 'time', grossRet: gross, netRet: gross - roundTrip(cost) };
    }
  }
  return null;
}

function validate(hold: number, stopPct: number | null): void {
  if (!Number.isInteger(hold) || hold < 1) throw new RangeError('hold must be a positive integer');
  if (stopPct !== null && !(stopPct > 0 && stopPct < 1)) throw new RangeError('stopPct must be in (0,1)');
}

/** 공통 진입 전 점검. 통과하면 null, 아니면 건너뜀 Fill. */
function preEntry(f: Frame, i: number, e: number, o: FillOptions): Fill | null {
  if (!isTradable(f, e)) return skip(f, e, 'liquidity_skip', f.bars[e].open);
  if (o.slotAmount !== null) {
    const a = adtv(f, i, o.adtvWindow);
    if (a === null || o.slotAmount > a * o.adtvMaxShare) return skip(f, e, 'liquidity_skip', f.bars[e].open);
  }
  return null;
}

export function d1openFill(f: Frame, i: number, hold: number, stopPct: number | null, cost: CostModel, opts: FillOptions): Fill | null {
  validate(hold, stopPct);
  const e = i + 1;
  const x = i + hold;
  if (i < 0 || x >= f.bars.length) return null;
  if (windowBroken(f, i, x)) return null;
  if (isTradable(f, e) && gapSkip(f.bars[i].close, f.bars[e].open, opts.gapUp, opts.gapDown, opts.gapBoundary)) return skip(f, e, 'gap_skip', f.bars[e].open);
  const pre = preEntry(f, i, e, opts);
  if (pre) return pre;
  return holdAndExit(f, e, x, f.bars[e].open, stopPct, cost);
}

export function limitFill(f: Frame, i: number, hold: number, stopPct: number | null, cost: CostModel, chasePct: number, opts: FillOptions): Fill | null {
  validate(hold, stopPct);
  const e = i + 1;
  const x = i + hold;
  if (i < 0 || x >= f.bars.length) return null;
  if (windowBroken(f, i, x)) return null;
  const pre = preEntry(f, i, e, opts);
  if (pre) return pre;
  const limit = f.bars[i].close * (1 + chasePct);
  const b = f.bars[e];
  if (!(b.low < limit - tickSize(f.market, limit))) return skip(f, e, 'unfilled', limit);
  return holdAndExit(f, e, x, Math.min(b.open, limit), stopPct, cost);
}

export const isTaken = (fl: Fill | null): fl is Fill => !!fl && (fl.exitKind === 'time' || fl.exitKind === 'stop');
