import { getRouterConfig, isAnalystEnabled, routeSignal, type SignalInput } from '../router';

jest.mock('@/lib/db', () => ({
  getPool: () => { throw new Error('db not available in tests'); },
}));

const baseInput: SignalInput = {
  symbol: 'KRW-BTC',
  side: 'buy',
  orderType: 'limit',
  price: 90_000_000,
  quantity: 0.0001,
  amountKRW: 9_000,
};

describe('routeSignal', () => {
  test('analystEnabled=true → auto_submit', () => {
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, true);
    expect(r.route).toBe('auto_submit');
  });

  test('analystEnabled=false → pending_approval', () => {
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, false);
    expect(r.route).toBe('pending_approval');
  });

  test('expiresAt 미지정 시 now + defaultTtlMin 적용', () => {
    const now = new Date('2026-04-19T10:00:00Z');
    const r = routeSignal(baseInput, { defaultTtlMin: 30 }, true, now);
    expect(r.expiresAt.getTime()).toBe(now.getTime() + 30 * 60_000);
  });

  test('expiresAt(ISO 문자열) 지정 시 그대로 사용', () => {
    const target = '2026-04-20T00:00:00Z';
    const r = routeSignal({ ...baseInput, expiresAt: target }, { defaultTtlMin: 30 }, true);
    expect(r.expiresAt.toISOString()).toBe(new Date(target).toISOString());
  });
});

describe('getRouterConfig', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  test('환경변수 읽어오기', async () => {
    process.env.SIGNAL_DEFAULT_TTL_MIN = '15';
    expect(await getRouterConfig()).toEqual({ defaultTtlMin: 15 });
  });

  test('잘못된 값은 기본값 30', async () => {
    process.env.SIGNAL_DEFAULT_TTL_MIN = '-10';
    expect(await getRouterConfig()).toEqual({ defaultTtlMin: 30 });
  });
});

describe('isAnalystEnabled', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  test('기본값은 false', async () => {
    delete process.env.ANALYST_ENABLED;
    expect(await isAnalystEnabled()).toBe(false);
  });

  test('"true" 문자열만 활성화', async () => {
    process.env.ANALYST_ENABLED = 'true';
    expect(await isAnalystEnabled()).toBe(true);
    process.env.ANALYST_ENABLED = 'TRUE';
    expect(await isAnalystEnabled()).toBe(true);
    process.env.ANALYST_ENABLED = '1';
    expect(await isAnalystEnabled()).toBe(false);
  });
});
