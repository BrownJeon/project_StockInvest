import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { SignalInput } from '@/lib/signals/router';
import type { StrategyProfile } from '@/lib/strategy/universe';
import type { StyleConfig } from '@/lib/strategy/style';

export interface RuleContext {
  strategyId: string;
  symbol: string;
  candles: Candle[];  // ascending (oldest first)
  ticker: Ticker;
  amountKRW: number;
  style: StyleConfig;
}

export type RuleFunction = (ctx: RuleContext) => SignalInput[];

export interface StrategyMeta {
  fn: RuleFunction;
  interval: string;
  minCandles: number;
  /** universe 활성 시 사용할 전략 프로파일 */
  profile?: StrategyProfile;
  /** universe에서 선택할 종목 수 (기본 3) */
  topN?: number;
}
