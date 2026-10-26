/**
 * T-096 1단계 구현 신호 함수 목록 — **S1·S7 만**. S2·S4 와 Tier B 는 사전 등록(registry)에는 있지만 구현하지 않았다
 * (사용자 확정: S1 IS 결과 뒤 다시 결정). 목록에 없는 전략을 러너가 요청하면 '미구현'으로 거부한다.
 * signalParams = 격자 파라미터 중 신호 함수가 받는 것(나머지 hold·stop·regime 은 체결·필터 쪽).
 */
import type { Frame, Params, Signal } from '../types';
import * as s1 from './rsi-oversold-daily';
import * as s7 from './control-spike-contraction';

export interface SignalModule {
  id: string;
  minBars: number;
  signalParams: string[];
  evaluate: (frame: Frame, i: number, params: Params) => Signal | null;
}

export const SIGNALS: Readonly<Record<string, SignalModule>> = Object.freeze({
  [s1.ID]: { id: s1.ID, minBars: s1.MIN_BARS, signalParams: ['th'], evaluate: s1.evaluate },
  [s7.ID]: { id: s7.ID, minBars: s7.MIN_BARS, signalParams: [], evaluate: s7.evaluate },
});

export function signalModule(id: string): SignalModule | null {
  return Object.prototype.hasOwnProperty.call(SIGNALS, id) ? SIGNALS[id] : null;
}
