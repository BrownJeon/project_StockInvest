import { getPool } from '@/lib/db';
import { checkPortfolioStability } from '../portfolio-stability';
import type { StyleConfig } from '../style';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

const STYLE_STABLE: StyleConfig = {
  rsiBuyThreshold: 30, rsiSellThreshold: 70, rsiSellPriceMult: 1.01,
  minProfitMargin: 0.04, rebuyCooldownMin: 1440, minAiConfidence: 75,
  atrStopMult: 2.5, minRWinPct: 6.0,
  holdingPeriodDays: { min: 90, max: 180 },
  targetProfitPct: 10.0,
  universeSource: 'kospi100',
  stableCoreRatioMin: 0.70,
  maxPositionsPerSymbol: 1,
};

const STYLE_AGGRESSIVE: StyleConfig = { ...STYLE_STABLE, stableCoreRatioMin: 0.20, maxPositionsPerSymbol: 3 };

interface MockBehavior {
  /** symbol → tier in symbol_universe */
  tiers?: Record<string, 'core' | 'satellite' | 'speculative'>;
  /** symbol → recent 24h buy count */
  recentBuys?: Record<string, number>;
}

function setupPool(behavior: MockBehavior = {}): void {
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    const params = paramsArg ?? [];

    if (/FROM symbol_universe WHERE symbol = \?/i.test(sql)) {
      const sym = String(params[0]);
      const tier = behavior.tiers?.[sym];
      return tier ? [[{ tier }]] : [[]];
    }
    if (/COUNT\(\*\)[\s\S]*FROM signals[\s\S]*side = 'buy'/i.test(sql)) {
      const sym = String(params[0]);
      const n = behavior.recentBuys?.[sym] ?? 0;
      return [[{ n }]];
    }
    return [[]];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
}

describe('checkPortfolioStability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('SELL → 항상 통과', async () => {
    setupPool();
    const r = await checkPortfolioStability({
      symbol: '005930', side: 'sell', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });

  test('해외 시장 → 항상 통과', async () => {
    setupPool();
    const r = await checkPortfolioStability({
      symbol: 'AAPL', side: 'buy', amountKRW: 1_000_000, market: 'overseas',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });

  test('maxPositionsPerSymbol 초과 → skip', async () => {
    setupPool({ recentBuys: { '005930': 1 } });
    const r = await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 100_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('skip');
    expect(r.reason).toBe('max_positions_exceeded');
  });

  test('빈 포트폴리오 부트스트랩 → pass (안정 모드, speculative 매수)', async () => {
    // 빈 포트폴리오에서는 신규 매수가 어느 tier든 자유 통과 (bootstrap).
    // 데드락 회피: 코어 보유 0이면 speculative도 차단되어 시드 확보 불가능했던 버그 수정.
    setupPool({ tiers: { '263750': 'speculative' } });
    const r = await checkPortfolioStability({
      symbol: '263750', side: 'buy', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });

  test('기존 보유에 core 0% 이고 speculative만 있는 경우 → skip (안정 모드)', async () => {
    // 기존 보유 1M (모두 speculative), 신규 speculative 매수 → ratio = 0/2M = 0 < 0.7 → skip
    setupPool({ tiers: { '247540': 'speculative', '263750': 'speculative' } });
    const heldAmounts = new Map([['247540', { qty: 10, avgPrice: 100_000 }]]); // 1M speculative
    const r = await checkPortfolioStability({
      symbol: '263750', side: 'buy', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts,
    });
    expect(r.verdict).toBe('skip');
    expect(r.reason).toBe('core_ratio_below_min');
  });

  test('stableCoreRatioMin 통과 — core 매수', async () => {
    setupPool({ tiers: { '005930': 'core' } });
    const r = await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });

  test('stableCoreRatioMin 통과 — 기존 core 보유 비중 충분', async () => {
    // 기존 core 보유 9M, 신규 satellite 매수 1M → ratio = 9/10 = 0.9 ≥ 0.7 → pass
    setupPool({
      tiers: { '005930': 'core', '247540': 'satellite' },
    });
    const heldAmounts = new Map([['005930', { qty: 100, avgPrice: 90_000 }]]);  // 9M KRW
    const r = await checkPortfolioStability({
      symbol: '247540', side: 'buy', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts,
    });
    expect(r.verdict).toBe('pass');
  });

  test('공격 모드 — 빈 포트폴리오 부트스트랩 → pass (speculative 단독 매수)', async () => {
    // 부트스트랩 정책: 빈 포트폴리오에서는 모든 tier 통과 (안정/공격 모드 동일 정책)
    setupPool({ tiers: { '263750': 'speculative' } });
    const r = await checkPortfolioStability({
      symbol: '263750', side: 'buy', amountKRW: 1_000_000, market: 'domestic',
      style: STYLE_AGGRESSIVE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });
});
