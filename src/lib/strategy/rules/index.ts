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

/**
 * 전략 레지스트리.
 *
 * ⚠️ **장중 룰의 interval 은 전부 `1h` 로 통일한다** (T-003 §2, Phase 2 Step 3).
 *    구 30m 표기는 엔진에서 adaptive-interval 로 1h 승격되기도 하고 아니기도 해서
 *    (실측: 90종목 중 23종목만 1h) **룰의 의미가 레짐에 따라 바뀌었다**.
 *    시간축이 흔들리는 룰은 백테스트가 불가능하고, 백테스트가 불가능한 룰은 운용할 수 없다.
 *    엔진은 `resolveEngineInterval()` 로 한 번 더 정규화하므로 여기에 30m 이 다시 들어와도
 *    실행 축은 1h 로 강제되지만, 백테스트(`/api/backtest`)는 이 값을 그대로 쓰므로
 *    **선언값 자체를 1h 로 맞춰야 룰과 백테스트의 축이 일치**한다.
 *    1d 룰은 원래 국면·변동성과 무관하므로 1d 유지.
 */
export const STRATEGY_REGISTRY: Record<string, StrategyMeta> = {
  'rsi-oversold-v1':         { fn: rsiOversold,         interval: '1h', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'rsi-overbought-exit-v1':  { fn: rsiOverboughtExit,   interval: '1h', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'ma-cross-v1':             { fn: maCross,             interval: '1h', minCandles: 30,  profile: 'trend',    topN: 3 },
  'bb-breakout-v1':          { fn: bbBreakout,          interval: '1h', minCandles: 30,  profile: 'breakout', topN: 3 },
  'rsi-macd-reversal-v1':    { fn: rsiMacdReversal,     interval: '1h', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'bb-squeeze-expansion-v1': { fn: bbSqueezeExpansion,  interval: '1h', minCandles: 30,  profile: 'breakout', topN: 3 },
  'rsi-divergence-v1':       { fn: rsiDivergence,       interval: '1h', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'triple-confirmation-v1':  { fn: tripleConfirmation,  interval: '1h', minCandles: 30,  profile: 'mean-rev', topN: 3 },
  'volume-spike-breakout-v1': { fn: volumeSpikeBreakout, interval: '1h', minCandles: 30,  profile: 'breakout', topN: 3 },
  'pullback-trend-v1':       { fn: pullbackTrend,       interval: '1h', minCandles: 30,  profile: 'trend',    topN: 3 },
  'weekly-trend-follow-v1':  { fn: weeklyTrendFollow,   interval: '1d',  minCandles: 210, profile: 'trend',    topN: 5 },
  'dividend-quality-buyback-v1': { fn: dividendQualityBuyback, interval: '1d', minCandles: 210, profile: 'trend', topN: 5 },
  'price-breakout-v1':          { fn: priceBreakout,           interval: '1h', minCandles: 5,  profile: 'breakout', topN: 3 },
};
