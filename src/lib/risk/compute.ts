/**
 * T-066 리스크 정책 계산 — 공용 순수 함수 (서버 라우트·클라이언트 화면이 같은 함수를 쓴다).
 *
 * 규칙: DB·fetch·Node 전용 API 금지. 입력만으로 결과가 정해진다.
 * 기준 구현: 승인 데모 v3 (`mockups/T-066-risk-policy-settings-v3.html`) 의 `stopOf`·`compute`·`gapsList`.
 *
 * 금액은 **원화로 계산**한다(청산 엔진과 같은 기준). `position_state.entry_price`·스냅샷 현재가가 모두
 * 원화 환산값이므로 손익률·손절가까지 거리 같은 비율은 환율 영향이 없다. USD 표시는 화면에서 `원화 ÷ fx`.
 *
 * 표시·위험 계산 전용이다 — 이 결과로 주문·매도를 만들지 않는다.
 */
import { LIMITS, type RiskPolicyEditable, type StopBasis } from './defaults';

export interface HoldingInput {
  symbol: string;
  market: 'domestic' | 'overseas';
  qty: number;
  /** 평균단가(원화). 없거나 0 이하면 계산 불가 */
  avgKrw: number | null;
  /** 보유 중 고점(원화). 고점 기준일 때만 필요 */
  peakKrw: number | null;
  /** 스냅샷 현재가(원화) */
  priceKrw: number | null;
}

export type NotComputableReason = 'no_avg' | 'no_peak' | 'no_price';

export interface HoldingRow {
  symbol: string;
  market: 'domestic' | 'overseas';
  qty: number;
  avgKrw: number | null;
  priceKrw: number | null;
  /** 평가액 = 현재가 × 수량 (현재가가 있을 때) */
  valueKrw: number | null;
  computable: boolean;
  reason: NotComputableReason | null;
  /** 손절 기준가 (avg → 평균단가, peak → max(고점, 현재가)) */
  refKrw: number | null;
  /** 예상 손절가 = ref × (1 − 손절폭) */
  stopKrw: number | null;
  /** 현재가 ≤ 예상 손절가 */
  below: boolean;
  /** 현재가가 손절가 위이면서 남은 폭 1% 미만 */
  near: boolean;
  /** 현재가에서 손절가까지 남은 폭 % ((현재가 − 손절가) ÷ 현재가) — 손절가 위일 때 */
  distPct: number | null;
  /** 손절가보다 낮은 정도 % ((손절가 − 현재가) ÷ 손절가) — 이미 아래일 때 */
  underPct: number | null;
  /** 손절 시 손익 = (손절가 − 평균단가) × 수량 */
  pnlAtStopKrw: number | null;
  pnlAtStopPct: number | null;
  /** 지금 평가손익 = (현재가 − 평균단가) × 수량 */
  unrealKrw: number | null;
  unrealPct: number | null;
}

export interface RiskComposition {
  holdingsCount: number;
  topSymbol: string | null;
  /** 가장 큰 종목의 총자산 대비 비중 % */
  topPct: number | null;
  /** 현금의 총자산 대비 % (cashKrw 가 주어졌을 때) */
  cashPct: number | null;
  /** 주식 평가액 중 미국 비중 % */
  overseasPct: number | null;
}

export interface RiskComputed {
  rows: HoldingRow[];
  totalKrw: number;
  /** 계산 가능한 종목의 취득원가 합 (평균단가 × 수량) */
  costKrw: number;
  /** 손절 합 — 모든 종목이 예상 손절가에 닿을 때 손실만 더한 값 (≥ 0) */
  heatKrw: number;
  /** 손절 합 ÷ 총자산 % (총자산을 모르면 null) */
  heatPct: number | null;
  /** 한도 금액 = 한도% × 총자산 */
  capKrw: number;
  /** 사용률 % = 손절 합 ÷ 한도 금액 (한도 금액이 0이면 null) */
  usagePct: number | null;
  over: boolean;
  belowCount: number;
  belowSymbols: string[];
  /** 이미 손절가 아래인 종목들의 평가손익 합 (보통 음수) */
  belowLossKrw: number;
  belowLossPct: number | null;
  /** 한도를 지키는 최대 손절폭 % (0.01 단위 내림, 최대 20). 계산 가능한 종목이 없거나 총자산을 모르면 null */
  maxStopPct: number | null;
  computableCount: number;
  /** 계산 불가 종목이 하나라도 있으면 true — '일부 계산 불가' 표시 */
  partial: boolean;
  composition: RiskComposition;
}

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

