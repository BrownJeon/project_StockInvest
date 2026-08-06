/**
 * 통합 쿨다운 단위 테스트 (T-003 §4-3).
 *
 * 지키는 계약:
 *  1. **fail-open** — 조회 실패 시 전 후보 통과 (쿨다운은 억제 필터지 자금 안전장치가 아니다).
 *  2. **NULL 금지 / 빈 문자열 센티넬** — scope 별로 쓰지 않는 키 컬럼은 '' 로 정규화돼야
 *     UNIQUE(scope,symbol,strategy_id,side,exit_kind) 가 실제로 dedup 을 수행한다.
 *     (MySQL/MariaDB UNIQUE 는 NULL 을 서로 다른 값으로 취급 → NULL 이면 무한 증식)
 *  3. **쿨다운은 줄어들지 않는다** — 사람 거부 4h 직후 시그널 생성 2h 로 덮여 짧아지면 안 된다.
 */
import { getPool } from '@/lib/db';
import {
  COOLDOWN_TTL_MIN,
  CooldownSet,
  loadActiveCooldowns,
  pruneExpiredCooldowns,
  setCooldown,
  __resetCooldownPruneThrottleForTest,
} from '../cooldowns';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

interface Captured { sql: string; params: unknown[] }

function mockPool(rows: unknown[] = [], opts: { throwOn?: RegExp } = {}) {
  const captured: Captured[] = [];
  const query = jest.fn(async (sqlArg: unknown, paramsArg: unknown[] = []) => {
    const sql = String(sqlArg);
    captured.push({ sql, params: paramsArg ?? [] });
    if (opts.throwOn && opts.throwOn.test(sql)) throw new Error('db exploded');
    if (/SELECT[\s\S]*FROM cooldowns/i.test(sql)) return [rows];
    return [{ affectedRows: 1 }];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return captured;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetCooldownPruneThrottleForTest();
});

/** 실제 로더를 거쳐 스냅샷을 만든다 — 키 직렬화 규칙까지 함께 검증된다. */
async function setFrom(rows: Array<Partial<Record<string, unknown>>>) {
  mockPool(rows.map(r => ({
    scope: r.scope, symbol: r.symbol,
    strategy_id: r.strategy_id ?? '', side: r.side ?? '', exit_kind: r.exit_kind ?? '',
    until: r.until,
  })));
  return loadActiveCooldowns();
}

describe('CooldownSet — 판정', () => {
  const future = new Date(Date.now() + 60 * 60_000);
  const past = new Date(Date.now() - 60 * 60_000);

  test('entry 는 (symbol, strategy, side) 조합이 정확히 일치할 때만 활성', async () => {
    const set = await setFrom([
      { scope: 'entry', symbol: '005930', strategy_id: 'rsi-oversold-v1', side: 'buy', until: future },
    ]);
    expect(set.isActive({ scope: 'entry', symbol: '005930', strategyId: 'rsi-oversold-v1', side: 'buy' })).toBe(true);
    // 방향이 다르면 별개
    expect(set.isActive({ scope: 'entry', symbol: '005930', strategyId: 'rsi-oversold-v1', side: 'sell' })).toBe(false);
    // 전략이 다르면 별개
    expect(set.isActive({ scope: 'entry', symbol: '005930', strategyId: 'ma-cross-v1', side: 'buy' })).toBe(false);
    // 종목이 다르면 별개
    expect(set.isActive({ scope: 'entry', symbol: '000660', strategyId: 'rsi-oversold-v1', side: 'buy' })).toBe(false);
  });

  test('rebuy 는 symbol 만 보고, strategy/side 를 주더라도 무시된다', async () => {
    const set = await setFrom([{ scope: 'rebuy', symbol: '005930', until: future }]);
    expect(set.isActive({ scope: 'rebuy', symbol: '005930' })).toBe(true);
    expect(set.isActive({ scope: 'rebuy', symbol: '005930', strategyId: 'x', side: 'buy' })).toBe(true);
    expect(set.isActive({ scope: 'rebuy', symbol: '000660' })).toBe(false);
  });

  test('exit 은 (symbol, exit_kind) 조합', async () => {
    const set = await setFrom([{ scope: 'exit', symbol: '005930', exit_kind: 'hard_stop', until: future }]);
    expect(set.isActive({ scope: 'exit', symbol: '005930', exitKind: 'hard_stop' })).toBe(true);
    // 다른 청산 종류는 막히지 않는다 — 손절과 익절은 별개 사건이다
    expect(set.isActive({ scope: 'exit', symbol: '005930', exitKind: 'target_profit' })).toBe(false);
  });

  test('scope 가 다르면 서로 간섭하지 않는다', async () => {
    const set = await setFrom([{ scope: 'rebuy', symbol: '005930', until: future }]);
    expect(set.isActive({ scope: 'entry', symbol: '005930', strategyId: '', side: 'buy' })).toBe(false);
    expect(set.isActive({ scope: 'exit', symbol: '005930', exitKind: '' })).toBe(false);
  });

  test('만료된 쿨다운은 비활성', async () => {
    const set = await setFrom([{ scope: 'rebuy', symbol: '005930', until: past }]);
    expect(set.isActive({ scope: 'rebuy', symbol: '005930' })).toBe(false);
  });

  test('조회 실패 스냅샷은 전부 fail-open', () => {
    const set = new CooldownSet(new Map(), 'connection lost');
    expect(set.loadError).toBe('connection lost');
    expect(set.isActive({ scope: 'rebuy', symbol: '005930' })).toBe(false);
  });
});

describe('loadActiveCooldowns', () => {
  test('DB row 를 키 맵으로 적재한다', async () => {
    const until = new Date(Date.now() + 30 * 60_000);
    mockPool([
      { scope: 'entry', symbol: '005930', strategy_id: 'rsi-oversold-v1', side: 'buy', exit_kind: '', until },
      { scope: 'rebuy', symbol: '000660', strategy_id: '', side: '', exit_kind: '', until },
    ]);
    const set = await loadActiveCooldowns();
    expect(set.loadError).toBeNull();
    expect(set.size).toBe(2);
    expect(set.isActive({ scope: 'entry', symbol: '005930', strategyId: 'rsi-oversold-v1', side: 'buy' })).toBe(true);
    expect(set.isActive({ scope: 'rebuy', symbol: '000660' })).toBe(true);
  });

  test('조회 실패해도 throw 하지 않고 fail-open 스냅샷을 준다', async () => {
    mockPool([], { throwOn: /SELECT/i });
    const set = await loadActiveCooldowns();
    expect(set.loadError).toBeTruthy();
    expect(set.isActive({ scope: 'rebuy', symbol: '005930' })).toBe(false);
  });
});

describe('setCooldown — 키 정규화 (NULL 금지)', () => {
  test('entry: strategy/side 는 값 그대로, exit_kind 는 빈 문자열', async () => {
    const cap = mockPool();
    await setCooldown(
      { scope: 'entry', symbol: '005930', strategyId: 'rsi-oversold-v1', side: 'buy' },
      COOLDOWN_TTL_MIN.entry,
      'signal_created',
    );
    const ins = cap.find(c => /INSERT INTO cooldowns/i.test(c.sql))!;
    expect(ins.params.slice(0, 5)).toEqual(['entry', '005930', 'rsi-oversold-v1', 'buy', '']);
    expect(ins.params[5]).toBe(120);
  });

  test('rebuy: 쓰지 않는 키는 NULL 이 아니라 빈 문자열이어야 UNIQUE 가 작동한다', async () => {
    const cap = mockPool();
    await setCooldown({ scope: 'rebuy', symbol: '005930', strategyId: 'x', side: 'buy' }, COOLDOWN_TTL_MIN.rebuy);
    const ins = cap.find(c => /INSERT INTO cooldowns/i.test(c.sql))!;
    expect(ins.params.slice(0, 5)).toEqual(['rebuy', '005930', '', '', '']);
    expect(ins.params.slice(2, 5).some(v => v === null || v === undefined)).toBe(false);
    expect(ins.params[5]).toBe(30);
  });

  test('exit: exit_kind 만 채운다', async () => {
    const cap = mockPool();
    await setCooldown({ scope: 'exit', symbol: '005930', exitKind: 'hard_stop' }, COOLDOWN_TTL_MIN.exit);
    const ins = cap.find(c => /INSERT INTO cooldowns/i.test(c.sql))!;
    expect(ins.params.slice(0, 5)).toEqual(['exit', '005930', '', '', 'hard_stop']);
    expect(ins.params[5]).toBe(15);
  });

  test('UPSERT 는 GREATEST 로 늘리기만 한다 (사람 거부 4h 가 2h 로 짧아지면 안 된다)', async () => {
    const cap = mockPool();
    await setCooldown({ scope: 'entry', symbol: '005930', strategyId: 's', side: 'buy' }, COOLDOWN_TTL_MIN.entry);
    const ins = cap.find(c => /INSERT INTO cooldowns/i.test(c.sql))!;
    expect(ins.sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(ins.sql).toMatch(/GREATEST\(VALUES\(`until`\), `until`\)/);
  });

  test('설정 실패는 삼킨다 (쿨다운 기록 실패로 매매를 멈추지 않는다)', async () => {
    mockPool([], { throwOn: /INSERT INTO cooldowns/i });
    await expect(setCooldown({ scope: 'rebuy', symbol: '005930' }, 30)).resolves.toBe(false);
  });

  test('사람 거부 TTL 은 시그널 생성 TTL 보다 길다', () => {
    expect(COOLDOWN_TTL_MIN.entryRejected).toBeGreaterThan(COOLDOWN_TTL_MIN.entry);
  });
});

describe('pruneExpiredCooldowns', () => {
  test('실패해도 0 을 반환하고 throw 하지 않는다', async () => {
    mockPool([], { throwOn: /DELETE FROM cooldowns/i });
    await expect(pruneExpiredCooldowns()).resolves.toBe(0);
  });
});
