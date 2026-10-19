/**
 * T-055 1단계 — 매도 제안 미리보기 스위치·임계값 판독기 계약 (fail-closed).
 *
 * 켜짐은 **불리언 true 하나뿐**이다. 문자열 "true"·숫자 1·"on" 은 꺼짐.
 * 임계값은 하나라도 누락·숫자 아님·범위 밖이면 전체가 꺼진다(코드 기본값으로 메우지 않는다).
 */
const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import {
  readSellProposalPreviewPolicy,
  SELL_PROPOSAL_CONFIG_SEED,
  SELL_PROPOSAL_PREVIEW_ENABLED_KEY,
  SELL_PROPOSAL_STOP_PCT_KEY,
  SELL_PROPOSAL_RESTEP_PCT_KEY,
  SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY,
} from '../sell-proposal-policy';
import { resetUnparsableReports } from '@/lib/safety/flags';

type Cfg = Record<string, string | null | undefined>;
const GOOD: Cfg = {
  [SELL_PROPOSAL_PREVIEW_ENABLED_KEY]: 'true',
  [SELL_PROPOSAL_STOP_PCT_KEY]: '6',
  [SELL_PROPOSAL_RESTEP_PCT_KEY]: '5',
  [SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY]: '1',
};
function db(cfg: Cfg) {
  query.mockImplementation(async (_sql: string, params: string[]) => [
    params.filter(k => cfg[k] !== undefined).map(k => ({ key: k, value: cfg[k] })),
  ]);
}

