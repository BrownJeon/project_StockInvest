import { getPool } from '@/lib/db';
import { getCurrentStage, isVerifySkipActive } from '../asset-profile';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

function mockHasFilledRows(has: boolean) {
  // 1st call: system_config → empty (DB override 없음, env/auto 로직으로 fallthrough)
  // 2nd call: orders → has 여부에 따라 결과 반환
  const query = jest.fn()
    .mockResolvedValueOnce([[]])
    .mockResolvedValue([has ? [{ 1: 1 }] : []]);
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}

describe('isVerifySkipActive — auto 분기 (DB 의존)', () => {
  const orig = process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY;
  beforeEach(() => { process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'auto'; });
  afterEach(() => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = orig;
    jest.clearAllMocks();
  });

  test('filled 이력 있으면 스킵 ON', async () => {
    const query = mockHasFilledRows(true);
    expect(await isVerifySkipActive('crypto')).toBe(true);
    const [sql, params] = query.mock.calls[1]; // calls[0]는 system_config 조회
    expect(String(sql)).toMatch(/FROM orders/);
    expect(String(sql)).toMatch(/status IN \('filled','partially_filled'/);
    expect(params[0]).toBe('crypto');
  });

  test('filled 이력 없으면 스킵 OFF', async () => {
    mockHasFilledRows(false);
    expect(await isVerifySkipActive('crypto')).toBe(false);
  });

  test('DB 실패 시 안전 기본값 OFF', async () => {
    const query = jest.fn().mockRejectedValue(new Error('boom'));
    (getPool as jest.Mock).mockReturnValue({ query });
    expect(await isVerifySkipActive('crypto')).toBe(false);
  });

  test('crypto auto + 이력 있음 → 강제 true/false가 auto를 override', async () => {
    mockHasFilledRows(true);
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
    expect(await isVerifySkipActive('crypto')).toBe(false);
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'true';
    expect(await isVerifySkipActive('crypto')).toBe(true);
  });
});

describe('getCurrentStage', () => {
  const orig = process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY;
  afterEach(() => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = orig;
    jest.clearAllMocks();
  });

  test('스킵 OFF → verify 단계', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'false';
    expect(await getCurrentStage('crypto')).toBe('verify');
  });

  test('스킵 ON → pilot 단계', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'true';
    expect(await getCurrentStage('crypto')).toBe('pilot');
  });

  test('auto + 이력 있음 → pilot', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'auto';
    mockHasFilledRows(true);
    expect(await getCurrentStage('crypto')).toBe('pilot');
  });

  test('auto + 이력 없음 → verify', async () => {
    process.env.ASSET_PROFILE_CRYPTO_SKIP_VERIFY = 'auto';
    mockHasFilledRows(false);
    expect(await getCurrentStage('crypto')).toBe('verify');
  });
});
