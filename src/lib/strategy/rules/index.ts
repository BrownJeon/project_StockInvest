import type { StrategyMeta } from './types';
import { rsiOversold }       from './rsi-oversold';
import { maCross }           from './ma-cross';
import { bbBreakout }        from './bb-breakout';
import { rsiMacdReversal }   from './rsi-macd-reversal';
import { bbSqueezeExpansion } from './bb-squeeze-expansion';
import { rsiDivergence }     from './rsi-divergence';
import { tripleConfirmation } from './triple-confirmation';

export const STRATEGY_REGISTRY: Record<string, StrategyMeta> = {
  'rsi-oversold-v1':         { fn: rsiOversold,        interval: '30m', minCandles: 30, profile: 'mean-rev', topN: 3 },
  'ma-cross-v1':             { fn: maCross,            interval: '1h',  minCandles: 30, profile: 'trend',    topN: 3 },
  'bb-breakout-v1':          { fn: bbBreakout,         interval: '30m', minCandles: 30, profile: 'breakout', topN: 3 },
  'rsi-macd-reversal-v1':    { fn: rsiMacdReversal,    interval: '30m', minCandles: 30, profile: 'mean-rev', topN: 3 },
  'bb-squeeze-expansion-v1': { fn: bbSqueezeExpansion, interval: '30m', minCandles: 30, profile: 'breakout', topN: 3 },
  'rsi-divergence-v1':       { fn: rsiDivergence,      interval: '30m', minCandles: 30, profile: 'mean-rev', topN: 3 },
  'triple-confirmation-v1':  { fn: tripleConfirmation, interval: '30m', minCandles: 30, profile: 'mean-rev', topN: 3 },
};