beforeEach(() => {
  query.mockReset();
  resetUnparsableReports();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('켜짐 — 불리언 true + 유효한 임계값', () => {
  test('시드값 그대로 켜면 정책 6/5/1', async () => {
    db(GOOD);
    const r = await readSellProposalPreviewPolicy();
    expect(r).toEqual({
      enabled: true,
      policy: { stopPct: 6, restepPct: 5, reboundExitPct: 1 },
      source: 'config',
      problems: [],
    });
  });

  test('쿼리 1회 · 4개 키를 한 번에 읽는다 (캐시 없음 — 두 번 부르면 두 번 읽는다)', async () => {
    db(GOOD);
    await readSellProposalPreviewPolicy();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      SELL_PROPOSAL_PREVIEW_ENABLED_KEY, SELL_PROPOSAL_STOP_PCT_KEY,
      SELL_PROPOSAL_RESTEP_PCT_KEY, SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY,
    ]);
    await readSellProposalPreviewPolicy();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('🔴 스위치 — 불리언 true 가 아니면 전부 꺼짐', () => {
  test.each([
    ['"true"', 'not_boolean'],   // JSON 문자열 "true"
    ['1', 'not_boolean'],
    ['"1"', 'not_boolean'],
    ['on', 'not_boolean'],       // 비-JSON 원문
    ['TRUE', 'not_boolean'],
    ['yes', 'not_boolean'],
    ['{}', 'not_boolean'],
    ['[true]', 'not_boolean'],
    ['null', 'not_boolean'],
    ['false', 'config'],
    ['', 'absent'],
    ['   ', 'absent'],
  ])('스위치 원문 %s → 꺼짐(%s)', async (raw, source) => {
    db({ ...GOOD, [SELL_PROPOSAL_PREVIEW_ENABLED_KEY]: raw });
    const r = await readSellProposalPreviewPolicy();
    expect(r.enabled).toBe(false);
    expect(r.policy).toBeNull();
    expect(r.source).toBe(source);
  });

  test('스위치 키가 없으면 꺼짐(absent) — 기본 방향은 비활성', async () => {
    db({ ...GOOD, [SELL_PROPOSAL_PREVIEW_ENABLED_KEY]: undefined });
    const r = await readSellProposalPreviewPolicy();
    expect(r).toMatchObject({ enabled: false, policy: null, source: 'absent' });
  });

  test('DB 조회 실패 → 꺼짐(db_error), 던지지 않는다', async () => {
    query.mockRejectedValue(new Error('ECONNRESET'));
    const r = await readSellProposalPreviewPolicy();
    expect(r).toMatchObject({ enabled: false, policy: null, source: 'db_error' });
    expect(r.problems.join()).toContain('ECONNRESET');
  });

  test('getPool 자체가 던져도 꺼짐', async () => {
    query.mockImplementation(() => { throw new Error('setup fatal'); });
    const r = await readSellProposalPreviewPolicy();
    expect(r).toMatchObject({ enabled: false, source: 'db_error' });
  });

  test('쿼리 결과 형태가 이상해도(행 배열 아님) 꺼짐', async () => {
    query.mockResolvedValue([null]);
    const r = await readSellProposalPreviewPolicy();
    expect(r).toMatchObject({ enabled: false, source: 'absent' });
  });
});

describe('🔴 임계값 — 하나라도 문제면 전체 꺼짐 (코드 기본값으로 메우지 않는다)', () => {
  for (const key of [SELL_PROPOSAL_STOP_PCT_KEY, SELL_PROPOSAL_RESTEP_PCT_KEY, SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY]) {
    test(`${key} 누락 → 꺼짐`, async () => {
      db({ ...GOOD, [key]: undefined });
      const r = await readSellProposalPreviewPolicy();
      expect(r).toMatchObject({ enabled: false, policy: null, source: 'policy_invalid' });
      expect(r.problems.join()).toContain(key);
    });
  }

  test.each([
    [SELL_PROPOSAL_STOP_PCT_KEY, '"6"'],     // JSON 문자열 숫자
    [SELL_PROPOSAL_STOP_PCT_KEY, 'six'],
    [SELL_PROPOSAL_STOP_PCT_KEY, 'null'],
    [SELL_PROPOSAL_STOP_PCT_KEY, 'true'],
    [SELL_PROPOSAL_STOP_PCT_KEY, '0'],
    [SELL_PROPOSAL_STOP_PCT_KEY, '-6'],
    [SELL_PROPOSAL_STOP_PCT_KEY, '51'],
    [SELL_PROPOSAL_RESTEP_PCT_KEY, '0'],
    [SELL_PROPOSAL_RESTEP_PCT_KEY, '100'],
    [SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY, '-1'],
    [SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY, '6'],
  ])('%s = %s → 꺼짐(policy_invalid)', async (key, raw) => {
    db({ ...GOOD, [key]: raw });
    const r = await readSellProposalPreviewPolicy();
    expect(r).toMatchObject({ enabled: false, policy: null, source: 'policy_invalid' });
  });

  test('반복 호출해도 같은 문제는 로그 1회 (틱마다 스팸 금지)', async () => {
    db({ ...GOOD, [SELL_PROPOSAL_STOP_PCT_KEY]: '0' });
    await readSellProposalPreviewPolicy();
    await readSellProposalPreviewPolicy();
    await readSellProposalPreviewPolicy();
    expect((console.error as jest.Mock).mock.calls.length).toBe(1);
  });
});

describe('부팅 시드 — 설계 §3.3 이름·기본값, 스위치 기본 꺼짐', () => {
  test('시드는 스위치 false + 6/5/1', () => {
    expect(Object.fromEntries(SELL_PROPOSAL_CONFIG_SEED)).toEqual({
      sell_proposal_preview_enabled: 'false',
      sell_proposal_stop_pct: '6',
      sell_proposal_restep_pct: '5',
      sell_proposal_rebound_exit_pct: '1',
    });
  });

  test('🔴 db.ts 부팅 시드는 이 상수를 INSERT IGNORE 로만 쓴다 (운영자 값을 덮어쓰지 않는다)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'db.ts'), 'utf8');
    const start = src.indexOf("await import('@/lib/strategy/sell-proposal-policy')");
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, src.indexOf('} catch', start));
    expect(block).toContain('SELL_PROPOSAL_CONFIG_SEED');
    expect(block).toContain('INSERT IGNORE INTO system_config');
    expect(block).not.toMatch(/ON DUPLICATE KEY|REPLACE INTO|UPDATE system_config/i);
    // 키 문자열을 db.ts 에 따로 적지 않는다 (단일 소스)
    expect(src).not.toContain("'sell_proposal_preview_enabled'");
  });

  test('시드 그대로면 미리보기는 꺼져 있다', async () => {
    db(Object.fromEntries(SELL_PROPOSAL_CONFIG_SEED));
    const r = await readSellProposalPreviewPolicy();
    expect(r.enabled).toBe(false);
  });

  test('시드 임계값만 그대로 두고 스위치만 true 로 바꾸면 켜진다 (유효한 기본값)', async () => {
    db({ ...Object.fromEntries(SELL_PROPOSAL_CONFIG_SEED), [SELL_PROPOSAL_PREVIEW_ENABLED_KEY]: 'true' });
    const r = await readSellProposalPreviewPolicy();
    expect(r.enabled).toBe(true);
  });
});
