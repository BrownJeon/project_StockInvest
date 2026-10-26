/**
 * T-096 비용 모델(§B-4) — 왕복 = 수수료 왕복 + 슬리피지, 손절 = 수수료 왕복 + 손절 슬리피지.
 *   US 0.65% = 0.25+0.25+0.15, 손절 0.75% · KR 0.33% = 0.18+0.15, 손절 0.43%. 민감도 = 슬리피지 ×k(수수료 불변).
 * 거래 수준 순수익은 P1(postmortem-core)과 같이 **가산식**: netRet = grossRet − 비용.
 */
import type { CostModel } from './types';

export const roundTrip = (c: CostModel): number => c.feeRoundTrip + c.slippage;
export const stopCost = (c: CostModel): number => c.feeRoundTrip + c.stopSlippage;

/** 슬리피지만 k 배(손절 슬리피지 포함). k < 0 · 비유한 값은 거부. */
export function scaleSlippage(c: CostModel, k: number): CostModel {
  if (!(Number.isFinite(k) && k >= 0)) throw new RangeError('slippage multiplier must be >= 0');
  return { feeRoundTrip: c.feeRoundTrip, slippage: c.slippage * k, stopSlippage: c.stopSlippage * k };
}

export function assertCostModel(c: CostModel): CostModel {
  for (const k of ['feeRoundTrip', 'slippage', 'stopSlippage'] as const) {
    if (!(Number.isFinite(c[k]) && c[k] >= 0 && c[k] < 0.1)) throw new RangeError(`cost.${k} out of range`);
  }
  return c;
}
