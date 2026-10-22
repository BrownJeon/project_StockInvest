import { getPool } from '@/lib/db';
import { checkPortfolioStability } from '../portfolio-stability';
import { DEFAULT_STYLE_CONFIG, type StyleConfig } from '../style';

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
  /** symbol → recent 24h 실주문(orders) buy count */
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
    // countRecentBuysForSymbol 은 signals 가 아니라 **orders**(실주문) 기준이다.
    // signals.auto_submitted 기준이면 dry_run·blocked 주문까지 세어 실거래 없이 한도에
    // 도달하는 버그가 있어 orders 로 전환됐다 (portfolio-stability.ts 주석 참조).
    if (/COUNT\(\*\)[\s\S]*FROM orders[\s\S]*side = 'buy'/i.test(sql)) {
      const sym = String(params[0]);
      const n = behavior.recentBuys?.[sym] ?? 0;
      return [[{ n }]];
    }
    throw new Error(`unexpected SQL: ${sql}`);
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
    expect(r.detail).toMatch(/24h 내 005930 buy 1건 ≥ 한도 1/);
  });

  test('maxPositionsPerSymbol 미만 → 카운트 통과 (공격 모드 한도 3, 실주문 2건)', async () => {
    setupPool({ recentBuys: { '005930': 2 }, tiers: { '005930': 'core' } });
    const r = await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 100_000, market: 'domestic',
      style: STYLE_AGGRESSIVE, heldAmounts: new Map(),
    });
    expect(r.verdict).toBe('pass');
  });

  test('T-068 WP-B — 코드 기본 한도 4: 24h 실주문 4건이면 skip(한도 4), 3건이면 카운트 통과', async () => {
    setupPool({ recentBuys: { '005930': 4 }, tiers: { '005930': 'core' } });
    const r4 = await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 100_000, market: 'domestic',
      style: DEFAULT_STYLE_CONFIG, heldAmounts: new Map(),
    });
    expect(r4.verdict).toBe('skip');
    expect(r4.reason).toBe('max_positions_exceeded');
    expect(r4.detail).toMatch(/24h 내 005930 buy 4건 ≥ 한도 4/);

    setupPool({ recentBuys: { '005930': 3 }, tiers: { '005930': 'core' } });
    const r3 = await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 100_000, market: 'domestic',
      style: DEFAULT_STYLE_CONFIG, heldAmounts: new Map(),
    });
    expect(r3.verdict).toBe('pass');
  });

  test('누적 카운트는 signals 가 아니라 orders 실주문 기준 (dry_run·blocked 제외)', async () => {
    // 회귀 방어: signals.auto_submitted 기준으로 되돌리면 DRY_RUN 만으로 한도가 소진돼
    // 실거래가 시작되기도 전에 매수가 영구 차단된다.
    setupPool({ recentBuys: { '005930': 0 } });
    await checkPortfolioStability({
      symbol: '005930', side: 'buy', amountKRW: 100_000, market: 'domestic',
      style: STYLE_STABLE, heldAmounts: new Map(),
    });
    const query = (getPool as jest.Mock).mock.results[0].value.query as jest.Mock;
    const countSql = query.mock.calls.map((c) => String(c[0])).find((s) => /COUNT\(\*\)/i.test(s));
    expect(countSql).toBeDefined();
    expect(countSql).toMatch(/FROM orders/i);
    expect(countSql).not.toMatch(/FROM signals/i);
    expect(countSql).toMatch(/status IN \('filled','accepted','partially_filled'\)/i);
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
