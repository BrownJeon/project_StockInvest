/**
 * Phase 0 — isDryRun() fail-safe 테스트.
 *
 * DRY_RUN 은 "실거래 차단" 스위치이므로, 값이 애매하면 **ON(차단)** 쪽으로 기울어야 한다.
 * 이전 구현(`val === true || val === 'true'`)은 `1` · `"1"` · `"ON"` · 오타를 전부
 * false(=실거래 개시)로 해석했다 — fail-open.
 *
 * 3분기 계약: 미설정 → ON(안전) / 정상 인식 → 그 값 / 해석 불가 → ON + console.error 경고
 */
import { getPool } from '@/lib/db';
import { isDryRun } from '../dry-run';
import { resetUnparsableReports } from '../flags';

jest.mock('@/lib/db', () => ({ getPool: jest.fn(), getAccountId: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

/** system_config.safety_dry_run 값(JSON 문자열)을 흉내낸다. undefined = 키 없음. */
function mockConfig(rawJson: string | undefined) {
  const query = jest.fn(async () => (rawJson === undefined ? [[]] : [[{ value: rawJson }]]));
  (getPool as jest.Mock).mockReturnValue({ query });
}

function mockConfigThrows() {
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn().mockRejectedValue(new Error('db down')) });
}

const origEnv = { ...process.env };
let errSpy: jest.SpyInstance;

beforeEach(() => {
  resetUnparsableReports();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  process.env = { ...origEnv };
  jest.clearAllMocks();
});

describe('isDryRun — DB 값 해석', () => {
  test('명시적 true 계열은 ON', async () => {
    for (const raw of ['true', '"true"', '1', '"1"', '"on"', '"YES"', '" TRUE "']) {
      mockConfig(raw);
      await expect(isDryRun()).resolves.toBe(true);
    }
  });

  test('명시적 false 계열만 OFF', async () => {
    for (const raw of ['false', '"false"', '0', '"0"', '"off"', '"no"']) {
      mockConfig(raw);
      await expect(isDryRun()).resolves.toBe(false);
    }
  });

  test('해석 불가한 값은 ON (fail-safe) + console.error 경고', async () => {
    mockConfig('"maybe"');
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/해석할 수 없음/);
  });

  test('오타(flase)는 ON — 조용히 실거래로 넘어가지 않는다', async () => {
    mockConfig('"flase"');
    await expect(isDryRun()).resolves.toBe(true);
  });

  test('같은 해석 불가 값 반복 호출 시 경고는 1회만', async () => {
    mockConfig('"maybe"');
    await isDryRun();
    await isDryRun();
    await isDryRun();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  test('DB 값이 null 이면 미설정 취급 → env 폴백', async () => {
    mockConfig('null');
    process.env.DRY_RUN = 'false';
    await expect(isDryRun()).resolves.toBe(false);
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe('isDryRun — env 폴백', () => {
  test('DB 키 없음 + DRY_RUN 미설정 → ON', async () => {
    mockConfig(undefined);
    delete process.env.DRY_RUN;
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).not.toHaveBeenCalled();  // 미설정은 경고 대상 아님
  });

  test('DB 조회 실패 + DRY_RUN=false → OFF (명시적 해제만 허용)', async () => {
    mockConfigThrows();
    process.env.DRY_RUN = 'false';
    await expect(isDryRun()).resolves.toBe(false);
  });

  test('DB 조회 실패 + DRY_RUN 오타 → ON + 경고', async () => {
    mockConfigThrows();
    process.env.DRY_RUN = 'flase';
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  test('DRY_RUN=0 은 OFF, DRY_RUN=1 은 ON', async () => {
    mockConfig(undefined);
    process.env.DRY_RUN = '0';
    await expect(isDryRun()).resolves.toBe(false);
    process.env.DRY_RUN = '1';
    await expect(isDryRun()).resolves.toBe(true);
  });

  test('DRY_RUN="" 은 미설정 취급 → ON', async () => {
    mockConfig(undefined);
    process.env.DRY_RUN = '';
    await expect(isDryRun()).resolves.toBe(true);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
