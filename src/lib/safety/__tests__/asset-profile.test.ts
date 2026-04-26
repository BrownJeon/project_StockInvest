import { getStageLimits, isVerifySkipActive } from '../asset-profile';

// DB 접근을 차단해 auto 분기의 DB 쿼리 실패 시에도 테스트가 deterministic하게 동작
jest.mock('@/lib/db', () => ({
  getPool: () => { throw new Error('db not available in tests'); },
}));

describe('getStageLimits', () => {
  test('verify: 10,000 / 50,000', async () => {
    expect(await getStageLimits('verify')).toEqual({ orderMaxKRW: 10_000, dailyOrderMaxKRW: 50_000 });
  });
  test('pilot: 50,000 / 300,000', async () => {
    expect(await getStageLimits('pilot')).toEqual({ orderMaxKRW: 50_000, dailyOrderMaxKRW: 300_000 });
  });
  test('stage2_plus: 300,000 / 1,500,000', async () => {
    expect(await getStageLimits('stage2_plus')).toEqual({ orderMaxKRW: 300_000, dailyOrderMaxKRW: 1_500_000 });
  });
});

describe('isVerifySkipActive — 강제 모드', () => {
  const origCrypto = process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY;
  const origStock = process.env.ASSET_PROFILE_STOCK_SKIP_VERIFY;
  afterEach(() => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = origCrypto;
    process.env.ASSET_PROFILE_STOCK_SKIP_VERIFY = origStock;
  });

  test('crypto=true → 항상 ON', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'true';
    expect(await isVerifySkipActive('crypto')).toBe(true);
  });

  test('crypto=false → 항상 OFF', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
    expect(await isVerifySkipActive('crypto')).toBe(false);
  });

  test('crypto auto + DB 실패 → OFF (안전 기본값)', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'auto';
    // DB mock이 throw하므로 catch 경로를 타고 false를 반환
    expect(await isVerifySkipActive('crypto')).toBe(false);
  });

  test('잘못된 값은 기본값으로 폴백', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'bogus';
    // crypto 기본은 auto → DB 실패 → false
    expect(await isVerifySkipActive('crypto')).toBe(false);
  });
});