function refOf(h: HoldingInput, basis: StopBasis): number | null {
  if (basis === 'avg') return pos(h.avgKrw) ? h.avgKrw : null;
  // 고점 기준 — 데모와 같이 고점이 현재가보다 낮게 기록돼 있으면 현재가를 고점으로 본다
  if (!pos(h.peakKrw)) return null;
  return pos(h.priceKrw) ? Math.max(h.peakKrw, h.priceKrw) : h.peakKrw;
}

/** 예상 손절가 (원화) */
export function stopPriceKrw(ref: number, stopPct: number): number {
  return ref * (1 - stopPct / 100);
}

function heatAt(holdings: HoldingInput[], stopPct: number, basis: StopBasis): number {
  let sum = 0;
  for (const h of holdings) {
    if (!pos(h.avgKrw)) continue;
    const ref = refOf(h, basis);
    if (ref === null) continue;
    const stop = stopPriceKrw(ref, stopPct);
    sum += Math.max(0, h.avgKrw - stop) * h.qty;
  }
  return sum;
}

const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;

/**
 * 보유 종목·총자산·정책으로 예상 손절가·손절 합·사용률·역산 손절폭을 계산한다.
 * qty ≤ 0 인 종목은 보유가 아니므로 제외한다.
 */
export function computeRisk(
  holdingsIn: HoldingInput[],
  totalKrwIn: number,
  policy: RiskPolicyEditable,
  cashKrw: number | null = null,
): RiskComputed {
  const holdings = holdingsIn.filter(h => Number.isFinite(h.qty) && h.qty > 0);
  const totalKrw = Number.isFinite(totalKrwIn) && totalKrwIn > 0 ? totalKrwIn : 0;
  const { stopPct, heatCapPct, stopBasis } = policy;

  const rows: HoldingRow[] = holdings.map((h) => {
    const priceKrw = pos(h.priceKrw) ? h.priceKrw : null;
    const avgKrw = pos(h.avgKrw) ? h.avgKrw : null;
    const valueKrw = priceKrw !== null ? priceKrw * h.qty : null;
    const ref = refOf(h, stopBasis);
    const reason: NotComputableReason | null =
      avgKrw === null ? 'no_avg' : ref === null ? 'no_peak' : priceKrw === null ? 'no_price' : null;
    const base = {
      symbol: h.symbol, market: h.market, qty: h.qty, avgKrw, priceKrw, valueKrw,
      unrealKrw: avgKrw !== null && priceKrw !== null ? (priceKrw - avgKrw) * h.qty : null,
      unrealPct: avgKrw !== null && priceKrw !== null ? (priceKrw - avgKrw) / avgKrw * 100 : null,
    };
    if (reason !== null && reason !== 'no_price') {
      return { ...base, computable: false, reason, refKrw: null, stopKrw: null, below: false, near: false,
        distPct: null, underPct: null, pnlAtStopKrw: null, pnlAtStopPct: null };
    }
    // 여기서 avgKrw·ref 는 확정. 현재가가 없으면 손절가·손절 시 손익은 계산하되 거리는 모른다.
    const stop = stopPriceKrw(ref as number, stopPct);
    const a = avgKrw as number;
    const below = priceKrw !== null && priceKrw <= stop;
    return {
      ...base,
      computable: reason === null,
      reason,
      refKrw: ref,
      stopKrw: stop,
      below,
      near: priceKrw !== null && !below && (priceKrw - stop) / priceKrw * 100 < 1,
      distPct: priceKrw !== null && !below ? (priceKrw - stop) / priceKrw * 100 : null,
      underPct: priceKrw !== null && below ? (stop - priceKrw) / stop * 100 : null,
      pnlAtStopKrw: (stop - a) * h.qty,
      pnlAtStopPct: (stop - a) / a * 100,
    };
  });

  // 손절 합은 손절가를 구할 수 있는 종목(평균단가·기준가 있음)으로만 — 현재가가 없어도 손절 손실은 정해진다
  const heatRows = rows.filter(r => r.pnlAtStopKrw !== null);
  const heatKrw = heatRows.reduce((a, r) => a + Math.max(0, -(r.pnlAtStopKrw as number)), 0);
  const costKrw = heatRows.reduce((a, r) => a + (r.avgKrw as number) * r.qty, 0);
  const capKrw = totalKrw * heatCapPct / 100;
  const below = rows.filter(r => r.below);
  const belowLossKrw = below.reduce((a, r) => a + (r.unrealKrw ?? 0), 0);

  let maxStopPct: number | null = null;
  if (totalKrw > 0 && heatRows.length > 0) {
    if (stopBasis === 'avg') {
      maxStopPct = costKrw > 0 ? Math.min(floor2(heatCapPct * totalKrw / costKrw), LIMITS.stopPct.max) : null;
    } else {
      const H = holdings;
      const hi0 = LIMITS.stopPct.max;
      if (heatAt(H, hi0, 'peak') <= capKrw) maxStopPct = hi0;
      else {
        let lo = 0, hi = hi0;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (heatAt(H, mid, 'peak') <= capKrw) lo = mid; else hi = mid;
        }
        maxStopPct = floor2(lo);
      }
    }
  }

  // 구성 (읽기 전용 정책표의 '현재 상태')
  const valued = rows.filter(r => r.valueKrw !== null);
  const top = valued.slice().sort((a, b) => (b.valueKrw as number) - (a.valueKrw as number))[0] ?? null;
  const stockValue = valued.reduce((a, r) => a + (r.valueKrw as number), 0);
  const usValue = valued.filter(r => r.market === 'overseas').reduce((a, r) => a + (r.valueKrw as number), 0);

  return {
    rows,
    totalKrw,
    costKrw,
    heatKrw,
    heatPct: totalKrw > 0 ? heatKrw / totalKrw * 100 : null,
    capKrw,
    usagePct: capKrw > 0 ? heatKrw / capKrw * 100 : null,
    over: totalKrw > 0 && heatKrw > capKrw,
    belowCount: below.length,
    belowSymbols: below.map(r => r.symbol),
    belowLossKrw,
    belowLossPct: totalKrw > 0 ? belowLossKrw / totalKrw * 100 : null,
    maxStopPct,
    computableCount: rows.filter(r => r.computable).length,
    partial: rows.some(r => !r.computable),
    composition: {
      holdingsCount: rows.length,
      topSymbol: top ? top.symbol : null,
      topPct: top && totalKrw > 0 ? (top.valueKrw as number) / totalKrw * 100 : null,
      cashPct: cashKrw !== null && Number.isFinite(cashKrw) && totalKrw > 0 ? cashKrw / totalKrw * 100 : null,
      overseasPct: stockValue > 0 ? usValue / stockValue * 100 : null,
    },
  };
}

