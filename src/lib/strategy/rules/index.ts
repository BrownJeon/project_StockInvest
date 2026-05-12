import type { StrategyMeta } from './types';
import { rsiOversold }         from './rsi-oversold';
import { rsiOverboughtExit }   from './rsi-overbought-exit';
import { maCross }             from './ma-cross';
import { bbBreakout }          from './bb-breakout';
import { rsiMacdReversal }     from './rsi-macd-reversal';
import { bbSqueezeExpansion }  from './bb-squeeze-expansion';
import { rsiDivergence }       from './rsi-divergence';
import { tripleConfirmation }  from './triple-confirmation';
import { volumeSpikeBreakout } from './volume-spike-breakout';
import { pullbackTrend }       from './pullback-trend';
import { weeklyTrendFollow }   from './weekly-trend-follow';
import { dividendQualityBuyback } from './dividend-quality-buyback';
import { priceBreakout }          from './price-breakout';

export const STRATEGY_REGISTRY: Record<string, StrategyMeta> = {
  'rsi-oversold-v1':         { fn: rsiOversold,         interval: '30m', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'rsi-overbought-exit-v1':  { fn: rsiOverboughtExit,   interval: '30m', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'ma-cross-v1':             { fn: maCross,             interval: '1h',  minCandles: 30,  profile: 'trend',    topN: 3 },
  'bb-breakout-v1':          { fn: bbBreakout,          interval: '30m', minCandles: 30,  profile: 'breakout', topN: 3 },
  'rsi-macd-reversal-v1':    { fn: rsiMacdReversal,     interval: '30m', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'bb-squeeze-expansion-v1': { fn: bbSqueezeExpansion,  interval: '30m', minCandles: 30,  profile: 'breakout', topN: 3 },
  'rsi-divergence-v1':       { fn: rsiDivergence,       interval: '30m', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'triple-confirmation-v1':  { fn: tripleConfirmation,  interval: '30m', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'volume-spike-breakout-v1': { fn: volumeSpikeBreakout, interval: '30m', minCandles: 30,  profile: 'breakout', topN: 3 },
  'pullback-trend-v1':       { fn: pullbackTrend,       interval: '30m', minCandles: 30,  profile: 'trend',    topN: 3 },
  'weekly-trend-follow-v1':  { fn: weeklyTrendFollow,   interval: '1d',  minCandles: 210, profile: 'trend',    topN: 5 },
  'dividend-quality-buyback-v1': { fn: dividendQualityBuyback, interval: '1d', minCandles: 210, profile: 'trend', topN: 5 },
  'price-breakout-v1':          { fn: priceBreakout,           interval: '30m', minCandles: 5,  profile: 'breakout', topN: 3 },
};