// ─── 입력 검증 (서버 PUT·클라이언트 입력 공용) ─────────────────────────────

export interface FieldCheck {
  /** 저장을 막는 오류 문구 */
  error: string | null;
  /** 저장은 되지만 알리는 경고 문구 */
  warning: string | null;
  /** 소수 2자리 반올림된 값 (오류면 null) */
  value: number | null;
}

/**
 * 입력 문자열/숫자 → 숫자 ('%'·공백 무시). 빈 값·숫자 아님은 NaN.
 * 쉼표는 받지 않는다 — 퍼센트에 천 단위 구분이 없고, '1,5' 를 15 로 읽으면 소수점 오타가 10배 값이 된다(Reviewer L-4).
 */
export function parsePct(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== 'string') return NaN;
  if (raw.includes(',')) return NaN;
  const s = raw.replace(/[%\s]/g, '');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 소수 2자리 반올림 (2.345 → 2.35 — 부동소수 표현 오차 보정) */
export const round2 = (n: number) => Math.round((n + Math.sign(n) * Number.EPSILON * Math.max(1, Math.abs(n))) * 100) / 100;

export function checkStopPct(raw: unknown): FieldCheck {
  const n = parsePct(raw);
  if (Number.isNaN(n)) return { error: '숫자를 넣어 주세요.', warning: null, value: null };
  const v = round2(n);
  if (v < LIMITS.stopPct.min || v > LIMITS.stopPct.max) return { error: '0.5% ~ 20% 사이로 넣어 주세요.', warning: null, value: null };
  return {
    error: null,
    warning: v > LIMITS.stopPct.warnAbove ? '10%보다 크면 손절이 늦어져 한 번에 잃는 돈이 커집니다.' : null,
    value: v,
  };
}

export function checkHeatCapPct(raw: unknown): FieldCheck {
  const n = parsePct(raw);
  if (Number.isNaN(n)) return { error: '숫자를 넣어 주세요.', warning: null, value: null };
  const v = round2(n);
  if (v < LIMITS.heatCapPct.min || v > LIMITS.heatCapPct.max) return { error: '0.5% ~ 10% 사이로 넣어 주세요.', warning: null, value: null };
  return { error: null, warning: null, value: v };
}

export function isStopBasis(v: unknown): v is StopBasis {
  return v === 'avg' || v === 'peak';
}
